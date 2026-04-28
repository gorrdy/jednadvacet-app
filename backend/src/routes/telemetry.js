// Anonymous telemetry endpoints + the public stats they feed
// (community totals, online-now count). All public reads are cached in
// memory because the underlying queries scan whole tables.

import { db } from "../db.js";

const TELEMETRY_KIND_RE = /^(app_open|heartbeat|tab:[a-z]{1,20})$/;

export function mountTelemetryRoutes(app) {
  // ── Telemetry ping (anonymous) ────────────────────────────
  app.post("/api/telemetry/ping", (req, res) => {
    const anonId = String(req.body?.anonId ?? "").trim();
    const rawCookie = req.body?.userCookie ? String(req.body.userCookie).trim() : "";
    const userCookie = rawCookie.length >= 16 && rawCookie.length <= 128 ? rawCookie : null;
    const kind = String(req.body?.kind ?? "");
    const standalone = req.body?.standalone ? 1 : 0;
    if (!anonId || anonId.length < 16 || anonId.length > 128) return res.json({ ok: true });
    if (!TELEMETRY_KIND_RE.test(kind)) return res.json({ ok: true });

    const day = new Date().toISOString().slice(0, 10);
    try {
      db.prepare(`
        INSERT INTO telemetry_ping (day, kind, anon_id, user_cookie, standalone)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(day, kind, anon_id) DO UPDATE SET
          user_cookie = COALESCE(telemetry_ping.user_cookie, excluded.user_cookie),
          standalone = excluded.standalone
      `).run(day, kind, anonId, userCookie, standalone);

      db.prepare(`
        INSERT INTO telemetry_presence (anon_id, user_cookie, last_seen_at, standalone)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(anon_id) DO UPDATE SET
          user_cookie  = COALESCE(excluded.user_cookie, telemetry_presence.user_cookie),
          last_seen_at = datetime('now'),
          standalone   = excluded.standalone
      `).run(anonId, userCookie, standalone);
    } catch (e) {
      console.error("[telemetry/ping]", e.message);
    }
    res.json({ ok: true });
  });

  // ── Community stats ────────────────────────────────────────
  // Public counts: tier distribution + top organizers. Cached 5 min
  // because both queries scan the whole user_tier table.
  let statsCache = { value: null, expires: 0 };
  app.get("/api/stats/community", (_req, res) => {
    const now = Date.now();
    if (statsCache.value && now < statsCache.expires) {
      return res.json({ ...statsCache.value, cached: true });
    }
    // Tier distribution. Users with chat profile but no user_tier row
    // count as tier 1 — that's how we render them in chat too.
    const dist = db.prepare(`
      SELECT COALESCE(t.tier, 1) AS tier, COUNT(u.owner_id) AS c
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      GROUP BY COALESCE(t.tier, 1)
      ORDER BY tier ASC
    `).all();
    const totalUsers = dist.reduce((sum, r) => sum + Number(r.c), 0);
    // Top organizers: tier 4+ users who match events.organizer string.
    // events.organizer is a free-text field (admin-typed); a strict match
    // on display_name is best-effort but reasonable.
    const topOrganizers = db.prepare(`
      SELECT u.display_name, u.avatar, t.tier, COUNT(e.id) AS event_count
      FROM chat_user u
      JOIN user_tier t ON t.owner_id = u.owner_id AND t.tier >= 4
      LEFT JOIN events e ON e.organizer = u.display_name
      GROUP BY u.owner_id
      HAVING event_count > 0
      ORDER BY event_count DESC, t.tier DESC
      LIMIT 5
    `).all();
    const value = {
      tierDistribution: dist.map((r) => ({ tier: Number(r.tier), count: Number(r.c) })),
      totalUsers,
      topOrganizers: topOrganizers.map((r) => ({
        displayName: r.display_name,
        avatar: r.avatar ?? null,
        tier: Number(r.tier),
        eventCount: Number(r.event_count),
      })),
    };
    statsCache = { value, expires: now + 5 * 60 * 1000 };
    res.json(value);
  });

  // ── Public live stats ───────────────────────────────────────
  // Online-now count exposed publicly so the topbar can show "X online".
  // Cached in memory for 60s — telemetry_presence updates often and we
  // don't want every page render to hit COUNT DISTINCT.
  let onlineCache = { value: 0, expires: 0 };
  app.get("/api/stats/online", (_req, res) => {
    const now = Date.now();
    if (now < onlineCache.expires) {
      return res.json({ users: onlineCache.value, cached: true });
    }
    const row = db.prepare(`
      SELECT COUNT(DISTINCT user_cookie) AS users
      FROM telemetry_presence
      WHERE datetime(last_seen_at) > datetime('now', '-5 minutes')
        AND user_cookie IS NOT NULL
    `).get();
    const users = Number(row?.users ?? 0);
    onlineCache = { value: users, expires: now + 60_000 };
    res.json({ users });
  });
}
