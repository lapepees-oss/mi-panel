"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");
const Data = require("../assistant/assistantData.js");
const Rules = require("../assistant/assistantRules.js");
const Scoring = require("../assistant/assistantScoring.js");
const Actions = require("../assistant/assistantActions.js");
const Feedback = require("../assistant/assistantFeedback.js");
const Engine = require("../assistant/assistantEngine.js");

/* ---------- Utilidades con datos FICTICIOS ---------- */
const TODAY = "2026-10-26"; // lunes
const day = (n) => L.addDays(TODAY, n);
const ts = (k, h = 12) => `${k}T${String(h).padStart(2, "0")}:00:00`;
function clockAt(y = 2026, m = 9, d = 26, h = 19) { const c = { t: new Date(y, m, d, h, 0) }; c.now = () => c.t; c.advance = (n, hh) => { c.t = new Date(c.t.getFullYear(), c.t.getMonth(), c.t.getDate() + n, hh == null ? c.t.getHours() : hh, 0); }; return c; }
async function mk({ userId = "u1", adapter = Data.createMemoryAdapter(), clock = clockAt(), guest = false, config } = {}) {
  const e = Engine.create({ userId: guest ? null : userId, guest, adapter, now: clock.now, config });
  await e.init();
  return { e, clock, adapter };
}
const T = (id, title, o = {}) => ({ id, title, status: "todo", prio: 4, created_at: ts(day(-10)), ...o });
const H = (id, name, o = {}) => ({ id, name, frequency: "Diario", created_at: ts(day(-80)), ...o });
const logs = (hid, days) => days.map((d) => ({ habit_id: hid, day: d }));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => day(a + i)); // a..b desplazamientos
const S = (k, min = 25) => ({ created_at: ts(k, 10), duration_ms: min * 60000 });
const X = (type, amount, category, date) => ({ type, amount, title: "x", category, tx_date: date });
const ids = (r) => r.suggestions.map((s) => s.ruleId);
// Tarea vencida hace 3 días RESPECTO AL RELOJ del test (para pruebas que avanzan el tiempo)
const overdueRaw = (clock, late = 3) => ({ tasks: [T("a", "A", { due_date: L.addDays(L.dayKey(clock.now()), -late) })] });
// Datos «vivos»: siempre una tarea vencida hace 3 días respecto al reloj (para tests que avanzan el tiempo)
const liveOverdue = (clock) => ({ get tasks() { return overdueRaw(clock).tasks; } });
const byRule = (r, id) => r.suggestions.find((s) => s.ruleId === id);

/* ---------- Sin datos / datos incompletos ---------- */

test("sin datos: ninguna sugerencia, todas las reglas omitidas con motivo", async () => {
  const { e } = await mk();
  const r = e.evaluate({});
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped.length, Rules.RULES.length);
  assert.ok(r.skipped.every((s) => s.reason && s.reason.length > 5));
  assert.equal(r.errors.length, 0);
});

test("datos incompletos o inválidos: se descartan y se cuentan, sin romper", async () => {
  const { e } = await mk();
  const raw = { tasks: [{ id: 1 }, null, T("2", "Válida", { due_date: "no-es-fecha", prio: 99 })], habits: [{ id: "h" }], transactions: [{ type: "expense", amount: -5, tx_date: TODAY }, X("expense", 10, "Comida", "2099-01-01")], timer_sessions: [{ created_at: "x", duration_ms: 5 }] };
  const snap = Data.normalize(raw, { now: new Date(2026, 9, 26, 12) });
  assert.equal(snap.tasks.length, 1);
  assert.equal(snap.tasks[0].due_date, null);
  assert.equal(snap.tasks[0].prio, 4);
  assert.equal(snap.quality.dropped.tasks, 2);
  assert.equal(snap.transactions.length, 0);
  assert.doesNotThrow(() => e.evaluate(raw));
  assert.doesNotThrow(() => e.evaluate(null));
});

test("un módulo con datos insuficientes no genera sugerencias (finanzas sin presupuesto)", async () => {
  const { e } = await mk();
  const r = e.evaluate({ transactions: [X("expense", 500, "Comida", day(-2))] });
  assert.equal(r.suggestions.filter((s) => s.module === "finance").length, 0);
  assert.ok(r.skipped.find((s) => s.ruleId === "finance.budget_near").reason.includes("presupuestos"));
});

/* ---------- Reglas: tareas ---------- */

test("tareas vencidas: una sugerencia agrupada con la evidencia correcta", async () => {
  const { e } = await mk();
  const r = e.evaluate({ tasks: [T("a", "Informe", { due_date: day(-8), prio: 2 }), T("b", "Llamar", { due_date: day(-1) }), T("c", "Futuro", { due_date: day(3) })] });
  const s = byRule(r, "task.overdue");
  assert.ok(s);
  assert.equal(s.evidence.metrics.count, 2);
  assert.equal(s.evidence.metrics.maxDaysLate, 8);
  assert.deepEqual(s.evidence.refs.map((x) => x.id).sort(), ["a", "b"]);
  assert.ok(!JSON.stringify(s).includes("Informe"), "el aviso breve no copia los títulos");
  assert.equal(s.schemaVersion, 1);
  for (const f of ["id", "ruleId", "module", "title", "summary", "priorityScore", "urgency", "confidence", "createdAt", "status", "evidence", "reasonCodes", "actions", "cooldownUntil"]) assert.ok(f in s, `falta ${f}`);
});

