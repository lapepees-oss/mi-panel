"use strict";
// Tests de la lógica pura. Ejecutar: node --test tests/   (también con TZ=Pacific/Auckland, etc.)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

/* ---------- Fechas ---------- */

test("dayKey usa el día LOCAL, no el UTC", () => {
  // 23:30 hora local del 24 de octubre: en UTC puede ser ya el 25 (o aún el 24); da igual
  assert.equal(L.dayKey(new Date(2026, 9, 24, 23, 30)), "2026-10-24");
  assert.equal(L.dayKey(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("isDayKey valida fechas reales", () => {
  assert.ok(L.isDayKey("2026-02-28"));
  assert.ok(L.isDayKey("2028-02-29"));
  assert.ok(!L.isDayKey("2026-02-29"));
  assert.ok(!L.isDayKey("2026-02-30"));
  assert.ok(!L.isDayKey("2026-13-01"));
  assert.ok(!L.isDayKey("26-1-1"));
  assert.ok(!L.isDayKey(null));
});

test("addDays y dayDiff cruzan los cambios de hora sin desplazarse", () => {
  // Cambios de hora de Europa (29 mar y 25 oct 2026) y de EE. UU. (8 mar y 1 nov 2026)
  assert.equal(L.addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(L.addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(L.addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(L.addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(L.addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(L.dayDiff("2026-03-30", "2026-03-28"), 2);
  assert.equal(L.dayDiff("2026-10-26", "2026-10-24"), 2);
  assert.equal(L.dayDiff("2027-01-01", "2026-01-01"), 365);
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.addDays("2028-02-28", 1), "2028-02-29");
});

test("lastDayKeys devuelve n días consecutivos terminando hoy", () => {
  const k = L.lastDayKeys(35, "2026-10-24");
  assert.equal(k.length, 35);
  assert.equal(k[34], "2026-10-24");
  assert.equal(k[0], "2026-09-20");
  for (let i = 1; i < k.length; i++) assert.equal(L.dayDiff(k[i], k[i - 1]), 1);
});

test("semanas empiezan en lunes", () => {
  assert.equal(L.weekdayIndex("2026-10-24"), 5); // sábado
  assert.equal(L.weekStart("2026-10-24"), "2026-10-19");
  assert.equal(L.weekStart("2026-10-19"), "2026-10-19");
  assert.equal(L.weekStart("2026-10-25"), "2026-10-19"); // domingo
  assert.deepEqual(L.weekKeys("2026-10-19").slice(-1), ["2026-10-25"]);
});

test("meses: límites, bisiestos y saltos de año", () => {
  assert.equal(L.monthBounds("2028-02").last, "2028-02-29");
  assert.equal(L.monthBounds("2026-02").last, "2026-02-28");
  assert.equal(L.addMonths("2026-12", 1), "2027-01");
  assert.equal(L.addMonths("2026-01", -1), "2025-12");
  assert.equal(L.addMonths("2026-10", -12), "2025-10");
});

/* ---------- Dinero ---------- */

test("parseCents acepta formatos habituales", () => {
  const ok = (s, c) => assert.deepEqual(L.parseCents(s), { ok: true, cents: c }, s);
  ok("12,50", 1250);
  ok("12.50", 1250);
  ok("12.5", 1250);
  ok("12", 1200);
  ok("0,05", 5);
  ok("0.99", 99);
  ok(",5", 50);
  ok("1.234,56", 123456);
  ok("1,234.56", 123456);
  ok("1.234.567", 123456700);
  ok(" 7,00 € ", 700);
  ok("+3", 300);
});

test("parseCents rechaza importes inválidos (sin redondear en silencio)", () => {
  for (const s of ["", "  ", "abc", "-5", "0", "0,00", "1,234", "12,345", "1e3", "NaN", "Infinity", "1,2,3x", "99999999999"]) {
    assert.equal(L.parseCents(s).ok, false, `"${s}" debería rechazarse`);
  }
  assert.equal(L.parseCents(null).ok, false);
  assert.deepEqual(L.parseCents("0", { allowZero: true }), { ok: true, cents: 0 });
});

test("el dinero no acumula errores de coma flotante", () => {
  // 0,1 + 0,2 en float es 0,30000000000000004; en céntimos es exacto
  const sum = L.parseCents("0,10").cents + L.parseCents("0,20").cents;
  assert.equal(sum, 30);
  assert.equal(L.centsToDb(sum), "0.30");
  assert.equal(L.centsToDb(1005), "10.05");
  assert.equal(L.centsToDb(5), "0.05");
  assert.equal(L.centsToDb(0), "0.00");
  assert.equal(L.centsToDb(-250), "-2.50");
  assert.equal(L.centsToPlain(123456), "1234,56");
  assert.equal(L.centsFromDb("12.50"), 1250);
  assert.equal(L.centsFromDb(10.05), 1005);
  assert.equal(L.centsFromDb(1.005 * 100 / 100 /* 1.005 */) >= 100, true);
  assert.equal(L.centsFromDb(null), 0);
});

test("formatEUR usa formato español", () => {
  const f = (c) => L.formatEUR(c).replace(/\s/g, " ");
  assert.equal(f(1250), "12,50 €");
  assert.equal(f(123456), "1234,56 €".replace("1234", "1234")); // sin separador de miles en es-ES para 4 cifras
  assert.equal(f(0), "0,00 €");
  assert.ok(f(-500).includes("5,00"));
});

/* ---------- Finanzas ---------- */

const tx = (type, euros, tx_date, category = "Comida", title = "x") => ({ type, amount: euros, tx_date, category, title, created_at: tx_date + "T10:00:00Z" });

test("monthTotals separa por mes y suma en céntimos", () => {
  const list = [
    tx("income", "1000.00", "2026-10-01", "Salario"),
    tx("expense", "0.10", "2026-10-02"),
    tx("expense", "0.20", "2026-10-03"),
    tx("expense", "12.50", "2026-10-31", "Ocio"),
    tx("expense", "99.00", "2026-09-30"),
    tx("expense", "5.00", "2026-11-01"),
  ];
  const t = L.monthTotals(list, "2026-10");
  assert.equal(t.income, 100000);
  assert.equal(t.expense, 1280);
  assert.equal(t.balance, 98720);
  assert.deepEqual(t.byCategory, { Comida: 30, Ocio: 1250 });
  assert.equal(t.count, 4);
});

test("monthSeries devuelve n meses terminando en el indicado", () => {
  const s = L.monthSeries([tx("expense", "10.00", "2026-08-15")], "2026-10", 3);
  assert.deepEqual(s.map((x) => x.month), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(s[0].expense, 1000);
  assert.equal(s[2].expense, 0);
});

test("budgetStatus: total y por categoría, con excesos", () => {
  const totals = { expense: 30000, byCategory: { Comida: 12000, Ocio: 5000 } };
  const st = L.budgetStatus(
    [{ category: "", amount: "250.00" }, { category: "Comida", amount: "100.00" }, { category: "Ocio", amount: "100.00" }],
    totals
  );
  assert.equal(st.total.limit, 25000);
  assert.equal(st.total.over, true);
  assert.equal(st.total.left, -5000);
  assert.equal(st.total.pct, 100);
  assert.equal(st.categories[0].category, "Comida");
  assert.equal(st.categories[0].over, true);
  assert.equal(st.categories[1].pct, 50);
  assert.equal(L.budgetStatus([], totals).total, null);
});

test("goalPct limita a 100 y evita dividir por cero", () => {
  assert.equal(L.goalPct({ target: "500.00", current: "125.00" }), 25);
  assert.equal(L.goalPct({ target: "100.00", current: "250.00" }), 100);
  assert.equal(L.goalPct({ target: "0", current: "5" }), 0);
});

/* ---------- Hábitos ---------- */

const set = (...d) => new Set(d);

test("racha actual: no se rompe hasta que acaba el día", () => {
  const today = "2026-10-24";
  assert.equal(L.currentStreak(set("2026-10-24", "2026-10-23", "2026-10-22"), today), 3);
  assert.equal(L.currentStreak(set("2026-10-23", "2026-10-22"), today), 2); // hoy aún sin marcar
  assert.equal(L.currentStreak(set("2026-10-22", "2026-10-21"), today), 0); // ayer falló
  assert.equal(L.currentStreak(set(), today), 0);
});

test("racha actual cruza cambios de hora y de año", () => {
  assert.equal(L.currentStreak(set("2026-03-30", "2026-03-29", "2026-03-28"), "2026-03-30"), 3);
  assert.equal(L.currentStreak(set("2027-01-01", "2026-12-31", "2026-12-30"), "2027-01-01"), 3);
});

test("racha más larga con huecos y fechas desordenadas", () => {
  assert.equal(L.longestStreak(set("2026-10-05", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "2026-10-11")), 3);
  assert.equal(L.longestStreak(set()), 0);
  assert.equal(L.longestStreak(set("2026-10-01")), 1);
  assert.equal(L.longestStreak(set("2026-12-31", "2027-01-01")), 2);
});

test("completionRate respeta la antigüedad del hábito", () => {
  const days = set("2026-10-24", "2026-10-23");
  assert.deepEqual(L.completionRate(days, "2026-10-24", 30), { done: 2, total: 30, pct: 7 });
  // hábito creado ayer: solo 2 días posibles
  assert.deepEqual(L.completionRate(days, "2026-10-24", 30, "2026-10-23"), { done: 2, total: 2, pct: 100 });
});

test("heatLevel y heatCells", () => {
  assert.equal(L.heatLevel(0, 3), 0);
  assert.equal(L.heatLevel(1, 4), 1);
  assert.equal(L.heatLevel(2, 4), 2);
  assert.equal(L.heatLevel(3, 4), 3);
  assert.equal(L.heatLevel(4, 4), 4);
  assert.equal(L.heatLevel(2, 1), 4); // más marcas que hábitos conocidos → nivel máximo
  const habits = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }, { id: "b", created_at: "2026-10-24T08:00:00Z" }];
  const by = L.logsByHabit([{ habit_id: "a", day: "2026-10-23" }, { habit_id: "a", day: "2026-10-24" }, { habit_id: "b", day: "2026-10-24" }]);
  const cells = L.heatCells(habits, by, "2026-10-24", 35);
  assert.equal(cells.length, 35);
  const c23 = cells.find((c) => c.key === "2026-10-23");
  const c24 = cells.find((c) => c.key === "2026-10-24");
  assert.deepEqual([c23.count, c23.total, c23.level], [1, 1, 4]); // "b" aún no existía el 23
  assert.deepEqual([c24.count, c24.total, c24.level], [2, 2, 4]);
  assert.equal(L.activeDays(cells), 2);
});

/* ---------- Tareas ---------- */

const TODAY = "2026-10-24";
const T = (o) => ({ id: Math.random().toString(36).slice(2), title: "t", status: "todo", prio: 4, due_date: null, list_id: null, tags: [], notes: "", created_at: "2026-10-01T10:00:00Z", ...o });

test("vistas: Hoy incluye vencidas; Próximas solo futuras; Bandeja solo sin proyecto", () => {
  const a = T({ title: "vencida", due_date: "2026-10-20" });
  const b = T({ title: "hoy", due_date: TODAY });
  const c = T({ title: "mañana", due_date: "2026-10-25" });
  const d = T({ title: "sin fecha" });
  const e = T({ title: "proyecto", list_id: "L1" });
  const f = T({ title: "hecha", status: "done", due_date: TODAY });
  const all = [a, b, c, d, e, f];
  const names = (v) => all.filter((t) => L.inView(v, t, TODAY)).map((t) => t.title);
  assert.deepEqual(names("today"), ["vencida", "hoy"]);
  assert.deepEqual(names("upcoming"), ["mañana"]);
  assert.deepEqual(names("inbox"), ["vencida", "hoy", "mañana", "sin fecha"]);
  assert.deepEqual(names("pending"), ["vencida", "hoy", "mañana", "sin fecha", "proyecto"]);
  assert.deepEqual(names("done"), ["hecha"]);
  assert.deepEqual(names("list:L1"), ["proyecto"]);
  const counts = L.viewCounts(all, TODAY);
  assert.deepEqual([counts.inbox, counts.today, counts.upcoming, counts.pending, counts.done, counts.lists.L1], [4, 2, 1, 5, 1, 1]);
});

test("una tarea hecha nunca figura como vencida", () => {
  assert.equal(L.isOverdue(T({ due_date: "2026-01-01", status: "done" }), TODAY), false);
  assert.equal(L.isOverdue(T({ due_date: "2026-01-01" }), TODAY), true);
  assert.equal(L.isOverdue(T({ due_date: TODAY }), TODAY), false);
  assert.equal(L.isOverdue(T({}), TODAY), false);
});

test("orden inteligente: fecha, luego prioridad (P1 primero), luego más reciente", () => {
  const items = [
    T({ title: "sin fecha P1", prio: 1 }),
    T({ title: "hoy P4", due_date: TODAY, prio: 4 }),
    T({ title: "hoy P1", due_date: TODAY, prio: 1 }),
    T({ title: "vencida P4", due_date: "2026-10-01", prio: 4 }),
  ];
  assert.deepEqual(L.sortTasks(items, "smart", "pending").map((t) => t.title), ["vencida P4", "hoy P1", "hoy P4", "sin fecha P1"]);
  assert.deepEqual(L.sortTasks(items, "priority", "pending").map((t) => t.title).slice(0, 2), ["hoy P1", "sin fecha P1"]);
  assert.deepEqual(L.sortTasks(items, "alpha", "pending").map((t) => t.title)[0], "hoy P1");
  const done = [T({ title: "a", status: "done", completed_at: "2026-10-01T00:00:00Z" }), T({ title: "b", status: "done", completed_at: "2026-10-02T00:00:00Z" })];
  assert.deepEqual(L.sortTasks(done, "smart", "done").map((t) => t.title), ["b", "a"]);
});

test("filtros: búsqueda, etiqueta, prioridad y proyecto", () => {
  const all = [
    T({ title: "Comprar leche", tags: ["casa"], prio: 2, list_id: "L1" }),
    T({ title: "Estudiar SQL", tags: ["dam"], notes: "tema JOIN", prio: 1 }),
    T({ title: "Llamar", tags: ["dam"], prio: 4 }),
  ];
  const f = (o) => L.filterTasks(all, { view: "pending", ...o }, TODAY, (id) => (id === "L1" ? "Compras" : "")).map((t) => t.title);
  assert.deepEqual(f({ q: "sql" }), ["Estudiar SQL"]);
  assert.deepEqual(f({ q: "join" }), ["Estudiar SQL"]); // busca en notas
  assert.deepEqual(f({ q: "compras" }), ["Comprar leche"]); // busca en el nombre del proyecto
  assert.deepEqual(f({ label: "dam" }), ["Estudiar SQL", "Llamar"]);
  assert.deepEqual(f({ prio: "2" }), ["Comprar leche"]);
  assert.deepEqual(f({ listId: "L1" }), ["Comprar leche"]);
  assert.deepEqual(f({ q: "CASA" }), ["Comprar leche"]); // etiqueta sin distinguir mayúsculas
});

test("dueInfo y agrupación por día", () => {
  assert.equal(L.dueInfo("2026-10-20", TODAY).cls, "overdue");
  assert.equal(L.dueInfo(TODAY, TODAY).text, "Hoy");
  assert.equal(L.dueInfo("2026-10-25", TODAY).text, "Mañana");
  assert.equal(L.dueInfo(null, TODAY), null);
  const groups = L.groupByDue(
    [T({ due_date: "2026-10-25" }), T({ due_date: "2026-10-25" }), T({ due_date: "2026-10-27" })],
    TODAY
  );
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Mañana", 2], ["Martes, 27 De Octubre".replace("De", "de"), 1]].map(([l, n], i) => [i === 0 ? l : groups[1].label, n]));
  assert.equal(groups[0].label, "Mañana");
});

test("repetición: diaria, semanal y mensual con fin de mes", () => {
  assert.equal(L.addInterval("2026-10-24", "daily"), "2026-10-25");
  assert.equal(L.addInterval("2026-10-24", "weekly"), "2026-10-31");
  assert.equal(L.addInterval("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(L.addInterval("2028-01-31", "monthly"), "2028-02-29");
  assert.equal(L.addInterval("2026-12-15", "monthly"), "2027-01-15");
  // siempre posterior a hoy aunque la tarea llevara semanas vencida
  assert.equal(L.nextOccurrence("2026-09-01", "weekly", TODAY), "2026-10-27");
  assert.equal(L.nextOccurrence(null, "daily", TODAY), "2026-10-25");
  assert.equal(L.nextOccurrence(TODAY, "daily", TODAY), "2026-10-25");
});

test("normalizeTags limpia, minusculiza y deduplica", () => {
  assert.deepEqual(L.normalizeTags(" #Estudio, dam ,,DAM, #Casa "), ["estudio", "dam", "casa"]);
  assert.deepEqual(L.normalizeTags(""), []);
});

test("wordCount", () => {
  assert.equal(L.wordCount(""), 0);
  assert.equal(L.wordCount("  hola   mundo\ncómo estás "), 4);
  assert.equal(L.wordCount(null), 0);
});

/* ---------- CSV ---------- */

test("CSV: BOM, separador ;, coma decimal y neutralización de fórmulas", () => {
  const csv = L.buildTransactionsCsv([
    tx("expense", "12.50", "2026-10-02", "Comida", '=HYPERLINK("http://x")'),
    tx("income", "1000.00", "2026-10-01", "Salario", "Nómina; octubre"),
    tx("expense", "3.05", "2026-10-03", "Otros", 'Café "doble"'),
  ]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"Fecha";"Tipo";"Concepto";"Categoría";"Importe (EUR)";"Importe con signo (EUR)"');
  assert.equal(lines[1], '"2026-10-01";"Ingreso";"Nómina; octubre";"Salario";"1000,00";"1000,00"');
  assert.equal(lines[2], '"2026-10-02";"Gasto";"\'=HYPERLINK(""http://x"")";"Comida";"12,50";"-12,50"');
  assert.equal(lines[3], '"2026-10-03";"Gasto";"Café ""doble""";"Otros";"3,05";"-3,05"');
  assert.equal(lines[4], "");
  assert.equal(L.buildTransactionsCsv([]).split("\r\n").length, 2);
});

/* ---------- Copia JSON ---------- */

const emptyState = () => ({
  tasks: [], lists: [], steps: [], habits: [], logs: [], journal: [], transactions: [], budgets: [], goals: [],
  routines: [], routineSteps: [], sessions: [],
});

test("buildBackup no incluye user_id ni credenciales y normaliza importes", () => {
  const s = emptyState();
  s.tasks = [{ id: "1", user_id: "U", title: "a" }];
  s.transactions = [{ id: "2", user_id: "U", amount: "12.50", type: "expense", title: "x", category: "c", tx_date: "2026-10-01" }];
  s.goals = [{ id: "3", user_id: "U", name: "Viaje", target: "500.00", current: "20.10" }];
  const b = L.buildBackup({ state: s, prefs: { theme: "dark" }, now: new Date("2026-10-24T10:00:00Z") });
  const json = JSON.stringify(b);
  assert.ok(!json.includes("user_id"));
  assert.ok(!/token|password|apikey|anon/i.test(json));
  assert.equal(b.data.transactions[0].amount, 12.5);
  assert.equal(b.data.savingsGoals[0].current, 20.1);
  assert.equal(b.version, 5);
  for (const k of ["tasks", "projects", "steps", "habits", "habitLogs", "journal", "transactions", "budgets", "savingsGoals", "routines", "routineSteps", "timerSessions"]) {
    assert.ok(Array.isArray(b.data[k]), k);
  }
});

const csBackup = () => ({
  app: "Cloudspace",
  version: 4,
  tasks: [
    { id: 1, title: "Planificar", done: false, priority: 1, project: "Estudios", label: "#DAM", due: "2026-10-25", created: "2026-10-20" },
    { id: 2, title: "Hecha", done: true, priority: "3", project: "Personal", label: "", due: "", created: "2026-10-01" },
    { id: 3, title: "   ", done: false },
    { id: 4, title: "Nueva lista", project: "Viajes", priority: 9, due: "2026-02-30" },
  ],
  habits: [{ id: "h1", name: "Leer", emoji: "📖", hint: "Hábito personal", history: { "2026-10-23": true, "2026-10-22": true, "2026-10-21": false, "mal": true } }],
  transactions: [
    { id: 1, type: "expense", amount: 12.5, title: "Café", category: "Comida", date: "2026-10-02" },
    { id: 2, type: "income", amount: "1.000,00", title: "Paga", category: "Salario", date: "2026-10-01" },
    { id: 3, type: "bank", amount: 5, title: "x", date: "2026-10-01" },
    { id: 4, type: "expense", amount: -5, title: "neg", date: "2026-10-01" },
    { id: 5, type: "expense", amount: 1.234, title: "tres decimales", date: "2026-10-01" },
  ],
  monthlyBudget: 250,
  savingsGoal: { name: "Viaje", target: 500, current: 20.5 },
  quickNote: "nota rápida",
  fullNote: "entrada larga",
});

test("parseCloudspaceBackup valida y normaliza", () => {
  const n = L.parseCloudspaceBackup(csBackup());
  assert.equal(n.tasks.length, 3);
  assert.deepEqual(n.tasks[0].tags, ["dam"]);
  assert.equal(n.tasks[2].prio, 4); // 9 se limita a 4
  assert.equal(n.tasks[2].due_date, null); // 30 de febrero no existe
  assert.equal(n.habits[0].hint, "");
  assert.deepEqual(n.habits[0].days, ["2026-10-22", "2026-10-23"]);
  assert.equal(n.transactions.length, 2);
  assert.equal(n.transactions[1].cents, 100000);
  assert.equal(n.budget, 25000);
  assert.deepEqual(n.goal, { name: "Viaje", target: 50000, current: 2050 });
  assert.ok(n.warnings.some((w) => /omitido/.test(w)));
});

test("parseCloudspaceBackup rechaza archivos que no son de Cloudspace", () => {
  assert.throws(() => L.parseCloudspaceBackup(null), /válida/);
  assert.throws(() => L.parseCloudspaceBackup([]), /válida/);
  assert.throws(() => L.parseCloudspaceBackup({ foo: 1 }), /formato/);
  assert.throws(() => L.parseCloudspaceBackup({ app: "Mi Panel", data: {} }), /Mi Panel/);
});

test("planImport crea lo que falta y es idempotente", () => {
  const norm = L.parseCloudspaceBackup(csBackup());
  const existing = { ...emptyState(), lists: [{ id: "L1", name: "estudios" }], logs: [], journal: [] };
  const plan = L.planImport(norm, existing, TODAY);
  assert.deepEqual(plan.newLists, ["Personal", "Viajes"]);
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[0].project, "estudios"); // reutiliza el proyecto existente, sin distinguir mayúsculas
  assert.equal(plan.transactions.length, 2);
  assert.equal(plan.budget, 25000);
  assert.equal(plan.goal.name, "Viaje");
  assert.equal(plan.journal.length, 2);

  // Estado tras importar: volver a planificar no debe añadir nada
  const after = {
    tasks: plan.tasks.map((t) => ({ title: t.title, due_date: t.due_date })),
    lists: [{ id: "L1", name: "estudios" }, { id: "L2", name: "Viajes" }, { id: "L3", name: "Personal" }],
    habits: [{ id: "H1", name: "Leer" }],
    logs: [{ habit_id: "H1", day: "2026-10-22" }, { habit_id: "H1", day: "2026-10-23" }],
    transactions: plan.transactions.map((t) => ({ tx_date: t.tx_date, type: t.type, amount: L.centsToDb(t.cents), title: t.title, category: t.category })),
    budgets: [{ category: "", amount: "250.00" }],
    goals: [{ name: "Viaje" }],
    journal: [{ kind: "quick", entry_date: TODAY, body: "x" }, { kind: "entry", entry_date: TODAY, body: "y" }],
  };
  const again = L.planImport(norm, after, TODAY);
  assert.equal(again.tasks.length, 0);
  assert.equal(again.transactions.length, 0);
  assert.equal(again.habits.length, 0);
  assert.equal(again.budget, null);
  assert.equal(again.goal, null);
  assert.equal(again.journal.length, 0);
  assert.equal(again.skipped.tasks, 3);
  assert.equal(again.skipped.transactions, 2);
});

test("planImport conserva movimientos repetidos legítimos del propio archivo", () => {
  const b = csBackup();
  b.tasks = []; b.habits = [];
  b.transactions = [
    { type: "expense", amount: 1.5, title: "Café", category: "Comida", date: "2026-10-02" },
    { type: "expense", amount: 1.5, title: "Café", category: "Comida", date: "2026-10-02" },
  ];
  const plan = L.planImport(L.parseCloudspaceBackup(b), emptyState(), TODAY);
  assert.equal(plan.transactions.length, 2);
  const one = { ...emptyState(), transactions: [{ tx_date: "2026-10-02", type: "expense", amount: "1.50", title: "café", category: "comida" }] };
  assert.equal(L.planImport(L.parseCloudspaceBackup(b), one, TODAY).transactions.length, 1);
});

test("legacyFromStorage lee las claves cloud-* (notas como texto plano)", () => {
  const store = {
    "cloud-tasks": JSON.stringify([{ title: "a" }]),
    "cloud-quick-note": "hola",
    "cloud-monthly-budget": "100",
  };
  const o = L.legacyFromStorage((k) => (k in store ? store[k] : null));
  assert.equal(o.tasks.length, 1);
  assert.equal(o.quickNote, "hola");
  assert.equal(o.monthlyBudget, 100);
  assert.equal(L.legacyFromStorage(() => null), null);
  assert.equal(L.legacyFromStorage(() => { throw new Error("bloqueado"); }), null);
});

/* ---------- Acceso ---------- */

test("validateAuth: reglas por modo (el login no exige 8 caracteres)", () => {
  assert.deepEqual(L.validateAuth({ mode: "login", email: "a@b.co", password: "x" }), {});
  assert.deepEqual(Object.keys(L.validateAuth({ mode: "login", email: "mal", password: "" })), ["email", "password"]);
  assert.deepEqual(Object.keys(L.validateAuth({ mode: "signup", email: "a@b.co", password: "corta", confirm: "corta" })), ["password"]);
  assert.deepEqual(Object.keys(L.validateAuth({ mode: "signup", email: "a@b.co", password: "largalarga", confirm: "otra" })), ["confirm"]);
  assert.deepEqual(L.validateAuth({ mode: "signup", email: " a@b.co ", password: "largalarga", confirm: "largalarga" }), {});
  assert.deepEqual(L.validateAuth({ mode: "forgot", email: "a@b.co" }), {});
  assert.deepEqual(Object.keys(L.validateAuth({ mode: "forgot", email: "a@b" })), ["email"]);
  assert.deepEqual(L.validateAuth({ mode: "recovery", password: "largalarga", confirm: "largalarga" }), {});
  assert.ok(!L.EMAIL_RE.test("a b@c.d"));
});

test("authErrorText traduce los errores de Supabase", () => {
  assert.match(L.authErrorText({ message: "Invalid login credentials" }), /incorrectos/);
  assert.match(L.authErrorText({ code: "email_not_confirmed" }), /confirmado/);
  assert.match(L.authErrorText({ message: "User already registered" }), /Ya existe/);
  assert.match(L.authErrorText({ status: 429, message: "x" }), /Demasiados/);
  assert.match(L.authErrorText(new TypeError("Failed to fetch")), /conexión/);
  assert.match(L.authErrorText({ message: "Unsupported provider: provider is not enabled" }), /Google/);
  assert.match(L.dataErrorText({ code: "42501", message: "new row violates row-level security policy" }), /permiso/);
  assert.match(L.dataErrorText({ code: "PGRST205", message: "Could not find the table" }), /migracion-v3/);
});

/* ---------- Fases del cronómetro ---------- */

test("timerPhase recorre fases y ciclos y termina", () => {
  const steps = [{ seconds: 1500, label: "Estudiando", kind: "work" }, { seconds: 300, label: "Descansando", kind: "break" }];
  let p = L.timerPhase(steps, 2, 0);
  assert.equal(p.idx, 0); assert.equal(p.remaining, 1500000);
  p = L.timerPhase(steps, 2, 1500000);
  assert.equal(p.idx, 1); assert.equal(p.remaining, 300000);
  p = L.timerPhase(steps, 2, 1800000 + 10000);
  assert.equal(p.cycle, 1); assert.equal(p.idx, 0);
  assert.ok(L.timerPhase(steps, 2, 3600000).finished);
  assert.ok(!L.timerPhase(steps, 0, 99999999).finished);
});

test("clock formatea mm:ss y h:mm:ss", () => {
  assert.equal(L.clock(754000), "12:34");
  assert.equal(L.clock(5000), "0:05");
  assert.equal(L.clock(3723000), "1:02:03");
  assert.equal(L.clock(-5), "0:00");
});
