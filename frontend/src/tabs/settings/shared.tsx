// Settings primitives shared between the menu and the panels.
import { type FC, type ReactNode } from "react";

export type SettingsPanel =
  | null
  | "profile"
  | "notifications"
  | "cities"
  | "categories"
  | "wallet"
  | "seed"
  | "adminApply";

export const PANEL_TITLES: Record<Exclude<SettingsPanel, null>, string> = {
  profile: "Profil",
  notifications: "Notifikace",
  cities: "Města zájmu",
  categories: "Témata",
  wallet: "Peněženka",
  seed: "Záložní fráze",
  adminApply: "Stát se adminem",
};

export const PanelHeader: FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <div className="settings-panel-head">
    <button className="btn btn-sm btn-ghost" onClick={onBack}>← Zpět</button>
    <h1 className="page-h" style={{ margin: 0 }}>{title}</h1>
    <div />
  </div>
);

export const SettingsGroup: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="settings-group">{children}</div>
);

export const SettingsRow: FC<{
  icon: string;
  label: string;
  value?: string;
  onClick: () => void;
}> = ({ icon, label, value, onClick }) => (
  <button className="settings-row" onClick={onClick}>
    <span className="settings-row-icon">{icon}</span>
    <span className="settings-row-label">{label}</span>
    {value && <span className="settings-row-value">{value}</span>}
    <span className="chevron">›</span>
  </button>
);
