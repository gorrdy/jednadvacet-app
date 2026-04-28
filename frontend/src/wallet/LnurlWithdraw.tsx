// LNURL-withdraw flow: scanned QR → spec fetch → user picks amount in
// the allowed range → wallet creates a mint quote (= BOLT-11 invoice
// from the active Cashu mint) → invoice is handed to the LNURL service
// callback → service pays it → wallet polls the mint quote and mints
// proofs once `state === PAID`.
//
// Design notes:
//   • Amount is in *sats*. The spec returns millisats; we divide by
//     1000 for both UI and the eventual mint quote.
//   • If min === max, the amount input is read-only — the spec dictates
//     the withdraw amount (faucets often work this way).
//   • Polling cadence + tx accounting reuses the same machinery as the
//     ordinary "request invoice" Receive flow, so this lights up in
//     transaction history identically.

import { useEffect, useRef, useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { fetchLnurlWithdrawSpec, submitLnurlInvoice, type LnurlWithdrawSpec } from "../lib/lnurl";
import { WalletHeader } from "./shared";

interface Props {
  url: string;
  onBack: () => void;
  /** LUD-08 fast-path: caller has already extracted the spec from the
   *  URL query string, so the initial GET round-trip is skipped. */
  preloadedSpec?: LnurlWithdrawSpec;
}

export const LnurlWithdrawView: FC<Props> = ({ url, onBack, preloadedSpec }) => {
  const cashu = useCashu();
  const mintUrl = cashu.activeMintUrl;

  const [spec, setSpec] = useState<LnurlWithdrawSpec | null>(preloadedSpec ?? null);
  const [loading, setLoading] = useState(!preloadedSpec);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>(
    preloadedSpec ? String(Math.floor(preloadedSpec.maxWithdrawable / 1000)) : "",
  );
  const [phase, setPhase] = useState<"input" | "submitting" | "waiting" | "paid">("input");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the LNURL-withdraw spec on mount unless caller preloaded it.
  useEffect(() => {
    if (preloadedSpec) return;
    let mounted = true;
    void fetchLnurlWithdrawSpec(url)
      .then((s) => {
        if (!mounted) return;
        setSpec(s);
        // Default to maxWithdrawable — most LNURL-w QRs are vouchers
        // where the user expects to take the full amount.
        const maxSats = Math.floor(s.maxWithdrawable / 1000);
        setAmount(String(maxSats));
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!mounted) return;
        setErr(e.message ?? "LNURL fetch selhal");
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [url, preloadedSpec]);

  const specMinSats = spec ? Math.floor(spec.minWithdrawable / 1000) : 0;
  const maxSats = spec ? Math.floor(spec.maxWithdrawable / 1000) : 0;
  // LNURL-w spec allows min === 0, but mint quotes need ≥ 1 sat.
  // Clamp the practical floor at 1 — the spec floor is only relevant
  // when it's higher than 1 (some faucets enforce a min payout).
  const minSats = Math.max(1, specMinSats);
  const fixedAmount = spec ? spec.minWithdrawable === spec.maxWithdrawable && specMinSats > 0 : false;

  const submit = async () => {
    if (!spec || !mintUrl) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n < minSats || n > maxSats) {
      setErr(`Částka musí být ${minSats === maxSats ? `přesně ${minSats}` : `${minSats}–${maxSats}`} sats.`);
      return;
    }
    setErr(null);
    setPhase("submitting");
    try {
      // 1. Create a mint quote at our active Cashu mint — that's our BOLT-11 invoice.
      const { quote } = await cashu.requestMint(mintUrl, n, spec.defaultDescription || "LNURL-withdraw");
      // 2. Hand the invoice to the LNURL service. It will pay it.
      await submitLnurlInvoice(spec.callback, spec.k1, quote.request);
      // 3. Switch to polling — once the mint sees the payment, mintProofs runs
      //    and the tx flips to "paid".
      setPaidAmount(n);
      setPhase("waiting");
      const tick = async () => {
        try {
          const paid = await cashu.claimMintIfPaid(mintUrl, n, quote.quote, null);
          if (paid) {
            setPhase("paid");
            if (pollRef.current) clearInterval(pollRef.current);
            setTimeout(onBack, 2500);
          }
        } catch (e) {
          console.warn("[lnurl-w poll]", e);
        }
      };
      pollRef.current = setInterval(tick, 3000);
      void tick();
    } catch (e) {
      setErr((e as Error).message ?? "LNURL withdraw selhal");
      setPhase("input");
    }
  };

  // Stop polling on unmount / re-mount.
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (loading) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL výběr" />
        <div className="loading">Načítám LNURL službu…</div>
      </div>
    );
  }

  if (!spec) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL výběr" />
        <div className="card">
          <h3>LNURL nešel načíst</h3>
          <p className="error">{err ?? "Neznámá chyba."}</p>
          <button className="btn btn-secondary mt-md" onClick={onBack}>Zpět</button>
        </div>
      </div>
    );
  }

  if (phase === "paid") {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL výběr" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>✓</div>
          <h2>Přijato</h2>
          <p className="hint">{paidAmount.toLocaleString("cs-CZ")} sats přibylo do peněženky.</p>
        </div>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL výběr" />
        <div className="card">
          <h3>Čekám na zaplacení…</h3>
          <p className="hint">
            LNURL služba má 30 s na úhradu invoice. Většinou to trvá pár vteřin.
          </p>
          <div className="form mt-md">
            <div className="row-actions">
              <span className="mono small muted">●</span>{" "}
              <span className="small muted">{paidAmount.toLocaleString("cs-CZ")} sats — z {hostFromUrl(spec.callback)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="LNURL výběr" />
      <div className="card">
        {spec.defaultDescription && (
          <p className="hint" style={{ marginTop: 0 }}>{spec.defaultDescription}</p>
        )}
        <p className="small muted">
          Zdroj: <span className="mono">{hostFromUrl(spec.callback)}</span>
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
          {err && <p className="error small">{err}</p>}
          {!mintUrl && (
            <p className="error small">Nemáš aktivní mint. Otevři Peněženka → Nastavení mintu.</p>
          )}
          <div className="row-actions mt-md">
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={phase === "submitting" || !mintUrl}
            >
              {phase === "submitting" ? "Odesílám…" : `Vybrat ${Number(amount || 0).toLocaleString("cs-CZ")} sats`}
            </button>
            <button className="btn btn-ghost" onClick={onBack}>Zpět</button>
          </div>
        </div>
      </div>
    </div>
  );
};

function hostFromUrl(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}
