# Plan a largo plazo: mantener CloudSpace dentro del plan gratuito de Supabase

## 1. Dónde estás hoy (captura del panel de uso)

| Recurso | Uso | Límite gratis | Lectura |
|---|---|---|---|
| Egress (tráfico saliente) | 0,01 GB | 5 GB / mes | **El que más puede crecer** (ver §2) |
| Tamaño de la base de datos | 28 MB | 500 MB | Casi todo es la base del sistema de Supabase; tus datos ocupan muy poco |
| Usuarios activos al mes | 1 | 50.000 | Sin riesgo (es una app personal) |
| Almacenamiento de archivos | 0 | 1 GB | No se usa; sigue sin guardar imágenes ni archivos en Supabase |
| Logs | 0,02 GB | 1 GB | Sin riesgo |

Los límites exactos y las condiciones del plan gratuito cambian: compruébalos en la página de precios de Supabase de vez en cuando.

## 2. El riesgo real: el tráfico, no el espacio

El espacio no es problema: una tarea ocupa unos 0,5 KB, un registro de hábito ~0,1 KB y una entrada de diario ~2 KB. Años de uso personal caben en pocas decenas de MB.

El tráfico sí crece, porque la app descarga los datos **completos** cada vez que carga. Estimación orientativa (no medida) tras 2 años de uso intenso: ~10.000 tareas, ~3.000 gastos, ~700 notas de diario, ~5.000 registros de hábitos → unos 8 MB por carga completa. Con la app antigua, cada acción disparaba 2 cargas completas: 100 acciones al día ≈ 1,6 GB al día, es decir, por encima del límite mensual en pocos días.

## 3. Fase 1 — ya hecha en este código

- **Lectura por tabla:** cada tabla tiene su propio cargador. Al cambiar algo solo se vuelve a leer la tabla escrita (y las que dependen de ella, p. ej. borrar un proyecto relee sus tareas).
- **Tiempo real por tabla:** cada aviso trae el nombre de la tabla que cambió y solo se relee esa.
- **Sin eco duplicado:** antes tu propio cambio provocaba una carga completa y luego otra por el aviso en tiempo real.
- **Al volver a la app:** solo se descarga todo si pasó más de un minuto desde la última carga completa.
- **Sesiones del cronómetro:** solo se descargan las recientes (ya era así).

Resultado medido en modo invitado: completar una tarea → lee 3 tablas (antes ~18); crear/editar una suscripción → 1.

## 4. Fase 2 — siguiente paso recomendado (necesita migración, te la preparo y la apruebas tú)

1. **Sincronización por cambios (delta sync):** añadir `updated_at` con un disparador en cada tabla y guardar en el navegador (IndexedDB) una copia local. Al abrir la app solo se piden las filas con `updated_at` posterior a la última sincronización. La carga completa pasa de MB a unos pocos KB. Para detectar borrados se usa una columna `deleted_at` (borrado lógico) o una tabla de borrados.
2. **Historial bajo demanda:** cargar por defecto solo lo reciente y pedir el resto al abrir esa vista:
   - Tareas completadas: últimos 90 días.
   - Diario: últimos 90 días (buscar en el resto con consulta al servidor).
   - Gastos: últimos 24 meses; los totales mensuales antiguos se guardan resumidos.
   - Hábitos: últimos 400 días de registros, más una fila de resumen con la mejor racha histórica para no perderla.
3. **Columnas concretas en lugar de `*`:** no pedir campos largos (notas, cuerpo del diario) en las listas; pedirlos solo al abrir el elemento.

## 5. Fase 3 — mantenimiento (cuando haga falta)

- **Archivar:** exportar a JSON el año antiguo (la app ya tiene copia de seguridad) y borrar de Supabase lo que ya no consultes. `mantenimiento.sql` incluye la consulta para ver qué tablas pesan más y un borrado opcional comentado.
- **Copia de seguridad:** el plan gratuito no es una garantía de copias. Haz una exportación desde la app cada mes. Limitación actual: la copia de seguridad todavía no incluye las suscripciones (pendiente).
- **Pausa por inactividad:** los proyectos gratuitos de Supabase se pausan si pasan unos 7 días sin actividad (compruébalo en su documentación vigente). Usándola a diario no ocurre; si te vas de vacaciones, un reactivar manual desde el panel basta, o se puede programar una petición periódica sencilla.
- **Revisar el panel de uso** una vez al mes (Egress y Database size) durante los primeros meses; si Egress supera el ~50 %, pasa a la Fase 2.

## 6. Qué NO hacer

- No guardar fotos, audios ni archivos en la base de datos.
- No subir el intervalo de sondeo ni añadir recargas automáticas periódicas.
- No activar Intelligence/IA con envío automático de datos: ya es manual y así debe seguir.
- Pasar a un plan de pago no hace falta mientras se mantenga el uso actual: solo si ves el Egress o el tamaño de la base de datos acercarse a los límites.
