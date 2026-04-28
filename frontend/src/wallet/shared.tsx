import { useState, type FC } from "react";

export const WalletHeader: FC<{ onBack: () => void; title: string }> = ({ onBack, title }) => (
  <div className="wallet-sub-header">
    <button className="btn btn-sm btn-ghost" onClick={onBack}>← Zpět</button>
    <h2>{title}</h2>
    <div />
  </div>
);

export function useCopyState() {
  const [copied, setCopied] = useState(false);
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };
  return { copied, copy };
}

export function prettyMintHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

// View state for WalletTab — shared across all wallet screens so they can
// route to each other (e.g. Send → Scan → Claim).
export type WalletView =
  | { kind: "home" }
  | { kind: "receive" }
  | { kind: "send" }
  | { kind: "scan" }
  | { kind: "claim"; token: string }
  | { kind: "melt"; invoice: string }
  | { kind: "lnurl"; url: string }            // resolves at runtime — pay vs. withdraw vs. auth
  | { kind: "lnurlPay"; url: string }
  | { kind: "lnurlWithdraw"; url: string }
  | { kind: "lnurlAuth"; url: string }
  | { kind: "tx-detail"; txId: string };
