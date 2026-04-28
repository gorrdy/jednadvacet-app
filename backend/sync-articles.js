// Pull blog articles from a curated set of Bitcoin / crypto RSS feeds and
// upsert them into the `articles` table. Each feed is fetched independently
// — one bad source doesn't kill the rest.
//
// Each RSS-sourced row gets a `feed_name` so the UI can show "this came
// from KryptoHodler / Bitcoin Magazine / …". We deliberately don't derive
// topic categories any more — the source feed is the only tag.
//
// Reconciliation is per-feed: only RSS rows from feed F are deleted when
// they disappear from feed F's response, so a transient HTTP failure on
// one source can't wipe its archive.

import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

function stripHtml(s) {
  return (s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8230;/g, "…")
    .replace(/&hellip;/g, "…")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstImage(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html ?? "");
  return m ? m[1] : null;
}

function hashArticle(a) {
  const s = JSON.stringify([
    a.title, a.excerpt, a.body, a.url, a.author,
    a.publishedAt, a.feedName ?? "", a.cover ?? "",
  ]);
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function safeId(feedSlug, guid, link) {
  // Per-feed namespace — different feeds reusing the same WP post id
  // (?p=12) would otherwise collide.
  const pMatch = /\?p=(\d+)/.exec(guid ?? "");
  if (pMatch) return `rss-${feedSlug}-wp-${pMatch[1]}`;
  const h = crypto.createHash("sha1").update(link ?? guid ?? Math.random().toString()).digest("hex").slice(0, 10);
  return `rss-${feedSlug}-${h}`;
}

function slugify(name) {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "feed";
}

async function fetchRss(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "jednadvacet-app/0.1 (+https://jednadvacet.gorrdy.cz)",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function parseFeed({ feedName, url, xml }) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
    textNodeName: "_text",
  });
  const parsed = parser.parse(xml);

  // RSS 2.0 → rss.channel.item; Atom → feed.entry. Both supported.
  const channel = parsed?.rss?.channel ?? parsed?.channel;
  if (channel) {
    const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    return parseRssItems({ feedName, items: rawItems });
  }
  const atomFeed = parsed?.feed;
  if (atomFeed) {
    const rawEntries = Array.isArray(atomFeed.entry) ? atomFeed.entry : atomFeed.entry ? [atomFeed.entry] : [];
    return parseAtomEntries({ feedName, entries: rawEntries, url });
  }
  return [];
}

function cdata(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if ("__cdata" in v) return v.__cdata;
    if ("_text" in v) return v._text;
    return Object.values(v).filter((x) => typeof x === "string").join(" ");
  }
  return String(v);
}

function parseRssItems({ feedName, items }) {
  const feedSlug = slugify(feedName);
  const out = [];
  for (const it of items) {
    const title = cdata(it.title).trim();
    const link = cdata(it.link).trim();
    if (!title || !link) continue;

    const guid = cdata(it.guid).trim();
    const pubDate = cdata(it.pubDate).trim();
    const author = cdata(it["dc:creator"] ?? it.author).trim() || feedName;

    const content = cdata(it["content:encoded"]);
    const descHtml = cdata(it.description);

    const bodyPlain = stripHtml(content || descHtml);
    const excerpt = bodyPlain.slice(0, 260).replace(/\s+\S*$/, "") + (bodyPlain.length > 260 ? "…" : "");
    const cover = firstImage(content || descHtml);

    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const id = safeId(feedSlug, guid, link);

    const a = {
      id,
      sourceUid: guid || link,
      title, excerpt,
      body: bodyPlain.slice(0, 50000),
      url: link, author, publishedAt,
      feedName,
      cover,
    };
    a.hash = hashArticle(a);
    out.push(a);
  }
  return out;
}