test("tarea importante con fecha cercana", async () => {
  const { e } = await mk();
  const r = e.evaluate({ tasks: [T("a", "Entrega", { due_date: day(1), prio: 1 }), T("b", "Lejana", { due_date: day(10), prio: 1 }), T("c", "Normal", { due_date: day(1), prio: 4 })] });
  const s = byRule(r, "task.important_near_deadline");
  assert.equal(s.evidence.metrics.count, 1);
  assert.equal(s.evidence.metrics.daysLeft, 1);
});

test("acumulación solo a partir del umbral", async () => {
  const { e } = await mk();
  const mkTasks = (n) => Array.from({ length: n }, (_, i) => T("t" + i, "Tarea " + i));
  assert.ok(!ids(e.evaluate({ tasks: mkTasks(24) })).includes("task.accumulation"));
  assert.ok(ids(e.evaluate({ tasks: mkTasks(30) })).includes("task.accumulation"));
});

test("aplazamientos repetidos: inactiva sin historial, activa con él", async () => {
  const { e } = await mk();
  const tasks = [T("a", "Pesada", { due_date: day(2) })];
  const r0 = e.evaluate({ tasks });
  assert.ok(r0.skipped.find((s) => s.ruleId === "task.repeated_postponement").reason.includes("historial"));
  const ev = [0, 1, 2].map((i) => ({ taskId: "a", type: "due_changed", at: ts(day(-10 + i * 3)), from: day(-8 + i), to: day(-5 + i) }));
  const r1 = e.evaluate({ tasks, taskEvents: ev });
  assert.equal(byRule(r1, "task.repeated_postponement").evidence.metrics.maxPostponements, 3);
});

test("revisión de prioridades: demasiadas P1", async () => {
  const { e } = await mk();
  const r = e.evaluate({ tasks: Array.from({ length: 7 }, (_, i) => T("u" + i, "U" + i, { prio: 1 })) });
  assert.ok(byRule(r, "task.priority_review").reasonCodes.includes("URGENT_OVERLOAD"));
});

/* ---------- Reglas: hábitos ---------- */

test("hábito pendiente: no antes de la hora configurada, sí después", async () => {
  const raw = { habits: [H("h", "Leer")], habit_logs: logs("h", range(-12, -1)) };
  const morning = await mk({ clock: clockAt(2026, 9, 26, 10) });
  assert.ok(!ids(morning.e.evaluate(raw)).includes("habit.pending_today"));
  const night = await mk({ clock: clockAt(2026, 9, 26, 20) });
  const s = byRule(night.e.evaluate(raw), "habit.pending_today");
  assert.ok(s);
  assert.ok(s.reasonCodes.includes("STREAK_AT_RISK"));
  const done = await mk({ clock: clockAt(2026, 9, 26, 20) });
  assert.ok(!ids(done.e.evaluate({ ...raw, habit_logs: logs("h", range(-12, 0)) })).includes("habit.pending_today"));
});

const dropFixture = (hid = "h", name = "Meditar") => ({ habit: H(hid, name), logs: logs(hid, [...range(-41, -15).filter((_, i) => i % 9 !== 4), ...[-14, -9, -3].map(day)]) });

test("caída de regularidad sostenida: números verificables en la explicación", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const f = dropFixture();
  const raw = { habits: [f.habit], habit_logs: f.logs };
  const r = e.evaluate(raw);
  const s = byRule(r, "habit.regularity_drop");
  assert.ok(s, JSON.stringify(r.skipped.filter((x) => x.module === "habits")));
  const m = s.evidence.metrics;
  assert.equal(m.recentDue, 14);
  assert.equal(m.baselineDue, 28);
  assert.equal(m.recentRate, Math.round((3 / 14) * 100));
  assert.ok(m.dropPoints >= 25);
  const exp = e.getExplanation(s.id, raw);
  assert.ok(exp.data.some((d) => d.includes(`${m.recentRate}%`)));
  assert.ok(exp.data.some((d) => d.includes(`${m.baselineRate}%`)));
  assert.ok(exp.hypotheses.every((h) => h.confirmed === false));
  assert.equal(exp.basis.type, "pattern");
});

test("patrón por día de la semana: visible cuando es relevante, solo detectado cuando no", async () => {
  const mondays = new Set(range(-56, -1).filter((k) => L.weekdayIndex(k) === 0));
  const done = range(-56, -1).filter((k) => !mondays.has(k) || k === day(-35));
  const raw = { habits: [H("h", "Gimnasio")], habit_logs: logs("h", done) };
  const mon = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const s = byRule(mon.e.evaluate(raw), "habit.weekday_pattern");
  assert.ok(s, "lunes: debería mostrarse");
  assert.equal(s.evidence.metrics.weekday, 0);
  assert.equal(s.evidence.metrics.dayDue, 8);
  const wed = await mk({ clock: clockAt(2026, 9, 28, 10) }); // miércoles: el lunes queda lejos
  const r = wed.e.evaluate(raw);
  assert.ok(!ids(r).includes("habit.weekday_pattern"));
  const rec = wed.e.listAll().find((x) => x.ruleId === "habit.weekday_pattern");
  assert.ok(rec && rec.status === "detected" && rec.gateReason === "not_timely", "detectada pero no mostrada");
});

