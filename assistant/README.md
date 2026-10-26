# Motor algorítmico del asistente de CloudSpace

Motor **autónomo, modular, explicable y adaptativo** que decide *cuándo* una sugerencia merece aparecer y, bajo petición, explica *por qué* con una explicación profunda por plantillas.

- **Solo lógica.** Sin HTML/CSS, sin paneles, sin animaciones, sin DOM. No modifica ningún otro módulo de CloudSpace: todo vive en `assistant/` y en `tests/assistant.test.js`.
- **Sin IA.** Reglas JavaScript, estadística simple (medias, medianas, ventanas comparables) y análisis de patrones. No llama a ningún modelo, API ni servicio de pago.
- **Nunca interrumpe.** El motor devuelve datos; no abre nada. La interfaz futura decide cómo pintarlos y pide el detalle por `id`.
- **Nunca modifica datos.** Las acciones son *propuestas validadas*; ejecutar exige confirmación explícita y un ejecutor que aporta la app.

## Archivos y responsabilidades

| Archivo | Responsabilidad |
|---|---|
| `assistantData.js` | Normaliza las filas reales de la app a una *instantánea* validada (descarta lo inválido y lo cuenta). Adaptadores de persistencia: memoria, almacenamiento clave-valor y Supabase. |
| `assistantPatterns.js` | Estadística pura: ventanas de cumplimiento de hábitos, perfil por día de la semana, ventanas de sesiones, gasto por tramo de mes, factor de muestra. |
| `assistantRules.js` | 17 reglas declarativas (`minData`, `detect`, `describe`). Una regla que falla no impide las demás. |
| `assistantScoring.js` | Prioridad (0–100) y confianza (0–1), **medidas distintas**; reglas de discreción: umbrales, cooldowns, cuotas, capacidad, ruptura de silencio. |
| `assistantProposals.js` | Esquema versionado de la sugerencia breve y construcción de la explicación profunda. |
| `assistantActions.js` | Catálogo cerrado de acciones seguras, validación estricta de parámetros, preparar ≠ ejecutar. |
| `assistantFeedback.js` | Siete tipos de feedback con efectos distintos, acotados y reversibles. |
| `assistantMemory.js` | Memoria observada / inferida / confirmada, con alcance, pausa, edición, borrado con «lápida» y pausa del aprendizaje. |
| `assistantAIContext.js` | Capa para una IA **futura** (sin llamarla): contexto minimizado y validación de su salida. |
| `assistantEngine.js` | Orquestador y API pública. |
| `examples/demo.js` | Demo ejecutable con datos ficticios: `node assistant/examples/demo.js`. |

Orden de carga en el navegador (cuando se integre; scripts clásicos, globales `Assistant*`): `logic.js`, `assistantPatterns.js`, `assistantData.js`, `assistantActions.js`, `assistantRules.js`, `assistantScoring.js`, `assistantMemory.js`, `assistantFeedback.js`, `assistantProposals.js`, `assistantAIContext.js`, `assistantEngine.js`. En Node basta `require("./assistant/assistantEngine.js")`.

## Arquitectura

```
datos de la app → normalize() → instantánea validada
   → reglas (detect) → candidatos con SUS números
   → puntuación: prioridad (urgencia/impacto/novedad/relevancia) y confianza (hecho/patrón/estimación)
   → agrupación (≥3 iguales de una regla → una sola)
   → discreción: tipo de momento, confianza mínima, prioridad mínima, cooldown, cuota diaria, capacidad por módulo y total
   → sugerencias breves: visibles u «detectadas» (ocultas)
pedido por id → se re-detecta con datos actuales → ¿sigue valiendo? → explicación profunda (plantillas) o «ya no aplica»
```

Estados de una sugerencia: `detected` (oculta), `visible`, `snoozed`, `hidden`, `dismissed`, `accepted`, `ignored`, `resolved`. «Detectar sin mostrar» es explícito: `listAll()` incluye el motivo (`gateReason`: `not_timely`, `low_confidence`, `below_threshold`, `daily_limit`, `capacity_module`, `capacity_total`, `cooldown`).

## API pública (`AssistantEngine`)

