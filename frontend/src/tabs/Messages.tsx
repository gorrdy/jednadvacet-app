// Messages tab — Discord-style: left sidebar with channels + DMs + pending
// requests, right pane with the open thread. On mobile the sidebar collapses
// under a hamburger; desktop breakpoints show both side-by-side.
//
// DMs: any other user whose chat profile we can fetch can be added as a
// contact by scanning their QR code or tapping their name in a public chat
// and confirming the request. Once both sides accept, the server exposes a
// `dm:<A>:<B>` channel that the Thread component can render like any other.

import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { use } from "react";
import { evolu } from "../evolu";
import { useUserPrefs } from "../hooks/usePrefs";
import { useChatProfile } from "../hooks/useChatProfile";
import { cityName } from "../data/cities";
import {
  fetchDmState, requestDm, acceptDmRequest, rejectDmRequest, dmSlugFor,
  fetchMyEventChats,
  type DmContact, type DmIncomingRequest, type DmOutgoingRequest, type MyEventChat,
} from "../api";
import { Thread } from "../chat/Thread";
import { QrScanner } from "../components/QrScanner";
import { initialsFor } from "../lib/imageResize";
import { IconBell, IconQr, IconUsers, IconX } from "../components/Icons";
import { useUnreadTracker, type UnreadCounts } from "../hooks/useUnreadTracker";
import { LS } from "../lib/storageKeys";

interface Props {
  deepLinkSlug?: string | null;
  onDeepLinkConsumed?: () => void;
}

type Active =
  | { kind: "channel"; slug: string; label: string }
  | { kind: "dm"; partnerOwnerId: string; partnerName: string; slug: string }
  | { kind: "event"; slug: string; label: string }
  | { kind: "requests" }
  | null;

