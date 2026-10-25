"use strict";
// Finanzas manuales: movimientos, presupuestos (total y por categoría), objetivos de ahorro, gráficos y CSV.
// Todos los importes se calculan en céntimos enteros (Logic) y se guardan como numeric(12,2).
// No hay conexión con ningún banco: todo lo escribes tú.

let finMonth = null; // mes que se muestra (YYYY-MM); null = el actual
let txEditId = null;

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
  const left = $("#finBudgetLeft");
  left.textContent = bs.total ? Logic.formatEUR(bs.total.left) : "—";
  left.classList.toggle("neg", !!(bs.total && bs.total.over));
  $("#finBudgetFoot").textContent = bs.total
    ? bs.total.over ? "Te has pasado del presupuesto" : `${100 - bs.total.pct}% de ${Logic.formatEUR(bs.total.limit)}`
    : "Define un presupuesto abajo";

  // Formulario de movimiento: las categorías dependen del tipo
  const type = $("#txType").value;
  fillCategorySelect($("#txCategory"), type === "income" ? incomeCategories() : expenseCategories());
  if (!$("#txDate").value) $("#txDate").value = todayKey();

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
  const series = Logic.monthSeries(state.transactions, mk, 6);
  const top = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  $("#trendChart").setAttribute("aria-label", "Ingresos y gastos de los últimos seis meses: " + series.map((s) => `${Logic.monthLabel(s.month)}, ingresos ${Logic.formatEUR(s.income)}, gastos ${Logic.formatEUR(s.expense)}`).join("; "));
  $("#trendChart").replaceChildren(
    ...series.map((s) => {
      const [y, m] = s.month.split("-").map(Number);
      const short = new Date(y, m - 1, 1, 12).toLocaleDateString("es-ES", { month: "short" });
      return h("div", { class: "trend-col" + (s.month === mk ? " current" : "") },
        h("div", { class: "trend-bars" },
          h("span", { title: `Ingresos: ${Logic.formatEUR(s.income)}`, style: `height:${s.income ? Math.max(3, (s.income / top) * 100) : 0}%` }),
          h("span", { class: "exp", title: `Gastos: ${Logic.formatEUR(s.expense)}`, style: `height:${s.expense ? Math.max(3, (s.expense / top) * 100) : 0}%` })),
        h("span", { class: "trend-label", text: short }));
    })
  );

  renderTransactions(mk);
  renderGoals();
}

