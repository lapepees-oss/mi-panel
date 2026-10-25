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

  // Entradas anteriores
  const byDate = new Map();
  for (const j of state.journal) {
    if (!j.body.trim()) continue;
    if (!byDate.has(j.entry_date)) byDate.set(j.entry_date, {});
    byDate.get(j.entry_date)[j.kind] = j.body;
  }
  const days = [...byDate.keys()].sort().reverse();
  $("#journalHistoryCaption").textContent = days.length ? `${plural(days.length, "día con notas", "días con notas")}. Pulsa uno para abrirlo.` : "";
  show($("#journalHistoryEmpty"), days.length === 0);
  $("#journalHistory").replaceChildren(
    ...days.slice(0, 40).map((d) => {
      const e = byDate.get(d);
      const text = (e.entry || e.quick || "").replace(/\s+/g, " ").trim();
      const words = Logic.wordCount(e.entry) + Logic.wordCount(e.quick);
      return h("button", { type: "button", class: "history-item", onclick: () => gotoJournalDay(d) },
        h("b", { text: Logic.longDate(d) }),
        h("span", { text: (text.length > 140 ? text.slice(0, 140) + "…" : text) + `  ·  ${plural(words, "palabra", "palabras")}` }));
    })
  );
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

renderers.push(renderJournal);
