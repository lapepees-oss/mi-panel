"use strict";
// Resumen: mapa de constancia, estadísticas, hábitos y tareas de hoy, gráficos y finanzas del mes.
// No guarda nada propio: lee state (la misma fuente que usan Hábitos, Tareas, Diario y Finanzas).

function renderDashboard() {
  const today = todayKey();
  const byHabit = habitDays();

  /* Mapa de constancia (ancho completo arriba y mini en la barra lateral) */
  const cells = Logic.heatCells(state.habits, byHabit, today, 35);
  paintHeat($("#activityHeatmap"), cells);
  const active = Logic.activeDays(cells);
  $("#heatmapCaption").textContent = `${active} de 35 días activos`;

  /* Estadísticas */
  const dueNow = state.tasks.filter((t) => Logic.inView("today", t, today));
  const overdue = dueNow.filter((t) => Logic.isOverdue(t, today)).length;
  $("#statToday").textContent = String(dueNow.length);
  $("#statTodayFoot").textContent = !dueNow.length ? "Nada para hoy" : overdue ? `${plural(overdue, "vencida", "vencidas")}` : "Todo al día";

  const doneHabits = state.habits.filter((hb) => (byHabit.get(hb.id) || new Set()).has(today)).length;
  $("#statHabits").textContent = `${doneHabits}/${state.habits.length}`;
  $("#statHabitsFoot").textContent = !state.habits.length ? "Crea tu primer hábito" : doneHabits === state.habits.length ? "¡Todos cumplidos!" : `Faltan ${state.habits.length - doneHabits}`;

  let bestStreak = 0, bestName = "";
  for (const hb of state.habits) {
    const s = Logic.currentStreak(byHabit.get(hb.id) || new Set(), today);
    if (s > bestStreak) { bestStreak = s; bestName = hb.name; }
  }
  $("#statStreak").textContent = streakText(bestStreak);
  $("#statStreakFoot").textContent = bestName || "Marca un hábito para empezar";

  $("#statWords").textContent = new Intl.NumberFormat("es-ES").format(state.journal.reduce((n, j) => n + Logic.wordCount(j.body), 0));

  /* Hábitos de hoy */
  const hbBox = $("#dashHabits");
  if (!state.habits.length) {
    hbBox.replaceChildren(h("p", { class: "empty-state" }, "Aún no tienes hábitos. ", h("a", { href: "#/habits", text: "Crea el primero" }), "."));
  } else {
    hbBox.replaceChildren(...state.habits.map((hb) => habitToggle(hb, today, (byHabit.get(hb.id) || new Set()).has(today))));
  }

  /* Tareas de hoy y vencidas */
  const list = Logic.sortTasks(dueNow, "smart").slice(0, 6);
  const ul = $("#dashTasks");
  if (!list.length) {
    ul.replaceChildren(h("li", { class: "muted" }, state.tasks.some((t) => Logic.isOpen(t)) ? "Nada vence hoy. Mira «Próximas» en Tareas." : "Todo despejado. Añade una tarea cuando quieras."));
  } else {
    ul.replaceChildren(...list.map((t) => taskItem(t, { compact: true })));
  }

  /* Gráfico semanal */
  const week = Logic.lastDayKeys(7, today);
  const total = Math.max(1, state.habits.length);
  $("#weeklyChart").replaceChildren(
    ...week.map((key) => {
      const count = state.habits.filter((hb) => (byHabit.get(hb.id) || new Set()).has(key)).length;
      const wd = (Logic.weekdayIndex(key));
      return h(
        "div",
        { class: "chart-day" + (key === today ? " today" : ""), title: `${Logic.longDate(key)}: ${count} de ${state.habits.length}` },
        h("span", { class: "chart-count", text: String(count) }),
        h("div", { class: "chart-track" }, h("div", { class: "chart-bar", style: `height:${count ? Math.max(6, (count / total) * 100) : 0}%` })),
        h("span", { class: "chart-label", text: WEEKDAY_LETTERS[wd] })
      );
    })
  );

  /* Progreso de hoy: hábitos + tareas que vencen hoy o están vencidas, más las completadas hoy */
  const doneToday = state.tasks.filter((t) => !Logic.isOpen(t) && Logic.dayOfTimestamp(t.completed_at) === today).length;
  const planned = state.habits.length + dueNow.length + doneToday;
  const done = doneHabits + doneToday;
  const pct = planned ? Math.round((done / planned) * 100) : 0;
  $("#progressRing").style.setProperty("--pct", String(pct));
  $("#progressRing").setAttribute("aria-label", `Progreso de hoy: ${pct}%`);
  $("#progressPct").textContent = `${pct}%`;
  $("#progressTitle").textContent = !planned ? "Empieza cuando quieras" : pct === 100 ? "Día completado" : pct >= 50 ? "Vas por buen camino" : "Un paso a la vez";
  $("#progressText").textContent = planned ? `${done} de ${planned} cosas hechas hoy (hábitos y tareas).` : "Crea un hábito o una tarea para ver tu progreso.";

  /* Finanzas del mes actual */
  const mk = Logic.monthKey(today);
  const totals = Logic.monthTotals(state.transactions, mk);
  const bs = Logic.budgetStatus(state.budgets, totals);
  $("#dashMonthLabel").textContent = `Resumen de ${Logic.monthLabel(mk)}.`;
  $("#dashIncome").textContent = Logic.formatEUR(totals.income);
  $("#dashExpenses").textContent = Logic.formatEUR(totals.expense);
  const bal = $("#dashBalance");
  bal.textContent = Logic.formatEUR(totals.balance);
  bal.classList.toggle("neg", totals.balance < 0);
  bal.classList.toggle("pos", totals.balance > 0);
  $("#dashBudgetLeft").textContent = bs.total ? Logic.formatEUR(bs.total.left) : "—";
  $("#dashBudgetLeft").classList.toggle("neg", !!(bs.total && bs.total.over));
  $("#dashBudgetFoot").textContent = bs.total
    ? bs.total.over ? "Te has pasado del presupuesto" : `Quedan ${100 - bs.total.pct}% de ${Logic.formatEUR(bs.total.limit)}`
    : "Define un presupuesto en Finanzas";
}

$("#quickTaskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#quickTask");
  const title = input.value.trim();
  if (!title) return toast("Escribe el nombre de la tarea.");
  const ok = await createTask({ title, due_date: todayKey() });
  if (ok) input.value = "";
});

renderers.push(renderDashboard);