test("hábitos de pocos datos: sin sugerencias de patrón", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const r = e.evaluate({ habits: [H("h", "Nuevo", { created_at: ts(day(-4)) })], habit_logs: logs("h", [day(-3), day(-2)]) });
  assert.ok(!ids(r).some((x) => ["habit.regularity_drop", "habit.weekday_pattern", "habit.review_plan"].includes(x)));
});

test("agrupación: 4 hábitos que caen se muestran como UNA sugerencia con detalle por elemento", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const hs = ["a", "b", "c", "d"].map((x) => dropFixture(x, "Hábito " + x));
  const raw = { habits: hs.map((x) => x.habit), habit_logs: hs.flatMap((x) => x.logs) };
  const r = e.evaluate(raw);
  const list = r.suggestions.filter((s) => s.ruleId === "habit.regularity_drop");
  assert.equal(list.length, 1);
  assert.equal(list[0].evidence.metrics.count, 4);
  const exp = e.getExplanation(list[0].id, raw);
  assert.equal(exp.valid, true);
  assert.equal(exp.data.filter((d) => d.startsWith("Periodo reciente")).length, 4);
});

/* ---------- Reglas: sesiones ---------- */

test("sesiones: menos frecuencia, y propuesta de sesión enlazada a una tarea", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const sessions = [...[-26, -24, -22, -20, -18, -16].map((n) => S(day(n))), S(day(-5)), S(day(-3)), S(day(-2))];
  const raw = { timer_sessions: sessions, tasks: [T("t1", "Estudiar BBDD", { prio: 2, due_date: day(1) })] };
  const r = e.evaluate(raw);
  const f = byRule(r, "focus.frequency_change");
  assert.ok(f, JSON.stringify(r.skipped.filter((x) => x.module === "timer")));
  assert.equal(f.evidence.metrics.priorCount, 6);
  assert.equal(f.evidence.metrics.recentCount, 3);
  assert.ok(f.reasonCodes.includes("FOCUS_FREQUENCY_DOWN"));
  // Con solo 3 sesiones recientes la propuesta existe pero su confianza es baja: queda detectada y sin mostrar
  assert.ok(!byRule(r, "focus.propose_session"));
  assert.equal(e.listAll().find((x) => x.ruleId === "focus.propose_session").gateReason, "low_confidence");
  // Con uso claro y regular (8 sesiones en 6 días distintos) sí se propone
  const reg = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const raw2 = { timer_sessions: [-12, -10, -8, -6, -5, -3, -2, -1].map((n) => S(day(n))), tasks: raw.tasks };
  const p = byRule(reg.e.evaluate(raw2), "focus.propose_session");
  assert.ok(p);
  const a = p.actions[0];
  assert.equal(a.type, "timer.prepare_session");
  assert.equal(a.params.taskId, "t1");
  assert.equal(a.params.minutes, 25);
});

test("sesiones: sin uso reciente no se propone nada", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const r = e.evaluate({ timer_sessions: [S(day(-40))], tasks: [T("t1", "X", { prio: 1 })] });
  assert.ok(!ids(r).includes("focus.propose_session"));
});

test("duración de sesiones: cambio detectado con muestra suficiente", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const sessions = [...[-26, -24, -22, -20, -18].map((n) => S(day(n), 50)), ...[-10, -8, -5, -3, -2].map((n) => S(day(n), 20))];
  const s = byRule(e.evaluate({ timer_sessions: sessions }), "focus.duration_change");
  assert.ok(s);
  assert.equal(s.evidence.metrics.changePct, -60);
});

/* ---------- Reglas: finanzas ---------- */

test("presupuesto cerca del límite / superado", async () => {
  const budgets = [{ category: "Comida", amount: 200 }, { category: "Ocio", amount: 100 }];
  const { e } = await mk();
  const r = e.evaluate({ budgets, transactions: [X("expense", 170, "Comida", day(-3)), X("expense", 30, "Ocio", day(-2))] });
  const c = r.suggestions.filter((s) => s.ruleId === "finance.budget_near");
  assert.equal(c.length, 1);
  assert.equal(c[0].evidence.metrics.category, "Comida");
  assert.equal(c[0].evidence.metrics.pct, 85);
  assert.equal(c[0].evidence.metrics.spentCents, 17000);
  const over = e.evaluate({ budgets, transactions: [X("expense", 130, "Ocio", day(-2))] });
  const o = over.suggestions.find((s) => s.ruleId === "finance.budget_near");
  assert.equal(o.urgency, "high");
  assert.ok(o.reasonCodes.includes("BUDGET_EXCEEDED"));
});

test("cambio frente a periodos comparables: con una sola referencia queda sin mostrar por confianza baja; con varias, se muestra", async () => {
  const budgets = [];
  const base = [X("expense", 80, "Ocio", day(-10))];
  const one = await mk();
  const r1 = one.e.evaluate({ budgets, transactions: [...base, X("expense", 30, "Ocio", "2026-09-05")] });
  assert.ok(!r1.suggestions.some((s) => s.ruleId === "finance.period_change"));
  const rec = one.e.listAll().find((x) => x.ruleId === "finance.period_change");
  assert.ok(rec && rec.gateReason === "low_confidence", "detectada pero con confianza insuficiente");
  const many = await mk();
  const txs = [...base, ...["2026-09-05", "2026-08-05", "2026-07-05", "2026-06-05"].map((d) => X("expense", 30, "Ocio", d))];
  const r2 = many.e.evaluate({ budgets, transactions: txs });
  const s = r2.suggestions.find((x) => x.ruleId === "finance.period_change" && x.evidence.metrics.category === "Ocio");
  assert.ok(s);
  assert.equal(s.evidence.metrics.changePct, 167);
  assert.equal(s.evidence.metrics.olderMonthsUsed, 3);
  assert.ok(s.confidence >= 0.75);
});

