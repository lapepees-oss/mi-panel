"use strict";
// Modo invitado: para que cualquiera pruebe Cloudspace y deje feedback sin crear cuenta.
//  - Los datos del invitado viven SOLO en este navegador (localStorage); nunca se envían a Supabase.
//  - No hay ninguna cuenta, contraseña ni acceso a tu base de datos: es una base local que imita las consultas.
//  - El feedback sí se envía a tu Supabase (tabla "feedback", solo inserción desde fuera; ver feedback.sql).

const GUEST_FLAG = "mipanel.guest";
const GUEST_DB_KEY = "mipanel.guest.db";
const GUEST_ID = "00000000-0000-4000-8000-000000000000";
const guestEnabled = () => cfg.GUEST_MODE !== false;
const isGuest = () => {
  try { return localStorage.getItem(GUEST_FLAG) === "1" && guestEnabled(); } catch (_) { return false; }
};
const guestSession = () => ({ user: { id: GUEST_ID, email: "Invitado", guest: true } });

const GUEST_DEFAULTS = {
  tasks: { prio: 4, status: "todo", done: false, tags: [], notes: "", recurrence: null, list_id: null, due_date: null, completed_at: null },
  habits: { emoji: "🌱", hint: "", category: "Personal", frequency: "Diario", color: "#8064ff" },
  savings_goals: { current: 0 },
  subscriptions: { cycle: "monthly", category: "Suscripciones", status: "active", next_charge: null, started_on: null, ended_on: null, notes: "" },
  timer: { running: false, started_at: null, accumulated_ms: 0, mode: "stopwatch", routine_id: null, label: "", target_ms: 0 },
  timer_sessions: { label: "", kind: null },
  routines: { cycles: 1 },
  objectives: { why: "", due_date: null, status: "active", milestones: [], task_ids: [], habit_ids: [] },
  intelligence_items: { status: "pending", category: "otros", problem: "", action: "", priority: 4, suggested_date: null, related_goal: "" },
};
const GUEST_CASCADE = {
  task_lists: [["tasks", "list_id", "null"]],
  tasks: [["task_steps", "task_id", "delete"]],
  habits: [["habit_logs", "habit_id", "delete"]],
  routines: [["routine_steps", "routine_id", "delete"], ["timer", "routine_id", "null"]],
};
const guestUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "g" + Math.random().toString(16).slice(2) + Date.now().toString(16));

function guestSeed() {
  const today = todayKey();
  const d = (n) => Logic.addDays(today, n);
  const now = new Date().toISOString();
  const row = (extra) => ({ id: guestUuid(), user_id: GUEST_ID, created_at: now, ...extra });
  const list = row({ name: "Universidad" });
  // Los hábitos de ejemplo tienen registros de las últimas semanas: se crean "hace 30 días" para que su historia sea coherente
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  const habits = [
    row({ name: "Leer 20 minutos", emoji: "📖", hint: "Antes de dormir", category: "Aprendizaje", color: "#4f80ff", created_at: old }),
    row({ name: "Entrenar", emoji: "🏃", hint: "", category: "Salud", color: "#35c99a", created_at: old }),
    row({ name: "Meditar 5 minutos", emoji: "🧘", hint: "", category: "Bienestar", frequency: "Entre semana", color: "#21b7ce", created_at: old }),
  ];
  const logs = [];
  habits.forEach((hb, i) => {
    for (let n = 0; n < 24; n++) if ((n * (i + 2) + i) % 4 !== 0) logs.push(row({ habit_id: hb.id, day: d(-n) }));
  });
  const task = (title, extra) => row({ ...GUEST_DEFAULTS.tasks, title, ...extra });
  const tasks = [
    task("Entregar la práctica de bases de datos", { due_date: today, prio: 1, list_id: list.id, tags: ["clase"] }),
    task("Comprar el billete de tren", { due_date: d(-1), prio: 2 }),
    task("Preparar el examen del viernes", { due_date: d(3), prio: 2, list_id: list.id }),
    task("Llamar al dentista", { due_date: today, prio: 3 }),
    task("Ordenar el escritorio"),
    task("Revisar el borrador del informe", { status: "review", prio: 3 }),
    task("Practicar SQL con ejercicios", { status: "doing", prio: 3 }),
    task("Enviar el currículum", { status: "done", done: true, completed_at: now, due_date: d(-2) }),
  ];
  const tx = (type, amount, title, category, n) => row({ type, amount, title, category, tx_date: d(n) });
  return {
    task_lists: [list], tasks, task_steps: [], habits, habit_logs: logs,
    journal_entries: [row({ kind: "entry", entry_date: today, body: "Hoy he probado Cloudspace en modo invitado. Estas notas se quedan en este navegador." })],
    transactions: [
      tx("income", 450, "Otros", "Otros", -6), tx("expense", 120.5, "Compra semanal", "Comida", -4), tx("expense", 35.9, "Cine y cena", "Ocio", -3),
      tx("expense", 24, "Bono de transporte", "Transporte", -2), tx("expense", 62.3, "Libros de clase", "Estudios", -1),
    ],
    budgets: [row({ category: "", amount: 400 }), row({ category: "Ocio", amount: 50 })],
    savings_goals: [row({ name: "Portátil nuevo", target: 900, current: 320 })],
    ideas: [],
    subscriptions: [
      row({ ...GUEST_DEFAULTS.subscriptions, name: "Música en streaming", amount: 10.99, next_charge: d(5), started_on: d(-60) }),
      row({ ...GUEST_DEFAULTS.subscriptions, name: "Almacenamiento en la nube", amount: 24, cycle: "yearly", next_charge: d(120), started_on: d(-200) }),
    ],
    objectives: [row({ ...GUEST_DEFAULTS.objectives, title: "Aprobar el primer curso", why: "Llegar a junio con todo al día", due_date: d(120),
      milestones: [{ id: "m1", title: "Entregar las prácticas del primer trimestre", done: true, date: d(-10), task_ids: [tasks[0].id] }, { id: "m2", title: "Aprobar los exámenes de diciembre", done: false, date: d(45), task_ids: [tasks[2].id] }, { id: "m3", title: "Proyecto final entregado", done: false, date: d(100) }],
      task_ids: [tasks[0].id, tasks[2].id], habit_ids: [habits[0].id] })],
    timer: [], timer_sessions: [], routines: [], routine_steps: [],
  };
}

