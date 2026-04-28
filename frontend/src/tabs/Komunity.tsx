// Komunity tab — hosts geolocation-based nearest communities + full
// directory of all CZ Jednadvacet communities (from /api/communities).
//
// Entry to a community is via its Signal group, gated by pow.jednadvacet.org
// — the same PoW anti-bot flow used on the jednadvacet.org map. Clicking
// "Vstoupit" opens the PoW page as an in-app overlay (iframe + postMessage
// back from the PoW server once the challenge is solved), never a new tab.
//
// Note: "Moje města" in Profile is a separate concern — it filters events
// in the feed/calendar by city. A user can be in the Signal group without
// the city being in their prefs, and vice versa.

import { useEffect, useMemo, useState, type FC } from "react";
import { fetchCommunities, type Community } from "../api";
import { NearestCommunities } from "../components/NearestCommunities";
import { CommunityStatsCard } from "../components/CommunityStatsCard";
import { PowModal } from "../components/PowModal";
import { IconExternal } from "../components/Icons";
import { shortCommunityName } from "../lib/communityName";
import { communityLogoUrl, GENERIC_LOGO } from "../lib/communityLogo";

// Czech regional capitals that also host a Jednadvacet community, ordered
// by city population (largest first). Shown before the alphabetically-sorted
// rest so someone in a large city sees it at the top.
const REGIONAL_PRIORITY = [
  "praha", "brno", "ostrava", "plzen", "liberec", "olomouc",
  "ceske-budejovice", "hradec-kralove",
  "pardubice", "zlin", "jihlava", "karlovy-vary",
];

/** Lowercase + strip diacritics for case- and accent-insensitive search. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Default size for the "Všechny komunity" preview — keeps the page short
// (regional capitals + a few extras) so the user isn't drowned by 80+
// communities on first scroll. Expand button reveals the rest.
const DEFAULT_VISIBLE = 10;

export const Komunity: FC = () => {
  const [communities, setCommunities] = useState<readonly Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [powSlug, setPowSlug] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchCommunities().then((d) => {
      if (!mounted) return;
      setCommunities(d?.communities ?? []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const sorted = useMemo(() => {
    // 1. Regional capitals in the hard-coded priority order, 2. the rest
    // sorted alphabetically using Czech collation (diacritics land right).
    const byRegional = new Map<string, number>();
    REGIONAL_PRIORITY.forEach((slug, i) => byRegional.set(slug, i));

    const regional: Community[] = [];
    const rest: Community[] = [];
    for (const c of communities) {
      if (byRegional.has(c.slug)) regional.push(c);
      else rest.push(c);
    }
    regional.sort((a, b) => (byRegional.get(a.slug) ?? 99) - (byRegional.get(b.slug) ?? 99));
    rest.sort((a, b) => shortCommunityName(a.name).localeCompare(shortCommunityName(b.name), "cs"));
    return [...regional, ...rest];
  }, [communities]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return sorted;
    return sorted.filter((c) =>
      normalize(shortCommunityName(c.name)).includes(q) ||
      normalize(c.slug).includes(q),
    );
  }, [sorted, query]);

  // When the user is searching, always render the full result set —
  // pagination would hide matches that are alphabetically deeper in
  // the list. Otherwise honor the showAll toggle.
  const isSearching = query.trim().length > 0;
  const visible = isSearching || showAll
    ? filtered
    : filtered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = filtered.length - visible.length;

  return (
    <div>
      <h1 className="page-h">Komunity</h1>
      <p className="hint">
        Lokální Jednadvacet skupiny v ČR. Klepni <strong>Vstoupit</strong> →
        ověř se proti botům → přejdi do Signal skupiny.
      </p>

      <NearestCommunities onEnter={setPowSlug} />

      <CommunityStatsCard />

      <section className="card">
        <div className="flex-row space-between" style={{ alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Všechny komunity</h2>
          <span className="small muted mono">{sorted.length}</span>
        </div>

        <input
          type="search"
          className="komunity-search mt-md"
          placeholder="Hledat komunitu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <div className="loading">Načítám…</div>
        ) : filtered.length === 0 ? (
          <p className="muted mt-md">Nic nenalezeno{query ? ` pro "${query}"` : ""}.</p>
        ) : (
          <>
            <div className="community-grid mt-md">
              {visible.map((c) => (
                <CommunityCard key={c.slug} c={c} onEnter={setPowSlug} />
              ))}
            </div>
            {hiddenCount > 0 && (
              <button
                className="btn btn-secondary mt-md"
                style={{ width: "100%" }}
                onClick={() => setShowAll(true)}
              >
                Zobrazit zbývajících {hiddenCount}
              </button>
            )}
            {showAll && !isSearching && filtered.length > DEFAULT_VISIBLE && (
              <button
                className="btn btn-ghost btn-sm mt-md"
                style={{ width: "100%" }}
                onClick={() => setShowAll(false)}
              >
                Sbalit
              </button>
            )}
          </>
        )}
      </section>

      {powSlug && <PowModal slug={powSlug} onClose={() => setPowSlug(null)} />}
    </div>
  );
};

const CommunityCard: FC<{ c: Community; onEnter: (slug: string) => void }> = ({ c, onEnter }) => (
  <div className="community-card">
    <div className="community-icon">
      <img
        src={communityLogoUrl(c.slug)}
        alt=""
        onError={(e) => {
          const el = e.currentTarget as HTMLImageElement;
          if (!el.src.endsWith(GENERIC_LOGO)) el.src = GENERIC_LOGO;
          else el.style.display = "none";
        }}
      />
    </div>
    <div className="community-body">
      <div className="community-name">{shortCommunityName(c.name)}</div>
      {c.website && (
        <a className="small muted" href={c.website} target="_blank" rel="noopener noreferrer">
          Web <IconExternal style={{ width: 10, height: 10 }} />
        </a>
      )}
    </div>
    <button
      className="btn btn-sm btn-primary"
      onClick={() => onEnter(c.slug)}
      title="Ověření proti botům → Signal"
    >
      Vstoupit
    </button>
  </div>
);
