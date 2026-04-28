import { useEffect, useRef, useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { WalletHeader } from "./shared";

export const ClaimView: FC<{ token: string; onBack: () => void }> = ({ token, onBack }) => {
  const cashu = useCashu();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number } | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      setBusy(true);
      try {
        const r = await cashu.receiveToken(token);
        setDone({ amount: r.amount });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [cashu, token]);

  if (done) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Přijato" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>✓</div>
          <h2>Přijato</h2>
          <p className="hint">{done.amount.toLocaleString("cs-CZ")} sats přibylo.</p>
          <button className="btn btn-primary mt-md" onClick={onBack}>Hotovo</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="Příjem tokenu" />
      <div className="card center" style={{ padding: "2rem 1rem" }}>
        {busy && <p className="hint">Přijímám token…</p>}
        {err && (
          <>
            <p className="error">{err}</p>
            <button className="btn btn-secondary mt-md" onClick={onBack}>Zpět</button>
          </>
        )}
      </div>
    </div>
  );
};
