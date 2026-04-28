import { useEffect, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import QrScannerLib from "qr-scanner";
import { IconCopy, IconX } from "./Icons";

interface Props {
  onScan: (text: string) => void;
  onClose: () => void;
  hint?: string;
  /** Optional secondary action — when provided, renders a "Zadat ID ručně"
   *  link in the footer that closes the scanner and lets the host open a
   *  manual-entry dialog. Avoids duplicating two CTA buttons elsewhere. */
  onManualEntry?: () => void;
}

export const QrScanner: FC<Props> = ({ onScan, onClose, hint, onManualEntry }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScannerLib | null>(null);
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const scanner = new QrScannerLib(
      video,
      (result) => {
        if (firedRef.current) return;
        firedRef.current = true;
        onScan(result.data);
      },
      {
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: "environment",
        maxScansPerSecond: 5,
      },
    );
    scannerRef.current = scanner;

    scanner
      .start()
      .then(async () => {
        if (cancelled) return;
        setStarting(false);
        try {
          const flash = await scanner.hasFlash();
          if (!cancelled) setHasFlash(flash);
        } catch {
          /* ignore */
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setStarting(false);
        if (e.name === "NotAllowedError") setError("Kamera je zablokovaná v nastavení prohlížeče.");
        else if (e.name === "NotFoundError") setError("Nenašel jsem žádnou kameru.");
        else setError(e.message || "Kamera se nepodařila spustit.");
      });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [onScan]);

  const toggleFlash = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.toggleFlash();
      setFlashOn(s.isFlashOn());
    } catch {
      /* ignore */
    }
  };

  // Same effect as a successful scan, but the payload comes from the OS
  // clipboard. Useful when the QR is on the same device (no second
  // device to point the camera at) or the camera permission is denied.
  const pasteFromClipboard = async () => {
    if (firedRef.current) return;
    try {
      const txt = (await navigator.clipboard.readText()).trim();
      if (!txt) {
        setError("Schránka je prázdná.");
        return;
      }
      firedRef.current = true;
      onScan(txt);
    } catch {
      setError("Schránka není dostupná. V Safari povol clipboard přístup, nebo vlož ručně.");
    }
  };

  // Portal directly into <body>: a `position: fixed` element nested
  // inside an `overflow: auto` ancestor (our `.content`) is a known iOS
  // Safari bug — Safari treats it as positioned relative to the scroll
  // container instead of the viewport, so the camera overlay was
  // wedged between the page topbar and the bottom-nav. Portaling out
  // gives us a true full-screen overlay regardless of where the host
  // component is mounted in the React tree.
  return createPortal(
    <div className="qr-scanner-overlay" role="dialog" aria-label="Naskenovat QR">
      <div className="qr-scanner-header">
        <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Zavřít">
          <IconX /> Zavřít
        </button>
        {hasFlash && (
          <button
            className={`btn btn-sm ${flashOn ? "btn-primary" : "btn-secondary"}`}
            onClick={toggleFlash}
          >
            {flashOn ? "Blesk: zap" : "Blesk"}
          </button>
        )}
      </div>

      <div className="qr-scanner-stage">
        <video ref={videoRef} playsInline muted />
        {starting && !error && <div className="qr-scanner-status">Spouštím kameru…</div>}
        {error && <div className="qr-scanner-status error">{error}</div>}
      </div>

      <div className="qr-scanner-foot">
        <p style={{ margin: 0 }}>
          {hint ?? "Namiř na QR kód. Rozpozná se automaticky."}
        </p>
        <button
          type="button"
          className="qr-scanner-paste-btn"
          onClick={pasteFromClipboard}
          aria-label="Vložit ze schránky"
        >
          <IconCopy style={{ width: 16, height: 16 }} />
          Vložit ze schránky
        </button>
        {onManualEntry && (
          <button
            type="button"
            className="qr-scanner-manual-link"
            onClick={onManualEntry}
          >
            …nebo zadat ID ručně
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
};
