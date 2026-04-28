// Shared web-push helper. Send a notification payload to every device
// subscribed to a given push_tag, prune endpoints the browser tells us
// are dead (404/410). Reuses the same pattern that
// `maybePushChatNotification` and the daily reminder scheduler use.

import webpush from "web-push";
import { db } from "./db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "./config.js";

/**
 * Send a payload to every push subscription tagged `tag`.
 * @param {string} tag — e.g. "user:<ownerId>", "city:praha", "chat:global"
 * @param {object} payload — { title, body, url?, tag?, renotify? }
 * @param {object} [opts]
 * @param {number} [opts.ttl=600] — push TTL seconds
 */
export async function sendPushToTag(tag, payload, opts = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0, pruned: 0 };
  const subs = db.prepare(`
    SELECT DISTINCT s.token, s.endpoint, s.p256dh, s.auth
    FROM push_sub s JOIN push_tag t ON t.token = s.token
    WHERE t.tag = ?
  `).all(tag);
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
  if (stale.length > 0) {
    const del = db.prepare("DELETE FROM push_sub WHERE token = ?");
    const tx = db.transaction((arr) => { for (const t of arr) del.run(t); });
    tx(stale);
  }
  return { sent: subs.length - stale.length, pruned: stale.length };
}
