// Lightning Address (LUD-16) hosting for chat users.
//
//   <username>@<host>  →  GET https://<host>/.well-known/lnurlp/<username>
//                          → returns LNURL-pay metadata + callback URL
//                          → external wallet calls callback → returns BOLT-11 invoice
//
// We don't run our own LN node. Instead each pay request spawns a Cashu
// mint quote at the recipient's preferred mint (cashu.cz by default).
// The mint provides the invoice; once paid, the mint holds a custodial
// claim against `quote_id`. The recipient's app polls
// /api/lnurlp/pending/:ownerId on next open and redeems each quote
// client-side via cashu-ts (`wallet.mintProofs`), which produces real
// blinded ecash proofs tied to *their* secrets — server never sees them.
//
// Custodial caveat: between "paid" and "claimed", the mint holds the
// sats. If the mint dies in that window, those sats are stuck. The UI
// makes this clear ("Cashu mint = trusted custodian during pending").

import { db } from "../db.js";
import { validOwnerId } from "../helpers.js";
import { sendPushToTag } from "../push.js";
import { buildUserTag } from "../../../shared/pushTags.js";

const DEFAULT_MINT_URL = "https://cashu.cz";

// Username allowlist: lowercase ASCII, digits, dashes, underscores.
// 3-32 chars. Matches what most other Lightning Address services accept.
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

/** Mark a quote paid + fire a one-shot push notification to the
 *  recipient's user:<ownerId> tag. Idempotent — re-marking already-paid
 *  rows is a no-op (we set paid_at via WHERE clause guard). */
async function markPaidAndNotify(row) {
  const r = db.prepare(`
    UPDATE lnurl_payment SET paid_at = datetime('now')
    WHERE quote_id = ? AND paid_at IS NULL
  `).run(row.quote_id);
  if (r.changes === 0) return; // already marked, don't double-notify
  try {
    const sats = row.amount_sats.toLocaleString("cs-CZ");
    const body = row.comment
      ? `${sats} sats · ${String(row.comment).slice(0, 80)}`
      : `${sats} sats čekají v Peněžence`;
    await sendPushToTag(buildUserTag(row.owner_id), {
      title: "⚡ Příchozí platba",
      body,
      url: "/#wallet",
      tag: `lnurl-${row.quote_id}`,
      renotify: false,
    }, { ttl: 24 * 60 * 60 });
  } catch (e) {
    console.warn("[lnurlp] notify failed:", e.message);
  }
}

/** Background poller — every 30s walk recent unpaid quotes, ask each
 *  mint, mark paid + notify when state flips. Necessary because most
 *  users don't keep the app open; the in-app polling in useLnurlClaim
 *  only runs when wallet tab is mounted. */
