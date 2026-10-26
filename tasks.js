"use strict";
// Tareas estilo Todoist: Bandeja de entrada, Hoy, Próximas, Pendientes y Completadas; proyectos, etiquetas,
// prioridades 1-4, fechas límite, búsqueda, filtros, orden, edición, pasos y repetición.
// Una sola lista (state.tasks) alimenta esta página, el Resumen y las estadísticas.

const PRIORITIES = [["1", "P1 · Urgente"], ["2", "P2 · Alta"], ["3", "P3 · Media"], ["4", "P4 · Normal"]];
const STATUSES = [["todo", "Por hacer"], ["doing", "En curso"], ["done", "Hecha"]];
const REPEATS = [["", "No se repite"], ["daily", "Cada día"], ["weekly", "Cada semana"], ["monthly", "Cada mes"]];
const BASE_VIEWS = [["inbox", "Bandeja de entrada"], ["today", "Hoy"], ["upcoming", "Próximas"], ["pending", "Pendientes"], ["done", "Completadas"]];
const PRIO_TEXT = { 1: "Urgente", 2: "Alta", 3: "Media" };
const EMPTY_TEXT = {
  inbox: "La bandeja está vacía. Aquí caen las tareas sin proyecto.",
  today: "Nada para hoy ni vencido. Buen momento para respirar.",
  upcoming: "No hay tareas con fecha futura.",
  pending: "No tienes tareas pendientes. Escribe la primera arriba.",
  done: "Todavía no has completado ninguna tarea.",
  list: "Este proyecto no tiene tareas.",
  filtered: "Ninguna tarea coincide con la búsqueda o los filtros.",
};

const taskUI = Object.assign({ view: "pending", mode: "list", sort: "smart" }, store.get("taskUI", {}));
Object.assign(taskUI, { q: "", label: "", prio: "" }); // la búsqueda y los filtros no se recuerdan
let openTaskId = null;
let pendingNotes = null;
let notesTimer = null;

const getTask = (id) => state.tasks.find((t) => t.id === id);
const stepsOfTask = (id) => state.steps.filter((s) => s.task_id === id);
const listName = (id) => (state.lists.find((l) => l.id === id) || {}).name || "";
const saveUI = () => store.set("taskUI", { view: taskUI.view, mode: taskUI.mode, sort: taskUI.sort });
const isListView = () => taskUI.view.startsWith("list:");
const currentListId = () => (isListView() ? taskUI.view.slice(5) : "");

/* ---------- Cambios (todos pasan por mutate: pintan ya, guardan y releen) ---------- */

function createTask({ title, due_date = null, prio = 4, list_id = null, tags = [], notes = "" }) {
  title = String(title || "").trim();
  if (!title) return Promise.resolve(false);
  if (title.length > 200) {
    toast("El título es demasiado largo (máximo 200 caracteres).");
    return Promise.resolve(false);
  }
  const row = { title, prio, due_date, list_id, tags, status: "todo", done: false };
  if (notes) row.notes = notes;
  return mutate(null, () => run(db.from("tasks").insert(row)));
}

function patchTask(id, patch) {
  const t = getTask(id);
  if (!t) return Promise.resolve(false);
  return mutate(() => Object.assign(t, patch), () => run(db.from("tasks").update(patch).eq("id", id)));
}

// Marca como hecha / pendiente / en curso. Las tareas periódicas crean la siguiente al completarse.
function setStatus(id, status) {
  const t = getTask(id);
  if (!t || t.status === status) return Promise.resolve(true);
  const wasOpen = Logic.isOpen(t);
  const done = status === "done";
  const patch = { status, done, completed_at: done ? new Date().toISOString() : null };
  const next = done && wasOpen && t.recurrence ? Logic.nextOccurrence(t.due_date, t.recurrence, todayKey()) : null;
  const steps = stepsOfTask(id);
  return mutate(
    () => Object.assign(t, patch),
    async () => {
      await run(db.from("tasks").update(patch).eq("id", id));
      if (next) {
        const row = await run(
          db.from("tasks").insert({ title: t.title, notes: t.notes, list_id: t.list_id, prio: t.prio, recurrence: t.recurrence, tags: t.tags, due_date: next }).select().single()
        );
        if (steps.length) await run(db.from("task_steps").insert(steps.map((s) => ({ task_id: row.id, title: s.title }))));
        toast(`Próxima repetición: ${Logic.shortDate(next)}`);
      }
    }
  );
}

