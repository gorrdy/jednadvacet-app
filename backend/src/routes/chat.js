// Chat subsystem — channel access gating, real-time SSE fan-out, push
// notifications for chat messages, profile CRUD bound to owner_id, and
// the message + reaction endpoints.
//
// State that lives at module scope (not inside mountChatRoutes):
//   • chatSubscribers — slug → Set<sendFn>; SSE clients added via
//     subscribeChat, removed on disconnect.
//   • lastPushAt — slug → ms-timestamp of last push notification; used
//     by the per-channel debounce.
//
// Both must stay singletons so a chat broadcast reaches every connected
// client. They live here, not in public.js, so the chat handlers and
// the DM handlers (in routes/dm.js, which imports canAccessChannel)
// share one source of truth.

import webpush from "web-push";
import { db } from "../db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "../config.js";
import { getSubsForTagExcludingUser, pruneStalePushTokens } from "../push.js";
import {
  profileShape, safeId, validOwnerId, validOpaqueToken, validDisplayName,
} from "../helpers.js";
import { CITIES } from "../../cities.js";
import {
  REACTIONS,
  BIO_MAX_CHARS,
  AVATAR_MAX_BYTES,
  MESSAGE_MAX_CHARS,
  EVENT_CHAT_ARCHIVE_DAYS,
} from "../../../shared/constants.js";
import { parseDmSlug, parseEventSlug } from "../../../shared/slugs.js";
import { buildChatTag, buildUserTag } from "../../../shared/pushTags.js";
import { ensureUserTier } from "../tier.js";

const VALID_CHANNEL_SLUGS = new Set(["global", ...CITIES.map((c) => c.slug)]);
const EVENT_CHAT_ARCHIVE_MS = EVENT_CHAT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

/** Returns true if `ownerId` may read/write messages in `slug`. Public slugs
 *  are open; dm slugs require the caller to be one of the pair AND the
 *  request between them to be accepted. Pass `forWrite: true` when checking
 *  POST/DELETE access — event chats archive 7d after the event ends.
 *
 *  Exported because routes/dm.js's slug-based delete also needs it. */
export function canAccessChannel(db, slug, ownerId, forWrite = false) {
  if (VALID_CHANNEL_SLUGS.has(slug)) return { ok: true };
  const dm = parseDmSlug(slug);
  if (dm) {
    if (!ownerId) return { ok: false, code: 401, error: "ownerId required for DM" };
    if (ownerId !== dm.a && ownerId !== dm.b) return { ok: false, code: 403, error: "not a participant" };
    // At least one accepted request between the pair must exist. Either
    // direction counts — an accepted request opens the channel both ways.
    const req = db.prepare(`
      SELECT 1 FROM dm_request
      WHERE status = 'accepted'
        AND ((from_owner_id = ? AND to_owner_id = ?) OR (from_owner_id = ? AND to_owner_id = ?))
    `).get(dm.a, dm.b, dm.b, dm.a);
    if (!req) return { ok: false, code: 403, error: "DM not accepted yet" };
    return { ok: true };
  }
  const ev = parseEventSlug(slug);
  if (ev) {
    const event = db.prepare("SELECT id, ends_at FROM events WHERE id = ?").get(ev.eventId);
    if (!event) return { ok: false, code: 404, error: "unknown event" };
    if (!ownerId) return { ok: false, code: 401, error: "ownerId required for event chat" };
    // Allow if user has an RSVP (any status) for this event with their
    // owner_id linked. Anonymous RSVPs (token-only) can't access — the
    // chat needs identity to function.
    const rsvp = db.prepare(`
      SELECT 1 FROM event_rsvp
      WHERE event_id = ? AND owner_id = ? AND status IN ('going','maybe')
    `).get(ev.eventId, ownerId);
    if (!rsvp) return { ok: false, code: 403, error: "RSVP required" };
    if (forWrite && event.ends_at) {
      const endedMs = new Date(event.ends_at).getTime();
      if (Number.isFinite(endedMs) && Date.now() - endedMs > EVENT_CHAT_ARCHIVE_MS) {
        return { ok: false, code: 410, error: "event chat archived (read-only)" };
      }
    }
    return { ok: true };
  }
  return { ok: false, code: 404, error: "unknown channel" };
}

