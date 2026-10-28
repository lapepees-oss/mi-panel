"use strict";
// Diario: nota rápida y entrada del día para cualquier fecha, con guardado automático en tu cuenta,
// contador de palabras y borrador local por si se cierra la pestaña antes de que termine de guardar.

let journalDate = null; // día que se muestra en la página Diario (null = hoy)

const EDITOR_DEFS = [
  { id: "quickJournal", status: "quickSaveStatus", words: "quickWords", follow: "today" },
  { id: "jQuick", status: "jQuickStatus", words: "jQuickWords", follow: "date" },
  { id: "jFull", status: "jFullStatus", words: "jFullWords", follow: "date" },
];

const editors = EDITOR_DEFS.map((d) => {
  const el = $("#" + d.id);
  return { el, kind: el.dataset.journal, follow: d.follow, statusEl: $("#" + d.status), wordsEl: $("#" + d.words), dirty: false, date: null, timer: null, saving: false, recovered: new Set() };
});

const dataReady = () => state.timer !== null; // loadAll() lo rellena al terminar
const pageDate = () => journalDate || todayKey();
const editorDate = (ed) => (ed.dirty && ed.date ? ed.date : ed.follow === "today" ? todayKey() : pageDate());
const draftKey = (ed, date) => `draft.${ed.kind}.${date}`;

function setEditorStatus(ed, text, cls = "") {
  ed.statusEl.textContent = text;
  ed.statusEl.className = "save-indicator" + (cls ? " " + cls : "");
}

function updateWords(ed) {
  const n = Logic.wordCount(ed.el.value);
  ed.wordsEl.textContent = n ? plural(n, "palabra", "palabras") : "";
}

async function saveEditor(ed) {
  clearTimeout(ed.timer);
  if (!ed.dirty || ed.saving || !user) return;
  ed.saving = true;
  const value = ed.el.value;
  const date = ed.date;
  setEditorStatus(ed, "Guardando…", "pending");
  const ok = await saveJournal(ed.kind, date, value);
  ed.saving = false;
  if (!ok) {
    setEditorStatus(ed, "No se pudo guardar. Se reintentará; tu texto sigue aquí.", "error");
    ed.timer = setTimeout(() => saveEditor(ed), 6000);
    return;
  }
  if (ed.el.value === value) {
    ed.dirty = false;
    store.remove(draftKey(ed, date));
    const hhmm = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    setEditorStatus(ed, `Guardado a las ${hhmm}`);
  } else {
    saveEditor(ed); // se escribió más mientras se guardaba
  }
  renderAll();
}

// Guarda ya todo lo pendiente (al cambiar de día o de página)
function flushJournal() {
  return Promise.all(editors.filter((e) => e.dirty).map((e) => saveEditor(e)));
}

for (const ed of editors) {
  ed.el.addEventListener("input", () => {
    if (!ed.dirty) ed.date = ed.follow === "today" ? todayKey() : pageDate();
    ed.dirty = true;
    store.set(draftKey(ed, ed.date), ed.el.value);
    setEditorStatus(ed, "Escribiendo…", "pending");
    updateWords(ed);
    clearTimeout(ed.timer);
    ed.timer = setTimeout(() => saveEditor(ed), 900);
  });
  ed.el.addEventListener("blur", () => saveEditor(ed));
}
window.addEventListener("pagehide", () => user && flushJournal());
document.addEventListener("visibilitychange", () => document.hidden && user && flushJournal());

/* ---------- Pintado ---------- */

const JOURNAL_PROMPTS = [
  ["☀️ Algo bueno", "¿Qué pequeño detalle ha mejorado tu día?"],
  ["🌱 Aprendizaje", "¿Qué has descubierto o aprendido últimamente?"],
  ["🌙 Para mañana", "¿Qué te gustaría hacer con más calma?"],
  ["💬 Agradecimiento", "¿A quién o qué le estás agradecido hoy?"],
  ["🎯 Enfoque", "¿Cuál es lo único importante de esta semana?"],
  ["🧭 Dudas", "¿Qué te da vueltas en la cabeza y podrías dejar por escrito?"],
];

