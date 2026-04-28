// Channel slug formats and parsers shared by frontend and backend.
//
//   global, <city>            — public broadcast channels
//   dm:<ownerA>:<ownerB>      — direct message between two app-owners
//                               (lex-sorted so either side derives same slug)
//   event:<eventId>           — per-event chat thread, RSVP-gated
//
// Plain ESM JavaScript — see shared/constants.js for the design.

/** Strict regex for DM slugs. Both owner ids are 16–64 char base64url. */
export const DM_SLUG_RE = /^dm:([A-Za-z0-9_-]{16,64}):([A-Za-z0-9_-]{16,64})$/;

/** Strict regex for per-event chat slugs. eventId is whatever the calendar
 *  source emits (ICS UIDs include `_`, manual ids may include `-`). */
export const EVENT_SLUG_RE = /^event:([a-zA-Z0-9_-]+)$/;

/** Build the canonical DM slug from two owner ids. Returns null when the
 *  same id is given for both sides (no self-DMs). */
export function dmSlugFor(a, b) {
  if (a === b) return null;
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

/** Parse a DM slug. Returns `{ a, b }` (lex-sorted) on success, null on
 *  malformed input or unsorted ids (which would let one side derive a
 *  different slug than the other and break access checks). */
export function parseDmSlug(slug) {
  const m = DM_SLUG_RE.exec(slug);
  if (!m) return null;
  const [, a, b] = m;
  if (a >= b) return null;
  return { a, b };
}

/** Parse an event-chat slug. Returns `{ eventId }` or null. */
export function parseEventSlug(slug) {
  const m = EVENT_SLUG_RE.exec(slug);
  if (!m) return null;
  return { eventId: m[1] };
}
