// Marketplace: P2P classifieds (Vexl-lite). Tier 2+ users post listings
// for sats-for-cash, hardware wallets, services, etc. Negotiation
// happens via DM (clicking "Kontaktovat" on a listing fires the
// existing DM-request flow). Backend's job is just hosting the list +
// reports + auto-expiry.

import { db } from "../db.js";
import { safeId, validOwnerId } from "../helpers.js";

const VALID_TYPES = new Set(["buy_sats", "sell_sats", "service", "goods"]);
// Default lifetime — long enough for casual scrolling, short enough that
// stale listings drop off without manual cleanup.
const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 90;

function offerShape(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    proposerName: row.proposer_name,
    type: row.type,
    title: row.title,
    description: row.description ?? "",
    location: row.location ?? null,
    citiesCsv: row.cities_csv ?? "",
    paymentMethodsCsv: row.payment_methods_csv ?? "",
    priceText: row.price_text ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    avatar: row.avatar ?? null,
    tier: row.current_tier ?? 1,
  };
}

export function mountMarketplaceRoutes(app) {
  // List active offers with optional filters. Joined with chat_user +
  // user_tier so the UI can render avatar + tier badge per row.
  app.get("/api/marketplace/offers", (req, res) => {
    // Drop expired listings opportunistically — cheap UPDATE, no
    // separate cron needed at our scale.
    db.prepare(`
      UPDATE marketplace_offer
      SET status = 'closed', updated_at = datetime('now')
      WHERE status = 'active' AND datetime(expires_at) <= datetime('now')
    `).run();

    const type = req.query?.type ? String(req.query.type) : null;
    const city = req.query?.city ? String(req.query.city) : null;
    const q = req.query?.q ? String(req.query.q).trim().toLowerCase() : null;
    const status = req.query?.status ? String(req.query.status) : "active";

    let sql = `
      SELECT o.*, u.avatar, COALESCE(t.tier, 1) AS current_tier
      FROM marketplace_offer o
      LEFT JOIN chat_user u ON u.owner_id = o.owner_id
      LEFT JOIN user_tier t ON t.owner_id = o.owner_id
      WHERE o.status = ?
    `;
    const params = [status];
    if (type && VALID_TYPES.has(type)) {
      sql += " AND o.type = ?";
      params.push(type);
    }
    if (city) {
      sql += " AND (',' || o.cities_csv || ',') LIKE ?";
      params.push(`%,${city},%`);
    }
    if (q) {
      sql += " AND (LOWER(o.title) LIKE ? OR LOWER(o.description) LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY o.created_at DESC LIMIT 200";

    const rows = db.prepare(sql).all(...params);
    res.json({ offers: rows.map(offerShape) });
  });

  app.get("/api/marketplace/offers/mine/:ownerId", (req, res) => {
    if (!validOwnerId(req.params.ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const rows = db.prepare(`
      SELECT o.*, u.avatar, COALESCE(t.tier, 1) AS current_tier
      FROM marketplace_offer o
      LEFT JOIN chat_user u ON u.owner_id = o.owner_id
      LEFT JOIN user_tier t ON t.owner_id = o.owner_id
      WHERE o.owner_id = ?
      ORDER BY o.created_at DESC
      LIMIT 100
    `).all(req.params.ownerId);
    res.json({ offers: rows.map(offerShape) });
  });

  app.post("/api/marketplace/offers", (req, res) => {
    const {
      ownerId, type, title, description, location,
      citiesCsv, paymentMethodsCsv, priceText, ttlDays,
    } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof type !== "string" || !VALID_TYPES.has(type)) return res.status(400).json({ error: "bad type" });
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: "title 3-200 chars" });
    }

    // Tier 2+ gate. Newly-onboarded users (tier 1, no Signal joined yet)
    // can't post — keeps random sign-ups from spamming the marketplace.
    const userRow = db.prepare(`
      SELECT u.display_name, COALESCE(t.tier, 1) AS tier
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE u.owner_id = ?
    `).get(ownerId);
    if (!userRow) return res.status(404).json({ error: "no chat profile" });
    if (userRow.tier < 2) return res.status(403).json({ error: "tier 2+ required" });

    // Anti-spam: a single user can have at most 10 active listings.
    const activeCount = db.prepare(`
      SELECT COUNT(*) AS c FROM marketplace_offer
      WHERE owner_id = ? AND status = 'active' AND datetime(expires_at) > datetime('now')
    `).get(ownerId).c;
    if (activeCount >= 10) return res.status(429).json({ error: "max 10 active listings" });

    const ttl = Math.min(MAX_TTL_DAYS, Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS));
    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000).toISOString();

    const id = safeId("offer");
    db.prepare(`
      INSERT INTO marketplace_offer
        (id, owner_id, proposer_name, type, title, description, location,
         cities_csv, payment_methods_csv, price_text, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      id, ownerId, userRow.display_name, type,
      title.trim(),
      typeof description === "string" ? description.trim().slice(0, 5000) : "",
      typeof location === "string" ? location.trim().slice(0, 200) : null,
      typeof citiesCsv === "string" ? citiesCsv : "",
      typeof paymentMethodsCsv === "string" ? paymentMethodsCsv : "",
      typeof priceText === "string" ? priceText.trim().slice(0, 100) : null,
      expiresAt,
    );
    res.json({ ok: true, id });
  });

  app.post("/api/marketplace/offers/:id/update", (req, res) => {
    const { ownerId, status, title, description, priceText } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT owner_id, status FROM marketplace_offer WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.owner_id !== ownerId) return res.status(403).json({ error: "not owner" });

    // Build the SET clause from whichever fields the caller supplied.
    const updates = [];
    const params = [];
    if (typeof status === "string" && ["active", "closed", "sold"].includes(status)) {
      updates.push("status = ?"); params.push(status);
    }
    if (typeof title === "string" && title.trim().length >= 3 && title.trim().length <= 200) {
      updates.push("title = ?"); params.push(title.trim());
    }
    if (typeof description === "string") {
      updates.push("description = ?"); params.push(description.trim().slice(0, 5000));
    }
    if (typeof priceText === "string") {
      updates.push("price_text = ?"); params.push(priceText.trim().slice(0, 100));
    }
    if (updates.length === 0) return res.status(400).json({ error: "no changes" });
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE marketplace_offer SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  });

  app.delete("/api/marketplace/offers/:id", (req, res) => {
    const ownerId = req.body?.ownerId ?? req.query?.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare("SELECT owner_id FROM marketplace_offer WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.owner_id !== ownerId) return res.status(403).json({ error: "not owner" });
    db.prepare("DELETE FROM marketplace_offer WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Anyone can flag. Spam / illegal / scam — admins review later.
  app.post("/api/marketplace/offers/:id/report", (req, res) => {
    const { ownerId, reason } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500) {
      return res.status(400).json({ error: "reason 5-500 chars" });
    }
    const row = db.prepare("SELECT id FROM marketplace_offer WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    db.prepare(`
      INSERT INTO marketplace_report (id, offer_id, reporter_id, reason)
      VALUES (?, ?, ?, ?)
    `).run(safeId("rep"), req.params.id, ownerId, reason.trim());
    res.json({ ok: true });
  });
}
