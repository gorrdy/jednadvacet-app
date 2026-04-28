// Centralised environment loading + constants. Everything that used to be
// a top-level `const FOO = process.env.FOO || ...` in server.js lives here,
// so each module imports only what it needs instead of depending on the
// entry file's closure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

export const ROOT_DIR = ROOT;

export const PORT = Number(process.env.PORT || 3021);
export const HOST = process.env.HOST || "127.0.0.1";

export const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || "";
export const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "";
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

export const DB_PATH = process.env.DB_PATH || path.join(ROOT, "db.sqlite3");

// Optional: a public iCalendar URL to ingest events from. Leave unset to
// disable ICS sync entirely. Example (Google Calendar public ICS):
//   ICS_URL=https://calendar.google.com/calendar/ical/<id>/public/basic.ics
export const ICS_URL = process.env.ICS_URL || "";
export const ICS_INTERVAL_MS = Number(process.env.ICS_INTERVAL_MS || 15 * 60 * 1000);

// Curated RSS feeds aggregated into the Novinky tab. Override via the
// RSS_FEEDS env var as a comma-separated list of `name|url` pairs:
//   RSS_FEEDS="KryptoHodler|https://kryptohodler.cz/feed/,No BS Bitcoin|https://nobsbitcoin.com/rss/"
// Each feed is fetched independently; one failing source doesn't kill the
// rest. We deliberately don't pull jednadvacet.org — the app is a separate
// news aggregator, not a republisher of our own site.
const DEFAULT_RSS_FEEDS = [
  { name: "KryptoHodler", url: "https://kryptohodler.cz/feed/" },
  { name: "BTCTip",       url: "https://btctip.cz/feed/" },
];
function parseRssFeeds(env) {
  if (!env) return DEFAULT_RSS_FEEDS;
  const out = [];
  for (const part of env.split(",")) {
    const [name, url] = part.split("|").map((s) => (s ?? "").trim());
    if (name && url) out.push({ name, url });
  }
  return out.length > 0 ? out : DEFAULT_RSS_FEEDS;
}
export const RSS_FEEDS = parseRssFeeds(process.env.RSS_FEEDS);
export const RSS_INTERVAL_MS = Number(process.env.RSS_INTERVAL_MS || 15 * 60 * 1000);

export const SUPERADMIN_EMAIL    = (process.env.SUPERADMIN_EMAIL || "").toLowerCase().trim();
export const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "";

export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
export const INVITE_TTL_DAYS  = Number(process.env.INVITE_TTL_DAYS  || 14);

// Min interval mezi postupy v tier systému (default 7 dní). Snížíme na
// staging přes TIER_COOLDOWN_MS=60000 v `.env.staging` ať testování není
// blokované týdenním čekáním.
export const TIER_COOLDOWN_MS = Number(process.env.TIER_COOLDOWN_MS || 7 * 24 * 60 * 60 * 1000);

// Daily "tomorrow's events" reminder. Fires once per Prague-local day at
// REMINDER_HOUR (0–23). Set REMINDER_HOUR="" to disable.
export const REMINDER_HOUR = process.env.REMINDER_HOUR === ""
  ? null
  : Number(process.env.REMINDER_HOUR ?? 18);
export const REMINDER_TZ = process.env.REMINDER_TZ || "Europe/Prague";

export const FRONTEND_DIST = process.env.FRONTEND_DIST ?? path.join(ROOT, "..", "frontend", "dist");
