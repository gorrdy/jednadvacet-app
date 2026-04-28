// Public routes: content (articles/events), anonymous push, anonymous RSVP,
// anonymous telemetry. None of these require auth.

import webpush from "web-push";
import { db } from "../db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "../config.js";
import { getSubsForTagExcludingUser, pruneStalePushTokens } from "../push.js";
import {
  asArticle, asEvent, randomToken, safeId,
  profileShape, validOwnerId, validOpaqueToken, validDisplayName,
} from "../helpers.js";
import { CITIES } from "../../cities.js";
import {
  REACTIONS,
  BIO_MAX_CHARS,
  AVATAR_MAX_BYTES,
  MESSAGE_MAX_CHARS,
  EVENT_CHAT_ARCHIVE_DAYS,
  EVENT_CHAT_LOOKAHEAD_DAYS,
} from "../../../shared/constants.js";
import { dmSlugFor, parseDmSlug, parseEventSlug } from "../../../shared/slugs.js";
import { buildChatTag, buildUserTag } from "../../../shared/pushTags.js";
import { getCommunities } from "../communities.js";

const VALID_CHANNEL_SLUGS = new Set(["global", ...CITIES.map((c) => c.slug)]);

// Archive policy for per-event chats: 7 days after the event ends, the
// thread becomes read-only — old conversations can still be browsed but
// no new messages stick around. Caller passes `forWrite` to distinguish
// the two access modes.
const EVENT_CHAT_ARCHIVE_MS = EVENT_CHAT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

/** Returns true if `ownerId` may read/write messages in `slug`. Public slugs
 *  are open; dm slugs require the caller to be one of the pair AND the
 *  request between them to be accepted. Pass `forWrite: true` when checking
 *  POST/DELETE access — event chats archive 7d after the event ends. */
function canAccessChannel(db, slug, ownerId, forWrite = false) {
  if (VALID_CHANNEL_SLUGS.has(slug)) return { ok: true };
  const dm = parseDmSlug(slug);
  if (dm) {
    if (!ownerId) return { ok: false, code: 401, error: "ownerId required for DM" };
    if (ownerId !== dm.a && ownerId !== dm.b) return { ok: false, code: 403, error: "not a participant" };
    // At least one accepted request between the pair must exist. Either
    // direction counts — an accepted request opens the channel both ways.
    const req = db.prepare(`
      SELECT 1 FROM dm_request
      WHERE status = 'accepted'
        AND ((from_owner_id = ? AND to_owner_id = ?) OR (from_owner_id = ? AND to_owner_id = ?))
    `).get(dm.a, dm.b, dm.b, dm.a);
    if (!req) return { ok: false, code: 403, error: "DM not accepted yet" };
    return { ok: true };
  }
  const ev = parseEventSlug(slug);
  if (ev) {
    const event = db.prepare("SELECT id, ends_at FROM events WHERE id = ?").get(ev.eventId);
    if (!event) return { ok: false, code: 404, error: "unknown event" };
    if (!ownerId) return { ok: false, code: 401, error: "ownerId required for event chat" };
    // Allow if user has an RSVP (any status) for this event with their
    // owner_id linked. Anonymous RSVPs (token-only) can't access — the
    // chat needs identity to function.
    const rsvp = db.prepare(`
      SELECT 1 FROM event_rsvp
      WHERE event_id = ? AND owner_id = ? AND status IN ('going','maybe')
    `).get(ev.eventId, ownerId);
    if (!rsvp) return { ok: false, code: 403, error: "RSVP required" };
    if (forWrite && event.ends_at) {
      const endedMs = new Date(event.ends_at).getTime();
      if (Number.isFinite(endedMs) && Date.now() - endedMs > EVENT_CHAT_ARCHIVE_MS) {
        return { ok: false, code: 410, error: "event chat archived (read-only)" };
      }
    }
    return { ok: true };
  }
  return { ok: false, code: 404, error: "unknown channel" };
}

// ── Real-time chat fan-out (SSE) ────────────────────────────────
// In-memory pub/sub. Each slug has a Set of `send` callbacks that push
// serialised SSE events to connected clients. Cleaned up on client
// disconnect via req.on('close'). Scales to a few thousand connections
// on one Node process — well past what our community needs.
const chatSubscribers = new Map();
function subscribeChat(slug, send) {
  let subs = chatSubscribers.get(slug);
  if (!subs) { subs = new Set(); chatSubscribers.set(slug, subs); }
  subs.add(send);
  return () => {
    const s = chatSubscribers.get(slug);
    if (!s) return;
    s.delete(send);
    if (s.size === 0) chatSubscribers.delete(slug);
  };
}
function broadcastChat(slug, payload) {
  const subs = chatSubscribers.get(slug);
  if (!subs || subs.size === 0) return;
  for (const send of subs) {
    try { send(payload); } catch { /* client gone, cleanup happens on disconnect */ }
  }
}

// Rate-limit state for chat push: per (slug, any subscriber), max 1 push
// per 30 s. Prevents notification spam during a rapid burst. Keyed by
// slug because we batch per-channel anyway.
const lastPushAt = new Map();
const PUSH_DEBOUNCE_MS = 30_000;

