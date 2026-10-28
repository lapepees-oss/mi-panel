"use strict";
// Plan · Objetivos e hitos.
// Un objetivo es un resultado que quieres conseguir, dividido en hitos manejables. Su progreso se mide por HITOS
// conseguidos, no por contar tareas. Las tareas y hábitos que enlazas son los mismos registros de siempre (aquí solo se
// guardan sus ids): al pulsarlos se abre la tarea original. Nada se crea ni se enlaza solo.

const objOpen = new Set(); // objetivos con el detalle desplegado
let objFilter = "active";

/* ---------- Diálogos ---------- */

// Formulario pequeño con varios campos. fields: [{ key, label, type: text|textarea|date, value, max, required }]
function objForm({ title, fields, confirmLabel = "Guardar" }) {
  return new Promise((resolve) => {
    const dlg = uiShell("ui-small");
    let done = false;
    const finish = (v) => { if (done) return; done = true; uiClose(dlg); resolve(v); };
    const inputs = fields.map((f) => f.type === "textarea"
      ? h("textarea", { class: "ui-input", rows: 2, maxlength: f.max || 300, "aria-label": f.label, placeholder: f.label, text: f.value || "" })
      : h("input", { class: "ui-input", type: f.type === "date" ? "date" : "text", maxlength: f.max || 120, "aria-label": f.label, placeholder: f.label, value: f.value || "" }));
    const err = h("p", { class: "ui-error", role: "alert" });
    const form = h("form", { novalidate: true, class: "obj-form",
      onsubmit: (e) => {
        e.preventDefault();
        const out = {};
        for (let i = 0; i < fields.length; i++) {
          const v = inputs[i].value.trim();
          if (fields[i].required && !v) { err.textContent = `Falta: ${fields[i].label.toLowerCase()}.`; inputs[i].focus(); return; }
          out[fields[i].key] = v;
        }
        finish(out);
      } },
      h("h2", { class: "ui-title", text: title }),
      ...fields.map((f, i) => h("label", { class: "obj-field" }, h("small", { text: f.label }), inputs[i])),
      err,
      h("div", { class: "ui-actions" },
        h("button", { type: "button", class: "ui-btn ghost", text: "Cancelar", onclick: () => finish(null) }),
        h("button", { type: "submit", class: "ui-btn primary", text: confirmLabel })));
    dlg.append(form);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener("click", (e) => e.target === dlg && finish(null));
    inputs.forEach((i) => i.addEventListener("input", () => (err.textContent = "")));
    openDialog(dlg);
    inputs[0].focus();
  });
}

// Selector con casillas (para vincular tareas u hábitos). items: [{ id, label, sub }]. Devuelve los ids marcados o null.
function objPick({ title, empty, items, selected }) {
  return new Promise((resolve) => {
    const dlg = uiShell("ui-small");
    let done = false;
    const finish = (v) => { if (done) return; done = true; uiClose(dlg); resolve(v); };
    const sel = new Set(selected);
    const rows = items.map((it) => {
      const cb = h("input", { type: "checkbox", checked: sel.has(it.id), onchange: () => (cb.checked ? sel.add(it.id) : sel.delete(it.id)) });
      return h("label", { class: "obj-pick-row" }, cb, h("span", {}, h("b", { text: it.label }), it.sub ? h("small", { text: it.sub }) : null));
    });
    dlg.append(h("div", {},
      h("h2", { class: "ui-title", text: title }),
      rows.length ? h("div", { class: "obj-pick" }, ...rows) : h("p", { class: "ui-text", text: empty }),
      h("div", { class: "ui-actions" },
        h("button", { type: "button", class: "ui-btn ghost", text: "Cancelar", onclick: () => finish(null) }),
        h("button", { type: "button", class: "ui-btn primary", text: "Guardar", onclick: () => finish([...sel]) }))));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener("click", (e) => e.target === dlg && finish(null));
    openDialog(dlg);
  });
}

