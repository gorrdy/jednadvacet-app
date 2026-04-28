// Single source of truth for tier-question text rendered to users:
//   - `hintFor(id)`    — verbose hint shown next to a failed `client` check
//                         in the quiz modal.
//   - `shortLabel(id)` — one-line label used in the home-page checklist.
// Both are keyed by the question `id` strings defined in `backend/src/tier.js`.
// Keep the union of cases here in sync with `QUIZZES`.

import type { ReactNode } from "react";
import type { TierQuestion } from "./tierSystem";

export function hintFor(id: string): ReactNode {
  switch (id) {
    case "pwa_installed":
      return (
        <>
          Otevři v prohlížeči Sdílet →{" "}
          <strong>„Přidat na plochu"</strong> (iOS) nebo Menu →{" "}
          <strong>„Instalovat appku"</strong> (Android Chrome).
        </>
      );
    case "cities_selected":
      return <>Otevři <strong>Nastavení → Města zájmu</strong> a vyber alespoň jedno.</>;
    case "signal_joined":
      return <>Otevři <strong>Komunity</strong> a klikni <strong>Vstoupit</strong> u nějaké skupiny.</>;
    case "rsvp_attended":
      return <>V <strong>Kalendáři</strong> klikni "Jdu" u nějaké akce a přijď.</>;
    case "wallet_minted":
      return <>Otevři <strong>Peníze → Přijmout</strong> a nabij přes Lightning.</>;
    case "wallet_send_recv":
      return <>Otevři <strong>Peníze → Poslat</strong> a poprvé pošli/přijmi ecash token.</>;
    case "organized_event":
      return <>Uspořádej (nebo spolupořádej) meetup s ≥ 3 lidmi a v kvízu odklikni Ano.</>;
    case "referrals_active":
      return <>Pozvi 3 kamarády přes svůj referral link (najdeš v Profilu) a počkej, až dosáhnou tieru 3.</>;
    default:
      return <>Splň podmínku a zkus znovu.</>;
  }
}

export function shortLabel(q: TierQuestion): ReactNode {
  switch (q.id) {
    case "pwa_installed":     return "Přidat appku na plochu";
    case "cities_selected":   return "Vybrat alespoň jedno město";
    case "signal_joined":     return "Připojit se do Signal skupiny";
    case "rsvp_attended":     return "Přihlásit se a jít na akci";
    case "wallet_minted":     return "Nabít peněženku";
    case "wallet_send_recv":  return "Poslat / přijmout saty";
    case "organized_event":   return "Uspořádat meetup s ≥ 3 lidmi";
    case "referrals_active":  return "Pozvat 3 lidi přes referral link";
    default:                  return q.text;
  }
}
