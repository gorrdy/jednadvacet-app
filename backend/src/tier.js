// Tier (úroveň) systém — quiz-gated progression mezi 5 tiery s 7-denním
// cooldownem. Klient si některé podmínky ověřuje sám (PWA install, lokální
// Cashu wallet stav, Evolu prefs), server doplňuje ty, které vyžadují
// backend data (events organized by user, RSVP counts, referral statistics).
//
// Postup je vždy iniciovaný klientem voláním
//   POST /api/user/tier/advance { ownerId, targetTier, answers }
// kde `answers` jsou odpovědi (yes/no) na otázky daného tier quizu plus
// případně doplňující ID (např. eventId pro tier 4). Server validuje,
// zkontroluje cooldown, a zapíše nový tier nebo vrátí 400 se seznamem
// nesplněných podmínek.

import crypto from "node:crypto";
import { db } from "./db.js";
import { TIER_COOLDOWN_MS } from "./config.js";

export const MAX_TIER = 5;

// Quiz defs. Klient zrcadlí questions + auto-detection logic; server
// validuje odpovědi a doplňuje server-side checks (`serverCheck`).
//
// Question types:
//   - "selfattest" — klient nemůže auto-detect, je to čestné prohlášení
//   - "client"     — klient detekuje stav (PWA, prefs, Cashu wallet) a
//                    posílá hotovou odpověď; server jen důvěřuje
//   - "server"     — server validuje sám (RSVP počty, referrals)
export const QUIZZES = {
  2: {
    name: "Občan komunity",
    description:
      "Krok 2 znamená, že máš appku na ploše, vybral sis svoje města a zapojil ses do alespoň jedné Signal skupiny.",
    questions: [
      {
        id: "pwa_installed",
        text: "Máš appku přidanou na plochu (Add to Home Screen)?",
        type: "client",
      },
      {
        id: "cities_selected",
        text: "Vybral jsi alespoň jedno město zájmu v Nastavení?",
        type: "client",
      },
      {
        id: "signal_joined",
        text: "Připojil ses do alespoň jedné Signal skupiny komunity?",
        type: "selfattest",
      },
    ],
  },
  3: {
    name: "Aktivní účastník",
    description:
      "Tier 3 znamená, že jsi byl na meetupu, vyzkoušel jsi peněženku a přijal nebo poslal saty.",
    questions: [
      {
        id: "rsvp_attended",
        text: "Šel jsi na nějakou akci, na kterou jsi RSVP přes appku?",
        type: "client",
      },
      {
        id: "wallet_minted",
        text: "Nabil jsi peněženku libovolnou částkou (přes Lightning)?",
        type: "client",
      },
      {
        id: "wallet_send_recv",
        text: "Poslal nebo přijal jsi nějaké satoshi přes ecash?",
        type: "client",
      },
    ],
  },
  4: {
    name: "Pořadatel",
    description:
      "Tier 4 znamená, že jsi pořádal nebo spolupořádal meetup ve svém městě, kam přišli alespoň 3 lidi.",
    questions: [
      {
        id: "organized_event",
        text: "Pořádal nebo spolupořádal jsi meetup, kam přišlo ≥ 3 lidí?",
        type: "selfattest",
        // Self-attest — žádné server-side ověření. Honor system na
        // úrovni komunity. Pokud někdo zalže, je to společenský problém,
        // ne technický.
      },
    ],
  },
  5: {
    name: "Onboarding Master",
    description:
      "Tier 5 získává ten, kdo přivedl alespoň 3 nové lidi přes svůj referral odkaz a všichni dosáhli tieru 3.",
    questions: [
      {
        id: "referrals_active",
        text: "Přivedl jsi alespoň 3 lidi přes svůj referral odkaz a všichni dosáhli tieru 3?",
        type: "server",
        // Server validuje: COUNT(referral WHERE referrer=ownerId AND referred.tier >= 3) >= 3
      },
    ],
  },
};

export const TIER_NAMES = {
  1: "Nováček",
  2: "Občan komunity",
  3: "Aktivní účastník",
  4: "Pořadatel",
  5: "Onboarding Master",
};

/** Generate krátký unikátní referral kód (8 znaků base32). */
function generateReferralCode() {
  // 5 bytů = 8 base32 znaků. base32 bez paddingu, bez 0/O/I/1 substitucí.
  const bytes = crypto.randomBytes(5);
  return bytes.toString("base64url").replace(/[_-]/g, "").slice(0, 8).toUpperCase();
}

/** Zaručí, že daný owner má řádek v user_tier (s default tier=1 a referral
 *  code). Volat až poté, co byl vytvořen řádek v `chat_user` (FK). Pokud
 *  chat_user neexistuje, vrací null bez chyby — pro callera to znamená
 *  "user ještě nemá profil, vytvoř ho první". */
export function ensureUserTier(ownerId) {
  if (!ownerId) return null;
  const existing = db.prepare("SELECT * FROM user_tier WHERE owner_id = ?").get(ownerId);
  if (existing) return existing;
  // FK guard — bez chat_user řádku by INSERT spadl. Vrať null, ať volající
  // ví, že má nejdřív vytvořit profil.
  const userExists = db.prepare("SELECT 1 FROM chat_user WHERE owner_id = ?").get(ownerId);
  if (!userExists) return null;

  // Vygeneruj unikátní referral kód s retry pro extrémně nepravděpodobnou kolizi.
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateReferralCode();
    const clash = db.prepare("SELECT 1 FROM user_tier WHERE referral_code = ?").get(code);
    if (!clash) break;
    code = null;
  }
  if (!code) throw new Error("could not generate unique referral code");

  db.prepare(
    "INSERT INTO user_tier (owner_id, tier, referral_code) VALUES (?, 1, ?)",
  ).run(ownerId, code);
  return db.prepare("SELECT * FROM user_tier WHERE owner_id = ?").get(ownerId);
}

