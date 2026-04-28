// Per-device chat auth token. Lets the user delete their own messages
// without a session or account. Same privacy shape as push/rsvp tokens —
// backend gets only the opaque random token, no identity.
//
// The nickname (shown next to messages) is NOT stored here anymore — it
// lives in chat_user on the backend, keyed by Evolu appOwner.id, so it
// syncs across devices. See useChatProfile.

import { LS, safeLs } from "./storageKeys";

const TOKEN_KEY = LS.ChatToken;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}

export function getOrCreateChatToken(): string {
  const existing = safeLs.get(TOKEN_KEY);
  if (existing && existing.length >= 16) return existing;
  const t = generateToken();
  safeLs.set(TOKEN_KEY, t);
  return t;
}
