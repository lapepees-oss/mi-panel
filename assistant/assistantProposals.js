"use strict";
// Explicaciones y propuestas. La explicación profunda se construye por PLANTILLAS a partir de los datos y las reglas
// realmente activadas: no inventa porcentajes, causas ni predicciones. Si no hay historial, lo dice y se basa en la situación actual.
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../logic.js") : root.Logic,
    typeof module === "object" && module.exports ? require("./assistantActions.js") : root.AssistantActions
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantProposals = api;
})(typeof self !== "undefined" ? self : this, function (L, A) {
  const SCHEMA_VERSION = 1;
  const BASIS_LABEL = {
    fact: "Dato confirmado (lectura directa de lo registrado)",
    pattern: "Patrón observado (comparación entre periodos; no es una certeza)",
    estimate: "Estimación (menos fiable que un patrón)",
  };
  const MODULE_LIMITS = {
    tasks: ["Solo se conocen las tareas registradas en CloudSpace; el trabajo hecho fuera de la app no cuenta."],
    habits: ["Los hábitos se registran por día: no se conoce la hora ni el motivo de un cumplimiento o de una omisión."],
    timer: ["Las sesiones no indican qué actividad concreta se hacía, salvo el tipo registrado."],
    finance: ["Solo cuentan los movimientos y presupuestos anotados a mano; el asistente no hace previsiones ni supone gastos no registrados."],
    goals: ["Un objetivo solo muestra el avance que se registra; el progreso real puede ser mayor o menor."],
  };

  // Versión breve de una sugerencia (lo que recibe la interfaz para pintar un aviso). Sin copias innecesarias de datos sensibles.
  function toBrief(r) {
    return {
      id: r.id, schemaVersion: SCHEMA_VERSION, ruleId: r.ruleId, module: r.module, title: r.title, summary: r.summary,
      priorityScore: r.priorityScore, urgency: r.urgency, confidence: r.confidence, createdAt: r.createdAt, status: r.status,
      evidence: r.evidence, reasonCodes: r.reasonCodes, actions: r.actions, cooldownUntil: r.cooldownUntil || null,
    };
  }

  // Valida y prepara (sin ejecutar) las acciones propuestas contra la instantánea actual.
  function prepareActions(actions, snapshot) {
    return (actions || []).map((a) => A.prepare(a, snapshot));
  }

  /* El describe() de cada regla aporta situación, datos, periodo, patrones e hipótesis. Aquí se añaden las partes comunes. */
  function build({ record, scored, parts, rules, snapshot, preparedActions }) {
    const basis = scored.basis;
    const limits = [];
    const q = snapshot.quality;
    const involved = new Set(rules.map((r) => r.module));
    for (const m of involved) limits.push(...(MODULE_LIMITS[m] || []));
    if (basis === "fact") limits.push("Esta sugerencia se basa únicamente en la situación actual; no se ha analizado un historial.");
    if (scored.sampleShort) limits.push("La muestra es menor que la necesaria para confianza plena; trátalo como orientativo.");
    const dropped = Object.entries(q.dropped || {}).filter(([m]) => involved.has(m) || (m === "habits" && involved.has("habits")));
    for (const [m, n] of dropped) limits.push(`${n} registros de «${m}» se descartaron por datos incompletos o inválidos.`);
    if (record.pastFeedback) limits.push(record.pastFeedback);

    return {
      id: record.id, valid: true, schemaVersion: SCHEMA_VERSION, generatedAt: scored.generatedAt, status: record.status,
      title: scored.title, summary: scored.summary,
      situation: parts.map((p) => p.situation).join(" "),
      rulesActivated: rules.map((r) => ({ id: r.id, label: r.label, description: r.description, version: r.version, reasonCodes: scored.reasonCodes })),
      data: parts.flatMap((p) => p.data),
      period: parts.length === 1 ? parts[0].period : { from: parts.map((p) => p.period.from).sort()[0], to: parts.map((p) => p.period.to).sort().pop(), label: "Varios periodos (uno por elemento incluido)" },
      influencingPatterns: parts.flatMap((p) => p.patterns),
      hypotheses: parts.flatMap((p) => p.hypotheses).map((text) => ({ text, confirmed: false })),
      basis: { type: basis, label: BASIS_LABEL[basis] },
      confidence: { value: scored.confidence, level: scored.confidenceLevel, method: scored.confidenceDetail.method, components: scored.confidenceDetail.components },
      priority: { score: scored.priorityScore, urgency: scored.urgency, formula: scored.formula, breakdown: scored.breakdown, note: "La prioridad indica cuánta atención merece ahora; no es lo mismo que la confianza en los datos." },
      proposedActions: preparedActions,
      limitations: limits,
    };
  }

  function invalid(record, reason) {
    return { id: record.id, valid: false, status: "resolved", reason, lastKnown: { title: record.title, summary: record.summary, createdAt: record.createdAt }, proposedActions: [] };
  }

  return { SCHEMA_VERSION, BASIS_LABEL, toBrief, prepareActions, build, invalid };
});
