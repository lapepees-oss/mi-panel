"use strict";
// Cronometro libre y rutinas encadenadas (por ejemplo 25 min estudiando + 5 descansando).
// Se guarda la hora de inicio y el tiempo acumulado, no los segundos. Asi sigue contando
// con la pantalla bloqueada y la fase actual se calcula igual en todos los dispositivos.

let tickHandle = null;
let lastPhaseKey = null;
let finishing = false;
let audioCtx = null;

const routineById = (id) => state.routines.find((r) => r.id === id);
const stepsOfRoutine = (id) =>
  state.routineSteps.filter((s) => s.routine_id === id).sort((a, b) => a.position - b.position);

function activeRoutine() {
  const t = state.timer;
  if (!t || t.mode !== "routine") return null;
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

// Tiempo de "trabajo" acumulado (los descansos no cuentan en la sesion guardada)
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
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) reg.showNotification(title, { body, icon: "icons/icon-192.png", tag: "mipanel-timer" });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch (_) {}
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
  } catch (_) {
    loadAll();
  }
}

const resetPatch = { running: false, started_at: null, accumulated_ms: 0 };

function sessionLabel(extra) {
  return [extra, $("#timer-label").value.trim()].filter(Boolean).join(" · ");
}

async function finishRoutine(ar, p) {
  if (finishing) return;
  finishing = true;
  try {
    // Solo un dispositivo gana esta actualizacion (running pasa de true a false)
    const rows = await run(
      db.from("timer").update(resetPatch).eq("user_id", user.id).eq("running", true).select()
    );
    if (rows && rows.length) {
      state.timer = rows[0];
      const work = workMs(ar, p.total);
      if (work >= 1000) {
        await run(db.from("timer_sessions").insert({ label: sessionLabel(ar.routine.name), duration_ms: work }));
      }
      toast(`✅ Rutina «${ar.routine.name}» completada`);
      beep("break");
      systemNotify("✅ Rutina completada", ar.routine.name);
    }
    loadAll();
  } catch (_) {
  } finally {
    setTimeout(() => (finishing = false), 3000);
  }
}

/* ---------- Pintado ---------- */

