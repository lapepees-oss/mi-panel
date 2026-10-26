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
  // Cumplimiento de los últimos n días. Con isDue(key) solo cuentan los días programados (más los cumplidos fuera
  // de calendario); sin él, todos los días (comportamiento anterior).
  function completionRate(days, today, n = 30, createdDay = null, isDue = null) {
    let window = n;
    if (createdDay) window = Math.max(1, Math.min(n, dayDiff(today, createdDay) + 1));
    let done = 0, total = 0;
    for (let i = 0; i < window; i++) {
      const key = addDays(today, -i), did = days.has(key);
      if (did) done++;
      if (!isDue || did || isDue(key)) total++;
    }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function heatLevel(count, total) {
    if (!count) return 0;
    return Math.min(4, Math.max(1, Math.ceil((count / Math.max(total, count, 1)) * 4)));
  }

  // Primer día en que un hábito "existe" para las estadísticas: su creación o, si hay registros anteriores
  // (hábitos importados, de ejemplo o rellenados a posteriori), el primero de ellos. Sin esto, un hábito creado hoy
  // con registros pasados no contaría en el total de esos días y una sola marca parecería "todos cumplidos".
  function habitStartDay(h, days) {
    const created = dayOfTimestamp(h.created_at);
    const first = days && days.size ? [...days].filter(isDayKey).sort()[0] : null;
    if (created && first) return first < created ? first : created;
    return created || first || null;
  }

  // Un cuadro por día. "total" = hábitos que ya existían ese día Y le tocaban (o que se cumplieron igualmente);
  // un día en el que no tocaba ninguno sale como off = true (no es un incumplimiento). Los hábitos Semanales
  // no tienen día fijo: cuentan cada día desde que existen, como antes.
  function heatCells(habits, byHabit, today, n = 35) {
    const starts = new Map(habits.map((h) => [h.id, habitStartDay(h, byHabit.get(h.id))]));
    const freqs = new Map(habits.map((h) => [h.id, habitFrequency(h)]));
    return lastDayKeys(n, today).map((key) => {
      let count = 0, total = 0;
      for (const h of habits) {
        const start = starts.get(h.id);
        const did = !!byHabit.get(h.id)?.has(key);
        if (did) count++;
        if ((!start || start <= key) && (did || habitDueOn(freqs.get(h.id), key))) total++;
      }
      return { key, count, total, level: heatLevel(count, total), off: habits.length > 0 && total === 0 };
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

  /* ================= Fase del cronómetro (misma lógica en el navegador y en la función de avisos) ================= */

  // steps: [{ seconds, label, kind }]; cycles: 0 = sin fin. ms = tiempo transcurrido desde el inicio de la rutina.
  function timerPhase(steps, cycles, ms) {
    const cycleMs = steps.reduce((a, s) => a + s.seconds * 1000, 0);
    if (!steps.length || cycleMs <= 0) return { finished: true, total: 0 };
    if (cycles > 0 && ms >= cycles * cycleMs) return { finished: true, total: cycles * cycleMs };
    const cycle = Math.floor(ms / cycleMs);
    let within = ms - cycle * cycleMs;
    for (let i = 0; i < steps.length; i++) {
      const dur = steps[i].seconds * 1000;
      if (within < dur) return { finished: false, cycle, idx: i, step: steps[i], dur, remaining: dur - within };
      within -= dur;
    }
    return { finished: true, total: cycles * cycleMs };
  }

  // Texto del tiempo para las notificaciones: 12:34 o 1:02:03
  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
    return (hh ? hh + ":" + pad(mm) : String(mm)) + ":" + pad(ss);
  }


  /* ================= Sesiones del cronómetro ================= */

  const SESSION_KINDS = { stopwatch: "Cronómetro libre", timer: "Temporizador", pomodoro: "Pomodoro", routine: "Rutina" };
  // Las sesiones antiguas no tienen tipo: se muestran como "Sesión" sin inventar nada
  const sessionKindLabel = (kind) => SESSION_KINDS[kind] || "Sesión";

  // 1h 25min · 50min · 45s
  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
    if (hh) return mm ? `${hh}h ${mm}min` : `${hh}h`;
    if (mm) return `${mm}min`;
    return `${ss}s`;
  }

  // Estadísticas a partir de sesiones reales. Las sesiones llevan created_at (ISO); el día es el local.
  function sessionStats(sessions, today) {
    const yesterday = addDays(today, -1);
    const last7 = lastDayKeys(7, today);
    const perDay = Object.fromEntries(last7.map((k) => [k, 0]));
    let todayMs = 0, yesterdayMs = 0, todayCount = 0, yesterdayCount = 0;
    for (const s of sessions) {
      const day = dayOfTimestamp(s.created_at);
      if (!day) continue;
      const ms = Number(s.duration_ms) || 0;
      if (day === today) { todayMs += ms; todayCount++; }
      else if (day === yesterday) { yesterdayMs += ms; yesterdayCount++; }
      if (day in perDay) perDay[day] += ms;
    }
    return {
      todayMs, yesterdayMs, todayCount, yesterdayCount,
      days7: last7.map((k) => ({ key: k, ms: perDay[k] })),
      activeDays7: last7.filter((k) => perDay[k] > 0).length,
    };
  }

  // Variación porcentual respecto a una base; null si no hay base con la que comparar
  const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

  // Duración de una cuenta atrás en ms a partir de horas/minutos/segundos (máx. 24 h)
  function countdownMs(hh, mm, ss) {
    const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
    return Math.min(24 * 3600, n(hh) * 3600 + n(mm) * 60 + n(ss)) * 1000;
  }
  const splitHms = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
  };

  /* ================= Hábitos: categorías, frecuencia y progreso semanal ================= */

  const HABIT_CATEGORIES = ["Salud", "Aprendizaje", "Bienestar", "Productividad", "Personal"];
  // Frecuencia de un hábito = texto guardado en habits.frequency (sin columnas nuevas, compatible con los hábitos antiguos):
  //   "Diario" · "Entre semana" (L-V) · "Fines de semana" (S-D) · "Semanal" (1 vez a la semana, cualquier día)
  //   · "Personalizada:0,2,4" → días concretos, 0 = lunes … 6 = domingo.
  // Un valor desconocido, vacío o "Personalizada" sin días se trata como "Diario" (así ningún hábito antiguo se rompe).
  const HABIT_FREQUENCIES = ["Diario", "Entre semana", "Fines de semana", "Semanal", "Personalizada"];
  const WEEKDAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const WEEKDAY_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const FREQ_LABELS = { Diario: "Todos los días", "Entre semana": "Días laborables", "Fines de semana": "Fines de semana", Semanal: "Una vez por semana", Personalizada: "Días personalizados" };
  const cleanDays = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  // Texto que se guarda para un tipo de frecuencia (y, si es personalizada, sus días). Todos los días marcados = "Diario".
  function freqToken(kind, days) {
    if (kind !== "Personalizada") return HABIT_FREQUENCIES.includes(kind) ? kind : "Diario";
    const d = cleanDays(days);
    return d.length === 0 || d.length === 7 ? "Diario" : "Personalizada:" + d.join(",");
  }
  // Inverso: {kind, days} de un texto guardado (days solo en Personalizada)
  function parseFreq(freq) {
    const s = String(freq || "");
    if (s.startsWith("Personalizada:")) {
      const d = cleanDays(s.slice(14).split(","));
      return d.length && d.length < 7 ? { kind: "Personalizada", days: d } : { kind: "Diario", days: [] };
    }
    return { kind: ["Entre semana", "Fines de semana", "Semanal"].includes(s) ? s : "Diario", days: [] };
  }
  const HABIT_COLORS = ["#8064ff", "#4f80ff", "#21b7ce", "#35c99a", "#ffad54", "#ff607e"];
  const HABIT_COLOR_NAMES = { "#8064ff": "Morado", "#4f80ff": "Azul", "#21b7ce": "Cian", "#35c99a": "Verde", "#ffad54": "Naranja", "#ff607e": "Rosa" };
  const HABIT_ICONS = { Salud: "🏋️", Aprendizaje: "📖", Bienestar: "🍃", Productividad: "✅", Personal: "✦" };
  const habitCategory = (h) => (HABIT_CATEGORIES.includes(h.category) ? h.category : "Personal");
  // Frecuencia normalizada del hábito (texto estándar); el resto del código la pasa tal cual a habitDueOn, habitStreak…
  const habitFrequency = (h) => { const p = parseFreq(h && h.frequency); return p.kind === "Personalizada" ? freqToken("Personalizada", p.days) : p.kind; };
  // Texto legible: «Todos los días», «Días laborables», «Lun · Mié · Vie»…
  function freqLabel(freq) {
    const p = parseFreq(freq);
    return p.kind === "Personalizada" ? p.days.map((i) => WEEKDAY_SHORT[i]).join(" · ") : FREQ_LABELS[p.kind];
  }
  const habitColor = (h) => (/^#[0-9a-f]{6}$/i.test(h.color || "") ? h.color : HABIT_COLORS[0]);

  // ¿Toca este hábito ese día? ÚNICA definición de "día programado": rachas, contadores, semana y mapa la usan.
  // (Semanal toca "cualquier día": se cumple con una marca en la semana.) Usa la fecha local del día (YYYY-MM-DD).
  function habitDueOn(freq, key) {
    const p = parseFreq(freq), wd = weekdayIndex(key);
    if (p.kind === "Entre semana") return wd <= 4;
    if (p.kind === "Fines de semana") return wd >= 5;
    if (p.kind === "Personalizada") return p.days.includes(wd);
    return true;
  }
  // Marcas necesarias para cumplir una semana completa = nº de días programados por semana
  function habitWeekTarget(freq) {
    const p = parseFreq(freq);
    return p.kind === "Entre semana" ? 5 : p.kind === "Fines de semana" ? 2 : p.kind === "Semanal" ? 1 : p.kind === "Personalizada" ? p.days.length : 7;
  }

  // done = cumplido hoy (o, en Semanal, ya cumplido esta semana); off = hoy no toca; pending = falta
  function habitStatusToday(freq, days, today) {
    if (days.has(today)) return "done";
    if (freq === "Semanal" && weekKeys(weekStart(today)).some((k) => days.has(k))) return "done";
    if (!habitDueOn(freq, today)) return "off";
    return "pending";
  }

  // Racha actual: cuenta hacia atrás sin romperse por días que no tocan; hoy sin marcar no la rompe
  function habitStreak(freq, days, today) {
    if (freq === "Semanal") {
      let wk = weekStart(today);
      if (!weekKeys(wk).some((k) => days.has(k))) wk = addDays(wk, -7);
      let n = 0;
      while (weekKeys(wk).some((k) => days.has(k))) { n++; wk = addDays(wk, -7); }
      return n;
    }
    let cursor = days.has(today) ? today : addDays(today, -1);
    let n = 0;
    for (let guard = 0; guard < 4000; guard++) {
      if (days.has(cursor)) n++;
      else if (!habitDueOn(freq, cursor)) { /* día que no toca: no rompe */ }
      else break;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  function habitBestStreak(freq, days) {
    const sorted = [...days].filter(isDayKey).sort();
    if (!sorted.length) return 0;
    if (freq === "Semanal") {
      const weeks = [...new Set(sorted.map(weekStart))].sort();
      let best = 0, run = 0, prev = null;
      for (const w of weeks) { run = prev && dayDiff(w, prev) === 7 ? run + 1 : 1; best = Math.max(best, run); prev = w; }
      return best;
    }
    let best = 0, run = 0;
    for (let k = sorted[0]; k <= sorted[sorted.length - 1]; k = addDays(k, 1)) {
      if (days.has(k)) { run++; best = Math.max(best, run); }
      else if (!habitDueOn(freq, k)) { /* no rompe */ }
      else run = 0;
    }
    return best;
  }

  // Progreso de una semana (lunes a domingo) de UN hábito: marcas hechas / marcas necesarias
  function habitWeekProgress(freq, days, weekStartKey) {
    const target = habitWeekTarget(freq);
    // En Semanal vale cualquier día; en las demás frecuencias solo cuentan las marcas de días programados (una marca en un día libre no tapa un día fallado)
    const done = weekKeys(weekStartKey).filter((k) => days.has(k) && (freq === "Semanal" || habitDueOn(freq, k))).length;
    return { done: Math.min(done, target), target };
  }

  // Resumen de la semana de TODOS los hábitos con una única definición: cada hábito tiene "huecos" (los días que
  // le tocan desde que existe; en Semanal, uno por semana). Hechos / no hechos (ya pasados) / pendientes (hoy o futuros).
  function weekSummary(habits, byHabit, today) {
    const ws = weekStart(today);
    const keys = weekKeys(ws);
    let done = 0, missed = 0, pending = 0;
    for (const h of habits) {
      const freq = habitFrequency(h);
      const days = byHabit.get(h.id) || new Set();
      const created = dayOfTimestamp(h.created_at);
      const live = keys.filter((k) => !created || k >= created || days.has(k));
      if (freq === "Semanal") {
        if (!live.length) continue;
        if (live.some((k) => days.has(k))) done++;
        else if (today > keys[6]) missed++;
        else pending++;
        continue;
      }
      for (const k of live) {
        const did = days.has(k);
        if (!habitDueOn(freq, k) && !did) continue;
        if (k > today && !did) continue; // los días que aún no han llegado no cuentan
        if (did) done++;
        else if (k < today) missed++;
        else pending++;
      }
    }
    const total = done + missed + pending;
    return { done, missed, pending, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  // Filas del mapa de constancia: una por hábito. done / miss / na (aún no existía o no tocaba ese día)
  function habitHeatRows(habits, byHabit, today, n = 35) {
    const keys = lastDayKeys(n, today);
    return habits.map((h) => {
      const freq = habitFrequency(h);
      const days = byHabit.get(h.id) || new Set();
      const created = habitStartDay(h, days);
      return {
        habit: h,
        cells: keys.map((key) => ({
          key,
          // done = cumplido · na = aún no existía · off = no estaba programado ese día (no es un fallo) · miss = programado y sin cumplir
          state: days.has(key) ? "done" : created && key < created ? "na" : !habitDueOn(freq, key) ? "off" : "miss",
        })),
      };
    });
  }

  /* ================= Suscripciones ================= */

  const SUB_CYCLES = { weekly: "Semanal", monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual" };
  const SUB_STATUS = { active: "Activa", paused: "Pausada", cancelled: "Cancelada" };
  const subCycle = (s) => (SUB_CYCLES[s && s.cycle] ? s.cycle : "monthly");
  const subStatus = (s) => (SUB_STATUS[s && s.status] ? s.status : "active");

  // Equivalente mensual / anual en céntimos (semanal = 52 pagos al año; trimestral = 4; anual = 1)
  function subYearlyCents(s) {
    const c = centsFromDb(s.amount);
    return { weekly: c * 52, monthly: c * 12, quarterly: c * 4, yearly: c }[subCycle(s)];
  }
  const subMonthlyCents = (s) => Math.round(subYearlyCents(s) / 12);

  // Suma `n` meses a una fecha conservando el día; si el mes no llega (31 → febrero), usa el último día
  function addMonthsToDay(key, n) {
    const d = Number(key.slice(8)), mk = addMonths(key.slice(0, 7), n);
    return `${mk}-${pad(Math.min(d, monthBounds(mk).days))}`;
  }
  function addCycle(key, cycle, anchorDay) {
    if (cycle === "weekly") return addDays(key, 7);
    const months = cycle === "yearly" ? 12 : cycle === "quarterly" ? 3 : 1;
    const day = anchorDay || Number(key.slice(8)); // el día original se conserva (31 → 28 → 31…)
    const mk = addMonths(key.slice(0, 7), months);
    return `${mk}-${pad(Math.min(day, monthBounds(mk).days))}`;
  }

  // Próximo cobro desde `today`: si la fecha guardada ya pasó, se avanza ciclo a ciclo. Sin fecha → null. Solo tiene sentido para activas.
  function nextCharge(s, today) {
    if (subStatus(s) !== "active" || !isDayKey(s.next_charge)) return null;
    const cyc = subCycle(s), anchor = Number(s.next_charge.slice(8));
    let k = s.next_charge;
    for (let i = 0; k < today && i < 2000; i++) k = addCycle(k, cyc, anchor);
    return k;
  }

  function subSummary(subs, today) {
    const out = { active: 0, paused: 0, cancelled: 0, monthly: 0, yearly: 0, freedMonthly: 0, upcoming: [], byCategory: {} };
    for (const s of subs) {
      const st = subStatus(s);
      out[st]++;
      if (st === "active") {
        out.monthly += subMonthlyCents(s);
        out.yearly += subYearlyCents(s);
        const cat = s.category || "Suscripciones";
        out.byCategory[cat] = (out.byCategory[cat] || 0) + subMonthlyCents(s);
        const next = nextCharge(s, today);
        if (next) out.upcoming.push({ sub: s, date: next, days: dayDiff(next, today), cents: centsFromDb(s.amount) });
      } else if (st === "cancelled") out.freedMonthly += subMonthlyCents(s);
    }
    out.upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }

  /* ================= Resumen personalizable ================= */

  const DASH_WIDGETS = ["metrics", "timer", "tasks", "heat", "week", "activity", "finance", "quote", "note"];

  // Normaliza el diseño guardado: ignora ids desconocidos o repetidos y añade al final los que falten (p. ej. bloques nuevos)
  function dashLayout(saved, ids = DASH_WIDGETS) {
    const order = [], seen = new Set();
    const src = saved && Array.isArray(saved.order) ? saved.order : [];
    for (const id of src) if (ids.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
    for (const id of ids) if (!seen.has(id)) order.push(id);
    const hidden = (saved && Array.isArray(saved.hidden) ? saved.hidden : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
    return { order, hidden };
  }

  // Mueve un bloque una posición (dir = -1 sube, +1 baja). Devuelve una lista nueva; en los extremos no cambia nada.
  function moveWidget(order, id, dir) {
    const i = order.indexOf(id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= order.length) return order.slice();
    const out = order.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  /* ================= Calendario mensual (diario) ================= */

  // Semanas (lunes primero) de un mes: cada celda es una clave de día o null
  function monthGrid(mk) {
    const { first, days } = monthBounds(mk);
    const lead = weekdayIndex(first);
    const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${mk}-${pad(i + 1)}`)];
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  }

  /* ---------- Frase del día (Resumen) ----------
   * Selección determinista a partir de la fecha: misma frase en todos los dispositivos, al recargar y al volver a iniciar
   * sesión el mismo día, sin guardar nada. Los días se reparten en "ciclos" del tamaño de la colección; cada ciclo es una
   * mezcla (con semilla) de TODAS las frases, así no se repite ninguna hasta agotarlas. Entre un ciclo y el siguiente se
   * evita que las primeras frases coincidan con las últimas del ciclo anterior (no se repite nada de la última semana). */
  const PHRASE_STYLES = ["mixto", "filosofico", "motivacional", "reflexivo"];
  const PHRASE_LENGTHS = ["corta", "larga", "ninguna"];
  const PHRASE_DEFAULTS = { show: true, style: "mixto", length: "corta", date: true, accent: true };

  // Normaliza lo guardado en el navegador: valores desconocidos vuelven al predeterminado
  function phrasePrefs(saved) {
    const s = saved && typeof saved === "object" ? saved : {};
    return {
      show: s.show !== false,
      style: PHRASE_STYLES.includes(s.style) ? s.style : PHRASE_DEFAULTS.style,
      length: PHRASE_LENGTHS.includes(s.length) ? s.length : PHRASE_DEFAULTS.length,
      date: s.date !== false,
      accent: s.accent !== false,
    };
  }

  // Generador pseudoaleatorio con semilla (mulberry32): mismo resultado siempre para la misma semilla
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const phraseOrderCache = new Map();
  // Orden de los índices 0..size-1 en el ciclo c (memoizado). Parte de una mezcla con semilla y recoloca al final
  // cualquier índice de las primeras posiciones que coincida con las últimas `avoid` del ciclo anterior.
  function phraseCycle(c, size, avoid) {
    const memo = `${size}:${avoid}`;
    let list = phraseOrderCache.get(memo);
    if (!list) phraseOrderCache.set(memo, (list = []));
    while (list.length <= c) {
      const n = list.length, rnd = seededRandom(n * 2654435761 + size * 97 + 12345);
      const ord = Array.from({ length: size }, (_, i) => i);
      for (let i = size - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
      if (n > 0) {
        const recent = new Set(list[n - 1].slice(size - avoid));
        // las primeras `avoid` posiciones se llenan con frases que NO estén entre las recientes; el resto conserva el orden de la mezcla
        const head = ord.filter((i) => !recent.has(i)).slice(0, avoid), used = new Set(head);
        const rest = ord.filter((i) => !used.has(i));
        ord.length = 0;
        ord.push(...head, ...rest);
      }
      list.push(ord);
    }
    return list[c];
  }

  // pool = lista de frases ya filtrada por estilo. Devuelve la frase de ese día (o null si la lista está vacía).
  function phraseOfDay(key, pool, avoid = 7) {
    if (!pool || !pool.length) return null;
    const size = pool.length, a = Math.min(avoid, Math.floor(size / 2));
    const n = Math.floor(Date.UTC(...key.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) / 86400000);
    const idx = ((n % size) + size) % size, cycle = Math.max(0, Math.floor(n / size));
    return pool[phraseCycle(cycle, size, a)[idx]];
  }

  const greeting = (hour) => (hour < 6 ? "Buenas noches" : hour < 13 ? "Buenos días" : hour < 21 ? "Buenas tardes" : "Buenas noches");

  // Cuántas tareas abiertas lleva cada etiqueta
  function tagCounts(tasks) {
    const c = {};
    for (const t of tasks) if (isOpen(t)) for (const g of t.tags || []) c[g] = (c[g] || 0) + 1;
    return c;
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
    SESSION_KINDS, sessionKindLabel, formatDuration, sessionStats, pctChange, countdownMs, splitHms,
    SUB_CYCLES, SUB_STATUS, subCycle, subStatus, subYearlyCents, subMonthlyCents, addMonthsToDay, addCycle, nextCharge, subSummary,
    DASH_WIDGETS, dashLayout, moveWidget, habitStartDay, HABIT_CATEGORIES, HABIT_FREQUENCIES, WEEKDAY_SHORT, WEEKDAY_FULL, FREQ_LABELS, freqToken, parseFreq, freqLabel, HABIT_COLORS, HABIT_COLOR_NAMES, HABIT_ICONS, habitCategory, habitFrequency, habitColor,
    habitDueOn, habitWeekTarget, habitStatusToday, habitStreak, habitBestStreak, habitWeekProgress, weekSummary, habitHeatRows,
    monthGrid, greeting, tagCounts, PHRASE_STYLES, PHRASE_LENGTHS, PHRASE_DEFAULTS, phrasePrefs, phraseOfDay,
    timerPhase, clock, csvText, buildTransactionsCsv, buildBackup, legacyFromStorage, parseCloudspaceBackup, planImport,
    EMAIL_RE, MIN_PASSWORD, validateAuth, authErrorText, dataErrorText,
  };
});
