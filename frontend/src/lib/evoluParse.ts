// Evolu branded-string parse helpers. The repo had 27 places writing
//   const p = NonEmptyTrimmedString100.from(x);
//   if (!p.ok) return;
//   use p.value;
// Collapses to:
//   const s = toNET100(x);
//   if (!s) return;
//   use s;
// `null` result means the input didn't parse into the requested brand —
// callers decide to skip, throw, or fall back.

import { NonEmptyString1000, NonEmptyTrimmedString100 } from "@evolu/common";

export function toNET100(v: string | null | undefined): NonEmptyTrimmedString100 | null {
  if (!v) return null;
  const r = NonEmptyTrimmedString100.from(v);
  return r.ok ? r.value : null;
}

export function toNES1000(v: string | null | undefined): NonEmptyString1000 | null {
  if (!v) return null;
  const r = NonEmptyString1000.from(v);
  return r.ok ? r.value : null;
}
