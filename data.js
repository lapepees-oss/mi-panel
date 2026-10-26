"use strict";
// Persistencia (Supabase): carga paginada POR TABLA (LOADERS) y operaciones de hábitos, diario, finanzas, ideas,
// suscripciones e importación. loadAll(tablas) solo relee lo que cambió para gastar poco tráfico del plan gratuito
// (ver PLAN-SUPABASE.md).
// Las tareas y el cronómetro mantienen sus operaciones en tasks.js y timer.js.

const PAGE_SIZE = 1000; // límite por petición de PostgREST

// Lee TODAS las filas de una consulta, página a página (sin esto se pierden datos a partir de 1000)
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const data = await run(build().range(from, from + PAGE_SIZE - 1));
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadTimer() {
  let row = await run(db.from("timer").select("*").eq("user_id", user.id).maybeSingle());
  if (!row) row = await run(db.from("timer").insert({ user_id: user.id }).select().single());
  return row;
}

// Cuántos días de sesiones del cronómetro se cargan (estadísticas, historial)
const SESSION_DAYS = 90;

// Guarda una sesión. Si todavía no existe la columna "kind" (falta migracion-v4.sql), se guarda sin tipo.
async function saveSession({ label, duration_ms, kind }) {
  let { error } = await db.from("timer_sessions").insert({ label, duration_ms, kind });
  if (error && (error.code === "42703" || error.code === "PGRST204" || /kind/i.test(error.message || ""))) {
    ({ error } = await db.from("timer_sessions").insert({ label, duration_ms }));
  }
  if (error) {
    console.error(error);
    setSync(false);
    toast(Logic.dataErrorText(error), 6000);
    throw error;
  }
  setSync(true);
}

/* ---------- Carga de datos ----------
 * Antes, cada cambio (propio o de otro dispositivo) volvía a descargar TODAS las tablas. Eso multiplica el tráfico
 * (egress) de Supabase según crece tu historial. Ahora cada tabla tiene su propio cargador y solo se vuelve a leer
 * la que cambió (más las que dependen de ella). loadAll() sin argumentos sigue cargándolo todo (inicio, reconexión).
 */

let loading = false;
let reloadTimeout = null;
let pendingTables = new Set(); // tablas pendientes de recargar mientras hay una carga en curso
let pendingAll = false;
let lastFullLoad = 0;

const latest = (col) => (q) => q.order(col, { ascending: false }).order("id");
const oldest = (col) => (q) => q.order(col).order("id");
// Un cargador por tabla: rellena su parte de `state`. Las claves son nombres de tabla de Supabase.
const LOADERS = {
  tasks: async () => { state.tasks = await fetchAll(() => latest("created_at")(db.from("tasks").select("*"))); },
  task_lists: async () => { state.lists = await fetchAll(() => oldest("created_at")(db.from("task_lists").select("*"))); },
  task_steps: async () => { state.steps = await fetchAll(() => oldest("created_at")(db.from("task_steps").select("*"))); },
  habits: async () => { state.habits = await fetchAll(() => oldest("created_at")(db.from("habits").select("*"))); },
  habit_logs: async () => { state.logs = await fetchAll(() => db.from("habit_logs").select("*").order("day").order("habit_id")); },
  journal_entries: async () => { state.journal = await fetchAll(() => latest("entry_date")(db.from("journal_entries").select("*"))); },
  transactions: async () => { state.transactions = await fetchAll(() => latest("tx_date")(db.from("transactions").select("*"))); },
  budgets: async () => { state.budgets = await fetchAll(() => db.from("budgets").select("*").order("category")); },
  savings_goals: async () => { state.goals = await fetchAll(() => oldest("created_at")(db.from("savings_goals").select("*"))); },
  // Solo las sesiones recientes (SESSION_DAYS): el historial antiguo no se descarga cada vez
  timer_sessions: async () => { state.sessions = await fetchAll(() => latest("created_at")(db.from("timer_sessions").select("*").gte("created_at", new Date(Date.now() - SESSION_DAYS * 86400000).toISOString()))); },
  routines: async () => { state.routines = await fetchAll(() => oldest("created_at")(db.from("routines").select("*"))); },
  routine_steps: async () => { state.routineSteps = await fetchAll(() => db.from("routine_steps").select("*").order("id")); },
  timer: async () => { state.timer = await loadTimer(); },
  ideas: () => loadIdeas(),
  subscriptions: () => loadSubs(),
  intelligence: () => loadIntel(), // intelligence_settings + intelligence_items
};
// Si cambia X, también hay que releer lo que depende de X (borrados en cascada, etc.)
const TABLE_ALIAS = { intelligence_settings: "intelligence", intelligence_items: "intelligence" };
const DEPENDENTS = { task_lists: ["tasks", "task_steps"], tasks: ["task_steps"], habits: ["habit_logs"], routines: ["routine_steps"] };

