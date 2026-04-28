import { useState, type FC } from "react";
import { adminBroadcast, type BroadcastResult } from "../../api";
import { CITIES } from "../../data/cities";
import { CATEGORIES } from "../../data/categories";
import { toggleInArray } from "../shared";
import { buildCatTag, buildCityTag } from "../../../../shared/pushTags.js";

export const BroadcastView: FC<{ token: string }> = ({ token }) => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [cities, setCities] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title.trim()) { setErr("Zadej titulek."); return; }
    const tags = [
      ...cities.map(buildCityTag),
      ...cats.map(buildCatTag),
    ];
    if (tags.length === 0) {
      if (!window.confirm("Necháš prázdné tagy → notifikace dostane VŠICHNI. Pokračovat?")) return;
    }
    setBusy(true); setErr("");
    const r = await adminBroadcast(token, {
      title: title.trim(),
      body: body.trim(),
      ...(url.trim() ? { url: url.trim() } : {}),
      tags,
    });
    setBusy(false);
    if (!r) { setErr("Broadcast selhal."); return; }
    setResult(r);
  };

  return (
    <div>
      <div className="card">
        <h2>Rozeslat notifikaci</h2>
        <p className="hint">
          Notifikace dorazí všem zařízením, jejichž <em>libovolný</em> zájmový tag protíná vybrané tagy.
          Server <strong>nezná identitu uživatelů</strong> — posílá jen na anonymní push endpointy.
        </p>
        <div className="form mt-md">
          <div className="field">
            <label>Titulek *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Např. Pražský meetup za 2 dny" />
          </div>
          <div className="field">
            <label>Text</label>
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="field">
            <label>URL po kliknutí (volitelné)</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/ nebo https://…" />
          </div>
          <div className="field">
            <label>Cílit na města (aspoň jedno)</label>
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
            <label>Nebo na kategorie</label>
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
          {err && <p className="error">{err}</p>}
          <div className="row-actions">
            <button className="btn btn-primary" onClick={send} disabled={busy}>
              {busy ? "Rozesílám…" : "Rozeslat"}
            </button>
          </div>
          {result && (
            <div className="mt-md success-msg">
              ✅ Odesláno: {result.sent} / {result.matched} cílených (selhání: {result.failed}).
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
