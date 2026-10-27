"use strict";
// Bloques nuevos del Resumen. Cada uno lee de `state` (la misma fuente de verdad que el resto de la app) y NUNCA
// inventa datos: sin datos muestra un estado vacío, mientras carga un esqueleto y si falla un error con «Reintentar».
// Se pintan solo si están visibles. Estilos compartidos: .w-* en pages.css.

const dataLoading = () => !lastFullLoad && !loadFailed;

// Estados comunes: carga / vacío / error. `link` = [texto, #ruta] opcional.
function wState(kind, text, link) {
  if (kind === "loading") return h("div", { class: "w-state loading", role: "status", "aria-label": "Cargando" }, h("i", { class: "w-skel" }), h("i", { class: "w-skel short" }), h("i", { class: "w-skel" }));
  if (kind === "error") return h("div", { class: "w-state error", role: "alert" }, h("p", { text: text || "No se pudieron cargar los datos." }), h("button", { type: "button", class: "secondary small", text: "Reintentar", onclick: () => loadAll() }));
  return h("div", { class: "w-state empty" }, h("p", { text }), link ? h("a", { class: "link-button", href: link[1], text: link[0] }) : null);
}

const wBar = (pct, over) => h("div", { class: "w-bar" + (over ? " over" : ""), role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)) }, h("span", { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
const wStat = (label, value, foot) => h("div", { class: "w-stat" }, h("small", { text: label }), h("strong", { text: value }), foot ? h("em", { text: foot }) : null);

/* ---------- Próxima acción ---------- */
// Orden: vencidas → de hoy → con fecha → sin fecha; dentro de cada grupo, prioridad y fecha. Solo es una propuesta de orden.
function nextTask(tasks, today) {
  const open = tasks.filter((t) => Logic.isOpen(t));
  const grp = (t) => (!t.due_date ? 3 : t.due_date < today ? 0 : t.due_date === today ? 1 : 2);
  return open.sort((a, b) => grp(a) - grp(b) || Logic.prioOf(a) - Logic.prioOf(b) || String(a.due_date || "9").localeCompare(String(b.due_date || "9")))[0] || null;
}
function renderWNext(body, today) {
  const t = nextTask(state.tasks, today);
  if (!t) return body.replaceChildren(wState("empty", "No tienes tareas pendientes. Buen momento para respirar.", ["Crear una tarea", "#/tasks"]));
  const di = Logic.dueInfo(t.due_date, today);
  const why = !t.due_date ? "Sin fecha, pero es la de mayor prioridad." : t.due_date < today ? "Está vencida: puedes hacerla, aplazarla o cerrarla." : t.due_date === today ? "Es para hoy." : "Es la siguiente con fecha.";
  body.replaceChildren(h("div", { class: "w-next" },
    h("strong", { class: "w-next-title", text: t.title }),
    h("div", { class: "w-chips" }, di ? h("span", { class: "badge " + di.cls, text: di.text }) : null, h("span", { class: "badge p" + Logic.prioOf(t), text: (PRIORITIES.find((p) => p[0] === String(Logic.prioOf(t))) || [, "P4 · Normal"])[1] })),
    h("p", { class: "muted", text: why }),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary-btn small", text: "Completar", onclick: () => setStatus(t.id, "done") }), h("button", { type: "button", class: "secondary small", text: "Abrir", onclick: () => openTask(t.id) }))));
}

/* ---------- Presupuesto por categorías ---------- */
function renderWBudget(body, today) {
  const mk = Logic.monthKey(today), totals = Logic.monthTotals(state.transactions, mk), bs = Logic.budgetStatus(state.budgets, totals);
  if (!bs.categories.length) return body.replaceChildren(wState("empty", "Aún no has puesto límites por categoría.", ["Definir presupuestos", "#/finance"]));
  const moves = {};
  for (const t of state.transactions) if (t.type === "expense" && Logic.monthKey(t.tx_date) === mk) moves[t.category] = (moves[t.category] || 0) + 1;
  body.replaceChildren(h("ul", { class: "w-list" }, ...bs.categories.slice(0, 6).map((c) => h("li", {},
    h("div", { class: "w-row" }, h("span", { text: c.category }), h("b", { class: c.over ? "neg" : "", text: `${Logic.formatEUR(c.spent)} / ${Logic.formatEUR(c.limit)}` })),
    wBar(c.pct, c.over), h("small", { class: "muted", text: plural(moves[c.category] || 0, "movimiento", "movimientos") + (c.over ? " · límite superado" : ` · quedan ${Logic.formatEUR(c.left)}`) })))));
}

/* ---------- Objetivo activo e hitos / Objetivo de ahorro ---------- */
function chosenGoal(layout, id) {
  const want = layout.cfg[id] && layout.cfg[id].goal;
  return state.goals.find((g) => g.id === want) || state.goals[0] || null;
}
function renderWGoal(body, layout) {
  const g = chosenGoal(layout, "goal");
  if (!g) return body.replaceChildren(wState("empty", "Crea un objetivo de ahorro para seguir su progreso por hitos.", ["Ir a Finanzas", "#/finance"]));
  const target = Logic.centsFromDb(g.target), cur = Logic.centsFromDb(g.current), m = Logic.savingMilestones(target, cur);
  body.replaceChildren(h("div", { class: "w-goal" },
    h("strong", { text: g.name }), wBar(m.pct), 
    h("ol", { class: "w-miles", "aria-label": "Hitos del objetivo" }, ...m.marks.map((k) => h("li", { class: k.reached ? "done" : "" }, h("i", { "aria-hidden": "true" }), h("span", { text: k.pct + " %" })))),
    h("p", { class: "muted", text: m.next ? `Próximo hito: ${Logic.formatEUR(Math.round(m.next.amount))} (${m.next.pct} %). Hitos cada 25 % de la meta.` : "¡Meta conseguida!" })));
}
function renderWSaving(body, layout) {
  const g = chosenGoal(layout, "saving");
  if (!g) return body.replaceChildren(wState("empty", "No hay ninguna meta de ahorro todavía.", ["Crear una meta", "#/finance"]));
  const target = Logic.centsFromDb(g.target), cur = Logic.centsFromDb(g.current), pct = target ? Math.min(100, Math.floor((cur / target) * 100)) : 0;
  body.replaceChildren(h("div", { class: "w-saving" }, h("strong", { text: g.name }), wBar(pct),
    h("div", { class: "w-stats" }, wStat("Llevas", Logic.formatEUR(cur), pct + " %"), wStat("Meta", Logic.formatEUR(target)), wStat("Falta", Logic.formatEUR(Math.max(0, target - cur))))));
}

/* ---------- Tiempo de concentración ---------- */
function renderWFocus(body, today) {
  const wk = Logic.weekKeys(Logic.weekStart(today));
  const rows = Logic.dayActivity([], new Map(), [], state.sessions, wk);
  const week = rows.reduce((n, r) => n + r.ms, 0), tod = (rows.find((r) => r.key === today) || { ms: 0 }).ms;
  const count = state.sessions.filter((s) => wk.includes(Logic.dayOfTimestamp(s.created_at))).length;
  if (!count) return body.replaceChildren(wState("empty", "Aún no hay sesiones esta semana.", ["Abrir el cronómetro", "#/timer"]));
  body.replaceChildren(h("div", { class: "w-stats" }, wStat("Hoy", tod ? Logic.formatDuration(tod) : "—"), wStat("Esta semana", Logic.formatDuration(week), plural(count, "sesión", "sesiones"))),
    h("a", { class: "link-button", href: "#/timer", text: "Abrir el cronómetro ↗" }));
}

/* ---------- Notas rápidas y calendario ---------- */
function renderWNotes(body, today) {
  const notes = state.journal.filter((j) => (j.body || "").trim()).sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1)).slice(0, 3);
  const ideas = state.ideas.slice(0, 2);
  const soon = state.tasks.filter((t) => Logic.isOpen(t) && t.due_date && t.due_date >= today && t.due_date <= Logic.addDays(today, 7)).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4);
  if (!notes.length && !ideas.length && !soon.length) return body.replaceChildren(wState("empty", "Sin notas ni vencimientos próximos.", ["Escribir una nota", "#/journal"]));
  const clip = (s) => { s = s.replace(/\s+/g, " ").trim(); return s.length > 80 ? s.slice(0, 79) + "…" : s; };
  body.replaceChildren(
    notes.length || ideas.length ? h("div", { class: "w-sec" }, h("small", { class: "w-h", text: "Notas e ideas recientes" }), h("ul", { class: "w-list tight" },
      ...notes.map((n) => h("li", {}, h("a", { href: "#/journal" }, h("b", { text: Logic.shortDate(n.entry_date) }), " " + clip(n.body)))),
      ...ideas.map((i) => h("li", {}, h("a", { href: "#/journal" }, h("b", { text: "💡" }), " " + clip(i.title || i.body || "Idea")))))) : null,
    soon.length ? h("div", { class: "w-sec" }, h("small", { class: "w-h", text: "Próximos 7 días" }), h("ul", { class: "w-list tight" },
      ...soon.map((t) => h("li", {}, h("button", { type: "button", class: "w-link", onclick: () => openTask(t.id) }, h("b", { text: Logic.dueInfo(t.due_date, today).text }), " " + t.title))))) : null);
}

/* ---------- Próximos pagos ---------- */
function renderWPayments(body, today) {
  if (!state.subsReady) return body.replaceChildren(wState("empty", "Falta la tabla de suscripciones: ejecuta migracion-v6.sql.", null));
  const list = state.subs.filter((s) => Logic.subStatus(s) === "active").map((s) => ({ s, nc: Logic.nextCharge(s, today) })).filter((x) => x.nc).sort((a, b) => a.nc.localeCompare(b.nc)).slice(0, 5);
  if (!list.length) return body.replaceChildren(wState("empty", "No hay suscripciones activas con fecha de cobro.", ["Añadir una suscripción", "#/finance"]));
  body.replaceChildren(h("ul", { class: "w-list" }, ...list.map(({ s, nc }) => {
    const d = Logic.dayDiff(nc, today);
    return h("li", {}, h("div", { class: "w-row" }, h("span", { text: s.name }), h("b", { text: Logic.formatEUR(Logic.centsFromDb(s.amount)) })),
      h("small", { class: "muted", text: (d <= 0 ? "Hoy" : d === 1 ? "Mañana" : `En ${d} días`) + " · " + Logic.shortDate(nc) }));
  })));
}

/* ---------- Estadísticas personales ---------- */
function renderWStats(body, today, layout) {
  const n = (layout.cfg.stats && layout.cfg.stats.period) || 7;
  const keys = Array.from({ length: n }, (_, i) => Logic.addDays(today, i - (n - 1)));
  const t = Logic.periodTotals(Logic.dayActivity(state.habits, habitDays(), state.tasks, state.sessions, keys));
  if (!t.habits && !t.tasks && !t.ms && !state.habits.length) return body.replaceChildren(wState("empty", `Sin actividad registrada en los últimos ${n} días.`, null));
  body.replaceChildren(h("p", { class: "muted w-period", text: `Últimos ${n} días` }),
    h("div", { class: "w-stats" }, wStat("Hábitos marcados", String(t.habits), t.pct == null ? "Sin hábitos programados" : `${t.pct} % de los programados`), wStat("Tareas completadas", String(t.tasks)), wStat("Concentración", t.ms ? Logic.formatDuration(t.ms) : "—")));
}

/* ---------- Sugerencia contextual (solo cuenta real con Intelligence activa) ---------- */
function renderWSuggestion(body) {
  if (typeof intelActive === "function" && !intelActive()) return body.replaceChildren(wState("empty", "CloudSpace Intelligence no está activa.", ["Ver ajustes", "#/prefs"]));
  const dis = dismissals(), card = intelAnalysis().cards.find((c) => !dis[c.id]);
  if (!card) return body.replaceChildren(wState("empty", "Nada que destacar ahora mismo.", null));
  body.replaceChildren(h("div", { class: "w-sug" },
    h("div", { class: "w-chips" }, h("span", { class: "it-kind " + KIND_CLASS[card.kind], text: Intel.KIND_LABEL[card.kind] })),
    h("strong", { text: card.title }), h("p", { class: "muted", text: card.recommendation }),
    h("div", { class: "row" }, h("a", { class: "secondary small btn-link", href: "#/intelligence", text: "Ver detalle" }), h("button", { type: "button", class: "link-button", text: "Descartar", onclick: () => dismissCard(card.id) }))));
}

const WIDGET_RENDERERS = {
  next: (b, t) => renderWNext(b, t), budget: (b, t) => renderWBudget(b, t), goal: (b, t, l) => renderWGoal(b, l), saving: (b, t, l) => renderWSaving(b, l),
  focus: (b, t) => renderWFocus(b, t), notes: (b, t) => renderWNotes(b, t), payments: (b, t) => renderWPayments(b, t), stats: (b, t, l) => renderWStats(b, t, l), suggestion: (b) => renderWSuggestion(b),
};

// Pinta los bloques nuevos que están visibles (los ocultos no gastan nada). Son de solo lectura, así que se rehacen enteros.
function renderNewWidgets(layout, today) {
  for (const id of Object.keys(WIDGET_RENDERERS)) {
    const el = $(`#dbBoard > .db-widget[data-widget="${id}"]`);
    if (!el || layout.hidden.includes(id)) continue;
    const body = $(".wbody", el);
    if (dataLoading()) body.replaceChildren(wState("loading"));
    else if (loadFailed && !lastFullLoad) body.replaceChildren(wState("error"));
    else { try { WIDGET_RENDERERS[id](body, today, layout); } catch (e) { console.error(e); body.replaceChildren(wState("error", "No se pudo mostrar este bloque.")); } }
  }
}
