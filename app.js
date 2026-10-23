"use strict";

const $ = (s) => document.querySelector(s);
const show = (el, on) => el.classList.toggle("hidden", !on);

const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith("PEGA_");

let db = null;
let user = null;
let tasks = [], habits = [], logs = [], timer = null, sessions = [];
let channel = null;
let tickHandle = null;

/* ---------- Utilidades ---------- */

// Fecha local en formato YYYY-MM-DD (evita desfases por zona horaria)
const dayKey = (d) => d.toLocaleDateString("sv-SE");

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function setSync(ok) {
  const el = $("#sync");
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(error);
    setSync(false);
    throw error;
  }
  setSync(true);
  return data;
}

/* ---------- Arranque ---------- */

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (!configured) {
    show($("#setup"), true);
    return;
  }
  db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const { data } = await db.auth.getSession();
  await onSession(data.session);
  db.auth.onAuthStateChange((_event, session) => onSession(session));
}

async function onSession(session) {
  const newUser = session ? session.user : null;
  if (newUser && user && newUser.id === user.id) return; // mismo usuario, nada que hacer
  user = newUser;
  if (!user) {
    stopRealtime();
    show($("#app"), false);
    show($("#auth"), true);
    return;
  }
  show($("#auth"), false);
  show($("#app"), true);
  await loadAll();
  startRealtime();
  startTick();
}

/* ---------- Acceso ---------- */

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = e.submitter ? e.submitter.dataset.mode : "login";
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const msg = $("#auth-msg");
  msg.textContent = "…";
  const { error, data } =
    mode === "signup"
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });
  if (error) {
    msg.textContent = error.message;
  } else if (mode === "signup" && !data.session) {
    msg.textContent = "Cuenta creada. Revisa tu correo para confirmarla y luego entra.";
  } else {
    msg.textContent = "";
  }
});

$("#logout").addEventListener("click", () => db.auth.signOut());

/* ---------- Datos y tiempo real ---------- */

async function loadAll() {
  try {
    const since = dayKey(lastDays(60)[0]);
    [tasks, habits, logs, sessions] = await Promise.all([
      run(db.from("tasks").select("*").order("created_at", { ascending: false })),
      run(db.from("habits").select("*").order("created_at")),
      run(db.from("habit_logs").select("*").gte("day", since)),
      run(db.from("timer_sessions").select("*").order("created_at", { ascending: false }).limit(10)),
    ]);
    timer = await loadTimer();
  } catch (_) {
    return;
  }
  renderAll();
}

async function loadTimer() {
  let row = await run(db.from("timer").select("*").eq("user_id", user.id).maybeSingle());
  if (!row) {
    row = await run(db.from("timer").insert({ user_id: user.id }).select().single());
  }
  return row;
}

let reloadTimeout = null;
function scheduleReload() {
  clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(loadAll, 150);
}

function startRealtime() {
  stopRealtime();
  channel = db
    .channel("cambios")
    .on("postgres_changes", { event: "*", schema: "public" }, scheduleReload)
    .subscribe((status) => setSync(status === "SUBSCRIBED"));
}

function stopRealtime() {
  if (channel) db.removeChannel(channel);
  channel = null;
  clearInterval(tickHandle);
}

// Al volver a la app (por ejemplo desde otra pestaña) refresca por si se perdió algo
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && user) loadAll();
});
window.addEventListener("online", () => user && loadAll());

/* ---------- Pestañas ---------- */

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach((t) => show(t, t.id === `tab-${btn.dataset.tab}`));
  });
});

/* ---------- Tareas ---------- */

$("#task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) return;
  $("#task-title").value = "";
  await run(db.from("tasks").insert({ title })).catch(() => {});
  loadAll();
});

function renderTasks() {
  const ul = $("#task-list");
  ul.replaceChildren();
  show($("#task-empty"), tasks.length === 0);
  // Pendientes primero
  const sorted = [...tasks].sort((a, b) => Number(a.done) - Number(b.done));
  for (const t of sorted) {
    const li = document.createElement("li");
    if (t.done) li.classList.add("done");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.addEventListener("change", async () => {
      await run(db.from("tasks").update({ done: cb.checked }).eq("id", t.id)).catch(() => {});
      loadAll();
    });

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = t.title;

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.title = "Borrar";
    del.addEventListener("click", async () => {
      await run(db.from("tasks").delete().eq("id", t.id)).catch(() => {});
      loadAll();
    });

    li.append(cb, title, del);
    ul.append(li);
  }
}

/* ---------- Hábitos ---------- */

$("#habit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#habit-name").value.trim();
  if (!name) return;
  $("#habit-name").value = "";
  await run(db.from("habits").insert({ name })).catch(() => {});
  loadAll();
});

