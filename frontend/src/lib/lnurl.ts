// LNURL helpers for the wallet. Implements:
//   • LUD-01 — bech32 LNURL encoding (decoder inlined below)
//   • LUD-03 — withdrawRequest (faucets, vouchers — wallet pulls funds in)
//   • LUD-06 — payRequest (wallet pays a remote service)
//   • LUD-09 — successAction in pay response (message / url / aes — aes
//              is parsed but not decrypted; we surface the encrypted
//              blob so a future LUD-10 implementation can drop in)
//   • LUD-12 — comment field in payRequest
//   • LUD-16 — Lightning Address (user@domain.com → LUD-06 endpoint)
//   • LUD-17 — protocol scheme prefixes (`lnurlp:`, `lnurlw:`, etc.)
//
// Out of scope (yet): LUD-04 auth, LUD-08 fast withdraw, LUD-10 aes
// decryption, LUD-11 disposable, LUD-14/15 balance check / notify,
// LUD-18 payer identity, LUD-19 discoverability, LUD-20 long desc,
// LUD-21 verify.
//
// Bech32 decoder is inlined (~50 lines) — pulling a dep just for this
// would be silly. Reference: BIP-173.

import { sha256 } from "@noble/hashes/sha2.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function bech32VerifyChecksum(hrp: string, data: number[]): boolean {
  return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
}

function from5to8(words: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    if (w < 0 || w >> 5) return null;
    acc = ((acc << 5) | w) & 0xfffff;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1))) return null;
  return new Uint8Array(out);
}

/** Decode a bech32 LNURL (case-insensitive) → URL string. Throws on bad input. */
export function decodeLnurl(input: string): string {
  const lower = input.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) throw new Error("Špatný LNURL");
  const hrp = lower.slice(0, sep);
  if (hrp !== "lnurl") throw new Error("Neznámý LNURL prefix");
  const data: number[] = [];
  for (let i = sep + 1; i < lower.length; i++) {
    const idx = CHARSET.indexOf(lower.charAt(i));
    if (idx === -1) throw new Error("Špatný LNURL znak");
    data.push(idx);
  }
  if (!bech32VerifyChecksum(hrp, data)) throw new Error("LNURL checksum");
  const bytes = from5to8(data.slice(0, -6));
  if (!bytes) throw new Error("LNURL data");
  return new TextDecoder().decode(bytes);
}

/** Detect if a scanned/pasted string looks like an LNURL (bech32 form, a
 *  LUD-17 `lnurlp:` / `lnurlw:` / `lnurla:` URI, or a `https://...` URL
 *  pointing to an LNURL endpoint). The latter only qualifies after we
 *  successfully fetch and see a known `tag`, but we accept https URLs as
 *  candidates here so the user can still try pasted links. */
export function isLnurlCandidate(s: string): boolean {
  const trimmed = stripUriScheme(s.trim());
  if (/^lnurl1[a-z0-9]+$/i.test(trimmed)) return true;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  return false;
}

/** Strip recognised URI scheme prefixes. Handles `lightning:` /
 *  `lightning://` (any number of slashes), nested wrappers like
 *  `lightning:lnurl:lnurl1…`, LUD-17 schemes (`lnurlp:`, `lnurlw:`,
 *  `lnurla:`, `keyauth:` — with optional `//`), and the legacy bare
 *  `lnurl:` prefix. After stripping, the result is either a bech32
 *  `lnurl1…`, an https URL, or (for LUD-17 schemes that contained just
 *  a host+path) we coerce the scheme to https — LUD-17 says http is
 *  only valid for clearnet localhost / .onion. */
