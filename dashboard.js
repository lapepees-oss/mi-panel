"use strict";
// Resumen: frase del día, métricas, mapa de constancia por hábito, resumen semanal, próximas tareas, actividad, finanzas y nota rápida.
// Los bloques se pueden ocultar y reordenar (diseño guardado en este navegador) y hay un cronómetro integrado
// que usa el mismo temporizador que la página Tiempo. No guarda datos propios: lee state (la misma fuente que Hábitos, Tareas, Diario y Finanzas).

/* ---------- Frase del día (sustituye al saludo) ----------
 * La frase depende solo de la fecha local (Logic.phraseOfDay): no se guarda nada, así que no cambia al recargar ni al
 * volver a entrar el mismo día y es igual en todos tus dispositivos. Los ajustes viven en este navegador. */
const phrasePrefsNow = () => Logic.phrasePrefs(store.get("phrase", null));
let phraseKey = ""; // lo último pintado: si no cambia, no se toca el DOM

function renderPhrase(today) {
  const p = phrasePrefsNow(), box = $("#dbPhrase");
  show(box, p.show); // oculto = desaparece del flujo y el resto sube, sin hueco
  const pool = PHRASES.filter((x) => p.style === "mixto" || x.s === p.style);
  const ph = Logic.phraseOfDay(today, pool.length ? pool : PHRASES);
  const sig = JSON.stringify([today, p, ph && ph.t]);
  if (sig === phraseKey) return;
  phraseKey = sig;
  box.classList.toggle("plain", !p.accent);
  $("#dbPhraseText").textContent = ph ? ph.t : "Hoy, un paso pequeño también cuenta.";
  const note = ph ? (p.length === "ninguna" ? "" : p.length === "larga" ? `${ph.a} ${ph.b}` : ph.a) : "";
  $("#dbPhraseNote").textContent = note;
  show($("#dbPhraseNote"), !!note);
  const ld = Logic.longDate(today);
  $("#dbDate").textContent = ld.charAt(0).toUpperCase() + ld.slice(1);
  show($("#dbDate"), p.date);
}

function syncPhraseControls() {
  const p = phrasePrefsNow();
  $("#phShow").checked = p.show; $("#phStyle").value = p.style; $("#phLen").value = p.length;
  $("#phDate").checked = p.date; $("#phAccent").checked = p.accent;
}
function savePhrase() {
  store.set("phrase", { show: $("#phShow").checked, style: $("#phStyle").value, length: $("#phLen").value, date: $("#phDate").checked, accent: $("#phAccent").checked });
  renderPhrase(todayKey());
}
["phShow", "phStyle", "phLen", "phDate", "phAccent"].forEach((id) => $("#" + id).addEventListener("change", savePhrase));

