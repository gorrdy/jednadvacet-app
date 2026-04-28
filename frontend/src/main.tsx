import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { requestPersistentStorage } from "./lib/persistStorage";
// Self-hosted fonts — standard in the bitcoin/crypto ecosystem.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles.css";

// Ask for persistent storage BEFORE Evolu opens OPFS — reduces the chance
// of Safari evicting our local SQLite file while the app is warm.
void requestPersistentStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[sw]", e));
  });
}

// Prevent Safari pinch-zoom and double-tap-zoom gestures. iOS sometimes
// ignores user-scalable=no in a tab; the CSS touch-action + these listeners
// cover the remaining cases. Tested: iOS 17 Safari, iPadOS.
(["gesturestart", "gesturechange", "gestureend"] as const).forEach((ev) => {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
});
// Prevent pinch via multi-touch move (belt-and-suspenders).
document.addEventListener(
  "touchmove",
  (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
// Double-tap-to-zoom guard.
{
  let lastTouch = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    },
    { passive: false },
  );
}