```js
const e = AssistantEngine.create({
  userId,            // obligatorio salvo guest:true
  guest: false,      // invitado: SIN persistencia ni memoria entre sesiones
  adapter,           // AssistantData.createMemoryAdapter() | createStorageAdapter(localStorage) | createSupabaseAdapter(client)
  now: () => new Date(),  // reloj inyectable (tests)
  config: { thresholds: {}, rules: {} },
});
await e.init();                              // carga el estado del usuario

const r = e.evaluate(raw);                   // { suggestions[] (visibles), hiddenDetected, skipped[], errors[], changed, fingerprint }
e.getVisible(); e.getSuggestion(id); e.listAll();

e.getExplanation(id, raw);                   // explicación profunda; revalida y retira si ya no aplica
e.prepareActions(id, raw);                   // acciones preparadas (executed:false)
await e.executeAction(prepared, { token: prepared.token, confirmed: true }, async (type, params) => { /* la app hace el cambio */ });

e.feedback(id, "accept"|"reject"|"modify"|"not_relevant"|"postpone"|"hide"|"no_response", { days, note });

e.memory.centerView();                       // para «Mi memoria»: confirmed / observed / inferred / temporal
e.memory.set(key, value, reason, scope); e.memory.update(id, patch); e.memory.pause(id); e.memory.remove(id); e.memory.setLearningPaused(true);
e.pendingConfirmations(); e.confirmMemory(id); e.rejectMemory(id);

e.settings.pauseAll(); e.settings.pauseModule("finance"); e.settings.disableRule("task.overdue");
e.settings.setThresholds({ minPriority: 40 }); e.settings.setRuleConfig("habits", { eveningHour: 20 }); e.ruleCatalog();

e.aiContext(raw, { includeTitles: false });   // contexto para una IA futura
e.validateModelOutput(output, raw);             // valida su respuesta (solo propuestas del catálogo)
await e.flush(); e.exportState(); await e.reset();
```

`raw` = las colecciones que ya tiene la app (en `state`):

```js
const raw = {
  tasks: state.tasks, habits: state.habits, habit_logs: state.logs,
  timer_sessions: state.sessions, transactions: state.transactions, budgets: state.budgets,
  // goals: solo si existe un módulo de objetivos con hitos (ver «Limitaciones»). NO pases state.goals: son metas de ahorro.
  // taskEvents: [{taskId, type:"due_changed", at, from, to}] cuando la app registre cambios de fecha.
};
```

## Reglas

| Id | Nombre | Qué detecta | Datos mínimos / umbrales |
|---|---|---|---|
| `task.overdue` | Tareas vencidas | Tareas abiertas cuya fecha de vencimiento ya pasó. | Tareas abiertas (con fecha vencida). |
| `task.important_near_deadline` | Importantes con fecha cercana | Tareas de prioridad P1/P2 que vencen en los próximos días. | Tareas P1/P2 con fecha en los próximos 3 días. |
| `task.accumulation` | Acumulación de tareas | Muchas tareas abiertas a la vez. | ≥ 25 tareas abiertas. |
| `task.repeated_postponement` | Aplazamientos repetidos | Tareas cuya fecha se ha retrasado varias veces (requiere historial de cambios de fecha). | `taskEvents` (historial de cambios de fecha). **La app actual no lo registra: la regla está inactiva hasta que se añada.** |
| `task.priority_review` | Revisión de prioridades | Demasiadas tareas urgentes a la vez o tareas antiguas sin fecha. | ≥ 5 tareas abiertas; ≥ 6 en P1, o ≥ 5 con +30 días y sin fecha. |
| `habit.pending_today` | Hábitos pendientes hoy | Hábitos que tocan hoy y aún no están marcados, a partir de cierta hora. | Hábitos creados; hora ≥ 18:00; el hábito toca hoy y no está marcado. |
| `habit.regularity_drop` | Descenso de regularidad | Un hábito cumplido con regularidad que ha bajado de forma sostenida. | Hábito no semanal con ≥ 8 días que tocaban en las últimas 2 semanas y ≥ 10 en las 4 anteriores; caída ≥ 25 puntos desde ≥ 50 %. |
| `habit.weekday_pattern` | Patrón por día de la semana | Un hábito que casi siempre se omite el mismo día de la semana. | ≥ 4 observaciones de ese día en 8 semanas; ≤ 25 % ese día y ≥ 60 % el resto (≥ 12 días). Solo se muestra si ese día es hoy o mañana. |
| `habit.review_plan` | Revisar un hábito | Hábitos con cumplimiento bajo durante un mes completo. | ≥ 30 días de antigüedad y ≥ 20 días que tocaban; cumplimiento < 30 % (no se solapa con la caída de regularidad). |
| `focus.frequency_change` | Cambio en la frecuencia de sesiones | Compara el número de sesiones de las dos últimas quincenas. | ≥ 3 sesiones en la quincena anterior; cambio ≥ 40 %. |
| `focus.duration_change` | Cambio en la duración de sesiones | Compara la duración media de las sesiones de las dos últimas quincenas. | ≥ 3 sesiones en cada quincena; cambio de la duración media ≥ 30 %. |
| `focus.propose_session` | Proponer una sesión | Si sueles hacer sesiones y hay una tarea pendiente relevante, propone preparar una. | ≥ 3 sesiones en 14 días, ninguna hoy, entre 8:00 y 21:00, y una tarea P1/P2 o con fecha ≤ 2 días. La duración propuesta es la mediana de tus sesiones. |
| `finance.budget_near` | Presupuesto cerca del límite | Categorías (o el total) que alcanzan un porcentaje alto del presupuesto del mes, según los movimientos registrados. | Presupuestos definidos y gastos del mes; ≥ 80 % del límite (por categoría o total). |
| `finance.period_change` | Cambio frente a periodos comparables | Gasto del mes hasta hoy frente al mismo tramo del mes anterior (y de los tres anteriores si hay datos). | Desde el día 7 del mes; gasto del mismo tramo del mes anterior ≥ 20 €; subida ≥ 30 % y ≥ 20 €. Usa hasta 3 meses previos como contraste. |
| `goal.no_progress` | Objetivo sin avances | Objetivos activos sin actividad durante un periodo configurable. | `goals` activos (la app actual no tiene módulo de objetivos); ≥ 21 días sin actividad. |
| `goal.milestone_upcoming` | Hito próximo | Hitos no completados con fecha en los próximos días. | Hitos con fecha en los próximos 7 días. |
| `goal.review_split` | Revisar o dividir un objetivo | Objetivos con hitos vencidos o sin ninguna tarea abierta que los haga avanzar. | Objetivo con hitos pendientes y (hito vencido, o ninguna tarea abierta vinculada). |

