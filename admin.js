/* Administración: solo para la cuenta de administrador (el servidor lo exige con is_admin(); esto es solo la pantalla).
 * Muestra RECUENTOS (tiempo de uso, módulos abiertos, número de registros). Nunca el contenido de tareas, notas ni gastos.
 * Necesita migracion-v11.sql. En modo invitado, con store «adminDemo» activado, enseña datos de ejemplo (para probar el diseño). */
const adminDemo = () => isGuest() && store.get("adminDemo", false) === true;
const adminActive = () => (!isGuest() && state.isAdmin === true) || adminDemo();

const adm = { tab: store.get("admTab", "resumen"), days: store.get("admDays", 14), users: [], daily: [], modules: [], size: null, survey: [], feedback: [], settings: null, loaded: false, loading: false, missing: false, error: "", filter: "all", q: "", open: new Set() };
const ADM_TABS = ["resumen", "usuarios", "uso", "opiniones", "ajustes"];

function admDemoData(days) {
  const t = todayKey(), base = Date.parse(t + "T12:00:00");
  const key = (n) => new Date(base - n * 86400000).toISOString().slice(0, 10);
  const mk = (email, lastN, s7, tot, d30, rows, extra = {}) => ({ user_id: email, email, created_at: key(40), last_sign_in_at: key(lastN), blocked: false, is_admin: false, seconds_7d: s7, seconds_total: tot, days_30: d30, last_day: lastN == null ? null : key(lastN), rows_count: rows, ...extra });
  const users = [
    mk("tu.correo@gmail.com", 0, 5400, 90000, 25, 120, { is_admin: true }),
    mk("lucia.m@gmail.com", 0, 13200, 80000, 24, 412), mk("carlos.r@outlook.com", 0, 7500, 52000, 19, 268), mk("ana.pf@gmail.com", 1, 4500, 30000, 14, 190),
    mk("dani.s@gmail.com", 6, 720, 9000, 6, 34), mk("marcos.t@yahoo.es", 21, 0, 1200, 2, 8, { blocked: true }), mk("sara.l@gmail.com", null, 0, 0, 0, 0),
  ];
  const daily = Array.from({ length: days }, (_, i) => { const n = days - 1 - i, a = 1 + ((i * 7 + 3) % 5), sec = a * (1500 + ((i * 13) % 9) * 220); return { day: key(n), active_users: a, seconds: sec }; });
  const modules = [["tasks", 41000, 5], ["habits", 33000, 5], ["finance", 21000, 4], ["timer", 12000, 3], ["journal", 8000, 2], ["plan", 2500, 1], ["dashboard", 18000, 6], ["app", 0, 6]].map(([module, seconds, u]) => ({ module, seconds, users: u }));
  const survey = [{ id: "1", answer: "Más funciones", comment: "Me gustaría exportar los hábitos.", page: "habits", created_at: new Date(base - 2 * 86400000).toISOString() }, { id: "2", answer: "Que sea más claro", comment: "", page: "plan", created_at: new Date(base - 5 * 86400000).toISOString() }, { id: "3", answer: "Más funciones", comment: "", page: "finance", created_at: new Date(base - 6 * 86400000).toISOString() }];
  return { users, daily, modules, size: 14.2 * 1048576, survey, feedback: [], settings: { ...Usage.DEFAULT_SURVEY } };
}

const admMissing = (e) => e && (e.code === "42883" || e.code === "PGRST202" || e.code === "42P01" || /could not find the function|does not exist/i.test(e.message || ""));

