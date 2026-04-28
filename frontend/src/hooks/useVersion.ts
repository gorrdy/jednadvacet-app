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

  const reload = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update().catch(() => {});
      });
    }
    // Hard reload to bust caches.
    window.location.reload();
  };

  return { updateAvailable, latestId, myBuildId: MY_BUILD_ID, reload };
}