function streakFor(habitId) {
  const days = new Set(logs.filter((l) => l.habit_id === habitId).map((l) => l.day));
  const cursor = new Date();
  // Si hoy aún no está marcado, la racha cuenta desde ayer
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

async function toggleHabit(habitId, day) {
  const exists = logs.some((l) => l.habit_id === habitId && l.day === day);
  if (exists) {
    await run(db.from("habit_logs").delete().eq("habit_id", habitId).eq("day", day)).catch(() => {});
  } else {
    await run(db.from("habit_logs").insert({ habit_id: habitId, day })).catch(() => {});
  }
  loadAll();
}

function renderHabits() {
  const box = $("#habit-list");
  box.replaceChildren();
  show($("#habit-empty"), habits.length === 0);
  const days = lastDays(7);
  const today = dayKey(new Date());
  const names = ["D", "L", "M", "X", "J", "V", "S"];

  for (const h of habits) {
    const card = document.createElement("div");
    card.className = "habit";

    const head = document.createElement("div");
    head.className = "habit-head";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = h.name;
    const streak = document.createElement("span");
    streak.className = "streak";
    streak.textContent = `🔥 ${streakFor(h.id)}`;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.title = "Borrar hábito";
    del.addEventListener("click", async () => {
      if (!confirm(`¿Borrar "${h.name}" y todo su historial?`)) return;
      await run(db.from("habits").delete().eq("id", h.id)).catch(() => {});
      loadAll();
    });
    head.append(name, streak, del);

    const row = document.createElement("div");
    row.className = "days";
    for (const d of days) {
      const key = dayKey(d);
      const b = document.createElement("button");
      b.className = "day";
      if (key === today) b.classList.add("today");
      if (logs.some((l) => l.habit_id === h.id && l.day === key)) b.classList.add("on");
      b.append(names[d.getDay()], document.createElement("br"), String(d.getDate()));
      b.addEventListener("click", () => toggleHabit(h.id, key));
      row.append(b);
    }

    card.append(head, row);
    box.append(card);
  }
}

/* ---------- Cronómetro ---------- */
// Se guarda la hora de inicio (no los segundos), así sigue contando
// con la pantalla bloqueada y se ve igual en todos los dispositivos.

function elapsed() {
  if (!timer) return 0;
  const extra = timer.running && timer.started_at ? Date.now() - Date.parse(timer.started_at) : 0;
  return Number(timer.accumulated_ms) + extra;
}

function renderTimer() {
  if (!timer) return;
  $("#timer-toggle").textContent = timer.running ? "Pausar" : elapsed() > 0 ? "Reanudar" : "Iniciar";
  if (document.activeElement !== $("#timer-label")) $("#timer-label").value = timer.label || "";
  tickTimer();

  const ul = $("#session-list");
  ul.replaceChildren();
  if (sessions.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Aún no has guardado sesiones.";
    ul.append(li);
  }
  for (const s of sessions) {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "title";
    const when = new Date(s.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
    title.textContent = `${fmt(Number(s.duration_ms))} · ${s.label || "Sin etiqueta"} · ${when}`;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      await run(db.from("timer_sessions").delete().eq("id", s.id)).catch(() => {});
      loadAll();
    });
    li.append(title, del);
    ul.append(li);
  }
}

function tickTimer() {
  $("#timer-display").textContent = fmt(elapsed());
  document.title = timer && timer.running ? `${fmt(elapsed())} · Mi Panel` : "Mi Panel";
}

function startTick() {
  clearInterval(tickHandle);
  tickHandle = setInterval(tickTimer, 250);
}

async function updateTimer(patch) {
  const data = await run(db.from("timer").update(patch).eq("user_id", user.id).select().single()).catch(() => null);
  if (data) {
    timer = data;
    renderTimer();
  }
}

$("#timer-toggle").addEventListener("click", () => {
  if (!timer) return;
  if (timer.running) {
    updateTimer({ running: false, started_at: null, accumulated_ms: elapsed() });
  } else {
    updateTimer({ running: true, started_at: new Date().toISOString() });
  }
});

$("#timer-reset").addEventListener("click", () => {
  if (elapsed() > 5000 && !confirm("¿Reiniciar sin guardar la sesión?")) return;
  updateTimer({ running: false, started_at: null, accumulated_ms: 0 });
});

$("#timer-save").addEventListener("click", async () => {
  const ms = elapsed();
  if (ms < 1000) return;
  await run(
    db.from("timer_sessions").insert({ label: $("#timer-label").value.trim(), duration_ms: ms })
  ).catch(() => {});
  await updateTimer({ running: false, started_at: null, accumulated_ms: 0 });
  loadAll();
});

$("#timer-label").addEventListener("change", () => {
  updateTimer({ label: $("#timer-label").value.trim() });
});

/* ---------- Render ---------- */

function renderAll() {
  renderTasks();
  renderHabits();
  renderTimer();
}

init();
