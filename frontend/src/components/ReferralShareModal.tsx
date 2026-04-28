// Referral sharing modal: QR + copy button + native share fallback.
// Replaces the inline "Tvůj referral link" copy row that lived in
// TierSection — share-by-QR is much faster IRL ("ukaž mu mobil → naskenuje")
// than dictating a 8-char code.

import { useState, type FC } from "react";
import { QrCode } from "./QrCode";
import { IconCopy } from "./Icons";

const SHARE_MESSAGE = (url: string) =>
  `Pojď do Bitcoin komunity Jednadvacet. Pozvánka: ${url}`;

interface Props {
  url: string;
  code: string;
  /** Stats from TierState — shown if user has any progress already. */
  total: number;
  activeAtTier3: number;
  onClose: () => void;
}

export const ReferralShareModal: FC<Props> = ({ url, code, total, activeAtTier3, onClose }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  // navigator.share is only on HTTPS + most mobile browsers. Fall back
  // to copy-only on desktops where share isn't available.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async () => {
    if (!canShare) { void copy(); return; }
    try {
      await navigator.share({
        title: "Jednadvacet",
        text: SHARE_MESSAGE(url),
        url,
      });
    } catch { /* user cancelled or error — silent */ }
  };

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container referral-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="referral-modal-body">
          <h3 style={{ margin: "0 0 0.4rem" }}>Pozvi kamaráda</h3>
          <p className="small muted" style={{ margin: "0 0 1rem" }}>
            Naskenuj QR nebo pošli odkaz. Když přivedeš tři kamarády na tier 3,
            získáš <strong>Tier 5 — Onboarding Master</strong>.
          </p>

          <div className="referral-qr-wrap">
            <QrCode value={url} size={200} />
          </div>

          <div className="referral-stats">
            <span className="small muted">Pozvánky:</span>
            <strong>{total}</strong>
            <span className="small muted">·</span>
            <span className="small muted">Aktivních na tier ≥ 3:</span>
            <strong style={{ color: activeAtTier3 >= 3 ? "var(--ok)" : "inherit" }}>
              {activeAtTier3}/3
            </strong>
          </div>

          <div className="referral-link mono small">{url}</div>
          <div className="referral-code small muted" style={{ textAlign: "center" }}>
            Kód: <strong>{code}</strong>
          </div>

          <div className="row-actions" style={{ justifyContent: "center", marginTop: "1rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={share}>
              {canShare ? "Sdílet" : copied ? "Zkopírováno" : "Zkopírovat odkaz"}
            </button>
            {canShare && (
              <button className="btn btn-secondary" onClick={copy}>
                <IconCopy style={{ width: 14, height: 14 }} /> {copied ? "Zkopírováno" : "Zkopírovat"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
