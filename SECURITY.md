# Security policy

## Reporting a vulnerability

If you find a security issue, **please don't open a public GitHub issue**.

Email: `gorrdy@jednadvacet.org`

Please include:

- A description of the issue.
- Steps to reproduce (or a proof-of-concept).
- The component (frontend / backend / Evolu sync / push pipeline).
- The impact you think it has and any suggested mitigation.

You'll get an acknowledgement within a few days. Coordinated disclosure is
preferred — give us a reasonable window to ship a fix before publishing.

## Scope

In scope:

- The PWA frontend (`frontend/`)
- The Node + SQLite backend (`backend/`)
- Anonymous push pipeline (VAPID, push tokens, broadcast tags)
- Anything that could leak personal data (Evolu CRDT integration,
  bookmarks/RSVP/preferences)
- The Cashu wallet integration (proof handling, mint interactions)

Out of scope:

- Bugs in upstream dependencies (Evolu, cashu-ts, web-push) — please
  report those upstream.
- Issues in the live demo deployment that aren't reproducible against a
  fresh checkout (those are operator concerns, not codebase ones).
- Self-XSS, social engineering, missing security headers without a
  demonstrated impact.

## Cryptographic assumptions

- Personal user data is end-to-end encrypted by Evolu using a 24-word
  BIP-39 mnemonic. We never see plaintext on the relay.
- Push subscription endpoints are stored under an opaque per-device
  token; the backend cannot link them to identity. Push **provider**
  (Google / Mozilla / Apple) still sees endpoint metadata — this is
  inherent to Web Push.
- The Cashu wallet uses each mint's keysets directly via cashu-ts. We
  do not custody anyone's funds.

If you have feedback on these assumptions or believe they don't hold,
that's exactly the kind of report we want.
