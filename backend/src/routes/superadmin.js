// Superadmin-only: user management, invites, dashboard rollup, plus
// the public invite-redeem and invite-info endpoints (no auth but tied
// to the invite system).

import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { ICS_URL, ICS_INTERVAL_MS, RSS_FEEDS, RSS_INTERVAL_MS, INVITE_TTL_DAYS } from "../config.js";
import { EMAIL_RE, USERNAME_RE, publicAdmin, safeId } from "../helpers.js";
import {
  hashPassword, issueSession, requireAdmin, requireSuperadmin, verifyPassword,
} from "../auth.js";
import { getLastIcsSync, getLastRssSync } from "../sync.js";

const inviteExpiresIso = () =>
  new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

const inviteRow = (r) => ({
  code: r.code,
  role: r.role,
  city: r.city ?? null,
  displayName: r.display_name ?? null,
  note: r.note ?? null,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  used: Boolean(r.used_at),
  usedAt: r.used_at ?? null,
  usedByEmail: r.used_by_email ?? null,
  usedByUsername: r.used_by_username ?? null,
});

export function mountSuperadminRoutes(app) {
  // ── User management ────────────────────────────────────────
  app.get("/api/admin/users", requireAdmin, requireSuperadmin, (_req, res) => {
    const rows = db.prepare(`
      SELECT id, email, username, role, city, display_name, created_at
      FROM admin_user
      ORDER BY created_at ASC
    `).all();
    res.json(rows.map((r) => ({ ...publicAdmin(r), createdAt: r.created_at })));
  });

  app.post("/api/admin/users", requireAdmin, requireSuperadmin, (req, res) => {
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : "";
    const username = req.body?.username ? String(req.body.username).trim() : "";
    const password = String(req.body?.password ?? "");
    const role = String(req.body?.role ?? "admin");
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;

    if (!email && !username) return res.status(400).json({ error: "email or username required" });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "bad email" });
    if (username && !USERNAME_RE.test(username)) return res.status(400).json({ error: "bad username (3–40 chars, a–z 0–9 . _ -)" });
    if (password.length < 8) return res.status(400).json({ error: "password must be 8+ chars" });
    if (role !== "admin" && role !== "superadmin") return res.status(400).json({ error: "bad role" });

    const id = safeId("adm");
    try {
      db.prepare(`
        INSERT INTO admin_user (id, email, username, password_hash, role, city, display_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, email || null, username || null, hashPassword(password), role, city, displayName);
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "email or username already exists" });
      console.error("[admin/users create]", e.message);
      return res.status(500).json({ error: "create failed" });
    }
    res.json({ id, email: email || null, username: username || null, role, city, displayName });
  });

  app.delete("/api/admin/users/:id", requireAdmin, requireSuperadmin, (req, res) => {
    if (req.params.id === req.admin.id) return res.status(400).json({ error: "cannot delete self" });
    const r = db.prepare("DELETE FROM admin_user WHERE id = ?").run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/password", requireAdmin, requireSuperadmin, (req, res) => {
    const password = String(req.body?.password ?? "");
    if (password.length < 8) return res.status(400).json({ error: "password must be 8+ chars" });
    const r = db.prepare("UPDATE admin_user SET password_hash = ? WHERE id = ?")
      .run(hashPassword(password), req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    // Invalidate all existing sessions for that user.
    db.prepare("DELETE FROM admin_session WHERE admin_id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── Invites: CRUD (superadmin) ─────────────────────────────
  app.get("/api/admin/invites", requireAdmin, requireSuperadmin, (_req, res) => {
    const rows = db.prepare(`
      SELECT i.*, u.email AS used_by_email, u.username AS used_by_username
      FROM admin_invite i
      LEFT JOIN admin_user u ON u.id = i.used_by_admin_id
      ORDER BY i.created_at DESC
      LIMIT 200
    `).all();
    res.json(rows.map(inviteRow));
  });

  app.post("/api/admin/invites", requireAdmin, requireSuperadmin, (req, res) => {
    const role = String(req.body?.role ?? "admin");
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;
    if (role !== "admin" && role !== "superadmin") return res.status(400).json({ error: "bad role" });

    const code = randomBytes(12).toString("base64url");
    const expiresAt = inviteExpiresIso();
    db.prepare(`
      INSERT INTO admin_invite (code, role, city, display_name, note, created_by_admin_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, role, city, displayName, note, req.admin.id, expiresAt);

    const row = db.prepare("SELECT * FROM admin_invite WHERE code = ?").get(code);
    res.json(inviteRow(row));
  });

  app.delete("/api/admin/invites/:code", requireAdmin, requireSuperadmin, (req, res) => {
    const r = db.prepare("DELETE FROM admin_invite WHERE code = ?").run(req.params.code);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  // ── Invite public info + redeem ────────────────────────────
  app.get("/api/admin/invites/:code/info", (req, res) => {
    const row = db.prepare("SELECT code, role, city, display_name, note, expires_at, used_at FROM admin_invite WHERE code = ?").get(req.params.code);
    if (!row) return res.status(404).json({ error: "invite not found" });
    if (row.used_at) return res.status(410).json({ error: "invite already used" });
    if (Date.parse(row.expires_at) < Date.now()) return res.status(410).json({ error: "invite expired" });
    res.json({
      code: row.code,
      role: row.role,
      city: row.city ?? null,
      displayName: row.display_name ?? null,
      note: row.note ?? null,
      expiresAt: row.expires_at,
    });
  });

  app.post("/api/admin/invites/:code/redeem", (req, res) => {
    const code = req.params.code;
    const invite = db.prepare("SELECT * FROM admin_invite WHERE code = ?").get(code);
    if (!invite) return res.status(404).json({ error: "invite not found" });
    if (invite.used_at) return res.status(410).json({ error: "invite already used" });
    if (Date.parse(invite.expires_at) < Date.now()) return res.status(410).json({ error: "invite expired" });

    const mode = String(req.body?.mode ?? "create");

    if (mode === "create") {
      const username = String(req.body?.username ?? "").trim();
      const password = String(req.body?.password ?? "");
      const displayName = req.body?.displayName ? String(req.body.displayName).trim() : (invite.display_name ?? null);
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "bad username (3–40 chars, a–z 0–9 . _ -)" });
      if (password.length < 8) return res.status(400).json({ error: "password must be 8+ chars" });

      const id = safeId("adm");
      try {
        const apply = db.transaction(() => {
          db.prepare(`
            INSERT INTO admin_user (id, email, username, password_hash, role, city, display_name)
            VALUES (?, NULL, ?, ?, ?, ?, ?)
          `).run(id, username, hashPassword(password), invite.role, invite.city ?? null, displayName);
          db.prepare("UPDATE admin_invite SET used_at = datetime('now'), used_by_admin_id = ? WHERE code = ?")
            .run(id, code);
        });
        apply();
      } catch (e) {
        if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "username already exists" });
        console.error("[invite/redeem create]", e.message);
        return res.status(500).json({ error: "redeem failed" });
      }
      const row = db.prepare("SELECT id, email, username, role, city, display_name FROM admin_user WHERE id = ?").get(id);
      const { token, expiresAt } = issueSession(id);
      return res.json({ token, expiresAt, admin: publicAdmin(row) });
    }

    if (mode === "pair") {
      const raw = String(req.body?.identifier ?? req.body?.email ?? req.body?.username ?? "").trim();
      const password = String(req.body?.password ?? "");
      if (!raw || !password) return res.status(400).json({ error: "identifier and password required" });

      const isEmail = raw.includes("@");
      const user = isEmail
        ? db.prepare("SELECT id, email, username, password_hash, role, city, display_name FROM admin_user WHERE lower(email) = ?").get(raw.toLowerCase())
        : db.prepare("SELECT id, email, username, password_hash, role, city, display_name FROM admin_user WHERE lower(username) = ?").get(raw.toLowerCase());
      const hash = user?.password_hash ?? "00:00";
      const ok = verifyPassword(password, hash);
      if (!user || !ok) return res.status(401).json({ error: "bad credentials" });

      // Apply invite → update role/city. Never demote superadmin to admin via invite.
      const nextRole = user.role === "superadmin" ? "superadmin" : invite.role;
      const apply = db.transaction(() => {
        db.prepare("UPDATE admin_user SET role = ?, city = COALESCE(?, city), display_name = COALESCE(?, display_name) WHERE id = ?")
          .run(nextRole, invite.city ?? null, invite.display_name ?? null, user.id);
        db.prepare("UPDATE admin_invite SET used_at = datetime('now'), used_by_admin_id = ? WHERE code = ?")
          .run(user.id, code);
      });
      apply();

      const row = db.prepare("SELECT id, email, username, role, city, display_name FROM admin_user WHERE id = ?").get(user.id);
      const { token, expiresAt } = issueSession(user.id);
      return res.json({ token, expiresAt, admin: publicAdmin(row) });
    }

    return res.status(400).json({ error: "bad mode" });
  });

  // ── Dashboard rollup ───────────────────────────────────────
  app.get("/api/admin/dashboard", requireAdmin, requireSuperadmin, (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const pushSubscribers = db.prepare("SELECT COUNT(*) AS c FROM push_sub").get().c;
    const rsvpTokens = db.prepare("SELECT COUNT(DISTINCT token) AS c FROM event_rsvp").get().c;
    const rsvpTotal = db.prepare("SELECT COUNT(*) AS c FROM event_rsvp").get().c;
    const adminAccounts = db.prepare("SELECT COUNT(*) AS c FROM admin_user").get().c;
    const inviteActive = db.prepare(`
      SELECT COUNT(*) AS c FROM admin_invite
      WHERE used_at IS NULL AND datetime(expires_at) > datetime('now')
    `).get().c;

    const onlineNow = db.prepare(`
      SELECT COUNT(*) AS devices, COUNT(DISTINCT user_cookie) AS users
      FROM telemetry_presence
      WHERE datetime(last_seen_at) > datetime('now', '-5 minutes')
    `).get();

    const activityRange = (sinceExpr) => db.prepare(`
      SELECT COUNT(DISTINCT anon_id) AS devices, COUNT(DISTINCT user_cookie) AS users
      FROM telemetry_ping
      WHERE day >= ${sinceExpr} AND kind = 'app_open'
    `).get();

    const todayStats = db.prepare(`
      SELECT COUNT(DISTINCT anon_id) AS devices, COUNT(DISTINCT user_cookie) AS users
      FROM telemetry_ping
      WHERE day = ? AND kind = 'app_open'
    `).get(today);

    const active7d = activityRange("date('now', '-6 days')");
    const active30d = activityRange("date('now', '-29 days')");

    const dauSeries = db.prepare(`
      WITH RECURSIVE days(d) AS (
        SELECT date('now', '-13 days')
        UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
      )
      SELECT days.d AS day,
             (SELECT COUNT(DISTINCT anon_id)    FROM telemetry_ping
              WHERE day = days.d AND kind = 'app_open') AS devices,
             (SELECT COUNT(DISTINCT user_cookie) FROM telemetry_ping
              WHERE day = days.d AND kind = 'app_open') AS users
      FROM days ORDER BY days.d ASC
    `).all();

    const standaloneRateRow = db.prepare(`
      SELECT
        CASE WHEN COUNT(*) = 0 THEN 0.0
             ELSE ROUND(AVG(CASE WHEN standalone = 1 THEN 1.0 ELSE 0.0 END), 3)
        END AS rate,
        COUNT(*) AS total
      FROM telemetry_ping
      WHERE day >= date('now', '-6 days') AND kind = 'app_open'
    `).get();

    const tabUsage = db.prepare(`
      SELECT kind,
             COUNT(DISTINCT anon_id)     AS devices,
             COUNT(DISTINCT user_cookie) AS users
      FROM telemetry_ping
      WHERE day >= date('now', '-29 days') AND kind LIKE 'tab:%'
      GROUP BY kind
      ORDER BY users DESC, devices DESC
    `).all().map((r) => ({ kind: r.kind, users: r.users, devices: r.devices }));

    const topRsvp = db.prepare(`
      SELECT e.id, e.title, e.starts_at,
             SUM(CASE WHEN r.status = 'going' THEN 1 ELSE 0 END) AS going,
             SUM(CASE WHEN r.status = 'maybe' THEN 1 ELSE 0 END) AS maybe,
             SUM(CASE WHEN r.status = 'not_going' THEN 1 ELSE 0 END) AS not_going,
             COUNT(*) AS total
      FROM event_rsvp r
      JOIN events e ON e.id = r.event_id
      WHERE datetime(e.ends_at) >= datetime('now')
      GROUP BY e.id, e.title, e.starts_at
      ORDER BY total DESC
      LIMIT 10
    `).all().map((r) => ({
      id: r.id, title: r.title, startsAt: r.starts_at,
      going: r.going, maybe: r.maybe, notGoing: r.not_going, total: r.total,
    }));

    const eventsBySource = Object.fromEntries(
      db.prepare("SELECT source, COUNT(*) AS c FROM events GROUP BY source").all().map((r) => [r.source, r.c]),
    );
    const eventsTotal = db.prepare("SELECT COUNT(*) AS c FROM events").get().c;
    const articlesTotal = db.prepare("SELECT COUNT(*) AS c FROM articles").get().c;

    const byTag = Object.fromEntries(
      db.prepare(`
        SELECT tag, COUNT(DISTINCT token) AS n FROM push_tag
        GROUP BY tag ORDER BY n DESC
      `).all().map((r) => [r.tag, r.n]),
    );

    const adminApplications = db.prepare(`
      SELECT COUNT(*) AS c FROM admin_application WHERE status = 'pending'
    `).get().c;

    res.json({
      devices: { pushSubscribers, rsvpTokens, adminAccounts, inviteActive, adminApplications },
      activity: {
        onlineNow:   { devices: onlineNow.devices ?? 0,   users: onlineNow.users ?? 0 },
        activeToday: { devices: todayStats.devices ?? 0,  users: todayStats.users ?? 0 },
        active7d:    { devices: active7d.devices ?? 0,    users: active7d.users ?? 0 },
        active30d:   { devices: active30d.devices ?? 0,   users: active30d.users ?? 0 },
        dauSeries,
        standaloneRate: standaloneRateRow.rate ?? 0,
        standaloneSample: standaloneRateRow.total ?? 0,
      },
      features: tabUsage,
      content: { eventsTotal, eventsBySource, articlesTotal, rsvpTotal, topRsvp },
      tags: { byTag },
      sync: {
        ics: { url: ICS_URL, intervalMs: ICS_INTERVAL_MS, lastSync: getLastIcsSync() },
        rss: { feeds: RSS_FEEDS, intervalMs: RSS_INTERVAL_MS, lastSync: getLastRssSync() },
      },
    });
  });

  // ── Admin applications: review queue for tier 3+ users who want to
  // become community admins. Approval is just a bookkeeping flag here —
  // the actual admin_user account still goes through admin_invite.
  app.get("/api/admin/applications", requireSuperadmin, (req, res) => {
    const status = req.query?.status ? String(req.query.status) : "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "bad status" });
    }
    const rows = db.prepare(`
      SELECT a.id, a.owner_id, a.display_name, a.cities_csv, a.message,
             a.tier_at_apply, a.status, a.applied_at, a.reviewed_at,
             a.reviewed_by, a.reject_reason,
             u.avatar, u.bio,
             COALESCE(t.tier, 1) AS current_tier
      FROM admin_application a
      LEFT JOIN chat_user u ON u.owner_id = a.owner_id
      LEFT JOIN user_tier t ON t.owner_id = a.owner_id
      WHERE a.status = ?
      ORDER BY a.applied_at ASC
    `).all(status);
    res.json({
      applications: rows.map((r) => ({
        id: r.id,
        ownerId: r.owner_id,
        displayName: r.display_name,
        avatar: r.avatar ?? null,
        bio: r.bio ?? null,
        citiesCsv: r.cities_csv,
        message: r.message ?? null,
        tierAtApply: r.tier_at_apply,
        currentTier: r.current_tier,
        status: r.status,
        appliedAt: r.applied_at,
        reviewedAt: r.reviewed_at ?? null,
        reviewedBy: r.reviewed_by ?? null,
        rejectReason: r.reject_reason ?? null,
      })),
    });
  });

  // ── Event proposals: tier 4+ chat users suggest events. Admins
  // (including non-superadmin city admins) review for their cities.
  app.get("/api/admin/event-proposals", requireAdmin, (req, res) => {
    const status = req.query?.status ? String(req.query.status) : "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "bad status" });
    }
    const rows = db.prepare(`
      SELECT p.*, u.avatar, COALESCE(t.tier, 1) AS current_tier
      FROM event_proposal p
      LEFT JOIN chat_user u ON u.owner_id = p.owner_id
      LEFT JOIN user_tier t ON t.owner_id = p.owner_id
      WHERE p.status = ?
      ORDER BY p.proposed_at ASC
    `).all(status);
    res.json({
      proposals: rows.map((r) => ({
        id: r.id,
        ownerId: r.owner_id,
        proposerName: r.proposer_name,
        avatar: r.avatar ?? null,
        currentTier: r.current_tier,
        title: r.title,
        description: r.description,
        location: r.location,
        url: r.url ?? null,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        citiesCsv: r.cities_csv,
        categoriesCsv: r.categories_csv,
        status: r.status,
        proposedAt: r.proposed_at,
        reviewedAt: r.reviewed_at ?? null,
        rejectReason: r.reject_reason ?? null,
        approvedEventId: r.approved_event_id ?? null,
      })),
    });
  });

  app.post("/api/admin/event-proposals/:id/review", requireAdmin, (req, res) => {
    const { decision, rejectReason } = req.body || {};
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approved|rejected" });
    }
    const p = db.prepare("SELECT * FROM event_proposal WHERE id = ?").get(req.params.id);
    if (!p) return res.status(404).json({ error: "not found" });
    if (p.status !== "pending") return res.status(409).json({ error: "already reviewed" });

    let approvedEventId = null;
    if (decision === "approved") {
      // Mint the events row from the proposal. Source = 'admin' so it
      // doesn't get clobbered by an ICS sync.
      approvedEventId = safeId("ev");
      db.prepare(`
        INSERT INTO events
          (id, title, description, location, url, starts_at, ends_at,
           cities_csv, categories_csv, organizer, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')
      `).run(
        approvedEventId, p.title, p.description, p.location, p.url,
        p.starts_at, p.ends_at, p.cities_csv, p.categories_csv, p.proposer_name,
      );
    }
    const reason = decision === "rejected" && typeof rejectReason === "string"
      ? rejectReason.trim().slice(0, 500)
      : null;
    db.prepare(`
      UPDATE event_proposal
      SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?,
          reject_reason = ?, approved_event_id = ?
      WHERE id = ?
    `).run(decision, req.admin?.id ?? null, reason, approvedEventId, req.params.id);
    res.json({ ok: true, approvedEventId });
  });

  app.post("/api/admin/applications/:id/review", requireSuperadmin, (req, res) => {
    const { decision, rejectReason } = req.body || {};
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approved|rejected" });
    }
    const row = db.prepare("SELECT id, status FROM admin_application WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.status !== "pending") return res.status(409).json({ error: "already reviewed" });
    const reason = decision === "rejected" && typeof rejectReason === "string"
      ? rejectReason.trim().slice(0, 500)
      : null;
    db.prepare(`
      UPDATE admin_application
      SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?, reject_reason = ?
      WHERE id = ?
    `).run(decision, req.admin?.id ?? null, reason, req.params.id);
    res.json({ ok: true });
  });
}
