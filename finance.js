"use strict";
// Finanzas manuales: movimientos, presupuestos (total y por categoría), objetivos de ahorro, gráficos y CSV.
// Todos los importes se calculan en céntimos enteros (Logic) y se guardan como numeric(12,2).
// No hay conexión con ningún banco: todo lo escribes tú.

let finMonth = null; // mes que se muestra (YYYY-MM); null = el actual

const currentMonth = () => Logic.monthKey(todayKey());
const shownMonth = () => finMonth || currentMonth();

function expenseCategories() {
  const used = state.transactions.filter((t) => t.type === "expense").map((t) => t.category);
  const budgeted = state.budgets.map((b) => b.category).filter(Boolean);
  return [...new Set([...Logic.EXPENSE_CATEGORIES, ...used, ...budgeted])];
}
function incomeCategories() {
  const used = state.transactions.filter((t) => t.type === "income").map((t) => t.category);
  return [...new Set([...Logic.INCOME_CATEGORIES, ...used])];
}

function fillCategorySelect(sel, list, keep) {
  const prev = keep !== undefined ? keep : sel.value;
  sel.replaceChildren(...list.map((c) => h("option", { value: c, text: c })));
  if (list.includes(prev)) sel.value = prev;
}

/* ---------- Pintado ---------- */

