// Auto-claim hook for incoming Lightning Address payments.
//
// On wallet open (and every 60s while the tab is visible):
//   1. Poll /api/lnurlp/pending/:ownerId — server-side status check
//      against each mint's quote endpoint, marking paid_at as it goes.
//   2. For every paid-but-unclaimed entry, call cashu.claimLnurlPayment
//      to redeem the mint quote into ecash proofs locally.
//   3. POST /api/lnurlp/claimed/:quoteId so the server stops surfacing it.
//
// Idempotent: cashu mint enforces "ISSUED" state once redeemed, so a
// sibling device that beats us doesn't break anything (mintProofs returns
// the error path, we still mark claimed).

import { useEffect, useRef } from "react";
import { fetchLnurlPending, markLnurlClaimed } from "../api";
import { useCashu } from "./useCashu";

const POLL_INTERVAL_MS = 60_000;

export function useLnurlClaim(ownerId: string | null): void {
  const cashu = useCashu();
  // Avoid re-entrant claim attempts when a poll fires while we're still
  // mid-loop on the previous one (slow mint, multiple pending).
  const inFlight = useRef(false);

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const pending = await fetchLnurlPending(ownerId);
        for (const p of pending) {
          if (cancelled) break;
          if (!p.paidAt) continue; // still unpaid
          const ok = await cashu.claimLnurlPayment(
            p.mintUrl, p.amountSats, p.quoteId, p.comment,
          );
          if (ok) {
            try { await markLnurlClaimed(p.quoteId, ownerId); } catch { /* retry next tick */ }
          }
        }
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    // Also re-fire when the tab becomes visible after being backgrounded —
    // most "I sent you sats" moments are followed by the recipient
    // foregrounding the app to look.
    const onVis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
}
