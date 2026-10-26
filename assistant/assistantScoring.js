"use strict";
// Puntuación y discreción. Dos medidas SEPARADAS:
//  · priorityScore (0–100): cuánto merece atención ahora (urgencia, impacto, novedad, relevancia aprendida).
//  · confidence (0–1): cuánto respaldan los datos la observación (hecho directo vs. patrón con muestra pequeña).
// Una sugerencia puede ser muy prioritaria y poco fiable, o al revés. Las fórmulas son fijas y se muestran en la explicación.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./assistantPatterns.js") : root.AssistantPatterns);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantScoring = api;
})(typeof self !== "undefined" ? self : this, function (P) {
  const clamp = P.clamp;
  const WEIGHTS = { urgency: 0.45, impact: 0.3, novelty: 0.15, relevance: 0.1 };
  const THRESHOLDS = { minPriority: 35, minConfidence: 0.45, maxVisible: 5, maxNewPerDay: 3, maxPerModule: 2, groupMinItems: 3, ignoreAfterDays: 3, extraForHigh: 2 };

  const urgencyLabel = (u) => (u >= 0.7 ? "high" : u >= 0.4 ? "normal" : "low");
  const levelOf = (v) => (v >= 0.75 ? "alta" : v >= 0.5 ? "media" : "baja");

  // Confianza estadística. hecho = lectura directa de un dato registrado; patrón = comparación con muestra; estimación = tope 0.6.
  function confidence(c) {
    const n = (c.sample && c.sample.n) || 0, full = (c.sample && c.sample.full) || 1;
    const sf = P.sampleFactor(n, full), cons = c.consistency == null ? 1 : clamp(c.consistency);
    if (c.basis === "fact") {
      return { value: 0.95, level: "alta", method: "Dato registrado leído directamente: confianza fija 0,95 (puede faltar información que no esté anotada).", components: [{ name: "tipo de base", value: "hecho", note: "lectura directa de datos" }] };
    }
    let v = 0.2 + 0.7 * sf * cons;
    if (c.basis === "estimate") v = Math.min(v, 0.6);
    v = Math.round(v * 100) / 100;
    return {
      value: v, level: levelOf(v),
      method: `${c.basis === "estimate" ? "min(0,6; " : "("}0,2 + 0,7 × tamaño de muestra × consistencia${c.basis === "estimate" ? ")" : ")"}, donde tamaño de muestra = min(1, observaciones / observaciones necesarias).`,
      components: [
        { name: "observaciones", value: n, note: `necesarias para confianza plena: ${full}` },
        { name: "tamaño de muestra", value: Math.round(sf * 100) / 100, note: "min(1, observaciones / necesarias)" },
        { name: "consistencia", value: Math.round(cons * 100) / 100, note: "cuán marcada es la diferencia o el patrón observado" },
      ],
    };
  }

  // ctx: { weight (peso aprendido de la regla, 0,6–1,2), isNew }
  function score(c, ctx = {}) {
    const weight = ctx.weight == null ? 1 : ctx.weight;
    const relevance = clamp(weight / 1.2), novelty = ctx.isNew === false ? 0.5 : 1;
    const raw = WEIGHTS.urgency * c.urgency + WEIGHTS.impact * c.impact + WEIGHTS.novelty * novelty + WEIGHTS.relevance * relevance;
    const conf = confidence(c);
    return {
      priorityScore: Math.round(clamp(raw) * 100), urgencyValue: Math.round(c.urgency * 100) / 100, urgency: urgencyLabel(c.urgency), confidence: conf.value, confidenceLevel: conf.level, confidenceDetail: conf,
      breakdown: [
        { factor: "urgencia", value: Math.round(c.urgency * 100) / 100, weight: WEIGHTS.urgency },
        { factor: "impacto", value: Math.round(c.impact * 100) / 100, weight: WEIGHTS.impact },
        { factor: "novedad (1 = sin respuesta previa del usuario)", value: novelty, weight: WEIGHTS.novelty },
        { factor: "relevancia aprendida", value: Math.round(relevance * 100) / 100, weight: WEIGHTS.relevance },
      ],
      formula: "prioridad = 100 × (0,45·urgencia + 0,30·impacto + 0,15·novedad + 0,10·relevancia)",
    };
  }

  /* ---------- Reglas de discreción ----------
     gateOne decide, para UN candidato puntuado, si puede mostrarse o debe quedar solo detectado.
     Devuelve { show, status, reason, bypass }. No decide capacidad total (eso lo hace capacity()). */

  // ¿Ha cambiado algo lo bastante importante como para romper un periodo de silencio por una respuesta del usuario?
  function breaksCooldown(rec, scored, signatureChanged) {
    const fb = rec && rec.lastFeedback;
    if (!fb) return false;
    if (fb.type === "postpone" || fb.type === "hide") return false; // el usuario fijó un periodo explícito: se respeta
    const dismissals = (rec.dismissals || 0);
    const need = dismissals >= 2 ? 30 : 20; // descartes repetidos exigen un cambio mayor
    if (scored.urgency === "high" && fb.urgency !== "high") return true;
    if (scored.priorityScore >= (fb.score || 0) + need) return true;
    return false;
  }

  function gateOne(scored, rec, ctx) {
    const { today, thresholds: th } = ctx;
    if (scored.timing === "later") return { show: false, status: "detected", reason: "not_timely" };
    if (scored.confidence < th.minConfidence) return { show: false, status: "detected", reason: "low_confidence" };
    const high = scored.urgency === "high";
    if (scored.priorityScore < th.minPriority && !(high && scored.priorityScore >= th.minPriority - 10)) return { show: false, status: "detected", reason: "below_threshold" };
    if (rec && rec.cooldownUntil && rec.cooldownUntil > today) {
      if (breaksCooldown(rec, scored)) return { show: true, status: "visible", reason: "important_change", bypass: true };
      return { show: false, status: rec.status === "visible" ? "ignored" : rec.status, reason: "cooldown" };
    }
    if (rec && rec.status === "visible") return { show: true, status: "visible", reason: "still_relevant" };
    // Nueva aparición (o cooldown vencido): cuota diaria de sugerencias nuevas
    if (!high && ctx.newToday >= th.maxNewPerDay) return { show: false, status: "detected", reason: "daily_limit" };
    return { show: true, status: "visible", reason: "meets_thresholds", isNew: true };
  }

  // Aplica los límites de capacidad a los que pueden mostrarse, por prioridad descendente.
  // Las de urgencia alta pueden superar el límite por módulo y hasta `extraForHigh` el total.
  function capacity(items, th) {
    const sorted = [...items].sort((a, b) => b.s.priorityScore - a.s.priorityScore);
    const perModule = {};
    let total = 0, extra = 0;
    for (const it of sorted) {
      if (!it.gate.show) continue;
      const m = it.s.module, high = it.s.urgency === "high";
      const modOk = (perModule[m] || 0) < th.maxPerModule, totOk = total < th.maxVisible;
      if (modOk && totOk) { perModule[m] = (perModule[m] || 0) + 1; total++; continue; }
      if (high && extra < th.extraForHigh) { extra++; perModule[m] = (perModule[m] || 0) + 1; total++; continue; }
      it.gate = { show: false, status: "detected", reason: modOk ? "capacity_total" : "capacity_module" };
    }
    return items;
  }

  return { WEIGHTS, THRESHOLDS, urgencyLabel, levelOf, confidence, score, breaksCooldown, gateOne, capacity };
});
