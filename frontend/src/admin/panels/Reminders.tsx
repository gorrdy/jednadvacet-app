import { useState, type FC } from "react";
import { adminFireReminders, adminRemindersUpcoming, type ReminderUpcoming } from "../../api";
import { formatDateTime, formatRelative } from "../../lib/fmt";
import { useAsync } from "../../hooks/useAsync";
import { ErrorBox } from "../../components/ErrorBox";
import { LoadingSpinner } from "../../components/LoadingSpinner";

export const RemindersView: FC<{ token: string }> = ({ token }) => {
  const [firing, setFiring] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading } = useAsync(() => adminRemindersUpcoming(token), [token, reloadKey]);

  const fire = async () => {
    if (!window.confirm(
      "Pustit reminder teď? Odešle push všem subscribero všech kanálů se zítřejšími akcemi. Dedup tabulka zabrání double-send do stejného kanálu/dne.",
    )) return;
    setFiring(true);
    const r = await adminFireReminders(token);
    setFiring(false);
    if (!r.ok) alert(`Selhalo: ${r.error ?? "?"}`);
    else alert(`Odesláno ${r.sent ?? 0} notifikací.`);
    setReloadKey((k) => k + 1);
  };

  if (loading) return <LoadingSpinner />;
  if (!data) return <ErrorBox message="Nelze načíst." />;

  const { preview, history } = data;
  const recipientsTotal = preview.channels.reduce((n, c) => n + c.recipientCount, 0);

  return (
    <div>
      <div className="card">
        <div className="flex-row space-between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Plánované notifikace</h2>
            <p className="hint">
              Denní <strong>reminder zítřejších akcí</strong> se spouští automaticky každý den
              {preview.reminderHour != null
                ? <> v <strong>{String(preview.reminderHour).padStart(2, "0")}:00</strong> {preview.timezone}.</>
                : <>. <span className="error" style={{ display: "inline" }}>Reminder je vypnutý (REMINDER_HOUR=env).</span></>}
              Broadcast na jednotlivá zařízení probíhá per-tag <span className="mono">city:&lt;slug&gt;</span> —
              server nikdy nespojuje token s reálnou identitou.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={fire} disabled={firing}>
            {firing ? "Posílám…" : "Odeslat teď"}
          </button>
        </div>

        {preview.nextFireAt && (
          <div className="mt-md">
            <div className="small muted">Příští odeslání</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {formatDateTime(preview.nextFireAt)}
              <span className="muted" style={{ fontWeight: 400, marginLeft: "0.4rem" }}>
                ({formatRelative(preview.nextFireAt).replace("před ", "za ")} — Prague)
              </span>
            </div>
          </div>
        )}

        <div className="flex-row mt-md" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
          <div>
            <div className="small muted">Zítřejší den</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{preview.day}</div>
          </div>
          <div>
            <div className="small muted">Kanálů s akcí</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{preview.channels.length}</div>
          </div>
          <div>
            <div className="small muted">Příjemců celkem</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{recipientsTotal}</div>
          </div>
        </div>
      </div>

      {preview.channels.length === 0 ? (
        <div className="empty-state">
          <p>Na <strong>{preview.day}</strong> žádné akce — reminder nepošle nic.</p>
        </div>
      ) : (
        preview.channels.map((ch) => <ChannelCard key={ch.slug} ch={ch} />)
      )}

      <section className="card mt-lg">
        <h3>Historie posledních odeslání</h3>
        {history.length === 0 ? (
          <p className="muted small">Zatím žádný reminder nevyjel.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--hairline)", textAlign: "left" }}>
                <th style={{ padding: "0.4rem 0.3rem" }}>Den</th>
                <th style={{ padding: "0.4rem 0.3rem" }}>Kanál</th>
                <th style={{ padding: "0.4rem 0.3rem", textAlign: "right" }}>Akce</th>
                <th style={{ padding: "0.4rem 0.3rem", textAlign: "right" }}>Odesláno</th>
                <th style={{ padding: "0.4rem 0.3rem" }}>Kdy</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--hairline)" }}>
                  <td style={{ padding: "0.4rem 0.3rem" }} className="mono">{h.day}</td>
                  <td style={{ padding: "0.4rem 0.3rem" }}>{h.city}</td>
                  <td style={{ padding: "0.4rem 0.3rem", textAlign: "right" }}>{h.events}</td>
                  <td style={{ padding: "0.4rem 0.3rem", textAlign: "right" }}>{h.sent}</td>
                  <td style={{ padding: "0.4rem 0.3rem" }} className="small muted">
                    {formatRelative(h.sent_at.replace(" ", "T") + "Z")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

const ChannelCard: FC<{ ch: ReminderUpcoming["preview"]["channels"][number] }> = ({ ch }) => {
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  return (
    <div className="card" style={{ padding: "0.9rem 1rem" }}>
      <div className="flex-row space-between" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.05rem" }}>
            {ch.cityName}
          </div>
          <div className="small muted mono" style={{ fontSize: "0.75rem" }}>
            tag {ch.tag} · {ch.recipientCount} {ch.recipientCount === 1 ? "zařízení" : "zařízení"}
          </div>
        </div>
        {ch.alreadySent ? (
          <span className="chip" title={ch.alreadySentAt ?? ""}>
            ✓ Odesláno {ch.alreadySentCount ? `(${ch.alreadySentCount})` : ""}
          </span>
        ) : (
          <span className="chip" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}>
            Naplánováno
          </span>
        )}
      </div>

      <div className="mt-md">
        <div className="small muted" style={{ marginBottom: "0.3rem" }}>Akce ({ch.events.length})</div>
        {ch.events.map((e) => (
          <div key={e.id} style={{ padding: "0.3rem 0", borderBottom: "1px solid var(--hairline)" }}>
            <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{e.title}</div>
            <div className="small muted">
              {formatDateTime(e.startsAt)} · {e.location}
            </div>
          </div>
        ))}
      </div>

      {ch.recipients.length > 0 && (
        <div className="mt-md">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setRecipientsOpen((v) => !v)}
          >
            {recipientsOpen ? "Skrýt" : "Zobrazit"} příjemce ({ch.recipients.length})
          </button>
          {recipientsOpen && (
            <div className="mt-sm" style={{
              maxHeight: 220,
              overflowY: "auto",
              padding: "0.4rem 0.6rem",
              background: "var(--bg-elev)",
              border: "1px solid var(--hairline)",
              borderRadius: "0.4rem",
              fontFamily: "var(--mono)",
              fontSize: "0.75rem",
            }}>
              {ch.recipients.map((r, i) => (
                <div key={i} style={{ padding: "0.15rem 0" }}>
                  <span style={{ color: "var(--ember)" }}>…{r.tokenSuffix}</span>{" "}
                  <span className="muted">· {r.endpointHost}</span>
                </div>
              ))}
            </div>
          )}
          <p className="small muted mt-sm" style={{ marginBottom: 0 }}>
            Příjemci jsou anonymní push tokeny — server nezná jejich skutečnou identitu,
            jen opaque handle na push službu prohlížeče (Apple / Google / Mozilla).
          </p>
        </div>
      )}
    </div>
  );
};