test("finanzas: no compara con un mes anterior vacío (no inventa)", async () => {
  const { e } = await mk();
  const r = e.evaluate({ transactions: [X("expense", 300, "Ocio", day(-3))] });
  assert.ok(!ids(r).includes("finance.period_change"));
});

/* ---------- Reglas: objetivos ---------- */

test("objetivos: sin avances, hito próximo y revisión", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10), config: { thresholds: { maxPerModule: 5 } } });
  const goals = [
    { id: "g1", title: "Aprender a dibujar", created_at: ts(day(-60)), last_progress_at: ts(day(-30)), milestones: [{ id: "m1", title: "Anatomía", due_date: day(3) }] },
    { id: "g2", title: "Examen", created_at: ts(day(-20)), last_progress_at: ts(day(-1)), milestones: [{ id: "m2", title: "Tema 1", due_date: day(-4) }] },
  ];
  const r = e.evaluate({ goals });
  assert.ok(byRule(r, "goal.no_progress"));
  assert.equal(byRule(r, "goal.milestone_upcoming").evidence.metrics.daysLeft, 3);
  assert.ok(byRule(r, "goal.review_split").reasonCodes.includes("MILESTONE_OVERDUE"));
  const none = e.evaluate({});
  assert.equal(none.suggestions.filter((s) => s.module === "goals").length, 0);
});

/* ---------- Puntuación y discreción ---------- */

test("prioridad ≠ confianza: fórmulas fijas y verificables", () => {
  const c = Scoring.confidence({ basis: "pattern", sample: { n: 4, full: 8 }, consistency: 0.5 });
  assert.equal(c.value, 0.38);
  assert.equal(Scoring.confidence({ basis: "fact", sample: { n: 1, full: 1 } }).value, 0.95);
  assert.ok(Scoring.confidence({ basis: "estimate", sample: { n: 100, full: 1 }, consistency: 1 }).value <= 0.6);
  const s = Scoring.score({ urgency: 1, impact: 1, basis: "pattern", sample: { n: 1, full: 20 }, consistency: 1 }, { weight: 1.2, isNew: true });
  assert.equal(s.priorityScore, 100);
  assert.ok(s.confidence < 0.3, "muy prioritaria pero poco fiable");
});

test("orden por prioridad: lo urgente va antes que lo informativo", async () => {
  const { e } = await mk();
  const r = e.evaluate({ tasks: [T("a", "A", { due_date: day(-12), prio: 1 })], habits: [H("h", "Leer")], habit_logs: logs("h", range(-5, -1)) });
  const scores = r.suggestions.map((s) => s.priorityScore);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(r.suggestions[0].ruleId, "task.overdue");
});

test("duplicados: evaluar varias veces no crea sugerencias repetidas ni cambia el id", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const id1 = e.evaluate(raw).suggestions[0].id;
  const id2 = e.evaluate(raw).suggestions[0].id;
  e.evaluate(raw);
  assert.equal(id1, id2);
  assert.equal(e.listAll().filter((s) => s.ruleId === "task.overdue").length, 1);
  assert.equal(e.exportState().suggestions[id1].shownCount, 1);
});

test("control de frecuencia: cuota diaria de sugerencias nuevas", async () => {
  const { e } = await mk({ config: { thresholds: { maxNewPerDay: 1 } } });
  const raw = { tasks: [T("a", "A", { due_date: day(-3), prio: 1 }), T("b", "B", { due_date: day(1), prio: 1 }), ...Array.from({ length: 8 }, (_, i) => T("p" + i, "P", { prio: 1 }))], habits: [H("h", "Leer")], habit_logs: logs("h", range(-5, -1)) };
  const r = e.evaluate(raw);
  assert.equal(r.suggestions.length, 1, "solo entra una nueva hoy");
  assert.ok(e.listAll().some((s) => s.gateReason === "daily_limit"));
});

test("control de frecuencia: límite por módulo y total", async () => {
  const { e } = await mk({ config: { thresholds: { maxPerModule: 1, maxNewPerDay: 10 } } });
  const raw = { tasks: [T("a", "A", { due_date: day(-3), prio: 1 }), T("b", "B", { due_date: day(1), prio: 1 })] };
  const r = e.evaluate(raw);
  assert.equal(r.suggestions.filter((s) => s.module === "tasks").length, 1);
  assert.ok(e.listAll().some((s) => s.gateReason === "capacity_module"));
});

test("sugerencia retirada cuando la situación desaparece", async () => {
  const { e } = await mk();
  assert.equal(e.evaluate({ tasks: [T("a", "A", { due_date: day(-3) })] }).suggestions.length, 1);
  const r = e.evaluate({ tasks: [T("a", "A", { due_date: day(-3), status: "done" })] });
  assert.equal(r.suggestions.length, 0);
  assert.equal(e.listAll().find((s) => s.ruleId === "task.overdue").status, "resolved");
});