function parseAtomEntries({ feedName, entries, url }) {
  const feedSlug = slugify(feedName);
  const out = [];
  for (const e of entries) {
    const title = cdata(e.title).trim();
    // Atom <link href="…"/> — XMLParser puts attrs under @_href.
    let link = "";
    const linkRaw = e.link;
    if (Array.isArray(linkRaw)) {
      const alt = linkRaw.find((l) => l?.["@_rel"] === "alternate") ?? linkRaw[0];
      link = (alt?.["@_href"] ?? cdata(alt)).trim();
    } else if (linkRaw && typeof linkRaw === "object") {
      link = (linkRaw["@_href"] ?? cdata(linkRaw)).trim();
    } else {
      link = cdata(linkRaw).trim();
    }
    if (!title || !link) continue;

    const id = cdata(e.id).trim() || link;
    const updated = cdata(e.updated || e.published).trim();
    const author = cdata(e?.author?.name ?? e?.author).trim() || feedName;
    const summary = cdata(e.summary);
    const content = cdata(e.content);

    const bodyPlain = stripHtml(content || summary);
    const excerpt = bodyPlain.slice(0, 260).replace(/\s+\S*$/, "") + (bodyPlain.length > 260 ? "…" : "");
    const cover = firstImage(content || summary);

    const publishedAt = updated ? new Date(updated).toISOString() : new Date().toISOString();
    const safe = safeId(feedSlug, id, link);

    const a = {
      id: safe,
      sourceUid: id || link,
      title, excerpt,
      body: bodyPlain.slice(0, 50000),
      url: link, author, publishedAt,
      feedName,
      cover,
    };
    a.hash = hashArticle(a);
    out.push(a);
    void url; // (reserved for future relative-URL resolution)
  }
  return out;
}

async function syncOneFeed({ db, feedName, url, log }) {
  let xml;
  try {
    xml = await fetchRss(url);
  } catch (e) {
    log.error?.(`[rss:${feedName}] fetch failed: ${e.message}`);
    return { ok: false, feedName, url, error: e.message };
  }

  let derived;
  try {
    derived = parseFeed({ feedName, url, xml });
  } catch (e) {
    log.error?.(`[rss:${feedName}] parse failed: ${e.message}`);
    return { ok: false, feedName, url, error: e.message };
  }

  const byId = new Map();
  for (const a of derived) byId.set(a.id, a);

  // Reconcile only this feed's rows. Different feeds shouldn't see each
  // other's items.
  const existing = db.prepare(
    "SELECT id, source_hash FROM articles WHERE source = 'rss' AND feed_name = ?",
  ).all(feedName);
  const existingMap = new Map(existing.map((r) => [r.id, r.source_hash]));

  const upsert = db.prepare(`
    INSERT INTO articles (
      id, title, excerpt, body, url, author, published_at,
      categories_csv, cover,
      source, source_uid, source_hash, feed_name, updated_at
    ) VALUES (
      @id, @title, @excerpt, @body, @url, @author, @publishedAt,
      '', @cover,
      'rss', @sourceUid, @hash, @feedName, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      title=@title, excerpt=@excerpt, body=@body, url=@url, author=@author,
      published_at=@publishedAt, cover=@cover,
      source_hash=@hash, feed_name=@feedName, updated_at=datetime('now')
  `);
  const del = db.prepare("DELETE FROM articles WHERE id = ? AND source = 'rss' AND feed_name = ?");

  let inserted = 0, updated = 0, skipped = 0, deleted = 0;

  const tx = db.transaction(() => {
    for (const a of byId.values()) {
      const prev = existingMap.get(a.id);
      if (prev === a.hash) { skipped++; continue; }
      upsert.run({
        ...a,
        cover: a.cover ?? null,
      });
      if (prev !== undefined) updated++; else inserted++;
    }
    for (const id of existingMap.keys()) {
      if (!byId.has(id)) { del.run(id, feedName); deleted++; }
    }
  });
  tx();

  log.info?.(`[rss:${feedName}] ${inserted} new, ${updated} updated, ${skipped} unchanged, ${deleted} removed (total ${byId.size})`);
  return { ok: true, feedName, url, total: byId.size, inserted, updated, skipped, deleted };
}

export async function syncArticles({ db, feeds, log = console }) {
  if (!Array.isArray(feeds) || feeds.length === 0) {
    return { ok: false, error: "no feeds configured" };
  }
  const perFeed = [];
  let inserted = 0, updated = 0, skipped = 0, deleted = 0, total = 0, failed = 0;
  for (const f of feeds) {
    const r = await syncOneFeed({ db, feedName: f.name, url: f.url, log });
    perFeed.push(r);
    if (r.ok) {
      inserted += r.inserted; updated += r.updated; skipped += r.skipped;
      deleted += r.deleted; total += r.total;
    } else {
      failed++;
    }
  }
  return { ok: failed < feeds.length, feeds: perFeed, total, inserted, updated, skipped, deleted, failed };
}
