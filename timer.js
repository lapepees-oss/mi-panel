// Editar la duración en el propio control: pulsa el tiempo y escribe h, min y s (Enter o salir del campo = aplicar, Esc = cancelar)
let cdEditing = false;
function openCdEdit() {
  if (cdEditing || state.timer.running || elapsed() > 0) return;
  cdEditing = true;
  const cd = Logic.splitHms(targetMs());
  $("#cd-h").value = String(cd.h); $("#cd-m").value = String(cd.m); $("#cd-s").value = String(cd.s);
  show($("#cd-label"), false); show($("#cd-edit"), true);
  $("#cd-edit").closest(".adjust").classList.add("editing");
  const first = cd.h ? $("#cd-h") : $("#cd-m");
  first.focus(); first.select();
}
function closeCdEdit(apply) {
  if (!cdEditing) return;
  cdEditing = false;
  if (apply) applyCountdown(Logic.countdownMs($("#cd-h").value, $("#cd-m").value, $("#cd-s").value));
  show($("#cd-edit"), false); show($("#cd-label"), true);
  $("#cd-edit").closest(".adjust").classList.remove("editing");
  renderTimer();
}
$("#cd-label").addEventListener("click", openCdEdit);
$("#cd-edit").addEventListener("focusin", (e) => { if (e.target.matches("input")) e.target.select(); });
$("#cd-edit").addEventListener("focusout", (e) => { if (!$("#cd-edit").contains(e.relatedTarget)) closeCdEdit(true); });
$("#cd-edit").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); closeCdEdit(true); $("#cd-label").focus(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCdEdit(false); $("#cd-label").focus(); }
});
"use strict";
// Cronómetro, temporizador, Pomodoro y rutinas encadenadas.
// Se guarda la hora de inicio y el tiempo acumulado, no los segundos que han pasado. Así el contador no
// acumula errores si la pestaña se ralentiza, sigue con la pantalla bloqueada y la fase actual se calcula
// igual en todos los dispositivos. Modos (columna timer.mode): stopwatch · timer · pomodoro · routine.
//  - Cronómetro: cuenta hacia arriba.   - Temporizador: cuenta atrás de timer.target_ms (migracion-v4.sql).
//  - Pomodoro: usa una rutina llamada "Pomodoro…" (se crea la primera vez; 25/5 × 4 por defecto).
//  - Rutinas: el resto de rutinas del usuario (fases encadenadas).

let tickHandle = null;
let lastPhaseKey = null;
let finishing = false;
let audioCtx = null;
let showAllSessions = false;

const MODE_NAMES = { stopwatch: "Cronómetro", timer: "Temporizador", pomodoro: "Pomodoro", routine: "Rutinas" };
const DEFAULT_POMODORO = { work: 25, rest: 5, cycles: 4 };
const DEFAULT_COUNTDOWN_MS = 25 * 60 * 1000;

const currentMode = () => (state.timer && MODE_NAMES[state.timer.mode] ? state.timer.mode : "stopwatch");
const routineById = (id) => state.routines.find((r) => r.id === id);
const stepsOfRoutine = (id) =>
  state.routineSteps.filter((s) => s.routine_id === id).sort((a, b) => a.position - b.position);
const isPomodoroRoutine = (r) => /^pomodoro/i.test(r.name || "");
// La rutina que usa el modo Pomodoro: la llamada "Pomodoro" exacta y, si no, la primera cuyo nombre empiece así
const pomodoroRoutine = () =>
  state.routines.find((r) => (r.name || "").trim().toLowerCase() === "pomodoro") || state.routines.find(isPomodoroRoutine) || null;
const otherRoutines = () => state.routines.filter((r) => r !== pomodoroRoutine());

function activeRoutine() {
  const t = state.timer;
  const mode = currentMode();
  if (!t || (mode !== "routine" && mode !== "pomodoro")) return null;
  const r = routineById(t.routine_id);
  if (!r) return null;
  const steps = stepsOfRoutine(r.id);
  return steps.length ? { routine: r, steps } : null;
}

function elapsed() {
  const t = state.timer;
  if (!t) return 0;
  const extra = t.running && t.started_at ? Date.now() - Date.parse(t.started_at) : 0;
  return Number(t.accumulated_ms) + Math.max(0, extra);
}

const targetMs = () => Math.max(0, Number(state.timer && state.timer.target_ms) || 0);

const cycleMsOf = (ar) => ar.steps.reduce((a, s) => a + s.seconds * 1000, 0);