function guestLoad() {
  try {
    const raw = localStorage.getItem(GUEST_DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return guestSeed();
}

function createGuestDb() {
  let DB = guestLoad();
  const save = () => { try { localStorage.setItem(GUEST_DB_KEY, JSON.stringify(DB)); } catch (_) {} };
  save();
  const table = (t) => (DB[t] = DB[t] || []);

  function builder(t) {
    let op = "select", payload, filters = [], ord = null, rng = null, lim = null, one = null, conflict = null, ignoreDup = false;
    const b = {
      select() { return b; },
      insert(p) { op = "insert"; payload = p; return b; },
      update(p) { op = "update"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      upsert(p, o) { op = "upsert"; payload = p; conflict = o && o.onConflict; ignoreDup = !!(o && o.ignoreDuplicates); return b; },
      eq(k, v) { filters.push((r) => r[k] === v); return b; },
      neq(k, v) { filters.push((r) => r[k] !== v); return b; },
      gte(k, v) { filters.push((r) => r[k] >= v); return b; },
      lte(k, v) { filters.push((r) => r[k] <= v); return b; },
      gt(k, v) { filters.push((r) => r[k] > v); return b; },
      lt(k, v) { filters.push((r) => r[k] < v); return b; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return b; },
      match(o) { for (const k in o) filters.push((r) => r[k] === o[k]); return b; },
      order(k, o) { ord = [k, !(o && o.ascending === false)]; return b; },
      range(a, z) { rng = [a, z]; return b; },
      limit(n) { lim = n; return b; },
      single() { one = "single"; return b; },
      maybeSingle() { one = "maybe"; return b; },
      then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
    };
    function exec() {
      const rows = table(t);
      const mk = (p) => ({ id: guestUuid(), user_id: GUEST_ID, created_at: new Date().toISOString(), ...(GUEST_DEFAULTS[t] || {}), ...p });
      let out;
      if (op === "insert") {
        out = (Array.isArray(payload) ? payload : [payload]).map(mk);
        rows.push(...out);
      } else if (op === "upsert") {
        out = [];
        const keys = (conflict || "id").split(",").map((k) => k.trim());
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const ex = rows.find((r) => keys.every((k) => r[k] === (p[k] === undefined && k === "user_id" ? GUEST_ID : p[k])));
          if (ex) { if (!ignoreDup) Object.assign(ex, p); out.push(ex); }
          else { const nr = mk(p); rows.push(nr); out.push(nr); }
        }
      } else {
        let m = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") { m.forEach((r) => Object.assign(r, payload)); out = m; }
        else if (op === "delete") {
          const gone = new Set(m);
          DB[t] = rows.filter((r) => !gone.has(r));
          for (const [ct, col, how] of GUEST_CASCADE[t] || []) {
            const ids = new Set(m.map((r) => r.id));
            if (how === "delete") DB[ct] = table(ct).filter((r) => !ids.has(r[col]));
            else table(ct).forEach((r) => ids.has(r[col]) && (r[col] = null));
          }
          out = m;
        } else {
          if (ord) m = [...m].sort((a, c) => (a[ord[0]] > c[ord[0]] ? 1 : a[ord[0]] < c[ord[0]] ? -1 : 0) * (ord[1] ? 1 : -1));
          if (rng) m = m.slice(rng[0], rng[1] + 1);
          if (lim != null) m = m.slice(0, lim);
          out = m;
        }
      }
      if (op !== "select") save();
      out = JSON.parse(JSON.stringify(out));
      if (one === "single") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "Se esperaba una fila" } };
      if (one === "maybe") return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    return b;
  }

  return {
    guest: true,
    from: builder,
    channel() { const c = { on() { return c; }, subscribe(cb) { if (cb) setTimeout(() => cb("SUBSCRIBED"), 0); return c; } }; return c; },
    removeChannel() {},
    auth: {
      getSession: async () => ({ data: { session: guestSession() } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
    },
  };
}

function enterGuest() {
  try { localStorage.setItem(GUEST_FLAG, "1"); } catch (_) {}
  location.reload();
}

function exitGuest({ wipe = true } = {}) {
  try {
    localStorage.removeItem(GUEST_FLAG);
    if (wipe) {
      localStorage.removeItem(GUEST_DB_KEY);
      for (const k of Object.keys(localStorage)) if (k.startsWith("mipanel.draft.")) localStorage.removeItem(k);
    }
  } catch (_) {}
}

/* ---------- Barra de invitado ---------- */

function renderGuestBar() {
  show($("#guestBar"), isGuest() && !!user);
}

/* ---------- Feedback ---------- */

const FEEDBACK_COOLDOWN_MS = 30000;

function openFeedback() {
  const last = Number(sessionStorage.getItem("mipanel.feedbackAt") || 0);
  if (Date.now() - last < FEEDBACK_COOLDOWN_MS) return toast("Acabas de enviar un comentario. Espera un momento antes de enviar otro.");
  openWizard({
    steps: [
      { key: "rating", label: "¿Qué te ha parecido Cloudspace?", type: "choice", required: true, requiredMessage: "Elige una valoración.", summaryLabel: "Valoración",
        options: [{ value: 1, label: "😞 Mal" }, { value: 2, label: "😕 Regular" }, { value: 3, label: "🙂 Bien" }, { value: 4, label: "😀 Muy bien" }, { value: 5, label: "🤩 Genial" }] },
      { key: "message", label: "¿Qué mejorarías o qué te ha gustado?", type: "textarea", required: true, requiredMessage: "Escribe un comentario.", maxLength: 1000, placeholder: "Cuéntanos lo que quieras…", summaryLabel: "Comentario" },
      { key: "contact", label: "¿Quieres que te responda?", type: "text", hint: "Opcional. Deja un correo o un nombre.", maxLength: 120, summaryLabel: "Contacto" },
    ],
    initial: { rating: "", message: "", contact: "" }, submitLabel: "Enviar feedback", doneMessage: "¡Gracias por tu feedback!",
    onSubmit: async (v) => {
      if (!realDb) return "No se pudo conectar.";
      const { error } = await realDb.from("feedback").insert({
        rating: Number(v.rating), message: String(v.message).trim().slice(0, 1000), contact: String(v.contact || "").trim().slice(0, 120) || null,
        page: typeof currentPage === "string" ? currentPage : null, guest: isGuest(), user_agent: navigator.userAgent.slice(0, 200),
      });
      if (error) { console.error(error); return "No se pudo enviar ahora mismo. Inténtalo más tarde."; }
      try { sessionStorage.setItem("mipanel.feedbackAt", String(Date.now())); } catch (_) {}
      return true;
    },
  });
}

async function leaveGuest() {
  if (!(await askConfirm({ title: "¿Salir del modo invitado?", text: "Se borrarán los datos de prueba guardados en este navegador.", confirmLabel: "Salir y borrar" }))) return;
  exitGuest();
  location.reload();
}

renderers.push(renderGuestBar);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-guest-action]");
  if (!b) return;
  const a = b.dataset.guestAction;
  if (a === "feedback") openFeedback();
  else if (a === "leave") leaveGuest();
  else if (a === "enter") enterGuest();
});