function stripUriScheme(s: string): string {
  let r = s.trim();
  // Loop a few times to unwrap nested wrappers — cheap, cap at 4 to
  // avoid pathological inputs spinning forever.
  for (let i = 0; i < 4; i++) {
    // LUD-17: lnurl(p|w|a|c)? / keyauth → conversion to https. We
    // handle this branch first because if it matches, we want to
    // *return* the converted URL, not just strip the prefix.
    const lud17 = r.match(/^(lnurl[pwac]?|keyauth):(\/{0,2})(.+)$/i);
    if (lud17) {
      const rest = lud17[3].trim();
      if (/^https?:\/\//i.test(rest)) return rest;
      if (/^lnurl1[a-z0-9]+$/i.test(rest)) return rest;
      return `https://${rest}`;
    }
    // Plain wrapper schemes: drop the prefix and continue (might be
    // nested under another).
    const wrap = r.match(/^(lightning|bitcoin|cashu|lnurl):\/{0,2}/i);
    if (!wrap) break;
    r = r.slice(wrap[0].length).trim();
  }
  return r;
}

/** Coerce a scanned string to its underlying LNURL service URL. Accepts
 *  bech32 lnurl1…, LUD-17 schemes, or plain https URLs. */
export function lnurlServiceUrl(s: string): string {
  const trimmed = stripUriScheme(s.trim());
  if (/^lnurl1[a-z0-9]+$/i.test(trimmed)) return decodeLnurl(trimmed);
  return trimmed;
}

/** Lightning Address (LUD-16) `name@domain` → `.well-known/lnurlp/<name>`
 *  URL that returns a payRequest spec. We accept addresses with the same
 *  rules as RFC 5321 local-part (loosely) — letters/digits and `._%+-`. */
export function isLightningAddress(s: string): boolean {
  return /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
}

export function lightningAddressToUrl(addr: string): string {
  const [name, domain] = addr.trim().toLowerCase().split("@");
  if (!name || !domain) throw new Error("Špatná Lightning Address");
  // .onion / localhost stay http per LUD-17, everything else https.
  const scheme = domain.endsWith(".onion") || domain === "localhost" ? "http" : "https";
  return `${scheme}://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

export interface LnurlWithdrawSpec {
  tag: "withdrawRequest";
  callback: string;
  k1: string;
  defaultDescription: string;
  minWithdrawable: number; // millisats
  maxWithdrawable: number; // millisats
}

/** LUD-06 payRequest spec. `metadata` is a JSON-stringified array of
 *  [type, value] tuples (image, plain-text desc, identifier, …). The
 *  full string is hashed and embedded in the BOLT-11 description hash
 *  by the service — wallet doesn't need to recompute, just display the
 *  human-readable parts. `commentAllowed` (LUD-12) is the max length
 *  of an optional comment, 0 = disabled. */
export interface LnurlPaySpec {
  tag: "payRequest";
  callback: string;
  minSendable: number;       // millisats
  maxSendable: number;       // millisats
  metadata: string;          // JSON-encoded
  commentAllowed?: number;   // LUD-12
  payerData?: unknown;       // LUD-18 (we don't yet sign payer identity)
}

export type LnurlSpec = LnurlPaySpec | LnurlWithdrawSpec;

export interface LnurlError {
  status: "ERROR";
  reason: string;
}

/** Most LNURL services restrict CORS to their own / a small allowlist
 *  of web wallets, so a direct fetch from this app's origin fails with
 *  "Load failed" / "TypeError: Failed to fetch". Route through our
 *  backend proxy when we know the URL isn't same-origin. Same-origin
 *  URLs (our own `.well-known/lnurlp/…` for the receive flow) skip the
 *  proxy to avoid a pointless extra hop. */
export function maybeProxyLnurl(target: string): string {
  try {
    const t = new URL(target, typeof window !== "undefined" ? window.location.href : "https://x");
    if (typeof window !== "undefined" && t.origin === window.location.origin) {
      return target;
    }
  } catch { /* fall through */ }
  return `/api/lnurl/proxy?url=${encodeURIComponent(target)}`;
}

async function lnurlGet(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(maybeProxyLnurl(url), { credentials: "omit" });
  if (!r.ok) throw new Error(`LNURL HTTP ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>;
  if (j.status === "ERROR") throw new Error(String(j.reason ?? "LNURL error"));
  return j;
}

/** LUD-04 auth params can be read directly from the LNURL URL — there is
 *  no spec round-trip before signing. Returns null if the URL is not an
 *  auth challenge. */
export interface LnurlAuthParams {
  tag: "login";
  url: string;          // the full URL we'll later GET with sig+key appended
  k1: string;           // 32-byte hex challenge
  action: "register" | "login" | "link" | "auth";
  domain: string;       // for display + per-domain key derivation
}

/** LUD-05 spec on the derivation domain:
 *   "service domain (without port if it's clearnet, with port if it's
 *    localhost or onion)"
 *  We follow that to stay key-compatible with reference wallets. */
function lnurlAuthDomain(parsed: URL): string {
  const host = parsed.hostname;
  if (host === "localhost" || host.endsWith(".onion")) return parsed.host;
  return host;
}

export function parseLnurlAuthFromUrl(url: string): LnurlAuthParams | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.searchParams.get("tag") !== "login") return null;
  const k1 = parsed.searchParams.get("k1");
  if (!k1 || !/^[0-9a-f]{64}$/i.test(k1)) return null;
  const action = (parsed.searchParams.get("action") ?? "auth").toLowerCase();
  if (!["register", "login", "link", "auth"].includes(action)) return null;
  return {
    tag: "login",
    url,
    k1: k1.toLowerCase(),
    action: action as LnurlAuthParams["action"],
    domain: lnurlAuthDomain(parsed),
  };
}

