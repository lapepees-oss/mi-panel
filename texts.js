"use strict";
// Textos de la interfaz que se pueden personalizar. Catálogo centralizado con ids estables:
//   - Solo textos FIJOS (títulos, menús, botones). Nunca valores dinámicos (cifras, fechas, nombres de tus datos).
//   - Cada id apunta a uno o varios elementos con `sel`; el texto original se lee del propio HTML la primera vez
//     (dataset.textOrig), así "Restaurar" siempre devuelve exactamente el texto de fábrica.
//   - Se guardan por usuario (userprefs.js → user_prefs.texts). El invitado los tiene solo en memoria.
//   - Se escribe siempre con textContent: no se interpreta HTML.
const UI_TEXTS = [
  { id: "nav.dashboard", group: "Menú", label: "Resumen", sel: '.nav a[data-page="dashboard"] span, .bottom-nav a[data-page="dashboard"] span', max: 20 },
  { id: "nav.habits", group: "Menú", label: "Hábitos", sel: '.nav a[data-page="habits"] span, .bottom-nav a[data-page="habits"] span', max: 20 },
  { id: "nav.tasks", group: "Menú", label: "Tareas", sel: '.nav a[data-page="tasks"] span, .bottom-nav a[data-page="tasks"] span', max: 20 },
  { id: "nav.journal", group: "Menú", label: "Diario", sel: '.nav a[data-page="journal"] span, .bottom-nav a[data-page="journal"] span', max: 20 },
  { id: "nav.finance", group: "Menú", label: "Finanzas", sel: '.nav a[data-page="finance"] span, .bottom-nav a[data-page="finance"] span', max: 20 },
  { id: "nav.timer", group: "Menú", label: "Cronómetro (en la barra inferior: Tiempo)", sel: '.nav a[data-page="timer"] span, .bottom-nav a[data-page="timer"] span', max: 20 },
  { id: "habits.title", group: "Hábitos", label: "Título de la página", sel: "#h-habits", max: 60 },
  { id: "habits.sub", group: "Hábitos", label: "Subtítulo", sel: "#page-habits .page-intro > p", max: 160 },
  { id: "habits.calendar", group: "Hábitos", label: "Panel «Calendario de constancia»", sel: "#page-habits .hb-side .hb-card:first-child > h3", max: 50 },
  { id: "tasks.title", group: "Tareas", label: "Título de la página", sel: "#h-tasks", max: 60 },
  { id: "tasks.sub", group: "Tareas", label: "Subtítulo", sel: "#page-tasks .page-intro > p", max: 160 },
  { id: "journal.title", group: "Diario", label: "Título de la página", sel: "#h-journal", max: 60 },
  { id: "journal.sub", group: "Diario", label: "Subtítulo", sel: "#page-journal .page-intro > p", max: 160 },
  { id: "finance.title", group: "Finanzas", label: "Título de la página", sel: "#h-finance", max: 60 },
  { id: "finance.flow", group: "Finanzas", label: "Panel «Ingresos y gastos»", sel: "#page-finance .panel-head h3", only: "Ingresos y gastos", max: 50 },
  { id: "finance.budgets", group: "Finanzas", label: "Panel «Presupuestos»", sel: "#page-finance .panel-head h3", only: "Presupuestos", max: 50 },
  { id: "finance.subs", group: "Finanzas", label: "Panel «Suscripciones»", sel: "#page-finance .panel-head h3", only: "Suscripciones", max: 50 },
  { id: "finance.goals", group: "Finanzas", label: "Panel «Objetivos de ahorro»", sel: "#page-finance .panel-head h3", only: "Objetivos de ahorro", max: 50 },
  { id: "timer.title", group: "Cronómetro", label: "Título de la página", sel: "#h-timer", max: 60 },
  { id: "timer.sub", group: "Cronómetro", label: "Subtítulo", sel: "#page-timer .page-intro > p", max: 160 },
  { id: "prefs.title", group: "Preferencias", label: "Título de la página", sel: "#h-prefs", max: 60 },
  { id: "prefs.sub", group: "Preferencias", label: "Subtítulo", sel: "#page-prefs .page-intro > p", max: 160 },
];
const UI_TEXT_IDS = new Map(UI_TEXTS.map((t) => [t.id, t]));

