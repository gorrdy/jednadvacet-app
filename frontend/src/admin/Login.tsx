import { useState, type FC } from "react";
import { adminLogin, type AdminLoginResult } from "../api";

export const LoginScreen: FC<{ onSuccess: (r: AdminLoginResult) => void }> = ({ onSuccess }) => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !password) return;
    setBusy(true); setErr("");
    const r = await adminLogin(identifier.trim(), password);
    setBusy(false);
    if ("error" in r) {
      setErr(r.error === "bad credentials" ? "Nesprávný email/jméno nebo heslo." : r.error);
      return;
    }
    onSuccess(r);
  };

  return (
    <div className="admin-login">
      <h1>
        <span>Jednadvacet</span>
        <span className="sigil" style={{
          fontFamily: "var(--mono)",
          color: "var(--ember)",
          fontWeight: 700,
          border: "1px solid var(--ember)",
          padding: "0.1rem 0.4rem",
          borderRadius: "0.35rem",
          fontSize: "0.85rem",
          lineHeight: 1,
        }}>21 ADMIN</span>
      </h1>
      <p className="sub">Přihlášení pro leadery jednadvacítek a superadmina.</p>

      <section className="card">
        <div className="form">
          <div className="field">
            <label>Email nebo uživatelské jméno</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setErr(""); }}
              autoFocus
              autoComplete="username"
              placeholder="ty@example.com / honza_praha"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="field">
            <label>Heslo</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              autoComplete="current-password"
              placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" onClick={submit} disabled={busy || !identifier.trim() || !password}>
            {busy ? "Přihlašuji…" : "Přihlásit"}
          </button>
        </div>
      </section>
    </div>
  );
};