/** LUD-08 — Fast withdrawRequest. The URL itself can carry the spec
 *  params in its query string, letting the wallet skip the initial GET
 *  and go straight to "ask user for amount". Returns null if any
 *  required field is missing or if the URL is not LUD-08-shaped. */
export function parseInlineWithdrawSpec(url: string): LnurlWithdrawSpec | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.searchParams.get("tag") !== "withdrawRequest") return null;
  const callback = parsed.searchParams.get("callback");
  const k1 = parsed.searchParams.get("k1");
  const min = Number(parsed.searchParams.get("minWithdrawable"));
  const max = Number(parsed.searchParams.get("maxWithdrawable"));
  if (!callback || !k1) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || max < min) return null;
  return {
    tag: "withdrawRequest",
    callback,
    k1,
    defaultDescription: parsed.searchParams.get("defaultDescription") ?? "",
    minWithdrawable: min,
    maxWithdrawable: max,
  };
}

/** GET the LNURL service URL and validate it's a withdrawRequest. */
export async function fetchLnurlWithdrawSpec(url: string): Promise<LnurlWithdrawSpec> {
  const j = await lnurlGet(url);
  if (j.tag !== "withdrawRequest") {
    throw new Error(`LNURL nepodporovaný typ: ${String(j.tag ?? "neznámý")}`);
  }
  const min = Number(j.minWithdrawable);
  const max = Number(j.maxWithdrawable);
  // LUD-03 allows min === 0 (== "any amount up to max"); only reject
  // outright negative values, NaN, or max < min.
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || max < min) {
    throw new Error("LNURL špatné limity");
  }
  return {
    tag: "withdrawRequest",
    callback: String(j.callback),
    k1: String(j.k1),
    defaultDescription: String(j.defaultDescription ?? ""),
    minWithdrawable: min,
    maxWithdrawable: max,
  };
}

/** GET the LNURL service URL and dispatch by `tag`. Caller decides how to
 *  branch (LnurlPayView vs. LnurlWithdrawView). Lets the scan handler hand
 *  off to one helper instead of two. */
