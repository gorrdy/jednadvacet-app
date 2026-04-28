// Shared web-push helpers — query subscriptions by tag, prune dead
// endpoints, send payloads. Replaces the inline copies that lived in
// public.js, reminders.js, and admin.js.

import webpush from "web-push";
import { db } from "./db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "./config.js";

/** All distinct subscriptions whose owner has subscribed to `tag`. */
export function getSubsForTag(tag) {
  return db.prepare(`
    SELECT DISTINCT s.token, s.endpoint, s.p256dh, s.auth
    FROM push_sub s JOIN push_tag t ON t.token = s.token
    WHERE t.tag = ?
  `).all(tag);
}

/** Same as getSubsForTag but excludes tokens that ALSO carry the
 *  given `userTag`. Used by chat broadcasts so the author's own devices
 *  don't ping for their own message. */
export function getSubsForTagExcludingUser(tag, userTag) {
  if (!userTag) return getSubsForTag(tag);
  return db.prepare(`
    SELECT DISTINCT s.token, s.endpoint, s.p256dh, s.auth
    FROM push_sub s JOIN push_tag t ON t.token = s.token
    WHERE t.tag = ?
      AND s.token NOT IN (SELECT token FROM push_tag WHERE tag = ?)
  `).all(tag, userTag);
}

/** Delete `push_sub` rows for tokens that the browser reported gone
 *  (404 or 410 from sendNotification). Call after a Promise.all sweep
 *  collects stale tokens via the catch branch. Idempotent + transactional. */
export function pruneStalePushTokens(stale) {
  if (stale.length === 0) return 0;
  const del = db.prepare("DELETE FROM push_sub WHERE token = ?");
  const tx = db.transaction((arr) => { for (const t of arr) del.run(t); });
  tx(stale);
  return stale.length;
}

/**
 * Send a payload to every push subscription tagged `tag`.
 * @param {string} tag — e.g. "user:<ownerId>", "city:praha", "chat:global"
 * @param {object} payload — { title, body, url?, tag?, renotify? }
 * @param {object} [opts]
 * @param {number} [opts.ttl=600] — push TTL seconds
 */
export async function sendPushToTag(tag, payload, opts = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0, pruned: 0 };
  const subs = getSubsForTag(tag);
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const ttl = opts.ttl ?? 600;
  const stale = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body, { TTL: ttl },
      );
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.token);
    }
  }));
  pruneStalePushTokens(stale);
  return { sent: subs.length - stale.length, pruned: stale.length };
}
