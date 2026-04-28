import { useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { WalletHeader } from "./shared";

export const MeltView: FC<{ invoice: string; onBack: () => void }> = ({ invoice, onBack }) => {
  const cashu = useCashu();
  const mintUrl = cashu.activeMintUrl;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; fee: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    if (!mintUrl) return;
    setBusy(true); setErr(null);
    try {
      const r = await cashu.meltToInvoice(mintUrl, invoice);
      setDone(r);
      setTimeout(onBack, 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Poslat" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>⚡</div>
          <h2>Zaplaceno</h2>
          <p className="hint">{done.amount} sats (poplatek ~{done.fee} sats)</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="Zaplatit Lightning" />
      <div className="card">
        <h3>Lightning platba</h3>
        <div className="form mt-md">
          <div className="field">
            <label>Lightning invoice</label>
            <textarea rows={4} readOnly value={invoice} className="mono" style={{ fontSize: "0.78rem" }} />
          </div>
          {err && <p className="error">{err}</p>}
          {!confirmed ? (
            <div className="row-actions">
              <button className="btn btn-primary" onClick={() => setConfirmed(true)}>Zobrazit potvrzení</button>
              <button className="btn btn-ghost" onClick={onBack}>Zrušit</button>
            </div>
          ) : (
            <div className="row-actions">
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? "Platím…" : "Potvrdit a zaplatit"}
              </button>
              <button className="btn btn-ghost" onClick={onBack}>Zrušit</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
