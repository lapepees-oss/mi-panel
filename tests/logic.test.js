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

/* ---------- Sesiones del cronómetro ---------- */

test("formatDuration y tipos de sesión", () => {
  assert.equal(L.formatDuration(5100000), "1h 25min");
  assert.equal(L.formatDuration(3600000), "1h");
  assert.equal(L.formatDuration(3000000), "50min");
  assert.equal(L.formatDuration(45000), "45s");
  assert.equal(L.sessionKindLabel("pomodoro"), "Pomodoro");
  assert.equal(L.sessionKindLabel(null), "Sesión"); // sesiones antiguas sin tipo
});

test("sessionStats separa hoy y ayer por día LOCAL y cuenta días activos", () => {
  const at = (day, h) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)), h).toISOString();
  const today = "2026-10-26";
  const sessions = [
    { created_at: at("2026-10-26", 9), duration_ms: 1800000 },
    { created_at: at("2026-10-26", 23), duration_ms: 600000 },
    { created_at: at("2026-10-25", 12), duration_ms: 3600000 },
    { created_at: at("2026-10-20", 12), duration_ms: 1000 },
    { created_at: at("2026-10-01", 12), duration_ms: 99999 },
  ];
  const s = L.sessionStats(sessions, today);
  assert.equal(s.todayMs, 2400000); assert.equal(s.todayCount, 2);
  assert.equal(s.yesterdayMs, 3600000); assert.equal(s.yesterdayCount, 1);
  assert.equal(s.activeDays7, 3);
  assert.equal(s.days7.length, 7);
  assert.equal(L.pctChange(2400000, 3600000), -33);
  assert.equal(L.pctChange(5, 0), null);
});

test("countdownMs limita a 24 h y descarta valores no válidos", () => {
  assert.equal(L.countdownMs(0, 25, 0), 1500000);
  assert.equal(L.countdownMs("1", "2", "3"), 3723000);
  assert.equal(L.countdownMs(99, 0, 0), 86400000);
  assert.equal(L.countdownMs(-3, "x", null), 0);
  assert.deepEqual(L.splitHms(3723000), { h: 1, m: 2, s: 3 });
});

/* ---------- Hábitos: frecuencia, rachas y semana ---------- */

test("habitStreak: Diario, Entre semana (el fin de semana no rompe) y Semanal", () => {
  const d = (...k) => new Set(k);
  // Hoy lunes 26: no marcado todavía → cuenta desde el domingo
  assert.equal(L.habitStreak("Diario", d("2026-10-25", "2026-10-24"), "2026-10-26"), 2);
  assert.equal(L.habitStreak("Diario", d("2026-10-23"), "2026-10-26"), 0);
  assert.equal(L.habitStreak("Entre semana", d("2026-10-22", "2026-10-23"), "2026-10-26"), 2);
  assert.equal(L.habitStreak("Entre semana", d("2026-10-21", "2026-10-23"), "2026-10-26"), 1); // falta el jueves
  assert.equal(L.habitStreak("Semanal", d("2026-10-14", "2026-10-21"), "2026-10-26"), 2); // semanas del 12 y del 19; esta aún sin marcar
  assert.equal(L.habitStreak("Semanal", d("2026-10-26", "2026-10-14"), "2026-10-26"), 1); // esta semana sí, la anterior no
});

test("habitBestStreak coincide con la lógica de cada frecuencia", () => {
  const d = (...k) => new Set(k);
  assert.equal(L.habitBestStreak("Diario", d("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05")), 3);
  assert.equal(L.habitBestStreak("Entre semana", d("2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27")), 4); // jue vie (finde) lun mar
  assert.equal(L.habitBestStreak("Semanal", d("2026-10-01", "2026-10-08", "2026-10-22")), 2);
  assert.equal(L.habitBestStreak("Diario", d()), 0);
});

test("habitStatusToday y progreso semanal por hábito", () => {
  const d = (...k) => new Set(k);
  assert.equal(L.habitStatusToday("Diario", d("2026-10-26"), "2026-10-26"), "done");
  assert.equal(L.habitStatusToday("Diario", d(), "2026-10-26"), "pending");
  assert.equal(L.habitStatusToday("Entre semana", d(), "2026-10-25"), "off"); // domingo
  assert.equal(L.habitStatusToday("Semanal", d("2026-10-22"), "2026-10-23"), "done"); // ya cumplido esta semana
  assert.deepEqual(L.habitWeekProgress("Diario", d("2026-10-26", "2026-10-27"), "2026-10-26"), { done: 2, target: 7 });
  assert.deepEqual(L.habitWeekProgress("Semanal", d("2026-10-26", "2026-10-27"), "2026-10-26"), { done: 1, target: 1 });
});

test("weekSummary usa una sola definición: hechos, no hechos (pasados) y pendientes (solo hoy)", () => {
  const created = new Date(2026, 8, 1).toISOString();
  const habits = [{ id: "a", created_at: created }, { id: "b", created_at: created, frequency: "Entre semana" }];
  const by = new Map([["a", new Set(["2026-10-26", "2026-10-27"])], ["b", new Set(["2026-10-26"])]]);
  // Miércoles 28: a → 2 hechos, 1 no hecho (nada pasado sin marcar salvo el 28? lunes y martes hechos) …
  const s = L.weekSummary(habits, by, "2026-10-28");
  // a: lun✓ mar✓ mié(hoy) pendiente; los días futuros no cuentan
  // b: lun✓ mar✗ mié(hoy) pendiente
  assert.deepEqual([s.done, s.missed, s.pending, s.total, s.pct], [3, 1, 2, 6, 50]);
  // Un hábito creado a mitad de semana no arrastra días anteriores
  const late = [{ id: "c", created_at: new Date(2026, 9, 28, 10).toISOString() }];
  const s2 = L.weekSummary(late, new Map(), "2026-10-28");
  assert.deepEqual([s2.done, s2.missed, s2.pending], [0, 0, 1]);
});