function expandTables(names) {
  const out = new Set();
  for (const raw of names) {
    const n = TABLE_ALIAS[raw] || raw;
    if (!LOADERS[n]) return null; // tabla desconocida → por seguridad, recarga completa
    out.add(n);
    (DEPENDENTS[n] || []).forEach((x) => out.add(x));
  }
  return out;
}

async function loadAll(only) {
  if (!user) return;
  const wanted = only && only.length ? expandTables(only) : null;
  // Una sola carga a la vez; lo que llegue mientras tanto se acumula y se repite al terminar
  if (loading) {
    if (wanted) wanted.forEach((t) => pendingTables.add(t));
    else pendingAll = true;
    return;
  }
  loading = true;
  try {
    const names = wanted ? [...wanted] : Object.keys(LOADERS);
    await Promise.all(names.map((n) => LOADERS[n]()));
    if (!wanted) lastFullLoad = Date.now();
    showBanner("");
    renderAll();
  } catch (e) {
    showBanner(
      "No se pudieron cargar los datos. Si acabas de actualizar la app, ejecuta migracion-v3.sql (y luego single-user.sql) en el SQL Editor de Supabase y recarga. " +
        Logic.dataErrorText(e)
    );
  } finally {
    loading = false;
    if (pendingAll || pendingTables.size) {
      const t = pendingAll ? null : [...pendingTables];
      pendingAll = false;
      pendingTables = new Set();
      scheduleReload(t);
    }
  }
}

// Agrupa avisos seguidos (p. ej. varios cambios a la vez) en una sola lectura de las tablas afectadas
let scheduledTables = new Set(), scheduledAll = false;
function scheduleReload(tables) {
  if (tables && tables.length) tables.forEach((t) => scheduledTables.add(t));
  else scheduledAll = true;
  clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(() => {
    const t = scheduledAll ? null : [...scheduledTables];
    scheduledTables = new Set(); scheduledAll = false;
    loadAll(t);
  }, 150);
}

// ¿Hace falta recargar todo al volver a la app? Solo si pasó un rato desde la última carga completa
const needsFullReload = () => Date.now() - lastFullLoad > 60000;

/* ---------- Hábitos ---------- */

const habitDays = () => Logic.logsByHabit(state.logs);

// Los campos categoría/frecuencia/color existen tras ejecutar migracion-v4.sql; si faltan, se avisa en vez de perder datos.
const missingColumn = (e) => e && (e.code === "42703" || e.code === "PGRST204" || /column/i.test(e.message || ""));
async function habitWrite(query) {
  const { error } = await query;
  if (error) {
    console.error(error);
    setSync(false);
    toast(missingColumn(error) ? "Falta actualizar la base de datos: ejecuta migracion-v4.sql en Supabase." : Logic.dataErrorText(error), 7000);
    throw error;
  }
  setSync(true);
}

function createHabit({ name, emoji, hint, category, frequency, color }) {
  const row = { name, emoji: emoji || "🌱", hint: hint || "", category: category || "Personal", frequency: frequency || "Diario", color: color || Logic.HABIT_COLORS[0] };
  return mutate(null, () => habitWrite(db.from("habits").insert(row)));
}

function updateHabit(id, patch) {
  const hb = state.habits.find((x) => x.id === id);
  return mutate(() => hb && Object.assign(hb, patch), () => habitWrite(db.from("habits").update(patch).eq("id", id)));
}

// Copia independiente (nuevo id, sin historial)
function duplicateHabit(hb) {
  let name = `${hb.name} (copia)`.slice(0, 80);
  for (let n = 2; state.habits.some((x) => x.name.toLowerCase() === name.toLowerCase()); n++) name = `${hb.name} (copia ${n})`.slice(0, 80);
  return createHabit({ name, emoji: hb.emoji, hint: hb.hint, category: Logic.habitCategory(hb), frequency: Logic.habitFrequency(hb), color: Logic.habitColor(hb) });
}