function renderJournal() {
  const today = todayKey();
  if (journalDate && journalDate > today) journalDate = today;
  const date = pageDate();

  for (const ed of editors) {
    const d = editorDate(ed);
    const entry = journalEntry(ed.kind, d);
    // Borrador local no guardado (por ejemplo, se cerró la pestaña a medias): se recupera una sola vez
    if (dataReady() && !ed.dirty && !ed.recovered.has(d)) {
      ed.recovered.add(d);
      const draft = store.get(draftKey(ed, d), null);
      if (typeof draft === "string" && draft !== (entry ? entry.body : "")) {
        ed.el.value = draft;
        ed.dirty = true;
        ed.date = d;
        setEditorStatus(ed, "Borrador recuperado, guardando…", "pending");
        updateWords(ed);
        ed.timer = setTimeout(() => saveEditor(ed), 400);
        continue;
      }
    }
    if (!ed.dirty && document.activeElement !== ed.el) {
      const body = entry ? entry.body : "";
      if (ed.el.value !== body) ed.el.value = body;
      if (ed.statusEl.className.includes("error") === false && !ed.saving && !ed.statusEl.textContent.startsWith("Guardado")) setEditorStatus(ed, "");
    }
    updateWords(ed);
  }

  // Cabecera de fecha
  const picker = $("#journalDate");
  picker.max = today;
  if (document.activeElement !== picker) picker.value = date;
  $("#journalDateLabel").textContent = date === today ? "Hoy · " + Logic.longDate(date) : Logic.longDate(date);
  $("#journalNext").disabled = date >= today;
  $("#journalToday").classList.toggle("active", date === today);

  // Preguntas para empezar (rotan cada día)
  const start = Math.floor(Logic.parseDay(today).getTime() / 86400000) % JOURNAL_PROMPTS.length;
  $("#journalPrompts").replaceChildren(
    ...[0, 1, 2].map((i) => {
      const [title, q] = JOURNAL_PROMPTS[(start + i) % JOURNAL_PROMPTS.length];
      return h("button", { type: "button", class: "prompt-card", onclick: () => addPrompt(title, q) }, h("b", { text: title }), q);
    })
  );
  renderRecent(date);
  renderSideIdeas();
  renderJournalTabs();
}

const SHEET_ROT = [-1.5, 1, -0.6, 1.4, -1];
const DOW_ES = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
// Últimos días con notas, como hojas apiladas; pulsar uno lo abre en el cuaderno
function renderRecent(current) {
  const entries = dayEntries();
  const days = [...entries.keys()].sort().reverse().slice(0, 5);
  const box = $("#jrRecent");
  if (!days.length) { box.replaceChildren(h("p", { class: "muted", text: "Aquí aparecerán tus últimos días con notas." })); return; }
  box.replaceChildren(...days.map((d, i) => {
    const e = entries.get(d);
    return h("button", {
      type: "button", class: "jr-leaf" + (d === current ? " on" : ""), style: `transform: rotate(${SHEET_ROT[i % SHEET_ROT.length]}deg)`,
      "aria-label": `Abrir la entrada del ${Logic.longDate(d)}`, "aria-pressed": String(d === current), onclick: () => gotoJournalDay(d),
    },
      h("span", { class: "jr-leaf-date", "aria-hidden": "true" }, h("small", { text: DOW_ES[Logic.parseDay(d).getDay()] }), h("b", { text: String(Number(d.slice(8))) })),
      h("span", { class: "jr-leaf-text", text: excerpt(e.entry || e.quick, 70) }));
  }));
}

// Las ideas más recientes, como notas pegadas; llevan a la pestaña de ideas
function renderSideIdeas() {
  const box = $("#jrIdeas");
  const list = [...state.ideas].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 3);
  if (!list.length) { box.replaceChildren(h("p", { class: "muted", text: "Todavía no tienes ideas. Guárdalas con «💡» desde tus notas." })); return; }
  box.replaceChildren(...list.map((i, k) => h("button", {
    type: "button", class: "jr-note n" + (k % 3), style: `transform: rotate(${[1.5, -2, 1][k % 3]}deg)`, onclick: async () => { await flushJournal(); setJournalTab("ideas"); },
    "aria-label": `Idea: ${i.title}. Abrir mis ideas`,
  }, i.title)));
}

function addPrompt(title, question) {
  const full = $("#jFull");
  full.value += (full.value.trim() ? "\n\n" : "") + `${title}: ${question}\n`;
  full.dispatchEvent(new Event("input", { bubbles: true }));
  full.focus();
  full.setSelectionRange(full.value.length, full.value.length);
}