export const Messages: FC<Props> = ({ deepLinkSlug, onDeepLinkConsumed }) => {
  const { prefs } = useUserPrefs();
  const { profile, ownerId } = useChatProfile();
  const appOwner = use(evolu.appOwner);
  const selfOwnerId = (appOwner.id as string) || ownerId;

  const [dm, setDm] = useState<{
    incoming: DmIncomingRequest[];
    outgoing: DmOutgoingRequest[];
    contacts: DmContact[];
  }>({ incoming: [], outgoing: [], contacts: [] });
  // Default-land in the country-wide global channel — Discord-style:
  // the chat tab is never empty, the user always has a thread open.
  // Deep links and explicit channel taps override this initial state.
  const [active, setActive] = useState<Active>(() => ({
    kind: "channel",
    slug: "global",
    label: "Globální · CZ",
  }));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showManual, setShowManual] = useState(false);

  // Per-event chat threads come from the backend (windowed: events the user
  // RSVP'd to, starting within the next 5 days or ended within the last 7).
  // Refreshed on mount + every 60 s so newly RSVP'd events appear without a
  // tab reload.
  const [eventChats, setEventChats] = useState<MyEventChat[]>([]);
  useEffect(() => {
    if (!selfOwnerId) return;
    let mounted = true;
    const load = () => {
      void fetchMyEventChats(selfOwnerId).then((list) => {
        if (mounted) setEventChats(list);
      });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(t); };
  }, [selfOwnerId]);

  const channels = useMemo(() => {
    const list: { slug: string; label: string }[] = [
      { slug: "global", label: "Globální · CZ" },
    ];
    for (const c of prefs.cities) list.push({ slug: c, label: cityName(c) });
    return list;
  }, [prefs.cities]);

  // Event chats live in their own sidebar section ("Akce"), separate from
  // the persistent location channels above. Same shape so ChatChannelList
  // can render them with the existing row component.
  const eventChannels = useMemo(
    () => eventChats.map((ev) => ({ slug: ev.slug, label: ev.title })),
    [eventChats],
  );

  // Persist per-section collapse state. Default: all expanded so a fresh
  // user immediately sees what's available; once they collapse a section we
  // honor that across reloads.
  type SectionKey = "dms" | "channels" | "events";
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem(LS.ChatSectionsCollapsed);
      if (!raw) return { dms: false, channels: false, events: false };
      const parsed = JSON.parse(raw) as Partial<Record<SectionKey, boolean>>;
      return {
        dms: !!parsed.dms,
        channels: !!parsed.channels,
        events: !!parsed.events,
      };
    } catch { return { dms: false, channels: false, events: false }; }
  });
  const toggleCollapse = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(LS.ChatSectionsCollapsed, JSON.stringify(next)); }
      catch { /* ignore */ }
      return next;
    });
  }, []);

  // All slugs the user can see in the sidebar — these get SSE-tracked for
  // unread counters.
  const activeSlug: string | null =
    active?.kind === "channel" ? active.slug :
    active?.kind === "dm" ? active.slug :
    active?.kind === "event" ? active.slug : null;
  const allSlugs = useMemo(
    () => [...channels.map((c) => c.slug), ...dm.contacts.map((c) => c.dmSlug)],
    [channels, dm.contacts],
  );
  const mentionWords = useMemo(
    () => profile?.displayName ? [profile.displayName.toLowerCase()] : [],
    [profile?.displayName],
  );
  const { counts: unread, markRead } = useUnreadTracker({
    slugs: allSlugs,
    activeSlug,
    ownerId: selfOwnerId,
    mentionWords,
  });

  const refreshDm = useCallback(async () => {
    if (!selfOwnerId) return;
    const s = await fetchDmState(selfOwnerId);
    if (s) setDm(s);
  }, [selfOwnerId]);

  useEffect(() => { void refreshDm(); }, [refreshDm]);
  useEffect(() => {
    if (!selfOwnerId) return;
    // Poll every 30s so incoming DM requests and new contacts surface even
    // without a dedicated real-time channel. Lightweight; one JSON round-trip.
    const t = setInterval(() => { void refreshDm(); }, 30_000);
    return () => clearInterval(t);
  }, [selfOwnerId, refreshDm]);

  // Deep-link from push notification: `#chat/<slug>`. For DM slugs we also
  // need to resolve partner info from the loaded contacts list.
  useEffect(() => {
    if (!deepLinkSlug) return;
    if (deepLinkSlug.startsWith("dm:")) {
      const c = dm.contacts.find((x) => x.dmSlug === deepLinkSlug);
      if (c) {
        setActive({ kind: "dm", partnerOwnerId: c.partnerOwnerId, partnerName: c.partnerName ?? "…", slug: c.dmSlug });
        markRead(c.dmSlug);
      }
    } else if (deepLinkSlug.startsWith("event:")) {
      // Event chat — backend gates by RSVP status; we just trust the
      // slug came from a calendar row the user could see.
      setActive({ kind: "event", slug: deepLinkSlug, label: "Diskuse k akci" });
      markRead(deepLinkSlug);
    } else {
      const ch = channels.find((x) => x.slug === deepLinkSlug);
      if (ch) {
        setActive({ kind: "channel", slug: ch.slug, label: ch.label });
        markRead(ch.slug);
      }
    }
    onDeepLinkConsumed?.();
    if (typeof window !== "undefined" && window.location.hash.startsWith("#chat/")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkSlug, channels, dm.contacts]);

  const sendDmRequest = async (targetOwnerId: string) => {
    if (!selfOwnerId) return;
    if (targetOwnerId === selfOwnerId) { alert("Nemůžeš psát sám sobě."); return; }
    const r = await requestDm(selfOwnerId, targetOwnerId);
    if (!r.ok) {
      alert(
        r.error === "recipient has no chat profile yet"
          ? "Tento uživatel ještě nemá nastavený profil — ať si nastaví přezdívku a zkus to znovu."
          : r.error === "blocked"
          ? "Tvoje žádost byla zablokovaná."
          : `Chyba: ${r.error}`,
      );
      return;
    }
    await refreshDm();
    if (r.status === "accepted") {
      const slug = dmSlugFor(selfOwnerId, targetOwnerId);
      setActive({ kind: "dm", partnerOwnerId: targetOwnerId, partnerName: "…", slug });
    } else {
      alert(r.reciprocal
        ? "Tenhle člověk tě už přijal — můžeš mu psát."
        : "Žádost odeslaná. Jakmile ji druhá strana přijme, zobrazí se v seznamu DMs.");
    }
  };

  // QR scan: value is `jednadvacet-dm:<ownerId>` or a bare ownerId.
  const onQrScan = (raw: string) => {
    setShowScanner(false);
    const m = raw.match(/^jednadvacet-dm:([A-Za-z0-9_-]{16,64})$/) ?? raw.match(/^([A-Za-z0-9_-]{16,64})$/);
    if (!m) { alert("QR nerozpoznán. Očekávám ID uživatele Jednadvacet."); return; }
    void sendDmRequest(m[1]);
  };

  const needsProfile = !profile;
  if (!selfOwnerId) return <div className="loading">Načítám…</div>;

  // Mobile drawer gestures:
  //   • swipe-left ON the open sidebar  → close
  //   • swipe-right ON the chat thread  → open the sidebar
  // We require horizontal travel ≥ 50 px AND |dx| > |dy| * 1.4 so vertical
  // scrolling inside either pane never accidentally fires the gesture. The
  // start-X must also be near the edge for the open gesture (within 40 px
  // from the left), which mirrors iOS / Android system back-swipe behavior
  // and prevents tap-and-drag during normal interaction from yanking the
  // drawer in.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onSidebarTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onSidebarTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx < -50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      setSidebarOpen(false);
    }
  };
  const onMainTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    // Accept the open gesture from anywhere within the left 3/4 of the
    // screen — the dominant-axis check in onMainTouchEnd (|dx| > |dy| *
    // 1.4) is what really prevents vertical-scroll gestures from tripping
    // the drawer. Restricting to a tiny edge made the gesture undiscoverable.
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    if (t.clientX > w * 0.75) return;
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onMainTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      setSidebarOpen(true);
    }
  };

  return (
    <div className="messages-shell">
      {/* No standalone topbar — the hamburger lives inside the chat-thread head
       * (mobile only) and the "+ QR" CTA lives inside the sidebar header,
       * so there's exactly one of each action element on screen. */}

      {sidebarOpen && <div className="messages-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside
        className={`messages-sidebar ${sidebarOpen ? "is-open" : ""}`}
        onTouchStart={onSidebarTouchStart}
        onTouchEnd={onSidebarTouchEnd}
      >
        <div className="messages-sidebar-head">
          <h2>Zprávy</h2>
          <div className="messages-head-actions">
            <button
              className="messages-head-btn messages-head-btn-add"
              onClick={() => setShowScanner(true)}
              aria-label="Přidat kontakt přes QR"
              title="Přidat kontakt — naskenuj QR jiného uživatele"
            >
              <IconQr style={{ width: 16, height: 16 }} /> +
            </button>
            <button
              className="messages-head-btn messages-head-btn-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Zavřít"
            >
              <IconX style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        <ChatChannelList
          channels={channels}
          eventChannels={eventChannels}
          dm={dm}
          unread={unread}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          active={active}
          onSelectChannel={(c) => {
            setActive({ kind: "channel", slug: c.slug, label: c.label });
            setSidebarOpen(false);
            markRead(c.slug);
          }}
          onSelectEvent={(c) => {
            setActive({ kind: "event", slug: c.slug, label: c.label });
            setSidebarOpen(false);
            markRead(c.slug);
          }}
          onSelectDm={(c) => {
            setActive({
              kind: "dm",
              partnerOwnerId: c.partnerOwnerId,
              partnerName: c.partnerName ?? "neznámý",
              slug: c.dmSlug,
            });
            setSidebarOpen(false);
            markRead(c.dmSlug);
          }}
          onSelectRequests={() => { setActive({ kind: "requests" }); setSidebarOpen(false); }}
        />
      </aside>

      <main
        className="messages-main"
        onTouchStart={onMainTouchStart}
        onTouchEnd={onMainTouchEnd}
      >
        {needsProfile && (
          <div className="card" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
            <p className="hint" style={{ color: "var(--ink)", margin: 0 }}>
              <strong>Před psaním si nastav přezdívku.</strong> Otevři{" "}
              <span className="kbd">Nastavení → Profil</span>.
            </p>
          </div>
        )}

        {/* Chat tab is never empty — Messages mounts with active = #global by
         * default, so one of the Thread / Requests branches always renders. */}
        {active?.kind === "channel" && (
          <Thread
            key={active.slug}
            slug={active.slug}
            label={`# ${active.label}`}
            onBack={() => setSidebarOpen(true)}
            onAuthorRequest={(pid, pname) => {
              if (window.confirm(`Poslat uživateli ${pname} žádost o přímou zprávu?`)) {
                void sendDmRequest(pid);
              }
            }}
          />
        )}

        {active?.kind === "dm" && (
          <Thread
            key={active.slug}
            slug={active.slug}
            label={`@ ${active.partnerName}`}
            onBack={() => setSidebarOpen(true)}
          />
        )}

        {active?.kind === "event" && (
          <Thread
            key={active.slug}
            slug={active.slug}
            label={`📅 ${active.label}`}
            onBack={() => setSidebarOpen(true)}
            onAuthorRequest={(pid, pname) => {
              if (window.confirm(`Poslat uživateli ${pname} žádost o přímou zprávu?`)) {
                void sendDmRequest(pid);
              }
            }}
          />
        )}

        {active?.kind === "requests" && (
          <RequestsPane
            ownerId={selfOwnerId}
            incoming={dm.incoming}
            outgoing={dm.outgoing}
            onRefresh={refreshDm}
            onAccepted={(partnerId, partnerName) => {
              setActive({
                kind: "dm",
                partnerOwnerId: partnerId,
                partnerName: partnerName ?? "…",
                slug: dmSlugFor(selfOwnerId, partnerId),
              });
            }}
          />
        )}
      </main>

      {showScanner && (
        <QrScanner
          onScan={onQrScan}
          onManualEntry={() => {
            setShowScanner(false);
            setShowManual(true);
          }}
          onClose={() => setShowScanner(false)}
          hint="Naskenuj QR kód jiného uživatele Jednadvacet z jejich Nastavení → Profil."
        />
      )}

      {showManual && (
        <ManualIdDialog
          onClose={() => setShowManual(false)}
          onSubmit={(id) => { setShowManual(false); void sendDmRequest(id); }}
        />
      )}
    </div>
  );
};