function deleteHabit(id) {
  return mutate(
    () => {
      state.habits = state.habits.filter((x) => x.id !== id);
      state.logs = state.logs.filter((l) => l.habit_id !== id);
    },
    () => run(db.from("habits").delete().eq("id", id))
  );
}

// Marca o desmarca un hábito en una fecha (también pasadas; las futuras no se permiten)
function setHabitDay(habitId, day, on) {
  if (!Logic.isDayKey(day) || day > todayKey()) return Promise.resolve(false);
  const has = state.logs.some((l) => l.habit_id === habitId && l.day === day);
  if (on === has) return Promise.resolve(true);
  return mutate(
    () => {
      if (on) state.logs.push({ habit_id: habitId, day });
      else state.logs = state.logs.filter((l) => !(l.habit_id === habitId && l.day === day));
    },
    () =>
      on
        ? run(db.from("habit_logs").upsert({ habit_id: habitId, day, user_id: user.id }, { onConflict: "habit_id,day", ignoreDuplicates: true }))
        : run(db.from("habit_logs").delete().eq("habit_id", habitId).eq("day", day))
  );
}

/* ---------- Intelligence (tablas de migracion-v5.sql) ---------- */

// Activa = interruptor encendido y fecha de expiración (si existe) aún no alcanzada. La fecha la fija el propietario a mano.
function intelActive(now = Date.now()) {
  const i = state.intel;
  return !!i.enabled && (!i.expires_at || now < Date.parse(i.expires_at));
}

async function loadIntel() {
  try {
    const rows = await fetchAll(() => db.from("intelligence_settings").select("*"));
    const r = rows[0];
    state.intel = r
      ? { enabled: r.intelligence_enabled !== false, expires_at: r.intelligence_expires_at || null, mode: r.intelligence_mode === "rules" ? "rules" : "hybrid", stored: true, ready: true }
      : { enabled: true, expires_at: null, mode: "hybrid", stored: false, ready: true };
    state.intelItems = await fetchAll(() => db.from("intelligence_items").select("*").order("created_at", { ascending: false }).order("id"));
  } catch (e) {
    if (!missingTable(e)) throw e;
    state.intel = { enabled: true, expires_at: null, mode: "hybrid", stored: false, ready: false };
    state.intelItems = [];
  }
}

async function intelWrite(query) {
  const { error } = await query;
  if (error) {
    console.error(error);
    setSync(false);
    const blocked = /row-level security|violates/i.test(error.message || "");
    toast(missingTable(error) ? "Falta actualizar la base de datos: ejecuta migracion-v5.sql en Supabase." : blocked ? "Intelligence está desactivada o ha expirado: el servidor no permite guardar." : Logic.dataErrorText(error), 7000);
    throw error;
  }
  setSync(true);
}

function saveIntelSettings({ enabled, expires_at, mode }) {
  const row = { intelligence_enabled: !!enabled, intelligence_expires_at: expires_at || null, intelligence_mode: mode === "rules" ? "rules" : "hybrid", updated_at: new Date().toISOString() };
  return mutate(
    () => { state.intel = { enabled: !!enabled, expires_at: row.intelligence_expires_at, mode: row.intelligence_mode, stored: true, ready: true }; },
    () => intelWrite(db.from("intelligence_settings").upsert({ ...row, user_id: user.id }, { onConflict: "user_id" }))
  );
}