function uiTextEls(t) {
  const all = $$(t.sel);
  return t.only ? all.filter((el) => (el.dataset.textOrig ?? el.textContent.trim()) === t.only) : all;
}

// Valida un texto escrito por el usuario: una línea, sin espacios sobrantes, dentro del máximo. "" = restaurar.
function cleanUiText(id, v) {
  const t = UI_TEXT_IDS.get(id);
  if (!t || typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, t.max);
}

// Texto original de fábrica de un id (el primero que se encuentre)
function uiTextDefault(t) {
  const el = uiTextEls(t)[0] || $$(t.sel)[0];
  return el ? (el.dataset.textOrig ?? el.textContent.trim()) : "";
}

function applyUiTexts() {
  const custom = upTexts();
  for (const t of UI_TEXTS) {
    const value = cleanUiText(t.id, custom[t.id]);
    for (const el of uiTextEls(t)) {
      if (el.dataset.textOrig === undefined) el.dataset.textOrig = el.textContent.trim();
      const want = value || el.dataset.textOrig;
      if (el.textContent !== want) el.textContent = want;
      if (el.matches(".nav a span, .bottom-nav a span")) el.closest("a").setAttribute("title", want);
    }
  }
  if (typeof moveNavIndicator === "function") moveNavIndicator();
}
renderers.push(applyUiTexts);

function saveUiTexts(map) {
  const out = {};
  for (const [id, v] of Object.entries(map)) { const c = cleanUiText(id, v); if (c && c !== uiTextDefault(UI_TEXT_IDS.get(id))) out[id] = c; }
  upSet("texts", out);
  applyUiTexts();
}

function openTextsEditor() {
  const dlg = $("#sheet-dialog");
  const cur = { ...upTexts() };
  const rows = new Map();
  const groups = [...new Set(UI_TEXTS.map((t) => t.group))];
  const body = groups.map((g) => h("fieldset", { class: "tx-group" },
    h("legend", { text: g }),
    ...UI_TEXTS.filter((t) => t.group === g).map((t) => {
      const def = uiTextDefault(t);
      const input = h("input", { type: "text", maxlength: String(t.max), value: cur[t.id] || "", placeholder: def, "aria-label": t.label + " (original: " + def + ")" });
      const reset = h("button", { type: "button", class: "link-button", text: "Restaurar", onclick: () => { input.value = ""; } });
      rows.set(t.id, input);
      return h("label", { class: "tx-row" }, h("span", { text: t.label }), h("div", {}, input, reset));
    })));
  const collect = () => Object.fromEntries([...rows].map(([id, el]) => [id, el.value]));
  dlg.replaceChildren(h("div", { class: "sheet tx-sheet" },
    h("h2", { style: "margin-top:0", text: "Textos de la interfaz" }),
    h("p", { class: "muted", text: isGuest() ? "Modo invitado: tus cambios son temporales y no se guardan en ninguna cuenta." : "Solo textos fijos (títulos, menús, botones). Dejarlo vacío restaura el original. Se guardan en tu cuenta." }),
    h("div", { class: "tx-list" }, ...body),
    h("div", { class: "row", style: "justify-content:space-between;margin-top:12px;gap:8px;flex-wrap:wrap" },
      h("button", { type: "button", class: "secondary", text: "Restaurar todos", onclick: () => { rows.forEach((el) => (el.value = "")); } }),
      h("span", {}, h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => closeDialog(dlg) }), " ",
        h("button", { type: "button", class: "primary-btn", text: "Guardar", onclick: () => { saveUiTexts(collect()); closeDialog(dlg); toast("Textos actualizados."); } })))));
  openDialog(dlg);
}
$("#editTexts").addEventListener("click", openTextsEditor);
