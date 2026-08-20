<!-- CONTEXT: scope=adr | dependencias=core/Export_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,architecture/03_Data_Model.md,adr/ADR-009-Export-Strategy.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md | audiencia=humanos+IA | fase=10 -->

# ADR-047 — ExportEngine: el ensamblado pdf-lib cruza al ExportWorker; el worker es un **ensamblador con estado de un documento**, no un kernel puro

- **Estado**: Accepted
- **Fecha**: 2026-07-24
- **Decidido por**: El planificador, en la auditoría pre-PR16 encargada por el humano ("audita también los docs para los PR 16 y 17 así queda todo listo para asignárselo al implementador sin que corte"). Aplica al último motor el patrón host-side ya decidido por el humano en ADR-043 y ratificado en ADR-045/046, y resuelve las cuatro cosas que ese patrón **no** cubre para export: no hay pool, el worker sí retiene estado, el payload publicado está incompleto y el retry puede duplicar páginas.
- **Relacionado con**: ADR-036 (§1: "el ExportWorker es un worker único dedicado, **sin `WorkerPool`**" — **matizado acá**, ver §2; §4 `ExportSavePayload`), ADR-032 (§1 `EncodedPageImage`, §2 invocación directa por el Orchestrator, §3 warning sin grupos), ADR-034 (§3 dónde vive el canvas), ADR-035 (fallback in-process bit-idéntico), ADR-043/045/046 (el patrón: clase host-side dueña de su despacho), ADR-009 (estrategia de export), ADR-041 §5 (fila `export-engine` "Ninguno (verificado)" — cierta para la **clase**, no para el worker; ver §4)

## Contexto

PR16 es el último de la serie 12–16 (ADR-038 §8). La forma general ya está decidida por los tres ADRs previos y por ADR-036 §1: `ExportEngine.export()` se queda en host dirigiendo el loop y emitiendo `EXPORT_*` (ADR-013 §6); solo la frontera pdf-lib cruza al worker. Pero la auditoría contra el código encontró **cuatro forks** que habrían detenido al implementador:

1. **No hay transporte**. ADR-036 §1 declara el ExportWorker "worker único dedicado, sin `WorkerPool`", y `PoolKey` es literalmente `"pdf" | "ocr" | "ner" | "render"` (`worker-pool.ts:52`). Sin pool no hay correlación por `jobId`, ni propagación de `CANCEL`, ni deserialización de `FAILED`, ni manejo de crash, ni fallback in-process — todo eso vive en `WorkerPool` y habría que reescribirlo dentro de `export-engine`. Además, la factory hoy se retiene en el **Orchestrator** (`exportWorkerFactory`, dead code con un comentario que dice que "el host-bridge de `export-engine` la use"), lo que contradice el wiring establecido en ADR-043/045/046: el façade construye e inyecta por constructor.
2. **`ExportPagePayload` está incompleto**. Publicado como `{ documentId, pageIndex, pageImage: ArrayBuffer, metadata }` (`03_Data_Model.md` §18), no alcanza para ensamblar: pdf-lib necesita saber si llamar `embedJpg` o `embedPng` (`EncodedPageImage.format`) y el tamaño de la página en **puntos PDF** (`document.pages[i].width/height`, que hoy el motor lee host-side, `export.engine.ts:283-320`). Con el payload actual el worker no puede hacer su trabajo.
3. **El worker retiene estado por documento — y eso está bien**. A diferencia de Render/Ocr/Ner, el ExportWorker acumula un `PDFDocument` a lo largo de N mensajes `export-page` y lo serializa en el `ExportSavePayload` final. No es un kernel sin estado y no puede serlo: pdf-lib ensambla incrementalmente y no es thread-safe sobre el mismo documento (`Export_Engine.md` §12). Falta especificar qué pasa con el parcial ante un `documentId` nuevo, una cancelación o un fallo a mitad de camino.
4. **El retry puede duplicar páginas**. `exportPage` reintenta una vez y hoy se protege con `pageCountBeforeAttempt` (`export.engine.ts:298`) porque el `pdfDoc` es local al host. Con el ensamblado del otro lado de la frontera, un timeout del host sobre un mensaje que el worker **sí** terminó de procesar dejaría la página adjuntada dos veces en el PDF final: un bug silencioso de salida, no un error visible.

## Decisión

### 1. Reparto: `export()` entero host-side; al worker cruzan dos operaciones de pdf-lib