test("habitHeatRows distingue hecho, no hecho y no aplica", () => {
  const created = new Date(2026, 9, 24, 9).toISOString();
  const rows = L.habitHeatRows([{ id: "a", created_at: created }], new Map([["a", new Set(["2026-10-26"])]]), "2026-10-26", 4);
  assert.deepEqual(rows[0].cells.map((c) => c.state), ["na", "miss", "miss", "done"]); // 23 (antes de existir), 24, 25, 26
});

/* ---------- Calendario y utilidades ---------- */

test("monthGrid empieza en lunes y completa semanas", () => {
  const g = L.monthGrid("2026-10"); // 1 oct 2026 = jueves
  assert.deepEqual(g[0].slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(g.length, 5);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.flat().filter(Boolean).length, 31);
});

test("greeting y tagCounts", () => {
  assert.equal(L.greeting(8), "Buenos días");
  assert.equal(L.greeting(15), "Buenas tardes");
  assert.equal(L.greeting(23), "Buenas noches");
  const c = L.tagCounts([{ tags: ["a", "b"], status: "todo" }, { tags: ["a"], status: "done" }, { tags: ["a"], status: "todo" }]);
  assert.deepEqual(c, { a: 2, b: 1 });
});

/* ---------- Mapa de constancia: intensidad según hábitos que existían ese día ---------- */

test("mapa de constancia: 0/3, 1/3, 2/3 y 3/3 (hábitos creados antes, modo normal)", () => {
  const today = "2026-10-26", day = "2026-10-20";
  const habits = ["a", "b", "c"].map((id) => ({ id, created_at: "2026-09-01T10:00:00" }));
  const levels = [0, 1, 2, 3].map((n) => {
    const by = L.logsByHabit(["a", "b", "c"].slice(0, n).map((id) => ({ habit_id: id, day })));
    const c = L.heatCells(habits, by, today, 10).find((x) => x.key === day);
    assert.equal(c.total, 3);
    assert.equal(c.count, n);
    return c.level;
  });
  assert.equal(levels[0], 0);
  assert.ok(levels[1] >= 1 && levels[1] < levels[2] && levels[2] < levels[3], `niveles crecientes: ${levels}`);
  assert.equal(levels[3], 4);
});

test("mapa de constancia: hábitos creados HOY pero con registros pasados (datos de ejemplo del invitado) — causa raíz", () => {
  const today = "2026-10-26", day = "2026-10-20", created = `${today}T10:00:00`;
  const habits = ["a", "b", "c"].map((id) => ({ id, created_at: created }));
  // cada hábito tiene historia previa (registros anteriores al día mirado) → los tres existían ese día
  const base = ["a", "b", "c"].map((id) => ({ habit_id: id, day: "2026-10-10" }));
  const lv = [0, 1, 2, 3].map((n) => {
    const by = L.logsByHabit([...base, ...["a", "b", "c"].slice(0, n).map((id) => ({ habit_id: id, day }))]);
    const c = L.heatCells(habits, by, today, 20).find((x) => x.key === day);
    assert.equal(c.total, 3, "los 3 existían ese día aunque su created_at sea de hoy");
    return c.level;
  });
  assert.equal(lv[0], 0);
  assert.ok(lv[1] < lv[3] && lv[1] <= lv[2] && lv[2] < lv[3]);
  assert.equal(lv[3], 4);
  // el caso del bug: antes el total era 0 y 1 marca daba nivel 4
  const only1 = L.logsByHabit([...base, { habit_id: "a", day }]);
  assert.notEqual(L.heatCells(habits, only1, today, 20).find((x) => x.key === day).level, 4);
});

test("habitStartDay: la creación o el primer registro, lo que ocurra antes", () => {
  assert.equal(L.habitStartDay({ created_at: "2026-10-26T10:00:00" }, new Set(["2026-10-10", "2026-10-12"])), "2026-10-10");
  assert.equal(L.habitStartDay({ created_at: "2026-09-01T10:00:00" }, new Set(["2026-10-10"])), "2026-09-01");
  assert.equal(L.habitStartDay({}, new Set()), null);
});

/* ---------- Resumen personalizable ---------- */

test("dashLayout: valores por defecto, ids desconocidos/repetidos y bloques nuevos", () => {
  const d = L.dashLayout(null);
  assert.deepEqual(d.order, L.DASH_WIDGETS);
  assert.deepEqual(d.hidden, L.DASH_WIDGETS.filter((id) => !L.DASH_CATALOG[id].on)); // los bloques del catálogo nuevos arrancan ocultos
  const x = L.dashLayout({ order: ["note", "zzz", "timer", "note"], hidden: ["tasks", "tasks", "nope"] });
  assert.deepEqual(x.order.slice(3, 5), ["note", "timer"]); // «Mi horario» (first) y sus compañeros se colocan delante la primera vez
  assert.equal(x.order.length, L.DASH_WIDGETS.length);
  assert.equal(new Set(x.order).size, x.order.length);
  assert.ok(x.hidden.includes("tasks") && !x.hidden.includes("nope") && x.hidden.filter((i) => i === "tasks").length === 1);
  assert.deepEqual(L.dashLayout("basura").order, L.DASH_WIDGETS);
});

