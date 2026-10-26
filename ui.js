"use strict";
// Componentes de entrada reutilizables, sin ventanas nativas del navegador:
//  - askText({...})      → Promise<string|null>   (sustituye a prompt)
//  - askConfirm({...})   → Promise<boolean>        (sustituye a confirm)
//  - openWizard({...})   → asistente paso a paso con una pregunta cada vez
// Los avisos informativos (antes alert) usan toast().

function uiShell(className) {
  const dlg = h("dialog", { class: "ui-dialog " + (className || "") });
  document.body.append(dlg);
  return dlg;
}

function uiClose(dlg) {
  closeDialog(dlg);
  setTimeout(() => dlg.remove(), 0);
}

function askText({ title, placeholder = "", value = "", confirmLabel = "Guardar", maxLength = 80, validate = null } = {}) {
  return new Promise((resolve) => {
    const dlg = uiShell("ui-small");
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      uiClose(dlg);
      resolve(v);
    };
    const input = h("input", { class: "ui-input", maxlength: maxLength, placeholder, "aria-label": placeholder || title, autocomplete: "off", value });
    const err = h("p", { class: "ui-error", role: "alert" });
    const form = h("form", { novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const v = input.value.trim();
        const problem = !v ? "Escribe un nombre." : validate ? validate(v) : "";
        if (problem) { err.textContent = problem; input.focus(); return; }
        finish(v);
      } },
      h("h2", { class: "ui-title", text: title }),
      input, err,
      h("div", { class: "ui-actions" },
        h("button", { type: "button", class: "ui-btn ghost", text: "Cancelar", onclick: () => finish(null) }),
        h("button", { type: "submit", class: "ui-btn primary", text: confirmLabel })));
    dlg.append(form);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener("click", (e) => e.target === dlg && finish(null));
    input.addEventListener("input", () => (err.textContent = ""));
    openDialog(dlg);
    input.focus();
    input.select();
  });
}

function askConfirm({ title, text = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = uiShell("ui-small");
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      uiClose(dlg);
      resolve(v);
    };
    const ok = h("button", { type: "button", class: "ui-btn " + (danger ? "danger" : "primary"), text: confirmLabel, onclick: () => finish(true) });
    dlg.append(
      h("div", { role: "alertdialog", "aria-label": title },
        h("h2", { class: "ui-title", text: title }),
        text ? h("p", { class: "ui-text", text }) : null,
        h("div", { class: "ui-actions" },
          h("button", { type: "button", class: "ui-btn ghost", text: cancelLabel, onclick: () => finish(false) }), ok))
    );
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener("click", (e) => e.target === dlg && finish(false));
    openDialog(dlg);
    (danger ? dlg.querySelector(".ui-btn.ghost") : ok).focus();
  });
}

// Varias salidas posibles: options = [{ label, value, kind: "primary"|"danger"|"ghost" }]. Cancelar/Esc devuelve null.
function askChoice({ title, text = "", options = [] } = {}) {
  return new Promise((resolve) => {
    const dlg = uiShell("ui-small");
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      uiClose(dlg);
      resolve(v);
    };
    const buttons = options.map((o) => h("button", { type: "button", class: "ui-btn " + (o.kind || "ghost"), text: o.label, onclick: () => finish(o.value) }));
    dlg.append(
      h("div", { role: "alertdialog", "aria-label": title },
        h("h2", { class: "ui-title", text: title }),
        text ? h("p", { class: "ui-text", text }) : null,
        h("div", { class: "ui-actions ui-stack" }, ...buttons))
    );
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener("click", (e) => e.target === dlg && finish(null));
    openDialog(dlg);
    (buttons.find((b) => b.classList.contains("primary")) || buttons[0])?.focus();
  });
}

/* ---------- Asistente paso a paso ---------- */
// steps: [{ key, label, type: text|textarea|amount|date|choice|color, required, placeholder, options, hint,
//           maxLength, validate(value, values) → texto de error, when(values) → bool, format(value) → texto del resumen,
//           quick: [{label, value}] (atajos para fechas) }]
// onSubmit(values) → Promise<boolean|string>  (false o texto = error; true = guardado)