La clase conserva **todo**: validación de input (§9), `EXPORT_STARTED`, el loop por página, la resolución de `Replacement[]` (`buildPageReplacements`), la llamada al `RenderPageProvider` (que ya despacha a `RenderPool`), el retry/timeout por página, `EXPORT_PROGRESS`, la creación del blob URL y `EXPORT_FINISHED`/`EXPORT_FAILED`. Al worker cruzan exactamente dos operaciones:

- **`append-page`**: `embedJpg`/`embedPng` de los bytes + `addPage([widthPt, heightPt])` + `drawImage`.
- **`save`**: `setProducer`/`setCreator`/`setCreationDate`/`setTitle` (metadata ya sanitizada en host) + `save({ useObjectStreams: true })` → `ArrayBuffer` transferido.

El worker es un **ensamblador con estado de un documento a la vez**, no un kernel puro: retiene el `PDFDocument` en construcción y el `documentId` al que pertenece. Es la **cuarta desviación sancionada de ADR-036 §1** ("el entry-point corre el motor real") y la primera con estado — inherente a pdf-lib, no una concesión de diseño. La sanitización de `title`/`filename` (§15.8, superficie de PDF injection) se queda **en host**: es validación de entrada del usuario, no ensamblado.

### 2. Transporte: se reusa `WorkerPool` con `size: 1`; ADR-036 §1 queda matizado, no revertido

El façade construye en `create-core.ts` un `WorkerPool({ poolKey: "export", jobType: "export-page", size: 1, maxQueue: 8, ... })` — espejo literal de `ocrPool`/`renderPool` — y lo inyecta: `new ExportEngine(pool?)`, con el mismo puerto interno `ExportJobPool` + `IMMEDIATE_POOL` de los otros dos y `maxRetriesOverride: 0`. *(Errata: la redacción original escribía `maxQueue: EXPORT_QUEUE_LIMIT`, un nombre de constante que sugería una fuente publicada inexistente — `MAX_QUEUE_PER_POOL` de `Contracts.md` §6 solo lista `{pdf, ocr, ner, render}`, consistente con el párrafo siguiente de esta misma sección. El valor es el literal `8`, el mismo que ocr/ner, y es funcionalmente inerte con `size: 1` y despacho secuencial.)*

**Qué de ADR-036 §1 sigue en pie** (todo lo que motivaba su rechazo del "quinto pool"): **no** hay quinta clave en `WorkerPoolConfig.maxQueuePerPool` ni en `WorkerPoolConfig.*PoolSize` — el façade pasa `size`/`maxQueue` como literales, igual que ya hace para render y ocr —, **no** hay cola prioritaria multi-worker (tamaño 1, cola trivial), y el worker sigue siendo del lado host de `export-engine`. **Qué cambia**: `PoolKey` gana la etiqueta `"export"` (tipo **interno** de `worker-pool.ts`; su único uso observable es el string `` `${poolKey}-pool` `` del `workerId` en la telemetría `WORKER_JOB_*`), y `WorkerPoolManager` conserva su unión de cuatro mediante un alias propio (`ManagedPoolKey = Exclude<PoolKey, "export">`) — el manager sigue indexando records de cuatro claves sin cambio. Reusar la clase como transporte es exactamente lo contrario del churn que ADR-036 §1 quería evitar: cero código de mensajería nuevo, y el fallback in-process (ADR-035) sale gratis.

Beneficios concretos que el pool aporta acá: correlación `jobId`, `CANCEL` propagado al worker, `FAILED` deserializado, rechazo de los jobs en vuelo si el worker crashea (§9), telemetría `WORKER_JOB_*` homogénea con los otros cuatro, creación **perezosa** del `Worker` real en el primer despacho (= "se crea perezoso al primer `EXPORT_REQUESTED`", `05` §8) y serialización natural de dos exports concurrentes (§13 caso 14) por tener un solo slot.

### 3. Payloads: `ExportPagePayload` completo y `metadata` movida a `ExportSavePayload`

```ts
// Reemplaza la forma publicada en 03_Data_Model.md §18.
export interface ExportPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly pageImage: ArrayBuffer;          // EncodedPageImage.bytes, transferido
  readonly imageFormat: "png" | "jpeg";     // decide embedPng vs embedJpg (faltaba)
  readonly pageWidthPt: number;             // document.pages[i].width  (faltaba)
  readonly pageHeightPt: number;            // document.pages[i].height (faltaba)
}

export interface ExportSavePayload {
  readonly documentId: string;
  readonly metadata: ExportMetadata;        // se aplica justo antes de save() (movida desde ExportPagePayload)
}
```

