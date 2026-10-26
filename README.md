# Cloudspace (Mi Panel)

Espacio personal privado, instalable como PWA: **resumen con mapa de constancia de 35 días, hábitos, tareas estilo Todoist, diario, finanzas manuales y cronómetro con rutinas**. HTML + CSS + JavaScript sin framework ni build; datos y login en **Supabase**. Oscuro por defecto con acentos violetas (también hay tema claro).

## Qué hace de verdad
- **Login real** con Supabase Auth: entrar, crear cuenta (opcional), recuperar contraseña, mostrar/ocultar contraseña, "mantener sesión" y Google (si lo activas). La contraseña nunca se guarda en el navegador. Sin sesión no se ve ninguna página privada.
- **Resumen:** saludo con tu nombre y fecha, acciones rápidas (abren los formularios reales), mapa de constancia de 35 días con una fila por hábito, resumen semanal, métricas enlazadas, próximas tareas completables, actividad semanal, finanzas del mes, nota rápida y «Filosofía del día» (lista fija de frases dentro de la app, con historial).
- **Hábitos:** categorías (Salud, Aprendizaje, Bienestar, Productividad, Personal), frecuencia (Diario, Entre semana, Semanal), color; crear/editar/duplicar/eliminar, marcar hoy o días pasados, rachas y progreso semanal con fechas locales, calendario de 35 días y estadísticas por hábito.
- **Tareas:** Bandeja de entrada, Hoy, Próximas, Pendientes, Completadas y etiquetas con contadores; prioridades P1–P4, fecha, proyectos, pasos, repetición, búsqueda, orden y vistas lista, cuadrícula y tablero; menú de acciones por tarea.
- **Diario:** pestañas Diario (nota rápida y entrada larga con autoguardado), Entradas (calendario mensual, búsqueda, detalle, edición y borrado) y Solo ideas (biblioteca con etiquetas, búsqueda, orden y enlace a la entrada de origen; se crean desde el editor o sueltas).
- **Cronómetro:** cronómetro, temporizador, Pomodoro y rutinas; tiempo calculado con la hora de inicio (no con intervalos), estadísticas e historial reales.
- **Finanzas:** ingresos/gastos en céntimos exactos, balance mensual, anillo de presupuesto, gráfico de 6/12 meses, gastos por categoría, presupuestos (total y por categoría), movimientos con filtros de tipo y periodo, metas de ahorro, resumen con conclusiones calculadas solo de tus datos y **exportación CSV**.
- **Intelligence:** observaciones calculadas con reglas en tu navegador (tareas vencidas o próximas, hábitos parados, presupuestos, gasto frente al mes anterior, pagos repetidos, objetivos sin tareas) con su evidencia y su nivel de certeza (dato confirmado, patrón probable o estimación). Informe en Markdown para analizarlo **manualmente** en Claude (copiar, descargar, abrir claude.ai) e importación de la respuesta con revisión previa; resumen semanal; nube flotante. **No usa la API de Anthropic ni ninguna otra, no hay claves y no se envía nada solo.** Se puede activar/desactivar y fijar una fecha de expiración en Preferencias; la fecha la pones tú, la app no comprueba tu suscripción.
- **Preferencias:** tema, **exportar JSON**, importar copias de Cloudspace (con resumen previo y sin duplicar), cerrar sesión.

## Modo invitado y feedback
- En el login hay «Probar como invitado»: abre la app con datos de ejemplo guardados **solo en el navegador del invitado** (no se envía nada a tu Supabase y no puede ver tus datos). Se desactiva con `GUEST_MODE: false` en `config.js`.
- Su botón «Dar feedback» envía el comentario a tu tabla `feedback`. Para que funcione ejecuta `feedback.sql` en Supabase (con tu correo) y súbelo a GitHub. Tú los lees en Preferencias > Feedback recibido (o en Table Editor).
- Límites: no hay filtro antispam más allá de los límites de longitud y una espera de 30 s por navegador; si alguien abusa, puedes borrar filas o quitar la política «enviar feedback».

## Lo que NO hace
- No hay cola de escritura sin conexión: sin red puedes abrir la app pero los cambios no se guardan.
- No hay notificaciones push: las notificaciones son locales y solo funcionan mientras el navegador mantiene la app viva.
- No se conecta a bancos: los movimientos se escriben a mano.

## Puesta en marcha
1. **Supabase > SQL Editor**, en este orden (una vez): `schema.sql` → `migracion-v2.sql` → `migracion-v3.sql` → `migracion-v4.sql` → `migracion-v5.sql` → `single-user.sql` (edita tu correo dentro; este último es el que bloquea los datos a tu cuenta). Si ya los tenías, ejecuta solo `migracion-v4.sql` (nuevo cronómetro, categorías/frecuencia/color de hábitos y tabla `ideas`) y `migracion-v5.sql` (Intelligence) y vuelve a ejecutar `single-user.sql`.
2. **`config.js`:** pega `SUPABASE_URL` y `SUPABASE_ANON_KEY` (Project Settings > API). Opcionales: `ALLOW_SIGNUP` (true para mostrar "Crear cuenta"), `GOOGLE_LOGIN` (true para el botón de Google), `ALLOWED_EMAIL` (solo aviso en pantalla).
3. **Supabase > Authentication > URL Configuration:** pon como *Site URL* y en *Redirect URLs* la dirección de la app (p. ej. `https://lapepees-oss.github.io/mi-panel/`). Sin esto fallan la recuperación de contraseña y Google.
4. **Google (opcional):** Authentication > Providers > Google, con credenciales de Google Cloud; luego `GOOGLE_LOGIN: true`.
5. Sube los cambios con git (sin sobrescribir tu `config.js` con claves) y recarga con `Ctrl+Shift+R`.

```bash
git add .
git commit -m "Cloudspace: login, panel, finanzas y diario"
git push
```

## Estructura
`index.html` (páginas y diálogos) · `styles.css`, `pages.css` (estilos por página), `login.css` · `logic.js` (lógica pura, probada en Node) · `quotes.js` (frases) · `intel.js` (motor de reglas de Intelligence, probado en Node) · `intelligence.js` (interfaz) · `core.js` (estado, utilidades) · `data.js` (Supabase) · `auth.js` · `app.js` (rutas) · `dashboard.js`, `habits.js`, `tasks.js`, `journal.js`, `finance.js`, `timer.js`, `prefs.js` · `sw.js`, `manifest.webmanifest`, `icons/`.

## Pruebas
```bash
node --test tests/logic.test.js tests/intel.test.js
```
Cubre fechas locales, dinero en céntimos, rachas, vistas de tareas, CSV, importación y validación de login.
