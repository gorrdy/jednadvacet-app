// "Která komunita je ti nejblíž?" section for the Komunity tab.
//
// Privacy: geolocation coords are read in the browser and kept in memory +
// localStorage only. They are NEVER sent to the backend — distance is
// computed purely client-side against the static community centres the
// server publishes at /api/communities. We cache the last fix for 24 h so
// returning visitors don't get re-prompted.
//
// "Vstoupit" → https://pow.jednadvacet.org/<slug> — the same PoW anti-bot
// gate the public jednadvacet.org map uses before revealing Signal links.

import { useEffect, useMemo, useState, type FC } from "react";
import { fetchCommunities, type Community } from "../api";
import { IconPin } from "./Icons";
import { shortCommunityName } from "../lib/communityName";
import { communityLogoUrl, GENERIC_LOGO } from "../lib/communityLogo";
import { LS } from "../lib/storageKeys";
import { useUserPrefs } from "../hooks/usePrefs";

const POW_ORIGIN = "https://pow.jednadvacet.org";

function communityPowUrl(slug: string): string {
  return `${POW_ORIGIN}/${encodeURIComponent(slug)}`;
}

// Geolocation cache stays in localStorage — coords are inherently per-device
// and don't belong in a synced store.
const GEO_CACHE_KEY = LS.NearestGeo;
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedFix {
  lat: number;
  lng: number;
  ts: number;
}

function readCachedFix(): CachedFix | null {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as CachedFix;
    if (typeof f.lat !== "number" || typeof f.lng !== "number") return null;
    if (Date.now() - f.ts > GEO_CACHE_TTL_MS) return null;
    return f;
  } catch { return null; }
}

function writeCachedFix(lat: number, lng: number) {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
  } catch { /* ignore */ }
}

/** Great-circle distance in km. Haversine — good enough at city scale. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

type Status = "idle" | "locating" | "ok" | "denied" | "unavailable";

interface Props {
  /** Called when the user taps "Vstoupit". The parent should open the PoW
   *  overlay for the given slug. If omitted, falls back to opening the PoW
   *  page in a new tab (used on standalone/non-Komunity mounts). */
  onEnter?: (slug: string) => void;
}

export const NearestCommunities: FC<Props> = ({ onEnter }) => {
  const [communities, setCommunities] = useState<readonly Community[]>([]);
  const [fix, setFix] = useState<CachedFix | null>(() => readCachedFix());
  const [status, setStatus] = useState<Status>(() => (readCachedFix() ? "ok" : "idle"));
  const [error, setError] = useState<string | null>(null);
  const { prefs, save } = useUserPrefs();
  const dismissed = prefs.nearestDismissed;

  useEffect(() => {
    let mounted = true;
    fetchCommunities().then((d) => {
      if (!mounted || !d) return;
      setCommunities(d.communities);
    });
    return () => { mounted = false; };
  }, []);

  const top3 = useMemo(() => {
    if (!fix || communities.length === 0) return [];
    return communities
      .map((c) => ({ ...c, distanceKm: haversineKm(fix.lat, fix.lng, c.lat, c.lng) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 3);
  }, [fix, communities]);

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("Prohlížeč neumožňuje geolokaci.");
      return;
    }
    setStatus("locating");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        writeCachedFix(latitude, longitude);
        setFix({ lat: latitude, lng: longitude, ts: Date.now() });
        setStatus("ok");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          setError("Povol polohu v prohlížeči a zkus to znovu.");
        } else {
          setStatus("unavailable");
          setError(err.message || "Polohu se nepodařilo zjistit.");
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  };

  const dismiss = () => save({ nearestDismissed: true });
  const undismiss = () => save({ nearestDismissed: false });

  if (dismissed) {
    return (
      <div className="nearest-minicard">
        <span className="muted small">Nejbližší komunity jsou skryté.</span>
        <button className="link" onClick={undismiss}>Zobrazit znovu</button>
      </div>
    );
  }

  return (
    <section className="nearest-section">
      <div className="nearest-head">
        <div>
          <strong>Komunity poblíž</strong>
          <p className="small muted" style={{ margin: "0.1rem 0 0" }}>
            Poloha se nikam neposílá — počítá se jen lokálně v prohlížeči.
          </p>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={dismiss}
          title="Skrýt"
          style={{ padding: "0.1rem 0.4rem", fontSize: "1rem" }}
        >×</button>
      </div>

      {status === "idle" && (
        <button className="btn btn-secondary nearest-locate" onClick={locate}>
          <IconPin style={{ width: 14, height: 14 }} /> Najít nejbližší komunitu
        </button>
      )}

      {status === "locating" && (
        <div className="loading" style={{ padding: "0.7rem 0" }}>Zjišťuji polohu…</div>
      )}

      {(status === "denied" || status === "unavailable") && (
        <div className="error-soft">
          <p style={{ margin: 0 }}>{error}</p>
          <p className="small muted" style={{ marginTop: "0.3rem", marginBottom: 0 }}>
            Nebo si vyber město ručně v záložce <span className="kbd">Nastavení</span>.
          </p>
        </div>
      )}

      {status === "ok" && top3.length > 0 && (
        <>
          <div className="nearest-list">
            {top3.map((c) => {
              const enter = () => {
                if (onEnter) onEnter(c.slug);
                else window.open(communityPowUrl(c.slug), "_blank", "noopener,noreferrer");
              };
              return (
                <div key={c.slug} className="nearest-card">
                  <div className="nearest-icon">
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
                  <div className="nearest-body">
                    <div className="nearest-title">{shortCommunityName(c.name)}</div>
                    <div className="small muted">{formatDistance(c.distanceKm)}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={enter} title="Ověření proti botům → Signal">
                    Vstoupit
                  </button>
                </div>
              );
            })}
          </div>
          <div className="nearest-foot">
            <button className="link" onClick={locate}>Aktualizovat polohu</button>
          </div>
        </>
      )}
    </section>
  );
};