/** DMs first, channels second — both collapsible. When collapsed, only items
 *  with unread messages stay visible so the user always sees what needs
 *  attention without expanding the section. Used both inside the sidebar
 *  (mobile drawer / desktop pane) and as the welcome view of the Chat tab
 *  (when no thread is active) — same content, two surfaces. */
const ChatChannelList: FC<{
  channels: { slug: string; label: string }[];
  eventChannels: { slug: string; label: string }[];
  dm: { incoming: DmIncomingRequest[]; outgoing: DmOutgoingRequest[]; contacts: DmContact[] };
  unread: UnreadCounts;
  collapsed: { dms: boolean; channels: boolean; events: boolean };
  toggleCollapse: (k: "dms" | "channels" | "events") => void;
  active: Active;
  onSelectChannel: (c: { slug: string; label: string }) => void;
  onSelectEvent: (c: { slug: string; label: string }) => void;
  onSelectDm: (c: DmContact) => void;
  onSelectRequests: () => void;
}> = ({
  channels, eventChannels, dm, unread, collapsed, toggleCollapse, active,
  onSelectChannel, onSelectEvent, onSelectDm, onSelectRequests,
}) => {
  const visibleDms = collapsed.dms
    ? dm.contacts.filter((c) => unread[c.dmSlug]?.unread)
    : dm.contacts;
  const visibleChannels = collapsed.channels
    ? channels.filter((c) => unread[c.slug]?.unread)
    : channels;
  const visibleEvents = collapsed.events
    ? eventChannels.filter((c) => unread[c.slug]?.unread)
    : eventChannels;
  const hiddenChannelsCount = collapsed.channels
    ? channels.length - visibleChannels.length
    : 0;
  const hiddenDmsCount = collapsed.dms
    ? dm.contacts.length - visibleDms.length
    : 0;
  const hiddenEventsCount = collapsed.events
    ? eventChannels.length - visibleEvents.length
    : 0;

  return (
    <>
      {/* ── DMs section (first per user request) ──────────────── */}
      <div className="sidebar-group">
        <button
          type="button"
          className="sidebar-group-head clickable"
          onClick={() => toggleCollapse("dms")}
          aria-expanded={!collapsed.dms}
        >
          <span className={`sidebar-chevron ${collapsed.dms ? "collapsed" : ""}`} aria-hidden="true">▾</span>
          Přímé zprávy <span className="small muted">· {dm.contacts.length}</span>
        </button>
        {visibleDms.length === 0 ? (
          collapsed.dms ? (
            hiddenDmsCount > 0 ? (
              <p className="small muted" style={{ margin: "0.3rem 0.4rem" }}>
                {hiddenDmsCount} skrytých · žádné nepřečtené
              </p>
            ) : null
          ) : (
            <p className="small muted" style={{ margin: "0.3rem 0.4rem" }}>Zatím žádná DM.</p>
          )
        ) : (
          visibleDms.map((c) => {
            const u = unread[c.dmSlug];
            const isActive = active?.kind === "dm" && active.partnerOwnerId === c.partnerOwnerId;
            return (
              <button
                key={c.partnerOwnerId}
                className={`sidebar-row ${isActive ? "active" : ""} ${u?.unread ? "has-unread" : ""}`}
                onClick={() => onSelectDm(c)}
              >
                <span className="sidebar-avatar" aria-hidden="true">
                  {c.partnerAvatar
                    ? <img src={c.partnerAvatar} alt="" />
                    : <span className="initials">{initialsFor(c.partnerName ?? "?")}</span>}
                </span>
                <span className="sidebar-row-label">{c.partnerName ?? "neznámý"}</span>
                {/* For DMs, any unread IS effectively a mention (1:1). Show count. */}
                {u?.unread ? <span className="sidebar-mention">{u.unread}</span> : null}
              </button>
            );
          })
        )}
        {collapsed.dms && hiddenDmsCount > 0 && visibleDms.length > 0 && (
          <button
            type="button"
            className="sidebar-show-rest"
            onClick={() => toggleCollapse("dms")}
          >
            …a {hiddenDmsCount} dalších bez nepřečteného
          </button>
        )}
        {/* Add-contact CTAs intentionally moved to the sidebar header (the
         * "+ QR" button) so we don't render the same scanner/manual entry
         * actions twice — manual entry is reachable via the link inside the
         * QR scanner overlay. */}
      </div>

      {/* ── Pending DM requests — between sections ────────────── */}
      {dm.incoming.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group-head">
            Žádosti <span className="badge-dot">{dm.incoming.length}</span>
          </div>
          <button
            className={`sidebar-row ${active?.kind === "requests" ? "active" : ""}`}
            onClick={onSelectRequests}
          >
            <IconBell style={{ width: 13, height: 13 }} />{" "}
            <span className="sidebar-row-label">
              {dm.incoming.length} {dm.incoming.length === 1 ? "nová" : "nových"}
            </span>
          </button>
        </div>
      )}

      {/* ── Channels section ─────────────────────────────────── */}
      <div className="sidebar-group">
        <button
          type="button"
          className="sidebar-group-head clickable"
          onClick={() => toggleCollapse("channels")}
          aria-expanded={!collapsed.channels}
        >
          <span className={`sidebar-chevron ${collapsed.channels ? "collapsed" : ""}`} aria-hidden="true">▾</span>
          Kanály <span className="small muted">· {channels.length}</span>
        </button>
        {visibleChannels.length === 0 ? (
          collapsed.channels ? (
            hiddenChannelsCount > 0 ? (
              <p className="small muted" style={{ margin: "0.3rem 0.4rem" }}>
                {hiddenChannelsCount} skrytých · žádné nepřečtené
              </p>
            ) : null
          ) : null
        ) : (
          visibleChannels.map((c) => {
            const u = unread[c.slug];
            const isActive = active?.kind === "channel" && active.slug === c.slug;
            return (
              <button
                key={c.slug}
                className={`sidebar-row ${isActive ? "active" : ""} ${u?.unread ? "has-unread" : ""}`}
                onClick={() => onSelectChannel(c)}
              >
                <span className="hashglyph">#</span>
                <span className="sidebar-row-label">{c.label}</span>
                {u?.mentions ? <span className="sidebar-mention">@{u.mentions}</span>
                 : u?.unread ? <span className="sidebar-unread-dot" aria-hidden="true" /> : null}
              </button>
            );
          })
        )}
        {collapsed.channels && hiddenChannelsCount > 0 && visibleChannels.length > 0 && (
          <button
            type="button"
            className="sidebar-show-rest"
            onClick={() => toggleCollapse("channels")}
          >
            …a {hiddenChannelsCount} dalších bez nepřečteného
          </button>
        )}
      </div>

      {/* ── Event chats ("Akce") — separate category, collapsible ─── */}
      {eventChannels.length > 0 && (
        <div className="sidebar-group">
          <button
            type="button"
            className="sidebar-group-head clickable"
            onClick={() => toggleCollapse("events")}
            aria-expanded={!collapsed.events}
          >
            <span className={`sidebar-chevron ${collapsed.events ? "collapsed" : ""}`} aria-hidden="true">▾</span>
            Akce <span className="small muted">· {eventChannels.length}</span>
          </button>
          {visibleEvents.length === 0 && collapsed.events && hiddenEventsCount > 0 ? (
            <p className="small muted" style={{ margin: "0.3rem 0.4rem" }}>
              {hiddenEventsCount} skrytých · žádné nepřečtené
            </p>
          ) : (
            visibleEvents.map((c) => {
              const u = unread[c.slug];
              const isActive = active?.kind === "event" && active.slug === c.slug;
              return (
                <button
                  key={c.slug}
                  className={`sidebar-row ${isActive ? "active" : ""} ${u?.unread ? "has-unread" : ""}`}
                  onClick={() => onSelectEvent(c)}
                >
                  <span className="hashglyph">📅</span>
                  <span className="sidebar-row-label">{c.label}</span>
                  {u?.mentions ? <span className="sidebar-mention">@{u.mentions}</span>
                   : u?.unread ? <span className="sidebar-unread-dot" aria-hidden="true" /> : null}
                </button>
              );
            })
          )}
          {collapsed.events && hiddenEventsCount > 0 && visibleEvents.length > 0 && (
            <button
              type="button"
              className="sidebar-show-rest"
              onClick={() => toggleCollapse("events")}
            >
              …a {hiddenEventsCount} dalších bez nepřečteného
            </button>
          )}
        </div>
      )}
    </>
  );
};

