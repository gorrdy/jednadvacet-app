// Modální kvíz pro postup na další tier. Sdílený mezi `<TierSection>`
// v Profilu a `<TierHomeBanner>` na home page. Klient validuje
// "client" otázky přes auto-detection (PWA install, Evolu prefs, Cashu
// wallet stav), "selfattest" otázky uživatel klikne ano/ne, "server"
// otázky validuje backend (tier 4 organizer match, tier 5 referral
// count). Submit → POST /api/user/tier/advance.

import { useEffect, useMemo, useState, type FC } from "react";
import { postTierAdvance, type TierQuestion } from "../lib/tierSystem";
import { hintFor } from "../lib/tierLabels";
import { useClientChecks, type ClientChecks } from "../hooks/useTierChecks";
import { IconCheck } from "./Icons";

interface Props {
  ownerId: string;
  targetTier: number;
  quiz: { name: string; description: string; questions: TierQuestion[] };
  onClose: () => void;
  onSuccess: () => void;
}

export const TierQuizModal: FC<Props> = ({ ownerId, targetTier, quiz, onClose, onSuccess }) => {
  const checks = useClientChecks();
  const [answers, setAnswers] = useState<Record<string, boolean | string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  // Auto-set client answers based on detection. Self-attest answers
  // se NESMĚJÍ resetovat — `checks` má novou referenci na každém renderu
  // (useQuery z Evolu re-runs hodně často), takže effect se pálí
  // pravidelně. Merge-update jen client otázky, selfattest zachovat.
  useEffect(() => {
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of quiz.questions) {
        if (q.type === "client") {
          const k = q.id as keyof ClientChecks;
          next[q.id] = checks[k] === "pass";
        }
      }
      return next;
    });
  }, [quiz, checks]);

  const allReady = useMemo(() => {
    return quiz.questions.every((q) => {
      if (q.type === "client") return answers[q.id] === true;
      if (q.type === "selfattest") return answers[q.id] === true;
      // server: žádný klientský input; submit → server validates and
      // answers s `failed: [<id>]` pokud podmínka neplatí.
      return true;
    });
  }, [quiz, answers]);

  const submit = async () => {
    setSubmitting(true); setError(null); setFailed([]);
    const r = await postTierAdvance(ownerId, targetTier, answers);
    setSubmitting(false);
    if (r.ok) { onSuccess(); return; }
    if (r.error === "checks_failed" && r.failed) {
      setFailed(r.failed);
      setError("Některé podmínky ještě nejsou splněné — viz červeně níže.");
    } else if (r.error === "cooldown_active") {
      const days = Math.ceil((r.cooldownRemainsMs ?? 0) / (24 * 60 * 60 * 1000));
      setError(`Cooldown ještě neuplynul (zbývá ~${days} d). Mezi tiery musí být minimální interval.`);
    } else if (r.error === "must_advance_one_at_a_time") {
      setError("Můžeš postoupit vždy jen o jeden tier. Aktualizuj stránku.");
    } else {
      setError(`Postup selhal: ${r.error ?? "neznámá chyba"}`);
    }
  };

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container tier-quiz" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="tier-quiz-body">
          <h3 style={{ margin: "0 0 0.3rem" }}>Tier {targetTier} — {quiz.name}</h3>
          <p className="small muted" style={{ margin: "0 0 1rem" }}>{quiz.description}</p>

          {quiz.questions.map((q) => (
            <QuestionRow
              key={q.id}
              q={q}
              targetTier={targetTier}
              checks={checks}
              value={answers[q.id]}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              isFailed={failed.includes(q.id)}
            />
          ))}

          {error && <p className="error small" style={{ marginTop: "0.6rem" }}>{error}</p>}

          <div className="row-actions" style={{ marginTop: "1rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={submitting}>
              Zavřít
            </button>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={!allReady || submitting}
              title={!allReady ? "Splň všechny podmínky" : undefined}
            >
              {submitting ? "Posílám…" : `Postoupit na Tier ${targetTier}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const QuestionRow: FC<{
  q: TierQuestion;
  targetTier: number;
  checks: ClientChecks;
  value: boolean | string | undefined;
  onChange: (v: boolean | string) => void;
  isFailed: boolean;
}> = ({ q, targetTier, checks, value, onChange, isFailed }) => {
  const tone = isFailed ? "var(--danger)" : "var(--ink-muted)";
  return (
    <div className="tier-q" style={{ borderLeftColor: tone }}>
      <div className="tier-q-text">{q.text}</div>
      {q.type === "client" && (
        <ClientAnswer q={q} checks={checks} />
      )}
      {q.type === "selfattest" && (
        <div className="tier-q-buttons">
          <button
            className={`btn btn-sm ${value === true ? "btn-primary" : "btn-ghost"}`}
            onClick={() => onChange(true)}
          >
            Ano
          </button>
          <button
            className={`btn btn-sm ${value === false ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => onChange(false)}
          >
            Ne
          </button>
        </div>
      )}
      {q.type === "server" && targetTier === 5 && q.id === "referrals_active" && (
        <p className="small muted" style={{ marginTop: "0.3rem" }}>
          Server zkontroluje sám: kolik lidí přivedených tvým referral linkem dosáhlo
          tieru ≥ 3. Potřebuješ alespoň 3.
        </p>
      )}
    </div>
  );
};

const ClientAnswer: FC<{ q: TierQuestion; checks: ClientChecks }> = ({ q, checks }) => {
  const k = q.id as keyof ClientChecks;
  const result = checks[k];
  if (result === "pass") {
    return (
      <div className="tier-q-result ok">
        <IconCheck style={{ width: 14, height: 14 }} /> Ověřeno
      </div>
    );
  }
  return (
    <div className="tier-q-result fail">
      <span style={{ marginRight: "0.4rem" }}>✗</span>
      {hintFor(q.id)}
    </div>
  );
};

