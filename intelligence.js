"use strict";
// CloudSpace Intelligence (interfaz). El análisis lo hace intel.js con reglas, en este navegador.
// La página completa de Intelligence se sustituyó por el chat con Sócrates (socrates.js); aquí quedan la nube
// flotante, el informe para Claude Pro, los descartes (los usa el widget «Sugerencia contextual») y los ajustes.
// No hay ninguna llamada a IA ni a APIs externas: Claude Pro solo interviene si TÚ copias el informe y lo pegas allí.
// Nada se crea o modifica sin confirmación explícita.

const CLAUDE_URL = "https://claude.ai/new"; // dirección oficial; no se usa ningún endpoint privado
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

/* ---------- Nube flotante ---------- */

function renderCloud(active, analysis) {
  const fab = $("#itCloud"), win = $("#itWindow");
  const allowed = active && user && !isGuest() && currentPage !== "socrates"; // el invitado no ve la nube; en el chat taparía el botón de enviar
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
      h("button", { type: "button", class: "secondary small", onclick: () => { location.hash = "#/socrates"; cloud.open = false; saveCloud(); renderIntelligence(); } }, "Hablar con Sócrates"),
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
  renderCloud(active, active ? intelAnalysis() : { cards: [], main: null, summary: { state: "", hasData: false } });
}

// Abre la nube flotante (la usan el widget «Sugerencia contextual» y su enlace «Abrir»)
function openIntelCloud() { cloud.open = true; saveCloud(); renderIntelligence(); }
document.addEventListener("click", (e) => { const b = e.target.closest("[data-open-intel]"); if (b) { e.preventDefault(); openIntelCloud(); } });

// Comprueba la expiración sin recargar: al cruzar la fecha, la sección desaparece sola
setInterval(() => {
  const a = intelActive();
  if (lastActive !== null && a !== lastActive) renderAll();
  lastActive = a;
}, 15000);
renderers.push(() => { lastActive = intelActive(); renderIntelligence(); });
