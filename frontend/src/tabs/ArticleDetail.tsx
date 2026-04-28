// Full-screen reader pro RSS článek. Zobrazí celý plain-text body uložený
// při RSS sync (až 50 000 znaků), takže uživatel nemusí odcházet z PWA.
// Obrázky jsou jen v `cover` (RSS body je stripovaný); pro plnou bohatou
// verzi je v patičce tlačítko "Číst na webu" → externí URL.

import { Fragment, useEffect, useMemo, type FC } from "react";
import type { Article } from "../data/articles";
import { IconBookmark, IconBookmarkFilled, IconExternal } from "../components/Icons";
import { formatDateLong } from "../lib/fmt";
import { scrollContentTop } from "../lib/scroll";

const formatDate = (iso: string): string => {
  try { return formatDateLong(iso); } catch { return iso; }
};

/** Split a plain-text body into paragraphs on blank lines. Soft single
 *  newlines stay as <br/> within a paragraph (handles e.g. quoted blocks
 *  in RSS bodies that weren't broken with double newlines). */
function splitParagraphs(body: string): readonly string[] {
  return body
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

interface Props {
  article: Article;
  isBookmarked: boolean;
  onBack: () => void;
  onToggleBookmark: () => void;
  onMarkRead: () => void;
}

export const ArticleDetail: FC<Props> = ({ article, isBookmarked, onBack, onToggleBookmark, onMarkRead }) => {
  // Auto-mark-read on open + scroll to top so the user lands on the title
  // rather than wherever the underlying list was scrolled to.
  useEffect(() => {
    onMarkRead();
    scrollContentTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id]);

  const paragraphs = useMemo(
    () => splitParagraphs(article.body || article.excerpt || ""),
    [article.body, article.excerpt],
  );

  return (
    <div className="article-reader">
      <button className="reader-back" onClick={onBack} aria-label="Zpět na seznam">
        <span aria-hidden="true">←</span>
        <span>Zpět</span>
      </button>

      {article.cover && (
        <div className="article-cover">
          <img
            src={article.cover}
            alt=""
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
          />
        </div>
      )}

      <header className="article-reader-head">
        {article.feedName && <span className="reader-feed">{article.feedName}</span>}
        <h1>{article.title}</h1>
        <div className="reader-byline">
          <span>{article.author}</span>
          <span className="sep">·</span>
          <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        </div>
      </header>

      <div className="article-body">
        {paragraphs.length === 0 ? (
          <p className="muted">Náhled tohoto článku není k dispozici. Otevři ho na webu.</p>
        ) : (
          paragraphs.map((p, i) => (
            <p key={i} className={i === 0 ? "is-lead" : undefined}>
              {p.split("\n").map((line, j, all) => (
                <Fragment key={j}>
                  {line}
                  {j < all.length - 1 && <br />}
                </Fragment>
              ))}
            </p>
          ))
        )}
      </div>

      <div className="reader-actions">
        <a
          className="btn btn-sm btn-primary"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Číst na webu <IconExternal style={{ width: 14, height: 14 }} />
        </a>
        <button
          className={`btn btn-sm ${isBookmarked ? "btn-secondary" : "btn-ghost"}`}
          onClick={onToggleBookmark}
        >
          {isBookmarked
            ? <IconBookmarkFilled style={{ width: 14, height: 14 }} />
            : <IconBookmark style={{ width: 14, height: 14 }} />}
          {isBookmarked ? "Uloženo" : "Uložit"}
        </button>
      </div>
    </div>
  );
};