function renderTimer() {
  const t = state.timer;
  if (!t) return;
  const ar = activeRoutine();

  // Selector de modo
  const sel = $("#timer-mode");
  sel.replaceChildren(
    h("option", { value: "", text: "⏱ Cronómetro libre" }),
    ...state.routines.map((r) => h("option", { value: r.id, text: "🔁 " + r.name }))
  );
  sel.value = ar ? ar.routine.id : "";
  show($("#routine-edit"), !!ar);
  show($("#routine-del"), !!ar);
  show($("#routine-examples"), state.routines.length === 0);
  show($("#timer-skip"), !!ar);
  show($("#timer-notify"), "Notification" in window && Notification.permission === "default");

  $("#timer-toggle").textContent = t.running ? "Pausar" : elapsed() > 0 ? "Reanudar" : "Iniciar";
  if (document.activeElement !== $("#timer-label")) $("#timer-label").value = t.label || "";

  // Plan de la rutina
  const plan = $("#routine-plan");
  plan.replaceChildren();
  show(plan, !!ar);
  if (ar) {
    const cyc = ar.routine.cycles === 0 ? "sin fin" : `${ar.routine.cycles} ${ar.routine.cycles === 1 ? "ciclo" : "ciclos"}`;
    plan.append(
      h("span", { class: "muted", text: cyc + ": " }),
      ...ar.steps.map((s) => h("span", { class: "step-pill " + s.kind, text: `${s.label} ${minutesText(s.seconds)}` }))
    );
  }
  tickTimer();

  // Sesiones guardadas
  const ul = $("#session-list");
  ul.replaceChildren();
  if (state.sessions.length === 0) {
    ul.append(h("li", { class: "muted", text: "Aún no has guardado sesiones." }));
  }
  for (const s of state.sessions) {
    const when = new Date(s.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
    ul.append(
      h("li", {},
        h("div", { class: "body" }, h("div", { class: "title", text: `${fmt(Number(s.duration_ms))} · ${s.label || "Sin etiqueta"}` }), h("div", { class: "muted", text: when })),
        h("button", {
          class: "icon-btn", title: "Borrar sesión", text: "✕",
          onclick: async () => {
            state.sessions = state.sessions.filter((x) => x.id !== s.id);
            renderTimer();
            await run(db.from("timer_sessions").delete().eq("id", s.id)).catch(() => {});
            loadAll();
          },
        })
      )
    );
  }
}

function tickTimer() {
  const t = state.timer;
  if (!t) return;
  const ms = elapsed();
  const ar = activeRoutine();
  const card = $("#timer-card");
  const disp = $("#timer-display");

  if (!ar) {
    disp.textContent = fmt(ms);
    $("#phase-label").textContent = "";
    $("#phase-next").textContent = "";
    show($("#phase-bar"), false);
    card.classList.remove("work", "break");
    lastPhaseKey = null;
    document.title = t.running ? `${fmt(ms)} · Cloudspace` : pageTitle();
    return;
  }

  const p = phaseAt(ar, ms);
  if (p.finished) {
    disp.textContent = "00:00";
    if (t.running) finishRoutine(ar, p);
    return;
  }

  disp.textContent = fmtShort(p.remaining + 999);
  card.classList.toggle("work", p.step.kind === "work");
  card.classList.toggle("break", p.step.kind === "break");
  const cycleTxt = ar.routine.cycles === 0 ? `Ciclo ${p.cycle + 1}` : `Ciclo ${p.cycle + 1}/${ar.routine.cycles}`;
  $("#phase-label").textContent = `${p.step.kind === "break" ? "☕" : "📚"} ${p.step.label} · ${cycleTxt}`;
  $("#phase-next").textContent = p.next ? `Siguiente: ${p.next.label} (${minutesText(p.next.seconds)})` : "Última fase";
  show($("#phase-bar"), true);
  $("#phase-fill").style.width = `${Math.min(100, (1 - p.remaining / p.dur) * 100)}%`;

  const key = `${t.routine_id}:${p.cycle}:${p.idx}`;
  if (t.running && lastPhaseKey !== null && key !== lastPhaseKey) alertPhase(p);
  lastPhaseKey = t.running ? key : null;
  document.title = t.running ? `${fmtShort(p.remaining + 999)} ${p.step.label} · Cloudspace` : pageTitle();
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

$("#timer-toggle").addEventListener("click", () => {
  const t = state.timer;
  if (!t) return;
  if (t.running) updateTimer({ running: false, started_at: null, accumulated_ms: elapsed() });
  else updateTimer({ running: true, started_at: new Date().toISOString() });
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
  if (elapsed() > 5000 && !(await askConfirm({ title: "¿Reiniciar sin guardar la sesión?", text: "Se perderá el tiempo que llevas.", confirmLabel: "Reiniciar", danger: true }))) return;
  lastPhaseKey = null;
  updateTimer(resetPatch);
});

$("#timer-save").addEventListener("click", async () => {
  const ar = activeRoutine();
  const ms = ar ? workMs(ar, elapsed()) : elapsed();
  if (ms < 1000) {
    toast(ar ? "Todavía no hay tiempo de trabajo que guardar." : "Todavía no hay tiempo que guardar.");
    return;
  }
  lastPhaseKey = null;
  await run(
    db.from("timer_sessions").insert({ label: sessionLabel(ar ? ar.routine.name : ""), duration_ms: ms })
  ).catch(() => {});
  await updateTimer(resetPatch);
  loadAll();
});

$("#timer-label").addEventListener("change", () => updateTimer({ label: $("#timer-label").value.trim() }));

$("#timer-mode").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (elapsed() > 5000 && !(await askConfirm({ title: "¿Cambiar de modo?", text: "Cambiar de modo reinicia el cronómetro actual.", confirmLabel: "Continuar" }))) {
    renderTimer();
    return;
  }
  lastPhaseKey = null;
  updateTimer({ mode: id ? "routine" : "stopwatch", routine_id: id || null, ...resetPatch });
});

$("#timer-notify").addEventListener("click", async () => {
  try {
    await Notification.requestPermission();
  } catch (_) {}
  renderTimer();
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
  if (ar) openRoutineEditor(ar.routine.id);
});

$("#routine-del").addEventListener("click", async () => {
  const ar = activeRoutine();
  if (!ar || !(await askConfirm({ title: `¿Borrar la rutina «${ar.routine.name}»?`, text: "No se puede deshacer.", confirmLabel: "Borrar rutina", danger: true }))) return;
  lastPhaseKey = null;
  await updateTimer({ mode: "stopwatch", routine_id: null, ...resetPatch });
  await run(db.from("routines").delete().eq("id", ar.routine.id)).catch(() => {});
  loadAll();
});

$("#routine-examples").addEventListener("click", async () => {
  try {
    await writeRoutine(null, "Pomodoro 25/5", 4, [
      { label: "Estudiando", seconds: 1500, kind: "work", position: 0 },
      { label: "Descansando", seconds: 300, kind: "break", position: 1 },
    ]);
    await writeRoutine(null, "Concentración 50/10", 3, [
      { label: "Estudiando", seconds: 3000, kind: "work", position: 0 },
      { label: "Descansando", seconds: 600, kind: "break", position: 1 },
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
