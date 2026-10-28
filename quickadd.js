/* Acciones rápidas (botón «+» flotante) y panel «Más» de la barra inferior.
 * Reutilizan los formularios que ya existen; no crean nada por sí mismos. */
(function () {
  const fab = $("#qaFab"), qa = $("#qaMenu"), moreBtn = $("#moreBtn"), more = $("#moreMenu");
  if (!fab || !qa) return;
  const MORE_PAGES = ["journal", "timer", "plan", "intelligence", "admin"];

  const ACTIONS = [
    { icon: "euro", label: "Nuevo gasto", run: () => openTxWizard("expense"), main: true },
    { icon: "chart", label: "Nuevo ingreso", run: () => openTxWizard("income") },
    { icon: "task", label: "Nueva tarea", run: () => openTaskWizard() },
    { icon: "habit", label: "Nuevo hábito", run: () => openHabitForm() },
    { icon: "journal", label: "Nota", run: () => { location.hash = "#/journal"; setTimeout(() => { if (typeof setJournalTab === "function") setJournalTab("diario"); const t = $("#jFull"); if (t) t.focus(); }, 80); } },
    { icon: "bulb", label: "Soporte y feedback", run: () => openFeedback() },
  ];
  qa.replaceChildren(...ACTIONS.map((a) => h("button", { type: "button", role: "menuitem", class: "qa-item" + (a.main ? " is-main" : ""), onclick: () => { closeAll(); a.run(); } }, ico(a.icon), h("span", { text: a.label }))));

  function setOpen(menu, btn, on) {
    menu.hidden = !on; btn.setAttribute("aria-expanded", String(on));
    btn.classList.toggle("open", on);
  }
  function closeAll() { setOpen(qa, fab, false); if (more) setOpen(more, moreBtn, false); }
  fab.addEventListener("click", (e) => { e.stopPropagation(); const on = qa.hidden; closeAll(); setOpen(qa, fab, on); if (on) qa.querySelector("button").focus({ preventScroll: true }); });
  if (moreBtn) moreBtn.addEventListener("click", (e) => { e.stopPropagation(); const on = more.hidden; closeAll(); setOpen(more, moreBtn, on); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".qa-menu, .qa-fab, .nav-more")) closeAll(); else if (e.target.closest("#moreMenu a")) closeAll(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (!qa.hidden || (more && !more.hidden))) { closeAll(); fab.focus({ preventScroll: true }); } });
  window.addEventListener("hashchange", closeAll);

  /* «Más» se marca como activo cuando la página actual vive dentro de su panel */
  function syncMore() {
    /* En el móvil el Resumen es solo para mirar (sin «+»); en PC el botón se queda */
    const onDash = currentPage === "dashboard" && matchMedia("(max-width: 760px)").matches; fab.hidden = onDash; if (onDash) closeAll();
    if (!moreBtn) return;
    if (MORE_PAGES.includes(currentPage)) moreBtn.setAttribute("aria-current", "page"); else moreBtn.removeAttribute("aria-current");
    if (typeof moveNavIndicator === "function") moveNavIndicator();
  }
  renderers.push(syncMore);
  matchMedia("(max-width: 760px)").addEventListener("change", syncMore);
  window.addEventListener("hashchange", () => setTimeout(syncMore, 0));
})();