Todos los umbrales viven en `AssistantRules.DEFAULTS` y se ajustan con `settings.setRuleConfig`. Una regla sin datos suficientes se **omite** y `evaluate().skipped` dice por qué (p. ej. «No hay presupuestos definidos»).

## Puntuación y discreción

- **Prioridad** (0–100) = `100 × (0,45·urgencia + 0,30·impacto + 0,15·novedad + 0,10·relevancia)`. Novedad = 1 si no has respondido antes a esa sugerencia (0,5 si ya); relevancia = peso aprendido de la regla (0,6–1,2) / 1,2.
- **Confianza** (0–1), independiente: *hecho* (lectura directa) = 0,95; *patrón* = `0,2 + 0,7 × muestra × consistencia`; *estimación* = ese valor con tope 0,6. `muestra = min(1, observaciones / necesarias)`. Una sugerencia puede ser muy prioritaria y poco fiable (y se queda sin mostrar).
- **Umbrales por defecto:** prioridad ≥ 35, confianza ≥ 0,45, máx. 5 visibles, 3 nuevas por día, 2 por módulo, agrupar a partir de 3, «sin respuesta» a los 3 días. La urgencia alta (≥ 0,7) puede superar la cuota diaria y el límite por módulo (hasta +2 en total).
- **Duplicados:** el `id` es un hash estable de la clave de la situación; evaluar de nuevo actualiza el mismo registro.
- **Retirada:** si la situación desaparece (o pasa a mostrarse agrupada) la sugerencia pasa a `resolved`.
- **Respetar el silencio:** tras `reject` (14 d), `not_relevant` (30 d), `no_response` (3 d), `accept/modify` (7 d), `postpone`/`hide` (días elegidos). Los rechazos repetidos de una regla alargan el silencio (×2…×4, nunca permanente). Solo un **cambio importante** rompe el silencio de un rechazo: urgencia que pasa a *alta*, o prioridad +20 (+30 tras 2 descartes). `postpone` y `hide` se respetan siempre.

## Formato de la sugerencia breve (esquema v1)

