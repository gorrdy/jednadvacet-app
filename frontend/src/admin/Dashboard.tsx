import { useEffect, useState, type FC } from "react";
import { adminDashboard, type DashboardPayload } from "../api";
import { formatDateLong, formatDayTick, formatRelative } from "../lib/fmt";

const TAB_LABELS: Record<string, string> = {
  "tab:home": "Domů",
  "tab:articles": "Novinky",
  "tab:calendar": "Kalendář",
  "tab:wallet": "Peněženka",
  "tab:profile": "Moje",
};

const pct = (n: number): string => `${Math.round(n * 100)} %`;

interface Props {
  token: string;
}

export const Dashboard: FC<Props> = ({ token }) => {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    adminDashboard(token).then((d) => { if (mounted) { setData(d); setLoading(false); } });
    const t = setInterval(() => setReloadKey((k) => k + 1), 30_000);
    return () => { mounted = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (reloadKey === 0) return;
    let mounted = true;
    adminDashboard(token).then((d) => { if (mounted && d) setData(d); });
    return () => { mounted = false; };
  }, [reloadKey, token]);

  if (loading) return <div className="loading">Načítám dashboard…</div>;
  if (!data) return <p className="error">Dashboard se nepodařilo načíst.</p>;

  const { devices, activity, features, content, tags, sync } = data;

  return (
    <div>
      <div className="dash-top-grid">
        <DualMetricCard label="Online teď" pair={activity.onlineNow} hint="posledních 5 min" accent />
        <DualMetricCard label="Aktivní dnes" pair={activity.activeToday} />
        <DualMetricCard label="Týden" pair={activity.active7d} hint="DAU / 7 dní" />
        <DualMetricCard label="Měsíc" pair={activity.active30d} hint="MAU / 30 dní" />
        <MetricCard label="Notifikace" value={devices.pushSubscribers} hint="registrovaná zařízení" />
        <MetricCard label="RSVP" value={content.rsvpTotal} hint={`${devices.rsvpTokens} zařízení`} />
      </div>

      <section className="card">
        <h3>Aktivita · 14 dní</h3>
        <DauBars series={activity.dauSeries} />
        <div className="flex-row mt-md" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div className="small muted">
            Instalovaných PWA: <strong>{pct(activity.standaloneRate)}</strong>
            <span className="faint"> · ze {activity.standaloneSample} aktivit tento týden</span>
          </div>
          <div className="small muted">
            Data rotují denně. Žádné IP, žádná vazba na push/RSVP token.
          </div>
        </div>
      </section>

      <div className="dash-two-col">
        <section className="card">
          <h3>Využití záložek · 30 dní</h3>
          <p className="hint small" style={{ marginTop: "-0.3rem" }}>
            Unikátní uživatelé, kteří danou záložku alespoň jednou otevřeli.
          </p>
          {features.length === 0 ? (
            <p className="muted small">Zatím žádná data.</p>
          ) : (
            <UsageBars items={features.map((f) => ({
              label: TAB_LABELS[f.kind] ?? f.kind.replace("tab:", ""),
              value: f.users,
              sub: f.devices > f.users ? `${f.devices} zařízení` : null,
            }))} />
          )}
        </section>

        <section className="card">
          <h3>Top akce podle účasti</h3>
          {content.topRsvp.length === 0 ? (
            <p className="muted small">Zatím nikdo nic RSVPnul.</p>
          ) : (
            <div>
              {content.topRsvp.slice(0, 6).map((e) => (
                <div key={e.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--hairline)" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{e.title}</div>
                  <div className="small muted" style={{ marginBottom: "0.3rem" }}>
                    {formatDateLong(e.startsAt)}
                  </div>
                  <div className="rsvp-counts">
                    <span className="pill going"><span className="n">{e.going}</span> jdu</span>
                    <span className="pill maybe"><span className="n">{e.maybe}</span> možná</span>
                    <span className="pill not_going"><span className="n">{e.notGoing}</span> nejdu</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dash-two-col">
        <section className="card">
          <h3>Zájmy publika</h3>
          {Object.keys(tags.byTag).length === 0 ? (
            <p className="muted small">Žádné registrované tagy.</p>
          ) : (
            <UsageBars items={Object.entries(tags.byTag).map(([tag, n]) => ({ label: tag, value: n }))} mono />
          )}
        </section>

        <section className="card">
          <h3>Obsah</h3>
          <div className="flex-row" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
            <div>
              <div className="small muted">Akce celkem</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{content.eventsTotal}</div>
            </div>
            <div>
              <div className="small muted">Články</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{content.articlesTotal}</div>
            </div>
            <div>
              <div className="small muted">Admini</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{devices.adminAccounts}</div>
            </div>
            <div>
              <div className="small muted">Aktivní pozvánky</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{devices.inviteActive}</div>
            </div>
          </div>
          <div className="mt-md">
            <div className="small muted" style={{ marginBottom: "0.3rem" }}>Akce dle zdroje</div>
            <div className="chip-row">
              {Object.entries(content.eventsBySource).map(([k, v]) => (
                <span key={k} className="chip"><span className="mono">{k}</span> <span className="muted">· {v}</span></span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h3>Synchronizace</h3>
        <SyncRow label="ICS (Google kalendář)" info={sync.ics} />
        <SyncRow label="RSS (blog)" info={sync.rss} />
      </section>

      <p className="small muted mt-lg center" style={{ marginBottom: "0.5rem" }}>
        Dashboard se obnovuje každých 30 sekund.
      </p>
    </div>
  );
};

// ─── Bits ──────────────────────────────────────────────────────

const MetricCard: FC<{ label: string; value: number; hint?: string; accent?: boolean }> = ({ label, value, hint, accent }) => (
  <div className={`metric-card ${accent ? "accent" : ""}`}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value.toLocaleString("cs-CZ")}</div>
    {hint && <div className="metric-hint">{hint}</div>}
  </div>
);

const DualMetricCard: FC<{ label: string; pair: { devices: number; users: number }; hint?: string; accent?: boolean }> = ({ label, pair, hint, accent }) => (
  <div className={`metric-card ${accent ? "accent" : ""}`}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{(pair.users || 0).toLocaleString("cs-CZ")}</div>
    <div className="metric-hint">
      uživatelů · <strong>{pair.devices.toLocaleString("cs-CZ")}</strong> zařízení
      {hint && <> · {hint}</>}
    </div>
  </div>
);

const DauBars: FC<{ series: Array<{ day: string; devices: number; users: number }> }> = ({ series }) => {
  const max = Math.max(1, ...series.map((s) => Math.max(s.devices, s.users)));
  return (
    <div>
      <div className="dau-bars">
        {series.map((s) => {
          const deviceH = Math.round((s.devices / max) * 100);
          const userH = Math.round((s.users / max) * 100);
          return (
            <div key={s.day} className="dau-bar" title={`${s.day}: ${s.users} userů, ${s.devices} zařízení`}>
              <div className="stack">
                <div className="bar users" style={{ height: `${Math.max(userH === 0 ? 0 : 2, userH)}%` }} />
                <div className="bar devices" style={{ height: `${Math.max(deviceH === 0 ? 0 : 2, deviceH)}%` }} />
              </div>
              <div className="n">{s.users}</div>
              <div className="d">{formatDayTick(s.day)}</div>
            </div>
          );
        })}
      </div>
      <div className="small muted mt-sm" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <span><span className="legend-swatch users" /> unikátní uživatelé</span>
        <span><span className="legend-swatch devices" /> zařízení</span>
      </div>
    </div>
  );
};

const UsageBars: FC<{ items: Array<{ label: string; value: number; sub?: string | null }>; mono?: boolean }> = ({ items, mono }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      {items.map((it) => (
        <div key={it.label} className="usage-row">
          <div className={`label ${mono ? "mono" : ""}`}>
            {it.label}
            {it.sub && <span className="small faint" style={{ marginLeft: "0.4rem" }}>{it.sub}</span>}
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <div className="n">{it.value}</div>
        </div>
      ))}
    </div>
  );
};

const SyncRow: FC<{ label: string; info: { intervalMs: number; lastSync: unknown } }> = ({ label, info }) => {
  const last = info.lastSync as { startedAt?: string; ok?: boolean; total?: number; new?: number; updated?: number; removed?: number; error?: string } | null;
  const ago = last?.startedAt ? formatRelative(last.startedAt) : "nikdy";
  return (
    <div style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--hairline)" }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="small muted">
        Interval {Math.round(info.intervalMs / 60000)} min · Poslední sync {ago}
        {last?.total != null && <> · {last.total} položek</>}
        {last?.error && <> · <span className="error" style={{ display: "inline" }}>chyba: {last.error}</span></>}
      </div>
    </div>
  );
};
