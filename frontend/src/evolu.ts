import {
  id,
  NonEmptyString1000,
  NonEmptyTrimmedString100,
  SqliteBoolean,
  optional,
  SimpleName,
} from "@evolu/common";
import { createEvolu } from "@evolu/common/local-first";
import { createUseEvolu } from "@evolu/react";
import { evoluReactWebDeps } from "@evolu/react-web";
import { SS } from "./lib/storageKeys";

const UserPrefsId = id("UserPrefs");
const EventOverrideId = id("EventOverride");
const BookmarkId = id("Bookmark");
const ReadArticleId = id("ReadArticle");
const ChatReadId = id("ChatRead");
const CashuMintId = id("CashuMint");
const CashuProofId = id("CashuProof");
const CashuTxId = id("CashuTx");

// All per-user, local-first. Sync via wss://evolu.gorrdy.cz.
// Public content (articles, global events) comes from /api/* — not Evolu.
export const Schema = {
  // Singleton row — user preferences (selected cities, categories).
  // Push token is NOT here — it's per-device (localStorage) because each
  // browser/device has its own push subscription endpoint.
  userPrefs: {
    id: UserPrefsId,
    // CSV of city slugs (kept as a single string to avoid JSON columns in Evolu).
    cities: optional(NonEmptyString1000),
    // CSV of category slugs.
    categories: optional(NonEmptyString1000),
    language: optional(NonEmptyTrimmedString100),
    // Synced flags (per-user, not per-device): same identity → same state on
    // every device. Migration from per-device localStorage flags is in
    // `lib/evoluMigrations.ts`.
    seedBackedUp: optional(SqliteBoolean),
    onboardingDismissed: optional(SqliteBoolean),
    nearestDismissed: optional(SqliteBoolean),
  },

  // Per-channel "last seen" timestamp for the unread/mention counter in
  // Messages. Synced so reading on phone clears the badge on desktop.
  // One row per channel (slug = global, city slug, or `dm:<a>:<b>`).
  chatRead: {
    id: ChatReadId,
    slug: NonEmptyTrimmedString100,
    lastReadAt: NonEmptyTrimmedString100, // ISO 8601
  },

  // RSVP for a global (backend-served) event.
  // status: "going" | "maybe" | "not_going"
  eventOverride: {
    id: EventOverrideId,
    eventId: NonEmptyTrimmedString100,
    status: NonEmptyTrimmedString100,
    note: optional(NonEmptyString1000),
  },

  // Bookmarked articles (server article id).
  bookmark: {
    id: BookmarkId,
    articleId: NonEmptyTrimmedString100,
  },

  // Mark an article as read.
  readArticle: {
    id: ReadArticleId,
    articleId: NonEmptyTrimmedString100,
  },

  // ── Cashu ecash wallet (E2E synced via BIP-39 mnemonic) ───────────
  // Mints the user has added (default: cashu.cz).
  cashuMint: {
    id: CashuMintId,
    url: NonEmptyString1000,
    name: optional(NonEmptyTrimmedString100),
  },
  // Individual ecash proofs. `data` is the full proof JSON (amount, secret,
  // C, id). We keep `amount` + `state` as columns for fast balance queries.
  // state: 'active' | 'pending' | 'spent'
  cashuProof: {
    id: CashuProofId,
    mintUrl: NonEmptyString1000,
    amount: NonEmptyTrimmedString100,   // stored as string, parsed as int
    state: NonEmptyTrimmedString100,
    secret: NonEmptyString1000,          // used for de-dupe queries
    data: NonEmptyString1000,            // JSON of the full proof
  },
  // Transaction history (mint/melt/send/receive).
  cashuTx: {
    id: CashuTxId,
    type: NonEmptyTrimmedString100,      // 'mint' | 'melt' | 'send' | 'receive'
    amount: NonEmptyTrimmedString100,    // signed string: "+123" or "-45"
    mintUrl: NonEmptyString1000,
    status: NonEmptyTrimmedString100,    // 'pending' | 'paid' | 'failed'
    memo: optional(NonEmptyString1000),
    token: optional(NonEmptyString1000), // for send/receive (encoded V4)
    invoice: optional(NonEmptyString1000), // for mint/melt
    quoteId: optional(NonEmptyString1000), // mint quote ID (for polling)
  },

} as const;

// Multi-relay redundancy — Evolu syncs every change to ALL transports in
// parallel (not failover), which is the local-first best practice: any
// one relay can die, memory-leak, or be restarted without interrupting
// the user. Each relay is an independent systemd service on the same host
// for now; moving one to a separate VPS would add geographic redundancy.
const RELAYS: ReadonlyArray<string> =
  (import.meta.env.VITE_EVOLU_RELAYS as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean)
  ?? [
    "wss://evolu.gorrdy.cz",
    "wss://evolu2.gorrdy.cz",
    "wss://evolu3.gorrdy.cz",
  ];

// Evolu instance name also acts as the OPFS database filename on the client
// AND the namespace on relays. Staging build sets this to "jednadvacet-test"
// so the test environment can never clash with production data even on the
// same device. Default "jednadvacet" for prod.
const INSTANCE_NAME = (import.meta.env.VITE_EVOLU_INSTANCE as string | undefined) || "jednadvacet";

export const evolu = createEvolu(evoluReactWebDeps)(Schema, {
  name: SimpleName.orThrow(INSTANCE_NAME),
  transports: RELAYS.map((url) => ({ type: "WebSocket" as const, url })),
});

export const useTypedEvolu = createUseEvolu(evolu);