// ── Real-time chat fan-out (SSE) ────────────────────────────────
// In-memory pub/sub. Each slug has a Set of `send` callbacks that push
// serialised SSE events to connected clients. Cleaned up on client
// disconnect via req.on('close'). Scales to a few thousand connections
// on one Node process — well past what our community needs.
const chatSubscribers = new Map();
function subscribeChat(slug, send) {
  let subs = chatSubscribers.get(slug);
  if (!subs) { subs = new Set(); chatSubscribers.set(slug, subs); }
  subs.add(send);
  return () => {
    const s = chatSubscribers.get(slug);
    if (!s) return;
    s.delete(send);
    if (s.size === 0) chatSubscribers.delete(slug);
  };
}
function broadcastChat(slug, payload) {
  const subs = chatSubscribers.get(slug);
  if (!subs || subs.size === 0) return;
  for (const send of subs) {
    try { send(payload); } catch { /* client gone, cleanup happens on disconnect */ }
  }
}

// Rate-limit state for chat push: per (slug, any subscriber), max 1 push
// per 30 s. Prevents notification spam during a rapid burst.
const lastPushAt = new Map();
const PUSH_DEBOUNCE_MS = 30_000;

async function maybePushChatNotification(slug, authorName, body, authorOwnerId) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const last = lastPushAt.get(slug) ?? 0;
  const now = Date.now();
  if (now - last < PUSH_DEBOUNCE_MS) return;
  lastPushAt.set(slug, now);

  const tag = buildChatTag(slug);
  // Exclude the author's own devices — getting a push notification for a
  // message you just sent yourself is annoying noise.
  const userTag = authorOwnerId ? buildUserTag(authorOwnerId) : null;
  const subs = getSubsForTagExcludingUser(tag, userTag);
  if (subs.length === 0) return;

  const channelLabel = slug === "global" ? "Globální · CZ" : (CITIES.find((c) => c.slug === slug)?.name ?? slug);
  const payload = JSON.stringify({
    title: `${authorName} · ${channelLabel}`,
    body: body.length > 100 ? body.slice(0, 97) + "…" : body,
    // Deep-link: `/#chat/<slug>`. Frontend reads the hash on mount and
    // routes to the Messages tab + that channel. Service worker focuses
    // an existing tab (if any) via .navigate() or opens a new window.
    url: `/#chat/${slug}`,
    tag: `chat-${slug}`,          // collapse multiple into one on native
    renotify: false,
  });

  const stale = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 60 * 10 },
      );
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.token);
    }
  }));
  pruneStalePushTokens(stale);
}