async function admLoad() {
  if (adm.loading) return;
  adm.loading = true; adm.error = ""; adm.missing = false; renderAdmin();
  try {
    if (adminDemo()) { Object.assign(adm, admDemoData(adm.days)); adm.loaded = true; return; }
    const [u, d, m, sz, sv, st, fb] = await Promise.all([
      db.rpc("admin_users"), db.rpc("admin_usage_daily", { p_days: adm.days }), db.rpc("admin_module_usage", { p_days: adm.days }), db.rpc("admin_db_size"),
      db.from("survey_responses").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("app_settings").select("value").eq("key", "survey").limit(1),
      realDb ? realDb.from("feedback").select("*").order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    ]);
    const bad = [u, d, m].find((r) => r.error);
    if (bad) { if (admMissing(bad.error)) adm.missing = true; else adm.error = Logic.dataErrorText(bad.error); return; }
    adm.users = u.data || []; adm.daily = (d.data || []).map((r) => ({ ...r, day: String(r.day).slice(0, 10) })); adm.modules = m.data || [];
    adm.users.forEach((x) => { if (x.last_day) x.last_day = String(x.last_day).slice(0, 10); });
    adm.size = sz.error ? null : Number(sz.data);
    adm.survey = sv.error ? [] : sv.data || [];
    adm.settings = { ...Usage.DEFAULT_SURVEY, ...((st.data && st.data[0] && st.data[0].value) || {}) };
    adm.feedback = fb.error ? [] : fb.data || [];
    adm.loaded = true;
  } catch (e) { console.error(e); adm.error = "No se pudieron cargar los datos. Inténtalo de nuevo."; }
  finally { adm.loading = false; renderAdmin(); }
}

