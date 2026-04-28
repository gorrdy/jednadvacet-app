import { useQuery } from "@evolu/react";
import { type NonEmptyString1000, type SqliteBoolean } from "@evolu/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { userPrefsQuery, useTypedEvolu } from "../evolu";
import { toNES1000, toNET100 } from "../lib/evoluParse";

export interface UserPrefs {
  cities: string[];
  categories: string[];
  language: string;
  /** User has confirmed they wrote down the BIP-39 phrase. Synced. */
  seedBackedUp: boolean;
  /** User has dismissed the home onboarding checklist. Synced. */
  onboardingDismissed: boolean;
  /** User has dismissed the "nearest community" widget. Synced. */
  nearestDismissed: boolean;
}

const DEFAULT_PREFS: UserPrefs = {
  cities: [], categories: [], language: "cs",
  seedBackedUp: false, onboardingDismissed: false, nearestDismissed: false,
};

function parseCsv(v: string | null | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function stringifyCsv(arr: string[]): string | null {
  const clean = Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
  return clean.length === 0 ? null : clean.join(",");
}

// SqliteBoolean stores 0/1; missing/undefined → false default.
const asBool = (v: unknown): boolean => v === 1 || v === true;

function serverPrefsFrom(row: Record<string, unknown> | null): UserPrefs {
  if (!row) return DEFAULT_PREFS;
  return {
    cities: parseCsv(row.cities as string | null),
    categories: parseCsv(row.categories as string | null),
    language: (row.language as string | null) ?? "cs",
    seedBackedUp: asBool(row.seedBackedUp),
    onboardingDismissed: asBool(row.onboardingDismissed),
    nearestDismissed: asBool(row.nearestDismissed),
  };
}

/**
 * Optimistic, debounced prefs hook.
 *
 * Prior bug: `toggleCity(praha)` immediately followed by `toggleCity(brno)`
 * both read `prefs.cities` from the *same* stale closure (React hadn't
 * re-rendered after the first save yet, and Evolu's write is async), so the
 * second click overwrote the first — only the latest city was saved.
 *
 * Fix: local React state is the source of truth. Toggles use the functional
 * setState form so each click reads the freshest value. Writes are flushed
 * to Evolu on a 300ms debounce so a rapid burst of chip-clicks becomes one
 * merged write. Inbound sync from another device still lands — but only
 * when we don't have a local edit queued, to avoid clobbering pending work.
 */
export function useUserPrefs() {
  const rows = useQuery(userPrefsQuery);
  const { insert, update } = useTypedEvolu();
  const row = rows[0] ?? null;

  const serverPrefs: UserPrefs = useMemo(
    () => serverPrefsFrom(row as Record<string, unknown> | null),
    [row],
  );

  const [prefs, setPrefs] = useState<UserPrefs>(serverPrefs);
  const latestRef = useRef(prefs);
  latestRef.current = prefs;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeToEvolu = useCallback(
    (next: UserPrefs) => {
      const cities = toNES1000(stringifyCsv(next.cities));
      const categories = toNES1000(stringifyCsv(next.categories));
      const language = toNET100(next.language);
      const seed = (next.seedBackedUp ? 1 : 0) as SqliteBoolean;
      const onbo = (next.onboardingDismissed ? 1 : 0) as SqliteBoolean;
      const near = (next.nearestDismissed ? 1 : 0) as SqliteBoolean;

      if (row) {
        // null at runtime clears the optional field (TS types are branded
        // non-null strings, hence the cast).
        update("userPrefs", {
          id: row.id,
          cities: cities as unknown as NonEmptyString1000,
          categories: categories as unknown as NonEmptyString1000,
          ...(language ? { language } : {}),
          seedBackedUp: seed,
          onboardingDismissed: onbo,
          nearestDismissed: near,
        });
      } else {
        // First insert: skip null fields.
        insert("userPrefs", {
          ...(cities ? { cities } : {}),
          ...(categories ? { categories } : {}),
          ...(language ? { language } : {}),
          seedBackedUp: seed,
          onboardingDismissed: onbo,
          nearestDismissed: near,
        });
      }
    },
    [row, insert, update],
  );

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      writeToEvolu(latestRef.current);
    }, 300);
  }, [writeToEvolu]);

  // Adopt remote changes unless we have a pending flush (don't stomp on
  // local user edits mid-stream).
  useEffect(() => {
    if (flushTimerRef.current) return;
    setPrefs(serverPrefs);
  }, [serverPrefs]);

  // Flush pending on unmount so we don't lose the last burst.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
        writeToEvolu(latestRef.current);
      }
    };
  }, [writeToEvolu]);

  const save = useCallback(
    (patch: Partial<UserPrefs>) => {
      setPrefs((p) => ({ ...p, ...patch }));
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const toggleCity = useCallback(
    (slug: string) => {
      setPrefs((p) => {
        const set = new Set(p.cities);
        if (set.has(slug)) set.delete(slug);
        else set.add(slug);
        return { ...p, cities: Array.from(set) };
      });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const toggleCategory = useCallback(
    (slug: string) => {
      setPrefs((p) => {
        const set = new Set(p.categories);
        if (set.has(slug)) set.delete(slug);
        else set.add(slug);
        return { ...p, categories: Array.from(set) };
      });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  return { prefs, save, toggleCity, toggleCategory, hasRow: row !== null };
}

export const _internal = { parseCsv, stringifyCsv, DEFAULT_PREFS };

export type { SqliteBoolean };
