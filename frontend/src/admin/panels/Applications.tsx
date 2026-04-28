// Superadmin panel: review tier-3+ user applications for community admin
// role. Approval here is a soft hand-shake — the actual admin_user
// account still goes through the email+password invite system, because
// chat owner_id (BIP-39 derived) and admin login are separate identity
// domains by design.

import { useEffect, useState, type FC } from "react";
import {
  adminListApplications, adminReviewApplication,
  type AdminApplicationReview,
} from "../../api";
import { cityName } from "../../data/cities";
import { initialsFor } from "../../lib/imageResize";

type Tab = "pending" | "approved" | "rejected";

export const ApplicationsView: FC<{ token: string }> = ({ token }) => {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<AdminApplicationReview[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    adminListApplications(token, tab).then((rows) => {
      if (mounted) setItems(rows);
    });
    return () => { mounted = false; };
  }, [token, tab, reloadKey]);

  const decide = async (a: AdminApplicationReview, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !rejectReason[a.id]) {
      if (!window.confirm("Zamítnout bez důvodu? (lepší napsat krátký důvod)")) return;
    }
    setBusyId(a.id);
    const r = await adminReviewApplication(token, a.id, decision, rejectReason[a.id]);
    setBusyId(null);
    if (!r.ok) { alert(`Selhalo: ${r.error}`); return; }
    setReloadKey((k) => k + 1);
  };

  return (
    <section className="card">
      <h2>Žádosti o admin roli</h2>
      <p className="hint">
        Tier 3+ uživatelé chatu žádají o community admin pro vybraná města.
        Schválení je hand-shake — pak vystavíš pozvánku přes <strong>Users → Vytvořit invite</strong>{" "}
        a pošleš ji uživateli (out-of-band: Signal/email).
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
          <p className="muted small">Žádné žádosti.</p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="application-row card" style={{ marginBottom: "0.8rem" }}>
              <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-start" }}>
                <span className="chat-avatar" aria-hidden="true" style={{ width: 40, height: 40 }}>
                  {a.avatar
                    ? <img src={a.avatar} alt="" />
                    : <span className="initials">{initialsFor(a.displayName)}</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong>{a.displayName}</strong>
                    <span className={`tier-badge tier-${a.currentTier}`}>T{a.currentTier}</span>
                    <span className="small muted">
                      podáno {new Date(a.appliedAt).toLocaleString("cs-CZ")}
                    </span>
                  </div>
                  <div className="small mono" style={{ color: "var(--ink-faint)", wordBreak: "break-all" }}>
                    {a.ownerId}
                  </div>
                  <div className="small muted" style={{ marginTop: "0.4rem" }}>
                    Města: <strong>
                      {a.citiesCsv.split(",").map((s) => s.trim()).filter(Boolean).map(cityName).join(", ")}
                    </strong>
                  </div>
                  {a.message && (
                    <p style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>
                      <em>{a.message}</em>
                    </p>
                  )}
                  {a.bio && (
                    <p className="small muted" style={{ marginTop: "0.3rem" }}>
                      Bio: {a.bio}
                    </p>
                  )}

                  {a.status === "pending" && (
                    <div className="form mt-md">
                      <input
                        placeholder="Důvod zamítnutí (volitelné)"
                        value={rejectReason[a.id] ?? ""}
                        onChange={(e) => setRejectReason({ ...rejectReason, [a.id]: e.target.value })}
                      />
                      <div className="row-actions" style={{ marginTop: "0.5rem" }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => decide(a, "approved")}
                          disabled={busyId === a.id}
                        >
                          ✓ Schválit
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => decide(a, "rejected")}
                          disabled={busyId === a.id}
                        >
                          ✗ Zamítnout
                        </button>
                      </div>
                    </div>
                  )}

                  {a.status === "rejected" && a.rejectReason && (
                    <p className="small" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
                      Zamítnuto: {a.rejectReason}
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
