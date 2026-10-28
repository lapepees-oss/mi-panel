"use strict";
// Plan · Calendario unificado. SOLO LEE: coloca en su día lo que ya existe en otros módulos (tareas con fecha, hitos de
// objetivos, próximos cobros y tiempo de concentración). Nada se duplica: cada elemento abre o edita el original, y
// cualquier cambio (completar una tarea, moverla de día) se guarda en su propio módulo.

let calMonth = todayKey().slice(0, 7), calSel = todayKey();
let calShow = Object.assign({ tasks: true, milestones: true, payments: true, focus: true }, store.get("calShow", {}));
let planTab = store.get("planTab", "objetivos");

function setPlanTab(t) {
  planTab = t === "calendario" ? "calendario" : "objetivos";
  store.set("planTab", planTab);
  $$("#planTabs button").forEach((b) => { const on = b.dataset.tab === planTab; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  $("#pv-objetivos").classList.toggle("hidden", planTab !== "objetivos");
  $("#pv-calendario").classList.toggle("hidden", planTab !== "calendario");
  $("#objNew").classList.toggle("hidden", planTab !== "objetivos");
  if (planTab === "calendario") renderCalendar();
}

const calKeyOf = (mk, d) => `${mk}-${String(d).padStart(2, "0")}`;

function calDots(day) {
  if (!day) return [];
  const out = [];
  const n = (arr) => arr.length;
  if (calShow.tasks && n(day.tasks)) out.push(["tasks", n(day.tasks)]);
  if (calShow.milestones && n(day.milestones)) out.push(["milestones", n(day.milestones)]);
  if (calShow.payments && n(day.payments)) out.push(["payments", n(day.payments)]);
  if (calShow.focus && day.focusMs) out.push(["focus", 1]);
  return out;
}

function renderCalendar() {
  const grid = $("#calGrid");
  if (!grid || planTab !== "calendario") return;
  const today = todayKey();
  const cal = Logic.calendarMonth(calMonth, { tasks: state.tasks, objectives: state.objectives, subs: state.subs, sessions: state.sessions }, today);
  $("#calLabel").textContent = cal.label;
  $$("#calFilters button").forEach((b) => { const on = !!calShow[b.dataset.k]; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  const head = ["L", "M", "X", "J", "V", "S", "D"].map((d) => h("div", { class: "cal-wd", role: "columnheader", text: d }));
  const cells = [];
  for (const week of cal.weeks) for (const key of week) {
    if (!key) { cells.push(h("div", { class: "cal-cell off", role: "gridcell", "aria-hidden": "true" })); continue; }
    const dots = calDots(cal.byDay[key]), isToday = key === today, sel = key === calSel;
    const label = `${Logic.longDate(key)}${dots.length ? ": " + dots.map(([k, c]) => ({ tasks: plural(c, "tarea", "tareas"), milestones: plural(c, "hito", "hitos"), payments: plural(c, "pago", "pagos"), focus: "concentración" }[k])).join(", ") : ""}`;
    cells.push(h("button", { type: "button", role: "gridcell", class: "cal-cell" + (isToday ? " today" : "") + (sel ? " sel" : ""), "aria-label": label, "aria-selected": String(sel), onclick: () => { calSel = key; renderCalendar(); } },
      h("span", { class: "cal-num", text: String(Number(key.slice(8))) }),
      h("span", { class: "cal-dots", "aria-hidden": "true" }, ...dots.map(([k, c]) => h("i", { class: "k-" + k, title: String(c) })))));
  }
  grid.replaceChildren(...head, ...cells);
  renderCalendarDay(cal, today);
}

function calMove(task, to) {
  if (!Logic.isDayKey(to) || to === task.due_date) return;
  patchTask(task.id, { due_date: to }).then(() => toast("Tarea movida al " + Logic.longDate(to) + "."));
}

function renderCalendarDay(cal, today) {
  const box = $("#calDay");
  const day = cal.byDay[calSel] || { tasks: [], milestones: [], payments: [], focusMs: 0 };
  const parts = [];
  if (calShow.tasks && day.tasks.length) parts.push(h("section", { class: "cal-sec" }, h("b", { text: "Tareas" }),
    h("ul", {}, ...day.tasks.map((t) => h("li", { class: Logic.isOpen(t) ? "" : "done" },
      h("input", { type: "checkbox", checked: !Logic.isOpen(t), "aria-label": "Completar " + t.title, onchange: (e) => setStatus(t.id, e.target.checked ? "done" : "todo") }),
      h("button", { type: "button", class: "cal-link", text: t.title, title: "Abrir la tarea", onclick: () => openTask(t.id) }),
      Logic.isOpen(t) ? h("input", { type: "date", class: "cal-move", value: t.due_date, "aria-label": "Mover «" + t.title + "» a otro día", onchange: (e) => calMove(t, e.target.value) }) : null)))));
  if (calShow.milestones && day.milestones.length) parts.push(h("section", { class: "cal-sec" }, h("b", { text: "Hitos" }),
    h("ul", {}, ...day.milestones.map((x) => h("li", { class: x.milestone.done ? "done" : "" },
      ico(x.milestone.done ? "check" : "target"),
      h("button", { type: "button", class: "cal-link", onclick: () => { objOpen.add(x.objective.id); objFilter = x.objective.status === "done" ? "done" : "active"; setPlanTab("objetivos"); renderPlan(); }, title: "Ver el objetivo" },
        x.milestone.title, h("small", { text: " · " + x.objective.title }))))))); 
  if (calShow.payments && day.payments.length) parts.push(h("section", { class: "cal-sec" }, h("b", { text: "Pagos" }),
    h("ul", {}, ...day.payments.map((s) => h("li", {}, ico("euro"), h("a", { class: "cal-link", href: "#/finance", text: s.name }), h("small", { text: Logic.formatEUR(Logic.centsFromDb(s.amount)) }))))));
  if (calShow.focus && day.focusMs) parts.push(h("section", { class: "cal-sec" }, h("b", { text: "Concentración" }),
    h("ul", {}, h("li", {}, ico("timer"), h("a", { class: "cal-link", href: "#/timer", text: Logic.formatDuration(day.focusMs) })))));
  box.replaceChildren(h("h3", { text: Logic.longDate(calSel).replace(/ de \d{4}$/, "") + (calSel === today ? " · hoy" : "") }),
    ...(parts.length ? parts : [h("p", { class: "muted", text: "Nada programado este día." })]));
}

$$("#planTabs button").forEach((b) => b.addEventListener("click", () => setPlanTab(b.dataset.tab)));
$("#calPrev").addEventListener("click", () => { calMonth = Logic.addMonths(calMonth, -1); calSel = calKeyOf(calMonth, 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { calMonth = Logic.addMonths(calMonth, 1); calSel = calKeyOf(calMonth, 1); renderCalendar(); });
$("#calToday").addEventListener("click", () => { calMonth = todayKey().slice(0, 7); calSel = todayKey(); renderCalendar(); });
$$("#calFilters button").forEach((b) => b.addEventListener("click", () => { calShow[b.dataset.k] = !calShow[b.dataset.k]; store.set("calShow", calShow); renderCalendar(); }));
renderers.push(renderCalendar);
setPlanTab(planTab);
