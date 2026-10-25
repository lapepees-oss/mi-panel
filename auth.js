"use strict";
// Acceso real con Supabase Auth: iniciar sesión, registro, recuperación, Google y cierre de sesión.
// Las contraseñas solo viajan a Supabase por HTTPS; nunca se guardan en este navegador.
// En el navegador solo queda el token de sesión que gestiona la librería de Supabase.

let authMode = "login";
let authBusy = false;
// true mientras el usuario llega desde un enlace de "recuperar contraseña" y aún no ha elegido la nueva
let recoveryActive = /[#&]type=recovery\b/.test(location.hash);

/* ---------- Persistencia de la sesión ("mantener la sesión iniciada") ---------- */

const REMEMBER_KEY = "mipanel.remember"; // solo un 0/1, sin credenciales
const rememberSession = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch (_) {
    return true;
  }
};

// Con "mantener sesión" el token va a localStorage; sin ella, a sessionStorage (se borra al cerrar la pestaña)
const sessionStore = {
  getItem(k) {
    try {
      const s = sessionStorage.getItem(k);
      return s != null ? s : localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  },
  setItem(k, v) {
    try {
      if (rememberSession()) {
        localStorage.setItem(k, v);
        sessionStorage.removeItem(k);
      } else {
        sessionStorage.setItem(k, v);
        localStorage.removeItem(k);
      }
    } catch (_) {}
  },
  removeItem(k) {
    try {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    } catch (_) {}
  },
};

function createDb() {
  return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      storage: sessionStore,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Flujo implícito: los enlaces del correo funcionan aunque se abran en otro dispositivo
      flowType: "implicit",
    },
  });
}

// URL a la que vuelven los correos y Google. Debe estar en Supabase > Authentication > URL Configuration.
const redirectUrl = () => location.origin + location.pathname;

/* ---------- Interfaz ---------- */

const AUTH_TEXT = {
  login: { eyebrow: "QUÉ BUENO TENERTE AQUÍ", title: "Bienvenido de nuevo", sub: "Inicia sesión para continuar donde lo dejaste.", submit: "Entrar en mi espacio", busy: "Entrando…" },
  signup: { eyebrow: "EMPIEZA HOY", title: "Crea tu espacio", sub: "Un correo y una contraseña. Recibirás un mensaje para confirmar la cuenta.", submit: "Crear mi cuenta", busy: "Creando cuenta…" },
  forgot: { eyebrow: "SIN PROBLEMA", title: "Recupera tu contraseña", sub: "Escribe tu correo y te enviaremos un enlace para elegir una nueva.", submit: "Enviar enlace", busy: "Enviando…" },
  recovery: { eyebrow: "CASI LISTO", title: "Elige una contraseña nueva", sub: "Usa al menos 8 caracteres. Después entrarás directamente.", submit: "Guardar contraseña", busy: "Guardando…" },
};

function setAuthStatus(msg, kind = "") {
  const el = $("#status-message");
  el.textContent = msg || "";
  el.className = "status-message" + (kind ? " " + kind : "");
}

function clearFieldErrors() {
  for (const f of ["email", "password", "confirm"]) {
    $(`#${f}-error`).textContent = "";
    $(`#${f}`).removeAttribute("aria-invalid");
    $(`#${f}`).removeAttribute("aria-describedby");
  }
}

function showFieldErrors(errors) {
  clearFieldErrors();
  let first = null;
  for (const [f, msg] of Object.entries(errors)) {
    $(`#${f}-error`).textContent = msg;
    $(`#${f}`).setAttribute("aria-invalid", "true");
    $(`#${f}`).setAttribute("aria-describedby", `${f}-error`);
    first = first || $(`#${f}`);
  }
  if (first) first.focus();
}

function setAuthMode(mode, { keepStatus = false } = {}) {
  if (mode === "signup" && !flags.allowSignup) mode = "login";
  authMode = mode;
  const t = AUTH_TEXT[mode];
  $("#auth-eyebrow").textContent = t.eyebrow;
  $("#auth-title").textContent = t.title;
  $("#auth-sub").textContent = t.sub;
  $("#submit-label").textContent = t.submit;
  $$("#auth-form [data-for]").forEach((el) => show(el, el.dataset.for.split(" ").includes(mode)));
  const pw = $("#password");
  pw.autocomplete = mode === "login" ? "current-password" : "new-password";
  pw.placeholder = mode === "login" ? "Tu contraseña" : "Mínimo 8 caracteres";
  $("#password-label").textContent = mode === "recovery" ? "Contraseña nueva" : "Contraseña";
  // Pestañas solo en login/registro, y solo si el registro está abierto
  const tabs = $("#auth-tabs");
  show(tabs, (mode === "login" || mode === "signup") && flags.allowSignup);
  $$("#auth-tabs .mode").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  show($("#auth-back"), mode === "forgot");
  const social = (mode === "login" || mode === "signup") && flags.google;
  show($("#google-button"), social);
  show($("#auth-sep"), social);
  clearFieldErrors();
  if (!keepStatus) setAuthStatus("");
  $("#password").type = "password";
  $("#toggle-password").textContent = "Mostrar";
  $("#toggle-password").setAttribute("aria-pressed", "false");
  $("#toggle-password").setAttribute("aria-label", "Mostrar contraseña");
}

