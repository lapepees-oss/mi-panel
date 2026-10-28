"use strict";
// Copiloto del día y Máquina del tiempo (bloques del Resumen).
//  · Copiloto: SOLO PROPONE. Lee tareas y hábitos, calcula los huecos libres de hoy y enseña el porqué de cada paso.
//    Nada se crea, se mueve ni se borra sin pulsar un botón. Tu horario (clases, comidas…) vive en el diseño del Resumen
//    de tu usuario (user_prefs.dashboard.copilot); si hoy lo dejas pasar o quitas algo, queda en este dispositivo.
//  · Máquina del tiempo: SOLO LEE. Compara los últimos 30 días con los de hace 1 a 12 meses reconstruyéndolos con lo que ya
//    está guardado (Logic.timeTravel). No usa tablas nuevas.
// Se registran como bloques del Resumen en WIDGET_RENDERERS (widgets.js).

const cpRaw = () => (upDash() || {}).copilot;
const cpDay = () => { const s = store.get("copilot.day", null); return s && s.day === todayKey() && Array.isArray(s.skip) ? s : { day: todayKey(), mode: "", skip: [] }; };
const cpSaveDay = (s) => store.set("copilot.day", s);
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function cpRefresh() {
  const el = $('#dbBoard > .db-widget[data-widget="copilot"]');
  if (!el || el.classList.contains("is-off") || dataLoading()) return;
  const body = $(".wbody", el);
  if (body) renderWCopilot(body, todayKey());
}
// «Mi horario» y el Copiloto comparten los mismos bloques: al editarlos se repinta también el tambor
const cpRefreshAll = () => { cpRefresh(); if (typeof schRefresh === "function") schRefresh(); };

function cpRow(slot, today) {
  const time = `${Logic.minLabel(slot.start)}–${Logic.minLabel(slot.end)}`;
  const doneFn = slot.kind === "task" ? () => setStatus(slot.id, "done") : () => setHabitDay(slot.id, today, true);
  const skipFn = () => { const s = cpDay(); if (!s.skip.includes(slot.key)) s.skip.push(slot.key); cpSaveDay(s); cpRefresh(); };
  return h("li", { class: "w-cp-item " + slot.kind },
    h("span", { class: "w-cp-time", text: time }),
    h("div", { class: "w-cp-main" },
      h("a", { class: "w-link", href: slot.kind === "task" ? "#/tasks" : "#/habits", title: slot.title, text: slot.title }),
      h("small", { class: "muted", text: slot.why })),
    h("div", { class: "w-cp-act" },
      h("button", { type: "button", class: "secondary small", text: "Hecho", "aria-label": `Marcar «${slot.title}» como hecho`, onclick: doneFn }),
      h("button", { type: "button", class: "link-button", text: "Hoy no", "aria-label": `Quitar «${slot.title}» del plan de hoy`, onclick: skipFn })));
}

function cpFixedRow(b) {
  return h("li", { class: "w-cp-item fixed" },
    h("span", { class: "w-cp-time", text: `${Logic.minLabel(b.start)}–${Logic.minLabel(b.end)}` }),
    h("div", { class: "w-cp-main" }, h("span", { text: b.label }), h("small", { class: "muted", text: "Bloque fijo" })));
}

