"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");
const I = require("../intel.js");

const today = "2026-10-26"; // lunes
const mk = (o = {}) => ({ today, habits: [], byHabit: new Map(), tasks: [], lists: [], goals: [], transactions: [], budgets: [], sessions: [], ...o });
const task = (title, extra = {}) => ({ id: title, title, status: "todo", prio: 4, tags: [], notes: "", ...extra });
const tx = (type, amount, title, category, date) => ({ type, amount, title, category, tx_date: date });

test("sin datos: no inventa nada", () => {
  const a = I.analyze(mk());
  assert.equal(a.cards.length, 0);
  assert.equal(a.summary.hasData, false);
  assert.match(a.summary.state, /no hay datos suficientes/i);
});

test("tareas vencidas y próximas, con prioridad de las vencidas", () => {
  const a = I.analyze(mk({ tasks: [task("Entregar práctica", { due_date: "2026-10-27", prio: 1 }), task("Pagar tasa", { due_date: "2026-10-20" })] }));
  assert.equal(a.cards[0].id, "task-overdue");
  assert.ok(a.cards.some((c) => c.id === "task-soon-Entregar práctica"));
  const soon = a.cards.find((c) => c.id.startsWith("task-soon"));
  assert.ok(soon.evidence.some((e) => /No consta tiempo/.test(e)));
  assert.equal(soon.action.type, "task");
  assert.equal(a.summary.overdue, 1);
});

test("el tiempo registrado en el cronómetro con ese nombre cambia la evidencia", () => {
  const a = I.analyze(mk({ tasks: [task("Estudiar SQL", { due_date: "2026-10-27" })], sessions: [{ label: "estudiar sql", created_at: new Date(2026, 9, 25, 10).toISOString() }] }));
  assert.ok(a.cards[0].evidence.some((e) => /Hay tiempo registrado/.test(e)));
});

test("hábito parado: solo con registros reales y sin inventar motivos", () => {
  const created = new Date(2026, 9, 1).toISOString();
  const hb = { id: "h", name: "Leer", created_at: created };
  const a = I.analyze(mk({ habits: [hb], byHabit: new Map([["h", new Set(["2026-10-20"])]]) }));
  const c = a.cards.find((x) => x.id === "hab-stalled-h");
  assert.ok(c);
  assert.match(c.recommendation, /No se conoce el motivo/);
  assert.equal(c.action.prio, 3);
  // hábito creado hoy: nada que decir
  const b = I.analyze(mk({ habits: [{ id: "n", name: "Nuevo", created_at: new Date(2026, 9, 26, 8).toISOString() }] }));
  assert.equal(b.cards.length, 0);
});

test("presupuesto superado y gasto por encima del mes anterior (tramo comparable)", () => {
  const txs = [
    tx("expense", 120, "Cena", "Ocio", "2026-10-10"),
    tx("expense", 30, "Cine", "Ocio", "2026-09-10"),
    tx("expense", 200, "Fuera del tramo", "Ocio", "2026-09-28"),
  ];
  const a = I.analyze(mk({ transactions: txs, budgets: [{ category: "Ocio", amount: 100 }] }));
  assert.ok(a.cards.some((c) => c.id === "fin-budget-Ocio" && c.severity === 3));
  const v = a.cards.find((c) => c.id === "fin-vs-prev-Ocio");
  assert.ok(v, "compara hasta el día 26 de cada mes");
  assert.ok(v.evidence.some((e) => e.includes("30,00")), "no cuenta lo posterior al día 26 del mes anterior");
});

test("pagos recurrentes: mismo concepto e importe en meses distintos", () => {
  const a = I.analyze(mk({ transactions: [tx("expense", 9.99, "Streaming", "Ocio", "2026-09-05"), tx("expense", 9.99, "Streaming", "Ocio", "2026-10-05"), tx("expense", 9.99, "Otro", "Ocio", "2026-10-06")] }));
  const r = a.cards.find((c) => c.id === "fin-recurring");
  assert.ok(r);
  assert.equal(r.kind, "pattern");
  assert.ok(r.evidence.some((e) => /Estimación/.test(e)));
});

