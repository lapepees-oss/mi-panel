"use strict";
// Barra lateral (solo escritorio). Tres estados: normal (ancho ajustable), compacta (solo iconos, 76 px) y oculta.
//  - Se ensancha o estrecha arrastrando su borde derecho; por debajo de ~150 px pasa a compacta;
//    arrastrada casi hasta el borde izquierdo, se oculta.
//  - El botón de la barra superior alterna normal <-> compacta, y desde oculta la vuelve a mostrar.
//  - El ancho y el estado se guardan en este navegador.

const SIDE_DEFAULT = 245, SIDE_RAIL = 76, SIDE_MAX = 380, SIDE_RAIL_BELOW = 150, SIDE_HIDE_BELOW = 36;
const sideApp = $(".app"), sideBar = $(".sidebar"), sideHandle = $("#sideResizer"), sideToggle = $("#sideToggle");
let sideState = (() => {
  const s = store.get("sidebar", {});
  const w = Number(s.w);
  return { w: Number.isFinite(w) && w >= SIDE_RAIL_BELOW ? Math.min(SIDE_MAX, w) : SIDE_DEFAULT, mode: ["normal", "rail", "hidden"].includes(s.mode) ? s.mode : "normal" };
})();

function applySide() {
  const mode = sideState.mode;
  const width = mode === "hidden" ? 0 : mode === "rail" ? SIDE_RAIL : sideState.w;
  document.documentElement.style.setProperty("--side-w", width + "px");
  sideApp.classList.toggle("side-rail", mode === "rail");
  sideApp.classList.toggle("side-hidden", mode === "hidden");
  document.body.classList.toggle("side-is-hidden", mode === "hidden");
  sideBar.toggleAttribute("inert", mode === "hidden");
  sideBar.setAttribute("aria-hidden", String(mode === "hidden"));
  const label = mode === "hidden" ? "Mostrar barra lateral" : mode === "rail" ? "Expandir barra lateral" : "Contraer barra lateral";
  sideToggle.title = label;
  sideToggle.setAttribute("aria-label", label);
  sideToggle.setAttribute("aria-expanded", String(mode === "normal"));
  sideToggle.classList.toggle("active", mode !== "normal");
  sideHandle.setAttribute("aria-valuenow", String(width));
  sideHandle.setAttribute("aria-valuemin", "0");
  sideHandle.setAttribute("aria-valuemax", String(SIDE_MAX));
  // En modo compacto los nombres van como ayuda al pasar el ratón
  $$(".nav a", sideBar).forEach((a) => {
    const text = a.querySelector("span") ? a.querySelector("span").textContent : "";
    if (mode === "rail") { a.title = text; a.setAttribute("aria-label", text); }
    else { a.removeAttribute("title"); a.removeAttribute("aria-label"); }
  });
}
function saveSide() { store.set("sidebar", { w: sideState.w, mode: sideState.mode }); }
function setSide(mode, w, persist = true) {
  sideState.mode = mode;
  if (w != null) sideState.w = Math.min(SIDE_MAX, Math.max(SIDE_RAIL_BELOW, Math.round(w)));
  applySide();
  if (persist) saveSide();
}
// Posición del puntero → estado
function sideFromX(x, persist) {
  if (x < SIDE_HIDE_BELOW) setSide("hidden", null, persist);
  else if (x < SIDE_RAIL_BELOW) setSide("rail", null, persist);
  else setSide("normal", x, persist);
}

sideToggle.addEventListener("click", () => {
  if (sideState.mode === "normal") setSide("rail");
  else setSide("normal");
});

sideHandle.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  sideHandle.setPointerCapture(e.pointerId);
  sideHandle.classList.add("dragging");
  document.body.classList.add("side-dragging");
  const left = sideApp.getBoundingClientRect().left;
  const startW = sideState.w; // el ancho "normal" que se recuerda si la barra acaba compacta u oculta
  const move = (ev) => sideFromX(ev.clientX - left, false);
  const up = () => {
    sideHandle.classList.remove("dragging");
    document.body.classList.remove("side-dragging");
    sideHandle.removeEventListener("pointermove", move);
    sideHandle.removeEventListener("pointerup", up);
    sideHandle.removeEventListener("pointercancel", up);
    if (sideState.mode !== "normal") sideState.w = startW;
    saveSide();
  };
  sideHandle.addEventListener("pointermove", move);
  sideHandle.addEventListener("pointerup", up);
  sideHandle.addEventListener("pointercancel", up);
});
sideHandle.addEventListener("dblclick", () => setSide("normal", SIDE_DEFAULT));
sideHandle.addEventListener("keydown", (e) => {
  const cur = sideState.mode === "rail" ? SIDE_RAIL : sideState.w;
  if (e.key === "ArrowRight") { e.preventDefault(); sideState.mode === "rail" ? setSide("normal", SIDE_RAIL_BELOW + 20) : setSide("normal", cur + 16); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); cur - 16 < SIDE_RAIL_BELOW ? setSide("rail") : setSide("normal", cur - 16); }
  else if (e.key === "Home") { e.preventDefault(); setSide("rail"); }
  else if (e.key === "Enter") { e.preventDefault(); setSide("normal", SIDE_DEFAULT); }
});

applySide();
