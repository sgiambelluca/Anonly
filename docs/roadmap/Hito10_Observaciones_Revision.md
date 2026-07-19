<!-- CONTEXT: scope=roadmap-hito10-observaciones | dependencias=roadmap/MVP.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos | fase=10 -->

# Hito 10 — Observaciones de revisión (no bloqueantes) y ambigüedades

> Documento vivo, actualizado PR por PR durante la implementación del Hito 10. Recoge todo lo que el revisor o el implementador señalaron como **no bloqueante** (no impidió aprobar el PR) pero que amerita que el humano lo revise en algún momento: decisiones de scope, limitaciones estructurales conocidas, tensiones entre secciones del spec, y ambigüedades resueltas sin improvisar. No es un changelog de lo que se hizo — para eso están los mensajes de commit — es un registro de **lo que falta decidir o revisar**.
>
> Convención: cada entrada cita el PR donde se originó, el archivo/sección relevante, y si tiene una tarea de seguimiento asociada (tasklist de la sesión) o no.

---

## PR1 — Scaffold `apps/react-client`

- **Stores creados en PR1, no en PR5 (tabla ADR-038 §8)**: los 6 stores de Zustand (`document`, `entities`, `rules`, `pipeline`, `viewer`, `settings`) se implementaron como placeholders locales en el scaffold, aunque la tabla canónica de PRs los asigna al PR5 (`core-adapter`). Confirmado como intencional por el revisor (son placeholders puros, sin conexión al bus) y por el humano al aprobar. Solo una nota de trazabilidad, sin acción pendiente.
- **Ícono del Hero**: 40px (`h-10 w-10`) vs. 32px que documenta `Components.md` §11. Cosmético, sin corregir.
- **`console.warn` en `settings.store.ts`**: usado para fallos de `localStorage`. Válido hoy (permitido en `apps/`); candidato a moverse a un logger de UI si se crea uno más adelante.

## Auditoría pre-Hito-10 (ADR-036) + reapertura (ADR-037/038)

- **Q1 (ADR-038)**: al desactivar NER, un grupo cuyos únicos members eran NER se **elimina** aunque el usuario lo haya editado (no se conserva "huérfano deshabilitado"). Confirmado por decisión de diseño, no revisitado.
- **Q2 (ADR-038)**: los índices de placeholder (`[PERSON 03]` → `[PERSON 05]`) pueden correrse tras un `reanalyze`, visible para el usuario. Aceptado como costo del determinismo de ADR-028.
- **Q3 (ADR-038)**: `performancePreset` cambiado con documento abierto no aplica en caliente — se persiste y aplica recién al próximo documento. Aceptado.

## PR2 — Grouping re-análisis (`reopenSession`/`dropOccurrences`)

- **Limitación estructural real, sin tarea de seguimiento todavía**: `dropOccurrences` solo cubre el caso "grupo eliminado" para descartar conflictos stale (`03_Data_Model.md` §13.25). El caso "el grupo sobrevive pero un `candidate` puntual referenciaba una ocurrencia eliminada" **no se puede detectar** con el contrato actual de `ConflictCandidate` (`shared/src/types.ts`), que no tiene `occurrenceId` ni `bbox`. Ampliarlo requeriría ADR + cambio de `Contracts.md` (R-2/R-19). No corrompe datos (deja un conflicto "stale" en el snapshot), pero el spec (§13.25 / ADR-038 §2) describe el caso completo sin la salvedad de esta limitación — **conviene que un futuro PR de docs acote la redacción del spec a lo que es estructuralmente posible, o abra el ADR de ampliación si de verdad hace falta**.
- `ENTITY_GROUP_UPDATED.changes` incluye siempre `["members","aliases"]` en un `dropOccurrences`, aunque `aliases` a veces no cambie de contenido. Sobre-emisión conservadora, inofensiva (evento idempotente). Sin acción.
- Dedup por identidad es O(n²) en `recordedOccurrences` — mismo patrón que `findOverlapConflict` ya existente. Anotado por si el perfilado futuro lo señala; no es una regresión de este PR.

