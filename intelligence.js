"use strict";
// CloudSpace Intelligence (interfaz). El análisis lo hace intel.js con reglas, en este navegador.
// No hay ninguna llamada a IA ni a APIs externas: Claude Pro solo interviene si TÚ copias el informe y lo pegas allí.
// Nada se crea o modifica sin confirmación explícita.

const CLAUDE_URL = "https://claude.ai/new"; // dirección oficial; no se usa ningún endpoint privado
const CAT_FILTERS = [["all", "Todas"], ["tareas", "Tareas"], ["habitos", "Hábitos"], ["finanzas", "Finanzas"], ["objetivos", "Objetivos"]];
let itFilter = "all";
let showDismissed = false;
const cloud = { open: false, expanded: new Set() }; // un único botón alterna abrir/cerrar; el estado (tarjetas desplegadas, scroll) se conserva
try { Object.assign(cloud, JSON.parse(sessionStorage.getItem("itCloud") || "{}"), { expanded: new Set() }); } catch (_) {}
const saveCloud = () => { try { sessionStorage.setItem("itCloud", JSON.stringify({ open: cloud.open })); } catch (_) {} };

const intelData = () => ({ today: todayKey(), habits: state.habits, byHabit: habitDays(), tasks: state.tasks, lists: state.lists, goals: state.goals, transactions: state.transactions, budgets: state.budgets, sessions: state.sessions });
const intelAnalysis = () => Intel.analyze(intelData());
const rulesOnly = () => state.intel.mode === "rules";

/* ---------- Descartes (comodidad por dispositivo) ---------- */
const dismissals = () => { const m = store.get("intelDismissed", {}); const t = todayKey(); return Object.fromEntries(Object.entries(m).filter(([, until]) => until >= t)); };
function dismissCard(id, days = 14) { const m = dismissals(); m[id] = Logic.addDays(todayKey(), days); store.set("intelDismissed", m); renderIntelligence(); }

/* ---------- Tarjetas ---------- */
const KIND_CLASS = { confirmed: "k-confirmed", pattern: "k-pattern", estimate: "k-estimate" };

function applyCard(c, edit) {
  const a = c.action;
  if (!a) return;
  const done = () => { toast("Tarea creada."); dismissCard(c.id, 14); };
  if (!edit) {
    askConfirm({ title: "¿Crear esta tarea?", text: `«${a.title}»${a.due_date ? " · " + Logic.longDate(a.due_date) : ""}. Es solo una propuesta: se crea únicamente si confirmas.`, confirmLabel: "Crear tarea" })
      .then(async (ok) => { if (ok && (await createTask({ title: a.title, due_date: a.due_date, prio: a.prio, notes: a.notes }))) done(); });
    return;
  }
  openWizard({
    steps: [
      { key: "title", label: "Título de la tarea", type: "text", required: true, requiredMessage: "Escribe un título.", maxLength: 200, summaryLabel: "Tarea" },
      { key: "due", label: "¿Para cuándo?", type: "date", hint: "Opcional.", summaryLabel: "Fecha", validate: (v) => (!v || Logic.isDayKey(v) ? "" : "Elige una fecha válida."), format: (v) => (Logic.isDayKey(v) ? Logic.longDate(v) : "Sin fecha") },
    ],
    initial: { title: a.title, due: a.due_date || "" }, earlyAfter: 0, submitLabel: "Crear tarea", doneMessage: "Tarea creada.",
    onSubmit: async (v) => { const ok = await createTask({ title: v.title.trim(), due_date: v.due || null, prio: a.prio, notes: a.notes }); if (ok) dismissCard(c.id, 14); return !!ok; },
  });
}

function cardEl(c) {
  const btn = (label, fn, cls = "secondary small") => h("button", { type: "button", class: cls, onclick: fn }, label);
  return h("article", { class: "it-card sev" + c.severity, "data-id": c.id },
    h("div", { class: "it-card-top" },
      h("span", { class: "badge", text: Intel.CATEGORY_LABEL[c.category] || "Otros" }),
      h("span", { class: "it-kind " + KIND_CLASS[c.kind], title: "Nivel de certeza de esta observación", text: Intel.KIND_LABEL[c.kind] })),
    h("h3", { text: c.title }),
    h("p", { class: "it-problem", text: c.problem }),
    h("div", { class: "it-block" }, h("small", { text: "Datos que lo justifican" }), h("ul", {}, ...c.evidence.map((e) => h("li", { text: e })))),
    h("div", { class: "it-block" }, h("small", { text: "Recomendación" }), h("p", { text: c.recommendation })),
    c.benefit ? h("div", { class: "it-block" }, h("small", { text: "Beneficio esperado" }), h("p", { text: c.benefit })) : null,
    h("div", { class: "it-card-actions" },
      c.review ? btn(c.review.label || "Revisar", () => { location.hash = "#/" + c.review.page; }) : null,
      c.action ? btn("Aplicar", () => applyCard(c, false), "primary-btn small") : null,
      c.action ? btn("Editar", () => applyCard(c, true)) : null,
      btn("Descartar", () => dismissCard(c.id), "link-button")));
}