async function maybePushChatNotification(slug, authorName, body, authorOwnerId) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const last = lastPushAt.get(slug) ?? 0;
  const now = Date.now();
  if (now - last < PUSH_DEBOUNCE_MS) return;
  lastPushAt.set(slug, now);

  const tag = buildChatTag(slug);
  // Exclude the author's own devices — getting a push notification for a
  // message you just sent yourself is annoying noise.
  const userTag = authorOwnerId ? buildUserTag(authorOwnerId) : null;
  const subs = getSubsForTagExcludingUser(tag, userTag);
  if (subs.length === 0) return;

  const channelLabel = slug === "global" ? "Globální · CZ" : (CITIES.find((c) => c.slug === slug)?.name ?? slug);
  const payload = JSON.stringify({
    title: `${authorName} · ${channelLabel}`,
    body: body.length > 100 ? body.slice(0, 97) + "…" : body,
    // Deep-link: `/#chat/<slug>`. Frontend reads the hash on mount and
    // routes to the Messages tab + that channel. Service worker focuses
    // an existing tab (if any) via .navigate() or opens a new window.
    url: `/#chat/${slug}`,
    tag: `chat-${slug}`,          // collapse multiple into one on native
    renotify: false,
  });

  const stale = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 60 * 10 },
      );
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.token);
    }
  }));
  pruneStalePushTokens(stale);
}