## PR3 — `Orchestrator.reanalyze`

- **Gap real, sin tarea de seguimiento formal todavía (mitigado a nivel UI en PR6)**: un patch combinado `{ner, ocr}` en una sola llamada a `reanalyze` no logra la equivalencia con una corrida fresca en dos sub-casos (ocurrencias NER huérfanas al combinar OCR+NER-off; NER incompleto —solo páginas re-OCR— al combinar OCR+NER-on). No hay bug de crash ni de tipos, pero el resultado puede quedar inconsistente. `ADR-038 §5.4` no detalla estos sub-casos. **Mitigado en PR6**: `SettingsDialog` nunca envía un patch combinado — emite dos llamadas secuenciales (OCR primero). La mitigación evita el síntoma pero el gap de `Orchestrator.reanalyze` en sí sigue sin resolver a nivel de Core; si algún consumidor futuro (o un test de integración) llama `reanalyze` con ambos campos a la vez, el problema reaparece.
- Guard defensivo `patch == null` en `validateReanalyzePatch`: inalcanzable vía la firma tipada, inofensivo. Sin acción.

## PR4 — `render-engine` zoom (`RenderRequested.scale`)

- **Bug real, con tarea de seguimiento abierta (bloqueando PR9/Export)**: `pendingRenders` (mecanismo de supersede de renders obsoletos) nunca se limpia al completar un render con éxito — solo en `dispose`/`unloadDocument`/`loadDocument` (reload). Combinado con que la clave de supersede no incluye `mode` (decisión literal de ADR-037 §4), una entrada de un preview a `previewScale` que ya terminó puede cancelar espuriamente un export posterior en `mode:"full"` de la misma página. Intenté un fix rápido ("limpiar la entrada al completar") pero reintroduce una carrera distinta con el propio mecanismo de supersede-en-cola (rompe el test `superseded render in queue is discarded`). El fix correcto necesita distinguir invocaciones vía `handleRenderRequested` (deben participar del supersede) de invocaciones directas del Orchestrator —export/OCR— (deben ser inmunes). Documentado en el header de `render.engine.ts`. **Debe resolverse antes de que el PR9 (Export) pueda considerarse completo** — el bug es 100% reproducible en el flujo normal "usuario previsualiza con zoom, después exporta".
- Cosmético: `pending.controller.signal.aborted` en `throwIfSuperseded` siempre evalúa `false` en la práctica (código muerto, el `.abort()` solo afecta a la entrada reemplazada, no a la vigente). Sin acción, señalado por el revisor como cleanup opcional.
- Ventana angosta: un delta-render (`GROUP_TOGGLED`/`GROUP_REPLACEMENT_CHANGED`) que corre mientras hay un zoom en vuelo a otra escala puede ser superseded incorrectamente, perdiendo visualmente el cambio de grupo hasta el próximo evento. Misma raíz que el bug de arriba; se resuelve junto con el fix de supersede.
- **Resolución (2026-07-19, las tres observaciones)**: el supersede quedó acotado al flujo por eventos — `handleRenderRequested` despacha por la vía interna `renderPagesInternal`/`renderPageInternal` con `participatesInSupersede = true`; las invocaciones directas de `renderPage`/`renderPages` (export, tests) y el delta render pasan `false` y nunca consultan `pendingRenders`. Las entradas no se limpian al completar (deliberado: limpiar reintroduce la carrera del render en cola superado; una entrada residual es inofensiva e invisible para la vía directa) y el `AbortController` muerto se eliminó (detección por comparación de escala pura). Sin cambio de contrato público ni de la clave de ADR-037 §4. Tests de regresión: `direct full render (export) ignores supersede entry...` y `delta render ignores supersede entry...` en `edge.test.ts`; los dos tests de supersede del PR4 pasan sin modificación. Spec: `Render_Engine.md` v1.3.1 (§8, §13 caso 21, §14). Desbloquea el cierre del PR9 (Export).

