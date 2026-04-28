// Klientská část tier (úroveň) systému. Zrcadlí backend `tier.js` quiz
// definice + helpery pro auto-detekci client-side podmínek (PWA install,
// vybraná města v Evolu prefs, Cashu wallet stav).
//
// Vlastní postup je iniciovaný klientem voláním
//   POST /api/user/tier/advance { ownerId, targetTier, answers }
// kde `answers` jsou yes/no odpovědi na otázky daného tier quizu.
// Pro tier 4 navíc `eventId`, pro tier 5 nic (server validuje sám).

import { apiGet, apiPost, isApiError } from "./http";
import { LS } from "./storageKeys";

export const MAX_TIER = 5;

export interface TierState {
  tier: number;
  tierName: string;
  maxTier: number;
  referralCode: string | null;
  lastAdvanceAt: string | null;
  cooldownRemainsMs: number;
  canAdvanceAt: string | null;
  nextTier: number | null;
  nextQuiz: TierQuiz | null;
  referralStats: { total: number; activeAtTier3: number };
}

export interface TierQuestion {
  id: string;
  text: string;
  type: "client" | "selfattest" | "server";
}

export interface TierQuiz {
  name: string;
  description: string;
  questions: TierQuestion[];
}

export interface AdvanceResult {
  ok: boolean;
  tier?: number;
  /** Strojově čitelný důvod neúspěchu — "cooldown_active",
   *  "checks_failed", "must_advance_one_at_a_time", "user_tier_not_found",
   *  "HTTP 5xx", atd. */
  error?: string;
  /** ID otázek, které selhaly (pro `error === "checks_failed"`). */
  failed?: string[];
  cooldownRemainsMs?: number;
  canAdvanceAt?: string;
  currentTier?: number;
}

export const TIER_NAMES: Record<number, string> = {
  1: "Nováček",
  2: "Občan komunity",
  3: "Aktivní účastník",
  4: "Pořadatel",
  5: "Onboarding Master",
};

/** Server vrátí tier 1 i pro uživatele bez `user_tier` řádku. */
export async function fetchTierState(ownerId: string): Promise<TierState | null> {
  const r = await apiGet<TierState>(`/api/user/tier/${encodeURIComponent(ownerId)}`);
  if (isApiError(r)) return null;
  return r;
}

export async function postTierAdvance(
  ownerId: string,
  targetTier: number,
  answers: Record<string, unknown>,
): Promise<AdvanceResult> {
  const r = await apiPost<AdvanceResult>("/api/user/tier/advance", {
    ownerId, targetTier, answers,
  });
  if (isApiError(r)) {
    return { ok: false, error: r.error ?? "network_error" };
  }
  return r;
}

export async function postReferralRedeem(
  ownerId: string,
  code: string,
): Promise<{ ok: boolean; referrerOwnerId?: string; error?: string }> {
  const r = await apiPost<{ ok: boolean; referrerOwnerId: string }>("/api/referral/redeem", {
    ownerId, code,
  });
  if (isApiError(r)) return { ok: false, error: r.error };
  return r;
}

// ── Client-side auto-detection helpers ──────────────────────────

/** PWA running in standalone (= installed to home screen). */
export function isPWAInstalled(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari nezná display-mode standalone, používá vlastní vlajku.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Has at least one selected city in Evolu userPrefs.cities? */
export function hasSelectedCities(cities: readonly string[] | undefined): boolean {
  return Array.isArray(cities) && cities.length > 0;
}

/** Did user RSVP "going" to any event? Reads from local Evolu rows. */
export function hasGoingRSVP(rsvps: readonly { status: string }[] | undefined): boolean {
  return Array.isArray(rsvps) && rsvps.some((r) => r.status === "going");
}

/** Did the Cashu wallet successfully mint at least once? */
export function hasMintedSats(txs: readonly { type: string; status: string }[] | undefined): boolean {
  return Array.isArray(txs) && txs.some((t) => t.type === "mint" && t.status === "paid");
}

/** Did the Cashu wallet send or receive sats at least once?
 *  send→paid (recipient claimed) OR send→reclaimed (we got it back) OR
 *  receive→paid (we claimed someone else's token). */
export function hasSendOrReceive(txs: readonly { type: string; status: string }[] | undefined): boolean {
  return (
    Array.isArray(txs) &&
    txs.some((t) =>
      (t.type === "send" && (t.status === "paid" || t.status === "pending" || t.status === "reclaimed")) ||
      (t.type === "receive" && t.status === "paid"),
    )
  );
}

// ── Referral capture ────────────────────────────────────────────

const REFERRAL_KEY = LS.PendingReferral;

/** Při startu appky: pokud URL obsahuje ?ref=CODE, ulož do localStorage
 *  a sundej z URL. Po vytvoření chat_user profilu (POST /api/chat/profile)
 *  klient zkonzumuje uložený kód voláním `redeemPendingReferral(ownerId)`. */
export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref) return;
    if (!/^[A-Z0-9]{4,16}$/i.test(ref)) return;
    // Neoverwriteuj existující pending referral (idempotence — uživatel
    // mohl reload-it stránku se stejným ?ref).
    const existing = localStorage.getItem(REFERRAL_KEY);
    if (!existing) localStorage.setItem(REFERRAL_KEY, ref.toUpperCase());
    // Sundej ?ref= z URL bez reloadu, ať se to nepředává dál ani v
    // share / bookmarku.
    url.searchParams.delete("ref");
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* ignore */
  }
}

/** Po úspěšném vytvoření chat_user profilu zavolej tohle s ownerId.
 *  Pokud máme uložený pending referral, redeemne ho na backendu a smaže
 *  z localStorage. Idempotentní — druhé volání už neudělá nic. */
export async function redeemPendingReferral(ownerId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const code = localStorage.getItem(REFERRAL_KEY);
  if (!code) return false;
  const r = await postReferralRedeem(ownerId, code);
  if (r.ok || r.error === "cannot_self_refer") {
    // Smaž i v cannot_self_refer případě — uživatel kliknul vlastní link,
    // nemá smysl si to pamatovat.
    localStorage.removeItem(REFERRAL_KEY);
    return r.ok;
  }
  // 404 (kód neexistuje) → smázat, ať to neblokuje dál.
  if (r.error === "referral_code_not_found") {
    localStorage.removeItem(REFERRAL_KEY);
  }
  return false;
}

export function buildReferralUrl(code: string, host?: string): string {
  const origin = host ?? (typeof window !== "undefined" ? window.location.origin : "https://jednadvacet.gorrdy.cz");
  return `${origin}/?ref=${encodeURIComponent(code)}`;
}
