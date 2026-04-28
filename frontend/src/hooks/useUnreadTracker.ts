// Per-channel unread + @mention counter for the Messages sidebar.
//
// State model:
//   Evolu `chatRead` row per channel slug: { slug, lastReadAt }. Synced
//   across devices so reading on phone clears the badge on desktop.
//   Missing → channel is treated as "caught up" on first visit (so the
//   user doesn't drown in years of backlog the moment they open the app).
//
//   In-memory state counts messages/mentions since that timestamp across
//   the slugs passed in, excluding whatever channel is currently active
//   (because a message that's being read as it arrives isn't "unread").
//
// Wire-up: Messages subscribes to every visible channel+DM via SSE. For
// each non-active delivery, the counter bumps. @mentions match a simple
// `@nickname` substring (case-insensitive); more sophisticated parsing can
// come later if we add real @-autocomplete.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@evolu/react";
import { listChannelMessages, type ChannelMessage } from "../api";
import { useChannelStream } from "./useChannelStream";
import { allChatReadQuery, useTypedEvolu } from "../evolu";
import { toNET100 } from "../lib/evoluParse";

export interface UnreadCount { unread: number; mentions: number }
export type UnreadCounts = Record<string, UnreadCount>;

interface Params {
  slugs: readonly string[];
  activeSlug: string | null;
  ownerId: string | null;
  /** Lowercased mention needles (typically just the user's nickname). */
  mentionWords: readonly string[];
}

function mentionMatch(body: string, words: readonly string[]): boolean {
  if (words.length === 0) return false;
  const low = body.toLowerCase();
  return words.some((w) => w && low.includes("@" + w));
}

export function useUnreadTracker({ slugs, activeSlug, ownerId, mentionWords }: Params): {
  counts: UnreadCounts;
  markRead: (slug: string) => void;
} {
  const [counts, setCounts] = useState<UnreadCounts>({});
  const slugsKey = slugs.join(",");
  const wordsKey = mentionWords.join(",");

  const readRows = useQuery(allChatReadQuery);
  const { insert, update } = useTypedEvolu();

  // Build a slug → row index. The row id is needed for update vs. insert.
  const readMap = useMemo(() => {
    const m = new Map<string, { id: string; lastReadAt: string }>();
    for (const r of readRows) {
      const slug = String(r.slug ?? "");
      const lastReadAt = String(r.lastReadAt ?? "");
      if (!slug || !lastReadAt) continue;
      m.set(slug, { id: String(r.id), lastReadAt });
    }
    return m;
  }, [readRows]);

  // Latest map kept in a ref so the SSE callback always upserts against
  // fresh row ids (avoid stale closures when `update` lands a tick later).
  const readMapRef = useRef(readMap);
  readMapRef.current = readMap;

  const writeLastRead = useCallback(
    (slug: string, iso: string) => {
      const slugV = toNET100(slug);
      const isoV = toNET100(iso);
      if (!slugV || !isoV) return;
      const existing = readMapRef.current.get(slug);
      if (existing) {
        update("chatRead", { id: existing.id as never, lastReadAt: isoV });
      } else {
        insert("chatRead", { slug: slugV, lastReadAt: isoV });
      }
    },
    [insert, update],
  );

  // Seed counts from history on mount + whenever the slug list changes.
  // Missing lastRead → set it to now so we don't flag ancient messages as
  // "unread". Having some backlog but lastRead set → count since that time.
  useEffect(() => {
    let cancelled = false;
    const seed = async () => {
      const now = new Date().toISOString();
      const next: UnreadCounts = {};
      for (const slug of slugs) {
        if (slug === activeSlug) continue;
        const last = readMapRef.current.get(slug)?.lastReadAt ?? null;
        if (!last) {
          writeLastRead(slug, now);
          continue;
        }
        const isDm = slug.startsWith("dm:");
        const msgs = await listChannelMessages(
          slug, last, 100, isDm ? ownerId ?? undefined : undefined,
        );
        if (cancelled) return;
        // Don't double-count our own messages.
        const incoming = msgs.filter((m) => m.authorOwnerId !== ownerId);
        const mentions = incoming.filter((m) => mentionMatch(m.body, mentionWords)).length;
        if (incoming.length > 0) {
          next[slug] = { unread: incoming.length, mentions };
        }
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setCounts((prev) => ({ ...prev, ...next }));
      }
    };
    void seed();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey, ownerId, wordsKey]);

  // Live deliveries: SSE fans all visible slugs into one callback. Active
  // channel's messages update lastRead directly; others bump the counter.
  const mentionWordsRef = useRef(mentionWords);
  mentionWordsRef.current = mentionWords;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const activeRef = useRef(activeSlug);
  activeRef.current = activeSlug;

  const onMessage = useCallback((m: ChannelMessage) => {
    if (m.authorOwnerId === ownerIdRef.current) {
      // Own message via SSE: treat as seen (don't flag unread on our own
      // devices that are silently tailing but not focused).
      writeLastRead(m.channelSlug, m.createdAt);
      return;
    }
    if (m.channelSlug === activeRef.current) {
      // User is looking at this channel right now → keep lastRead fresh.
      writeLastRead(m.channelSlug, m.createdAt);
      return;
    }
    const mentioned = mentionMatch(m.body, mentionWordsRef.current);
    setCounts((prev) => {
      const cur = prev[m.channelSlug] ?? { unread: 0, mentions: 0 };
      return {
        ...prev,
        [m.channelSlug]: {
          unread: cur.unread + 1,
          mentions: cur.mentions + (mentioned ? 1 : 0),
        },
      };
    });
  }, [writeLastRead]);

  useChannelStream(slugs, onMessage, ownerId);

  const markRead = useCallback((slug: string) => {
    writeLastRead(slug, new Date().toISOString());
    setCounts((prev) => {
      if (!prev[slug]) return prev;
      const { [slug]: _drop, ...rest } = prev;
      return rest;
    });
  }, [writeLastRead]);

  return useMemo(() => ({ counts, markRead }), [counts, markRead]);
}
