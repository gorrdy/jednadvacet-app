// 4-step onboarding checklist shown on Home.
//
// Auto-detects progress from app state:
//   1. Wallet ready      — cashu has at least one mint configured (default
//                          cashu.cz is auto-added on first boot, so this is
//                          effectively pre-ticked for everyone).
//   2. First sats        — non-zero Cashu balance OR at least one receive tx.
//   3. Seed backed up    — user explicitly ticked "mám frázi zapsanou" in
//                          Moje (synced via Evolu prefs).
//   4. Community joined  — at least one city in prefs.cities.
//
// Once all four are done, the card auto-collapses (renders nothing). User can
// also dismiss it explicitly via the × button, persisted in synced prefs so
// the dismissal carries to other devices.

import { type FC } from "react";
import { useCashu } from "../hooks/useCashu";
import { useUserPrefs } from "../hooks/usePrefs";
import type { DirectoryTab, ScrollAnchor } from "../data/directory";
import { IconCheck } from "./Icons";

interface Props {
  onNavigate: (t: DirectoryTab) => void;
  onScrollTo: (a: ScrollAnchor) => void;
}

export const OnboardingChecklist: FC<Props> = ({ onNavigate, onScrollTo }) => {
  const cashu = useCashu();
  const { prefs, save } = useUserPrefs();

  const walletReady = cashu.mints.length > 0;
  const hasSats = cashu.balances.total > 0 || cashu.txs.some((t) => t.type === "receive" && t.status === "paid");
  const inCommunity = prefs.cities.length > 0;

  const allDone = walletReady && hasSats && prefs.seedBackedUp && inCommunity;
  if (allDone || prefs.onboardingDismissed) return null;

  const dismiss = () => save({ onboardingDismissed: true });

  const steps: Array<{ done: boolean; label: string; desc: string; onClick: () => void; cta: string }> = [
    {
      done: walletReady,
      label: "Máš peněženku",
      desc: "Cashu v appce — ecash na malé platby. Pustíš ji na záložce Peníze.",
      cta: "Otevřít",
      onClick: () => onNavigate("wallet"),
    },
    {
      done: hasSats,
      label: "První sats",
      desc: "Kup si nebo přijmi první sats. CZK přes Anycoin/Stosuj, KYC-free přes Vexl.",
      cta: "Kde koupit",
      onClick: () => onScrollTo("doporucujeme"),
    },
    {
      done: prefs.seedBackedUp,
      label: "Záloha fráze",
      desc: "24 slov (BIP-39). Napiš na papír. Potvrď v Nastavení → Záložní fráze.",
      cta: "Zálohovat",
      onClick: () => onNavigate("profile"),
    },
    {
      done: inCommunity,
      label: "Vyber si své město",
      desc: "V Nastavení → Města zájmu vyber, z jakých měst chceš vidět akce. V Komunity pak najdeš, jak se připojit do Signal skupiny.",
      cta: "Otevřít Nastavení",
      onClick: () => onNavigate("profile"),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="onboarding-card">
      <div className="onboarding-head">
        <div>
          <strong>První kroky</strong>
          <p className="small muted" style={{ margin: "0.15rem 0 0" }}>
            {doneCount}/4 hotovo — projdi si to.
          </p>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={dismiss}
          title="Skrýt"
          style={{ padding: "0.1rem 0.4rem", fontSize: "1rem" }}
        >×</button>
      </div>

      <div className="onboarding-progress">
        <div className="onboarding-progress-fill" style={{ width: `${(doneCount / 4) * 100}%` }} />
      </div>

      <ul className="onboarding-list">
        {steps.map((s, i) => (
          <li key={i} className={`onboarding-step ${s.done ? "done" : ""}`}>
            <div className="onboarding-step-check">
              {s.done ? <IconCheck /> : <span className="muted">{i + 1}</span>}
            </div>
            <div className="onboarding-step-body">
              <div className="onboarding-step-label">{s.label}</div>
              <div className="small muted">{s.desc}</div>
            </div>
            {!s.done && (
              <button className="btn btn-sm btn-secondary" onClick={s.onClick}>{s.cta}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
