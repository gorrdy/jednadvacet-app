// iOS-style settings root: top-level menu lists groups; tapping a row
// slides in the corresponding panel. Each panel lives in its own file
// under `settings/` — this file just routes between them and computes
// the shared push/prefs state needed by both the menu summary and the
// notifications panel.

import { use, useMemo, useState, type FC } from "react";
import { evolu } from "../evolu";
import { useUserPrefs } from "../hooks/usePrefs";
import { LS, safeLs } from "../lib/storageKeys";
import { buildCatTag, buildChatTag, buildCityTag, buildUserTag } from "../../../shared/pushTags.js";
import { usePush } from "../hooks/usePush";
import { sendTestPush } from "../api";
import { CitiesPanel } from "./settings/CitiesPanel";
import { CategoriesPanel } from "./settings/CategoriesPanel";
import { NotificationsPanel } from "./settings/NotificationsPanel";
import { WalletPanel } from "./settings/WalletPanel";
import { RecoveryPanel } from "./settings/RecoveryPanel";
import { ChatProfilePanel } from "./settings/ChatProfilePanel";
import { AdminApplyPanel } from "./settings/AdminApplyPanel";
import { SettingsMenu } from "./settings/SettingsMenu";
import { PANEL_TITLES, PanelHeader, type SettingsPanel } from "./settings/shared";

// iOS Safari only allows web push for installed PWAs (added to Home Screen).
// We detect that and show clearer copy so users don't enable push and wonder
// why nothing arrives.
function detectEnvironment(): { isIOS: boolean; isStandalone: boolean; isIOSSafari: boolean } {
  if (typeof navigator === "undefined") return { isIOS: false, isStandalone: false, isIOSSafari: false };
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return { isIOS, isStandalone, isIOSSafari };
}

export const Profile: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;
  const { prefs, toggleCity, toggleCategory } = useUserPrefs();
  const env = useMemo(detectEnvironment, []);

  // Per-device toggle: do we want push notifications for new chat messages?
  // Stored in localStorage (not Evolu) so the user can decide per-device
  // — phone yes, desktop no is a legit preference.
  const [chatPush, setChatPush] = useState<boolean>(() => safeLs.get(LS.ChatPush) === "1");
  const toggleChatPush = (next: boolean) => {
    setChatPush(next);
    if (next) safeLs.set(LS.ChatPush, "1");
    else safeLs.remove(LS.ChatPush);
  };

  const tags = [
    ...prefs.cities.map(buildCityTag),
    ...prefs.categories.map(buildCatTag),
    // Chat push channels: global is always included when chatPush is on;
    // per-city tags pile up per user preference. Broadcast-side uses
    // `chat:<slug>` join to send notifications only to opt-ins.
    ...(chatPush ? [buildChatTag("global"), ...prefs.cities.map(buildChatTag)] : []),
    // Personal-notification tag: incoming Lightning Address payments,
    // future direct-message pushes, etc. Always-on when push is enabled —
    // the user implicitly opted in by enabling notifications at all.
    buildUserTag(ownerId),
  ];
  const push = usePush(tags);

  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!push.token) return;
    setTesting(true);
    setTestResult(null);
    const r = await sendTestPush(push.token);
    setTesting(false);
    if (r.ok) setTestResult("✓ Odesláno. Pokud se notifikace do pár sekund neobjeví, viz troubleshooting níž.");
    else setTestResult(`✗ Selhalo: ${r.error ?? "neznámá chyba"}${r.statusCode ? ` (${r.statusCode})` : ""}`);
  };

  const iosNeedsInstall = env.isIOS && !env.isStandalone;

  const [panel, setPanel] = useState<SettingsPanel>(null);

  if (panel !== null) {
    return (
      <div>
        <PanelHeader title={PANEL_TITLES[panel]} onBack={() => setPanel(null)} />
        {panel === "profile" && <ChatProfilePanel />}
        {panel === "notifications" && (
          <NotificationsPanel
            push={push}
            tags={tags}
            iosNeedsInstall={iosNeedsInstall}
            testing={testing}
            testResult={testResult}
            onTest={handleTest}
            chatPush={chatPush}
            onToggleChatPush={toggleChatPush}
          />
        )}
        {panel === "cities" && <CitiesPanel prefs={prefs} toggleCity={toggleCity} />}
        {panel === "categories" && <CategoriesPanel prefs={prefs} toggleCategory={toggleCategory} />}
        {panel === "wallet" && <WalletPanel />}
        {panel === "seed" && <RecoveryPanel />}
        {panel === "adminApply" && <AdminApplyPanel />}
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-h">Nastavení</h1>
      <SettingsMenu
        prefsCities={prefs.cities}
        prefsCategories={prefs.categories}
        pushActive={push.state === "on"}
        onOpen={setPanel}
      />
    </div>
  );
};
