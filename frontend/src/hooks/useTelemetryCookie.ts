import { use, useEffect } from "react";
import { evolu } from "../evolu";
import { setTelemetryUserCookie } from "../lib/telemetry";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Derive a per-user cookie that's stable across devices but rotates daily.
//   cookie = SHA-256(ownerId || utcDay).slice(0, 24 bytes → base64url)
// • Same for every device of the same BIP-39 seed → multi-device dedupes.
// • Different every UTC day → no cross-day tracking on the app backend.
// • Backend can't invert to ownerId without a dictionary of ownerIds; our
//   app backend doesn't have that list (only the Evolu relay does).
async function deriveCookie(ownerId: string, day: string): Promise<string> {
  const data = new TextEncoder().encode(`${ownerId}::${day}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64url(new Uint8Array(digest).slice(0, 24));
}

export function useTelemetryCookie(): void {
  const owner = use(evolu.appOwner);

  useEffect(() => {
    let cancelled = false;
    const ownerId = owner?.id as string | undefined;
    if (!ownerId) return;
    const today = utcDay();
    deriveCookie(ownerId, today).then((c) => {
      if (cancelled) return;
      setTelemetryUserCookie(c);
    }).catch(() => setTelemetryUserCookie(null));
    return () => { cancelled = true; };
  }, [owner]);
}
