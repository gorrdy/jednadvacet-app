// Tier system + referral endpoints (public — used by user frontend).
// Tier state lookup, quiz definitions, advancement, and the
// referral-redeem endpoint that ties a `?ref=CODE` URL to an
// app-owner pair.
//
// All real logic lives in src/tier.js; these are thin HTTP wrappers.

import { validOwnerId } from "../helpers.js";
import {
  ensureUserTier,
  getTierState,
  attemptAdvance,
  lookupReferrer,
  recordReferral,
  getReferralStats,
  QUIZZES,
  TIER_NAMES,
  MAX_TIER,
} from "../tier.js";

export function mountTierPublicRoutes(app) {
  // ── Tier state + quizzes ──────────────────────────────────
  // Klient si některé otázky validuje sám (PWA install, Cashu wallet
  // stav z Evolu); server doplňuje to, co vyžaduje backend data
  // (events organized, referral stats).

  app.get("/api/user/tier/:ownerId", (req, res) => {
    const { ownerId } = req.params;
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    const state = getTierState(ownerId);
    if (!state) return res.status(404).json({ error: "no_chat_profile" });
    res.json({
      ...state,
      tierName: TIER_NAMES[state.tier],
      maxTier: MAX_TIER,
      nextQuiz: state.nextTier ? QUIZZES[state.nextTier] : null,
      referralStats: getReferralStats(ownerId),
    });
  });

  app.get("/api/user/tier-quizzes", (_req, res) => {
    res.json({ quizzes: QUIZZES, tierNames: TIER_NAMES, maxTier: MAX_TIER });
  });

  app.post("/api/user/tier/advance", (req, res) => {
    const { ownerId, targetTier, answers } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof targetTier !== "number") return res.status(400).json({ error: "targetTier required" });
    const result = attemptAdvance(ownerId, targetTier, answers || {});
    if (!result.ok) {
      // Klient čte `error`; pro zpětnou kompatibilitu necháváme i `reason`.
      return res.status(400).json({ ...result, error: result.reason });
    }
    res.json(result);
  });

  // ── Referral ──────────────────────────────────────────────────
  // Přijdeš na app s `?ref=CODE` v URL → klient po vytvoření chat_user
  // pošle code+ownerId sem; server zaeviduje vztah (referrer →
  // referred). Tier 5 ho pak započítá. Idempotentní: druhý pokus
  // o referral pro stejného `referredOwnerId` se ignoruje.

  app.post("/api/referral/redeem", (req, res) => {
    const { code, ownerId } = req.body || {};
    if (!validOwnerId(ownerId)) return res.status(400).json({ error: "bad ownerId" });
    if (typeof code !== "string" || !code.trim()) return res.status(400).json({ error: "bad code" });
    const referrer = lookupReferrer(code);
    if (!referrer) return res.status(404).json({ error: "referral_code_not_found" });
    if (referrer.owner_id === ownerId) return res.status(400).json({ error: "cannot_self_refer" });
    // Zajistí, že referrer i referred mají user_tier řádek.
    ensureUserTier(referrer.owner_id);
    ensureUserTier(ownerId);
    const ok = recordReferral(referrer.owner_id, ownerId);
    if (!ok) return res.status(500).json({ error: "record_failed" });
    res.json({ ok: true, referrerOwnerId: referrer.owner_id });
  });
}
