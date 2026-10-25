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

function renderPrefs() {
  $("#prefsEmail").textContent = user ? `Sesión iniciada como ${user.email}` : "";
  const n = state.transactions.length + state.tasks.length + state.habits.length;
  $("#exportInfo").textContent = `Ahora mismo: ${plural(state.tasks.length, "tarea", "tareas")}, ${plural(state.habits.length, "hábito", "hábitos")}, ${plural(state.transactions.length, "movimiento", "movimientos")}, ${plural(state.journal.length, "nota", "notas")}.` + (n ? "" : " Aún no hay datos.");
}
renderers.push(renderPrefs);