```json
{
  "id": "sg_6ak598", "schemaVersion": 1, "ruleId": "task.overdue", "module": "tasks",
  "title": "Tienes 2 tareas vencidas", "summary": "La más antigua venció hace 6 días. Puedes moverlas, cerrarlas o dejarlas como están.",
  "priorityScore": 70, "urgency": "normal", "confidence": 0.95, "createdAt": "2026-10-26T18:00:00.000Z", "status": "visible",
  "evidence": { "refs": [{"type":"task","id":"t1"},{"type":"task","id":"t2"}], "metrics": {"count":2,"maxDaysLate":6,"highPriority":1}, "period": {"from":"2026-10-20","to":"2026-10-26"} },
  "reasonCodes": ["TASK_PAST_DUE","HIGH_PRIORITY_INVOLVED"],
  "actions": [
    {"type":"navigate.review","params":{"page":"tasks"},"label":"Revisar"},
    {"type":"task.reschedule","params":{"taskId":"t1","due_date":"2026-10-27"},"label":"Mover a mañana"}
  ],
  "cooldownUntil": null
}
```

Privacidad: la sugerencia breve guarda **ids, recuentos, importes agregados y fechas**; no copia títulos ni notas. Los títulos se resuelven de los datos vivos al pedir la explicación.

## Explicación profunda por id

`getExplanation(id, raw)` re-detecta con los datos actuales. Si la situación ya no se da, devuelve `{ valid:false, reason }` y retira la sugerencia. Si vale, devuelve (ejemplo real de la demo, con datos ficticios):

```json
{
  "valid": true, "id": "sg_6ak598",
  "situation": "Hay 2 tareas abiertas con la fecha de vencimiento ya pasada.",
  "rulesActivated": [{"id":"task.overdue","label":"Tareas vencidas","version":1,"reasonCodes":["TASK_PAST_DUE","HIGH_PRIORITY_INVOLVED"]}],
  "data": [
    "«Entregar práctica de Bases de Datos» · P1 · Urgente · vencía el 20 oct (hace 6 días)",
    "«Pedir cita médica» · P3 · Media · vencía el 25 oct (hace 1 día)"
  ],
  "period": {"from":"2026-10-20","to":"2026-10-26","label":"Desde la fecha de vencimiento más antigua hasta hoy"},
  "influencingPatterns": [], "hypotheses": [],
  "basis": {"type":"fact","label":"Dato confirmado (lectura directa de lo registrado)"},
  "confidence": {"value":0.95,"level":"alta","method":"Dato registrado leído directamente: confianza fija 0,95 (puede faltar información que no esté anotada).","components":[...]},
  "priority": {"score":70,"urgency":"normal","formula":"prioridad = 100 × (0,45·urgencia + 0,30·impacto + 0,15·novedad + 0,10·relevancia)","breakdown":[...]},
  "proposedActions": [ /* preparadas, executed:false, requiresConfirmation según el catálogo */ ],
  "limitations": ["Solo se conocen las tareas registradas en CloudSpace; el trabajo hecho fuera de la app no cuenta.", "Esta sugerencia se basa únicamente en la situación actual; no se ha analizado un historial."]
}
```

Las hipótesis llevan `confirmed:false`; los patrones indican su muestra; los límites avisan de muestra corta, filas descartadas y alcance del módulo. No hay porcentajes, causas ni previsiones que no salgan de los datos.

## Memoria y feedback

- **Feedback:** `accept`, `modify` (con nota), `reject`, `not_relevant`, `postpone`, `hide`, `no_response` (automático). Cada uno fija un estado y un silencio distintos. Un rechazo **no** es una preferencia: solo alarga el silencio de esa sugerencia y baja un poco (acotado a 0,6–1,2) el peso de su regla.
- **Memoria:** `observed` (patrón repetido, no es preferencia) → `inferred` (hipótesis) → `confirmed` (solo si lo confirma o fija el usuario). Tras 3 descartes de una regla en 6 meses se crea un patrón observado; tras 5, una hipótesis «¿desactivar esta regla?» que **no hace nada** hasta que la confirmas (`confirmMemory`).
- **Alcance:** `global`, `module`, `rule`, `temporal` (con `until`; caduca solo), `conditional`.
- **Corregir ≠ rechazar ≠ eliminar:** `update` corrige; `feedback` rechaza una sugerencia; `remove` borra el recuerdo y deja una *lápida* para que no se reconstruya con el mismo comportamiento (solo `set`/`confirm` del usuario lo repone).
- **Pausa del aprendizaje:** `setLearningPaused(true)` detiene observaciones, hipótesis y ajuste de pesos; las preferencias confirmadas siguen aplicándose.

## Persistencia, usuarios e invitado

