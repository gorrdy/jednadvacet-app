// "Zítra se koná …" push reminder. Runs once per Prague-local day at
// REMINDER_HOUR, groups tomorrow's events by city, sends a push to each
// city:<slug> tag cohort. Dedup via reminder_sent(day, city) so restarts
// around trigger time can't double-send.

import webpush from "web-push";
import { db } from "./db.js";
import { REMINDER_HOUR, REMINDER_TZ, VAPID_PUBLIC, VAPID_PRIVATE } from "./config.js";
import { asEvent, splitCsv } from "./helpers.js";
import { CITIES } from "../cities.js";
import { buildCityTag } from "../../shared/pushTags.js";
import { pruneStalePushTokens } from "./push.js";

const CITY_NAME = new Map(CITIES.map((c) => [c.slug, c.name]));
const cityLabel = (slug) => CITY_NAME.get(slug) ?? slug;

/** Format "HH:MM" in Europe/Prague for a given ISO timestamp. */
function pragueTime(iso) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: REMINDER_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Return the Prague-local YYYY-MM-DD for `date`. */
function pragueDateKey(date) {
  // Intl returns "04. 05. 2026" by default; use en-CA which formats ISO.
  return new Intl.DateTimeFormat("en-CA", { timeZone: REMINDER_TZ }).format(date);
}

/** Current hour 0–23 in Europe/Prague. */
function pragueHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: REMINDER_TZ,
    hour: "numeric",
    hour12: false,
  }).format(date));
}

/** Window [startIso, endIso) for tomorrow's events in Prague local time. */
function tomorrowWindow(now = new Date()) {
  // Get today's Prague date, then compute the UTC instant at Prague midnight
  // of (today+1) and (today+2). The pragueDateKey drift trick keeps us away
  // from DST edge cases.
  const todayKey = pragueDateKey(now);
  // Parse YYYY-MM-DD as a naive date, step +1 and +2 days, format each at
  // 00:00 Prague local and convert that to UTC.
  const [y, m, d] = todayKey.split("-").map(Number);
  // Build Prague midnight for a given Y-M-D by making a Date at UTC for that
  // Y-M-D and then shifting by Prague's offset. Easiest: use Date.UTC and
  // adjust with the Intl formatter output. But for a pragmatic window we can
  // just use a wider range and filter in SQL — cheaper:
  const startLocal = `${y}-${String(m).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}T00:00:00`;
  const endLocal   = `${y}-${String(m).padStart(2, "0")}-${String(d + 2).padStart(2, "0")}T00:00:00`;
  // Treat as UTC — ICS events store UTC ISO strings, so comparing against
  // Prague-midnight-as-UTC is a ~1h approximation (CET/CEST). Good enough
  // for a "tomorrow" feed — we'll query with 90-minute slack on both ends.
  return { startLocal, endLocal };
}

