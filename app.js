"use strict";
// Arranque: sesión, rutas protegidas, tiempo real (por tabla) y navegación.
// El acceso (formulario, Google, recuperación) está en auth.js; las secciones, en sus propios archivos.

const PAGE_NAMES = {
  dashboard: "Resumen", habits: "Hábitos", tasks: "Tareas", journal: "Diario",
  finance: "Finanzas", timer: "Cronómetro", intelligence: "Intelligence", prefs: "Preferencias",
};
let currentPage = "dashboard";
let channel = null;
let authNotice = null; // mensaje que se muestra una vez en la pantalla de acceso
const pageTitle = () => `${PAGE_NAMES[currentPage]} · Cloudspace`;

/* ---------- Rutas ---------- */

// Solo hay rutas con el formato #/pagina. Los demás hashes (tokens de Supabase) se ignoran.
function routeFromHash() {
  const m = /^#\/([a-z]+)/.exec(location.hash);
  const allowed = (n) => PAGE_NAMES[n] && (n !== "intelligence" || intelActive()); // Intelligence caducada: no hay ruta
  if (m && allowed(m[1])) return m[1];
  const saved = store.get("page", "dashboard");
  return allowed(saved) ? saved : "dashboard";
}

function route() {
  if (!user) return; // ruta privada: sin sesión no se pinta nada
  const next = routeFromHash();
  if (next !== currentPage && typeof flushJournal === "function") flushJournal();
  currentPage = next;
  if (/^#\/intelligence/.test(location.hash) && next !== "intelligence") history.replaceState(null, "", "#/" + next); // sección caducada: no se queda la ruta
  for (const name of Object.keys(PAGE_NAMES)) show($(`#page-${name}`), name === currentPage);
  $$("[data-page]").forEach((a) => {
    if (a.dataset.page === currentPage) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#prefsLink").setAttribute("aria-current", currentPage === "prefs" ? "page" : "false");
  $("#crumb").textContent = PAGE_NAMES[currentPage];
  document.title = pageTitle();
  store.set("page", currentPage);
  window.scrollTo(0, 0);
  renderAll();
}
window.addEventListener("hashchange", route);

/* ---------- Sesión ---------- */

function denyAccess() {
  authNotice = { text: "Esta cuenta no tiene acceso a este espacio.", kind: "error" };
  return db.auth.signOut().catch(() => {});
}

async function onSession(session) {
  show($("#boot"), false);
  const newUser = session ? session.user : null;

  // Llegada desde el enlace de "recuperar contraseña": primero hay que elegir la nueva
  if (recoveryActive && newUser) {
    user = null;
    stopRealtime();
    stopTick();
    showAuthScreen("recovery");
    return;
  }
  if (newUser && user && newUser.id === user.id) return; // mismo usuario: nada que hacer

  if (newUser && !newUser.guest && cfg.ALLOWED_EMAIL && newUser.email.toLowerCase() !== String(cfg.ALLOWED_EMAIL).toLowerCase()) {
    // Aviso de comodidad; la barrera real es el RLS de single-user.sql en la base de datos
    await denyAccess();
    return;
  }

  user = newUser;
  if (!user) {
    stopRealtime();
    stopTick();
    wipeLocalData();
    const urlErr = authErrorFromUrl();
    const notice = authNotice || (urlErr ? { text: urlErr, kind: "error" } : null);
    authNotice = null;
    showAuthScreen("login", notice || "");
    return;
  }

  $("#userEmail").textContent = user.email || "";
  $("#prefsEmail").textContent = user.email ? `Sesión iniciada como ${user.email}.` : "";
  show($("#auth"), false);
  show($("#setup"), false);
  show($("#app"), true);
  route();
  await loadAll();
  startRealtime();
  startTick();
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (!configured) {
    show($("#boot"), false);
    show($("#setup"), true);
    return;
  }
  if (!window.supabase) {
    show($("#boot"), false);
    show($("#setup"), true);
    $("#setup").replaceChildren(
      h("h1", { text: "No se pudo cargar Supabase" }),
      h("p", { text: "Comprueba tu conexión a internet y recarga la página." })
    );
    return;
  }
  realDb = createDb();
  if (isGuest()) {
    db = trackWrites(createGuestDb());
    await onSession(guestSession());
    return;
  }
  db = trackWrites(realDb);
  // Nunca se espera a Supabase dentro de este callback (puede bloquear la librería): se aplaza un ciclo
  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") recoveryActive = true;
      if (event === "INITIAL_SESSION") return; // ya se trata abajo con getSession()
      onSession(session);
    }, 0);
  });
  const { data } = await db.auth.getSession();
  await onSession(data.session);
}

/* ---------- Seguimiento de escrituras ----------
 * Envuelve db.from() para anotar qué tablas se modifican (insert/update/upsert/delete). Así, tras una operación solo se
 * vuelven a leer esas tablas en vez de toda la base de datos, lo que ahorra mucho tráfico de Supabase. */
function trackWrites(client) {
  return new Proxy(client, {
    get(target, key) {
      if (key === "from") {
        return (name) => {
          const q = target.from(name);
          for (const m of ["insert", "update", "upsert", "delete"]) {
            const fn = q[m];
            q[m] = (...args) => { writtenTables.add(name); return fn.apply(q, args); };
          }
          return q;
        };
      }
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/* ---------- Tiempo real ---------- */

function startRealtime() {
  stopRealtime();
  channel = db
    .channel("cambios")
    // Cada aviso trae el nombre de la tabla: solo se relee esa (y sus dependientes), no toda la base de datos
    .on("postgres_changes", { event: "*", schema: "public" }, (payload) => scheduleReload(payload && payload.table ? [payload.table] : null))
    .subscribe((status) => setSync(status === "SUBSCRIBED"));
}

function stopRealtime() {
  if (channel && db) db.removeChannel(channel);
  channel = null;
}

// Al volver a la app, o al reconectar, se vuelve a leer por si se perdió algo
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && user) {
    checkNewDay();
    if (needsFullReload()) loadAll(); // si se acaba de cargar todo hace menos de un minuto, no se vuelve a descargar
  }
});
window.addEventListener("online", () => user && loadAll());

// Si la app se queda abierta pasada la medianoche, "hoy" cambia y todo se repinta
let knownToday = todayKey();
function checkNewDay() {
  const now = todayKey();
  if (now !== knownToday) {
    knownToday = now;
    if (user) renderAll();
  }
}
setInterval(checkNewDay, 30000);

/* ---------- Pintado común ---------- */

function renderChrome() {
  $("#todayDate").textContent = new Date().toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
renderers.push(renderChrome);

init();
