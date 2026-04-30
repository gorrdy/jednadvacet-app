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

// Pending mint/melt/send checks are cheap (each early-returns when there
// is nothing pending) — poll fast so a redeemed Cashu token or a settled
// LN invoice flips status within a minute while the user is staring at
// the wallet tab. Proof state verification iterates all active proofs
// against the mint, so it runs slower.
const FAST_INTERVAL_MS = 60_000;          // pending tx reconciliation
const SLOW_INTERVAL_MS = 5 * 60 * 1000;   // proof state audits

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
    const fastRun = () => {
      const c = cashuRef.current;
      void c.reconcilePendingTxs();    // mint/melt quote-state catch-up
      void c.reconcileSendTxs();       // claim / auto-reclaim pending send tokens
    };
    const slowRun = () => {
      const c = cashuRef.current;
      void c.recoverProofs();          // bring back stale-spent proofs (legacy bug recovery)
      void c.verifyActiveProofs();     // drop active proofs the mint says are SPENT
    };
    fastRun();                          // immediate pass on mount
    slowRun();
    const fastId = window.setInterval(fastRun, FAST_INTERVAL_MS);
    const slowId = window.setInterval(slowRun, SLOW_INTERVAL_MS);
    // Re-poll the fast lane the moment the user comes back to the tab
    // (returning from another app, switching tabs back) — they're now
    // staring at potentially stale "čeká na claim" / "čeká" badges.
    const onVis = () => {
      if (document.visibilityState === "visible") fastRun();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(fastId);
      window.clearInterval(slowId);
      document.removeEventListener("visibilitychange", onVis);
    };
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