test("actualización al cambiar los datos: mismo id, evidencia nueva", async () => {
  const { e } = await mk();
  const a = e.evaluate({ tasks: [T("a", "A", { due_date: day(-3) })] }).suggestions[0];
  const b = e.evaluate({ tasks: [T("a", "A", { due_date: day(-3) }), T("b", "B", { due_date: day(-1) })] }).suggestions[0];
  assert.equal(a.id, b.id);
  assert.equal(a.evidence.metrics.count, 1);
  assert.equal(b.evidence.metrics.count, 2);
});

/* ---------- Feedback ---------- */

test("rechazar: silencio de 14 días, no es permanente; vuelve cuando termina", async () => {
  const { e, clock } = await mk();
  const raw = () => overdueRaw(clock);
  const s = e.evaluate(raw()).suggestions[0];
  const res = e.feedback(s.id, "reject");
  assert.equal(res.status, "dismissed");
  assert.equal(res.cooldownUntil, day(14));
  assert.equal(e.evaluate(raw()).suggestions.length, 0);
  clock.advance(10);
  assert.equal(e.evaluate(raw()).suggestions.length, 0, "sigue en silencio");
  clock.advance(5);
  assert.equal(e.evaluate(raw()).suggestions.length, 1, "pasado el cooldown vuelve a poder aparecer");
});

test("no relevante > rechazar; rechazos repetidos alargan el silencio (con tope)", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  let s = e.evaluate(raw).suggestions[0];
  assert.equal(e.feedback(s.id, "not_relevant").cooldownUntil, day(30));
  clock.advance(31);
  s = e.evaluate(raw).suggestions[0];
  const second = e.feedback(s.id, "reject");
  assert.equal(second.cooldownUntil, L.addDays(L.dayKey(clock.now()), 28), "14 × (1 + 1 descarte previo)");
});

test("posponer y ocultar respetan el periodo elegido y validan los días", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  const s = e.evaluate(raw).suggestions[0];
  assert.throws(() => e.feedback(s.id, "postpone", { days: 0 }));
  assert.throws(() => e.feedback(s.id, "hide", { days: 400 }));
  assert.equal(e.feedback(s.id, "postpone", { days: 2 }).cooldownUntil, day(2));
  assert.equal(e.evaluate(raw).suggestions.length, 0);
  clock.advance(3);
  assert.equal(e.evaluate(raw).suggestions.length, 1);
  const s2 = e.getVisible()[0];
  e.feedback(s2.id, "hide", { days: 10 });
  assert.equal(e.getVisible().length, 0);
});

test("aceptar y modificar: no vuelve a molestar durante 7 días", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const s = e.evaluate(raw).suggestions[0];
  const m = e.feedback(s.id, "modify", { note: "Lo muevo yo" });
  assert.equal(m.status, "accepted");
  assert.equal(e.evaluate(raw).suggestions.length, 0);
  assert.ok(e.getExplanation(s.id, raw).limitations.some((l) => l.includes("Lo muevo yo")), "la explicación recuerda la respuesta previa");
});

test("cambio importante rompe el silencio de un rechazo (pero no el de un aplazamiento explícito)", async () => {
  const mkRaw = (late) => ({ tasks: [T("a", "A", { due_date: day(-late), prio: 1 })] });
  const a = await mk();
  const sA = a.e.evaluate(mkRaw(1)).suggestions[0];
  assert.notEqual(sA.urgency, "high");
  a.e.feedback(sA.id, "reject");
  assert.equal(a.e.evaluate(mkRaw(1)).suggestions.length, 0);
  const rA = a.e.evaluate(mkRaw(30));
  assert.equal(rA.suggestions.length, 1, "la urgencia pasó a alta: cambio importante");
  const b = await mk();
  const sB = b.e.evaluate(mkRaw(1)).suggestions[0];
  b.e.feedback(sB.id, "postpone", { days: 5 });
  assert.equal(b.e.evaluate(mkRaw(30)).suggestions.length, 0, "el periodo elegido por el usuario se respeta");
});

test("sin respuesta: tras varios días visible pasa a silencio temporal, sin contarse como rechazo", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  const s = e.evaluate(raw).suggestions[0];
  clock.advance(4);
  const r = e.evaluate(raw);
  assert.equal(r.suggestions.length, 0);
  const rec = e.exportState().suggestions[s.id];
  assert.equal(rec.lastFeedback.type, "no_response");
  assert.equal(rec.dismissals || 0, 0);
});

test("el feedback ajusta el peso de la regla de forma acotada", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  for (let i = 0; i < 12; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "not_relevant"); clock.advance(121); }
  const w = e.ruleCatalog().find((r) => r.id === "task.overdue").weight;
  assert.equal(w, Feedback.W_MIN);
});

/* ---------- Memoria ---------- */

test("memoria: patrón observado tras repetidos descartes; hipótesis a los 5; nada es permanente sin confirmar", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  for (let i = 0; i < 3; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "reject"); clock.advance(40); }
  let view = e.memory.centerView();
  assert.equal(view.observed.length, 1);
  assert.equal(view.confirmed.length, 0);
  assert.equal(e.ruleCatalog().find((r) => r.id === "task.overdue").disabled, false, "no se desactiva solo");
  for (let i = 0; i < 2; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "reject"); clock.advance(40); }
  view = e.memory.centerView();
  assert.equal(view.inferred.length, 1);
  assert.equal(e.pendingConfirmations().length, 1);
  assert.equal(e.evaluate(raw).suggestions.length, 1, "la hipótesis no cambia nada hasta confirmarse");
  e.confirmMemory(e.pendingConfirmations()[0].id);
  assert.equal(e.ruleCatalog().find((r) => r.id === "task.overdue").disabled, true);
  assert.equal(e.evaluate(raw).suggestions.length, 0);
});

