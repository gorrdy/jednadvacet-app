// Single source of truth for browser-storage keys used across the app.
// Each entry was previously declared inline in its consuming file (or, in
// a few cases, twice in two different files), making it impossible to
// audit at a glance, harder to grep for, and easy to drift on a rename.
//
// Naming convention: every key starts with `jednadvacet-` so it's easy to
// spot in DevTools and easy to wipe selectively if we ever need a "log
// out" or "clear all local state" affordance.
//
// Exporting both an `LS` (localStorage, persistent) and `SS` (sessionStorage,
// per-tab-session) namespace so the call site declares scope at the import.

export const LS = {
  /** Has the user clicked through the welcome screen? */
  SeenWelcome: "jednadvacet-seen-welcome",
  /** Persisted active bottom-nav tab — restored on app open. */
  ActiveTab: "jednadvacet-active-tab",
  /** Anonymous tab-instance id used for telemetry pings. */
  AnonId: "jednadvacet-anon-id",

  // ── Chat / DM ────────────────────────────────────────────────────
  /** Server-issued chat session token (resolves a stable owner_id ↔ token map). */
  ChatToken: "jednadvacet-chat-token",
  /** User's per-device opt-in flag for push notifications on chat messages. */
  ChatPush: "jednadvacet-chat-push",
  /** LEGACY: per-channel last-read timestamps. Now stored in Evolu chatRead.
   *  Kept here only so evoluMigrations can find and drain old entries. */
  ChatReadPrefix: "jednadvacet-chat-read-",
  /** Per-section collapse state in the Chat tab sidebar, JSON-serialised.
   *  Per-device by design — desktop user might want both expanded while
   *  mobile user collapses both to save scroll. */
  ChatSectionsCollapsed: "jednadvacet-chat-sections-collapsed",

  // ── Push ─────────────────────────────────────────────────────────
  /** Server-issued anonymous push token (decoupled from chat token by design). */
  PushToken: "jednadvacet-push-token",

  // ── RSVP ─────────────────────────────────────────────────────────
  /** Server-issued RSVP token for posting calendar overrides. */
  RsvpToken: "jednadvacet-rsvp-token",

  // ── Recovery / wallet seed ───────────────────────────────────────
  /** LEGACY: now `prefs.seedBackedUp` in Evolu (synced). Kept for migration. */
  SeedBackedUp: "jednadvacet-seed-backed-up",

  // ── Tier / referral ──────────────────────────────────────────────
  /** Captured ?ref=CODE before profile creation; redeemed after. */
  PendingReferral: "jednadvacet-pending-referral",

  // ── Home-page dismissibles ───────────────────────────────────────
  PwaHintDismissed: "jednadvacet-pwa-hint-dismissed",
  /** LEGACY: now `prefs.onboardingDismissed` in Evolu (synced). Migration only. */
  OnboardingDismissed: "jednadvacet-onboarding-dismissed",
  /** LEGACY: now `prefs.nearestDismissed` in Evolu (synced). Migration only. */
  NearestDismissed: "jednadvacet-nearest-dismissed",
  /** Cached browser geolocation result (lat/lng/ts JSON). Stays per-device. */
  NearestGeo: "jednadvacet-nearest-geo",

  // ── Admin ────────────────────────────────────────────────────────
  /** Admin login bearer; cleared on logout or 401. */
  AdminSession: "jednadvacet-admin-session",
} as const;

export const SS = {
  /** Set once per tab-session before the auto-recovery reload — prevents a
   *  reload loop if Evolu still won't init on the second try. */
  EvoluRecoveryAttempted: "jednadvacet-evolu-recovery-attempted",
} as const;