// Fase en la que estamos tras `ms` milisegundos desde el inicio de la rutina
function phaseAt(ar, ms) {
  const cycleMs = cycleMsOf(ar);
  const cycles = ar.routine.cycles;
  if (cycles > 0 && ms >= cycles * cycleMs) return { finished: true, total: cycles * cycleMs };
  const cycle = Math.floor(ms / cycleMs);
  let within = ms - cycle * cycleMs;
  let start = cycle * cycleMs;
  for (let i = 0; i < ar.steps.length; i++) {
    const dur = ar.steps[i].seconds * 1000;
    if (within < dur) {
      let next = ar.steps[i + 1] || null;
      if (!next && (cycles === 0 || cycle + 1 < cycles)) next = ar.steps[0];
      return { finished: false, cycle, idx: i, step: ar.steps[i], dur, remaining: dur - within, end: start + dur, next };
    }
    within -= dur;
    start += dur;
  }
  return { finished: true, total: cycles * cycleMs };
}

// Tiempo de "trabajo" acumulado (los descansos no cuentan en la sesión guardada)
function workMs(ar, ms) {
  const cycleMs = cycleMsOf(ar);
  const cycles = ar.routine.cycles;
  if (cycles > 0) ms = Math.min(ms, cycles * cycleMs);
  const workPer = ar.steps.filter((s) => s.kind === "work").reduce((a, s) => a + s.seconds * 1000, 0);
  const full = Math.floor(ms / cycleMs);
  let total = full * workPer;
  let rest = ms - full * cycleMs;
  for (const s of ar.steps) {
    if (rest <= 0) break;
    const take = Math.min(rest, s.seconds * 1000);
    if (s.kind === "work") total += take;
    rest -= take;
  }
  return total;
}

function fmtShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return fmt(ms);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const minutesText = (sec) => {
  const m = sec / 60;
  return Number.isInteger(m) ? `${m} min` : `${m.toFixed(1)} min`;
};

/* ---------- Avisos ---------- */

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (_) {}
}
document.addEventListener("click", unlockAudio);

function beep(kind) {
  try {
    unlockAudio();
    if (!audioCtx) return;
    const freqs = kind === "break" ? [660, 880, 1100] : [1100, 880, 660];
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t0 = audioCtx.currentTime + i * 0.22;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
  } catch (_) {}
}

async function systemNotify(title, body) {
  if (!notifPrefs().phase) return;
  showSystem(title, body, { tag: "cloudspace-timer-phase", renotify: true });
}

function alertPhase(p) {
  const isBreak = p.step.kind === "break";
  const title = isBreak ? "☕ Descanso" : "📚 A trabajar";
  const body = `${p.step.label} · ${minutesText(p.step.seconds)}`;
  toast(`${title}: ${body}`);
  beep(p.step.kind);
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (_) {}
  systemNotify(title, body);
}

/* ---------- Estado en la base de datos ---------- */

async function updateTimer(patch) {
  if (!state.timer) return;
  state.timer = { ...state.timer, ...patch };
  renderTimer();
  try {
    const data = await run(db.from("timer").update(patch).eq("user_id", user.id).select().single());
    state.timer = data;
    renderTimer();
  } catch (e) {
    if (e && /target_ms/i.test(e.message || "")) toast("Para usar el temporizador ejecuta migracion-v4.sql en Supabase.", 7000);
    loadAll();
  }
}

const resetPatch = { running: false, started_at: null, accumulated_ms: 0 };
const timerLabel = () => $("#timer-label").value.trim();

// Etiqueta con la que se guarda la sesión: lo que el usuario puso; en rutinas, el nombre de la rutina si no puso nada
function sessionLabel() {
  const own = timerLabel();
  if (own) return own;
  const ar = activeRoutine();
  return ar && currentMode() === "routine" ? ar.routine.name : "";
}

// Tiempo que se guardaría ahora mismo y de qué tipo es
function currentSession() {
  const mode = currentMode();
  const ar = activeRoutine();
  const ms = mode === "timer" ? Math.min(elapsed(), targetMs()) : ar ? workMs(ar, elapsed()) : elapsed();
  return { mode, ms, label: sessionLabel() };
}

// Guarda la sesión actual (si dura al menos 1 s) y deja el contador a cero
async function saveCurrentAndReset() {
  const s = currentSession();
  if (s.ms >= 1000) await saveSession({ label: s.label, duration_ms: s.ms, kind: s.mode });
  lastPhaseKey = null;
  await updateTimer(resetPatch);
  loadAll();
  return s.ms >= 1000;
}

function vibrate() {
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (_) {}
}

// Solo un dispositivo gana este final: running pasa de true a false una única vez
async function autoFinish(kind, ms, label, announce) {
  if (finishing) return;
  finishing = true;
  try {
    const rows = await run(db.from("timer").update(resetPatch).eq("user_id", user.id).eq("running", true).select());
    if (rows && rows.length) {
      state.timer = rows[0];
      if (ms >= 1000) await saveSession({ label, duration_ms: ms, kind });
      announce();
    }
    loadAll();
  } catch (_) {
  } finally {
    setTimeout(() => (finishing = false), 3000);
  }
}

