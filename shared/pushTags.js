// Builders for the four push-notification tag formats. Used by:
//   • frontend (Profile.tsx, Broadcast admin) when registering subscriptions
//     and constructing per-user tag sets,
//   • backend (push.js, public.js, lnurl.js, reminders.js) when looking up
//     subscribers for a broadcast.
//
// Centralising the format strings here means the canonical shape lives in
// one file — neither side can drift from the other.

/** Per-user tag — every device tied to one app-owner shares this tag. */
export const buildUserTag = (ownerId) => `user:${ownerId}`;

/** Geographic interest — receives admin city broadcasts. */
export const buildCityTag = (citySlug) => `city:${citySlug}`;

/** Topical interest — categories the user opted into. */
export const buildCatTag = (categorySlug) => `cat:${categorySlug}`;

/** Per-channel chat-message tag. `slug` is either "global" or a city slug. */
export const buildChatTag = (channelSlug) => `chat:${channelSlug}`;