function deleteTask(id) {
  return mutate(
    () => (state.tasks = state.tasks.filter((x) => x.id !== id)),
    () => run(db.from("tasks").delete().eq("id", id))
  );
}

/* ---------- Proyectos ---------- */

function cleanProjectName(raw, exceptId) {
  const name = String(raw || "").trim();
  if (!name) return { error: "" };
  if (name.length > 60) return { error: "El nombre es demasiado largo (máximo 60 caracteres)." };
  if (state.lists.some((l) => l.id !== exceptId && l.name.toLowerCase() === name.toLowerCase())) return { error: "Ya existe un proyecto con ese nombre." };
  return { name };
}

async function addProject() {
  const name = await askText({ title: "Nuevo proyecto", placeholder: "Nombre del proyecto", confirmLabel: "Crear proyecto", maxLength: 60, validate: (v) => cleanProjectName(v).error });
  if (!name) return;
  const r = cleanProjectName(name);
  if (r.error || !r.name) return toast(r.error || "Escribe un nombre.");
  try {
    const row = await run(db.from("task_lists").insert({ name: r.name }).select().single());
    state.lists.push(row);
    taskUI.view = "list:" + row.id;
    saveUI();
    renderAll();
  } catch (_) {}
}

$("#list-rename").addEventListener("click", async () => {
  const id = currentListId();
  const cur = state.lists.find((l) => l.id === id);
  if (!cur) return;
  const name = await askText({ title: "Renombrar proyecto", placeholder: "Nombre del proyecto", value: cur.name, confirmLabel: "Guardar", maxLength: 60, validate: (v) => cleanProjectName(v, id).error });
  if (!name) return;
  const r = cleanProjectName(name, id);
  if (r.error) return toast(r.error);
  if (!r.name || r.name === cur.name) return;
  mutate(() => (cur.name = r.name), () => run(db.from("task_lists").update({ name: r.name }).eq("id", id)));
});

$("#list-delete").addEventListener("click", async () => {
  const id = currentListId();
  const cur = state.lists.find((l) => l.id === id);
  if (!cur) return;
  const n = state.tasks.filter((t) => t.list_id === id).length;
  if (!(await askConfirm({ title: `¿Borrar el proyecto «${cur.name}»?`, text: `Sus ${plural(n, "tarea", "tareas")} no se borran: pasan a la Bandeja de entrada.`, confirmLabel: "Borrar proyecto", danger: true }))) return;
  taskUI.view = "pending";
  saveUI();
  mutate(
    () => {
      state.lists = state.lists.filter((l) => l.id !== id);
      state.tasks.forEach((t) => t.list_id === id && (t.list_id = null));
    },
    () => run(db.from("task_lists").delete().eq("id", id))
  );
});

$("#task-clear-done").addEventListener("click", async () => {
  const n = state.tasks.filter((t) => !Logic.isOpen(t)).length;
  if (!n) return;
  if (!(await askConfirm({ title: `¿Eliminar ${plural(n, "tarea completada", "tareas completadas")}?`, text: "No se puede deshacer.", confirmLabel: "Eliminar", danger: true }))) return;
  mutate(
    () => (state.tasks = state.tasks.filter((t) => Logic.isOpen(t))),
    () => run(db.from("tasks").delete().eq("status", "done"))
  );
});

/* ---------- Formulario, búsqueda y filtros ---------- */

// Fecha por defecto según la vista en la que estás (Hoy / Próximas)
function defaultDue() {
  if (taskUI.view === "today") return { due: todayKey(), note: "Añadida para hoy." };
  if (taskUI.view === "upcoming") return { due: Logic.addDays(todayKey(), 1), note: "Añadida para mañana." };
  return { due: "", note: "" };
}

// Entrada rápida: un solo dato, se guarda al pulsar Enter
$("#task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#task-error");
  err.textContent = "";
  const title = $("#task-title").value.trim();
  if (!title) return (err.textContent = "Escribe el nombre de la tarea.");
  if (title.length > 200) return (err.textContent = "El título es demasiado largo (máximo 200 caracteres).");
  const { due, note } = defaultDue();
  const btn = e.submitter || $("#task-form button[type=submit]");
  btn.disabled = true;
  const ok = await createTask({ title, due_date: due || null, list_id: isListView() ? currentListId() : null });
  btn.disabled = false;
  if (!ok) return (err.textContent = "No se pudo guardar la tarea.");
  $("#task-title").value = "";
  if (note) toast(note);
  $("#task-title").focus();
});

