"use strict";
// Frases para Resumen, Tareas y Cronómetro. Es una lista fija escrita a mano (no se genera nada):
// la frase del día depende solo de la fecha, así que es la misma en todos tus dispositivos.
// Solo hay citas con autoría clásica bien establecida; las demás van sin firma.

const QUOTES = [
  { text: "No es que tengamos poco tiempo, sino que perdemos mucho.", by: "Séneca", note: "Un recordatorio de cuidar dónde pones tu atención." },
  { text: "Mientras aplazamos la vida, esta pasa.", by: "Séneca", note: "Empezar pequeño hoy suele pesar menos que seguir esperando." },
  { text: "No hay viento favorable para quien no sabe a qué puerto se dirige.", by: "Séneca", note: "Saber qué quieres hace más fácil elegir qué hacer hoy." },
  { text: "No son las cosas las que nos perturban, sino los juicios que hacemos sobre ellas.", by: "Epicteto", note: "A veces basta con mirar de otra forma lo que ya tienes delante." },
  { text: "Lo que no beneficia al enjambre, no beneficia a la abeja.", by: "Marco Aurelio", note: "Lo que haces bien por los demás también te sostiene a ti." },
  { text: "Un viaje de mil millas comienza con un solo paso.", by: "Lao Tse", note: "Un paso a la vez ya es avanzar." },
  { text: "Nadie se baña dos veces en el mismo río.", by: "Heráclito", note: "Todo cambia; hoy es una oportunidad nueva." },
  { text: "Conócete a ti mismo.", by: "Inscripción del templo de Apolo en Delfos", note: "Observar cómo te sientes es parte de organizarte bien." },
  { text: "Solo sé que no sé nada.", by: "Sócrates", note: "Preguntar con curiosidad también es avanzar." },
  { text: "La vida breve es suficiente si se sabe emplear.", by: "Séneca", note: "No hace falta hacerlo todo; basta con lo que importa." },
  { text: "Un pequeño paso hoy hace una gran diferencia mañana." },
  { text: "La constancia no es hacerlo perfecto, es no rendirse." },
  { text: "Hoy también estás construyendo la vida que quieres." },
  { text: "Descansar también forma parte del camino." },
  { text: "Lo importante no es la velocidad, sino seguir en marcha." },
];

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// offset = 0 hoy, -1 ayer… Determinista: depende solo de la fecha
function quoteOfDay(key, offset = 0) {
  const n = dayNumber(key) + offset;
  return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

// Frases cortas y sin firma para tarjetas pequeñas (Cronómetro, Tareas)
const MOTIVATION = QUOTES.filter((q) => !q.by);
function motivationOfDay(key) {
  const n = dayNumber(key);
  return MOTIVATION[((n % MOTIVATION.length) + MOTIVATION.length) % MOTIVATION.length];
}