function meterRow({ name, limit, spent, left, pct, over }, onDelete, onEdit) {
  const cls = "meter" + (over ? " over" : pct >= 80 ? " warn" : "");
  return h("div", { class: "meter-row" },
    h("div", { class: "meter-head" }, h("strong", { text: name }),
      h("span", {}, `${Logic.formatEUR(spent)} de ${Logic.formatEUR(limit)}`),
      h("span", { class: "row nowrap" },
        h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar presupuesto ${name}`, text: "✎", onclick: onEdit }),
        h("button", { type: "button", class: "icon-btn", title: "Quitar", "aria-label": `Quitar presupuesto ${name}`, text: "✕", onclick: onDelete }))),
    h("div", { class: cls, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": `${name}: ${pct}% gastado` }, h("span", { style: `width:${pct}%` })),
    h("div", { class: "meter-foot" }, h("span", { text: `${pct}% gastado` }),
      h("span", { text: over ? `Te has pasado ${Logic.formatEUR(-left)}` : `Quedan ${Logic.formatEUR(left)}` })));
}

function renderFinance() {
  const mk = shownMonth();
  const cur = currentMonth();
  if (mk > cur) finMonth = null;
  const totals = Logic.monthTotals(state.transactions, mk);
  const bs = Logic.budgetStatus(state.budgets, totals);

  const ml = Logic.monthLabel(mk);
  $("#finMonthLabel").textContent = ml.charAt(0).toUpperCase() + ml.slice(1);
  $("#finNext").disabled = mk >= cur;
  $("#finThisMonth").classList.toggle("active", mk === cur);
  $("#finMonthPill").textContent = Logic.monthLabel(mk);

  $("#finIncome").textContent = Logic.formatEUR(totals.income);
  $("#finExpense").textContent = Logic.formatEUR(totals.expense);
  const bal = $("#finBalance");
  bal.textContent = Logic.formatEUR(totals.balance);
  bal.classList.toggle("neg", totals.balance < 0);
  bal.classList.toggle("pos", totals.balance > 0);
  $("#finBudgetRing").style.setProperty("--pct", bs.total ? Math.min(100, bs.total.pct) : 0);
  $("#finBudgetRing").classList.toggle("over", !!(bs.total && bs.total.over));
  $("#finBudgetPct").textContent = bs.total ? bs.total.pct + "%" : "—";
  const left = $("#finBudgetLeft");
  left.textContent = bs.total ? Logic.formatEUR(bs.total.left) : "—";
  left.classList.toggle("neg", !!(bs.total && bs.total.over));
  $("#finBudgetFoot").textContent = bs.total
    ? bs.total.over ? "Te has pasado del presupuesto" : `${100 - bs.total.pct}% de ${Logic.formatEUR(bs.total.limit)}`
    : "Define un presupuesto abajo";

  // Presupuestos
  fillCategorySelect($("#budgetCategory"), ["", ...expenseCategories()]);
  $("#budgetCategory").options[0].text = "Total mensual";
  const rows = [];
  if (bs.total) rows.push(meterRow({ name: "Total mensual", ...bs.total }, () => removeBudget(""), () => editBudget("")));
  for (const c of bs.categories) rows.push(meterRow({ name: c.category, ...c }, () => removeBudget(c.category), () => editBudget(c.category)));
  $("#budgetList").replaceChildren(...(rows.length ? rows : [h("p", { class: "empty-state", text: "Sin presupuestos. Elige «Total mensual» o una categoría y pon un límite." })]));

  // Gastos por categoría
  const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map((c) => c[1]));
  $("#categoryChart").replaceChildren(
    ...(cats.length
      ? cats.map(([name, cents]) => h("div", { class: "category-row" },
          h("span", { text: name }),
          h("div", { class: "category-track" }, h("span", { style: `width:${Math.max(2, (cents / max) * 100)}%` })),
          h("strong", { text: Logic.formatEUR(cents) })))
      : [h("p", { class: "empty-state", text: "No hay gastos en este mes. Registra uno para ver el reparto." })])
  );
  $("#categoryCaption").textContent = cats.length ? `${plural(cats.length, "categoría", "categorías")} con gastos` : "";

  // Últimos 6 meses
  const range = Number($("#finRange").value) || 6;
  const series = Logic.monthSeries(state.transactions, mk, range);
  const top = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  $("#trendChart").setAttribute("aria-label", `Ingresos y gastos de los últimos ${range} meses: ` + series.map((s) => `${Logic.monthLabel(s.month)}, ingresos ${Logic.formatEUR(s.income)}, gastos ${Logic.formatEUR(s.expense)}`).join("; "));
  $("#trendChart").style.gridTemplateColumns = `repeat(${series.length}, minmax(0, 1fr))`;
  $("#trendChart").replaceChildren(
    ...series.map((s) => {
      const [y, m] = s.month.split("-").map(Number);
      const short = new Date(y, m - 1, 1, 12).toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
      return h("div", { class: "trend-col" + (s.month === mk ? " current" : "") },
        h("div", { class: "trend-bars" },
          h("span", { title: `Ingresos: ${Logic.formatEUR(s.income)}`, style: `height:${s.income ? Math.max(3, (s.income / top) * 100) : 0}%` }),
          h("span", { class: "exp", title: `Gastos: ${Logic.formatEUR(s.expense)}`, style: `height:${s.expense ? Math.max(3, (s.expense / top) * 100) : 0}%` })),
        h("span", { class: "trend-label", text: short }));
    })
  );

  renderTransactions(mk);
  renderGoals();
  renderInsights(mk, totals, bs);
}

// Conclusiones calculadas solo con movimientos reales; sin datos suficientes no se dice nada.
function renderInsights(mk, totals, bs) {
  const items = [];
  const eur = Logic.formatEUR;
  const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
  if (cats.length && totals.expense > 0) items.push(`Tu mayor gasto es «${cats[0][0]}»: ${eur(cats[0][1])} (${Math.round((cats[0][1] / totals.expense) * 100)}% de los gastos).`);
  const prev = Logic.monthTotals(state.transactions, Logic.addMonths(mk, -1));
  if (prev.expense > 0 && totals.expense > 0) {
    const diff = totals.expense - prev.expense;
    items.push(diff === 0 ? "Has gastado lo mismo que el mes anterior." : `Has gastado ${eur(Math.abs(diff))} ${diff > 0 ? "más" : "menos"} que el mes anterior.`);
  }
  if (totals.income > 0 && totals.expense > 0) {
    const rate = Math.round(((totals.income - totals.expense) / totals.income) * 100);
    items.push(rate >= 0 ? `Has ahorrado el ${rate}% de tus ingresos este mes.` : `Este mes has gastado más de lo que ha entrado (${eur(-(totals.income - totals.expense))} de diferencia).`);
  }
  if (bs.total) items.push(bs.total.over ? `Has superado el presupuesto mensual en ${eur(-bs.total.left)}.` : `Llevas el ${bs.total.pct}% del presupuesto mensual; quedan ${eur(bs.total.left)}.`);
  $("#finInsights").replaceChildren(...(items.length ? items : ["Registra ingresos y gastos de este mes para ver conclusiones."]).map((t) => h("li", { text: t })));

  // Gastos que se repiten: mismo concepto e importe en al menos dos meses distintos
  const groups = new Map();
  for (const t of state.transactions) {
    if (t.type !== "expense") continue;
    const key = t.title.trim().toLowerCase() + "|" + Logic.centsFromDb(t.amount);
    if (!groups.has(key)) groups.set(key, { title: t.title, cents: Logic.centsFromDb(t.amount), months: new Set() });
    groups.get(key).months.add(Logic.monthKey(t.tx_date));
  }
  const rep = [...groups.values()].filter((g) => g.months.size >= 2).sort((a, b) => b.cents - a.cents).slice(0, 5);
  $("#finRepeat").replaceChildren(...(rep.length ? rep.map((g) => h("li", {}, h("span", { text: g.title }), h("b", { text: eur(g.cents) }), h("small", { text: `${g.months.size} meses` }))) : [h("li", { class: "muted", text: "Todavía no hay gastos repetidos en tus movimientos." })]));
}

function renderTransactions(mk) {
  const typeF = $("#txFilterType").value;
  const q = $("#txSearch").value.trim().toLowerCase();
  const period = $("#txPeriod").value;
  const since = period === "90" ? Logic.addDays(todayKey(), -90) : "";
  const inMonth = state.transactions.filter((t) => (period === "month" ? Logic.monthKey(t.tx_date) === mk : period === "90" ? t.tx_date >= since : true));
  const periodText = period === "month" ? `en ${Logic.monthLabel(mk)}` : period === "90" ? "en los últimos 90 días" : "en todo el historial";
  const list = inMonth
    .filter((t) => typeF === "all" || t.type === typeF)
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    .sort((a, b) => (a.tx_date < b.tx_date ? 1 : a.tx_date > b.tx_date ? -1 : (b.created_at || "").localeCompare(a.created_at || "")));
  $("#txSummary").textContent = `${plural(list.length, "movimiento", "movimientos")} ${periodText} · ${state.transactions.length} en total`;
  $("#txList").replaceChildren(
    ...list.map((t) => {
      const cents = Logic.centsFromDb(t.amount);
      const inc = t.type === "income";
      return h("div", { class: "transaction-row" },
        h("div", { class: "transaction-icon " + t.type, "aria-hidden": "true", text: inc ? "↙" : "↗" }),
        h("div", { class: "transaction-copy" }, h("strong", { text: t.title }), h("small", { text: `${t.category} · ${Logic.shortDate(t.tx_date)}` })),
        h("strong", { class: "transaction-amount " + t.type, text: (inc ? "+" : "−") + Logic.formatEUR(cents) }),
        h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${t.title}`, text: "✎", onclick: () => startEditTx(t) }),
        h("button", { type: "button", class: "icon-btn", title: "Borrar", "aria-label": `Borrar ${t.title}`, text: "✕", onclick: () => confirmDeleteTx(t) }));
    })
  );
  const empty = $("#txEmpty");
  empty.textContent = !inMonth.length
    ? `No hay movimientos ${periodText}. Añade el primero con «− Gasto» o «+ Ingreso».`
    : "Ningún movimiento coincide con el filtro.";
  show(empty, list.length === 0);
}

