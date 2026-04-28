import { useState, type FC } from "react";
import { CITIES } from "../../data/cities";
import { IconX } from "../../components/Icons";

/** Cities selector — pinned "Vybrané" row + filtered pool with search.
 *  Plain 45-chip grid becomes visually overwhelming; this splits "vybrané"
 *  from "vše" and lets the user type-to-find a specific city. */
export const CitiesPanel: FC<{
  prefs: { cities: string[] };
  toggleCity: (slug: string) => void;
}> = ({ prefs, toggleCity }) => {
  const [q, setQ] = useState("");
  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const qq = normalize(q.trim());
  const selected = CITIES.filter((c) => prefs.cities.includes(c.slug));
  const pool = CITIES.filter((c) => !prefs.cities.includes(c.slug) &&
    (qq === "" || normalize(c.name).includes(qq) || normalize(c.slug).includes(qq)));

  return (
    <section className="card">
      <h2>Města zájmu</h2>
      <p className="hint">
        Vyber města, z kterých chceš vidět akce v kalendáři a dostávat notifikace.
        Nesouvisí se Signal skupinami — ty jsou v záložce <strong>Komunity</strong>.
      </p>

      {selected.length > 0 && (
        <div className="settings-block mt-md">
          <div className="small muted" style={{ marginBottom: "0.35rem" }}>Vybraná ({selected.length})</div>
          <div className="chip-row">
            {selected.map((c) => (
              <button
                key={c.slug}
                className="chip selectable active"
                onClick={() => toggleCity(c.slug)}
                title="Odebrat"
              >
                {c.name} <IconX style={{ width: 10, height: 10, marginLeft: "0.2rem", verticalAlign: "-1px" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        type="search"
        className="komunity-search mt-md"
        placeholder="Hledat město…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="chip-row mt-md">
        {pool.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            {qq ? `Nic pro "${q}".` : "Všechna města jsou už vybraná."}
          </p>
        ) : pool.map((c) => (
          <button
            key={c.slug}
            className="chip selectable"
            onClick={() => toggleCity(c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
};
