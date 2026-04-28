// Smoke test for all public + admin endpoints. Runs against a running
// backend (defaults to the staging instance on :3022). Uses Node's
// built-in test runner — no dependencies.
//
//   BASE=http://127.0.0.1:3022 ADMIN_EMAIL=… ADMIN_PASSWORD=… node --test test/
//
// Designed to be idempotent: creates its own admin users, cleans up push
// subs + channel messages + telemetry rows it inserts. Never touches
// production data when pointed at staging.

import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import crypto from "node:crypto";

const BASE = process.env.BASE || "http://127.0.0.1:3022";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin+staging@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "staging-pw-changeme";

const rand = (n = 16) => crypto.randomBytes(n).toString("base64url");

async function api(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  return { status: r.status, ok: r.ok, body: json, text };
}

// ── Health + public content ──────────────────────────────────

test("GET /api/health → ok + adminUsers count", async () => {
  const r = await api("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(typeof r.body.adminUsers === "number");
});

test("GET /api/articles → array", async () => {
  const r = await api("GET", "/api/articles");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test("GET /api/events → array", async () => {
  const r = await api("GET", "/api/events");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test("GET /api/push/vapid → key", async () => {
  const r = await api("GET", "/api/push/vapid");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.key === "string" && r.body.key.length > 0);
});

// ── Push register/unregister ────────────────────────────────

let pushToken = null;
const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/${rand(20)}`;

test("POST /api/push/register → issues token", async () => {
  const r = await api("POST", "/api/push/register", {
    body: {
      endpoint: fakeEndpoint,
      keys: { p256dh: rand(64), auth: rand(16) },
      tags: ["city:praha", "cat:meetup"],
    },
  });
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.token === "string" && r.body.token.length >= 16);
  pushToken = r.body.token;
});

test("POST /api/push/register → idempotent on same endpoint", async () => {
  const r = await api("POST", "/api/push/register", {
    body: {
      endpoint: fakeEndpoint,
      keys: { p256dh: rand(64), auth: rand(16) },
      tags: ["city:brno"],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, pushToken, "same endpoint reuses token");
});

test("POST /api/push/unregister → ok", async () => {
  const r = await api("POST", "/api/push/unregister", { body: { token: pushToken } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  pushToken = null;
});

// ── RSVP ─────────────────────────────────────────────────────

test("POST /api/rsvp → 404 on unknown event", async () => {
  const r = await api("POST", "/api/rsvp", {
    body: { token: rand(32), eventId: "definitely-not-a-real-event-id", status: "going" },
  });
  assert.equal(r.status, 404);
});

// ── Telemetry ────────────────────────────────────────────────

test("POST /api/telemetry/ping → 200 ok", async () => {
  const r = await api("POST", "/api/telemetry/ping", {
    body: { anonId: rand(32), kind: "app_open", standalone: false },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("POST /api/telemetry/ping → swallows invalid kind silently", async () => {
  const r = await api("POST", "/api/telemetry/ping", {
    body: { anonId: rand(32), kind: "nonsense", standalone: false },
  });
  assert.equal(r.status, 200, "server responds 200 even on invalid kind");
});

// ── Channels (public) ────────────────────────────────────────

const chatToken = rand(32);
const testOwnerA = `test-${rand(8)}`;
const testOwnerB = `test-${rand(8)}`;
let testMessageId = null;

test("POST /api/chat/profile → claim nickname", async () => {
  const r = await api("POST", "/api/chat/profile", {
    body: { ownerId: testOwnerA, displayName: `TestBot-${rand(4)}` },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerId, testOwnerA);
});

test("POST /api/chat/profile → 409 on name collision (case/diacritic insensitive)", async () => {
  const name = `Collide-${rand(4)}`;
  // A claims it
  await api("POST", "/api/chat/profile", { body: { ownerId: testOwnerA, displayName: name } });
  // B tries the same name normalised — should 409
  const r = await api("POST", "/api/chat/profile", {
    body: { ownerId: testOwnerB, displayName: name.toLowerCase() },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "name taken");
});

test("GET /api/chat/profile/:ownerId → returns profile", async () => {
  const r = await api("GET", `/api/chat/profile/${testOwnerA}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerId, testOwnerA);
});

test("POST /api/channels/global/messages → 412 without profile", async () => {
  const r = await api("POST", "/api/channels/global/messages", {
    body: { token: chatToken, ownerId: `no-profile-${rand(4)}`, body: "hi" },
  });
  assert.equal(r.status, 412);
});

test("POST /api/channels/global/messages → creates message", async () => {
  const r = await api("POST", "/api/channels/global/messages", {
    body: { token: chatToken, ownerId: testOwnerA, body: "automated test message" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.id);
  assert.equal(r.body.channelSlug, "global");
  assert.equal(r.body.authorOwnerId, testOwnerA);
  testMessageId = r.body.id;
});

test("GET /api/channels/global/messages → includes test message with resolved name", async () => {
  const r = await api("GET", "/api/channels/global/messages?limit=10");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  const found = r.body.find((m) => m.id === testMessageId);
  assert.ok(found, "test message present");
  assert.ok(found.authorName.length > 0, "name is joined from chat_user");
});

test("Renaming profile updates historical messages' authorName", async () => {
  const newName = `Renamed-${rand(4)}`;
  const up = await api("POST", "/api/chat/profile", {
    body: { ownerId: testOwnerA, displayName: newName },
  });
  assert.equal(up.status, 200);
  const r = await api("GET", "/api/channels/global/messages?limit=10");
  const found = r.body.find((m) => m.id === testMessageId);
  assert.equal(found.authorName, newName, "old message shows new name via JOIN");
});

test("POST /api/channels/unknownslug/messages → 404", async () => {
  const r = await api("POST", "/api/channels/unknownslug/messages", {
    body: { token: chatToken, ownerId: testOwnerA, body: "y" },
  });
  assert.equal(r.status, 404);
});

test("POST /api/channels/global/messages → 400 on missing body", async () => {
  const r = await api("POST", "/api/channels/global/messages", {
    body: { token: chatToken, ownerId: testOwnerA },
  });
  assert.equal(r.status, 400);
});

test("DELETE /api/channels/global/messages/:id → 404 with wrong token", async () => {
  const r = await api("DELETE", `/api/channels/global/messages/${testMessageId}`, {
    body: { token: rand(32) },
  });
  assert.equal(r.status, 404);
});

test("DELETE /api/channels/global/messages/:id → cleans up with right token", async () => {
  const r = await api("DELETE", `/api/channels/global/messages/${testMessageId}`, {
    body: { token: chatToken },
  });
  assert.equal(r.status, 200);
  testMessageId = null;
});

// ── Admin auth ───────────────────────────────────────────────

let adminToken = null;

test("POST /api/admin/login → bad credentials → 401", async () => {
  const r = await api("POST", "/api/admin/login", {
    body: { email: ADMIN_EMAIL, password: "wrong" },
  });
  assert.equal(r.status, 401);
});

test("POST /api/admin/login → issues session for bootstrapped superadmin", async () => {
  const r = await api("POST", "/api/admin/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200, `login should succeed with ${ADMIN_EMAIL}`);
  assert.ok(typeof r.body.token === "string");
  assert.equal(r.body.admin.role, "superadmin");
  adminToken = r.body.token;
});

test("GET /api/admin/me → echoes the logged-in admin", async () => {
  const r = await api("GET", "/api/admin/me", { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.admin.email, ADMIN_EMAIL);
});

test("GET /api/admin/me → 401 without token", async () => {
  const r = await api("GET", "/api/admin/me");
  assert.equal(r.status, 401);
});

// ── Admin endpoints ──────────────────────────────────────────

test("GET /api/admin/stats → counters", async () => {
  const r = await api("GET", "/api/admin/stats", { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.subscribers === "number");
  assert.ok(typeof r.body.events === "number");
});

test("GET /api/admin/rsvps → object", async () => {
  const r = await api("GET", "/api/admin/rsvps", { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body, "object");
});

test("GET /api/admin/dashboard → rollup payload", async () => {
  const r = await api("GET", "/api/admin/dashboard", { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.body.devices);
  assert.ok(r.body.activity);
  assert.ok(r.body.content);
});

test("GET /api/admin/users → array (superadmin)", async () => {
  const r = await api("GET", "/api/admin/users", { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── Admin: events CRUD ──────────────────────────────────────

let testEventId = null;

test("POST /api/admin/events → creates event", async () => {
  const starts = new Date(Date.now() + 24 * 3600e3).toISOString();
  const ends = new Date(Date.now() + 26 * 3600e3).toISOString();
  const r = await api("POST", "/api/admin/events", {
    token: adminToken,
    body: {
      title: "API Test Event",
      description: "auto-generated by test suite",
      location: "Praha",
      startsAt: starts,
      endsAt: ends,
      cities: ["praha"],
      categories: ["meetup"],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, "API Test Event");
  testEventId = r.body.id;
});

test("POST /api/rsvp → works on just-created event", async () => {
  const r = await api("POST", "/api/rsvp", {
    body: { token: rand(32), eventId: testEventId, status: "going" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("DELETE /api/admin/events/:id → removes event (cascades RSVPs)", async () => {
  const r = await api("DELETE", `/api/admin/events/${testEventId}`, { token: adminToken });
  assert.equal(r.status, 200);
  testEventId = null;
});

// ── Admin: invite flow ───────────────────────────────────────

let invitedCode = null;

test("POST /api/admin/invites → creates invite (superadmin)", async () => {
  const r = await api("POST", "/api/admin/invites", {
    token: adminToken,
    body: { role: "admin", city: "brno", displayName: "TestInvitee" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.code);
  invitedCode = r.body.code;
});

test("GET /api/admin/invites/:code/info → public info", async () => {
  const r = await api("GET", `/api/admin/invites/${invitedCode}/info`);
  assert.equal(r.status, 200);
  assert.equal(r.body.role, "admin");
  assert.equal(r.body.city, "brno");
});

test("POST /api/admin/invites/:code/redeem create → new admin account", async () => {
  const username = `testadmin_${rand(4).toLowerCase()}`;
  const r = await api("POST", `/api/admin/invites/${invitedCode}/redeem`, {
    body: { mode: "create", username, password: "redeem-pw-123" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.admin.username, username);
  // Cleanup: remove the test admin we just made.
  await api("DELETE", `/api/admin/users/${r.body.admin.id}`, { token: adminToken });
});

test("POST /api/admin/invites/:code/redeem → 410 after use", async () => {
  // Already consumed by previous test.
  const r = await api("POST", `/api/admin/invites/${invitedCode}/redeem`, {
    body: { mode: "create", username: "foo", password: "barbarbar" },
  });
  assert.equal(r.status, 410);
});

// ── Admin: reminder trigger (smoke only) ────────────────────

test("POST /api/admin/reminders/fire → returns envelope", async () => {
  const r = await api("POST", "/api/admin/reminders/fire", { token: adminToken });
  assert.equal(r.status, 200);
  // May be {ok:false, error:"VAPID not configured"} in a degraded setup —
  // just smoke-test the endpoint exists + handles a POST.
  assert.ok("ok" in r.body);
});

// ── Admin: logout ────────────────────────────────────────────

test("POST /api/admin/logout → invalidates session", async () => {
  const r = await api("POST", "/api/admin/logout", { token: adminToken });
  assert.equal(r.status, 200);
  // Session should be dead now — next /me should 401.
  const me = await api("GET", "/api/admin/me", { token: adminToken });
  assert.equal(me.status, 401);
});

// ── Cleanup ──────────────────────────────────────────────────

after(async () => {
  // If anything was left dangling, best-effort cleanup.
  if (pushToken) await api("POST", "/api/push/unregister", { body: { token: pushToken } });
  // Note: chat_user + channel_message test rows are left in the staging
  // DB. They're namespaced with "test-" / "TestBot-" / "Renamed-" / etc.
  // so a periodic `./scripts/wipe-staging-db.sh` is the canonical cleanup.
});