## PR5 — `core-adapter`

- **Gap conocido, heredado por PR6/PR7**: `initCore(config?)` no deriva un `EngineConfig` desde `settings.store` — hace passthrough directo a `createCore`. Motivo: `Partial<EngineConfig>` es shallow (si se provee `workerPool`, TypeScript exige un `WorkerPoolConfig` completo con 11 campos, varios sin defaults consolidados en un único doc que el cliente pueda reproducir sin inventar valores). Consecuencia práctica: hoy, `nerEnabled`/`ocrLanguages`/`performancePreset` persistidos en `settings.store` **no tienen ningún efecto real** sobre el Core hasta que algún PR futuro cablee `buildEngineConfig(settings)` en el boot de `App.tsx` (probablemente cuando se agregue `settings.load()` al arranque). No es un bug vivo hoy porque `settings.load()` tampoco está cableado (todo corre con los defaults de `EngineConfig`, que coinciden con los defaults de `settings.store`).

## PR6 — Toolbar y diálogos de flujo

- **Bug menor, sin tarea de seguimiento**: en `SettingsDialog.handleConfirmReanalyze`, el store de settings se actualiza (`applyToStore`) **antes** de que las llamadas secuenciales a `reanalyze` resuelvan. Si la primera (`ocr`) rechaza, el store ya quedó persistido con ambos cambios pero el patch de `ner` nunca se envió — un segundo click en "Reanalizar" no-opea silenciosamente porque el diff ya da vacío. Se corrige aplicando el store recién tras el éxito de ambas llamadas, o reseteando el diff en el `catch`.
- Botón "Reintentar" genérico no implementado — correctamente, no existe API (`IPipelineOrchestrator`) que lo respalde sin inventar algo no documentado.
- `OCR_PAGE_FAILED` no wireado a ningún componente — hereda el gap del bus-bridge de PR5 (el evento no muta ningún store).
- El banner "Desactivar NER y reanalizar" (recuperación de `NER_MODEL_MISSING`) llama `reanalyze` pero no actualiza el toggle de `settings.store.nerEnabled` — quedaría desincronizado visualmente, sin efecto real hoy dado el gap de PR5 de arriba.
- Tensión entre `Components.md` §2.1 (que agrega el matiz "+ si hay jobs remanentes" a cuándo mostrar `CancelButton` en stage `Ready`) y §2.4 (regla propia, sin ese matiz): no hay campo en `pipeline.store` que represente "jobs remanentes", así que se implementó solo la regla de §2.4. Vale la pena reconciliar ambas secciones en un futuro PR de docs.

## PR7 — Visor

- **Rechazado por el revisor y corregido en la misma sesión (re-revisión: APPROVED)**: los dos `PdfViewer` (original/anonimizado) no sincronizaban el scroll real (solo compartían `visibleRange`, lo que desmontaba páginas del visor no scrolleado). Se agregó `scrollSync.ts` (`computeScrollSyncTarget`) cableado en `PageVirtualizer` vía la nueva prop `scrollToPageIndex`. El revisor trazó la cadena completa (incluido el corte del loop de realimentación) y confirmó que converge sin re-render infinito.
- Sincronización por **página**, no por píxel: en scrolls parciales los dos paneles pueden diferir visualmente hasta ~1 página. Consistente con el diseño (sincroniza vía `currentPageIndex`, no offset exacto) — no es un defecto, solo una característica a tener presente.
- Edge teórico con `pageSize` fraccional (zoom no entero): redondeo de `scrollTop` podría dejar un desfase estable de 1 página entre los dos visores. Acotado (no hay loop infinito), caso límite de QA, no bloqueante.
- `viewer.store.sideBySide` (`React_Client.md` §3.5, default `true`) no tiene setter ni ningún componente lo lee — el fallback mobile/desktop de `SideBySideViewer` es una media query CSS pura, no condicionada por ese campo. Campo inalcanzable con el contrato actual; nadie especifica qué UI debería togglearlo. Señalado para que el planificador confirme si un futuro PR debe cablearlo o si el campo debería eliminarse del store.
- `Components.md` §5.3 / `07_Performance_Strategy.md` §3 piden un "pool de canvas reutilizables"; la implementación monta/desmonta `PageCanvas` por reconciliación de React (`key={pageIndex}`) en vez de un pool explícito de `<canvas>`. El objetivo funcional (solo ±1 página montada) se cumple; es una diferencia de la letra del spec, no del comportamiento observable, con ≤ ~6 canvases vivos en la práctica. Candidato a ajustar la redacción del spec en vez de el código.
- Doble emisión de `RENDER_REQUESTED` (uno por cada `PdfViewer`, mismo `pageIndices`/`scale`) cuando ambos reaccionan al mismo `zoom`/`visibleRange` global: inofensivo hoy (cache LRU + supersede lo absorben), pero **al resolver el bug de supersede del PR4 (arriba)**, conviene revisar si el `visibleRange` compartido entre dos `IntersectionObserver` sigue teniendo sentido o si debería pasar a ser por-`kind`.

