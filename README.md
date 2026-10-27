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
- **Suscripciones (Finanzas):** alta con importe, frecuencia (semanal, mensual, trimestral, anual) y próximo cobro; estados activa / pausada / cancelada, editar y borrar. Muestra gasto mensual y anual equivalente, próximo cobro y lo que ahorras por las canceladas. Tabla `subscriptions` (`migracion-v6.sql`). No se incluye aún en la copia de seguridad.
- **Tablero de tareas:** cuatro columnas (Pendiente, En progreso, En revisión, Completado) con contador; arrastra una tarjeta a la columna que quieras (en táctil, con pulsación larga), o usa «⋯ → Mover a…» (o la tecla M). «+ Nueva tarea» en cada columna crea la tarea con ese estado. Completado está plegado por defecto y la preferencia se recuerda. Mover a Completado marca la tarea como hecha; sacarla la devuelve a una columna abierta. Sin reordenar dentro de la columna (no hay campo de orden).
- **Ahorro de tráfico de Supabase:** la app relee solo la tabla que cambió (no toda la base de datos). Plan a largo plazo en `PLAN-SUPABASE.md` y consultas de tamaño en `mantenimiento.sql`.
- **Resumen personalizable:** bloques reordenables y ocultables (guardado por navegador) y cronómetro/temporizador integrado.
- **Emoji por hábito** y mapa de constancia calculado sobre los hábitos que existían cada día.
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
1. **Supabase > SQL Editor**, en este orden (una vez): `schema.sql` → `migracion-v2.sql` → `migracion-v3.sql` → `migracion-v4.sql` → `migracion-v5.sql` → `migracion-v6.sql` → `migracion-v7.sql` → `migracion-v8.sql` → `migracion-v9.sql` → `single-user.sql` (edita tu correo dentro; este último es el que bloquea los datos a tu cuenta). Si ya los tenías, ejecuta solo `migracion-v4.sql` (nuevo cronómetro, categorías/frecuencia/color de hábitos y tabla `ideas`) `migracion-v5.sql` (Intelligence) `migracion-v6.sql` (suscripciones) y `migracion-v7.sql` (estado «En revisión») y vuelve a ejecutar `single-user.sql`.
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
`index.html` (páginas y diálogos) · `styles.css`, `pages.css` (estilos por página), `login.css` · `logic.js` (lógica pura, probada en Node) · `quotes.js` (citas) · `phrases.js` (frase del día: reflexiones originales sin firma) · `intel.js` (motor de reglas de Intelligence, probado en Node) · `intelligence.js` (interfaz) · `core.js` (estado, utilidades) · `data.js` (Supabase) · `auth.js` · `app.js` (rutas) · `userprefs.js` (preferencias por usuario) · `texts.js` (textos editables) · `widgets.js` (bloques nuevos del Resumen) · `dashboard.js`, `habits.js`, `tasks.js`, `journal.js`, `finance.js`, `timer.js`, `prefs.js` · `sw.js`, `manifest.webmanifest`, `icons/`.

## Pruebas
```bash
node --test tests/logic.test.js tests/intel.test.js
```
Cubre fechas locales, dinero en céntimos, rachas, vistas de tareas, CSV, importación y validación de login.

## Hábitos por días, frase del día y movimiento

- **Frecuencia de hábitos**: se guarda en la columna `habits.frequency` que ya existía (`Diario`, `Entre semana`, `Fines de semana`, `Semanal` o `Personalizada:0,2,4`, con 0 = lunes … 6 = domingo). Los hábitos antiguos siguen funcionando sin migración. Todo (lista de hoy, contadores, rachas, semana, mapa de constancia, estadísticas, Intelligence) pasa por `Logic.habitDueOn`. Un día no programado se muestra como «no programado», nunca como fallo, y cambiar la frecuencia no toca el historial. La app no tiene recordatorios de hábitos.
- **Frase del día**: `phrases.js` (reflexiones originales, sin firma) + `Logic.phraseOfDay` (determinista por fecha local, sin repeticiones en 7 días). Ajustes en Resumen → Personalizar (se guardan en este navegador).
- **Transiciones**: `swapPage`, `moveNavIndicator` y `armReveal` en `app.js`; estilos al final de `styles.css`. Respetan `prefers-reduced-motion`.

## Movimientos con concepto y nota (migración v8)

Todos los movimientos (gastos e ingresos) piden un **concepto** obligatorio (no vacío, máx. 120 caracteres) y admiten una **nota** opcional (máx. 300). La nota requiere `migracion-v8.sql` (añade la columna `transactions.note`; no toca datos existentes). Los movimientos antiguos conservan su título como concepto. El campo «Tarea (opcional)» del cronómetro se eliminó; la etiqueta libre de la sesión sigue disponible.

## Resumen libre, textos editables y preferencias por usuario (migración v9)
- **Resumen:** pulsa «Personalizar». Cada bloque se **arrastra por el asa ⠿** (ratón o dedo; con teclado, flechas ↑ ↓ sobre el asa), se **redimensiona** desde el borde derecho, el inferior o la esquina (rejilla de 6 columnas; alto automático o por filas; en móvil una columna y solo el alto), se oculta/muestra y tiene ajustes ⚙ (título, ancho, alto, información compacta, objetivo mostrado, periodo). El **catálogo** lista 18 bloques; los 9 nuevos (Próxima acción, Presupuesto por categorías, Objetivo activo e hitos, Tiempo de concentración, Notas rápidas y calendario, Próximos pagos, Objetivo de ahorro, Estadísticas personales y Sugerencia contextual) solo muestran datos que ya registraste y tienen estados de carga, vacío y error.
- **Guardado por usuario:** diseño y textos van a la tabla `user_prefs` (`migracion-v9.sql`) con caché local por id de usuario; dos cuentas en el mismo navegador no se mezclan. Si no ejecutaste v9, funciona con la caché local y avisa. El **invitado** lo tiene solo en memoria y nunca escribe en la caché ni en la base de ninguna cuenta; no ve la Sugerencia contextual ni la nube de Intelligence.
- **Textos editables:** Preferencias > «Editar textos». Solo textos fijos con id estable (menús, títulos, botones; ver `texts.js`); nunca valores dinámicos. «Restaurar» devuelve el original exacto.
- **Nube de Intelligence:** un único botón la abre y la cierra y conserva su estado.
- **Límites conocidos:** no existe un modelo de objetivos con hitos propios (los hitos son cada 25 % de una meta de ahorro) ni una tabla de eventos de calendario (el bloque usa vencimientos de tareas).
