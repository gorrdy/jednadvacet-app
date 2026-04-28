// Community `name` fields in the backend start with the "Jednadvacet "
// prefix for consistency with BTC Map's canonical labels ("Jednadvacet
// Praha", "Jednadvacet Brno" …). In the UI we drop that prefix — every
// label is already in the "Komunity" context, so the prefix is noise.

export function shortCommunityName(full: string): string {
  return full.replace(/^Jednadvacet\s+/i, "").trim();
}
