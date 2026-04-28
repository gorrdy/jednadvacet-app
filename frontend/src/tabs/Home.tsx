// Home = "one-stop-shop pro pleb bitcoinera". Launcher-style:
//   1. Greeting
//   2. PWA install hint (when browser refused persistent storage)
//   3. Onboarding checklist (hides when all 4 steps done)
//   4. Tip dne (rotating, daily-deterministic)
//   5. Directory — curated sections of external tools + in-app nav chips
//   6. Footer strip (jednadvacet.org + feedback)
//
// No blockchain data, no live prices — intentional. Communities and events
// have moved to the Komunity + Kalendář tabs.

import { useState, type FC } from "react";
import { IconExternal } from "../components/Icons";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { DailyTip } from "../components/DailyTip";
import { DirectoryGrid } from "../components/DirectoryGrid";
import { TierHomeBanner } from "../components/TierHomeBanner";
import type { DirectoryTab, ScrollAnchor } from "../data/directory";
import { isStandalonePwa } from "../lib/fmt";
import { isPersistGranted } from "../lib/persistStorage";
import { LS } from "../lib/storageKeys";

type TabKey = DirectoryTab;

interface Props {
  setTab: (t: TabKey) => void;
}

const timeGreeting = (): { head: string; em: string } => {
  const h = new Date().getHours();
  if (h < 5) return { head: "Dobrou", em: "noc" };
  if (h < 10) return { head: "Dobré", em: "ráno" };
  if (h < 17) return { head: "Dobrý", em: "den" };
  if (h < 22) return { head: "Dobrý", em: "večer" };
  return { head: "Dobrou", em: "noc" };
};

export const Home: FC<Props> = ({ setTab }) => {
  const greet = timeGreeting();
  const showPwaHint = !isStandalonePwa() && isPersistGranted() === false;

  const navigate = (t: DirectoryTab) => setTab(t);
  const scrollTo = (a: ScrollAnchor) => {
    // Ask DirectoryGrid to expand this accordion (no-op if already open),
    // then scroll. rAF gives the layout a tick so we land on the expanded
    // body, not the collapsed header.
    window.dispatchEvent(new CustomEvent("directory-open", { detail: a }));
    requestAnimationFrame(() => {
      const el = document.getElementById(a);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div>
      <div className="home-hero">
        <div>
          <h1 className="greeting">{greet.head} <span>{greet.em}</span>.</h1>
          <p className="subline">Bitcoin one-stop-shop. Nástroje, lidi, učení.</p>
        </div>
      </div>

      <TierHomeBanner />

      {showPwaHint && <PwaHintCard />}

      <OnboardingChecklist onNavigate={navigate} onScrollTo={scrollTo} />

      <DailyTip />

      <DirectoryGrid onNavigate={navigate} onScrollTo={scrollTo} />

      <footer className="home-footer">
        <a href="https://jednadvacet.org" target="_blank" rel="noopener noreferrer">
          jednadvacet.org <IconExternal style={{ width: 10, height: 10 }} />
        </a>
        <span className="sep">·</span>
        <a href="https://github.com/Jednadvacetorg" target="_blank" rel="noopener noreferrer">
          GitHub <IconExternal style={{ width: 10, height: 10 }} />
        </a>
        <span className="sep">·</span>
        <a href="mailto:gorrdy@jednadvacet.org">Napsat feedback</a>
      </footer>
    </div>
  );
};

const PWA_HINT_DISMISSED_KEY = LS.PwaHintDismissed;

/** Nudge users whose Safari/Chromium denied persistent storage to install
 *  the app as a PWA — that's when both browsers reliably grant persist()
 *  and OPFS gets a stable home. Dismissable; we don't nag more than once. */
const PwaHintCard: FC = () => {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(PWA_HINT_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  if (dismissed) return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const dismiss = () => {
    try { localStorage.setItem(PWA_HINT_DISMISSED_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="card" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)", marginBottom: "1rem" }}>
      <div className="flex-row space-between" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ flex: 1 }}>
          <strong>💡 Přidej appku na plochu</strong>
          <p className="small" style={{ marginTop: "0.4rem", marginBottom: 0, color: "var(--ink-dim)" }}>
            Prohlížeč tvoji lokální databázi občas vyhodí pod tlakem paměti.
            Nainstaluj appku jako PWA — tím získá trvalé úložiště a přestane
            blikat "načítám databázi".
            {isIOS ? (
              <> V Safari klepni na <span className="kbd">Sdílet</span> → <span className="kbd">Přidat na plochu</span>.</>
            ) : (
              <> V Safari na Macu klikni na adresní řádek → <span className="kbd">Sdílet</span> → <span className="kbd">Přidat do Docku</span>.
                V Chrome/Edge kliknutí na ikonu <span className="kbd">⊕</span> vpravo od URL.</>
            )}
          </p>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={dismiss}
          title="Skrýt tip"
          style={{ padding: "0.1rem 0.4rem", fontSize: "1rem", flexShrink: 0 }}
        >×</button>
      </div>
    </div>
  );
};