export async function fetchLnurlSpec(url: string): Promise<LnurlSpec> {
  const j = await lnurlGet(url);
  if (j.tag === "withdrawRequest") {
    const min = Number(j.minWithdrawable);
    const max = Number(j.maxWithdrawable);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || max < min) {
      throw new Error("LNURL špatné limity");
    }
    return {
      tag: "withdrawRequest",
      callback: String(j.callback),
      k1: String(j.k1),
      defaultDescription: String(j.defaultDescription ?? ""),
      minWithdrawable: min,
      maxWithdrawable: max,
    };
  }
  if (j.tag === "payRequest") {
    const min = Number(j.minSendable);
    const max = Number(j.maxSendable);
    // LUD-06 requires minSendable >= 1 msat in practice (you can't pay
    // 0). But be tolerant of services that report min === 0 (treat as 1).
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || max < min) {
      throw new Error("LNURL špatné limity");
    }
    return {
      tag: "payRequest",
      callback: String(j.callback),
      minSendable: min,
      maxSendable: max,
      metadata: String(j.metadata ?? "[]"),
      ...(typeof j.commentAllowed === "number" ? { commentAllowed: j.commentAllowed } : {}),
      ...(j.payerData !== undefined ? { payerData: j.payerData } : {}),
    };
  }
  throw new Error(`LNURL nepodporovaný typ: ${String(j.tag ?? "neznámý")}`);
}

/** Pull human-readable bits out of the metadata JSON. Per LUD-06 the
 *  string is a JSON array of [type, value]; common types are
 *  `text/plain`, `text/long-desc`, `text/identifier`, `image/png;base64`,
 *  `image/jpeg;base64`, `text/email`. We expose plain + long-desc +
 *  identifier and ignore the inline images for now (rendering arbitrary
 *  base64 from a stranger is asking for trouble). */
export function parseLnurlPayMetadata(metadata: string): {
  description: string;
  longDescription: string | null;
  identifier: string | null;
} {
  let description = "";
  let longDescription: string | null = null;
  let identifier: string | null = null;
  try {
    const arr = JSON.parse(metadata);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const [type, value] = item;
        if (typeof type !== "string" || typeof value !== "string") continue;
        if (type === "text/plain" && !description) description = value;
        else if (type === "text/long-desc" && !longDescription) longDescription = value;
        else if ((type === "text/identifier" || type === "text/email") && !identifier) identifier = value;
      }
    }
  } catch { /* malformed — show empty */ }
  return { description, longDescription, identifier };
}

/** LUD-09 successAction shapes. AES is parsed but we don't decrypt yet —
 *  consumers should display "encrypted message — open in a wallet that
 *  supports LUD-10" or similar. */
export type LnurlSuccessAction =
  | { tag: "message"; message: string }
  | { tag: "url"; description: string; url: string }
  | { tag: "aes"; description: string; ciphertext: string; iv: string };

export interface LnurlPayResponse {
  pr: string;             // BOLT-11 invoice
  routes?: unknown[];     // legacy, ignored
  successAction?: LnurlSuccessAction | null;
  verify?: string;        // LUD-21 verify URL — surfaced for future use
}

/** GET the payRequest callback to receive a BOLT-11 invoice for the
 *  chosen amount. `comment` is optional (LUD-12). */