test("objetivo de ahorro sin tareas asociadas (relación por nombre)", () => {
  const g = { id: "g", name: "Portátil nuevo", target: 900, current: 300 };
  assert.ok(I.analyze(mk({ goals: [g] })).cards.some((c) => c.id === "goal-noaction-g"));
  assert.ok(!I.analyze(mk({ goals: [g], tasks: [task("Comparar portátil")] })).cards.some((c) => c.id === "goal-noaction-g"));
});

test("informe: incluye las 9 secciones, el prompt y respeta la minimización", () => {
  const d = mk({ tasks: [task("Examen privado", { due_date: "2026-10-27" })], transactions: [tx("expense", 50, "Concepto secreto", "Ocio", "2026-10-10")] });
  const full = I.buildReport(d, I.analyze(d));
  for (let i = 1; i <= 9; i++) assert.match(full, new RegExp(`## ${i}\\. `));
  assert.match(full, /Actúa como analista personal de CloudSpace/);
  assert.match(full, /Examen privado/);
  const min = I.buildReport(d, I.analyze(d), { includeTitles: false, includeConcepts: false });
  assert.doesNotMatch(min, /Examen privado|Concepto secreto/);
  assert.doesNotMatch(full, /@|token|apikey|password/i);
  const off = I.buildReport(d, I.analyze(d), { finance: false });
  assert.match(off, /No incluido por el usuario/);
});

test("importación: interpreta campos, valida fechas y no inventa", () => {
  const txt = `Aquí tienes mis recomendaciones:\n\n## 1. Reservar tiempo para el examen\n- **Categoría**: Tareas\n- **Problema**: El examen vence mañana.\n- **Acción**: Bloque de 45 minutos hoy.\n- **Prioridad**: Alta\n- **Fecha sugerida**: 2026-10-27\n- **Objetivo relacionado**: Aprobar SQL\n\n## 2. Revisar el presupuesto de ocio\nCategoría: Finanzas\nProblema: Superado.\nAcción: Ajustar el límite.\nPrioridad: baja\nFecha sugerida: 2020-01-01 <script>alert(1)</script>`;
  const r = I.parseClaudeResponse(txt, today);
  assert.equal(r.items.length, 2);
  assert.deepEqual([r.items[0].category, r.items[0].priority, r.items[0].suggested_date, r.items[0].goal], ["tareas", 2, "2026-10-27", "Aprobar SQL"]);
  assert.equal(r.items[1].suggested_date, null, "una fecha pasada no se propone");
  assert.equal(r.items[1].priority, 4);
  assert.ok(!JSON.stringify(r).includes("<script"));
});

test("importación: texto no interpretable se marca como tal", () => {
  const r = I.parseClaudeResponse("Hola, todo va bien. Sigue así.", today);
  assert.equal(r.unparsed, true);
  assert.equal(r.items.length, 0);
});

test("resumen semanal: cuenta lo completado en la semana y no inventa prioridades", () => {
  const d = mk({ tasks: [task("Hecha", { status: "done", completed_at: new Date(2026, 9, 26, 9).toISOString() }), task("Vieja", { status: "done", completed_at: new Date(2026, 9, 10, 9).toISOString() })] });
  const w = I.weeklyReview(d, I.analyze(d));
  assert.equal(w.tasks.done, 1);
  assert.equal(w.priorities.length, 0);
  assert.match(I.weeklyMarkdown(w), /Con los datos actuales no hay prioridades/);
});

test("una tarea creada desde una propuesta no genera propuestas nuevas, ni repite la original", () => {
  const orig = task("Entregar práctica", { due_date: "2026-10-27" });
  const mine = task("Empezar: Entregar práctica", { due_date: "2026-10-26", notes: "Bloque para avanzar «Entregar práctica» (vence 2026-10-27). Propuesta de CloudSpace Intelligence." });
  const a = I.analyze(mk({ tasks: [orig, mine] }));
  assert.equal(a.cards.filter((c) => c.id.startsWith("task-soon")).length, 0);
});
