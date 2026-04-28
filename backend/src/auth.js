// Admin auth: scrypt-hashed passwords, session tokens, Express middleware.
//
// scrypt is sync here — login is rare, and blocking the loop briefly is
// preferable to wrapping every handler in async/await just for hashing.

import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "./db.js";
import { SESSION_TTL_DAYS, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } from "./config.js";
import { safeId } from "./helpers.js";

export function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${key}`;
}

export function verifyPassword(pw, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = scryptSync(pw, salt, 64);
  const want = Buffer.from(keyHex, "hex");
  if (key.length !== want.length) return false;
  return timingSafeEqual(key, want);
}

const sessionTtlMs = () => Math.max(1, SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000;

export function issueSession(adminId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs()).toISOString();
  db.prepare("INSERT INTO admin_session (token, admin_id, expires_at) VALUES (?, ?, ?)")
    .run(token, adminId, expiresAt);
  return { token, expiresAt };
}

export function lookupSession(token) {
  if (typeof token !== "string" || token.length < 16) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.username, u.role, u.city, u.display_name, s.expires_at
    FROM admin_session s
    JOIN admin_user u ON u.id = s.admin_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare("DELETE FROM admin_session WHERE token = ?").run(token);
    return null;
  }
  return {
    id: row.id,
    email: row.email ?? null,
    username: row.username ?? null,
    role: row.role,
    city: row.city ?? null,
    displayName: row.display_name ?? null,
  };
}

export function requireAdmin(req, res, next) {
  const h = req.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "missing bearer" });
  const admin = lookupSession(m[1].trim());
  if (!admin) return res.status(401).json({ error: "bad session" });
  req.admin = admin;
  next();
}

export function requireSuperadmin(req, res, next) {
  if (!req.admin || req.admin.role !== "superadmin") {
    return res.status(403).json({ error: "superadmin only" });
  }
  next();
}

/** Bootstrap the very first superadmin from env, once. */
export function bootstrapSuperadmin() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM admin_user").get().c;
  if (count > 0) return;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    console.warn("[warn] no admin users exist and SUPERADMIN_EMAIL/PASSWORD not set — /admin login will be unusable");
    return;
  }
  if (SUPERADMIN_PASSWORD.length < 8) {
    console.warn("[warn] SUPERADMIN_PASSWORD is shorter than 8 chars — refusing to bootstrap");
    return;
  }
  const id = safeId("adm");
  db.prepare(`
    INSERT INTO admin_user (id, email, password_hash, role, display_name)
    VALUES (?, ?, ?, 'superadmin', ?)
  `).run(id, SUPERADMIN_EMAIL, hashPassword(SUPERADMIN_PASSWORD), "Superadmin");
  console.log(`[admin] bootstrapped superadmin ${SUPERADMIN_EMAIL} (id ${id})`);
}
