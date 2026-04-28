// One-time migrations for state moved from per-device localStorage to
// Evolu-synced storage. Each migration runs at most once per *Evolu state*
// (not once per browser): we only write to Evolu if the corresponding
// Evolu field is still empty AND localStorage has the legacy "1" flag.
// Once the prefs row carries the migrated value the localStorage entry
// is removed so the next device that signs in skips this branch.
//
// Called from <AppShell> via useEvoluMigrations().

import { useEffect } from "react";
import { useQuery } from "@evolu/react";
import { allChatReadQuery, userPrefsQuery, useTypedEvolu } from "../evolu";
import { LS } from "./storageKeys";
import { toNET100 } from "./evoluParse";

let didMigratePrefs = false;
let didMigrateChatRead = false;

export function useEvoluMigrations(): void {
  const prefRows = useQuery(userPrefsQuery);
  const readRows = useQuery(allChatReadQuery);
  const { insert, update } = useTypedEvolu();

  // ── userPrefs: SeedBackedUp / OnboardingDismissed / NearestDismissed ──
  useEffect(() => {
    if (didMigratePrefs) return;
    const row = prefRows[0];
    if (!row) return; // No prefs row yet — bootstrap creates one once user touches a setting; nothing to migrate against.
    didMigratePrefs = true;

    const lsRead = (key: string) => {
      try { return localStorage.getItem(key); } catch { return null; }
    };
    const lsClear = (key: string) => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    };

    const seedLegacy = lsRead(LS.SeedBackedUp) === "1";
    const onboLegacy = lsRead(LS.OnboardingDismissed) === "1";
    const nearLegacy = lsRead(LS.NearestDismissed) === "1";

    // SqliteBoolean stores 0/1; treat absent or 0 as "still default".
    const seedNow = row.seedBackedUp === 1;
    const onboNow = row.onboardingDismissed === 1;
    const nearNow = row.nearestDismissed === 1;

    const patches: Record<string, 1> = {};
    if (seedLegacy && !seedNow) patches.seedBackedUp = 1;
    if (onboLegacy && !onboNow) patches.onboardingDismissed = 1;
    if (nearLegacy && !nearNow) patches.nearestDismissed = 1;

    if (Object.keys(patches).length > 0) {
      update("userPrefs", { id: row.id, ...patches } as never);
      console.info("[migrate] copied prefs flags from localStorage to Evolu:", Object.keys(patches));
    }

    // Wipe legacy flags whether or not we wrote anything new — once Evolu
    // is the source of truth on this device, localStorage is redundant.
    lsClear(LS.SeedBackedUp);
    lsClear(LS.OnboardingDismissed);
    lsClear(LS.NearestDismissed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefRows.length === 0 ? null : prefRows[0]?.id]);

  // ── chatRead: per-channel lastRead timestamps ─────────────────────
  useEffect(() => {
    if (didMigrateChatRead) return;
    didMigrateChatRead = true;

    const existingSlugs = new Set(readRows.map((r) => String(r.slug ?? "")));
    const legacyKeys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS.ChatReadPrefix)) legacyKeys.push(k);
      }
    } catch { /* ignore */ }
    if (legacyKeys.length === 0) return;

    let imported = 0;
    for (const k of legacyKeys) {
      let iso: string | null = null;
      try { iso = localStorage.getItem(k); } catch { /* ignore */ }
      const slug = k.slice(LS.ChatReadPrefix.length);
      if (slug && iso && !existingSlugs.has(slug)) {
        const slugV = toNET100(slug);
        const isoV = toNET100(iso);
        if (slugV && isoV) {
          insert("chatRead", { slug: slugV, lastReadAt: isoV });
          imported++;
        }
      }
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    if (imported > 0) {
      console.info(`[migrate] imported ${imported} chatRead entries from localStorage`);
    }
    // Run once per app load — readRows is captured fresh; new chatRead
    // mutations after this don't re-trigger us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