async function gotoJournalDay(date) {
  if (!Logic.isDayKey(date) || date > todayKey()) return;
  await flushJournal();
  journalDate = date === todayKey() ? null : date;
  renderJournal();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#journalPrev").addEventListener("click", () => gotoJournalDay(Logic.addDays(pageDate(), -1)));
$("#journalNext").addEventListener("click", () => gotoJournalDay(Logic.addDays(pageDate(), 1)));
$("#journalToday").addEventListener("click", () => gotoJournalDay(todayKey()));
$("#journalDate").addEventListener("change", (e) => gotoJournalDay(e.target.value));



/* ================= Pestañas: Diario · Entradas · Solo ideas ================= */

let journalTab = store.get("journalTab", "diario");
if (!["diario", "entradas", "ideas"].includes(journalTab)) journalTab = "diario";
let entriesMonth = null; // "AAAA-MM"
let entriesDay = null; // día abierto en el detalle
let entriesQuery = "";
const ideaUI = { q: "", tag: "", sort: "desc" };

function setJournalTab(tab) {
  journalTab = tab;
  store.set("journalTab", tab);
  renderJournalTabs();
}
$$("#journalTabs [data-tab]").forEach((b) => b.addEventListener("click", async () => { await flushJournal(); setJournalTab(b.dataset.tab); }));

const dayEntries = () => {
  const m = new Map();
  for (const j of state.journal) {
    if (!j.body.trim()) continue;
    if (!m.has(j.entry_date)) m.set(j.entry_date, {});
    m.get(j.entry_date)[j.kind] = j.body;
  }
  return m;
};
const excerpt = (t, n = 160) => { const x = (t || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n) + "…" : x; };
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function renderJournalTabs() {
  $$("#journalTabs [data-tab]").forEach((b) => {
    const on = b.dataset.tab === journalTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  show($("#jv-diario"), journalTab === "diario");
  show($("#jv-entradas"), journalTab === "entradas");
  show($("#jv-ideas"), journalTab === "ideas");
  $("#ideasCount").textContent = state.ideas.length ? String(state.ideas.length) : "";
  if (journalTab === "entradas") renderEntries();
  if (journalTab === "ideas") renderIdeas();
}

/* ---------- Entradas ---------- */

function openEntryInDiario(date) {
  setJournalTab("diario");
  gotoJournalDay(date);
}

function renderEntries() {
  const today = todayKey();
  if (!entriesMonth) entriesMonth = today.slice(0, 7);
  const entries = dayEntries();
  const [yy, mm] = entriesMonth.split("-").map(Number);
  $("#jrMonth").textContent = `${MONTHS_ES[mm - 1][0].toUpperCase()}${MONTHS_ES[mm - 1].slice(1)} ${yy}`;
  $("#jrNext").disabled = entriesMonth >= today.slice(0, 7);
  $("#jrGrid").replaceChildren(
    ...Logic.monthGrid(entriesMonth).flat().map((k) => {
      if (!k) return h("span", { class: "jr-cell blank" });
      const has = entries.has(k);
      const cls = "jr-cell" + (has ? " has" : "") + (k === today ? " today" : "") + (k === entriesDay ? " sel" : "");
      return h("button", {
        type: "button", class: cls, disabled: k > today, "aria-pressed": String(k === entriesDay),
        "aria-label": `${Logic.longDate(k)}${has ? ": con entrada" : ""}`,
        onclick: () => { entriesDay = k === entriesDay ? null : k; renderEntries(); },
      }, h("span", { text: String(Number(k.slice(8))) }), has ? h("i", { "aria-hidden": "true" }) : null);
    })
  );

  const q = entriesQuery.trim().toLowerCase();
  let days = [...entries.keys()].sort().reverse();
  if (q) days = days.filter((d) => ((entries.get(d).entry || "") + " " + (entries.get(d).quick || "")).toLowerCase().includes(q));
  else days = days.filter((d) => d.startsWith(entriesMonth));
  $("#jrCaption").textContent = q ? `${plural(days.length, "resultado", "resultados")} en todo el diario.` : days.length ? `${plural(days.length, "día con notas", "días con notas")} este mes.` : "";
  $("#jrList").replaceChildren(
    ...days.map((d) => {
      const e = entries.get(d);
      const words = Logic.wordCount(e.entry) + Logic.wordCount(e.quick);
      return h("button", { type: "button", class: "history-item" + (d === entriesDay ? " sel" : ""), onclick: () => { entriesDay = d; entriesMonth = d.slice(0, 7); renderEntries(); } },
        h("b", { text: Logic.longDate(d) }),
        h("span", { text: excerpt(e.entry || e.quick) + `  ·  ${plural(words, "palabra", "palabras")}` }));
    })
  );
  show($("#jrEmpty"), days.length === 0);
  $("#jrEmptyText").textContent = q ? "Ninguna entrada coincide con tu búsqueda." : entries.size ? "No hay entradas en este mes." : "Todavía no has escrito nada. Tu primera nota aparecerá aquí.";

  // Detalle del día abierto
  const box = $("#jrDetail");
  show(box, !!entriesDay);
  if (!entriesDay) return;
  const e = entries.get(entriesDay);
  const ideas = state.ideas.filter((i) => i.entry_date === entriesDay);
  if (!e) {
    box.replaceChildren(h("div", { class: "panel-head" }, h("h3", { text: Logic.longDate(entriesDay) }),
      h("button", { type: "button", class: "secondary small", onclick: () => openEntryInDiario(entriesDay) }, "Escribir este día")),
      h("p", { class: "muted", text: "No hay entrada este día." }));
    return;
  }
  const block = (label, text) => (text ? h("div", { class: "jr-block" }, h("small", { text: label }), h("p", { text })) : null);
  box.replaceChildren(
    h("div", { class: "panel-head" }, h("h3", { text: Logic.longDate(entriesDay) }),
      h("div", { class: "row nowrap" },
        h("button", { type: "button", class: "secondary small", onclick: () => openEntryInDiario(entriesDay) }, "Editar"),
        h("button", { type: "button", class: "secondary small danger", onclick: async () => {
          if (await askConfirm({ title: "¿Borrar las notas de este día?", text: `Se borrará la nota rápida y la entrada del ${Logic.longDate(entriesDay)}. Las ideas guardadas se conservan. No se puede deshacer.`, confirmLabel: "Borrar", danger: true })) {
            const d = entriesDay; entriesDay = null; await deleteJournalDay(d); toast("Entrada borrada.");
          }
        } }, "Eliminar"))),
    block("Nota rápida", e.quick), block("Entrada del día", e.entry),
    ideas.length ? h("p", { class: "muted", text: `💡 ${plural(ideas.length, "idea guardada", "ideas guardadas")} desde esta entrada.` }) : null
  );
}

$("#jrPrev").addEventListener("click", () => { entriesMonth = Logic.addDays((entriesMonth || todayKey().slice(0, 7)) + "-01", -1).slice(0, 7); renderEntries(); });
$("#jrNext").addEventListener("click", () => { entriesMonth = Logic.addDays((entriesMonth || todayKey().slice(0, 7)) + "-28", 7).slice(0, 7); if (entriesMonth > todayKey().slice(0, 7)) entriesMonth = todayKey().slice(0, 7); renderEntries(); });
$("#jrThisMonth").addEventListener("click", () => { entriesMonth = todayKey().slice(0, 7); renderEntries(); });
$("#jrSearch").addEventListener("input", (e) => { entriesQuery = e.target.value; renderEntries(); });

/* ---------- Ideas ---------- */

const parseTags = (txt) => cleanTags(String(txt || "").split(/[,\s]+/));

function openIdeaForm(idea = null, seed = {}) {
  if (!state.ideasReady) return toast("Falta la tabla de ideas: ejecuta migracion-v4.sql en Supabase.", 6000);
  openWizard({
    steps: [
      { key: "title", label: "Título de la idea", type: "text", required: true, requiredMessage: "Escribe un título.", maxLength: 120, summaryLabel: "Título" },
      { key: "body", label: "Contenido", type: "textarea", maxLength: 4000, summaryLabel: "Contenido", hint: "Opcional." },
      { key: "tags", label: "Etiquetas", type: "text", maxLength: 120, summaryLabel: "Etiquetas", hint: "Opcional. Separadas por comas o espacios: dibujo, proyecto." },
    ],
    initial: idea ? { title: idea.title, body: idea.body || "", tags: (idea.tags || []).join(", ") } : { title: seed.title || "", body: seed.body || "", tags: "" },
    earlyAfter: 0,
    submitLabel: idea ? "Guardar cambios" : "Guardar idea",
    doneMessage: idea ? "Idea actualizada." : "Idea guardada.",
    onSubmit: (v) => (idea
      ? updateIdea(idea.id, { title: v.title.trim(), body: (v.body || "").trim(), tags: parseTags(v.tags) })
      : createIdea({ title: v.title, body: v.body, tags: parseTags(v.tags), entry_date: seed.entry_date || null })),
  });
}

// Desde un editor: usa el texto seleccionado o, si no hay selección, todo el texto
$$("[data-idea-from]").forEach((b) => b.addEventListener("click", () => {
  const ta = $("#" + b.dataset.ideaFrom);
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  const text = (sel || ta.value).trim();
  if (!text) return toast("Escribe algo primero para guardarlo como idea.");
  const first = text.split(/\n/)[0].trim();
  openIdeaForm(null, { title: first.length > 60 ? first.slice(0, 60).trim() + "…" : first, body: text, entry_date: pageDate() });
}));
$("#ideaNew").addEventListener("click", () => openIdeaForm());
$("#ideaSearch").addEventListener("input", (e) => { ideaUI.q = e.target.value; renderIdeas(); });
$("#ideaTag").addEventListener("change", (e) => { ideaUI.tag = e.target.value; renderIdeas(); });
$("#ideaSort").addEventListener("change", (e) => { ideaUI.sort = e.target.value; renderIdeas(); });

function renderIdeas() {
  const all = {};
  for (const i of state.ideas) for (const t of i.tags || []) all[t] = (all[t] || 0) + 1;
  const tagSel = $("#ideaTag");
  if (ideaUI.tag && !all[ideaUI.tag]) ideaUI.tag = "";
  tagSel.replaceChildren(h("option", { value: "", text: "Todas las etiquetas" }), ...Object.keys(all).sort().map((t) => h("option", { value: t, text: `#${t} (${all[t]})` })));
  tagSel.value = ideaUI.tag;
  $("#ideaSort").value = ideaUI.sort;

  const q = ideaUI.q.trim().toLowerCase();
  const list = state.ideas
    .filter((i) => (!ideaUI.tag || (i.tags || []).includes(ideaUI.tag)) && (!q || (i.title + " " + (i.body || "") + " " + (i.tags || []).join(" ")).toLowerCase().includes(q)))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) * (ideaUI.sort === "asc" ? 1 : -1));
  const entries = dayEntries();
  $("#ideaList").replaceChildren(
    ...list.map((i) => {
      const d = Logic.dayOfTimestamp(i.created_at);
      const menu = h("button", { type: "button", class: "task-menu-btn", title: "Opciones", "aria-label": `Opciones de «${i.title}»`, "aria-haspopup": "menu",
        onclick: (e) => { e.stopPropagation(); openMenu(e.currentTarget, [
          { label: "Editar", fn: () => openIdeaForm(i) },
          { label: "Eliminar", danger: true, fn: async () => { if (await askConfirm({ title: `¿Borrar «${i.title}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar", danger: true })) deleteIdea(i.id); } },
        ], "Opciones de la idea"); } });
      menu.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-dots"/></svg>';
      return h("article", { class: "idea-card" },
        h("div", { class: "idea-top" }, h("strong", { text: i.title }), menu),
        i.body ? h("p", { text: excerpt(i.body, 220) }) : null,
        (i.tags || []).length ? h("div", { class: "meta" }, ...i.tags.map((t) => h("button", { type: "button", class: "badge tag", title: "Filtrar por esta etiqueta", onclick: () => { ideaUI.tag = t; renderIdeas(); }, text: "#" + t }))) : null,
        h("div", { class: "idea-foot" }, h("small", { class: "muted", text: Logic.longDate(d) }),
          i.entry_date ? (h("button", { type: "button", class: "link-button", onclick: () => { entriesDay = i.entry_date; entriesMonth = i.entry_date.slice(0, 7); setJournalTab("entradas"); } }, "Ver entrada original")) : null));
    })
  );
  show($("#ideaEmpty"), list.length === 0);
  $("#ideaEmptyText").textContent = !state.ideasReady ? "La biblioteca de ideas necesita ejecutar migracion-v4.sql en Supabase." : state.ideas.length ? "Ninguna idea coincide con los filtros." : "Aún no tienes ideas. Guárdalas desde el diario o pulsa «+ Nueva idea».";
}

renderers.push(renderJournal);