function renderDashboard() {
  const today = todayKey();
  const byHabit = habitDays();

  /* Cabecera */
  renderPhrase(today);

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
      h("span", { class: "db-heat-name", title: r.habit.name, text: `${r.habit.emoji || "🌱"} ${r.habit.name}` }),
      h("div", { class: "db-heat-cells", style: `--hc:${Logic.habitColor(r.habit)}` },
        ...r.cells.map((c) => {
          const label = `${r.habit.name}, ${Logic.longDate(c.key)}: ${c.state === "done" ? "cumplido" : c.state === "miss" ? "no cumplido" : c.state === "off" ? "no programado" : "sin registro"}`;
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

/* ---------- Personalizar el Resumen: ordenar y ocultar bloques (se guarda en este navegador) ---------- */

let dashEditing = false;
const dashLayoutNow = () => Logic.dashLayout(store.get("dashLayout", null));

function applyDashLayout() {
  const board = $("#dbBoard");
  if (!board) return;
  const { order, hidden } = dashLayoutNow();
  // Sin cambios de diseño no se toca el DOM (así no se pierde el foco ni el cursor de la nota rápida en cada repintado)
  const sig = JSON.stringify([order, hidden, dashEditing]);
  if (board.dataset.sig === sig) return;
  board.dataset.sig = sig;
  const els = new Map($$("#dbBoard > .db-widget").map((el) => [el.dataset.widget, el]));
  for (const id of order) {
    const el = els.get(id);
    if (!el) continue;
    board.append(el); // el orden del DOM es el orden visual (también para teclado y lectores de pantalla)
    el.classList.toggle("is-off", hidden.includes(id));
    let tools = el.querySelector(":scope > .db-tools");
    if (!tools) {
      tools = h("div", { class: "db-tools" });
      el.prepend(tools);
    }
    const i = order.indexOf(id), title = el.dataset.title;
    tools.replaceChildren(
      h("b", { text: title + (hidden.includes(id) ? " (oculto)" : "") }),
      h("button", { type: "button", title: "Subir", "aria-label": `Subir «${title}»`, disabled: i === 0, onclick: () => saveDashLayout({ order: Logic.moveWidget(order, id, -1), hidden }, id, "up") }, "↑"),
      h("button", { type: "button", title: "Bajar", "aria-label": `Bajar «${title}»`, disabled: i === order.length - 1, onclick: () => saveDashLayout({ order: Logic.moveWidget(order, id, 1), hidden }, id, "down") }, "↓"),
      h("button", { type: "button", "aria-pressed": String(hidden.includes(id)), onclick: () => saveDashLayout({ order, hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] }, id) }, hidden.includes(id) ? "Mostrar" : "Ocultar")
    );
  }
  // Fila "Qué mostrar": una pastilla por bloque para activarlo/ocultarlo de un vistazo (mismo estado que el botón de cada bloque)
  $("#dbShowRow").replaceChildren(h("span", { class: "db-show-label", text: "Qué mostrar" }),
    ...order.filter((id) => els.has(id)).map((id) => {
      const on = !hidden.includes(id);
      return h("button", { type: "button", class: "db-chip" + (on ? " on" : ""), "aria-pressed": String(on), text: els.get(id).dataset.title,
        onclick: () => saveDashLayout({ order, hidden: on ? [...hidden, id] : hidden.filter((x) => x !== id) }) });
    }));
  board.classList.toggle("editing", dashEditing);
  show($("#dbEditBar"), dashEditing);
  const b = $("#dbCustomize");
  b.setAttribute("aria-pressed", String(dashEditing));
  b.textContent = dashEditing ? "⚙ Editando…" : "⚙ Personalizar";
  if (dashEditing) syncPhraseControls();
}

function saveDashLayout(layout, focusId, dir) {
  store.set("dashLayout", layout);
  applyDashLayout();
  // tras mover, el foco sigue en el mismo botón (si ya no puede moverse más, pasa al otro)
  const el = $(`#dbBoard > .db-widget[data-widget="${focusId}"]`);
  if (el && dir) { const btns = el.querySelectorAll(".db-tools button"); const t = btns[dir === "up" ? 0 : 1]; (t && !t.disabled ? t : btns[dir === "up" ? 1 : 0]).focus(); }
}

$("#dbCustomize").addEventListener("click", () => { dashEditing = !dashEditing; applyDashLayout(); });
$("#dbLayoutDone").addEventListener("click", () => { dashEditing = false; applyDashLayout(); $("#dbCustomize").focus(); });
$("#dbLayoutReset").addEventListener("click", () => { store.set("dashLayout", null); store.set("phrase", null); syncPhraseControls(); renderPhrase(todayKey()); applyDashLayout(); toast("Resumen restablecido."); });

/* ---------- Barra de tiempo: usa el MISMO temporizador de la página Tiempo (una sola fuente de verdad) ----------
 * No hay un segundo reloj ni otro setInterval por modo: los botones delegan en los de la página Tiempo (iniciar,
 * pausar, finalizar, reiniciar, cambiar de modo) y esta función solo lee el estado y repinta. Así no puede haber
 * intervalos duplicados ni saltos de tiempo al cambiar de modo (eso lo resuelve switchMode de timer.js). */

const MIN_MS = 60000, MAX_MS = 24 * 3600000, STEP_MS = 60000; // − y + mueven exactamente 1 minuto

// Mm:ss, o h:mm:ss si pasa de una hora (formato compacto de la referencia)
function compactClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

// Duración que dejaría un clic en − (dir = -1) o + (dir = 1). Nunca baja de 1 minuto, ni de lo ya transcurrido (en pausa).
function nextDuration(dir) {
  const cur = Math.max(0, Number(state.timer.target_ms) || 0);
  const floor = Math.max(MIN_MS, Math.ceil(elapsed() / STEP_MS) * STEP_MS);
  return Math.max(floor, Math.min(MAX_MS, cur + dir * STEP_MS));
}

// El cambio se ve al instante (local) y se guarda en Supabase una sola vez cuando dejas de pulsar,
// así pulsar + varias veces seguidas no genera una escritura por clic. Cualquier otra acción del temporizador
// (iniciar, pausar, cambiar de modo…) guarda antes lo pendiente para que nada se pise.
let durationSave = null, durationPending = null;
function flushDuration() {
  clearTimeout(durationSave);
  if (durationPending == null) return Promise.resolve();
  const v = durationPending;
  durationPending = null;
  return updateTimer({ target_ms: v });
}
function nudgeDuration(dir) {
  const t = state.timer;
  if (!t || t.running || currentMode() !== "timer") return;
  const next = nextDuration(dir);
  if (next === (Number(t.target_ms) || 0)) return;
  state.timer = { ...t, target_ms: next };
  durationPending = next;
  renderTimer();
  syncDashTimer();
  clearTimeout(durationSave);
  durationSave = setTimeout(flushDuration, 500);
}

function syncDashTimer() {
  const t = state.timer;
  const root = $("#dbTimer");
  if (!root || !t) return;
  const mode = currentMode();
  const running = !!t.running;
  const el = elapsed();
  const target = Math.max(0, Number(t.target_ms) || 0);
  root.classList.toggle("running", running);
  $$("#dbTimer .db-tm").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });

  // − / valor / +: solo en Temporizador. Al ocultarse se pliegan (CSS) y la barra de progreso ocupa su espacio.
  const isTimer = mode === "timer";
  $("#dbDuration").classList.toggle("is-hidden", !isTimer);
  if (isTimer) {
    const min = target / 60000;
    $("#dbTimerDuration").textContent = Number.isInteger(min) ? `${min} min` : Logic.formatDuration(target);
    $("#dbTimerMinus").disabled = running || nextDuration(-1) === target;
    $("#dbTimerPlus").disabled = running || nextDuration(1) === target;
  }

  // Texto de tiempo: el mismo que pinta la página Tiempo (cuenta atrás en Temporizador, hacia arriba en Cronómetro)
  const clock = $("#timer-display").textContent.replace(/^00:/, "");
  $("#dbTimerClock").textContent = isTimer ? `${clock} / ${compactClock(target)}` : clock;

  // Progreso: Temporizador = lo transcurrido; Cronómetro = vuelta de 1 hora; Pomodoro = el mismo valor que el anillo de Tiempo
  let pct = 0;
  if (isTimer) pct = target ? Math.min(100, (el / target) * 100) : 0;
  else if (mode === "stopwatch") pct = ((el % 3600000) / 3600000) * 100;
  else { const v = parseFloat($("#timer-ring").style.getPropertyValue("--pct")); pct = Number.isFinite(v) ? v : 0; }
  const bar = $("#dbTimerBar");
  bar.firstElementChild.style.width = pct + "%";
  bar.setAttribute("aria-valuenow", String(Math.round(pct)));

  $("#dbTimerStart").disabled = $("#timer-start").disabled || running;
  $("#dbTimerStart span").textContent = running ? "En marcha" : el > 0 ? "Reanudar" : "Iniciar";
  $("#dbTimerPause").disabled = $("#timer-pause").disabled;
  $("#dbTimerFinish").disabled = $("#timer-finish").disabled;
  $("#dbTimerReset").disabled = $("#timer-reset").disabled;
}

$("#dbTimerStart").addEventListener("click", () => flushDuration().then(() => $("#timer-start").click()));
$("#dbTimerPause").addEventListener("click", () => flushDuration().then(() => $("#timer-pause").click()));
$("#dbTimerFinish").addEventListener("click", () => flushDuration().then(() => $("#timer-finish").click()));
$("#dbTimerReset").addEventListener("click", () => flushDuration().then(() => $("#timer-reset").click())); // pide confirmación si hay tiempo sin guardar
$("#dbTimerMinus").addEventListener("click", () => nudgeDuration(-1));
$("#dbTimerPlus").addEventListener("click", () => nudgeDuration(1));
$("#dbTimer .db-timer-modes").addEventListener("click", (e) => { const b = e.target.closest(".db-tm"); if (b) flushDuration().then(() => switchMode(b.dataset.mode)).then(syncDashTimer); });
// Un único temporizador de repintado (solo con la página Resumen visible); la hora real sale de Date.now(), no de contar tics
setInterval(() => { if (!document.hidden && currentPage === "dashboard") syncDashTimer(); }, 400);

renderers.push(applyDashLayout, syncDashTimer);
