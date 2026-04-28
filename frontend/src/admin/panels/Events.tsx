import { useEffect, useState, type FC } from "react";
import {
  adminCreateEvent, adminDeleteEvent, adminRsvps, fetchEvents,
  type AdminUser, type RsvpCounts,
} from "../../api";
import type { GlobalEvent } from "../../data/events";
import { CITIES, cityName } from "../../data/cities";
import { CATEGORIES } from "../../data/categories";
import { formatDateTime } from "../../lib/fmt";
import { toggleInArray } from "../shared";

export const EventsView: FC<{ token: string; admin: AdminUser }> = ({ token, admin }) => {
  const [events, setEvents] = useState<readonly GlobalEvent[]>([]);
  const [rsvps, setRsvps] = useState<Record<string, RsvpCounts>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchEvents(), adminRsvps(token)]).then(([es, rs]) => {
      if (!mounted) return;
      setEvents(es);
      setRsvps(rs);
    });
    return () => { mounted = false; };
  }, [reloadKey, token]);

  const remove = async (id: string) => {
    if (!window.confirm(`Smazat akci "${id}"?`)) return;
    const ok = await adminDeleteEvent(token, id);
    if (ok) setReloadKey((k) => k + 1);
    else alert("Smazání selhalo.");
  };

  return (
    <div>
      <div className="row-actions mt-sm" style={{ marginBottom: "0.9rem" }}>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Nová akce</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>Obnovit</button>
      </div>

      {adding && (
        <EventForm
          token={token}
          {...(admin.city ? { defaultCity: admin.city } : {})}
          onSaved={() => { setAdding(false); setReloadKey((k) => k + 1); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {events.length === 0 ? (
        <div className="empty-state"><p>Žádné akce.</p></div>
      ) : (
        events.map((ev) => {
          const c = rsvps[ev.id];
          return (
            <div key={ev.id} className="card" style={{ padding: "0.85rem 1rem" }}>
              <div className="flex-row space-between" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{ev.title}</div>
                  <div className="small muted">
                    {formatDateTime(ev.startsAt)} · {ev.cities.map(cityName).join(", ") || "—"}
                  </div>
                  {c && c.total > 0 ? (
                    <div className="rsvp-counts">
                      <span className="pill going"><span className="n">{c.going}</span> jdu</span>
                      <span className="pill maybe"><span className="n">{c.maybe}</span> možná</span>
                      <span className="pill not_going"><span className="n">{c.not_going}</span> nejdu</span>
                    </div>
                  ) : (
                    <div className="rsvp-counts">
                      <span className="pill" style={{ color: "var(--ink-faint)" }}>zatím žádná RSVP</span>
                    </div>
                  )}
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => remove(ev.id)}>Smazat</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

const EventForm: FC<{
  token: string;
  defaultCity?: string;
  onSaved: () => void;
  onCancel: () => void;
}> = ({ token, defaultCity, onSaved, onCancel }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [cities, setCities] = useState<string[]>(defaultCity ? [defaultCity] : []);
  const [cats, setCats] = useState<string[]>([]);
  const [organizer, setOrganizer] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || !startsAt || !endsAt || !location.trim() || cities.length === 0) {
      setErr("Vyplň název, lokaci, začátek, konec a alespoň jedno město.");
      return;
    }
    setBusy(true); setErr("");
    const saved = await adminCreateEvent(token, {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      ...(url.trim() ? { url: url.trim() } : {}),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      cities,
      categories: cats,
      ...(organizer.trim() ? { organizer: organizer.trim() } : {}),
    });
    setBusy(false);
    if (!saved) { setErr("Uložení selhalo."); return; }
    onSaved();
  };

  return (
    <div className="card">
      <h3>Nová akce</h3>
      <div className="form">
        <div className="field">
          <label>Název *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Popis</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Místo *</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label>Odkaz (volitelné)</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="flex-row" style={{ gap: "0.7rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Začátek *</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Konec *</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Města *</label>
          <div className="chip-row">
            {CITIES.map((c) => (
              <button
                key={c.slug}
                className={`chip selectable ${cities.includes(c.slug) ? "active" : ""}`}
                onClick={() => setCities(toggleInArray(cities, c.slug))}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Kategorie</label>
          <div className="chip-row">
            {CATEGORIES.map((c) => (
              <button
                key={c.slug}
                className={`chip selectable ${cats.includes(c.slug) ? "active" : ""}`}
                onClick={() => setCats(toggleInArray(cats, c.slug))}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Organizátor</label>
          <input value={organizer} onChange={(e) => setOrganizer(e.target.value)} />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Ukládám…" : "Uložit akci"}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Zrušit</button>
        </div>
      </div>
    </div>
  );
};