/* ---------- Informe para Claude Pro ---------- */

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  const ta = h("textarea", { style: "position:fixed;opacity:0", "aria-hidden": "true" });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) {}
  ta.remove();
  return ok;
}

function openReport(kind = "full") {
  if (!intelActive() || rulesOnly()) return;
  const dlg = $("#intel-dialog");
  const opts = { habits: true, tasks: true, finance: true, goals: true, patterns: true, includeTitles: true, includeConcepts: true };
  const ta = h("textarea", { class: "it-report-text", rows: 14, spellcheck: "false", "aria-label": "Vista previa del informe (editable)" });
  const count = h("small", { class: "muted" });
  const gen = () => {
    const d = intelData(), a = Intel.analyze(d);
    ta.value = kind === "weekly" ? Intel.weeklyMarkdown(Intel.weeklyReview(d, a), { includeTitles: opts.includeTitles }) + "\n\n## Solicitud de recomendaciones personalizadas\n" + Intel.ANALYSIS_PROMPT : Intel.buildReport(d, a, opts);
    count.textContent = `${new Intl.NumberFormat("es-ES").format(ta.value.length)} caracteres`;
  };
  const toggles = kind === "weekly"
    ? [["includeTitles", "Incluir nombres de tareas, hábitos y objetivos"]]
    : [["habits", "Hábitos"], ["tasks", "Tareas"], ["finance", "Finanzas"], ["goals", "Objetivos y proyectos"], ["patterns", "Patrones del motor de reglas"], ["includeTitles", "Nombres de tareas, hábitos y objetivos"], ["includeConcepts", "Conceptos de los gastos"]];
  const checks = toggles.map(([k, label]) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => { opts[k] = e.target.checked; gen(); } }), label));
  const status = h("p", { class: "muted it-copy-status", role: "status" });
  const guide = h("details", { class: "it-guide" }, h("summary", { text: "Cómo usar este informe" }),
    h("ol", {},
      ...["Revisa y, si quieres, edita el texto: solo contiene lo que ves aquí (sin contraseñas, claves ni correo).",
        "Pulsa «Copiar informe» (o «Descargar informe» si prefieres adjuntar el archivo).",
        "Pulsa «Abrir Claude»: se abre la web oficial de Claude en una pestaña nueva.",
        "Pega el informe (o adjunta el archivo) y envíalo. El análisis lo hace Claude con tu suscripción; CloudSpace no se conecta con él.",
        "Cuando Claude responda, copia su respuesta y vuelve a CloudSpace: «Importar análisis de Claude».",
        "Revisa cada recomendación y elige cuáles guardar o convertir en tarea. Nada se aplica solo."].map((t) => h("li", { text: t }))));
  dlg.replaceChildren(h("div", { class: "sheet it-report" },
    h("h2", { style: "margin-top:0", text: kind === "weekly" ? "Resumen semanal para Claude Pro" : "Informe para Claude Pro" }),
    h("p", { class: "muted", text: "Vista previa editable. No se ha enviado nada: tú decides si lo copias o lo descargas." }),
    h("div", { class: "it-toggles" }, ...checks),
    ta, count, status, guide,
    h("div", { class: "ui-actions it-report-actions" },
      h("button", { type: "button", class: "ui-btn ghost", onclick: () => closeDialog(dlg) }, "Cerrar"),
      h("button", { type: "button", class: "ui-btn ghost", onclick: () => { downloadFile(`cloudspace-informe-${todayKey()}.md`, "text/markdown;charset=utf-8", ta.value); status.textContent = "Informe descargado."; } }, "Descargar informe"),
      h("button", { type: "button", class: "ui-btn ghost", onclick: () => window.open(CLAUDE_URL, "_blank", "noopener,noreferrer") }, "Abrir Claude"),
      h("button", { type: "button", class: "ui-btn primary", onclick: async () => { status.textContent = (await copyText(ta.value)) ? "Informe copiado. Ahora pégalo en Claude." : "No se pudo copiar automáticamente: selecciona el texto y cópialo a mano."; } }, "Copiar informe"))));
  gen();
  openDialog(dlg);
}