const RequestsPane: FC<{
  ownerId: string;
  incoming: DmIncomingRequest[];
  outgoing: DmOutgoingRequest[];
  onRefresh: () => Promise<void> | void;
  onAccepted: (partnerId: string, partnerName: string | null) => void;
}> = ({ ownerId, incoming, outgoing, onRefresh, onAccepted }) => {
  const [busy, setBusy] = useState<string | null>(null);

  const accept = async (r: DmIncomingRequest) => {
    setBusy(r.id);
    const res = await acceptDmRequest(r.id, ownerId);
    setBusy(null);
    if (!res.ok) { alert(`Chyba: ${res.error}`); return; }
    await onRefresh();
    onAccepted(r.fromOwnerId, r.fromName);
  };

  const reject = async (r: DmIncomingRequest, block: boolean) => {
    if (!window.confirm(block ? "Zablokovat tohoto uživatele?" : "Odmítnout žádost?")) return;
    setBusy(r.id);
    const res = await rejectDmRequest(r.id, ownerId, block);
    setBusy(null);
    if (!res.ok) { alert(`Chyba: ${res.error}`); return; }
    await onRefresh();
  };

  return (
    <div>
      <h2 className="page-h" style={{ marginTop: 0 }}>Žádosti o DM</h2>

      <section className="card">
        <h3>Nové ({incoming.length})</h3>
        {incoming.length === 0 ? (
          <p className="muted small">Žádné čekající žádosti.</p>
        ) : (
          incoming.map((r) => (
            <div key={r.id} className="dm-request-row">
              <span className="sidebar-avatar" aria-hidden="true">
                {r.fromAvatar
                  ? <img src={r.fromAvatar} alt="" />
                  : <span className="initials">{initialsFor(r.fromName ?? "?")}</span>}
              </span>
              <div className="dm-request-body">
                <div className="dm-request-name">{r.fromName ?? "neznámý"}</div>
                <div className="small muted mono" style={{ wordBreak: "break-all" }}>{r.fromOwnerId}</div>
              </div>
              <div className="row-actions" style={{ flexWrap: "wrap", gap: "0.25rem" }}>
                <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => accept(r)}>Přijmout</button>
                <button className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => reject(r, false)}>Odmítnout</button>
                <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => reject(r, true)}>Blokovat</button>
              </div>
            </div>
          ))
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="card mt-md">
          <h3>Moje odeslané ({outgoing.length})</h3>
          {outgoing.map((r) => (
            <div key={r.id} className="dm-request-row">
              <span className="sidebar-avatar" aria-hidden="true">
                {r.toAvatar
                  ? <img src={r.toAvatar} alt="" />
                  : <span className="initials">{initialsFor(r.toName ?? "?")}</span>}
              </span>
              <div className="dm-request-body">
                <div className="dm-request-name">{r.toName ?? "neznámý"}</div>
                <div className="small muted">{r.status === "pending" ? "Čeká na přijetí" : "Odmítnuto"}</div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

const ManualIdDialog: FC<{ onClose: () => void; onSubmit: (id: string) => void }> = ({ onClose, onSubmit }) => {
  const [val, setVal] = useState("");
  const ok = /^[A-Za-z0-9_-]{16,64}$/.test(val.trim());
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
        <h3><IconUsers style={{ width: 16, height: 16 }} /> Napsat podle ID</h3>
        <p className="small muted">
          ID najdeš v Nastavení → Profil → Moje ID.
        </p>
        <input
          ref={inputRef}
          className="komunity-search mt-sm"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="např. 1a2B3c4D5e6F7g8H…"
        />
        <div className="row-actions mt-md">
          <button className="btn btn-primary" disabled={!ok} onClick={() => onSubmit(val.trim())}>
            Poslat žádost
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Zrušit</button>
        </div>
      </div>
    </div>
  );
};
