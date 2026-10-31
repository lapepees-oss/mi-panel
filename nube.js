"use strict";
// Tema «Nube» y detalles de navegación de CloudSpace:
//  - nubes sueltas en el fondo (solo con el tema Nube: el CSS las oculta en los demás)
//  - móvil: botón «+» central (abre las acciones rápidas), contador de tareas para hoy, barra que se esconde al bajar,
//    botón «Más» que muestra la sección en la que estás y mini cronómetro cuando hay una sesión en marcha
//  - PC: pulsar A dos veces rápido = apartado anterior; B dos veces = siguiente (nunca mientras escribes)
// No guarda datos nuevos en Supabase; la única preferencia (el atajo) va en este navegador.
(function () {
  /* ---------- Nubes del fondo ---------- */
  const CLOUDS = [["6vw", "12vh", 220, 1, 48, 0], ["68vw", "7vh", 300, 2, 62, -8], ["38vw", "30vh", 150, 1, 40, -20], ["84vw", "40vh", 200, 2, 55, -12], ["3vw", "56vh", 260, 2, 70, -30],
    ["50vw", "64vh", 330, 1, 66, -5], ["22vw", "84vh", 180, 2, 44, -18], ["88vw", "80vh", 140, 1, 52, -26], ["60vw", "22vh", 110, 1, 36, -14], ["14vw", "34vh", 120, 2, 58, -40]];
  const NS = "http://www.w3.org/2000/svg";
  const sky = document.createElement("div");
  sky.className = "cs-sky"; sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = `<div class="cs-stars"></div><svg width="0" height="0" style="position:absolute"><defs>
    <symbol id="cs-cl1" viewBox="0 0 120 60"><path d="M24 56a16 16 0 0 1-2.5-31.8A24 24 0 0 1 67 14.5 18 18 0 0 1 98 26a15 15 0 0 1-2 30z"/></symbol>
    <symbol id="cs-cl2" viewBox="0 0 120 60"><path d="M18 54a12 12 0 0 1-1-24 15 15 0 0 1 24-12 22 22 0 0 1 40 2 14 14 0 0 1 22 10 12 12 0 0 1-1 24z"/></symbol></defs></svg>` +
    CLOUDS.map(([l, t, w, k, d, dl]) => `<svg class="cs-puff" style="left:${l};top:${t};width:${w}px;--d:${d}s;--dl:${dl}s" viewBox="0 0 120 60"><use href="#cs-cl${k}"/></svg>`).join("");
  document.body.prepend(sky);

  const isNube = () => /^nube/.test(document.documentElement.dataset.theme || "");
  const mobile = () => matchMedia("(max-width: 760px)").matches;

  /* ---------- PC: con el tema Nube la barra lateral es la barra superior y nunca queda bloqueada ---------- */
  const side = $(".sidebar");
  function unlockSide() { if (side && isNube() && !mobile()) { side.removeAttribute("inert"); side.setAttribute("aria-hidden", "false"); } }
  new MutationObserver(unlockSide).observe(side || document.body, { attributes: true, attributeFilter: ["inert"] });
  new MutationObserver(() => { unlockSide(); if (typeof moveNavIndicator === "function") setTimeout(moveNavIndicator, 60); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- Móvil: contador de tareas para hoy (vencidas incluidas) ---------- */
  const badge = $("#bnBadge");
  function syncBadge() {
    if (!badge || !state || !Array.isArray(state.tasks)) return;
    const today = todayKey();
    const n = state.tasks.filter((t) => Logic.isOpen(t) && t.due_date && t.due_date <= today).length;
    badge.textContent = n > 9 ? "9+" : String(n); badge.hidden = !n;
    badge.setAttribute("aria-label", `${n} para hoy`);
  }

  /* ---------- Móvil: «Más» enseña la sección en la que estás ---------- */
  const moreBtn = $("#moreBtn"), moreDefault = moreBtn ? moreBtn.innerHTML : "";
  function syncMore() {
    if (!moreBtn) return;
    const link = $(`#moreMenu a[data-page="${currentPage}"]`);
    if (link) { const svg = link.querySelector("svg"); moreBtn.innerHTML = (svg ? svg.outerHTML : "") + `<span>${link.querySelector("span").textContent}</span>`; moreBtn.setAttribute("aria-label", `${link.querySelector("span").textContent} · más secciones`); }
    else { moreBtn.innerHTML = moreDefault; moreBtn.setAttribute("aria-label", "Más secciones"); }
  }

  /* ---------- Mini cronómetro (móvil) ---------- */
  const mini = document.createElement("div");
  mini.className = "cs-mini"; mini.hidden = true;
  mini.innerHTML = `<button type="button" class="cs-mini-go" aria-label="Abrir el cronómetro"><span class="cs-mini-ico">${ico("timer").outerHTML}</span><span class="cs-mini-l">En marcha</span><span class="cs-mini-t">00:00</span></button><button type="button" class="cs-mini-pause" aria-label="Pausar">${ico("pause").outerHTML}</button>`;
  document.body.appendChild(mini);
  mini.querySelector(".cs-mini-go").addEventListener("click", () => { location.hash = "#/timer"; });
  mini.querySelector(".cs-mini-pause").addEventListener("click", () => { const p = $("#timer-pause"); if (p && !p.disabled) p.click(); syncMini(); });
  function syncMini() {
    const t = state && state.timer, on = !!(t && t.running) && currentPage !== "timer" && mobile() && !!user;
    mini.hidden = !on; document.body.classList.toggle("has-mini", on);
    if (!on) return;
    const disp = $("#timer-display"); mini.querySelector(".cs-mini-t").textContent = disp ? disp.textContent.replace(/^00:/, "") : "";
    const mode = t.mode && typeof MODE_NAMES === "object" ? MODE_NAMES[t.mode] : ""; mini.querySelector(".cs-mini-l").textContent = mode || "En marcha";
  }
  setInterval(syncMini, 500);

  /* ---------- Móvil: la barra se esconde al bajar y vuelve al subir ---------- */
  let lastY = scrollY, lastRoute = 0;
  window.addEventListener("hashchange", () => { lastRoute = Date.now(); document.body.classList.remove("nav-hide"); });
  window.addEventListener("scroll", () => {
    const y = scrollY, d = y - lastY;
    if (Math.abs(d) < 6) return;
    if (Date.now() - lastRoute > 500) document.body.classList.toggle("nav-hide", mobile() && d > 0 && y > 120 && !document.querySelector("dialog[open]"));
    lastY = y;
  }, { passive: true });

  /* ---------- PC: atajo A A (anterior) / B B (siguiente) ---------- */
  const AB_KEY = "abNav", abOn = () => store.get(AB_KEY, true) !== false;
  const abBox = $("#abNavToggle");
  if (abBox) { abBox.checked = abOn(); abBox.addEventListener("change", () => { store.set(AB_KEY, abBox.checked); toast(abBox.checked ? "Atajo A A / B B activado" : "Atajo A A / B B desactivado"); }); }
  const hint = document.createElement("div"); hint.className = "cs-ab"; hint.setAttribute("aria-hidden", "true"); document.body.appendChild(hint);
  let last = { key: "", t: 0 }, hintT = 0;
  const order = () => $$(".sidebar .nav a[data-page]").filter((a) => !a.classList.contains("hidden")).map((a) => a.dataset.page).concat("prefs");
  const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (k !== "a" && k !== "b") { last.key = ""; return; }
    if (!abOn() || !user || mobile() || matchMedia("(pointer: coarse)").matches) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || typing(document.activeElement) || document.querySelector("dialog[open]")) return;
    const seq = order(), i = Math.max(0, seq.indexOf(currentPage)), target = seq[(i + (k === "a" ? -1 : 1) + seq.length) % seq.length];
    const name = PAGE_NAMES[target] || target, now = Date.now();
    if (last.key === k && now - last.t < 380) { last.key = ""; hint.classList.remove("on"); location.hash = "#/" + target; return; }
    last = { key: k, t: now };
    hint.classList.toggle("right", k === "b");
    hint.replaceChildren(...(k === "a" ? [h("kbd", { text: "A" }), ico("back"), h("span", { text: name })] : [h("span", { text: name }), ico("next"), h("kbd", { text: "B" })]));
    hint.classList.add("on"); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove("on"), 420);
  });

  renderers.push(() => { syncBadge(); syncMore(); syncMini(); unlockSide(); });
  window.addEventListener("resize", unlockSide);
  unlockSide();
})();
