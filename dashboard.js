"use strict";
// Resumen: frase del día, métricas, mapa de constancia por hábito, resumen semanal, próximas tareas, actividad, finanzas y nota rápida.
// Los bloques se pueden ocultar y reordenar (diseño guardado en este navegador) y hay un cronómetro integrado
// que usa el mismo temporizador que la página Tiempo. No guarda datos propios: lee state (la misma fuente que Hábitos, Tareas, Diario y Finanzas).

/* ---------- Frase del día (sustituye al saludo) ----------
 * La frase depende solo de la fecha local (Logic.phraseOfDay): no se guarda nada, así que no cambia al recargar ni al
 * volver a entrar el mismo día y es igual en todos tus dispositivos. Los ajustes viven en este navegador. */
const phrasePrefsNow = () => Logic.phrasePrefs((upDash() || {}).phrase ?? store.get("phrase", null)); // por usuario (con el diseño del Resumen)
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
  upSet("dash", { ...(upDash() || {}), phrase: { show: $("#phShow").checked, style: $("#phStyle").value, length: $("#phLen").value, date: $("#phDate").checked, accent: $("#phAccent").checked } });
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
    ms: state.sessions.filter((x) => Logic.dayOfTimestamp(x.created_at) === k).reduce((n, x) => n + (Number(x.duration_ms) || 0), 0),
  }));
  const focusWeek = data.reduce((n, d) => n + d.ms, 0);
  $("#weeklyFocus").textContent = focusWeek ? `Concentración esta semana: ${Logic.formatDuration(focusWeek)}` : "";
  const max = Math.max(1, ...data.map((d) => d.habits + d.tasks));
  const any = data.some((d) => d.habits + d.tasks > 0 || d.ms > 0);
  show($("#weeklyEmpty"), !any);
  show($("#weeklyChart"), any);
  $("#weeklyChart").replaceChildren(
    ...data.map((d, i) => {
      const n = d.habits + d.tasks;
      return h("div", { class: "chart-day" + (d.key === today ? " today" : ""), title: `${Logic.longDate(d.key)}: ${plural(d.habits, "hábito", "hábitos")} y ${plural(d.tasks, "tarea", "tareas")}${d.ms ? " · " + Logic.formatDuration(d.ms) + " de concentración" : ""}` },
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

/* ---------- Personalizar el Resumen: tablero libre ----------
 * Rejilla de 6 columnas. Cada bloque tiene ancho (columnas) y alto (0 = automático, o filas de 72 px).
 * En modo edición: arrastrar por el asa (⠿), redimensionar por el borde derecho, el inferior o la esquina,
 * ocultar/mostrar, ajustar (⚙) y añadir desde el catálogo. Todo se guarda por usuario (userprefs.js);
 * el invitado lo tiene solo en memoria. Los botones ↑ ↓ y el ajuste con listas permiten hacerlo sin ratón.
 * Pantallas estrechas: una columna (los anchos no se pueden aplicar), pero el orden y el alto sí. */

let dashEditing = false, drawerCollapsed = false;
const GAP = 14, ROW_PX = Logic.DASH_ROW, ROW_STEP = ROW_PX + GAP;
const rowsToPx = (n) => n * ROW_PX + (n - 1) * GAP;
const guestHidden = () => (isGuest() ? ["suggestion"] : []); // CloudSpace Intelligence es de la cuenta: el invitado no la ve
const dashLayoutNow = () => {
  const l = Logic.dashLayout(upDash());
  for (const id of guestHidden()) if (!l.hidden.includes(id)) l.hidden.push(id);
  return l;
};
const dashRaw = () => ({ ...(upDash() || {}) }); // conserva claves ajenas al diseño (p. ej. la frase del día)

function saveDash(layout) {
  upSet("dash", { ...dashRaw(), order: layout.order, hidden: layout.hidden.filter((id) => !guestHidden().includes(id)), sizes: layout.sizes, cfg: layout.cfg });
  applyDashLayout(true);
}

function widgetTitleEl(el) { return $(":scope > .panel-head h3, :scope > .journal-prompt strong", el); }

function applyWidgetBox(el, layout) {
  const id = el.dataset.widget, size = Logic.widgetSize(layout, id);
  el.style.setProperty("--w", String(size.w));
  el.style.setProperty("--h", String(size.h));
  el.classList.toggle("has-h", size.h > 0);
  el.style.height = size.h > 0 ? rowsToPx(size.h) + "px" : "";
  const cfg = layout.cfg[id] || {}, t = widgetTitleEl(el);
  if (t) { if (t.dataset.orig === undefined) t.dataset.orig = t.textContent; t.textContent = cfg.title || t.dataset.orig; }
  el.classList.toggle("compact", cfg.info === "compact");
  if (t) el.setAttribute("aria-label", t.textContent);
}

function applyDashLayout(force) {
  const board = $("#dbBoard");
  if (!board) return;
  const layout = dashLayoutNow(), { order, hidden } = layout;
  const sig = JSON.stringify([layout, dashEditing, isGuest()]);
  if (!force && board.dataset.sig === sig) { renderNewWidgets(layout, todayKey()); return; } // sin cambios de diseño no se toca el DOM, pero los bloques de datos sí se refrescan
  board.dataset.sig = sig;
  const els = new Map($$("#dbBoard > .db-widget").map((el) => [el.dataset.widget, el]));
  for (const id of order) {
    const el = els.get(id);
    if (!el) continue;
    board.append(el); // el orden del DOM es el orden visual (también para teclado y lectores de pantalla)
    el.classList.toggle("is-off", hidden.includes(id));
    applyWidgetBox(el, layout);
    let tools = el.querySelector(":scope > .db-tools");
    if (!tools) { tools = h("div", { class: "db-tools" }); el.prepend(tools); }
    let handles = el.querySelector(":scope > .db-rz-wrap");
    if (!handles) {
      handles = h("div", { class: "db-rz-wrap", "aria-hidden": "true" }, ...["e", "s", "se"].map((k) => h("i", { class: "db-rz " + k, "data-rz": k, onpointerdown: (ev) => startResize(ev, el, k) })));
      el.append(handles);
    }
    const i = order.indexOf(id), title = (widgetTitleEl(el) || {}).textContent || el.dataset.title;
    const vis = order.filter((x) => !hidden.includes(x));
    const vi = vis.indexOf(id);
    const grip = h("button", { type: "button", class: "db-grip", title: "Arrastrar para mover", "aria-label": `Mover «${title}» (arrastra, o usa las flechas ↑ ↓ del teclado)`, onpointerdown: (ev) => startDrag(ev, el),
      onkeydown: (ev) => { if (ev.key === "ArrowUp" || ev.key === "ArrowDown") { ev.preventDefault(); moveBy(id, ev.key === "ArrowUp" ? -1 : 1); } } }, "⠿");
    tools.replaceChildren(grip, h("b", { text: title + (hidden.includes(id) ? " (oculto)" : "") }),
      h("button", { type: "button", title: "Subir", "aria-label": `Subir «${title}»`, disabled: vi <= 0, onclick: () => moveBy(id, -1) }, "↑"),
      h("button", { type: "button", title: "Bajar", "aria-label": `Bajar «${title}»`, disabled: vi < 0 || vi === vis.length - 1, onclick: () => moveBy(id, 1) }, "↓"),
      h("button", { type: "button", title: "Ajustes del bloque", "aria-label": `Ajustes de «${title}»`, onclick: () => openWidgetConfig(id) }, "⚙"),
      h("button", { type: "button", title: hidden.includes(id) ? "Mostrar" : "Ocultar", "aria-pressed": String(hidden.includes(id)), "aria-label": `${hidden.includes(id) ? "Mostrar" : "Ocultar"} «${title}»`, onclick: () => toggleWidget(id) }, hidden.includes(id) ? "Mostrar" : "Ocultar"));
  }
  renderDrawer(layout, els);
  board.classList.toggle("editing", dashEditing);
  document.body.classList.toggle("db-editing", dashEditing);
  const dr = $("#dbDrawer");
  if (!dashEditing) drawerCollapsed = false;
  dr.classList.toggle("open", dashEditing && !drawerCollapsed);
  document.body.classList.toggle("dr-collapsed", dashEditing && drawerCollapsed);
  show($("#dbDrawerTab"), dashEditing);
  $("#dbDrawerTab").setAttribute("aria-expanded", String(!drawerCollapsed));
  $("#dbDrawerTab span").textContent = drawerCollapsed ? "‹" : "›"; dr.setAttribute("aria-hidden", String(!dashEditing || drawerCollapsed)); dr.inert = !dashEditing || drawerCollapsed;
  const b = $("#dbCustomize");
  b.setAttribute("aria-pressed", String(dashEditing));
  b.textContent = dashEditing ? "⚙ Editando…" : "⚙ Personalizar";
  if (dashEditing) syncPhraseControls();
  renderNewWidgets(layout, todayKey());
}

function toggleWidget(id) {
  const l = dashLayoutNow(), off = l.hidden.includes(id);
  saveDash({ ...l, hidden: off ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] });
}
function moveBy(id, dir) {
  const l = dashLayoutNow(), vis = l.order.filter((x) => !l.hidden.includes(x)), i = vis.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= vis.length) return;
  saveDash({ ...l, order: Logic.placeWidget(l.order, id, dir < 0 ? vis[j] : (l.order[l.order.indexOf(vis[j]) + 1] ?? null)) });
  const g = $(`#dbBoard > .db-widget[data-widget="${id}"] .db-grip`); if (g) g.focus();
}

/* ---------- Panel lateral de widgets (derecha): previsualización, arrastrar al Resumen o pulsar «Añadir» ---------- */
// Esquema de cada widget (maqueta sin cifras: no son datos). Se dibuja con divs/CSS.
const MP = (cls, ...k) => h("div", { class: "mp " + cls, "aria-hidden": "true" }, ...k);
const mpI = (cls = "") => h("i", { class: cls });
const mpRows = (n, cls = "") => Array.from({ length: n }, () => h("div", { class: "mp-row " + cls }, mpI("dot"), mpI("ln"), mpI("ln s")));
const MINI = {
  metrics: () => MP("g4", ...Array.from({ length: 4 }, () => h("div", { class: "mp-tile" }, mpI("sq"), mpI("ln"), mpI("ln s")))),
  timer: () => MP("mcol", h("div", { class: "mp-pills" }, mpI(), mpI(), mpI(), mpI("btn")), h("div", { class: "mp-bar" }, mpI())),
  tasks: () => MP("mcol", ...mpRows(3)),
  heat: () => MP("mcol", ...Array.from({ length: 3 }, (_, r) => h("div", { class: "mp-dots" }, ...Array.from({ length: 14 }, (_, c) => mpI((c * 7 + r * 3) % 5 === 0 ? "off" : "on"))))),
  week: () => MP("mrow", mpI("ring"), h("div", { class: "mcol" }, mpI("ln"), mpI("ln s"))),
  activity: () => MP("bars", ...[40, 70, 25, 55, 85, 35, 60].map((n) => h("i", { style: `height:${n}%` }))),
  finance: () => MP("g3", ...Array.from({ length: 3 }, () => h("div", { class: "mp-tile" }, mpI("ln s"), mpI("ln")))),
  quote: () => MP("mcol", mpI("qm"), mpI("ln"), mpI("ln"), mpI("ln s")),
  note: () => MP("mcol", mpI("ln s"), h("div", { class: "mp-box" })),
  next: () => MP("mcol", mpI("ln"), h("div", { class: "mp-pills" }, mpI(), mpI()), mpI("btn")),
  budget: () => MP("mcol", ...Array.from({ length: 3 }, (_, i) => h("div", { class: "mp-meter" }, mpI("ln s"), h("div", { class: "mp-bar" }, h("i", { style: `width:${[80, 45, 62][i]}%` }))))),
  goal: () => MP("mcol", mpI("ln s"), h("div", { class: "mp-bar" }, h("i", { style: "width:55%" })), h("div", { class: "mp-miles" }, mpI("on"), mpI("on"), mpI(), mpI())),
  focus: () => MP("g2", ...Array.from({ length: 2 }, () => h("div", { class: "mp-tile" }, mpI("ln s"), mpI("ln")))),
  notes: () => MP("mcol", ...Array.from({ length: 3 }, () => h("div", { class: "mp-row" }, mpI("ln xs"), mpI("ln")))),
  payments: () => MP("mcol", ...Array.from({ length: 2 }, () => h("div", { class: "mp-row sp" }, mpI("ln"), mpI("ln xs")))),
  saving: () => MP("mcol", mpI("ln s"), h("div", { class: "mp-bar" }, h("i", { style: "width:35%" })), h("div", { class: "mp-pills" }, mpI("ln xs"), mpI("ln xs"), mpI("ln xs"))),
  stats: () => MP("g3", ...Array.from({ length: 3 }, () => h("div", { class: "mp-tile" }, mpI("ln"), mpI("ln s")))),
  suggestion: () => MP("mcol", h("div", { class: "mp-row" }, mpI("star"), mpI("ln")), mpI("ln"), mpI("ln s")),
};
const miniFor = (id) => (MINI[id] || (() => MP("mcol", mpI("ln"), mpI("ln s"))))();

function drawerCard(id, layout, on) {
  const c = Logic.DASH_CATALOG[id], title = (layout.cfg[id] && layout.cfg[id].title) || c.title;
  const size = Logic.widgetSize(layout, id);
  const thumb = h("div", { class: "dr-thumb" + (on ? "" : " grab"), title: on ? "" : "Arrastra al Resumen", onpointerdown: on ? null : (ev) => startAdd(ev, id) }, miniFor(id));
  const card = h("div", { class: "db-cat dr-card" + (on ? " on" : ""), "data-id": id },
    thumb,
    h("div", { class: "dr-info" }, h("b", { text: title }), h("small", { text: c.desc }), h("small", { class: "dr-size", text: `${size.w} de 6 columnas` })),
    h("button", { type: "button", class: "db-chip" + (on ? " on" : ""), "aria-pressed": String(on), "aria-label": `${on ? "Quitar" : "Añadir"} «${c.title}»`, text: on ? "Quitar" : "Añadir", onclick: () => (on ? toggleWidget(id) : addWidget(id, null))}));
  return card;
}

function renderDrawer(layout, els) {
  const { order, hidden } = layout;
  const ids = order.filter((id) => els.has(id) && !guestHidden().includes(id));
  const avail = ids.filter((id) => hidden.includes(id)), used = ids.filter((id) => !hidden.includes(id));
  $("#dbAvail").replaceChildren(...avail.map((id) => drawerCard(id, layout, false)));
  show($("#dbAvailEmpty"), avail.length === 0);
  $("#dbShowRow").replaceChildren(...used.map((id) => drawerCard(id, layout, true)));
}

/* Efecto «gota en el agua»: ondas concentricas que salen del widget recién añadido */
function rippleWidget(el) {
  el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  el.classList.remove("just-added"); void el.offsetWidth; el.classList.add("just-added");
  if (reducedMotion()) { setTimeout(() => el.classList.remove("just-added"), 1200); return; }
  const wave = h("div", { class: "db-ripple", "aria-hidden": "true" }, ...[0, 1, 2, 3].map((i) => h("i", { style: `animation-delay:${i * 0.22}s` })));
  el.append(wave);
  setTimeout(() => { wave.remove(); el.classList.remove("just-added"); }, 2600);
}

// Añade (o recoloca) un widget: lo muestra, lo pone antes de `beforeId` (o al final) y lanza el efecto de ondas
function addWidget(id, beforeId) {
  const l = dashLayoutNow();
  const order = Logic.placeWidget(l.order, id, beforeId || null);
  if (matchMedia("(max-width: 1099px)").matches) drawerCollapsed = true; // en pantallas estrechas el panel taparía el resultado
  saveDash({ ...l, order, hidden: l.hidden.filter((x) => x !== id) });
  requestAnimationFrame(() => { const el = $(`#dbBoard > .db-widget[data-widget="${id}"]`); if (el) rippleWidget(el); });
}

// Dónde caería un widget soltado en (x, y): el primer widget visible que quede «después» del punto, o null = al final
function insertionRef(x, y) {
  const items = $$("#dbBoard > .db-widget:not(.is-off):not(.dragging)");
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (y < r.top) return el;
    if (y <= r.bottom && x < r.left + r.width / 2) return el;
    if (y <= r.bottom && x >= r.left + r.width / 2 && x <= r.right) { /* mitad derecha: va después */ continue; }
  }
  return null;
}

// Arrastrar desde el panel lateral: una copia fantasma sigue al puntero y un hueco punteado marca dónde caerá
function startAdd(ev, id) {
  if (ev.button > 0) return;
  ev.preventDefault();
  const pid = ev.pointerId, c = Logic.DASH_CATALOG[id], layout = dashLayoutNow(), size = Logic.widgetSize(layout, id);
  const board = $("#dbBoard"), drawer = $("#dbDrawer");
  const ghost = h("div", { class: "dr-ghost" }, miniFor(id), h("b", { text: c.title }));
  document.body.append(ghost);
  const drop = h("div", { class: "db-drop", "aria-hidden": "true" }, h("span", { text: c.title }));
  drop.style.setProperty("--w", String(size.w));
  document.body.classList.add("db-adding");
  let raf = 0, lx = ev.clientX, ly = ev.clientY, over = false;
  const x0 = lx, y0 = ly;
  const pos = () => {
    if (Math.hypot(lx - x0, ly - y0) < 24 && !drop.parentNode) return; // un toque o un arrastre mínimo no añade nada
    ghost.style.transform = `translate(${lx + 14}px, ${ly + 14}px)`;
    const br = board.getBoundingClientRect(), dr = drawer.getBoundingClientRect();
    over = lx >= br.left && lx <= br.right && ly >= 0 && ly <= innerHeight && !(lx >= dr.left && dr.width > 0 && drawer.classList.contains("open") && getComputedStyle(drawer).opacity > 0.9);
    if (over) { const ref = insertionRef(lx, ly); if (drop.parentNode !== board || drop.nextElementSibling !== ref) flip(board, () => board.insertBefore(drop, ref)); }
    else if (drop.parentNode) drop.remove();
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    lx = e.clientX; ly = e.clientY; pos();
    cancelAnimationFrame(raf);
    const edge = 80, vy = ly < edge ? -14 : ly > innerHeight - edge ? 14 : 0;
    if (vy) { const tick = () => { window.scrollBy(0, vy); pos(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
  };
  const end = (e) => {
    if (e.pointerId !== pid) return;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
    const ref = drop.parentNode ? drop.nextElementSibling : undefined;
    const ok = drop.parentNode && e.type === "pointerup";
    drop.remove(); ghost.remove(); document.body.classList.remove("db-adding");
    if (ok) addWidget(id, ref && ref.dataset ? ref.dataset.widget : null);
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  pos();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dashEditing && !document.querySelector("dialog[open]")) { dashEditing = false; applyDashLayout(true); $("#dbCustomize").focus(); } });
// Al salir del Resumen se cierra el modo edición
renderers.push(() => { if (dashEditing && currentPage !== "dashboard") { dashEditing = false; applyDashLayout(true); } });

/* ---------- Arrastrar para reordenar (ratón y táctil) ---------- */
function flip(board, change) {
  const items = $$("#dbBoard > .db-widget:not(.is-off)"), before = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
  change();
  if (reducedMotion()) return;
  for (const el of items) {
    if (el.classList.contains("dragging")) continue;
    const a = before.get(el), b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if ((dx || dy) && el.animate) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.75,.25,1)" });
  }
}

function startDrag(ev, el) {
  if (ev.button > 0) return;
  ev.preventDefault();
  const board = $("#dbBoard"), id = el.dataset.widget;
  const pid = ev.pointerId; // se escucha en window: al reordenar el DOM el asa pierde la captura del puntero
  const r0 = el.getBoundingClientRect();
  const st = { gx: ev.clientX - r0.left, gy: ev.clientY - r0.top, tx: 0, ty: 0 };
  el.classList.add("dragging");
  let raf = 0, lastY = ev.clientY, lastX = ev.clientX;
  const place = () => {
    // posición natural = donde estaría sin transformación; el bloque sigue al puntero
    el.style.transform = "none";
    const nat = el.getBoundingClientRect();
    st.tx = lastX - st.gx - nat.left; st.ty = lastY - st.gy - nat.top;
    el.style.transform = `translate(${st.tx}px,${st.ty}px)`;
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    lastX = e.clientX; lastY = e.clientY;
    place();
    // ¿sobre qué bloque está el puntero?
    el.style.pointerEvents = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    el.style.pointerEvents = "";
    const other = under && under.closest("#dbBoard > .db-widget:not(.is-off)");
    if (other && other !== el) {
      const rr = other.getBoundingClientRect();
      const before = e.clientY < rr.top + rr.height / 2 || (e.clientY < rr.bottom && e.clientX < rr.left + rr.width / 2);
      const ref = before ? other : other.nextElementSibling;
      if (ref !== el && el.nextElementSibling !== ref) { flip(board, () => board.insertBefore(el, ref)); place(); }
    }
    // desplazamiento automático cerca de los bordes de la ventana
    cancelAnimationFrame(raf);
    const edge = 70, vy = lastY < edge ? -14 : lastY > innerHeight - edge ? 14 : 0;
    if (vy) { const tick = () => { window.scrollBy(0, vy); place(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
  };
  const end = (e) => {
    if (e && e.pointerId !== pid) return;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
    el.classList.remove("dragging"); el.style.transform = "";
    const domOrder = $$("#dbBoard > .db-widget").map((x) => x.dataset.widget);
    const l = dashLayoutNow();
    saveDash({ ...l, order: domOrder });
    const g = $(`#dbBoard > .db-widget[data-widget="${id}"] .db-grip`); if (g) g.focus();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
}

/* ---------- Redimensionar por bordes y esquina (ratón y táctil) ---------- */
function startResize(ev, el, kind) {
  if (ev.button > 0) return;
  ev.preventDefault(); ev.stopPropagation();
  const handle = ev.currentTarget, id = el.dataset.widget, board = $("#dbBoard");
  handle.setPointerCapture(ev.pointerId);
  const layout = dashLayoutNow(), cur = Logic.widgetSize(layout, id), bw = board.clientWidth;
  const narrow = matchMedia("(max-width: 760px)").matches;
  const colW = (bw + GAP) / 6;
  const start = { w: cur.w, hPx: el.offsetHeight + GAP };
  const x0 = ev.clientX, y0 = ev.clientY;
  let size = cur;
  el.classList.add("resizing");
  const move = (e) => {
    const dx = kind === "s" || narrow ? 0 : e.clientX - x0, dy = kind === "e" ? 0 : e.clientY - y0;
    size = Logic.sizeFromDrag(id, start, dx, dy, colW, ROW_STEP);
    if (kind === "e") size = { ...size, h: cur.h };
    if (kind === "s" || narrow) size = { ...size, w: cur.w };
    el.style.setProperty("--w", String(size.w)); el.style.setProperty("--h", String(size.h));
    el.style.height = size.h > 0 ? rowsToPx(size.h) + "px" : "";
    el.classList.toggle("has-h", size.h > 0);
  };
  const end = () => {
    handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end);
    el.classList.remove("resizing");
    saveDash({ ...layout, sizes: { ...layout.sizes, [id]: size } });
  };
  handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
}

/* ---------- Ajustes de un bloque (ventana) ---------- */
function openWidgetConfig(id) {
  const l = dashLayoutNow(), c = Logic.DASH_CATALOG[id], cfg = { ...(l.cfg[id] || {}) }, size = Logic.widgetSize(l, id);
  const el = $(`#dbBoard > .db-widget[data-widget="${id}"]`), hasTitle = !!widgetTitleEl(el);
  const dlg = $("#sheet-dialog");
  const sel = (opts, value, label) => { const s = h("select", { "aria-label": label }, ...opts.map(([v, t]) => h("option", { value: String(v), selected: String(v) === String(value), text: t }))); return s; };
  const title = h("input", { type: "text", maxlength: "60", value: cfg.title || "", placeholder: c.title, "aria-label": "Título del bloque" });
  const wSel = sel(Array.from({ length: c.max - c.min + 1 }, (_, i) => [c.min + i, `${c.min + i} de 6 columnas`]), size.w, "Ancho");
  const hSel = sel([[0, "Automático"], ...Array.from({ length: Logic.DASH_MAX_ROWS }, (_, i) => [i + 1, `${i + 1} ${i ? "filas" : "fila"}`])], size.h, "Alto");
  const info = sel([["", "Completa"], ["compact", "Compacta (sin descripciones)"]], cfg.info || "", "Información");
  const fields = [];
  if (hasTitle) fields.push(h("label", {}, "Título", title));
  fields.push(h("label", {}, "Ancho", wSel), h("label", {}, "Alto", hSel), h("label", {}, "Información", info));
  let goalSel = null, periodSel = null;
  if (id === "goal" || id === "saving") {
    goalSel = sel([["", state.goals.length ? "La primera meta" : "No hay metas todavía"], ...state.goals.map((g) => [g.id, g.name])], cfg.goal || "", "Objetivo mostrado");
    fields.push(h("label", {}, "Objetivo mostrado", goalSel));
  }
  if (id === "stats") {
    periodSel = sel([[7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"]], cfg.period || 7, "Periodo");
    fields.push(h("label", {}, "Periodo", periodSel));
  }
  const save = () => {
    const next = { ...(l.cfg) };
    const nc = { title: title.value, info: info.value, goal: goalSel ? goalSel.value : cfg.goal, period: periodSel ? Number(periodSel.value) : cfg.period };
    const clean = Logic.dashLayout({ order: l.order, cfg: { [id]: nc } }).cfg[id];
    if (clean) next[id] = clean; else delete next[id];
    saveDash({ ...l, cfg: next, sizes: { ...l.sizes, [id]: Logic.clampWidgetSize(id, { w: wSel.value, h: hSel.value }) } });
    closeDialog(dlg);
  };
  const restore = () => {
    const next = { ...l.cfg }, sizes = { ...l.sizes };
    delete next[id]; delete sizes[id];
    saveDash({ ...l, cfg: next, sizes });
    closeDialog(dlg);
    toast("Bloque restablecido.");
  };
  dlg.replaceChildren(h("div", { class: "sheet wcfg" },
    h("h2", { style: "margin-top:0", text: `Ajustes · ${c.title}` }), h("p", { class: "muted", text: c.desc }),
    h("div", { class: "wcfg-fields" }, ...fields),
    h("div", { class: "row", style: "justify-content:space-between;margin-top:14px;gap:8px;flex-wrap:wrap" },
      h("button", { type: "button", class: "secondary", text: "Restablecer bloque", onclick: restore }),
      h("span", {}, h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => closeDialog(dlg) }), " ", h("button", { type: "button", class: "primary-btn", text: "Guardar", onclick: save })))));
  openDialog(dlg);
}

$("#dbDrawerTab").addEventListener("click", () => { drawerCollapsed = !drawerCollapsed; applyDashLayout(true); });
$("#dbCustomize").addEventListener("click", () => { dashEditing = !dashEditing; applyDashLayout(true); });
$("#dbLayoutDone").addEventListener("click", () => { dashEditing = false; applyDashLayout(true); $("#dbCustomize").focus(); });
$("#dbLayoutReset").addEventListener("click", async () => {
  if (!(await askConfirm({ title: "¿Restablecer el Resumen?", text: "Se recupera el diseño original: orden, tamaños, bloques visibles y ajustes. Tus datos no cambian.", confirmLabel: "Restablecer" }))) return;
  upSet("dash", null);
  syncPhraseControls(); phraseKey = ""; renderPhrase(todayKey());
  applyDashLayout(true);
  toast("Resumen restablecido.");
});

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
