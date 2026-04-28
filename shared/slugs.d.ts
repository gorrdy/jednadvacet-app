export const DM_SLUG_RE: RegExp;
export const EVENT_SLUG_RE: RegExp;

export function dmSlugFor(a: string, b: string): string | null;
export function parseDmSlug(slug: string): { a: string; b: string } | null;
export function parseEventSlug(slug: string): { eventId: string } | null;