function renderGoals() {
  const box = $("#goalList");
  if (!state.goals.length) {
    box.replaceChildren(h("p", { class: "empty-state", text: "Todavía no tienes objetivos. Crea uno arriba (por ejemplo, un viaje o un ordenador)." }));
    return;
  }
  box.replaceChildren(
    ...state.goals.map((g) => {
      const target = Logic.centsFromDb(g.target);
      const cur = Logic.centsFromDb(g.current);
      const pct = Logic.goalPct(g);
      return h("div", { class: "meter-row" },
        h("div", { class: "meter-head" }, h("strong", { text: g.name }), h("span", { text: `${Logic.formatEUR(cur)} de ${Logic.formatEUR(target)}` })),
        h("div", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": `${g.name}: ${pct}%` }, h("span", { style: `width:${pct}%` })),
        h("div", { class: "meter-foot" },
          h("span", { text: pct >= 100 ? "¡Objetivo conseguido!" : `${pct}% · faltan ${Logic.formatEUR(Math.max(0, target - cur))}` }),
          h("span", { class: "row nowrap" },
            h("button", { type: "button", class: "secondary small", text: "+ Aportar", onclick: () => contribute(g) }),
            h("button", { type: "button", class: "secondary small", text: "Editar", onclick: () => openGoalDialog(g) }))));
    })
  );
}

/* ---------- Movimientos ---------- */

function startEditTx(t) {
  openTxWizard(t.type, t);
}

async function confirmDeleteTx(t) {
  const cents = Logic.centsFromDb(t.amount);
  if (await askConfirm({ title: `¿Borrar «${t.title}»?`, text: `${Logic.formatEUR(cents)} · ${Logic.shortDate(t.tx_date)}. No se puede deshacer.`, confirmLabel: "Borrar", danger: true })) deleteTransaction(t.id);
}

// Asistente de movimiento. Los ingresos no piden concepto: se guardan con el nombre de su categoría.
function openTxWizard(type, existing = null) {
  const editing = !!existing;
  const today = todayKey();
  const catOptions = (ty) => (ty === "income" ? incomeCategories() : expenseCategories()).map((c) => ({ value: c, label: c }));
  const steps = [
    { key: "type", label: "¿Es un gasto o un ingreso?", type: "choice", summaryLabel: "Tipo", options: [{ value: "expense", label: "Gasto" }, { value: "income", label: "Ingreso" }] },
    { key: "amount", label: "¿Cuánto es?", type: "amount", placeholder: "12,50", required: true, requiredMessage: "Escribe el importe.", maxLength: 14, summaryLabel: "Importe (€)",
      validate: (v) => { const r = Logic.parseCents(v); return r.ok ? "" : r.error; }, format: (v) => { const r = Logic.parseCents(v); return r.ok ? Logic.formatEUR(r.cents) : v; } },
    { key: "title", label: "¿Cuál es el concepto?", type: "text", placeholder: "Compra, transporte…", required: true, requiredMessage: "Escribe un concepto.", maxLength: 120, summaryLabel: "Concepto", when: (v) => v.type === "expense" },
    { key: "category", label: "¿En qué categoría?", type: "choice", summaryLabel: "Categoría", options: (v) => catOptions(v.type) },
    { key: "date", label: "¿Qué día fue?", type: "date", required: true, requiredMessage: "Elige una fecha.", summaryLabel: "Fecha",
      quick: [{ label: "Hoy", value: today }, { label: "Ayer", value: Logic.addDays(today, -1) }],
      validate: (v) => (Logic.isDayKey(v) ? "" : "Elige una fecha válida."), format: (v) => (Logic.isDayKey(v) ? Logic.longDate(v) : v) },
  ];
  const initial = existing
    ? { type: existing.type, amount: Logic.centsToPlain(Logic.centsFromDb(existing.amount)), title: existing.type === "expense" ? existing.title : "", category: existing.category, date: existing.tx_date }
    : { type, amount: "", title: "", category: "", date: today };
  openWizard({
    steps, initial, submitLabel: editing ? "Guardar cambios" : "Guardar movimiento", doneMessage: editing ? "Movimiento actualizado." : "Movimiento guardado.",
    onSubmit: async (v) => {
      const amt = Logic.parseCents(v.amount);
      if (!amt.ok) return amt.error;
      const valid = catOptions(v.type).map((o) => o.value);
      const cat = valid.includes(v.category) ? v.category : valid[valid.length - 1];
      const title = v.type === "income" ? (existing && existing.type === "income" ? existing.title : cat) : v.title.trim();
      const row = { type: v.type, cents: amt.cents, title, category: cat, tx_date: v.date };
      const ok = editing ? await updateTransaction(existing.id, row) : await addTransaction(row);
      if (ok && Logic.monthKey(v.date) !== shownMonth()) { finMonth = Logic.monthKey(v.date) === currentMonth() ? null : Logic.monthKey(v.date); renderFinance(); }
      return !!ok;
    },
  });
}
$("#addExpense").addEventListener("click", () => openTxWizard("expense"));
$("#addIncome").addEventListener("click", () => openTxWizard("income"));

["txFilterType", "txSearch", "txPeriod", "finRange"].forEach((id) => $("#" + id).addEventListener("input", renderFinance));
$("#finPrev").addEventListener("click", () => {
  finMonth = Logic.addMonths(shownMonth(), -1);
  renderFinance();
});
$("#finNext").addEventListener("click", () => {
  const next = Logic.addMonths(shownMonth(), 1);
  finMonth = next >= currentMonth() ? null : next;
  renderFinance();
});
$("#finThisMonth").addEventListener("click", () => {
  finMonth = null;
  renderFinance();
});

/* ---------- Presupuestos ---------- */

function editBudget(category) {
  fillCategorySelect($("#budgetCategory"), ["", ...expenseCategories()], category);
  $("#budgetCategory").options[0].text = "Total mensual";
  const b = state.budgets.find((x) => x.category === category);
  $("#budgetAmount").value = b ? Logic.centsToPlain(Logic.centsFromDb(b.amount)) : "";
  $("#budgetAmount").focus();
}

async function removeBudget(category) {
  const name = category || "Total mensual";
  if (await askConfirm({ title: `¿Quitar el presupuesto «${name}»?`, confirmLabel: "Quitar", danger: true })) setBudget(category, 0);
}

$("#budgetCategory").addEventListener("change", (e) => {
  const b = state.budgets.find((x) => x.category === e.target.value);
  $("#budgetAmount").value = b ? Logic.centsToPlain(Logic.centsFromDb(b.amount)) : "";
});

$("#budgetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#budgetError");
  err.textContent = "";
  const amt = Logic.parseCents($("#budgetAmount").value, { allowZero: true });
  if (!amt.ok) return (err.textContent = amt.error), $("#budgetAmount").focus();
  const category = $("#budgetCategory").value;
  const ok = await setBudget(category, amt.cents);
  if (!ok) return (err.textContent = "No se pudo guardar el presupuesto.");
  toast(amt.cents ? "Presupuesto guardado." : "Presupuesto quitado.");
  $("#budgetAmount").value = "";
});

