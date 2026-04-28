import { use, useState, type FC } from "react";
import { Mnemonic } from "@evolu/common";
import { evolu } from "../../evolu";
import { IconCopy } from "../../components/Icons";
import { useUserPrefs } from "../../hooks/usePrefs";

export const RecoveryPanel: FC = () => {
  const owner = use(evolu.appOwner);
  const { prefs, save } = useUserPrefs();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [err, setErr] = useState("");

  const toggleBackedUp = () => {
    save({ seedBackedUp: !prefs.seedBackedUp });
  };

  const copy = () => {
    if (!owner.mnemonic) return;
    navigator.clipboard.writeText(owner.mnemonic as string).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const restore = () => {
    const parsed = Mnemonic.from(restoreInput.trim());
    if (!parsed.ok) { setErr("Neplatná fráze. Musí obsahovat 24 BIP-39 slov."); return; }
    if (!window.confirm("Tato operace smaže lokální data a obnoví je ze záložní fráze. Pokračovat?")) return;
    void evolu.restoreAppOwner(parsed.value);
  };

  const resetAll = () => {
    if (!window.confirm("Tímto smažeš všechna lokální data a vytvoříš novou prázdnou identitu. Opravdu?")) return;
    void evolu.resetAppOwner();
  };

  return (
    <section className="card">
      <h2>Záložní fráze</h2>
      <p className="hint">
        24 slov (BIP‑39) obnoví tvá data na jakémkoliv zařízení. Fráze je tvá jediná identita —
        neuchovávej ji na serveru a <strong>nikomu ji neposílej</strong>. Zapiš si ji na papír.
      </p>

      <div className="row-actions mt-md">
        <button className="btn btn-secondary" onClick={() => setShow((v) => !v)}>
          {show ? "Skrýt" : "Zobrazit"} frázi
        </button>
        {show && owner.mnemonic && (
          <button className="btn btn-sm btn-ghost" onClick={copy}>
            <IconCopy style={{ width: 14, height: 14 }} />
            {copied ? "Zkopírováno" : "Zkopírovat"}
          </button>
        )}
      </div>

      {show && owner.mnemonic && (
        <div className="mnemonic-grid">
          {(owner.mnemonic as string).split(" ").map((w, i) => (
            <span key={i} className="mword"><small>{String(i + 1).padStart(2, "0")}</small>{w}</span>
          ))}
        </div>
      )}

      <label className="seed-confirm">
        <input type="checkbox" checked={prefs.seedBackedUp} onChange={toggleBackedUp} />
        <span>Mám frázi zapsanou na papíře a uloženou offline.</span>
      </label>

      <div className="divider" />

      <h3>Obnovit z fráze</h3>
      <p className="hint">Na jiném zařízení? Vlož 24 slov a app stáhne tvá data.</p>
      {!restoreOpen ? (
        <button className="btn btn-secondary mt-sm" onClick={() => setRestoreOpen(true)}>
          Obnovit ze záložní fráze
        </button>
      ) : (
        <div className="form mt-sm">
          <textarea
            rows={3}
            value={restoreInput}
            onChange={(e) => { setRestoreInput(e.target.value); setErr(""); }}
            placeholder="word1 word2 word3 … word24"
          />
          {err && <p className="error">{err}</p>}
          <div className="row-actions">
            <button className="btn btn-primary" onClick={restore}>Obnovit</button>
            <button className="btn btn-ghost" onClick={() => { setRestoreOpen(false); setErr(""); }}>
              Zrušit
            </button>
          </div>
        </div>
      )}

      <div className="divider" />

      <h3 style={{ color: "var(--danger)" }}>Reset</h3>
      <p className="hint">Smaže lokální data a vytvoří novou identitu. Starou frázi pak už nepoužiješ bez obnovení.</p>
      <button className="btn btn-danger mt-sm" onClick={resetAll}>
        Smazat a začít znovu
      </button>
    </section>
  );
};
