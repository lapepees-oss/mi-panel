"use strict";
// Hábitos: categorías, frecuencia, emoji y color propios; registro por fecha real (también días pasados), rachas, calendario de 35 días y estadísticas.
// Fuente de verdad: state.habits + state.logs (tabla habit_logs, un registro por hábito y día). Todo lo demás se calcula.

let habitCat = "Todos"; // filtro de categoría
let pickedDay = null; // día elegido en el calendario
let statsHabitId = null; // hábito cuyas estadísticas se muestran (null = todos)

const streakText = (n) => plural(n, "día", "días");
const habitUnit = (freq, n) => (freq === "Semanal" ? plural(n, "semana", "semanas") : streakText(n));

// Pinta un mapa de constancia. Con interactive, cada cuadro es un botón que elige ese día.
function paintHeat(el, cells, { interactive = false, selected = null } = {}) {
  const today = todayKey();
  el.replaceChildren(
    ...cells.map((c) => {
      const label = `${Logic.longDate(c.key)}: ${c.count} de ${c.total} ${c.total === 1 ? "hábito" : "hábitos"}`;
      const cls = `heatmap-cell level-${c.level}` + (c.key === today ? " today-cell" : "") + (c.key === selected ? " selected" : "");
      return interactive
        ? h("button", { type: "button", class: cls, title: label, "aria-label": label, onclick: () => pickDay(c.key) })
        : h("div", { class: cls, title: label });
    })
  );
}

function pickDay(key) {
  pickedDay = key;
  renderHabits();
}

// Casilla "hábito × día" (también la usa el panel de inicio)
function habitToggle(hb, key, on, { future = false } = {}) {
  return h(
    "button",
    { type: "button", class: "habit-toggle", "aria-pressed": String(on), disabled: future, onclick: () => setHabitDay(hb.id, key, !on) },
    h("span", { class: "box", "aria-hidden": "true", text: "✓" }),
    h("span", { class: "habit-emoji", "aria-hidden": "true", text: hb.emoji || "🌱" }),
    h("span", { class: "name", text: hb.name })
  );
}

/* ---------- Formulario crear / editar (asistente con paso de color) ---------- */

function habitNameProblem(name, ignoreId) {
  if (!name) return "Escribe un nombre para el hábito.";
  if (name.length > 80) return "El nombre es demasiado largo (máximo 80 caracteres).";
  if (state.habits.some((x) => x.id !== ignoreId && x.name.toLowerCase() === name.toLowerCase())) return "Ya tienes un hábito con ese nombre.";
  return "";
}

// Emojis sugeridos para hábitos (el usuario puede escribir cualquier otro)
const HABIT_EMOJIS = ["📖", "🏋️", "🏃", "🧘", "💧", "😴", "🥗", "💪", "🚶", "🎸", "✍️", "🧠", "💻", "🎨", "🧹", "🪥", "💊", "☀️", "🌱", "🙏", "📵", "🎯", "🛏️", "🚴", "🏊", "🍎", "☕", "📚", "🗣️", "🎧", "🧪"];
// Un único emoji: sin letras ni dígitos, con al menos un pictograma y como mucho un grafema (o una secuencia unida)
function habitEmojiOk(v) {
  if (!v || v.length > 12 || /[\p{L}\p{N}]/u.test(v.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3/gu, "")) ) return false;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v)) return false;
  const segs = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)].length : 1;
  return segs <= 1;
}

const defaultHabitEmoji = (cat) => (HABIT_EMOJIS.includes(Logic.HABIT_ICONS[cat]) ? Logic.HABIT_ICONS[cat] : "🌱");

