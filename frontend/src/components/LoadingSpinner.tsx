// Standardized loading state — replaces 15+ ad-hoc
// `<div className="loading">{label ?? "Načítám…"}</div>` sites with a
// single component so a future visual upgrade (animated spinner,
// skeleton screens, etc.) lands in one place.

import { type CSSProperties, type FC } from "react";

interface Props {
  /** Override the default "Načítám…" text. */
  label?: string;
  /** Optional inline style for the wrapper (mainly padding overrides). */
  style?: CSSProperties;
}

export const LoadingSpinner: FC<Props> = ({ label, style }) => (
  <div className="loading" style={style}>{label ?? "Načítám…"}</div>
);
