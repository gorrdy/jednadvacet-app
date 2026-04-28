import { useState, type FC } from "react";
import { QrScanner } from "../components/QrScanner";
import { parseWalletInput } from "../lib/parseWalletInput";
import { lightningAddressToUrl, lnurlServiceUrl } from "../lib/lnurl";
import type { WalletView } from "./shared";

export const ScanView: FC<{ onBack: () => void; setView: (v: WalletView) => void }> = ({ onBack, setView }) => {
  const [err, setErr] = useState<string | null>(null);

  const handleScan = (text: string) => {
    const parsed = parseWalletInput(text);
    if (parsed.kind === "cashuToken") { setView({ kind: "claim", token: parsed.value }); return; }
    if (parsed.kind === "lnInvoice") { setView({ kind: "melt", invoice: parsed.value }); return; }
    if (parsed.kind === "lnurl") {
      try {
        // Generic LNURL: fetch spec, dispatch by tag. Handles LUD-17 schemes
        // (lnurlp://, lnurlw://, lnurla://) too thanks to lnurlServiceUrl.
        setView({ kind: "lnurl", url: lnurlServiceUrl(parsed.value) });
      } catch (e) {
        setErr(`LNURL nešel rozkódovat: ${(e as Error).message}`);
      }
      return;
    }
    if (parsed.kind === "lightningAddress") {
      // LUD-16 → resolves to a LUD-06 payRequest endpoint.
      try {
        setView({ kind: "lnurlPay", url: lightningAddressToUrl(parsed.value) });
      } catch (e) {
        setErr(`Lightning Address nešel rozkódovat: ${(e as Error).message}`);
      }
      return;
    }
    setErr(`Nerozpoznaný QR: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  };

  return (
    <QrScanner
      onScan={handleScan}
      onClose={onBack}
      hint={err ?? "Lightning invoice, Cashu token, LNURL nebo Lightning Address."}
    />
  );
};
