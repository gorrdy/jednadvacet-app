// Standardized inline error message — replaces 40+ inline
// `<p className="error">{err}</p>` sites with a single component.
// Returns null when message is null/empty so callers can pass the raw
// state value without an outer `&&` guard.
//
// Use the `small` variant for in-form field-level errors (matches the
// existing `<p className="error small">…` pattern used in wallet
// flows). The default size is for top-of-card / page-level errors.

import { type FC } from "react";

interface Props {
  message: string | null | undefined;
  small?: boolean;
}

export const ErrorBox: FC<Props> = ({ message, small }) => {
  if (!message) return null;
  return <p className={small ? "error small" : "error"}>{message}</p>;
};