function finishRoutine(ar, p) {
  const mode = currentMode();
  const label = sessionLabel();
  return autoFinish(mode, workMs(ar, p.total), label, () => {
    const what = mode === "pomodoro" ? "Pomodoro" : `Rutina «${ar.routine.name}»`;
    toast(`✅ ${what} completado`);
    beep("break");
    vibrate();
    systemNotify("✅ Rutina completada", ar.routine.name);
  });
}

function finishCountdown() {
  const label = sessionLabel();
  return autoFinish("timer", targetMs(), label, () => {
    toast("⏰ ¡Tiempo completado!");
    beep("break");
    vibrate();
    systemNotify("⏰ Tiempo completado", label || "El temporizador ha llegado a cero");
  });
}

/* ---------- Pomodoro: se apoya en una rutina ---------- */

function pomodoroSettings() {
  const r = pomodoroRoutine();
  if (!r) return { ...DEFAULT_POMODORO, routine: null };
  const steps = stepsOfRoutine(r.id);
  const work = steps.find((s) => s.kind === "work");
  const rest = steps.find((s) => s.kind === "break");
  return { work: work ? work.seconds / 60 : DEFAULT_POMODORO.work, rest: rest ? rest.seconds / 60 : DEFAULT_POMODORO.rest, cycles: r.cycles, routine: r };
}

async function ensurePomodoro() {
  const existing = pomodoroRoutine();
  if (existing) return existing.id;
  return writeRoutine(null, "Pomodoro", DEFAULT_POMODORO.cycles, [
    { label: "Estudiando", seconds: DEFAULT_POMODORO.work * 60, kind: "work", position: 0 },
    { label: "Descansando", seconds: DEFAULT_POMODORO.rest * 60, kind: "break", position: 1 },
  ]);
}

async function savePomodoroSettings() {
  if (state.timer.running || elapsed() > 0) return;
  const work = Math.round(Number($("#pm-work").value));
  const rest = Math.round(Number($("#pm-break").value));
  const cycles = Math.round(Number($("#pm-cycles").value));
  if (!(work >= 1 && work <= 180) || !(rest >= 1 && rest <= 60) || !(cycles >= 0 && cycles <= 99)) {
    toast("Concentración 1–180 min, descanso 1–60 min y ciclos 0–99 (0 = sin fin).");
    renderTimer();
    return;
  }
  const r = pomodoroRoutine();
  const old = r ? stepsOfRoutine(r.id) : [];
  const wl = (old.find((s) => s.kind === "work") || {}).label || "Estudiando";
  const bl = (old.find((s) => s.kind === "break") || {}).label || "Descansando";
  try {
    await writeRoutine(r ? r.id : null, r ? r.name : "Pomodoro", cycles, [
      { label: wl, seconds: work * 60, kind: "work", position: 0 },
      { label: bl, seconds: rest * 60, kind: "break", position: 1 },
    ]);
  } catch (_) {
    toast("No se pudo guardar el Pomodoro. Comprueba que has ejecutado migracion-v2.sql en Supabase.");
  }
  loadAll();
}

/* ---------- Cambio de modo seguro ---------- */

const hasActiveSession = () => !!state.timer && (state.timer.running || elapsed() > 5000);

// Si hay una sesión en marcha o pausada con tiempo, pregunta qué hacer con ella. Devuelve false si el usuario cancela.
async function settleCurrentSession() {
  if (!hasActiveSession()) return true;
  const s = currentSession();
  const choice = await askChoice({
    title: "Tienes una sesión en curso",
    text: `Llevas ${Logic.formatDuration(s.ms)} (${MODE_NAMES[s.mode]}). Cambiar reinicia el contador: elige qué hacer con ese tiempo.`,
    options: [
      { label: s.ms >= 1000 ? "Guardar sesión y cambiar" : "Cambiar", value: "save", kind: "primary" },
      { label: "Descartar y cambiar", value: "discard", kind: "danger" },
      { label: "Seguir con la sesión", value: null, kind: "ghost" },
    ],
  });
  if (!choice) return false;
  if (choice === "save" && s.ms >= 1000) {
    try {
      await saveSession({ label: s.label, duration_ms: s.ms, kind: s.mode });
    } catch (_) {
      return false; // no se pudo guardar: no se pierde el tiempo
    }
  }
  return true;
}