`metadata` sale de `ExportPagePayload`: viajaba en cada página y se aplica una sola vez, al final — su lugar natural es el mensaje que serializa. El entry-point discrimina por forma, en este orden: `"pageImage" in payload` → `append-page`; si no → `save` (mismo criterio que ADR-043 §4 para `render-page`). `WorkerJobType` no cambia (ambas viajan bajo `export-page`, ADR-036 §4). `EncodedPageImage.widthPx/heightPx` **no** viajan: el `drawImage` cubre la página completa (`x:0, y:0, width: pageWidthPt, height: pageHeightPt`), como ya hace el código host-side.

### 4. Estado del worker: un documento a la vez, idempotencia por `pageIndex`

- El worker retiene `{ documentId, pdfDoc, appendedPages: Set<number> }`. Un `append-page` con un `documentId` **distinto** del retenido descarta el parcial y arranca uno nuevo (misma política que el kernel de OCR con un set de idiomas distinto, ADR-045 §3: sin mensaje de control nuevo).
- **Idempotencia por `pageIndex`**: si `appendedPages` ya contiene el índice, el worker responde `COMPLETED` sin volver a adjuntar. Esto hace seguro el reintento del host cuando un `append-page` sí se completó del otro lado pero el host lo dio por perdido (timeout) — el modo de falla del punto 4 del Contexto, que produciría un PDF con páginas duplicadas sin ningún error visible. Reemplaza al guard `pageCountBeforeAttempt`, que deja de tener sentido con el `pdfDoc` fuera del host.
- `CANCEL` descarta el `PDFDocument` parcial y responde `CANCELLED` (§13 caso 13, sin cambios de contrato). `DISPOSE` libera el documento y el estado.
- Tras un `save` exitoso el worker limpia su estado (el próximo export arranca de cero aunque sea el mismo `documentId` — §13 caso 14, exports encolados del mismo documento).

> **Riesgo aceptado (2026-08-19): `save` NO es idempotente, a diferencia de `append-page`.**
>
> **La ventana**: el host despacha `save` con el timeout de 30 s de §5; el worker lo completa **después** de vencido y llama `discardState()`; el host reintenta y choca contra un assembler vacío → `ExportFailedError`.
>
> **Por qué se acepta y no se cierra**, en orden de peso:
>
> 1. **Falla ruidosamente, no en silencio.** Es la diferencia exacta con el modo de falla que la idempotencia de `append-page` sí cierra: ahí un reintento producía un **PDF con páginas duplicadas y sin ningún error visible**; acá el usuario ve `EXPORT_FAILED` en el `ExportDialog` y reintenta, y el segundo intento funciona. No hay pérdida de datos ni documento mal anonimizado — que es la clase de daño que este proyecto tiene que evitar.
> 2. **La ventana es teórica.** 30 s de presupuesto contra un `save` real de 500-2000 ms: hace falta una máquina 15-60× más lenta que la medida.
> 3. **El fix cuesta memoria permanente.** La simetría natural es que el worker retenga el último `ArrayBuffer` serializado por `documentId` hasta el próximo `append-page` — o sea **un PDF exportado entero vivo en el worker, indefinidamente**. En una pericia grande eso es memoria real, retenida para cubrir un caso que nadie observó. Y contradice la política de este mismo §4 ("tras un `save` exitoso el worker limpia su estado"), así que sería una enmienda, no un detalle de implementación.
>
> **Cuándo revisitarlo**: si aparece un `EXPORT_FAILED` reproducible en el reintento de un `save`, o si el timeout de `export-page` se baja de 30 s (lo que ensancharía la ventana proporcionalmente). Mientras tanto, la asimetría con `append-page` es deliberada y está justificada por el modo de falla, no por olvido.

### 5. Retry, timeout y errores: host-side, como hoy