test("memoria: eliminar un recuerdo no se reconstruye con el mismo comportamiento", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  for (let i = 0; i < 3; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "reject"); clock.advance(40); }
  const entry = e.memory.list({ kind: "observed" })[0];
  assert.ok(entry.reason.length > 10 && entry.createdAt && entry.scope.type === "rule");
  e.memory.remove(entry.id);
  for (let i = 0; i < 3; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "reject"); clock.advance(40); }
  assert.equal(e.memory.list({ kind: "observed" }).length, 0);
  e.memory.set(entry.key, { count: 1 }, "Lo repongo yo");
  assert.equal(e.memory.list({ kind: "confirmed" }).length, 1, "solo el usuario puede reponerlo");
});

test("memoria: aprendizaje pausado no aprende ni ajusta pesos; lo confirmado sigue", async () => {
  const { e, clock } = await mk();
  const raw = liveOverdue(clock);
  e.memory.set("pref.demo", true, "El usuario lo pidió", { type: "global" });
  e.memory.setLearningPaused(true);
  for (let i = 0; i < 4; i++) { const s = e.evaluate(raw).suggestions[0]; e.feedback(s.id, "not_relevant"); clock.advance(121); }
  assert.equal(e.memory.list({ kind: "observed" }).length, 0);
  assert.equal(e.ruleCatalog().find((r) => r.id === "task.overdue").weight, 1);
  assert.equal(e.memory.effective("pref.demo").applies, true);
  assert.equal(e.memory.effective("pref.demo", { allowUnconfirmed: true }).applies, true);
});

test("memoria: pausar, editar y alcance temporal caducado", async () => {
  const { e, clock } = await mk();
  const en = e.memory.set("pref.x", 1, "razón", { type: "temporal", until: day(2) });
  assert.equal(e.memory.effective("pref.x").applies, true);
  e.memory.pause(en.id, true);
  assert.equal(e.memory.effective("pref.x").applies, false);
  e.memory.pause(en.id, false);
  e.memory.update(en.id, { value: 2 });
  assert.equal(e.memory.effective("pref.x").value, 2);
  assert.throws(() => e.memory.set("pref.y", 1, "r", { type: "temporal" }));
  clock.advance(5);
  e.evaluate({});
  assert.equal(e.memory.find("pref.x"), null, "caducó");
});

/* ---------- Explicación profunda ---------- */

test("explicación por id: todas las secciones obligatorias y coherente con los datos", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "Informe final", { due_date: day(-8), prio: 2 }), T("b", "Llamar al banco", { due_date: day(-1) })] };
  const s = e.evaluate(raw).suggestions[0];
  const x = e.getExplanation(s.id, raw);
  assert.equal(x.valid, true);
  for (const k of ["situation", "rulesActivated", "data", "period", "influencingPatterns", "hypotheses", "confidence", "priority", "proposedActions", "limitations", "basis"]) assert.ok(k in x, `falta ${k}`);
  assert.equal(x.rulesActivated[0].id, "task.overdue");
  assert.ok(x.data.some((d) => d.includes("Informe final") && d.includes("hace 8 días")));
  assert.ok(x.data.some((d) => d.includes("Llamar al banco") && d.includes("hace 1 día")));
  assert.equal(x.period.from, day(-8));
  assert.equal(x.period.to, TODAY);
  assert.ok(x.confidence.method.length > 20 && x.confidence.components.length >= 1);
  assert.ok(x.priority.formula.includes("0,45"));
  assert.ok(x.limitations.some((l) => l.includes("situación actual")), "sin historial: lo dice");
  assert.equal(x.proposedActions.every((a) => a.executed === false), true);
});

test("explicación: patrón con muestra pequeña avisa de sus límites; hipótesis no confirmadas", async () => {
  const { e } = await mk({ clock: clockAt(2026, 9, 26, 10) });
  const budgets = [];
  const txs = [X("expense", 80, "Ocio", day(-10)), ...["2026-09-05", "2026-08-05"].map((d) => X("expense", 30, "Ocio", d))];
  const raw = { budgets, transactions: txs };
  e.evaluate(raw);
  const rec = e.listAll().find((r) => r.ruleId === "finance.period_change" && r.evidence.metrics.category === "Ocio");
  assert.ok(rec);
  const x = e.getExplanation(rec.id, raw);
  assert.equal(x.basis.type, "pattern");
  assert.ok(x.limitations.some((l) => l.includes("muestra")));
  assert.ok(x.limitations.some((l) => l.includes("movimientos")));
  assert.ok(x.hypotheses.length > 0 && x.hypotheses.every((h) => !h.confirmed));
  assert.ok(x.data.some((d) => d.includes("Media de 1 mes previo")));
});

test("explicación: si la situación ya no se da, se indica y la sugerencia se retira", async () => {
  const { e } = await mk();
  const s = e.evaluate({ tasks: [T("a", "A", { due_date: day(-3) })] }).suggestions[0];
  const x = e.getExplanation(s.id, { tasks: [T("a", "A", { due_date: day(5) })] });
  assert.equal(x.valid, false);
  assert.ok(x.reason.includes("ya no se da"));
  assert.equal(e.listAll().find((r) => r.id === s.id).status, "resolved");
  assert.equal(e.getExplanation("sg_inexistente", {}).found, false);
});