async function switchMode(mode) {
  if (!state.timer || mode === currentMode() || !MODE_NAMES[mode]) return;
  if (!(await settleCurrentSession())) {
    renderTimer();
    return;
  }
  lastPhaseKey = null;
  try {
    if (mode === "stopwatch") await updateTimer({ mode, routine_id: null, ...resetPatch });
    else if (mode === "timer") await updateTimer({ mode, routine_id: null, target_ms: targetMs() > 0 ? targetMs() : DEFAULT_COUNTDOWN_MS, ...resetPatch });
    else if (mode === "pomodoro") {
      const id = await ensurePomodoro();
      await updateTimer({ mode, routine_id: id, ...resetPatch });
      await loadAll();
    } else {
      const keep = otherRoutines().find((r) => r.id === state.timer.routine_id);
      const pick = keep || otherRoutines()[0] || null;
      await updateTimer({ mode, routine_id: pick ? pick.id : null, ...resetPatch });
    }
  } catch (_) {
    toast("No se pudo cambiar de modo. Comprueba que has ejecutado migracion-v2.sql en Supabase.");
  }
}

async function switchRoutine(id) {
  if (!state.timer || id === state.timer.routine_id) return;
  if (!(await settleCurrentSession())) {
    renderTimer();
    return;
  }
  lastPhaseKey = null;
  updateTimer({ mode: "routine", routine_id: id || null, ...resetPatch });
}

/* ---------- Pintado ---------- */

function setRing(pct, tone) {
  const ring = $("#timer-ring");
  ring.style.setProperty("--pct", `${Math.max(0, Math.min(100, pct))}%`);
  ring.dataset.tone = tone || "";
}

function renderTimer() {
  const t = state.timer;
  if (!t) return;
  const mode = currentMode();
  const ar = activeRoutine();
  const idle = !t.running && elapsed() === 0;

  // Pestañas
  $$("#timer-tabs .timer-tab").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $("#mode-label").textContent = MODE_NAMES[mode];
  show($("#opt-timer"), mode === "timer");
  show($("#opt-pomodoro"), mode === "pomodoro");
  show($("#opt-routine"), mode === "routine");

  // Etiqueta de la sesión (texto libre opcional)
  const label = t.label || "";
  if (document.activeElement !== $("#timer-label")) $("#timer-label").value = label;

  // Temporizador
  const cd = Logic.splitHms(targetMs());
  for (const [id, v] of [["cd-h", cd.h], ["cd-m", cd.m], ["cd-s", cd.s]]) {
    const el = $("#" + id);
    if (!cdEditing) el.value = String(v);
    el.disabled = !idle;
  }
  $("#cd-minus").disabled = $("#cd-plus").disabled = $("#cd-label").disabled = !idle;
  if (!idle && cdEditing) closeCdEdit(false);
  $("#cd-label").textContent = fmt(targetMs());

  // Pomodoro
  const pm = pomodoroSettings();
  for (const [id, v] of [["pm-work", pm.work], ["pm-break", pm.rest], ["pm-cycles", pm.cycles]]) {
    const el = $("#" + id);
    if (document.activeElement !== el) el.value = String(v);
    el.disabled = !idle;
  }

  // Rutinas
  const rs = otherRoutines();
  const rsel = $("#routine-select");
  rsel.replaceChildren(
    h("option", { value: "", text: rs.length ? "Elige una rutina…" : "Aún no tienes rutinas" }),
    ...rs.map((r) => h("option", { value: r.id, text: "🔁 " + r.name }))
  );
  rsel.value = mode === "routine" && ar ? ar.routine.id : "";
  show($("#routine-edit"), mode === "routine" && !!ar);
  show($("#routine-del"), mode === "routine" && !!ar);
  show($("#routine-examples"), mode === "routine" && rs.length === 0);
  const plan = $("#routine-plan");
  plan.replaceChildren();
  show(plan, mode === "routine" && !!ar);
  if (mode === "routine" && ar) {
    const cyc = ar.routine.cycles === 0 ? "sin fin" : `${ar.routine.cycles} ${ar.routine.cycles === 1 ? "ciclo" : "ciclos"}`;
    plan.append(
      h("span", { class: "muted", text: cyc + ": " }),
      ...ar.steps.map((s) => h("span", { class: "step-pill " + s.kind, text: `${s.label} ${minutesText(s.seconds)}` }))
    );
  }

  // Controles
  const canRun = mode === "timer" ? targetMs() > 0 : mode === "routine" || mode === "pomodoro" ? !!ar : true;
  const startBtn = $("#timer-start");
  startBtn.disabled = t.running || !canRun;
  startBtn.querySelector("span").textContent = elapsed() > 0 ? "Reanudar" : "Iniciar";
  $("#timer-pause").disabled = !t.running;
  $("#timer-finish").disabled = elapsed() < 1000;
  $("#timer-reset").disabled = elapsed() === 0 && !t.running;
  show($("#timer-skip"), !!ar);
  $("#save-note").textContent = t.running ? "Sesión en curso: se guarda al finalizar."
    : elapsed() > 0 ? "En pausa. Pulsa Finalizar para guardar el tiempo."
    : mode === "routine" && !ar ? "Elige o crea una rutina para empezar."
    : mode === "timer" && targetMs() <= 0 ? "Indica una duración mayor que 0 para iniciar."
    : "El tiempo se guardará al finalizar la sesión.";
  show($("#timer-notify"), "Notification" in window && Notification.permission === "default");
  $("#timer-quote").textContent = motivationOfDay(todayKey()).text;

  tickTimer();
  renderTimerStats();
}

