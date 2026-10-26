"use strict";
// Catálogo de acciones seguras del asistente. El motor SOLO puede proponer acciones de este catálogo, con parámetros
// validados. Preparar una acción NO la ejecuta: ejecutar exige un token de confirmación y un ejecutor que inyecta la app.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../logic.js") : root.Logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantActions = api;
})(typeof self !== "undefined" ? self : this, function (L) {
  const PAGES = ["dashboard", "tasks", "habits", "timer", "finance", "journal"];

  // type: string | int | date | id | enum. required por defecto false. max/min opcionales.
  const CATALOG = {
    "task.create": {
      module: "tasks", label: "Crear tarea", readOnly: false,
      effect: "Añade una tarea nueva. No modifica tareas existentes.",
      params: { title: { type: "string", required: true, max: 120 }, due_date: { type: "date" }, prio: { type: "int", min: 1, max: 4 }, notes: { type: "string", max: 500 }, goalId: { type: "id" } },
      refs: {},
    },
    "task.reschedule": {
      module: "tasks", label: "Cambiar la fecha de una tarea", readOnly: false,
      effect: "Cambia únicamente la fecha de vencimiento de la tarea indicada.",
      params: { taskId: { type: "id", required: true }, due_date: { type: "date", required: true } }, refs: { taskId: "tasks" },
    },
    "task.set_priority": {
      module: "tasks", label: "Cambiar la prioridad de una tarea", readOnly: false,
      effect: "Cambia únicamente la prioridad de la tarea indicada.",
      params: { taskId: { type: "id", required: true }, prio: { type: "int", required: true, min: 1, max: 4 } }, refs: { taskId: "tasks" },
    },
    "habit.set_frequency": {
      module: "habits", label: "Cambiar la frecuencia de un hábito", readOnly: false,
      effect: "Cambia únicamente la frecuencia del hábito. El historial de registros no se toca.",
      params: { habitId: { type: "id", required: true }, frequency: { type: "enum", required: true, values: L.HABIT_FREQUENCIES } }, refs: { habitId: "habits" },
    },
    "timer.prepare_session": {
      module: "timer", label: "Preparar una sesión de concentración", readOnly: false,
      effect: "Deja preparada una sesión en el temporizador; no la inicia.",
      params: { label: { type: "string", required: true, max: 80 }, minutes: { type: "int", required: true, min: 5, max: 180 }, taskId: { type: "id" } }, refs: { taskId: "tasks" },
    },
    "budget.set_limit": {
      module: "finance", label: "Ajustar un presupuesto", readOnly: false,
      effect: "Cambia el límite mensual de una categoría. No altera movimientos.",
      params: { category: { type: "string", required: true, max: 40 }, amountCents: { type: "int", required: true, min: 1, max: 100000000 } }, refs: {},
    },
    "goal.add_milestone": {
      module: "goals", label: "Añadir un hito a un objetivo", readOnly: false,
      effect: "Añade un hito; no modifica los existentes.",
      params: { goalId: { type: "id", required: true }, title: { type: "string", required: true, max: 120 }, due_date: { type: "date" } }, refs: { goalId: "goals" },
    },
    "navigate.review": {
      module: "app", label: "Revisar en su contexto", readOnly: true,
      effect: "Solo abre el elemento para que lo revises. No cambia datos.",
      params: { page: { type: "enum", required: true, values: PAGES }, itemId: { type: "id" } }, refs: {},
    },
  };

  const has = (t) => Object.prototype.hasOwnProperty.call(CATALOG, t);

  function validate(type, params) {
    const errors = [];
    if (!has(type)) return { ok: false, errors: [`Acción «${type}» no permitida.`], params: null };
    const spec = CATALOG[type].params, p = params && typeof params === "object" ? params : {};
    const out = {};
    for (const k of Object.keys(p)) if (!spec[k]) errors.push(`Parámetro «${k}» no permitido en ${type}.`);
    for (const [k, s] of Object.entries(spec)) {
      const v = p[k];
      if (v == null || v === "") { if (s.required) errors.push(`Falta «${k}».`); continue; }
      if (s.type === "string") {
        const t = String(v).trim();
        if (typeof v !== "string") errors.push(`«${k}» debe ser texto.`);
        else if (!t && s.required) errors.push(`«${k}» no puede estar vacío.`);
        else if (s.max && t.length > s.max) errors.push(`«${k}» supera ${s.max} caracteres.`);
        else out[k] = t;
      } else if (s.type === "int") {
        if (!Number.isInteger(v)) errors.push(`«${k}» debe ser un entero.`);
        else if ((s.min != null && v < s.min) || (s.max != null && v > s.max)) errors.push(`«${k}» fuera de rango (${s.min}–${s.max}).`);
        else out[k] = v;
      } else if (s.type === "date") {
        if (!L.isDayKey(v)) errors.push(`«${k}» debe ser una fecha AAAA-MM-DD válida.`);
        else out[k] = v;
      } else if (s.type === "id") {
        if (typeof v !== "string" && typeof v !== "number") errors.push(`«${k}» debe ser un identificador.`);
        else out[k] = String(v);
      } else if (s.type === "enum") {
        if (!s.values.includes(v)) errors.push(`«${k}» debe ser uno de: ${s.values.join(", ")}.`);
        else out[k] = v;
      }
    }
    return { ok: errors.length === 0, errors, params: errors.length ? null : out };
  }

  let seq = 0;
  function makeToken(type, params) {
    const s = type + JSON.stringify(params) + ":" + ++seq;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return "act_" + h.toString(36) + seq.toString(36);
  }

  // Prepara una acción: valida parámetros y, si se aporta la instantánea, que los elementos referidos existan.
  // NUNCA la ejecuta. Devuelve un token que habrá que presentar al ejecutar.
  function prepare(action, snapshot = null) {
    const type = action && action.type;
    const v = validate(type, action && action.params);
    const errors = [...v.errors];
    if (v.ok && snapshot) {
      for (const [param, coll] of Object.entries(CATALOG[type].refs)) {
        const id = v.params[param];
        if (id != null && !(snapshot[coll] || []).some((x) => x.id === id)) errors.push(`«${param}» no existe (ya no hay un elemento ${id} en ${coll}).`);
      }
    }
    if (errors.length) return { ok: false, type, errors, executed: false };
    const c = CATALOG[type];
    return {
      ok: true, type, module: c.module, params: v.params, label: action.label || c.label, preview: c.effect,
      readOnly: c.readOnly, requiresConfirmation: !c.readOnly, token: c.readOnly ? null : makeToken(type, v.params),
      errors: [], executed: false,
    };
  }

  // Ejecuta una acción preparada SOLO si hay confirmación explícita con su token y la app aporta el ejecutor.
  async function execute(prepared, confirmation, executor) {
    if (!prepared || !prepared.ok) return { executed: false, error: "La acción no está preparada o no es válida." };
    if (prepared.executed) return { executed: false, error: "La acción ya se ejecutó." };
    if (typeof executor !== "function") return { executed: false, error: "No hay ejecutor: el asistente no modifica datos por sí mismo." };
    if (prepared.requiresConfirmation && (!confirmation || confirmation.token !== prepared.token || confirmation.confirmed !== true)) {
      return { executed: false, error: "Falta la confirmación explícita del usuario." };
    }
    const result = await executor(prepared.type, prepared.params);
    prepared.executed = true;
    return { executed: true, result };
  }

  // Valida una lista de acciones propuestas por una fuente externa (p. ej. una futura IA) con las mismas reglas.
  function validateProposal(actions, snapshot = null) {
    const list = Array.isArray(actions) ? actions : [];
    const prepared = list.map((a) => prepare(a, snapshot));
    return { ok: prepared.every((p) => p.ok), prepared, rejected: prepared.filter((p) => !p.ok) };
  }

  // Descripción pública del catálogo (sin funciones), útil para una capa de IA futura
  function describe() {
    return Object.entries(CATALOG).map(([type, c]) => ({ type, module: c.module, label: c.label, readOnly: c.readOnly, effect: c.effect, params: c.params }));
  }

  return { CATALOG, PAGES, validate, prepare, execute, validateProposal, describe };
});