## PR8 — Panel de Entidades + conflictos

- **`ConflictDialog` sin atajos "Usar Regex"/"Usar NER"**: `UX_Guidelines.md` §6 los menciona, pero `ConflictResolveRequested` (`Contracts.md`, `04_Event_System.md` §10) solo transporta `{documentId, conflictId, mode: ReplacementMode}` — no hay forma de expresar "qué fuente ganó" sin ampliar el contrato. Se implementó solo el flujo "Personalizado" (elegir un `ReplacementMode` real), confirmado como la única opción contract-consistente. Si se quieren los atajos literales, hace falta ADR + cambio de `Contracts.md`.
- **"Ver ocurrencias" (members con pageIndex+bbox+value) no implementado**: `OccurrenceRef` (`03_Data_Model.md` §8) no tiene campo `value`. Confirmado, no es un descuido.
- **Indicador "editado manualmente" (punto azul, `UX_Guidelines.md` §3.3) no implementado**: requeriría que la UI reimplemente la resolución de reglas de Grouping (fuera de su rol) para saber si el modo actual difiere del default. `EntityGroup` no expone ese dato.
- **`GroupContextMenu` implementado a mano, sin `@radix-ui/react-dropdown-menu`**: `Components.md` §13.7 pide que los componentes interactivos pasen por wrappers de Radix, pero agregar esa dependencia nueva requeriría ADR (P-9/R-12, prohibición absoluta sin ADR). Se priorizó no agregar la dependencia. Consecuencia: el menú a mano no tiene navegación por flechas ni gestión de foco como daría el primitivo de Radix. **Necesita una decisión del planificador**: ¿ADR para agregar `@radix-ui/react-dropdown-menu`, o aceptar formalmente el hand-roll?
- Estado vacío binario en `App.tsx` (`hasAnyGroup`): un documento cargado sin entidades detectadas sigue mostrando el estado "sin documento" en vez del mensaje específico de `UX_Guidelines.md` §11 fila 2 ("No se detectaron entidades..."). El dato para distinguir ambos casos existe (`pipeline.store.stage`), simplemente no se usó en este PR. Refinable en un PR posterior.
- Toasts de feedback (Merge/Split) y popover de aliases/edición inline de `canonicalValue` (`Components.md` §3.3/§3.6/§3.7): diferidos por no existir un componente `Toast` todavía en ningún PR previo. Correctamente fuera de alcance.

---

## Tareas de seguimiento con entrada formal en el tasklist de la sesión

- ~~Diseñar el fix del supersede de render (leak de `pendingRenders` + clave sin `mode`) — bloquea que el PR9 (Export) se dé por completo.~~ **Resuelto 2026-07-19** — ver "Resolución" en la entrada "PR4" arriba.
