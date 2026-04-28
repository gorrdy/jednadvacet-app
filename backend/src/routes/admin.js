// Admin-authenticated routes: login/session/me, stats, events CRUD,
// broadcast, rsvps aggregate, manual syncs. Superadmin-only pieces live
// in routes/superadmin.js.

import webpush from "web-push";
import { db } from "../db.js";
import { VAPID_PUBLIC, VAPID_PRIVATE } from "../config.js";
import {
  asEvent, joinCsv, isValidIso, safeId, publicAdmin,
} from "../helpers.js";
import {
  issueSession, requireAdmin, verifyPassword,
} from "../auth.js";
import { runIcsSync, runRssSync } from "../sync.js";
import { previewTomorrowReminders, sendTomorrowReminders } from "../reminders.js";
import { pruneStalePushTokens } from "../push.js";

export function mountAdminRoutes(app) {
  // ── Login / session / me ───────────────────────────────────
  app.post("/api/admin/login", (req, res) => {
    const raw = String(req.body?.identifier ?? req.body?.email ?? req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!raw || !password) return res.status(400).json({ error: "identifier and password required" });

    const isEmail = raw.includes("@");
    const lookup = isEmail
      ? db.prepare("SELECT id, email, username, password_hash, role, city, display_name FROM admin_user WHERE lower(email) = ?").get(raw.toLowerCase())
      : db.prepare("SELECT id, email, username, password_hash, role, city, display_name FROM admin_user WHERE lower(username) = ?").get(raw.toLowerCase());

    // Always run verifyPassword to avoid user-enumeration timing differences.
    const hash = lookup?.password_hash ?? "00:00";
    const ok = verifyPassword(password, hash);
    if (!lookup || !ok) return res.status(401).json({ error: "bad credentials" });

    const { token, expiresAt } = issueSession(lookup.id);
    res.json({ token, expiresAt, admin: publicAdmin(lookup) });
  });

  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const h = req.get("authorization") || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) db.prepare("DELETE FROM admin_session WHERE token = ?").run(m[1].trim());
    res.json({ ok: true });
  });

  app.get("/api/admin/me", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT id, email, username, role, city, display_name FROM admin_user WHERE id = ?").get(req.admin.id);
    res.json({ admin: row ? publicAdmin(row) : req.admin });
  });

  // ── Manual syncs ───────────────────────────────────────────
  app.post("/api/admin/ics/sync", requireAdmin, async (_req, res) => {
    res.json(await runIcsSync());
  });
  app.post("/api/admin/rss/sync", requireAdmin, async (_req, res) => {
    res.json(await runRssSync());
  });

  // Manually fire the "tomorrow's events" reminder. Dedup in reminder_sent
  // prevents double-sends if the daily cron also runs.
  app.post("/api/admin/reminders/fire", requireAdmin, async (_req, res) => {
    res.json(await sendTomorrowReminders());
  });

  // Preview: what would the next daily reminder push? Which channels,
  // which events, to which recipients (token suffix + endpoint host).
  // Also returns recent history from reminder_sent so admin can audit
  // past fires.
  app.get("/api/admin/reminders/upcoming", requireAdmin, (_req, res) => {
    const preview = previewTomorrowReminders();
    const history = db.prepare(`
      SELECT day, city, events, sent, sent_at
      FROM reminder_sent
      ORDER BY sent_at DESC
      LIMIT 50
    `).all();
    res.json({ preview, history });
  });

  // ── Events CRUD ────────────────────────────────────────────
  app.post("/api/admin/events", requireAdmin, (req, res) => {
    const b = req.body || {};
    if (typeof b.title !== "string" || b.title.length === 0) return res.status(400).json({ error: "title required" });
    if (typeof b.location !== "string" || b.location.length === 0) return res.status(400).json({ error: "location required" });
    if (!isValidIso(b.startsAt) || !isValidIso(b.endsAt)) return res.status(400).json({ error: "bad dates" });
    if (!Array.isArray(b.cities) || b.cities.length === 0) return res.status(400).json({ error: "cities required" });

    const id = typeof b.id === "string" && b.id.length > 0 ? b.id : safeId("e");

    db.prepare(`
      INSERT INTO events (id, title, description, location, url, starts_at, ends_at, cities_csv, categories_csv, organizer, source, updated_at)
      VALUES (@id, @title, @description, @location, @url, @startsAt, @endsAt, @cities, @categories, @organizer, 'admin', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title=@title, description=@description, location=@location, url=@url,
        starts_at=@startsAt, ends_at=@endsAt, cities_csv=@cities, categories_csv=@categories, organizer=@organizer,
        source='admin', updated_at=datetime('now')
    `).run({
      id,
      title: b.title,
      description: b.description ?? "",
      location: b.location,
      url: b.url ?? null,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      cities: joinCsv(b.cities),
      categories: joinCsv(b.categories ?? []),
      organizer: b.organizer ?? null,
    });

    const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    res.json(asEvent(row));
  });

  app.delete("/api/admin/events/:id", requireAdmin, (req, res) => {
    const r = db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  // ── Broadcast push ─────────────────────────────────────────
  app.post("/api/admin/broadcast", requireAdmin, async (req, res) => {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(503).json({ error: "VAPID not configured" });
    const b = req.body || {};
    if (typeof b.title !== "string" || b.title.length === 0) return res.status(400).json({ error: "title required" });
    const tags = Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === "string") : [];

    const subs = tags.length === 0
      ? db.prepare("SELECT token, endpoint, p256dh, auth FROM push_sub").all()
      : db.prepare(`
          SELECT DISTINCT s.token, s.endpoint, s.p256dh, s.auth
          FROM push_sub s
          JOIN push_tag t ON t.token = s.token
          WHERE t.tag IN (${tags.map(() => "?").join(",")})
        `).all(...tags);

    const matched = subs.length;
    const payload = JSON.stringify({
      title: b.title,
      body: b.body ?? "",
      url: b.url ?? "/",
      tag: "jednadvacet-admin",
    });

    let sent = 0, failed = 0;
    const stale = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (e) {
        failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.token);
      }
    }));
    pruneStalePushTokens(stale);

    res.json({ matched, sent, failed });
  });

  // ── Stats (legacy simple) ──────────────────────────────────
  app.get("/api/admin/stats", requireAdmin, (_req, res) => {
    const subscribers = db.prepare("SELECT COUNT(*) AS c FROM push_sub").get().c;
    const events = db.prepare("SELECT COUNT(*) AS c FROM events").get().c;
    const rsvps = db.prepare("SELECT COUNT(*) AS c FROM event_rsvp").get().c;
    const bySource = Object.fromEntries(
      db.prepare("SELECT source, COUNT(*) AS c FROM events GROUP BY source").all().map((r) => [r.source, r.c]),
    );
    const byTag = Object.fromEntries(
      db.prepare(`
        SELECT tag, COUNT(DISTINCT token) AS n FROM push_tag
        GROUP BY tag ORDER BY n DESC
      `).all().map((r) => [r.tag, r.n]),
    );
    res.json({ subscribers, events, rsvps, bySource, byTag });
  });

  // ── RSVP aggregates ────────────────────────────────────────
  app.get("/api/admin/rsvps", requireAdmin, (_req, res) => {
    const rows = db.prepare(`
      SELECT event_id, status, COUNT(*) AS n
      FROM event_rsvp
      GROUP BY event_id, status
    `).all();
    const out = {};
    for (const r of rows) {
      if (!out[r.event_id]) out[r.event_id] = { going: 0, maybe: 0, not_going: 0, total: 0 };
      out[r.event_id][r.status] = r.n;
      out[r.event_id].total += r.n;
    }
    res.json(out);
  });
}
