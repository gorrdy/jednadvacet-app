import { useCallback, useEffect, useRef, useState } from "react";
import { getVapidPublicKey, registerPush, unregisterPush } from "../api";
import { LS } from "../lib/storageKeys";

export type PushState = "unsupported" | "blocked" | "off" | "on";

// Per-device token. NOT stored in Evolu — each browser has its own push
// subscription endpoint, so each needs its own token to unregister cleanly.
const LS_TOKEN_KEY = LS.PushToken;

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readToken(): string | null {
  try { return localStorage.getItem(LS_TOKEN_KEY); } catch { return null; }
}
function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(LS_TOKEN_KEY, t);
    else localStorage.removeItem(LS_TOKEN_KEY);
  } catch { /* private mode etc. */ }
}

/**
 * Multi-device aware push hook.
 *   • Each device owns its own token in localStorage.
 *   • Enabling / disabling / tag syncs affect only this device's subscription.
 *   • Tags come from shared Evolu prefs, so when the user changes cities on
 *     device A, device B's tags update too on next load (or immediately if
 *     Evolu is online). We debounce-sync whenever `tags` changes.
 */
export function usePush(tags: string[]) {
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  // Current token (for this device). Used by Profile "Poslat testovací".
  const [token, setToken] = useState<string | null>(() => readToken());
  const tagsKey = tags.slice().sort().join(",");
  const lastSyncedTagsKey = useRef<string>("");

  // Initial state detection on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { setState("off"); return; }
      reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? "on" : "off");
      });
    });
  }, []);

  // Push the current subscription (endpoint + keys + tags) to the backend.
  // Idempotent — backend upserts by endpoint and returns/preserves this
  // device's token.
  const upsertToBackend = useCallback(async (): Promise<boolean> => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return false;
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const endpoint = json.endpoint ?? sub.endpoint;
    const p256dh = json.keys?.p256dh ?? bufToB64(sub.getKey("p256dh"));
    const auth = json.keys?.auth ?? bufToB64(sub.getKey("auth"));
    const existingToken = readToken();
    const newToken = await registerPush({
      endpoint,
      keys: { p256dh, auth },
      tags,
      ...(existingToken ? { token: existingToken } : {}),
    });
    if (newToken) {
      writeToken(newToken);
      setToken(newToken);
      lastSyncedTagsKey.current = tagsKey;
      return true;
    }
    return false;
  }, [tags, tagsKey]);

  const enable = useCallback(async () => {
    if (state === "unsupported") return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("blocked"); return; }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const vapid = await getVapidPublicKey();
      if (!vapid) { console.warn("[push] no VAPID key from server"); setState("off"); return; }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(vapid),
        });
      }

      const ok = await upsertToBackend();
      setState(ok ? "on" : "off");
    } finally {
      setBusy(false);
    }
  }, [state, upsertToBackend]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const existingToken = readToken();
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      if (existingToken) await unregisterPush(existingToken);
      writeToken(null);
      setToken(null);
      setState("off");
    } finally {
      setBusy(false);
    }
  }, []);

  const syncTags = useCallback(async () => {
    if (state !== "on") return;
    setBusy(true);
    try { await upsertToBackend(); } finally { setBusy(false); }
  }, [state, upsertToBackend]);

  // Auto-sync tags whenever the shared prefs change (via Evolu sync from
  // another device or local edit). Debounced so a burst of toggles makes one
  // network call, not six.
  useEffect(() => {
    if (state !== "on") return;
    if (tagsKey === lastSyncedTagsKey.current) return;
    const h = window.setTimeout(() => { void upsertToBackend(); }, 400);
    return () => window.clearTimeout(h);
  }, [state, tagsKey, upsertToBackend]);

  return { state, busy, token, enable, disable, syncTags };
}