let pollerInterval = null;
export function startLnurlPoller(intervalMs = 30_000) {
  if (pollerInterval) return;
  const tick = async () => {
    // Limit window: rows older than 24h are unlikely to ever pay (the
    // mint quote has expired) — leave them be, GC later.
    const rows = db.prepare(`
      SELECT quote_id, owner_id, mint_url, amount_sats, invoice, comment
      FROM lnurl_payment
      WHERE paid_at IS NULL
        AND datetime(created_at) > datetime('now', '-24 hours')
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    if (rows.length === 0) return;
    // One fetch per row (mints don't have a batch endpoint). Keep the
    // total wall time bounded by polling sequentially.
    for (const row of rows) {
      try {
        const resp = await fetch(`${row.mint_url}/v1/mint/quote/bolt11/${encodeURIComponent(row.quote_id)}`);
        if (!resp.ok) continue;
        const q = await resp.json();
        const isPaid = q?.state === "PAID" || q?.state === "ISSUED" || q?.paid === true;
        if (isPaid) await markPaidAndNotify(row);
      } catch { /* mint flaky → skip */ }
    }
  };
  // Fire one immediately so a freshly-restarted backend catches up.
  void tick();
  pollerInterval = setInterval(() => { void tick(); }, intervalMs);
  console.info(`[lnurlp] background poller running every ${intervalMs}ms`);
}

/** Slugify a display_name into a Lightning Address username candidate. */
function suggestUsername(displayName) {
  return String(displayName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function mountLnurlRoutes(app) {
  // Pretty domain for LN addresses. Falls back to request host.
  // In prod nginx routes both /.well-known and /api/lnurlp here, so the
  // username@host part of the address is whatever the user typed in
  // their wallet — no separate config required.
  const hostFromReq = (req) => req.get("host") || "jednadvacet.gorrdy.cz";

  // ── LNURL CORS proxy ─────────────────────────────────────────────
  // Most LNURL services (bitlifi.com, lnbits installations, getalby,
  // walletofsatoshi …) ship `Access-Control-Allow-Origin` allow-listed
  // for one or two known web wallets, not ours. A browser-based wallet
  // can't read those responses directly, so we forward the GET through
  // the backend (no CORS in server-to-server fetches) and ship the
  // result back to the wallet which IS on our origin.
  //
  // SSRF guard: HTTPS-only, no private IP ranges, no `file://` /
  // `data://` etc. Capped response size + 10 s timeout. Body relayed
  // verbatim with the upstream Content-Type so the JSON status / error
  // shape from the LNURL service flows through unchanged.
  const PRIVATE_HOST_RE = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|::1|fc00:|fe80:)/i;
  app.get("/api/lnurl/proxy", async (req, res) => {
    const target = String(req.query?.url ?? "");
    if (!/^https:\/\//i.test(target)) {
      return res.status(400).json({ error: "https URL required" });
    }
    let parsed;
    try { parsed = new URL(target); } catch { return res.status(400).json({ error: "bad URL" }); }
    const host = parsed.hostname.toLowerCase();
    if (PRIVATE_HOST_RE.test(host) || host.endsWith(".local")) {
      return res.status(400).json({ error: "private host not allowed" });
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const r = await fetch(target, {
        method: "GET",
        headers: { "User-Agent": "Jednadvacet/1.0 LNURL-Proxy" },
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const body = await r.text();
      // 256 KB cap — LNURL responses are small JSON; anything bigger
      // is either a misconfigured service or an attacker abusing the
      // proxy as a generic fetcher.
      if (body.length > 256 * 1024) {
        return res.status(502).json({ error: "upstream response too large" });
      }
      res
        .status(r.status)
        .type(r.headers.get("content-type") ?? "application/json")
        .send(body);
    } catch (e) {
      const msg = e.name === "AbortError" ? "upstream timeout" : (e.message ?? "proxy error");
      res.status(502).json({ error: msg });
    }
  });

  // ── User-facing: claim / change Lightning username ─────────────
  app.get("/api/lnurlp/suggest/:ownerId", (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const u = db.prepare(
      "SELECT display_name, lightning_username FROM chat_user WHERE owner_id = ?",
    ).get(ownerId);
    if (!u) return res.status(404).json({ error: "no chat profile" });
    res.json({
      current: u.lightning_username ?? null,
      suggestion: suggestUsername(u.display_name),
      host: hostFromReq(req),
    });
  });

  app.post("/api/lnurlp/claim", (req, res) => {
    const { ownerId, username } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: "username must be 3-32 chars [a-z0-9_-]" });
    }
    const u = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(ownerId);
    if (!u) return res.status(404).json({ error: "no chat profile" });
    // Reject reserved/system-y usernames to avoid conflicts with future
    // routes. Short list — extend as needed.
    const RESERVED = new Set(["admin", "support", "info", "api", "www", "root", "system", "jednadvacet"]);
    if (RESERVED.has(username)) return res.status(409).json({ error: "username reserved" });

    const clash = db.prepare(`
      SELECT owner_id FROM chat_user
      WHERE lightning_username = ? AND owner_id != ?
    `).get(username, ownerId);
    if (clash) return res.status(409).json({ error: "username taken" });

    db.prepare("UPDATE chat_user SET lightning_username = ? WHERE owner_id = ?")
      .run(username, ownerId);
    res.json({ ok: true, username, host: hostFromReq(req) });
  });

  app.delete("/api/lnurlp/claim", (req, res) => {
    const ownerId = req.body?.ownerId ?? req.query?.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    db.prepare("UPDATE chat_user SET lightning_username = NULL WHERE owner_id = ?").run(ownerId);
    res.json({ ok: true });
  });

  // ── LUD-16 step 1: well-known metadata ────────────────────────
  // External wallets fetch this when the user types `<username>@<host>`.
  // Returns the callback URL for the actual invoice generation step.
  app.get("/.well-known/lnurlp/:username", async (req, res) => {
    const username = String(req.params.username ?? "").toLowerCase();
    if (!USERNAME_RE.test(username)) return res.status(400).json({ status: "ERROR", reason: "bad username" });
    const u = db.prepare("SELECT owner_id, display_name FROM chat_user WHERE lightning_username = ?").get(username);
    if (!u) return res.status(404).json({ status: "ERROR", reason: "username not found" });

    const host = hostFromReq(req);
    const callback = `https://${host}/api/lnurlp/${encodeURIComponent(username)}/callback`;
    // LUD-06 metadata: JSON-stringified array of [mime, value] pairs.
    const metadata = JSON.stringify([
      ["text/plain", `Pay to ${username}@${host}`],
      ["text/identifier", `${username}@${host}`],
    ]);
    res.json({
      status: "OK",
      tag: "payRequest",
      callback,
      minSendable: 1000,           // 1 sat in millisats
      maxSendable: 10_000_000_000, // 10M sats — soft cap
      metadata,
      commentAllowed: 280,         // LUD-12 short comment
    });
  });

  // ── LUD-16 step 2: callback returns BOLT-11 invoice ───────────
  // The mint quote is created here with the recipient's mint of choice.
  // We persist (quote_id → owner_id) so the recipient's client can
  // claim proofs once paid.
  app.get("/api/lnurlp/:username/callback", async (req, res) => {
    const username = String(req.params.username ?? "").toLowerCase();
    if (!USERNAME_RE.test(username)) return res.status(400).json({ status: "ERROR", reason: "bad username" });
    const u = db.prepare("SELECT owner_id FROM chat_user WHERE lightning_username = ?").get(username);
    if (!u) return res.status(404).json({ status: "ERROR", reason: "username not found" });

    const amountMsat = Number(req.query?.amount);
    if (!Number.isFinite(amountMsat) || amountMsat < 1000 || amountMsat > 10_000_000_000) {
      return res.status(400).json({ status: "ERROR", reason: "amount out of range" });
    }
    if (amountMsat % 1000 !== 0) {
      return res.status(400).json({ status: "ERROR", reason: "amount must be whole sats (multiple of 1000 msat)" });
    }
    const amountSats = Math.floor(amountMsat / 1000);
    const comment = typeof req.query?.comment === "string"
      ? String(req.query.comment).slice(0, 280)
      : null;

    // Pick mint: recipient's first registered mint, or the default.
    // We don't persist this on the user record (yet) — keep it simple
    // and route every Lightning address to the default for now. A
    // followup can let users pick a per-address mint.
    const mintUrl = DEFAULT_MINT_URL;

    // Spawn a mint quote at the cashu mint via its own HTTP API.
    // NUT-04: POST /v1/mint/quote/bolt11 { unit: "sat", amount: <sats> }
    let quote;
    try {
      const r = await fetch(`${mintUrl}/v1/mint/quote/bolt11`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: "sat", amount: amountSats }),
      });
      if (!r.ok) throw new Error(`mint quote ${r.status}`);
      quote = await r.json();
    } catch (e) {
      console.error("[lnurlp] mint quote failed:", e.message);
      return res.status(502).json({ status: "ERROR", reason: "mint unavailable" });
    }

    if (!quote?.quote || !quote?.request) {
      return res.status(502).json({ status: "ERROR", reason: "mint returned bad quote" });
    }

    db.prepare(`
      INSERT INTO lnurl_payment (quote_id, owner_id, mint_url, amount_sats, invoice, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(quote.quote, u.owner_id, mintUrl, amountSats, quote.request, comment);

    res.json({
      status: "OK",
      pr: quote.request,
      routes: [],
    });
  });

  // ── User app: pending mint quotes for this user ────────────────
  // Client polls on app open + on Wallet tab open. Returns paid-but-
  // unclaimed quotes plus older still-unpaid ones (so UI can show
  // "incoming payment" placeholders).
  app.get("/api/lnurlp/pending/:ownerId", async (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    const rows = db.prepare(`
      SELECT quote_id, mint_url, amount_sats, invoice, comment, created_at, paid_at
      FROM lnurl_payment
      WHERE owner_id = ? AND claimed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `).all(ownerId);

    // Refresh paid status from each mint for any not-yet-paid rows that
    // are recent enough to still matter. Group by mint to keep call
    // count low; one fetch per mint regardless of how many quotes.
    const byMint = new Map();
    for (const r of rows) {
      if (r.paid_at) continue;
      const arr = byMint.get(r.mint_url) ?? [];
      arr.push(r);
      byMint.set(r.mint_url, arr);
    }
    for (const [mintUrl, group] of byMint) {
      for (const r of group) {
        try {
          const resp = await fetch(`${mintUrl}/v1/mint/quote/bolt11/${encodeURIComponent(r.quote_id)}`);
          if (!resp.ok) continue;
          const q = await resp.json();
          // NUT-04 v1: state = "UNPAID" | "PAID" | "ISSUED"
          const isPaid = q?.state === "PAID" || q?.state === "ISSUED" || q?.paid === true;
          if (isPaid) {
            await markPaidAndNotify(r);
            r.paid_at = new Date().toISOString();
          }
        } catch { /* mint flaky → skip */ }
      }
    }

    res.json({
      pending: rows.map((r) => ({
        quoteId: r.quote_id,
        mintUrl: r.mint_url,
        amountSats: r.amount_sats,
        invoice: r.invoice,
        comment: r.comment ?? null,
        createdAt: r.created_at,
        paidAt: r.paid_at ?? null,
      })),
    });
  });

  // Client confirms it claimed proofs from a quote — we mark the row so
  // future polls don't re-surface it. Idempotent.
  app.post("/api/lnurlp/claimed/:quoteId", (req, res) => {
    const { ownerId } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT owner_id FROM lnurl_payment WHERE quote_id = ?").get(req.params.quoteId);
    if (!row) return res.status(404).json({ error: "no such quote" });
    if (row.owner_id !== ownerId) return res.status(403).json({ error: "not your quote" });
    db.prepare("UPDATE lnurl_payment SET claimed_at = datetime('now') WHERE quote_id = ?")
      .run(req.params.quoteId);
    res.json({ ok: true });
  });
}
