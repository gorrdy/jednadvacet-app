// Tier (úroveň) sekce v Profile tabu. Zobrazí aktuální tier, popis dalšího
// tieru, podmínky postupu, tlačítko "Pokus o postup" → quiz modal. Plus
// referral link pro přivedení nových uživatelů (potřeba pro tier 5).
//
// Reusable části:
//   - `useClientChecks` (hooks/useTierChecks)
//   - `TierQuizModal` (components/TierQuizModal)
// Sdílí je s `<TierHomeBanner>`, který ukazuje stejnou progresi nahoře
// na home page jako quick checklist.

import { useEffect, useState, type FC } from "react";
import {
  fetchTierState, buildReferralUrl, TIER_NAMES,
  type TierState,
} from "../lib/tierSystem";
import { useCooldownActive } from "../hooks/useTierChecks";
import { TierQuizModal } from "./TierQuizModal";
import { ReferralShareModal } from "./ReferralShareModal";
import { IconCopy } from "./Icons";

function formatRemaining(canAdvanceAt: string): string {
  const ms = new Date(canAdvanceAt).getTime() - Date.now();
  if (ms <= 0) return "0";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h`;
  const mins = Math.ceil(ms / 60_000);
  return `${mins} min`;
}

interface Props { ownerId: string; }

export const TierSection: FC<Props> = ({ ownerId }) => {
  const [state, setState] = useState<TierState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const cooldownActive = useCooldownActive(state?.canAdvanceAt ?? null);

  const refresh = async () => {
    setLoading(true);
    const s = await fetchTierState(ownerId);
    setState(s);
    setLoading(false);
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ownerId]);

  if (loading || !state) return <div className="loading" style={{ padding: "0.4rem 0" }}>Načítám tier…</div>;

  const referralUrl = state.referralCode ? buildReferralUrl(state.referralCode) : null;

  return (
    <section className="card tier-section">
      <div className="tier-head">
        <div>
          <div className="small muted">Tvoje úroveň</div>
          <div className="tier-now">
            <span className="tier-num">Tier {state.tier}</span>
            <span className="tier-name">{state.tierName}</span>
          </div>
        </div>
        {state.tier < state.maxTier && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowQuiz(true)}>
            Pokus o postup
          </button>
        )}
      </div>

      {state.nextTier && state.nextQuiz && (
        <p className="small muted" style={{ marginTop: "0.6rem" }}>
          Další: <strong>Tier {state.nextTier} — {TIER_NAMES[state.nextTier]}</strong>.{" "}
          {state.nextQuiz.description}
        </p>
      )}

      {cooldownActive && state.canAdvanceAt && (
        <p className="small" style={{ color: "var(--ink-muted)", marginTop: "0.4rem" }}>
          ⏳ Další pokus o postup za <strong>{formatRemaining(state.canAdvanceAt)}</strong>.
        </p>
      )}

      {state.tier === state.maxTier && (
        <p className="small" style={{ color: "var(--ember)", marginTop: "0.4rem" }}>
          🏆 Onboarding Master — nejvyšší tier dosažen.
        </p>
      )}

      {referralUrl && state.referralCode && (
        <div className="tier-referral">
          <div className="small muted" style={{ marginBottom: "0.4rem" }}>
            Pozvi kamaráda
            {state.referralStats.activeAtTier3 > 0 && (
              <span style={{ marginLeft: "0.4rem", color: "var(--ok)" }}>
                ({state.referralStats.activeAtTier3}/3 tier ≥ 3)
              </span>
            )}
          </div>
          <button className="btn btn-secondary" onClick={() => setShowShare(true)}>
            <IconCopy style={{ width: 14, height: 14 }} /> Sdílet pozvánku
          </button>
        </div>
      )}

      {showQuiz && state.nextTier && state.nextQuiz && (
        <TierQuizModal
          ownerId={ownerId}
          targetTier={state.nextTier}
          quiz={state.nextQuiz}
          onClose={() => setShowQuiz(false)}
          onSuccess={async () => { setShowQuiz(false); await refresh(); }}
        />
      )}

      {showShare && referralUrl && state.referralCode && (
        <ReferralShareModal
          url={referralUrl}
          code={state.referralCode}
          total={state.referralStats.total}
          activeAtTier3={state.referralStats.activeAtTier3}
          onClose={() => setShowShare(false)}
        />
      )}
    </section>
  );
};
