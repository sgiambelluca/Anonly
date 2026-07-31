<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md | audiencia=humanos+IA | fase=10 -->

# ADR-043 — RenderEngine: reparto host/worker — la clase queda host-side, el worker corre un kernel sin estado

- **Estado**: Accepted
- **Fecha**: 2026-07-22
- **Decidido por**: El humano, sobre la decisión bloqueante pre-PR13 que ADR-041 §5 dejó asignada al planificador (el estado por documento de `render-engine` excede lo que cubre el broadcast `load-document`).
- **Relacionado con**: ADR-013 (§6: eventos siempre emitidos en host), ADR-030 (`loadDocument`/precondiciones), ADR-034 (§1 `rasterizePage`, §3 `encoded` donde vive el canvas, §5 blob URLs en host), ADR-035 (pools in-process, fallback bit-idéntico), ADR-036 (§1 "el entry-point corre el motor real" — **desviación sancionada acá para render**; §4 `load-document` broadcast, `RasterizePagePayload`), ADR-037 (supersede/cache por escala — lógica intacta, host-side), ADR-041 (§5: la fila que este ADR resuelve; mismo principio — estado en un solo lado, cómputo al worker)

## Contexto

ADR-041 §5 dejó PR13 bloqueado: `render-engine` retiene seis estructuras de estado por documento (`documents` con `PDFDocumentProxy`, `cache` LRU, `groupOverrides`, `lastAnonymizedInputs`/`lastOriginalInputs`, `pageGroupIndex`, `pendingRenders` — `render.engine.ts`), y solo la primera estaba cubierta por una decisión de transporte (broadcast `load-document`, ADR-036 §4). Mover la clase completa al worker exigiría forwarding de eventos host→worker (el motor se suscribe a `RENDER_REQUESTED`/`GROUP_TOGGLED`/`GROUP_REPLACEMENT_CHANGED`), coherencia de cache entre N workers y afinidad por página para `lastInputs` — reintroduciría, multiplicado, todo lo que ADR-041 eliminó.

La auditoría previa a esta decisión mostró que la arquitectura objetivo ya contenía el reparto correcto de forma implícita:

- `05_Worker_Architecture.md` §7.4 define el ciclo de vida del RenderWorker como `INIT` → `load-document` (broadcast) → `RUN(render-page | rasterize)` → `CANCEL`/`DISPOSE`: **sin suscripciones, sin cache, sin overrides, sin supersede** — un kernel puro.
- `RenderPagePayload` (`03_Data_Model.md` §18) es **autocontenido** (lleva `replacements`, `annotations`, `scale`, `imageFormat` por job): el worker no necesita estado de documento para renderizar, salvo el `PDFDocumentProxy`.
- Los eventos se emiten siempre en host (ADR-013 §6), el blob URL de `PREVIEW_UPDATED` lo crea el host (`Render_Engine.md` §7 nota) y `encoded` se genera donde vive el canvas (ADR-034 §3).
- `worker-pool.ts` ya anticipa el re-priming ("reemplazar un worker implica re-primear `INIT` y, para `RenderPool`, volver a mandar `load-document`").

Lo que faltaba: formalizar el reparto, fijar el wire shape de los mensajes de control (ADR-036 §4 declaró `load-document` "mensaje de control broadcast" sin definir cómo viaja sobre el union cerrado `WorkerInbound`), cubrir la liberación por documento (`unloadDocument` a mitad de sesión no tenía mensaje — solo `DISPOSE`, todo o nada), y unificar las vías de despacho (hoy el flujo de preview corre por dentro del motor sin pasar por `RenderPool`, mientras export/rasterización sí pasan — en modo worker esa asimetría rompería prioridades y backpressure).

## Decisión

### 1. Reparto: la clase `RenderEngine` queda entera host-side; el worker corre el kernel de §7.4

La clase conserva **todas** sus estructuras de estado, sus suscripciones al bus, el supersede (ADR-037 §4, lógica intacta), el cache LRU, el delta render y la emisión de eventos/blob URLs. Es, en términos de ADR-036 §1, **su propio host-bridge**. El worker corre un **kernel sin estado por documento** (salvo los `PDFDocumentProxy` cargados por broadcast): rasterización pdfjs + composición OffscreenCanvas + encode. **Desviación sancionada de ADR-036 §1** ("el entry-point corre el motor real"): para render, "el motor real" del worker es el kernel — la clase stateful no cruza la frontera. Precedente de forma: el ExportWorker ya es propiedad del lado host de `export-engine` (ADR-036 §1).