// Normalise a display name for uniqueness: lowercase + strip diacritics.
// Two nicks compare equal if their `nameNorm` match — lets the server
// reject "Honza" when "honzá" is already taken.
function normalizeName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function mountChatRoutes(app) {
  // ── Chat profile: nickname bound to Evolu owner_id ──────────────
  // Claim a nick (cross-device). Same mnemonic → same owner_id → same
  // nick everywhere. Uniqueness is case-insensitive + diacritic-insensitive.
  // Avatar is a base64 data URL. Guard against blow-up: ~200 KB is enough
  // for a 256×256 JPEG from client-side resize; bigger = reject.
  const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  app.get("/api/chat/profile/:ownerId", (req, res) => {
    if (!validOwnerId(req.params.ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare(
      "SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id = ?",
    ).get(req.params.ownerId);
    if (!row) return res.status(404).json({ error: "no profile" });
    res.json(profileShape(row));
  });

  // Batch fetch: `GET /api/chat/profiles?ids=a,b,c` returns a map keyed by
  // ownerId. Client uses this from the Thread view so avatars render for
  // every distinct author in the message list without N roundtrips.
  app.get("/api/chat/profiles", (req, res) => {
    const raw = String(req.query?.ids ?? "").trim();
    if (!raw) return res.json({});
    const ids = raw.split(",").map((s) => s.trim()).filter((s) => validOwnerId(s)).slice(0, 200);
    if (ids.length === 0) return res.json({});
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id IN (${placeholders})`,
    ).all(...ids);
    const out = {};
    for (const r of rows) out[r.owner_id] = profileShape(r);
    res.json(out);
  });

  app.post("/api/chat/profile", (req, res) => {
    const { ownerId, displayName, avatar, bio } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (!validDisplayName(displayName)) return res.status(400).json({ error: "bad name (2–40 chars)" });

    const name = String(displayName).trim();
    const norm = normalizeName(name);
    if (norm.length < 2) return res.status(400).json({ error: "bad name" });

    let avatarVal = undefined; // undefined = leave as-is, null = clear
    if (avatar !== undefined) {
      if (avatar === null || avatar === "") avatarVal = null;
      else {
        if (typeof avatar !== "string") return res.status(400).json({ error: "bad avatar" });
        if (avatar.length > AVATAR_MAX_BYTES) return res.status(413).json({ error: "avatar too big (resize to ≤200 KB)" });
        if (!DATA_URL_RE.test(avatar)) return res.status(400).json({ error: "avatar must be data:image/(png|jpeg|webp);base64,..." });
        avatarVal = avatar;
      }
    }

    let bioVal = undefined;
    if (bio !== undefined) {
      if (bio === null || bio === "") bioVal = null;
      else {
        if (typeof bio !== "string") return res.status(400).json({ error: "bad bio" });
        const trimmed = bio.trim();
        if (trimmed.length > BIO_MAX_CHARS) return res.status(400).json({ error: `bio too long (max ${BIO_MAX_CHARS})` });
        bioVal = trimmed || null;
      }
    }

    // Taken-by-someone-else check (same-owner update is fine).
    const existing = db.prepare("SELECT owner_id FROM chat_user WHERE name_norm = ?").get(norm);
    if (existing && existing.owner_id !== ownerId) {
      return res.status(409).json({ error: "name taken" });
    }

    // First insert requires the UNIQUE fields; updates only patch what changed.
    const current = db.prepare("SELECT owner_id FROM chat_user WHERE owner_id = ?").get(ownerId);
    if (current) {
      const patches = ["display_name = ?", "name_norm = ?", "updated_at = datetime('now')"];
      const args = [name, norm];
      if (avatarVal !== undefined) { patches.push("avatar = ?"); args.push(avatarVal); }
      if (bioVal    !== undefined) { patches.push("bio = ?");    args.push(bioVal); }
      args.push(ownerId);
      db.prepare(`UPDATE chat_user SET ${patches.join(", ")} WHERE owner_id = ?`).run(...args);
    } else {
      db.prepare(`
        INSERT INTO chat_user (owner_id, display_name, name_norm, avatar, bio)
        VALUES (?, ?, ?, ?, ?)
      `).run(ownerId, name, norm, avatarVal ?? null, bioVal ?? null);
    }

    const row = db.prepare(
      "SELECT owner_id, display_name, avatar, bio, updated_at FROM chat_user WHERE owner_id = ?",
    ).get(ownerId);
    // Zaručí, že každý chat_user má řádek v user_tier (default tier=1
    // + vygenerovaný referral_code) ihned po vytvoření profilu.
    ensureUserTier(ownerId);
    res.json(profileShape(row));
  });

  // ── Public community channels (Global CZ + per-city) ───────────
  // Resolve message shape: join chat_user so renaming a user updates
  // every historical message. Falls back to the denormalised
  // author_name snapshot for rows that pre-date owner_id.
  const messageRowShape = `
    m.id, m.channel_slug, m.author_token, m.author_owner_id,
    COALESCE(u.display_name, m.author_name) AS author_name,
    m.body, m.created_at
  `;

  app.get("/api/channels/:slug/messages", (req, res) => {
    const slug = String(req.params.slug);
    // For public slugs ownerId is ignored; for dm: slugs it must be a
    // participant AND the request must be accepted.
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    const access = canAccessChannel(db, slug, ownerId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const since = req.query?.since ? String(req.query.since) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50)));

    const rows = since
      ? db.prepare(`
          SELECT ${messageRowShape}
          FROM channel_message m
          LEFT JOIN chat_user u ON u.owner_id = m.author_owner_id
          WHERE m.channel_slug = ? AND m.created_at > ?
          ORDER BY m.created_at ASC
          LIMIT ?
        `).all(slug, since, limit)
      : db.prepare(`
          SELECT ${messageRowShape}
          FROM channel_message m
          LEFT JOIN chat_user u ON u.owner_id = m.author_owner_id
          WHERE m.channel_slug = ?
          ORDER BY m.created_at DESC
          LIMIT ?
        `).all(slug, limit).reverse();

    // Batch-fetch reactions for the loaded messages. Cheap COUNT query
    // grouped by (message, emoji), plus a "mine" flag if the requester
    // has an ownerId. One round-trip; UI doesn't have to fan out.
    const ids = rows.map((r) => r.id);
    let reactionsByMsg = new Map();
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const reactRows = db.prepare(`
        SELECT message_id, emoji, COUNT(*) AS c,
               MAX(CASE WHEN owner_id = ? THEN 1 ELSE 0 END) AS mine
        FROM message_reaction
        WHERE message_id IN (${placeholders})
        GROUP BY message_id, emoji
        ORDER BY c DESC, emoji ASC
      `).all(ownerId ?? "", ...ids);
      for (const r of reactRows) {
        const arr = reactionsByMsg.get(r.message_id) ?? [];
        arr.push({ emoji: r.emoji, count: Number(r.c), mine: r.mine === 1 });
        reactionsByMsg.set(r.message_id, arr);
      }
    }

    res.json(rows.map((r) => ({
      id: r.id,
      channelSlug: r.channel_slug,
      authorToken: r.author_token,
      authorOwnerId: r.author_owner_id,
      authorName: r.author_name,
      body: r.body,
      createdAt: r.created_at,
      reactions: reactionsByMsg.get(r.id) ?? [],
    })));
  });

  // Toggle a reaction. Body: { ownerId, emoji, op: "add" | "remove" }
  // Server enforces a small allowlist of emojis to keep the UI's
  // fixed-set picker honest.
  const ALLOWED_REACTIONS = new Set(REACTIONS);
  app.post("/api/messages/:id/reactions", (req, res) => {
    const messageId = String(req.params.id);
    const { ownerId, emoji, op } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof emoji !== "string" || !ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ error: "bad emoji" });
    }
    if (op !== "add" && op !== "remove") return res.status(400).json({ error: "bad op" });

    const msg = db.prepare("SELECT channel_slug FROM channel_message WHERE id = ?").get(messageId);
    if (!msg) return res.status(404).json({ error: "no message" });
    const access = canAccessChannel(db, msg.channel_slug, ownerId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    if (op === "add") {
      db.prepare(`
        INSERT OR IGNORE INTO message_reaction (message_id, owner_id, emoji)
        VALUES (?, ?, ?)
      `).run(messageId, ownerId, emoji);
    } else {
      db.prepare(`
        DELETE FROM message_reaction WHERE message_id = ? AND owner_id = ? AND emoji = ?
      `).run(messageId, ownerId, emoji);
    }
    res.json({ ok: true });
  });

  app.post("/api/channels/:slug/messages", (req, res) => {
    const slug = String(req.params.slug);
    const { token, ownerId, body } = req.body || {};
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    // forWrite=true blocks event chats archived 7d after the event ends.
    const access = canAccessChannel(db, slug, ownerId, true);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (typeof body !== "string") return res.status(400).json({ error: "body required" });
    const trimmed = body.trim();
    if (trimmed.length === 0) return res.status(400).json({ error: "empty body" });
    if (trimmed.length > MESSAGE_MAX_CHARS) return res.status(400).json({ error: `body too long (max ${MESSAGE_MAX_CHARS})` });

    // The user must have claimed a nick first.
    const profile = db.prepare("SELECT display_name FROM chat_user WHERE owner_id = ?").get(ownerId);
    if (!profile) return res.status(412).json({ error: "set nickname first" });

    // Rate limit: max 20 messages per token per minute.
    const recent = db.prepare(`
      SELECT COUNT(*) AS c FROM channel_message
      WHERE author_token = ? AND datetime(created_at) > datetime('now', '-60 seconds')
    `).get(token).c;
    if (recent >= 20) return res.status(429).json({ error: "too many messages (slow down)" });

    const id = safeId("msg");
    db.prepare(`
      INSERT INTO channel_message (id, channel_slug, author_token, author_owner_id, author_name, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, slug, token, ownerId, profile.display_name, trimmed);

    const message = {
      id,
      channelSlug: slug,
      authorToken: token,
      authorOwnerId: ownerId,
      authorName: profile.display_name,
      body: trimmed,
      createdAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      // New messages have no reactions yet, but the field must always be
      // present — frontend reads `m.reactions.length` unconditionally and
      // crashes (TypeError → iOS Safari white screen) if it's undefined.
      reactions: [],
    };
    res.json(message);

    // Fan out to in-app real-time subscribers, and fire an async push
    // notification for devices that opted into chat:<slug>.
    broadcastChat(slug, { kind: "message", message });
    void maybePushChatNotification(slug, profile.display_name, trimmed, ownerId);
  });

  // ── Real-time: subscribe to one or more channels via SSE ──────
  // Client: `new EventSource("/api/chat/stream?slugs=global,praha")`.
  // Server keeps the connection open and pushes `message` events as
  // they happen. Clients handle reconnect automatically via the
  // EventSource API.
  app.get("/api/chat/stream", (req, res) => {
    const raw = String(req.query?.slugs ?? "").trim();
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    const requested = raw.split(",").map((s) => s.trim()).slice(0, 30);
    const slugs = requested.filter((s) => canAccessChannel(db, s, ownerId).ok);
    if (slugs.length === 0) return res.status(400).json({ error: "no valid slugs" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",   // tell nginx not to buffer
    });
    res.flushHeaders();

    const send = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* socket closed */ }
    };

    send({ kind: "ready", slugs });
    const unsubs = slugs.map((s) => subscribeChat(s, send));

    // Heartbeat prevents intermediaries (nginx, Safari iOS background)
    // from dropping the socket after idle timeout.
    const ping = setInterval(() => {
      try { res.write(":ping\n\n"); } catch { /* ignore */ }
    }, 25_000);

    const cleanup = () => {
      clearInterval(ping);
      for (const u of unsubs) u();
      try { res.end(); } catch { /* already closed */ }
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  });

  // Author-side delete: only works with matching token. (For dm slugs the
  // token check is already sufficient — only the author can delete.)
  app.delete("/api/channels/:slug/messages/:id", (req, res) => {
    const slug = String(req.params.slug);
    // Accept both public and dm slug formats; the token match is the real auth.
    if (!VALID_CHANNEL_SLUGS.has(slug) && !parseDmSlug(slug) && !parseEventSlug(slug)) {
      return res.status(404).json({ error: "unknown channel" });
    }
    const token = req.body?.token ?? req.query?.token;
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    const r = db.prepare(
      "DELETE FROM channel_message WHERE id = ? AND channel_slug = ? AND author_token = ?"
    ).run(req.params.id, slug, token);
    if (r.changes === 0) return res.status(404).json({ error: "not found or not yours" });
    res.json({ ok: true });
  });
}
