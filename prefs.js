"use strict";
// Preferencias: tema (solo en este navegador), exportar JSON/CSV, importar desde Cloudspace y cerrar sesión.

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  store.set("theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f5f6fb" : "#0c0d14");
  const use = document.querySelector("#themeToggle use");
  if (use) use.setAttribute("href", theme === "light" ? "#i-moon" : "#i-sun");
  $$('input[name="theme"]').forEach((r) => (r.checked = r.value === theme));
}

$$('input[name="theme"]').forEach((r) => r.addEventListener("change", () => r.checked && applyTheme(r.value)));
$("#themeToggle").addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
applyTheme(currentTheme());

/* ---------- Exportar ---------- */

function exportJson() {
  const backup = Logic.buildBackup({ state, prefs: { theme: currentTheme() } });
  downloadFile(`cloudspace-copia-${todayKey()}.json`, "application/json;charset=utf-8", JSON.stringify(backup, null, 2));
  toast("Copia JSON exportada.");
}

$("#exportJson").addEventListener("click", exportJson);
$("#exportCsvPrefs").addEventListener("click", () => $("#exportCsv").click());

/* ---------- Importar desde Cloudspace ---------- */

function existingForImport() {
  return {
    lists: state.lists, tasks: state.tasks, habits: state.habits, logs: state.logs,
    transactions: state.transactions, budgets: state.budgets, goals: state.goals, journal: state.journal,
  };
}

function showImportSummary(plan, sourceLabel) {
  const dlg = $("#sheet-dialog");
  const lines = [
    [plan.tasks.length, "tareas", plan.skipped.tasks],
    [plan.habits.length, "hábitos", plan.skipped.habits],
    [plan.habits.reduce((n, x) => n + x.days.length, 0), "días de hábitos", plan.skipped.habitDays],
    [plan.transactions.length, "movimientos", plan.skipped.transactions],
    [plan.journal.length, "notas del diario", 0],
  ];
  if (plan.budget) lines.push([1, "presupuesto mensual", 0]);
  if (plan.goal) lines.push([1, "meta de ahorro", 0]);
  const total = lines.reduce((n, l) => n + l[0], 0);
  const busy = { v: false };
  const confirmBtn = h("button", { type: "button", class: "primary-btn", text: "Importar", disabled: total === 0 });
  const cancel = h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => !busy.v && closeDialog(dlg) });
  confirmBtn.addEventListener("click", async () => {
    busy.v = true;
    confirmBtn.disabled = cancel.disabled = true;
    confirmBtn.textContent = "Importando…";
    try {
      await runImport(plan, todayKey());
      closeDialog(dlg);
      toast("Importación terminada.");
    } catch (_) {
      confirmBtn.textContent = "Reintentar";
      confirmBtn.disabled = cancel.disabled = false;
    }
    busy.v = false;
  });
  dlg.replaceChildren(
    h("div", { class: "sheet" },
      h("h2", { style: "margin-top:0", text: "Importar desde " + sourceLabel }),
      total === 0
        ? h("p", { class: "muted", text: "No hay nada nuevo que importar: todo lo del archivo ya existe." })
        : h("ul", {}, ...lines.filter((l) => l[0] > 0 || l[2] > 0).map((l) => h("li", { text: `${l[0]} ${l[1]}` + (l[2] ? ` (${l[2]} ya existían y se omiten)` : "") }))),
      ...(plan.warnings || []).map((w) => h("p", { class: "muted", text: "⚠ " + w })),
      h("div", { class: "row", style: "margin-top:14px;justify-content:flex-end" }, cancel, confirmBtn))
  );
  openDialog(dlg);
}

function startImport(obj, label) {
  try {
    const norm = Logic.parseCloudspaceBackup(obj);
    showImportSummary(Logic.planImport(norm, existingForImport(), todayKey()), label);
  } catch (e) {
    toast(e.message || "No se pudo leer el archivo.");
  }
}

$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return toast("El archivo es demasiado grande (máximo 20 MB).");
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch (_) {
    return toast("El archivo no es un JSON válido.");
  }
  startImport(obj, file.name);
});

const legacy = Logic.legacyFromStorage((k) => localStorage.getItem(k));
if (legacy) {
  show($("#importLocal"), true);
  $("#importLocal").addEventListener("click", () => startImport(Logic.legacyFromStorage((k) => localStorage.getItem(k)), "este navegador"));
}

/* ---------- Cuenta ---------- */

$("#prefsLogout").addEventListener("click", () => logout());
$("#prefsFeedback").addEventListener("click", () => openFeedback());

function renderPrefs() {
  $("#prefsEmail").textContent = user ? (isGuest() ? "Modo invitado: tus datos están solo en este navegador." : `Sesión iniciada como ${user.email}`) : "";
  const n = state.transactions.length + state.tasks.length + state.habits.length;
  $("#exportInfo").textContent = `Ahora mismo: ${plural(state.tasks.length, "tarea", "tareas")}, ${plural(state.habits.length, "hábito", "hábitos")}, ${plural(state.transactions.length, "movimiento", "movimientos")}, ${plural(state.journal.length, "nota", "notas")}.` + (n ? "" : " Aún no hay datos.");
}
renderers.push(renderPrefs);

/* ---------- Notificaciones ---------- */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
$("#pushHour").replaceChildren(...HOURS.map((hh) => h("option", { value: String(hh), text: String(hh).padStart(2, "0") + ":00" })));
let notifBusy = false;

