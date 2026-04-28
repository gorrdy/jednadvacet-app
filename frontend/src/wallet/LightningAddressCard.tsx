// Lightning Address (LUD-16) setup card. Sits at the top of the Receive
// view: lets the user claim a `<username>@<host>` address that external
// Lightning wallets can pay to. Each incoming payment spawns a Cashu
// mint quote at our default mint; the user's app picks it up via
// useLnurlClaim and the sats land as ecash proofs.
//
// Privacy / threat model:
//   - The username is a human-typed slug. We don't auto-derive it from
//     display_name without explicit confirmation — different namespaces
//     have different collision risks.
//   - A pending payment means the mint is custodian. Surface that
//     plainly (the hint text below) so users size their incoming sats
//     accordingly.

import { use, useEffect, useState, type FC } from "react";
import { evolu } from "../evolu";
import {
  fetchLightningAddressSuggestion, claimLightningUsername, releaseLightningUsername,
} from "../api";
import { QrCode } from "../components/QrCode";
import { IconCopy } from "../components/Icons";

export const LightningAddressCard: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;

  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [host, setHost] = useState<string>("");
  const [suggestion, setSuggestion] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const s = await fetchLightningAddressSuggestion(ownerId);
    if (s) {
      setCurrent(s.current);
      setSuggestion(s.suggestion);
      setHost(s.host);
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null;

  const fullAddress = current ? `${current}@${host}` : null;

  const copy = async () => {
    if (!fullAddress) return;
    try {
      await navigator.clipboard.writeText(fullAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const submit = async () => {
    setErr(null);
    const u = draft.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,32}$/.test(u)) {
      setErr("Username musí mít 3–32 znaků: a-z, 0-9, _, -");
      return;
    }
    setBusy(true);
    const r = await claimLightningUsername(ownerId, u);
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error === "username taken" ? "Tenhle username už někdo má. Zkus jiný."
        : r.error === "username reserved" ? "Tenhle username je rezervovaný systémem."
        : `Nezdařilo se: ${r.error}`,
      );
      return;
    }
    setCurrent(r.username);
    setHost(r.host);
    setEditing(false);
    setDraft("");
  };

  const release = async () => {
    if (!window.confirm("Smazat Lightning Address? Příchozí platby budou odmítnuty.")) return;
    setBusy(true);
    await releaseLightningUsername(ownerId);
    setBusy(false);
    setCurrent(null);
    setShowQr(false);
  };

  return (
    <div className="card lightning-address-card">
      <h3 style={{ margin: "0 0 0.4rem" }}>⚡ Lightning Address</h3>

      {!current && !editing && (
        <>
          <p className="hint small">
            Aktivuj si <code className="mono">username@{host}</code> — kdokoli ti pak může poslat saty
            z libovolné Lightning peněženky. Sats dorazí jako ecash do tvojí Cashu peněženky
            (mint si je drží jako custodian, dokud si je sem nestáhneš).
          </p>
          <button
            className="btn btn-primary btn-sm mt-md"
            onClick={() => { setDraft(suggestion); setEditing(true); }}
          >
            Aktivovat Lightning Address
          </button>
        </>
      )}

      {editing && (
        <div className="form mt-md">
          <div className="field">
            <label>Tvoje username</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
              <input
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                placeholder="treba-honza"
                className="mono"
                style={{ flex: 1, minWidth: "10rem" }}
                maxLength={32}
              />
              <span className="muted small">@{host}</span>
            </div>
            <p className="small muted mt-sm" style={{ marginBottom: 0 }}>
              3–32 znaků: malá písmena, číslice, podtržítka, pomlčky.
            </p>
          </div>
          {err && <p className="error">{err}</p>}
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? "Ukládám…" : "Uložit"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setErr(null); }}>
              Zrušit
            </button>
          </div>
        </div>
      )}

      {current && !editing && fullAddress && (
        <>
          <div className="lightning-address-display mono">
            {fullAddress}
          </div>
          <div className="row-actions" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              <IconCopy style={{ width: 14, height: 14 }} /> {copied ? "Zkopírováno" : "Kopírovat"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowQr((v) => !v)}>
              {showQr ? "Skrýt QR" : "Zobrazit QR"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(current); setEditing(true); }}>
              Změnit
            </button>
            <button className="btn btn-ghost btn-sm" onClick={release} disabled={busy}>
              Smazat
            </button>
          </div>
          {showQr && (
            <div className="lightning-address-qr">
              <QrCode value={`lightning:${fullAddress}`} size={180} />
            </div>
          )}
          <p className="small muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
            ⚠ Mezi přijetím a stažením drží sats Cashu mint. Pro velké částky
            radši používej vlastní LN peněženku.
          </p>
        </>
      )}
    </div>
  );
};
