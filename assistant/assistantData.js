"use strict";
// Capa de datos del asistente. Lógica pura: sin DOM, sin red y SIN modelos de IA.
// 1) normalize(): convierte las filas reales de la app (tasks, habits, habit_logs, timer_sessions, transactions,
//    budgets, savings_goals…) en una "instantánea" limpia y validada. Descarta filas inválidas y lo cuenta.
// 2) Adaptadores de persistencia (memoria, almacenamiento clave-valor, Supabase) con aislamiento por usuario.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../logic.js") : root.Logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantData = api;
})(typeof self !== "undefined" ? self : this, function (L) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, n = 200) => String(v == null ? "" : v).trim().slice(0, n);

  /* ---------- Normalización ---------- */

  function normalize(rawIn, { now = new Date() } = {}) {
    const raw = rawIn && typeof rawIn === "object" ? rawIn : {};
    const today = L.dayKey(now);
    const quality = { dropped: {}, counts: {} };
    const drop = (m) => { quality.dropped[m] = (quality.dropped[m] || 0) + 1; };

    const tasks = [];
    for (const t of arr(raw.tasks)) {
      if (!t || t.id == null || !str(t.title)) { drop("tasks"); continue; }
      const status = t.status === "done" || t.done === true ? "done" : t.status === "doing" ? "doing" : "todo";
      tasks.push({
        id: String(t.id), title: str(t.title, 120), status, prio: L.prioOf(t),
        due_date: L.isDayKey(t.due_date) ? t.due_date : null,
        createdDay: L.dayOfTimestamp(t.created_at), completedDay: L.dayOfTimestamp(t.completed_at),
        listId: t.list_id || null, goalId: t.goal_id || null, recurring: !!t.recurrence,
      });
    }

    const logs = arr(raw.habit_logs || raw.logs).filter((l) => l && l.habit_id != null && L.isDayKey(l.day) && l.day <= today);
    const byHabit = L.logsByHabit(logs);
    const habits = [];
    for (const h of arr(raw.habits)) {
      if (!h || h.id == null || !str(h.name)) { drop("habits"); continue; }
      habits.push({
        id: String(h.id), name: str(h.name, 80), frequency: L.habitFrequency(h),
        createdDay: L.dayOfTimestamp(h.created_at) || today, days: byHabit.get(h.id) || byHabit.get(String(h.id)) || new Set(),
      });
    }

    const sessions = [];
    for (const s of arr(raw.timer_sessions || raw.sessions)) {
      const day = s && L.dayOfTimestamp(s.created_at);
      const ms = s && Number(s.duration_ms);
      if (!day || !(ms > 0) || day > today) { drop("sessions"); continue; }
      sessions.push({ day, ms, kind: s.kind || null });
    }

    const transactions = [];
    for (const t of arr(raw.transactions)) {
      const cents = t && L.centsFromDb(t.amount);
      if (!t || !L.isDayKey(t.tx_date) || t.tx_date > today || !(cents > 0) || (t.type !== "income" && t.type !== "expense")) { drop("transactions"); continue; }
      transactions.push({ type: t.type, cents, category: str(t.category, 40) || "Otros", date: t.tx_date });
    }

    const budgets = [];
    for (const b of arr(raw.budgets)) {
      const cents = b && L.centsFromDb(b.amount);
      if (!b || !(cents > 0)) { drop("budgets"); continue; }
      budgets.push({ category: str(b.category, 40), cents });
    }

    // Objetivos: la app actual NO tiene módulo de objetivos. Si se aporta `goals`, se usa; si no, el módulo queda sin datos.
    const goals = [];
    for (const g of arr(raw.goals)) {
      if (!g || g.id == null || !str(g.title)) { drop("goals"); continue; }
      goals.push({
        id: String(g.id), title: str(g.title, 120), status: ["done", "paused"].includes(g.status) ? g.status : "active",
        createdDay: L.dayOfTimestamp(g.created_at), lastProgressDay: L.dayOfTimestamp(g.last_progress_at || g.updated_at),
        milestones: arr(g.milestones).filter((m) => m && m.id != null).map((m) => ({
          id: String(m.id), title: str(m.title, 120), due_date: L.isDayKey(m.due_date) ? m.due_date : null, done: !!m.done,
        })),
      });
    }

    // Historial de cambios de fecha de tareas. La app actual no lo registra: sin él, la regla de aplazamientos no se activa.
    const taskEvents = arr(raw.taskEvents).filter((e) => e && e.taskId != null && e.type === "due_changed" && L.dayOfTimestamp(e.at))
      .map((e) => ({ taskId: String(e.taskId), day: L.dayOfTimestamp(e.at), from: L.isDayKey(e.from) ? e.from : null, to: L.isDayKey(e.to) ? e.to : null }));

    quality.counts = { tasks: tasks.length, habits: habits.length, habitLogs: logs.length, sessions: sessions.length, transactions: transactions.length, budgets: budgets.length, goals: goals.length, taskEvents: taskEvents.length };
    return { today, hour: now.getHours(), weekday: L.weekdayIndex(today), tasks, habits, sessions, transactions, budgets, goals, taskEvents, quality };
  }

  // Huella del estado de los datos: sirve para saber si "algo ha cambiado" desde la última evaluación.
  function fingerprint(snap) {
    const parts = [snap.today, snap.hour >= 18 ? "n" : "d"];
    for (const t of snap.tasks) parts.push(t.id, t.status, t.prio, t.due_date || "");
    for (const h of snap.habits) parts.push(h.id, h.frequency, h.days.size, [...h.days].sort().pop() || "");
    for (const s of snap.sessions) parts.push(s.day, s.ms);
    for (const t of snap.transactions) parts.push(t.type[0], t.cents, t.category, t.date);
    for (const b of snap.budgets) parts.push(b.category, b.cents);
    for (const g of snap.goals) parts.push(g.id, g.status, g.lastProgressDay || "", g.milestones.map((m) => m.id + m.done + (m.due_date || "")).join(","));
    for (const e of snap.taskEvents) parts.push(e.taskId, e.day, e.to || "");
    let hsh = 5381;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) hsh = ((hsh * 33) ^ s.charCodeAt(i)) >>> 0;
    return hsh.toString(36);
  }

  /* ---------- Adaptadores de persistencia ----------
     Interfaz (asíncrona): load(userId) → estado|null · save(userId, estado) · clear(userId).
     El estado siempre se guarda y se lee clonado: nadie comparte referencias, y cada userId tiene su espacio. */

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const needUser = (u) => { if (!u || typeof u !== "string") throw new Error("Se necesita un userId para persistir."); };

  function createMemoryAdapter() {
    const store = new Map();
    return {
      kind: "memory",
      async load(u) { needUser(u); return clone(store.get(u) || null); },
      async save(u, s) { needUser(u); store.set(u, clone(s)); },
      async clear(u) { needUser(u); store.delete(u); },
    };
  }

  // storage: cualquier objeto con getItem/setItem/removeItem (p. ej. localStorage)
  function createStorageAdapter(storage, prefix = "mipanel.assistant.") {
    return {
      kind: "storage",
      async load(u) { needUser(u); try { const v = storage.getItem(prefix + u); return v ? JSON.parse(v) : null; } catch { return null; } },
      async save(u, s) { needUser(u); storage.setItem(prefix + u, JSON.stringify(s)); },
      async clear(u) { needUser(u); storage.removeItem(prefix + u); },
    };
  }

  // Tabla propuesta `assistant_state (user_id uuid primary key default auth.uid(), state jsonb, updated_at)` con RLS.
  // NO se ha probado contra el Supabase real: solo contra un cliente simulado en los tests.
  function createSupabaseAdapter(client, table = "assistant_state") {
    return {
      kind: "supabase",
      async load(u) {
        needUser(u);
        const { data, error } = await client.from(table).select("state").eq("user_id", u).maybeSingle();
        if (error) throw error;
        return data ? data.state : null;
      },
      async save(u, s) {
        needUser(u);
        const { error } = await client.from(table).upsert({ user_id: u, state: s, updated_at: new Date().toISOString() });
        if (error) throw error;
      },
      async clear(u) {
        needUser(u);
        const { error } = await client.from(table).delete().eq("user_id", u);
        if (error) throw error;
      },
    };
  }

  return { normalize, fingerprint, createMemoryAdapter, createStorageAdapter, createSupabaseAdapter, clone };
});