function renderTimerStats() {
  const today = todayKey();
  const st = Logic.sessionStats(state.sessions, today);
  $("#tsToday").textContent = Logic.formatDuration(st.todayMs);
  const change = Logic.pctChange(st.todayMs, st.yesterdayMs);
  const foot = $("#tsTodayFoot");
  foot.replaceChildren();
  if (change === null) foot.textContent = st.todayMs > 0 ? "Ayer no hubo sesiones" : "Aún sin sesiones hoy";
  else foot.append(h("span", { class: change >= 0 ? "positive" : "negative", text: `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}%` }), " que ayer");
  $("#tsCount").textContent = String(st.todayCount);
  const diff = st.todayCount - st.yesterdayCount;
  const cf = $("#tsCountFoot");
  cf.replaceChildren();
  if (st.yesterdayCount === 0 && st.todayCount === 0) cf.textContent = "Aún sin sesiones hoy";
  else if (diff === 0) cf.textContent = "Igual que ayer";
  else cf.append(h("span", { class: diff > 0 ? "positive" : "negative", text: `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)}` }), " que ayer");
  $("#tsDays").textContent = String(st.activeDays7);
  const max = Math.max(1, ...st.days7.map((d) => d.ms));
  $("#tsBars").replaceChildren(...st.days7.map((d) => h("i", { style: `height:${d.ms ? Math.max(12, Math.round((d.ms / max) * 100)) : 6}%`, class: d.ms ? "on" : "", title: `${Logic.shortDate(d.key)}: ${Logic.formatDuration(d.ms)}` })));
  $("#tsDots").replaceChildren(...st.days7.map((d) => h("i", { class: d.ms ? "on" : "", title: Logic.shortDate(d.key) })));

  // Historial
  const ul = $("#session-list");
  ul.replaceChildren();
  const all = state.sessions;
  const rows = showAllSessions ? all : all.slice(0, 8);
  $("#sessionCaption").textContent = all.length ? `${plural(all.length, "sesión guardada", "sesiones guardadas")} en los últimos ${SESSION_DAYS} días.` : "Tus sesiones guardadas aparecerán aquí.";
  show($("#sessionMore"), all.length > 8);
  $("#sessionMore").textContent = showAllSessions ? "Ver menos" : "Ver todo →";
  if (!all.length) {
    ul.append(h("li", { class: "session-empty", text: "Aún no has guardado sesiones. Inicia el cronómetro y pulsa Finalizar para guardar la primera." }));
    return;
  }
  for (const s of rows) {
    const when = new Date(s.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    ul.append(
      h("li", { class: "session-row" },
        h("div", { class: "s-name" }, h("strong", { text: s.label || "Sin etiqueta" })),
        h("div", { class: "s-kind" }, h("span", { class: "type-pill " + (s.kind || "none"), text: Logic.sessionKindLabel(s.kind) })),
        h("div", { class: "s-dur", text: Logic.formatDuration(Number(s.duration_ms)) }),
        h("div", { class: "s-when muted", text: when }),
        h("button", {
          class: "icon-btn", title: "Borrar sesión", "aria-label": "Borrar sesión", text: "✕",
          onclick: async () => {
            if (!(await askConfirm({ title: "¿Borrar esta sesión?", text: "Dejará de contar en tus estadísticas.", confirmLabel: "Borrar", danger: true }))) return;
            state.sessions = state.sessions.filter((x) => x.id !== s.id);
            renderTimer();
            await run(db.from("timer_sessions").delete().eq("id", s.id)).catch(() => {});
            loadAll();
          },
        }))
    );
  }
}

function tickTimer() {
  const t = state.timer;
  if (!t) return;
  const mode = currentMode();
  const ms = elapsed();
  const ar = activeRoutine();
  const card = $("#timer-card");
  const disp = $("#timer-display");
  const note = (title, body, phaseKey) => timerProgress(t.running ? { phaseKey, title, body } : null);
  card.classList.remove("work", "break");
  $("#phase-label").textContent = "";
  $("#phase-next").textContent = "";

  if (mode === "stopwatch") {
    disp.textContent = fmt(ms);
    setRing((ms % 60000) / 600, "soft"); // sin duración objetivo: el aro solo da una vuelta por minuto (decorativo)
    lastPhaseKey = null;
    document.title = t.running ? `${fmt(ms)} · Cloudspace` : pageTitle();
    note("⏱ Cronómetro en marcha", `Llevas ${Logic.clock(ms)}${t.label ? " · " + t.label : ""}`, "free");
    return;
  }

  if (mode === "timer") {
    const target = targetMs();
    const rem = target - ms;
    disp.textContent = fmt(Math.max(0, rem) + (t.running ? 999 : 0));
    setRing(target > 0 ? (ms / target) * 100 : 0);
    lastPhaseKey = null;
    $("#phase-next").textContent = "";
    document.title = t.running ? `${fmtShort(Math.max(0, rem) + 999)} · Cloudspace` : pageTitle();
    if (t.running && target > 0 && rem <= 0) finishCountdown();
    else note(`⏳ Temporizador · quedan ${Logic.clock(Math.max(0, rem) + 999)}`, t.label ? t.label : "Cuenta atrás en marcha", "countdown");
    return;
  }

  if (!ar) {
    disp.textContent = "00:00";
    setRing(0);
    timerProgress(null);
    document.title = pageTitle();
    return;
  }

  const p = phaseAt(ar, ms);
  if (p.finished) {
    disp.textContent = "00:00";
    setRing(100);
    timerProgress(null);
    if (t.running) finishRoutine(ar, p);
    return;
  }

  disp.textContent = fmtShort(p.remaining + 999);
  card.classList.toggle("work", p.step.kind === "work");
  card.classList.toggle("break", p.step.kind === "break");
  setRing((1 - p.remaining / p.dur) * 100, p.step.kind);
  const cycleTxt = ar.routine.cycles === 0 ? `Ciclo ${p.cycle + 1}` : `Ciclo ${p.cycle + 1}/${ar.routine.cycles}`;
  $("#phase-label").textContent = `${p.step.kind === "break" ? "☕" : "📚"} ${p.step.label} · ${cycleTxt}`;
  $("#phase-next").textContent = p.next ? `Siguiente: ${p.next.label} (${minutesText(p.next.seconds)})` : "Última fase";

  const key = `${t.routine_id}:${p.cycle}:${p.idx}`;
  if (t.running && lastPhaseKey !== null && key !== lastPhaseKey) alertPhase(p);
  lastPhaseKey = t.running ? key : null;
  document.title = t.running ? `${fmtShort(p.remaining + 999)} ${p.step.label} · Cloudspace` : pageTitle();
  note(
    `${p.step.kind === "break" ? "☕" : "📚"} ${p.step.label} · quedan ${Logic.clock(p.remaining + 999)}`,
    `${cycleTxt} · lleva ${Logic.clock(ms)}${p.next ? " · Siguiente: " + p.next.label : ""}`,
    key
  );
}

function startTick() {
  clearInterval(tickHandle);
  tickHandle = setInterval(tickTimer, 250);
}

function stopTick() {
  clearInterval(tickHandle);
  tickHandle = null;
}

/* ---------- Controles ---------- */

$("#timer-tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".timer-tab");
  if (b) switchMode(b.dataset.mode);
});
// Flechas izquierda/derecha entre pestañas
$("#timer-tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabs = $$("#timer-tabs .timer-tab");
  const i = tabs.findIndex((b) => b.dataset.mode === currentMode());
  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  switchMode(next.dataset.mode);
});

