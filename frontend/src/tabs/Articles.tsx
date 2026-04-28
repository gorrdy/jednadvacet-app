import { useQuery } from "@evolu/react";
import { NonEmptyTrimmedString100, type SqliteBoolean } from "@evolu/common";
import { useEffect, useMemo, useState, type FC } from "react";
import { fetchArticles } from "../api";
import type { Article } from "../data/articles";
import { allBookmarksQuery, allReadQuery, useTypedEvolu } from "../evolu";
import { IconBookmark, IconBookmarkFilled, IconCheck } from "../components/Icons";
import { formatDateLong } from "../lib/fmt";
import { toNET100 } from "../lib/evoluParse";
import { ArticleDetail } from "./ArticleDetail";

const formatDate = (iso: string): string => {
  try { return formatDateLong(iso); } catch { return iso; }
};

export const Articles: FC = () => {
  const [articles, setArticles] = useState<readonly Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterFeed, setFilterFeed] = useState<string>("");
  const [showOnlyBookmarked, setShowOnlyBookmarked] = useState(false);
  // Ephemeral selection — open article in full-screen reader. Not persisted
  // across reloads; that would need URL routing or extra storage.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bookmarks = useQuery(allBookmarksQuery);
  const reads = useQuery(allReadQuery);
  const { insert, update } = useTypedEvolu();

  const bookmarkedIds = useMemo(
    () => new Map(bookmarks.map((b) => [b.articleId as string, b.id])),
    [bookmarks],
  );
  const readIds = useMemo(
    () => new Map(reads.map((r) => [r.articleId as string, r.id])),
    [reads],
  );

  useEffect(() => {
    let mounted = true;
    fetchArticles().then((a) => {
      if (mounted) {
        setArticles(a);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  // Distinct list of feeds present in the loaded articles, for the source
  // filter dropdown. Sorted alphabetically; only feeds with at least one
  // article are shown so we don't leak orphaned options.
  const availableFeeds = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) {
      if (a.feedName) set.add(a.feedName);
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y, "cs"));
  }, [articles]);

  const sorted = useMemo(() => {
    const s = search.trim().toLowerCase();
    return [...articles]
      .filter((a) => {
        if (filterFeed && a.feedName !== filterFeed) return false;
        if (showOnlyBookmarked && !bookmarkedIds.has(a.id)) return false;
        if (!s) return true;
        return (
          a.title.toLowerCase().includes(s) ||
          a.excerpt.toLowerCase().includes(s) ||
          (a.feedName ?? "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }, [articles, search, filterFeed, showOnlyBookmarked, bookmarkedIds]);

  const toggleBookmark = (articleId: string) => {
    // Read the live bookmarks list instead of the memoised map — if the
    // user double-taps before React re-renders, we'd otherwise insert a
    // duplicate (and the next click would only soft-delete one of them,
    // leaving a phantom bookmark). Filtering the raw list + removing all
    // matches is idempotent.
    const matching = bookmarks.filter((b) => (b.articleId as string) === articleId);
    if (matching.length > 0) {
      for (const b of matching) {
        update("bookmark", { id: b.id, isDeleted: true as unknown as SqliteBoolean });
      }
    } else {
      const parsed = NonEmptyTrimmedString100.from(articleId);
      if (parsed.ok) insert("bookmark", { articleId: parsed.value });
    }
  };

  const markRead = (articleId: string) => {
    if (readIds.has(articleId)) return;
    const parsed = NonEmptyTrimmedString100.from(articleId);
    if (parsed.ok) insert("readArticle", { articleId: parsed.value });
  };

  const markAllRead = () => {
    // Only mark what's actually on screen (respects search + filters +
    // bookmark scope). Doesn't re-mark articles already read.
    const unread = sorted.filter((a) => !readIds.has(a.id));
    if (unread.length === 0) return;
    if (unread.length > 20) {
      const ok = window.confirm(`Označit ${unread.length} článků jako přečtené?`);
      if (!ok) return;
    }
    for (const a of unread) {
      const id = toNET100(a.id);
      if (id) insert("readArticle", { articleId: id });
    }
  };

  const unreadOnScreenCount = useMemo(
    () => sorted.reduce((n, a) => (readIds.has(a.id) ? n : n + 1), 0),
    [sorted, readIds],
  );

  if (loading) return <div className="loading">Načítám články…</div>;

  const selected = selectedId ? articles.find((a) => a.id === selectedId) ?? null : null;
  if (selected) {
    return (
      <ArticleDetail
        article={selected}
        isBookmarked={bookmarkedIds.has(selected.id)}
        onBack={() => setSelectedId(null)}
        onToggleBookmark={() => toggleBookmark(selected.id)}
        onMarkRead={() => markRead(selected.id)}
      />
    );
  }

  return (
    <div>
      <h1 className="page-h">Novinky <span className="counter">{articles.length}</span></h1>
      <p className="page-sub">Bitcoin/krypto zprávy z více zdrojů.</p>

      <div className="toolbar">
        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat…"
        />
        {availableFeeds.length > 1 && (
          <select value={filterFeed} onChange={(e) => setFilterFeed(e.target.value)} style={{ width: "auto" }}>
            <option value="">Všechny zdroje</option>
            {availableFeeds.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}
        <button
          className={`chip selectable ${showOnlyBookmarked ? "active" : ""}`}
          onClick={() => setShowOnlyBookmarked((v) => !v)}
          title="Jen uložené"
        >
          <IconBookmark style={{ width: 12, height: 12 }} /> {bookmarks.length}
        </button>
        <button
          className="chip selectable"
          onClick={markAllRead}
          disabled={unreadOnScreenCount === 0}
          title="Označit vše na obrazovce jako přečtené"
          style={{ opacity: unreadOnScreenCount === 0 ? 0.5 : 1 }}
        >
          <IconCheck style={{ width: 12, height: 12 }} /> Přečíst vše
          {unreadOnScreenCount > 0 && <span className="muted"> · {unreadOnScreenCount}</span>}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">ŽÁDNÉ ČLÁNKY</div>
          <p>{search || filterFeed ? "Nic nevyhovuje filtru." : "Zatím prázdno — RSS se synchronizuje na pozadí."}</p>
        </div>
      ) : (
        <div>
          {sorted.map((a) => {
            const isRead = readIds.has(a.id);
            const isBookmarked = bookmarkedIds.has(a.id);
            return (
              <article
                key={a.id}
                className="article is-clickable"
                onClick={() => setSelectedId(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedId(a.id); }}
              >
                <div className="article-meta">
                  <span>{formatDate(a.publishedAt)}</span>
                  <span className="sep">/</span>
                  <span>{a.author}</span>
                  {a.feedName && <span className="badge">{a.feedName}</span>}
                </div>
                <h3 className={`article-title ${isRead ? "read" : ""}`}>{a.title}</h3>
                <p className="article-excerpt">{a.excerpt}</p>
                <div className="article-actions">
                  <button
                    className={`btn btn-sm ${isBookmarked ? "btn-secondary" : "btn-ghost"}`}
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(a.id); }}
                  >
                    {isBookmarked ? <IconBookmarkFilled style={{ width: 14, height: 14 }} /> : <IconBookmark style={{ width: 14, height: 14 }} />}
                    {isBookmarked ? "Uloženo" : "Uložit"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