### 2. Puerto interno `RenderKernel` con despacho unificado vía `RenderPool`

`render-engine` define un puerto interno con cuatro operaciones — `loadDocument`, `unloadDocument`, `renderPage` (`RenderPagePayload`), `rasterizePage` (`RasterizePagePayload`) — y **una** implementación de despacho: todas las vías de ejecución convergen en `RenderPool.dispatch({ jobType: "render-page", payload, run })`, el seam de PR11 que ya resuelve solo el modo: con `workerFactory` despacha el `payload` por `postMessage`; sin factory invoca `run()` (el kernel in-process — el código actual de pdfjs/canvas, mismo paquete). Esto da el fallback bit-idéntico de ADR-035 gratis y hace pasar el flujo de preview por la misma cola prioritaria que export/rasterización (prioridades y backpressure coherentes; la asimetría actual desaparece). El façade inyecta al motor el acceso al pool en `createCore` (el façade ya posee `WorkerPoolManager` y motores; P-1 intacto). El Orchestrator **deja de envolver** `rasterizePage`/`renderPage` en `pool.dispatch({run})` — invoca los métodos del motor directo y el motor despacha internamente (evita el doble despacho; el wiring se ajusta en PR13, sancionado acá).

La cancelación y el supersede no cambian de lógica: el bookkeeping (`pendingRenders`, `AbortController`s) es host-side; abortar un render en vuelo se traduce al mensaje `CANCEL` del protocolo (checkpoint entre operaciones de canvas, §7.4), que el pool ya sabe propagar.

### 3. `documents` host-side pasa de `PDFDocumentProxy` a `{ buffer, pageCount }`

En modo worker los proxies viven en cada worker. El host retiene por documento el **buffer** (para el broadcast — clonado por worker, §2.3 — y el re-priming del punto 5) y el **pageCount** (para las precondiciones de ADR-030 y la validación de `pageIndex`), devuelto por el `COMPLETED` del `load-document` (el kernel in-process lo devuelve igual). La semántica pública de `loadDocument`/`unloadDocument` (§6 del spec: posesión del buffer, re-carga determinística, no-op idempotente) no cambia.

### 4. Wire shape de los mensajes de control + `unload-document` nuevo

- Los mensajes de control del RenderPool viajan como **`RUN` con `jobType: "render-page"` enviado directo a cada worker, sin pasar por la cola** (por eso "no son jobs encolables", ADR-036 §4, y por eso responden `COMPLETED` — tienen `jobId`). `WorkerInbound` **no cambia** (union cerrado intacto, coherente con ADR-036 §4/ADR-042).
- **`UnloadDocumentPayload { documentId }` nuevo** (`03_Data_Model.md` §18): broadcast simétrico a `load-document`, libera el `PDFDocumentProxy` de ese documento en cada worker a mitad de sesión (`DOCUMENT_CLOSED` → `unloadDocument`). Sin él, la única liberación era `DISPOSE` (todo o nada). Sin transfer (no viaja buffer).
- El entry-point discrimina el payload de `render-page` **por forma**, en este orden: `"buffer" in payload` → load-document; `"kind" in payload` → render (RenderPagePayload); `"pageIndex" in payload` → rasterize (RasterizePagePayload); si no → unload-document. Mismo criterio implícito que ADR-036 §4 ya usa para rasterize vs render bajo un solo jobType.
- `WorkerPool` gana una operación genérica `broadcast(payload)` (RUN directo a cada worker vivo, espera el `COMPLETED` de todos): reabre `worker-pool.ts` (PR11) con una capacidad que ADR-036 §4 ya exigía y que el propio archivo anticipaba (comentario de re-priming). En modo in-process, `broadcast` degenera en una sola invocación del kernel local.

### 5. Re-priming de workers nuevos o reemplazados

Un worker que entra al pool con documentos vigentes (creación perezosa tardía, o reemplazo tras crash — la deuda registrada en PR11) recibe `INIT` + `load-document` de **todos** los documentos retenidos por el host **antes** de aceptar jobs `render-page`. El buffer retenido del punto 3 es lo que lo hace posible. Esto concreta, para el RenderPool, el manejo de crash que PR11 dejó diferido a los PR12–16.

### 6. Qué no cambia

