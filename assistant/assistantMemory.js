"use strict";
// Memoria del asistente: transparente, revisable, editable y borrable. Distingue tres orígenes:
//  observed  = patrón observado (comportamiento repetido, aún NO es una preferencia)
//  inferred  = hipótesis provisional (puede ser incorrecta)
//  confirmed = preferencia expresada o confirmada por el usuario
// Eliminar un recuerdo deja una «lápida»: lo observado/inferido NO se vuelve a crear solo; únicamente el usuario puede reponerlo.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantMemory = api;
})(typeof self !== "undefined" ? self : this, function () {
  const KINDS = ["observed", "inferred", "confirmed"];
  const SCOPES = ["global", "module", "rule", "temporal", "conditional"];
  const KIND_LABEL = { confirmed: "Preferencia confirmada", observed: "Patrón observado", inferred: "Hipótesis del asistente" };

  // state = objeto persistible { entries:{id:entry}, tombstones:{key:isoDate}, learningPaused:false, seq:0 }
  function emptyState() { return { entries: {}, tombstones: {}, learningPaused: false, seq: 0 }; }

  function create(state, { now = () => new Date() } = {}) {
    const iso = () => now().toISOString();
    const dayNow = () => iso().slice(0, 10);
    const validScope = (sc) => {
      const s = sc && SCOPES.includes(sc.type) ? { ...sc } : { type: "global" };
      if (s.type === "temporal" && !/^\d{4}-\d{2}-\d{2}$/.test(s.until || "")) throw new Error("Un alcance temporal necesita «until» (AAAA-MM-DD).");
      return s;
    };
    const find = (key) => Object.values(state.entries).find((e) => e.key === key) || null;

    function put(kind, key, value, reason, scope, extra = {}) {
      const existing = find(key);
      const t = iso();
      if (existing) {
        // Nunca degrada una preferencia confirmada con una observación
        if (existing.kind === "confirmed" && kind !== "confirmed") return existing;
        existing.value = value; existing.reason = reason || existing.reason; existing.updatedAt = t;
        existing.evidence = (existing.evidence || 0) + 1;
        if (kind === "confirmed") { existing.kind = "confirmed"; existing.confirmedAt = t; }
        return existing;
      }
      const e = { id: `m${++state.seq}`, key, kind, value, reason: reason || "", scope: validScope(scope), createdAt: t, updatedAt: t, confirmedAt: kind === "confirmed" ? t : null, paused: false, evidence: 1, ...extra };
      state.entries[e.id] = e;
      return e;
    }

    return {
      KINDS, KIND_LABEL,
      // Aprendizaje automático: respeta pausa y lápidas
      observe(key, value, reason, scope) {
        if (state.learningPaused || state.tombstones[key]) return null;
        return put("observed", key, value, reason, scope);
      },
      infer(key, value, reason, scope) {
        if (state.learningPaused || state.tombstones[key]) return null;
        const ex = find(key);
        if (ex && ex.kind === "observed") { ex.kind = "inferred"; ex.value = value; ex.reason = reason || ex.reason; ex.updatedAt = iso(); return ex; }
        return put("inferred", key, value, reason, scope);
      },
      // Acciones del usuario: siempre permitidas (también reponen algo borrado)
      set(key, value, reason, scope) { delete state.tombstones[key]; return put("confirmed", key, value, reason, scope); },
      confirm(id) {
        const e = state.entries[id]; if (!e) return null;
        e.kind = "confirmed"; e.confirmedAt = iso(); e.updatedAt = e.confirmedAt; delete state.tombstones[e.key];
        return e;
      },
      update(id, patch) {
        const e = state.entries[id]; if (!e) return null;
        if ("value" in patch) e.value = patch.value;
        if ("reason" in patch) e.reason = String(patch.reason || "");
        if ("scope" in patch) e.scope = validScope(patch.scope);
        e.updatedAt = iso();
        return e;
      },
      pause(id, paused = true) { const e = state.entries[id]; if (!e) return null; e.paused = !!paused; e.updatedAt = iso(); return e; },
      remove(id) {
        const e = state.entries[id]; if (!e) return false;
        delete state.entries[id];
        state.tombstones[e.key] = iso();
        return true;
      },
      forgetTombstone(key) { delete state.tombstones[key]; },
      setLearningPaused(v) { state.learningPaused = !!v; },
      isLearningPaused: () => !!state.learningPaused,
      find,
      get: (id) => state.entries[id] || null,
      list({ kind, module } = {}) {
        return Object.values(state.entries)
          .filter((e) => (!kind || e.kind === kind) && (!module || (e.scope.module || null) === module))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      // Valor efectivo de una clave. Confirmadas: siempre. Observadas/inferidas: solo si `allowUnconfirmed` y el aprendizaje no está pausado.
      // Entradas en pausa o con alcance temporal caducado no se aplican.
      effective(key, { allowUnconfirmed = false } = {}) {
        const e = find(key);
        if (!e || e.paused) return { applies: false, entry: e };
        if (e.scope.type === "temporal" && e.scope.until < dayNow()) return { applies: false, entry: e, expired: true };
        if (e.kind === "confirmed") return { applies: true, entry: e, value: e.value };
        if (allowUnconfirmed && !state.learningPaused) return { applies: true, entry: e, value: e.value, unconfirmed: true };
        return { applies: false, entry: e };
      },
      // Elimina los recuerdos temporales caducados (no deja lápida: caducar no es rechazar)
      expireTemporal() {
        let n = 0;
        for (const e of Object.values(state.entries)) if (e.scope.type === "temporal" && e.scope.until < dayNow()) { delete state.entries[e.id]; n++; }
        return n;
      },
      // Vista para el futuro centro «Mi memoria»: cada elemento con por qué existe, cuándo y qué alcance tiene
      centerView() {
        const all = Object.values(state.entries).map((e) => ({ ...e, kindLabel: KIND_LABEL[e.kind] }));
        const temporal = all.filter((e) => e.scope.type === "temporal");
        const rest = all.filter((e) => e.scope.type !== "temporal");
        return {
          confirmed: rest.filter((e) => e.kind === "confirmed"), observed: rest.filter((e) => e.kind === "observed"), inferred: rest.filter((e) => e.kind === "inferred"),
          temporal, learningPaused: !!state.learningPaused, deletedKeys: Object.keys(state.tombstones).length,
        };
      },
    };
  }

  return { emptyState, create, KINDS, SCOPES, KIND_LABEL };
});
