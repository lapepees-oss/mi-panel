/* Uso de la app (solo cuentas reales, nunca el modo invitado):
 *  - mide tiempo de uso y módulo (SOLO segundos y nombre del apartado; nunca el contenido de nadie),
 *  - muestra «Acceso pausado» si el administrador ha pausado la cuenta,
 *  - ofrece, muy de vez en cuando, una pregunta suave de mejora (se puede descartar y no volver a preguntar).
 * Si migracion-v11.sql no está ejecutada, todo esto se desactiva en silencio. */
const Usage = (() => {
  const TICK_MS = 15000, FLUSH_MS = 60000, IDLE_MS = 60000;
  const DEFAULT_SURVEY = {
    enabled: true, every_days: 14, min_days: 5,
    question: "¿Qué mejorarías de Cloudspace?",
    options: ["Que vaya más rápido", "Más funciones", "Que sea más claro", "Que se vea mejor", "Otra cosa"],
  };
  let off = false, startedFor = null, pending = {}, lastTouch = Date.now(), lastTick = Date.now(), opened = false;
  let blockedEl = null, surveyEl = null, settings = null;

  const active = () => !!user && !isGuest() && !off && !!db;
  const touch = () => { lastTouch = Date.now(); };
  ["pointerdown", "keydown", "scroll", "touchstart", "wheel"].forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));

  function tick() {
    const now = Date.now(), dt = Math.min(Math.round((now - lastTick) / 1000), 30);
    lastTick = now;
    if (!active() || document.visibilityState !== "visible" || now - lastTouch > IDLE_MS || blockedEl) return;
    const mod = typeof currentPage === "string" ? currentPage.replace(/[^a-z]/g, "").slice(0, 16) || "otro" : "otro";
    pending[mod] = (pending[mod] || 0) + dt;
  }

  async function send(seconds, module, open) {
    try {
      const { error } = await db.rpc("track_usage", { p_seconds: seconds, p_module: module, p_open: open });
      if (error) { if (error.code === "42883" || error.code === "PGRST202" || /could not find the function/i.test(error.message || "")) off = true; return false; }
      return true;
    } catch (_) { return false; }
  }
  async function flush() {
    if (!active()) return;
    const work = pending; pending = {};
    for (const [mod, sec] of Object.entries(work)) if (sec > 0) { if (!(await send(sec, mod, false))) pending[mod] = (pending[mod] || 0) + sec; }
    if (!opened && !off) { opened = await send(0, "app", true); }
  }

  /* ---------- Cuenta pausada ---------- */
  function showBlocked(on) {
    if (!on) { if (blockedEl) { blockedEl.remove(); blockedEl = null; } return; }
    if (blockedEl) return;
    blockedEl = h("div", { class: "blocked-screen", role: "alertdialog", "aria-labelledby": "blockedTitle" },
      h("div", { class: "blocked-card" },
        h("span", { class: "blocked-ico" }, ico("cloud")),
        h("h2", { id: "blockedTitle", text: "Acceso pausado" }),
        h("p", { text: "El administrador ha pausado esta cuenta. Tus datos están a salvo y volverán cuando se reactive." }),
        h("button", { type: "button", class: "secondary", onclick: () => db.auth.signOut().catch(() => {}), text: "Cerrar sesión" })));
    document.body.append(blockedEl);
  }
  async function checkBlocked() {
    if (!active()) return;
    try {
      const { data, error } = await db.rpc("is_blocked");
      if (error) return;
      showBlocked(data === true);
    } catch (_) {}
  }

  /* ---------- Pregunta suave ---------- */
  const sKey = () => "survey." + (user ? user.id : "x");
  async function loadSettings() {
    try {
      const { data, error } = await db.from("app_settings").select("value").eq("key", "survey").limit(1);
      if (error) return { ...DEFAULT_SURVEY };
      return { ...DEFAULT_SURVEY, ...((data && data[0] && data[0].value) || {}) };
    } catch (_) { return { ...DEFAULT_SURVEY }; }
  }
  async function daysOfUse() {
    try {
      const { data, error } = await db.from("usage_daily").select("day");
      return error ? 0 : (data || []).length;
    } catch (_) { return 0; }
  }
  function dialogOpen() { return !!document.querySelector("dialog[open]") || !!blockedEl; }
  async function maybeAskSurvey() {
    if (!active() || surveyEl) return;
    const st = store.get(sKey(), {});
    if (st.never) return;
    settings = await loadSettings();
    if (!settings.enabled || !settings.options || !settings.options.length) return;
    if (st.last && Date.now() - st.last < settings.every_days * 86400000) return;
    if ((await daysOfUse()) < settings.min_days) return;
    if (dialogOpen() || document.visibilityState !== "visible") return;
    showSurvey();
  }
  function closeSurvey() { if (surveyEl) { surveyEl.classList.add("out"); const el = surveyEl; surveyEl = null; setTimeout(() => el.remove(), 220); } }
  function snooze(never) { store.set(sKey(), { ...store.get(sKey(), {}), last: Date.now(), never: !!never }); closeSurvey(); }
  function showSurvey() {
    let chosen = "";
    const note = h("textarea", { class: "sv-note", rows: 2, maxlength: 500, placeholder: "Cuéntanos más (opcional)", "aria-label": "Comentario opcional" });
    const sendBtn = h("button", { type: "button", class: "primary-btn small", disabled: true, text: "Enviar" });
    const chips = settings.options.map((o) => h("button", { type: "button", class: "sv-chip", text: o, "aria-pressed": "false",
      onclick: (e) => { chosen = o; chips.forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); sendBtn.disabled = false; } }));
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      let ok = false;
      try {
        const { error } = await db.from("survey_responses").insert({ answer: chosen.slice(0, 40), comment: note.value.trim().slice(0, 500), page: typeof currentPage === "string" ? currentPage.slice(0, 24) : null });
        ok = !error;
      } catch (_) {}
      if (!ok) { sendBtn.disabled = false; return toast("No se pudo enviar ahora. Prueba más tarde."); }
      store.set(sKey(), { ...store.get(sKey(), {}), last: Date.now() });
      toast("¡Gracias por contárnoslo!");
      closeSurvey();
    });
    surveyEl = h("aside", { class: "survey", role: "dialog", "aria-label": "Pregunta rápida" },
      h("div", { class: "sv-head" }, h("strong", { text: settings.question }),
        h("button", { type: "button", class: "sv-x", "aria-label": "Cerrar", title: "Ahora no", onclick: () => snooze(false) }, ico("x"))),
      h("div", { class: "sv-chips" }, ...chips), note,
      h("div", { class: "sv-foot" },
        h("button", { type: "button", class: "linklike", onclick: () => snooze(true), text: "No volver a preguntar" }), sendBtn));
    document.body.append(surveyEl);
  }

  /* ---------- Arranque por sesión ---------- */
  async function start() {
    if (!active() || startedFor === user.id) return;
    startedFor = user.id; opened = false; pending = {}; lastTick = Date.now();
    await checkBlocked();
    if (blockedEl) return;
    flush();
    setTimeout(maybeAskSurvey, 45000); // nunca nada más entrar
  }
  setInterval(tick, TICK_MS);
  let beat = 0;
  setInterval(() => { flush(); if (++beat % 5 === 0) checkBlocked(); }, FLUSH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { tick(); flush(); } else { lastTick = Date.now(); checkBlocked(); } });
  window.addEventListener("pagehide", () => { tick(); flush(); });
  renderers.push(() => { const pnl = $("#usagePanel"); if (pnl) pnl.classList.toggle("hidden", !(user && !isGuest())); if (user && !isGuest()) start(); else if (!user) { startedFor = null; showBlocked(false); closeSurvey(); } });

  return { hideSurvey: closeSurvey, flush, maybeAskSurvey, showSurvey: () => { settings = settings || { ...DEFAULT_SURVEY }; if (!surveyEl) showSurvey(); }, DEFAULT_SURVEY, showBlocked };
})();
