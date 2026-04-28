import { useQuery } from "@evolu/react";
import { NonEmptyTrimmedString100, type SqliteBoolean } from "@evolu/common";
import { use, useEffect, useMemo, useRef, useState, type FC } from "react";
import { fetchEvents } from "../api";
import { CITIES, cityName, isNationwide } from "../data/cities";
import { CATEGORIES, categoryBySlug } from "../data/categories";
import type { GlobalEvent } from "../data/events";
import { allOverridesQuery, evolu, useTypedEvolu } from "../evolu";
import { useUserPrefs } from "../hooks/usePrefs";
import { reconcileRsvps, syncRsvp } from "../lib/rsvpSync";
import { formatEventDateBlock, formatEventRange } from "../lib/fmt";
import { IconCheck, IconCity, IconClock, IconExternal, IconPin, IconQuestion, IconX } from "../components/Icons";
import { AttendeeListModal } from "../components/AttendeeListModal";
import { ProposeEventModal } from "../components/ProposeEventModal";
import { fetchTierState } from "../lib/tierSystem";

type Status = "going" | "maybe" | "not_going";

// Recurring ICS events land as separate rows with IDs like
// `ics-<uid>-YYYY-MM-DD` per instance. Group them so the calendar doesn't
// get drowned by 50 weekly meetups of the same series; we only show the
// first two upcoming instances per series by default.
const ICS_INSTANCE_RE = /^(ics-.+)-\d{4}-\d{2}-\d{2}$/;
function seriesKey(id: string): string {
  const m = id.match(ICS_INSTANCE_RE);
  return m ? m[1] : id;
}
const SERIES_HEAD = 2;

