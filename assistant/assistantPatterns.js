"use strict";
// Análisis estadístico simple y explicable. Todo son funciones puras sobre la instantánea normalizada.
// Nada de modelos: medias, medianas, ventanas comparables y recuentos. Cada función devuelve también el tamaño de muestra.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../logic.js") : root.Logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssistantPatterns = api;
})(typeof self !== "undefined" ? self : this, function (L) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const pct = (x, y) => (y > 0 ? Math.round((x / y) * 100) : null);
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  // Variación relativa en % respecto a una base (null si no hay base)
  const change = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

  // Días que "tocaban" a un hábito entre from..to (incluidos), desde que existe. Los semanales cuentan una marca por semana.
  function habitWindow(h, from, to) {
    const start = from < h.createdDay ? h.createdDay : from;
    if (start > to) return { due: 0, done: 0, rate: null, from: start, to };
    if (h.frequency === "Semanal") {
      let due = 0, done = 0;
      let w = L.weekStart(start);
      if (w < start) w = L.addDays(w, 7); // solo semanas completas dentro de la ventana
      for (; L.addDays(w, 6) <= to; w = L.addDays(w, 7)) {
        due++;
        if (L.weekKeys(w).some((k) => h.days.has(k))) done++;
      }
      return { due, done, rate: due ? done / due : null, from: start, to };
    }
    let due = 0, done = 0;
    for (let k = start; k <= to; k = L.addDays(k, 1)) {
      if (!L.habitDueOn(h.frequency, k)) { continue; }
      due++;
      if (h.days.has(k)) done++;
    }
    return { due, done, rate: due ? done / due : null, from: start, to };
  }

  // Cumplimiento por día de la semana (0 = lunes) en los últimos n días. Excluye hoy (aún en curso).
  function habitWeekdayProfile(h, today, n) {
    const out = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
    if (h.frequency === "Semanal") return out;
    const to = L.addDays(today, -1);
    for (let k = L.addDays(today, -n); k <= to; k = L.addDays(k, 1)) {
      if (k < h.createdDay || !L.habitDueOn(h.frequency, k)) continue;
      const w = L.weekdayIndex(k);
      out[w].due++;
      if (h.days.has(k)) out[w].done++;
    }
    return out;
  }

  // Resumen de sesiones de concentración entre from..to
  function sessionWindow(sessions, from, to) {
    const inRange = sessions.filter((s) => s.day >= from && s.day <= to);
    const ms = inRange.map((s) => s.ms);
    return { count: inRange.length, totalMs: sum(ms), avgMs: mean(ms), medianMs: median(ms), activeDays: new Set(inRange.map((s) => s.day)).size, from, to };
  }

  // Gasto por categoría de un mes hasta el día `upto` (comparar periodos equivalentes, no un mes entero con uno a medias)
  function spendUpTo(transactions, mk, upto) {
    const last = L.monthBounds(mk).days;
    const lim = `${mk}-${L.pad(Math.min(upto, last))}`;
    const byCategory = {};
    let total = 0, count = 0;
    for (const t of transactions) {
      if (t.type !== "expense" || L.monthKey(t.date) !== mk || t.date > lim) continue;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.cents;
      total += t.cents; count++;
    }
    return { month: mk, upto: Math.min(upto, last), total, byCategory, count };
  }

  // Confianza estadística por tamaño de muestra: crece linealmente hasta `full` observaciones y se satura en 1.
  const sampleFactor = (n, full) => clamp(n / full);

  // Inicio y fin de una ventana de n días que termina en `end` (inclusive)
  const windowDays = (end, n) => ({ from: L.addDays(end, -(n - 1)), to: end });

  return { sum, mean, median, pct, clamp, change, habitWindow, habitWeekdayProfile, sessionWindow, spendUpTo, sampleFactor, windowDays };
});
