// ICS + RSS sync runners and their schedulers. The last-sync result is kept
// here as module-scoped state so the admin dashboard can read it (via the
// getters) without reaching into server.js.

import { syncIcs } from "../sync-ics.js";
import { syncArticles } from "../sync-articles.js";
import { db } from "./db.js";
import { ICS_URL, ICS_INTERVAL_MS, RSS_FEEDS, RSS_INTERVAL_MS } from "./config.js";

let lastIcsSync = null;
let lastRssSync = null;
let icsRunning = false;
let rssRunning = false;

export const getLastIcsSync = () => lastIcsSync;
export const getLastRssSync = () => lastRssSync;

export async function runIcsSync() {
  if (icsRunning) return { ok: false, error: "sync already running" };
  if (!ICS_URL) return { ok: false, error: "ICS_URL not configured" };
  icsRunning = true;
  const started = Date.now();
  try {
    const r = await syncIcs({ db, url: ICS_URL });
    lastIcsSync = { ...r, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started };
    return lastIcsSync;
  } catch (e) {
    lastIcsSync = { ok: false, error: e.message, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started };
    console.error("[ics] error:", e);
    return lastIcsSync;
  } finally {
    icsRunning = false;
  }
}

export async function runRssSync() {
  if (rssRunning) return { ok: false, error: "sync already running" };
  if (!RSS_FEEDS || RSS_FEEDS.length === 0) return { ok: false, error: "no RSS feeds configured" };
  rssRunning = true;
  const started = Date.now();
  try {
    const r = await syncArticles({ db, feeds: RSS_FEEDS });
    if (r.ok && r.total > 0) {
      const del = db.prepare("DELETE FROM articles WHERE source = 'seed'").run();
      if (del.changes > 0) console.log(`[rss] cleared ${del.changes} placeholder articles`);
    }
    lastRssSync = { ...r, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started };
    return lastRssSync;
  } catch (e) {
    lastRssSync = { ok: false, error: e.message, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started };
    console.error("[rss] error:", e);
    return lastRssSync;
  } finally {
    rssRunning = false;
  }
}

export function startSchedulers() {
  if (ICS_URL) {
    setTimeout(() => { runIcsSync(); }, 2_000);
    setInterval(() => { runIcsSync(); }, ICS_INTERVAL_MS);
    console.log(`[ics] scheduled every ${Math.round(ICS_INTERVAL_MS / 1000)}s from ${ICS_URL.slice(0, 80)}…`);
  }
  if (RSS_FEEDS && RSS_FEEDS.length > 0) {
    setTimeout(() => { runRssSync(); }, 3_500);
    setInterval(() => { runRssSync(); }, RSS_INTERVAL_MS);
    console.log(`[rss] scheduled every ${Math.round(RSS_INTERVAL_MS / 1000)}s across ${RSS_FEEDS.length} feed(s): ${RSS_FEEDS.map((f) => f.name).join(", ")}`);
  }
}
