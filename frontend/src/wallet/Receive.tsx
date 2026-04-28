import { useEffect, useRef, useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { QrCode } from "../components/QrCode";
import { IconCopy } from "../components/Icons";
import { WalletHeader, useCopyState } from "./shared";
import { LightningAddressCard } from "./LightningAddressCard";

export const ReceiveView: FC<{ onBack: () => void }> = ({ onBack }) => {
  const cashu = useCashu();
  const mintUrl = cashu.activeMintUrl;
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "paid" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyBtn = useCopyState();

  const create = async () => {
    if (!mintUrl) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1) { setErr("Zadej celé číslo v sats."); return; }
    setErr(null); setStatus("waiting");
    try {
      const { quote, txId: newTxId } = await cashu.requestMint(mintUrl, n, memo || undefined);
      setInvoice(quote.request);
      setQuoteId(quote.quote);
      setTxId(newTxId);
    } catch (e) {
      setErr((e as Error).message);
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!quoteId || !mintUrl || status !== "waiting") return;
    let active = true;
    const n = Number(amount);
    const tick = async () => {
      try {
        const paid = await cashu.claimMintIfPaid(mintUrl, n, quoteId, txId);
        if (paid && active) {
          setStatus("paid");
          if (pollRef.current) clearInterval(pollRef.current);
          setTimeout(() => { if (active) onBack(); }, 2500);
        }
      } catch (e) {
        console.warn("[mint poll]", e);
      }
    };
    pollRef.current = setInterval(tick, 3000);
    void tick();
    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [quoteId, mintUrl, status, amount, txId, cashu, onBack]);

  if (status === "paid") {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Přijmout" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>✓</div>
          <h2>Přijato</h2>
          <p className="hint">{Number(amount).toLocaleString("cs-CZ")} sats přibylo do peněženky.</p>
        </div>
      </div>
    );
  }

  if (invoice) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Přijmout" />
        <div className="card">
          <h3>Zaplať Lightning invoice</h3>
          <p className="hint">Otevři Lightning peněženku a naskenuj QR nebo zkopíruj.</p>
          <div className="qr-wrap">
            <QrCode value={invoice.toUpperCase()} size={260} />
          </div>
          <div className="form mt-md">
            <div className="field">
              <label>Lightning invoice</label>
              <textarea rows={3} readOnly value={invoice} className="mono" style={{ fontSize: "0.75rem" }} />
            </div>
            <div className="row-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => copyBtn.copy(invoice)}>
                <IconCopy style={{ width: 14, height: 14 }} />
                {copyBtn.copied ? "Zkopírováno" : "Zkopírovat"}
              </button>
            </div>
            <p className="small muted mt-sm">
              Čekám na zaplacení… <span className="mono" style={{ color: "var(--ember)" }}>●</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="Přijmout" />
      <LightningAddressCard />
      <div className="card">
        <h3>Lightning deposit</h3>
        <p className="hint">
          Zadej částku a dostaneš Lightning invoice, kterou ti kdokoliv zaplatí.
          Po zaplacení se sats zobrazí na peněžence jako ecash.
        </p>
        <div className="form mt-md">
          <div className="field">
            <label>Částka (sats)</label>
            <input
              type="number" inputMode="numeric" min={1}
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErr(null); }}
              placeholder="Např. 1000" autoFocus
            />
          </div>
          <div className="field">
            <label>Poznámka (volitelné)</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Např. testovací nabití" />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" onClick={create} disabled={!amount}>
            Vytvořit invoice
          </button>
        </div>
      </div>
    </div>
  );
};
