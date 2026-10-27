"use strict";
// Preferencias por usuario: diseño del Resumen (dashboard) y textos personalizados (texts).
//  - Cuenta real: se guardan en Supabase (tabla user_prefs, migracion-v9.sql) y se cachean en este navegador con
//    una clave que incluye el id del usuario, así dos cuentas en el mismo navegador nunca se mezclan.
//  - Invitado: solo en memoria. Se pierde al cerrar la pestaña y NUNCA toca la caché ni la base de ninguna cuenta.
//  - Si la tabla no existe (no se ejecutó v9) o no hay red, el cambio queda en la caché local y se reintenta después.

const UP = { uid: null, dash: null, texts: {}, remote: true, loaded: false, dirty: false, warned: false };
let upTimer = null;

const upCacheKey = (uid) => "prefs." + uid;
const upUid = () => (user && user.id) || null;

// Cambia de "usuario" sin arrastrar nada del anterior
function upEnsure() {
  const uid = upUid();
  if (UP.uid === uid) return;
  clearTimeout(upTimer);
  Object.assign(UP, { uid, dash: null, texts: {}, remote: true, loaded: false, dirty: false, warned: false });
  if (!uid || isGuest()) return; // invitado: memoria vacía y temporal
  const c = store.get(upCacheKey(uid), null);
  if (c && typeof c === "object") { UP.dash = c.dash || null; UP.texts = c.texts || {}; UP.dirty = !!c.dirty; }
  else { const legacy = store.get("dashLayout", null); if (legacy) UP.dash = legacy; } // diseño anterior (por navegador): se adopta una vez
}

function upCache() {
  if (!UP.uid || isGuest()) return;
  store.set(upCacheKey(UP.uid), { dash: UP.dash, texts: UP.texts, dirty: UP.dirty });
}

async function loadUserPrefs() {
  upEnsure();
  if (!UP.uid || isGuest()) { UP.loaded = true; return; }
  try {
    const { data, error } = await db.from("user_prefs").select("dashboard, texts").eq("user_id", UP.uid).maybeSingle();
    if (error) throw error;
    UP.remote = true;
    if (data && !UP.dirty) {
      UP.dash = data.dashboard && Object.keys(data.dashboard).length ? data.dashboard : UP.dash;
      UP.texts = data.texts && typeof data.texts === "object" ? data.texts : {};
      upCache();
    } else if (UP.dash || Object.keys(UP.texts).length) {
      upPush(); // no hay fila en la nube (o hay cambios sin enviar): sube lo local
    }
  } catch (e) {
    UP.remote = false; // tabla ausente o sin red: se sigue con la caché local
  }
  UP.loaded = true;
}

async function upPush() {
  if (!UP.uid || isGuest()) return;
  try {
    const { error } = await db.from("user_prefs").upsert({ user_id: UP.uid, dashboard: UP.dash || {}, texts: UP.texts || {}, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    UP.remote = true; UP.dirty = false; upCache();
  } catch (e) {
    UP.remote = false; UP.dirty = true; upCache();
    if (!UP.warned) { UP.warned = true; toast("Tu diseño se guarda en este dispositivo. Para sincronizarlo, ejecuta migracion-v9.sql en Supabase."); }
  }
}

// kind: "dash" | "texts". Guarda al instante en local/memoria y sincroniza con la nube tras una pausa.
function upSet(kind, value) {
  upEnsure();
  UP[kind] = value;
  if (!UP.uid || isGuest()) return; // invitado: solo memoria
  UP.dirty = true;
  upCache();
  clearTimeout(upTimer);
  upTimer = setTimeout(upPush, 700);
}
const upDash = () => { upEnsure(); return UP.dash; };
const upTexts = () => { upEnsure(); return UP.texts || {}; };

LOADERS.user_prefs = loadUserPrefs;
window.addEventListener("pagehide", () => { if (UP.dirty && UP.uid && !isGuest()) upPush(); });
