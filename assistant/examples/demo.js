"use strict";
// Demo ejecutable con datos FICTICIOS:  node assistant/examples/demo.js
const L = require("../../logic.js");
const Engine = require("../assistantEngine.js");
const Data = require("../assistantData.js");

const now = new Date(2026, 9, 26, 19, 0); // lunes 26-oct-2026, 19:00
const today = L.dayKey(now), day = (n) => L.addDays(today, n), ts = (k) => `${k}T12:00:00`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => day(a + i));

const raw = {
  tasks: [
    { id: "t1", title: "Entregar práctica de Bases de Datos", status: "todo", prio: 1, due_date: day(-6), created_at: ts(day(-20)) },
    { id: "t2", title: "Pedir cita médica", status: "todo", prio: 3, due_date: day(-1), created_at: ts(day(-9)) },
    { id: "t3", title: "Preparar examen de Programación", status: "todo", prio: 2, due_date: day(2), created_at: ts(day(-5)) },
  ],
  habits: [
    { id: "h1", name: "Meditar", frequency: "Diario", created_at: ts(day(-80)) },
    { id: "h2", name: "Leer 20 min", frequency: "Diario", created_at: ts(day(-80)) },
  ],
  habit_logs: [
    ...range(-41, -15).filter((_, i) => i % 9 !== 4).map((d) => ({ habit_id: "h1", day: d })), ...[-14, -9, -3].map((n) => ({ habit_id: "h1", day: day(n) })),
    ...range(-12, -1).map((d) => ({ habit_id: "h2", day: d })),
  ],
  timer_sessions: [...[-26, -24, -22, -20, -18, -16, -12, -10, -8, -6, -5, -3, -2, -1].map((n) => ({ created_at: `${day(n)}T10:00:00`, duration_ms: 25 * 60000 }))],
  budgets: [{ category: "Comida", amount: 200 }, { category: "Ocio", amount: 80 }],
  transactions: [
    { type: "expense", amount: 172.4, title: "Compra", category: "Comida", tx_date: day(-3) },
    { type: "expense", amount: 64, title: "Cine y salidas", category: "Ocio", tx_date: day(-5) },
    ...["2026-09-05", "2026-08-05", "2026-07-05"].map((d) => ({ type: "expense", amount: 30, title: "Ocio", category: "Ocio", tx_date: d })),
  ],
};

(async () => {
  const e = Engine.create({ userId: "demo-user", adapter: Data.createMemoryAdapter(), now: () => now });
  await e.init();
  const r = e.evaluate(raw);
  console.log("=== SUGERENCIAS VISIBLES ===");
  for (const s of r.suggestions) console.log(`[${s.priorityScore}] ${s.urgency.padEnd(6)} conf ${s.confidence}  ${s.ruleId.padEnd(30)} ${s.title}`);
  console.log(`\nDetectadas pero ocultas: ${r.hiddenDetected}`);
  for (const x of e.listAll().filter((x) => x.status === "detected")) console.log(`  · ${x.ruleId} (${x.gateReason})`);
  console.log("\n=== BREVE (esquema) ===\n" + JSON.stringify(r.suggestions[0], null, 2));
  console.log("\n=== EXPLICACIÓN POR ID ===\n" + JSON.stringify(e.getExplanation(r.suggestions[0].id, raw), null, 2));
})();