// Con detalles: asistente paso a paso
function openTaskWizard(title = "") {
  const { due } = defaultDue();
  const tomorrow = Logic.addDays(todayKey(), 1);
  const steps = [
    { key: "title", label: "¿Cómo se llama la tarea?", type: "text", required: true, requiredMessage: "Escribe el nombre de la tarea.", maxLength: 200, summaryLabel: "Tarea" },
    { key: "notes", label: "¿Quieres añadir una descripción?", type: "textarea", hint: "Opcional.", summaryLabel: "Descripción" },
    { key: "due", label: "¿Para cuándo?", type: "date", hint: "Opcional.", summaryLabel: "Fecha",
      quick: [{ label: "Hoy", value: todayKey() }, { label: "Mañana", value: tomorrow }, { label: "En una semana", value: Logic.addDays(todayKey(), 7) }],
      validate: (v) => (Logic.isDayKey(v) ? "" : "La fecha no es válida."), format: (v) => (v ? Logic.longDate(v) : "Sin fecha") },
    { key: "prio", label: "¿Qué prioridad tiene?", type: "choice", summaryLabel: "Prioridad",
      options: [{ value: 4, label: "Normal" }, { value: 3, label: "Media" }, { value: 2, label: "Alta" }, { value: 1, label: "Urgente" }] },
    ...(state.lists.length ? [{ key: "list", label: "¿En qué proyecto?", type: "choice", summaryLabel: "Proyecto",
      options: [{ value: "", label: "Bandeja de entrada" }, ...state.lists.map((l) => ({ value: l.id, label: l.name }))] }] : []),
    { key: "tags", label: "¿Alguna etiqueta?", type: "text", hint: "Opcional. Sepáralas con comas.", maxLength: 80, summaryLabel: "Etiquetas" },
  ];
  openWizard({
    steps, earlyAfter: 0, submitLabel: "Crear tarea", doneMessage: "Tarea creada.",
    initial: { title, notes: "", due, prio: 4, list: isListView() ? currentListId() : "", tags: "" },
    onSubmit: (v) => createTask({ title: v.title.trim(), notes: (v.notes || "").trim(), due_date: v.due || null, prio: Number(v.prio) || 4, list_id: v.list || null, tags: Logic.normalizeTags(v.tags || "") }),
  });
}
$("#task-details").addEventListener("click", () => {
  const t = $("#task-title").value.trim();
  $("#task-title").value = "";
  openTaskWizard(t);
});

$("#task-search").addEventListener("input", (e) => {
  taskUI.q = e.target.value;
  renderTasks();
});
$("#task-filter-label").addEventListener("change", (e) => {
  taskUI.label = e.target.value;
  renderTasks();
});
$("#task-filter-prio").addEventListener("change", (e) => {
  taskUI.prio = e.target.value;
  renderTasks();
});
$("#task-sort").addEventListener("change", (e) => {
  taskUI.sort = e.target.value;
  saveUI();
  renderTasks();
});
$$("#task-mode button").forEach((b) =>
  b.addEventListener("click", () => {
    taskUI.mode = b.dataset.mode;
    saveUI();
    renderTasks();
  })
);

$("#task-empty-action").addEventListener("click", (e) => {
  if (e.currentTarget.dataset.mode === "clear") {
    taskUI.q = ""; taskUI.label = ""; taskUI.prio = "";
    $("#task-search").value = "";
    renderTasks();
  } else $("#task-title").focus();
});

/* ---------- Pintado ---------- */

function setView(view) {
  taskUI.view = view;
  saveUI();
  renderTasks();
}

function renderTaskStats() {
  const counts = Logic.viewCounts(state.tasks, todayKey());
  $("#tkPending").textContent = String(counts.pending);
  $("#tkToday").textContent = String(counts.today);
  $("#tkDone").textContent = String(counts.done);
  const q = quoteOfDay(todayKey(), 3);
  $("#tkQuote").textContent = "“" + q.text + "”";
  $("#tkQuoteBy").textContent = q.by ? "— " + q.by : "";
}