function renderWCopilot(body, today) {
  const st = cpDay(), nowMin = nowMinutes();
  const plan = Logic.planDay({ today, nowMin, tasks: state.tasks, habits: state.habits, byHabit: Logic.logsByHabit(state.logs), prefs: cpRaw(), skip: new Set(st.skip) });
  const wd = Logic.WEEKDAY_FULL[Logic.weekdayIndex(today)];
  const head = h("div", { class: "w-cp-head" }, h("strong", { text: `Hoy · ${wd}` }),
    h("span", { class: "badge" + (st.mode === "accepted" ? " today" : ""), text: st.mode === "accepted" ? "Plan de hoy" : st.mode === "skipped" ? "Sin plan" : "Propuesta" }));

  if (st.mode === "skipped") {
    return body.replaceChildren(h("div", { class: "w-cp", title: why }, head,
      h("p", { class: "muted", text: "Hoy lo dejas libre. No pasa nada: mañana habrá otra propuesta." }),
      h("button", { type: "button", class: "secondary small", text: "Ver la propuesta de hoy", onclick: () => { cpSaveDay({ ...st, mode: "" }); cpRefresh(); } })));
  }

  // Cierre del día (a partir de las 20:00): solo ofrece opciones, no cambia nada solo
  const pend = state.tasks.filter((t) => Logic.isOpen(t) && t.due_date && t.due_date <= today);
  const evening = nowMin >= 20 * 60 && pend.length
    ? h("div", { class: "w-cp-close" },
        h("p", { class: "muted", text: `${plural(pend.length, "tarea queda", "tareas quedan")} con fecha de hoy o anterior. Sin prisa: elige qué hacer.` }),
        h("div", { class: "row" },
          h("button", { type: "button", class: "secondary small", text: "Pasar a mañana", onclick: () => cpMoveTomorrow(pend, today) }),
          h("span", { class: "muted", text: "o déjalas como están." })))
    : null;

  const rows = [...plan.slots.map((s) => ({ at: s.start, el: cpRow(s, today) })), ...plan.fixed.filter((b) => b.end > nowMin).map((b) => ({ at: b.start, el: cpFixedRow(b) }))]
    .sort((a, b) => a.at - b.at).map((r) => r.el);

  const pct = plan.freeMin ? Math.round((plan.used / plan.freeMin) * 100) : 0;
  const why = plan.freeMin
    ? `Primero lo vencido y lo de hoy, después hábitos. Ocupo ${Logic.formatDuration(plan.used * 60000)} de ${Logic.formatDuration(plan.freeMin * 60000)} libres (${pct} %; tu límite es ${plan.prefs.fill} %).`
    : "Hoy no queda tiempo libre dentro de tu horario.";

  const left = plan.left.length
    ? h("details", { class: "w-cp-left" }, h("summary", { text: `Fuera del plan de hoy (${plan.left.length})` }),
        h("ul", { class: "w-list tight" }, ...plan.left.slice(0, 8).map((l) => h("li", {}, h("span", { text: l.title }), h("small", { class: "muted", text: l.reason })))))
    : null;

  const empty = !plan.slots.length
    ? h("p", { class: "muted", text: plan.candidates ? "Hoy no cabe nada más dentro de tu horario." : "No hay nada urgente para hoy. Puedes aprovechar para lo que quieras." })
    : null;

  body.replaceChildren(h("div", { class: "w-cp", title: why }, head,
    rows.length ? h("ul", { class: "w-cp-list" }, ...rows) : null, empty,
    plan.freeMin ? null : h("p", { class: "muted small", text: why }), left, evening,
    h("div", { class: "row w-cp-foot" },
      st.mode === "accepted"
        ? h("button", { type: "button", class: "secondary small", text: "Rehacer", onclick: () => { cpSaveDay({ ...st, mode: "", skip: [] }); cpRefresh(); } })
        : h("button", { type: "button", class: "primary-btn small", text: "Usar este plan", disabled: !plan.slots.length, onclick: () => { cpSaveDay({ ...st, mode: "accepted" }); cpRefresh(); toast("Plan de hoy guardado en este dispositivo."); } }),
      h("button", { type: "button", class: "secondary small", text: "Cambiar horario", onclick: openCopilotEditor }),
      st.mode === "accepted" ? null : h("button", { type: "button", class: "link-button", text: "Hoy no", onclick: () => { cpSaveDay({ ...st, mode: "skipped" }); cpRefresh(); } }))));
}

async function cpMoveTomorrow(list, today) {
  const tomorrow = Logic.addDays(today, 1), n = Math.min(list.length, 30);
  const ok = await askConfirm({ title: `¿Pasar ${plural(n, "tarea", "tareas")} a mañana?`, text: "Solo cambia su fecha de vencimiento a mañana. Puedes volver a cambiarla cuando quieras.", confirmLabel: "Pasar a mañana" });
  if (!ok) return;
  for (const t of list.slice(0, n)) await patchTask(t.id, { due_date: tomorrow });
  toast("Listo: pasadas a mañana.");
}

/* ---------- Editor de «Mi horario» ---------- */
const cpTimeStr = (m) => Logic.minLabel(Math.min(m, 1439));
const cpParse = (v, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };

