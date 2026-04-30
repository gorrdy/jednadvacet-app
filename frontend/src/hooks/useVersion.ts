import { useEffect, useState } from "react";

// Build id baked in at build time via vite's define() in vite.config.ts.
// Falls back to "dev" during development.
declare const __BUILD_ID__: string;
const MY_BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const POLL_MS = 60_000;

// Polls /version.json. If the build id changes from what we booted with,
// flip `updateAvailable` → true so the UI can show a banner.
export function useVersion() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestId, setLatestId] = useState<string | null>(null);

  useEffect(() => {
    if (MY_BUILD_ID === "dev") return;

    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { buildId?: string };
        if (cancelled) return;
        if (j.buildId && j.buildId !== MY_BUILD_ID) {
          setLatestId(j.buildId);
          setUpdateAvailable(true);
        }
      } catch {
        /* network noise */
      }
    };

    check();
    const id = window.setInterval(check, POLL_MS);

    // Also check when the tab becomes visible again — people leave PWAs open.
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Update flow used to call reg.update() async then immediately reload —
  // the reload fired before the new SW reached activate, so the old SW
  // kept serving while the new index.html referenced not-yet-cached
  // chunks. Result: black screen until the user kill-restarted the app.
  //
  // Now: unregister the SW + nuke all Cache Storage entries first, then
  // reload. With no SW intercepting fetches, the reload pulls everything
  // fresh from network; main.tsx re-registers the SW on the next load —
  // same effect as a kill-restart.
  const reload = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.unregister();
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* best-effort — fall through to plain reload */
    }
    window.location.reload();
  };

  return { updateAvailable, latestId, myBuildId: MY_BUILD_ID, reload };
}
