import { EvoluProvider } from "@evolu/react";
import { Component, Suspense, useEffect, useState, type FC, type ReactNode } from "react";
import { clearRecoveryMarker, evolu, hadUnrecoveredEvoluError } from "./evolu";
import { Home } from "./tabs/Home";
import { Articles } from "./tabs/Articles";
import { CalendarTab } from "./tabs/Calendar";
import { Komunity } from "./tabs/Komunity";
import { Profile } from "./tabs/Profile";
import { Welcome } from "./tabs/Welcome";
import { WalletTab } from "./tabs/Wallet";
import { Messages } from "./tabs/Messages";
import { BazarTab } from "./tabs/Bazar";
import { AdminApp } from "./admin/AdminApp";
import { IconCalendar, IconCog, IconHome, IconMessage, IconNews, IconRefresh, IconUsers, IconWallet } from "./components/Icons";
import { useVersion } from "./hooks/useVersion";
import { pingAppOpen, pingTab, startHeartbeat, stopHeartbeat } from "./lib/telemetry";
import { useTelemetryCookie } from "./hooks/useTelemetryCookie";
import { useOnlineCount } from "./hooks/useOnlineCount";
import { captureReferralFromUrl } from "./lib/tierSystem";
import { useCashuBootstrap } from "./lib/cashuBootstrap";
import { useEvoluMigrations } from "./lib/evoluMigrations";
import { LS, SS, safeLs } from "./lib/storageKeys";
import { scrollContentTop } from "./lib/scroll";

type Tab = "home" | "articles" | "calendar" | "komunity" | "messages" | "wallet" | "bazar" | "profile";

