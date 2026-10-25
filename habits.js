"use strict";
// Hábitos: registro por fecha (también pasadas), rachas con fechas reales, calendario de 35 días y estadísticas.
// La fuente de verdad es state.habits + state.logs; el panel, la barra lateral y esta página leen de ahí.

let habitWeek = null; // lunes de la semana que se muestra
let pickedDay = null; // día elegido en el panel "Registrar un día"

const streakText = (n) => plural(n, "día", "días");

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
  const picker = $("#dayPicker");
  if (picker) picker.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Botón de una casilla "hábito × día"
function habitToggle(hb, key, on, { future = false } = {}) {
  return h(
    "button",
    {
      type: "button",
      class: "habit-toggle",
      "aria-pressed": String(on),
      disabled: future,
      onclick: () => setHabitDay(hb.id, key, !on),
    },
    h("span", { class: "box", "aria-hidden": "true", text: "✓" }),
    h("span", { class: "habit-emoji", "aria-hidden": "true", text: hb.emoji || "🌱" }),
    h("span", { class: "name", text: hb.name })
  );
}

async function renameHabit(hb) {
  const name = (prompt("Nuevo nombre del hábito", hb.name) || "").trim();
  if (!name || name === hb.name) return;
  if (name.length > 80) return toast("El nombre es demasiado largo (máximo 80 caracteres).");
  if (state.habits.some((x) => x.id !== hb.id && x.name.toLowerCase() === name.toLowerCase())) {
    return toast("Ya tienes un hábito con ese nombre.");
  }
  updateHabit(hb.id, { name });
}

function habitRow(hb, weekKeys, byHabit, today) {
  const days = byHabit.get(hb.id) || new Set();
  const streak = Logic.currentStreak(days, today);
  const best = Logic.longestStreak(days);
  const created = Logic.dayOfTimestamp(hb.created_at);
  const rate = Logic.completionRate(days, today, 30, created);
  const week = weekKeys.map((key, i) => {
    const on = days.has(key);
    const future = key > today;
    const d = Logic.parseDay(key);
    return h(
      "button",
      {
        type: "button",
        class: "week-day" + (on ? " done" : "") + (key === today ? " today" : ""),
        "aria-pressed": String(on),
        "aria-label": `${hb.name}, ${WEEKDAYS[i]} ${d.getDate()}: ${on ? "cumplido" : "sin marcar"}`,
        disabled: future,
        onclick: () => setHabitDay(hb.id, key, !on),
      },
      h("span", { text: WEEKDAY_LETTERS[i] }),
      h("b", { text: on ? "✓" : String(d.getDate()) })
    );
  });
  return h(
    "article",
    { class: "habit-row" },
    h(
      "div",
      { class: "habit-top" },
      h("div", { class: "habit-emoji", "aria-hidden": "true", text: hb.emoji || "🌱" }),
      h("div", { class: "habit-info" }, h("strong", { text: hb.name }), h("small", { text: hb.hint || "Hábito personal" })),
      h("span", { class: "streak", title: "Racha actual", text: `🔥 ${streakText(streak)}` }),
      h("button", { type: "button", class: "icon-btn", title: "Renombrar", "aria-label": `Renombrar ${hb.name}`, text: "✎", onclick: () => renameHabit(hb) }),
      h("button", {
        type: "button", class: "icon-btn", title: "Borrar hábito", "aria-label": `Borrar ${hb.name}`, text: "✕",
        onclick: () => {
          if (confirm(`¿Borrar «${hb.name}» y todo su historial? No se puede deshacer.`)) deleteHabit(hb.id);
        },
      })
    ),
    h(
      "div",
      { class: "habit-stats" },
      h("span", {}, "Mejor racha: ", h("b", { text: streakText(best) })),
      h("span", {}, "Últimos 30 días: ", h("b", { text: `${rate.pct}%` }), ` (${rate.done}/${rate.total})`),
      h("span", {}, "Total: ", h("b", { text: streakText(days.size) }))
    ),
    h("div", { class: "week" }, week)
  );
}

function renderHabits() {
  const today = todayKey();
  const byHabit = habitDays();
  if (!habitWeek) habitWeek = Logic.weekStart(today);
  const thisWeek = Logic.weekStart(today);
  if (habitWeek > thisWeek) habitWeek = thisWeek;
  const keys = Logic.weekKeys(habitWeek);

  $("#weekLabel").textContent =
    habitWeek === thisWeek ? "Esta semana · " + Logic.shortDate(keys[0]) + " – " + Logic.shortDate(keys[6]) : Logic.shortDate(keys[0]) + " – " + Logic.shortDate(keys[6]);
  $("#weekNext").disabled = habitWeek >= thisWeek;
  $("#weekToday").classList.toggle("active", habitWeek === thisWeek);

  $("#habitList").replaceChildren(...state.habits.map((hb) => habitRow(hb, keys, byHabit, today)));
  show($("#habitEmpty"), state.habits.length === 0);

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
}

/* ---------- Eventos ---------- */

$("#habitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#habitError");
  const name = $("#habitName").value.trim();
  const hint = $("#habitHint").value.trim();
  err.textContent = "";
  if (!name) return (err.textContent = "Escribe un nombre para el hábito.");
  if (state.habits.some((x) => x.name.toLowerCase() === name.toLowerCase())) return (err.textContent = "Ya tienes un hábito con ese nombre.");
  const btn = e.submitter || $("#habitForm button[type=submit]");
  btn.disabled = true;
  const ok = await createHabit({ name, emoji: $("#habitEmoji").value, hint });
  btn.disabled = false;
  if (ok) {
    $("#habitName").value = "";
    $("#habitHint").value = "";
    toast("Hábito creado. Márcalo hoy si ya lo has hecho.");
  } else {
    err.textContent = "No se pudo crear el hábito.";
  }
});

$("#weekPrev").addEventListener("click", () => {
  habitWeek = Logic.addDays(habitWeek || Logic.weekStart(todayKey()), -7);
  renderHabits();
});
$("#weekNext").addEventListener("click", () => {
  habitWeek = Logic.addDays(habitWeek || Logic.weekStart(todayKey()), 7);
  renderHabits();
});
$("#weekToday").addEventListener("click", () => {
  habitWeek = Logic.weekStart(todayKey());
  renderHabits();
});
$("#dayPicker").addEventListener("change", (e) => {
  const v = e.target.value;
  if (Logic.isDayKey(v) && v <= todayKey()) pickedDay = v;
  renderHabits();
});

renderers.push(renderHabits);