export const CalendarTab: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;
  const { prefs } = useUserPrefs();
  const [events, setEvents] = useState<readonly GlobalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<string>("");
  const [scope, setScope] = useState<"upcoming" | "past" | "all">("upcoming");
  const [attendeesFor, setAttendeesFor] = useState<{ id: string; title: string } | null>(null);
  const [tier, setTier] = useState<number>(1);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const overrides = useQuery(allOverridesQuery);
  const { insert, update } = useTypedEvolu();

  const overrideMap = useMemo(() => {
    const m = new Map<string, { id: string; status: Status; note: string | null }>();
    for (const o of overrides) {
      m.set(o.eventId as string, {
        id: o.id,
        status: (o.status as Status) ?? "maybe",
        note: (o.note as string | null) ?? null,
      });
    }
    return m;
  }, [overrides]);

  useEffect(() => {
    let mounted = true;
    fetchEvents().then((e) => {
      if (mounted) { setEvents(e); setLoading(false); }
    });
    return () => { mounted = false; };
  }, [reloadKey]);

  // Tier check for the "Navrhnout akci" button gate. One-shot fetch.
  useEffect(() => {
    let mounted = true;
    fetchTierState(ownerId).then((t) => {
      if (mounted && t) setTier(t.tier);
    });
    return () => { mounted = false; };
  }, [ownerId]);

  const now = Date.now();

  const filtered = useMemo(() => {
    // Explicit single-city pick from the dropdown — exact match only.
    // "Moje města" (no explicit pick + user has preferred cities) also
    // includes nationwide/online events, so Pražák sees celorepublic
    // online meetups in his default feed.
    let cityScope: Set<string> | null = null;
    let includeNationwide = false;
    if (cityFilter) {
      cityScope = new Set([cityFilter]);
    } else if (prefs.cities.length > 0) {
      cityScope = new Set(prefs.cities);
      includeNationwide = true;
    }

    return [...events]
      .filter((ev) => {
        if (cityScope) {
          const hitScope = ev.cities.some((c) => cityScope!.has(c));
          const hitNationwide = includeNationwide && ev.cities.some(isNationwide);
          if (!hitScope && !hitNationwide) return false;
        }
        const endMs = new Date(ev.endsAt).getTime();
        if (scope === "upcoming") return endMs >= now;
        if (scope === "past") return endMs < now;
        return true;
      })
      .sort((a, b) =>
        scope === "past" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt),
      );
  }, [events, cityFilter, prefs.cities, scope, now]);

  const setStatus = (eventId: string, status: Status) => {
    const existing = overrideMap.get(eventId);
    if (existing) {
      const parsed = NonEmptyTrimmedString100.from(status);
      if (!parsed.ok) return;
      update("eventOverride", { id: existing.id, status: parsed.value });
      void syncRsvp(eventId, status, ownerId);
      return;
    }
    const eventIdP = NonEmptyTrimmedString100.from(eventId);
    const statusP = NonEmptyTrimmedString100.from(status);
    if (eventIdP.ok && statusP.ok) {
      insert("eventOverride", { eventId: eventIdP.value, status: statusP.value });
      void syncRsvp(eventId, status, ownerId);
    }
  };

  const clearStatus = (eventId: string) => {
    const existing = overrideMap.get(eventId);
    if (existing) {
      update("eventOverride", { id: existing.id, isDeleted: true as unknown as SqliteBoolean });
      void syncRsvp(eventId, null);
    }
  };

  // Heal any RSVPs that never reached the backend (offline, pre-sync-layer
  // clients). Runs once when overrides first arrive from Evolu.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    if (overrides.length === 0) return;
    reconciledRef.current = true;
    void reconcileRsvps(
      overrides.map((o) => ({ eventId: o.eventId as string, status: o.status as string })),
      ownerId,
    );
  }, [overrides]);

  if (loading) return <div className="loading">Načítám akce…</div>;

  const upcomingCount = events.filter((e) => new Date(e.endsAt).getTime() >= now).length;

  return (
    <div>
      <h1 className="page-h">Kalendář <span className="counter">{upcomingCount} nadchází</span></h1>
      <p className="page-sub">Meetupy, přednášky a setkání napříč jednadvacítkami.</p>

      {tier >= 4 && (
        <div style={{ marginBottom: "0.8rem" }}>
          <button className="btn btn-primary btn-sm" onClick={() => setProposeOpen(true)}>
            ➕ Navrhnout akci
          </button>
        </div>
      )}

      <div className="toolbar">
        <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">
            {prefs.cities.length > 0
              ? `Moje města (${prefs.cities.length})`
              : "Všechna města"}
          </option>
          {CITIES.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <div className="chip-row">
          {(["upcoming", "past", "all"] as const).map((s) => (
            <button
              key={s}
              className={`chip selectable ${scope === s ? "active" : ""}`}
              onClick={() => setScope(s)}
            >
              {s === "upcoming" ? "Nadcházející" : s === "past" ? "Proběhlé" : "Vše"}
            </button>
          ))}
        </div>
      </div>

      {/* Filter readout — exposes the active city scope so the user can verify
       *  multi-city selections are actually applied (we had a feedback report
       *  where it looked like only one city was being filtered). Hidden in the
       *  trivial "no filter" case. */}
      {!cityFilter && prefs.cities.length > 0 && (
        <p className="small muted" style={{ margin: "0.1rem 0 0.6rem" }}>
          Filtruji akce pro: <strong>{prefs.cities.map(cityName).join(", ")}</strong>
          {" "}<span className="faint">(+ celorepubliková a online)</span>
        </p>
      )}
      {cityFilter && (
        <p className="small muted" style={{ margin: "0.1rem 0 0.6rem" }}>
          Filtruji akce pro: <strong>{cityName(cityFilter)}</strong>
        </p>
      )}

      {prefs.cities.length === 0 && scope === "upcoming" && (
        <div className="card" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
          <p className="hint" style={{ color: "var(--ink)" }}>
            <strong>Tip:</strong> Zvol si města v záložce <span className="kbd">Nastavení</span> a uvidíš jen akce, které tě zajímají.
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">ŽÁDNÉ AKCE</div>
          <p>
            {scope === "upcoming"
              ? "Žádné nadcházející akce ve vybraných městech."
              : "Nic k zobrazení."}
          </p>
        </div>
      ) : (
        <div>
          {(() => {
            // Count instances per series so we can render a "show more"
            // affordance only when the series is actually recurring. For
            // "past" scope we don't fold — users usually want the full
            // timeline there.
            // Hard cap per series: show only the SERIES_HEAD nearest
            // upcoming instances. Past view keeps the full timeline so users
            // can scroll back through history.
            const seen = new Map<string, number>();
            const output: Array<{ kind: "event"; ev: GlobalEvent }> = [];
            const shouldFold = scope !== "past";

            for (const ev of filtered) {
              const key = seriesKey(ev.id);
              const idx = (seen.get(key) ?? 0);
              seen.set(key, idx + 1);
              if (!shouldFold || idx < SERIES_HEAD) {
                output.push({ kind: "event", ev });
              }
              // idx >= SERIES_HEAD: drop — UX preference: noise-free feed.
            }

            return output.map((item) => {
              const ev = item.ev;
              const start = formatEventDateBlock(ev.startsAt);
              const ov = overrideMap.get(ev.id);
              return (
              <div className="event" key={ev.id}>
                <div className="event-date">
                  <span className="month">{start.month}</span>
                  <span className="day">{start.day}</span>
                  <span className="weekday">{start.weekday}</span>
                </div>
                <div className="event-body">
                  <div className="flex-row space-between" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
                    <h3 className="event-title">{ev.title}</h3>
                    {ov && <span className={`event-status ${ov.status}`}>
                      {ov.status === "going" ? "jedu" : ov.status === "maybe" ? "možná" : "nejedu"}
                    </span>}
                  </div>
                  <div className="event-meta">
                    <span><IconClock className="icon" /> {formatEventRange(ev.startsAt, ev.endsAt)}</span>
                    {ev.location && <span><IconPin className="icon" /> {ev.location}</span>}
                    {ev.cities.length > 0 && (
                      <span><IconCity className="icon" /> {ev.cities.map(cityName).join(", ")}</span>
                    )}
                    {(ev.goingCount ?? 0) > 0 && (
                      <button
                        type="button"
                        className="going-badge going-badge-btn"
                        title="Klikni pro seznam"
                        onClick={() => setAttendeesFor({ id: ev.id, title: ev.title })}
                      >
                        <IconCheck className="icon" /> {ev.goingCount} {ev.goingCount === 1 ? "jde" : ev.goingCount! < 5 ? "jdou" : "jde"}
                      </button>
                    )}
                  </div>
                  {ev.categories.length > 0 && (
                    <div className="chip-row" style={{ marginBottom: "0.4rem" }}>
                      {ev.categories.slice(0, 3).map((slug) => {
                        const cat = categoryBySlug(slug);
                        return <span key={slug} className="chip">{cat?.name ?? slug}</span>;
                      })}
                    </div>
                  )}
                  {ev.description && <p className="small muted event-description">{truncate(stripHtml(ev.description), 300)}</p>}
                  <div className="event-actions">
                    {ev.url && (
                      <a className="btn btn-sm btn-secondary" href={ev.url} target="_blank" rel="noopener noreferrer">
                        Detail <IconExternal style={{ width: 12, height: 12 }} />
                      </a>
                    )}
                    {(ov?.status === "going" || ov?.status === "maybe") && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => { window.location.hash = `#chat/event:${ev.id}`; }}
                        title="Otevřít diskusní vlákno k akci (jen pro účastníky)"
                      >
                        💬 Diskuse
                      </button>
                    )}
                    <button
                      className={`btn btn-sm ${ov?.status === "going" ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setStatus(ev.id, "going")}
                    >
                      <IconCheck style={{ width: 14, height: 14 }} /> Jedu
                    </button>
                    <button
                      className={`btn btn-sm ${ov?.status === "maybe" ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setStatus(ev.id, "maybe")}
                    >
                      <IconQuestion style={{ width: 14, height: 14 }} /> Možná
                    </button>
                    <button
                      className={`btn btn-sm ${ov?.status === "not_going" ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setStatus(ev.id, "not_going")}
                    >
                      <IconX style={{ width: 14, height: 14 }} /> Nejedu
                    </button>
                    {ov && (
                      <button className="btn btn-sm btn-ghost" onClick={() => clearStatus(ev.id)}>
                        Zrušit
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            });
          })()}
        </div>
      )}

      {attendeesFor && (
        <AttendeeListModal
          eventId={attendeesFor.id}
          eventTitle={attendeesFor.title}
          onClose={() => setAttendeesFor(null)}
        />
      )}

      {proposeOpen && (
        <ProposeEventModal
          ownerId={ownerId}
          onClose={() => setProposeOpen(false)}
          onSubmitted={() => {
            setProposeOpen(false);
            alert("Návrh odeslán. Po schválení adminem se objeví v kalendáři.");
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
};

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}