// /admin is a completely separate app. It has its own login (email+password)
// and never touches Evolu — community leaders and the superadmin sign in here
// to manage events, broadcasts, and (for superadmin) other admins.
function isAdminPath(): boolean {
  if (typeof location === "undefined") return false;
  return location.pathname === "/admin" || location.pathname.startsWith("/admin/");
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="welcome">
          <div className="welcome-card">
            <h1>Inicializační chyba</h1>
            <p className="tagline">App se nedaří spustit. Safari v soukromém režimu nebo starší prohlížeč bez OPFS?</p>
            <pre style={{ fontSize: "0.78rem", color: "var(--danger)", whiteSpace: "pre-wrap", textAlign: "left", marginTop: "0.5rem" }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: FC = () => {
  // /admin is a totally separate tree — no Evolu, no tabs, no welcome flow.
  if (isAdminPath()) {
    return (
      <ErrorBoundary>
        <AdminApp />
      </ErrorBoundary>
    );
  }

  const [seenWelcome, setSeenWelcome] = useState(() => safeLs.get(LS.SeenWelcome) === "1");

  if (!seenWelcome) {
    return (
      <Welcome
        onContinue={() => {
          safeLs.set(LS.SeenWelcome, "1");
          setSeenWelcome(true);
        }}
      />
    );
  }

  return (
    <ErrorBoundary>
      <EvoluProvider value={evolu}>
        <Suspense fallback={<InitFallback />}>
          <AppShell />
        </Suspense>
      </EvoluProvider>
    </ErrorBoundary>
  );
};

/**
 * Evolu init normally resolves in a few hundred ms (OPFS open). We handle
 * three cases:
 *
 *  1. **Suspended < 6s** — plain spinner, the normal case.
 *  2. **Stuck ≥ 6s, first time** — OPFS worker probably died silently
 *     (Safari quirk where worker errors don't bubble up). Auto-reload
 *     once with a marker — same mechanism as evolu.ts subscribeError,
 *     defense-in-depth.
 *  3. **Stuck ≥ 6s, already tried (post-recovery)** — show the clear
 *     error card with "restore from seed phrase" affordance.
 */
const InitFallback: FC = () => {
  const postRecovery = hadUnrecoveredEvoluError();
  const [stuck, setStuck] = useState(postRecovery);

  useEffect(() => {
    if (postRecovery) return;
    const t = setTimeout(() => {
      // Silently attempt one recovery reload. The reload flow through
      // the top of the file re-reads the marker and routes us here with
      // `postRecovery=true` on the retry if OPFS still won't init.
      if (!hadUnrecoveredEvoluError()) {
        try { sessionStorage.setItem(SS.EvoluRecoveryAttempted, "1"); } catch { /* ignore */ }
        console.warn("[InitFallback] stuck for 6s, auto-reloading once");
        window.location.reload();
        return;
      }
      setStuck(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [postRecovery]);

  if (!stuck) return <div className="loading">Načítám lokální databázi…</div>;

  const softReload = () => {
    clearRecoveryMarker();
    window.location.reload();
  };

  /** Nuke local Evolu state and reload — user will need their 24-word phrase
   *  to get data back. Scorched earth, but sometimes the only way out of a
   *  corrupt OPFS state. */
  const wipeAndReload = async () => {
    if (!window.confirm(
      "Tímto smažeš lokální databázi a začneš znovu. Všechna data, která nejsou synchronizovaná (např. rozpracovaná ecash transakce), budou ztracena.\n\n" +
      "Po smazání budeš mít prázdnou aplikaci a v Nastavení → Obnovit ze záložní fráze můžeš obnovit data ze svých 24 slov.\n\n" +
      "Opravdu pokračovat?",
    )) return;

    // OPFS cleanup.
    try {
      const root = await navigator.storage.getDirectory();
      // Try to remove everything — Evolu stores under a few named files.
      // Force recursive remove of all children.
      for await (const name of (root as unknown as AsyncIterable<string>)) {
        try { await (root as unknown as { removeEntry: (n: string, o?: { recursive?: boolean }) => Promise<void> })
          .removeEntry(name, { recursive: true }); }
        catch { /* some entries may be locked; best-effort */ }
      }
    } catch { /* OPFS not available or already gone */ }

    // IndexedDB cleanup (Evolu uses it alongside OPFS on older Safari).
    try {
      const dbs = await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> })
        .databases?.() ?? [];
      await Promise.all(dbs.filter((d) => d.name).map((d) => new Promise<void>((resolve) => {
        const r = indexedDB.deleteDatabase(d.name!);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      })));
    } catch { /* ignore */ }

    // Clear our own markers so the reload starts clean.
    try { sessionStorage.clear(); } catch { /* ignore */ }
    clearRecoveryMarker();
    window.location.reload();
  };

  if (postRecovery) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>Lokální databáze se nedaří otevřít</h1>
          <p className="tagline">
            Zkusil jsem restart aplikace, ale Safari pořád odmítá přístup k&nbsp;úložišti.
            Obvyklá příčina: konflikt s&nbsp;jiným tabem, zaplněný disk, nebo chvilkový
            výpadek prohlížeče. Co můžeš zkusit:
          </p>
          <ol style={{ textAlign: "left", color: "var(--ink-dim)", fontSize: "0.9rem", lineHeight: 1.7 }}>
            <li>Zavři ostatní otevřené taby téhle appky</li>
            <li>Ukonči úplně Safari a otevři znovu</li>
            <li>Pokud nic nepomáhá, smaž lokální data (níž) — data obnovíš ze záložní fráze (24 slov)</li>
          </ol>
          <div className="row-actions mt-md" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={softReload}>
              Zkusit znovu
            </button>
            <button className="btn btn-danger" onClick={wipeAndReload}>
              Smazat lokální data
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Načítání trvá déle než obvykle</h1>
        <p className="tagline">
          Lokální databáze se nestihla otevřít. Obvykle pomáhá reload. Pokud
          potíže trvají, zkus zavřít ostatní taby téhle appky nebo vymazat
          data webu v nastavení prohlížeče.
        </p>
        <div className="row-actions mt-md" style={{ justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={softReload}>
            Načíst znovu
          </button>
        </div>
      </div>
    </div>
  );
};

const UpdateBanner: FC<{ onReload: () => void }> = ({ onReload }) => (
  <div className="update-banner" role="alert">
    <IconRefresh />
    <span className="text">
      <strong>Nová verze je dostupná.</strong> Načti znovu pro nejnovější obsah.
    </span>
    <button onClick={onReload}>Načíst</button>
  </div>
);

const validTabs: readonly Tab[] = ["home", "articles", "calendar", "komunity", "messages", "wallet", "bazar", "profile"];
const isTab = (s: string): s is Tab => (validTabs as readonly string[]).includes(s);

const readPersistedTab = (): Tab => {
  const v = safeLs.get(LS.ActiveTab);
  if (v && isTab(v)) return v;
  return "home";
};

const AppShell: FC = () => {
  // Persist active tab across reload — opening the PWA should land you back
  // on whichever section you were on. Hash-based deep links (#admin, #chat/…)
  // override this in the effect below.
  const [tab, setTab] = useState<Tab>(readPersistedTab);
  const [deepLinkSlug, setDeepLinkSlug] = useState<string | null>(null);
  const version = useVersion();
  useTelemetryCookie();
  const onlineCount = useOnlineCount();
  // Single-instance default-mint seeding + duplicate row cleanup. Must
  // live here, not inside useCashu — that hook is called from 9 places
  // and concurrent mounts would race to insert the seed.
  useCashuBootstrap();
  // One-time copy of legacy localStorage flags into Evolu prefs so the
  // synced fields actually reflect what the user picked on a previous
  // build of this app. Self-clears once data has moved.
  useEvoluMigrations();

  useEffect(() => { safeLs.set(LS.ActiveTab, tab); }, [tab]);

  // Capture ?ref=<code> v URL hned na startu — uloží do localStorage
  // a sundá z URL. Po vytvoření chat_user profilu (Profile tab) se
  // redeemne. Captureujeme hned, ať neztratíme code, kdyby uživatel
  // refreshoval nebo otevřel jiný link.
  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Legacy #admin hash redirects to the /admin page.
    if (window.location.hash === "#admin") {
      window.location.href = "/admin";
      return;
    }
    // Push-notification deep link: `/#chat/<slug>` → Messages tab,
    // auto-open that channel. Works both on initial load and when the
    // service worker navigates an already-open tab via clients.navigate().
    const applyHash = () => {
      // Slug character set covers: public city slugs (a-z digits dash),
      // dm:<id>:<id> (id is base64url + colons), event:<id> (same id charset).
      const m = window.location.hash.match(/^#chat\/([A-Za-z0-9_:-]+)$/);
      if (m) {
        setTab("messages");
        setDeepLinkSlug(m[1]);
        return;
      }
      // Direct tab deep-link from a push-notification click, e.g.
      // `#wallet` from an incoming-payment notification.
      const tabMatch = window.location.hash.match(/^#(home|calendar|komunity|messages|wallet|bazar|profile)$/);
      if (tabMatch) {
        setTab(tabMatch[1] as Tab);
        // Strip the hash so a refresh doesn't keep landing the user
        // on this tab via the hash path (tab is now persisted via
        // TAB_STORAGE_KEY anyway).
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // Anonymous telemetry: app-open + per-visible-tab + presence heartbeat.
  useEffect(() => {
    pingAppOpen();
    pingTab(tab);
    startHeartbeat();
    return () => stopHeartbeat();
    // `tab` intentionally not a dep here — the effect that tracks tab is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    pingTab(tab);
    // Scroll to top when switching tabs. iOS-standard UX — matches the
    // browser chrome scroll-to-top-on-tap behaviour and prevents landing
    // mid-page when returning to a tab after deep navigation elsewhere.
    scrollContentTop();
  }, [tab]);

  return (
    <div className="app">
      {version.updateAvailable && <UpdateBanner onReload={version.reload} />}

      <header className="topbar">
        <div className="brand">
          <img
            src="/brand/jednadvacet-jeden-radek-bila-nbg.svg"
            alt="Jednadvacet"
            className="brand-logo"
          />
        </div>
        <div className="spacer" />
        {onlineCount !== null && onlineCount > 0 && (
          <span className="online-pill" title="Lidé online za posledních 5 min">
            <span className="online-dot" aria-hidden="true" /> {onlineCount}
          </span>
        )}
        <button
          className={`topbar-gear ${tab === "profile" ? "active" : ""}`}
          onClick={() => setTab("profile")}
          aria-label="Nastavení"
          title="Nastavení"
        >
          <IconCog />
        </button>
      </header>

      <main className="content">
        {tab === "home" && <Home setTab={(t) => setTab(t)} />}
        {tab === "articles" && <Articles />}
        {tab === "calendar" && <CalendarTab />}
        {tab === "komunity" && <Komunity />}
        {tab === "messages" && (
          <Messages
            deepLinkSlug={deepLinkSlug}
            onDeepLinkConsumed={() => setDeepLinkSlug(null)}
          />
        )}
        {tab === "wallet" && <WalletTab />}
        {tab === "bazar" && <BazarTab />}
        {tab === "profile" && <Profile />}
      </main>

      {/* Novinky tab is temporarily hidden — visual didn't satisfy. Tab
          render path (`{tab === "articles" && …}`) stays intact so we can
          reinstate the button later without re-wiring routing. */}
      <nav className="tabs-bottom">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          <IconHome />
          <span>Domů</span>
        </button>
        <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>
          <IconCalendar />
          <span>Kalendář</span>
        </button>
        <button className={tab === "komunity" ? "active" : ""} onClick={() => setTab("komunity")}>
          <IconUsers />
          <span>Komunity</span>
        </button>
        <button className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>
          <IconMessage />
          <span>Chat</span>
        </button>
        {/* Bazar tab is temporarily hidden from bottom nav. Render path
            (`{tab === "bazar" && …}`) stays intact + hash deep-link
            `#bazar` still works, so the feature can be reinstated by
            uncommenting this button. Same pattern as Articles. */}
        <button className={tab === "wallet" ? "active" : ""} onClick={() => setTab("wallet")}>
          <IconWallet />
          <span>Peníze</span>
        </button>
      </nav>
    </div>
  );
};
