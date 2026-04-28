// "Tip dne" — small rotating card shown on Home.
// Deterministic by calendar day (see data/tips.ts).

import type { FC } from "react";
import { getTipOfDay } from "../data/tips";

export const DailyTip: FC = () => {
  const tip = getTipOfDay();
  return (
    <section className="daily-tip">
      <div className="daily-tip-head">
        <span className="daily-tip-icon" aria-hidden="true">💡</span>
        <strong>Tip dne</strong>
      </div>
      <p className="daily-tip-body">{tip}</p>
    </section>
  );
};
