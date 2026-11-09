"use strict";
// Chat con Sócrates (sustituye a la página de Intelligence).
// La web NO habla directamente con tu PC: escribe tus mensajes en la tabla socrates_messages de Supabase
// (estado «pending») y el puente de tu ordenador (socrates-puente/puente_cloudspace.py) los recoge, se los pasa
// a Sócrates y escribe su respuesta en la misma tabla. El tiempo real de Supabase la trae aquí al instante.
// Así funciona igual desde el móvil o desde otro PC, sin abrir puertos en casa. Tabla: migracion-v12.sql.

const SC_HISTORY = 100;          // mensajes que se cargan (los más recientes)
const SC_ONLINE_MS = 60 * 1000;  // el puente da señales cada ~20 s; sin noticias en 1 min = desconectado
const SC_STATUS_POLL_MS = 20 * 1000;

Object.assign(state, { scMessages: [], scReady: true, scStatus: null, scStatusReady: true });

const socratesAllowed = () => !!user && !isGuest(); // el invitado no tiene base real: sin chat
const scMissing = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /socrates_|schema cache/i.test(e.message || ""));

/* ---------- Datos ---------- */

// Cargador por tabla (lo usa loadAll de data.js; el tiempo real lo llama cuando cambia socrates_messages)
LOADERS.socrates_messages = async () => {
  if (!socratesAllowed()) { state.scMessages = []; return; }
  const { data, error } = await db.from("socrates_messages").select("*")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(SC_HISTORY);
  if (error) {
    if (scMissing(error)) { state.scReady = false; state.scMessages = []; return; }
    throw error;
  }
  state.scReady = true;
  state.scMessages = data.reverse();
};

// Latido del puente (no va por tiempo real para no repintar toda la app cada 20 s)
async function loadSocratesStatus() {
  if (!socratesAllowed()) return;
  const { data, error } = await db.from("socrates_status").select("last_seen, model").maybeSingle();
  if (error) { state.scStatusReady = !scMissing(error); state.scStatus = null; }
  else { state.scStatusReady = true; state.scStatus = data; }
  renderSocratesStatus();
}
const socratesOnline = () => !!(state.scStatus && Date.now() - Date.parse(state.scStatus.last_seen) < SC_ONLINE_MS);

async function scWrite(query) {
  const { error } = await query;
  if (error) {
    console.error(error);
    setSync(false);
    toast(scMissing(error) ? "Falta ejecutar migracion-v12.sql en Supabase para usar el chat con Sócrates." : Logic.dataErrorText(error), 7000);
    throw error;
  }
  setSync(true);
}

function sendToSocrates(text) {
  const tmp = { id: "tmp-" + Date.now(), role: "user", content: text, status: "pending", created_at: new Date().toISOString() };
  return mutate(
    () => { state.scMessages.push(tmp); scStick = true; },
    () => scWrite(db.from("socrates_messages").insert({ role: "user", content: text, status: "pending" }))
  );
}

const retryMessage = (m) => mutate(() => { m.status = "pending"; }, () => scWrite(db.from("socrates_messages").update({ status: "pending" }).eq("id", m.id)));

async function clearSocrates() {
  if (!state.scMessages.length) return;
  const ok = await askConfirm({ title: "¿Borrar la conversación?", text: "Se eliminan todos los mensajes con Sócrates de tu cuenta. No se puede deshacer.", confirmLabel: "Borrar", danger: true });
  if (!ok) return;
  // PostgREST exige un filtro en los borrados; el RLS ya limita a tus filas
  await mutate(() => { state.scMessages = []; }, () => scWrite(db.from("socrates_messages").delete().gte("id", 0)));
}

/* ---------- Pintado ---------- */

let scSig = "";       // firma de lo pintado: si no cambia, no se toca el DOM (se conserva el scroll y la selección)
let scStick = true;   // bajar al final al pintar (al entrar, al enviar o si ya estabas abajo)
const scTime = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function bubble(m) {
  const mine = m.role === "user";
  return h("div", { class: "sc-msg " + (mine ? "me" : "bot") + (m.status === "error" ? " err" : "") },
    h("div", { class: "sc-bubble", text: m.content }),
    h("small", { class: "sc-meta" },
      mine ? "" : "Sócrates · ", scTime(m.created_at),
      mine && m.status === "error" ? h("span", {}, " · No se pudo responder ", h("button", { type: "button", class: "link-button", onclick: () => retryMessage(m) }, "Reintentar")) : null));
}

