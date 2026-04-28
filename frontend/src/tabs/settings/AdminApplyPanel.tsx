// "Stát se community adminem" — settings panel for tier 3+ users to
// apply for an admin role over one or more cities. Approval is a soft
// hand-shake; the actual admin login (email+password) is set up
// out-of-band by the superadmin via the existing invite flow.

import { use, useEffect, useState, type FC } from "react";
import { evolu } from "../../evolu";
import { CITIES } from "../../data/cities";
import {
  fetchAdminApplication, postAdminApplication,
  type AdminApplicationStatus,
} from "../../api";
import { fetchTierState, type TierState } from "../../lib/tierSystem";

export const AdminApplyPanel: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;

  const [tier, setTier] = useState<TierState | null>(null);
  const [existing, setExisting] = useState<AdminApplicationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickedCities, setPickedCities] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTierState(ownerId), fetchAdminApplication(ownerId)])
      .then(([t, a]) => {
        if (cancelled) return;
        setTier(t);
        setExisting(a);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ownerId]);

  if (loading) return <p className="small muted">Načítám…</p>;

  // Tier gate
  if (!tier || tier.tier < 3) {
    return (
      <section className="card">
        <h2>Stát se community adminem</h2>
        <p className="hint">
          Admin role je otevřená pro tier 3 a výš. Aktuálně jsi <strong>Tier {tier?.tier ?? 1}</strong>.
          Postup začíná v Profile → Tvoje úroveň.
        </p>
      </section>
    );
  }

  // Existing application — show status
  if (existing && existing.status === "pending") {
    return (
      <section className="card">
        <h2>Stát se community adminem</h2>
        <p className="hint">
          Tvoje žádost byla odeslána <strong>{new Date(existing.appliedAt).toLocaleString("cs-CZ")}</strong>{" "}
          a čeká na schválení od superadmina.
        </p>
        <p className="small muted">
          Požadovaná města: <strong>{existing.citiesCsv.split(",").map((s) => s.trim()).join(", ")}</strong>
        </p>
        {existing.message && (
          <p className="small">Tvoje zpráva: <em>{existing.message}</em></p>
        )}
      </section>
    );
  }
  if (existing && existing.status === "approved") {
    return (
      <section className="card">
        <h2>Stát se community adminem</h2>
        <p style={{ color: "var(--ok)" }}>
          ✓ Tvoje žádost byla schválena. Superadmin se ti ozve s pozvánkou pro
          vytvoření admin účtu (email + heslo, oddělené od chat identity).
        </p>
      </section>
    );
  }
  if (existing && existing.status === "rejected") {
    return (
      <section className="card">
        <h2>Stát se community adminem</h2>
        <p style={{ color: "var(--danger)" }}>Tvoje žádost byla zamítnuta.</p>
        {existing.rejectReason && (
          <p className="small muted">Důvod: <em>{existing.rejectReason}</em></p>
        )}
        <p className="small muted">
          Můžeš podat novou žádost níže.
        </p>
        {/* Fall through to the form — rejected applications can be retried. */}
        <ApplyForm
          ownerId={ownerId}
          pickedCities={pickedCities}
          setPickedCities={setPickedCities}
          message={message}
          setMessage={setMessage}
          submitting={submitting}
          err={err}
          submitted={submitted}
          onSubmit={async () => {
            setErr(null);
            if (pickedCities.length === 0) { setErr("Vyber alespoň jedno město."); return; }
            setSubmitting(true);
            const r = await postAdminApplication(ownerId, pickedCities.join(","), message);
            setSubmitting(false);
            if (!r.ok) setErr(r.error);
            else setSubmitted(true);
          }}
        />
      </section>
    );
  }

  if (submitted) {
    return (
      <section className="card">
        <h2>Stát se community adminem</h2>
        <p style={{ color: "var(--ok)" }}>
          ✓ Žádost odeslána. Superadmin ji zkontroluje a ozve se ti.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Stát se community adminem</h2>
      <p className="hint">
        Jsi <strong>Tier {tier.tier}</strong> a chceš pomáhat vést komunitu? Vyber, kterým
        městům bys chtěl(a) administrovat (přidávat akce, posílat broadcasty), a stručně
        napiš proč. Superadmin žádost zkontroluje a ozve se ti s pozvánkou pro vytvoření
        admin účtu.
      </p>
      <ApplyForm
        ownerId={ownerId}
        pickedCities={pickedCities}
        setPickedCities={setPickedCities}
        message={message}
        setMessage={setMessage}
        submitting={submitting}
        err={err}
        submitted={submitted}
        onSubmit={async () => {
          setErr(null);
          if (pickedCities.length === 0) { setErr("Vyber alespoň jedno město."); return; }
          setSubmitting(true);
          const r = await postAdminApplication(ownerId, pickedCities.join(","), message);
          setSubmitting(false);
          if (!r.ok) setErr(r.error);
          else setSubmitted(true);
        }}
      />
    </section>
  );
};

const ApplyForm: FC<{
  ownerId: string;
  pickedCities: string[];
  setPickedCities: (cs: string[]) => void;
  message: string;
  setMessage: (s: string) => void;
  submitting: boolean;
  err: string | null;
  submitted: boolean;
  onSubmit: () => void;
}> = ({ pickedCities, setPickedCities, message, setMessage, submitting, err, onSubmit }) => {
  const toggle = (slug: string) => {
    if (pickedCities.includes(slug)) setPickedCities(pickedCities.filter((s) => s !== slug));
    else setPickedCities([...pickedCities, slug]);
  };
  return (
    <div className="form mt-md">
      <div className="field">
        <label>Města ({pickedCities.length}/10)</label>
        <div className="chip-row">
          {CITIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              className={`chip selectable ${pickedCities.includes(c.slug) ? "active" : ""}`}
              onClick={() => toggle(c.slug)}
              disabled={!pickedCities.includes(c.slug) && pickedCities.length >= 10}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Krátká zpráva pro superadmina (volitelné)</label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
          placeholder="Např. Pořádám měsíční meetupy v Brně, mám spojení s místní komunitou…"
        />
        <p className="small muted" style={{ marginTop: "0.3rem" }}>{message.length}/1000</p>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" onClick={onSubmit} disabled={submitting || pickedCities.length === 0}>
        {submitting ? "Odesílám…" : "Odeslat žádost"}
      </button>
    </div>
  );
};
