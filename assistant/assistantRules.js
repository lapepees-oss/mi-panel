"use strict";
// Reglas del asistente. Cada regla es un objeto declarativo:
//   { id, module, version, label, description, minData(s,cfg) → {ok,reason}, detect(s,cfg) → candidatos[],
//     describe(c,s,cfg) → {situation,data[],period,patterns[],hypotheses[]}, groupTitle?(n) }
// Un candidato es una situación detectada con SUS números; la puntuación, la discreción y la explicación se calculan
// aparte. Ninguna regla escribe datos ni inventa causas: lo que no es dato se marca como hipótesis.
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../logic.js") : root.Logic,
    typeof module === "object" && module.exports ? require("./assistantPatterns.js") : root.AssistantPatterns
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantRules = api;
})(typeof self !== "undefined" ? self : this, function (L, P) {
  const DEFAULTS = {
    tasks: { importantDays: 3, accumulationOpen: 25, flowDays: 7, postponeMin: 3, postponeDays: 30, urgentOverload: 6, staleDays: 30, staleMin: 5 },
    habits: { eveningHour: 18, recentDays: 14, baselineDays: 28, minDueRecent: 8, minDueBaseline: 10, dropPoints: 25, weekdayDays: 56, weekdayMinDue: 4, reviewDays: 30, reviewMinAge: 30, reviewRate: 0.3 },
    focus: { windowDays: 14, minPrior: 3, freqChangePct: 40, durChangePct: 30, minRecentForProposal: 3, startHour: 8, endHour: 21 },
    finance: { nearPct: 80, changePct: 30, changeMinCents: 2000, minPrevCents: 2000, minDayOfMonth: 7 },
    goals: { staleDays: 21, milestoneDays: 7 },
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const eur = (c) => L.formatEUR(c);
  const clamp = P.clamp;
  const nav = (page, itemId) => ({ type: "navigate.review", params: itemId ? { page, itemId } : { page }, label: "Revisar" });
  const open = (s) => s.tasks.filter((t) => t.status !== "done");
  const byUrgency = (a, b) => a.prio - b.prio || (a.due_date || "9999") .localeCompare(b.due_date || "9999");
  const ok = { ok: true };
  const no = (reason) => ({ ok: false, reason });
  const cand = (rule, c) => ({ ruleId: rule.id, module: rule.module, ruleVersion: rule.version, timing: "now", reasonCodes: [], actions: [], consistency: 1, ...c });

  /* =============== TAREAS =============== */

  const taskOverdue = {
    id: "task.overdue", module: "tasks", version: 1, label: "Tareas vencidas",
    description: "Tareas abiertas cuya fecha de vencimiento ya pasó.",
    minData: (s) => (open(s).length ? ok : no("No hay tareas abiertas.")),
    detect(s) {
      const od = open(s).filter((t) => t.due_date && t.due_date < s.today).sort(byUrgency);
      if (!od.length) return [];
      const late = od.map((t) => L.dayDiff(s.today, t.due_date));
      const maxLate = Math.max(...late), hasHigh = od.some((t) => t.prio <= 2);
      return [cand(taskOverdue, {
        key: "task.overdue",
        title: od.length === 1 ? "Tienes una tarea vencida" : `Tienes ${od.length} tareas vencidas`,
        summary: `La más antigua venció hace ${plural(maxLate, "día", "días")}. Puedes moverlas, cerrarlas o dejarlas como están.`,
        impact: clamp(0.35 + 0.08 * od.length + (hasHigh ? 0.2 : 0)), urgency: clamp(0.4 + (Math.min(maxLate, 14) / 14) * 0.4),
        basis: "fact", sample: { n: od.length, full: 1 },
        evidence: { refs: od.slice(0, 20).map((t) => ({ type: "task", id: t.id })), metrics: { count: od.length, maxDaysLate: maxLate, highPriority: od.filter((t) => t.prio <= 2).length }, period: { from: od.map((t) => t.due_date).sort()[0], to: s.today } },
        reasonCodes: ["TASK_PAST_DUE", ...(hasHigh ? ["HIGH_PRIORITY_INVOLVED"] : [])],
        actions: [nav("tasks"), ...od.slice(0, 3).map((t) => ({ type: "task.reschedule", params: { taskId: t.id, due_date: L.addDays(s.today, 1) }, label: "Mover a mañana" }))],
        signature: `${od.length}:${maxLate >= 7 ? "w" : "d"}`,
      })];
    },
    describe(c, s) {
      const ids = new Set(c.evidence.refs.map((r) => r.id));
      const items = s.tasks.filter((t) => ids.has(t.id)).sort(byUrgency);
      return {
        situation: `Hay ${plural(c.evidence.metrics.count, "tarea abierta", "tareas abiertas")} con la fecha de vencimiento ya pasada.`,
        data: items.slice(0, 8).map((t) => `«${t.title}» · ${L.PRIO_LABELS[t.prio]} · vencía el ${L.shortDate(t.due_date)} (hace ${plural(L.dayDiff(s.today, t.due_date), "día", "días")})`),
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Desde la fecha de vencimiento más antigua hasta hoy" },
        patterns: [], hypotheses: [],
      };
    },
  };

  const taskImportant = {
    id: "task.important_near_deadline", module: "tasks", version: 1, label: "Importantes con fecha cercana",
    description: "Tareas de prioridad P1/P2 que vencen en los próximos días.",
    minData: (s) => (open(s).some((t) => t.prio <= 2) ? ok : no("No hay tareas abiertas de prioridad alta.")),
    detect(s, cfg) {
      const lim = L.addDays(s.today, cfg.tasks.importantDays);
      const items = open(s).filter((t) => t.prio <= 2 && t.due_date && t.due_date >= s.today && t.due_date <= lim).sort(byUrgency);
      if (!items.length) return [];
      const minLeft = Math.min(...items.map((t) => L.dayDiff(t.due_date, s.today)));
      return [cand(taskImportant, {
        key: "task.important_near_deadline",
        title: items.length === 1 ? "Una tarea importante vence pronto" : `${items.length} tareas importantes vencen pronto`,
        summary: minLeft === 0 ? "Alguna vence hoy." : `La más próxima vence en ${plural(minLeft, "día", "días")}.`,
        impact: clamp(0.55 + 0.05 * items.length), urgency: [0.85, 0.7, 0.55, 0.45][Math.min(minLeft, 3)],
        basis: "fact", sample: { n: items.length, full: 1 },
        evidence: { refs: items.map((t) => ({ type: "task", id: t.id })), metrics: { count: items.length, daysLeft: minLeft }, period: { from: s.today, to: lim } },
        reasonCodes: ["HIGH_PRIORITY", "DEADLINE_NEAR"],
        actions: [nav("tasks", items[0].id), { type: "timer.prepare_session", params: { label: "Sesión de concentración", minutes: 25, taskId: items[0].id }, label: "Preparar una sesión" }],
        signature: `${items.length}:${minLeft}`,
      })];
    },
    describe(c, s, cfg) {
      const ids = new Set(c.evidence.refs.map((r) => r.id));
      return {
        situation: `Tienes tareas P1/P2 que vencen en los próximos ${cfg.tasks.importantDays} días.`,
        data: s.tasks.filter((t) => ids.has(t.id)).sort(byUrgency).map((t) => `«${t.title}» · ${L.PRIO_LABELS[t.prio]} · vence el ${L.shortDate(t.due_date)}`),
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Hoy y los próximos ${cfg.tasks.importantDays} días` },
        patterns: [], hypotheses: [],
      };
    },
  };

  const taskAccumulation = {
    id: "task.accumulation", module: "tasks", version: 1, label: "Acumulación de tareas",
    description: "Muchas tareas abiertas a la vez.",
    minData: (s, cfg) => (open(s).length >= cfg.tasks.accumulationOpen ? ok : no(`Hay menos de ${cfg.tasks.accumulationOpen} tareas abiertas.`)),
    detect(s, cfg) {
      const o = open(s);
      if (o.length < cfg.tasks.accumulationOpen) return [];
      const from = L.addDays(s.today, -(cfg.tasks.flowDays - 1));
      const created = s.tasks.filter((t) => t.createdDay && t.createdDay >= from).length;
      const completed = s.tasks.filter((t) => t.status === "done" && t.completedDay && t.completedDay >= from).length;
      const noDue = o.filter((t) => !t.due_date).length;
      return [cand(taskAccumulation, {
        key: "task.accumulation",
        title: `Tienes ${o.length} tareas abiertas`,
        summary: "Quizá convenga revisar cuáles siguen teniendo sentido. No hace falta hacerlo todo.",
        impact: clamp(0.3 + (o.length - cfg.tasks.accumulationOpen) * 0.01), urgency: 0.2, basis: "fact", sample: { n: o.length, full: cfg.tasks.accumulationOpen },
        evidence: { refs: [], metrics: { open: o.length, withoutDate: noDue, createdLastWeek: created, completedLastWeek: completed }, period: { from, to: s.today } },
        reasonCodes: ["MANY_OPEN_TASKS"], actions: [nav("tasks")], signature: `${Math.floor(o.length / 5)}`,
      })];
    },
    describe(c, s, cfg) {
      const m = c.evidence.metrics;
      return {
        situation: `Ahora mismo hay ${m.open} tareas abiertas; el umbral para avisar es ${cfg.tasks.accumulationOpen}.`,
        data: [`${m.withoutDate} de ellas no tienen fecha.`, `En los últimos ${cfg.tasks.flowDays} días se crearon ${m.createdLastWeek} y se completaron ${m.completedLastWeek}.`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Últimos ${cfg.tasks.flowDays} días para el flujo; recuento actual para las abiertas` },
        patterns: m.createdLastWeek > m.completedLastWeek ? ["En el periodo se han creado más tareas de las que se han completado."] : [],
        hypotheses: ["Es posible que parte de las tareas ya no sea relevante; solo tú puedes saberlo."],
      };
    },
  };

  const taskPostponement = {
    id: "task.repeated_postponement", module: "tasks", version: 1, label: "Aplazamientos repetidos",
    description: "Tareas cuya fecha se ha retrasado varias veces (requiere historial de cambios de fecha).",
    minData: (s) => (s.taskEvents.length ? ok : no("La app no registra todavía el historial de cambios de fecha de las tareas.")),
    detect(s, cfg) {
      const from = L.addDays(s.today, -(cfg.tasks.postponeDays - 1));
      const counts = new Map();
      for (const e of s.taskEvents) if (e.day >= from && e.from && e.to && e.to > e.from) counts.set(e.taskId, (counts.get(e.taskId) || 0) + 1);
      const items = open(s).filter((t) => (counts.get(t.id) || 0) >= cfg.tasks.postponeMin).sort(byUrgency);
      if (!items.length) return [];
      const max = Math.max(...items.map((t) => counts.get(t.id)));
      return [cand(taskPostponement, {
        key: "task.repeated_postponement",
        title: items.length === 1 ? "Una tarea se ha aplazado varias veces" : `${items.length} tareas se han aplazado varias veces`,
        summary: "Tal vez convenga dividirlas, cambiar su alcance o cerrarlas. Es solo una opción.",
        impact: 0.45, urgency: 0.3, basis: "fact", sample: { n: items.length, full: 1 },
        evidence: { refs: items.map((t) => ({ type: "task", id: t.id })), metrics: { count: items.length, maxPostponements: max, perTask: Object.fromEntries(items.map((t) => [t.id, counts.get(t.id)])) }, period: { from, to: s.today } },
        reasonCodes: ["REPEATED_POSTPONEMENT"], actions: [nav("tasks", items[0].id)], signature: `${items.length}:${max}`,
      })];
    },
    describe(c, s, cfg) {
      const per = c.evidence.metrics.perTask;
      return {
        situation: `La fecha de ${plural(c.evidence.metrics.count, "tarea", "tareas")} se ha retrasado al menos ${cfg.tasks.postponeMin} veces en ${cfg.tasks.postponeDays} días.`,
        data: s.tasks.filter((t) => per[t.id]).map((t) => `«${t.title}» · ${per[t.id]} aplazamientos`),
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Últimos ${cfg.tasks.postponeDays} días` },
        patterns: [], hypotheses: ["Puede que la tarea sea demasiado grande, que no sea el momento o que haya perdido prioridad. No hay datos para saber cuál."],
      };
    },
  };

  const taskPriorityReview = {
    id: "task.priority_review", module: "tasks", version: 1, label: "Revisión de prioridades",
    description: "Demasiadas tareas urgentes a la vez o tareas antiguas sin fecha.",
    minData: (s, cfg) => (open(s).length >= cfg.tasks.staleMin ? ok : no("Hay muy pocas tareas abiertas para valorar prioridades.")),
    detect(s, cfg) {
      const o = open(s), reasons = [];
      const urgent = o.filter((t) => t.prio === 1);
      if (urgent.length >= cfg.tasks.urgentOverload) reasons.push("URGENT_OVERLOAD");
      const stale = o.filter((t) => !t.due_date && t.createdDay && L.dayDiff(s.today, t.createdDay) >= cfg.tasks.staleDays);
      if (stale.length >= cfg.tasks.staleMin) reasons.push("STALE_UNDATED");
      if (!reasons.length) return [];
      return [cand(taskPriorityReview, {
        key: "task.priority_review",
        title: "Quizá toque revisar prioridades",
        summary: reasons.includes("URGENT_OVERLOAD") ? `Hay ${urgent.length} tareas marcadas como urgentes a la vez.` : `Hay ${stale.length} tareas antiguas sin fecha.`,
        impact: 0.4, urgency: 0.2, basis: "fact", sample: { n: o.length, full: 10 },
        evidence: { refs: [...urgent, ...stale].slice(0, 20).map((t) => ({ type: "task", id: t.id })), metrics: { urgent: urgent.length, staleUndated: stale.length }, period: { from: s.today, to: s.today } },
        reasonCodes: reasons, actions: [nav("tasks")], signature: `${urgent.length}:${stale.length}`,
      })];
    },
    describe(c, s, cfg) {
      const m = c.evidence.metrics;
      return {
        situation: "La distribución actual de prioridades o fechas puede dificultar decidir qué hacer primero.",
        data: [`${m.urgent} tareas abiertas en P1 (umbral: ${cfg.tasks.urgentOverload}).`, `${m.staleUndated} tareas abiertas con más de ${cfg.tasks.staleDays} días y sin fecha (umbral: ${cfg.tasks.staleMin}).`],
        period: { from: s.today, to: s.today, label: "Estado actual" }, patterns: [],
        hypotheses: ["Si todo es urgente, la prioridad deja de distinguir. Es una observación general, no una conclusión sobre tu caso."],
      };
    },
  };

  /* =============== HÁBITOS =============== */

  const dropOf = (h, s, cfg) => {
    if (h.frequency === "Semanal") return null;
    const hc = cfg.habits, end = L.addDays(s.today, -1);
    const recent = P.habitWindow(h, L.addDays(end, -(hc.recentDays - 1)), end);
    const base = P.habitWindow(h, L.addDays(end, -(hc.recentDays + hc.baselineDays - 1)), L.addDays(end, -hc.recentDays));
    if (recent.due < hc.minDueRecent || base.due < hc.minDueBaseline) return null;
    const drop = Math.round((base.rate - recent.rate) * 100);
    return { recent, base, drop, hit: base.rate >= 0.5 && drop >= hc.dropPoints };
  };

  const habitPending = {
    id: "habit.pending_today", module: "habits", version: 1, label: "Hábitos pendientes hoy",
    description: "Hábitos que tocan hoy y aún no están marcados, a partir de cierta hora.",
    minData: (s) => (s.habits.length ? ok : no("No hay hábitos creados.")),
    detect(s, cfg) {
      if (s.hour < cfg.habits.eveningHour) return [];
      const pend = s.habits.filter((h) => h.createdDay <= s.today && L.habitStatusToday(h.frequency, h.days, s.today) === "pending");
      if (!pend.length) return [];
      const atRisk = pend.filter((h) => L.habitStreak(h.frequency, h.days, s.today) >= 3);
      const span = Math.max(1, 24 - cfg.habits.eveningHour);
      return [cand(habitPending, {
        key: "habit.pending_today",
        title: pend.length === 1 ? "Te queda un hábito por marcar hoy" : `Te quedan ${pend.length} hábitos por marcar hoy`,
        summary: atRisk.length ? "Alguno tiene una racha en marcha; puedes hacer una versión corta o dejarlo para mañana." : "Si hoy no es el día, no pasa nada.",
        impact: clamp(0.25 + 0.1 * atRisk.length), urgency: clamp(0.3 + ((s.hour - cfg.habits.eveningHour) / span) * 0.45, 0, 0.75),
        basis: "fact", sample: { n: pend.length, full: 1 },
        evidence: { refs: pend.map((h) => ({ type: "habit", id: h.id })), metrics: { pending: pend.length, streaksAtRisk: atRisk.length, hour: s.hour }, period: { from: s.today, to: s.today } },
        reasonCodes: ["HABIT_PENDING_TODAY", ...(atRisk.length ? ["STREAK_AT_RISK"] : [])],
        actions: [nav("habits")], signature: `${s.today}:${pend.length}`,
      })];
    },
    describe(c, s, cfg) {
      const ids = new Set(c.evidence.refs.map((r) => r.id));
      const hs = s.habits.filter((h) => ids.has(h.id));
      const patterns = [];
      for (const h of hs) {
        const prof = P.habitWeekdayProfile(h, s.today, cfg.habits.weekdayDays)[s.weekday];
        if (prof.due >= cfg.habits.weekdayMinDue) patterns.push(`«${h.name}»: los ${WEEKDAYS[s.weekday]} lo has cumplido ${prof.done} de ${prof.due} veces en las últimas ${cfg.habits.weekdayDays / 7} semanas.`);
      }
      return {
        situation: `Pasadas las ${cfg.habits.eveningHour}:00, ${plural(hs.length, "hábito que toca hoy sigue", "hábitos que tocan hoy siguen")} sin marcar.`,
        data: hs.map((h) => `«${h.name}» (${h.frequency}) · racha actual: ${plural(L.habitStreak(h.frequency, h.days, s.today), "día", "días")}`),
        period: { from: s.today, to: s.today, label: "Hoy" }, patterns,
        hypotheses: ["Puede que ya lo hayas hecho sin registrarlo; el asistente solo ve lo marcado."],
      };
    },
  };

  const habitDrop = {
    id: "habit.regularity_drop", module: "habits", version: 1, label: "Descenso de regularidad",
    description: "Un hábito cumplido con regularidad que ha bajado de forma sostenida.",
    minData: (s) => (s.habits.some((h) => h.frequency !== "Semanal" && h.days.size >= 10) ? ok : no("Ningún hábito tiene historial suficiente (10+ registros).")),
    detect(s, cfg) {
      const out = [];
      for (const h of s.habits) {
        const d = dropOf(h, s, cfg);
        if (!d || !d.hit) continue;
        out.push(cand(habitDrop, {
          key: `habit.regularity_drop:${h.id}`,
          title: "Un hábito ha bajado de ritmo",
          summary: `Del ${Math.round(d.base.rate * 100)}% al ${Math.round(d.recent.rate * 100)}% en las últimas ${cfg.habits.recentDays} jornadas. Nada grave: a veces cambian las circunstancias.`,
          impact: 0.4, urgency: 0.25, basis: "pattern", sample: { n: d.recent.due + d.base.due, full: cfg.habits.minDueRecent + cfg.habits.minDueBaseline + 14 },
          consistency: clamp(d.drop / 60, 0.4, 1),
          evidence: { refs: [{ type: "habit", id: h.id }], metrics: { baselineRate: Math.round(d.base.rate * 100), recentRate: Math.round(d.recent.rate * 100), dropPoints: d.drop, recentDue: d.recent.due, baselineDue: d.base.due }, period: { from: d.base.from, to: d.recent.to } },
          reasonCodes: ["SUSTAINED_DROP"], actions: [nav("habits", h.id)], signature: `${h.id}:${Math.floor(d.drop / 10)}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} hábitos han bajado de ritmo`,
    describe(c, s, cfg) {
      const m = c.evidence.metrics, h = s.habits.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: `«${h ? h.name : "Un hábito"}» se cumplía bastante más antes que en las últimas semanas.`,
        data: [`Periodo reciente (${cfg.habits.recentDays} días): ${m.recentRate}% de los días que tocaba (${m.recentDue} días).`, `Periodo anterior (${cfg.habits.baselineDays} días): ${m.baselineRate}% (${m.baselineDue} días).`, `Diferencia: ${m.dropPoints} puntos porcentuales.`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `${cfg.habits.baselineDays} días de referencia + ${cfg.habits.recentDays} días recientes (sin contar hoy)` },
        patterns: ["La bajada se mantiene en todo el periodo reciente, no es un único día malo."],
        hypotheses: ["No se conoce el motivo: puede ser un cambio de horario, de objetivo o simplemente una etapa distinta."],
      };
    },
  };

  const habitWeekday = {
    id: "habit.weekday_pattern", module: "habits", version: 1, label: "Patrón por día de la semana",
    description: "Un hábito que casi siempre se omite el mismo día de la semana.",
    minData: (s, cfg) => (s.habits.some((h) => h.frequency !== "Semanal" && L.dayDiff(s.today, h.createdDay) >= cfg.habits.weekdayDays / 2) ? ok : no("Ningún hábito diario tiene suficientes semanas de historia.")),
    detect(s, cfg) {
      const out = [];
      for (const h of s.habits) {
        if (h.frequency === "Semanal") continue;
        const prof = P.habitWeekdayProfile(h, s.today, cfg.habits.weekdayDays);
        const w = prof.reduce((best, p, i) => (p.due >= cfg.habits.weekdayMinDue && (best < 0 || p.done / p.due < prof[best].done / prof[best].due) ? i : best), -1);
        if (w < 0) continue;
        const others = prof.filter((_, i) => i !== w), due = P.sum(others.map((p) => p.due)), done = P.sum(others.map((p) => p.done));
        const wRate = prof[w].done / prof[w].due;
        if (!(due >= 12 && done / due >= 0.6 && wRate <= 0.25)) continue;
        const relevantNow = s.weekday === w || (s.weekday + 1) % 7 === w;
        out.push(cand(habitWeekday, {
          key: `habit.weekday_pattern:${h.id}`, timing: relevantNow ? "now" : "later",
          title: `Los ${WEEKDAYS[w]} suele costar un hábito`,
          summary: `Lo has cumplido ${prof[w].done} de ${prof[w].due} ${WEEKDAYS[w]} frente al ${Math.round((done / due) * 100)}% el resto de días.`,
          impact: 0.3, urgency: s.weekday === w ? 0.45 : 0.3, basis: "pattern", sample: { n: prof[w].due, full: 8 }, consistency: clamp(1 - wRate),
          evidence: { refs: [{ type: "habit", id: h.id }], metrics: { weekday: w, dayDone: prof[w].done, dayDue: prof[w].due, otherRate: Math.round((done / due) * 100) }, period: { from: L.addDays(s.today, -cfg.habits.weekdayDays), to: L.addDays(s.today, -1) } },
          reasonCodes: ["WEEKDAY_PATTERN"], actions: [nav("habits", h.id)], signature: `${h.id}:${w}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} hábitos tienen un día flojo recurrente`,
    describe(c, s, cfg) {
      const m = c.evidence.metrics, h = s.habits.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: `«${h ? h.name : "Un hábito"}» se omite con frecuencia los ${WEEKDAYS[m.weekday]}.`,
        data: [`Los ${WEEKDAYS[m.weekday]}: ${m.dayDone} de ${m.dayDue} cumplidos.`, `El resto de días: ${m.otherRate}% cumplido.`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Últimas ${cfg.habits.weekdayDays / 7} semanas completas` },
        patterns: [`Son ${m.dayDue} ${WEEKDAYS[m.weekday]} observados: es un patrón de pocas repeticiones.`],
        hypotheses: ["Puede deberse a la agenda de ese día; no hay datos sobre el motivo. Podrías mover el hábito o hacerlo más corto ese día."],
      };
    },
  };

  const habitReview = {
    id: "habit.review_plan", module: "habits", version: 1, label: "Revisar un hábito",
    description: "Hábitos con cumplimiento bajo durante un mes completo.",
    minData: (s, cfg) => (s.habits.some((h) => L.dayDiff(s.today, h.createdDay) >= cfg.habits.reviewMinAge) ? ok : no("Ningún hábito tiene un mes de antigüedad.")),
    detect(s, cfg) {
      const out = [], hc = cfg.habits, end = L.addDays(s.today, -1);
      for (const h of s.habits) {
        if (L.dayDiff(s.today, h.createdDay) < hc.reviewMinAge) continue;
        const w = P.habitWindow(h, L.addDays(end, -(hc.reviewDays - 1)), end);
        const minDue = h.frequency === "Semanal" ? 3 : 20;
        if (w.due < minDue || w.rate >= hc.reviewRate) continue;
        const d = dropOf(h, s, cfg);
        if (d && d.hit) continue; // ya lo cubre «descenso de regularidad»
        out.push(cand(habitReview, {
          key: `habit.review_plan:${h.id}`,
          title: "Un hábito cuesta mantenerlo",
          summary: `Cumplido ${w.done} de ${w.due} en ${hc.reviewDays} días. Quizá convenga ajustar su frecuencia o dificultad.`,
          impact: 0.35, urgency: 0.15, basis: "pattern", sample: { n: w.due, full: 30 }, consistency: clamp(1 - w.rate),
          evidence: { refs: [{ type: "habit", id: h.id }], metrics: { done: w.done, due: w.due, ratePct: Math.round(w.rate * 100) }, period: { from: w.from, to: w.to } },
          reasonCodes: ["LOW_COMPLETION_MONTH"],
          actions: [nav("habits", h.id), ...(h.frequency === "Diario" ? [{ type: "habit.set_frequency", params: { habitId: h.id, frequency: "Entre semana" }, label: "Pasar a entre semana" }] : [])],
          signature: `${h.id}:${Math.floor(w.rate * 10)}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} hábitos podrían necesitar un ajuste`,
    describe(c, s, cfg) {
      const m = c.evidence.metrics, h = s.habits.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: `«${h ? h.name : "Un hábito"}» se ha cumplido pocas veces en el último mes.`,
        data: [`${m.done} de ${m.due} jornadas que tocaban (${m.ratePct}%).`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `${cfg.habits.reviewDays} días hasta ayer` },
        patterns: [], hypotheses: ["Un cumplimiento bajo no significa que el hábito no importe: puede que su formato no encaje ahora. Decides tú si ajustarlo, pausarlo o mantenerlo."],
      };
    },
  };

  /* =============== SESIONES DE CONCENTRACIÓN =============== */

  const windows = (s, cfg) => {
    const n = cfg.focus.windowDays;
    const recent = P.sessionWindow(s.sessions, L.addDays(s.today, -(n - 1)), s.today);
    const prior = P.sessionWindow(s.sessions, L.addDays(s.today, -(2 * n - 1)), L.addDays(s.today, -n));
    return { recent, prior, n };
  };

  const focusFreq = {
    id: "focus.frequency_change", module: "timer", version: 1, label: "Cambio en la frecuencia de sesiones",
    description: "Compara el número de sesiones de las dos últimas quincenas.",
    minData: (s, cfg) => (windows(s, cfg).prior.count >= cfg.focus.minPrior ? ok : no(`Se necesitan al menos ${cfg.focus.minPrior} sesiones en la quincena anterior para comparar.`)),
    detect(s, cfg) {
      const { recent, prior, n } = windows(s, cfg);
      if (prior.count < cfg.focus.minPrior) return [];
      const ch = P.change(recent.count, prior.count);
      if (ch == null || Math.abs(ch) < cfg.focus.freqChangePct) return [];
      const down = ch < 0;
      return [cand(focusFreq, {
        key: "focus.frequency_change",
        title: down ? "Has hecho menos sesiones de concentración" : "Has hecho más sesiones de concentración",
        summary: `${recent.count} sesiones en los últimos ${n} días frente a ${prior.count} en los ${n} anteriores.`,
        impact: down ? 0.3 : 0.2, urgency: down ? 0.2 : 0.1, basis: "pattern", sample: { n: prior.count + recent.count, full: 12 }, consistency: P.clamp(Math.abs(ch) / 100, 0.4, 1),
        evidence: { refs: [], metrics: { recentCount: recent.count, priorCount: prior.count, changePct: ch }, period: { from: prior.from, to: recent.to } },
        reasonCodes: [down ? "FOCUS_FREQUENCY_DOWN" : "FOCUS_FREQUENCY_UP"], actions: [nav("timer")], signature: `${down ? "d" : "u"}:${Math.floor(Math.abs(ch) / 20)}`,
      })];
    },
    describe(c, s, cfg) {
      const m = c.evidence.metrics;
      return {
        situation: `El número de sesiones ha ${m.changePct < 0 ? "bajado" : "subido"} un ${Math.abs(m.changePct)}% entre dos periodos de ${cfg.focus.windowDays} días.`,
        data: [`Últimos ${cfg.focus.windowDays} días: ${m.recentCount} sesiones.`, `${cfg.focus.windowDays} días anteriores: ${m.priorCount} sesiones.`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Dos quincenas consecutivas (${2 * cfg.focus.windowDays} días)` }, patterns: [],
        hypotheses: ["Un cambio de ritmo puede ser normal (vacaciones, exámenes, otras prioridades). No indica un problema por sí mismo."],
      };
    },
  };

  const focusDur = {
    id: "focus.duration_change", module: "timer", version: 1, label: "Cambio en la duración de sesiones",
    description: "Compara la duración media de las sesiones de las dos últimas quincenas.",
    minData: (s, cfg) => { const w = windows(s, cfg); return w.prior.count >= cfg.focus.minPrior && w.recent.count >= cfg.focus.minPrior ? ok : no(`Se necesitan al menos ${cfg.focus.minPrior} sesiones en cada quincena.`); },
    detect(s, cfg) {
      const { recent, prior } = windows(s, cfg);
      if (prior.count < cfg.focus.minPrior || recent.count < cfg.focus.minPrior) return [];
      const ch = P.change(recent.avgMs, prior.avgMs);
      if (ch == null || Math.abs(ch) < cfg.focus.durChangePct) return [];
      const down = ch < 0;
      return [cand(focusDur, {
        key: "focus.duration_change",
        title: down ? "Tus sesiones están siendo más cortas" : "Tus sesiones están siendo más largas",
        summary: `Duración media: ${L.formatDuration(recent.avgMs)} frente a ${L.formatDuration(prior.avgMs)}.`,
        impact: 0.25, urgency: 0.1, basis: "pattern", sample: { n: prior.count + recent.count, full: 12 }, consistency: P.clamp(Math.abs(ch) / 100, 0.4, 1),
        evidence: { refs: [], metrics: { recentAvgMs: Math.round(recent.avgMs), priorAvgMs: Math.round(prior.avgMs), changePct: ch, recentCount: recent.count, priorCount: prior.count }, period: { from: prior.from, to: recent.to } },
        reasonCodes: [down ? "FOCUS_DURATION_DOWN" : "FOCUS_DURATION_UP"], actions: [nav("timer")], signature: `${down ? "d" : "u"}:${Math.floor(Math.abs(ch) / 15)}`,
      })];
    },
    describe(c, s, cfg) {
      const m = c.evidence.metrics;
      return {
        situation: `La duración media de tus sesiones ha cambiado un ${m.changePct > 0 ? "+" : ""}${m.changePct}%.`,
        data: [`Últimos ${cfg.focus.windowDays} días: ${L.formatDuration(m.recentAvgMs)} de media (${m.recentCount} sesiones).`, `${cfg.focus.windowDays} días anteriores: ${L.formatDuration(m.priorAvgMs)} de media (${m.priorCount} sesiones).`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Dos quincenas consecutivas" }, patterns: [],
        hypotheses: ["La duración depende del tipo de tarea; no se distingue entre estudio, trabajo u otras actividades."],
      };
    },
  };

  const focusPropose = {
    id: "focus.propose_session", module: "timer", version: 1, label: "Proponer una sesión",
    description: "Si sueles hacer sesiones y hay una tarea pendiente relevante, propone preparar una.",
    minData: (s, cfg) => (P.sessionWindow(s.sessions, L.addDays(s.today, -13), s.today).count >= cfg.focus.minRecentForProposal ? ok : no("Hay pocas sesiones recientes: no consta que uses esta herramienta con regularidad.")),
    detect(s, cfg) {
      if (s.hour < cfg.focus.startHour || s.hour > cfg.focus.endHour) return [];
      const rec = P.sessionWindow(s.sessions, L.addDays(s.today, -13), s.today);
      if (rec.count < cfg.focus.minRecentForProposal) return [];
      if (s.sessions.some((x) => x.day === s.today)) return [];
      const lim = L.addDays(s.today, 2);
      const t = open(s).filter((x) => x.prio <= 2 || (x.due_date && x.due_date <= lim)).sort(byUrgency)[0];
      if (!t) return [];
      const minutes = clamp(Math.round(P.median(s.sessions.filter((x) => x.day >= L.addDays(s.today, -13)).map((x) => x.ms / 60000)) / 5) * 5, 15, 90);
      return [cand(focusPropose, {
        key: "focus.propose_session",
        title: "¿Una sesión de concentración hoy?",
        summary: `Hoy aún no has hecho ninguna y hay una tarea relevante pendiente. Tus sesiones suelen durar unos ${minutes} min.`,
        impact: 0.35, urgency: t.due_date && t.due_date <= s.today ? 0.5 : 0.3, basis: "pattern", sample: { n: rec.count, full: 8 }, consistency: clamp(rec.activeDays / 7, 0.5, 1),
        evidence: { refs: [{ type: "task", id: t.id }], metrics: { recentSessions: rec.count, activeDays: rec.activeDays, suggestedMinutes: minutes }, period: { from: rec.from, to: rec.to } },
        reasonCodes: ["NO_SESSION_TODAY", "RELEVANT_TASK_PENDING"],
        actions: [{ type: "timer.prepare_session", params: { label: "Sesión de concentración", minutes, taskId: t.id }, label: "Preparar sesión" }],
        signature: `${s.today}:${t.id}`,
      })];
    },
    describe(c, s, cfg) {
      const m = c.evidence.metrics, t = s.tasks.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: "Hoy no hay sesiones registradas y existe una tarea que podría beneficiarse de una.",
        data: [t ? `Tarea: «${t.title}» · ${L.PRIO_LABELS[t.prio]}${t.due_date ? " · vence el " + L.shortDate(t.due_date) : ""}` : "La tarea ya no existe.", `Sesiones en los últimos 14 días: ${m.recentSessions} en ${m.activeDays} días distintos.`, `Duración propuesta: ${m.suggestedMinutes} min (mediana de tus sesiones recientes, redondeada a 5).`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Últimos 14 días" }, patterns: [`Has usado el temporizador en ${m.activeDays} de los últimos 14 días.`],
        hypotheses: ["Se asume que la tarea elegida es la más adecuada por su prioridad/fecha; el asistente no sabe cuánta energía o tiempo tienes."],
      };
    },
  };

  /* =============== FINANZAS =============== */

  const monthExpenses = (s) => P.spendUpTo(s.transactions, L.monthKey(s.today), 31);

  const finBudget = {
    id: "finance.budget_near", module: "finance", version: 1, label: "Presupuesto cerca del límite",
    description: "Categorías (o el total) que alcanzan un porcentaje alto del presupuesto del mes, según los movimientos registrados.",
    minData: (s) => (!s.budgets.length ? no("No hay presupuestos definidos.") : monthExpenses(s).count ? ok : no("Este mes no hay gastos registrados.")),
    detect(s, cfg) {
      const mk = L.monthKey(s.today), spent = monthExpenses(s), out = [];
      const dom = Number(s.today.slice(8)), days = L.monthBounds(mk).days;
      for (const b of s.budgets) {
        const isTotal = b.category === "";
        const sp = isTotal ? spent.total : spent.byCategory[b.category] || 0;
        const pct = Math.round((sp / b.cents) * 100);
        if (pct < cfg.finance.nearPct) continue;
        const over = pct >= 100, name = isTotal ? "el presupuesto total" : `«${b.category}»`;
        out.push(cand(finBudget, {
          key: `finance.budget_near:${isTotal ? "_total" : b.category}`,
          title: over ? `Has superado ${name}` : `${isTotal ? "El presupuesto total" : `«${b.category}»`} va por el ${pct}%`,
          summary: over ? `Llevas ${eur(sp)} de ${eur(b.cents)} este mes.` : `Llevas ${eur(sp)} de ${eur(b.cents)}; quedan ${eur(b.cents - sp)} y ${plural(days - dom, "día", "días")} de mes.`,
          impact: over ? 0.7 : 0.5, urgency: over ? 0.7 : clamp(0.4 + ((pct - cfg.finance.nearPct) / (100 - cfg.finance.nearPct)) * 0.25),
          basis: "fact", sample: { n: 1, full: 1 },
          evidence: { refs: [], metrics: { category: isTotal ? null : b.category, spentCents: sp, limitCents: b.cents, pct, dayOfMonth: dom, daysInMonth: days }, period: { from: `${mk}-01`, to: s.today } },
          reasonCodes: [over ? "BUDGET_EXCEEDED" : "BUDGET_NEAR_LIMIT"], actions: [nav("finance")], signature: `${isTotal ? "_total" : b.category}:${over ? "o" : Math.floor(pct / 5)}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} presupuestos están cerca del límite`,
    describe(c, s, cfg) {
      const m = c.evidence.metrics;
      return {
        situation: `${m.category ? `La categoría «${m.category}»` : "El gasto total"} ha alcanzado el ${m.pct}% de su presupuesto mensual (umbral de aviso: ${cfg.finance.nearPct}%).`,
        data: [`Gastado: ${eur(m.spentCents)}.`, `Presupuesto: ${eur(m.limitCents)}.`, `${m.pct >= 100 ? "Exceso" : "Margen"}: ${eur(Math.abs(m.limitCents - m.spentCents))}.`, `Día ${m.dayOfMonth} de ${m.daysInMonth} del mes.`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Mes en curso, solo movimientos registrados" }, patterns: [],
        hypotheses: ["Solo cuenta lo que has anotado: gastos sin registrar no aparecen aquí. No se hace ninguna previsión de fin de mes."],
      };
    },
  };

  const finChange = {
    id: "finance.period_change", module: "finance", version: 1, label: "Cambio frente a periodos comparables",
    description: "Gasto del mes hasta hoy frente al mismo tramo del mes anterior (y de los tres anteriores si hay datos).",
    minData: (s, cfg) => {
      if (Number(s.today.slice(8)) < cfg.finance.minDayOfMonth) return no(`Hasta el día ${cfg.finance.minDayOfMonth} del mes no hay tramo suficiente para comparar.`);
      const prev = P.spendUpTo(s.transactions, L.addMonths(L.monthKey(s.today), -1), Number(s.today.slice(8)));
      return prev.count ? ok : no("No hay gastos registrados en el mismo tramo del mes anterior.");
    },
    detect(s, cfg) {
      const mk = L.monthKey(s.today), dom = Number(s.today.slice(8)), out = [];
      if (dom < cfg.finance.minDayOfMonth) return out;
      const cur = P.spendUpTo(s.transactions, mk, dom);
      const prevs = [1, 2, 3, 4].map((i) => P.spendUpTo(s.transactions, L.addMonths(mk, -i), dom));
      const prev = prevs[0];
      if (!prev.count) return out;
      const older = prevs.slice(1).filter((p) => p.count);
      const cats = new Set([...Object.keys(cur.byCategory), ""]);
      for (const cat of cats) {
        const isTotal = cat === "";
        const now = isTotal ? cur.total : cur.byCategory[cat] || 0, before = isTotal ? prev.total : prev.byCategory[cat] || 0;
        const ch = P.change(now, before);
        if (before < cfg.finance.minPrevCents || ch == null || ch < cfg.finance.changePct || now - before < cfg.finance.changeMinCents) continue;
        const olderVals = older.map((p) => (isTotal ? p.total : p.byCategory[cat] || 0));
        const avgOlder = olderVals.length ? Math.round(P.mean(olderVals)) : null;
        const agrees = avgOlder != null && now > avgOlder;
        out.push(cand(finChange, {
          key: `finance.period_change:${isTotal ? "_total" : cat}`,
          title: isTotal ? "Este mes llevas más gasto que el anterior" : `Gasto en «${cat}» por encima del mes pasado`,
          summary: `${eur(now)} hasta el día ${dom}, frente a ${eur(before)} en el mismo tramo del mes anterior (+${ch}%).`,
          impact: clamp(0.3 + ch / 400), urgency: 0.25, basis: "pattern", sample: { n: 1 + olderVals.length, full: 3 }, consistency: agrees ? 1 : 0.7,
          evidence: { refs: [], metrics: { category: isTotal ? null : cat, nowCents: now, prevCents: before, changePct: ch, upToDay: dom, olderMonthsUsed: olderVals.length, olderAvgCents: avgOlder }, period: { from: `${mk}-01`, to: s.today } },
          reasonCodes: ["SPEND_ABOVE_PREVIOUS_PERIOD", ...(agrees ? ["ABOVE_OLDER_AVERAGE"] : [])], actions: [nav("finance")], signature: `${isTotal ? "_total" : cat}:${Math.floor(ch / 20)}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} categorías de gasto están por encima del mes pasado`,
    describe(c, s) {
      const m = c.evidence.metrics;
      const data = [`Mes en curso hasta el día ${m.upToDay}: ${eur(m.nowCents)}.`, `Mes anterior, mismo tramo: ${eur(m.prevCents)}.`, `Variación: +${m.changePct}% (+${eur(m.nowCents - m.prevCents)}).`];
      if (m.olderAvgCents != null) data.push(`Media de ${plural(m.olderMonthsUsed, "mes previo", "meses previos")} con datos (mismo tramo): ${eur(m.olderAvgCents)}.`);
      return {
        situation: `${m.category ? `El gasto en «${m.category}»` : "El gasto total"} es mayor que en el tramo equivalente del mes anterior.`,
        data, period: { from: c.evidence.period.from, to: c.evidence.period.to, label: `Días 1–${m.upToDay} de cada mes comparado` },
        patterns: m.olderAvgCents != null ? [m.nowCents > m.olderAvgCents ? "También supera la media de meses anteriores." : "No supera la media de meses anteriores: puede ser un mes puntualmente bajo el pasado."] : [],
        hypotheses: ["Un pago grande o puntual puede explicar la diferencia. El asistente no distingue gastos extraordinarios de habituales."],
      };
    },
  };

  /* =============== OBJETIVOS =============== */
  // La app actual no tiene módulo de objetivos: estas reglas solo actúan si se le pasan `goals` (y, opcionalmente, tareas con goal_id).

  const goalProgressDay = (g, s) => {
    const days = [g.lastProgressDay, g.createdDay, ...s.tasks.filter((t) => t.goalId === g.id && t.completedDay).map((t) => t.completedDay)].filter(Boolean);
    return days.sort().pop() || null;
  };
  const activeGoals = (s) => s.goals.filter((g) => g.status === "active");

  const goalStale = {
    id: "goal.no_progress", module: "goals", version: 1, label: "Objetivo sin avances",
    description: "Objetivos activos sin actividad durante un periodo configurable.",
    minData: (s) => (activeGoals(s).length ? ok : no("No hay objetivos activos.")),
    detect(s, cfg) {
      const out = [];
      for (const g of activeGoals(s)) {
        const last = goalProgressDay(g, s);
        if (!last) continue;
        const idle = L.dayDiff(s.today, last);
        if (idle < cfg.goals.staleDays) continue;
        out.push(cand(goalStale, {
          key: `goal.no_progress:${g.id}`, title: "Un objetivo lleva tiempo sin avances",
          summary: `La última actividad conocida fue hace ${plural(idle, "día", "días")}. ¿Definimos un siguiente paso pequeño o lo pausamos?`,
          impact: 0.4, urgency: clamp(0.2 + (idle - cfg.goals.staleDays) / 120, 0.2, 0.5), basis: "fact", sample: { n: 1, full: 1 },
          evidence: { refs: [{ type: "goal", id: g.id }], metrics: { idleDays: idle, lastProgressDay: last }, period: { from: last, to: s.today } },
          reasonCodes: ["GOAL_IDLE"], actions: [nav("dashboard", g.id)], signature: `${g.id}:${Math.floor(idle / 14)}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} objetivos llevan tiempo sin avances`,
    describe(c, s, cfg) {
      const m = c.evidence.metrics, g = s.goals.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: `«${g ? g.title : "Un objetivo"}» sigue activo pero sin actividad registrada desde hace ${plural(m.idleDays, "día", "días")} (umbral: ${cfg.goals.staleDays}).`,
        data: [`Última actividad conocida: ${L.shortDate(m.lastProgressDay)}.`, "Se cuentan avances del objetivo y tareas vinculadas completadas."],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Desde la última actividad conocida" }, patterns: [],
        hypotheses: ["Puede que el avance ocurra fuera de la app. El asistente solo ve lo registrado."],
      };
    },
  };

  const goalMilestone = {
    id: "goal.milestone_upcoming", module: "goals", version: 1, label: "Hito próximo",
    description: "Hitos no completados con fecha en los próximos días.",
    minData: (s) => (activeGoals(s).some((g) => g.milestones.length) ? ok : no("Ningún objetivo activo tiene hitos.")),
    detect(s, cfg) {
      const out = [], lim = L.addDays(s.today, cfg.goals.milestoneDays);
      for (const g of activeGoals(s)) for (const m of g.milestones) {
        if (m.done || !m.due_date || m.due_date < s.today || m.due_date > lim) continue;
        const left = L.dayDiff(m.due_date, s.today);
        out.push(cand(goalMilestone, {
          key: `goal.milestone_upcoming:${g.id}:${m.id}`, title: left === 0 ? "Un hito vence hoy" : `Un hito vence en ${plural(left, "día", "días")}`,
          summary: "Revisa si el siguiente paso está claro o si conviene mover la fecha.", impact: 0.55, urgency: clamp(0.8 - left * 0.08), basis: "fact", sample: { n: 1, full: 1 },
          evidence: { refs: [{ type: "goal", id: g.id }, { type: "milestone", id: m.id }], metrics: { daysLeft: left, due: m.due_date }, period: { from: s.today, to: m.due_date } },
          reasonCodes: ["MILESTONE_NEAR"], actions: [nav("dashboard", g.id)], signature: `${m.id}:${left}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} hitos vencen pronto`,
    describe(c, s) {
      const g = s.goals.find((x) => x.id === c.evidence.refs[0].id), mid = c.evidence.refs[1].id, m = g && g.milestones.find((x) => x.id === mid);
      return {
        situation: `${m ? `El hito «${m.title}»` : "Un hito"} del objetivo «${g ? g.title : "?"}» vence el ${L.shortDate(c.evidence.metrics.due)}.`,
        data: [`Fecha: ${L.shortDate(c.evidence.metrics.due)} (en ${plural(c.evidence.metrics.daysLeft, "día", "días")}).`],
        period: { from: c.evidence.period.from, to: c.evidence.period.to, label: "Hasta la fecha del hito" }, patterns: [], hypotheses: [],
      };
    },
  };

  const goalReview = {
    id: "goal.review_split", module: "goals", version: 1, label: "Revisar o dividir un objetivo",
    description: "Objetivos con hitos vencidos o sin ninguna tarea abierta que los haga avanzar.",
    minData: (s) => (activeGoals(s).some((g) => g.milestones.length) ? ok : no("Ningún objetivo activo tiene hitos.")),
    detect(s, cfg) {
      const out = [];
      for (const g of activeGoals(s)) {
        const pend = g.milestones.filter((m) => !m.done);
        if (!pend.length) continue;
        const overdue = pend.filter((m) => m.due_date && m.due_date < s.today);
        const openTasks = s.tasks.filter((t) => t.goalId === g.id && t.status !== "done").length;
        const last = goalProgressDay(g, s);
        const stale = last && L.dayDiff(s.today, last) >= cfg.goals.staleDays;
        const noNext = openTasks === 0 && !stale; // si está inactivo ya lo cubre «sin avances»
        if (!overdue.length && !noNext) continue;
        out.push(cand(goalReview, {
          key: `goal.review_split:${g.id}`, title: overdue.length ? "Un objetivo tiene hitos vencidos" : "Un objetivo no tiene siguiente paso",
          summary: overdue.length ? `${plural(overdue.length, "hito ha pasado", "hitos han pasado")} de fecha. Puede ser buen momento para reajustarlo o dividirlo.` : "Tiene hitos pendientes pero ninguna tarea abierta vinculada.",
          impact: 0.45, urgency: overdue.length ? 0.4 : 0.25, basis: "fact", sample: { n: 1, full: 1 },
          evidence: { refs: [{ type: "goal", id: g.id }], metrics: { overdueMilestones: overdue.length, pendingMilestones: pend.length, openLinkedTasks: openTasks }, period: { from: s.today, to: s.today } },
          reasonCodes: [...(overdue.length ? ["MILESTONE_OVERDUE"] : []), ...(openTasks === 0 ? ["NO_NEXT_STEP"] : [])], actions: [nav("dashboard", g.id)], signature: `${g.id}:${overdue.length}:${openTasks}`,
        }));
      }
      return out;
    },
    groupTitle: (n) => `${n} objetivos conviene revisarlos`,
    describe(c, s) {
      const m = c.evidence.metrics, g = s.goals.find((x) => x.id === c.evidence.refs[0].id);
      return {
        situation: `«${g ? g.title : "Un objetivo"}» tiene hitos pendientes y ${m.overdueMilestones ? "alguno fuera de fecha" : "ninguna tarea abierta vinculada"}.`,
        data: [`Hitos pendientes: ${m.pendingMilestones} (vencidos: ${m.overdueMilestones}).`, `Tareas abiertas vinculadas: ${m.openLinkedTasks}.`],
        period: { from: s.today, to: s.today, label: "Estado actual" }, patterns: [],
        hypotheses: ["Un hito vencido puede indicar que era demasiado grande o que cambió el plan. Dividirlo es una opción, no una obligación."],
      };
    },
  };

  const RULES = [taskOverdue, taskImportant, taskAccumulation, taskPostponement, taskPriorityReview, habitPending, habitDrop, habitWeekday, habitReview, focusFreq, focusDur, focusPropose, finBudget, finChange, goalStale, goalMilestone, goalReview];
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));

  function mergeConfig(over = {}) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(over[k] || {}) };
    return out;
  }

  // Ejecuta las reglas. Devuelve { candidates, skipped:[{ruleId,module,reason}], errors }.
  // `disabled` (Set) = reglas desactivadas por el usuario. Una regla que falle no impide las demás.
  function runAll(snapshot, config, { disabled = new Set(), pausedModules = new Set() } = {}) {
    const cfg = mergeConfig(config), candidates = [], skipped = [], errors = [];
    for (const r of RULES) {
      if (disabled.has(r.id)) { skipped.push({ ruleId: r.id, module: r.module, reason: "Regla desactivada por el usuario." }); continue; }
      if (pausedModules.has(r.module)) { skipped.push({ ruleId: r.id, module: r.module, reason: "Categoría en pausa." }); continue; }
      try {
        const m = r.minData(snapshot, cfg);
        if (!m.ok) { skipped.push({ ruleId: r.id, module: r.module, reason: m.reason }); continue; }
        candidates.push(...r.detect(snapshot, cfg));
      } catch (e) { errors.push({ ruleId: r.id, message: String(e && e.message || e) }); }
    }
    return { candidates, skipped, errors };
  }

  return { DEFAULTS, RULES, byId, mergeConfig, runAll, WEEKDAYS };
});
