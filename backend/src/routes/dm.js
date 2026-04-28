// Direct-message request lifecycle: send, accept, reject/block, list.
// The actual message exchange goes through the public channel-message
// endpoints (in routes/chat.js) keyed by `dm:<a>:<b>` slug; this file
// only owns the contact list and pending-request state.

import { db } from "../db.js";
import { safeId, validOwnerId } from "../helpers.js";
import { dmSlugFor } from "../../../shared/slugs.js";

export function mountDmRoutes(app) {
  // ── DM request + contact management ────────────────────────
  // Caller wants to start a DM with `toOwnerId`. Creates a pending request
  // (or re-opens a previously rejected one). Blocked requests cannot be
  // retried from the sender side — they must be unblocked by the receiver.
  app.post("/api/dm/request", (req, res) => {
    const { fromOwnerId, toOwnerId } = req.body || {};
    if (!validOwnerId(fromOwnerId)) return res.status(400).json({ error: "bad fromOwnerId" });
    if (!validOwnerId(toOwnerId)) return res.status(400).json({ error: "bad toOwnerId" });
    if (fromOwnerId === toOwnerId) return res.status(400).json({ error: "cannot DM yourself" });
    // The recipient must have a chat profile so sender can see whom they're
    // requesting. Orphan ids shouldn't pollute the inbox.
    const toProfile = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(toOwnerId);
    if (!toProfile) return res.status(404).json({ error: "recipient has no chat profile yet" });

    const existing = db.prepare(`
      SELECT id, status FROM dm_request
      WHERE from_owner_id = ? AND to_owner_id = ?
    `).get(fromOwnerId, toOwnerId);

    // Also check the reverse direction — if B once requested A and A accepted,
    // treat it as a reciprocal accepted contact (no need for A to "re-request").
    const reverse = db.prepare(`
      SELECT id, status FROM dm_request
      WHERE from_owner_id = ? AND to_owner_id = ?
    `).get(toOwnerId, fromOwnerId);
    if (reverse && reverse.status === "accepted") {
      return res.json({ ok: true, id: reverse.id, status: "accepted", reciprocal: true });
    }

    if (existing) {
      if (existing.status === "blocked") return res.status(403).json({ error: "blocked" });
      if (existing.status === "accepted") return res.json({ ok: true, id: existing.id, status: "accepted" });
      // pending / rejected → reopen
      db.prepare(`
        UPDATE dm_request SET status = 'pending', updated_at = datetime('now') WHERE id = ?
      `).run(existing.id);
      return res.json({ ok: true, id: existing.id, status: "pending" });
    }

    const id = safeId("dmr");
    db.prepare(`
      INSERT INTO dm_request (id, from_owner_id, to_owner_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, fromOwnerId, toOwnerId);
    res.json({ ok: true, id, status: "pending" });
  });

  // Returns the caller's full DM state:
  //   incoming  — pending requests where caller is recipient (needs action)
  //   outgoing  — pending requests the caller has sent (awaiting reply)
  //   contacts  — accepted requests (either direction) with partner's profile
  //               and last-message metadata so the UI can build a sidebar
  app.get("/api/dm/state", (req, res) => {
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    const incoming = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.status, r.created_at,
             u.display_name, u.avatar
      FROM dm_request r
      LEFT JOIN chat_user u ON u.owner_id = r.from_owner_id
      WHERE r.to_owner_id = ? AND r.status = 'pending'
      ORDER BY r.created_at DESC
    `).all(ownerId);

    const outgoing = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.status, r.created_at,
             u.display_name, u.avatar
      FROM dm_request r
      LEFT JOIN chat_user u ON u.owner_id = r.to_owner_id
      WHERE r.from_owner_id = ? AND r.status IN ('pending', 'rejected')
      ORDER BY r.created_at DESC
    `).all(ownerId);

    // Accepted contacts — either direction. Partner is the "other" side.
    const accepted = db.prepare(`
      SELECT r.id, r.from_owner_id, r.to_owner_id, r.updated_at,
             CASE WHEN r.from_owner_id = ? THEN r.to_owner_id ELSE r.from_owner_id END AS partner_id
      FROM dm_request r
      WHERE (r.from_owner_id = ? OR r.to_owner_id = ?) AND r.status = 'accepted'
      ORDER BY r.updated_at DESC
    `).all(ownerId, ownerId, ownerId);

    // For each accepted contact, fetch partner profile + last DM message.
    const contacts = accepted.map((r) => {
      const u = db.prepare(
        "SELECT owner_id, display_name, avatar FROM chat_user WHERE owner_id = ?"
      ).get(r.partner_id);
      const slug = dmSlugFor(ownerId, r.partner_id);
      const last = db.prepare(`
        SELECT body, created_at, author_owner_id FROM channel_message
        WHERE channel_slug = ? ORDER BY created_at DESC LIMIT 1
      `).get(slug);
      return {
        partnerOwnerId: r.partner_id,
        partnerName: u?.display_name ?? null,
        partnerAvatar: u?.avatar ?? null,
        dmSlug: slug,
        lastMessage: last ? { body: last.body, createdAt: last.created_at, authorOwnerId: last.author_owner_id } : null,
        acceptedAt: r.updated_at,
      };
    });

    res.json({
      incoming: incoming.map((r) => ({
        id: r.id,
        fromOwnerId: r.from_owner_id,
        fromName: r.display_name ?? null,
        fromAvatar: r.avatar ?? null,
        createdAt: r.created_at,
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        toOwnerId: r.to_owner_id,
        toName: r.display_name ?? null,
        toAvatar: r.avatar ?? null,
        status: r.status,
        createdAt: r.created_at,
      })),
      contacts,
    });
  });

  app.post("/api/dm/requests/:id/accept", (req, res) => {
    const { ownerId } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT to_owner_id, status FROM dm_request WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.to_owner_id !== ownerId) return res.status(403).json({ error: "not recipient" });
    if (row.status === "accepted") return res.json({ ok: true });
    db.prepare(`
      UPDATE dm_request SET status = 'accepted', updated_at = datetime('now') WHERE id = ?
    `).run(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/dm/requests/:id/reject", (req, res) => {
    const { ownerId, block } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT to_owner_id, status FROM dm_request WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.to_owner_id !== ownerId) return res.status(403).json({ error: "not recipient" });
    const next = block ? "blocked" : "rejected";
    db.prepare(`
      UPDATE dm_request SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(next, req.params.id);
    res.json({ ok: true, status: next });
  });
}