async function renderNotifPrefs() {
  const prefs = notifPrefs();
  const supported = notifSupported();
  const granted = notifGranted();
  const denied = supported && Notification.permission === "denied";
  $("#notifStatus").textContent = !supported
    ? "Este navegador no admite notificaciones."
    : granted ? "Permiso concedido en este dispositivo."
    : denied ? "Bloqueadas en este navegador: permítelas en los ajustes del sitio (el candado junto a la dirección)."
    : "Todavía no has dado permiso.";
  show($("#notifEnable"), supported && !granted && !denied);
  $("#notifPhase").checked = prefs.phase;
  $("#notifProgress").checked = prefs.progress;
  [$("#notifPhase"), $("#notifProgress"), $("#notifTest")].forEach((el) => (el.disabled = !granted));

  // Push
  const configured = pushConfigured();
  show($("#pushBox"), true);
  const sub = configured && granted ? await currentPushSub().catch(() => null) : null;
  const settings = configured && user ? notifSettings || (await loadNotifSettings()) : null;
  $("#pushEnable").checked = !!sub;
  $("#pushEnable").disabled = !configured || !granted || notifBusy;
  $("#pushHint").textContent = !configured
    ? "Pendiente de configurar: falta VAPID_PUBLIC_KEY en config.js y la función en Supabase (mira el README)."
    : !granted ? "Primero permite las notificaciones."
    : settings === null ? "Falta ejecutar migracion-v4.sql en Supabase."
    : "Envío push desde tu Supabase.";
  const ready = configured && granted && !!sub && !!settings;
  $("#pushTimer").disabled = $("#pushDaily").disabled = $("#pushHour").disabled = !ready;
  $("#pushTimer").checked = ready ? !!settings.timer_enabled : false;
  $("#pushDaily").checked = ready ? !!settings.daily_enabled : false;
  $("#pushHour").value = String(settings ? settings.daily_hour : 8);
}

$("#notifEnable").addEventListener("click", async () => {
  const r = await requestNotifPermission();
  toast(r === "granted" ? "Notificaciones permitidas." : "No se concedió el permiso.");
  renderNotifPrefs();
});
$("#notifPhase").addEventListener("change", (e) => { store.set("notif", { ...notifPrefs(), phase: e.target.checked }); });
$("#notifProgress").addEventListener("change", (e) => {
  store.set("notif", { ...notifPrefs(), progress: e.target.checked });
  if (!e.target.checked) timerProgress(null);
});
$("#notifTest").addEventListener("click", async () => {
  const ok = await showSystem("Cloudspace", "Así se verán tus avisos.", { tag: "cloudspace-test" });
  toast(ok ? "Notificación enviada." : "No se pudo mostrar la notificación.");
});
$("#pushEnable").addEventListener("change", async (e) => {
  notifBusy = true;
  try {
    if (e.target.checked) { await enablePush(); await saveNotifSettings({}); toast("Avisos con la app cerrada activados."); }
    else { await disablePush(); toast("Avisos con la app cerrada desactivados."); }
  } catch (err) {
    toast(err && err.message ? err.message : "No se pudo cambiar el envío push.");
  }
  notifBusy = false;
  renderNotifPrefs();
});
$("#pushTimer").addEventListener("change", (e) => saveNotifSettings({ timer_enabled: e.target.checked }).catch(() => toast("No se pudo guardar.")));
$("#pushDaily").addEventListener("change", (e) => saveNotifSettings({ daily_enabled: e.target.checked }).catch(() => toast("No se pudo guardar.")));
$("#pushHour").addEventListener("change", (e) => saveNotifSettings({ daily_hour: Number(e.target.value) }).catch(() => toast("No se pudo guardar.")));
renderers.push(() => { if (!notifBusy) renderNotifPrefs(); });

/* ---------- Feedback recibido (solo el dueño, no el invitado) ---------- */

async function loadFeedback() {
  if (!user || isGuest()) return show($("#feedbackPanel"), false);
  let rows = null;
  try {
    const { data, error } = await realDb.from("feedback").select("*").order("created_at", { ascending: false }).limit(50);
    if (!error) rows = data;
  } catch (_) {}
  const panel = $("#feedbackPanel");
  if (rows === null) return show(panel, false); // tabla sin crear o sin permiso: no se muestra nada
  show(panel, true);
  $("#feedbackCaption").textContent = rows.length ? `Últimos ${plural(rows.length, "comentario", "comentarios")}.` : "Todavía no ha llegado ninguno.";
  $("#feedbackList").replaceChildren(
    ...rows.map((r) => h("div", { class: "feedback-item" },
      h("div", { class: "feedback-head" },
        h("b", { text: "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0)) }),
        h("span", { class: "muted", text: new Date(r.created_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) + (r.page ? " · " + r.page : "") + (r.guest ? " · invitado" : "") })),
      h("p", { text: r.message }),
      r.contact ? h("small", { class: "muted", text: "Contacto: " + r.contact }) : null))
  );
}
$("#feedbackReload").addEventListener("click", loadFeedback);
let feedbackLoadedFor = null;
renderers.push(() => { if (user && currentPage === "prefs" && feedbackLoadedFor !== user.id) { feedbackLoadedFor = user.id; loadFeedback(); } });
