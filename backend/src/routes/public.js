// Public routes that didn't fit a more specific module:
//   • /api/articles, /api/events  (content reads)
//   • /api/push/*                  (anonymous push registration + self-test)
//   • /api/communities             (community directory snapshot)
//   • /api/admin/apply             (tier 3+ users requesting community admin)
//
// Chat lives in routes/chat.js, DMs in routes/dm.js, events/RSVP in
// routes/events.js, telemetry in routes/telemetry.js, tier wrappers in
// routes/tier-public.js.

import webpush from "web-push";
import { db } from "../db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "../config.js";
import {
  asArticle, asEvent, randomToken, safeId,
  validOwnerId,
} from "../helpers.js";
import { CITIES } from "../../cities.js";
import { getCommunities } from "../communities.js";

export function mountPublicRoutes(app) {
  // ── Articles ────────────────────────────────────────────────
  app.get("/api/articles", (_req, res) => {
    const rows = db.prepare("SELECT * FROM articles ORDER BY published_at DESC").all();
    res.json(rows.map(asArticle));
  });

  // ── Events listing ──────────────────────────────────────────
  // Public list with a live "going" count joined in. Cheap correlated
  // subquery; SQLite indexes on event_rsvp(event_id, status) handle it.
  // The RSVP write/delete + attendees endpoints live in routes/events.js.
  app.get("/api/events", (_req, res) => {
    const rows = db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM event_rsvp r WHERE r.event_id = e.id AND r.status = 'going') AS going_count
      FROM events e
      ORDER BY e.starts_at ASC
    `).all();
    res.json(rows.map(asEvent));
  });

  // ── Push (anonymous) ───────────────────────────────────────
  app.get("/api/push/vapid", (_req, res) => {
    if (!VAPID_PUBLIC) return res.status(503).json({ error: "VAPID not configured" });
    res.json({ publicKey: VAPID_PUBLIC });
  });

  // ── Community directory ────────────────────────────────────
  app.get("/api/communities", (_req, res) => {
    res.json(getCommunities());
  });

  app.post("/api/push/register", (req, res) => {
    const { endpoint, keys, tags } = req.body || {};
    if (typeof endpoint !== "string" || !endpoint.startsWith("http")) return res.status(400).json({ error: "bad endpoint" });
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return res.status(400).json({ error: "bad keys" });
    const cleanTags = Array.isArray(tags)
      ? tags.filter((t) => typeof t === "string" && t.length > 0 && t.length < 64).slice(0, 64)
      : [];

    // Endpoint is the authoritative identity. Token is a server-issued handle
    // so the client can unregister without revealing the push URL again.
    let token;
    try {
      const upsert = db.transaction(() => {
        const newToken = randomToken();
        db.prepare(`
          INSERT INTO push_sub (token, endpoint, p256dh, auth)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            updated_at = datetime('now')
        `).run(newToken, endpoint, keys.p256dh, keys.auth);
        token = db.prepare("SELECT token FROM push_sub WHERE endpoint = ?").get(endpoint).token;
        db.prepare("DELETE FROM push_tag WHERE token = ?").run(token);
        const ins = db.prepare("INSERT OR IGNORE INTO push_tag (token, tag) VALUES (?, ?)");
        for (const tag of cleanTags) ins.run(token, tag);
      });
      upsert();
    } catch (e) {
      console.error("[push/register]", e.message);
      return res.status(500).json({ error: "register failed" });
    }
    res.json({ token });
  });

  app.post("/api/push/unregister", (req, res) => {
    const { token } = req.body || {};
    if (typeof token !== "string") return res.status(400).json({ error: "bad token" });
    db.prepare("DELETE FROM push_sub WHERE token = ?").run(token);
    res.json({ ok: true });
  });

  // ── Push: self-test ─────────────────────────────────────────
  app.post("/api/push/test", async (req, res) => {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(503).json({ error: "VAPID not configured" });
    const { token } = req.body || {};
    if (typeof token !== "string" || token.length < 10) return res.status(400).json({ error: "bad token" });
    const sub = db.prepare("SELECT endpoint, p256dh, auth FROM push_sub WHERE token = ?").get(token);
    if (!sub) return res.status(404).json({ error: "not registered" });

    const payload = JSON.stringify({
      title: "Jednadvacet · test",
      body: "Notifikace dorazila. Jestli ji vidíš, všechno je v pořádku.",
      url: "/",
      tag: "jednadvacet-test",
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload, { TTL: 60 },
      );
      res.json({ ok: true, endpoint: sub.endpoint.split("/").slice(0, 3).join("/") + "/…" });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        db.prepare("DELETE FROM push_sub WHERE token = ?").run(token);
        return res.status(410).json({ ok: false, error: "subscription gone; removed from server" });
      }
      console.error("[push/test]", e.statusCode, e.body ?? e.message);
      res.status(500).json({ ok: false, error: e.message, statusCode: e.statusCode });
    }
  });

  // ── Admin application: tier 3+ users apply to become community admin ──
  // Hand-shake mechanism. Approval doesn't auto-create an admin_user
  // (chat owner_id and admin email/password are separate identity
  // domains); superadmin uses the existing invite system to onboard.
  const VALID_CITY_SLUGS = new Set(CITIES.map((c) => c.slug));

  app.post("/api/admin/apply", (req, res) => {
    const { ownerId, citiesCsv, message } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof citiesCsv !== "string" || !citiesCsv.trim()) {
      return res.status(400).json({ error: "bad cities" });
    }
    const cities = citiesCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (cities.length === 0 || cities.length > 10) {
      return res.status(400).json({ error: "pick 1–10 cities" });
    }
    for (const c of cities) {
      if (!VALID_CITY_SLUGS.has(c)) return res.status(400).json({ error: `unknown city: ${c}` });
    }
    const msg = typeof message === "string" ? message.trim().slice(0, 1000) : "";

    const userRow = db.prepare(`
      SELECT u.display_name, COALESCE(t.tier, 1) AS tier
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE u.owner_id = ?
    `).get(ownerId);
    if (!userRow) return res.status(404).json({ error: "no chat profile" });
    if (userRow.tier < 3) return res.status(403).json({ error: "tier 3+ required" });

    // Re-application allowed; pending one is replaced.
    const existing = db.prepare(
      "SELECT id, status FROM admin_application WHERE owner_id = ? ORDER BY applied_at DESC LIMIT 1",
    ).get(ownerId);
    if (existing && existing.status === "approved") {
      return res.status(409).json({ error: "already approved" });
    }

    const id = safeId("aapp");
    if (existing && existing.status === "pending") {
      db.prepare(`
        UPDATE admin_application
        SET cities_csv = ?, message = ?, tier_at_apply = ?, applied_at = datetime('now')
        WHERE id = ?
      `).run(cities.join(","), msg, userRow.tier, existing.id);
      return res.json({ ok: true, id: existing.id, status: "pending" });
    }
    db.prepare(`
      INSERT INTO admin_application (id, owner_id, display_name, cities_csv, message, tier_at_apply, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, ownerId, userRow.display_name, cities.join(","), msg, userRow.tier);
    res.json({ ok: true, id, status: "pending" });
  });

  app.get("/api/admin/apply/:ownerId", (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const row = db.prepare(`
      SELECT id, cities_csv, message, status, applied_at, reviewed_at, reject_reason
      FROM admin_application
      WHERE owner_id = ?
      ORDER BY applied_at DESC
      LIMIT 1
    `).get(ownerId);
    if (!row) return res.json({ application: null });
    res.json({
      application: {
        id: row.id,
        citiesCsv: row.cities_csv,
        message: row.message ?? null,
        status: row.status,
        appliedAt: row.applied_at,
        reviewedAt: row.reviewed_at ?? null,
        rejectReason: row.reject_reason ?? null,
      },
    });
  });
}
