// Community-wide stats card for the Komunity tab. Shows the tier
// distribution as a horizontal bar chart + top organizers (tier 4+ users
// with matched events). Aims to make the tier ladder feel populated:
// "I'm tier 2 of N tiers, with X people above me" beats opaque progress.

import { type FC } from "react";
import { fetchCommunityStats } from "../api";
import { TIER_NAMES } from "../lib/tierSystem";
import { useAsync } from "../hooks/useAsync";
import { Avatar } from "./Avatar";

export const CommunityStatsCard: FC = () => {
  const { data: stats, loading } = useAsync(() => fetchCommunityStats(), []);

  if (loading || !stats || stats.totalUsers === 0) return null;

  const max = Math.max(...stats.tierDistribution.map((d) => d.count));

  return (
    <section className="card community-stats">
      <h2 style={{ margin: "0 0 0.4rem" }}>Komunita</h2>
      <p className="small muted" style={{ margin: "0 0 1rem" }}>
        {stats.totalUsers} {stats.totalUsers === 1 ? "uživatel" : stats.totalUsers < 5 ? "uživatelé" : "uživatelů"} v komunitě.
        Kde se nacházíš?
      </p>

      <div className="tier-dist">
        {stats.tierDistribution.map((d) => (
          <div key={d.tier} className={`tier-dist-row tier-${d.tier}`}>
            <span className="tier-dist-label">
              <span className={`tier-badge tier-${d.tier}`}>T{d.tier}</span>
              <span className="muted small">{TIER_NAMES[d.tier] ?? `Tier ${d.tier}`}</span>
            </span>
            <div className="tier-dist-bar">
              <div
                className={`tier-dist-fill tier-${d.tier}`}
                style={{ width: max > 0 ? `${(d.count / max) * 100}%` : "0%" }}
              />
            </div>
            <span className="tier-dist-count mono">{d.count}</span>
          </div>
        ))}
      </div>

      {stats.topOrganizers.length > 0 && (
        <>
          <h3 style={{ margin: "1.2rem 0 0.4rem", fontSize: "0.95rem" }}>Top pořadatelé</h3>
          <ul className="top-organizers">
            {stats.topOrganizers.map((o) => (
              <li key={o.displayName} className="top-organizer-row">
                <Avatar src={o.avatar} name={o.displayName} className="chat-avatar" />
                <span className="top-organizer-name">{o.displayName}</span>
                <span className={`tier-badge tier-${o.tier}`}>T{o.tier}</span>
                <span className="small muted">
                  {o.eventCount} {o.eventCount === 1 ? "akce" : o.eventCount < 5 ? "akce" : "akcí"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
