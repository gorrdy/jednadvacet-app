// Proof-of-Work gate for joining a community Signal group, rendered as an
// in-app overlay instead of a new browser tab. Matches the pattern used on
// jednadvacet.org's interactive map (iframe to pow.jednadvacet.org/<slug>?embed=1
// + postMessage listener for the 'pow-done' event that carries the actual
// signal.group URL).
//
// Why overlay vs. new tab:
//   - keeps user in the PWA (no loss of scroll position, no re-auth on return)
//   - matches the website's UX so people recognise the PoW challenge flow
//   - iOS PWA standalone mode doesn't handle window.open cleanly — new tab
//     opens Safari; from there the back-gesture is lost.
//
// Flow:
//   1. Mount → iframe loads the PoW challenge from pow.jednadvacet.org
//   2. User solves PoW → pow server sends postMessage {type:'pow-done', url}
//   3. We switch to "redirecting" state, wait briefly so user sees the result,
//      then window.open() the signal URL in a new tab (lets iOS route to
//      Signal app via the signal.group/# universal link)
//   4. Modal closes

import { useEffect, useState, type FC } from "react";
import { IconX } from "./Icons";

const POW_ORIGIN = "https://pow.jednadvacet.org";

interface Props {
  slug: string;
  onClose: () => void;
}

export const PowModal: FC<Props> = ({ slug, onClose }) => {
  const [phase, setPhase] = useState<"pow" | "redirecting">("pow");
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== POW_ORIGIN) return;
      const data = e.data as { type?: string; url?: string } | null;
      if (!data) return;
      if (data.type === "pow-done" && data.url) {
        setPhase("redirecting");
        setRedirectUrl(data.url);
        // iOS PWA standalone mode blocks window.open() called outside of a
        // direct user activation (our setTimeout loses the activation
        // token). Top-level navigation via location.href has no such gate
        // — the browser just follows the URL. signal.group is a Signal
        // universal link on iOS/Android, so the OS hands off to the app.
        //
        // Close the modal before navigating so if the user taps back,
        // they return to a clean PWA state instead of a stale "Otevírám
        // Signal…" screen.
        setTimeout(() => {
          onClose();
          window.location.href = data.url!;
        }, 1000);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onClose]);

  // Esc / hardware back on Android
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">
          <IconX style={{ width: 15, height: 15 }} />
        </button>

        {phase === "pow" && (
          <>
            {!iframeLoaded && (
              <div className="pow-loading">
                <div className="pow-spinner" aria-hidden="true" />
                <p className="small muted" style={{ marginTop: "0.8rem" }}>
                  Načítám ověření…
                </p>
              </div>
            )}
            <iframe
              src={`${POW_ORIGIN}/${encodeURIComponent(slug)}?embed=1`}
              title="Ověření proti botům"
              className={`pow-iframe ${iframeLoaded ? "is-loaded" : ""}`}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation-by-user-activation"
              onLoad={() => setIframeLoaded(true)}
            />
          </>
        )}

        {phase === "redirecting" && redirectUrl && (
          <div className="pow-redirect">
            <div className="pow-check">✓</div>
            <h3>Otevírám Signal…</h3>
            <p className="hint" style={{ marginTop: "0.6rem" }}>
              Pokud se nic neotevře,{" "}
              <a href={redirectUrl} target="_blank" rel="noopener noreferrer">klikni sem</a>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