/* ---------- Importar análisis de Claude ---------- */

function openImport() {
  if (!intelActive() || rulesOnly()) return;
  const dlg = $("#intel-dialog");
  const raw = h("textarea", { class: "it-report-text", rows: 9, placeholder: "Pega aquí la respuesta de Claude…", "aria-label": "Respuesta de Claude" });
  const preview = h("div", { class: "it-import-preview" });
  const saveBtn = h("button", { type: "button", class: "ui-btn primary", disabled: true }, "Guardar seleccionadas");
  let parsed = [];
  const picked = () => parsed.filter((p) => p.on);
  const sync = () => { saveBtn.disabled = picked().length === 0; saveBtn.textContent = `Guardar seleccionadas (${picked().length})`; };

  const manual = () => openWizard({
    steps: [
      { key: "title", label: "Título de la recomendación", type: "text", required: true, requiredMessage: "Escribe un título.", maxLength: 120, summaryLabel: "Título" },
      { key: "action", label: "Acción propuesta", type: "textarea", maxLength: 500, hint: "Opcional.", summaryLabel: "Acción" },
    ],
    initial: { title: "", action: "" }, earlyAfter: 0, submitLabel: "Guardar", doneMessage: "Recomendación guardada.",
    onSubmit: (v) => addIntelItems([{ title: v.title.trim(), action: (v.action || "").trim(), category: "otros", priority: 4 }]),
  });

  const interpret = () => {
    const r = Intel.parseClaudeResponse(raw.value, todayKey());
    parsed = r.items.map((i) => ({ ...i, on: true }));
    if (r.unparsed) {
      preview.replaceChildren(h("p", { class: "it-warn", role: "status" }, raw.value.trim() ? "No he podido identificar recomendaciones con ese formato. Tu texto se conserva arriba para que lo revises; puedes añadir una recomendación a mano." : "Pega primero la respuesta de Claude."),
        raw.value.trim() ? h("button", { type: "button", class: "secondary small", onclick: manual }, "Añadir una recomendación a mano") : null);
    } else {
      preview.replaceChildren(
        h("p", { class: "muted", text: "Esto es solo una interpretación del texto pegado. No se ha guardado nada ni se ejecuta ninguna instrucción del texto: marca las que quieras conservar." }),
        ...parsed.map((p) => h("div", { class: "it-import-item" },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => { p.on = e.target.checked; sync(); } }),
            h("input", { class: "it-import-title", value: p.title, maxlength: "120", "aria-label": "Título", oninput: (e) => { p.title = e.target.value.slice(0, 120); } })),
          h("div", { class: "meta" },
            h("span", { class: "badge", text: Intel.CATEGORY_LABEL[p.category] || "Otros" }),
            h("span", { class: "badge p" + p.priority, text: Logic.PRIO_LABELS[p.priority] }),
            p.suggested_date ? h("span", { class: "badge today", text: "📅 " + Logic.shortDate(p.suggested_date) }) : null,
            p.goal ? h("span", { class: "badge", text: "Objetivo: " + p.goal }) : null),
          p.problem ? h("p", { class: "muted", text: "Problema: " + p.problem }) : null,
          p.action ? h("p", { text: "Acción: " + p.action }) : null)));
    }
    sync();
  };
  saveBtn.addEventListener("click", async () => {
    const sel = picked().filter((p) => p.title.trim());
    if (!sel.length) return;
    saveBtn.disabled = true;
    if (await addIntelItems(sel)) { closeDialog(dlg); toast(`${plural(sel.length, "recomendación guardada", "recomendaciones guardadas")}.`); }
    else sync();
  });
  dlg.replaceChildren(h("div", { class: "sheet it-report" },
    h("h2", { style: "margin-top:0", text: "Importar análisis de Claude" }),
    h("p", { class: "muted", text: "Pega la respuesta que obtuviste en Claude. Funciona mejor si sigue el formato pedido en el informe (título, categoría, problema, acción, prioridad, fecha)." }),
    raw, h("button", { type: "button", class: "secondary small", onclick: interpret }, "Interpretar texto"), preview,
    h("div", { class: "ui-actions" }, h("button", { type: "button", class: "ui-btn ghost", onclick: () => closeDialog(dlg) }, "Cerrar"), saveBtn)));
  openDialog(dlg);
  raw.focus();
}