/* ---------- Acciones ---------- */

const objById = (id) => state.objectives.find((o) => o.id === id);
const newMilestoneId = () => "m" + Math.random().toString(36).slice(2, 8);

async function objCreate() {
  const v = await objForm({ title: "Nuevo objetivo", confirmLabel: "Crear", fields: [
    { key: "title", label: "¿Qué quieres conseguir?", max: 120, required: true },
    { key: "why", label: "¿Para qué? (opcional)", type: "textarea", max: 300 },
    { key: "due", label: "Fecha objetivo (opcional)", type: "date" }] });
  if (!v) return;
  await createObjective({ title: v.title, why: v.why, due_date: v.due || null });
  toast("Objetivo creado. Añade hitos para medir tu avance.");
}
async function objEdit(o) {
  const cur = Logic.objectiveView(o);
  const v = await objForm({ title: "Editar objetivo", fields: [
    { key: "title", label: "¿Qué quieres conseguir?", value: cur.title, max: 120, required: true },
    { key: "why", label: "¿Para qué?", type: "textarea", value: cur.why, max: 300 },
    { key: "due", label: "Fecha objetivo", type: "date", value: cur.due || "" }] });
  if (v) await updateObjective(o.id, { title: v.title, why: v.why, due_date: v.due || null });
}
async function objDelete(o) {
  const ok = await askConfirm({ title: "¿Eliminar este objetivo?", text: "Se borra el objetivo y sus hitos. Las tareas y hábitos enlazados no se tocan.", confirmLabel: "Eliminar", danger: true });
  if (ok) { objOpen.delete(o.id); await deleteObjective(o.id); }
}
async function objAddMilestone(o) {
  const v = await objForm({ title: "Nuevo hito", confirmLabel: "Añadir", fields: [
    { key: "title", label: "¿Qué debe estar hecho?", max: 100, required: true },
    { key: "date", label: "Fecha prevista (opcional)", type: "date" }] });
  if (!v) return;
  const ms = Logic.normMilestones(o.milestones);
  await updateObjective(o.id, { milestones: [...ms, { id: newMilestoneId(), title: v.title, done: false, date: v.date || null }], status: o.status === "done" ? "active" : o.status });
}
async function objToggleMilestone(o, mid) {
  const ms = Logic.normMilestones(o.milestones).map((m) => (m.id === mid ? { ...m, done: !m.done } : m));
  const view = Logic.objectiveView({ ...o, milestones: ms });
  await updateObjective(o.id, { milestones: ms });
  if (view.complete && o.status !== "done") {
    const ok = await askConfirm({ title: "¡Todos los hitos conseguidos!", text: "¿Marcas el objetivo como conseguido? Podrás reabrirlo cuando quieras.", confirmLabel: "Marcar conseguido", cancelLabel: "Todavía no" });
    if (ok) await updateObjective(o.id, { status: "done" });
  }
}
async function objRemoveMilestone(o, mid) {
  await updateObjective(o.id, { milestones: Logic.normMilestones(o.milestones).filter((m) => m.id !== mid) });
}
async function objLinkTasks(o) {
  const v = Logic.objectiveView(o), today = todayKey();
  const items = state.tasks.filter((t) => Logic.isOpen(t) || v.taskIds.includes(t.id))
    .sort((a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")))
    .map((t) => ({ id: t.id, label: t.title, sub: t.due_date ? Logic.dueInfo(t.due_date, today).text : "" }));
  const ids = await objPick({ title: "Tareas de este objetivo", empty: "No tienes tareas pendientes para vincular.", items, selected: v.taskIds });
  if (ids) await updateObjective(o.id, { task_ids: ids });
}
async function objLinkHabits(o) {
  const v = Logic.objectiveView(o);
  const items = state.habits.map((hb) => ({ id: hb.id, label: hb.name, sub: hb.category || "" }));
  const ids = await objPick({ title: "Hábitos de este objetivo", empty: "Aún no tienes hábitos.", items, selected: v.habitIds });
  if (ids) await updateObjective(o.id, { habit_ids: ids });
}

/* ---------- Tareas del objetivo ---------- */

// Crea una tarea NUEVA y la enlaza al objetivo (y, si se indica, a un hito). Es una tarea normal, también visible en Tareas.
async function objNewTask(o, mid) {
  const v = await objForm({ title: mid ? "Nueva tarea para este hito" : "Nueva tarea para este objetivo", confirmLabel: "Crear tarea", fields: [
    { key: "title", label: "¿Qué hay que hacer?", max: 200, required: true },
    { key: "due", label: "Fecha (opcional)", type: "date" }] });
  if (!v) return;
  const before = new Set(state.tasks.map((t) => t.id));
  await createTask({ title: v.title, due_date: v.due || null });
  const t = state.tasks.filter((x) => !before.has(x.id) && x.title === v.title).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!t) return toast("Tarea creada, pero no pude enlazarla sola: vincúlala desde «Vincular».");
  const cur = objById(o.id) || o;
  const patch = { task_ids: [...Logic.objectiveView(cur).taskIds, t.id] };
  if (mid) patch.milestones = Logic.normMilestones(cur.milestones).map((m) => (m.id === mid ? { ...m, task_ids: [...m.task_ids, t.id] } : m));
  await updateObjective(o.id, patch);
  toast("Tarea creada y enlazada.");
}
// Tareas de un hito concreto (se enlazan también al objetivo)
async function objMilestoneTasks(o, m) {
  const view = Logic.objectiveView(o), today = todayKey();
  const items = state.tasks.filter((t) => Logic.isOpen(t) || m.task_ids.includes(t.id))
    .sort((a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")))
    .map((t) => ({ id: t.id, label: t.title, sub: t.due_date ? Logic.dueInfo(t.due_date, today).text : "" }));
  const ids = await objPick({ title: "Tareas del hito «" + m.title + "»", empty: "No tienes tareas pendientes para vincular.", items, selected: m.task_ids });
  if (!ids) return;
  const ms = Logic.normMilestones(o.milestones).map((x) => (x.id === m.id ? { ...x, task_ids: ids } : x));
  await updateObjective(o.id, { milestones: ms, task_ids: [...new Set([...view.taskIds, ...ids])] });
}
async function objUnlinkTask(o, tid) {
  const ms = Logic.normMilestones(o.milestones).map((m) => ({ ...m, task_ids: m.task_ids.filter((x) => x !== tid) }));
  await updateObjective(o.id, { task_ids: Logic.objectiveView(o).taskIds.filter((x) => x !== tid), milestones: ms });
}

/* ---------- Pintado ---------- */

const objColor = (id) => `hsl(${Logic.objectiveHue(id)} 70% 68%)`;

function objDueChip(v, today) {
  if (!v.due) return null;
  const n = Logic.dayDiff(v.due, today);
  const text = v.status === "done" ? Logic.shortDate(v.due) : n < 0 ? `Pasó el ${Logic.shortDate(v.due)}` : n === 0 ? "Hoy" : n === 1 ? "Mañana" : n <= 60 ? `En ${n} días` : Logic.shortDate(v.due);
  return h("span", { class: "obj-chip" + (n < 0 && v.status !== "done" ? " late" : ""), title: Logic.longDate(v.due) }, ico("calendar"), " " + text);
}

// Constelación: cada hito es una estrella unida a la siguiente; las conseguidas se iluminan y llevan su fecha debajo
function objStars(v, labels) {
  if (!v.total) return h("p", { class: "obj-nostars", text: "Aún sin hitos: divide el objetivo en pasos manejables." });
  return h("ol", { class: "obj-stars" + (labels ? " labeled" : ""), "aria-label": `${v.done} de ${plural(v.total, "hito", "hitos")} conseguidos` },
    ...v.milestones.map((m) => h("li", { class: (m.done ? "done" : "") + (v.next && v.next.id === m.id ? " next" : ""), title: m.title + (m.date ? " · " + Logic.shortDate(m.date) : "") },
      h("i", { "aria-hidden": "true" }), labels ? h("span", { class: "obj-star-l", text: m.date ? Logic.shortDate(m.date) : "" }) : null)));
}

const objRing = (pct) => h("span", { class: "obj-ring-pct", style: `--p:${pct}`, role: "img", "aria-label": pct + " % completado" }, h("b", { text: pct + "%" }));

// Una tarea enlazada: casilla para completarla, título que abre la original, fecha y prioridad
function objTaskRow(o, t, today, hitoTitle) {
  const open = Logic.isOpen(t), di = t.due_date ? Logic.dueInfo(t.due_date, today) : null, list = listName(t.list_id);
  return h("li", { class: "obj-task" + (open ? "" : " done") },
    h("input", { type: "checkbox", checked: !open, "aria-label": "Completar " + t.title, onchange: (e) => setStatus(t.id, e.target.checked ? "done" : "todo") }),
    h("div", { class: "obj-task-main" },
      h("button", { type: "button", class: "obj-link", onclick: () => openTask(t.id), title: "Abrir la tarea" }, t.title),
      h("span", { class: "obj-task-meta" },
        open && di ? h("span", { class: "badge " + di.cls, text: di.text }) : null,
        open && Logic.prioOf(t) <= 2 ? h("span", { class: "badge p" + Logic.prioOf(t), text: Logic.prioOf(t) === 1 ? "Urgente" : "Alta" }) : null,
        list ? h("small", { text: list }) : null, hitoTitle ? h("small", { class: "obj-task-hito" }, ico("target"), " " + hitoTitle) : null)),
    h("button", { type: "button", class: "obj-x", title: "Quitar del objetivo", "aria-label": "Quitar «" + t.title + "» del objetivo", onclick: () => objUnlinkTask(o, t.id) }, ico("x")));
}

function objDetail(o, v, today) {
  const TT = Logic.objectiveTasks(o, state.tasks, today), links = Logic.objectiveLinks(o, state.tasks, state.habits);
  const hitoOf = new Map(); v.milestones.forEach((m) => m.task_ids.forEach((id) => hitoOf.set(id, m.title)));
  const ms = v.milestones.map((m) => {
    const mt = Logic.milestoneTasks(m, state.tasks);
    return h("li", { class: "obj-ms" + (m.done ? " done" : "") },
      h("div", { class: "obj-ms-row" },
        h("label", {}, h("input", { type: "checkbox", checked: m.done, onchange: () => objToggleMilestone(o, m.id) }), h("span", { text: m.title })),
        m.date ? h("small", { class: "obj-ms-date" + (!m.done && m.date < today ? " late" : ""), text: Logic.shortDate(m.date) }) : null,
        h("button", { type: "button", class: "link-button obj-ms-tasks", onclick: () => objMilestoneTasks(o, m), title: "Tareas de este hito" }, mt.total ? `${mt.done}/${mt.total} tareas` : "Tareas"),
        h("button", { type: "button", class: "obj-x", title: "Quitar hito", "aria-label": "Quitar hito " + m.title, onclick: () => objRemoveMilestone(o, m.id) }, ico("x"))),
      mt.suggestDone ? h("p", { class: "obj-suggest" }, ico("spark"), h("span", { text: "Todas las tareas de este hito están hechas." }), h("button", { type: "button", class: "link-button", text: "Marcar como conseguido", onclick: () => objToggleMilestone(o, m.id) })) : null);
  });
  const groups = [["overdue", "Vencidas", "late"], ["today", "Para hoy", ""], ["upcoming", "Próximas", ""], ["nodate", "Sin fecha", ""], ["done", "Hechas", "ok"]];
  const taskSec = TT.total
    ? groups.filter(([k]) => TT.groups[k].length).map(([k, label, cls]) => h("div", { class: "obj-tgroup " + cls }, h("small", { class: "obj-tgroup-h", text: `${label} · ${TT.groups[k].length}` }), h("ul", { class: "obj-list" }, ...TT.groups[k].map((t) => objTaskRow(o, t, today, hitoOf.get(t.id))))))
    : [h("p", { class: "muted small", text: "Ninguna todavía. Crea una tarea nueva para este objetivo o enlaza las que ya tengas: siguen siendo las mismas." })];
  const byHabit = habitDays();
  const habits = links.habits.map((hb) => {
    const set = byHabit.get(hb.id) || new Set(), freq = Logic.habitFrequency(hb), st = Logic.habitStatusToday(freq, set, today), streak = Logic.habitStreak(freq, set, today);
    return h("a", { class: "obj-habit" + (st === "done" ? " done" : ""), href: "#/habits", title: st === "done" ? "Hecho hoy" : "Pendiente hoy" }, ico(st === "done" ? "check" : "habit"), " " + hb.name, streak > 1 ? h("small", { text: ` · racha ${streak}` }) : null);
  });
  return h("div", { class: "obj-detail" },
    h("div", { class: "obj-sec" }, h("div", { class: "obj-sec-h" }, h("b", { text: "Hitos" }), h("button", { type: "button", class: "link-button", text: "+ Añadir hito", onclick: () => objAddMilestone(o) })),
      ms.length ? h("ul", { class: "obj-list" }, ...ms) : h("p", { class: "muted small", text: "Un hito es un resultado concreto, por ejemplo «Entregar el primer borrador»." })),
    h("div", { class: "obj-sec" },
      h("div", { class: "obj-sec-h" }, h("b", { text: "Tareas del objetivo" + (TT.total ? ` · ${TT.done}/${TT.total}` : "") }),
        h("span", { class: "obj-sec-btns" }, h("button", { type: "button", class: "link-button", text: "+ Nueva", onclick: () => objNewTask(o) }), h("button", { type: "button", class: "link-button", text: "Vincular", onclick: () => objLinkTasks(o) }))),
      TT.total ? h("span", { class: "obj-bar wide", "aria-hidden": "true" }, h("i", { style: `width:${TT.pct}%` })) : null,
      ...taskSec),
    h("div", { class: "obj-sec" }, h("div", { class: "obj-sec-h" }, h("b", { text: "Hábitos" }), h("button", { type: "button", class: "link-button", text: "Vincular", onclick: () => objLinkHabits(o) })),
      habits.length ? h("div", { class: "obj-habits" }, ...habits) : h("p", { class: "muted small", text: "Ninguno. Un hábito de práctica ayuda a avanzar sin depender de la motivación." })),
    h("div", { class: "obj-actions" },
      h("button", { type: "button", class: "secondary small", text: "Editar", onclick: () => objEdit(o) }),
      v.status === "done" ? h("button", { type: "button", class: "secondary small", text: "Reabrir", onclick: () => updateObjective(o.id, { status: "active" }) })
        : h("button", { type: "button", class: "secondary small", text: v.status === "paused" ? "Reanudar" : "Pausar", onclick: () => updateObjective(o.id, { status: v.status === "paused" ? "active" : "paused" }) }),
      v.status !== "done" ? h("button", { type: "button", class: "secondary small", text: "Marcar conseguido", onclick: () => updateObjective(o.id, { status: "done" }) }) : null,
      h("button", { type: "button", class: "link-button danger", text: "Eliminar", onclick: () => objDelete(o) })));
}

function objCard(o, today) {
  const v = Logic.objectiveView(o), open = objOpen.has(o.id), TT = Logic.objectiveTasks(o, state.tasks, today);
  const nextT = v.status === "active" ? TT.next : null;
  return h("article", { class: "obj-card " + v.status + (v.complete ? " complete" : ""), style: `--oc:${objColor(o.id)}` },
    h("button", { type: "button", class: "obj-head", "aria-expanded": String(open), onclick: () => { open ? objOpen.delete(o.id) : objOpen.add(o.id); renderPlan(); } },
      objRing(v.pct),
      h("span", { class: "obj-head-main" },
        h("span", { class: "obj-title", text: v.title || "Sin título" }),
        v.why ? h("span", { class: "obj-why", text: v.why }) : null),
      h("span", { class: "obj-meta" }, objDueChip(v, today), v.status === "paused" ? h("span", { class: "obj-chip" }, ico("pause"), " En pausa") : null, v.status === "done" ? h("span", { class: "obj-chip ok" }, ico("check"), " Conseguido") : null, h("span", { class: "obj-caret" + (open ? " open" : "") }, ico("chev")))),
    objStars(v, true),
    h("div", { class: "obj-facts" },
      v.total ? h("span", { class: "obj-fact" }, ico("target"), h("b", { text: `${v.done}/${v.total}` }), " hitos") : null,
      TT.total ? h("span", { class: "obj-fact" + (TT.groups.overdue.length ? " late" : "") }, ico("task"), h("b", { text: `${TT.done}/${TT.total}` }), " tareas", TT.groups.overdue.length ? ` · ${plural(TT.groups.overdue.length, "vencida", "vencidas")}` : "") : null,
      v.habitIds.length ? h("span", { class: "obj-fact" }, ico("habit"), h("b", { text: String(v.habitIds.length) }), v.habitIds.length === 1 ? " hábito" : " hábitos") : null,
      v.total && v.status === "active" && v.next ? h("span", { class: "obj-fact grow" }, "Siguiente hito: ", h("b", { text: v.next.title }), v.next.date ? ` · ${Logic.shortDate(v.next.date)}` : "") : null),
    nextT ? h("div", { class: "obj-nextstep" },
      h("span", { class: "obj-nextstep-l" }, h("small", { text: "Siguiente paso" }), h("button", { type: "button", class: "obj-link", text: nextT.title, onclick: () => openTask(nextT.id) })),
      h("button", { type: "button", class: "secondary small", title: "Completar esta tarea", onclick: () => setStatus(nextT.id, "done") }, ico("check"), " Hecha")) : null,
    open ? objDetail(o, v, today) : null);
}

// Cabecera con cifras clave: de un vistazo cuánto llevas y qué viene
function objSummary(all, today) {
  const act = all.filter((x) => x.v.status === "active");
  const hitos = act.reduce((n, x) => n + x.v.total, 0), hechos = act.reduce((n, x) => n + x.v.done, 0);
  let overdue = 0, open = 0, nextMs = null;
  for (const x of act) {
    const T = Logic.objectiveTasks(x.o, state.tasks, today);
    overdue += T.groups.overdue.length; open += T.open;
    if (x.v.next && x.v.next.date && (!nextMs || x.v.next.date < nextMs.date)) nextMs = { date: x.v.next.date, title: x.v.next.title };
  }
  const stat = (icon, cls, val, label, pct) => h("div", { class: "pl-stat" }, h("span", { class: "pl-ico " + cls }, ico(icon)), h("div", {}, h("strong", { text: val }), h("small", { text: label })), pct != null ? h("span", { class: "sx-bar", "aria-hidden": "true" }, h("i", { style: `width:${pct}%` })) : null);
  return h("div", { class: "pl-stats", role: "group", "aria-label": "Resumen de tus objetivos" },
    stat("target", "", String(act.length), act.length === 1 ? "objetivo activo" : "objetivos activos", null),
    stat("check", "mint", hitos ? `${hechos}/${hitos}` : "—", "hitos conseguidos", hitos ? (hechos / hitos) * 100 : 0),
    stat("task", overdue ? "rose" : "", String(open), overdue ? `tareas pendientes · ${overdue} vencida${overdue === 1 ? "" : "s"}` : "tareas pendientes", null),
    stat("calendar", "peach", nextMs ? Logic.shortDate(nextMs.date) : "—", nextMs ? "próximo hito" : "sin hitos con fecha", null));
}

function renderPlan() {
  const box = $("#objList");
  if (!box) return;
  const today = todayKey(), all = state.objectives.map((o) => ({ o, v: Logic.objectiveView(o) }));
  const count = (s) => all.filter((x) => x.v.status === s).length;
  $$("#objFilter button").forEach((b) => {
    b.classList.toggle("active", b.dataset.f === objFilter); b.setAttribute("aria-pressed", String(b.dataset.f === objFilter));
    const n = count(b.dataset.f); b.querySelector("em").textContent = n ? ` ${n}` : "";
  });
  const sum = $("#objSummary");
  if (dataLoading()) { sum.replaceChildren(); return box.replaceChildren(h("div", { class: "w-state loading" }, h("i", { class: "w-skel" }), h("i", { class: "w-skel short" }))); }
  if (!state.objectivesReady) { sum.replaceChildren(); return box.replaceChildren(h("p", { class: "empty-state", text: "Falta la tabla de objetivos: ejecuta migracion-v10.sql en Supabase y recarga." })); }
  sum.replaceChildren(...(all.length ? [objSummary(all, today)] : []));
  const list = all.filter((x) => x.v.status === objFilter).map((x) => objCard(x.o, today));
  box.replaceChildren(...(list.length ? list : [h("div", { class: "obj-empty" },
    h("span", { class: "sch-ico", "aria-hidden": "true" }, ico(objFilter === "done" ? "spark" : "target")),
    h("strong", { text: objFilter === "active" ? (all.length ? "No tienes objetivos activos" : "Aún no tienes objetivos") : objFilter === "paused" ? "Nada en pausa" : "Todavía no has conseguido ninguno" }),
    objFilter === "active" ? h("p", { class: "muted small", text: "Un objetivo es un resultado que quieres conseguir. Lo divides en hitos y enlazas las tareas y hábitos que te acercan." }) : null,
    objFilter === "active" ? h("button", { type: "button", class: "secondary small", text: "+ Nuevo objetivo", onclick: objCreate }) : null)]));
}

$("#objNew").addEventListener("click", objCreate);
$$("#objFilter button").forEach((b) => b.addEventListener("click", () => { objFilter = b.dataset.f; renderPlan(); }));
renderers.push(renderPlan);

// Bloque del Resumen: solo lectura; al pulsar un objetivo se abre en su sección con el detalle desplegado
function renderWObjectives(body) {
  if (!state.objectivesReady) return body.replaceChildren(wState("empty", "Falta la tabla de objetivos (migracion-v10.sql).", null));
  const list = state.objectives.map((o) => Logic.objectiveView(o)).filter((v) => v.status === "active").slice(0, 3);
  if (!list.length) return body.replaceChildren(wState("empty", "Aún no tienes objetivos activos.", ["Crear un objetivo", "#/plan"]));
  body.replaceChildren(h("ul", { class: "wo-list" }, ...list.map((v) => h("li", {},
    h("button", { type: "button", class: "wo-item", onclick: () => { objOpen.add(v.id); objFilter = "active"; location.hash = "#/plan"; } },
      h("span", { class: "wo-top" }, h("b", { text: v.title }), h("small", { text: v.total ? `${v.done}/${v.total}` : "sin hitos" })),
      objStars(v),
      v.next ? h("small", { class: "wo-next", text: "Siguiente: " + v.next.title }) : null)))));
}
WIDGET_RENDERERS.objectives = (b) => renderWObjectives(b);