Los dos loops de retry existentes se quedan en el motor (render por página y `save`), con `maxRetriesOverride: 0` en cada despacho. `workerPool.timeouts["export-page"]` (30 s, `05` §4) lo aplica el host envolviendo el despacho — el pool no tiene timeout propio. Un `EXPORT_TIMEOUT`/`EXPORT_FAILED` que cruzó el worker llega deserializado (instancia genérica con el `code` correcto); el motor lo re-instancia por `code` antes de decidir si reintenta, exactamente como ADR-045 §2 (`normalizeTimeout`) y ADR-046 §2. Sin esto, la política de reintentos cambiaría según haya worker real o fallback.

### 6. Eventos, blob URL y semántica pública intactos

`EXPORT_STARTED`/`EXPORT_PROGRESS`/`EXPORT_FINISHED`/`EXPORT_FAILED`: mismos payloads, mismo orden, emitidos siempre en host. El blob URL lo sigue creando el motor host-side desde el `ArrayBuffer` (la nota de `Export_Engine.md` §7 se cumple sin cambios: el worker nunca toca `createObjectURL`). `ExportEngineInput`/`ExportEngineOutput`/`RenderPageProvider`/`buildPageReplacements` (ADR-044 §4) no cambian. La garantía de no-recuperabilidad (§10, `test:security`) no se ve afectada: el worker solo recibe imágenes ya codificadas y metadata nueva, nunca nada del PDF original.

### 7. Wiring

`create-core.ts` construye el `exportPool` (espejo de `ocrPool`, `workerFactory` de `runtime.workers.export`, sin `onWorkerCreated`) e inyecta `new ExportEngine(exportPool)`; `dispose()` del façade lo dispone. El **Orchestrator suelta `exportWorkerFactory`** (el campo y su log dejan de existir): la factory ya no pasa por ahí, igual que las de render/ocr/ner. Con esto se cierra el último consumidor pendiente de `CoreRuntimeOptions.workers` y `poolWorkerFactories` queda sin ninguna clave viva (limpieza conjunta, ver la tarea de seguimiento del roadmap).

### 8. Qué no cambia

La interfaz pública de `Export_Engine.md` §6 salvo el constructor; el flujo del §"Flujo de export"; `ExportOptions`/`ExportMetadata` (`03_Data_Model.md` §19); la prioridad 1000 del camino de export (`05` §6.2); el render full por `RenderPool` vía `RenderPageProvider`; los tests de seguridad; `WorkerJobType`/`WorkerInbound`/`WorkerOutbound`.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Puerto de mensajería propio dentro de `export-engine`** (ADR-036 §1 literal: "sin `WorkerPool`") | Duplica ~100 líneas ya escritas y probadas en `worker-pool.ts` (correlación por `jobId`, `CANCEL`, `FAILED`/deserialize, crash, fallback in-process) en el último PR de la serie, y con una implementación distinta de la de los otros cuatro workers: más superficie de bug, cero ganancia. Lo que ADR-036 §1 quería evitar (quinta clave de config, cola multi-worker) se evita igual con `size: 1`. |
| **Quinto pool "de verdad"** (clave nueva en `WorkerPoolConfig`, gestionado por `WorkerPoolManager`) | Sigue rechazado por las razones de ADR-036 §1: churn mecánico de `maxQueuePerPool`/`*PoolSize` en fixtures de todos los paquetes, para un pool de tamaño 1 con cola trivial. |
| **Mandar todas las páginas juntas en un solo job** | Obliga a retener las N imágenes codificadas en memoria del host antes de ensamblar (1000 páginas × ~200 KB ≈ 200 MB, contra el presupuesto de `07` §5); mata el `EXPORT_PROGRESS` por página y el descarte incremental que el diseño de streaming (§12) ya tenía. |
| **Export inline en host también en el Hito 10** | `save()` de pdf-lib son 500–2000 ms de main thread (§12) contra el principio A-9; contradice `05` §7.5, `06` §14, ADR-035 §2 y ADR-036 §1. |
| **Dejar `metadata` en `ExportPagePayload`** | Se transmite N veces algo que se aplica una; y obliga al worker a decidir "¿la aplico en la primera página o en la última?" — ambigüedad gratuita en el mensaje equivocado. |

> **Enmienda de ADR-079 (2026-08-19)** sobre la prosa de "transferido": hasta ADR-079, ni este worker ni ninguno de los otros cuatro pasaban transfer list a `postMessage`, así que todo lo que cruzaba era **structured clone**. ADR-079 §1 lo hace real en la dirección worker → host, que cubre el `ArrayBuffer` del PDF final del `save` (el assembler llama `discardState()` inmediatamente después, así que transferirlo es seguro por construcción). La dirección host → worker de este motor (la imagen de página del `append-page`) queda **sin** transferir, igual que antes.