function renderChips() {
  const bar = $("#task-chips");
  const counts = Logic.viewCounts(state.tasks, todayKey());
  const tags = Logic.tagCounts(state.tasks);
  const chip = (view, label, n) =>
    h("button", {
      type: "button", role: "tab", class: "chip" + (taskUI.view === view ? " active" : ""),
      "aria-selected": String(taskUI.view === view), onclick: () => setView(view),
    }, label, h("span", { class: "n", text: String(n) }));
  bar.replaceChildren(
    ...BASE_VIEWS.map(([v, l]) => chip(v, l, counts[v])),
    ...state.lists.map((l) => chip("list:" + l.id, "# " + l.name, counts.lists[l.id] || 0)),
    ...Object.keys(tags).sort((a, b) => a.localeCompare(b, "es")).map((g) =>
      h("button", {
        type: "button", class: "chip tagchip" + (taskUI.label === g ? " active" : ""), "aria-pressed": String(taskUI.label === g), title: "Filtrar por la etiqueta #" + g,
        onclick: () => { taskUI.label = taskUI.label === g ? "" : g; renderTasks(); },
      }, "#" + g, h("span", { class: "n", text: String(tags[g]) }))),
    h("button", { type: "button", class: "chip add", onclick: addProject, text: "+ Proyecto" })
  );
}

function renderTaskControls() {
  const labels = [...new Set(state.tasks.flatMap((t) => t.tags || []))].sort((a, b) => a.localeCompare(b, "es"));
  if (taskUI.label && !labels.includes(taskUI.label)) taskUI.label = "";
  const fl = $("#task-filter-label");
  fl.replaceChildren(h("option", { value: "", text: "Toda etiqueta" }), ...labels.map((g) => h("option", { value: g, text: "#" + g })));
  fl.value = taskUI.label;
  $("#task-filter-prio").value = taskUI.prio;
  $("#task-sort").value = taskUI.sort;
  $$("#task-mode button").forEach((b) => b.classList.toggle("active", b.dataset.mode === taskUI.mode));
}

function taskMeta(t, { compact = false } = {}) {
  const today = todayKey();
  const bits = [];
  const open = Logic.isOpen(t);
  const di = Logic.dueInfo(t.due_date, today);
  if (di) bits.push(h("span", { class: "badge " + (open ? di.cls : ""), title: di.title || "", text: "📅 " + (open ? di.text : Logic.shortDate(t.due_date)) }));
  if (t.status === "doing") bits.push(h("span", { class: "badge doing", text: "En curso" }));
  const p = Logic.prioOf(t);
  if (p < 4) bits.push(h("span", { class: "badge p" + p, title: "Prioridad " + PRIO_TEXT[p].toLowerCase(), text: "● " + PRIO_TEXT[p] }));
  const st = stepsOfTask(t.id);
  if (st.length) bits.push(h("span", { class: "badge", title: "Pasos", text: `☑ ${st.filter((s) => s.done).length}/${st.length}` }));
  if (t.recurrence) bits.push(h("span", { class: "badge", title: "Se repite", text: "🔁" }));
  const ln = listName(t.list_id);
  if (ln && !compact && !isListView()) bits.push(h("span", { class: "badge", text: "# " + ln }));
  if (!compact) for (const tag of t.tags || []) bits.push(h("span", { class: "badge tag", text: "#" + tag }));
  if (t.notes && !compact) bits.push(h("span", { class: "badge", title: "Tiene notas", text: "📝" }));
  return h("div", { class: "meta" }, bits);
}

function taskItem(t, opts = {}) {
  const cb = h("input", {
    type: "checkbox", checked: !Logic.isOpen(t), "aria-label": `Completar «${t.title}»`,
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => setStatus(t.id, e.target.checked ? "done" : "todo"),
  });
  const body = h("div", { class: "body" }, h("div", { class: "title", text: t.title }), taskMeta(t, opts));
  const menu = h("button", {
    type: "button", class: "task-menu-btn", title: "Acciones", "aria-label": `Acciones de «${t.title}»`, "aria-haspopup": "menu",
    onclick: (e) => { e.stopPropagation(); openTaskMenu(t, e.currentTarget); },
    onkeydown: (e) => e.stopPropagation(),
  });
  menu.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-dots"/></svg>';
  return h("li", {
    class: (Logic.isOpen(t) ? "" : "done ") + "p" + Logic.prioOf(t), tabindex: "0", "aria-label": `Abrir «${t.title}»`,
    onclick: () => openTask(t.id),
    onkeydown: (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        openTask(t.id);
      }
    },
  }, cb, body, menu);
}