// Normalise a display name for uniqueness: lowercase + strip diacritics.
// Two nicks compare equal if their `nameNorm` match — lets the server
// reject "Honza" when "honzá" is already taken.
function normalizeName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function mountPublicRoutes(app) {
  // ── Articles ────────────────────────────────────────────────
  app.get("/api/articles", (_req, res) => {
    const rows = db.prepare("SELECT * FROM articles ORDER BY published_at DESC").all();
    res.json(rows.map(asArticle));
  });

  // ── Events ──────────────────────────────────────────────────
  // Public list with a live "going" count joined in. Cheap correlated
  // subquery; SQLite indexes on event_rsvp(event_id, status) handle it.
  app.get("/api/events", (_req, res) => {
    const rows = db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM event_rsvp r WHERE r.event_id = e.id AND r.status = 'going') AS going_count
      FROM events e
      ORDER BY e.starts_at ASC
    `).all();
    res.json(rows.map(asEvent));
  });

  // ── Push: VAPID public key ─────────────────────────────────
  app.get("/api/push/vapid", (_req, res) => {
    if (!VAPID_PUBLIC) return res.status(503).json({ error: "VAPID not configured" });
    res.json({ key: VAPID_PUBLIC });
  });

  // ── Communities (for "nearest" feature on Home) ────────────
  // Returns the Jednadvacet/21 community directory — cached in-memory,
  // refreshed daily from BTC Map. Public list; only the community
  // centre coordinates, signal/website link, and icon. No per-user data.
  app.get("/api/communities", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(getCommunities());
  });

  // ── Push: register (anonymous) ──────────────────────────────
  app.post("/api/push/register", (req, res) => {
    const { endpoint, keys, tags } = req.body || {};
    if (typeof endpoint !== "string" || !endpoint.startsWith("http")) return res.status(400).json({ error: "bad endpoint" });
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return res.status(400).json({ error: "bad keys" });
    const cleanTags = Array.isArray(tags)
      ? [...new Set(tags.filter((t) => typeof t === "string" && t.length > 0 && t.length < 64))].slice(0, 40)
      : [];

    // Endpoint is the authoritative identity. Token is a server-issued handle
    // so the client can unregister without revealing the push URL again.
    let token;
    try {
      const upsert = db.transaction(() => {
        const newToken = randomToken();
        db.prepare(`
          INSERT INTO push_sub (token, endpoint, p256dh, auth)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            updated_at = datetime('now')
        `).run(newToken, endpoint, keys.p256dh, keys.auth);
        token = db.prepare("SELECT token FROM push_sub WHERE endpoint = ?").get(endpoint).token;
        db.prepare("DELETE FROM push_tag WHERE token = ?").run(token);
        const ins = db.prepare("INSERT OR IGNORE INTO push_tag (token, tag) VALUES (?, ?)");
        for (const tag of cleanTags) ins.run(token, tag);
      });
      upsert();
    } catch (e) {
      console.error("[push/register]", e.message);
      return res.status(500).json({ error: "register failed" });
    }
    res.json({ token });
  });

  app.post("/api/push/unregister", (req, res) => {
    const { token } = req.body || {};
    if (typeof token !== "string") return res.status(400).json({ error: "bad token" });
    db.prepare("DELETE FROM push_sub WHERE token = ?").run(token);
    res.json({ ok: true });
  });

  // ── Push: self-test ─────────────────────────────────────────
  app.post("/api/push/test", async (req, res) => {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(503).json({ error: "VAPID not configured" });
    const { token } = req.body || {};
    if (typeof token !== "string" || token.length < 10) return res.status(400).json({ error: "bad token" });
    const sub = db.prepare("SELECT endpoint, p256dh, auth FROM push_sub WHERE token = ?").get(token);
    if (!sub) return res.status(404).json({ error: "not registered" });

    const payload = JSON.stringify({
      title: "Jednadvacet · test",
      body: "Notifikace dorazila. Jestli ji vidíš, všechno je v pořádku.",
      url: "/",
      tag: "jednadvacet-test",
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload, { TTL: 60 },
      );
      res.json({ ok: true, endpoint: sub.endpoint.split("/").slice(0, 3).join("/") + "/…" });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        db.prepare("DELETE FROM push_sub WHERE token = ?").run(token);
        return res.status(410).json({ ok: false, error: "subscription gone; removed from server" });
      }
      console.error("[push/test]", e.statusCode, e.body ?? e.message);
      res.status(500).json({ ok: false, error: e.message, statusCode: e.statusCode });
    }
  });

  // ── Telemetry: anonymous per-day ping ───────────────────────
  // Telemetry ping + community/online stats live in routes/telemetry.js.

  // ── RSVP: anonymous ─────────────────────────────────────────
  const RSVP_STATUSES = new Set(["going", "maybe", "not_going"]);

  app.post("/api/rsvp", (req, res) => {
    const { token, eventId, status, ownerId } = req.body || {};
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128) {
      return res.status(400).json({ error: "bad eventId" });
    }
    if (!RSVP_STATUSES.has(status)) return res.status(400).json({ error: "bad status" });
    // ownerId is optional. Only accept it if the user actually has a
    // chat_user row for that owner — otherwise we'd let anyone claim
    // any owner_id. Falsy or unrecognised → store as NULL (anonymous).
    let resolvedOwner = null;
    if (typeof ownerId === "string" && validOwnerId(ownerId)) {
      const userRow = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(ownerId);
      if (userRow) resolvedOwner = ownerId;
    }

    const ev = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
    if (!ev) return res.status(404).json({ error: "unknown event" });

    try {
      db.prepare(`
        INSERT INTO event_rsvp (token, event_id, status, owner_id, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(token, event_id) DO UPDATE SET
          status = excluded.status,
          owner_id = excluded.owner_id,
          updated_at = datetime('now')
      `).run(token, eventId, status, resolvedOwner);
    } catch (e) {
      console.error("[rsvp]", e.message);
      return res.status(500).json({ error: "rsvp failed" });
    }
    res.json({ ok: true });
  });

  // Per-event attendee list. Returns named "going" attendees joined with
  // chat_user (so display name + avatar are server-side, not exposed
  // anonymous tokens), plus the count of anonymous-token attendees.
  app.get("/api/events/:eventId/attendees", (req, res) => {
    const eventId = req.params.eventId;
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128) {
      return res.status(400).json({ error: "bad eventId" });
    }
    const ev = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
    if (!ev) return res.status(404).json({ error: "unknown event" });
    const named = db.prepare(`
      SELECT u.owner_id, u.display_name, u.avatar, COALESCE(t.tier, 1) AS tier
      FROM event_rsvp r
      JOIN chat_user u ON u.owner_id = r.owner_id
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE r.event_id = ? AND r.status = 'going' AND r.owner_id IS NOT NULL
      ORDER BY t.tier DESC, u.display_name ASC
    `).all(eventId);
    const anonRow = db.prepare(`
      SELECT COUNT(*) AS c FROM event_rsvp
      WHERE event_id = ? AND status = 'going' AND owner_id IS NULL
    `).get(eventId);
    const maybeRow = db.prepare(`
      SELECT COUNT(*) AS c FROM event_rsvp
      WHERE event_id = ? AND status = 'maybe'
    `).get(eventId);
    res.json({
      named: named.map((r) => ({
        ownerId: r.owner_id,
        displayName: r.display_name,
        avatar: r.avatar ?? null,
        tier: r.tier ?? 1,
      })),
      anonCount: anonRow?.c ?? 0,
      maybeCount: maybeRow?.c ?? 0,
      total: named.length + (anonRow?.c ?? 0),
    });
  });

  app.delete("/api/rsvp", (req, res) => {
    const token = req.body?.token ?? req.query?.token;
    const eventId = req.body?.eventId ?? req.query?.eventId;
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (typeof eventId !== "string" || eventId.length === 0) return res.status(400).json({ error: "bad eventId" });
    db.prepare("DELETE FROM event_rsvp WHERE token = ? AND event_id = ?").run(token, eventId);
    res.json({ ok: true });
  });

  // ── Chat profile: nickname bound to Evolu owner_id ──────────────
  // Claim a nick (cross-device). Same mnemonic → same owner_id → same
  // nick everywhere. Uniqueness is case-insensitive + diacritic-insensitive.

  // Avatar is a base64 data URL. Guard against blow-up: ~200 KB is enough
  // for a 256×256 JPEG from client-side resize; bigger = reject.
  const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  app.get("/api/chat/profile/:ownerId", (req, res) => {
    if (!validOwnerId(req.params.ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare(
      "SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id = ?",
    ).get(req.params.ownerId);
    if (!row) return res.status(404).json({ error: "no profile" });
    res.json(profileShape(row));
  });

  // Batch fetch: `GET /api/chat/profiles?ids=a,b,c` returns a map keyed by
  // ownerId. Client uses this from the Thread view so avatars render for
  // every distinct author in the message list without N roundtrips.
  app.get("/api/chat/profiles", (req, res) => {
    const raw = String(req.query?.ids ?? "").trim();
    if (!raw) return res.json({});
    const ids = raw.split(",").map((s) => s.trim()).filter((s) => validOwnerId(s)).slice(0, 200);
    if (ids.length === 0) return res.json({});
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id IN (${placeholders})`,
    ).all(...ids);
    const out = {};
    for (const r of rows) out[r.owner_id] = profileShape(r);
    res.json(out);
  });

  app.post("/api/chat/profile", (req, res) => {
    const { ownerId, displayName, avatar, bio } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (!validDisplayName(displayName)) return res.status(400).json({ error: "bad name (2–40 chars)" });

    const name = String(displayName).trim();
    const norm = normalizeName(name);
    if (norm.length < 2) return res.status(400).json({ error: "bad name" });

    let avatarVal = undefined; // undefined = leave as-is, null = clear
    if (avatar !== undefined) {
      if (avatar === null || avatar === "") avatarVal = null;
      else {
        if (typeof avatar !== "string") return res.status(400).json({ error: "bad avatar" });
        if (avatar.length > AVATAR_MAX_BYTES) return res.status(413).json({ error: "avatar too big (resize to ≤200 KB)" });
        if (!DATA_URL_RE.test(avatar)) return res.status(400).json({ error: "avatar must be data:image/(png|jpeg|webp);base64,..." });
        avatarVal = avatar;
      }
    }

    let bioVal = undefined;
    if (bio !== undefined) {
      if (bio === null || bio === "") bioVal = null;
      else {
        if (typeof bio !== "string") return res.status(400).json({ error: "bad bio" });
        const trimmed = bio.trim();
        if (trimmed.length > BIO_MAX_CHARS) return res.status(400).json({ error: `bio too long (max ${BIO_MAX_CHARS})` });
        bioVal = trimmed || null;
      }
    }

    // Taken-by-someone-else check (same-owner update is fine).
    const existing = db.prepare("SELECT owner_id FROM chat_user WHERE name_norm = ?").get(norm);
    if (existing && existing.owner_id !== ownerId) {
      return res.status(409).json({ error: "name taken" });
    }

    // First insert requires the UNIQUE fields; updates only patch what changed.
    const current = db.prepare("SELECT owner_id FROM chat_user WHERE owner_id = ?").get(ownerId);
    if (current) {
      const patches = ["display_name = ?", "name_norm = ?", "updated_at = datetime('now')"];
      const args = [name, norm];
      if (avatarVal !== undefined) { patches.push("avatar = ?"); args.push(avatarVal); }
      if (bioVal    !== undefined) { patches.push("bio = ?");    args.push(bioVal); }
      args.push(ownerId);
      db.prepare(`UPDATE chat_user SET ${patches.join(", ")} WHERE owner_id = ?`).run(...args);
    } else {
      db.prepare(`
        INSERT INTO chat_user (owner_id, display_name, name_norm, avatar, bio)
        VALUES (?, ?, ?, ?, ?)
      `).run(ownerId, name, norm, avatarVal ?? null, bioVal ?? null);
    }

    const row = db.prepare(
      "SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id = ?",
    ).get(ownerId);
    // Zaručí, že každý chat_user má řádek v user_tier (default tier=1
    // + vygenerovaný referral_code) ihned po vytvoření profilu.
    ensureUserTier(ownerId);
    res.json(profileShape(row));
  });

  // ── Tier (úroveň) ──────────────────────────────────────────────
  // Quiz-gated postup mezi 5 tiery s 7-denním cooldownem mezi postupy.
  // Klient si některé otázky validuje sám (PWA install, Cashu wallet
  // stav z Evolu); server doplňuje to, co vyžaduje backend data
  // (events organized, referral stats).

  // Tier state + advancement + referral redeem live in routes/tier-public.js.

  // ── Public community channels (Global CZ + per-city) ───────────
  // Broadcast chats — author identity = opaque per-device token +
  // user-chosen display name. Backend never learns who posted what.

  // Resolve message shape: join chat_user so renaming a user updates
  // every historical message. Falls back to the denormalised
  // author_name snapshot for rows that pre-date owner_id.
  const messageRowShape = `
    m.id, m.channel_slug, m.author_token, m.author_owner_id,
    COALESCE(u.display_name, m.author_name) AS author_name,
    m.body, m.created_at
  `;

  app.get("/api/channels/:slug/messages", (req, res) => {
    const slug = String(req.params.slug);
    // For public slugs ownerId is ignored; for dm: slugs it must be a
    // participant AND the request must be accepted.
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    const access = canAccessChannel(db, slug, ownerId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const since = req.query?.since ? String(req.query.since) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50)));

    const rows = since
      ? db.prepare(`
          SELECT ${messageRowShape}
          FROM channel_message m
          LEFT JOIN chat_user u ON u.owner_id = m.author_owner_id
          WHERE m.channel_slug = ? AND m.created_at > ?
          ORDER BY m.created_at ASC
          LIMIT ?
        `).all(slug, since, limit)
      : db.prepare(`
          SELECT ${messageRowShape}
          FROM channel_message m
          LEFT JOIN chat_user u ON u.owner_id = m.author_owner_id
          WHERE m.channel_slug = ?
          ORDER BY m.created_at DESC
          LIMIT ?
        `).all(slug, limit).reverse();

    // Batch-fetch reactions for the loaded messages. Cheap COUNT query
    // grouped by (message, emoji), plus a "mine" flag if the requester
    // has an ownerId. One round-trip; UI doesn't have to fan out.
    const ids = rows.map((r) => r.id);
    let reactionsByMsg = new Map();
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const reactRows = db.prepare(`
        SELECT message_id, emoji, COUNT(*) AS c,
               MAX(CASE WHEN owner_id = ? THEN 1 ELSE 0 END) AS mine
        FROM message_reaction
        WHERE message_id IN (${placeholders})
        GROUP BY message_id, emoji
        ORDER BY c DESC, emoji ASC
      `).all(ownerId ?? "", ...ids);
      for (const r of reactRows) {
        const arr = reactionsByMsg.get(r.message_id) ?? [];
        arr.push({ emoji: r.emoji, count: Number(r.c), mine: r.mine === 1 });
        reactionsByMsg.set(r.message_id, arr);
      }
    }

    res.json(rows.map((r) => ({
      id: r.id,
      channelSlug: r.channel_slug,
      authorToken: r.author_token,       // exposed so client can "this is me" check for delete
      authorOwnerId: r.author_owner_id,  // cross-device identity
      authorName: r.author_name,         // live-resolved via JOIN
      body: r.body,
      createdAt: r.created_at,
      reactions: reactionsByMsg.get(r.id) ?? [],
    })));
  });

  // Toggle a reaction. Adding the same (message, owner, emoji) twice
  // is a no-op; "removing" via the same call shape removes it. Body:
  //   { ownerId, emoji, op: "add" | "remove" }
  // Server enforces a small allowlist of emojis to prevent abuse and
  // keep the UI's fixed-set picker honest.
  const ALLOWED_REACTIONS = new Set(REACTIONS);
  app.post("/api/messages/:id/reactions", (req, res) => {
    const messageId = String(req.params.id);
    const { ownerId, emoji, op } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof emoji !== "string" || !ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ error: "bad emoji" });
    }
    if (op !== "add" && op !== "remove") return res.status(400).json({ error: "bad op" });

    // Verify the message exists + the user can access its channel
    // (don't let outsiders react to DM messages they shouldn't see).
    const msg = db.prepare("SELECT channel_slug FROM channel_message WHERE id = ?").get(messageId);
    if (!msg) return res.status(404).json({ error: "no message" });
    const access = canAccessChannel(db, msg.channel_slug, ownerId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    if (op === "add") {
      db.prepare(`
        INSERT OR IGNORE INTO message_reaction (message_id, owner_id, emoji)
        VALUES (?, ?, ?)
      `).run(messageId, ownerId, emoji);
    } else {
      db.prepare(`
        DELETE FROM message_reaction WHERE message_id = ? AND owner_id = ? AND emoji = ?
      `).run(messageId, ownerId, emoji);
    }
    res.json({ ok: true });
  });

  app.post("/api/channels/:slug/messages", (req, res) => {
    const slug = String(req.params.slug);
    const { token, ownerId, body } = req.body || {};
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    // forWrite=true blocks event chats archived 7d after the event ends.
    const access = canAccessChannel(db, slug, ownerId, true);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (typeof body !== "string") return res.status(400).json({ error: "body required" });
    const trimmed = body.trim();
    if (trimmed.length === 0) return res.status(400).json({ error: "empty body" });
    if (trimmed.length > MESSAGE_MAX_CHARS) return res.status(400).json({ error: `body too long (max ${MESSAGE_MAX_CHARS})` });

    // The user must have claimed a nick first. Without a chat_user row
    // we'd have nothing to show next to the message.
    const profile = db.prepare("SELECT display_name FROM chat_user WHERE owner_id = ?").get(ownerId);
    if (!profile) return res.status(412).json({ error: "set nickname first" });

    // Rate limit: max 20 messages per token per minute.
    const recent = db.prepare(`
      SELECT COUNT(*) AS c FROM channel_message
      WHERE author_token = ? AND datetime(created_at) > datetime('now', '-60 seconds')
    `).get(token).c;
    if (recent >= 20) return res.status(429).json({ error: "too many messages (slow down)" });

    const id = safeId("msg");
    db.prepare(`
      INSERT INTO channel_message (id, channel_slug, author_token, author_owner_id, author_name, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, slug, token, ownerId, profile.display_name, trimmed);

    const message = {
      id,
      channelSlug: slug,
      authorToken: token,
      authorOwnerId: ownerId,
      authorName: profile.display_name,
      body: trimmed,
      createdAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      // New messages have no reactions yet, but the field must always be
      // present — frontend reads `m.reactions.length` unconditionally and
      // crashes (TypeError → iOS Safari white screen) if it's undefined.
      reactions: [],
    };
    res.json(message);

    // Fan out to in-app real-time subscribers, and fire an async push
    // notification for devices that opted into chat:<slug>.
    broadcastChat(slug, { kind: "message", message });
    void maybePushChatNotification(slug, profile.display_name, trimmed, ownerId);
  });

  // ── Per-event chat threads (windowed listing) ─────────────────
  // For each event the user has RSVP'd "going" / "maybe" to AND that
  // either starts within the next 5 days or ended within the last 7
  // days, surface an `event:<id>` channel in the sidebar. The 5-day
  // forward window prevents the sidebar from filling up with chats
  // for events months out; the 7-day backward window keeps recent
  // event chats around for post-event recap (after which they're
  // archived = read-only and dropped from the listing).
  app.get("/api/chat/my-event-chats", (req, res) => {
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    const now = new Date();
    const forwardWindowEnd = new Date(now.getTime() + EVENT_CHAT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const backwardWindowStart = new Date(now.getTime() - EVENT_CHAT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);

    // event_rsvp PRIMARY KEY is (token, event_id), so a user signed in on
    // 3 devices has 3 RSVP rows per event — without GROUP BY the JOIN
    // returns the event once per device. Group by event id to dedupe.
    const rows = db.prepare(`
      SELECT e.id, e.title, e.starts_at, e.ends_at
      FROM events e
      JOIN event_rsvp r ON r.event_id = e.id
      WHERE r.owner_id = ?
        AND r.status IN ('going','maybe')
        AND datetime(e.ends_at) >= datetime(?)
        AND datetime(e.starts_at) <= datetime(?)
      GROUP BY e.id
      ORDER BY datetime(e.starts_at) ASC
    `).all(ownerId, backwardWindowStart.toISOString(), forwardWindowEnd.toISOString());

    res.json({
      chats: rows.map((r) => ({
        eventId: r.id,
        slug: `event:${r.id}`,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      })),
    });
  });

  // ── Real-time: subscribe to one or more channels via SSE ──────
  // Client: `new EventSource("/api/chat/stream?slugs=global,praha")`.
  // Server keeps the connection open and pushes `message` events as
  // they happen. Clients handle reconnect automatically via the
  // EventSource API.
  app.get("/api/chat/stream", (req, res) => {
    const raw = String(req.query?.slugs ?? "").trim();
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    const requested = raw.split(",").map((s) => s.trim()).slice(0, 30);
    const slugs = requested.filter((s) => canAccessChannel(db, s, ownerId).ok);
    if (slugs.length === 0) return res.status(400).json({ error: "no valid slugs" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",   // tell nginx not to buffer
    });
    res.flushHeaders();

    const send = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* socket closed */ }
    };

    send({ kind: "ready", slugs });
    const unsubs = slugs.map((s) => subscribeChat(s, send));

    // Heartbeat prevents intermediaries (nginx, Safari iOS background)
    // from dropping the socket after idle timeout.
    const ping = setInterval(() => {
      try { res.write(":ping\n\n"); } catch { /* ignore */ }
    }, 25_000);

    const cleanup = () => {
      clearInterval(ping);
      for (const u of unsubs) u();
      try { res.end(); } catch { /* already closed */ }
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  });

  // Author-side delete: only works with matching token. (For dm slugs the
  // token check is already sufficient — only the author can delete.)
  app.delete("/api/channels/:slug/messages/:id", (req, res) => {
    const slug = String(req.params.slug);
    // Accept both public and dm slug formats; the token match is the real auth.
    if (!VALID_CHANNEL_SLUGS.has(slug) && !parseDmSlug(slug) && !parseEventSlug(slug)) {
      return res.status(404).json({ error: "unknown channel" });
    }
    const token = req.body?.token ?? req.query?.token;
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    const r = db.prepare(
      "DELETE FROM channel_message WHERE id = ? AND channel_slug = ? AND author_token = ?"
    ).run(req.params.id, slug, token);
    if (r.changes === 0) return res.status(404).json({ error: "not found or not yours" });
    res.json({ ok: true });
  });

  // ── DM request + contact management ────────────────────────
  // Caller wants to start a DM with `toOwnerId`. Creates a pending request
  // (or re-opens a previously rejected one). Blocked requests cannot be
  // retried from the sender side — they must be unblocked by the receiver.
  app.post("/api/dm/request", (req, res) => {
    const { fromOwnerId, toOwnerId } = req.body || {};
    if (!validOwnerId(fromOwnerId)) return res.status(400).json({ error: "bad fromOwnerId" });
    if (!validOwnerId(toOwnerId)) return res.status(400).json({ error: "bad toOwnerId" });
    if (fromOwnerId === toOwnerId) return res.status(400).json({ error: "cannot DM yourself" });
    // The recipient must have a chat profile so sender can see whom they're
    // requesting. Orphan ids shouldn't pollute the inbox.
    const toProfile = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(toOwnerId);
    if (!toProfile) return res.status(404).json({ error: "recipient has no chat profile yet" });

    const existing = db.prepare(`
      SELECT id, status FROM dm_request
      WHERE from_owner_id = ? AND to_owner_id = ?
    `).get(fromOwnerId, toOwnerId);

    // Also check the reverse direction — if B once requested A and A accepted,
    // treat it as a reciprocal accepted contact (no need for A to "re-request").
    const reverse = db.prepare(`
      SELECT id, status FROM dm_request
      WHERE from_owner_id = ? AND to_owner_id = ?
    `).get(toOwnerId, fromOwnerId);
    if (reverse && reverse.status === "accepted") {
      return res.json({ ok: true, id: reverse.id, status: "accepted", reciprocal: true });
    }

    if (existing) {
      if (existing.status === "blocked") return res.status(403).json({ error: "blocked" });
      if (existing.status === "accepted") return res.json({ ok: true, id: existing.id, status: "accepted" });
      // pending / rejected → reopen
      db.prepare(`
        UPDATE dm_request SET status = 'pending', updated_at = datetime('now') WHERE id = ?
      `).run(existing.id);
      return res.json({ ok: true, id: existing.id, status: "pending" });
    }

    const id = safeId("dmr");
    db.prepare(`
      INSERT INTO dm_request (id, from_owner_id, to_owner_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, fromOwnerId, toOwnerId);
    res.json({ ok: true, id, status: "pending" });
  });

  // Returns the caller's full DM state:
  //   incoming  — pending requests where caller is recipient (needs action)
  //   outgoing  — pending requests the caller has sent (awaiting reply)
  //   contacts  — accepted requests (either direction) with partner's profile
  //               and last-message metadata so the UI can build a sidebar
  app.get("/api/dm/state", (req, res) => {
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    const incoming = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.status, r.created_at,
             u.display_name, u.avatar
      FROM dm_request r
      LEFT JOIN chat_user u ON u.owner_id = r.from_owner_id
      WHERE r.to_owner_id = ? AND r.status = 'pending'
      ORDER BY r.created_at DESC
    `).all(ownerId);

    const outgoing = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.status, r.created_at,
             u.display_name, u.avatar
      FROM dm_request r
      LEFT JOIN chat_user u ON u.owner_id = r.to_owner_id
      WHERE r.from_owner_id = ? AND r.status IN ('pending', 'rejected')
      ORDER BY r.created_at DESC
    `).all(ownerId);

    // Accepted contacts — either direction. Partner is the "other" side.
    const accepted = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.updated_at,
             CASE WHEN r.from_owner_id = ? THEN r.to_owner_id ELSE r.from_owner_id END AS partner_id
      FROM dm_request r
      WHERE (r.from_owner_id = ? OR r.to_owner_id = ?) AND r.status = 'accepted'
      ORDER BY r.updated_at DESC
    `).all(ownerId, ownerId, ownerId);

    // For each accepted contact, fetch partner profile + last DM message.
    const contacts = accepted.map((r) => {
      const u = db.prepare(
        "SELECT owner_id, display_name, avatar FROM chat_user WHERE owner_id = ?"
      ).get(r.partner_id);
      const slug = dmSlugFor(ownerId, r.partner_id);
      const last = db.prepare(`
        SELECT body, created_at, author_owner_id FROM channel_message
        WHERE channel_slug = ? ORDER BY created_at DESC LIMIT 1
      `).get(slug);
      return {
        partnerOwnerId: r.partner_id,
        partnerName: u?.display_name ?? null,
        partnerAvatar: u?.avatar ?? null,
        dmSlug: slug,
        lastMessage: last ? { body: last.body, createdAt: last.created_at, authorOwnerId: last.author_owner_id } : null,
        acceptedAt: r.updated_at,
      };
    });

    res.json({
      incoming: incoming.map((r) => ({
        id: r.id,
        fromOwnerId: r.from_owner_id,
        fromName: r.display_name ?? null,
        fromAvatar: r.avatar ?? null,
        createdAt: r.created_at,
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        toOwnerId: r.to_owner_id,
        toName: r.display_name ?? null,
        toAvatar: r.avatar ?? null,
        status: r.status,
        createdAt: r.created_at,
      })),
      contacts,
    });
  });

  app.post("/api/dm/requests/:id/accept", (req, res) => {
    const { ownerId } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT to_owner_id, status FROM dm_request WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.to_owner_id !== ownerId) return res.status(403).json({ error: "not recipient" });
    if (row.status === "accepted") return res.json({ ok: true });
    db.prepare(`
      UPDATE dm_request SET status = 'accepted', updated_at = datetime('now') WHERE id = ?
    `).run(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/dm/requests/:id/reject", (req, res) => {
    const { ownerId, block } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT to_owner_id, status FROM dm_request WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.to_owner_id !== ownerId) return res.status(403).json({ error: "not recipient" });
    const next = block ? "blocked" : "rejected";
    db.prepare(`
      UPDATE dm_request SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(next, req.params.id);
    res.json({ ok: true, status: next });
  });

  // ── Admin application: tier 3+ users apply to become community admin ──
  // Hand-shake mechanism. Approval doesn't auto-create an admin_user
  // (chat owner_id and admin email/password are separate identity
  // domains); superadmin uses the existing invite system to onboard.
  const VALID_CITY_SLUGS = new Set(CITIES.map((c) => c.slug));

  app.post("/api/admin/apply", (req, res) => {
    const { ownerId, citiesCsv, message } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof citiesCsv !== "string" || !citiesCsv.trim()) {
      return res.status(400).json({ error: "bad cities" });
    }
    const cities = citiesCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (cities.length === 0 || cities.length > 10) {
      return res.status(400).json({ error: "pick 1–10 cities" });
    }
    for (const c of cities) {
      if (!VALID_CITY_SLUGS.has(c)) return res.status(400).json({ error: `unknown city: ${c}` });
    }
    const msg = typeof message === "string" ? message.trim().slice(0, 1000) : null;

    const userRow = db.prepare(`
      SELECT u.display_name, COALESCE(t.tier, 1) AS tier
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE u.owner_id = ?
    `).get(ownerId);
    if (!userRow) return res.status(404).json({ error: "no chat profile" });
    if (userRow.tier < 3) return res.status(403).json({ error: "tier 3+ required" });

    // Reject if there's already a pending application from this owner.
    const existing = db.prepare(`
      SELECT id FROM admin_application WHERE owner_id = ? AND status = 'pending'
    `).get(ownerId);
    if (existing) return res.status(409).json({ error: "application already pending", id: existing.id });

    const id = safeId("aapp");
    db.prepare(`
      INSERT INTO admin_application
        (id, owner_id, display_name, cities_csv, message, tier_at_apply, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, ownerId, userRow.display_name, cities.join(","), msg, userRow.tier);
    res.json({ ok: true, id, status: "pending" });
  });

  // Event proposal: tier 4+ users propose events for admin moderation.
  app.post("/api/events/propose", (req, res) => {
    const { ownerId, title, description, location, url, startsAt, endsAt, citiesCsv, categoriesCsv } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: "title 3-200 chars" });
    }
    if (typeof location !== "string" || location.trim().length < 2 || location.trim().length > 200) {
      return res.status(400).json({ error: "location required" });
    }
    if (typeof startsAt !== "string" || typeof endsAt !== "string") {
      return res.status(400).json({ error: "starts/ends required" });
    }
    if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) {
      return res.status(400).json({ error: "bad date" });
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return res.status(400).json({ error: "endsAt must be after startsAt" });
    }
    if (Date.parse(startsAt) < Date.now() - 60 * 60 * 1000) {
      return res.status(400).json({ error: "starts in the past" });
    }
    const desc = typeof description === "string" ? description.trim().slice(0, 5000) : "";
    const u = typeof url === "string" ? url.trim().slice(0, 500) : "";
    const cities = typeof citiesCsv === "string"
      ? citiesCsv.split(",").map((s) => s.trim()).filter(Boolean).filter((c) => VALID_CITY_SLUGS.has(c))
      : [];
    const categories = typeof categoriesCsv === "string"
      ? categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : [];

    const userRow = db.prepare(`
      SELECT u.display_name, COALESCE(t.tier, 1) AS tier
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE u.owner_id = ?
    `).get(ownerId);
    if (!userRow) return res.status(404).json({ error: "no chat profile" });
    if (userRow.tier < 4) return res.status(403).json({ error: "tier 4+ required" });

    const id = safeId("eprop");
    db.prepare(`
      INSERT INTO event_proposal
        (id, owner_id, proposer_name, title, description, location, url,
         starts_at, ends_at, cities_csv, categories_csv, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id, ownerId, userRow.display_name, title.trim(), desc, location.trim(),
      u || null, startsAt, endsAt, cities.join(","), categories.join(","),
    );
    res.json({ ok: true, id });
  });

  app.get("/api/events/proposals/:ownerId", (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const rows = db.prepare(`
      SELECT id, title, location, starts_at, status, proposed_at, reviewed_at, reject_reason
      FROM event_proposal
      WHERE owner_id = ?
      ORDER BY proposed_at DESC
      LIMIT 20
    `).all(ownerId);
    res.json({
      proposals: rows.map((r) => ({
        id: r.id,
        title: r.title,
        location: r.location,
        startsAt: r.starts_at,
        status: r.status,
        proposedAt: r.proposed_at,
        reviewedAt: r.reviewed_at ?? null,
        rejectReason: r.reject_reason ?? null,
      })),
    });
  });

  app.get("/api/admin/apply/:ownerId", (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare(`
      SELECT id, cities_csv, message, status, applied_at, reviewed_at, reject_reason
      FROM admin_application
      WHERE owner_id = ?
      ORDER BY applied_at DESC
      LIMIT 1
    `).get(ownerId);
    if (!row) return res.json({ application: null });
    res.json({
      application: {
        id: row.id,
        citiesCsv: row.cities_csv,
        message: row.message ?? null,
        status: row.status,
        appliedAt: row.applied_at,
        reviewedAt: row.reviewed_at ?? null,
        rejectReason: row.reject_reason ?? null,
      },
    });
  });
}