function setBusy(on) {
  authBusy = on;
  const btn = $("#submit-button");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  btn.setAttribute("aria-busy", String(on));
  $("#submit-label").textContent = on ? AUTH_TEXT[authMode].busy : AUTH_TEXT[authMode].submit;
  $("#google-button").disabled = on;
}

function showAuthScreen(mode = "login", message = "") {
  show($("#app"), false);
  show($("#setup"), false);
  show($("#auth"), true);
  setAuthMode(mode, { keepStatus: !!message });
  if (message) setAuthStatus(message.text, message.kind);
}

// Errores que Supabase deja en la URL tras un enlace caducado o inválido
function authErrorFromUrl() {
  const params = new URLSearchParams(location.hash.replace(/^#/, "").replace(/^\/?\??/, ""));
  const desc = params.get("error_description");
  if (!desc) return null;
  const code = params.get("error_code");
  return code === "otp_expired" ? "El enlace ha caducado o ya se usó. Pide uno nuevo." : "No se pudo validar el enlace: " + desc.replace(/\+/g, " ");
}

/* ---------- Eventos del formulario ---------- */

$$("#auth-tabs .mode").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));
$("#forgot-button").addEventListener("click", () => {
  const typed = $("#email").value;
  setAuthMode("forgot");
  $("#email").value = typed;
  $("#email").focus();
});
$("#auth-back").addEventListener("click", () => setAuthMode("login"));

$("#toggle-password").addEventListener("click", () => {
  const visible = $("#password").type === "password";
  for (const id of ["password", "confirm"]) $("#" + id).type = visible ? "text" : "password";
  $("#toggle-password").textContent = visible ? "Ocultar" : "Mostrar";
  $("#toggle-password").setAttribute("aria-pressed", String(visible));
  $("#toggle-password").setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authBusy || !db) return;
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const confirm = $("#confirm").value;
  const mode = authMode;

  const errors = Logic.validateAuth({ mode, email, password, confirm });
  showFieldErrors(errors);
  if (Object.keys(errors).length) {
    setAuthStatus("");
    return;
  }

  setAuthStatus("");
  setBusy(true);
  try {
    if (mode === "login") {
      try {
        localStorage.setItem(REMEMBER_KEY, $("#remember").checked ? "1" : "0");
      } catch (_) {}
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $("#password").value = "";
      // La entrada a la app la dispara onAuthStateChange
    } else if (mode === "signup") {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      $("#password").value = "";
      $("#confirm").value = "";
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // Supabase no revela si el correo existe, pero devuelve un usuario sin identidades
        setAuthStatus(Logic.authErrorText({ code: "user_already_exists" }), "error");
      } else if (!data.session) {
        setAuthMode("login", { keepStatus: true });
        setAuthStatus("Cuenta creada. Revisa tu correo (y el spam) y pulsa el enlace de confirmación; después podrás entrar.", "ok");
      }
    } else if (mode === "forgot") {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
      if (error) throw error;
      // Mensaje neutro: no se revela si la cuenta existe
      setAuthStatus("Si ese correo tiene una cuenta, recibirás un enlace para elegir una contraseña nueva. Puede tardar un minuto.", "ok");
    } else if (mode === "recovery") {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      recoveryActive = false;
      $("#password").value = "";
      $("#confirm").value = "";
      const { data } = await db.auth.getSession();
      toast("Contraseña actualizada. Ya has entrado.");
      await onSession(data.session);
    }
  } catch (err) {
    setAuthStatus(Logic.authErrorText(err), "error");
  } finally {
    setBusy(false);
  }
});

$("#google-button").addEventListener("click", async () => {
  if (authBusy || !db || !flags.google) return;
  setAuthStatus("");
  setBusy(true);
  try {
    const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl() } });
    if (error) throw error;
    setAuthStatus("Redirigiendo a Google…", "ok"); // el navegador sale de la página
  } catch (err) {
    setAuthStatus(Logic.authErrorText(err), "error");
    setBusy(false);
  }
});

/* ---------- Sesión ---------- */

async function logout() {
  try {
    await db.auth.signOut();
  } catch (_) {}
  await onSession(null); // por si el evento tarda: la interfaz se cierra ya
}

$("#logout").addEventListener("click", logout);

// Al cerrar sesión no deja datos privados en memoria ni borradores en este navegador
function wipeLocalData() {
  for (const k of Object.keys(state)) state[k] = Array.isArray(state[k]) ? [] : null;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("mipanel.draft.")) localStorage.removeItem(k);
  } catch (_) {}
}