function renderSocratesStatus() {
  const el = $("#scStatus");
  if (!el) return;
  const on = socratesOnline();
  el.classList.toggle("on", on);
  const model = on && state.scStatus.model ? ` · ${state.scStatus.model}` : "";
  $("span", el).textContent = !state.scStatusReady ? "Sin configurar" : on ? "Conectado" + model : "Desconectado";
  el.title = on ? "El puente de tu PC está activo" : "Arranca el puente en tu PC (socrates-puente/puente_cloudspace.py) para que Sócrates responda";
}

function renderSocrates() {
  $$("[data-socrates]").forEach((a) => a.classList.toggle("hidden", !socratesAllowed()));
  if (currentPage !== "socrates" || !socratesAllowed()) return;
  renderSocratesStatus();

  const warn = $("#scWarn");
  warn.textContent = state.scReady ? "" : "Falta ejecutar migracion-v12.sql en el SQL Editor de Supabase. Hasta entonces el chat no puede guardar mensajes.";
  show(warn, !state.scReady);
  $("#scClear").disabled = !state.scMessages.length;

  const msgs = state.scMessages;
  const waiting = msgs.filter((m) => m.role === "user" && (m.status === "pending" || m.status === "thinking"));
  const thinking = waiting.some((m) => m.status === "thinking");
  const online = socratesOnline();
  const sig = msgs.map((m) => m.id + ":" + m.status).join("|") + `#${thinking}${online}`;
  if (sig === scSig) return;
  scSig = sig;

  const log = $("#scLog");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const kids = msgs.length ? msgs.map(bubble) : [h("div", { class: "sc-empty" },
    h("div", { class: "empty-cloud", "aria-hidden": "true" }, ico("chat")),
    h("p", { text: "A su servicio, señor. Escríbame lo que necesite." }),
    h("p", { class: "muted", text: "Sus mensajes se guardan en su cuenta y Sócrates los lee desde su PC." }))];
  if (waiting.length) {
    kids.push(h("div", { class: "sc-msg bot typing" },
      h("div", { class: "sc-bubble" }, h("i"), h("i"), h("i")),
      h("small", { class: "sc-meta", text: thinking ? "Sócrates está pensando…" : online ? "Enviado a Sócrates…" : "Sócrates no está conectado: responderá cuando arranque el puente en tu PC." })));
  }
  log.replaceChildren(...kids);
  if (scStick || atBottom) log.scrollTop = log.scrollHeight;
  scStick = false;
}
renderers.push(renderSocrates);

/* ---------- Entrada ---------- */

const scInput = $("#scInput");
const autosize = () => { scInput.style.height = "auto"; scInput.style.height = Math.min(scInput.scrollHeight, 160) + "px"; };
scInput.addEventListener("input", autosize);
// Intro envía; Mayús+Intro hace salto de línea (en el móvil, el botón de enviar)
scInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#scForm").requestSubmit(); }
});
$("#scForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = scInput.value.trim().slice(0, 4000);
  if (!text) return;
  if (!state.scReady) { toast("Falta ejecutar migracion-v12.sql en Supabase.", 6000); return; }
  scInput.value = "";
  autosize();
  const ok = await sendToSocrates(text);
  if (!ok && !scInput.value) { scInput.value = text; autosize(); } // si falló, no pierdes lo escrito
  scInput.focus();
});
$("#scClear").addEventListener("click", clearSocrates);

// Al entrar en el apartado: latido al momento, bajar al final y foco en la caja (solo en PC, en móvil abriría el teclado)
window.addEventListener("hashchange", () => {
  if (!/^#\/socrates/.test(location.hash)) return;
  scStick = true; scSig = "";
  loadSocratesStatus();
  if (matchMedia("(pointer: fine)").matches) setTimeout(() => scInput.focus(), 150);
});
// Mientras el apartado está a la vista, se consulta el latido cada 20 s
setInterval(() => { if (currentPage === "socrates" && !document.hidden && socratesAllowed()) loadSocratesStatus(); }, SC_STATUS_POLL_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentPage === "socrates") loadSocratesStatus(); });
// Primera carga (sesión ya iniciada al abrir la app directamente en #/socrates)
setTimeout(function firstStatus() { if (user) loadSocratesStatus(); else setTimeout(firstStatus, 1500); }, 1500);