## Consecuencias

**Positivas**: el último worker del hito no inventa transporte propio; el fallback in-process queda bit-idéntico como en los otros tres; el payload publicado deja de ser inejecutable; el modo de falla "página duplicada por reintento" queda cerrado por construcción (idempotencia por índice) en vez de por un guard que ya no aplica; `CoreRuntimeOptions.workers` queda con sus cinco kinds efectivamente consumidos y el Orchestrator sin factories residuales.

**Negativas**: `PoolKey` gana una etiqueta que no es un pool en el sentido de `05` §1.1 (mitigado: `ManagedPoolKey` mantiene la unión de cuatro donde importa, y `05` §1.1 sigue diciendo cuatro pools); `03_Data_Model.md` §18 cambia dos payloads publicados (nadie los consume todavía — el ExportWorker no existe, así que el cambio es de papel); el `ArrayBuffer` de cada página hace dos saltos (RenderWorker → host → ExportWorker), inevitable mientras el encode viva donde vive el canvas (ADR-034 §3) y aceptable porque ambos son transferencias zero-copy.

**Neutras**: memoria por worker igual (60–200 MB, §12); el ExportWorker hereda la misma deuda de idle-dispose que render/ocr/ner al construirse en el façade (los `Worker` reales sí se crean perezosamente; lo que no hay es el temporizador de 60 s de `05` §8 — deuda común a los cuatro, registrada en el roadmap); el handshake `INIT`/`READY` conserva el gap conocido (el pool no envía `INIT`; el entry-point se auto-inicializa).

## Docs actualizados por este ADR

- `core/Export_Engine.md` v1.2.0: nota de cabecera, §2, §6 (constructor `pool?` + semántica del despacho), §12, §13 (casos 18–20), §14 (tests nuevos), §15 (items 21–25 de PR16).
- `architecture/05_Worker_Architecture.md` §7.5 (ciclo de vida del ensamblador, idempotencia, reset por documento) + §1.1 (nota de la fila del ExportWorker) + §1 cabecera (cuarta excepción).
- `architecture/03_Data_Model.md` §18: `ExportPagePayload` completo, `metadata` en `ExportSavePayload`.
- `roadmap/Hito10_Observaciones_Revision.md`: entrada PR16 + tareas de seguimiento.

## Validación

- **Unit del entry-point**: discriminación por forma (`append-page` vs `save`); `append-page` repetido con el mismo `pageIndex` no duplica la página; `documentId` nuevo descarta el parcial; `CANCEL` descarta y responde `CANCELLED`; `jobType ≠ "export-page"` → `FAILED`.
- **Contract del motor**: firma de §6 sin cambios salvo constructor; los cuatro eventos y su orden idénticos con y sin pool inyectado (ADR-035); todo despacho con `maxRetriesOverride: 0`; el blob URL se crea en host.
- **Unit de normalización**: `EXPORT_TIMEOUT` deserializado se reintenta como el local; agotado el reintento se emite `EXPORT_FAILED`.
- **Security (sin cambios de expectativa, corriendo por el camino nuevo)**: `no-recuperability` y `metadata-strip` verdes con el ensamblado en el worker.
- **E2E**: export real vía ExportWorker (Escenario 1, ya cubierto) — es el gate de que el reparto no rompió el flujo visible.

## Referencias

- `core/Export_Engine.md` §6–§7, §12–§15 — `architecture/05_Worker_Architecture.md` §4, §6.2, §7.5, §8 — `architecture/03_Data_Model.md` §18–§19
- `adr/ADR-013` §6 — `adr/ADR-032` §1–§3 — `adr/ADR-034` §3 — `adr/ADR-035` — `adr/ADR-036` §1/§4 — `adr/ADR-043` §2/§4 — `adr/ADR-045` §2 — `adr/ADR-046` §2
- `packages/anonymization-core/export-engine/src/export.engine.ts` (loop, retry, metadata, blob URL) — `packages/anonymization-core/src/worker-pool.ts` (`PoolKey`, `dispatchRemote`, `handleWorkerTransportError`) — `packages/anonymization-core/src/create-core.ts` (wiring de `ocrPool`) — `packages/anonymization-core/src/orchestrator.ts` (`exportWorkerFactory`, `runExport`, `makeRenderPageProvider`)