$("#timer-start").addEventListener("click", () => {
  const t = state.timer;
  if (!t || t.running) return;
  const mode = currentMode();
  if (mode === "timer" && targetMs() <= 0) return toast("Indica una duración mayor que 0 para iniciar la cuenta atrás.");
  if ((mode === "routine" || mode === "pomodoro") && !activeRoutine()) return toast("Elige o crea una rutina para empezar.");
  unlockAudio();
  updateTimer({ running: true, started_at: new Date().toISOString() });
});

$("#timer-pause").addEventListener("click", () => {
  const t = state.timer;
  if (t && t.running) updateTimer({ running: false, started_at: null, accumulated_ms: elapsed() });
});

$("#timer-skip").addEventListener("click", () => {
  const ar = activeRoutine();
  if (!ar) return;
  const p = phaseAt(ar, elapsed());
  if (p.finished) return;
  const patch = { accumulated_ms: p.end };
  if (state.timer.running) patch.started_at = new Date().toISOString();
  updateTimer(patch);
});

$("#timer-reset").addEventListener("click", async () => {
  if (elapsed() > 5000 && !(await askConfirm({ title: "¿Reiniciar sin guardar la sesión?", text: "Se perderá el tiempo que llevas. Si quieres conservarlo, usa Finalizar.", confirmLabel: "Reiniciar", danger: true }))) return;
  lastPhaseKey = null;
  updateTimer(resetPatch);
});

