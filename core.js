"use strict";
// Núcleo compartido: estado único, utilidades de DOM, avisos y errores.
// mutate(local, remote) es la única vía para cambiar datos: aplica el cambio en pantalla al instante (optimista),
// lo escribe en Supabase y relee solo las tablas tocadas.
// La lógica pura (fechas, dinero, rachas…) vive en logic.js; aquí solo hay lo que toca el navegador.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const show = (el, on) => el.classList.toggle("hidden", !on);

const cfg = window.APP_CONFIG || {};
const configured = !!cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith("PEGA_");
// El registro se puede cerrar en config.js; Google solo se muestra si lo activas (requiere configurar OAuth)
const flags = { allowSignup: cfg.ALLOW_SIGNUP !== false, google: cfg.GOOGLE_LOGIN === true };

let db = null;
let realDb = null; // cliente real de Supabase (en modo invitado `db` es una base local; el feedback usa este)
let user = null;

// Única copia local de los datos de Supabase: todas las vistas leen de aquí
const state = {
  tasks: [], lists: [], steps: [],
  habits: [], logs: [],
  journal: [], ideas: [], ideasReady: true, subs: [], subsReady: true,
  intel: { enabled: true, expires_at: null, mode: "hybrid", stored: false, ready: true }, intelItems: [], transactions: [], budgets: [], goals: [],
  timer: null, sessions: [], routines: [], routineSteps: [],
};

// Cada archivo registra aquí su función de pintado
const renderers = [];
function renderAll() {
  for (const fn of renderers) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

// Preferencias de interfaz guardadas en este navegador (nunca contraseñas ni tokens)
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("mipanel." + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("mipanel." + key, JSON.stringify(value));
    } catch (_) {}
  },
  remove(key) {
    try {
      localStorage.removeItem("mipanel." + key);
    } catch (_) {}
  },
};

/* ---------- Fechas (ver logic.js) ---------- */

const dayKey = Logic.dayKey;
const todayKey = () => Logic.todayKey();
const parseDay = Logic.parseDay;
const addDays = Logic.addDays;

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/* ---------- DOM ---------- */

// Crea un elemento de forma segura (el texto siempre va como texto, nunca como HTML)
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || k === "value") continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "style" && typeof v === "string") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  // El valor va el último para que los <select> ya tengan sus opciones
  if ("value" in props && props.value != null) e.value = props.value;
  return e;
}

function openDialog(dlg) {
  if (dlg.open) return;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

function closeDialog(dlg) {
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
}

// Descarga un archivo generado en el navegador (CSV, JSON)
function downloadFile(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Avisos y red ---------- */

let toastTimer = null;
function toast(msg, ms = 4000) {
  const el = $("#toast");
  el.textContent = msg;
  show(el, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(el, false), ms);
}

function setSync(ok) {
  const el = $("#sync");
  if (!el) return;
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
  el.title = ok ? (typeof isGuest === "function" && isGuest() ? "Modo invitado: datos solo en este navegador" : "Sincronizado con Supabase") : "Sin conexión o error al sincronizar";
}

function showBanner(msg) {
  const el = $("#banner");
  el.textContent = msg || "";
  show(el, !!msg);
}

let lastErrorAt = 0;
async function run(promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(error);
    setSync(false);
    // Un solo aviso por ráfaga de errores
    if (Date.now() - lastErrorAt > 2500) toast(Logic.dataErrorText(error), 6000);
    lastErrorAt = Date.now();
    throw error;
  }
  setSync(true);
  return data;
}

// Cambio optimista: se pinta ya, se guarda, y se vuelve a leer la verdad del servidor
// Tablas escritas desde la última lectura; las rellena trackWrites() en app.js
const writtenTables = new Set();
async function mutate(local, remote) {
  if (local) local();
  renderAll();
  let ok = true;
  try {
    await remote();
  } catch (_) {
    ok = false; // run() ya avisó al usuario
  }
  // Solo se relee lo que esta operación escribió (ver trackWrites en app.js); si no se sabe, se relee todo
  const tables = [...writtenTables];
  writtenTables.clear();
  await loadAll(tables);
  return ok;
}

/* ---------- Pequeñas ayudas de texto ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
