// Tiny shared utilities pulled out of server.js so every module doesn't
// need to re-declare the same one-liners.

import crypto from "node:crypto";
import { db } from "./db.js";

export const splitCsv = (v) => (v ? String(v).split(",").filter(Boolean) : []);
export const joinCsv = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).join(",") : "");

export const asArticle = (r) => ({
  id: r.id,
  title: r.title,
  excerpt: r.excerpt,
  body: r.body,
  url: r.url,
  author: r.author,
  publishedAt: r.published_at,
  feedName: r.feed_name ?? null,
  cover: r.cover ?? undefined,
});

export const asEvent = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  location: r.location,
  url: r.url ?? undefined,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  cities: splitCsv(r.cities_csv),
  categories: splitCsv(r.categories_csv),
  organizer: r.organizer ?? undefined,
  // Public aggregate: how many RSVP'd "going". Exposed to everyone so users
  // can see "X lidí jde" on the calendar. `maybe` and `not_going` stay
  // admin-only (granular intent is more identifying than just attendance).
  goingCount: Number(r.going_count ?? 0),
});

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const safeId = (prefix) => `${prefix}-${crypto.randomBytes(6).toString("base64url").toLowerCase()}`;

export function isValidIso(s) {
  if (typeof s !== "string" || s.length < 8) return false;
  return Number.isFinite(Date.parse(s));
}

export const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,40}$/;

/** Public shape of a chat_user row + tier joined from user_tier so the
 *  client doesn't need an extra fetch when rendering chat messages.
 *  `tier=1` if the user has no user_tier row yet (legacy rows). */
export function profileShape(row) {
  const t = db.prepare("SELECT tier FROM user_tier WHERE owner_id = ?").get(row.owner_id);
  return {
    ownerId: row.owner_id,
    displayName: row.display_name,
    avatar: row.avatar ?? null,
    bio: row.bio ?? null,
    updatedAt: row.updated_at,
    tier: t?.tier ?? 1,
  };
}

// Token / id validators used across multiple route files. Each is a thin
// length+charset gate — full identity verification still happens in the
// handler against the relevant DB table.
export const validOwnerId = (x) =>
  typeof x === "string" && x.length >= 16 && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x);
export const validOpaqueToken = (t) =>
  typeof t === "string" && t.length >= 16 && t.length <= 128;
export const validDisplayName = (n) =>
  typeof n === "string" && n.trim().length >= 2 && n.trim().length <= 40;

/** Build the public shape of an admin_user row. */
export function publicAdmin(row) {
  return {
    id: row.id,
    email: row.email ?? null,
    username: row.username ?? null,
    role: row.role,
    city: row.city ?? null,
    displayName: row.display_name ?? null,
  };
}
