// Home directory — rendered as an accordion so the page doesn't firehose
// 30+ tiles at once. Each section is a distinct card with its own accent
// colour and a 1-line preview when collapsed. State persists per-section
// in localStorage so a user's preferred folds survive reloads.
//
// Defaults (first visit): "Začni tady" open, rest collapsed — so newcomers
// see the guided path first and discover the rest on their own terms.

import { useEffect, useState, type FC } from "react";
import {
  DIRECTORY_SECTIONS,
  type DirectorySection,
  type DirectoryTab,
  type DirectoryTile,
  type ScrollAnchor,
} from "../data/directory";

interface GridProps {
  onNavigate: (t: DirectoryTab) => void;
  onScrollTo: (a: ScrollAnchor) => void;
}

const DEFAULT_OPEN: Record<string, boolean> = {
  start: true,
  doporucujeme: true,
  tools: false,
};

const STORAGE_KEY = "jednadvacet-directory-open";

function readOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OPEN;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OPEN, ...parsed };
  } catch { return DEFAULT_OPEN; }
}

function writeOpenState(s: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
  catch { /* ignore */ }
}

export const DirectoryGrid: FC<GridProps> = ({ onNavigate, onScrollTo }) => {
  const [open, setOpen] = useState<Record<string, boolean>>(readOpenState);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeOpenState(next);
      return next;
    });
  };

  // External "open this section" requests — currently fired by the home
  // onboarding checklist's "Kde koupit" CTA so the user lands on an already-
  // expanded panel instead of a collapsed header.
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      setOpen((prev) => {
        if (prev[id]) return prev;
        const next = { ...prev, [id]: true };
        writeOpenState(next);
        return next;
      });
    };
    window.addEventListener("directory-open", h as EventListener);
    return () => window.removeEventListener("directory-open", h as EventListener);
  }, []);

  return (
    <>
      {DIRECTORY_SECTIONS.map((s) => (
        <AccordionSection
          key={s.id}
          section={s}
          isOpen={!!open[s.id]}
          onToggle={() => toggle(s.id)}
          onNavigate={onNavigate}
          onScrollTo={onScrollTo}
        />
      ))}
    </>
  );
};

const AccordionSection: FC<{
  section: DirectorySection;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate: (t: DirectoryTab) => void;
  onScrollTo: (a: ScrollAnchor) => void;
}> = ({ section, isOpen, onToggle, onNavigate, onScrollTo }) => {
  const preview = section.tiles.slice(0, 3).map((t) => t.label).join(" · ") +
    (section.tiles.length > 3 ? " · …" : "");
  const anchorId = section.id === "doporucujeme" ? "doporucujeme" : undefined;

  return (
    <section
      className={`directory-section accent-${section.id} ${isOpen ? "is-open" : ""}`}
      id={anchorId}
    >
      <button className="directory-section-head" onClick={onToggle} aria-expanded={isOpen}>
        <div className="directory-section-head-text">
          <div className="directory-section-title">{section.title}</div>
          {!isOpen && <div className="directory-section-preview">{preview}</div>}
          {isOpen && section.hint && <div className="directory-section-hint">{section.hint}</div>}
        </div>
        <div className="directory-section-meta">
          <span className="directory-section-count">{section.tiles.length}</span>
          <span className={`chevron ${isOpen ? "up" : ""}`} aria-hidden="true">›</span>
        </div>
      </button>

      {isOpen && (
        <div className="directory-grid">
          {section.tiles.map((t) => (
            <Tile key={t.id} tile={t} onNavigate={onNavigate} onScrollTo={onScrollTo} />
          ))}
        </div>
      )}
    </section>
  );
};

const Tile: FC<{ tile: DirectoryTile; onNavigate: (t: DirectoryTab) => void; onScrollTo: (a: ScrollAnchor) => void }> = ({ tile, onNavigate, onScrollTo }) => {
  const click = () => {
    if (tile.url) {
      window.open(tile.url, "_blank", "noopener,noreferrer");
    } else if (tile.tab) {
      onNavigate(tile.tab);
    } else if (tile.scroll) {
      onScrollTo(tile.scroll);
    }
  };
  return (
    <button className="directory-tile" onClick={click} title={tile.desc}>
      <span className="directory-tile-icon" aria-hidden="true">{tile.icon}</span>
      <span className="directory-tile-label">
        {tile.label}
        {tile.badge && <span className="directory-tile-badge">{tile.badge}</span>}
      </span>
      <span className="directory-tile-desc">{tile.desc}</span>
    </button>
  );
};