// Safari's OPFS throws `UnknownError: transient reason` intermittently
// (memory pressure / lock contention / eviction — WebKit doesn't
// distinguish). sqlite-wasm already retries 4× internally; if it still
// propagates up here, the next-best recovery is a clean reload. We do
// this at most *once per tab-session* using a sessionStorage marker —
// if we reload again and the error reoccurs, the user sees InitFallback
// with a "restore from seed phrase" affordance instead of a reload loop.
const RECOVERABLE_ERROR_TYPES = new Set([
  "SqliteError",
  "TransferableError",
  "OpfsError",
]);

evolu.subscribeError(() => {
  const err = evolu.getError() as { type?: string } | null;
  if (!err) return;
  console.error("[Evolu]", err);

  const alreadyTried = (() => {
    try { return sessionStorage.getItem(SS.EvoluRecoveryAttempted) === "1"; } catch { return false; }
  })();
  if (alreadyTried) return; // InitFallback takes over on this load
  if (!err.type || !RECOVERABLE_ERROR_TYPES.has(err.type)) return;

  try { sessionStorage.setItem(SS.EvoluRecoveryAttempted, "1"); } catch { /* ignore */ }
  console.warn("[Evolu] recoverable error — reloading once in 2s");
  setTimeout(() => {
    window.location.reload();
  }, 2000);
});

// Successful init clears the marker so the next crash starts a fresh cycle.
// `appOwner` is a Promise that resolves when Evolu's local DB is open;
// once it resolves we know the OPFS layer is healthy this session.
void evolu.appOwner.then(() => {
  try { sessionStorage.removeItem(SS.EvoluRecoveryAttempted); } catch { /* ignore */ }
});

// Defense-in-depth: errors thrown *inside* sqlite-wasm's OPFS-async-proxy
// worker don't always bubble up to Evolu's subscribeError. Catch them
// via the global error event so we can trigger the same recovery.
if (typeof window !== "undefined") {
  const looksLikeOpfs = (msg: string | undefined | null) =>
    typeof msg === "string" && (
      msg.includes("OPFS") ||
      msg.includes("sqlite3-opfs") ||
      msg.includes("unknown transient reason")
    );

  const tryRecover = (reason: string) => {
    try { if (sessionStorage.getItem(SS.EvoluRecoveryAttempted) === "1") return; } catch { /* ignore */ }
    try { sessionStorage.setItem(SS.EvoluRecoveryAttempted, "1"); } catch { /* ignore */ }
    console.warn(`[Evolu/OPFS] ${reason} — reloading once in 2s`);
    setTimeout(() => window.location.reload(), 2000);
  };

  window.addEventListener("error", (ev) => {
    if (looksLikeOpfs(ev.message) || looksLikeOpfs(ev.filename)) tryRecover("error event");
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason as { message?: string } | string | null;
    const msg = typeof reason === "string" ? reason : reason?.message;
    if (looksLikeOpfs(msg)) tryRecover("unhandled rejection");
  });
}

export function hadUnrecoveredEvoluError(): boolean {
  try { return sessionStorage.getItem(SS.EvoluRecoveryAttempted) === "1"; } catch { return false; }
}

export function clearRecoveryMarker(): void {
  try { sessionStorage.removeItem(SS.EvoluRecoveryAttempted); } catch { /* ignore */ }
}

// ── Queries ──────────────────────────────────────────────────────────

const notDeleted = 1 as SqliteBoolean;

export const userPrefsQuery = evolu.createQuery((db) =>
  db
    .selectFrom("userPrefs")
    .select(["id", "cities", "categories", "language", "seedBackedUp", "onboardingDismissed", "nearestDismissed"])
    .where("isDeleted", "is not", notDeleted)
    .limit(1),
);

export const allChatReadQuery = evolu.createQuery((db) =>
  db
    .selectFrom("chatRead")
    .select(["id", "slug", "lastReadAt"])
    .where("isDeleted", "is not", notDeleted),
);

export const allOverridesQuery = evolu.createQuery((db) =>
  db
    .selectFrom("eventOverride")
    .select(["id", "eventId", "status", "note", "createdAt", "updatedAt"])
    .where("isDeleted", "is not", notDeleted),
);

export const allBookmarksQuery = evolu.createQuery((db) =>
  db
    .selectFrom("bookmark")
    .select(["id", "articleId", "createdAt"])
    .where("isDeleted", "is not", notDeleted),
);

export const allReadQuery = evolu.createQuery((db) =>
  db
    .selectFrom("readArticle")
    .select(["id", "articleId", "createdAt"])
    .where("isDeleted", "is not", notDeleted),
);

// ── Cashu queries ─────────────────────────────────────────────────

export const allMintsQuery = evolu.createQuery((db) =>
  db
    .selectFrom("cashuMint")
    .select(["id", "url", "name", "createdAt"])
    .where("isDeleted", "is not", notDeleted)
    .orderBy("createdAt", "asc"),
);

export const allProofsQuery = evolu.createQuery((db) =>
  db
    .selectFrom("cashuProof")
    .select(["id", "mintUrl", "amount", "state", "secret", "data", "createdAt"])
    .where("isDeleted", "is not", notDeleted),
);

export const allTxQuery = evolu.createQuery((db) =>
  db
    .selectFrom("cashuTx")
    .select(["id", "type", "amount", "mintUrl", "status", "memo", "token", "invoice", "quoteId", "createdAt", "updatedAt"])
    .where("isDeleted", "is not", notDeleted)
    .orderBy("createdAt", "desc"),
);

