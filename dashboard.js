"use strict";
// Resumen: saludo, métricas, mapa de constancia por hábito, resumen semanal, próximas tareas, actividad, finanzas y nota rápida.
// No guarda datos propios: lee state (la misma fuente que Hábitos, Tareas, Diario y Finanzas).

function displayName() {
  if (!user) return "";
  if (user.guest) return "";
  const m = user.user_metadata || {};
  const n = m.full_name || m.name || m.display_name || (user.email ? user.email.split("@")[0] : "");
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}

function renderDashboard() {
  const today = todayKey();
  const byHabit = habitDays();
  const name = displayName();

  /* Cabecera */
  $("#dbGreeting").textContent = Logic.greeting(new Date().getHours());
  $("#dbName").textContent = name ? ", " + name : "";
  const ld = Logic.longDate(today);
  $("#dbDate").textContent = ld.charAt(0).toUpperCase() + ld.slice(1);
  $("#dbWelcome").textContent = "Bienvenido a tu espacio. Elige un paso pequeño y empieza por ahí.";

  /* Métricas */
  const open = state.tasks.filter((t) => Logic.isOpen(t));
  const overdue = open.filter((t) => Logic.isOverdue(t, today)).length;
  $("#dbTasks").textContent = String(open.length);
  $("#dbTasksFoot").textContent = !open.length ? "Todo despejado" : overdue ? `${plural(overdue, "vencida", "vencidas")}` : "Ninguna vencida";

  const status = state.habits.map((hb) => Logic.habitStatusToday(Logic.habitFrequency(hb), byHabit.get(hb.id) || new Set(), today));
  const due = status.filter((s) => s !== "off").length;
  const done = status.filter((s) => s === "done").length;
  $("#dbHabits").textContent = `${done}/${due}`;
  $("#dbHabitsFoot").textContent = !state.habits.length ? "Crea tu primer hábito" : done >= due ? "¡Todos cumplidos!" : `Faltan ${due - done}`;

  const sum = Logic.weekSummary(state.habits, byHabit, today);
  $("#dbWeekGoal").textContent = sum.total ? `${sum.done}/${sum.total}` : "—";
  $("#dbWeekGoalFoot").textContent = sum.total ? `${sum.pct}% de los hábitos de la semana` : "Sin hábitos esta semana";

  const mk = Logic.monthKey(today);
  const totals = Logic.monthTotals(state.transactions, mk);
  const bs = Logic.budgetStatus(state.budgets, totals);
  const bal = $("#dbBalance");
  bal.textContent = Logic.formatEUR(totals.balance);
  bal.classList.toggle("neg", totals.balance < 0);
  bal.classList.toggle("pos", totals.balance > 0);
  $("#dbBalanceFoot").textContent = state.transactions.some((t) => Logic.monthKey(t.tx_date) === mk) ? `Ingresos − gastos de ${Logic.monthLabel(mk)}` : "Sin movimientos este mes";

  /* Mapa de constancia: una fila por hábito. Solo la casilla de hoy se puede marcar desde aquí. */
  const rows = Logic.habitHeatRows(state.habits, byHabit, today, 35);
  const cells = Logic.heatCells(state.habits, byHabit, today, 35);
  $("#heatmapCaption").textContent = `${Logic.activeDays(cells)} de 35 días activos`;
  show($("#dbHeatEmpty"), rows.length === 0);
  $("#dbHeat").replaceChildren(
    ...rows.map((r) => h("div", { class: "db-heat-row" },
      h("span", { class: "db-heat-name", title: r.habit.name, text: r.habit.name }),
      h("div", { class: "db-heat-cells", style: `--hc:${Logic.habitColor(r.habit)}` },
        ...r.cells.map((c) => {
          const label = `${r.habit.name}, ${Logic.longDate(c.key)}: ${c.state === "done" ? "cumplido" : c.state === "miss" ? "no cumplido" : "sin registro"}`;
          return c.key === today
            ? h("button", { type: "button", class: "dh-cell " + c.state + " today", title: label + " (pulsa para cambiar)", "aria-label": label, "aria-pressed": String(c.state === "done"), onclick: () => setHabitDay(r.habit.id, today, c.state !== "done") })
            : h("i", { class: "dh-cell " + c.state, title: label });
        })))));

  /* Resumen semanal (misma definición que Hábitos) */
  $("#progressRing").style.setProperty("--pct", String(sum.pct));
  $("#progressRing").setAttribute("aria-label", `Cumplimiento semanal: ${sum.pct}%`);
  $("#progressPct").textContent = sum.total ? `${sum.pct}%` : "—";
  $("#progressTitle").textContent = !sum.total ? "Empieza cuando quieras" : sum.pct >= 80 ? "Semana muy sólida" : sum.pct >= 50 ? "Vas por buen camino" : "Un paso a la vez";
  $("#progressText").textContent = sum.total ? `${plural(sum.done, "hecho", "hechos")} · ${plural(sum.pending, "pendiente", "pendientes")}${sum.missed ? ` · ${plural(sum.missed, "sin marcar", "sin marcar")}` : ""}.` : "Crea un hábito para ver tu semana.";

  /* Próximas tareas: vencidas → hoy → próximas */
  const withDue = open.filter((t) => t.due_date).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.prio - b.prio));
  const list = withDue.slice(0, 6);
  const ul = $("#dashTasks");
  ul.replaceChildren(...(list.length
    ? list.map((t) => taskItem(t, { compact: true }))
    : [h("li", { class: "muted" }, open.length ? "Ninguna tarea tiene fecha. Mira «Bandeja de entrada» en Tareas." : "Todo despejado. Crea una tarea cuando quieras.")]));

  /* Actividad semanal: hábitos marcados + tareas completadas, lunes a domingo */
  const wk = Logic.weekKeys(Logic.weekStart(today));
  const data = wk.map((k) => ({
    key: k,
    habits: state.habits.filter((hb) => (byHabit.get(hb.id) || new Set()).has(k)).length,
    tasks: state.tasks.filter((t) => !Logic.isOpen(t) && Logic.dayOfTimestamp(t.completed_at) === k).length,
  }));
  const max = Math.max(1, ...data.map((d) => d.habits + d.tasks));
  const any = data.some((d) => d.habits + d.tasks > 0);
  show($("#weeklyEmpty"), !any);
  show($("#weeklyChart"), any);
  $("#weeklyChart").replaceChildren(
    ...data.map((d, i) => {
      const n = d.habits + d.tasks;
      return h("div", { class: "chart-day" + (d.key === today ? " today" : ""), title: `${Logic.longDate(d.key)}: ${plural(d.habits, "hábito", "hábitos")} y ${plural(d.tasks, "tarea", "tareas")}` },
        h("span", { class: "chart-count", text: String(n) }),
        h("div", { class: "chart-track" }, h("div", { class: "chart-bar", style: `height:${n ? Math.max(6, (n / max) * 100) : 0}%` })),
        h("span", { class: "chart-label", text: WEEKDAY_LETTERS[i] }));
    })
  );

  /* Finanzas del mes */
  $("#dashMonthLabel").textContent = `Resumen de ${Logic.monthLabel(mk)}.`;
  $("#dashIncome").textContent = Logic.formatEUR(totals.income);
  $("#dashExpenses").textContent = Logic.formatEUR(totals.expense);
  $("#dashBudgetLeft").textContent = bs.total ? Logic.formatEUR(bs.total.left) : "—";
  $("#dashBudgetLeft").classList.toggle("neg", !!(bs.total && bs.total.over));
  $("#dashBudgetFoot").textContent = bs.total ? (bs.total.over ? "Te has pasado del presupuesto mensual." : `Has gastado el ${bs.total.pct}% de ${Logic.formatEUR(bs.total.limit)}.`) : "Define un presupuesto en Finanzas.";

  /* Filosofía del día */
  const q = quoteOfDay(today);
  $("#dbQuote").textContent = "“" + q.text + "”";
  $("#dbQuoteBy").textContent = q.by ? "— " + q.by : "";
}

