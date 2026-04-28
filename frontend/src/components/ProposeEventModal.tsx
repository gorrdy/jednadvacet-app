// Tier 4+ users propose events from the Calendar tab. Approval queue
// lives in the admin panel ("Návrhy akcí"); approved proposals mint a
// row in `events` so they show up in the public calendar.

import { useState, type FC } from "react";
import { CITIES } from "../data/cities";
import { CATEGORIES } from "../data/categories";
import { postEventProposal } from "../api";

interface Props {
  ownerId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

function localToIso(local: string): string {
  // datetime-local has no timezone; treat as local time and produce ISO.
  if (!local) return "";
  const d = new Date(local);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

export const ProposeEventModal: FC<Props> = ({ ownerId, onClose, onSubmitted }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [pickedCities, setPickedCities] = useState<string[]>([]);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (title.trim().length < 3) { setErr("Název musí mít aspoň 3 znaky."); return; }
    if (!location.trim()) { setErr("Vyplň místo konání."); return; }
    if (!startsAtLocal || !endsAtLocal) { setErr("Vyplň začátek a konec."); return; }
    const startsAt = localToIso(startsAtLocal);
    const endsAt = localToIso(endsAtLocal);
    if (!startsAt || !endsAt) { setErr("Neplatné datum."); return; }
    setSubmitting(true);
    const r = await postEventProposal({
      ownerId,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      location: location.trim(),
      ...(url.trim() ? { url: url.trim() } : {}),
      startsAt,
      endsAt,
      citiesCsv: pickedCities.join(","),
      categoriesCsv: pickedCats.join(","),
    });
    setSubmitting(false);
    if (!r.ok) { setErr(r.error); return; }
    onSubmitted();
  };

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container propose-event-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="propose-event-body">
          <h3 style={{ margin: "0 0 0.4rem" }}>Navrhnout akci</h3>
          <p className="small muted" style={{ margin: "0 0 1rem" }}>
            Tvůj návrh projde admin moderací. Po schválení se objeví v kalendáři.
          </p>

          <div className="form">
            <div className="field">
              <label>Název *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} />
            </div>
            <div className="field">
              <label>Popis</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value.slice(0, 5000))} />
            </div>
            <div className="field">
              <label>Místo *</label>
              <input value={location} onChange={(e) => setLocation(e.target.value.slice(0, 200))}
                placeholder="Např. Paralelní Polis, Praha" />
            </div>
            <div className="field">
              <label>Odkaz (volitelné)</label>
              <input value={url} onChange={(e) => setUrl(e.target.value.slice(0, 500))}
                placeholder="https://…" className="mono" />
            </div>
            <div className="field">
              <label>Začátek *</label>
              <input type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} />
            </div>
            <div className="field">
              <label>Konec *</label>
              <input type="datetime-local" value={endsAtLocal} onChange={(e) => setEndsAtLocal(e.target.value)} />
            </div>
            <div className="field">
              <label>Města</label>
              <div className="chip-row">
                {CITIES.map((c) => (
                  <button key={c.slug} type="button"
                    className={`chip selectable ${pickedCities.includes(c.slug) ? "active" : ""}`}
                    onClick={() => setPickedCities(
                      pickedCities.includes(c.slug)
                        ? pickedCities.filter((s) => s !== c.slug)
                        : [...pickedCities, c.slug],
                    )}
                  >{c.name}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Kategorie</label>
              <div className="chip-row">
                {CATEGORIES.map((c) => (
                  <button key={c.slug} type="button"
                    className={`chip selectable ${pickedCats.includes(c.slug) ? "active" : ""}`}
                    onClick={() => setPickedCats(
                      pickedCats.includes(c.slug)
                        ? pickedCats.filter((s) => s !== c.slug)
                        : [...pickedCats, c.slug],
                    )}
                  >{c.name}</button>
                ))}
              </div>
            </div>
            {err && <p className="error">{err}</p>}
            <div className="row-actions" style={{ marginTop: "0.6rem" }}>
              <button className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? "Odesílám…" : "Odeslat ke schválení"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Zrušit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