La interfaz pública completa de `Render_Engine.md` §6 (`loadDocument`/`unloadDocument`/`renderPage`/`renderPages`/`rasterizePage`/`requestDeltaRender`/`dispose`), los eventos de §7/§8, la clave y el alcance del supersede (ADR-037 §4 + nota v1.3.1), la clave del cache LRU (ADR-031 §2/ADR-037 §3), `WorkerJobType`/`WorkerInbound`/`WorkerOutbound` (ADR-036 §4, ADR-042), y los tamaños de pool.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| Motor completo en el worker (patrón PdfWorker/ADR-036 §1 literal) | Exige forwarding host→worker de `RENDER_REQUESTED`/`GROUP_*`, coherencia de cache y afinidad de `lastInputs` entre N workers, y N× la memoria de cache/estado; reintroduce la clase de problema que ADR-041 eliminó. |
| Estado replicado por broadcast en todos los workers | Mutaciones (`groupOverrides`, cache) por evento × worker: tráfico y memoria multiplicados; el supersede entre workers requeriría consenso — desproporcionado para estado que solo el host necesita consultar. |
| Afinidad página→worker (sticky) | Misma objeción que ADR-041 (opción 2): infraestructura genérica nueva en el pool para un problema que desaparece con el reparto correcto; el cache dejaría de ser global (misses por worker). |
| Variante nueva de `WorkerInbound` para mensajes de control | Rompe el union cerrado sin necesidad: `RUN` directo por worker ya da `jobId`/`COMPLETED`/timeouts gratis y es lo que "no encolable" (ADR-036 §4) ya insinuaba. |

## Consecuencias

**Positivas**: ningún estado mutable cruza la frontera (el worker solo retiene proxies inmutables por documento); el cache y el supersede siguen siendo globales y coherentes; el flujo de preview entra a la cola prioritaria del pool (prioridades/backpressure unificados — corrige una asimetría latente del Hito 9); el fallback in-process queda bit-idéntico sin código condicional en el motor (el pool decide); el crash-replace de RenderWorkers queda definido (re-priming) en vez de diferido.

**Negativas**: PR13 toca, además de `render-engine`, dos costuras ajenas sancionadas acá — `worker-pool.ts` (`broadcast`) y el wiring del Orchestrator (des-envolver `rasterizePage`/`renderPage`) — más `03_Data_Model.md` §18 (`UnloadDocumentPayload`); la discriminación por forma del payload de `render-page` es implícita (mitigado: orden de chequeo fijado en §4, testeable unitariamente).

**Neutras**: la memoria por worker (40–120 MB, §7.4) no cambia; los tests contract/unit del motor siguen corriendo in-process sin factory (ADR-035).

## Docs actualizados por este ADR

- `core/Render_Engine.md` v1.4.0: nota de cabecera con el reparto, §6 (semántica de `loadDocument`/`unloadDocument` en modo worker), §15 (items 22–24 nuevos para PR13).
- `architecture/05_Worker_Architecture.md` §7.4: `unload-document` en el ciclo de vida, wire shape de los controles, re-priming.
- `architecture/03_Data_Model.md` §18: `UnloadDocumentPayload` + wire shape.
- `adr/ADR-041`: nota en Estado (la decisión pre-PR13 de §5 queda tomada acá).
- `roadmap/MVP.md` (Hito 10) y `roadmap/Hito10_Observaciones_Revision.md` (tarea de seguimiento resuelta).

## Validación

- Unit del entry-point: discriminación por forma de los 4 payloads de `render-page` (orden de §4).
- Contract del motor: interfaz de §6 sin cambios; supersede/cache/delta render idénticos con y sin factory (fallback ADR-035).
- Integration/E2E de PR13: preview real vía RenderWorkers en la app (Escenario 1), `DOCUMENT_CLOSED` libera proxies en cada worker (`unload-document`), reemplazo de worker re-primea `load-document`.
- Gates completos verdes al cierre de PR13.

## Referencias

- `core/Render_Engine.md` §6–§8, §12 — `architecture/05_Worker_Architecture.md` §2, §7.4 — `architecture/03_Data_Model.md` §18
- `adr/ADR-030` — `adr/ADR-034` §1/§3/§5 — `adr/ADR-035` — `adr/ADR-036` §1/§4 — `adr/ADR-037` §3/§4 — `adr/ADR-041` §5 — `adr/ADR-042`
- `packages/anonymization-core/render-engine/src/render.engine.ts` (estado y suscripciones) — `packages/anonymization-core/src/worker-pool.ts` (seam `dispatch({payload, run})`, comentario de re-priming) — `packages/anonymization-core/src/orchestrator.ts` (wiring actual de `rasterizePage`/`renderPage`)