$("#timer-finish").addEventListener("click", async () => {
  if (finishing) return;
  if (currentSession().ms < 1000) return toast("Todavía no hay tiempo que guardar.");
  finishing = true;
  $("#timer-finish").disabled = true;
  try {
    await saveCurrentAndReset();
    toast("Sesión guardada.");
  } catch (_) {
    renderTimer(); // no se pudo guardar: el contador sigue donde estaba
  } finally {
    finishing = false;
  }
});

// Etiqueta de la sesión: texto libre
$("#timer-label").addEventListener("change", () => updateTimer({ label: timerLabel() }));

// Cuenta atrás: h / min / s y ajuste de 1 minuto
function applyCountdown(ms) {
  if (state.timer.running || elapsed() > 0) return;
  updateTimer({ target_ms: Math.max(0, Math.min(86400000, ms)) });
}
for (const id of ["cd-h", "cd-m", "cd-s"]) {
  $("#" + id).addEventListener("change", () => applyCountdown(Logic.countdownMs($("#cd-h").value, $("#cd-m").value, $("#cd-s").value)));
}
$("#cd-minus").addEventListener("click", () => applyCountdown(Math.max(60000, targetMs() - 60000)));
$("#cd-plus").addEventListener("click", () => applyCountdown(targetMs() + 60000));

for (const id of ["pm-work", "pm-break", "pm-cycles"]) $("#" + id).addEventListener("change", savePomodoroSettings);

$("#routine-select").addEventListener("change", (e) => switchRoutine(e.target.value));

$("#sessionMore").addEventListener("click", () => {
  showAllSessions = !showAllSessions;
  renderTimerStats();
});

$("#timer-notify").addEventListener("click", async () => {
  await requestNotifPermission();
  renderTimer();
  if (typeof renderNotifPrefs === "function") renderNotifPrefs();
});

/* ---------- Editor de rutinas ---------- */

let draft = null;

function openRoutineEditor(id) {
  if (id) {
    const r = routineById(id);
    if (!r) return;
    draft = {
      id,
      name: r.name,
      cycles: r.cycles,
      steps: stepsOfRoutine(id).map((s) => ({ label: s.label, minutes: s.seconds / 60, kind: s.kind })),
    };
  } else {
    draft = {
      id: null, name: "", cycles: 4,
      steps: [{ label: "Estudiando", minutes: 25, kind: "work" }, { label: "Descansando", minutes: 5, kind: "break" }],
    };
  }
  renderRoutineEditor();
  openDialog($("#routine-dialog"));
}

function renderRoutineEditor() {
  const dlg = $("#routine-dialog");
  dlg.replaceChildren();
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]];
    renderRoutineEditor();
  };

  const rows = draft.steps.map((s, i) =>
    h("div", { class: "step-row" },
      h("input", { value: s.label, placeholder: "Nombre (ej. Estudiando)", maxlength: 40, oninput: (e) => (s.label = e.target.value) }),
      h("input", {
        type: "number", value: String(s.minutes), min: "0.5", step: "0.5", title: "Minutos", class: "mins",
        oninput: (e) => (s.minutes = e.target.value),
      }),
      h("select", {
        value: s.kind, title: "Tipo",
        onchange: (e) => (s.kind = e.target.value),
      }, h("option", { value: "work", text: "Trabajo" }), h("option", { value: "break", text: "Descanso" })),
      h("button", { class: "icon-btn", title: "Subir", text: "↑", onclick: () => move(i, -1) }),
      h("button", { class: "icon-btn", title: "Bajar", text: "↓", onclick: () => move(i, 1) }),
      h("button", {
        class: "icon-btn", title: "Quitar fase", text: "✕",
        onclick: () => {
          draft.steps.splice(i, 1);
          renderRoutineEditor();
        },
      })
    )
  );

  dlg.append(
    h("div", { class: "sheet" },
      h("div", { class: "row" },
        h("h2", { style: "margin:0;flex:1", text: draft.id ? "Editar rutina" : "Nueva rutina" }),
        h("button", { class: "icon-btn", title: "Cerrar", text: "✕", onclick: () => closeDialog(dlg) })
      ),
      h("label", { class: "field" }, h("span", { class: "muted", text: "Nombre" }),
        h("input", { value: draft.name, placeholder: "Pomodoro", maxlength: 60, oninput: (e) => (draft.name = e.target.value) })),
      h("label", { class: "field" }, h("span", { class: "muted", text: "Repeticiones del ciclo completo (0 = sin fin)" }),
        h("input", { type: "number", min: "0", max: "99", value: String(draft.cycles), oninput: (e) => (draft.cycles = e.target.value) })),
      h("h2", { text: "Fases (se encadenan solas, en este orden)" }),
      ...rows,
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", {
          class: "secondary", text: "+ Trabajo",
          onclick: () => {
            draft.steps.push({ label: "Estudiando", minutes: 25, kind: "work" });
            renderRoutineEditor();
          },
        }),
        h("button", {
          class: "secondary", text: "+ Descanso",
          onclick: () => {
            draft.steps.push({ label: "Descansando", minutes: 5, kind: "break" });
            renderRoutineEditor();
          },
        })
      ),
      h("div", { class: "row", style: "margin-top:16px;justify-content:flex-end" },
        h("button", { class: "secondary", text: "Cancelar", onclick: () => closeDialog(dlg) }),
        h("button", { text: "Guardar rutina", onclick: saveRoutine })
      )
    )
  );
}

