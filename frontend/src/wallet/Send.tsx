import { useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { QrCode } from "../components/QrCode";
import { parseWalletInput } from "../lib/parseWalletInput";
import { lightningAddressToUrl, lnurlServiceUrl } from "../lib/lnurl";
import { IconCopy, IconDownload, IconQr } from "../components/Icons";
import { WalletHeader, useCopyState, type WalletView } from "./shared";

export const SendView: FC<{ onBack: () => void; setView: (v: WalletView) => void }> = ({ onBack, setView }) => {
  const cashu = useCashu();
  const mintUrl = cashu.activeMintUrl;
  const available = mintUrl ? (cashu.balances.byMint[mintUrl] ?? 0) : 0;

  const [input, setInput] = useState("");
  const [inputErr, setInputErr] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [createdAmount, setCreatedAmount] = useState<number>(0);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const copyBtn = useCopyState();

  const handleInput = () => {
    const parsed = parseWalletInput(input);
    if (parsed.kind === "lnInvoice") { setView({ kind: "melt", invoice: parsed.value }); return; }
    if (parsed.kind === "cashuToken") { setView({ kind: "claim", token: parsed.value }); return; }
    if (parsed.kind === "lnurl") {
      try {
        setView({ kind: "lnurl", url: lnurlServiceUrl(parsed.value) });
      } catch (e) {
        setInputErr(`LNURL nešel rozkódovat: ${(e as Error).message}`);
      }
      return;
    }
    if (parsed.kind === "lightningAddress") {
      try {
        setView({ kind: "lnurlPay", url: lightningAddressToUrl(parsed.value) });
      } catch (e) {
        setInputErr(`Lightning Address nešel rozkódovat: ${(e as Error).message}`);
      }
      return;
    }
    if (parsed.kind === "mintUrl") {
      setInputErr("To je URL mintu. Přidej ho v Moje → Peněženka.");
      return;
    }
    setInputErr("Nerozpoznaný vstup. Zkus Lightning invoice, Lightning Address, LNURL nebo ecash token.");
  };

  const paste = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      setInput(txt.trim());
      setInputErr(null);
    } catch {
      setInputErr("Schránka není dostupná. Vlož ručně.");
    }
  };

  const createToken = async () => {
    if (!mintUrl) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1) { setCreateErr("Zadej celé číslo v sats."); return; }
    if (n > available) { setCreateErr(`Máš jen ${available} sats v tomto mintu.`); return; }
    setCreating(true); setCreateErr(null);
    try {
      const r = await cashu.createSendToken(mintUrl, n, memo || undefined);
      setToken(r.token);
      setCreatedAmount(n);
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (token) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="Poslat" />
        <div className="card">
          <h3>Token připraven</h3>
          <p className="hint">Naskenuj QR nebo zkopíruj a pošli příjemci. Jakmile token přijme, už nejde použít znovu.</p>
          <div className="qr-wrap">
            <QrCode value={token} size={260} />
          </div>
          <div className="form mt-md">
            <div className="field">
              <label>Token ({createdAmount} sats)</label>
              <textarea rows={4} readOnly value={token} className="mono" style={{ fontSize: "0.75rem" }} />
            </div>
            <div className="row-actions">
              <button className="btn btn-secondary" onClick={() => copyBtn.copy(token)}>
                <IconCopy style={{ width: 14, height: 14 }} />
                {copyBtn.copied ? "Zkopírováno" : "Zkopírovat token"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={onBack}>Hotovo</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="Poslat" />

      <div className="card wallet-input-card">
        <h3>Vlož fakturu nebo token</h3>
        <p className="hint small">
          Vlož Lightning invoice pro platbu, nebo ecash token pro příjem. Typ se rozpozná automaticky.
        </p>
        <textarea
          rows={3}
          value={input}
          onChange={(e) => { setInput(e.target.value); setInputErr(null); }}
          placeholder="lnbc… nebo cashuB…"
          className="mono"
          style={{ fontSize: "0.78rem" }}
        />
        {inputErr && <p className="error">{inputErr}</p>}
        <div className="wallet-input-actions">
          <button className="btn btn-primary" onClick={handleInput} disabled={!input.trim()}>
            Pokračovat
          </button>
          <button className="btn btn-secondary btn-sm" onClick={paste}>
            <IconDownload style={{ width: 14, height: 14 }} /> Vložit ze schránky
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setView({ kind: "scan" })}>
            <IconQr style={{ width: 14, height: 14 }} /> Naskenovat QR
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Vytvořit ecash token</h3>
        <p className="small muted">Dostupné: <strong>{available.toLocaleString("cs-CZ")} sats</strong></p>
        <div className="form mt-md">
          <div className="field">
            <label>Částka (sats)</label>
            <input
              type="number" inputMode="numeric" min={1} max={available}
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setCreateErr(null); }}
              placeholder={`1 – ${available}`}
            />
          </div>
          <div className="field">
            <label>Poznámka (volitelné)</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Pro tebe / komu" />
          </div>
          {createErr && <p className="error">{createErr}</p>}
          <button className="btn btn-primary" onClick={createToken} disabled={creating || !amount}>
            {creating ? "Vytvářím…" : "Vytvořit token"}
          </button>
        </div>
      </div>
    </div>
  );
};
