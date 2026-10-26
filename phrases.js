"use strict";
// Frase del día del Resumen: colección LOCAL de reflexiones originales (sin llamadas a ninguna API ni coste).
// Ninguna lleva firma: son textos propios, así que no se atribuye nada a ningún filósofo real.
// Cada entrada: s = estilo (filosofico | motivacional | reflexivo), t = frase, a = interpretación breve,
// b = una frase más que se añade cuando eliges la interpretación "Larga".
// La elección de cada día la hace Logic.phraseOfDay (solo depende de la fecha → igual en todos tus dispositivos).

const PHRASES = [
  // --- Filosófico ---
  { s: "filosofico", t: "Lo que repites en silencio acaba siendo el carácter.", a: "Los pequeños gestos de cada día, más que las grandes decisiones, van dando forma a quién eres.", b: "Hoy puedes elegir uno de esos gestos y hacerlo con calma." },
  { s: "filosofico", t: "El tiempo no se gasta: se entrega a algo.", a: "Cada hora termina en alguna parte; la pregunta es si la has dirigido tú.", b: "Basta con decidir a qué quieres entregar la próxima." },
  { s: "filosofico", t: "No controlas el viento, pero sí cómo colocas la vela.", a: "Hay cosas que no dependen de ti; tu respuesta ante ellas sí.", b: "Empieza por separar lo que puedes cambiar de lo que no." },
  { s: "filosofico", t: "Entender algo a medias ya es un lugar desde el que seguir.", a: "No hace falta tenerlo todo claro para avanzar; la claridad suele llegar caminando.", b: "Da el paso que ya entiendes y deja el resto para después." },
  { s: "filosofico", t: "Un día completo no es el que lo contiene todo, sino el que tuvo sentido.", a: "Medir el día por lo que importó, no por cuánto se hizo.", b: "Elige una cosa que valga la pena y deja que eso cuente." },
  { s: "filosofico", t: "La prisa confunde lo urgente con lo importante.", a: "Lo que grita más fuerte no siempre es lo que más te conviene.", b: "Antes de empezar, pregúntate qué pasaría si esperara una hora." },
  { s: "filosofico", t: "Quien sabe por qué empieza soporta casi cualquier cómo.", a: "Un motivo claro hace más llevaderas las dificultades del camino.", b: "Recuerda el porqué de lo que tienes entre manos." },
  { s: "filosofico", t: "La duda bien usada es una forma de atención.", a: "Preguntarte las cosas no es debilidad: es mirar con más cuidado.", b: "Hoy deja que una duda te lleve a mirar mejor, no a parar." },
  { s: "filosofico", t: "Lo simple no es pobre: es lo que queda cuando sobra lo demás.", a: "Quitar lo que no hace falta suele aclarar lo que sí importa.", b: "Prueba a quitar una cosa de hoy y mira qué cambia." },
  { s: "filosofico", t: "Cambiar de opinión también es avanzar.", a: "Corregir el rumbo con nueva información no es incoherencia, es aprender.", b: "Revisa un plan antiguo sin culparte por haberlo hecho." },
  { s: "filosofico", t: "Lo que hoy te pesa fue ayer una decisión razonable.", a: "Mirar atrás con amabilidad ayuda a decidir mejor hacia adelante.", b: "Agradece lo que aprendiste y elige de nuevo." },
  { s: "filosofico", t: "La libertad empieza en el espacio entre el estímulo y la respuesta.", a: "Una pausa corta antes de reaccionar te devuelve la elección.", b: "Respira una vez antes de la próxima cosa que te altere." },
  // --- Motivacional ---
  { s: "motivacional", t: "Empieza pequeño: lo pequeño también cuenta como empezar.", a: "Cinco minutos de verdad valen más que una hora que nunca llega.", b: "Elige la versión más sencilla de tu tarea y comienza por ella." },
  { s: "motivacional", t: "No necesitas verlo entero para dar el siguiente paso.", a: "Con ver el próximo paso es suficiente para ponerse en marcha.", b: "Escribe solo el primer paso y hazlo." },
  { s: "motivacional", t: "La constancia no es hacerlo perfecto, es volver a hacerlo.", a: "Un día flojo no borra el camino; lo que suma es regresar.", b: "Si ayer se torció, hoy es un buen sitio para retomarlo." },
  { s: "motivacional", t: "Hoy basta con hacer una cosa bien.", a: "Una sola tarea cuidada pesa más que diez a medias.", b: "Decide cuál es y dale tu mejor atención un rato." },
  { s: "motivacional", t: "Lo que construyes despacio tiende a quedarse.", a: "El progreso lento suele ser el que se sostiene en el tiempo.", b: "No compares tu ritmo con el de nadie: compáralo con el tuyo de ayer." },
  { s: "motivacional", t: "Ya has empezado cosas difíciles antes; esta no es la primera.", a: "Tu experiencia pasada es una prueba de que puedes con más de lo que crees.", b: "Piensa en algo que lograste y usa esa misma energía." },
  { s: "motivacional", t: "Un buen descanso también es trabajo bien hecho.", a: "Parar a tiempo protege las ganas de seguir mañana.", b: "Si hoy toca descansar, hazlo sin culpa." },
  { s: "motivacional", t: "Hazlo imperfecto, y luego mejóralo.", a: "Un borrador existe; una obra perfecta imaginada, no.", b: "Termina una versión rápida y vuelve a ella después." },
  { s: "motivacional", t: "Cada pequeño avance te deja mejor colocado que ayer.", a: "No hace falta un gran salto: sumar poco cada día cambia el resultado.", b: "Mira qué avanzaste esta semana, aunque parezca poco." },
  { s: "motivacional", t: "Tu ritmo es válido si sigue en marcha.", a: "Ir más lento no es ir hacia atrás.", b: "Ajusta la exigencia de hoy a lo que realmente puedes sostener." },
  { s: "motivacional", t: "Hay días de empuje y días de mantener: ambos suman.", a: "Mantener lo que ya funciona también es avanzar.", b: "Hoy elige entre empujar o mantener, y está bien cualquiera." },
  { s: "motivacional", t: "El mejor momento para empezar es cuando el miedo es solo un poco menor que las ganas.", a: "No hace falta esperar a no sentir nada; basta con que las ganas pesen un poco más.", b: "Si dudas, reduce el tamaño del primer paso." },
  // --- Reflexivo ---
  { s: "reflexivo", t: "¿Qué merece hoy tu mejor atención?", a: "Tu atención es limitada; decidir dónde ponerla es la primera tarea del día.", b: "Escoge una cosa y deja que las demás esperen su turno." },
  { s: "reflexivo", t: "A veces avanzar es soltar algo que ya no te sirve.", a: "No todo lo pendiente merece seguir en la lista.", b: "Mira si hay algo que puedas cerrar o dejar ir hoy." },
  { s: "reflexivo", t: "Mirar atrás un momento ayuda a caminar con más sentido.", a: "Recordar lo que has hecho te da perspectiva sobre lo que viene.", b: "Piensa en algo de la semana pasada que te alegre haber hecho." },
  { s: "reflexivo", t: "Lo importante rara vez es lo más ruidoso.", a: "Las cosas que más valen suelen pedir poco ruido y mucha constancia.", b: "Busca lo discreto que has estado dejando para después." },
  { s: "reflexivo", t: "¿Qué te gustaría haber hecho al final de esta semana?", a: "Pensar en el final ayuda a ordenar el principio.", b: "Anota una o dos cosas, no más, y empieza por la más amable." },
  { s: "reflexivo", t: "Estar en calma no es estar parado.", a: "Se puede avanzar con tranquilidad; la calma suele mejorar las decisiones.", b: "Prueba a trabajar hoy sin prisa y observa qué cambia." },
  { s: "reflexivo", t: "Cuidar lo básico sostiene todo lo demás.", a: "Dormir, comer, moverte y descansar son la base de lo que puedes hacer.", b: "Antes de exigirte más, revisa cómo estás de lo básico." },
  { s: "reflexivo", t: "Nada de lo que hoy dejes a medias te define.", a: "Un pendiente es solo un pendiente; no habla de ti como persona.", b: "Reorganiza lo que no llegaste a hacer, sin reproches." },
  { s: "reflexivo", t: "Un buen plan deja espacio para lo inesperado.", a: "Agendar sin margen suele convertir cualquier imprevisto en agobio.", b: "Deja hoy un hueco libre en tu agenda." },
  { s: "reflexivo", t: "Pregúntate menos cuánto falta y más cuánto has recorrido.", a: "Ver el camino hecho da fuerza para el que queda.", b: "Haz una lista corta de lo que ya conseguiste este mes." },
  { s: "reflexivo", t: "Aprender es acumular preguntas mejores.", a: "Cada duda bien formulada te acerca a lo que de verdad quieres entender.", b: "Anota hoy una pregunta que te gustaría resolver." },
  { s: "reflexivo", t: "Lo que cuidas con regularidad crece sin hacer ruido.", a: "Las rutinas pequeñas dan resultados que no se notan de un día para otro.", b: "Elige una rutina que quieras mantener y simplifícala." },
];