/* ---------- Piezas ---------- */
const admStat = (icon, cls, val, label) => h("div", { class: "pl-stat" }, h("span", { class: "pl-ico " + cls }, ico(icon)), h("div", {}, h("strong", { text: val }), h("small", { text: label })));
const admPanel = (title, note, ...kids) => h("section", { class: "panel adm-panel" }, h("div", { class: "panel-head" }, h("div", {}, h("h3", { text: title }), note ? h("p", { text: note }) : null)), ...kids);
const admBar = (pct, cls = "") => h("div", { class: "adm-bar " + cls, role: "presentation" }, h("span", { style: `width:${Math.max(2, Math.min(100, pct))}%` }));
const admAvatar = (email) => h("i", { class: "adm-av", "aria-hidden": "true", text: Logic.adminName(email).charAt(0) });
function admSize(b) { return b == null ? "—" : b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB"; }

function admChart(daily) {
  const max = Math.max(1, ...daily.map((d) => d.active_users));
  const dn = (k) => "DLMXJVS"[new Date(k + "T12:00:00").getDay()];
  return h("div", { class: "adm-chart", role: "img", "aria-label": `Usuarios activos por día, últimos ${daily.length} días` },
    ...daily.map((d) => h("div", { class: "adm-col", title: `${Logic.shortDate(d.day)} · ${d.active_users} activos · ${Logic.adminTime(d.seconds)}` },
      h("span", { class: "adm-colbar" + (d.active_users ? "" : " zero"), style: `height:${Math.max(4, (d.active_users / max) * 100)}%` }), daily.length <= 16 ? h("small", { text: dn(d.day) }) : null)));
}
function admModules(mods) {
  const list = mods.filter((m) => m.module !== "app").sort((a, b) => b.seconds - a.seconds);
  const max = Math.max(1, ...list.map((m) => m.seconds));
  if (!list.length) return h("p", { class: "muted", text: "Todavía no hay uso medido." });
  return h("div", { class: "adm-mods" }, ...list.map((m, i) => h("div", { class: "adm-mod" }, h("span", { text: Logic.MODULE_LABEL(m.module) }), admBar((m.seconds / max) * 100, "c" + (i % 5)), h("small", { text: `${Logic.adminTime(m.seconds)} · ${m.users} ${m.users === 1 ? "persona" : "personas"}` }))));
}
const KIND_LABEL = { dato: "Dato", patron: "Patrón", hipotesis: "Hipótesis" };
function admInsights() {
  const list = Logic.adminInsights({ users: adm.users, daily: adm.daily, modules: adm.modules, today: todayKey() });
  return h("div", { class: "adm-ins" }, ...list.map((i) => h("div", { class: "adm-in " + i.kind }, h("span", { class: "adm-kind", text: KIND_LABEL[i.kind] }), h("div", {}, h("p", { text: i.text }), h("small", { text: i.note })))));
}

/* ---------- Pestañas ---------- */
function admResumen() {
  const st = Logic.adminStats(adm.users, adm.daily, todayKey());
  return [
    h("div", { class: "pl-stats adm-stats", role: "group", "aria-label": "Cifras clave" },
      admStat("habit", "", String(st.friends), st.friends === 1 ? "usuario" : "usuarios"),
      admStat("check", "mint", String(st.activeToday), "activos hoy"),
      admStat("timer", "peach", Logic.adminTime(st.avgSecPerActive), "al día por persona activa"),
      admStat("cloud", "", admSize(adm.size), "base de datos")),
    h("div", { class: "adm-grid" },
      admPanel("Usuarios activos por día", `Últimos ${adm.daily.length} días`, admChart(adm.daily), h("h4", { class: "adm-sub", text: "Lo que se usa más" }), admModules(adm.modules)),
      admPanel("Lo que he observado", "Separo lo confirmado de lo que solo parece", admInsights())),
  ];
}

function admRow(u) {
  const today = todayKey(), status = Logic.adminStatus(u, today), open = adm.open.has(u.user_id);
  const toggle = h("button", { type: "button", class: "secondary small", "aria-expanded": String(open), onclick: () => { open ? adm.open.delete(u.user_id) : adm.open.add(u.user_id); renderAdmin(); }, text: open ? "Cerrar" : "Ver" });
  const act = u.is_admin ? null : h("button", { type: "button", class: "small " + (u.blocked ? "secondary" : "danger-ghost"), onclick: () => admPause(u), text: u.blocked ? "Reactivar" : "Pausar" });
  const rows = [h("tr", { class: "adm-tr " + status },
    h("td", {}, h("div", { class: "adm-who" }, admAvatar(u.email), h("div", {}, h("b", { text: Logic.adminName(u.email) }), h("small", { text: u.email })))),
    h("td", { class: "adm-hide", text: Logic.adminLastSeen(u, today) }),
    h("td", {}, admBar(Math.min(100, (u.seconds_7d / 14400) * 100)), h("small", { text: Logic.adminTime(u.seconds_7d) })),
    h("td", { class: "adm-hide", text: String(u.rows_count) }),
    h("td", {}, h("em", { class: "adm-pill " + status, text: Logic.ADMIN_STATUS_LABEL[status] })),
    h("td", { class: "adm-act" }, toggle, act))];
  if (open) rows.push(h("tr", { class: "adm-detail" }, h("td", { colspan: "6" }, h("dl", {},
    ...[["Cuenta creada", Logic.shortDate(String(u.created_at).slice(0, 10))], ["Último acceso", u.last_sign_in_at ? Logic.shortDate(String(u.last_sign_in_at).slice(0, 10)) : "—"], ["Tiempo total", Logic.adminTime(u.seconds_total)], ["Días activos (30 d)", String(u.days_30)], ["Registros guardados", String(u.rows_count)]]
      .map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))))));
  return rows;
}
async function admPause(u) {
  const pausing = !u.blocked;
  const ok = await askConfirm(pausing
    ? { title: `¿Pausar a ${Logic.adminName(u.email)}?`, text: "No podrá entrar a sus datos hasta que lo reactives. No se borra nada.", confirmLabel: "Pausar", danger: true }
    : { title: `¿Reactivar a ${Logic.adminName(u.email)}?`, text: "Volverá a tener acceso a todo lo suyo.", confirmLabel: "Reactivar" });
  if (!ok) return;
  if (adminDemo()) { u.blocked = pausing; toast(pausing ? "Pausado (demo)." : "Reactivado (demo)."); return renderAdmin(); }
  const { error } = await db.rpc("admin_set_blocked", { p_user: u.user_id, p_blocked: pausing, p_reason: "" });
  if (error) return toast(error.message || "No se pudo cambiar.", 5000);
  u.blocked = pausing; toast(pausing ? "Cuenta pausada." : "Cuenta reactivada."); renderAdmin();
}
function admUsuarios() {
  const today = todayKey(), q = adm.q.trim().toLowerCase();
  const F = [["all", "Todos"], ["active", "Activos"], ["inactive", "Inactivos"], ["paused", "Pausados"]];
  const list = adm.users.filter((u) => (adm.filter === "all" || Logic.adminStatus(u, today) === adm.filter) && (!q || u.email.toLowerCase().includes(q)));
  const search = h("input", { type: "search", class: "adm-search", placeholder: "Buscar por correo", value: adm.q, "aria-label": "Buscar usuario", oninput: (e) => { adm.q = e.target.value; const pos = e.target.selectionStart; renderAdmin(); const i = $(".adm-search"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
  const chips = h("div", { class: "seg", role: "group", "aria-label": "Filtrar por estado" }, ...F.map(([k, l]) => h("button", { type: "button", class: adm.filter === k ? "active" : "", "aria-pressed": String(adm.filter === k), onclick: () => { adm.filter = k; renderAdmin(); }, text: l })));
  const table = list.length ? h("table", { class: "adm-table" },
    h("thead", {}, h("tr", {}, h("th", { text: "Persona" }), h("th", { class: "adm-hide", text: "Última vez" }), h("th", { text: "Esta semana" }), h("th", { class: "adm-hide", text: "Registros" }), h("th", { text: "Estado" }), h("th"))),
    h("tbody", {}, ...list.flatMap(admRow))) : h("p", { class: "empty-state", text: "Nadie coincide con ese filtro." });
  return [h("div", { class: "adm-tools" }, search, chips), admPanel("Usuarios", `${list.length} de ${adm.users.length}`, table),
    h("p", { class: "muted adm-note", text: "Pausar bloquea el acceso a sus datos pero no borra nada; puedes reactivarla cuando quieras. A un administrador no se le puede pausar." })];
}
function admUso() {
  const tot = adm.daily.reduce((n, d) => n + d.seconds, 0), peak = adm.daily.reduce((m, d) => (d.active_users > m.active_users ? d : m), { active_users: 0 });
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Periodo" }, ...[7, 14, 30].map((n) => h("button", { type: "button", class: adm.days === n ? "active" : "", "aria-pressed": String(adm.days === n), onclick: () => { adm.days = n; store.set("admDays", n); admLoad(); }, text: `${n} días` })));
  return [h("div", { class: "adm-tools" }, seg),
    h("div", { class: "pl-stats adm-stats" }, admStat("timer", "peach", Logic.adminTime(tot), `de uso en ${adm.days} días`), admStat("habit", "", String(peak.active_users || 0), peak.day ? `máximo de activos · ${Logic.shortDate(peak.day)}` : "máximo de activos")),
    h("div", { class: "adm-grid" }, admPanel("Actividad", `Personas activas por día`, admChart(adm.daily)), admPanel("Por apartado", "Tiempo y personas que lo han usado", admModules(adm.modules)))];
}
function admOpiniones() {
  const counts = {}; adm.survey.forEach((r) => { counts[r.answer] = (counts[r.answer] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const when = (iso) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  const summary = Object.keys(counts).length ? h("div", { class: "adm-mods" }, ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a, n], i) => h("div", { class: "adm-mod" }, h("span", { text: a }), admBar((n / max) * 100, "c" + (i % 5)), h("small", { text: String(n) })))) : h("p", { class: "muted", text: "Aún no ha respondido nadie. La pregunta aparece de vez en cuando, tras unos días de uso." });
  const list = adm.survey.filter((r) => r.comment).map((r) => h("div", { class: "adm-op" }, h("div", {}, h("b", { text: r.answer }), h("small", { text: ` · ${when(r.created_at)}${r.page ? " · " + Logic.MODULE_LABEL(r.page) : ""}` })), h("p", { text: r.comment })));
  const fb = adm.feedback.map((r) => h("div", { class: "adm-op" }, h("div", {}, h("b", { text: "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0)) }), h("small", { text: ` · ${when(r.created_at)}${r.guest ? " · invitado" : ""}` })), h("p", { text: r.message })));
  return [admPanel("Qué mejorarían", `${adm.survey.length} ${adm.survey.length === 1 ? "respuesta" : "respuestas"} de la pregunta rápida`, summary),
    list.length ? admPanel("Comentarios", null, ...list) : null,
    fb.length ? admPanel("Feedback del modo invitado", "Desde el botón «Dar feedback»", ...fb) : null].filter(Boolean);
}
function admAjustes() {
  const s = adm.settings || { ...Usage.DEFAULT_SURVEY };
  const en = h("input", { type: "checkbox", id: "svOn" }); en.checked = s.enabled !== false;
  const every = h("select", { id: "svEvery", "aria-label": "Cada cuántos días" }, ...[7, 14, 30, 60].map((n) => h("option", { value: String(n), text: `Cada ${n} días` })));
  every.value = String(s.every_days);
  const minD = h("select", { id: "svMin", "aria-label": "Tras cuántos días de uso" }, ...[3, 5, 10, 20].map((n) => h("option", { value: String(n), text: `Tras ${n} días de uso` })));
  minD.value = String(s.min_days);
  const q = h("input", { type: "text", id: "svQ", maxlength: 120, value: s.question, "aria-label": "Pregunta" });
  const opts = h("textarea", { id: "svOpts", rows: 5, "aria-label": "Opciones, una por línea" }); opts.value = (s.options || []).join("\n");
  const save = async () => {
    const options = opts.value.split("\n").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
    const value = { enabled: en.checked, every_days: Number(every.value), min_days: Number(minD.value), question: q.value.trim().slice(0, 120) || Usage.DEFAULT_SURVEY.question, options: options.length ? options : Usage.DEFAULT_SURVEY.options };
    if (adminDemo()) { adm.settings = value; return toast("Guardado (demo)."); }
    const { error } = await db.from("app_settings").upsert({ key: "survey", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return toast(error.message || "No se pudo guardar.", 5000);
    adm.settings = value; toast("Ajustes guardados.");
  };
  return [admPanel("Pregunta suave", "Un aviso pequeño, nunca en medio de nada: se puede cerrar o silenciar para siempre",
    h("label", { class: "check" }, en, " Activada"),
    h("div", { class: "adm-form" }, h("label", { class: "field" }, h("span", { class: "muted", text: "Frecuencia" }), every), h("label", { class: "field" }, h("span", { class: "muted", text: "Empezar" }), minD)),
    h("label", { class: "field" }, h("span", { class: "muted", text: "Pregunta" }), q),
    h("label", { class: "field" }, h("span", { class: "muted", text: "Opciones (una por línea)" }), opts),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary-btn", onclick: save, text: "Guardar" }), h("button", { type: "button", class: "secondary", onclick: () => Usage.showSurvey(), text: "Ver cómo se ve" }))),
    admPanel("Qué se mide", null, h("ul", { class: "honest" },
      h("li", { text: "Solo segundos de uso al día, cuántas veces se abre la app y cuánto tiempo en cada apartado." }),
      h("li", { text: "Nunca el contenido de nadie: ni tareas, ni notas, ni gastos. Solo cuántos registros hay." }),
      h("li", { text: "El modo invitado no se mide: sus datos viven solo en su navegador." }),
      h("li", { text: "Cada persona lo ve explicado en sus Preferencias." })))];
}

/* ---------- Pintado ---------- */
function setAdmTab(t) { adm.tab = ADM_TABS.includes(t) ? t : "resumen"; store.set("admTab", adm.tab); renderAdmin(); }
function renderAdmin() {
  const on = adminActive();
  $$("[data-admin]").forEach((a) => a.classList.toggle("hidden", !on));
  if (!on && currentPage === "admin") { location.hash = "#/dashboard"; return; }
  if (currentPage !== "admin" || !on) return;
  $$("#admTabs button").forEach((b) => { const a = b.dataset.tab === adm.tab; b.classList.toggle("active", a); b.setAttribute("aria-selected", String(a)); });
  const body = $("#admBody");
  if (!adm.loaded && !adm.loading && !adm.missing && !adm.error) { admLoad(); return; }
  if (adm.loading && !adm.loaded) return body.replaceChildren(h("div", { class: "w-state loading" }, h("i", { class: "w-skel" }), h("i", { class: "w-skel short" })));
  if (adm.missing) return body.replaceChildren(h("p", { class: "empty-state", text: "Falta actualizar la base de datos: ejecuta multiusuario.sql y después migracion-v11.sql en Supabase, y recarga." }));
  if (adm.error) return body.replaceChildren(h("p", { class: "empty-state", text: adm.error }), h("button", { type: "button", class: "secondary", onclick: () => { adm.error = ""; admLoad(); }, text: "Reintentar" }));
  const parts = { resumen: admResumen, usuarios: admUsuarios, uso: admUso, opiniones: admOpiniones, ajustes: admAjustes }[adm.tab]();
  body.replaceChildren(...parts);
}
$$("#admTabs button").forEach((b) => b.addEventListener("click", () => setAdmTab(b.dataset.tab)));
$("#admRefresh").addEventListener("click", () => { adm.loaded = false; adm.missing = false; admLoad(); });
let admSeen = false;
renderers.push(() => { renderAdmin(); if (currentPage === "admin" && !admSeen) admSeen = true; if (currentPage !== "admin") admSeen = false; });
