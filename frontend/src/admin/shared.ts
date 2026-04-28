// Tiny helpers shared across admin panels.

/** Set-backed toggle: adding if missing, removing if present. */
export function toggleInArray(arr: string[], v: string): string[] {
  const s = new Set(arr);
  if (s.has(v)) s.delete(v);
  else s.add(v);
  return Array.from(s);
}
