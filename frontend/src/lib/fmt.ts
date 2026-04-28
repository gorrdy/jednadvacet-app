// Centralised date/time formatting for the whole app. Previously each tab
// reimplemented `MONTHS_CZ`, `WEEKDAYS_CZ`, `formatStart`, `formatRange`,
// `formatWhen`, etc. When we go multi-language this is the only file that
// needs to change.

export const MONTHS_CZ = [
  "led", "úno", "bře", "dub", "kvě", "čvn",
  "čvc", "srp", "zář", "říj", "lis", "pro",
] as const;

export const WEEKDAYS_CZ = ["ne", "po", "út", "st", "čt", "pá", "so"] as const;

const LOCALE = "cs-CZ";

/** Short weekday + month+day block used by the calendar event tile. */
export function formatEventDateBlock(iso: string): { month: string; day: string; weekday: string } {
  const d = new Date(iso);
  return {
    month: MONTHS_CZ[d.getMonth()],
    day: String(d.getDate()),
    weekday: WEEKDAYS_CZ[d.getDay()],
  };
}

/** Compact month+day for dashboards / mini cards. */
export function formatDayMonth(iso: string): { m: string; d: string } {
  const dt = new Date(iso);
  return { m: MONTHS_CZ[dt.getMonth()], d: String(dt.getDate()) };
}

export function formatTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateShort(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

export function formatDateLong(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleString(LOCALE);
}

/** Day of month label for short bar-chart ticks: "15 čvn". */
export function formatDayTick(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** "dnes · 19:00", "zítra · 08:00", "za 4 d · 19:00", "15 čvn · 19:00" — home feed. */
export function formatEventWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffDays = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const t = formatTime(d);
  if (diffDays < 0) return `před ${-diffDays} d · ${t}`;
  if (diffDays === 0) return `dnes · ${t}`;
  if (diffDays === 1) return `zítra · ${t}`;
  if (diffDays < 7) return `za ${diffDays} d · ${t}`;
  if (diffDays < 14) return `za týden · ${t}`;
  return `${formatDateShort(d)} · ${t}`;
}

/** "19:00 – 21:00" if same day, otherwise "15 čvn – 17 čvn". */
export function formatEventRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  if (sameDay) return `${formatTime(s)} – ${formatTime(e)}`;
  return `${formatDateShort(s)} – ${formatDateShort(e)}`;
}

/** Relative-time for logs/telemetry: "teď" · "před 12 min" · "před 3 h" · "před 2 dny". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return "teď";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} ${d === 1 ? "dnem" : "dny"}`;
}

/** Detect if the app is running as a standalone PWA. Used by telemetry and
 * Profile (both previously had their own copy). */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}