/* ---------- Acciones rápidas (abren los formularios existentes) ---------- */
$("#dbNewTask").addEventListener("click", () => openTaskWizard());
$("#dbNewHabit").addEventListener("click", () => openHabitForm());
$("#dbNewNote").addEventListener("click", () => { location.hash = "#/journal"; setTimeout(() => { if (typeof setJournalTab === "function") setJournalTab("diario"); const t = $("#jFull"); if (t) t.focus(); }, 80); });

$("#dbQuoteHistory").addEventListener("click", () => {
  const dlg = $("#sheet-dialog");
  const today = todayKey();
  const items = Array.from({ length: 14 }, (_, i) => {
    const key = Logic.addDays(today, -i);
    const q = quoteOfDay(key);
    return h("li", {}, h("small", { text: i === 0 ? "Hoy" : Logic.longDate(key) }), h("p", { text: "“" + q.text + "”" + (q.by ? " — " + q.by : "") }));
  });
  dlg.replaceChildren(h("div", { class: "sheet" },
    h("h2", { style: "margin-top:0", text: "Filosofía de los últimos días" }),
    h("ul", { class: "db-quote-list" }, ...items),
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:12px" }, h("button", { type: "button", class: "secondary", text: "Cerrar", onclick: () => closeDialog(dlg) }))));
  openDialog(dlg);
});

renderers.push(renderDashboard);