- El estado (sugerencias, historial de feedback, pesos, memoria, ajustes) es un único objeto serializable por usuario. El adaptador lo guarda y lo lee **clonado** y con clave `userId`: dos usuarios con el mismo adaptador no comparten nada.
- **Invitado** (`guest:true`): no usa el adaptador, no persiste y no recuerda nada entre sesiones.
- Si el guardado falla, el motor sigue funcionando y deja el error en `e.lastPersistError`.
- **Supabase:** solo hace falta una tabla si se quiere sincronizar entre dispositivos. Con el adaptador de almacenamiento (`localStorage`) no hace falta tocar la base. Propuesta (no ejecutada, no probada contra tu Supabase):

```sql
create table if not exists public.assistant_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.assistant_state enable row level security;
create policy "assistant_state propia" on public.assistant_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

(Si usas el modo «solo yo» de `single-user.sql`, añade la tabla a su lista para tener la política por correo.)

## Capa para una IA futura (no se llama a ninguna)

`e.aiContext(raw)` devuelve un objeto versionado con: restricciones, recuentos y tasas por módulo, sugerencias activas, memoria **confirmada**, calidad de datos, catálogo de acciones permitido y contrato de salida. **Por defecto no incluye títulos ni textos** (`includeTitles:true` los añade). `e.validateModelOutput({ proposals:[{type, params, rationale}] }, raw)` pasa la respuesta del modelo por el mismo catálogo y las mismas validaciones: lo desconocido se rechaza, lo válido sale como propuesta `confirmed:false, executed:false, origin:"external-model"`. Conectar un proveedor (Gemini, Groq, Ollama…) consistirá en llamar a su API con ese contexto y devolver la respuesta a `validateModelOutput`; nada más del motor cambia.

## Catálogo de acciones seguras

`task.create`, `task.reschedule`, `task.set_priority`, `habit.set_frequency`, `timer.prepare_session`, `budget.set_limit`, `goal.add_milestone`, `navigate.review` (solo lectura). Cada una declara parámetros tipados con rango; los desconocidos, fuera de rango o que apuntan a elementos inexistentes se rechazan. `prepare()` devuelve un `token`; `execute()` exige `{token, confirmed:true}` y un ejecutor inyectado, y no se puede ejecutar dos veces.

## Integración con CloudSpace (cuando se haga la interfaz)

1. Cargar los scripts en el orden indicado (y añadirlos a `SHELL` en `sw.js`).
2. Crear el motor al iniciar sesión: `AssistantEngine.create({ userId: user.id, adapter: AssistantData.createStorageAdapter(localStorage) })` — o `guest:true` en modo invitado.
3. Llamar a `evaluate(raw)` tras `loadAll()`/cambios relevantes (es síncrono y barato).
4. Pintar `suggestions` donde corresponda (p. ej. en el módulo) y, al pulsar, llamar a `getExplanation(id, raw)`.
5. Conectar los botones a `feedback(...)`, y las acciones aceptadas a `prepareActions` + `executeAction` con un ejecutor que use las funciones existentes de `data.js`.

## Tests

`node --test tests/logic.test.js tests/intel.test.js tests/assistant.test.js` → **114 pasan** (54 del motor). Cubren: vencidas, patrones de hábitos (caída y día de la semana), presupuesto cerca del límite, priorización, supresión de duplicados, control de frecuencia (cuota y capacidad), recuperación de explicaciones, actualización al cambiar los datos, efecto del feedback, datos incompletos, casos sin sugerencias, aislamiento entre usuarios, invitado y acciones preparadas sin ejecutar. Los datos son ficticios y el reloj está inyectado.

## Limitaciones (honestas)

- **No hay módulo de objetivos** en la app: las reglas `goal.*` solo actúan si se les pasa `goals` con hitos; `state.goals` (metas de ahorro) no encaja y no se usa. Con la app actual esas 3 reglas están inactivas.
- **`task.repeated_postponement` está inactiva** porque la app no registra el historial de cambios de fecha (`taskEvents`).
- Los hábitos se guardan por día, sin hora: «patrones temporales» se limitan al día de la semana.
- Las sesiones no dicen a qué tarea se dedicaron, así que no se enlazan automáticamente con tareas.
- Los umbrales son valores razonables, **no calibrados** con tus datos reales; ajústalos con `settings`.
- El adaptador de Supabase solo se ha probado contra un cliente simulado, no contra tu proyecto. Nada de esto se ha probado en el navegador con la interfaz (no existe aún); sí se comprobó que los scripts cargan como scripts clásicos en un contexto sin `require`.