function renderTransactions(mk) {
  const typeF = $("#txFilterType").value;
  const q = $("#txSearch").value.trim().toLowerCase();
  const inMonth = state.transactions.filter((t) => Logic.monthKey(t.tx_date) === mk);
  const list = inMonth
    .filter((t) => typeF === "all" || t.type === typeF)
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    .sort((a, b) => (a.tx_date < b.tx_date ? 1 : a.tx_date > b.tx_date ? -1 : (b.created_at || "").localeCompare(a.created_at || "")));
  $("#txSummary").textContent = `${plural(list.length, "movimiento", "movimientos")} en ${Logic.monthLabel(mk)} · ${state.transactions.length} en total`;
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
    ? `No hay movimientos en ${Logic.monthLabel(mk)}. Añade el primero arriba.`
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

function resetTxForm() {
  txEditId = null;
  $("#txFormTitle").textContent = "Añadir movimiento";
  $("#txSubmit").textContent = "+ Guardar movimiento";
  show($("#txCancel"), false);
  $("#txAmount").value = "";
  $("#txTitle").value = "";
  $("#txError").textContent = "";
}

function startEditTx(t) {
  txEditId = t.id;
  $("#txType").value = t.type;
  fillCategorySelect($("#txCategory"), t.type === "income" ? incomeCategories() : expenseCategories(), t.category);
  $("#txAmount").value = Logic.centsToPlain(Logic.centsFromDb(t.amount));
  $("#txTitle").value = t.title;
  $("#txDate").value = t.tx_date;
  $("#txFormTitle").textContent = "Editar movimiento";
  $("#txSubmit").textContent = "Guardar cambios";
  show($("#txCancel"), true);
  $("#txError").textContent = "";
  $("#txForm").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#txTitle").focus();
}

function confirmDeleteTx(t) {
  const cents = Logic.centsFromDb(t.amount);
  if (confirm(`¿Borrar «${t.title}» (${Logic.formatEUR(cents)})? No se puede deshacer.`)) {
    if (txEditId === t.id) resetTxForm();
    deleteTransaction(t.id);
  }
}

$("#txType").addEventListener("change", renderFinance);
$("#txCancel").addEventListener("click", () => {
  resetTxForm();
  renderFinance();
});

$("#txForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#txError");
  err.textContent = "";
  const amt = Logic.parseCents($("#txAmount").value);
  const title = $("#txTitle").value.trim();
  const date = $("#txDate").value;
  const category = $("#txCategory").value;
  if (!amt.ok) return (err.textContent = amt.error), $("#txAmount").focus();
  if (!title) return (err.textContent = "Escribe un concepto."), $("#txTitle").focus();
  if (title.length > 120) return (err.textContent = "El concepto es demasiado largo (máximo 120 caracteres).");
  if (!Logic.isDayKey(date)) return (err.textContent = "Elige una fecha válida."), $("#txDate").focus();
  const row = { type: $("#txType").value, cents: amt.cents, title, category, tx_date: date };
  const btn = $("#txSubmit");
  btn.disabled = true;
  const ok = txEditId ? await updateTransaction(txEditId, row) : await addTransaction(row);
  btn.disabled = false;
  if (!ok) return (err.textContent = "No se pudo guardar el movimiento.");
  const wasEdit = !!txEditId;
  resetTxForm();
  if (Logic.monthKey(date) !== shownMonth()) {
    finMonth = Logic.monthKey(date) === currentMonth() ? null : Logic.monthKey(date);
    toast(`Guardado en ${Logic.monthLabel(Logic.monthKey(date))}.`);
  } else toast(wasEdit ? "Movimiento actualizado." : "Movimiento guardado.");
  renderFinance();
});

["txFilterType", "txSearch"].forEach((id) => $("#" + id).addEventListener("input", renderFinance));
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

function removeBudget(category) {
  const name = category || "Total mensual";
  if (confirm(`¿Quitar el presupuesto «${name}»?`)) setBudget(category, 0);
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

$("#goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#goalError");
  err.textContent = "";
  const name = $("#goalName").value.trim();
  const target = Logic.parseCents($("#goalTarget").value);
  const current = $("#goalCurrent").value.trim() ? Logic.parseCents($("#goalCurrent").value, { allowZero: true }) : { ok: true, cents: 0 };
  if (!name) return (err.textContent = "Ponle un nombre a la meta."), $("#goalName").focus();
  if (name.length > 60) return (err.textContent = "El nombre es demasiado largo (máximo 60 caracteres).");
  if (!target.ok) return (err.textContent = "Objetivo: " + target.error), $("#goalTarget").focus();
  if (!current.ok) return (err.textContent = "Ahorrado: " + current.error), $("#goalCurrent").focus();
  if (!(await addGoal({ name, target: target.cents, current: current.cents }))) return (err.textContent = "No se pudo crear el objetivo.");
  $("#goalName").value = $("#goalTarget").value = $("#goalCurrent").value = "";
  toast("Objetivo creado.");
});

function contribute(g) {
  const raw = prompt(`¿Cuánto añades a «${g.name}»? (usa un número negativo no: para restar, edita la meta)`, "");
  if (raw === null) return;
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
        h("button", { type: "button", class: "secondary danger", text: "Borrar meta", onclick: () => {
          if (confirm(`¿Borrar la meta «${g.name}»?`)) { closeDialog(dlg); deleteGoal(g.id); }
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
