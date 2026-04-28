import { type FC } from "react";
import { CATEGORIES } from "../../data/categories";

export const CategoriesPanel: FC<{
  prefs: { categories: string[] };
  toggleCategory: (slug: string) => void;
}> = ({ prefs, toggleCategory }) => (
  <section className="card">
    <p className="hint">
      Preferované kategorie se zobrazí v novinkách nahoře a ovlivní notifikace.
    </p>
    <div className="chip-row mt-md">
      {CATEGORIES.map((c) => (
        <button
          key={c.slug}
          className={`chip selectable ${prefs.categories.includes(c.slug) ? "active" : ""}`}
          onClick={() => toggleCategory(c.slug)}
        >
          {c.name}
        </button>
      ))}
    </div>
  </section>
);