test("explicación de un grupo y acciones revalidadas con los datos actuales", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const s = e.evaluate(raw).suggestions[0];
  const resched = e.prepareActions(s.id, raw).find((a) => a.type === "task.reschedule");
  assert.ok(resched && resched.params.taskId === "a" && resched.params.due_date === day(1));
  assert.equal(resched.executed, false);
});

/* ---------- Acciones ---------- */

test("acciones preparadas pero NO ejecutadas sin confirmación explícita", async () => {
  const calls = [];
  const executor = async (type, params) => { calls.push([type, params]); return "ok"; };
  const snap = { tasks: [{ id: "a" }], habits: [], goals: [] };
  const p = Actions.prepare({ type: "task.reschedule", params: { taskId: "a", due_date: day(1) } }, snap);
  assert.equal(p.ok, true);
  assert.equal(p.executed, false);
  assert.equal(calls.length, 0);
  assert.equal((await Actions.execute(p, null, executor)).executed, false);
  assert.equal((await Actions.execute(p, { token: "falso", confirmed: true }, executor)).executed, false);
  assert.equal((await Actions.execute(p, { token: p.token, confirmed: false }, executor)).executed, false);
  assert.equal((await Actions.execute(p, { token: p.token, confirmed: true }, undefined)).executed, false, "sin ejecutor no hay cambios");
  assert.equal(calls.length, 0);
  assert.equal((await Actions.execute(p, { token: p.token, confirmed: true }, executor)).executed, true);
  assert.equal(calls.length, 1);
  assert.equal((await Actions.execute(p, { token: p.token, confirmed: true }, executor)).executed, false, "no se ejecuta dos veces");
});

test("acciones: validación estricta de parámetros y del catálogo", () => {
  const snap = { tasks: [{ id: "a" }] };
  assert.equal(Actions.prepare({ type: "db.drop_table", params: {} }).ok, false);
  assert.equal(Actions.prepare({ type: "task.set_priority", params: { taskId: "a", prio: 9 } }, snap).ok, false);
  assert.equal(Actions.prepare({ type: "task.set_priority", params: { taskId: "a", prio: 2, extra: 1 } }, snap).ok, false);
  assert.equal(Actions.prepare({ type: "task.reschedule", params: { taskId: "a", due_date: "mañana" } }, snap).ok, false);
  assert.equal(Actions.prepare({ type: "task.reschedule", params: { taskId: "zzz", due_date: day(1) } }, snap).ok, false, "elemento inexistente");
  assert.equal(Actions.prepare({ type: "habit.set_frequency", params: { habitId: "h", frequency: "Cada hora" } }).ok, false);
  assert.equal(Actions.prepare({ type: "navigate.review", params: { page: "tasks" } }).requiresConfirmation, false);
});

test("el motor nunca ejecuta acciones por su cuenta", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  e.evaluate(raw);
  const out = await e.executeAction(e.prepareActions(e.getVisible()[0].id, raw).find((a) => a.type === "task.reschedule"), null, async () => { throw new Error("no debería llamarse"); });
  assert.equal(out.executed, false);
});

/* ---------- Capa para IA futura ---------- */

test("contexto para IA: minimizado por defecto, sin llamadas a ninguna API", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "Secreto personal", { due_date: day(-3) })], habits: [H("h", "Terapia semanal")] };
  e.evaluate(raw);
  const c = e.aiContext(raw);
  const json = JSON.stringify(c);
  assert.ok(!json.includes("Secreto personal") && !json.includes("Terapia"));
  assert.equal(c.includesTitles, false);
  assert.equal(c.tasks.overdue, 1);
  assert.ok(c.allowedActions.length === Object.keys(Actions.CATALOG).length);
  assert.ok(c.constraints.length >= 4);
  assert.ok(JSON.stringify(e.aiContext(raw, { includeTitles: true })).includes("Secreto personal"));
});

test("salida de un modelo externo: solo propuestas válidas del catálogo, sin confirmar ni ejecutar", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A")] };
  const out = e.validateModelOutput({ proposals: [
    { type: "task.create", params: { title: "Practicar 20 min" }, rationale: "Hipótesis del modelo" },
    { type: "task.set_priority", params: { taskId: "a", prio: 1 } },
    { type: "shell.exec", params: { cmd: "rm -rf /" } },
    { type: "task.create", params: { title: "" } },
    { type: "task.reschedule", params: { taskId: "fantasma", due_date: day(1) } },
  ] }, raw);
  assert.equal(out.accepted.length, 2);
  assert.equal(out.rejected.length, 3);
  assert.ok(out.accepted.every((p) => p.confirmed === false && p.executed === false && p.origin === "external-model" && p.requiresConfirmation));
  assert.equal(out.executedAnything, false);
});

/* ---------- Ajustes ---------- */

