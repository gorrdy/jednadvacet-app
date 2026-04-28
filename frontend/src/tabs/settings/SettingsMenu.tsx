import { type FC } from "react";
import { useChatProfile } from "../../hooks/useChatProfile";
import { useCashu } from "../../hooks/useCashu";
import { initialsFor } from "../../lib/imageResize";
import { SettingsGroup, SettingsRow, type SettingsPanel } from "./shared";

interface Props {
  prefsCities: string[];
  prefsCategories: string[];
  pushActive: boolean;
  onOpen: (p: Exclude<SettingsPanel, null>) => void;
}

export const SettingsMenu: FC<Props> = ({ prefsCities, prefsCategories, pushActive, onOpen }) => {
  const { profile } = useChatProfile();
  const cashu = useCashu();

  return (
    <>
      {/* Top profile row — tap to open profile panel (iOS "Apple ID" pattern) */}
      <button
        className="settings-profile-card"
        onClick={() => onOpen("profile")}
        aria-label="Upravit profil"
      >
        <span className="settings-profile-avatar">
          {profile?.avatar
            ? <img src={profile.avatar} alt="" />
            : <span className="initials">{initialsFor(profile?.displayName ?? "?")}</span>}
        </span>
        <span className="settings-profile-text">
          <strong>{profile?.displayName ?? "Nastav přezdívku"}</strong>
          <span className="small muted">
            {profile?.bio ? profile.bio : profile ? "Přezdívka, fotka, QR, ID" : "Dokud nemáš profil, nemůžeš psát"}
          </span>
        </span>
        <span className="chevron">›</span>
      </button>

      <SettingsGroup>
        <SettingsRow
          icon="🔔"
          label="Notifikace"
          value={pushActive ? "Zapnuto" : "Vypnuto"}
          onClick={() => onOpen("notifications")}
        />
        <SettingsRow
          icon="🏙"
          label="Města zájmu"
          value={prefsCities.length > 0 ? `${prefsCities.length}` : "Žádné"}
          onClick={() => onOpen("cities")}
        />
        <SettingsRow
          icon="🏷"
          label="Témata"
          value={prefsCategories.length > 0 ? `${prefsCategories.length}` : "Žádné"}
          onClick={() => onOpen("categories")}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon="🔶"
          label="Peněženka (Cashu)"
          value={`${cashu.balances.total.toLocaleString("cs-CZ")} sats`}
          onClick={() => onOpen("wallet")}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon="🔐"
          label="Záložní fráze"
          value="BIP-39 24 slov"
          onClick={() => onOpen("seed")}
        />
      </SettingsGroup>

      {/* Admin application — only meaningful from tier 3+, but the panel
          itself shows a friendly "you need tier 3" message when below.
          Always offer the entry point so users see the path. */}
      {profile && (profile.tier ?? 1) >= 3 && (
        <SettingsGroup>
          <SettingsRow
            icon="🛡"
            label="Stát se adminem"
            value="pro tier 3+"
            onClick={() => onOpen("adminApply")}
          />
        </SettingsGroup>
      )}
    </>
  );
};
