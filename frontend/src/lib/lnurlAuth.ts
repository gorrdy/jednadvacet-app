// LNURL-auth (LUD-04) — sign a per-domain challenge with a wallet-derived
// key so a remote service can authenticate the user without a password.
//
// Key derivation follows LUD-05:
//   1. masterSeed = sha256(<stable user identity bytes>)
//      We use the SHA-256 of the user's Evolu appOwner.id (a SLIP-21
//      derived identity already deterministic per mnemonic). This gives
//      us a stable 32-byte seed without re-exposing the BIP-39 mnemonic.
//   2. hashingKey = HMAC-SHA256(masterSeed, "Make_LNURL_auth_key")
//   3. derivationMaterial = HMAC-SHA256(hashingKey, domainBytes)
//   4. interpret derivationMaterial[0..16] as four little-endian u32's
//      → BIP-32 path m/138'/<u32_1>/<u32_2>/<u32_3>/<u32_4>
//   5. linkingPrivKey = derived child's private key
//
// Signature is secp256k1 ECDSA over the 32-byte k1 challenge bytes,
// serialised in DER (compatible with the LUD-04 reference and major
// services). Public key is the compressed (33-byte) sec1 form.

import { HDKey } from "@scure/bip32";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const TEXT = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function fromHex(h: string): Uint8Array {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/** Derive a per-(user, domain) linking keypair following LUD-05. */
export function deriveAuthLinkingKey(
  ownerId: string,
  domain: string,
): { privKey: Uint8Array; pubKey: Uint8Array } {
  // Stable per-user 32-byte seed — sha256 of the SLIP-21-derived owner id.
  // The owner id is already public, so hashing it doesn't leak more than
  // the wallet already discloses.
  const masterSeed = sha256(TEXT.encode(ownerId));
  const hashingKey = hmac(sha256, masterSeed, TEXT.encode("Make_LNURL_auth_key"));
  const derivation = hmac(sha256, hashingKey, TEXT.encode(domain));

  // First 16 bytes → four little-endian u32 path indices. Per LUD-05
  // these are full uint32 values (0..2^32-1), passed verbatim to BIP-32
  // child derivation. Indices ≥ 0x80000000 trigger HARDENED derivation,
  // which @scure/bip32 handles correctly. We previously clipped to the
  // non-hardened range (& 0x7fffffff) — that produced different keys
  // than spec-compliant wallets (Phoenix / LNbits / Coracle) and broke
  // login on services that had previously seen our key from a
  // standards-compliant wallet.
  const path: number[] = [];
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    const v =
      derivation[o] |
      (derivation[o + 1] << 8) |
      (derivation[o + 2] << 16) |
      (derivation[o + 3] << 24);
    path.push(v >>> 0); // force unsigned, no clipping
  }

  // Construct an HD root from the masterSeed. BIP-32 normally takes a
  // 64-byte seed; @scure/bip32 will fill chain code from any 32-byte+ input.
  // We use the same masterSeed so the derivation is fully deterministic.
  const root = HDKey.fromMasterSeed(masterSeed);
  const node = root
    .deriveChild(138 + 0x80000000) // m/138'
    .deriveChild(path[0])
    .deriveChild(path[1])
    .deriveChild(path[2])
    .deriveChild(path[3]);

  if (!node.privateKey) throw new Error("BIP-32 derivation has no private key");
  return {
    privKey: node.privateKey,
    pubKey: secp256k1.getPublicKey(node.privateKey, true),
  };
}

/** Sign the 32-byte k1 challenge (hex) with the linking key. Returns the
 *  DER-encoded signature as a hex string — what LUD-04 services expect
 *  in the `?sig=` query parameter. We pass `prehash: false` because the
 *  k1 IS the message digest already (32 random bytes from the service). */
export function signAuthChallenge(privKey: Uint8Array, k1Hex: string): string {
  const msg = fromHex(k1Hex);
  if (msg.length !== 32) throw new Error("k1 must be 32 bytes");
  const sig = secp256k1.sign(msg, privKey, {
    lowS: true,
    prehash: false,
    format: "der",
  });
  return hex(sig);
}

/** Convenience: derive + sign in one go. Returns the parameters the
 *  LUD-04 callback expects (`sig` + `key`, both hex). */
export function buildAuthResponse(
  ownerId: string,
  domain: string,
  k1Hex: string,
): { sig: string; key: string } {
  const { privKey, pubKey } = deriveAuthLinkingKey(ownerId, domain);
  return {
    sig: signAuthChallenge(privKey, k1Hex),
    key: hex(pubKey),
  };
}
