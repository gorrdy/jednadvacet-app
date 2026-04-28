import { useEffect, useState, type FC } from "react";
import {
  adminCreateInvite, adminCreateUser, adminDeleteUser,
  adminListInvites, adminListUsers, adminResetUserPassword, adminRevokeInvite,
  type AdminInvite, type AdminUser,
} from "../../api";
import { CITIES, cityName } from "../../data/cities";
import { IconCopy } from "../../components/Icons";

export const UsersView: FC<{ token: string; self: AdminUser }> = ({ token, self }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([adminListUsers(token), adminListInvites(token)]).then(([u, i]) => {
      if (!mounted) return;
      setUsers(u);
      setInvites(i);
    });
    return () => { mounted = false; };
  }, [token, reloadKey]);

  const remove = async (u: AdminUser) => {
    if (u.id === self.id) { alert("Nemůžeš smazat svůj vlastní účet."); return; }
    const label = u.email ?? u.username ?? u.id;
    if (!window.confirm(`Smazat admina ${label}?`)) return;
    const r = await adminDeleteUser(token, u.id);
    if (!r.ok) { alert(r.error ?? "Smazání selhalo."); return; }
    setReloadKey((k) => k + 1);
  };

  const resetPw = async (u: AdminUser) => {
    const label = u.email ?? u.username ?? u.id;
    const pw = window.prompt(`Nové heslo pro ${label} (min. 8 znaků):`);
    if (!pw) return;
    if (pw.length < 8) { alert("Heslo musí mít alespoň 8 znaků."); return; }
    const r = await adminResetUserPassword(token, u.id, pw);
    if (!r.ok) { alert(r.error ?? "Změna hesla selhala."); return; }
    alert("Heslo změněno. Existující přihlášení byla odhlášena.");
  };

  const revokeInvite = async (code: string) => {
    if (!window.confirm("Zrušit tuto pozvánku?")) return;
    const r = await adminRevokeInvite(token, code);
    if (!r.ok) { alert(r.error ?? "Zrušení selhalo."); return; }
    setReloadKey((k) => k + 1);
  };

  const activeInvites = invites.filter((i) => !i.used);
  const usedInvites = invites.filter((i) => i.used);

  return (
    <div>
      <div className="row-actions mt-sm" style={{ marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => setInviting(true)}>✉︎ Pozvat admina</button>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>+ Ručně přidat</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>Obnovit</button>
      </div>

      {inviting && (
        <InviteForm
          token={token}
          onSaved={() => { setInviting(false); setReloadKey((k) => k + 1); }}
          onCancel={() => setInviting(false)}
        />
      )}

      {adding && (
        <UserForm
          token={token}
          onSaved={() => { setAdding(false); setReloadKey((k) => k + 1); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {activeInvites.length > 0 && (
        <section className="card" style={{ padding: "0.9rem 1rem" }}>
          <h3 style={{ marginTop: 0 }}>Aktivní pozvánky</h3>
          {activeInvites.map((inv) => <InviteRow key={inv.code} inv={inv} onRevoke={revokeInvite} />)}
        </section>
      )}

      <h3 style={{ margin: "1.2rem 0 0.5rem" }}>Admini</h3>
      {users.length === 0 ? (
        <div className="empty-state"><p>Žádní admini.</p></div>
      ) : (
        users.map((u) => <AdminRow key={u.id} u={u} isSelf={u.id === self.id} onReset={() => resetPw(u)} onRemove={() => remove(u)} />)
      )}

      {usedInvites.length > 0 && (
        <details style={{ marginTop: "1.5rem" }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Použité pozvánky ({usedInvites.length})
          </summary>
          <div className="mt-sm">
            {usedInvites.map((inv) => (
              <div key={inv.code} className="card" style={{ padding: "0.6rem 0.85rem", opacity: 0.7 }}>
                <div className="small">
                  <span className="mono">{inv.code}</span> · role <strong>{inv.role}</strong>
                  {inv.city && <> · {cityName(inv.city)}</>}
                  {inv.usedByUsername && <> · použita jako <strong>{inv.usedByUsername}</strong></>}
                  {inv.usedByEmail && !inv.usedByUsername && <> · použita jako <strong>{inv.usedByEmail}</strong></>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

const AdminRow: FC<{ u: AdminUser; isSelf: boolean; onReset: () => void; onRemove: () => void }> = ({ u, isSelf, onReset, onRemove }) => {
  const label = u.email ?? u.username ?? u.id;
  const sub = u.email && u.username ? `${u.username} · ${u.email}` : null;
  return (
    <div className="card" style={{ padding: "0.85rem 1rem" }}>
      <div className="flex-row space-between" style={{ alignItems: "center", gap: "0.75rem" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {label}
            {isSelf && <span className="chip" style={{ fontSize: "0.7rem" }}>ty</span>}
          </div>
          {sub && <div className="small muted mono" style={{ fontSize: "0.72rem" }}>{sub}</div>}
          <div className="small muted">
            <span className="role-chip" style={{
              background: "var(--ember-soft)", border: "1px solid var(--ember-deep)",
              padding: "0.05rem 0.4rem", borderRadius: "0.35rem",
              fontFamily: "var(--mono)", fontSize: "0.7rem", marginRight: "0.4rem",
            }}>{u.role}</span>
            {u.city ? `· ${cityName(u.city)}` : "· bez města"}
            {u.displayName && ` · ${u.displayName}`}
          </div>
        </div>
        <div className="row-actions">
          <button className="btn btn-sm btn-secondary" onClick={onReset}>Heslo</button>
          {!isSelf && (
            <button className="btn btn-sm btn-danger" onClick={onRemove}>Smazat</button>
          )}
        </div>
      </div>
    </div>
  );
};

const InviteRow: FC<{ inv: AdminInvite; onRevoke: (code: string) => void }> = ({ inv, onRevoke }) => {
  const [copied, setCopied] = useState(false);
  const url = typeof location !== "undefined"
    ? `${location.origin}/admin?invite=${encodeURIComponent(inv.code)}`
    : `/admin?invite=${inv.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const daysLeft = Math.max(0, Math.round((new Date(inv.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <div className="mint-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
      <div className="flex-row space-between" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mint-name">
            {inv.displayName ?? "Pozvánka"} · <span className="mono" style={{ color: "var(--ember)" }}>{inv.role}</span>
            {inv.city && <> · {cityName(inv.city)}</>}
          </div>
          <div className="mint-url mono">{url}</div>
          <div className="small muted" style={{ marginTop: "0.25rem" }}>
            Platná ještě {daysLeft} {daysLeft === 1 ? "den" : daysLeft >= 2 && daysLeft <= 4 ? "dny" : "dní"}
            {inv.note && <> · {inv.note}</>}
          </div>
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn-sm btn-primary" onClick={copy}>
          <IconCopy style={{ width: 14, height: 14 }} /> {copied ? "Zkopírováno" : "Zkopírovat odkaz"}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onRevoke(inv.code)}>Zrušit</button>
      </div>
    </div>
  );
};

const InviteForm: FC<{ token: string; onSaved: () => void; onCancel: () => void }> = ({ token, onSaved, onCancel }) => {
  const [role, setRole] = useState<"admin" | "superadmin">("admin");
  const [city, setCity] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr("");
    const r = await adminCreateInvite(token, {
      role,
      ...(city ? { city } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Vytvoření selhalo."); return; }
    onSaved();
  };

  return (
    <div className="card">
      <h3>Nová pozvánka</h3>
      <p className="hint">
        Vytvoří unikátní odkaz. Pošli ho pozvanému — on se pak buď nově zaregistruje (uživatelské jméno + heslo, bez emailu), nebo napáruje stávající admin účet.
      </p>
      <div className="form mt-md">
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "superadmin")}>
            <option value="admin">admin (leader komunity)</option>
            <option value="superadmin">superadmin</option>
          </select>
        </div>
        <div className="field">
          <label>Město (volitelné)</label>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">— bez města —</option>
            {CITIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Zobrazované jméno (volitelné)</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Např. Leader Prahy" />
        </div>
        <div className="field">
          <label>Poznámka (volitelné)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Komu je pozvánka určená" />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Vytvářím…" : "Vytvořit pozvánku"}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Zrušit</button>
        </div>
      </div>
    </div>
  );
};

const UserForm: FC<{ token: string; onSaved: () => void; onCancel: () => void }> = ({ token, onSaved, onCancel }) => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "superadmin">("admin");
  const [city, setCity] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const e = email.trim();
    const u = username.trim();
    if (!e && !u) { setErr("Zadej email nebo uživatelské jméno."); return; }
    if (password.length < 8) { setErr("Heslo musí mít alespoň 8 znaků."); return; }
    setBusy(true); setErr("");
    const r = await adminCreateUser(token, {
      ...(e ? { email: e } : {}),
      ...(u ? { username: u } : {}),
      password,
      role,
      ...(city ? { city } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error?.includes("already exists") ? "Tento email nebo jméno už je použité." :
        r.error ?? "Uložení selhalo.",
      );
      return;
    }
    onSaved();
  };

  return (
    <div className="card">
      <h3>Ruční vytvoření admina</h3>
      <p className="hint small">Použij, když chceš admina vytvořit přímo, bez pozvánkového odkazu. Stačí buď email, nebo uživatelské jméno.</p>
      <div className="form mt-md">
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="volitelné" />
        </div>
        <div className="field">
          <label>Uživatelské jméno</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="volitelné, alternativa k emailu" />
        </div>
        <div className="field">
          <label>Heslo * (min. 8 znaků)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "superadmin")}>
            <option value="admin">admin (leader komunity)</option>
            <option value="superadmin">superadmin (celý web)</option>
          </select>
        </div>
        <div className="field">
          <label>Město (volitelné, pro community admina)</label>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">— bez města —</option>
            {CITIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Jméno (volitelné)</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Např. Honza" />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Ukládám…" : "Vytvořit"}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Zrušit</button>
        </div>
      </div>
    </div>
  );
};
