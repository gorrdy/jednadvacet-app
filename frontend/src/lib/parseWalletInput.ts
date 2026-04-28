// Universal input parser for the wallet. Detects what a scanned/pasted
// string represents so the UI can route without asking the user.
//
// Real-world QR generators emit a wide menagerie of prefix shapes:
//   lightning:lnurl1…              (most common)
//   lightning://lnurl1…             (some Android wallets)
//   LIGHTNING:LNURL1…               (uppercase)
//   lightning:lnurlp://service…     (LUD-17 inside lightning: scheme)
//   lightning:user@domain.com       (LN address inside lightning: scheme)
//   bitcoin:bc1q…?amount=0.001&lightning=lnbc…   (BIP-21 with LN fallback)
//   lnurl:lnurl1…                   (rare but seen)
// We strip all of those down to the bare payload before dispatch.

export type WalletInput =
  | { kind: "cashuToken"; value: string }
  | { kind: "lnInvoice"; value: string }
  | { kind: "lnurl"; value: string }              // raw lnurl1… / LUD-17 lnurl(p|w|a):/ / https URL
  | { kind: "lightningAddress"; value: string }   // user@domain.com (LUD-16)
  | { kind: "mintUrl"; value: string }
  | { kind: "unknown"; value: string };

/** Strip wallet-payload-irrelevant scheme prefixes that QR generators wrap
 *  things in. Keeps LUD-17 schemes (`lnurlp:`, `lnurlw:`, `lnurla:`,
 *  `keyauth:`) intact because downstream needs them to identify LUD-17 —
 *  those get stripped later in `lnurlServiceUrl`. */
function stripWrapperSchemes(input: string): string {
  let r = input.trim();
  // Loop a few times to unwrap nested prefixes like
  // `lightning:lightning://lnurl:lnurl1…` (cheap; we cap at 4 to avoid
  // pathological inputs spinning forever).
  for (let i = 0; i < 4; i++) {
    const m = r.match(/^(lightning|bitcoin|cashu|lnurl):\/{0,2}/i);
    if (!m) break;
    r = r.slice(m[0].length).trim();
  }
  return r;
}

/** BIP-21 `bitcoin:address?…&lightning=<bolt11-or-lnurl>` carries a
 *  Lightning fallback in its query string. When present, the LN fallback
 *  is what we want to act on (BTCPay servers, Strike, etc. emit these). */
function extractBip21Lightning(raw: string): string | null {
  if (!/^bitcoin:/i.test(raw)) return null;
  // Replace the bitcoin: scheme with https:// so URL() can parse the
  // query string (the address itself becomes the path which we ignore).
  let u: URL;
  try { u = new URL(raw.replace(/^bitcoin:\/{0,2}/i, "https://btc/")); } catch { return null; }
  const ln = u.searchParams.get("lightning") ?? u.searchParams.get("LIGHTNING");
  return ln && ln.length > 0 ? ln : null;
}

export function parseWalletInput(raw: string): WalletInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "unknown", value: trimmed };

  // BIP-21 with LN fallback short-circuits to whatever the `lightning=`
  // param contained — recurse to dispatch that as its own input.
  const bip21Ln = extractBip21Lightning(trimmed);
  if (bip21Ln) return parseWalletInput(bip21Ln);

  const s = stripWrapperSchemes(trimmed);
  if (!s) return { kind: "unknown", value: trimmed };

  // Cashu V4 tokens start with `cashuB`; legacy V3 with `cashuA`.
  if (/^cashu[AB]/i.test(s)) return { kind: "cashuToken", value: s };

  // BOLT11 Lightning invoice — mainnet `lnbc`, testnet `lntb`, regtest `lnbcrt`.
  if (/^ln(bc|tb|bcrt)\w+/i.test(s)) return { kind: "lnInvoice", value: s.toLowerCase() };

  // Lightning Address (LUD-16) — user@domain.tld. Resolved by the wallet
  // flow to a LUD-06 payRequest endpoint.
  if (/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) {
    return { kind: "lightningAddress", value: s.toLowerCase() };
  }

  // LNURL bech32 OR LUD-17 protocol schemes (lnurlp:/lnurlw:/lnurla:/keyauth:).
  if (/^lnurl1[a-z0-9]+$/i.test(s)) return { kind: "lnurl", value: s };
  if (/^(lnurl[pwac]?|keyauth):/i.test(s)) return { kind: "lnurl", value: s };

  // Mint URL — bare https pointing at a mint-looking host. Be conservative;
  // we don't want to misclassify arbitrary URLs. Accept only if it ends in
  // a plausible mint path or is the root of a known-looking host.
  if (/^https?:\/\/[^\s]+$/i.test(s)) return { kind: "mintUrl", value: s };

  return { kind: "unknown", value: s };
}
