import { use, useEffect, useRef, useState, type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { useLnurlClaim } from "../hooks/useLnurlClaim";
import { evolu } from "../evolu";
import { WalletHome } from "../wallet/Home";
import { ReceiveView } from "../wallet/Receive";
import { SendView } from "../wallet/Send";
import { ScanView } from "../wallet/Scan";
import { ClaimView } from "../wallet/Claim";
import { MeltView } from "../wallet/Melt";
import { LnurlWithdrawView } from "../wallet/LnurlWithdraw";
import { LnurlPayView } from "../wallet/LnurlPay";
import { LnurlAuthView } from "../wallet/LnurlAuth";
import { LnurlRouterView } from "../wallet/LnurlRouter";
import { parseLnurlAuthFromUrl } from "../lib/lnurl";
import { TxDetailView } from "../wallet/TxDetail";
import type { WalletView } from "../wallet/shared";
import { scrollContentTop } from "../lib/scroll";

const PERIODIC_INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 h while wallet tab is open

export const WalletTab: FC = () => {
  const owner = use(evolu.appOwner);
  const [view, setView] = useState<WalletView>({ kind: "home" });
  const cashu = useCashu();
  // Auto-claim any incoming Lightning Address payments (LUD-16 →
  // Cashu mint quote → user redeems for proofs locally).
  useLnurlClaim((owner.id as string) || null);

  // useCashu returns a fresh object every render, so we keep the latest
  // reference in a ref and let the periodic effect run with empty deps.
  // Otherwise the interval would reset on every render and the 2 h tick
  // would never actually fire.
  const cashuRef = useRef(cashu);
  cashuRef.current = cashu;

  useEffect(() => {
    const run = () => {
      const c = cashuRef.current;
      void c.reconcilePendingTxs();    // mint/melt quote-state catch-up
      void c.recoverProofs();          // bring back stale-spent proofs (legacy bug recovery)
      void c.verifyActiveProofs();     // drop active proofs the mint says are SPENT
      void c.reconcileSendTxs();       // claim / auto-reclaim pending send tokens
    };
    run(); // immediate pass on mount
    const id = window.setInterval(run, PERIODIC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Any inner-view navigation (Receive → Home after paid, Send → Home, etc.)
  // should land the user at the top of the wallet page, not scrolled to
  // wherever they were on the previous screen.
  useEffect(() => {
    scrollContentTop();
  }, [view.kind]);

  const back = () => setView({ kind: "home" });

  return (
    <div>
      {view.kind === "home" && <WalletHome setView={setView} />}
      {view.kind === "receive" && <ReceiveView onBack={back} />}
      {view.kind === "send" && <SendView onBack={back} setView={setView} />}
      {view.kind === "scan" && <ScanView onBack={back} setView={setView} />}
      {view.kind === "claim" && <ClaimView token={view.token} onBack={back} />}
      {view.kind === "melt" && <MeltView invoice={view.invoice} onBack={back} />}
      {view.kind === "lnurl" && <LnurlRouterView url={view.url} onBack={back} />}
      {view.kind === "lnurlPay" && <LnurlPayView url={view.url} onBack={back} />}
      {view.kind === "lnurlWithdraw" && <LnurlWithdrawView url={view.url} onBack={back} />}
      {view.kind === "lnurlAuth" && (() => {
        const params = parseLnurlAuthFromUrl(view.url);
        return params ? <LnurlAuthView params={params} onBack={back} /> : <LnurlRouterView url={view.url} onBack={back} />;
      })()}
      {view.kind === "tx-detail" && <TxDetailView txId={view.txId} onBack={back} setView={setView} />}
    </div>
  );
};