/* ---------- Recomendaciones importadas ---------- */

const STATUS_TEXT = { pending: "Pendiente de revisar", applied: "Convertida en tarea", dismissed: "Descartada" };

function importedEl(it) {
  const actions = [];
  if (it.status === "pending") {
    actions.push(
      h("button", { type: "button", class: "primary-btn small", onclick: async () => {
        if (!(await askConfirm({ title: "¿Crear esta tarea?", text: `«${it.title}»${it.suggested_date ? " · " + Logic.longDate(it.suggested_date) : ""}. Se creará solo si confirmas.`, confirmLabel: "Crear tarea" }))) return;
        const notes = [it.action, it.problem && `Problema: ${it.problem}`, it.related_goal && `Objetivo: ${it.related_goal}`, "Importada desde un análisis de Claude."].filter(Boolean).join("\n\n");
        if (await createTask({ title: it.title, due_date: it.suggested_date || null, prio: it.priority, notes })) { await updateIntelItem(it.id, { status: "applied" }); toast("Tarea creada."); }
      } }, "Crear tarea"),
      h("button", { type: "button", class: "secondary small", onclick: () => updateIntelItem(it.id, { status: "dismissed" }) }, "Descartar"));
  }
  actions.push(h("button", { type: "button", class: "link-button danger", onclick: async () => { if (await askConfirm({ title: `¿Eliminar «${it.title}»?`, text: "No se puede deshacer.", confirmLabel: "Eliminar", danger: true })) deleteIntelItem(it.id); } }, "Eliminar"));
  return h("article", { class: "it-card imported " + it.status },
    h("div", { class: "it-card-top" }, h("span", { class: "badge", text: Intel.CATEGORY_LABEL[it.category] || "Otros" }), h("span", { class: "it-kind", text: STATUS_TEXT[it.status] })),
    h("h3", { text: it.title }),
    it.problem ? h("p", { class: "it-problem", text: it.problem }) : null,
    it.action ? h("p", { text: it.action }) : null,
    h("div", { class: "meta" }, h("span", { class: "badge p" + it.priority, text: Logic.PRIO_LABELS[it.priority] }), it.suggested_date ? h("span", { class: "badge today", text: "📅 " + Logic.shortDate(it.suggested_date) }) : null, it.related_goal ? h("span", { class: "badge", text: "Objetivo: " + it.related_goal }) : null),
    h("div", { class: "it-card-actions" }, ...actions));
}

/* ---------- Resumen semanal ---------- */

function weeklyView() {
  const d = intelData();
  const w = Intel.weeklyReview(d, Intel.analyze(d));
  const row = (k, v) => h("div", {}, h("small", { text: k }), h("strong", { text: v }));
  $("#itWeeklyBody").replaceChildren(
    h("p", { class: "muted", text: `Semana del ${Logic.longDate(w.weekStart)} al ${Logic.longDate(w.weekEnd)}` }),
    h("div", { class: "it-stats" },
      row("Tareas completadas", String(w.tasks.done)), row("Tareas abiertas / vencidas", `${w.tasks.open} / ${w.tasks.overdue}`),
      row("Cumplimiento de hábitos", w.habits.pct === null ? "Sin datos" : w.habits.pct + "%"), row("Gastos / ingresos de la semana", `${Logic.formatEUR(w.finance.expense)} / ${Logic.formatEUR(w.finance.income)}`)),
    h("div", { class: "it-block" }, h("small", { text: "Principales obstáculos observados" }), h("ul", {}, ...(w.obstacles.length ? w.obstacles : ["Ninguno destacado con los datos disponibles."]).map((o) => h("li", { text: o })))),
    h("div", { class: "it-block" }, h("small", { text: "Tres prioridades sugeridas para la próxima semana" }),
      w.priorities.length ? h("ol", {}, ...w.priorities.map((p) => h("li", {}, h("b", { text: p.title }), " — " + p.why))) : h("p", { text: "Con los datos actuales no hay prioridades que sugerir." })));
  return w;
}

