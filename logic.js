"use strict";
// Lógica pura: sin DOM, sin red y sin estado global. Se carga en el navegador (window.Logic)
// y en los tests de Node. Aquí viven las partes donde un fallo sería silencioso:
// fechas locales, dinero en céntimos, rachas, filtros de tareas, CSV y copias de seguridad.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof self !== "undefined" ? self : this, function () {
  const pad = (n) => String(n).padStart(2, "0");

  /* ================= Fechas (claves locales YYYY-MM-DD) ================= */

  // Nunca se usa toISOString() para las fechas del usuario: eso es UTC y desplaza el día.
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = (now = new Date()) => dayKey(now);

  function isDayKey(s) {
    if (typeof s !== "string") return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  // Fecha local a mediodía: así un cambio de hora nunca la mueve de día
  function parseDay(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }

  // Aritmética de calendario pura (UTC): inmune a cambios de hora
  function addDays(s, n) {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  // Días de calendario entre a y b (a - b)
  function dayDiff(a, b) {
    const u = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((u(a) - u(b)) / 86400000);
  }

  function lastDayKeys(n, today) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
    return out;
  }

  // Lunes = 0 … domingo = 6
  function weekdayIndex(key) {
    const [y, m, d] = key.split("-").map(Number);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  }
  const weekStart = (key) => addDays(key, -weekdayIndex(key));
  const weekKeys = (startKey) => Array.from({ length: 7 }, (_, i) => addDays(startKey, i));

  const monthKey = (key) => key.slice(0, 7);
  function addMonths(mk, n) {
    const [y, m] = mk.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${String(Math.floor(t / 12)).padStart(4, "0")}-${pad((t % 12) + 1)}`;
  }
  function monthBounds(mk) {
    const [y, m] = mk.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { first: `${mk}-01`, last: `${mk}-${pad(last)}`, days: last };
  }
  const monthLabel = (mk) => {
    const [y, m] = mk.split("-").map(Number);
    return new Date(y, m - 1, 1, 12).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  };
  const shortDate = (key) => parseDay(key).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  const longDate = (key) =>
    parseDay(key).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Día local de una marca de tiempo ISO (created_at, completed_at…)
  function dayOfTimestamp(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : dayKey(d);
  }

  /* ================= Dinero (siempre en céntimos enteros) ================= */

  const MAX_CENTS = 10000000000; // 100.000.000,00 €

  // Acepta "12,50", "12.5", "1.234,56", "1,234.56". Rechaza más de 2 decimales (no redondea en silencio).
  function parseCents(input, { allowZero = false } = {}) {
    const bad = (error) => ({ ok: false, error });
    if (input == null) return bad("Introduce un importe.");
    let s = String(input).trim().replace(/[€\s]/g, "");
    if (!s) return bad("Introduce un importe.");
    if (s[0] === "-") return bad("El importe debe ser positivo; usa el tipo Gasto para salidas.");
    if (s[0] === "+") s = s.slice(1);
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    let intPart = s, frac = "";
    if (lc >= 0 && ld >= 0) {
      const sep = Math.max(lc, ld);
      intPart = s.slice(0, sep).replace(/[.,]/g, "");
      frac = s.slice(sep + 1);
    } else if (lc >= 0 || ld >= 0) {
      const sep = Math.max(lc, ld);
      const ch = s[sep];
      if (s.split(ch).length > 2) intPart = s.replace(/[.,]/g, ""); // 1.234.567 → miles
      else {
        intPart = s.slice(0, sep);
        frac = s.slice(sep + 1);
      }
    }
    if (intPart === "") intPart = "0";
    if (!/^\d+$/.test(intPart) || (frac !== "" && !/^\d+$/.test(frac))) return bad("Importe no válido.");
    if (frac.length > 2) return bad("Usa como máximo 2 decimales.");
    const cents = Number(intPart) * 100 + Number((frac + "00").slice(0, 2));
    if (!Number.isSafeInteger(cents)) return bad("Importe no válido.");
    if (cents === 0 && !allowZero) return bad("El importe debe ser mayor que 0.");
    if (cents > MAX_CENTS) return bad("El importe es demasiado grande.");
    return { ok: true, cents };
  }

  const centsFromDb = (v) => Math.round(Number(v) * 100) || 0;
  // numeric(12,2) de Postgres: "12.50" (se construye con texto, sin decimales flotantes)
  function centsToDb(c) {
    const sign = c < 0 ? "-" : "";
    const a = Math.abs(Math.round(c));
    return `${sign}${Math.floor(a / 100)}.${pad(a % 100)}`;
  }
  // Para CSV y campos de edición: coma decimal, sin separador de miles
  function centsToPlain(c) {
    return centsToDb(c).replace(".", ",");
  }
  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const formatEUR = (c) => eurFmt.format(c / 100);

  /* ================= Finanzas ================= */

  const EXPENSE_CATEGORIES = ["Comida", "Transporte", "Ocio", "Estudios", "Hogar", "Salud", "Suscripciones", "Ropa", "Otros"];
  const INCOME_CATEGORIES = ["Salario", "Regalo", "Ahorro", "Otros"];

  function monthTotals(txs, mk) {
    let income = 0, expense = 0;
    const byCategory = {};
    let count = 0;
    for (const t of txs) {
      if (!t.tx_date || monthKey(t.tx_date) !== mk) continue;
      const c = centsFromDb(t.amount);
      count++;
      if (t.type === "income") income += c;
      else {
        expense += c;
        byCategory[t.category] = (byCategory[t.category] || 0) + c;
      }
    }
    return { income, expense, balance: income - expense, byCategory, count };
  }

  function monthSeries(txs, endMonth, n) {
    return Array.from({ length: n }, (_, i) => {
      const mk = addMonths(endMonth, -(n - 1 - i));
      const { income, expense } = monthTotals(txs, mk);
      return { month: mk, income, expense };
    });
  }

  // budgets: [{category:'' (total) | nombre, amount}] ; totals: salida de monthTotals
  function budgetStatus(budgets, totals) {
    const mk = (limit, spent) => ({
      limit,
      spent,
      left: limit - spent,
      pct: limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0,
      over: limit > 0 && spent > limit,
    });
    const total = budgets.find((b) => b.category === "");
    return {
      total: total ? mk(centsFromDb(total.amount), totals.expense) : null,
      categories: budgets
        .filter((b) => b.category !== "")
        .map((b) => ({ category: b.category, ...mk(centsFromDb(b.amount), totals.byCategory[b.category] || 0) }))
        .sort((a, b) => b.pct - a.pct || a.category.localeCompare(b.category, "es")),
    };
  }

  const goalPct = (g) => {
    const target = centsFromDb(g.target), cur = centsFromDb(g.current);
    return target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0;
  };

  /* ================= Hábitos ================= */

  function logsByHabit(logs) {
    const map = new Map();
    for (const l of logs) {
      if (!map.has(l.habit_id)) map.set(l.habit_id, new Set());
      map.get(l.habit_id).add(l.day);
    }
    return map;
  }

  // Racha actual: si hoy aún no está marcado, cuenta desde ayer (no se rompe hasta que acaba el día)
  function currentStreak(days, today) {
    let cursor = days.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (days.has(cursor)) {
      n++;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  function longestStreak(days) {
    const sorted = [...days].filter(isDayKey).sort();
    let best = 0, run = 0, prev = null;
    for (const d of sorted) {
      run = prev && dayDiff(d, prev) === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    }
    return best;
  }

  // Cumplimiento en los últimos n días (si el hábito es más reciente, solo cuentan sus días)
  function completionRate(days, today, n = 30, createdDay = null) {
    let window = n;
    if (createdDay) window = Math.max(1, Math.min(n, dayDiff(today, createdDay) + 1));
    let done = 0;
    for (let i = 0; i < window; i++) if (days.has(addDays(today, -i))) done++;
    return { done, total: window, pct: Math.round((done / window) * 100) };
  }

  function heatLevel(count, total) {
    if (!count) return 0;
    return Math.min(4, Math.max(1, Math.ceil((count / Math.max(total, count, 1)) * 4)));
  }

  // Un cuadro por día; "total" = hábitos que ya existían ese día
  function heatCells(habits, byHabit, today, n = 35) {
    return lastDayKeys(n, today).map((key) => {
      let count = 0;
      for (const h of habits) if (byHabit.get(h.id)?.has(key)) count++;
      const total = habits.filter((h) => {
        const c = dayOfTimestamp(h.created_at);
        return !c || c <= key;
      }).length;
      return { key, count, total, level: heatLevel(count, total) };
    });
  }

  function activeDays(cells) {
    return cells.filter((c) => c.count > 0).length;
  }

  /* ================= Tareas ================= */

  const PRIO_LABELS = { 1: "P1 · Urgente", 2: "P2 · Alta", 3: "P3 · Media", 4: "P4 · Normal" };
  const prioOf = (t) => (t.prio >= 1 && t.prio <= 4 ? t.prio : 4);
  const isOpen = (t) => t.status !== "done";
  const isOverdue = (t, today) => isOpen(t) && !!t.due_date && t.due_date < today;

  // Vistas: inbox = abiertas sin proyecto; today = abiertas con fecha de hoy o vencida;
  // upcoming = abiertas con fecha futura; pending = todas las abiertas; done = completadas.
  function inView(view, t, today) {
    if (view === "inbox") return isOpen(t) && !t.list_id;
    if (view === "today") return isOpen(t) && !!t.due_date && t.due_date <= today;
    if (view === "upcoming") return isOpen(t) && !!t.due_date && t.due_date > today;
    if (view === "pending") return isOpen(t);
    if (view === "done") return !isOpen(t);
    if (view.startsWith("list:")) return t.list_id === view.slice(5);
    return true;
  }

  const dueKey = (t) => t.due_date || "9999-12-31";
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function sortTasks(items, mode, view) {
    const created = (a, b) => cmpStr(b.created_at || "", a.created_at || "");
    const by = {
      smart: (a, b) => cmpStr(dueKey(a), dueKey(b)) || prioOf(a) - prioOf(b) || created(a, b),
      due: (a, b) => cmpStr(dueKey(a), dueKey(b)) || prioOf(a) - prioOf(b),
      priority: (a, b) => prioOf(a) - prioOf(b) || cmpStr(dueKey(a), dueKey(b)),
      created,
      alpha: (a, b) => a.title.localeCompare(b.title, "es"),
    };
    const out = [...items];
    if (view === "done" && mode === "smart") {
      return out.sort((a, b) => cmpStr(b.completed_at || b.created_at || "", a.completed_at || a.created_at || ""));
    }
    return out.sort(by[mode] || by.smart);
  }

  function filterTasks(tasks, { view = "pending", q = "", label = "", prio = "", listId = "" }, today, listNameOf = () => "") {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!inView(view, t, today)) return false;
      if (listId && t.list_id !== listId) return false;
      if (label && !(t.tags || []).includes(label)) return false;
      if (prio && String(prioOf(t)) !== String(prio)) return false;
      if (!needle) return true;
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.notes || "").toLowerCase().includes(needle) ||
        (t.tags || []).some((g) => g.includes(needle)) ||
        (listNameOf(t.list_id) || "").toLowerCase().includes(needle)
      );
    });
  }

  function viewCounts(tasks, today) {
    const c = { inbox: 0, today: 0, upcoming: 0, pending: 0, done: 0, lists: {} };
    for (const t of tasks) {
      for (const v of ["inbox", "today", "upcoming", "pending", "done"]) if (inView(v, t, today)) c[v]++;
      if (t.list_id && isOpen(t)) c.lists[t.list_id] = (c.lists[t.list_id] || 0) + 1;
    }
    return c;
  }

  function dueInfo(due, today) {
    if (!due) return null;
    if (due < today) {
      const n = dayDiff(today, due);
      return { cls: "overdue", text: `Vencida · ${shortDate(due)}`, title: n === 1 ? "Venció ayer" : `Venció hace ${n} días` };
    }
    if (due === today) return { cls: "today", text: "Hoy" };
    if (due === addDays(today, 1)) return { cls: "", text: "Mañana" };
    return { cls: "", text: shortDate(due) };
  }

  function dueGroupLabel(due, today) {
    if (due === today) return "Hoy";
    if (due === addDays(today, 1)) return "Mañana";
    const w = parseDay(due).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  function groupByDue(items, today) {
    const groups = [];
    for (const t of items) {
      const key = t.due_date || "";
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: key ? dueGroupLabel(key, today) : "Sin fecha", items: [] };
        groups.push(g);
      }
      g.items.push(t);
    }
    return groups;
  }

  function addInterval(dateStr, kind) {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (kind === "daily") return addDays(dateStr, 1);
    if (kind === "weekly") return addDays(dateStr, 7);
    // Mensual: mismo día del mes siguiente, o el último si no existe (31 ene → 28/29 feb)
    const mk = addMonths(`${String(y).padStart(4, "0")}-${pad(m)}`, 1);
    return `${mk}-${pad(Math.min(d, monthBounds(mk).days))}`;
  }

  // Siguiente vencimiento de una tarea periódica: siempre posterior a hoy
  function nextOccurrence(due, kind, today) {
    let next = addInterval(due || today, kind);
    let guard = 0;
    while (next <= today && guard++ < 5000) next = addInterval(next, kind);
    return next;
  }

  function normalizeTags(text) {
    return [
      ...new Set(
        String(text || "")
          .split(",")
          .map((s) => s.trim().toLowerCase().replace(/^#+/, ""))
          .filter(Boolean)
          .map((s) => s.slice(0, 30))
      ),
    ];
  }

  /* ================= Texto ================= */

  const wordCount = (s) => (String(s || "").match(/\S+/g) || []).length;

  /* ================= CSV ================= */

  // Texto: se entrecomilla y se neutralizan las fórmulas (=, +, -, @) que Excel ejecutaría
  function csvText(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildTransactionsCsv(txs) {
    const rows = [["Fecha", "Tipo", "Concepto", "Categoría", "Importe (EUR)", "Importe con signo (EUR)"]];
    const sorted = [...txs].sort((a, b) => cmpStr(a.tx_date, b.tx_date) || cmpStr(a.created_at || "", b.created_at || ""));
    for (const t of sorted) {
      const c = centsFromDb(t.amount);
      const plain = centsToPlain(c);
      rows.push([t.tx_date, t.type === "income" ? "Ingreso" : "Gasto", t.title, t.category, plain, t.type === "income" ? plain : "-" + plain]);
    }
    const body = rows
      .map((r, i) => r.map((v, j) => (i === 0 ? '"' + v + '"' : j >= 4 ? '"' + v + '"' : csvText(v))).join(";"))
      .join("\r\n");
    return "﻿" + body + "\r\n";
  }

  /* ================= Copia JSON ================= */

  const stripUser = (row) => {
    const { user_id, ...rest } = row;
    return rest;
  };

  function buildBackup({ state, prefs, now = new Date() }) {
    return {
      app: "Mi Panel",
      version: 5,
      exportedAt: now.toISOString(),
      note: "Copia de seguridad de lectura. Para restaurar datos de Cloudspace usa Preferencias > Importar.",
      prefs: prefs || {},
      data: {
        tasks: state.tasks.map(stripUser),
        projects: state.lists.map(stripUser),
        steps: state.steps.map(stripUser),
        habits: state.habits.map(stripUser),
        habitLogs: state.logs.map(stripUser),
        journal: state.journal.map(stripUser),
        transactions: state.transactions.map((t) => ({ ...stripUser(t), amount: Number(centsToDb(centsFromDb(t.amount))) })),
        budgets: state.budgets.map((b) => ({ ...stripUser(b), amount: Number(centsToDb(centsFromDb(b.amount))) })),
        savingsGoals: state.goals.map((g) => ({
          ...stripUser(g),
          target: Number(centsToDb(centsFromDb(g.target))),
          current: Number(centsToDb(centsFromDb(g.current))),
        })),
        routines: state.routines.map(stripUser),
        routineSteps: state.routineSteps.map(stripUser),
        timerSessions: state.sessions.map(stripUser),
      },
    };
  }

  /* ================= Importar datos de Cloudspace ================= */

  // Lee las claves cloud-* de un almacenamiento (por si la referencia se abrió en este mismo sitio)
  function legacyFromStorage(getItem) {
    const json = (k) => {
      try {
        const v = getItem("cloud-" + k);
        return v == null ? undefined : JSON.parse(v);
      } catch (_) {
        return undefined;
      }
    };
    const raw = (k) => {
      try {
        return getItem("cloud-" + k) || "";
      } catch (_) {
        return "";
      }
    };
    const out = {
      app: "Cloudspace",
      tasks: json("tasks"),
      habits: json("habits"),
      transactions: json("transactions"),
      monthlyBudget: json("monthly-budget"),
      savingsGoal: json("savings-goal"),
      quickNote: raw("quick-note"),
      fullNote: raw("full-note"),
    };
    const has = out.tasks || out.habits || out.transactions || out.monthlyBudget || out.savingsGoal || out.quickNote || out.fullNote;
    return has ? out : null;
  }

  const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n);

  function parseCloudspaceBackup(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("El archivo no es una copia válida.");
    if (obj.app === "Mi Panel") {
      throw new Error("Esto es una copia de Mi Panel: sirve como respaldo, pero no se importa. Importa una copia de Cloudspace.");
    }
    if (!("tasks" in obj || "habits" in obj || "transactions" in obj || "savingsGoal" in obj || "quickNote" in obj)) {
      throw new Error("No se reconoce el formato. Se espera una copia JSON de Cloudspace.");
    }
    const warnings = [];
    const arr = (v) => (Array.isArray(v) ? v : []);
    let bad = 0;

    const tasks = [];
    for (const t of arr(obj.tasks)) {
      const title = clip(t && t.title, 200);
      if (!title) { bad++; continue; }
      const prio = Math.min(4, Math.max(1, Math.round(Number(t.priority)) || 4));
      const label = clip(t.label, 30).toLowerCase().replace(/^#+/, "");
      tasks.push({
        title,
        done: !!t.done,
        prio,
        due_date: isDayKey(t.due) ? t.due : null,
        project: clip(t.project, 60),
        tags: label ? [label] : [],
        created: isDayKey(t.created) ? t.created : null,
      });
    }

    const habits = [];
    for (const h of arr(obj.habits)) {
      const name = clip(h && h.name, 80);
      if (!name) { bad++; continue; }
      const days = Object.entries(h.history && typeof h.history === "object" ? h.history : {})
        .filter(([k, v]) => v && isDayKey(k))
        .map(([k]) => k)
        .sort();
      if (!h.history && Array.isArray(h.days) && h.days.some(Boolean)) {
        warnings.push(`El hábito «${name}» usa el formato semanal antiguo; solo se importa el hábito, sin marcas.`);
      }
      habits.push({ name, emoji: clip(h.emoji, 8) || "🌱", hint: clip(h.hint, 120) === "Hábito personal" ? "" : clip(h.hint, 120), days });
    }

    const transactions = [];
    for (const t of arr(obj.transactions)) {
      const type = t && t.type === "income" ? "income" : t && t.type === "expense" ? "expense" : null;
      const amt = parseCents(typeof t.amount === "number" ? String(t.amount) : t.amount);
      const title = clip(t && t.title, 120);
      if (!type || !amt.ok || !title || !isDayKey(t.date)) { bad++; continue; }
      transactions.push({ type, cents: amt.cents, title, category: clip(t.category, 40) || "Otros", tx_date: t.date });
    }

    const b = parseCents(obj.monthlyBudget, { allowZero: true });
    const budget = b.ok && b.cents > 0 ? b.cents : null;

    let goal = null;
    const g = obj.savingsGoal;
    if (g && typeof g === "object") {
      const target = parseCents(g.target, { allowZero: true });
      const current = parseCents(g.current == null ? 0 : g.current, { allowZero: true });
      if (target.ok && target.cents > 0 && current.ok) goal = { name: clip(g.name, 60) || "Objetivo", target: target.cents, current: current.cents };
    }

    if (bad) warnings.push(`${bad} elemento(s) con datos no válidos se han omitido.`);
    return { tasks, habits, transactions, budget, goal, quick: String(obj.quickNote || ""), full: String(obj.fullNote || ""), warnings };
  }

  // Decide qué hay que crear, sin duplicar lo que ya existe (importar dos veces no repite nada)
  function planImport(norm, existing, today) {
    const lower = (s) => String(s || "").trim().toLowerCase();
    const counter = (keys) => {
      const m = new Map();
      for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
      return m;
    };
    const consume = (m, k) => {
      const n = m.get(k) || 0;
      if (n > 0) { m.set(k, n - 1); return true; }
      return false;
    };
    const skipped = { tasks: 0, habits: 0, transactions: 0, habitDays: 0 };

    const listNames = new Map(existing.lists.map((l) => [lower(l.name), l.name]));
    const newLists = [];
    const taskKeys = counter(existing.tasks.map((t) => `${lower(t.title)}|${t.due_date || ""}`));
    const tasks = [];
    for (const t of norm.tasks) {
      if (consume(taskKeys, `${lower(t.title)}|${t.due_date || ""}`)) { skipped.tasks++; continue; }
      let project = null;
      if (t.project) {
        project = listNames.get(lower(t.project)) || null;
        if (!project) {
          project = t.project;
          listNames.set(lower(project), project);
          newLists.push(project);
        }
      }
      tasks.push({ ...t, project });
    }

    const habitByName = new Map(existing.habits.map((h) => [lower(h.name), h]));
    const loggedDays = new Map();
    for (const l of existing.logs) {
      if (!loggedDays.has(l.habit_id)) loggedDays.set(l.habit_id, new Set());
      loggedDays.get(l.habit_id).add(l.day);
    }
    const habits = [];
    for (const h of norm.habits) {
      const ex = habitByName.get(lower(h.name));
      const have = ex ? loggedDays.get(ex.id) || new Set() : new Set();
      const days = h.days.filter((d) => !have.has(d));
      skipped.habitDays += h.days.length - days.length;
      if (ex && !days.length) { skipped.habits++; continue; }
      habits.push({ name: h.name, emoji: h.emoji, hint: h.hint, existingId: ex ? ex.id : null, days });
    }

    const txKeys = counter(
      existing.transactions.map((t) => `${t.tx_date}|${t.type}|${centsFromDb(t.amount)}|${lower(t.title)}|${lower(t.category)}`)
    );
    const transactions = [];
    for (const t of norm.transactions) {
      if (consume(txKeys, `${t.tx_date}|${t.type}|${t.cents}|${lower(t.title)}|${lower(t.category)}`)) { skipped.transactions++; continue; }
      transactions.push(t);
    }

    const hasTotal = existing.budgets.some((b) => b.category === "");
    const budget = norm.budget && !hasTotal ? norm.budget : null;
    const goal = norm.goal && !existing.goals.some((g) => lower(g.name) === lower(norm.goal.name)) ? norm.goal : null;

    const journal = [];
    const has = (kind) => existing.journal.some((j) => j.kind === kind && j.entry_date === today && j.body);
    if (norm.quick.trim() && !has("quick")) journal.push({ kind: "quick", entry_date: today, body: norm.quick });
    if (norm.full.trim() && !has("entry")) journal.push({ kind: "entry", entry_date: today, body: norm.full });

    return { newLists, tasks, habits, transactions, budget, goal, journal, skipped, warnings: norm.warnings };
  }

  /* ================= Acceso (validación y mensajes) ================= */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MIN_PASSWORD = 8;

  // mode: login | signup | forgot | recovery  →  { field: mensaje } (vacío = válido)
  function validateAuth({ mode, email = "", password = "", confirm = "" }) {
    const errors = {};
    if (mode !== "recovery" && !EMAIL_RE.test(String(email).trim())) errors.email = "Introduce un correo electrónico válido.";
    if (mode === "login" && !password) errors.password = "Escribe tu contraseña.";
    if (mode === "signup" || mode === "recovery") {
      if (password.length < MIN_PASSWORD) errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
      else if (confirm !== password) errors.confirm = "Las contraseñas no coinciden.";
    }
    return errors;
  }

  function authErrorText(err) {
    const m = String((err && err.message) || err || "").toLowerCase();
    const code = err && (err.code || err.error_code);
    const status = err && err.status;
    if (code === "invalid_credentials" || m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
    if (code === "email_not_confirmed" || m.includes("email not confirmed")) return "Aún no has confirmado tu correo. Revisa tu bandeja de entrada (y el spam).";
    if (code === "user_already_exists" || m.includes("already registered")) return "Ya existe una cuenta con ese correo. Prueba a iniciar sesión.";
    if (code === "weak_password" || m.includes("password should be")) return `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD} caracteres.`;
    if (code === "same_password" || m.includes("different from the old")) return "La nueva contraseña debe ser distinta de la anterior.";
    if (code === "signup_disabled" || m.includes("signups not allowed")) return "El registro está desactivado en este proyecto.";
    if (status === 429 || (code && String(code).includes("rate_limit")) || m.includes("rate limit")) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
    if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "El acceso con Google aún no está activado en Supabase.";
    if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed") || m.includes("load failed"))
      return "No hay conexión con el servidor. Comprueba tu internet.";
    return "No se pudo completar la operación" + (err && err.message ? `: ${err.message}` : ".");
  }

  // Errores de datos (no de acceso) con un texto útil para el usuario
  function dataErrorText(err) {
    const m = String((err && err.message) || err || "").toLowerCase();
    const code = err && err.code;
    if (code === "42501" || m.includes("row-level security")) return "Esta cuenta no tiene permiso para guardar datos. Revisa que single-user.sql use tu correo.";
    if (code === "PGRST205" || code === "42P01" || m.includes("could not find the table") || m.includes("does not exist"))
      return "Faltan tablas en Supabase: ejecuta migracion-v3.sql y recarga.";
    if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) return "Sin conexión: el cambio no se ha guardado.";
    return "No se pudo guardar" + (err && err.message ? `: ${err.message}` : ".");
  }

  return {
    pad, dayKey, todayKey, isDayKey, parseDay, addDays, dayDiff, lastDayKeys, weekdayIndex, weekStart, weekKeys,
    monthKey, addMonths, monthBounds, monthLabel, shortDate, longDate, dayOfTimestamp,
    MAX_CENTS, parseCents, centsFromDb, centsToDb, centsToPlain, formatEUR,
    EXPENSE_CATEGORIES, INCOME_CATEGORIES, monthTotals, monthSeries, budgetStatus, goalPct,
    logsByHabit, currentStreak, longestStreak, completionRate, heatLevel, heatCells, activeDays,
    PRIO_LABELS, prioOf, isOpen, isOverdue, inView, sortTasks, filterTasks, viewCounts, dueInfo, groupByDue,
    addInterval, nextOccurrence, normalizeTags, wordCount,
    csvText, buildTransactionsCsv, buildBackup, legacyFromStorage, parseCloudspaceBackup, planImport,
    EMAIL_RE, MIN_PASSWORD, validateAuth, authErrorText, dataErrorText,
  };
});
