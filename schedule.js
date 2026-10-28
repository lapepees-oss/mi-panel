"use strict";
// Mi horario (bloque del Resumen): muestra en qué etapa de tu horario estás con un tambor vertical, como las recámaras
// de un revólver: las etapas que vienen están arriba, la actual en el centro y las pasadas abajo. Es AUTOMÁTICO: sigue la
// hora del dispositivo y, en el minuto exacto en que acaba una etapa, el tambor gira solo de arriba abajo hasta la siguiente.
// No hay nada que mover a mano. SOLO LEE: usa los mismos bloques fijos que el Copiloto (user_prefs.dashboard.copilot.blocks),
// que se editan con «Editar» (openCopilotEditor). No guarda nada propio ni duplica datos.

const SCH_STEP = 54; // grados entre etapas contiguas
const SCH_R = 40;    // radio del cilindro (px): separa las recámaras

const sch = { sig: "", els: [], drum: null, info: null, nowIdx: 0, edge: null };

function schDur(min) {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
}

// Coloca cada recámara en el cilindro según su distancia a la etapa actual. d > 0 = futuro (arriba), d < 0 = pasado (abajo).
function schPlace(center) {
  sch.els.forEach((el, i) => {
    const d = i - center, a = Math.abs(d);
    el.style.transform = `translateY(-50%) rotateX(${d * SCH_STEP}deg) translateZ(${SCH_R}px)`;
    el.style.opacity = a === 0 ? "1" : a === 1 ? ".62" : a === 2 ? ".22" : "0";
    el.classList.toggle("is-center", a === 0);
    el.setAttribute("aria-hidden", a === 0 ? "false" : "true");
  });
}

function schBuild(body, stages, nowIdx) {
  sch.els = stages.map((s) => h("div", { class: "sch-item " + s.kind, role: "group", "aria-roledescription": "etapa" },
    h("span", { class: "sch-name", text: s.label }),
    h("span", { class: "sch-time", text: `${Logic.minLabel(s.start)}–${Logic.minLabel(s.end >= 1440 ? 1439 : s.end)}` }),
    h("span", { class: "sch-bar", "aria-hidden": "true" }, h("i")),
    h("span", { class: "sch-left" })));
  sch.drum = h("div", { class: "sch-drum" }, h("div", { class: "sch-cyl", style: `transform:translateZ(${-SCH_R}px)` }, ...sch.els));
  sch.info = h("p", { class: "sr-only", role: "status" });
  body.replaceChildren(h("div", { class: "sch" }, sch.drum, sch.info));
  // entrada: el tambor arranca desplazado y gira hasta la etapa actual
  const from = Math.min(stages.length - 1, nowIdx + 3);
  schPlace(from);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) schPlace(nowIdx);
  else { sch.drum.classList.add("spin"); void sch.drum.offsetWidth; requestAnimationFrame(() => requestAnimationFrame(() => schPlace(nowIdx))); }
}

function schRefresh() {
  const el = $('#dbBoard > .db-widget[data-widget="schedule"]');
  if (!el || el.classList.contains("is-off") || dataLoading()) return;
  const body = $(".wbody", el);
  if (body) renderWSchedule(body, todayKey());
}

// Programa el repintado justo cuando acaba la etapa actual (así el giro ocurre en el minuto exacto, no hasta 20 s después)
function schArmEdge(msLeft) {
  clearTimeout(sch.edge);
  if (!(msLeft > 0)) return;
  sch.edge = setTimeout(schRefresh, Math.min(msLeft, 2147483000) + 400);
}

function renderWSchedule(body, today) {
  const raw = (upDash() || {}).copilot, hasBlocks = !!(raw && Array.isArray(raw.blocks) && raw.blocks.length);
  const d = new Date(), min = d.getHours() * 60 + d.getMinutes(), secs = d.getSeconds();
  if (!hasBlocks) {
    sch.sig = ""; sch.drum = null; clearTimeout(sch.edge);
    return body.replaceChildren(h("div", { class: "sch-empty" },
      h("span", { class: "sch-ico", "aria-hidden": "true" }, ico("calendar")),
      h("strong", { text: "No hay horario" }),
      h("button", { type: "button", class: "secondary small", text: "Crear mi horario", onclick: () => openCopilotEditor() })));
  }
  const now = Logic.scheduleNow(raw, today, min);
  const sig = JSON.stringify([today, now.stages]);
  sch.nowIdx = now.index;
  if (sig !== sch.sig || !sch.drum || !body.contains(sch.drum)) {
    sch.sig = sig;
    schBuild(body, now.stages, now.index);
  } else {
    schPlace(now.index); // misma jornada: si la etapa cambió, el tambor gira hasta la nueva
  }
  // textos vivos de la etapa actual (avance y tiempo que queda)
  now.stages.forEach((s, i) => {
    const el = sch.els[i], cur = i === now.index;
    el.classList.toggle("is-now", cur);
    el.querySelector(".sch-bar").style.display = cur ? "" : "none";
    el.querySelector(".sch-left").textContent = cur ? (s.kind === "rest" ? `${schDur(now.leftMin)} para empezar el día` : `quedan ${schDur(now.leftMin)}`) : "";
    if (cur) el.querySelector(".sch-bar i").style.width = now.pct + "%";
  });
  const c = now.cur;
  if (sch.info) sch.info.textContent = c ? `Ahora: ${c.label}, ${Logic.minLabel(c.start)} a ${Logic.minLabel(Math.min(c.end, 1439))}, quedan ${schDur(now.leftMin)}.` : "";
  if (c) schArmEdge((c.end - min) * 60000 - secs * 1000);
}

$("#schEdit").addEventListener("click", () => openCopilotEditor());
WIDGET_RENDERERS.schedule = (b, t) => renderWSchedule(b, t);

// Sigue la hora sin que hagas nada: cada 20 s (progreso y minutos que quedan) y al volver a la pestaña o al Resumen
setInterval(() => { if (!document.hidden && currentPage === "dashboard") schRefresh(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentPage === "dashboard") schRefresh(); });
window.addEventListener("hashchange", () => setTimeout(() => { if (currentPage === "dashboard") schRefresh(); }, 60));
