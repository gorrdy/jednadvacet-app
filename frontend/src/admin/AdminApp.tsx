import { useEffect, useState, type FC } from "react";
import { adminLogout, adminMe, type AdminLoginResult, type AdminUser } from "../api";
import { IconCog, IconLogout, IconUsers } from "../components/Icons";
import { InviteRedeem } from "./InviteRedeem";
import { Dashboard } from "./Dashboard";
import { LoginScreen } from "./Login";
import { StatsView } from "./panels/Stats";
import { EventsView } from "./panels/Events";
import { BroadcastView } from "./panels/Broadcast";
import { UsersView } from "./panels/Users";
import { RemindersView } from "./panels/Reminders";
import { ApplicationsView } from "./panels/Applications";
import { EventProposalsView } from "./panels/EventProposals";
import { LS } from "../lib/storageKeys";

const TOKEN_KEY = LS.AdminSession;

interface Session {
  token: string;
  admin: AdminUser;
}

function readInviteCode(): string | null {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const code = params.get("invite");
  return code && /^[A-Za-z0-9_-]{8,64}$/.test(code) ? code : null;
}

function stripInviteFromUrl(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const url = new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
}

export const AdminApp: FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<string | null>(() => readInviteCode());

  useEffect(() => {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (!existing) { setLoading(false); return; }
    adminMe(existing).then((admin) => {
      if (admin) setSession({ token: existing, admin });
      else localStorage.removeItem(TOKEN_KEY);
      setLoading(false);
    });
  }, []);

  const acceptSession = (r: AdminLoginResult) => {
    localStorage.setItem(TOKEN_KEY, r.token);
    setSession({ token: r.token, admin: r.admin });
    setInvite(null);
    stripInviteFromUrl();
  };

  const signOut = async () => {
    if (session) await adminLogout(session.token);
    localStorage.removeItem(TOKEN_KEY);
    setSession(null);
  };

  if (loading) return <div className="loading" style={{ padding: "4rem 1rem" }}>Načítám…</div>;

  // Invite takes precedence: even if already logged in, the invitee flow is
  // independent (they may want to pair a different account).
  if (invite) {
    return (
      <InviteRedeem
        code={invite}
        onSuccess={acceptSession}
        onCancel={() => { setInvite(null); stripInviteFromUrl(); }}
      />
    );
  }

  if (!session) return <LoginScreen onSuccess={acceptSession} />;
  return <AdminShell session={session} signOut={signOut} />;
};

type View = "dashboard" | "stats" | "events" | "broadcast" | "reminders" | "users" | "applications" | "eventProposals";

const AdminShell: FC<{ session: Session; signOut: () => void }> = ({ session, signOut }) => {
  const isSuperadmin = session.admin.role === "superadmin";
  const [view, setView] = useState<View>(isSuperadmin ? "dashboard" : "events");

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <div className="brand">
          <span>Jednadvacet</span>
          <span className="sigil">21</span>
        </div>
        <div className="who">
          <span className="role-chip">{session.admin.role}</span>
          <span>{session.admin.email ?? session.admin.username ?? "—"}</span>
          <button className="btn btn-sm btn-ghost" onClick={signOut} title="Odhlásit">
            <IconLogout style={{ width: 14, height: 14 }} /> Odhlásit
          </button>
        </div>
      </div>

      <div className="admin-nav">
        {isSuperadmin && (
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            <IconCog style={{ width: 14, height: 14 }} /> Dashboard
          </button>
        )}
        <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}>Přehled</button>
        <button className={view === "events" ? "active" : ""} onClick={() => setView("events")}>Akce</button>
        <button className={view === "broadcast" ? "active" : ""} onClick={() => setView("broadcast")}>Notifikace</button>
        <button className={view === "reminders" ? "active" : ""} onClick={() => setView("reminders")}>Plánované</button>
        {isSuperadmin && (
          <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}>
            <IconUsers style={{ width: 14, height: 14 }} /> Uživatelé
          </button>
        )}
        {isSuperadmin && (
          <button className={view === "applications" ? "active" : ""} onClick={() => setView("applications")}>
            🛡 Žádosti
          </button>
        )}
        {/* Event proposals are open to all admins (superadmin + city
            admin), not just superadmin — community moderators are
            usually the right reviewers for their cities. */}
        <button className={view === "eventProposals" ? "active" : ""} onClick={() => setView("eventProposals")}>
          📅 Návrhy
        </button>
      </div>

      {view === "dashboard" && isSuperadmin && <Dashboard token={session.token} />}
      {view === "stats" && <StatsView token={session.token} />}
      {view === "events" && <EventsView token={session.token} admin={session.admin} />}
      {view === "broadcast" && <BroadcastView token={session.token} />}
      {view === "reminders" && <RemindersView token={session.token} />}
      {view === "users" && isSuperadmin && <UsersView token={session.token} self={session.admin} />}
      {view === "applications" && isSuperadmin && <ApplicationsView token={session.token} />}
      {view === "eventProposals" && <EventProposalsView token={session.token} />}
    </div>
  );
};
