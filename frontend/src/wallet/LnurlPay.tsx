// LNURL-pay (LUD-06) flow: user scans a pay QR or types a Lightning
// Address → wallet fetches the payRequest spec → user picks an amount
// (and optional comment per LUD-12) → wallet GETs the callback to
// receive a BOLT-11 invoice → wallet melts ecash to pay it →
// successAction (LUD-09) is shown afterwards if the service supplied
// one.
//
// The melt step reuses the same `meltToInvoice` path the manual Melt
// view uses, so transaction history shape is identical.

import { useEffect, useMemo, useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import {
  fetchLnurlSpec,
  fetchLnurlPayInvoice,
  parseLnurlPayMetadata,
  verifyLnurlPayInvoice,
  type LnurlPaySpec,
  type LnurlSuccessAction,
} from "../lib/lnurl";
import { ErrorBox } from "../components/ErrorBox";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { WalletHeader } from "./shared";

interface Props {
  url: string;
  onBack: () => void;
}

export const LnurlPayView: FC<Props> = ({ url, onBack }) => {
  const cashu = useCashu();
  const mintUrl = cashu.activeMintUrl;

  const [spec, setSpec] = useState<LnurlPaySpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [phase, setPhase] = useState<"input" | "fetching-invoice" | "paying" | "done">("input");
  const [paid, setPaid] = useState<{ amount: number; fee: number } | null>(null);
  const [successAction, setSuccessAction] = useState<LnurlSuccessAction | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchLnurlSpec(url)
      .then((s) => {
        if (!mounted) return;
        if (s.tag !== "payRequest") {
          setErr(`Tento LNURL je typu ${s.tag}, ne payRequest. Použij QR scan z hlavní obrazovky.`);
          setLoading(false);
          return;
        }
        setSpec(s);
        // Default amount = minSendable (smallest button-press flow).
        // Many services have min = max (fixed price) or a single
        // commonly-paid amount worth pre-filling.
        const minSats = Math.floor(s.minSendable / 1000);
        setAmount(String(minSats));
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!mounted) return;
        setErr(e.message ?? "LNURL fetch selhal");
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [url]);

  const meta = useMemo(() => spec ? parseLnurlPayMetadata(spec.metadata) : null, [spec]);
  const minSats = spec ? Math.floor(spec.minSendable / 1000) : 0;
  const maxSats = spec ? Math.floor(spec.maxSendable / 1000) : 0;
  const fixedAmount = spec ? spec.minSendable === spec.maxSendable : false;
  const commentMax = spec?.commentAllowed ?? 0;

  const submit = async () => {
    if (!spec || !mintUrl) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n < minSats || n > maxSats) {
      setErr(`Částka musí být ${minSats === maxSats ? `přesně ${minSats}` : `${minSats}–${maxSats}`} sats.`);
      return;
    }
    setErr(null);
    setPhase("fetching-invoice");
    try {
      // 1. Pull the BOLT-11 invoice from the LNURL service callback.
      const trimmedComment = comment.trim().slice(0, commentMax);
      const r = await fetchLnurlPayInvoice(
        spec.callback,
        n * 1000,
        trimmedComment ? trimmedComment : undefined,
      );
      // 2. LUD-06 MUST: verify the invoice's description-hash matches
      //    sha256(metadata) — guards against the service substituting a
      //    different invoice than what was advertised.
      verifyLnurlPayInvoice(r.pr, spec.metadata);
      // 3. Pay it from our active Cashu mint via melt.
      setPhase("paying");
      const result = await cashu.meltToInvoice(mintUrl, r.pr);
      // 3. Show success + any LUD-09 successAction the service returned.
      setPaid(result);
      setSuccessAction(r.successAction ?? null);
      setPhase("done");
    } catch (e) {
      setErr((e as Error).message ?? "LNURL pay selhal");
      setPhase("input");
    }
  };

  if (loading) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL platba" />
        <LoadingSpinner label="Načítám LNURL službu…" />
      </div>
    );
  }

  if (!spec) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL platba" />
        <div className="card">
          <h3>LNURL nešel načíst</h3>
          <ErrorBox message={err ?? "Neznámá chyba."} />
          <button className="btn btn-secondary mt-md" onClick={onBack}>Zpět</button>
        </div>
      </div>
    );
  }

  if (phase === "done" && paid) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL platba" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>⚡</div>
          <h2>Zaplaceno</h2>
          <p className="hint">{paid.amount.toLocaleString("cs-CZ")} sats (poplatek ~{paid.fee} sats)</p>
        </div>
        {successAction && <SuccessActionCard action={successAction} />}
        <div className="row-actions mt-md" style={{ justifyContent: "center" }}>
          <button className="btn btn-secondary" onClick={onBack}>Hotovo</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="LNURL platba" />
      <div className="card">
        {meta?.identifier && (
          <p className="small mono muted" style={{ marginTop: 0 }}>{meta.identifier}</p>
        )}
        {meta?.description && <p className="hint">{meta.description}</p>}
        {meta?.longDescription && (
          <details style={{ marginTop: "0.4rem" }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>Detaily</summary>
            <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: "0.4rem" }}>
              {meta.longDescription}
            </p>
          </details>
        )}
        <p className="small muted">
          Příjemce: <span className="mono">{hostFromUrl(spec.callback)}</span>
        </p>

        <div className="form mt-md">
          <div className="field">
            <label>
              Částka {fixedAmount
                ? <span className="small muted">(pevná)</span>
                : <span className="small muted">({minSats.toLocaleString("cs-CZ")}–{maxSats.toLocaleString("cs-CZ")} sats)</span>}
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              readOnly={fixedAmount}
              onChange={(e) => setAmount(e.target.value)}
              min={minSats}
              max={maxSats}
            />
          </div>
          {commentMax > 0 && (
            <div className="field">
              <label>
                Komentář <span className="small muted">(max {commentMax} znaků)</span>
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, commentMax))}
                maxLength={commentMax}
                placeholder="Volitelná zpráva pro příjemce"
              />
            </div>
          )}
          <ErrorBox message={err} small />
          {!mintUrl && (
            <ErrorBox message="Nemáš aktivní mint. Otevři Peněženka → Nastavení mintu." small />
          )}
          <div className="row-actions mt-md">
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={phase !== "input" || !mintUrl}
            >
              {phase === "fetching-invoice" ? "Vyžaduji invoice…"
               : phase === "paying" ? "Platím…"
               : `Zaplatit ${Number(amount || 0).toLocaleString("cs-CZ")} sats`}
            </button>
            <button className="btn btn-ghost" onClick={onBack}>Zpět</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SuccessActionCard: FC<{ action: LnurlSuccessAction }> = ({ action }) => {
  if (action.tag === "message") {
    return (
      <div className="card mt-md" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
        <h4 style={{ marginTop: 0 }}>Zpráva od příjemce</h4>
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{action.message}</p>
      </div>
    );
  }
  if (action.tag === "url") {
    return (
      <div className="card mt-md" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
        <h4 style={{ marginTop: 0 }}>Odkaz od příjemce</h4>
        {action.description && <p>{action.description}</p>}
        <a className="btn btn-secondary btn-sm" href={action.url} target="_blank" rel="noopener noreferrer">
          Otevřít odkaz
        </a>
        <p className="small muted mt-sm" style={{ wordBreak: "break-all", margin: "0.4rem 0 0" }}>
          {action.url}
        </p>
      </div>
    );
  }
  // AES — we don't decrypt yet (LUD-10). Show placeholder so user knows
  // the service tried to send something but our wallet can't read it.
  return (
    <div className="card mt-md">
      <h4 style={{ marginTop: 0 }}>Šifrovaná zpráva</h4>
      <p className="small muted">
        Příjemce poslal šifrovanou zprávu (LUD-10). Aktuálně ji neumíme rozšifrovat —
        otevři peněženku, která LUD-10 podporuje.
      </p>
    </div>
  );
};

function hostFromUrl(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}
