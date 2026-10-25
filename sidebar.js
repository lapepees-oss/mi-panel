"use strict";
// Barra lateral (solo escritorio): se ensancha arrastrando el borde; muy estrecha pasa a modo iconos; se puede ocultar.
// El ancho y si está oculta se guardan en este navegador.

const SIDE_DEFAULT = 245, SIDE_MIN = 72, SIDE_MAX = 380, SIDE_RAIL_BELOW = 150;
const sideApp = $(".app"), sideBar = $(".sidebar"), sideHandle = $("#sideResizer");
let sideState = (() => {
  const s = store.get("sidebar", {});
  const w = Number(s.w);
  return { w: Number.isFinite(w) ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)) : SIDE_DEFAULT, hidden: !!s.hidden };
})();

function applySide() {
  const rail = !sideState.hidden && sideState.w < SIDE_RAIL_BELOW;
  const width = sideState.hidden ? 0 : rail ? SIDE_MIN : sideState.w;
  document.documentElement.style.setProperty("--side-w", width + "px");
  sideApp.classList.toggle("side-rail", rail);
  sideApp.classList.toggle("side-hidden", sideState.hidden);
  document.body.classList.toggle("side-is-hidden", sideState.hidden);
  show($("#sideShow"), sideState.hidden);
  sideHandle.setAttribute("aria-valuenow", String(width));
  sideHandle.setAttribute("aria-valuemin", String(SIDE_MIN));
  sideHandle.setAttribute("aria-valuemax", String(SIDE_MAX));
  // En modo iconos los nombres van como ayuda al pasar el ratón
  $$(".nav a", sideBar).forEach((a) => {
    const label = a.querySelector("span") ? a.querySelector("span").textContent : "";
    if (rail) { a.title = label; a.setAttribute("aria-label", label); }
    else { a.removeAttribute("title"); a.removeAttribute("aria-label"); }
  });
}
function saveSide() { store.set("sidebar", { w: sideState.w, hidden: sideState.hidden }); }
function setSideWidth(w, persist = true) {
  sideState.w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(w)));
  applySide();
  if (persist) saveSide();
}

sideHandle.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  sideHandle.setPointerCapture(e.pointerId);
  sideHandle.classList.add("dragging");
  document.body.classList.add("side-dragging");
  const left = sideApp.getBoundingClientRect().left;
  const move = (ev) => setSideWidth(ev.clientX - left, false);
  const up = () => {
    sideHandle.classList.remove("dragging");
    document.body.classList.remove("side-dragging");
    sideHandle.removeEventListener("pointermove", move);
    sideHandle.removeEventListener("pointerup", up);
    sideHandle.removeEventListener("pointercancel", up);
    saveSide();
  };
  sideHandle.addEventListener("pointermove", move);
  sideHandle.addEventListener("pointerup", up);
  sideHandle.addEventListener("pointercancel", up);
});
sideHandle.addEventListener("dblclick", () => setSideWidth(SIDE_DEFAULT));
sideHandle.addEventListener("keydown", (e) => {
  const cur = sideState.w < SIDE_RAIL_BELOW ? SIDE_MIN : sideState.w;
  if (e.key === "ArrowRight") { e.preventDefault(); setSideWidth(cur < SIDE_RAIL_BELOW ? SIDE_RAIL_BELOW + 20 : cur + 16); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); setSideWidth(cur - 16 < SIDE_RAIL_BELOW ? SIDE_MIN : cur - 16); }
  else if (e.key === "Home") { e.preventDefault(); setSideWidth(SIDE_MIN); }
  else if (e.key === "Enter") { e.preventDefault(); setSideWidth(SIDE_DEFAULT); }
});
$("#sideHide").addEventListener("click", () => { sideState.hidden = true; applySide(); saveSide(); $("#sideShow").focus(); });
$("#sideShow").addEventListener("click", () => { sideState.hidden = false; applySide(); saveSide(); });

applySide();
