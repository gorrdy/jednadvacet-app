// Pure encoding/decoding helpers for LNURL strings — bech32 (LUD-01) +
// URI-scheme handling (LUD-17). No spec-level semantics, no network.
// Carved out of lnurl.ts so the codec can be tested in isolation and so
// the spec-level helpers don't have to scroll past 130 lines of bit
// twiddling. Reference: BIP-173.

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

export function from5to8(words: number[]): Uint8Array | null {
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

/** Bech32 charset lookup — exposed so the BOLT-11 description-hash walker
 *  in lnurl.ts can convert chars to 5-bit values without re-deriving. */
export const BECH32_CHARSET = CHARSET;

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
 *  pointing to an LNURL endpoint). */
export function isLnurlCandidate(s: string): boolean {
  const trimmed = stripUriScheme(s.trim());
  if (/^lnurl1[a-z0-9]+$/i.test(trimmed)) return true;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  return false;
}

/** Strip recognised URI scheme prefixes. Handles `lightning:` /
 *  `lightning://`, nested wrappers like `lightning:lnurl:lnurl1…`, LUD-17
 *  schemes (`lnurlp:`, `lnurlw:`, `lnurla:`, `keyauth:` with optional
 *  `//`), and the legacy bare `lnurl:` prefix. */
export function stripUriScheme(s: string): string {
  let r = s.trim();
  // Loop a few times to unwrap nested wrappers — cheap, cap at 4 to
  // avoid pathological inputs spinning forever.
  for (let i = 0; i < 4; i++) {
    // LUD-17: lnurl(p|w|a|c)? / keyauth → conversion to https. We handle
    // this branch first because if it matches, we want to *return* the
    // converted URL, not just strip the prefix.
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

/** Coerce a scanned string to its underlying LNURL service URL. */
export function lnurlServiceUrl(s: string): string {
  const trimmed = stripUriScheme(s.trim());
  if (/^lnurl1[a-z0-9]+$/i.test(trimmed)) return decodeLnurl(trimmed);
  return trimmed;
}

/** Lightning Address (LUD-16) shape detector. Matches `name@domain.tld`
 *  with the same local-part rules as RFC 5321. */
export function isLightningAddress(s: string): boolean {
  return /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
}

/** Lightning Address → `.well-known/lnurlp/<name>` URL. */
export function lightningAddressToUrl(addr: string): string {
  const [name, domain] = addr.trim().toLowerCase().split("@");
  if (!name || !domain) throw new Error("Špatná Lightning Address");
  // .onion / localhost stay http per LUD-17, everything else https.
  const scheme = domain.endsWith(".onion") || domain === "localhost" ? "http" : "https";
  return `${scheme}://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}
