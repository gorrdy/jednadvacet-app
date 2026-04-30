import { type FC } from "react";
import { useCashu, type StoredTx } from "../hooks/useCashu";
import {
  IconBolt, IconNut, IconQr, IconReceive, IconSend,
} from "../components/Icons";
import { prettyMintHost, type WalletView } from "./shared";
import { useUserPrefs } from "../hooks/usePrefs";

// Threshold above which we nag the user to confirm they've backed up
// the seed phrase. Picked to be "uncomfortably large for a casual
// custodial-mint wallet" — pre-this-amount, the friction of nagging
// outweighs the loss potential.
const BACKUP_NAG_THRESHOLD_SATS = 50_000;

export const WalletHome: FC<{ setView: (v: WalletView) => void }> = ({ setView }) => {
  const cashu = useCashu();
  const { prefs } = useUserPrefs();
  const showBackupNag = cashu.balances.total >= BACKUP_NAG_THRESHOLD_SATS && !prefs.seedBackedUp;

  return (
    <div className="wallet-page">
      {showBackupNag && (
        <div className="wallet-backup-nag" role="alert">
          <strong>⚠ Záloha fráze chybí.</strong>{" "}
          Máš tu {cashu.balances.total.toLocaleString("cs-CZ")} sats. Bez 24-slovní
          fráze se data nedají obnovit. Otevři <strong>Nastavení → Záložní fráze</strong>,
          opiš ji na papír a potvrď.
        </div>
      )}
      <div className="wallet-hero">
        <div className="wallet-hero-label">
          <IconNut /> <span>Tvůj balanc</span>
        </div>
        <div className="wallet-balance">
          <span className="num">{cashu.balances.total.toLocaleString("cs-CZ")}</span>
          <span className="unit">SATS</span>
        </div>
        {cashu.activeMintUrl && (
          <div className="wallet-hero-mint" style={{ pointerEvents: "none" }}>
            <IconNut className="mini" />
            {prettyMintHost(cashu.activeMintUrl)}
            {cashu.mints.length > 1 && <span className="faint"> · {cashu.mints.length - 1}+</span>}
          </div>
        )}
      </div>

      <div className="wallet-actions">
        <button className="wallet-action" onClick={() => setView({ kind: "receive" })}>
          <div className="circle"><IconReceive /></div>
          <span>Přijmout</span>
        </button>
        <button className="wallet-action" onClick={() => setView({ kind: "scan" })}>
          <div className="circle"><IconQr /></div>
          <span>Naskenovat</span>
        </button>
        <button className="wallet-action" onClick={() => setView({ kind: "send" })}>
          <div className="circle"><IconSend /></div>
          <span>Poslat</span>
        </button>
      </div>

      <section className="wallet-history">
        <div className="home-section-head" style={{ marginTop: "1.5rem" }}>
          <span className="t">Historie</span>
          <span className="link faint">{cashu.txs.length} záznamů</span>
        </div>
        {cashu.txs.length === 0 ? (
          <div className="empty-state" style={{ padding: "2rem 0" }}>
            <div className="glyph">ZATÍM PRÁZDNO</div>
            <p>Přijmi ecash nebo si nabij přes Lightning.</p>
          </div>
        ) : (
          <div>
            {cashu.txs.slice(0, 50).map((t) => (
              <TxRow key={t.id} tx={t} onOpen={() => setView({ kind: "tx-detail", txId: t.id })} />
            ))}
          </div>
        )}
      </section>

      <p className="small muted mt-lg center" style={{ marginBottom: "0.5rem" }}>
        ⚠ Ecash je experimentální. Mint může přestat fungovat. Nedrž zde větší částky.
      </p>
      <p className="small muted center" style={{ marginBottom: "0.5rem" }}>
        Minty a další nastavení najdeš v <span className="kbd">Moje → Peněženka</span>.
      </p>
    </div>
  );
};

const TxRow: FC<{ tx: StoredTx; onOpen: () => void }> = ({ tx, onOpen }) => {
  const positive = tx.amount > 0;
  const reclaimed = tx.type === "send" && tx.status === "reclaimed";
  const failed = tx.status === "failed";
  const icons = {
    mint: <IconBolt />, melt: <IconBolt />, send: <IconSend />, receive: <IconReceive />,
  };
  const labels = {
    mint: "Nabití (LN)", melt: "Výběr (LN)", send: "Odesláno", receive: "Přijato",
  };
  const when = new Date(tx.createdAt || Date.now()).toLocaleString("cs-CZ", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const rowCls = ["tx-row"];
  if (reclaimed) rowCls.push("is-reclaimed");
  if (failed) rowCls.push("is-failed");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={rowCls.join(" ")}
      style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, cursor: "pointer", padding: 0 }}
    >
      <div className={`tx-icon ${failed ? "neutral" : positive ? "in" : "out"}`}>{icons[tx.type]}</div>
      <div className="tx-body">
        <div className="tx-title">
          {labels[tx.type]}
          {!failed && tx.type === "send" && tx.status === "pending" && (
            <span className="badge" style={{ marginLeft: 8 }}>čeká na claim</span>
          )}
          {!failed && tx.type === "send" && tx.status === "reclaimed" && (
            <span className="badge" style={{ marginLeft: 8, background: "rgba(180,180,180,0.2)" }}>vzato zpět</span>
          )}
          {!failed && tx.type !== "send" && tx.status === "pending" && (
            <span className="badge" style={{ marginLeft: 8 }}>čeká</span>
          )}
          {failed && (
            <span className="badge" style={{ marginLeft: 8, background: "rgba(143,133,120,0.2)", color: "var(--ink-muted)" }}>selhalo</span>
          )}
        </div>
        <div className="tx-meta">{when} · {prettyMintHost(tx.mintUrl)}</div>
      </div>
      <div className={`tx-amount ${failed ? "neutral" : positive ? "in" : "out"}`}>
        {positive ? "+" : ""}{tx.amount.toLocaleString("cs-CZ")}
        <span className="unit"> sats</span>
      </div>
    </button>
  );
};
