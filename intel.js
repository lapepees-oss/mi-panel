"use strict";
// Motor de reglas de CloudSpace Intelligence. Lógica pura: sin DOM, sin red y SIN ningún modelo de IA.
// Recibe los datos reales de la app y devuelve observaciones con su evidencia; nunca inventa motivos ni importes.
// Cada tarjeta indica su nivel de certeza: confirmed (dato), pattern (patrón probable) o estimate (estimación).
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./logic.js") : root.Logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Intel = api;
})(typeof self !== "undefined" ? self : this, function (L) {
  const eur = (c) => L.formatEUR(c);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const CATEGORY_LABEL = { tareas: "Tareas", habitos: "Hábitos", finanzas: "Finanzas", cruzado: "Visión conjunta", objetivos: "Objetivos", otros: "Otros" };
  const CATEGORY_ORDER = { tareas: 0, habitos: 1, finanzas: 2, cruzado: 3, objetivos: 3, otros: 4 };
  const KIND_LABEL = { confirmed: "Dato confirmado", pattern: "Patrón probable", estimate: "Estimación" };

  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const words = (s) => norm(s).split(/[^a-záéíóúñü0-9]+/).filter((w) => w.length >= 4);

  /* ================= Hábitos ================= */

  function habitCards(d) {
    const { today, habits, byHabit } = d;
    const cards = [];
    for (const hb of habits) {
      const freq = L.habitFrequency(hb);
      const days = byHabit.get(hb.id) || new Set();
      const created = L.dayOfTimestamp(hb.created_at) || today;
      const age = L.dayDiff(today, created);
      const last = [...days].filter(L.isDayKey).sort().pop() || null;
      let missedDue = 0;
      for (let k = L.addDays(last || L.addDays(created, -1), 1); k <= today; k = L.addDays(k, 1)) if (L.habitDueOn(freq, k)) missedDue++;
      const stalled = freq === "Semanal" ? (last ? L.dayDiff(today, last) >= 10 : age >= 10) : age >= 3 && missedDue >= 3;
      if (stalled) {
        cards.push({
          id: `hab-stalled-${hb.id}`, category: "habitos", kind: "confirmed", severity: missedDue >= 7 ? 3 : 2,
          title: `«${hb.name}» lleva varios días sin registrarse`,
          problem: last ? `El último registro es del ${L.longDate(last)}.` : "Todavía no tiene ningún registro.",
          evidence: [last ? `Último registro: ${L.longDate(last)} (hace ${plural(L.dayDiff(today, last), "día", "días")}).` : "Sin registros desde que se creó.", freq === "Semanal" ? "Frecuencia: semanal." : `${plural(missedDue, "día que tocaba", "días que tocaba")} sin marcar.`],
          recommendation: "Empieza por una versión mínima (por ejemplo, 10 minutos) para reducir la dificultad de comenzar. No se conoce el motivo del parón, así que la propuesta es solo una opción.",
          benefit: null,
          action: { type: "task", title: `${hb.name}: versión mínima (10 min)`, due_date: today, prio: 3, notes: "Propuesta de CloudSpace Intelligence: retomar el hábito con una versión pequeña." },
          review: { page: "habits", label: "Ver hábito" },
        });
        continue;
      }
      const rate = L.completionRate(days, today, 30, created);
      if (rate.total >= 14 && rate.pct < 40) {
        cards.push({
          id: `hab-low-${hb.id}`, category: "habitos", kind: "pattern", severity: 2,
          title: `«${hb.name}» se cumple pocas veces`,
          problem: `Cumplimiento del ${rate.pct}% en los últimos ${rate.total} días.`,
          evidence: [`${rate.done} de ${rate.total} días cumplidos.`, `Frecuencia configurada: ${freq}.`],
          recommendation: "Valora si la frecuencia o la dificultad son realistas (por ejemplo, pasar de diario a entre semana o acortarlo). Es una hipótesis: solo tú sabes si el hábito sigue siendo importante.",
          benefit: null, action: null, review: { page: "habits", label: "Editar hábito" },
        });
      }
    }
    // Diferencias por día de la semana (solo con muestra suficiente)
    const by = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
    for (const hb of habits) {
      const freq = L.habitFrequency(hb);
      if (freq === "Semanal") continue;
      const days = byHabit.get(hb.id) || new Set();
      const created = L.dayOfTimestamp(hb.created_at) || today;
      for (let k = L.addDays(today, -55); k <= today; k = L.addDays(k, 1)) {
        if (k < created && !days.has(k)) continue;
        if (!L.habitDueOn(freq, k) && !days.has(k)) continue;
        const w = L.weekdayIndex(k);
        by[w].due++;
        if (days.has(k)) by[w].done++;
      }
    }
    const WD = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
    const ok = by.map((x, i) => ({ i, rate: x.due >= 8 ? x.done / x.due : null, due: x.due, done: x.done })).filter((x) => x.rate !== null);
    if (ok.length >= 5) {
      const best = ok.reduce((a, b) => (b.rate > a.rate ? b : a));
      const worst = ok.reduce((a, b) => (b.rate < a.rate ? b : a));
      if (best.rate - worst.rate >= 0.25) {
        cards.push({
          id: "hab-weekday", category: "habitos", kind: "pattern", severity: 1,
          title: `Los ${WD[worst.i]} cumples menos`,
          problem: `${Math.round(worst.rate * 100)}% los ${WD[worst.i]} frente a ${Math.round(best.rate * 100)}% los ${WD[best.i]}.`,
          evidence: [`${WD[worst.i]}: ${worst.done}/${worst.due} registros.`, `${WD[best.i]}: ${best.done}/${best.due} registros.`, "Calculado con las últimas 8 semanas."],
          recommendation: `Si encaja con tu semana, planifica algo más ligero los ${WD[worst.i]}. Un patrón no explica por sí solo la causa.`,
          benefit: null, action: null, review: { page: "habits", label: "Ver hábitos" },
        });
      }
    }
    return cards;
  }

  /* ================= Tareas ================= */

  function taskCards(d) {
    const { today, tasks, lists, goals, sessions } = d;
    const cards = [];
    const open = tasks.filter((t) => L.isOpen(t));
    const byDue = (a, b) => (a.due_date || "9999") < (b.due_date || "9999") ? -1 : (a.due_date || "9999") > (b.due_date || "9999") ? 1 : L.prioOf(a) - L.prioOf(b);
    const overdue = open.filter((t) => L.isOverdue(t, today)).sort(byDue);
    if (overdue.length) {
      cards.push({
        id: "task-overdue", category: "tareas", kind: "confirmed", severity: 3,
        title: overdue.length === 1 ? "Tienes 1 tarea vencida" : `Tienes ${overdue.length} tareas vencidas`,
        problem: `La más antigua venció el ${L.longDate(overdue[0].due_date)}.`,
        evidence: overdue.slice(0, 4).map((t) => `«${t.title}» · venció ${L.shortDate(t.due_date)} · ${L.PRIO_LABELS[L.prioOf(t)]}`),
        recommendation: "Decide cada una: hacerla hoy, moverla a una fecha realista o cerrarla si ya no importa. Sin culpa: es solo reorganizar.",
        benefit: null, action: null, review: { page: "tasks", label: "Ver tareas" },
      });
    }
    const MARK = "Propuesta de CloudSpace Intelligence";
    const mine = (t) => String(t.notes || "").includes(MARK); // tareas creadas desde una propuesta: no generan propuestas nuevas
    const actioned = (t) => open.some((o) => mine(o) && String(o.notes).includes(`«${t.title}»`)); // ya tiene un bloque para empezar
    const soon = open.filter((t) => t.due_date && t.due_date >= today && L.dayDiff(t.due_date, today) <= 2 && !mine(t) && !actioned(t)).sort(byDue).slice(0, 3);
    for (const t of soon) {
      const rel = t.due_date === today ? "hoy" : t.due_date === L.addDays(today, 1) ? "mañana" : `el ${L.shortDate(t.due_date)}`;
      const needle = norm(t.title);
      const recent = L.addDays(today, -7);
      const logged = (sessions || []).some((s) => norm(s.label) && (norm(s.label).includes(needle) || needle.includes(norm(s.label))) && (L.dayOfTimestamp(s.created_at) || "") >= recent);
      cards.push({
        id: `task-soon-${t.id}`, category: "tareas", kind: "confirmed", severity: L.prioOf(t) <= 2 ? 3 : 2,
        title: `«${t.title}» vence ${rel}`,
        problem: "Sigue pendiente y la fecha está cerca.",
        evidence: [`Fecha límite: ${L.longDate(t.due_date)}.`, `Prioridad: ${L.PRIO_LABELS[L.prioOf(t)]}.`, logged ? "Hay tiempo registrado con ese nombre en el cronómetro esta semana." : "No consta tiempo registrado con ese nombre en el cronómetro esta semana."],
        recommendation: "Divídela en tres pasos pequeños y reserva un bloque para empezar hoy.",
        benefit: "Empezar pronto deja margen antes de la fecha límite.",
        action: { type: "task", title: `Empezar: ${t.title}`.slice(0, 200), due_date: today, prio: Math.min(L.prioOf(t), 3), notes: `Bloque para avanzar «${t.title}» (vence ${t.due_date}). Propuesta de CloudSpace Intelligence.` },
        review: { page: "tasks", label: "Ver tareas" },
      });
    }
    const important = open.filter((t) => L.prioOf(t) <= 2 && !t.due_date);
    if (important.length) {
      cards.push({
        id: "task-important-nodate", category: "tareas", kind: "confirmed", severity: 1,
        title: `${plural(important.length, "tarea importante sin fecha", "tareas importantes sin fecha")}`,
        problem: "Son de prioridad alta o urgente pero no tienen fecha límite.",
        evidence: important.slice(0, 4).map((t) => `«${t.title}» · ${L.PRIO_LABELS[L.prioOf(t)]}`),
        recommendation: "Ponles una fecha tentativa para que aparezcan en Hoy o Próximas.",
        benefit: null, action: null, review: { page: "tasks", label: "Ver tareas" },
      });
    }
    if (open.length >= 25) {
      const noDate = open.filter((t) => !t.due_date).length;
      cards.push({
        id: "task-pile", category: "tareas", kind: "confirmed", severity: 2,
        title: `${open.length} tareas abiertas a la vez`,
        problem: "Hay muchas pendientes simultáneamente.",
        evidence: [`${plural(noDate, "sin fecha", "sin fecha")}.`, `${plural(overdue.length, "vencida", "vencidas")}.`],
        recommendation: "Elige un máximo de tres para esta semana y aplaza o cierra el resto con fecha.",
        benefit: null, action: null, review: { page: "tasks", label: "Ver tareas" },
      });
    }
    const perList = (lists || []).map((l) => ({ l, n: open.filter((t) => t.list_id === l.id).length })).filter((x) => x.n >= 5).sort((a, b) => b.n - a.n);
    if (perList.length) {
      cards.push({
        id: "task-projects", category: "tareas", kind: "confirmed", severity: 1,
        title: "Proyectos con muchas tareas abiertas",
        problem: "Estos proyectos acumulan tareas sin completar.",
        evidence: perList.slice(0, 3).map((x) => `${x.l.name}: ${plural(x.n, "tarea abierta", "tareas abiertas")}`),
        recommendation: "Define el siguiente paso concreto de cada proyecto en lugar de mantener toda la lista a la vista.",
        benefit: null, action: null, review: { page: "tasks", label: "Ver proyectos" },
      });
    }
    // Objetivos de ahorro sin ninguna tarea abierta relacionada por nombre (patrón probable: depende de que los nombres coincidan)
    for (const g of goals || []) {
      if (L.goalPct(g) >= 100) continue;
      const gw = words(g.name);
      if (!gw.length) continue;
      const related = open.some((t) => { const tw = words(`${t.title} ${(t.tags || []).join(" ")} ${t.notes || ""}`); return gw.some((w) => tw.includes(w)); });
      if (!related) {
        cards.push({
          id: `goal-noaction-${g.id}`, category: "objetivos", kind: "pattern", severity: 1,
          title: `El objetivo «${g.name}» no tiene tareas asociadas`,
          problem: "No hay tareas abiertas que mencionen este objetivo.",
          evidence: [`Ahorrado: ${eur(L.centsFromDb(g.current))} de ${eur(L.centsFromDb(g.target))} (${L.goalPct(g)}%).`, "La relación se detecta por el nombre; si usas otras palabras, puede que sí tengas acciones."],
          recommendation: "Crea una acción pequeña, por ejemplo decidir cuánto aportar cada mes.",
          benefit: null,
          action: { type: "task", title: `Definir plan de ahorro para «${g.name}»`.slice(0, 200), due_date: L.addDays(today, 7), prio: 3, notes: "Propuesta de CloudSpace Intelligence." },
          review: { page: "finance", label: "Ver objetivos" },
        });
      }
    }
    return cards;
  }

  /* ================= Finanzas ================= */

  const daysInMonth = (mk) => L.monthBounds(mk).days;

  function recurringGroups(txs) {
    const groups = new Map();
    for (const t of txs) {
      if (t.type !== "expense" || !t.tx_date) continue;
      const cents = L.centsFromDb(t.amount);
      const key = norm(t.title) + "|" + cents;
      if (!groups.has(key)) groups.set(key, { title: t.title, cents, months: new Set() });
      groups.get(key).months.add(L.monthKey(t.tx_date));
    }
    return [...groups.values()].filter((g) => g.months.size >= 2).sort((a, b) => b.cents - a.cents);
  }

  function financeCards(d) {
    const { today, transactions, budgets, goals } = d;
    const cards = [];
    if (!transactions.length && !(budgets || []).length) return cards;
    const mk = L.monthKey(today);
    const totals = L.monthTotals(transactions, mk);
    const bs = L.budgetStatus(budgets || [], totals);
    const day = Number(today.slice(8));
    const dim = daysInMonth(mk);
    const rows = [...(bs.total ? [{ name: "el presupuesto mensual", ...bs.total }] : []), ...bs.categories.map((c) => ({ name: `«${c.category}»`, ...c }))];
    for (const r of rows) {
      if (r.limit <= 0) continue;
      const rawPct = Math.round((r.spent / r.limit) * 100);
      if (r.over || rawPct >= 90) {
        cards.push({
          id: `fin-budget-${r.category || "total"}`, category: "finanzas", kind: "confirmed", severity: r.over ? 3 : 2,
          title: r.over ? `Has superado ${r.name}` : `${r.name[0].toUpperCase()}${r.name.slice(1)} está casi agotado`,
          problem: r.over ? `Te has pasado ${eur(-r.left)} este mes.` : `Queda ${eur(r.left)} (${100 - rawPct}%).`,
          evidence: [`Gastado ${eur(r.spent)} de ${eur(r.limit)} (${rawPct}%).`, `Día ${day} de ${dim} del mes.`],
          recommendation: "Revisa qué gastos podrían aplazarse, o ajusta el límite si no era realista. No se asume que ningún gasto sea innecesario: solo tú conoces su finalidad.",
          benefit: null, action: null, review: { page: "finance", label: "Ver finanzas" },
        });
      } else if (day >= 7 && day < dim) {
        const projected = Math.round((r.spent / day) * dim);
        if (projected > r.limit * 1.1) {
          cards.push({
            id: `fin-pace-${r.category || "total"}`, category: "finanzas", kind: "estimate", severity: 2,
            title: `A este ritmo podrías superar ${r.name}`,
            problem: `Proyección lineal: ${eur(projected)} frente a un límite de ${eur(r.limit)}.`,
            evidence: [`Gastado hasta hoy: ${eur(r.spent)} en ${plural(day, "día", "días")}.`, "Estimación simple (gasto medio diario × días del mes); no tiene en cuenta pagos que aún no hayas registrado."],
            recommendation: "Mira si queda algún gasto grande previsto este mes y decide si ajustas el ritmo o el límite.",
            benefit: null, action: null, review: { page: "finance", label: "Ver finanzas" },
          });
        }
      }
    }
    // Comparación con un periodo comparable: mismo tramo del mes anterior
    const prevMk = L.addMonths(mk, -1);
    const upTo = (m, byDay) => {
      const out = {};
      for (const t of transactions) {
        if (t.type !== "expense" || !t.tx_date || L.monthKey(t.tx_date) !== m || Number(t.tx_date.slice(8)) > byDay) continue;
        out[t.category] = (out[t.category] || 0) + L.centsFromDb(t.amount);
      }
      return out;
    };
    const cur = upTo(mk, day), prev = upTo(prevMk, day);
    const up = Object.keys(cur).map((c) => ({ c, cur: cur[c], prev: prev[c] || 0 })).filter((x) => x.prev >= 2000 && x.cur >= x.prev * 1.3 && x.cur - x.prev >= 1500).sort((a, b) => b.cur - b.prev - (a.cur - a.prev)).slice(0, 2);
    for (const x of up) {
      cards.push({
        id: `fin-vs-prev-${x.c}`, category: "finanzas", kind: "confirmed", severity: 2,
        title: `Gastas más en «${x.c}» que el mes pasado`,
        problem: `${eur(x.cur)} frente a ${eur(x.prev)} en el mismo tramo del mes anterior (hasta el día ${day}).`,
        evidence: [`Este mes hasta hoy: ${eur(x.cur)}.`, `Mes anterior hasta el día ${day}: ${eur(x.prev)}.`, `Diferencia: +${eur(x.cur - x.prev)}.`],
        recommendation: "Revisa los movimientos de esa categoría por si hay algo puntual. Un aumento no implica que haya un problema.",
        benefit: null, action: null, review: { page: "finance", label: "Ver movimientos" },
      });
    }
    const rec = recurringGroups(transactions);
    if (rec.length) {
      const monthly = rec.reduce((s, g) => s + g.cents, 0);
      cards.push({
        id: "fin-recurring", category: "finanzas", kind: "pattern", severity: 1,
        title: `${plural(rec.length, "posible pago recurrente", "posibles pagos recurrentes")}`,
        problem: "Mismo concepto e importe en meses distintos.",
        evidence: [...rec.slice(0, 4).map((g) => `${g.title}: ${eur(g.cents)} (${plural(g.months.size, "mes", "meses")})`), `Estimación orientativa: ${eur(monthly)} al mes si todos siguen activos.`],
        recommendation: "Comprueba que sigues usando cada uno. Esto se detecta por coincidencia de concepto e importe, no por una suscripción registrada.",
        benefit: null, action: null, review: { page: "finance", label: "Ver movimientos" },
      });
    }
    // Evolución: gastos por encima de ingresos en meses completos seguidos
    const series = L.monthSeries(transactions, prevMk, 3).filter((s) => s.income + s.expense > 0);
    const tail = [];
    for (let i = series.length - 1; i >= 0 && series[i].expense > series[i].income; i--) tail.unshift(series[i]);
    if (tail.length >= 2) {
      cards.push({
        id: "fin-deficit", category: "finanzas", kind: "confirmed", severity: 2,
        title: `Gastos superiores a ingresos ${tail.length} meses seguidos`,
        problem: "En los últimos meses completos has gastado más de lo que ha entrado.",
        evidence: tail.map((s) => `${L.monthLabel(s.month)}: ingresos ${eur(s.income)}, gastos ${eur(s.expense)}.`),
        recommendation: "Revisa si faltan ingresos por registrar y, si no, qué categorías pesan más. Sin ese contexto no se puede concluir nada más.",
        benefit: null, action: null, review: { page: "finance", label: "Ver finanzas" },
      });
    }
    const exps = transactions.filter((t) => t.type === "expense" && t.tx_date && L.monthKey(t.tx_date) === mk).sort((a, b) => L.centsFromDb(b.amount) - L.centsFromDb(a.amount));
    if (exps.length >= 3) {
      cards.push({
        id: "fin-top", category: "finanzas", kind: "confirmed", severity: 1,
        title: "Tus mayores gastos de este mes",
        problem: "Los tres movimientos más grandes registrados.",
        evidence: exps.slice(0, 3).map((t) => `${t.title} (${t.category}): ${eur(L.centsFromDb(t.amount))} · ${L.shortDate(t.tx_date)}`),
        recommendation: "Revísalos solo si quieres comprobar que encajan con tus prioridades; no se asume nada sobre su finalidad.",
        benefit: null, action: null, review: { page: "finance", label: "Ver movimientos" },
      });
    }
    const empty = (goals || []).filter((g) => L.centsFromDb(g.current) === 0 && L.centsFromDb(g.target) > 0);
    if (empty.length) {
      cards.push({
        id: "fin-goals-zero", category: "finanzas", kind: "confirmed", severity: 1,
        title: `${plural(empty.length, "objetivo de ahorro sin importe ahorrado", "objetivos de ahorro sin importe ahorrado")}`,
        problem: "Constan con 0 € ahorrados.",
        evidence: empty.slice(0, 3).map((g) => `«${g.name}»: 0 € de ${eur(L.centsFromDb(g.target))}`),
        recommendation: "Si ya has ahorrado algo, actualiza el importe; si no, plantea una primera aportación pequeña.",
        benefit: null, action: null, review: { page: "finance", label: "Ver objetivos" },
      });
    }
    return cards;
  }

  /* ================= Análisis completo ================= */

  function analyze(d) {
    const today = d.today;
    const data = { ...d, goals: d.goals || [], lists: d.lists || [], sessions: d.sessions || [], budgets: d.budgets || [], transactions: d.transactions || [] };
    const cards = [...taskCards(data), ...habitCards(data), ...financeCards(data)];
    cards.sort((a, b) => b.severity - a.severity || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);

    const open = data.tasks.filter((t) => L.isOpen(t));
    const overdue = open.filter((t) => L.isOverdue(t, today)).length;
    const soon = open.filter((t) => t.due_date && t.due_date >= today && L.dayDiff(t.due_date, today) <= 2).length;
    const status = data.habits.map((h) => L.habitStatusToday(L.habitFrequency(h), data.byHabit.get(h.id) || new Set(), today));
    const habitsPending = status.filter((s) => s === "pending").length;
    const week = L.weekSummary(data.habits, data.byHabit, today);
    const goalsAttention = cards.filter((c) => c.category === "objetivos" || c.id === "fin-goals-zero").length;
    const expensesReview = cards.filter((c) => c.category === "finanzas" && c.severity >= 2).length;
    const parts = [];
    if (data.habits.length) parts.push(habitsPending ? `${plural(habitsPending, "hábito pendiente", "hábitos pendientes")} hoy` : "hábitos de hoy al día");
    if (open.length) parts.push(overdue ? `${plural(overdue, "tarea vencida", "tareas vencidas")}` : "ninguna tarea vencida");
    if (soon) parts.push(`${plural(soon, "vence en 2 días o menos", "vencen en 2 días o menos")}`);
    const hasData = data.habits.length + data.tasks.length + data.transactions.length > 0;
    const state = !hasData ? "Todavía no hay datos suficientes para analizar. Registra algunas tareas, hábitos o movimientos."
      : `${parts.join(" · ")}.` + (week.total ? ` Esta semana llevas un ${week.pct}% en tus hábitos.` : "");
    return {
      cards,
      main: cards[0] || null,
      summary: { habitsPending, tasksSoon: overdue + soon, overdue, soon, goalsAttention, expensesReview, weekPct: week.total ? week.pct : null, state, hasData },
    };
  }

  /* ================= Resumen semanal (solo reglas) ================= */

  function weeklyReview(d, analysis, weekStartKey) {
    const ws = weekStartKey || L.weekStart(d.today);
    const keys = L.weekKeys(ws);
    const we = keys[6];
    const prevKeys = L.weekKeys(L.addDays(ws, -7));
    const inWeek = (k, arr) => !!k && k >= arr[0] && k <= arr[6];
    const done = d.tasks.filter((t) => !L.isOpen(t) && inWeek(L.dayOfTimestamp(t.completed_at), keys));
    const open = d.tasks.filter((t) => L.isOpen(t));
    const overdue = open.filter((t) => L.isOverdue(t, d.today));
    const upTo = d.today < we ? d.today : we;
    const sum = L.weekSummary(d.habits, d.byHabit, upTo);
    const habits = d.habits.map((h) => {
      const freq = L.habitFrequency(h);
      const prog = L.habitWeekProgress(freq, d.byHabit.get(h.id) || new Set(), ws);
      return { name: h.name, done: prog.done, target: prog.target };
    });
    const sumTx = (arr) => {
      let income = 0, expense = 0;
      for (const t of d.transactions) {
        if (!inWeek(t.tx_date, arr)) continue;
        const c = L.centsFromDb(t.amount);
        if (t.type === "income") income += c; else expense += c;
      }
      return { income, expense };
    };
    const fin = sumTx(keys), finPrev = sumTx(prevKeys);
    const goals = (d.goals || []).map((g) => ({ name: g.name, pct: L.goalPct(g), current: L.centsFromDb(g.current), target: L.centsFromDb(g.target) }));
    const obstacles = analysis.cards.filter((c) => c.severity >= 2).slice(0, 3).map((c) => c.title);
    const zero = habits.filter((h) => h.done === 0).map((h) => h.name);
    if (zero.length && !obstacles.length) obstacles.push(`Hábitos sin registros esta semana: ${zero.slice(0, 3).join(", ")}.`);
    const priorities = [];
    const seen = new Set();
    for (const c of analysis.cards) {
      const key = c.recommendation;
      if (seen.has(key)) continue;
      seen.add(key);
      priorities.push({ title: c.title, why: c.recommendation });
      if (priorities.length === 3) break;
    }
    return { weekStart: ws, weekEnd: we, tasks: { done: done.length, doneTitles: done.slice(0, 5).map((t) => t.title), open: open.length, overdue: overdue.length }, habits: { pct: sum.total ? sum.pct : null, list: habits }, goals, finance: { ...fin, prev: finPrev }, obstacles, priorities };
  }

  function weeklyMarkdown(w, { includeTitles = true } = {}) {
    const f = (c) => eur(c);
    const lines = [`# Resumen semanal de CloudSpace`, `Semana del ${L.longDate(w.weekStart)} al ${L.longDate(w.weekEnd)} (generado por reglas, sin IA).`, ""];
    lines.push("## Tareas", `- Completadas: ${w.tasks.done}${includeTitles && w.tasks.doneTitles.length ? ` (${w.tasks.doneTitles.map((t) => `«${t}»`).join(", ")})` : ""}`, `- Abiertas: ${w.tasks.open} · Vencidas: ${w.tasks.overdue}`, "");
    lines.push("## Hábitos", w.habits.pct === null ? "- Sin hábitos registrados esta semana." : `- Cumplimiento semanal: ${w.habits.pct}%`);
    for (const h of w.habits.list) lines.push(`- ${includeTitles ? h.name : "Hábito"}: ${h.done}/${h.target}`);
    lines.push("", "## Objetivos de ahorro", ...(w.goals.length ? w.goals.map((g) => `- ${includeTitles ? g.name : "Objetivo"}: ${g.pct}% (${f(g.current)} de ${f(g.target)}). No hay historial de aportaciones, solo el importe actual.`) : ["- Sin objetivos."]));
    lines.push("", "## Finanzas de la semana", `- Ingresos: ${f(w.finance.income)} (semana anterior: ${f(w.finance.prev.income)})`, `- Gastos: ${f(w.finance.expense)} (semana anterior: ${f(w.finance.prev.expense)})`);
    lines.push("", "## Principales obstáculos observados", ...(w.obstacles.length ? w.obstacles.map((o) => `- ${o}`) : ["- Ninguno destacado con los datos disponibles."]));
    lines.push("", "## Tres prioridades sugeridas para la próxima semana", ...(w.priorities.length ? w.priorities.map((p, i) => `${i + 1}. ${p.title} — ${p.why}`) : ["Con los datos actuales no hay prioridades que sugerir."]));
    return lines.join("\n");
  }

  /* ================= Informe para Claude Pro ================= */

  const ANALYSIS_PROMPT = [
    "Actúa como analista personal de CloudSpace. Examina los datos proporcionados sobre mis hábitos, tareas, objetivos y finanzas. Identifica patrones verificables, posibles obstáculos, tareas prioritarias y oportunidades de mejora.",
    "",
    "Distingue los hechos de las hipótesis. No inventes datos ni atribuyas causas sin evidencia. En finanzas, no asumas que un gasto es innecesario sin conocer su finalidad.",
    "",
    "Propón un máximo de cinco recomendaciones concretas y priorizadas. Para cada una, indica el problema detectado, la evidencia disponible, la acción propuesta y el beneficio esperado cuando pueda estimarse.",
    "",
    "Presenta un plan de acción realista para los próximos siete días. Evita recomendaciones genéricas, repeticiones y cambios excesivos. No modifiques datos de la aplicación: presenta tus propuestas para que el usuario decida cuáles incorporar.",
    "",
    "Formato de cada recomendación (para poder importarla después en CloudSpace): un encabezado con el título y debajo las líneas «Categoría:», «Problema:», «Evidencia:», «Acción:», «Prioridad:» (alta, media o baja), «Fecha sugerida:» (AAAA-MM-DD) y «Objetivo relacionado:».",
  ].join("\n");

  function buildReport(d, analysis, opts = {}) {
    const o = { habits: true, tasks: true, finance: true, goals: true, patterns: true, includeTitles: true, includeConcepts: true, ...opts };
    const today = d.today;
    const lines = [];
    const tn = (name, i, what) => (o.includeTitles ? `«${name}»` : `${what} ${i + 1}`);
    lines.push("# Informe de CloudSpace para análisis", "", "_Informe generado automáticamente por las reglas de CloudSpace (sin IA). Revísalo antes de compartirlo: no contiene contraseñas, claves ni correo._", "");
    lines.push("## 1. Fecha de generación", `${L.longDate(today)}`, "");
    lines.push("## 2. Resumen general", analysis.summary.state, `- Hábitos pendientes hoy: ${analysis.summary.habitsPending}`, `- Tareas vencidas: ${analysis.summary.overdue} · vencen en 2 días o menos: ${analysis.summary.soon}`, `- Observaciones del motor de reglas: ${analysis.cards.length}`, "");

    lines.push("## 3. Estado de los hábitos");
    if (!o.habits || !d.habits.length) lines.push(o.habits ? "Sin hábitos registrados." : "_No incluido por el usuario._");
    else {
      const sum = L.weekSummary(d.habits, d.byHabit, today);
      lines.push(`Cumplimiento semanal (hasta hoy): ${sum.total ? sum.pct + "%" : "sin datos"}.`);
      d.habits.forEach((h, i) => {
        const freq = L.habitFrequency(h);
        const days = d.byHabit.get(h.id) || new Set();
        const created = L.dayOfTimestamp(h.created_at) || today;
        const r = L.completionRate(days, today, 30, created);
        lines.push(`- ${tn(h.name, i, "Hábito")} (${L.habitCategory(h)}, ${freq}): ${r.total ? `${r.pct}% en los últimos ${r.total} días (${r.done}/${r.total})` : "sin días suficientes"}; racha actual ${L.habitStreak(freq, days, today)}, mejor ${L.habitBestStreak(freq, days)}.`);
      });
    }
    lines.push("");

    lines.push("## 4. Tareas pendientes y próximas a vencer");
    if (!o.tasks) lines.push("_No incluido por el usuario._");
    else {
      const open = d.tasks.filter((t) => L.isOpen(t));
      lines.push(`Abiertas: ${open.length}. Vencidas: ${open.filter((t) => L.isOverdue(t, today)).length}.`);
      const list = L.sortTasks(open.filter((t) => t.due_date || L.prioOf(t) <= 2), "smart").slice(0, 15);
      list.forEach((t, i) => lines.push(`- ${tn(t.title, i, "Tarea")} · ${t.due_date ? `vence ${t.due_date}` : "sin fecha"} · ${L.PRIO_LABELS[L.prioOf(t)]}${L.isOverdue(t, today) ? " · VENCIDA" : ""}`));
      if (!list.length) lines.push("- Sin tareas con fecha o prioridad alta.");
    }
    lines.push("");

    lines.push("## 5. Resumen financiero");
    if (!o.finance) lines.push("_No incluido por el usuario._");
    else {
      const mk = L.monthKey(today);
      const t = L.monthTotals(d.transactions, mk);
      lines.push(`Mes actual (${L.monthLabel(mk)}): ingresos ${eur(t.income)}, gastos ${eur(t.expense)}, balance ${eur(t.balance)}.`);
      const cats = Object.entries(t.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (cats.length) lines.push("Gastos por categoría:", ...cats.map(([c, v]) => `- ${c}: ${eur(v)}`));
      const bs = L.budgetStatus(d.budgets || [], t);
      if (bs.total) lines.push(`Presupuesto mensual: gastado ${eur(bs.total.spent)} de ${eur(bs.total.limit)}.`);
      for (const c of bs.categories) lines.push(`- Presupuesto «${c.category}»: ${eur(c.spent)} de ${eur(c.limit)}`);
      const series = L.monthSeries(d.transactions, mk, 4);
      lines.push("Evolución (ingresos / gastos):", ...series.map((s) => `- ${L.monthLabel(s.month)}: ${eur(s.income)} / ${eur(s.expense)}`));
      if (o.includeConcepts) {
        const top = d.transactions.filter((x) => x.type === "expense" && x.tx_date && L.monthKey(x.tx_date) === mk).sort((a, b) => L.centsFromDb(b.amount) - L.centsFromDb(a.amount)).slice(0, 5);
        if (top.length) lines.push("Mayores gastos del mes:", ...top.map((x) => `- ${x.title} (${x.category}): ${eur(L.centsFromDb(x.amount))}`));
      }
    }
    lines.push("");

    lines.push("## 6. Objetivos y proyectos");
    if (!o.goals) lines.push("_No incluido por el usuario._");
    else {
      (d.goals || []).forEach((g, i) => lines.push(`- Objetivo de ahorro ${tn(g.name, i, "Objetivo")}: ${eur(L.centsFromDb(g.current))} de ${eur(L.centsFromDb(g.target))} (${L.goalPct(g)}%)`));
      const open = d.tasks.filter((t) => L.isOpen(t));
      (d.lists || []).forEach((l, i) => { const n = open.filter((t) => t.list_id === l.id).length; if (n) lines.push(`- Proyecto ${tn(l.name, i, "Proyecto")}: ${plural(n, "tarea abierta", "tareas abiertas")}`); });
      if (!(d.goals || []).length && !(d.lists || []).length) lines.push("Sin objetivos ni proyectos.");
    }
    lines.push("");

    lines.push("## 7. Patrones detectados por el motor de reglas");
    if (!o.patterns || !analysis.cards.length) lines.push(o.patterns ? "El motor no ha detectado nada destacable con los datos actuales." : "_No incluido por el usuario._");
    else analysis.cards.slice(0, 12).forEach((c) => lines.push(`- [${KIND_LABEL[c.kind]}] ${o.includeTitles ? c.title : CATEGORY_LABEL[c.category]}: ${o.includeTitles ? c.problem : "ver datos arriba"}`));
    lines.push("");

    lines.push("## 8. Preguntas o aspectos que requieren interpretación",
      "- ¿Qué obstáculos reales explican los hábitos o tareas que se retrasan? (las reglas solo ven fechas, no motivos)",
      "- ¿Qué gastos son puntuales y cuáles recurrentes? (las reglas solo ven conceptos e importes)",
      "- ¿Qué prioridades tienen más peso en los próximos siete días?", "");

    lines.push("## 9. Solicitud de recomendaciones personalizadas", ANALYSIS_PROMPT);
    return lines.join("\n");
  }

  /* ================= Importación de la respuesta de Claude ================= */

  const FIELD_RE = /^[\s>*_-]*(?:\d+[.)]\s*)?\**\s*(título|titulo|categoría|categoria|problema detectado|problema|evidencia|acción propuesta|accion propuesta|acción|accion|beneficio esperado|beneficio|prioridad|fecha sugerida|fecha|objetivo relacionado|objetivo)\s*\**\s*[:：]\s*\**\s*(.*)$/i;
  const FIELD_MAP = { título: "title", titulo: "title", categoría: "category", categoria: "category", "problema detectado": "problem", problema: "problem", evidencia: "evidence", "acción propuesta": "action", "accion propuesta": "action", acción: "action", accion: "action", "beneficio esperado": "benefit", beneficio: "benefit", prioridad: "priority", "fecha sugerida": "date", fecha: "date", "objetivo relacionado": "goal", objetivo: "goal" };

  const clean = (s, n = 500) => String(s || "").replace(/<[^>]*>/g, "").replace(/[`*_#]+/g, "").replace(/\s+/g, " ").trim().slice(0, n);

  function parsePriority(s) {
    const v = norm(s);
    if (!v) return 4;
    if (/urgent|p1|cr[ií]tic/.test(v)) return 1;
    if (/alta|high|p2/.test(v)) return 2;
    if (/media|medium|p3|moderada/.test(v)) return 3;
    return 4;
  }
  function parseCategory(s) {
    const v = norm(s);
    if (/h[aá]bit/.test(v)) return "habitos";
    if (/tarea|proyecto/.test(v)) return "tareas";
    if (/finanz|presupuesto|gasto|ahorro|dinero/.test(v)) return "finanzas";
    if (/objetivo|meta/.test(v)) return "objetivos";
    return "otros";
  }
  function parseDate(s, today) {
    const str = String(s || "");
    let y, m, d;
    let r = /(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (r) [y, m, d] = [r[1], r[2], r[3]];
    else if ((r = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(str))) [d, m, y] = [r[1], r[2], r[3]];
    else return null;
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!L.isDayKey(key)) return null;
    return key >= today ? key : null;
  }

  // Interpreta el texto pegado. No ejecuta nada: devuelve candidatos para que el usuario los revise.
  function parseClaudeResponse(text, today) {
    const src = String(text || "").replace(/\r/g, "").slice(0, 30000);
    const items = [];
    let cur = null;
    const flush = () => { if (cur && (cur.action || cur.problem)) items.push(cur); cur = null; };
    for (const line of src.split("\n")) {
      if (!line.trim()) continue;
      const f = FIELD_RE.exec(line);
      if (f) {
        const key = FIELD_MAP[f[1].toLowerCase()];
        if (key === "title" && cur && !cur.title) { cur.title = clean(f[2], 120); continue; }
        if (!cur) cur = { title: "", fields: {} };
        if (key === "title") { flush(); cur = { title: clean(f[2], 120), fields: {} }; continue; }
        if (!cur[key]) cur[key] = clean(f[2]);
        continue;
      }
      const head = /^\s{0,3}(?:#{1,4}\s+|\d+[.)]\s+)(.+)$/.exec(line);
      if (head) {
        flush();
        const t = clean(head[1].replace(/^\**\s*(?:recomendaci[oó]n|prioridad)\s*\d*\s*[:.-]?\s*/i, ""), 120);
        if (t) cur = { title: t };
        continue;
      }
      const bold = /^\s*(?:[-*]\s+)?\*\*([^*]{3,120})\*\*\s*$/.exec(line);
      if (bold && (!cur || cur.action || cur.problem)) { flush(); cur = { title: clean(bold[1], 120) }; }
    }
    flush();
    const out = items.slice(0, 10).map((it, i) => ({
      id: `imp-${i}`,
      title: it.title || clean(it.action, 80) || `Recomendación ${i + 1}`,
      category: parseCategory(it.category),
      problem: it.problem || "",
      action: it.action || "",
      priority: parsePriority(it.priority),
      suggested_date: parseDate(it.date, today),
      goal: it.goal || "",
      benefit: it.benefit || "",
    }));
    return { items: out, unparsed: out.length === 0, rawLength: src.length };
  }

  return { CATEGORY_LABEL, KIND_LABEL, ANALYSIS_PROMPT, analyze, weeklyReview, weeklyMarkdown, buildReport, parseClaudeResponse, recurringGroups };
});