$("#itWeeklyCopy").addEventListener("click", async () => { const w = weeklyView(); toast((await copyText(Intel.weeklyMarkdown(w))) ? "Resumen copiado." : "No se pudo copiar automáticamente."); });
$("#itWeeklyDownload").addEventListener("click", () => { const w = weeklyView(); downloadFile(`cloudspace-resumen-semanal-${w.weekStart}.md`, "text/markdown;charset=utf-8", Intel.weeklyMarkdown(w)); });
$("#itWeeklyClaude").addEventListener("click", () => openReport("weekly"));
$("#itAnalyze").addEventListener("click", () => openReport("full"));
$("#itImport").addEventListener("click", openImport);
$("#itRestore").addEventListener("click", () => { showDismissed = !showDismissed; renderIntelligence(); });

/* ---------- Nube flotante ---------- */

function renderCloud(active, analysis) {
  const fab = $("#itCloud"), win = $("#itWindow");
  const allowed = active && user && !isGuest(); // el invitado no ve la nube: Intelligence es una función de la cuenta
  fab.classList.toggle("hidden", !allowed);
  if (!allowed) { win.classList.add("hidden"); return; }
  const dis = dismissals();
  const cards = analysis.cards.filter((c) => !dis[c.id]);
  $(".it-dot", fab).classList.toggle("hidden", !cards.some((c) => c.severity >= 3));
  win.classList.toggle("hidden", !cloud.open);
  fab.setAttribute("aria-expanded", String(cloud.open));
  fab.setAttribute("aria-label", cloud.open ? "Cerrar CloudSpace Intelligence" : "Abrir CloudSpace Intelligence");
  fab.title = cloud.open ? "Cerrar CloudSpace Intelligence" : "Abrir CloudSpace Intelligence";
  if (!cloud.open) return;
  const body = $("#itWinBody");
  const scroll = body.scrollTop;
  body.replaceChildren(
    h("p", { class: "it-state", text: analysis.summary.state }),
    ...(cards.length
      ? cards.slice(0, 3).map((c) => h("details", { class: "it-mini", open: cloud.expanded.has(c.id), ontoggle: (e) => { if (e.target.open) cloud.expanded.add(c.id); else cloud.expanded.delete(c.id); } },
          h("summary", { text: c.title }), h("p", { text: c.problem }), h("p", { class: "muted", text: c.recommendation })))
      : [h("p", { class: "muted", text: analysis.summary.hasData ? "Nada que destacar ahora mismo." : "Cuando registres datos, aquí aparecerán observaciones." })]),
    h("div", { class: "it-win-actions" },
      h("button", { type: "button", class: "secondary small", onclick: () => { location.hash = "#/intelligence"; cloud.open = false; saveCloud(); renderIntelligence(); } }, "Abrir Intelligence"),
      rulesOnly() ? null : h("button", { type: "button", class: "primary-btn small", onclick: () => openReport("full") }, "Analizar con Claude Pro")));
  body.scrollTop = scroll;
}
$("#itCloud").addEventListener("click", () => { cloud.open = !cloud.open; saveCloud(); renderIntelligence(); }); // botón único: abre y cierra sin perder el estado
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && cloud.open && !document.querySelector("dialog[open]")) { cloud.open = false; saveCloud(); renderIntelligence(); } });

/* ---------- Ajustes (zona del propietario) ---------- */

const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function renderIntelPrefs() {
  const prefsBox = $("#itPrefs") && ($("#itPrefs").closest(".panel") || $("#itPrefs"));
  if (prefsBox) prefsBox.classList.toggle("hidden", !isGuest() && !state.isAdmin);
  const i = state.intel;
  const when = i.expires_at ? new Date(i.expires_at).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : null;
  $("#itPrefStatus").textContent = !i.ready ? "Falta ejecutar migracion-v5.sql en Supabase: hasta entonces solo funciona la parte local."
    : !i.enabled ? "Desactivada: la sección está oculta."
    : intelActive() ? (when ? `Activa hasta el ${when}.` : "Activa, sin fecha límite.")
    : `Expirada el ${when}: la sección está oculta.`;
  if (!$("#itPrefs").contains(document.activeElement)) {
    $("#itEnabled").checked = i.enabled;
    $("#itExpiry").value = toLocalInput(i.expires_at);
    $("#itMode").value = i.mode;
  }
}
$("#itSave").addEventListener("click", async () => {
  const err = $("#itPrefError");
  err.textContent = "";
  const v = $("#itExpiry").value;
  const iso = v ? new Date(v).toISOString() : null;
  if (v && Number.isNaN(Date.parse(iso))) return (err.textContent = "La fecha no es válida.");
  const ok = await askConfirm({ title: "¿Guardar los ajustes de Intelligence?", text: iso && Date.parse(iso) <= Date.now() ? "La fecha elegida ya ha pasado: Intelligence quedará oculta y el servidor no permitirá nuevas recomendaciones." : "Cambiarás cuándo está disponible esta función. No afecta a ningún otro módulo.", confirmLabel: "Guardar" });
  if (!ok) return;
  if (await saveIntelSettings({ enabled: $("#itEnabled").checked, expires_at: iso, mode: $("#itMode").value })) toast("Ajustes guardados.");
});
$("#itNoExpiry").addEventListener("click", () => { $("#itExpiry").value = ""; });

