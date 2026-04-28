// Constants shared between the Express backend and the Vite/React frontend.
// Importable from both sides as `../../shared/constants.js` — backend reads
// at runtime via Node ESM, frontend inlines at build time via Vite.
//
// Keep this file:
//   • plain ESM JavaScript (no TypeScript syntax — backend can't compile),
//   • free of business logic (constants, regexes, builders only),
//   • free of external imports (other than other shared/* modules).
//
// TypeScript types are declared in the adjacent constants.d.ts so the
// frontend gets literal-narrowed types without a compile step.

/** Allowed reaction emojis, mirrored across UI picker and backend allowlist. */
export const REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "😮", "🙏", "🚀"];

/** Max characters for chat-user bio. */
export const BIO_MAX_CHARS = 500;

/** Min/max characters for chat-user display name. */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

/** Max bytes for chat-user avatar after base64 encoding. ~200 KB binary. */
export const AVATAR_MAX_BYTES = 220_000;

/** Max characters per chat message body. */
export const MESSAGE_MAX_CHARS = 2000;

/** Per-event chat lifecycle, in days:
 *   • Events show in the chat sidebar starting LOOKAHEAD days before they begin
 *   • Events stay visible (and writable) until ARCHIVE days after they end
 *   • Beyond ARCHIVE days, write attempts return 410 (read still works). */
export const EVENT_CHAT_LOOKAHEAD_DAYS = 5;
export const EVENT_CHAT_ARCHIVE_DAYS = 7;