// Menú de acciones de una tarea (Editar abre el detalle; Duplicar y Eliminar actúan sobre la tarea real)
let taskMenuEl = null;
function closeTaskMenu() {
  if (taskMenuEl) taskMenuEl.remove();
  taskMenuEl = null;
}
// Menú flotante genérico: items = [{label, fn, danger}]
function openMenu(anchor, items, label = "Acciones") {
  closeTaskMenu();
  const menu = h("div", { class: "task-menu", role: "menu", "aria-label": label },
    ...items.map((it) => h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : "", text: it.label, onclick: () => { closeTaskMenu(); it.fn(); } })));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, hgt = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
  menu.style.top = (r.bottom + hgt + 12 > innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4) + "px";
  taskMenuEl = menu;
  menu.querySelector("button").focus();
}
function openTaskMenu(t, anchor) {
  openMenu(anchor, [
    { label: "Editar", fn: () => openTask(t.id) },
    { label: "Duplicar", fn: async () => {
      if (await createTask({ title: `${t.title} (copia)`.slice(0, 200), due_date: t.due_date, prio: t.prio, list_id: t.list_id, tags: t.tags || [], notes: t.notes || "" })) toast("Tarea duplicada.");
    } },
    { label: "Eliminar", danger: true, fn: async () => {
      if (await askConfirm({ title: `¿Borrar «${t.title}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar", danger: true })) deleteTask(t.id);
    } },
  ], "Acciones de la tarea");
}
document.addEventListener("click", (e) => { if (taskMenuEl && !e.target.closest(".task-menu")) closeTaskMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTaskMenu(); });
window.addEventListener("hashchange", closeTaskMenu);

function boardCard(t) {
  const idx = STATUSES.findIndex((s) => s[0] === t.status);
  const move = (dir, text, title) =>
    h("button", { type: "button", class: "icon-btn", title, "aria-label": `${title}: ${t.title}`, text, onclick: (e) => { e.stopPropagation(); setStatus(t.id, STATUSES[idx + dir][0]); } });
  return h("div", {
    class: "card-task" + (t.status === "done" ? " done" : ""), draggable: true,
    ondragstart: (e) => e.dataTransfer.setData("text/plain", t.id), onclick: () => openTask(t.id),
  }, h("div", { class: "title", text: t.title }), taskMeta(t), h("div", { class: "move" }, idx > 0 && move(-1, "◀", "Mover atrás"), idx < STATUSES.length - 1 && move(1, "▶", "Mover adelante")));
}

function renderBoard(items) {
  $("#task-board").replaceChildren(
    ...STATUSES.map(([key, label]) => {
      const col = items.filter((t) => t.status === key);
      const colEl = h("div", {
        class: "col",
        ondragover: (e) => { e.preventDefault(); colEl.classList.add("over"); },
        ondragleave: () => colEl.classList.remove("over"),
        ondrop: (e) => {
          e.preventDefault();
          colEl.classList.remove("over");
          const id = e.dataTransfer.getData("text/plain");
          if (id) setStatus(id, key);
        },
      }, h("div", { class: "col-head" }, h("strong", { text: label }), h("span", { class: "muted", text: String(col.length) })), col.map(boardCard));
      return colEl;
    })
  );
}

function renderList(items) {
  const doneView = taskUI.view === "done";
  const open = items.filter((t) => Logic.isOpen(t));
  const done = items.filter((t) => !Logic.isOpen(t));
  const main = doneView ? done : open;
  const rest = doneView ? [] : done;
  const today = todayKey();
  const grouped = taskUI.view === "upcoming" && (taskUI.sort === "smart" || taskUI.sort === "due");
  const nodes = [];
  if (grouped) {
    for (const g of Logic.groupByDue(main, today)) {
      nodes.push(h("li", { class: "group-head", text: g.label }));
      nodes.push(...g.items.map((t) => taskItem(t)));
    }
  } else nodes.push(...main.map((t) => taskItem(t)));
  $("#task-list").replaceChildren(...nodes);
  $("#task-done-list").replaceChildren(...rest.map((t) => taskItem(t)));
  $("#task-done-count").textContent = String(rest.length);
  show($("#task-done-wrap"), rest.length > 0);
  return main.length + rest.length;
}

function renderTasks() {
  const today = todayKey();
  if (isListView() && !state.lists.some((l) => "list:" + l.id === taskUI.view)) taskUI.view = "pending";
  renderTaskStats();
  renderChips();
  renderTaskControls();

  const items = Logic.sortTasks(
    Logic.filterTasks(state.tasks, { view: taskUI.view, q: taskUI.q, label: taskUI.label, prio: taskUI.prio }, today, listName),
    taskUI.sort,
    taskUI.view
  );
  const title = isListView() ? "# " + listName(currentListId()) : (BASE_VIEWS.find((v) => v[0] === taskUI.view) || [])[1];
  $("#task-heading").textContent = title;
  const open = items.filter((t) => Logic.isOpen(t)).length;
  $("#task-summary").textContent = `${plural(open, "pendiente", "pendientes")} · ${items.length - open} completadas`;
  show($("#list-rename"), isListView());
  show($("#list-delete"), isListView());
  show($("#task-clear-done"), taskUI.view === "done" && items.length > 0);

  const board = taskUI.mode === "board";
  $("#task-list").classList.toggle("grid", taskUI.mode === "grid");
  $("#task-done-list").classList.toggle("grid", taskUI.mode === "grid");
  show($("#task-list-wrap"), !board);
  show($("#task-board"), board);
  let shown = items.length;
  if (board) renderBoard(items);
  else shown = renderList(items);

  const filtering = !!(taskUI.q.trim() || taskUI.label || taskUI.prio);
  $("#task-empty-text").textContent = filtering ? EMPTY_TEXT.filtered : EMPTY_TEXT[isListView() ? "list" : taskUI.view] || "";
  $("#task-empty-action").textContent = filtering ? "Limpiar filtros" : "Crear una tarea";
  $("#task-empty-action").dataset.mode = filtering ? "clear" : "create";
  show($("#task-empty"), shown === 0);

  if (openTaskId) {
    if (!getTask(openTaskId)) closeTask();
    else if ($("#dlg-steps")) renderSteps();
  }
}

/* ---------- Detalle de la tarea ---------- */

function openTask(id) {
  openTaskId = id;
  renderTaskDialog();
  openDialog($("#task-dialog"));
}

function flushNotes() {
  clearTimeout(notesTimer);
  if (pendingNotes) {
    const { id, value } = pendingNotes;
    pendingNotes = null;
    patchTask(id, { notes: value });
  }
}

function closeTask() {
  flushNotes();
  openTaskId = null;
  closeDialog($("#task-dialog"));
}

$("#task-dialog").addEventListener("close", () => {
  flushNotes();
  openTaskId = null;
});
$("#task-dialog").addEventListener("click", (e) => {
  if (e.target === $("#task-dialog")) closeTask();
});

function renderSteps() {
  const box = $("#dlg-steps");
  if (!box) return;
  box.replaceChildren(
    ...stepsOfTask(openTaskId).map((s) =>
      h("li", { class: s.done ? "done" : "" },
        h("input", {
          type: "checkbox", checked: s.done, "aria-label": `Paso: ${s.title}`,
          onchange: (e) => mutate(() => (s.done = e.target.checked), () => run(db.from("task_steps").update({ done: e.target.checked }).eq("id", s.id))),
        }),
        h("div", { class: "body" }, h("div", { class: "title", text: s.title })),
        h("button", {
          type: "button", class: "icon-btn", title: "Quitar paso", "aria-label": `Quitar paso ${s.title}`, text: "✕",
          onclick: () => mutate(() => (state.steps = state.steps.filter((x) => x.id !== s.id)), () => run(db.from("task_steps").delete().eq("id", s.id))),
        })
      )
    )
  );
}

function renderTaskDialog() {
  const dlg = $("#task-dialog");
  dlg.replaceChildren();
  const t = getTask(openTaskId);
  if (!t) return;
  const id = t.id;
  const field = (label, ...control) => h("label", { class: "field" }, h("span", { class: "muted", text: label }), ...control);
  const select = (opts, value, onchange, aria) => h("select", { value, onchange, "aria-label": aria }, opts.map(([v, l]) => h("option", { value: v, text: l })));

  const titleInput = h("input", {
    class: "dlg-title", value: t.title, maxlength: 200, "aria-label": "Título de la tarea",
    onchange: (e) => {
      const v = e.target.value.trim();
      if (v) patchTask(id, { title: v });
      else e.target.value = (getTask(id) || t).title;
    },
  });
  const notes = h("textarea", {
    rows: 5, placeholder: "Notas, enlaces, ideas…", value: t.notes || "", "aria-label": "Notas",
    oninput: (e) => {
      pendingNotes = { id, value: e.target.value };
      clearTimeout(notesTimer);
      notesTimer = setTimeout(flushNotes, 700);
    },
    onchange: flushNotes,
  });
  const dueInput = h("input", {
    type: "date", value: t.due_date || "", "aria-label": "Fecha límite",
    onchange: (e) => patchTask(id, { due_date: Logic.isDayKey(e.target.value) ? e.target.value : null }),
  });
  const quickDue = (label, key) => h("button", { type: "button", class: "secondary small", text: label, onclick: () => { dueInput.value = key; patchTask(id, { due_date: key }); } });

  const stepInput = h("input", { placeholder: "Añadir paso…", maxlength: 200, "aria-label": "Nuevo paso" });
  const stepForm = h("form", {
    class: "row nowrap",
    onsubmit: async (e) => {
      e.preventDefault();
      const title = stepInput.value.trim();
      if (!title) return;
      stepInput.value = "";
      try {
        const row = await run(db.from("task_steps").insert({ task_id: id, title }).select().single());
        state.steps.push(row);
        renderSteps();
        renderAll();
      } catch (_) {}
    },
  }, stepInput, h("button", { type: "submit", class: "secondary", "aria-label": "Añadir paso", text: "+" }));

  dlg.append(
    h("div", { class: "sheet" },
      h("div", { class: "row nowrap" }, titleInput, h("button", { type: "button", class: "icon-btn", title: "Cerrar", "aria-label": "Cerrar", text: "✕", onclick: closeTask })),
      h("div", { class: "grid2" },
        field("Estado", select(STATUSES, t.status, (e) => setStatus(id, e.target.value), "Estado")),
        field("Prioridad", select(PRIORITIES, String(Logic.prioOf(t)), (e) => patchTask(id, { prio: Number(e.target.value) }), "Prioridad"))
      ),
      h("div", { class: "grid2" },
        field("Proyecto", select([["", "Bandeja de entrada"], ...state.lists.map((l) => [l.id, "# " + l.name])], t.list_id || "", (e) => patchTask(id, { list_id: e.target.value || null }), "Proyecto")),
        field("Repetir", select(REPEATS, t.recurrence || "", (e) => patchTask(id, { recurrence: e.target.value || null }), "Repetición"))
      ),
      h("div", { class: "grid2" },
        field("Fecha límite", h("div", { class: "row nowrap" }, dueInput,
          h("button", { type: "button", class: "icon-btn", title: "Quitar fecha", "aria-label": "Quitar fecha", text: "✕", onclick: () => { dueInput.value = ""; patchTask(id, { due_date: null }); } }))),
        field("Etiquetas (separadas por comas)", h("input", {
          value: (t.tags || []).join(", "), placeholder: "estudio, dam", maxlength: 200,
          onchange: (e) => {
            const tags = Logic.normalizeTags(e.target.value);
            e.target.value = tags.join(", ");
            patchTask(id, { tags });
          },
        }))
      ),
      h("div", { class: "row", style: "margin-top:8px" }, quickDue("Hoy", todayKey()), quickDue("Mañana", Logic.addDays(todayKey(), 1)), quickDue("En una semana", Logic.addDays(todayKey(), 7))),
      field("Notas", notes),
      h("h2", { text: "Pasos" }),
      h("ul", { class: "list", id: "dlg-steps" }),
      h("div", { style: "margin-top:8px" }, stepForm),
      h("div", { class: "row", style: "margin-top:18px;justify-content:space-between" },
        h("span", { class: "muted", text: "Creada el " + new Date(t.created_at).toLocaleDateString("es-ES") + (t.completed_at ? " · completada el " + new Date(t.completed_at).toLocaleDateString("es-ES") : "") }),
        h("button", {
          type: "button", class: "secondary danger", text: "Borrar tarea",
          onclick: async () => {
            if (!(await askConfirm({ title: `¿Borrar «${t.title}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar", danger: true }))) return;
            closeTask();
            deleteTask(id);
          },
        })
      )
    )
  );
  renderSteps();
}

renderers.push(renderTasks);
