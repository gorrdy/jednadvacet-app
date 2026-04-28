import { useEffect, useRef, type FC } from "react";
import QRCode from "qrcode";

interface Props {
  value: string;
  size?: number;
}

export const QrCode: FC<Props> = ({ value, size = 240 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0d0b09",
        light: "#f2ece0",
      },
    }).catch((e) => console.warn("[qr]", e));
  }, [value, size]);

  return <canvas ref={canvasRef} width={size} height={size} style={{ display: "block", borderRadius: 12 }} />;
};