function openCopilotEditor() {
  const dlg = $("#sheet-dialog"), cur = Logic.copilotPrefs(cpRaw());
  let blocks = cur.blocks.map((b) => ({ ...b, days: [...b.days] }));
  const start = h("input", { type: "time", value: cpTimeStr(cur.start), "aria-label": "Hora de inicio del día" });
  const end = h("input", { type: "time", value: cpTimeStr(cur.end), "aria-label": "Hora de fin del día" });
  const fillOut = h("output", { text: `${cur.fill} %` });
  const fill = h("input", { type: "range", min: "10", max: "100", step: "5", value: String(cur.fill), "aria-label": "Cuánto del tiempo libre se puede llenar", oninput: () => { fillOut.textContent = fill.value + " %"; } });
  const taskMin = h("input", { type: "number", min: "5", max: "240", step: "5", value: String(cur.taskMin), "aria-label": "Minutos que se reservan por tarea" });
  const habitMin = h("input", { type: "number", min: "5", max: "120", step: "5", value: String(cur.habitMin), "aria-label": "Minutos que se reservan por hábito" });
  const list = h("div", { class: "cp-blocks" });

  const drawBlocks = () => list.replaceChildren(...(blocks.length ? blocks : [null]).map((b, i) => {
    if (!b) return h("p", { class: "muted", text: "Sin bloques todavía. Añade tus clases, comidas o lo que ocupe tu tiempo." });
    const label = h("input", { type: "text", maxlength: "40", value: b.label, placeholder: "Clases", "aria-label": "Nombre del bloque", oninput: () => { b.label = label.value; } });
    const from = h("input", { type: "time", value: cpTimeStr(b.start), "aria-label": "Desde", onchange: () => { b.start = cpParse(from.value, b.start); } });
    const to = h("input", { type: "time", value: cpTimeStr(b.end), "aria-label": "Hasta", onchange: () => { b.end = cpParse(to.value, b.end); } });
    const chips = Logic.WEEKDAY_SHORT.map((d, di) => {
      const btn = h("button", { type: "button", class: "cp-day" + (b.days.includes(di) ? " on" : ""), text: d, "aria-pressed": String(b.days.includes(di)), "aria-label": Logic.WEEKDAY_FULL[di],
        onclick: () => { b.days = b.days.includes(di) ? b.days.filter((x) => x !== di) : [...b.days, di].sort((x, y) => x - y); btn.classList.toggle("on", b.days.includes(di)); btn.setAttribute("aria-pressed", String(b.days.includes(di))); } });
      return btn;
    });
    return h("div", { class: "cp-block" }, label, h("div", { class: "cp-days" }, ...chips), h("div", { class: "cp-inline" }, from, h("span", { text: "a" }), to,
      h("button", { type: "button", class: "link-button", text: "Quitar", "aria-label": `Quitar el bloque ${b.label}`, onclick: () => { blocks = blocks.filter((x) => x !== b); drawBlocks(); } })));
  }));
  drawBlocks();

  const save = () => {
    const prefs = Logic.copilotPrefs({ start: cpParse(start.value, 480), end: cpParse(end.value, 1320) || 1320, fill: Number(fill.value), taskMin: Number(taskMin.value), habitMin: Number(habitMin.value), blocks });
    upSet("dash", { ...(upDash() || {}), copilot: prefs });
    closeDialog(dlg);
    toast(blocks.length !== prefs.blocks.length ? "Horario guardado. Algún bloque no era válido y se omitió." : "Horario guardado.");
    cpRefreshAll();
  };

  dlg.replaceChildren(h("div", { class: "sheet cp-sheet" },
    h("h2", { style: "margin-top:0", text: "Mi horario" }),
    h("p", { class: "muted", text: isGuest() ? "Modo invitado: se guarda solo mientras tengas esta pestaña abierta." : "El Copiloto usa esto para saber cuándo tienes tiempo libre. Solo propone: nunca cambia tus tareas por su cuenta." }),
    h("div", { class: "cp-grid" },
      h("label", {}, h("span", { text: "El día empieza" }), start), h("label", {}, h("span", { text: "El día termina" }), end),
      h("label", {}, h("span", { text: "Tiempo libre que puede llenar" }), h("div", { class: "cp-inline" }, fill, fillOut)),
      h("label", {}, h("span", { text: "Minutos por tarea" }), taskMin), h("label", {}, h("span", { text: "Minutos por hábito" }), habitMin)),
    h("h3", { text: "Bloques fijos" }), list,
    h("button", { type: "button", class: "secondary small", text: "Añadir bloque", onclick: () => { if (blocks.length >= 12) return toast("Máximo 12 bloques."); blocks.push({ id: "b" + Date.now().toString(36), label: "Clases", days: [0, 1, 2, 3, 4], start: 960, end: 1200 }); drawBlocks(); } }),
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:14px;gap:8px" },
      h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => closeDialog(dlg) }),
      h("button", { type: "button", class: "primary-btn", text: "Guardar", onclick: save }))));
  openDialog(dlg);
}

