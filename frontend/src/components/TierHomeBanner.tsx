// Kompaktní progress banner nahoře na home page. Ukáže aktuální tier
// + co ještě zbývá pro postup na další tier (jen unmet podmínky), s
// CTA tlačítkem na pokus o postup hned tady (otevře `<TierQuizModal>`).
//
// Záměrně agresivně viditelné — onboarding je nejdůležitější motivátor
// hned po prvním otevření appky. Plný řízený postup (referral link,
// detail, atd.) je dostupný v Profile → Profil → tier section.

import { useEffect, useState, type FC } from "react";
import { use } from "react";
import { evolu } from "../evolu";
import { useChatProfile } from "../hooks/useChatProfile";
import { useClientChecks, useCooldownActive, type ClientChecks } from "../hooks/useTierChecks";
import {
  fetchTierState, buildReferralUrl, TIER_NAMES,
  type TierState, type TierQuestion,
} from "../lib/tierSystem";
import { hintFor, shortLabel } from "../lib/tierLabels";
import { TierQuizModal } from "./TierQuizModal";
import { ReferralShareModal } from "./ReferralShareModal";
import { IconCheck } from "./Icons";

export const TierHomeBanner: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;
  const { profile } = useChatProfile();
  const checks = useClientChecks();
  const [state, setState] = useState<TierState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Tick každou sekundu během cooldownu, ať se "Cooldown…" tlačítko
  // samo enable hned po expiraci absolutního `canAdvanceAt` timestampu.
  // Hooky musí být volané unconditionally, takže `canAdvanceAt` čteme
  // i když je null.
  const cooldownActive = useCooldownActive(state?.canAdvanceAt ?? null);

  const refresh = async () => {
    setLoading(true);
    const s = await fetchTierState(ownerId);
    setState(s);
    setLoading(false);
  };

  useEffect(() => {
    if (!profile) { setLoading(false); return; }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, profile?.ownerId]);

  // Nemáme profile (= chat_user) → tier systém nedává smysl.
  // Místo skrytí bannerů ukážeme onboarding hint, ať uživatel ví,
  // kde profil najde.
  if (!profile) {
    return (
      <section className="tier-banner tier-banner-prompt">
        <div className="tier-banner-head">
          <span className="tier-banner-title">Vítej v komunitě</span>
        </div>
        <p className="small" style={{ margin: "0.4rem 0 0.6rem" }}>
          Začni nastavením přezdívky v Profilu — pak se zobrazí tvoje úroveň
          a co dál pro postup.
        </p>
      </section>
    );
  }

  if (loading || !state) return null; // tichý — nezasekáváme home obrazovku
  if (state.tier >= state.maxTier) {
    return (
      <section className="tier-banner tier-banner-max">
        <span>🏆 <strong>Onboarding Master</strong> — nejvyšší tier dosažen.</span>
      </section>
    );
  }
  if (!state.nextQuiz || !state.nextTier) return null;

  const unmet = unmetQuestions(state.nextQuiz.questions, checks, state.nextTier);
  const allMet = unmet.length === 0;

  return (
    <section className="tier-banner">
      <div className="tier-banner-head">
        <div>
          <span className="tier-banner-tier">Tier {state.tier}</span>
          <span className="tier-banner-name muted small"> · {state.tierName}</span>
        </div>
        <button
          className={`btn btn-sm ${allMet && !cooldownActive ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setShowQuiz(true)}
          disabled={cooldownActive}
          title={cooldownActive ? "Cooldown ještě neuplynul" : undefined}
        >
          {cooldownActive ? "Cooldown…" : `Postoupit na T${state.nextTier}`}
        </button>
      </div>

      <div className="tier-banner-progress small">
        Pro <strong>Tier {state.nextTier} — {TIER_NAMES[state.nextTier]}</strong>:
      </div>

      <ul className="tier-checklist">
        {state.nextQuiz.questions.map((q) => {
          const isUnmet = unmet.some((u) => u.id === q.id);
          return (
            <li key={q.id} className={isUnmet ? "unmet" : "met"}>
              <span className="tier-check-icon">
                {isUnmet ? <span aria-hidden="true">○</span> : <IconCheck style={{ width: 14, height: 14 }} />}
              </span>
              <div className="tier-check-body">
                <div>{shortLabel(q)}</div>
                {isUnmet && <div className="muted small tier-check-hint">{hintFor(q.id)}</div>}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Referral CTA — only for tier 2+ users (we trust them enough that
          they'll bring real people) AND only when there's a referral code.
          Position below the checklist so it doesn't compete with quiz CTA. */}
      {state.tier >= 2 && state.referralCode && (
        <div className="tier-banner-invite">
          <div className="small muted">
            Pozvi kamaráda
            {state.referralStats.activeAtTier3 > 0 && (
              <span style={{ marginLeft: "0.4rem", color: "var(--ok)" }}>
                ({state.referralStats.activeAtTier3}/3 tier ≥ 3)
              </span>
            )}
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowShare(true)}>
            🔗 Sdílet pozvánku
          </button>
        </div>
      )}

      {showQuiz && (
        <TierQuizModal
          ownerId={ownerId}
          targetTier={state.nextTier}
          quiz={state.nextQuiz}
          onClose={() => setShowQuiz(false)}
          onSuccess={async () => { setShowQuiz(false); await refresh(); }}
        />
      )}

      {showShare && state.referralCode && (
        <ReferralShareModal
          url={buildReferralUrl(state.referralCode)}
          code={state.referralCode}
          total={state.referralStats.total}
          activeAtTier3={state.referralStats.activeAtTier3}
          onClose={() => setShowShare(false)}
        />
      )}
    </section>
  );
};

/** Pro otázky typu "client" zkontroluj `checks` mapu; "selfattest" jsou
 *  vždy unmet dokud se uživatel neotevře modal (server validuje submit);
 *  "server" otázky jsou unmet dokud server nepotvrdí (taky jen ve modalu). */
function unmetQuestions(
  questions: readonly TierQuestion[],
  checks: ClientChecks,
  _targetTier: number,
): readonly TierQuestion[] {
  return questions.filter((q) => {
    if (q.type === "client") {
      const k = q.id as keyof ClientChecks;
      return checks[k] !== "pass";
    }
    // selfattest + server: ukážeme jako "unmet" v home banneru, ať to
    // uživatel klikne v modalu (kde si to potvrdí / kde to server zvalidu).
    return true;
  });
}