function cleanDraft() {
  const name = draft.name.trim();
  if (!name) return { error: "Ponle un nombre a la rutina." };
  const cycles = Math.max(0, Math.min(99, parseInt(draft.cycles, 10) || 0));
  const steps = draft.steps.map((s, i) => ({
    label: s.label.trim() || (s.kind === "break" ? "Descansando" : "Estudiando"),
    seconds: Math.round(Number(s.minutes) * 60),
    kind: s.kind,
    position: i,
  }));
  if (!steps.length) return { error: "Añade al menos una fase." };
  if (steps.some((s) => !(s.seconds > 0))) return { error: "Todas las fases deben durar más de 0 minutos." };
  return { name, cycles, steps };
}

// Crea o actualiza una rutina y sustituye todas sus fases
async function writeRoutine(id, name, cycles, steps) {
  let rid = id;
  if (rid) {
    await run(db.from("routines").update({ name, cycles }).eq("id", rid));
    await run(db.from("routine_steps").delete().eq("routine_id", rid));
  } else {
    const row = await run(db.from("routines").insert({ name, cycles }).select().single());
    rid = row.id;
  }
  await run(db.from("routine_steps").insert(steps.map((s) => ({ ...s, routine_id: rid }))));
  return rid;
}

async function saveRoutine() {
  const c = cleanDraft();
  if (c.error) {
    toast(c.error);
    return;
  }
  try {
    const wasActive = draft.id && state.timer && state.timer.routine_id === draft.id;
    const rid = await writeRoutine(draft.id, c.name, c.cycles, c.steps);
    closeDialog($("#routine-dialog"));
    if (!draft.id || wasActive) {
      lastPhaseKey = null;
      await updateTimer({ mode: "routine", routine_id: rid, ...resetPatch });
    }
    await loadAll();
  } catch (_) {
    toast("No se pudo guardar la rutina. Comprueba que has ejecutado migracion-v2.sql en Supabase.");
  }
}

$("#routine-new").addEventListener("click", () => openRoutineEditor(null));
$("#routine-edit").addEventListener("click", () => {
  const ar = activeRoutine();
  if (ar && currentMode() === "routine") openRoutineEditor(ar.routine.id);
});

$("#routine-del").addEventListener("click", async () => {
  const ar = activeRoutine();
  if (!ar || !(await askConfirm({ title: `¿Borrar la rutina «${ar.routine.name}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar rutina", danger: true }))) return;
  lastPhaseKey = null;
  await updateTimer({ mode: "routine", routine_id: null, ...resetPatch });
  await run(db.from("routines").delete().eq("id", ar.routine.id)).catch(() => {});
  loadAll();
});

$("#routine-examples").addEventListener("click", async () => {
  try {
    await writeRoutine(null, "Concentración 50/10", 3, [
      { label: "Estudiando", seconds: 3000, kind: "work", position: 0 },
      { label: "Descansando", seconds: 600, kind: "break", position: 1 },
    ]);
    await writeRoutine(null, "Estudio 45/15", 2, [
      { label: "Estudiando", seconds: 2700, kind: "work", position: 0 },
      { label: "Descansando", seconds: 900, kind: "break", position: 1 },
    ]);
  } catch (_) {
    toast("No se pudieron crear. Comprueba que has ejecutado migracion-v2.sql en Supabase.");
  }
  loadAll();
});

$("#routine-dialog").addEventListener("click", (e) => {
  if (e.target === $("#routine-dialog")) closeDialog($("#routine-dialog"));
});

renderers.push(renderTimer);
