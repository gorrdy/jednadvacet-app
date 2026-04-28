// Tap-through detail view for any wallet transaction. Shows the underlying
// token / invoice / quote so the sender can re-share or audit what they
// actually moved, and offers manual "Vzít zpět" for still-pending sends
// (auto-reclaim only fires after 2 h, but the user might want to pull a
// payment back immediately).

import { useState, type FC } from "react";
import { useCashu, type StoredTx } from "../hooks/useCashu";
import { QrCode } from "../components/QrCode";
import { IconCopy } from "../components/Icons";
import { WalletHeader, useCopyState, prettyMintHost, type WalletView } from "./shared";

const typeLabels: Record<StoredTx["type"], string> = {
  mint: "Nabití (Lightning)",
  melt: "Výběr (Lightning)",
  send: "Odesláno (ecash)",
  receive: "Přijato (ecash)",
};

const statusLabels: Record<StoredTx["status"], string> = {
  pending: "Čeká",
  paid: "Hotovo",
  failed: "Selhalo",
  reclaimed: "Vzato zpět",
};

export const TxDetailView: FC<{ txId: string; onBack: () => void; setView: (v: WalletView) => void }> = ({ txId, onBack }) => {
  const cashu = useCashu();
  const tx = cashu.txs.find((t) => t.id === txId);
  const copyToken = useCopyState();
  const copyInvoice = useCopyState();
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaimErr, setReclaimErr] = useState<string | null>(null);

  if (!tx) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Detail platby" />
        <div className="card">
          <p className="muted">Transakce nenalezena.</p>
        </div>
      </div>
    );
  }

  const positive = tx.amount > 0;
  const when = new Date(tx.createdAt || Date.now()).toLocaleString("cs-CZ", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const canReclaim = tx.type === "send" && tx.status === "pending" && !!tx.token;
  const isReclaimed = tx.type === "send" && tx.status === "reclaimed";

  const reclaim = async () => {
    setReclaiming(true); setReclaimErr(null);
    try {
      await cashu.reclaimSend(tx.id);
    } catch (e) {
      setReclaimErr((e as Error).message);
    } finally {
      setReclaiming(false);
    }
  };

  return (
    <div>
      <WalletHeader onBack={onBack} title="Detail platby" />

      <div className="card">
        <div className="form">
          <div className="field">
            <label>Typ</label>
            <div>{typeLabels[tx.type]}</div>
          </div>

          <div className="field">
            <label>Částka</label>
            <div
              className="num"
              style={{
                fontFamily: "var(--display)",
                fontWeight: 800,
                fontSize: "1.4rem",
                color: tx.status === "failed"
                  ? "var(--ink-muted)"
                  : positive ? "var(--ok)" : "var(--ember)",
                textDecoration: (isReclaimed || tx.status === "failed") ? "line-through" : "none",
              }}
            >
              {positive ? "+" : ""}{tx.amount.toLocaleString("cs-CZ")} sats
            </div>
          </div>

          <div className="field">
            <label>Stav</label>
            <div>
              {statusLabels[tx.status]}
              {tx.type === "send" && tx.status === "pending" && (
                <span className="small muted" style={{ marginLeft: 8 }}>
                  · příjemce ještě nevyzvedl
                </span>
              )}
              {tx.type === "send" && tx.status === "paid" && (
                <span className="small muted" style={{ marginLeft: 8 }}>
                  · příjemce vyzvedl
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <label>Kdy</label>
            <div className="mono small">{when}</div>
          </div>

          <div className="field">
            <label>Mint</label>
            <div className="mono small">{prettyMintHost(tx.mintUrl)}</div>
          </div>

          {tx.memo && (
            <div className="field">
              <label>Poznámka</label>
              <div>{tx.memo}</div>
            </div>
          )}

          {tx.invoice && (
            <div className="field">
              <label>Lightning invoice</label>
              <textarea rows={3} readOnly value={tx.invoice} className="mono" style={{ fontSize: "0.7rem" }} />
              <div className="row-actions" style={{ marginTop: "0.4rem" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => copyInvoice.copy(tx.invoice!)}>
                  <IconCopy style={{ width: 14, height: 14 }} />
                  {copyInvoice.copied ? "Zkopírováno" : "Zkopírovat invoice"}
                </button>
              </div>
            </div>
          )}

          {tx.quoteId && (
            <div className="field">
              <label>Quote ID</label>
              <div className="mono small" style={{ wordBreak: "break-all" }}>{tx.quoteId}</div>
            </div>
          )}

          {tx.token && (
            <div className="field">
              <label>
                Ecash token
                {tx.type === "send" && (
                  <span className="small muted" style={{ marginLeft: 6 }}>
                    (přesně to, co bylo posláno)
                  </span>
                )}
              </label>
              {tx.type === "send" && tx.status === "pending" && (
                <div className="qr-wrap" style={{ marginBottom: "0.6rem" }}>
                  <QrCode value={tx.token} size={220} />
                </div>
              )}
              <textarea rows={4} readOnly value={tx.token} className="mono" style={{ fontSize: "0.72rem" }} />
              <div className="row-actions" style={{ marginTop: "0.4rem" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => copyToken.copy(tx.token!)}>
                  <IconCopy style={{ width: 14, height: 14 }} />
                  {copyToken.copied ? "Zkopírováno" : "Zkopírovat token"}
                </button>
              </div>
            </div>
          )}

          {canReclaim && (
            <div className="field">
              <button className="btn btn-secondary" onClick={reclaim} disabled={reclaiming}>
                {reclaiming ? "Vracím…" : "Vzít zpět"}
              </button>
              <p className="small muted" style={{ marginTop: "0.4rem" }}>
                Token se vymění zpět u mintu. Pokud ho mezitím příjemce vyzvedl, akce selže
                a stav se opraví.
              </p>
              {reclaimErr && <p className="error small" style={{ marginTop: "0.4rem" }}>{reclaimErr}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
