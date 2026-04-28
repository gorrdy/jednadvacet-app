// Jednadvacet backend — Node + Express + SQLite + Web Push.
//
// Privacy posture:
//   • Public-user data: push subscriptions and RSVPs are stored under *opaque
//     random tokens*. The server never learns who owns them.
//   • Tags are broad (city:praha, cat:meetup) so cohorts are large enough
//     to resist deanonymisation from traffic analysis.
//   • Admins are the only identified entities — scrypt-hashed credentials.
//     Admin tables are strictly isolated from public-user tables.
//
// Module layout:
//   src/config.js       env + constants
//   src/db.js           singleton Database + schema + migrations + seed
//   src/helpers.js      tiny utilities, row mappers
//   src/auth.js         password hashing, sessions, requireAdmin middleware
//   src/sync.js         ICS/RSS runners + scheduler
//   src/routes/public.js       articles, events, push, telemetry, rsvp
//   src/routes/admin.js        login/me, events CRUD, broadcast, stats
//   src/routes/superadmin.js   users, invites, dashboard

import fs from "node:fs";
import path from "node:path";
import express from "express";
import webpush from "web-push";

import { PORT, HOST, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, FRONTEND_DIST } from "./src/config.js";
import { db } from "./src/db.js";
import { bootstrapSuperadmin } from "./src/auth.js";
import { startSchedulers } from "./src/sync.js";
import { startReminderScheduler } from "./src/reminders.js";
import { startCommunityRefresh } from "./src/communities.js";
import { mountPublicRoutes } from "./src/routes/public.js";
import { mountAdminRoutes } from "./src/routes/admin.js";
import { mountSuperadminRoutes } from "./src/routes/superadmin.js";
import { mountLnurlRoutes, startLnurlPoller } from "./src/routes/lnurl.js";
import { mountMarketplaceRoutes } from "./src/routes/marketplace.js";
import { mountTierPublicRoutes } from "./src/routes/tier-public.js";
import { mountTelemetryRoutes } from "./src/routes/telemetry.js";
import { mountDmRoutes } from "./src/routes/dm.js";
import { mountEventRoutes } from "./src/routes/events.js";
import { mountChatRoutes } from "./src/routes/chat.js";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn("[warn] VAPID keys missing; push broadcasts disabled. Run: npm run keys");
}

bootstrapSuperadmin();

const app = express();
app.disable("x-powered-by");
// 300kb ceiling: normal API calls are <1kb; the outlier is profile
// save with a base64-encoded avatar (client resizes to <=200kb).
app.use(express.json({ limit: "300kb" }));

// Lightweight CORS — only needed if frontend is served from a different origin.
// In production nginx co-serves static + /api on same origin → no CORS needed.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.get("origin") || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admin_user").get().c;
  res.json({
    ok: true,
    vapid: Boolean(VAPID_PUBLIC && VAPID_PRIVATE),
    adminUsers: adminCount,
  });
});

mountPublicRoutes(app);
mountTierPublicRoutes(app);
mountTelemetryRoutes(app);
mountDmRoutes(app);
mountEventRoutes(app);
mountChatRoutes(app);
mountAdminRoutes(app);
mountSuperadminRoutes(app);
mountLnurlRoutes(app);
mountMarketplaceRoutes(app);

// ── Static frontend (optional, for single-port deploy) ─────────────
if (FRONTEND_DIST && fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
      if (filePath.endsWith("sw.js")) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Service-Worker-Allowed", "/");
      }
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    },
  }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  console.log(`[jednadvacet] serving frontend from ${FRONTEND_DIST}`);
}

startSchedulers();
startReminderScheduler();
startCommunityRefresh();
startLnurlPoller();

app.listen(PORT, HOST, () => {
  console.log(`[jednadvacet] listening on http://${HOST}:${PORT}`);
});
