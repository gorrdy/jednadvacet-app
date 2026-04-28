// Database lifecycle — open connection, create tables, run migrations.
// Everyone else imports the `db` singleton. Migrations (ALTER TABLE +
// data cleanups) live in migrations.js and run after schema DDL.

import Database from "better-sqlite3";
import { DB_PATH } from "./config.js";
import { runMigrations } from "./migrations.js";

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT NOT NULL,
    published_at TEXT NOT NULL,
    categories_csv TEXT NOT NULL DEFAULT '',
    cover TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    url TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    cities_csv TEXT NOT NULL DEFAULT '',
    categories_csv TEXT NOT NULL DEFAULT '',
    organizer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_sub (
    token TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_tag (
    token TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (token, tag),
    FOREIGN KEY (token) REFERENCES push_sub(token) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
  CREATE INDEX IF NOT EXISTS idx_push_tag_tag ON push_tag(tag);

  CREATE TABLE IF NOT EXISTS admin_user (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    username      TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL CHECK (role IN ('superadmin','admin')),
    city          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_session (
    token      TEXT PRIMARY KEY,
    admin_id   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admin_user(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_admin_session_admin ON admin_session(admin_id);

  CREATE TABLE IF NOT EXISTS admin_invite (
    code                TEXT PRIMARY KEY,
    role                TEXT NOT NULL CHECK (role IN ('admin','superadmin')),
    city                TEXT,
    display_name        TEXT,
    note                TEXT,
    created_by_admin_id TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at          TEXT NOT NULL,
    used_by_admin_id    TEXT,
    used_at             TEXT,
    FOREIGN KEY (created_by_admin_id) REFERENCES admin_user(id) ON DELETE SET NULL,
    FOREIGN KEY (used_by_admin_id)    REFERENCES admin_user(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS telemetry_ping (
    day           TEXT NOT NULL,
    kind          TEXT NOT NULL,
    anon_id       TEXT NOT NULL,
    user_cookie   TEXT,
    standalone    INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (day, kind, anon_id)
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_ping_day    ON telemetry_ping(day);
  CREATE INDEX IF NOT EXISTS idx_telemetry_ping_kind   ON telemetry_ping(kind);

  CREATE TABLE IF NOT EXISTS telemetry_presence (
    anon_id      TEXT PRIMARY KEY,
    user_cookie  TEXT,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    standalone   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_presence_seen ON telemetry_presence(last_seen_at);

  CREATE TABLE IF NOT EXISTS event_rsvp (
    token      TEXT NOT NULL,
    event_id   TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('going','maybe','not_going')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (token, event_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_event_rsvp_event  ON event_rsvp(event_id);
  CREATE INDEX IF NOT EXISTS idx_event_rsvp_status ON event_rsvp(event_id, status);

  -- Dedup ledger for the "tomorrow's events" push reminder. Keyed by
  -- (day, city) so we never double-send if the backend restarts around
  -- the trigger hour.
  CREATE TABLE IF NOT EXISTS reminder_sent (
    day     TEXT NOT NULL,   -- YYYY-MM-DD (Prague date of the events)
    city    TEXT NOT NULL,
    events  INTEGER NOT NULL DEFAULT 0,
    sent    INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (day, city)
  );

  -- Public community channels (Global CZ + per-city). Stored on the
  -- backend intentionally — these are broadcast chats, not DMs, so there
  -- is no E2E requirement. Author identity is an opaque per-device
  -- author_token (rotating-free for MVP) with a user-chosen display
  -- name denormalised onto the message row. Backend never learns which
  -- BIP-39 mnemonic / Evolu owner posted what.
  --
  -- channel_slug: 'global' OR one of the city slugs (frontend/backend
  -- cities.js). Enforced by the API, not a FK.
  CREATE TABLE IF NOT EXISTS channel_message (
    id              TEXT PRIMARY KEY,
    channel_slug    TEXT NOT NULL,
    author_token    TEXT NOT NULL,
    author_owner_id TEXT,                      -- Evolu appOwner.id; stable across devices
    author_name     TEXT NOT NULL,             -- snapshot at post time, fallback when no owner_id
    body            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_channel_message_slug   ON channel_message(channel_slug, created_at);
  CREATE INDEX IF NOT EXISTS idx_channel_message_author ON channel_message(author_token);
  -- idx_channel_message_owner is created by the ALTER migration below (after
  -- the column is added to older installs).

  -- Cross-device chat identity. owner_id = Evolu AppOwner id (pseudonymous,
  -- derived from BIP-39 mnemonic via SLIP-21). Same mnemonic on different
  -- devices → same owner_id → same nickname everywhere.
  --
  -- Uniqueness is enforced on name_norm (lowercase + diacritic-stripped),
  -- so "Honza", "honza", and "Honzá" all compete for the same slot and
  -- we can tell the user their chosen nick collides with someone else's.
  CREATE TABLE IF NOT EXISTS chat_user (
    owner_id     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    name_norm    TEXT NOT NULL UNIQUE,
    avatar       TEXT,                         -- data URL (base64), client-side resized to <=200KB
    bio          TEXT,                         -- short description, max 500 chars
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Direct-message request state. 1-to-1 chat between two owner ids requires
  -- the recipient to accept first (reduces spam from randomly guessed ids).
  -- The DM channel itself reuses channel_message with slug 'dm:<A>:<B>' where
  -- A < B lexicographically. status lifecycle:
  --   pending  — request sent, waiting for recipient
  --   accepted — both sides may now post/read
  --   rejected — recipient declined; can be recreated by sender
  --   blocked  — recipient blocked sender; sender cannot retry
  CREATE TABLE IF NOT EXISTS dm_request (
    id             TEXT PRIMARY KEY,
    from_owner_id  TEXT NOT NULL,
    to_owner_id    TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Can only be one (a,b) directional request at a time. If rejected, the row
  -- lingers; a retry updates updated_at and flips status back to pending.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_request_pair ON dm_request(from_owner_id, to_owner_id);
  CREATE INDEX IF NOT EXISTS idx_dm_request_to  ON dm_request(to_owner_id, status);
  CREATE INDEX IF NOT EXISTS idx_dm_request_from ON dm_request(from_owner_id, status);

  -- Tier (úroveň) každého uživatele. Tier 1 je default; postup po splnění
  -- quizu pro vyšší tier + 7-denní cooldown mezi postupy. Server udržuje
  -- stav, klient zobrazuje badge a UI pro pokus o postup. Cooldown brání
  -- rychlému proletění tiery; quiz brání náhodnému kliku.
  CREATE TABLE IF NOT EXISTS user_tier (
    owner_id        TEXT PRIMARY KEY,                    -- chat_user.owner_id
    tier            INTEGER NOT NULL DEFAULT 1,
    last_advance_at TEXT,
    advanced_at_2   TEXT,
    advanced_at_3   TEXT,
    advanced_at_4   TEXT,
    advanced_at_5   TEXT,
    referral_code   TEXT UNIQUE,                          -- pro tier 5 + invitations
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES chat_user(owner_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_tier_referral ON user_tier(referral_code);

  -- Vztah pozvánky (tier 5 podmínka). Kdo koho přivedl přes referral
  -- link. Jeden uživatel může být přiveden jen jednou (referred_owner_id
  -- PK), ale referrer může mít neomezeně mnoho přivedených.
  CREATE TABLE IF NOT EXISTS referral (
    referrer_owner_id TEXT NOT NULL,
    referred_owner_id TEXT NOT NULL PRIMARY KEY,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral(referrer_owner_id);
`);


// LNURL-pay incoming-payment ledger. quote_id is mint-issued and unique;
// owner_id is the recipient. Lifecycle:
//   created (created_at set) → paid (paid_at set, mint reports payment)
//   → claimed (claimed_at set, client redeemed quote for proofs)
// Old rows (claimed > 14 days or paid > 30 days unclaimed) can be GC'd.
db.exec(`
  CREATE TABLE IF NOT EXISTS lnurl_payment (
    quote_id     TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL,
    mint_url     TEXT NOT NULL,
    amount_sats  INTEGER NOT NULL,
    invoice      TEXT NOT NULL,
    comment      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at      TEXT,
    claimed_at   TEXT,
    FOREIGN KEY (owner_id) REFERENCES chat_user(owner_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_lnurl_payment_owner ON lnurl_payment(owner_id, claimed_at);
`);

// Marketplace: Vexl-style P2P classifieds. Each offer is a "I sell sats
// for cash", "I'll buy your old hardware wallet", "I'm selling Bitcoin
// books" listing posted by a chat user (tier 2+ gate to reduce spam).
// Negotiation happens out-of-band via DM — backend just hosts the
// listings + reports + close button.
db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_offer (
    id                   TEXT PRIMARY KEY,
    owner_id             TEXT NOT NULL,
    proposer_name        TEXT NOT NULL,
    type                 TEXT NOT NULL CHECK (type IN ('buy_sats','sell_sats','service','goods')),
    title                TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    location             TEXT,
    cities_csv           TEXT NOT NULL DEFAULT '',
    payment_methods_csv  TEXT NOT NULL DEFAULT '',
    price_text           TEXT,
    status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','closed','sold')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at           TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES chat_user(owner_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_marketplace_offer_status ON marketplace_offer(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_marketplace_offer_owner  ON marketplace_offer(owner_id);
  CREATE INDEX IF NOT EXISTS idx_marketplace_offer_type   ON marketplace_offer(type);

  -- Reports for moderation. Anyone can flag, admins triage.
  CREATE TABLE IF NOT EXISTS marketplace_report (
    id           TEXT PRIMARY KEY,
    offer_id     TEXT NOT NULL,
    reporter_id  TEXT NOT NULL,
    reason       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (offer_id) REFERENCES marketplace_offer(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_marketplace_report_offer ON marketplace_report(offer_id);
`);

// Tier 4+ users (Pořadatel) can propose events; admins moderate.
// Approved proposals create an `events` row and the proposal stays on
// record so we can audit who suggested what.
db.exec(`
  CREATE TABLE IF NOT EXISTS event_proposal (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    proposer_name   TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL,
    url             TEXT,
    starts_at       TEXT NOT NULL,
    ends_at         TEXT NOT NULL,
    cities_csv      TEXT NOT NULL DEFAULT '',
    categories_csv  TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    proposed_at     TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at     TEXT,
    reviewed_by     TEXT,
    reject_reason   TEXT,
    approved_event_id TEXT,
    FOREIGN KEY (owner_id) REFERENCES chat_user(owner_id) ON DELETE CASCADE,
    FOREIGN KEY (approved_event_id) REFERENCES events(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_proposal_status ON event_proposal(status);
  CREATE INDEX IF NOT EXISTS idx_event_proposal_owner  ON event_proposal(owner_id);
`);

// Per-message emoji reactions. Composite primary key prevents duplicate
// reactions from the same owner with the same emoji; allows multiple
// distinct emojis per (owner, message). Cascades when message is deleted.
db.exec(`
  CREATE TABLE IF NOT EXISTS message_reaction (
    message_id TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, owner_id, emoji),
    FOREIGN KEY (message_id) REFERENCES channel_message(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_message_reaction_msg ON message_reaction(message_id);
`);

// Tier 3+ users can apply to become a community admin for one or more
// cities. Superadmin reviews in the admin panel; approval is a soft
// hand-shake — the actual admin_user account is still onboarded via
// the existing admin_invite flow (different identity domains —
// chat owner_id is BIP-39, admin_user is email+password).
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_application (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    cities_csv    TEXT NOT NULL,
    message       TEXT,
    tier_at_apply INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
    applied_at    TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at   TEXT,
    reviewed_by   TEXT,
    reject_reason TEXT,
    FOREIGN KEY (owner_id) REFERENCES chat_user(owner_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_admin_application_status ON admin_application(status);
  CREATE INDEX IF NOT EXISTS idx_admin_application_owner ON admin_application(owner_id);
`);

// Run all post-DDL migrations now that every CREATE TABLE has executed.
runMigrations(db);
