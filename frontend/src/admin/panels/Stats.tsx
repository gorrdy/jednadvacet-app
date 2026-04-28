import { useEffect, useState, type FC } from "react";
import { adminStats, type AdminStats } from "../../api";

export const StatsView: FC<{ token: string }> = ({ token }) => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    adminStats(token).then((s) => { if (mounted) { setStats(s); setLoading(false); } });
    return () => { mounted = false; };
  }, [token]);

  if (loading) return <div className="loading">Načítám…</div>;
  if (!stats) return <p className="error">Statistiky nelze načíst.</p>;

  const tagEntries = Object.entries(stats.byTag).sort((a, b) => b[1] - a[1]);
  const sources = stats.bySource ?? {};

  return (
    <div>
      <div className="card">
        <h2>Anonymní přehled</h2>
        <p className="hint">
          Všechny metriky jsou agregáty anonymních identit (push tokeny, RSVP tokeny).
          Server nezná identitu ani e-mail žádného běžného uživatele — jen admini (vy) se přihlašujete.
        </p>
        <div className="mt-md flex-row" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
          <div>
            <div className="small muted">Registrovaná zařízení</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{stats.subscribers}</div>
          </div>
          <div>
            <div className="small muted">Publikovaných akcí</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{stats.events}</div>
          </div>
          <div>
            <div className="small muted">RSVP odpovědí</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{stats.rsvps ?? 0}</div>
          </div>
        </div>
        {Object.keys(sources).length > 0 && (
          <div className="mt-md">
            <div className="small muted" style={{ marginBottom: "0.3rem" }}>Akce dle zdroje</div>
            <div className="chip-row">
              {Object.entries(sources).map(([k, v]) => (
                <span key={k} className="chip"><span className="mono">{k}</span> <span className="muted">· {v}</span></span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Zařízení podle tagu</h3>
        {tagEntries.length === 0 ? (
          <p className="muted small">Žádné tagy zatím nejsou.</p>
        ) : (
          <div className="chip-row mt-sm">
            {tagEntries.map(([tag, n]) => (
              <span key={tag} className="chip">
                <span className="mono">{tag}</span> <span className="muted">· {n}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
