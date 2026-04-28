import { useEffect, useState, type FC } from "react";
import {
  fetchInviteInfo,
  redeemInvite,
  type AdminLoginResult,
  type InvitePublicInfo,
} from "../api";
import { cityName } from "../data/cities";
import { formatDateTime } from "../lib/fmt";

interface Props {
  code: string;
  onSuccess: (result: AdminLoginResult) => void;
  onCancel: () => void;
}

export const InviteRedeem: FC<Props> = ({ code, onSuccess, onCancel }) => {
  const [info, setInfo] = useState<InvitePublicInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"create" | "pair">("create");

  useEffect(() => {
    let mounted = true;
    fetchInviteInfo(code).then((r) => {
      if (!mounted) return;
      if ("error" in r) setLoadErr(r.error);
      else setInfo(r);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [code]);

  if (loading) return <div className="admin-login"><div className="loading">Ověřuji pozvánku…</div></div>;

  if (loadErr || !info) {
    return (
      <div className="admin-login">
        <h1><span>Pozvánka</span></h1>
        <p className="sub">Něco není v pořádku s tímto odkazem.</p>
        <section className="card">
          <p className="error">{loadErr ?? "Pozvánka nenalezena."}</p>
          <button className="btn btn-secondary mt-md" onClick={onCancel}>
            Jít na přihlášení
          </button>
        </section>
      </div>
    );
  }

  const expires = formatDateTime(info.expiresAt);

  return (
    <div className="admin-login">
      <h1>
        <span>Jednadvacet</span>
        <span style={{
          fontFamily: "var(--mono)",
          color: "var(--ember)",
          fontWeight: 700,
          border: "1px solid var(--ember)",
          padding: "0.1rem 0.4rem",
          borderRadius: "0.35rem",
          fontSize: "0.85rem",
          lineHeight: 1,
        }}>POZVÁNKA</span>
      </h1>
      <p className="sub">
        {info.displayName ? <strong>{info.displayName}</strong> : "Pozvánka"} pro roli
        {" "}<span className="mono" style={{ color: "var(--ember)" }}>{info.role}</span>
        {info.city && <> · město <strong>{cityName(info.city)}</strong></>}
      </p>
      {info.note && <p className="small muted" style={{ marginTop: "-0.6rem" }}>{info.note}</p>}
      <p className="small muted" style={{ marginTop: "0.2rem" }}>Platí do {expires}.</p>

      <section className="card">
        <div className="admin-nav" style={{ marginBottom: "1rem" }}>
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
            Nový účet
          </button>
          <button className={mode === "pair" ? "active" : ""} onClick={() => setMode("pair")}>
            Mám už účet
          </button>
        </div>

        {mode === "create"
          ? <CreateForm code={code} info={info} onSuccess={onSuccess} />
          : <PairForm code={code} onSuccess={onSuccess} />}
      </section>
    </div>
  );
};

const CreateForm: FC<{
  code: string;
  info: InvitePublicInfo;
  onSuccess: (r: AdminLoginResult) => void;
}> = ({ code, info, onSuccess }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(info.displayName ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || password.length < 8) {
      setErr("Vyplň uživatelské jméno a heslo (min. 8 znaků).");
      return;
    }
    setBusy(true); setErr("");
    const r = await redeemInvite(code, {
      mode: "create",
      username: username.trim(),
      password,
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    });
    setBusy(false);
    if ("error" in r) {
      setErr(
        r.error === "username already exists" ? "Toto jméno už je použité — zkus jiné." :
        r.error === "invite already used" ? "Tuto pozvánku už někdo použil." :
        r.error === "invite expired" ? "Pozvánka vypršela." :
        r.error,
      );
      return;
    }
    onSuccess(r);
  };

  return (
    <div className="form">
      <div className="field">
        <label>Uživatelské jméno *</label>
        <input
          value={username}
          onChange={(e) => { setUsername(e.target.value); setErr(""); }}
          autoFocus
          placeholder="např. honza_praha"
          autoComplete="username"
        />
        <p className="small muted mt-sm">
          3–40 znaků, písmena, číslice, <span className="mono">. _ -</span>. Nemusí to být email.
        </p>
      </div>
      <div className="field">
        <label>Heslo * (min. 8 znaků)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErr(""); }}
          autoComplete="new-password"
        />
      </div>
      <div className="field">
        <label>Zobrazované jméno (volitelné)</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Honza"
        />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Zakládám…" : "Založit účet a přihlásit"}
      </button>
    </div>
  );
};

const PairForm: FC<{
  code: string;
  onSuccess: (r: AdminLoginResult) => void;
}> = ({ code, onSuccess }) => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setErr("Vyplň přihlašovací údaje.");
      return;
    }
    setBusy(true); setErr("");
    const r = await redeemInvite(code, {
      mode: "pair",
      identifier: identifier.trim(),
      password,
    });
    setBusy(false);
    if ("error" in r) {
      setErr(
        r.error === "bad credentials" ? "Nesprávné údaje." :
        r.error === "invite already used" ? "Tuto pozvánku už někdo použil." :
        r.error === "invite expired" ? "Pozvánka vypršela." :
        r.error,
      );
      return;
    }
    onSuccess(r);
  };

  return (
    <div className="form">
      <p className="hint small">
        Přihlas se svým stávajícím admin účtem. Pozvánka se na něj napáruje a přiřadí ti roli/město.
      </p>
      <div className="field">
        <label>Email nebo uživatelské jméno *</label>
        <input
          value={identifier}
          onChange={(e) => { setIdentifier(e.target.value); setErr(""); }}
          autoFocus
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label>Heslo *</label>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErr(""); }}
          autoComplete="current-password"
        />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Napáruji…" : "Napárovat a přihlásit"}
      </button>
    </div>
  );
};