function openHabitForm(hb = null, startAt = null) {
  const choices = (list) => list.map((v) => ({ value: v, label: v }));
  openWizard({
    steps: [
      { key: "name", label: hb ? "Nombre del hábito" : "¿Cómo se llama el hábito?", type: "text", required: true, requiredMessage: "Escribe un nombre para el hábito.", maxLength: 80, summaryLabel: "Hábito", validate: (v) => habitNameProblem(v.trim(), hb && hb.id) },
      { key: "category", label: "Categoría", type: "choice", options: choices(Logic.HABIT_CATEGORIES), summaryLabel: "Categoría" },
      { key: "frequency", label: "Frecuencia", type: "choice", hint: "Entre semana no cuenta sábados ni domingos; Semanal basta con una vez por semana.", options: choices(Logic.HABIT_FREQUENCIES.filter((f) => f !== "Personalizada")), summaryLabel: "Frecuencia" },
      { key: "emoji", label: "Emoji del hábito", type: "emoji", options: HABIT_EMOJIS, hint: "Elige uno o escribe el tuyo.", required: true, requiredMessage: "Elige o escribe un emoji.", validate: (v) => (habitEmojiOk(v.trim()) ? "" : "Escribe un único emoji (sin letras ni números)."), summaryLabel: "Emoji" },
      { key: "color", label: "Color identificativo", type: "color", options: Logic.HABIT_COLORS.map((c) => ({ value: c, label: Logic.HABIT_COLOR_NAMES[c] })), summaryLabel: "Color" },
    ],
    initial: hb
      ? { name: hb.name, category: Logic.habitCategory(hb), frequency: Logic.habitFrequency(hb), emoji: hb.emoji || "🌱", color: Logic.habitColor(hb) }
      : { name: "", category: habitCat !== "Todos" ? habitCat : "Salud", frequency: "Diario", emoji: defaultHabitEmoji(habitCat !== "Todos" ? habitCat : "Salud"), color: Logic.HABIT_COLORS[0] },
    earlyAfter: 0,
    startAt,
    submitLabel: hb ? "Guardar cambios" : "Crear hábito",
    doneMessage: hb ? "Hábito actualizado." : "Hábito creado. Márcalo hoy si ya lo has hecho.",
    onSubmit: (v) => {
      const data = { name: v.name.trim(), category: v.category, frequency: v.frequency, emoji: v.emoji.trim(), color: v.color };
      return hb ? updateHabit(hb.id, data) : createHabit(data);
    },
  });
}

/* ---------- Tarjetas ---------- */

function habitCard(hb, weekKeys, byHabit, today) {
  const freq = Logic.habitFrequency(hb);
  const color = Logic.habitColor(hb);
  const days = byHabit.get(hb.id) || new Set();
  const streak = Logic.habitStreak(freq, days, today);
  const best = Logic.habitBestStreak(freq, days);
  const prog = Logic.habitWeekProgress(freq, days, weekKeys[0]);
  const status = Logic.habitStatusToday(freq, days, today);
  const doneToday = days.has(today);
  const pct = Math.round((prog.done / prog.target) * 100);

  const week = weekKeys.map((key, i) => {
    const on = days.has(key);
    const d = Logic.parseDay(key);
    const off = !Logic.habitDueOn(freq, key) && !on;
    return h(
      "button",
      {
        type: "button",
        class: "week-day" + (on ? " done" : "") + (key === today ? " today" : "") + (off ? " off" : ""),
        "aria-pressed": String(on),
        title: `${WEEKDAYS[i]} ${d.getDate()}`,
        "aria-label": `${hb.name}, ${WEEKDAYS[i]} ${d.getDate()}: ${on ? "cumplido" : "sin marcar"}`,
        disabled: key > today,
        onclick: () => setHabitDay(hb.id, key, !on),
      },
      h("span", { text: WEEKDAY_LETTERS[i] }),
      h("b", { text: on ? "✓" : String(d.getDate()) })
    );
  });

  const menu = h("button", {
    type: "button", class: "task-menu-btn", title: "Opciones", "aria-label": `Opciones de «${hb.name}»`, "aria-haspopup": "menu",
    onclick: (e) => { e.stopPropagation(); openHabitMenu(hb, e.currentTarget); },
  });
  menu.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-dots"/></svg>';

  const icon = h("button", { type: "button", class: "hb-emoji", title: "Cambiar emoji", "aria-label": `Cambiar el emoji de «${hb.name}»`, text: hb.emoji || "🌱", onclick: () => openHabitForm(hb, "emoji") });
  const doneLabel = freq === "Semanal" && status === "done" && !doneToday ? "Cumplido esta semana" : doneToday ? "Completado hoy ✓" : status === "off" ? "Hoy no toca · marcar" : "Completar hoy";
  const btn = h("button", {
    type: "button", class: "hb-complete" + (status === "done" ? " is-done" : ""), "aria-pressed": String(doneToday),
    onclick: () => setHabitDay(hb.id, today, !doneToday),
  }, doneLabel);

  return h(
    "article",
    { class: "hb-card-item", style: `--hc:${color}`, "data-id": hb.id },
    h("div", { class: "hb-top" }, icon,
      h("div", { class: "hb-info" }, h("strong", { text: hb.name }), h("small", { text: `${Logic.habitCategory(hb)} · ${freq}` })),
      menu),
    h("div", { class: "week" }, week),
    h("div", { class: "hb-streaks" },
      h("span", {}, "🔥 Racha: ", h("b", { text: habitUnit(freq, streak) })),
      h("span", {}, "Mejor: ", h("b", { text: habitUnit(freq, best) }))),
    h("div", { class: "hb-progress", title: "Progreso de esta semana" },
      h("div", { class: "hb-bar" }, h("span", { style: `width:${pct}%` })),
      h("small", { text: `Esta semana: ${prog.done}/${prog.target}` })),
    btn
  );
}