test("ajustes: pausar categoría, desactivar regla, pausar todo, umbrales validados", async () => {
  const { e } = await mk();
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  assert.equal(e.evaluate(raw).suggestions.length, 1);
  e.settings.pauseModule("tasks");
  assert.equal(e.evaluate(raw).suggestions.length, 0);
  assert.ok(e.evaluate(raw).skipped.find((s) => s.ruleId === "task.overdue").reason.includes("pausa"));
  e.settings.resumeModule("tasks");
  e.settings.disableRule("task.overdue");
  assert.equal(e.evaluate(raw).suggestions.length, 0);
  e.settings.enableRule("task.overdue");
  e.settings.pauseAll(true);
  assert.equal(e.evaluate(raw).paused, true);
  e.settings.pauseAll(false);
  assert.throws(() => e.settings.setThresholds({ minPriority: 500 }));
  assert.throws(() => e.settings.setThresholds({ nope: 1 }));
  assert.throws(() => e.settings.pauseModule("inventado"));
  e.settings.setThresholds({ minPriority: 90 });
  assert.equal(e.evaluate(raw).suggestions.length, 0, "umbral alto: detecta pero no muestra");
  assert.ok(e.listAll().length > 0);
  e.settings.setRuleConfig("habits", { eveningHour: 10 });
  assert.equal(e.settings.get().effectiveRules.habits.eveningHour, 10);
  assert.throws(() => e.settings.setRuleConfig("habits", { noExiste: 1 }));
});

/* ---------- Persistencia y aislamiento ---------- */

test("persistencia: el estado sobrevive entre sesiones del mismo usuario", async () => {
  const adapter = Data.createMemoryAdapter();
  const a = await mk({ adapter });
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const s = a.e.evaluate(raw).suggestions[0];
  a.e.feedback(s.id, "reject");
  a.e.memory.set("pref.demo", 1, "razón");
  await a.e.flush();
  const b = await mk({ adapter, clock: a.clock });
  assert.equal(b.e.evaluate(raw).suggestions.length, 0, "recuerda el rechazo");
  assert.equal(b.e.memory.effective("pref.demo").applies, true);
});

test("aislamiento entre usuarios: la memoria y el feedback de uno no afectan a otro", async () => {
  const adapter = Data.createMemoryAdapter();
  const a = await mk({ adapter, userId: "alice" });
  const b = await mk({ adapter, userId: "bob" });
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const s = a.e.evaluate(raw).suggestions[0];
  a.e.feedback(s.id, "not_relevant");
  a.e.memory.set("pref.privada", "solo alice", "r");
  await a.e.flush();
  const b2 = await mk({ adapter, userId: "bob", clock: b.clock });
  assert.equal(b2.e.evaluate(raw).suggestions.length, 1, "Bob sigue viendo la sugerencia");
  assert.equal(b2.e.memory.find("pref.privada"), null);
  await assert.rejects(() => adapter.load(""));
  assert.throws(() => Engine.create({ adapter }), /userId/);
});

test("modo invitado: sin persistencia, sin memoria entre sesiones", async () => {
  const calls = [];
  const spy = { async load() { calls.push("load"); return null; }, async save() { calls.push("save"); }, async clear() { calls.push("clear"); } };
  const g = await mk({ guest: true, adapter: spy });
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  const s = g.e.evaluate(raw).suggestions[0];
  g.e.feedback(s.id, "reject");
  await g.e.flush();
  assert.equal(g.e.persistent, false);
  assert.deepEqual(calls, []);
  const g2 = await mk({ guest: true, adapter: spy });
  assert.equal(g2.e.evaluate(raw).suggestions.length, 1);
});

test("fallo de persistencia: el motor sigue funcionando y lo registra", async () => {
  const bad = { async load() { return null; }, async save() { throw new Error("sin red"); }, async clear() {} };
  const { e } = await mk({ adapter: bad });
  const r = e.evaluate({ tasks: [T("a", "A", { due_date: day(-3) })] });
  await e.flush();
  assert.equal(r.suggestions.length, 1);
  assert.match(String(e.lastPersistError), /sin red/);
});

test("adaptador Supabase (contra un cliente simulado, NO contra Supabase real)", async () => {
  const rows = new Map();
  const client = { from: () => ({
    select: () => ({ eq: (_, u) => ({ maybeSingle: async () => ({ data: rows.has(u) ? { state: rows.get(u) } : null, error: null }) }) }),
    upsert: async (row) => { rows.set(row.user_id, row.state); return { error: null }; },
    delete: () => ({ eq: async (_, u) => { rows.delete(u); return { error: null }; } }),
  }) };
  const ad = Data.createSupabaseAdapter(client);
  const a = await mk({ adapter: ad, userId: "uuid-1" });
  const raw = { tasks: [T("a", "A", { due_date: day(-3) })] };
  a.e.feedback(a.e.evaluate(raw).suggestions[0].id, "reject");
  await a.e.flush();
  assert.ok(rows.has("uuid-1"));
  assert.equal((await mk({ adapter: ad, userId: "uuid-1", clock: a.clock })).e.evaluate(raw).suggestions.length, 0);
  await a.e.reset();
  assert.equal(rows.has("uuid-1"), false);
});

test("reglas aisladas: una regla que falla no impide las demás", () => {
  const broken = { id: "x.broken", module: "tasks", version: 1, label: "x", description: "x", minData: () => ({ ok: true }), detect() { throw new Error("boom"); } };
  Rules.RULES.push(broken);
  try {
    const snap = Data.normalize({ tasks: [T("a", "A", { due_date: day(-3) })] }, { now: new Date(2026, 9, 26, 12) });
    const r = Rules.runAll(snap, {});
    assert.equal(r.errors.length, 1);
    assert.ok(r.candidates.some((c) => c.ruleId === "task.overdue"));
  } finally { Rules.RULES.pop(); }
});
