// Jednadvacet service worker — push notifications + basic offline shell.
// Kept small on purpose: Evolu handles data persistence for logged-in users.

const CACHE = "jednadvacet-shell-v5";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-512.png", "/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Network-first for navigations (so updates land fast), cache fallback.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Skip API — always network, never cache stale events/articles.
  if (url.pathname.startsWith("/api/")) return;
  // Skip version manifest — it's the *signal* that a new build is live,
  // so it must never be served from any cache (including SW cache).
  // Without this guard Safari on desktop keeps serving an old buildId
  // from the SW cache and the "new version" banner never lights up.
  if (url.pathname === "/version.json") return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match("/index.html").then((r) => r ?? fetch(req))),
    );
    return;
  }

  // Static assets: cache-first.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((r) => {
        if (r.ok && r.type === "basic") {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return r;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Jednadvacet", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Jednadvacet";
  const tag = data.tag || "jednadvacet";

  // Chat notifications use the `chat-<slug>` tag convention. If the user
  // currently has the app foregrounded, they're already seeing the
  // message live via SSE — skip the OS-level notification to avoid a
  // distracting duplicate. Admin broadcasts and reminders don't use the
  // `chat-` prefix, so they always show through.
  const suppressWhenVisible = typeof tag === "string" && tag.startsWith("chat-");

  const options = {
    body: data.body || "",
    icon: "/icon-512.png",
    badge: "/favicon.png",
    data: { url: data.url || "/" },
    tag,
    renotify: true,
    requireInteraction: false,
  };

  event.waitUntil((async () => {
    if (suppressWhenVisible) {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasVisible = clients.some((c) => c.visibilityState === "visible" && c.focused);
      if (hasVisible) return;
    }
    return self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          c.focus();
          c.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
