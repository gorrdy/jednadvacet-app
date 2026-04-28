// Generic LNURL entrypoint — used when the scan gave us a URL but no
// hint of payRequest vs. withdrawRequest. Fetches the spec once,
// dispatches by `tag` to the dedicated view.
//
// We could push this routing all the way back into ScanView, but that
// would force the scanner to do a network round-trip before closing.
// Splitting here keeps the scan flow snappy: scan → close → "Načítám
// LNURL službu…" inside a normal wallet view.

import { useEffect, useMemo, useState, type FC } from "react";
import {
  fetchLnurlSpec,
  parseInlineWithdrawSpec,
  parseLnurlAuthFromUrl,
  type LnurlAuthParams,
  type LnurlWithdrawSpec,
} from "../lib/lnurl";
import { LnurlPayView } from "./LnurlPay";
import { LnurlWithdrawView } from "./LnurlWithdraw";
import { LnurlAuthView } from "./LnurlAuth";
import { WalletHeader } from "./shared";

export const LnurlRouterView: FC<{ url: string; onBack: () => void }> = ({ url, onBack }) => {
  // LUD-04 (auth) and LUD-08 (fast withdraw) carry their parameters in
  // the URL query string itself — no spec fetch needed. Detect those
  // shapes synchronously so we can mount the right view immediately
  // and avoid the "Načítám…" placeholder on a redundant network call.
  const inlineAuth = useMemo<LnurlAuthParams | null>(() => parseLnurlAuthFromUrl(url), [url]);
  const inlineWithdraw = useMemo<LnurlWithdrawSpec | null>(
    () => (inlineAuth ? null : parseInlineWithdrawSpec(url)),
    [url, inlineAuth],
  );

  const [tag, setTag] = useState<"payRequest" | "withdrawRequest" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (inlineAuth || inlineWithdraw) return; // no fetch needed
    let mounted = true;
    void fetchLnurlSpec(url)
      .then((s) => { if (mounted) setTag(s.tag); })
      .catch((e: Error) => { if (mounted) setErr(e.message ?? "LNURL fetch selhal"); });
    return () => { mounted = false; };
  }, [url, inlineAuth, inlineWithdraw]);

  if (inlineAuth) {
    return <LnurlAuthView params={inlineAuth} onBack={onBack} />;
  }
  if (inlineWithdraw) {
    return <LnurlWithdrawView url={url} onBack={onBack} preloadedSpec={inlineWithdraw} />;
  }

  if (err) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL" />
        <div className="card">
          <h3>LNURL nešel načíst</h3>
          <p className="error">{err}</p>
          <button className="btn btn-secondary mt-md" onClick={onBack}>Zpět</button>
        </div>
      </div>
    );
  }

  if (!tag) {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL" />
        <div className="loading">Načítám LNURL službu…</div>
      </div>
    );
  }

  if (tag === "payRequest") return <LnurlPayView url={url} onBack={onBack} />;
  return <LnurlWithdrawView url={url} onBack={onBack} />;
};
