// Anonymous telemetry — rotating daily ID, no IP, no ties to push/rsvp/Evolu.
// Goal: give the superadmin DAU/MAU/online/tab-usage visibility without
// identifying anyone. The id resets at UTC midnight so the backend can't
// correlate activity across days.

import { LS } from "./storageKeys";

const LS_KEY = LS.AnonId;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateId(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return b64url(b);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Stored {
  id: string;
  day: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (!v?.id || !v?.day) return null;
    return v;
  } catch {
    return null;
  }
}

function writeStored(s: Stored) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function getOrRotateAnonId(): string {
  const today = utcDay();
  const existing = readStored();
  if (existing && existing.day === today) return existing.id;
  const next: Stored = { id: generateId(), day: today };
  writeStored(next);
  return next.id;
}

import { isStandalonePwa } from "./fmt";
import { API_BASE } from "./http";

// User cookie (C mode): daily-rotating, Evolu-synced identifier that lets
// the dashboard count unique users across devices. Pushed in from App
// once Evolu has loaded it — may be null for the first pings on cold
// start, which is fine: the backend backfills on subsequent pings.
let currentUserCookie: string | null = null;
export function setTelemetryUserCookie(c: string | null): void {
  currentUserCookie = c;
}

async function send(kind: string): Promise<void> {
  const anonId = getOrRotateAnonId();
  try {
    await fetch(`${API_BASE}/api/telemetry/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anonId,
        kind,
        standalone: isStandalonePwa(),
        ...(currentUserCookie ? { userCookie: currentUserCookie } : {}),
      }),
      credentials: "omit",
      keepalive: true,
    });
  } catch {
    /* silent */
  }
}

const recentlySent = new Set<string>();
const dedupeMs = 5 * 60 * 1000; // throttle repeat of same kind in same 5min window

function throttled(kind: string, fn: () => void) {
  if (recentlySent.has(kind)) return;
  recentlySent.add(kind);
  fn();
  setTimeout(() => recentlySent.delete(kind), dedupeMs);
}

export function pingAppOpen(): void {
  throttled("app_open", () => void send("app_open"));
}

export function pingTab(tab: string): void {
  const kind = `tab:${tab}`;
  throttled(kind, () => void send(kind));
}

let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (heartbeatHandle) return;
  // Fire once immediately so "online now" lights up without delay.
  void send("heartbeat");
  heartbeatHandle = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void send("heartbeat");
  }, 60_000);
}

export function stopHeartbeat(): void {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
}
