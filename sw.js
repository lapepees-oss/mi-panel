// Service worker: deja la app abrir sin conexión (los datos vienen de Supabase).
// Cada vez que cambies un archivo de SHELL, sube el número de CACHE para que los navegadores descarguen la versión nueva.
const CACHE = "cloudspace-v54";
const SHELL = ["./", "index.html", "styles.css", "login.css", "pages.css", "mix.css", "minimal.css", "theme.js", "vendor/supabase-2.117.3.js", "logic.js", "userprefs.js", "widgets.js", "copilot.js", "schedule.js", "texts.js", "intel.js", "intelligence.js", "core.js", "ui.js", "data.js", "auth.js", "dashboard.js", "habits.js", "tasks.js", "objectives.js", "calendar.js", "quickadd.js", "usage.js", "admin.js", "journal.js", "finance.js", "timer.js", "notify.js", "prefs.js", "guest.js", "sidebar.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png", "icons/apple-touch-icon.png"];

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

// Red primero, caché como respaldo. Archivos de la propia app y tipografías de Google Fonts
// (las fuentes se guardan al verlas una vez para que la app se vea igual sin conexión).
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !FONT_HOSTS.includes(url.hostname)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ("focus" in w) { w.navigate && w.navigate(url).catch(() => {}); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
