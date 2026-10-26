"use strict";
// Retroalimentación del usuario. Cada tipo tiene un efecto distinto y NINGUNO crea una preferencia permanente por sí solo:
// un rechazo solo alarga el silencio de esa sugerencia y reduce un poco el peso de su regla (acotado y reversible).
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../logic.js") : root.Logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantFeedback = api;
})(typeof self !== "undefined" ? self : this, function (L) {
  const TYPES = ["accept", "reject", "modify", "not_relevant", "postpone", "hide", "no_response"];
  const BASE = {
    accept: { status: "accepted", days: 7, weight: +0.05, label: "Aceptada" },
    modify: { status: "accepted", days: 7, weight: +0.02, label: "Aceptada con cambios" },
    reject: { status: "dismissed", days: 14, weight: -0.05, label: "Rechazada" },
    not_relevant: { status: "dismissed", days: 30, weight: -0.1, label: "Marcada como no relevante" },
    postpone: { status: "snoozed", days: 3, weight: 0, label: "Pospuesta" },
    hide: { status: "hidden", days: 7, weight: 0, label: "Ocultada durante un periodo" },
    no_response: { status: "ignored", days: 3, weight: -0.01, label: "Sin respuesta" },
  };
  const W_MIN = 0.6, W_MAX = 1.2;
  const emptyStats = () => ({ accepted: 0, rejected: 0, notRelevant: 0, ignored: 0, postponed: 0, weight: 1 });

  const recent = (log, ruleId, kinds, today, days) => log.filter((f) => f.ruleId === ruleId && kinds.includes(f.type) && L.dayDiff(today, f.day) <= days).length;

  // Calcula el efecto de un feedback (función pura). `log` = historial previo de feedback del usuario.
  function effectOf(type, opts = {}, ctx) {
    if (!TYPES.includes(type)) throw new Error(`Tipo de feedback desconocido: ${type}`);
    const { today, ruleId, log = [] } = ctx;
    const b = BASE[type];
    let days = b.days;
    if (type === "postpone" || type === "hide") {
      const d = opts.days == null ? b.days : opts.days;
      if (!Number.isInteger(d) || d < 1 || d > (type === "hide" ? 90 : 30)) throw new Error(`«days» debe ser un entero entre 1 y ${type === "hide" ? 90 : 30}.`);
      days = d;
    } else if (type === "reject" || type === "not_relevant" || type === "no_response") {
      // Cada rechazo reciente de esa regla alarga un poco el silencio (máx. ×4); no es permanente.
      const prior = recent(log, ruleId, ["reject", "not_relevant", "no_response"], today, 60);
      days = b.days * (1 + Math.min(3, prior));
    }
    return { status: b.status, label: b.label, cooldownDays: days, cooldownUntil: L.addDays(today, days), weightDelta: b.weight, countsAsDismissal: type === "reject" || type === "not_relevant" };
  }

  function applyToStats(stats, type, delta) {
    const s = { ...emptyStats(), ...(stats || {}) };
    if (type === "accept" || type === "modify") s.accepted++;
    else if (type === "reject") s.rejected++;
    else if (type === "not_relevant") s.notRelevant++;
    else if (type === "no_response") s.ignored++;
    else if (type === "postpone") s.postponed++;
    s.weight = Math.round(Math.max(W_MIN, Math.min(W_MAX, s.weight + delta)) * 100) / 100;
    return s;
  }

  return { TYPES, BASE, W_MIN, W_MAX, emptyStats, effectOf, applyToStats, recent };
});
