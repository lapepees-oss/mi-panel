"use strict";
// Capa de contexto para una IA FUTURA. Este módulo NO llama a ningún modelo ni API: solo
//  1) construye un contexto estructurado y minimizado (por defecto sin títulos ni textos del usuario), y
//  2) valida cualquier respuesta externa con las mismas reglas que las acciones propias (catálogo + parámetros).
// Una respuesta de un modelo solo puede producir PROPUESTAS que requieren confirmación; nunca se ejecutan aquí.
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../logic.js") : root.Logic,
    typeof module === "object" && module.exports ? require("./assistantPatterns.js") : root.AssistantPatterns,
    typeof module === "object" && module.exports ? require("./assistantActions.js") : root.AssistantActions
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantAIContext = api;
})(typeof self !== "undefined" ? self : this, function (L, P, A) {
  const CONTEXT_VERSION = 1;
  const CONSTRAINTS = [
    "Las sugerencias no se convierten automáticamente en tareas ni obligaciones.",
    "Solo se pueden proponer acciones del catálogo `allowedActions`, con sus parámetros exactos.",
    "Toda acción requiere aprobación explícita del usuario; el modelo no ejecuta nada.",
    "Distingue datos confirmados, patrones observados e hipótesis, y reconoce cuándo faltan datos.",
    "No inventes movimientos, saldos, previsiones ni causas. No generes culpa por tareas o hábitos pendientes.",
  ];

  function build(snapshot, { suggestions = [], memory = [], includeTitles = false, maxItems = 25 } = {}) {
    const s = snapshot, today = s.today;
    const open = s.tasks.filter((t) => t.status !== "done");
    const label = (x, n) => (includeTitles ? { title: String(x).slice(0, n) } : {});
    const mk = L.monthKey(today), spent = P.spendUpTo(s.transactions, mk, 31);
    const w14 = P.sessionWindow(s.sessions, L.addDays(today, -13), today);
    return {
      contextVersion: CONTEXT_VERSION, purpose: "structured-context-for-external-model", generatedFor: today, includesTitles: !!includeTitles,
      constraints: CONSTRAINTS,
      tasks: {
        open: open.length, overdue: open.filter((t) => t.due_date && t.due_date < today).length, dueNext3Days: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= L.addDays(today, 3)).length,
        byPriority: [1, 2, 3, 4].map((p) => open.filter((t) => t.prio === p).length),
        items: open.slice(0, maxItems).map((t) => ({ id: t.id, prio: t.prio, due: t.due_date, ...label(t.title, 120) })),
      },
      habits: s.habits.slice(0, maxItems).map((h) => {
        const w7 = P.habitWindow(h, L.addDays(today, -7), L.addDays(today, -1)), w30 = P.habitWindow(h, L.addDays(today, -30), L.addDays(today, -1));
        return { id: h.id, frequency: h.frequency, rate7: w7.rate == null ? null : Math.round(w7.rate * 100), rate30: w30.rate == null ? null : Math.round(w30.rate * 100), streak: L.habitStreak(h.frequency, h.days, today), ...label(h.name, 80) };
      }),
      focus: { sessionsLast14Days: w14.count, activeDaysLast14: w14.activeDays, avgMinutes: w14.avgMs == null ? null : Math.round(w14.avgMs / 60000) },
      finance: { month: mk, expenseCents: spent.total, byCategoryCents: spent.byCategory, budgets: s.budgets.map((b) => ({ category: b.category || "_total", limitCents: b.cents })) },
      goals: s.goals.slice(0, maxItems).map((g) => ({ id: g.id, status: g.status, milestonesPending: g.milestones.filter((m) => !m.done).length, ...label(g.title, 120) })),
      suggestions: suggestions.map((x) => ({ id: x.id, ruleId: x.ruleId, module: x.module, priorityScore: x.priorityScore, urgency: x.urgency, confidence: x.confidence, status: x.status, reasonCodes: x.reasonCodes })),
      memory: memory.filter((m) => m.kind === "confirmed" && !m.paused).map((m) => ({ key: m.key, value: m.value, scope: m.scope })),
      dataQuality: s.quality.counts,
      allowedActions: A.describe(),
      outputContract: { proposals: [{ type: "<uno de allowedActions[].type>", params: "<según el catálogo>", rationale: "<texto breve; se mostrará al usuario como hipótesis, no como hecho>" }] },
    };
  }

  // Valida la salida de un modelo externo. Devuelve propuestas PREPARADAS (no ejecutadas) y las rechazadas con el motivo.
  function validateModelOutput(output, snapshot) {
    const list = output && Array.isArray(output.proposals) ? output.proposals : [];
    const accepted = [], rejected = [];
    for (const p of list.slice(0, 20)) {
      const prepared = A.prepare({ type: p && p.type, params: p && p.params, label: p && typeof p.rationale === "string" ? p.rationale.slice(0, 120) : undefined }, snapshot);
      if (prepared.ok) accepted.push({ ...prepared, origin: "external-model", rationale: typeof p.rationale === "string" ? p.rationale.slice(0, 300) : "", confirmed: false });
      else rejected.push({ proposal: { type: p && p.type }, errors: prepared.errors });
    }
    return { accepted, rejected, executedAnything: false };
  }

  return { CONTEXT_VERSION, CONSTRAINTS, build, validateModelOutput };
});
