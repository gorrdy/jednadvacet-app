// Schema migrations — ALTER TABLE / column adds / data cleanups that
// must run AFTER the initial CREATE TABLE block in db.js but before any
// route handler can hit the schema. Schema DDL itself (CREATE TABLE …)
// stays in db.js so the file order in `tables created` ↔ `migrations
// run` is naturally enforced.
//
// Each block is idempotent (PRAGMA table_info lookup gates the ALTER)
// so calling runMigrations() repeatedly is safe — useful in dev where
// the process restarts often.

function addColumnsIfMissing(db, table, defs) {
  const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, sql] of defs) {
    if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
  }
}

export function runMigrations(db) {
  // Migration: add source tracking to events / articles (old installs).
  addColumnsIfMissing(db, "events", [
    ["source",      "source TEXT NOT NULL DEFAULT 'admin'"],
    ["source_uid",  "source_uid TEXT"],
    ["source_hash", "source_hash TEXT"],
    ["updated_at",  "updated_at TEXT"],
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)");

  // event_rsvp: nullable owner_id so signed-in users can be listed by
  // name in the per-event attendee modal (anonymous tokens stay
  // anonymous — they just count toward the "+ X dalších" badge).
  addColumnsIfMissing(db, "event_rsvp", [
    ["owner_id", "owner_id TEXT"],
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_event_rsvp_owner ON event_rsvp(event_id, status, owner_id)");

  // Lightning Address (LUD-16) for chat users.
  addColumnsIfMissing(db, "chat_user", [
    ["lightning_username", "lightning_username TEXT"],
  ]);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_user_lightning_username ON chat_user(lightning_username) WHERE lightning_username IS NOT NULL");

  // Articles: source tracking + feed name (RSS feed display).
  addColumnsIfMissing(db, "articles", [
    ["source",      "source TEXT NOT NULL DEFAULT 'seed'"],
    ["source_uid",  "source_uid TEXT"],
    ["source_hash", "source_hash TEXT"],
    ["updated_at",  "updated_at TEXT"],
    ["feed_name",   "feed_name TEXT"],
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source)");

  // chat_user: avatar + bio columns (profile page feature).
  {
    const cols = new Set(db.prepare("PRAGMA table_info(chat_user)").all().map((c) => c.name));
    if (cols.size > 0 && !cols.has("avatar")) db.exec("ALTER TABLE chat_user ADD COLUMN avatar TEXT");
    if (cols.size > 0 && !cols.has("bio"))    db.exec("ALTER TABLE chat_user ADD COLUMN bio TEXT");
  }

  // channel_message: author_owner_id for cross-device identity. Pre-
  // existing rows have NULL and fall back to the denormalised
  // author_name column. edited_at is NULL until the author edits the
  // message; clients render an "(upraveno)" hint when present.
  {
    const cols = new Set(db.prepare("PRAGMA table_info(channel_message)").all().map((c) => c.name));
    if (cols.size > 0 && !cols.has("author_owner_id")) {
      db.exec("ALTER TABLE channel_message ADD COLUMN author_owner_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_channel_message_owner ON channel_message(author_owner_id)");
    }
    if (cols.size > 0 && !cols.has("edited_at")) {
      db.exec("ALTER TABLE channel_message ADD COLUMN edited_at TEXT");
    }
  }

  // telemetry: user_cookie for unique-user dedup.
  {
    const pingCols = new Set(db.prepare("PRAGMA table_info(telemetry_ping)").all().map((c) => c.name));
    if (pingCols.size > 0 && !pingCols.has("user_cookie")) {
      db.exec("ALTER TABLE telemetry_ping ADD COLUMN user_cookie TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_telemetry_ping_cookie ON telemetry_ping(day, kind, user_cookie)");
    }
    const presCols = new Set(db.prepare("PRAGMA table_info(telemetry_presence)").all().map((c) => c.name));
    if (presCols.size > 0 && !presCols.has("user_cookie")) {
      db.exec("ALTER TABLE telemetry_presence ADD COLUMN user_cookie TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_telemetry_presence_cookie ON telemetry_presence(user_cookie)");
    }
  }

  // admin_user: older installs had (email NOT NULL) without a username
  // column. Relaxing NOT NULL in SQLite needs a table rebuild.
  {
    const cols = db.prepare("PRAGMA table_info(admin_user)").all();
    const colMap = new Map(cols.map((c) => [c.name, c]));
    if (cols.length > 0 && !colMap.has("username")) {
      db.exec("ALTER TABLE admin_user ADD COLUMN username TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_user_username ON admin_user(username)");
    }
    const emailCol = colMap.get("email");
    if (emailCol && emailCol.notnull === 1) {
      db.exec(`
        CREATE TABLE admin_user__new (
          id            TEXT PRIMARY KEY,
          email         TEXT UNIQUE,
          username      TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          display_name  TEXT,
          role          TEXT NOT NULL CHECK (role IN ('superadmin','admin')),
          city          TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO admin_user__new (id, email, username, password_hash, display_name, role, city, created_at)
          SELECT id, email, ${colMap.has("username") ? "username" : "NULL"}, password_hash, display_name, role, city, created_at FROM admin_user;
        DROP TABLE admin_user;
        ALTER TABLE admin_user__new RENAME TO admin_user;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_user_username ON admin_user(username);
      `);
      console.log("[admin] migrated admin_user to nullable email + username");
    }
  }

  // Drop legacy placeholder articles + legacy jednadvacet.org RSS items +
  // English-language feeds the user no longer wants in Novinky. Articles
  // now come exclusively from the curated CZ feeds (see RSS_FEEDS config).
  {
    const delSeed = db.prepare("DELETE FROM articles WHERE source = 'seed'").run();
    if (delSeed.changes > 0) console.log(`[migrate] removed ${delSeed.changes} legacy seed articles`);
    const delOldRss = db.prepare("DELETE FROM articles WHERE source = 'rss' AND feed_name IS NULL").run();
    if (delOldRss.changes > 0) console.log(`[migrate] removed ${delOldRss.changes} legacy single-feed RSS articles`);
    const delEn = db.prepare(
      "DELETE FROM articles WHERE source = 'rss' AND feed_name IN ('Bitcoin Magazine', 'No BS Bitcoin', 'Stacker News')",
    ).run();
    if (delEn.changes > 0) console.log(`[migrate] removed ${delEn.changes} EN-only RSS articles`);
  }
}