function openHabitMenu(hb, anchor) {
  openMenu(anchor, [
    { label: "Editar hábito", fn: () => openHabitForm(hb) },
    { label: "Estadísticas", fn: () => { statsHabitId = hb.id; renderHabits(); const c = $("#hbChart"); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" }); } },
    { label: "Duplicar", fn: async () => { if (await duplicateHabit(hb)) toast("Hábito duplicado."); } },
    { label: "Eliminar", danger: true, fn: async () => {
      if (await askConfirm({ title: `¿Borrar «${hb.name}»?`, text: "Se borrará también todo su historial. No se puede deshacer.", confirmLabel: "Borrar hábito", danger: true })) {
        if (statsHabitId === hb.id) statsHabitId = null;
        deleteHabit(hb.id);
      }
    } },
  ], "Opciones del hábito");
}

/* ---------- Paneles ---------- */

const svgBars = (vals, max, color) => {
  const w = 320, hgt = 90, bw = w / vals.length;
  const bars = vals.map((v, i) => {
    const bh = max ? Math.round((v / max) * (hgt - 6)) : 0;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${hgt - Math.max(bh, 2)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(bh, 2)}" rx="2" fill="${color}" opacity="${v ? 0.95 : 0.25}"/>`;
  });
  return `<svg viewBox="0 0 ${w} ${hgt}" width="100%" height="${hgt}" preserveAspectRatio="none" aria-hidden="true">${bars.join("")}</svg>`;
};

function renderHabitStats(byHabit, today) {
  const hb = state.habits.find((x) => x.id === statsHabitId);
  if (statsHabitId && !hb) statsHabitId = null;
  const keys = Logic.lastDayKeys(30, today);
  show($("#hbChartReset"), !!hb);
  const facts = (rows) => $("#hbFacts").replaceChildren(...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
  if (!state.habits.length) {
    $("#hbChartTitle").textContent = "Estadísticas";
    $("#hbChartSub").textContent = "Aparecerán cuando tengas hábitos y registros.";
    $("#hbChart").innerHTML = "";
    facts([]);
    return;
  }
  if (hb) {
    const days = byHabit.get(hb.id) || new Set();
    const freq = Logic.habitFrequency(hb);
    const vals = keys.map((k) => (days.has(k) ? 1 : 0));
    const created = Logic.dayOfTimestamp(hb.created_at);
    const rate = Logic.completionRate(days, today, 30, created);
    $("#hbChartTitle").textContent = hb.name;
    $("#hbChartSub").textContent = "Últimos 30 días";
    $("#hbChart").innerHTML = svgBars(vals, 1, Logic.habitColor(hb));
    $("#hbChart").setAttribute("aria-label", `${vals.reduce((a, b) => a + b, 0)} días cumplidos de los últimos 30`);
    facts([
      ["Cumplimiento (30 días)", `${rate.pct}% (${rate.done}/${rate.total})`],
      ["Racha actual", habitUnit(freq, Logic.habitStreak(freq, days, today))],
      ["Mejor racha", habitUnit(freq, Logic.habitBestStreak(freq, days))],
      ["Total de registros", String(days.size)],
    ]);
  } else {
    const per = keys.map((k) => state.habits.filter((x) => (byHabit.get(x.id) || new Set()).has(k)).length);
    const max = Math.max(1, state.habits.length);
    const total = per.reduce((a, b) => a + b, 0);
    $("#hbChartTitle").textContent = "Estadísticas";
    $("#hbChartSub").textContent = "Hábitos cumplidos por día · últimos 30 días";
    $("#hbChart").innerHTML = svgBars(per, max, "var(--primary)");
    $("#hbChart").setAttribute("aria-label", `${total} registros en los últimos 30 días`);
    facts([
      ["Registros (30 días)", String(total)],
      ["Días con actividad", `${per.filter((n) => n > 0).length} de 30`],
    ]);
  }
}

function renderHabits() {
  const today = todayKey();
  const byHabit = habitDays();
  const wk = Logic.weekKeys(Logic.weekStart(today));
  const cats = ["Todos", ...Logic.HABIT_CATEGORIES.filter((c) => c !== "Personal"), ...(state.habits.some((x) => Logic.habitCategory(x) === "Personal") ? ["Personal"] : [])];
  if (!cats.includes(habitCat)) habitCat = "Todos";

  // Resumen superior (datos reales)
  const status = state.habits.map((hb) => Logic.habitStatusToday(Logic.habitFrequency(hb), byHabit.get(hb.id) || new Set(), today));
  const dueToday = status.filter((s) => s !== "off").length;
  const doneToday = status.filter((s) => s === "done").length;
  $("#hbToday").textContent = `${doneToday} / ${dueToday}`;
  $("#hbTodayBar").style.width = (dueToday ? Math.round((doneToday / dueToday) * 100) : 0) + "%";
  const sum = Logic.weekSummary(state.habits, byHabit, today);
  $("#hbWeek").textContent = sum.total ? sum.pct + "%" : "—";
  $("#hbWeekBar").style.width = sum.pct + "%";
  let bestN = 0, bestName = "";
  for (const hb of state.habits) {
    const f = Logic.habitFrequency(hb);
    const n = Logic.habitStreak(f, byHabit.get(hb.id) || new Set(), today);
    if (n > bestN) { bestN = n; bestName = hb.name; }
  }
  $("#hbBest").textContent = bestN ? streakText(bestN) : "Sin racha";
  $("#hbBest").title = bestName ? `Hábito: ${bestName}` : "";
  $("#hbBestBar").style.width = Math.min(100, Math.round((bestN / 30) * 100)) + "%";

  // Barra de categorías con contadores y botón de crear (único lugar para crear)
  const count = (c) => (c === "Todos" ? state.habits.length : state.habits.filter((x) => Logic.habitCategory(x) === c).length);
  $("#habitCats").replaceChildren(
    ...cats.map((c) => h("button", { type: "button", class: "hb-cat" + (habitCat === c ? " active" : ""), "aria-pressed": String(habitCat === c), onclick: () => { habitCat = c; renderHabits(); } }, c, h("span", { text: String(count(c)) }))),
    h("button", { type: "button", class: "primary-btn hb-new", onclick: () => openHabitForm() }, "+ Nuevo hábito")
  );

  const shown = state.habits.filter((x) => habitCat === "Todos" || Logic.habitCategory(x) === habitCat);
  $("#habitList").replaceChildren(...shown.map((hb) => habitCard(hb, wk, byHabit, today)));
  show($("#habitEmpty"), shown.length === 0);
  $("#habitEmptyText").textContent = state.habits.length ? `No tienes hábitos en «${habitCat}». Cambia de categoría o crea uno nuevo.` : "Aún no tienes hábitos. Crea el primero con «+ Nuevo hábito» y empieza hoy.";
  const note = motivationOfDay(today);
  $("#habitNote").textContent = typeof note === "string" ? note : note.text;

  // Calendario de constancia + día elegido (editable, también fechas pasadas)
  const cells = Logic.heatCells(state.habits, byHabit, today, 35);
  if (!pickedDay || pickedDay > today) pickedDay = today;
  paintHeat($("#habitHeatmap"), cells, { interactive: true, selected: pickedDay });
  $("#habitHeatCaption").textContent = `${Logic.activeDays(cells)} de 35 días activos`;
  const picker = $("#dayPicker");
  picker.max = today;
  if (document.activeElement !== picker) picker.value = pickedDay;
  $("#dayPanelTitle").textContent = pickedDay === today ? "Hoy" : Logic.longDate(pickedDay);
  const panel = $("#dayPanel");
  if (!state.habits.length) panel.replaceChildren(h("p", { class: "empty-state", text: "Crea un hábito para poder registrarlo." }));
  else panel.replaceChildren(...state.habits.map((hb) => habitToggle(hb, pickedDay, (byHabit.get(hb.id) || new Set()).has(pickedDay))));

  // Pendientes de hoy
  const pending = state.habits.filter((hb, i) => status[i] === "pending");
  $("#pendingLabel").textContent = !state.habits.length ? "Aún no hay hábitos." : pending.length ? `Te ${pending.length === 1 ? "queda" : "quedan"} ${plural(pending.length, "hábito", "hábitos")} por hacer hoy.` : "Todo al día por hoy. Buen trabajo.";
  $("#pendingList").replaceChildren(...pending.map((hb) => habitToggle(hb, today, false)));

  renderHabitStats(byHabit, today);
}

$("#dayPicker").addEventListener("change", (e) => {
  const v = e.target.value;
  if (Logic.isDayKey(v) && v <= todayKey()) pickedDay = v;
  renderHabits();
});
$("#hbChartReset").addEventListener("click", () => { statsHabitId = null; renderHabits(); });

renderers.push(renderHabits);