/* ---------- Pintado ---------- */

let lastActive = null;
function renderIntelligence() {
  const active = intelActive();
  $$("[data-intel]").forEach((a) => a.classList.toggle("hidden", !active));
  renderIntelPrefs();
  if (!active && currentPage === "intelligence") { location.hash = "#/dashboard"; return; }
  const analysis = active ? intelAnalysis() : { cards: [], main: null, summary: { state: "", hasData: false } };
  renderCloud(active, analysis);
  if (currentPage !== "intelligence" || !active) return;

  const s = analysis.summary;
  $("#itStatus").textContent = state.intel.expires_at ? `Disponible hasta ${new Date(state.intel.expires_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}` : "Disponible sin fecha límite";
  show($("#itAnalyze"), !rulesOnly());
  show($("#itImport"), !rulesOnly());
  show($("#itWeeklyClaude"), !rulesOnly());
  const warn = $("#itWarn");
  warn.textContent = state.intel.ready ? "" : "Falta ejecutar migracion-v5.sql en Supabase: no se podrán guardar recomendaciones importadas ni aplicar la expiración en el servidor.";
  show(warn, !state.intel.ready);
  $("#itState").textContent = s.state;
  $("#itHabits").textContent = String(s.habitsPending || 0);
  $("#itTasks").textContent = String(s.tasksSoon || 0);
  $("#itGoals").textContent = String(s.goalsAttention || 0);
  $("#itSpend").textContent = String(s.expensesReview || 0);
  const dis = dismissals();
  const visible = analysis.cards.filter((c) => (showDismissed || !dis[c.id]) && (itFilter === "all" || c.category === itFilter));
  const main = analysis.cards.find((c) => !dis[c.id]);
  $("#itMain").replaceChildren(main
    ? h("div", {}, h("small", { text: "Recomendación principal" }), h("strong", { text: main.title }), h("p", { text: main.recommendation }))
    : h("div", {}, h("small", { text: "Recomendación principal" }), h("p", { class: "muted", text: s.hasData ? "Nada urgente con los datos actuales." : "Todavía no hay datos suficientes." })));
  $("#itFilters").replaceChildren(...CAT_FILTERS.map(([k, label]) => h("button", { type: "button", class: "chip" + (itFilter === k ? " active" : ""), "aria-pressed": String(itFilter === k), onclick: () => { itFilter = k; renderIntelligence(); } }, label)));
  show($("#itRestore"), Object.keys(dis).length > 0);
  $("#itRestore").textContent = showDismissed ? "Ocultar descartadas" : "Mostrar descartadas";
  $("#itCards").replaceChildren(...visible.map((c) => { const el = cardEl(c); if (dis[c.id]) el.classList.add("dismissed"); return el; }));
  show($("#itEmpty"), visible.length === 0);
  $("#itEmptyText").textContent = !s.hasData ? "Todavía no hay datos suficientes para analizar. Registra tareas, hábitos o movimientos y vuelve." : analysis.cards.length ? "No hay recomendaciones en esta categoría (o las has descartado)." : "No he detectado nada destacable con tus datos actuales. Eso también es una buena noticia.";
  weeklyView();
  $("#itItems").replaceChildren(...[...state.intelItems].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)).map(importedEl));
  show($("#itItemsEmpty"), state.intelItems.length === 0);
}

// Comprueba la expiración sin recargar: al cruzar la fecha, la sección desaparece sola
setInterval(() => {
  const a = intelActive();
  if (lastActive !== null && a !== lastActive) renderAll();
  lastActive = a;
}, 15000);
renderers.push(() => { lastActive = intelActive(); renderIntelligence(); });
