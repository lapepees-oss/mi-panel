// Aplica el tema antes de pintar para evitar parpadeos. Por defecto, el tema «Nube» (cielo de noche).
// Va en un archivo propio para que la política de contenido no necesite scripts en línea.
try {
  var T = ["nube", "nube-negro", "nube-dia", "light", "dark", "mix", "minimal", "minimal-dark"];
  var t = JSON.parse(localStorage.getItem("mipanel.theme"));
  // Estreno del tema Nube: se aplica una vez a todos; después manda lo que elijas en Preferencias
  if (!localStorage.getItem("mipanel.nubeIntro")) { t = "nube"; localStorage.setItem("mipanel.theme", JSON.stringify(t)); localStorage.setItem("mipanel.nubeIntro", "1"); }
  document.documentElement.dataset.theme = T.indexOf(t) >= 0 ? t : "nube";
} catch (_) { document.documentElement.dataset.theme = "nube"; }
