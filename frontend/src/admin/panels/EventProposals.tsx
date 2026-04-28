// Admin panel: review tier-4+ user-proposed events. Approval mints a
// real `events` row with source='admin' so the proposed event appears
// in the public calendar; reject keeps the proposal on record with a
// reason for accountability.

import { useEffect, useState, type FC } from "react";
import {
  adminListEventProposals, adminReviewEventProposal,
  type EventProposalReview,
} from "../../api";
import { cityName } from "../../data/cities";
import { Avatar } from "../../components/Avatar";

type Tab = "pending" | "approved" | "rejected";

export const EventProposalsView: FC<{ token: string }> = ({ token }) => {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<EventProposalReview[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    adminListEventProposals(token, tab).then((rows) => {
      if (mounted) setItems(rows);
    });
    return () => { mounted = false; };
  }, [token, tab, reloadKey]);

  const decide = async (p: EventProposalReview, decision: "approved" | "rejected") => {
    setBusyId(p.id);
    const r = await adminReviewEventProposal(token, p.id, decision, rejectReason[p.id]);
    setBusyId(null);
    if (!r.ok) { alert(`Selhalo: ${r.error}`); return; }
    setReloadKey((k) => k + 1);
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <section className="card">
      <h2>Návrhy akcí</h2>
      <p className="hint">
        Tier 4+ uživatelé chatu navrhují akce pro komunitní kalendář.
        Po schválení se vytvoří řádka v <code>events</code> a akce se objeví
        v Kalendáři pro všechny.
      </p>

      <div className="row-actions mt-md">
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(t)}
          >
            {t === "pending" ? "Čekající" : t === "approved" ? "Schválené" : "Zamítnuté"}
          </button>
        ))}
      </div>

      <div className="mt-md">
        {items.length === 0 ? (
          <p className="muted small">Žádné návrhy.</p>
        ) : (
          items.map((p) => (
            <div key={p.id} className="card" style={{ marginBottom: "0.8rem" }}>
              <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-start" }}>
                <Avatar src={p.avatar} name={p.proposerName} className="chat-avatar" style={{ width: 36, height: 36 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong>{p.title}</strong>
                    <span className={`tier-badge tier-${p.currentTier}`}>T{p.currentTier}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: "0.2rem" }}>
                    {p.proposerName} · navrženo {fmt(p.proposedAt)}
                  </div>
                  <div className="small" style={{ marginTop: "0.4rem" }}>
                    📅 <strong>{fmt(p.startsAt)}</strong> → {fmt(p.endsAt)}
                  </div>
                  <div className="small">📍 {p.location}</div>
                  {p.url && <div className="small mono" style={{ wordBreak: "break-all" }}>🔗 {p.url}</div>}
                  {p.citiesCsv && (
                    <div className="small muted" style={{ marginTop: "0.2rem" }}>
                      Města: {p.citiesCsv.split(",").map((s) => s.trim()).filter(Boolean).map(cityName).join(", ")}
                    </div>
                  )}
                  {p.description && (
                    <p style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>
                      {p.description}
                    </p>
                  )}

                  {p.status === "pending" && (
                    <div className="form mt-md">
                      <input
                        placeholder="Důvod zamítnutí (volitelné)"
                        value={rejectReason[p.id] ?? ""}
                        onChange={(e) => setRejectReason({ ...rejectReason, [p.id]: e.target.value })}
                      />
                      <div className="row-actions" style={{ marginTop: "0.5rem" }}>
                        <button className="btn btn-primary btn-sm" onClick={() => decide(p, "approved")} disabled={busyId === p.id}>
                          ✓ Schválit a vytvořit akci
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => decide(p, "rejected")} disabled={busyId === p.id}>
                          ✗ Zamítnout
                        </button>
                      </div>
                    </div>
                  )}

                  {p.status === "approved" && p.approvedEventId && (
                    <p className="small" style={{ marginTop: "0.4rem", color: "var(--ok)" }}>
                      ✓ Schváleno · event ID: <code className="mono">{p.approvedEventId}</code>
                    </p>
                  )}
                  {p.status === "rejected" && p.rejectReason && (
                    <p className="small" style={{ marginTop: "0.4rem", color: "var(--danger)" }}>
                      Zamítnuto: {p.rejectReason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
