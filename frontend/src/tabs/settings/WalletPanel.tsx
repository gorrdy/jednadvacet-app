import { useState, type FC } from "react";
import { useCashu } from "../../hooks/useCashu";
import { IconNut, IconX } from "../../components/Icons";

export const WalletPanel: FC = () => {
  const cashu = useCashu();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!url.trim()) return;
    setAdding(true); setErr(null);
    try {
      await cashu.addMint(url.trim(), name.trim() || undefined);
      setUrl(""); setName("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="card">
      <h2><IconNut style={{ width: 18, height: 18, verticalAlign: "-3px" }} /> Peněženka</h2>
      <p className="hint">
        Ecash (Cashu) minty, které peněženka používá. Aktivní mint je ten, do/ze kterého
        posíláš a přijímáš. Každý mint má oddělený balanc.
      </p>

      <div className="mt-md">
        {cashu.mints.length === 0 ? (
          <p className="muted small">Žádný mint. Přidej první níže.</p>
        ) : (
          cashu.mints.map((m) => {
            const bal = cashu.balances.byMint[m.url] ?? 0;
            const isActive = m.url === cashu.activeMintUrl;
            return (
              <div key={m.id} className={`mint-row ${isActive ? "active" : ""}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mint-name">
                    {m.name ?? new URL(m.url).host}
                    {isActive && <span className="badge" style={{ marginLeft: 8 }}>aktivní</span>}
                  </div>
                  <div className="mint-url mono">{m.url}</div>
                  <div className="mint-balance">{bal.toLocaleString("cs-CZ")} <span className="unit">sats</span></div>
                </div>
                <div className="row-actions">
                  {!isActive && (
                    <button className="btn btn-sm btn-secondary" onClick={() => cashu.setActiveMintUrl(m.url)}>
                      Aktivovat
                    </button>
                  )}
                  {cashu.mints.length > 1 && bal === 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => cashu.removeMint(m.id)} title="Odstranit">
                      <IconX style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="divider" />

      <h3>Přidat mint</h3>
      <div className="form mt-md">
        <div className="field">
          <label>URL</label>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setErr(null); }}
            placeholder="https://mint.example.com"
            className="mono"
          />
        </div>
        <div className="field">
          <label>Název (volitelné)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Přezdívka" />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" onClick={add} disabled={adding || !url.trim()}>
          {adding ? "Ověřuji…" : "Přidat"}
        </button>
      </div>
    </section>
  );
};
