// Aplica el tema antes de pintar para evitar parpadeos (oscuro por defecto).
// Va en un archivo propio para que la política de contenido no necesite scripts en línea.
try {
  var t = JSON.parse(localStorage.getItem("mipanel.theme"));
  if (["light", "dark", "mix", "minimal", "minimal-dark"].includes(t)) document.documentElement.dataset.theme = t;
} catch (_) {}