/* ---------- Objetivos de ahorro ---------- */

const amountStep = (key, label, extra = {}) => ({
  key, label, type: "amount", maxLength: 14, placeholder: "0", ...extra,
  validate: (v) => { const r = Logic.parseCents(v, { allowZero: !extra.required || key === "current" }); return r.ok ? "" : r.error; },
  format: (v) => { const r = Logic.parseCents(v || "0", { allowZero: true }); return r.ok ? Logic.formatEUR(r.cents) : v; },
});

// Nueva meta: asistente paso a paso
$("#addGoal").addEventListener("click", () => {
  openWizard({
    steps: [
      { key: "name", label: "¿Cómo se llama la meta?", type: "text", placeholder: "Viaje, ordenador…", required: true, requiredMessage: "Ponle un nombre a la meta.", maxLength: 60, summaryLabel: "Meta" },
      amountStep("target", "¿Cuánto quieres ahorrar?", { required: true, requiredMessage: "Escribe el objetivo.", placeholder: "500", summaryLabel: "Objetivo (€)" }),
      amountStep("current", "¿Cuánto llevas ya?", { hint: "Opcional.", summaryLabel: "Ahorrado (€)" }),
    ],
    initial: { name: "", target: "", current: "" }, earlyAfter: 1, submitLabel: "Crear meta", doneMessage: "Meta creada.",
    onSubmit: (v) => {
      const target = Logic.parseCents(v.target);
      const current = v.current && String(v.current).trim() ? Logic.parseCents(v.current, { allowZero: true }) : { ok: true, cents: 0 };
      if (!target.ok) return "Objetivo: " + target.error;
      if (!current.ok) return "Ahorrado: " + current.error;
      return addGoal({ name: v.name.trim(), target: target.cents, current: current.cents });
    },
  });
});