export function getTierState(ownerId) {
  const row = ensureUserTier(ownerId);
  if (!row) return null;
  const lastAdvance = row.last_advance_at ? new Date(row.last_advance_at).getTime() : 0;
  const now = Date.now();
  const cooldownRemainsMs = Math.max(0, lastAdvance + TIER_COOLDOWN_MS - now);
  return {
    tier: row.tier,
    referralCode: row.referral_code,
    lastAdvanceAt: row.last_advance_at,
    cooldownRemainsMs,
    canAdvanceAt: lastAdvance > 0 ? new Date(lastAdvance + TIER_COOLDOWN_MS).toISOString() : null,
    nextTier: row.tier < MAX_TIER ? row.tier + 1 : null,
  };
}

/**
 * Pokus o postup na targetTier. Vrací:
 *   - { ok: true, tier: N } — postup úspěšný
 *   - { ok: false, reason: string, failed?: string[] } — důvod neúspěchu
 *
 * Ověření:
 *   - cooldown (1 týden)
 *   - target == current + 1
 *   - všechny answers === true
 *   - server-side validace pro tier 4 (event organizer + going count)
 *     a tier 5 (3 referovaných s tier ≥ 3)
 */
export function attemptAdvance(ownerId, targetTier, answers) {
  const state = getTierState(ownerId);
  if (!state) return { ok: false, reason: "user_tier_not_found" };

  if (typeof targetTier !== "number" || !Number.isInteger(targetTier)) {
    return { ok: false, reason: "invalid_target_tier" };
  }
  if (targetTier !== state.tier + 1) {
    return { ok: false, reason: "must_advance_one_at_a_time", currentTier: state.tier };
  }
  if (targetTier > MAX_TIER) {
    return { ok: false, reason: "already_max_tier" };
  }
  if (state.cooldownRemainsMs > 0) {
    return {
      ok: false,
      reason: "cooldown_active",
      cooldownRemainsMs: state.cooldownRemainsMs,
      canAdvanceAt: state.canAdvanceAt,
    };
  }

  const quiz = QUIZZES[targetTier];
  if (!quiz) return { ok: false, reason: "no_quiz_for_tier" };

  const failed = [];

  // 1) klientské + selfattest otázky musí mít odpověď === true
  for (const q of quiz.questions) {
    if (q.type === "client" || q.type === "selfattest") {
      if (answers?.[q.id] !== true) failed.push(q.id);
    }
  }

  // 2) server-side validace
  for (const q of quiz.questions) {
    if (q.type !== "server") continue;
    if (targetTier === 5 && q.id === "referrals_active") {
      const ok = validateReferrals(ownerId);
      if (!ok) failed.push(q.id);
    } else {
      failed.push(q.id); // unknown server question → fail safe
    }
  }

  if (failed.length > 0) {
    return { ok: false, reason: "checks_failed", failed };
  }

  // Vše OK — zapsat advancement
  const now = new Date().toISOString();
  const advancedCol = `advanced_at_${targetTier}`;
  db.prepare(
    `UPDATE user_tier SET tier = ?, last_advance_at = ?, ${advancedCol} = ? WHERE owner_id = ?`,
  ).run(targetTier, now, now, ownerId);

  return { ok: true, tier: targetTier, advancedAt: now };
}

function validateReferrals(ownerId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS c
    FROM referral r
    JOIN user_tier t ON t.owner_id = r.referred_owner_id
    WHERE r.referrer_owner_id = ? AND t.tier >= 3
  `).get(ownerId);
  return (row?.c ?? 0) >= 3;
}

/** Najdi referrer-a podle kódu. Použito při onboarding nového uživatele. */
export function lookupReferrer(referralCode) {
  if (typeof referralCode !== "string" || !referralCode) return null;
  return db
    .prepare("SELECT owner_id FROM user_tier WHERE referral_code = ?")
    .get(referralCode.trim().toUpperCase());
}

/** Zaregistruj `referredOwnerId` jako přivedeného `referrerOwnerId`-em.
 *  Idempotentní: pokud už existuje záznam pro `referredOwnerId`, ignoruje. */
export function recordReferral(referrerOwnerId, referredOwnerId) {
  if (!referrerOwnerId || !referredOwnerId) return false;
  if (referrerOwnerId === referredOwnerId) return false; // sebe nemůžeš přivést
  try {
    db.prepare(
      "INSERT OR IGNORE INTO referral (referrer_owner_id, referred_owner_id) VALUES (?, ?)",
    ).run(referrerOwnerId, referredOwnerId);
    return true;
  } catch (e) {
    console.warn("[referral] record failed:", e.message);
    return false;
  }
}

/** Statistiky pro UI: kolik referralů jsem provedl, kolik z nich je tier ≥ 3. */
export function getReferralStats(ownerId) {
  const total = db
    .prepare("SELECT COUNT(*) AS c FROM referral WHERE referrer_owner_id = ?")
    .get(ownerId).c;
  const active = db
    .prepare(`
      SELECT COUNT(*) AS c
      FROM referral r
      JOIN user_tier t ON t.owner_id = r.referred_owner_id
      WHERE r.referrer_owner_id = ? AND t.tier >= 3
    `)
    .get(ownerId).c;
  return { total, activeAtTier3: active };
}