function openWizard({ steps, initial = {}, submitLabel = "Guardar", doneMessage = "Guardado.", onSubmit, earlyAfter = null, startAt = null }) {
  const dlg = uiShell("ui-wizard");
  const values = { ...initial };
  const active = () => steps.filter((s) => !s.when || s.when(values));
  let idx = Math.max(0, active().findIndex((s) => s.key === startAt)); // se busca entre los pasos activos (los condicionales ocultos no cuentan) // idx === active().length → pantalla de confirmación
  let busy = false;
  let dir = 1;

  const optionsOf = (s) => (typeof s.options === "function" ? s.options(values) : s.options);

  const stepFormat = (s) => {
    const v = values[s.key];
    if (s.format) return s.format(v);
    if (v == null || v === "") return "—";
    if (s.type === "choice" || s.type === "color") { const o = optionsOf(s).find((x) => x.value === v); return o ? o.label : String(v); }
    return String(v);
  };

  const checkStep = (s) => {
    const v = values[s.key];
    const empty = v == null || String(v).trim() === "";
    if (s.required && empty) return s.requiredMessage || "Este dato es obligatorio.";
    if (!empty && s.validate) return s.validate(v, values) || "";
    return "";
  };

  const bar = h("span");
  const body = h("div", { class: "wiz-body" });
  const err = h("p", { class: "ui-error", role: "alert" });
  const back = h("button", { type: "button", class: "ui-btn ghost", text: "Volver" });
  const early = h("button", { type: "button", class: "ui-btn ghost", text: "Guardar ya" });
  const next = h("button", { type: "submit", class: "ui-btn blue", text: "Continuar" });
  const cancel = h("button", { type: "button", class: "wiz-close", "aria-label": "Cancelar", title: "Cancelar", text: "✕", onclick: () => close(false) });
  const form = h("form", { novalidate: true, class: "wiz-form" },
    h("div", { class: "wiz-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, bar),
    cancel, body, err,
    h("div", { class: "ui-actions wiz-actions" }, back, h("span", { class: "grow" }), early, next));
  dlg.append(form);

  function close(saved) {
    uiClose(dlg);
    if (saved && doneMessage) toast(doneMessage);
  }

  function field(s) {
    const id = "wiz-" + s.key;
    const set = (v) => { values[s.key] = v; err.textContent = ""; };
    if (s.type === "choice") {
      const wrap = h("div", { class: "wiz-choices", role: "radiogroup", "aria-label": s.label });
      const opts = optionsOf(s);
      for (const o of opts) {
        const on = values[s.key] === o.value;
        wrap.append(h("button", { type: "button", class: "wiz-chip" + (on ? " on" : ""), role: "radio", "aria-checked": String(on), text: o.label,
          onclick: () => { set(o.value); wrap.querySelectorAll(".wiz-chip").forEach((b) => { const m = b === btn(o); b.classList.toggle("on", m); b.setAttribute("aria-checked", String(m)); }); } }));
      }
      const btn = (o) => wrap.children[opts.indexOf(o)];
      return wrap;
    }
    if (s.type === "weekdays") {
      // Días de la semana (0 = lunes … 6 = domingo): botones compactos que se activan/desactivan; el valor es un array de números
      const wrap = h("div", { class: "wiz-days", role: "group", "aria-label": s.label });
      const cur = new Set(Array.isArray(values[s.key]) ? values[s.key] : []);
      (s.options || []).forEach((o) => {
        const b = h("button", { type: "button", class: "wiz-day", "aria-pressed": String(cur.has(o.value)), "aria-label": o.title || o.label, title: o.title || o.label, text: o.label,
          onclick: () => { cur.has(o.value) ? cur.delete(o.value) : cur.add(o.value); b.setAttribute("aria-pressed", String(cur.has(o.value))); set([...cur].sort((x, y) => x - y)); } });
        wrap.append(b);
      });
      return wrap;
    }
    if (s.type === "color") {
      const wrap = h("div", { class: "wiz-colors", role: "radiogroup", "aria-label": s.label });
      for (const o of optionsOf(s)) {
        const on = values[s.key] === o.value;
        wrap.append(h("button", { type: "button", class: "wiz-color" + (on ? " on" : ""), role: "radio", "aria-checked": String(on), "aria-label": o.label, title: o.label,
          "data-v": o.value, style: `--c:${o.value}`,
          onclick: () => { set(o.value); wrap.querySelectorAll(".wiz-color").forEach((b) => { const m = b.dataset.v === o.value; b.classList.toggle("on", m); b.setAttribute("aria-checked", String(m)); }); } }));
      }
      return wrap;
    }
    if (s.type === "emoji") {
      // Emojis sugeridos + campo libre para escribir/pegar cualquier otro (teclado de emojis del móvil o del sistema)
      const wrap = h("div", { class: "wiz-emojis" });
      const grid = h("div", { class: "wiz-emoji-grid", role: "radiogroup", "aria-label": s.label });
      const input = h("input", { id, class: "wiz-input wiz-emoji-input", maxlength: 12, placeholder: "Otro emoji…", "aria-label": "Escribir otro emoji", autocomplete: "off", value: values[s.key] || "" });
      const sync = () => grid.querySelectorAll(".wiz-emoji").forEach((b) => { const m = b.dataset.v === values[s.key]; b.classList.toggle("on", m); b.setAttribute("aria-checked", String(m)); });
      for (const e of optionsOf(s)) {
        grid.append(h("button", { type: "button", class: "wiz-emoji", role: "radio", "data-v": e, "aria-label": e, text: e, "aria-checked": String(values[s.key] === e),
          onclick: () => { set(e); input.value = e; sync(); } }));
      }
      input.oninput = () => { set(input.value.trim()); sync(); };
      wrap.append(grid, input);
      sync();
      return wrap;
    }
    if (s.type === "textarea") {
      return h("textarea", { id, class: "wiz-input", rows: 3, maxlength: s.maxLength || 500, placeholder: s.placeholder || "", "aria-label": s.label, value: values[s.key] || "",
        oninput: (e) => set(e.target.value) });
    }
    const input = h("input", {
      id, class: "wiz-input", maxlength: s.maxLength || 200, placeholder: s.placeholder || "", "aria-label": s.label, autocomplete: "off",
      type: s.type === "date" ? "date" : "text", inputmode: s.type === "amount" ? "decimal" : null, value: values[s.key] == null ? "" : values[s.key],
      oninput: (e) => set(e.target.value),
    });
    if (s.type === "date" && s.quick) {
      return h("div", {}, input, h("div", { class: "wiz-quick" }, ...s.quick.map((q) =>
        h("button", { type: "button", class: "wiz-chip small", text: q.label, onclick: () => { input.value = q.value; set(q.value); } }))));
    }
    return input;
  }

  function render() {
    const list = active();
    err.textContent = "";
    body.className = "wiz-body " + (dir > 0 ? "from-right" : "from-left");
    void body.offsetWidth; // reinicia la animación
    const total = list.length + 1;
    const pct = Math.round(((idx + 1) / total) * 100);
    bar.style.width = pct + "%";
    form.querySelector(".wiz-progress").setAttribute("aria-valuenow", String(pct));
    back.style.visibility = idx === 0 ? "hidden" : "visible";
    if (idx >= list.length) {
      body.replaceChildren(
        h("h2", { class: "wiz-q", text: "¿Todo correcto?" }),
        h("dl", { class: "wiz-summary" }, ...list.flatMap((s, i) => [
          h("dt", { text: s.summaryLabel || s.label }),
          h("dd", {}, h("span", { text: stepFormat(s) }), h("button", { type: "button", class: "wiz-edit", text: "Editar", onclick: () => { dir = -1; idx = i; render(); } })),
        ])));
      next.textContent = submitLabel;
      show(early, false);
      next.focus();
      return;
    }
    const s = list[idx];
    body.replaceChildren(...[
      h("label", { class: "wiz-q", for: "wiz-" + s.key, text: s.label }),
      s.hint ? h("p", { class: "wiz-hint", text: s.hint }) : null,
      field(s),
    ].filter(Boolean));
    next.textContent = "Continuar";
    const canEarly = earlyAfter != null && idx >= earlyAfter && idx < list.length - 1 && list.slice(0, idx + 1).every((x) => !checkStep(x));
    show(early, canEarly);
    const el = body.querySelector("input, textarea, .wiz-chip.on, .wiz-color.on, .wiz-emoji.on, .wiz-chip, .wiz-color, .wiz-emoji, .wiz-day");
    if (el) el.focus();
  }

  async function advance() {
    if (busy) return;
    const list = active();
    if (idx < list.length) {
      const problem = checkStep(list[idx]);
      if (problem) { err.textContent = problem; const el = body.querySelector("input, textarea, .wiz-chip, .wiz-color, .wiz-emoji, .wiz-day"); if (el) el.focus(); return; }
      dir = 1;
      idx += 1;
      render();
      return;
    }
    await submit();
  }

  async function submit() {
    if (busy) return;
    const list = active();
    for (let i = 0; i < list.length; i++) {
      const problem = checkStep(list[i]);
      if (problem) { dir = -1; idx = i; render(); err.textContent = problem; return; }
    }
    busy = true;
    next.disabled = early.disabled = back.disabled = true;
    let res = false;
    try { res = await onSubmit({ ...values }); } catch (_) { res = false; }
    busy = false;
    next.disabled = early.disabled = back.disabled = false;
    if (res === true) return close(true);
    err.textContent = typeof res === "string" && res ? res : "No se pudo guardar. Inténtalo de nuevo.";
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); advance(); });
  back.addEventListener("click", () => { if (idx > 0 && !busy) { dir = -1; idx -= 1; render(); } });
  early.addEventListener("click", async () => { dir = 1; idx = active().length; render(); await submit(); });
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const t = e.target;
    if (t.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey)) return;
    if (t.tagName === "BUTTON" && t !== next && !t.classList.contains("wiz-chip")) return;
    e.preventDefault();
    advance();
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
  dlg.addEventListener("click", (e) => e.target === dlg && close(false));

  openDialog(dlg);
  render();
  return dlg;
}