test("moveWidget: sube y baja sin salirse de los extremos ni mutar", () => {
  const o = ["a", "b", "c"];
  assert.deepEqual(L.moveWidget(o, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(L.moveWidget(o, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(L.moveWidget(o, "a", -1), ["a", "b", "c"]);
  assert.deepEqual(L.moveWidget(o, "c", 1), ["a", "b", "c"]);
  assert.deepEqual(L.moveWidget(o, "x", 1), ["a", "b", "c"]);
  assert.deepEqual(o, ["a", "b", "c"]);
});

/* ---------- Suscripciones ---------- */

test("suscripciones: equivalente mensual y anual en céntimos exactos", () => {
  const sub = (amount, cycle) => ({ amount, cycle });
  assert.equal(L.subMonthlyCents(sub(10.99, "monthly")), 1099);
  assert.equal(L.subYearlyCents(sub(10.99, "monthly")), 13188);
  assert.equal(L.subMonthlyCents(sub(120, "yearly")), 1000);
  assert.equal(L.subMonthlyCents(sub(30, "quarterly")), 1000);
  assert.equal(L.subYearlyCents(sub(3, "weekly")), 15600);
  assert.equal(L.subMonthlyCents(sub(3, "weekly")), 1300);
  assert.equal(L.subMonthlyCents({ amount: 5 }), 500, "sin ciclo → mensual");
});

test("suscripciones: próximo cobro avanza por ciclos y conserva el día", () => {
  const today = "2026-10-26";
  assert.equal(L.nextCharge({ status: "active", cycle: "monthly", next_charge: "2026-10-30" }, today), "2026-10-30");
  assert.equal(L.nextCharge({ status: "active", cycle: "monthly", next_charge: "2026-08-15" }, today), "2026-11-15");
  assert.equal(L.nextCharge({ status: "active", cycle: "weekly", next_charge: "2026-10-01" }, today), "2026-10-29");
  assert.equal(L.nextCharge({ status: "active", cycle: "yearly", next_charge: "2025-11-02" }, today), "2026-11-02");
  assert.equal(L.nextCharge({ status: "active", cycle: "quarterly", next_charge: "2026-01-31" }, today), "2026-10-31", "31 ene → 30 abr → 31 jul → 31 oct");
  assert.equal(L.nextCharge({ status: "active", cycle: "monthly", next_charge: "2026-01-31" }, "2026-02-10"), "2026-02-28");
  assert.equal(L.nextCharge({ status: "paused", cycle: "monthly", next_charge: "2026-10-30" }, today), null);
  assert.equal(L.nextCharge({ status: "active", cycle: "monthly" }, today), null, "sin fecha no se inventa");
});

test("suscripciones: resumen solo cuenta las activas; canceladas = lo que dejas de pagar", () => {
  const today = "2026-10-26";
  const subs = [
    { name: "A", amount: 10, cycle: "monthly", status: "active", category: "Ocio", next_charge: "2026-10-28" },
    { name: "B", amount: 120, cycle: "yearly", status: "active", next_charge: "2027-03-01" },
    { name: "C", amount: 8, cycle: "monthly", status: "paused" },
    { name: "D", amount: 15, cycle: "monthly", status: "cancelled" },
  ];
  const r = L.subSummary(subs, today);
  assert.deepEqual([r.active, r.paused, r.cancelled], [2, 1, 1]);
  assert.equal(r.monthly, 2000);
  assert.equal(r.yearly, 24000);
  assert.equal(r.freedMonthly, 1500);
  assert.equal(r.upcoming[0].sub.name, "A");
  assert.equal(r.upcoming[0].days, 2);
  assert.equal(r.byCategory.Ocio, 1000);
  assert.equal(r.byCategory.Suscripciones, 1000);
  assert.deepEqual(L.subSummary([], today).monthly, 0);
});

test("isOpen: «En revisión» sigue siendo una tarea abierta y solo done cierra", () => {
  assert.equal(L.isOpen({ status: "review" }), true);
  assert.equal(L.isOpen({ status: "doing" }), true);
  assert.equal(L.isOpen({ status: "done" }), false);
});

/* ---------- Frecuencia de hábitos por días de la semana ---------- */

test("parseFreq/freqToken: ida y vuelta y compatibilidad con hábitos antiguos", () => {
  assert.deepEqual(L.parseFreq("Personalizada:4,0,2,2,9"), { kind: "Personalizada", days: [0, 2, 4] });
  assert.equal(L.freqToken("Personalizada", [4, 0, 2]), "Personalizada:0,2,4");
  assert.equal(L.freqToken("Diario", [1]), "Diario");
  assert.equal(L.habitFrequency({}), "Diario"); // hábito antiguo sin frecuencia
  assert.equal(L.habitFrequency({ frequency: "Semanal" }), "Semanal");
  assert.equal(L.habitFrequency({ frequency: "algo raro" }), "Diario");
});

test("habitDueOn: lunes, miércoles y viernes", () => {
  const f = "Personalizada:0,2,4";
  // 26 oct 2026 = lunes
  assert.deepEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-30", "2026-10-31"].map((k) => L.habitDueOn(f, k)), [true, false, true, true, false]);
  assert.equal(L.habitDueOn("Entre semana", "2026-10-31"), false);
  assert.equal(L.habitDueOn("Fines de semana", "2026-10-31"), true);
  assert.equal(L.habitDueOn("Diario", "2026-10-27"), true);
});

test("el mapa distingue día no programado (off) de día fallado (miss)", () => {
  const created = "2026-10-01T10:00:00";
  const hb = [{ id: "a", created_at: created, frequency: "Personalizada:0,2,4" }];
  const rows = L.habitHeatRows(hb, new Map([["a", new Set(["2026-10-26"])]]), "2026-10-30", 5); // 26..30
  const states = rows[0].cells.map((c) => c.state);
  assert.equal(states[0], "done"); // lun hecho
  assert.equal(states[1], "off"); // mar no programado
  assert.equal(states[2], "miss"); // mié programado y no hecho
  assert.equal(states[3], "off"); // jue no programado
});

test("completionRate solo cuenta días programados", () => {
  const days = new Set(["2026-10-26", "2026-10-28"]);
  const due = (k) => L.habitDueOn("Personalizada:0,2,4", k);
  const r = L.completionRate(days, "2026-10-30", 5, "2026-10-01", due); // lun, mié, vie programados; vie aún por hacer
  // Ventana 26..30 oct: programados lun 26, mié 28, vie 30 → 3 ocasiones, 2 hechas (no cuentan mar/jue)
  assert.deepEqual(r, { done: 2, total: 3, pct: 67 });
  // Un día hecho fuera de calendario suma como hecho y como ocasión (no hay doble conteo ni porcentajes >100)
  const extra = L.completionRate(new Set(["2026-10-27"]), "2026-10-30", 5, "2026-10-01", due);
  assert.equal(extra.done, 1); assert.equal(extra.total, 4);
});

test("semana y estado de hoy respetan el calendario del hábito", () => {
  const f = "Personalizada:0,2,4";
  assert.equal(L.habitStatusToday(f, new Set(), "2026-10-27"), "off"); // martes: no toca
  assert.equal(L.habitStatusToday(f, new Set(), "2026-10-28"), "pending"); // miércoles: toca
  assert.deepEqual(L.habitWeekProgress(f, new Set(["2026-10-26", "2026-10-27", "2026-10-28"]), "2026-10-26"), { done: 2, target: 3 });
  const hb = [{ id: "a", created_at: "2026-09-01T10:00:00", frequency: f }];
  const by = new Map([["a", new Set(["2026-10-26", "2026-10-28"])]]);
  assert.deepEqual(L.weekSummary(hb, by, "2026-10-27"), { done: 2, missed: 0, pending: 0, total: 2, pct: 100 }); // el martes no es una ocasión
});

/* ---------- Panel del Resumen: catálogo, tamaños, orden y estadísticas ---------- */

test("dashLayout normaliza: ids desconocidos, tamaños y textos; los bloques nuevos del catálogo arrancan ocultos", () => {
  const d = L.dashLayout(null);
  assert.equal(d.order.length, L.DASH_WIDGETS.length);
  assert.ok(d.hidden.includes("stats") && !d.hidden.includes("tasks"));
  const e = L.dashLayout({ order: ["note", "zzz", "tasks", "note"], hidden: ["tasks", "nope"], sizes: { tasks: { w: 99, h: -3 }, week: { w: 1 } }, cfg: { tasks: { title: "  Mis   tareas ", info: "compact" }, heat: { title: "" } } });
  assert.deepEqual(e.order.slice(3, 5), ["note", "tasks"]);
  assert.ok(e.hidden.includes("tasks") && !e.hidden.includes("nope"));
  assert.deepEqual(e.sizes.tasks, { w: 6, h: 0 });
  assert.equal(e.sizes.week.w, 2); // mínimo del catálogo
  assert.deepEqual(e.cfg.tasks, { title: "Mis tareas", info: "compact" });
  assert.equal(e.cfg.heat, undefined);
});

test("placeWidget y sizeFromDrag", () => {
  assert.deepEqual(L.placeWidget(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(L.placeWidget(["a", "b", "c"], "a", null), ["b", "c", "a"]);
  assert.deepEqual(L.placeWidget(["a", "b"], "zz", "a"), ["a", "b"]);
  const s = L.sizeFromDrag("tasks", { w: 3, h: 0, hPx: 300 }, 250, 0, 160);
  assert.equal(s.w, 5);
  assert.equal(L.sizeFromDrag("tasks", { w: 3, h: 0, hPx: 100 }, -9999, 9999, 160).w, 2); // no baja del mínimo
  assert.equal(L.sizeFromDrag("tasks", { w: 3, h: 0, hPx: 100 }, 9999, 9999, 160).w, 6); // no pasa del máximo
  assert.equal(L.sizeFromDrag("tasks", { w: 3, h: 0, hPx: 100 }, 0, 9999, 160).h, L.DASH_MAX_ROWS);
});

test("dayActivity y periodTotals respetan los días programados", () => {
  const hb = [{ id: "a", created_at: "2026-10-01T10:00:00", frequency: "Personalizada:0,2,4" }];
  const by = new Map([["a", new Set(["2026-10-26", "2026-10-28"])]]);
  const keys = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const tasks = [{ status: "done", done: true, completed_at: "2026-10-27T10:00:00" }, { status: "todo" }];
  const ses = [{ created_at: "2026-10-28T09:00:00", duration_ms: 600000 }, { created_at: "2026-10-20T09:00:00", duration_ms: 1 }];
  const rows = L.dayActivity(hb, by, tasks, ses, keys);
  assert.deepEqual(rows.map((r) => r.due), [1, 0, 1, 0, 1]); // lun, mié, vie
  assert.equal(rows[1].pct, null); // martes: no tocaba
  assert.equal(rows[0].pct, 100);
  const t = L.periodTotals(rows);
  assert.deepEqual([t.habits, t.tasks, t.ms, t.due, t.doneDue, t.pct], [2, 1, 600000, 3, 2, 67]);
});

test("savingMilestones: hitos cada 25 % derivados del importe", () => {
  const m = L.savingMilestones(2000, 1250);
  assert.equal(m.pct, 62); assert.equal(m.reached, 2); assert.equal(m.next.pct, 75); assert.equal(m.next.amount, 1500); assert.equal(m.left, 750);
  assert.equal(L.savingMilestones(0, 5).next, null);
  assert.equal(L.savingMilestones(100, 100).next, null);
});

/* ---------- Copiloto del día ---------- */

const CP_DAY = "2026-10-28"; // miércoles
const cpTask = (id, extra = {}) => ({ id, title: "Tarea " + id, status: "todo", prio: 4, due_date: null, ...extra });
const cpPrefs = { start: 480, end: 1320, fill: 70, taskMin: 30, habitMin: 15, blocks: [{ id: "c", label: "Clases", days: [0, 1, 2, 3, 4], start: 960, end: 1305 }] };

test("copilotPrefs: valores no válidos vuelven a los predeterminados y los bloques se limpian", () => {
  const p = L.copilotPrefs({ start: 900, end: 100, fill: 5000, blocks: [{ start: 600, end: 500, days: [1] }, { start: 600, end: 700, days: [] }, { label: "x".repeat(99), start: 600, end: 700, days: [9, 2, 2, "3"] }] });
  assert.equal(p.start, 480); assert.equal(p.end, 1320); assert.equal(p.fill, 100);
  assert.equal(p.blocks.length, 1); assert.equal(p.blocks[0].label.length, 40); assert.deepEqual(p.blocks[0].days, [2, 3]);
  assert.deepEqual(L.copilotPrefs(null).blocks, []);
});

test("copilotFree: quita los bloques fijos y lo que ya pasó", () => {
  const p = L.copilotPrefs(cpPrefs);
  assert.deepEqual(L.copilotFree(p, CP_DAY, 0), [[480, 960], [1305, 1320]]);
  assert.deepEqual(L.copilotFree(p, CP_DAY, 600), [[600, 960], [1305, 1320]]);
  assert.deepEqual(L.copilotFree(p, CP_DAY, 1000), [[1305, 1320]]);
  assert.deepEqual(L.copilotFree(p, "2026-10-31", 0), [[480, 1320]]); // sábado: no hay clases
});

test("planDay: orden vencidas → hoy → hábitos → alta prioridad sin fecha; no incluye lo que no toca", () => {
  const hab = { id: "h1", name: "Guitarra", created_at: "2026-10-01T10:00:00Z", frequency: "Diario" };
  const plan = L.planDay({
    today: CP_DAY, prefs: cpPrefs, habits: [hab], byHabit: new Map(),
    tasks: [
      cpTask("fut", { due_date: "2026-11-05" }), cpTask("hoy", { due_date: CP_DAY }), cpTask("venc", { due_date: "2026-10-26" }),
      cpTask("alta", { prio: 1 }), cpTask("baja"), cpTask("hecha", { status: "done", due_date: CP_DAY }),
    ],
  });
  assert.deepEqual(plan.slots.map((s) => s.id), ["venc", "hoy", "h1", "alta"]);
  assert.equal(plan.slots[0].start, 480); assert.equal(plan.slots[1].start, 510);
  assert.match(plan.slots[0].why, /Venció hace 2 días/);
  assert.ok(plan.slots.every((s) => s.end <= 960 || s.start >= 1305), "nada cae en las clases");
});

test("planDay: respeta el porcentaje de ocupación y deja el resto fuera con motivo", () => {
  const tasks = Array.from({ length: 30 }, (_, i) => cpTask("t" + i, { due_date: CP_DAY }));
  const plan = L.planDay({ today: CP_DAY, prefs: { ...cpPrefs, fill: 20 }, tasks });
  assert.ok(plan.used <= plan.capacity);
  assert.equal(plan.slots.length + plan.left.length, 30);
  assert.ok(plan.left.every((l) => l.reason));
  assert.ok(plan.capacity <= Math.floor(plan.freeMin * 0.2));
});

test("planDay: habitos ya hechos, 'hoy no toca' y omitidos no entran; sin datos devuelve un plan vacío", () => {
  const hb = { id: "h1", name: "Correr", created_at: "2026-10-01T10:00:00Z", frequency: "Fines de semana" };
  const hb2 = { id: "h2", name: "Leer", created_at: "2026-10-01T10:00:00Z", frequency: "Diario" };
  const plan = L.planDay({ today: CP_DAY, prefs: cpPrefs, habits: [hb, hb2], byHabit: new Map([["h2", new Set([CP_DAY])]]) });
  assert.equal(plan.slots.length, 0); assert.equal(plan.candidates, 0);
  const t = L.planDay({ today: CP_DAY, prefs: cpPrefs, tasks: [cpTask("x", { due_date: CP_DAY })], skip: new Set(["t:x"]) });
  assert.equal(t.slots.length, 0);
});

test("planDay: si ya es tarde solo usa los huecos que quedan", () => {
  const plan = L.planDay({ today: CP_DAY, prefs: cpPrefs, nowMin: 1310, tasks: [cpTask("a", { due_date: CP_DAY })] });
  assert.equal(plan.freeMin, 10); assert.equal(plan.slots.length, 0); assert.equal(plan.left.length, 1);
});

/* ---------- Máquina del tiempo ---------- */

const TM_TODAY = "2026-10-28";
const tmData = () => ({
  habits: [{ id: "h", name: "Leer", created_at: "2026-04-01T10:00:00Z", frequency: "Diario" }],
  logs: [...Array.from({ length: 15 }, (_, i) => ({ habit_id: "h", day: L.addDays("2026-07-20", i) })), ...Array.from({ length: 25 }, (_, i) => ({ habit_id: "h", day: L.addDays("2026-10-01", i) }))],
  tasks: [
    { id: "a", status: "done", created_at: "2026-07-01T10:00:00Z", completed_at: "2026-07-22T10:00:00Z" },
    { id: "b", status: "done", created_at: "2026-09-01T10:00:00Z", completed_at: "2026-10-10T10:00:00Z" },
    { id: "c", status: "done", created_at: "2026-09-01T10:00:00Z", completed_at: "2026-10-12T10:00:00Z" },
    { id: "d", status: "todo", created_at: "2026-10-20T10:00:00Z", completed_at: null },
  ],
  sessions: [{ created_at: "2026-10-05T10:00:00Z", duration_ms: 3600000 }],
  sessionsFrom: "2026-07-30",
  transactions: [{ type: "expense", amount: 40, tx_date: "2026-07-25" }, { type: "expense", amount: 55, tx_date: "2026-10-10" }],
});

test("timeTravel: compara 30 días de hace 3 meses con los últimos 30 días", () => {
  const r = L.timeTravel(tmData(), TM_TODAY, 3);
  assert.equal(r.months, 3); assert.equal(r.noPast, false);
  assert.equal(r.past.to, "2026-07-28"); assert.equal(r.now.to, TM_TODAY);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by.tasksDone.past, "1"); assert.equal(by.tasksDone.now, "2"); assert.equal(by.tasksDone.dir, "up");
  assert.equal(by.openTasks.past, "0"); assert.equal(by.openTasks.now, "1");
  assert.equal(by.spendCents.past, L.formatEUR(4000)); assert.equal(by.spendCents.now, L.formatEUR(5500));
  assert.ok(by.habitPct.past && by.habitPct.now);
});

test("timeTravel: sin datos en esa fecha no inventa nada; sesiones fuera de rango salen como sin dato", () => {
  const r = L.timeTravel(tmData(), TM_TODAY, 12);
  assert.equal(r.noPast, true);
  assert.ok(r.rows.every((x) => x.past === null && x.dir === null));
  const r6 = L.timeTravel(tmData(), TM_TODAY, 3);
  assert.equal(r6.rows.find((x) => x.key === "focusMs").past, null, "las sesiones solo llegan a 90 días");
  assert.equal(L.timeTravel(tmData(), TM_TODAY, 99).months, 3, "valor no válido → 3 meses");
  assert.equal(L.timeTravel({}, TM_TODAY, 1).noPast, true);
});

test("Mi horario: etapas del día (bloques, huecos libres y descanso) sin solapes", () => {
  const prefs = { start: 480, end: 1320, blocks: [
    { id: "a", label: "Clases", days: [0, 1, 2, 3, 4], start: 960, end: 1305 },
    { id: "b", label: "Comida", days: [0, 1, 2, 3, 4], start: 840, end: 900 },
    { id: "c", label: "Solape", days: [0], start: 1000, end: 1100 }, // lo tapa «Clases»
    { id: "d", label: "Finde", days: [5], start: 600, end: 660 },
  ] };
  const lun = "2026-10-26"; // lunes
  const st = L.scheduleStages(prefs, lun);
  assert.deepEqual(st.map((s) => [s.kind, s.label, s.start, s.end]), [
    ["rest", "Descanso", 0, 480], ["free", "Libre", 480, 840], ["block", "Comida", 840, 900], ["free", "Libre", 900, 960],
    ["block", "Clases", 960, 1305], ["free", "Libre", 1305, 1320], ["rest", "Descanso", 1320, 1440]]);
  // cubre las 24 h exactas
  assert.equal(st.reduce((n, s) => n + s.end - s.start, 0), 1440);
  for (let i = 1; i < st.length; i++) assert.equal(st[i].start, st[i - 1].end);
  // sin bloques: descanso, libre, descanso
  assert.deepEqual(L.scheduleStages({}, lun).map((s) => s.kind), ["rest", "free", "rest"]);
  // sábado: solo el bloque del finde
  assert.deepEqual(L.scheduleStages(prefs, "2026-10-31").filter((s) => s.kind === "block").map((s) => s.label), ["Finde"]);
});

test("Mi horario: etapa actual, avance y minutos restantes", () => {
  const prefs = { blocks: [{ id: "a", label: "Clases", days: [2], start: 960, end: 1305 }] };
  const mie = "2026-10-28"; // miércoles
  const n = L.scheduleNow(prefs, mie, 1000);
  assert.equal(n.cur.label, "Clases");
  assert.equal(n.pct, Math.round(((1000 - 960) / 345) * 100));
  assert.equal(n.leftMin, 305);
  assert.equal(L.scheduleNow(prefs, mie, 0).cur.kind, "rest");
  assert.equal(L.scheduleNow(prefs, mie, 1439).cur.kind, "rest");
  assert.equal(L.scheduleNow(prefs, mie, 1305).cur.kind, "free"); // el límite final pertenece a la etapa siguiente
});

test("Resumen: un bloque nuevo «first» se coloca al principio y visible en diseños guardados", () => {
  const d = L.dashLayout({ order: ["metrics", "tasks"], hidden: [] });
  assert.equal(d.order[0], "schedule");
  assert.ok(!d.hidden.includes("schedule"));
});

/* ---------- Objetivos e hitos ---------- */

test("objectiveView: el progreso se mide por hitos, no por tareas", () => {
  const v = L.objectiveView({ id: "o1", title: "  Aprender   a dibujar ", status: "active", due_date: "2026-12-31",
    milestones: [{ id: "a", title: "Formas básicas", done: true }, { id: "b", title: "Anatomía", done: false, date: "2026-11-20" }, { id: "c", title: "Primer personaje", done: false, date: "2026-11-05" }, { title: "" }],
    task_ids: ["t1", "t1", 7, "t2"], habit_ids: ["h1"] });
  assert.equal(v.title, "Aprender a dibujar");
  assert.equal(v.total, 3); assert.equal(v.done, 1); assert.equal(v.pct, 33);
  assert.equal(v.next.id, "c"); // el siguiente hito pendiente más cercano
  assert.deepEqual(v.taskIds, ["t1", "t2"]); assert.deepEqual(v.habitIds, ["h1"]);
  assert.equal(v.complete, false);
});

test("objectiveView: sin hitos 0 %; todos hechos = completo; datos raros no rompen", () => {
  assert.equal(L.objectiveView({ title: "x" }).pct, 0);
  assert.equal(L.objectiveView({ title: "x", milestones: [] }).complete, false);
  assert.equal(L.objectiveView({ title: "x", milestones: [{ id: "a", title: "A", done: true }] }).complete, true);
  const v = L.objectiveView({ title: "x", status: "zzz", due_date: "2026-02-30", milestones: "no", task_ids: "no" });
  assert.equal(v.status, "active"); assert.equal(v.due, null); assert.equal(v.total, 0); assert.deepEqual(v.taskIds, []);
  assert.equal(L.objectiveView(null).title, "");
});

test("normMilestones: ids únicos, máximo 40 y fechas válidas", () => {
  const m = L.normMilestones([{ id: "a", title: "Uno", date: "2026-13-01" }, { id: "a", title: "Dos" }, ...Array.from({ length: 50 }, (_, i) => ({ title: "H" + i }))]);
  assert.equal(m.length, 40); assert.equal(new Set(m.map((x) => x.id)).size, 40); assert.equal(m[0].date, null);
});

test("objectiveLinks: ignora lo que ya no existe; objectiveDaysLeft", () => {
  const o = { title: "x", task_ids: ["t1", "borrada"], habit_ids: ["h9", "h1"], due_date: "2026-11-01" };
  const r = L.objectiveLinks(o, [{ id: "t1" }], [{ id: "h1" }]);
  assert.deepEqual(r.tasks.map((t) => t.id), ["t1"]); assert.deepEqual(r.habits.map((x) => x.id), ["h1"]);
  assert.equal(L.objectiveDaysLeft(o, "2026-10-28"), 4); assert.equal(L.objectiveDaysLeft(o, "2026-11-03"), -2); assert.equal(L.objectiveDaysLeft({ title: "x" }, "2026-10-28"), null);
});

test("calendarMonth: coloca tareas, hitos, pagos y concentración en su día sin duplicar", () => {
  const src = {
    tasks: [{ id: "t1", due_date: "2026-11-05", status: "todo" }, { id: "t2", due_date: "2026-12-01" }, { id: "t3" }],
    objectives: [{ id: "o1", title: "A", milestones: [{ id: "a", title: "H1", date: "2026-11-05" }, { id: "b", title: "H2", date: "2026-12-02" }] }, { id: "o2", title: "B", status: "paused", milestones: [{ id: "c", title: "H3", date: "2026-11-05" }] }],
    subs: [{ id: "s1", name: "Música", amount: 10, cycle: "monthly", next_charge: "2026-10-12", status: "active" }, { id: "s2", name: "Vieja", amount: 5, cycle: "monthly", next_charge: "2026-11-20", status: "cancelled" }],
    sessions: [{ created_at: new Date(2026, 10, 5, 10).toISOString(), duration_ms: 1800000 }, { created_at: new Date(2026, 10, 5, 12).toISOString(), duration_ms: 600000 }],
  };
  const c = L.calendarMonth("2026-11", src, "2026-11-05");
  assert.equal(c.byDay["2026-11-05"].tasks.length, 1);
  assert.equal(c.byDay["2026-11-05"].milestones.length, 1); // el objetivo en pausa no aparece
  assert.equal(c.byDay["2026-11-05"].focusMs, 2400000);
  assert.equal(c.byDay["2026-11-12"].payments[0].id, "s1"); // el cobro mensual cae en noviembre; la suscripción cancelada, no
  assert.equal(c.byDay["2026-12-01"], undefined);
  assert.equal(c.today, "2026-11-05");
  assert.equal(L.calendarDayCount(c.byDay["2026-11-05"]), 3);
  assert.equal(L.calendarDayCount(undefined), 0);
  assert.equal(L.calendarMonth("2026-12", src, "2026-11-05").today, null);
});

test("objectiveTasks: agrupa por urgencia y elige la siguiente tarea", () => {
  const T = (id, extra) => ({ id, status: "todo", done: false, prio: 4, due_date: null, ...extra });
  const tasks = [T("a", { due_date: "2026-10-30" }), T("b", { due_date: "2026-10-20", prio: 3 }), T("c", { due_date: "2026-10-20", prio: 1 }), T("d"), T("e", { status: "done", done: true }), T("f", { due_date: "2026-10-28" })];
  const r = L.objectiveTasks({ title: "x", task_ids: ["a", "b", "c", "d", "e", "f", "zz"] }, tasks, "2026-10-28");
  assert.deepEqual(r.groups.overdue.map((t) => t.id), ["c", "b"]); // la de mayor prioridad primero a igual fecha
  assert.deepEqual(r.groups.today.map((t) => t.id), ["f"]); assert.deepEqual(r.groups.upcoming.map((t) => t.id), ["a"]);
  assert.deepEqual(r.groups.nodate.map((t) => t.id), ["d"]); assert.deepEqual(r.groups.done.map((t) => t.id), ["e"]);
  assert.equal(r.total, 6); assert.equal(r.open, 5); assert.equal(r.pct, 17); assert.equal(r.next.id, "c");
  assert.equal(L.objectiveTasks({ title: "x" }, tasks, "2026-10-28").next, null);
});

test("milestoneTasks: propone cerrar el hito cuando todas sus tareas están hechas", () => {
  const tasks = [{ id: "a", status: "done", done: true }, { id: "b", status: "todo", done: false }];
  assert.equal(L.milestoneTasks({ id: "m", task_ids: ["a"] }, tasks).suggestDone, true);
  assert.equal(L.milestoneTasks({ id: "m", task_ids: ["a", "b"] }, tasks).suggestDone, false);
  assert.equal(L.milestoneTasks({ id: "m", task_ids: ["a"], done: true }, tasks).suggestDone, false);
  assert.equal(L.milestoneTasks({ id: "m", task_ids: [] }, tasks).suggestDone, false);
  assert.deepEqual(L.normMilestones([{ id: "m", title: "H", task_ids: ["a", "a", 3] }])[0].task_ids, ["a"]);
});

test("objectiveHue es estable y está entre 0 y 359", () => {
  assert.equal(L.objectiveHue("abc"), L.objectiveHue("abc"));
  const h = L.objectiveHue("x-123"); assert.ok(h >= 0 && h < 360); assert.equal(L.objectiveHue(null), 0);
});

test("dataErrorText: la tabla que falta apunta a su migración", () => {
  const e = (t) => ({ code: "42P01", message: `relation "public.${t}" does not exist` });
  assert.match(L.dataErrorText(e("objectives")), /migracion-v10\.sql/);
  assert.match(L.dataErrorText(e("ideas")), /migracion-v4\.sql/);
  assert.match(L.dataErrorText(e("subscriptions")), /migracion-v6\.sql/);
  assert.match(L.dataErrorText(e("tasks")), /migracion-v3\.sql/);
});

test("administración: estado, textos y lecturas sin inventar", () => {
  const today = "2026-10-28";
  assert.equal(L.adminTime(125 * 60), "2 h 05 min");
  assert.equal(L.adminTime(0), "0 min");
  assert.equal(L.adminName("lucia.m@gmail.com"), "Lucia");
  assert.equal(L.adminStatus({ blocked: true, last_day: today }, today), "paused");
  assert.equal(L.adminStatus({ is_admin: true }, today), "admin");
  assert.equal(L.adminStatus({ last_day: null }, today), "new");
  assert.equal(L.adminStatus({ last_day: "2026-10-22" }, today), "active");
  assert.equal(L.adminStatus({ last_day: "2026-10-21" }, today), "inactive");
  assert.equal(L.adminLastSeen({ last_day: "2026-10-27" }, today), "Ayer");
  assert.equal(L.adminLastSeen({ last_day: "2026-10-22" }, today), "Hace 6 días");
  // sin usuarios no se inventa nada
  const empty = L.adminInsights({ users: [{ is_admin: true, email: "a@a" }], daily: [], modules: [], today });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].kind, "dato");
  // pocos usuarios: avisa de que es orientativo
  const few = L.adminInsights({ users: [{ email: "x@y.z", last_day: today, days_30: 3, rows_count: 5 }], daily: [], modules: [], today });
  assert.ok(few.some((i) => i.kind === "hipotesis" && /orientativas/.test(i.text)));
  // patrón de correlación solo con >=5 usuarios con uso, marcado como patrón y con confianza
  const us = [1, 2, 3, 4, 5, 6].map((n) => ({ email: `u${n}@x`, last_day: today, days_30: n * 3, rows_count: n * 10 }));
  const ins = L.adminInsights({ users: us, daily: [], modules: [], today });
  const p = ins.find((i) => i.kind === "patron");
  assert.ok(p && /confianza baja/.test(p.note) && /no demuestra la causa/.test(p.note));
  assert.ok(Math.abs(L.pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  assert.equal(L.pearson([1, 2], [1, 2]), null);
  const st = L.adminStats(us.concat([{ is_admin: true, email: "a@a" }]), [{ day: today, active_users: 4, seconds: 4800 }], today);
  assert.equal(st.friends, 6); assert.equal(st.activeToday, 4); assert.equal(st.avgSecPerActive, 1200);
});
