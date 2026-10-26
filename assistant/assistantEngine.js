"use strict";
// Orquestador del motor algorítmico del asistente de CloudSpace.
// Solo lógica: sin DOM, sin red, sin modelos de IA. Flujo de cada evaluación:
//   datos de la app → instantánea validada → reglas → puntuación (prioridad ≠ confianza) → agrupación
//   → discreción (umbrales, cooldowns, cuotas, capacidad) → sugerencias breves (visibles u ocultas).
// La explicación profunda se pide después por id y se recalcula con los datos actuales (si ya no aplica, se retira).
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, g) => (isNode ? require("./" + n + ".js") : root[g]);
  const api = factory({
    L: isNode ? require("../logic.js") : root.Logic,
    Data: dep("assistantData", "AssistantData"), Rules: dep("assistantRules", "AssistantRules"), Scoring: dep("assistantScoring", "AssistantScoring"),
    Memory: dep("assistantMemory", "AssistantMemory"), Feedback: dep("assistantFeedback", "AssistantFeedback"),
    Proposals: dep("assistantProposals", "AssistantProposals"), Actions: dep("assistantActions", "AssistantActions"), AI: dep("assistantAIContext", "AssistantAIContext"),
  });
  if (isNode) module.exports = api;
  else root.AssistantEngine = api;
})(typeof self !== "undefined" ? self : this, function ({ L, Data, Rules, Scoring, Memory, Feedback, Proposals, Actions, AI }) {
  const STATE_VERSION = 1;
  const PAGE_OF = { tasks: "tasks", habits: "habits", timer: "timer", finance: "finance", goals: "dashboard" };
  const MODULES = ["tasks", "habits", "timer", "finance", "goals"];
  const HISTORY_DAYS = 45, LOG_MAX = 300, LEARN_DAYS = 180; // ventana en la que se acumulan descartes/aceptaciones para aprender

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const idFor = (key) => "sg_" + hash(key);
  const defaultSettings = () => ({ paused: false, pausedModules: [], disabledRules: [], thresholds: {}, rules: {} });
  const freshState = () => ({ version: STATE_VERSION, suggestions: {}, feedbackLog: [], ruleStats: {}, memory: Memory.emptyState(), settings: defaultSettings(), meta: { fingerprint: null, lastEvaluatedAt: null, newShown: { day: null, n: 0 } } });

  function create({ userId = null, guest = false, adapter = null, now = () => new Date(), config = {} } = {}) {
    if (!guest && !userId) throw new Error("create(): se necesita userId (o guest:true para el modo invitado, sin persistencia).");
    const persistent = !guest && !!adapter;
    let state = freshState();
    let pending = Promise.resolve();
    const api = { persistent, lastPersistError: null };

    const clock = () => now();
    const iso = () => clock().toISOString();
    const todayKey = () => L.dayKey(clock());
    const mem = () => Memory.create(state.memory, { now: clock });
    const thresholds = () => ({ ...Scoring.THRESHOLDS, ...config.thresholds, ...state.settings.thresholds });
    const ruleCfg = () => {
      const merged = Rules.mergeConfig(config.rules);
      for (const k of Object.keys(state.settings.rules || {})) merged[k] = { ...merged[k], ...state.settings.rules[k] };
      return merged;
    };

    function persist() {
      if (!persistent) return;
      const snapshot = Data.clone(state);
      pending = pending.then(() => adapter.save(userId, snapshot)).then(() => { api.lastPersistError = null; }, (e) => { api.lastPersistError = e; });
    }
    api.flush = () => pending;

    api.init = async function () {
      if (!persistent) return api;
      const loaded = await adapter.load(userId);
      if (loaded && loaded.version === STATE_VERSION) {
        state = { ...freshState(), ...loaded, memory: { ...Memory.emptyState(), ...(loaded.memory || {}) }, settings: { ...defaultSettings(), ...(loaded.settings || {}) } };
      }
      return api;
    };

    /* ---------- Detección + puntuación (común a evaluate y a la explicación) ---------- */

    function detectAll(snap) {
      const cfg = ruleCfg(), th = thresholds();
      const disabled = new Set(state.settings.disabledRules), paused = new Set(state.settings.pausedModules);
      const run = Rules.runAll(snap, cfg, { disabled, pausedModules: paused });
      const byKey = new Map();
      for (const c of run.candidates) {
        const prev = byKey.get(c.key);
        if (!prev || c.impact + c.urgency > prev.impact + prev.urgency) byKey.set(c.key, c); // duplicados en la misma pasada: se queda el mejor
      }
      const generatedAt = iso();
      const scoreOne = (c) => {
        const rec = state.suggestions[idFor(c.key)];
        const w = (state.ruleStats[c.ruleId] || {}).weight;
        const sc = Scoring.score(c, { weight: w, isNew: !(rec && rec.lastFeedback) }); // novedad: 1 si aún no has respondido a esta sugerencia
        return { ...c, ...sc, generatedAt, sampleShort: c.basis !== "fact" && c.sample.n < c.sample.full };
      };
      let scored = [...byKey.values()].map(scoreOne);
      // Agrupación: varias sugerencias iguales de una regla se muestran como una sola
      const out = [];
      for (const rule of Rules.RULES) {
        const mine = scored.filter((s) => s.ruleId === rule.id);
        const now = mine.filter((s) => s.timing === "now");
        if (rule.groupTitle && now.length >= th.groupMinItems) {
          const g = {
            ruleId: rule.id, ruleVersion: rule.version, module: rule.module, key: `${rule.id}:group`, timing: "now",
            title: rule.groupTitle(now.length), summary: "Abre la explicación para ver cada elemento por separado.",
            impact: Math.max(...now.map((m) => m.impact)), urgency: Math.max(...now.map((m) => m.urgency)),
            basis: now.some((m) => m.basis !== "fact") ? "pattern" : "fact",
            sample: now.reduce((a, m) => (m.confidence < a.confidence ? m : a), now[0]).sample,
            consistency: Math.min(...now.map((m) => (m.consistency == null ? 1 : m.consistency))),
            evidence: {
              refs: now.flatMap((m) => m.evidence.refs).slice(0, 20), metrics: { count: now.length },
              period: { from: now.map((m) => m.evidence.period.from).sort()[0], to: now.map((m) => m.evidence.period.to).sort().pop() },
            },
            reasonCodes: [...new Set(now.flatMap((m) => m.reasonCodes))], actions: [{ type: "navigate.review", params: { page: PAGE_OF[rule.module] }, label: "Revisar" }],
            signature: now.map((m) => m.signature).sort().join("|"), members: now,
          };
          out.push({ ...g, ...scoreOne(g) , members: now, groupedFrom: now.map((m) => m.key) });
          out.push(...mine.filter((s) => s.timing !== "now"));
        } else out.push(...mine);
      }
      return { scored: out, skipped: run.skipped, errors: run.errors, cfg };
    }

    /* ---------- Evaluación ---------- */

    function newShownToday() {
      const ns = state.meta.newShown, t = todayKey();
      if (ns.day !== t) { ns.day = t; ns.n = 0; }
      return ns;
    }

    // Una sugerencia visible que no recibe respuesta en `ignoreAfterDays` pasa a «sin respuesta»: silencio temporal, no rechazo.
    function sweepNoResponse(today, th) {
      for (const rec of Object.values(state.suggestions)) {
        if (rec.status !== "visible" || !rec.lastShownAt) continue;
        if (L.dayDiff(today, rec.lastShownAt.slice(0, 10)) >= th.ignoreAfterDays) applyFeedback(rec, "no_response", {}, true);
      }
    }

    api.evaluate = function (raw) {
      const t = todayKey(), th = thresholds();
      const snap = Data.normalize(raw, { now: clock() });
      const fp = Data.fingerprint(snap);
      const changed = fp !== state.meta.fingerprint;
      if (state.settings.paused) return { today: t, paused: true, suggestions: [], hiddenDetected: 0, skipped: [], errors: [], changed, fingerprint: fp };
      mem().expireTemporal();
      sweepNoResponse(t, th);
      const { scored, skipped, errors } = detectAll(snap);

      const ns = newShownToday();
      const items = [];
      for (const s of scored.sort((a, b) => b.priorityScore - a.priorityScore)) {
        const id = idFor(s.key), rec = state.suggestions[id] || null;
        let gate = Scoring.gateOne(s, rec, { today: t, thresholds: th, newToday: ns.n });
        if (gate.show && gate.isNew) ns.n++; // la cuota se consume en orden de prioridad
        items.push({ id, s, rec, gate });
      }
      Scoring.capacity(items, th);

      const seen = new Set();
      for (const { id, s, rec, gate } of items) {
        seen.add(id);
        const wasVisible = rec && rec.status === "visible";
        const r = rec || { id, createdAt: iso(), shownCount: 0, dismissals: 0, firstShownDay: null };
        Object.assign(r, {
          id, schemaVersion: Proposals.SCHEMA_VERSION, ruleId: s.ruleId, ruleVersion: s.ruleVersion, module: s.module, key: s.key, title: s.title, summary: s.summary,
          priorityScore: s.priorityScore, urgency: s.urgency, confidence: s.confidence, evidence: s.evidence, reasonCodes: s.reasonCodes, actions: s.actions.map((a) => ({ ...a })),
          signature: s.signature, updatedAt: iso(), status: gate.status, gateReason: gate.reason, retiredAt: null, retiredReason: null, members: s.groupedFrom || null,
        });
        if (gate.reason === "important_change") r.cooldownUntil = null;
        if (gate.show && !wasVisible) { r.shownCount++; r.lastShownAt = iso(); r.firstShownDay = r.firstShownDay || t; }
        state.suggestions[id] = r;
      }
      // Sugerencias retiradas: la situación ya no se da, o ahora se muestran agrupadas
      const grouped = new Set(scored.flatMap((s) => s.groupedFrom || []).map(idFor));
      for (const rec of Object.values(state.suggestions)) {
        if (seen.has(rec.id) || rec.status === "resolved") continue;
        if (grouped.has(rec.id)) { rec.status = "resolved"; rec.retiredAt = iso(); rec.retiredReason = "grouped"; continue; }
        rec.status = "resolved"; rec.retiredAt = iso(); rec.retiredReason = "no_longer_applies";
      }
      for (const rec of Object.values(state.suggestions)) if (rec.status === "resolved" && rec.retiredAt && L.dayDiff(t, rec.retiredAt.slice(0, 10)) > HISTORY_DAYS && !(rec.cooldownUntil && rec.cooldownUntil > t)) delete state.suggestions[rec.id];

      state.meta.fingerprint = fp; state.meta.lastEvaluatedAt = iso();
      persist();
      const visible = api.getVisible();
      return { today: t, paused: false, suggestions: visible, hiddenDetected: Object.values(state.suggestions).filter((r) => r.status === "detected").length, skipped, errors, changed, fingerprint: fp };
    };

    api.getVisible = () => Object.values(state.suggestions).filter((r) => r.status === "visible").sort((a, b) => b.priorityScore - a.priorityScore).map(Proposals.toBrief);
    api.getSuggestion = (id) => (state.suggestions[id] ? Proposals.toBrief(state.suggestions[id]) : null);
    api.listAll = () => Object.values(state.suggestions).map((r) => ({ ...Proposals.toBrief(r), gateReason: r.gateReason || null }));

    /* ---------- Explicación profunda por id ---------- */

    api.getExplanation = function (id, raw) {
      const rec = state.suggestions[id];
      if (!rec) return { id, found: false, valid: false, reason: "No existe ninguna sugerencia con ese identificador." };
      const snap = Data.normalize(raw, { now: clock() });
      const { scored, cfg } = detectAll(snap);
      const s = scored.find((x) => idFor(x.key) === id);
      if (!s) {
        if (rec.status !== "resolved") { rec.status = "resolved"; rec.retiredAt = iso(); rec.retiredReason = "no_longer_applies"; persist(); }
        return Proposals.invalid(rec, "La situación que originó esta sugerencia ya no se da con los datos actuales.");
      }
      const members = s.members || [s];
      const parts = members.map((m) => Rules.byId[m.ruleId].describe(m, snap, cfg));
      const fb = rec.lastFeedback;
      const past = fb ? `Anteriormente respondiste «${Feedback.BASE[fb.type].label}» el ${L.shortDate(fb.day)}${fb.note ? ` (nota: ${fb.note})` : ""}.` : null;
      const prepared = Proposals.prepareActions(s.actions, snap);
      return Proposals.build({ record: { ...rec, pastFeedback: past }, scored: s, parts, rules: [Rules.byId[s.ruleId]], snapshot: snap, preparedActions: prepared });
    };

    api.prepareActions = (id, raw) => { const e = api.getExplanation(id, raw); return e.valid ? e.proposedActions : []; };
    api.executeAction = (prepared, confirmation, executor) => Actions.execute(prepared, confirmation, executor);

    /* ---------- Feedback ---------- */

    function applyFeedback(rec, type, opts, automatic = false) {
      const t = todayKey(), learning = !state.memory.learningPaused;
      const eff = Feedback.effectOf(type, opts, { today: t, ruleId: rec.ruleId, log: state.feedbackLog });
      rec.status = eff.status; rec.cooldownUntil = eff.cooldownUntil;
      rec.lastFeedback = { type, at: iso(), day: t, score: rec.priorityScore, urgency: rec.urgency, signature: rec.signature, note: opts && opts.note ? String(opts.note).slice(0, 200) : null };
      if (type === "accept" || type === "modify") rec.dismissals = 0;
      if (eff.countsAsDismissal) rec.dismissals = (rec.dismissals || 0) + 1;
      state.feedbackLog.push({ id: rec.id, ruleId: rec.ruleId, module: rec.module, type, day: t, automatic });
      if (state.feedbackLog.length > LOG_MAX) state.feedbackLog.splice(0, state.feedbackLog.length - LOG_MAX);
      // Aprendizaje: acotado, reversible y pausable
      if (learning) {
        state.ruleStats[rec.ruleId] = Feedback.applyToStats(state.ruleStats[rec.ruleId], type, eff.weightDelta);
        const neg = Feedback.recent(state.feedbackLog, rec.ruleId, ["reject", "not_relevant"], t, LEARN_DAYS);
        const pos = Feedback.recent(state.feedbackLog, rec.ruleId, ["accept", "modify"], t, LEARN_DAYS);
        const label = Rules.byId[rec.ruleId].label;
        if (neg >= 3) mem().observe(`rule.low_interest:${rec.ruleId}`, { count: neg }, `Has descartado «${label}» ${neg} veces en los últimos 6 meses. Es un patrón observado, no una preferencia.`, { type: "rule", ruleId: rec.ruleId });
        if (neg >= 5) mem().infer(`rule.disable_candidate:${rec.ruleId}`, { count: neg }, `Hipótesis: quizá no quieras recibir avisos de «${label}». Confírmalo para desactivarlos.`, { type: "rule", ruleId: rec.ruleId });
        if (pos >= 3) mem().observe(`rule.high_interest:${rec.ruleId}`, { count: pos }, `Has aceptado «${label}» ${pos} veces en los últimos 6 meses.`, { type: "rule", ruleId: rec.ruleId });
      }
      return { ok: true, id: rec.id, status: rec.status, cooldownUntil: rec.cooldownUntil, effect: eff.label, learned: learning };
    }

    api.feedback = function (id, type, opts = {}) {
      const rec = state.suggestions[id];
      if (!rec) return { ok: false, error: "No existe esa sugerencia." };
      const res = applyFeedback(rec, type, opts);
      persist();
      return res;
    };

    /* ---------- Memoria y ajustes ---------- */

    api.memory = new Proxy({}, { get: (_, k) => { const m = mem(); const v = m[k]; return typeof v === "function" ? (...a) => { const r = v.apply(m, a); persist(); return r; } : v; } });
    api.pendingConfirmations = () => mem().list({ kind: "inferred" }).filter((e) => e.key.startsWith("rule.disable_candidate:"));
    api.confirmMemory = function (id) {
      const e = mem().confirm(id);
      if (e && e.key.startsWith("rule.disable_candidate:")) { const r = e.key.split(":")[1]; if (!state.settings.disabledRules.includes(r)) state.settings.disabledRules.push(r); }
      persist();
      return e;
    };
    api.rejectMemory = (id) => { const ok = mem().remove(id); persist(); return ok; };

    const touch = (fn) => (...a) => { const r = fn(...a); persist(); return r; };
    api.settings = {
      get: () => Data.clone({ ...state.settings, thresholds: thresholds(), effectiveRules: ruleCfg() }),
      pauseAll: touch((v = true) => { state.settings.paused = !!v; }),
      pauseModule: touch((m) => { if (!MODULES.includes(m)) throw new Error(`Módulo desconocido: ${m}`); if (!state.settings.pausedModules.includes(m)) state.settings.pausedModules.push(m); }),
      resumeModule: touch((m) => { state.settings.pausedModules = state.settings.pausedModules.filter((x) => x !== m); }),
      disableRule: touch((r) => { if (!Rules.byId[r]) throw new Error(`Regla desconocida: ${r}`); if (!state.settings.disabledRules.includes(r)) state.settings.disabledRules.push(r); }),
      enableRule: touch((r) => { state.settings.disabledRules = state.settings.disabledRules.filter((x) => x !== r); }),
      setThresholds: touch((patch) => {
        const ranges = { minPriority: [0, 100], minConfidence: [0, 1], maxVisible: [1, 20], maxNewPerDay: [0, 20], maxPerModule: [1, 10], groupMinItems: [2, 20], ignoreAfterDays: [1, 30] };
        for (const [k, v] of Object.entries(patch)) {
          if (!ranges[k]) throw new Error(`Umbral desconocido: ${k}`);
          if (typeof v !== "number" || v < ranges[k][0] || v > ranges[k][1]) throw new Error(`«${k}» debe estar entre ${ranges[k][0]} y ${ranges[k][1]}.`);
        }
        state.settings.thresholds = { ...state.settings.thresholds, ...patch };
      }),
      setRuleConfig: touch((group, patch) => {
        if (!Rules.DEFAULTS[group]) throw new Error(`Grupo de reglas desconocido: ${group}`);
        for (const [k, v] of Object.entries(patch)) { if (!(k in Rules.DEFAULTS[group])) throw new Error(`Parámetro desconocido: ${group}.${k}`); if (typeof v !== "number" || !(v >= 0)) throw new Error(`«${k}» debe ser un número no negativo.`); }
        state.settings.rules[group] = { ...(state.settings.rules[group] || {}), ...patch };
      }),
    };
    api.ruleCatalog = () => Rules.RULES.map((r) => ({ id: r.id, module: r.module, label: r.label, description: r.description, version: r.version, disabled: state.settings.disabledRules.includes(r.id), weight: (state.ruleStats[r.id] || {}).weight || 1, stats: state.ruleStats[r.id] || Feedback.emptyStats() }));

    /* ---------- IA futura, exportación y reinicio ---------- */

    api.aiContext = (raw, opts = {}) => AI.build(Data.normalize(raw, { now: clock() }), { suggestions: api.getVisible(), memory: mem().list(), ...opts });
    api.validateModelOutput = (output, raw) => AI.validateModelOutput(output, Data.normalize(raw, { now: clock() }));
    api.exportState = () => Data.clone(state);
    api.reset = async function () { state = freshState(); if (persistent) { await pending; await adapter.clear(userId); } return true; };

    return api;
  }

  return { create, idFor, MODULES, STATE_VERSION };
});