export async function fetchLnurlPayInvoice(
  callback: string,
  amountMsat: number,
  comment?: string,
): Promise<LnurlPayResponse> {
  const u = new URL(callback);
  u.searchParams.set("amount", String(amountMsat));
  if (comment) u.searchParams.set("comment", comment);
  const r = await fetch(maybeProxyLnurl(u.toString()), { credentials: "omit" });
  if (!r.ok) throw new Error(`LNURL pay HTTP ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>;
  if (j.status === "ERROR") throw new Error(String(j.reason ?? "LNURL pay error"));
  if (typeof j.pr !== "string" || !/^ln/i.test(j.pr)) {
    throw new Error("LNURL pay neobsahuje invoice");
  }
  // LUD-09 successAction parsing + validation:
  //   - message:  1..144 chars (per spec)
  //   - url:      MUST be https (LUD-09 explicitly mandates https)
  //   - aes:      ciphertext + iv accepted but we don't decrypt (LUD-10)
  // Anything that doesn't pass validation is silently dropped — better
  // than crashing the whole pay flow over an optional field.
  let successAction: LnurlSuccessAction | null = null;
  const sa = j.successAction as Record<string, unknown> | undefined;
  if (sa && typeof sa === "object") {
    if (sa.tag === "message" && typeof sa.message === "string"
        && sa.message.length >= 1 && sa.message.length <= 144) {
      successAction = { tag: "message", message: sa.message };
    } else if (sa.tag === "url" && typeof sa.url === "string"
               && /^https:\/\//i.test(sa.url)) {
      const desc = typeof sa.description === "string" ? sa.description : "";
      // Spec: description ≤ 144 chars.
      if (desc.length <= 144) {
        successAction = { tag: "url", description: desc, url: sa.url };
      }
    } else if (sa.tag === "aes" && typeof sa.ciphertext === "string" && typeof sa.iv === "string") {
      successAction = {
        tag: "aes",
        description: typeof sa.description === "string" ? sa.description : "",
        ciphertext: sa.ciphertext,
        iv: sa.iv,
      };
    }
  }
  return {
    pr: j.pr,
    successAction,
    ...(typeof j.verify === "string" ? { verify: j.verify } : {}),
  };
}

/** Extract the description-hash (`h` tag, type 23) from a BOLT-11
 *  invoice as raw 32 bytes. Returns null if the invoice has no `h`
 *  tag (e.g. the service used `d` plain-text description instead, in
 *  which case there's nothing to verify against the LUD-06 metadata).
 *
 *  Minimal inline parser — we only walk the tagged-field section and
 *  pick out the `h` field. Signature / payment_hash / etc. are ignored.
 *  Mints validate the full invoice when paying, so we don't need a
 *  general BOLT-11 decoder here. */
function bolt11DescriptionHash(invoice: string): Uint8Array | null {
  const lower = invoice.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 4) return null;
  const data: number[] = [];
  for (let i = sep + 1; i < lower.length; i++) {
    const idx = CHARSET.indexOf(lower.charAt(i));
    if (idx === -1) return null;
    data.push(idx);
  }
  // Layout (5-bit chars): timestamp (7) | tagged fields … | signature (104) | checksum (6).
  if (data.length < 7 + 104 + 6) return null;
  const tlv = data.slice(7, data.length - 104 - 6);
  let pos = 0;
  while (pos + 3 <= tlv.length) {
    const type = tlv[pos];
    const len = (tlv[pos + 1] << 5) | tlv[pos + 2]; // 10-bit length, in 5-bit groups
    const start = pos + 3;
    const end = start + len;
    if (end > tlv.length) break;
    if (type === 23 /* 'h' */) {
      return from5to8(tlv.slice(start, end));
    }
    pos = end;
  }
  return null;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** LUD-06 spec: "Wallet MUST verify that h tag in the provided invoice
 *  is a hash of the metadata string converted to a byte array in UTF-8
 *  encoding." Throws if the BOLT-11 carries an `h` tag that doesn't
 *  match — silent pass when the service used plain `d` description
 *  (no hash to check). */
export function verifyLnurlPayInvoice(invoice: string, metadata: string): void {
  const got = bolt11DescriptionHash(invoice);
  if (!got) return; // no h tag → nothing to verify
  const want = sha256(new TextEncoder().encode(metadata));
  if (!bytesEq(got, want)) {
    throw new Error("LNURL pay: hash popisu se neshoduje s metadaty (možný MITM)");
  }
}

/** Submit a BOLT11 invoice to the LNURL-w callback. The service pays the
 *  invoice; the wallet detects the incoming payment via mint quote polling. */
export async function submitLnurlInvoice(
  callback: string,
  k1: string,
  pr: string,
): Promise<void> {
  const u = new URL(callback);
  u.searchParams.set("k1", k1);
  u.searchParams.set("pr", pr);
  const r = await fetch(maybeProxyLnurl(u.toString()), { credentials: "omit" });
  if (!r.ok) throw new Error(`LNURL callback HTTP ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>;
  if (j.status === "ERROR") throw new Error(String(j.reason ?? "LNURL callback error"));
  // OK status = service accepted the invoice and will attempt payment.
}