/** Core: send reminders for events that start tomorrow (Prague). */
export async function sendTomorrowReminders() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return { ok: false, error: "VAPID not configured" };
  }

  const now = new Date();
  const today = pragueDateKey(now);
  // tomorrow key = today + 1 day
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrowKey = pragueDateKey(tomorrow);

  // Pull all events whose start falls on tomorrow's Prague-local date. We
  // fetch a wide UTC window (± 2h around naive midnight) and filter by the
  // formatted Prague date to be DST-safe.
  const windowStart = new Date(Date.UTC(y, m - 1, d, 22, 0, 0)).toISOString();
  const windowEnd   = new Date(Date.UTC(y, m - 1, d + 2, 2, 0, 0)).toISOString();
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE starts_at >= ? AND starts_at < ?
    ORDER BY starts_at ASC
  `).all(windowStart, windowEnd);

  const events = rows
    .map((r) => ({ raw: r, parsed: asEvent(r), dayKey: pragueDateKey(new Date(r.starts_at)) }))
    .filter((e) => e.dayKey === tomorrowKey);

  // Group by city slug.
  const byCity = new Map();
  for (const e of events) {
    for (const city of splitCsv(e.raw.cities_csv)) {
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(e.parsed);
    }
  }

  const result = { day: tomorrowKey, cities: [], sent: 0, skipped: 0 };

  for (const [city, evs] of byCity) {
    // Dedup: if we already fired for this (day, city), skip.
    const already = db.prepare(
      "SELECT 1 FROM reminder_sent WHERE day = ? AND city = ?"
    ).get(tomorrowKey, city);
    if (already) {
      result.skipped++;
      continue;
    }

    const tag = buildCityTag(city);
    const subs = db.prepare(`
      SELECT DISTINCT s.token, s.endpoint, s.p256dh, s.auth
      FROM push_sub s
      JOIN push_tag t ON t.token = s.token
      WHERE t.tag = ?
    `).all(tag);

    // Compose the notification.
    const count = evs.length;
    const prefix = city === "online" ? "Zítra online" : `Zítra v ${cityLabel(city)}`;
    const title = count === 1
      ? `${prefix}: ${evs[0].title}`
      : `${prefix}: ${count} ${count >= 2 && count <= 4 ? "akce" : "akcí"}`;
    const body = evs
      .slice(0, 3)
      .map((e) => `${pragueTime(e.startsAt)} · ${e.title}`)
      .join("\n") + (evs.length > 3 ? `\n+ ${evs.length - 3} další` : "");

    const payload = JSON.stringify({
      title,
      body,
      url: "/",
      tag: `jednadvacet-reminder-${tomorrowKey}-${city}`,
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

    db.prepare(`
      INSERT OR REPLACE INTO reminder_sent (day, city, events, sent)
      VALUES (?, ?, ?, ?)
    `).run(tomorrowKey, city, count, sent);

    result.cities.push({ city, events: count, subs: subs.length, sent, failed });
    result.sent += sent;
  }

  console.log(`[reminder] ${tomorrowKey} sent=${result.sent} cities=${result.cities.length} skipped=${result.skipped}`);
  return { ok: true, ...result };
}

/**
 * Dry-run view of the next daily reminder: which channels would fire,
 * which events they'd announce, how many recipients (and their opaque
 * tokens for the admin "to whom" view). No side effects — just reads.
 */
export function previewTomorrowReminders() {
  const now = new Date();
  const today = pragueDateKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrowKey = pragueDateKey(tomorrow);

  const windowStart = new Date(Date.UTC(y, m - 1, d, 22, 0, 0)).toISOString();
  const windowEnd   = new Date(Date.UTC(y, m - 1, d + 2, 2, 0, 0)).toISOString();
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE starts_at >= ? AND starts_at < ?
    ORDER BY starts_at ASC
  `).all(windowStart, windowEnd);

  const events = rows
    .map((r) => ({ raw: r, dayKey: pragueDateKey(new Date(r.starts_at)) }))
    .filter((e) => e.dayKey === tomorrowKey);

  const byCity = new Map();
  for (const e of events) {
    for (const city of splitCsv(e.raw.cities_csv)) {
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(asEvent(e.raw));
    }
  }

  // When will the next cron tick happen? Next REMINDER_HOUR in Prague.
  const nextFire = (() => {
    if (REMINDER_HOUR == null) return null;
    const nowMs = now.getTime();
    // Try today's trigger hour first (Prague local), then tomorrow's.
    for (let offsetDays = 0; offsetDays <= 1; offsetDays++) {
      const cand = new Date(Date.UTC(y, m - 1, d + offsetDays, REMINDER_HOUR, 0, 0));
      // We built it in UTC; correct by Prague's offset so it's actually
      // REMINDER_HOUR local. Two-step: format → parse back.
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: REMINDER_TZ, hour: "numeric", hour12: false,
      }).formatToParts(cand);
      const utcHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const adjust = (REMINDER_HOUR - utcHour + 24) % 24;
      const fire = new Date(cand.getTime() + adjust * 3600_000);
      if (fire.getTime() > nowMs) return fire.toISOString();
    }
    return null;
  })();

  const channels = [];
  for (const [city, evs] of byCity) {
    const tag = buildCityTag(city);
    const subs = db.prepare(`
      SELECT s.token, s.endpoint
      FROM push_sub s JOIN push_tag t ON t.token = s.token
      WHERE t.tag = ?
    `).all(tag);

    const already = db.prepare(
      "SELECT sent_at, sent FROM reminder_sent WHERE day = ? AND city = ?",
    ).get(tomorrowKey, city);

    channels.push({
      slug: city,
      cityName: cityLabel(city),
      tag,
      alreadySent: !!already,
      alreadySentAt: already?.sent_at ?? null,
      alreadySentCount: already?.sent ?? 0,
      events: evs.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        location: e.location,
      })),
      recipients: subs.map((s) => ({
        // Short handle so the admin can tell rows apart without revealing
        // full token. Full token would be needless leak even in admin UI.
        tokenSuffix: s.token.slice(-10),
        endpointHost: safeHost(s.endpoint),
      })),
      recipientCount: subs.length,
    });
  }

  return {
    day: tomorrowKey,
    nextFireAt: nextFire,
    reminderHour: REMINDER_HOUR,
    timezone: REMINDER_TZ,
    channels,
  };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return "?"; }
}

let lastCheckHour = -1;

/** Runs in the main scheduler loop. Called ~every 10 min — cheap. */
export async function maybeFireReminder() {
  if (REMINDER_HOUR == null) return;
  const h = pragueHour();
  if (h !== REMINDER_HOUR) { lastCheckHour = h; return; }
  if (lastCheckHour === h) return; // already fired (or tried) this hour
  lastCheckHour = h;
  try {
    await sendTomorrowReminders();
  } catch (e) {
    console.error("[reminder]", e.message);
  }
}

export function startReminderScheduler() {
  if (REMINDER_HOUR == null) {
    console.log("[reminder] disabled (REMINDER_HOUR is empty)");
    return;
  }
  // Check every 10 min — cheap, and covers the case of the process being
  // restarted right around the trigger hour. Dedup table prevents double
  // sends.
  setInterval(() => { void maybeFireReminder(); }, 10 * 60 * 1000);
  // Also fire shortly after boot so a restart at e.g. 18:03 still catches
  // the day.
  setTimeout(() => { void maybeFireReminder(); }, 20_000);
  console.log(`[reminder] scheduled: daily ${REMINDER_HOUR}:00 ${REMINDER_TZ}`);
}
