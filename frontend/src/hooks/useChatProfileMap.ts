import { useEffect, useRef, useState } from "react";
import { fetchChatProfiles, type ChatProfile } from "../api";

/**
 * Resolve avatars/names for a set of ownerIds with a single batch call.
 * Used by the Thread view so rendering 50 messages from 10 authors makes
 * one `GET /api/chat/profiles?ids=…` instead of N.
 *
 * Caches across re-renders via a ref — we only refetch when a new ownerId
 * appears that isn't already cached. Avatars change rarely, so we tolerate
 * a bit of staleness for UX snappiness.
 */
export function useChatProfileMap(ownerIds: readonly (string | null | undefined)[]): Record<string, ChatProfile> {
  const cacheRef = useRef<Map<string, ChatProfile>>(new Map());
  const [, bump] = useState(0);

  useEffect(() => {
    const missing = Array.from(new Set(
      ownerIds.filter((x): x is string => !!x && !cacheRef.current.has(x)),
    ));
    if (missing.length === 0) return;
    let cancelled = false;
    fetchChatProfiles(missing).then((map) => {
      if (cancelled) return;
      let added = false;
      for (const [id, p] of Object.entries(map)) {
        if (!cacheRef.current.has(id)) {
          cacheRef.current.set(id, p);
          added = true;
        }
      }
      if (added) bump((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [ownerIds]);

  // Convert cache to plain object for consumers.
  return Object.fromEntries(cacheRef.current);
}