async function contribute(g) {
  const raw = await askText({
    title: `Añadir a «${g.name}»`, placeholder: "Importe en euros, p. ej. 25", confirmLabel: "Añadir", maxLength: 14,
    validate: (v) => { const r = Logic.parseCents(v); return r.ok ? "" : r.error; },
  });
  if (raw == null) return;
  const amt = Logic.parseCents(raw);
  if (!amt.ok) return toast(amt.error);
  updateGoal(g.id, { name: g.name, target: Logic.centsFromDb(g.target), current: Logic.centsFromDb(g.current) + amt.cents });
}

function openGoalDialog(g) {
  const dlg = $("#sheet-dialog");
  const err = h("p", { class: "form-error", role: "alert" });
  const name = h("input", { value: g.name, maxlength: 60, "aria-label": "Nombre de la meta" });
  const target = h("input", { value: Logic.centsToPlain(Logic.centsFromDb(g.target)), inputmode: "decimal", "aria-label": "Objetivo en euros" });
  const current = h("input", { value: Logic.centsToPlain(Logic.centsFromDb(g.current)), inputmode: "decimal", "aria-label": "Ahorrado en euros" });
  const field = (l, c) => h("label", { class: "field" }, h("span", { class: "muted", text: l }), c);
  dlg.replaceChildren(
    h("form", { class: "sheet", novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const t = Logic.parseCents(target.value);
        const c = Logic.parseCents(current.value, { allowZero: true });
        const n = name.value.trim();
        if (!n) return (err.textContent = "Ponle un nombre a la meta.");
        if (!t.ok) return (err.textContent = "Objetivo: " + t.error);
        if (!c.ok) return (err.textContent = "Ahorrado: " + c.error);
        closeDialog(dlg);
        updateGoal(g.id, { name: n, target: t.cents, current: c.cents });
      } },
      h("h2", { style: "margin-top:0", text: "Editar meta de ahorro" }),
      field("Nombre", name), field("Objetivo (€)", target), field("Ahorrado (€)", current), err,
      h("div", { class: "row", style: "margin-top:14px;justify-content:space-between" },
        h("button", { type: "button", class: "secondary danger", text: "Borrar meta", onclick: async () => {
          if (await askConfirm({ title: `¿Borrar la meta «${g.name}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar meta", danger: true })) { closeDialog(dlg); deleteGoal(g.id); }
        } }),
        h("span", { class: "row" },
          h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => closeDialog(dlg) }),
          h("button", { type: "submit", class: "primary-btn", text: "Guardar" }))))
  );
  openDialog(dlg);
  name.focus();
}

/* ---------- CSV ---------- */

function exportCsv() {
  if (!state.transactions.length) return toast("No hay movimientos que exportar.");
  downloadFile(`cloudspace-movimientos-${todayKey()}.csv`, "text/csv;charset=utf-8", Logic.buildTransactionsCsv(state.transactions));
  toast(`CSV exportado: ${plural(state.transactions.length, "movimiento", "movimientos")}.`);
}
$("#exportCsv").addEventListener("click", exportCsv);

$("#sheet-dialog").addEventListener("click", (e) => {
  if (e.target === $("#sheet-dialog")) closeDialog($("#sheet-dialog"));
});

renderers.push(renderFinance);
