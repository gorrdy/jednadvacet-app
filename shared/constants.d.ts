// TypeScript types for shared/constants.js. Adjacent to the runtime file so
// frontend gets literal narrowing without a build step.

export const REACTIONS: readonly ["👍", "❤️", "😂", "🔥", "👀", "😮", "🙏", "🚀"];

export const BIO_MAX_CHARS: 500;
export const DISPLAY_NAME_MIN: 2;
export const DISPLAY_NAME_MAX: 40;
export const AVATAR_MAX_BYTES: 220_000;
export const MESSAGE_MAX_CHARS: 2000;

export const EVENT_CHAT_LOOKAHEAD_DAYS: 5;
export const EVENT_CHAT_ARCHIVE_DAYS: 7;
