// Service worker: deja la app abrir sin conexión (los datos vienen de Supabase)
const CACHE = "cloudspace-v5";
const SHELL = ["./", "index.html", "styles.css", "login.css", "logic.js", "core.js", "ui.js", "data.js", "auth.js", "dashboard.js", "habits.js", "tasks.js", "journal.js", "finance.js", "timer.js", "prefs.js", "sidebar.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero, caché como respaldo, solo para archivos de la propia app
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
