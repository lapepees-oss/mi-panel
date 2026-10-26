"use strict";
// Notificaciones del sistema.
//  1) Locales (sin servidor): avisos de fase y una notificación que muestra el tiempo del cronómetro
//     (cuánto queda de la fase, o por cuánto va) cuando sales de la app. Funcionan mientras el navegador
//     mantiene la página viva; si el sistema la congela, la notificación deja de actualizarse.
//  2) Push (con la app cerrada): suscripción Web Push guardada en Supabase; las envía la función
//     supabase/functions/cloudspace-push. Requiere configuración (README).

const NOTIF_DEFAULTS = { phase: true, progress: true };
const notifPrefs = () => ({ ...NOTIF_DEFAULTS, ...store.get("notif", {}) });
const notifSupported = () => "Notification" in window;
const notifGranted = () => notifSupported() && Notification.permission === "granted";

async function swRegistration() {
  try {
    return "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
  } catch (_) {
    return null;
  }
}

async function showSystem(title, body, { tag = "cloudspace", silent = false, requireInteraction = false, renotify = false } = {}) {
  if (!notifGranted()) return false;
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/favicon-32.png", tag, silent, requireInteraction, renotify, data: { url: "./#/timer" } };
  try {
    const reg = await swRegistration();
    if (reg && reg.showNotification) await reg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch (_) {
    return false;
  }
}

async function closeSystem(tag) {
  try {
    const reg = await swRegistration();
    if (!reg || !reg.getNotifications) return;
    (await reg.getNotifications({ tag })).forEach((n) => n.close());
  } catch (_) {}
}

async function requestNotifPermission() {
  if (!notifSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
}

/* ---------- Notificación con el tiempo del cronómetro ---------- */

const PROGRESS_TAG = "cloudspace-timer-progress";
let progressLast = { text: "", at: 0, shown: false };

// Lo llama el cronómetro en cada tic con lo que habría que mostrar; null = nada que mostrar (parado)
function timerProgress(info) {
  if (!info || !notifPrefs().progress || !notifGranted() || !document.hidden) {
    if (progressLast.shown) {
      progressLast = { text: "", at: 0, shown: false };
      closeSystem(PROGRESS_TAG);
    }
    return;
  }
  const now = Date.now();
  const key = info.title + "|" + info.body;
  // Se refresca como mucho cada 10 s, salvo que cambie de fase
  if (progressLast.shown && info.phaseKey === progressLast.phaseKey && now - progressLast.at < 10000) return;
  if (progressLast.shown && key === progressLast.text) return;
  progressLast = { text: key, at: now, shown: true, phaseKey: info.phaseKey };
  showSystem(info.title, info.body, { tag: PROGRESS_TAG, silent: true, requireInteraction: true });
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && progressLast.shown) {
    progressLast = { text: "", at: 0, shown: false };
    closeSystem(PROGRESS_TAG);
  } else if (document.hidden && typeof tickTimer === "function") {
    progressLast = { text: "", at: 0, shown: false };
    tickTimer();
  }
});

/* ---------- Push con la app cerrada ---------- */

const pushConfigured = () => !!cfg.VAPID_PUBLIC_KEY && !(typeof isGuest === "function" && isGuest()) && "PushManager" in window && "serviceWorker" in navigator;

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentPushSub() {
  const reg = await swRegistration();
  return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
}

async function enablePush() {
  const reg = await swRegistration();
  if (!reg) throw new Error("El service worker no está activo. Recarga la página e inténtalo de nuevo.");
  const sub = (await currentPushSub()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  await run(db.from("push_subscriptions").upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" }));
  return true;
}

async function disablePush() {
  const sub = await currentPushSub();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await run(db.from("push_subscriptions").delete().eq("endpoint", endpoint)).catch(() => {});
}

// Ajustes guardados en la base de datos (hora del resumen, avisos del cronómetro con la app cerrada)
let notifSettings = null;
async function loadNotifSettings() {
  try {
    const row = await run(db.from("notification_settings").select("*").eq("user_id", user.id).maybeSingle());
    notifSettings = row || { daily_enabled: false, daily_hour: 8, timer_enabled: true };
    return notifSettings;
  } catch (_) {
    notifSettings = null; // tabla sin crear: falta ejecutar migracion-v4.sql
    return null;
  }
}
async function saveNotifSettings(patch) {
  const next = { ...(notifSettings || { daily_enabled: false, daily_hour: 8, timer_enabled: true }), ...patch };
  await run(db.from("notification_settings").upsert({ user_id: user.id, daily_enabled: !!next.daily_enabled, daily_hour: Number(next.daily_hour), timer_enabled: !!next.timer_enabled }, { onConflict: "user_id" }));
  notifSettings = next;
}
