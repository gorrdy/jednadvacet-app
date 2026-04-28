// Shared hook pro klientské podmínky tier postupu. Zrcadlí logiku
// `tier.js` quizů — pro každou client-detected otázku zjistí, zda je
// její podmínka splněná. Sdílený mezi `<TierSection>` v Profilu a
// `<TierHomeBanner>` na home page.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@evolu/react";
import { useUserPrefs } from "./usePrefs";
import { useCashu } from "./useCashu";
import { allOverridesQuery } from "../evolu";
import {
  isPWAInstalled, hasSelectedCities, hasGoingRSVP, hasMintedSats, hasSendOrReceive,
} from "../lib/tierSystem";

export type CheckResult = "pass" | "fail";

export interface ClientChecks {
  pwa_installed: CheckResult;
  cities_selected: CheckResult;
  rsvp_attended: CheckResult;
  wallet_minted: CheckResult;
  wallet_send_recv: CheckResult;
}

/**
 * Live cooldown indikátor. Bere absolutní timestamp `canAdvanceAt`
 * ze server response a každou sekundu re-renderuje, takže "Cooldown…"
 * tlačítko se enable přesně v moment, kdy expiruje, bez page refresh.
 *
 * Vrátí `true`, dokud Date.now() < canAdvanceAt; po expiraci `false`.
 * `null` canAdvanceAt = uživatel ještě nikdy nepostoupil → false.
 */
export function useCooldownActive(canAdvanceAt: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canAdvanceAt) return;
    const target = new Date(canAdvanceAt).getTime();
    if (target <= Date.now()) { setNow(Date.now()); return; }
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= target) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [canAdvanceAt]);
  if (!canAdvanceAt) return false;
  return new Date(canAdvanceAt).getTime() > now;
}

export function useClientChecks(): ClientChecks {
  const { prefs } = useUserPrefs();
  const cashu = useCashu();
  const rsvpRows = useQuery(allOverridesQuery);

  const rsvps = useMemo(
    () => rsvpRows.map((r) => ({ status: String(r.status ?? "") })),
    [rsvpRows],
  );

  return {
    pwa_installed: isPWAInstalled() ? "pass" : "fail",
    cities_selected: hasSelectedCities(prefs.cities) ? "pass" : "fail",
    rsvp_attended: hasGoingRSVP(rsvps) ? "pass" : "fail",
    wallet_minted: hasMintedSats(cashu.txs) ? "pass" : "fail",
    wallet_send_recv: hasSendOrReceive(cashu.txs) ? "pass" : "fail",
  };
}
