// Events-related public endpoints: anonymous RSVP write/delete,
// per-event attendee list, the windowed `my-event-chats` listing the
// chat sidebar uses, and the tier-4+ event-proposal flow.
//
// Lives apart from the basic /api/events listing in routes/public.js
// because that one is a thin SELECT * with no domain logic; everything
// here touches event_rsvp / event_proposal and benefits from being
// grouped.

import { db } from "../db.js";
import { safeId, validOwnerId, validOpaqueToken } from "../helpers.js";
import { CITIES } from "../../cities.js";
import {
  EVENT_CHAT_ARCHIVE_DAYS,
  EVENT_CHAT_LOOKAHEAD_DAYS,
} from "../../../shared/constants.js";

const RSVP_STATUSES = new Set(["going", "maybe", "not_going"]);
const VALID_CITY_SLUGS = new Set(CITIES.map((c) => c.slug));

export function mountEventRoutes(app) {
  // ── RSVP: anonymous ─────────────────────────────────────────
  app.post("/api/rsvp", (req, res) => {
    const { token, eventId, status, ownerId } = req.body || {};
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128) {
      return res.status(400).json({ error: "bad eventId" });
    }
    if (!RSVP_STATUSES.has(status)) return res.status(400).json({ error: "bad status" });
    // ownerId is optional. Only accept it if the user actually has a
    // chat_user row for that owner — otherwise we'd let anyone claim
    // any owner_id. Falsy or unrecognised → store as NULL (anonymous).
    let resolvedOwner = null;
    if (typeof ownerId === "string" && validOwnerId(ownerId)) {
      const userRow = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(ownerId);
      if (userRow) resolvedOwner = ownerId;
    }

    const ev = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
    if (!ev) return res.status(404).json({ error: "unknown event" });

    try {
      db.prepare(`
        INSERT INTO event_rsvp (token, event_id, status, owner_id, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(token, event_id) DO UPDATE SET
          status = excluded.status,
          owner_id = excluded.owner_id,
          updated_at = datetime('now')
      `).run(token, eventId, status, resolvedOwner);
    } catch (e) {
      console.error("[rsvp]", e.message);
      return res.status(500).json({ error: "rsvp failed" });
    }
    res.json({ ok: true });
  });

  // Per-event attendee list. Returns named "going" attendees joined with
  // chat_user (so display name + avatar are server-side, not exposed
  // anonymous tokens), plus the count of anonymous-token attendees.
  app.get("/api/events/:eventId/attendees", (req, res) => {
    const eventId = req.params.eventId;
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128) {
      return res.status(400).json({ error: "bad eventId" });
    }
    const ev = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
    if (!ev) return res.status(404).json({ error: "unknown event" });
    const named = db.prepare(`
      SELECT u.owner_id, u.display_name, u.avatar, COALESCE(t.tier, 1) AS tier
      FROM event_rsvp r
      JOIN chat_user u ON u.owner_id = r.owner_id
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE r.event_id = ? AND r.status = 'going' AND r.owner_id IS NOT NULL
      ORDER BY t.tier DESC, u.display_name ASC
    `).all(eventId);
    const anonRow = db.prepare(`
      SELECT COUNT(*) AS c FROM event_rsvp
      WHERE event_id = ? AND status = 'going' AND owner_id IS NULL
    `).get(eventId);
    const maybeRow = db.prepare(`
      SELECT COUNT(*) AS c FROM event_rsvp
      WHERE event_id = ? AND status = 'maybe'
    `).get(eventId);
    res.json({
      named: named.map((r) => ({
        ownerId: r.owner_id,
        displayName: r.display_name,
        avatar: r.avatar ?? null,
        tier: r.tier ?? 1,
      })),
      anonCount: anonRow?.c ?? 0,
      maybeCount: maybeRow?.c ?? 0,
      total: named.length + (anonRow?.c ?? 0),
    });
  });

  app.delete("/api/rsvp", (req, res) => {
    const token = req.body?.token ?? req.query?.token;
    const eventId = req.body?.eventId ?? req.query?.eventId;
    if (!validOpaqueToken(token)) return res.status(400).json({ error: "bad token" });
    if (typeof eventId !== "string" || eventId.length === 0) return res.status(400).json({ error: "bad eventId" });
    db.prepare("DELETE FROM event_rsvp WHERE token = ? AND event_id = ?").run(token, eventId);
    res.json({ ok: true });
  });

  // ── Per-event chat threads (windowed listing) ─────────────────
  // For each event the user has RSVP'd "going" / "maybe" to AND that
  // either starts within the next 5 days or ended within the last 7
  // days, surface an `event:<id>` channel in the sidebar. Past the
  // archive window, event chats drop from the listing (the chat is
  // still readable via deep link but writes are blocked — see
  // canAccessChannel in routes/public.js).
  app.get("/api/chat/my-event-chats", (req, res) => {
    const ownerId = req.query?.ownerId ? String(req.query.ownerId) : null;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });

    const now = new Date();
    const forwardWindowEnd = new Date(now.getTime() + EVENT_CHAT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const backwardWindowStart = new Date(now.getTime() - EVENT_CHAT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);

    // event_rsvp PRIMARY KEY is (token, event_id), so a user signed in on
    // 3 devices has 3 RSVP rows per event — without GROUP BY the JOIN
    // returns the event once per device. Group by event id to dedupe.
    const rows = db.prepare(`
      SELECT e.id, e.title, e.starts_at, e.ends_at
      FROM events e
      JOIN event_rsvp r ON r.event_id = e.id
      WHERE r.owner_id = ?
        AND r.status IN ('going','maybe')
        AND datetime(e.ends_at) >= datetime(?)
        AND datetime(e.starts_at) <= datetime(?)
      GROUP BY e.id
      ORDER BY datetime(e.starts_at) ASC
    `).all(ownerId, backwardWindowStart.toISOString(), forwardWindowEnd.toISOString());

    res.json({
      chats: rows.map((r) => ({
        eventId: r.id,
        slug: `event:${r.id}`,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      })),
    });
  });

  // ── Tier 4+ event proposals ──────────────────────────────────
  // Tier 4+ users propose events for admin moderation. Approved
  // proposals create an `events` row via the superadmin review flow.
  app.post("/api/events/propose", (req, res) => {
    const { ownerId, title, description, location, url, startsAt, endsAt, citiesCsv, categoriesCsv } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: "title 3-200 chars" });
    }
    if (typeof location !== "string" || location.trim().length < 2 || location.trim().length > 200) {
      return res.status(400).json({ error: "location required" });
    }
    if (typeof startsAt !== "string" || typeof endsAt !== "string") {
      return res.status(400).json({ error: "starts/ends required" });
    }
    if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) {
      return res.status(400).json({ error: "bad date" });
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return res.status(400).json({ error: "endsAt must be after startsAt" });
    }
    if (Date.parse(startsAt) < Date.now() - 60 * 60 * 1000) {
      return res.status(400).json({ error: "starts in the past" });
    }
    const desc = typeof description === "string" ? description.trim().slice(0, 5000) : "";
    const u = typeof url === "string" ? url.trim().slice(0, 500) : "";
    const cities = typeof citiesCsv === "string"
      ? citiesCsv.split(",").map((s) => s.trim()).filter(Boolean).filter((c) => VALID_CITY_SLUGS.has(c))
      : [];
    const categories = typeof categoriesCsv === "string"
      ? categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : [];

    const userRow = db.prepare(`
      SELECT u.display_name, COALESCE(t.tier, 1) AS tier
      FROM chat_user u
      LEFT JOIN user_tier t ON t.owner_id = u.owner_id
      WHERE u.owner_id = ?
    `).get(ownerId);
    if (!userRow) return res.status(404).json({ error: "no chat profile" });
    if (userRow.tier < 4) return res.status(403).json({ error: "tier 4+ required" });

    const id = safeId("eprop");
    db.prepare(`
      INSERT INTO event_proposal
        (id, owner_id, proposer_name, title, description, location, url,
         starts_at, ends_at, cities_csv, categories_csv, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id, ownerId, userRow.display_name, title.trim(), desc, location.trim(),
      u || null, startsAt, endsAt, cities.join(","), categories.join(","),
    );
    res.json({ ok: true, id });
  });

  app.get("/api/events/proposals/:ownerId", (req, res) => {
    const ownerId = req.params.ownerId;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const rows = db.prepare(`
      SELECT id, title, location, starts_at, status, proposed_at, reviewed_at, reject_reason
      FROM event_proposal
      WHERE owner_id = ?
      ORDER BY proposed_at DESC
      LIMIT 20
    `).all(ownerId);
    res.json({
      proposals: rows.map((r) => ({
        id: r.id,
        title: r.title,
        location: r.location,
        startsAt: r.starts_at,
        status: r.status,
        proposedAt: r.proposed_at,
        reviewedAt: r.reviewed_at ?? null,
        rejectReason: r.reject_reason ?? null,
      })),
    });
  });
}