function addIntelItems(items) {
  const rows = items.map((i) => ({ title: i.title.slice(0, 120), category: i.category || "otros", problem: (i.problem || "").slice(0, 500), action: (i.action || "").slice(0, 500), priority: i.priority >= 1 && i.priority <= 4 ? i.priority : 4, suggested_date: i.suggested_date || null, related_goal: (i.goal || "").slice(0, 200) }));
  return mutate(null, () => intelWrite(db.from("intelligence_items").insert(rows)));
}
function updateIntelItem(id, patch) {
  const it = state.intelItems.find((x) => x.id === id);
  return mutate(() => it && Object.assign(it, patch), () => intelWrite(db.from("intelligence_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id)));
}
function deleteIntelItem(id) {
  return mutate(() => { state.intelItems = state.intelItems.filter((x) => x.id !== id); }, () => intelWrite(db.from("intelligence_items").delete().eq("id", id)));
}

/* ---------- Ideas (tabla ideas; se crea con migracion-v4.sql) ---------- */

const missingTable = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /relation .*ideas|schema cache/i.test(e.message || ""));

async function loadIdeas() {
  try {
    state.ideas = await fetchAll(() => db.from("ideas").select("*").order("created_at", { ascending: false }).order("id"));
    state.ideasReady = true;
  } catch (e) {
    state.ideas = [];
    state.ideasReady = !missingTable(e);
    if (state.ideasReady) throw e;
  }
}

async function loadSubs() {
  try {
    state.subs = await fetchAll(() => db.from("subscriptions").select("*").order("created_at", { ascending: false }).order("id"));
    state.subsReady = true;
  } catch (e) {
    state.subs = [];
    state.subsReady = !missingTable(e);
    if (state.subsReady) throw e;
  }
}

async function subWrite(query) {
  const { error } = await query;
  if (error) {
    console.error(error);
    setSync(false);
    toast(missingTable(error) ? "Falta la tabla de suscripciones: ejecuta migracion-v6.sql en Supabase." : Logic.dataErrorText(error), 7000);
    throw error;
  }
  setSync(true);
}

const subRow = (v) => ({
  name: v.name.trim(), amount: Logic.centsToDb(v.cents), cycle: v.cycle, category: (v.category || "Suscripciones").trim() || "Suscripciones",
  next_charge: v.next_charge || null, notes: (v.notes || "").trim(),
});
const createSub = (v) => mutate(null, () => subWrite(db.from("subscriptions").insert({ ...subRow(v), status: "active", started_on: v.next_charge || null })));
function updateSub(id, patch) {
  const s = state.subs.find((x) => x.id === id);
  return mutate(() => s && Object.assign(s, patch), () => subWrite(db.from("subscriptions").update(patch).eq("id", id)));
}
const editSub = (id, v) => updateSub(id, subRow(v));
const deleteSub = (id) => mutate(() => { state.subs = state.subs.filter((x) => x.id !== id); }, () => subWrite(db.from("subscriptions").delete().eq("id", id)));

async function ideaWrite(query) {
  const { error } = await query;
  if (error) {
    console.error(error);
    setSync(false);
    toast(missingTable(error) ? "Falta la tabla de ideas: ejecuta migracion-v4.sql en Supabase." : Logic.dataErrorText(error), 7000);
    throw error;
  }
  setSync(true);
}

const cleanTags = (tags) => [...new Set((tags || []).map((t) => String(t).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12);

function createIdea({ title, body, tags, entry_date }) {
  return mutate(null, () => ideaWrite(db.from("ideas").insert({ title: title.trim(), body: (body || "").trim(), tags: cleanTags(tags), entry_date: entry_date || null })));
}
function updateIdea(id, patch) {
  const clean = { ...patch, updated_at: new Date().toISOString() };
  if (clean.tags) clean.tags = cleanTags(clean.tags);
  const idea = state.ideas.find((x) => x.id === id);
  return mutate(() => idea && Object.assign(idea, clean), () => ideaWrite(db.from("ideas").update(clean).eq("id", id)));
}
function deleteIdea(id) {
  return mutate(() => { state.ideas = state.ideas.filter((x) => x.id !== id); }, () => ideaWrite(db.from("ideas").delete().eq("id", id)));
}

// Borra las notas (rápida y entrada) de un día
async function deleteJournalDay(date) {
  const rows = state.journal.filter((j) => j.entry_date === date);
  return mutate(
    () => { state.journal = state.journal.filter((j) => j.entry_date !== date); },
    async () => { for (const r of rows) await run(db.from("journal_entries").delete().eq("id", r.id)); }
  );
}

/* ---------- Diario ---------- */

const journalEntry = (kind, date) => state.journal.find((j) => j.kind === kind && j.entry_date === date) || null;

// Guarda (o borra si queda vacío) la nota de un día. Devuelve true si el servidor la aceptó.
async function saveJournal(kind, date, body) {
  const existing = journalEntry(kind, date);
  try {
    if (!body.trim()) {
      if (existing) await run(db.from("journal_entries").delete().eq("id", existing.id));
      state.journal = state.journal.filter((j) => !(j.kind === kind && j.entry_date === date));
    } else {
      const row = await run(
        db
          .from("journal_entries")
          .upsert({ user_id: user.id, kind, entry_date: date, body, updated_at: new Date().toISOString() }, { onConflict: "user_id,kind,entry_date" })
          .select()
          .single()
      );
      state.journal = state.journal.filter((j) => !(j.kind === kind && j.entry_date === date));
      state.journal.push(row);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/* ---------- Finanzas ---------- */

function addTransaction({ type, cents, title, category, tx_date }) {
  return mutate(null, () =>
    run(db.from("transactions").insert({ type, amount: Logic.centsToDb(cents), title, category, tx_date }))
  );
}

function updateTransaction(id, { type, cents, title, category, tx_date }) {
  const patch = { type, amount: Logic.centsToDb(cents), title, category, tx_date };
  const t = state.transactions.find((x) => x.id === id);
  return mutate(() => t && Object.assign(t, patch), () => run(db.from("transactions").update(patch).eq("id", id)));
}

function deleteTransaction(id) {
  return mutate(
    () => (state.transactions = state.transactions.filter((t) => t.id !== id)),
    () => run(db.from("transactions").delete().eq("id", id))
  );
}

// category "" = presupuesto mensual total
function setBudget(category, cents) {
  return mutate(null, () =>
    cents > 0
      ? run(db.from("budgets").upsert({ user_id: user.id, category, amount: Logic.centsToDb(cents) }, { onConflict: "user_id,category" }))
      : run(db.from("budgets").delete().eq("category", category))
  );
}

const addGoal = ({ name, target, current }) =>
  mutate(null, () =>
    run(db.from("savings_goals").insert({ name, target: Logic.centsToDb(target), current: Logic.centsToDb(current) }))
  );

function updateGoal(id, { name, target, current }) {
  const patch = { name, target: Logic.centsToDb(target), current: Logic.centsToDb(current) };
  const g = state.goals.find((x) => x.id === id);
  return mutate(() => g && Object.assign(g, patch), () => run(db.from("savings_goals").update(patch).eq("id", id)));
}

const deleteGoal = (id) =>
  mutate(
    () => (state.goals = state.goals.filter((g) => g.id !== id)),
    () => run(db.from("savings_goals").delete().eq("id", id))
  );

/* ---------- Importar datos de Cloudspace ---------- */

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Ejecuta el plan de Logic.planImport. Los proyectos nuevos se crean primero para poder enlazar las tareas.
async function runImport(plan, today) {
  const listId = new Map(state.lists.map((l) => [l.name.toLowerCase(), l.id]));
  for (const name of plan.newLists) {
    const row = await run(db.from("task_lists").insert({ name }).select().single());
    listId.set(name.toLowerCase(), row.id);
  }
  for (const part of chunk(plan.tasks, 200)) {
    await run(
      db.from("tasks").insert(
        part.map((t) => ({
          title: t.title,
          prio: t.prio,
          due_date: t.due_date,
          tags: t.tags,
          list_id: t.project ? listId.get(t.project.toLowerCase()) || null : null,
          status: t.done ? "done" : "todo",
          done: t.done,
          completed_at: t.done ? new Date().toISOString() : null,
          ...(t.created ? { created_at: `${t.created}T12:00:00` } : {}),
        }))
      )
    );
  }
  for (const hb of plan.habits) {
    let id = hb.existingId;
    if (!id) {
      const row = await run(db.from("habits").insert({ name: hb.name, emoji: hb.emoji, hint: hb.hint }).select().single());
      id = row.id;
    }
    for (const part of chunk(hb.days, 500)) {
      await run(
        db.from("habit_logs").upsert(part.map((day) => ({ habit_id: id, day, user_id: user.id })), { onConflict: "habit_id,day", ignoreDuplicates: true })
      );
    }
  }
  for (const part of chunk(plan.transactions, 200)) {
    await run(
      db.from("transactions").insert(
        part.map((t) => ({ type: t.type, amount: Logic.centsToDb(t.cents), title: t.title, category: t.category, tx_date: t.tx_date }))
      )
    );
  }
  if (plan.budget) {
    await run(db.from("budgets").upsert({ user_id: user.id, category: "", amount: Logic.centsToDb(plan.budget) }, { onConflict: "user_id,category" }));
  }
  if (plan.goal) {
    await run(
      db.from("savings_goals").insert({ name: plan.goal.name, target: Logic.centsToDb(plan.goal.target), current: Logic.centsToDb(plan.goal.current) })
    );
  }
  for (const j of plan.journal) {
    await run(
      db.from("journal_entries").upsert({ user_id: user.id, kind: j.kind, entry_date: j.entry_date, body: j.body }, { onConflict: "user_id,kind,entry_date" })
    );
  }
  await loadAll();
}
