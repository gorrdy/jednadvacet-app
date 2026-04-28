// Articles arrive from /api/articles, populated by the backend RSS
// aggregator (see backend/sync-articles.js). Each row carries the source
// feed name so the UI can surface "this came from KryptoHodler / Bitcoin
// Magazine / …" — that's the only metadata tag we keep on articles now.

export interface Article {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  url: string;
  author: string;
  publishedAt: string; // ISO 8601
  /** Display name of the RSS feed this article came from, e.g. "KryptoHodler". */
  feedName: string | null;
  /** Optional cover image URL pulled from the feed item. */
  cover?: string;
}

// Empty placeholder. The backend RSS sync populates /api/articles within
// a few seconds of boot; an empty list during that window is acceptable.
export const PLACEHOLDER_ARTICLES: readonly Article[] = [];