/* ---------- Máquina del tiempo ---------- */
let tmMonths = 3;
const TM_LABEL = { 1: "1 mes", 2: "2 meses", 3: "3 meses", 6: "6 meses", 12: "1 año" };

function tmDelta(row) {
  if (row.delta == null) return "";
  if (!row.delta) return "=";
  const s = row.delta > 0 ? "▲ " : "▼ ", a = Math.abs(row.delta);
  return s + (row.key === "habitPct" ? `${a} pts` : row.key === "focusMs" ? Logic.formatDuration(a) : row.key === "spendCents" ? Logic.formatEUR(a) : String(a));
}

function renderWTime(body, today) {
  const data = { habits: state.habits, logs: state.logs, tasks: state.tasks, sessions: state.sessions, transactions: state.transactions, sessionsFrom: Logic.addDays(today, -SESSION_DAYS) };
  const res = h("div", { class: "w-tm-res", "aria-live": "polite" });
  const title = h("div", { class: "w-tm-title" });
  const paint = () => {
    const r = Logic.timeTravel(data, today, tmMonths);
    title.textContent = `Hace ${TM_LABEL[r.months]} frente a hoy`;
    range.setAttribute("aria-valuetext", `Hace ${TM_LABEL[r.months]}`);
    if (r.noPast) return res.replaceChildren(h("p", { class: "muted", text: "En esa fecha todavía no había datos guardados. Prueba con un periodo más corto." }));
    const win = (w) => `${Logic.shortDate(w.from)} – ${Logic.shortDate(w.to)}`;
    const cell = (v) => h("span", { class: "w-tm-v" + (v == null ? " none" : ""), title: v == null ? "Sin datos de este periodo" : "", text: v == null ? "—" : v });
    const changed = r.rows.filter((x) => x.dir === "up" || x.dir === "down");
    res.replaceChildren(
      h("div", { class: "w-tm-grid", role: "table", "aria-label": "Comparación de los dos periodos" },
        h("div", { class: "w-tm-h", role: "row" }, h("span", {}), h("span", { role: "columnheader", text: win(r.past) }), h("span", { role: "columnheader", text: "Hoy · " + win(r.now) }), h("span", {})),
        ...r.rows.map((x) => h("div", { class: "w-tm-r", role: "row" }, h("span", { class: "w-tm-l", role: "rowheader", text: x.label }), cell(x.past), cell(x.now), h("span", { class: "w-tm-d", text: tmDelta(x) })))),
      h("p", { class: "muted", text: changed.length ? "Lectura: " + changed.map((x) => `${x.label.toLowerCase()}: de ${x.past} a ${x.now}`).join("; ") + ". Es una observación, no un juicio." : "Sin cambios que contar entre los dos periodos." }),
      h("p", { class: "muted small", text: "Se reconstruye con lo que hay guardado ahora: lo que borraste no cuenta y la concentración solo llega a 90 días." }));
  };
  const range = h("input", { type: "range", min: "0", max: String(Logic.TM_STEPS.length - 1), step: "1", value: String(Math.max(0, Logic.TM_STEPS.indexOf(tmMonths))), "aria-label": "Cuánto tiempo atrás mirar",
    oninput: () => { tmMonths = Logic.TM_STEPS[Number(range.value)]; paint(); } });
  const ticks = h("div", { class: "w-tm-ticks", "aria-hidden": "true" }, ...Logic.TM_STEPS.map((m) => h("span", { text: TM_LABEL[m] })));
  body.replaceChildren(h("div", { class: "w-tm" }, h("div", { class: "w-tm-slider" }, range, ticks), title, res));
  paint();
}

WIDGET_RENDERERS.copilot = (b, t) => renderWCopilot(b, t);
WIDGET_RENDERERS.timemachine = (b, t) => renderWTime(b, t);

// El plan depende de la hora (huecos que ya pasaron): se recalcula cada minuto solo si el Resumen está a la vista
setInterval(() => { if (!document.hidden && currentPage === "dashboard") cpRefresh(); }, 60000);
