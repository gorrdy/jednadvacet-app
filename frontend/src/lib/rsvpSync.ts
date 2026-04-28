// Per-device RSVP token. Mirrors the anonymous push model — strictly
// separate from the push token so device-level push <-> rsvp identities
// can't be cross-referenced on the server (different localStorage keys,
// different backend tables, no FK).
//
// Evolu remains source of truth for the user. The backend copy is a
// write-only aggregate ledger so event organizers see counts.

import { LS } from "./storageKeys";

const LS_KEY = LS.RsvpToken;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}

export function getOrCreateRsvpToken(): string {
  try {
    const existing = localStorage.getItem(LS_KEY);
    if (existing && existing.length >= 16) return existing;
    const t = generateToken();
    localStorage.setItem(LS_KEY, t);
    return t;
  } catch {
    // Private mode / disabled storage → ephemeral token; accept that votes
    // won't dedupe across page loads. Rare enough to not care.
    return generateToken();
  }
}

import { apiDelete, apiPost } from "./http";

export async function syncRsvp(
  eventId: string,
  status: "going" | "maybe" | "not_going" | null,
  ownerId?: string | null,
): Promise<void> {
  const token = getOrCreateRsvpToken();
  // Fire-and-forget. If the backend is down now, the next reconcile
  // on Calendar mount will re-post the current state.
  if (status === null) await apiDelete("/api/rsvp", { token, eventId });
  else await apiPost("/api/rsvp", { token, eventId, status, ownerId: ownerId ?? null });
}

export async function reconcileRsvps(
  overrides: ReadonlyArray<{ eventId: string; status: string }>,
  ownerId?: string | null,
): Promise<void> {
  const token = getOrCreateRsvpToken();
  await Promise.all(
    overrides
      .filter((o) => o.status === "going" || o.status === "maybe" || o.status === "not_going")
      .map((o) => apiPost("/api/rsvp", { token, eventId: o.eventId, status: o.status, ownerId: ownerId ?? null })),
  );
}
