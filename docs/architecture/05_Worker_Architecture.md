<!-- CONTEXT: scope=workers | dependencias=03_Data_Model.md,04_Event_System.md,06_Pipeline.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-042-WorkerOutbound-Completed-Result-Unknown.md | audiencia=IA+humanos | fase=1 (actualizado en fase 9/10: entrega por fases ADR-035; transporte, EVENT, payloads y ExportWorker por ADR-036; COMPLETED.result unknown por ADR-042) -->

# Anonly — Arquitectura de Workers (TAD bloque 8)

> Define **cada Worker**, sus responsabilidades, mensajes, timeouts, cancelaciones, reintentos, colas y prioridades. Es lo más explícito posible para que un implementador no tenga que tomar decisiones de concurrencia.

**Principio rector**: todo procesamiento pesado ocurre en Workers (principio A-9 del TAD). El main thread solo orquesta y renderiza UI.

**Entrega por fases (ADR-035)**: el Hito 9 implementa los cuatro pools como colas de concurrencia **in-process** con la semántica completa de este documento (colas prioritarias, límites, backpressure, reintentos, eventos `WORKER_*`, cancelación), despachando por llamada directa a los métodos públicos de cada motor. El transporte por Web Workers de SO reales (`postMessage`, transferables §2.3, entry-points por motor) llega en el Hito 10, donde existe el bundler de `apps/react-client`. Este documento sigue siendo la arquitectura objetivo.

**Pools ≠ workers (ADR-036 §1)**: hay **cuatro pools** (§1.1) y **cinco entry-points de worker** (§7.1–§7.5). El ExportWorker (§7.5) es un worker único dedicado sin `WorkerPool` propio: lo posee el lado host de `export-engine`, no hay quinta clave en `WorkerPoolConfig`. Los `Worker` reales entran al Core por factories inyectadas en `createCore` (`CoreRuntimeOptions`, `Contracts.md` §3.5); sin factory para un kind, ese despacho queda in-process (ADR-035 §1) — la migración es motor por motor. Cada motor entrega dos mitades en su propio paquete: el **entry-point** (corre el motor real en el worker con un `EngineContext` puente) y el **host-bridge** (re-emite los eventos en el bus real del host — ADR-013 §6 — y completa efectos de host: blob URLs, depósito en `ctx.cache`).

---

## 1. Modelo general

### 1.1 Pools por tipo

Cada tipo de trabajo tiene su **propio pool**, separado. No se mezclan tipos en un mismo pool porque tienen perfiles de CPU/memoria muy distintos y requirements de reentrancia distintos.

| Pool | Tipo de job | Tamaño default | Justificación del tamaño |
|---|---|---|---|
| `PdfPool` | `pdf-parse` | `min(max(nCPU-1, 1), 4)` | CPU-bound al parsear, pero PDF.js es mayormente sync en worker. |
| `OcrPool` | `ocr-page` | `1` a `2` | Tesseract.js es muy pesado de memoria y CPU. Más de 2 satura RAM en móviles. |
| `NerPool` | `ner-page` | `1` a `2` | ONNX Runtime Web con WASM/SIMD: un modelo cargado por worker. Más workers = más RAM. |
| `RenderPool` | `render-page` (incluye la rasterización para OCR — `RasterizePagePayload`, ADR-034 §1/ADR-036 §4) | `min(max(nCPU-1, 1), 4)` | Canvas + pdfjs son razonablemente paralelizables. |
| ExportWorker (único, **no** es un pool) | `export-page` | `1` fijo | Ensamblado pdf-lib estrictamente secuencial sobre un solo `PDFDocument` (no thread-safe); una cola multi-worker no aporta. Dueño: lado host de `export-engine` (ADR-036 §1). |

`nCPU = navigator.hardwareConcurrency ?? 4`. Override por config del usuario (setting "Rendimiento").

### 1.2 Componentes

```
Host
├─ WorkerPoolManager
│   ├─ PdfPool
│   ├─ OcrPool
│   ├─ NerPool
│   └─ RenderPool
└─ AbortRegistry: Map<signalId, AbortController>

Cada Pool
├─ Queue<WorkerJob> (cola prioritaria)
├─ Worker[] (workers activos)
├─ IdleRegistry: Set<workerId> (workers libres)
└─ Stats: { dispatched, completed, failed, cancelled, avgDurationMs }
```

---

## 2. Mensajería

### 2.1 Mensaje Host → Worker

`WorkerInbound` es una unión discriminada por `type` (alineada con `WorkerOutbound` §2.2): cada variante tiene exactamente los campos que necesita, todos `readonly`. `config` (en `INIT`) y `payload` (en `RUN`) quedan tipados `unknown` a este nivel de transporte — cada worker los afina a su propio tipo concreto (`PdfParsePayload`, `OcrPagePayload`, etc., ver `03_Data_Model.md` §18) cuando se implementa en su hito (ver `adr/ADR-019-Hito1-Hardening.md`).

```ts
export type WorkerInbound =
  | { readonly type: "INIT"; readonly config: unknown }
  | { readonly type: "RUN"; readonly jobId: string; readonly signalId: string; readonly jobType: WorkerJobType; readonly payload: unknown }
  | { readonly type: "CANCEL"; readonly jobId: string; readonly signalId: string }
  | { readonly type: "DISPOSE" };
```

### 2.2 Mensaje Worker → Host

`COMPLETED.result` queda tipado `unknown` a este nivel de transporte (ADR-042) — misma regla que `INIT.config`/`RUN.payload` (§2.1, ADR-019) y que `EVENT.payload` (ADR-036 §3): el tipo concreto se afina al cruzar la frontera, acá en el **host-bridge** de cada motor, que lo estrecha a su `*EngineOutput` esperado con comentario de frontera (los `*EngineOutput` son `interface`s, no asignables a un index signature — microsoft/TypeScript#15300). `PROGRESS.partial` y `LOG.meta` **conservan** `Serializable`: transportan literales ad-hoc (que sí chequean contra el index signature), y la garantía estática de clonabilidad ahí es gratis.

```ts
export type WorkerOutbound =
  | { readonly type: "READY"; readonly workerId: string; readonly capabilities: WorkerCapabilities }
  | { readonly type: "PROGRESS"; readonly jobId: string; readonly progress: number; readonly partial?: Serializable }
  // ADR-042: result es unknown a nivel de transporte; el host-bridge lo afina.
  | { readonly type: "COMPLETED"; readonly jobId: string; readonly result: unknown; readonly transferred?: ReadonlyArray<Transferable> }
  | { readonly type: "FAILED"; readonly jobId: string; readonly error: SerializedEngineError }
  | { readonly type: "CANCELLED"; readonly jobId: string; readonly signalId: string }
  | { readonly type: "LOG"; readonly level: LogLevel; readonly message: string; readonly meta?: Serializable }
  // ADR-036 §3: el entry-point corre el motor real con un bus puente; cada emit
  // viaja como EVENT y el host-bridge del motor lo afina y re-emite en el bus
  // real (los eventos observables se emiten siempre en host, ADR-013 §6).
  | { readonly type: "EVENT"; readonly channel: EventChannel; readonly event: EngineEvents; readonly payload: unknown };
```

### 2.3 Transferencia zero-copy

Cualquier `ArrayBuffer` que viaje Host→Worker o Worker→Host se transfiere con `postMessage(msg, [buffer])`, no con structured clone. Esto vacía el buffer del lado emisor (zero-copy). Aplica a (precisiones ADR-036 §4):

- `pdf-parse`: el `ArrayBuffer` del PDF se transfiere al worker. Lo transferido es una **copia**: el Orchestrator retiene el original de la etapa 0 para `RenderEngine.loadDocument` (`06_Pipeline.md` §3, ADR-030).
- `ocr-page`: la `ImageData` de la página rasterizada viaja con su buffer subyacente en la transfer list — `postMessage(msg, [imageData.data.buffer])` (una `ImageData` no es transferible por sí misma; su clon estructurado referencia el buffer transferido, zero-copy).
- `load-document` (control, no job — §7.4): el buffer se **clona** por cada RenderWorker; transferirlo vaciaría el original retenido.
- `render-page`: la `ImageData` resultante se transfiere de vuelta; en `mode: "full"`, también `encoded.bytes` (`EncodedPageImage`, ADR-034 §3).
- `export-page`: el `ArrayBuffer` final del PDF se transfiere de vuelta en el `COMPLETED` del job `ExportSavePayload` (§7.5).

El orchestrator debe asegurar que **no** se use el buffer transferido después de transferirlo. El type system lo garantiza con un wrapper `Transferable<T>` que se consume una sola vez (`Contracts.md` §7). Nota de implementación: en archivos de worker (lib DOM), ese tipo sombrea al `Transferable` global del DOM — importarlo con alias (`import type { Transferable as TransferableBuffer }`).

---

## 3. Cancelación

### 3.1 Mecanismo

1. UI emite `CANCEL_REQUESTED` (canal `pipeline`).
2. Orchestrator llama `abortRegistry.get(signalId).abort()`.
3. Orchestrator envía `{ type: "CANCEL", signalId }` a cada pool que tenga jobs con ese `signalId`.
4. Pool hace `postMessage({ type: "CANCEL", jobId, signalId })` al worker que ejecuta cada job afectado.
5. Worker, en su loop interno, chequea una bandera atómica (`shouldCancel`) en cada iteración significativa (página procesada, batch de palabras, etc.) y termina en un **checkpoint seguro**.
6. Worker responde `{ type: "CANCELLED", jobId, signalId }`.
7. Pool emite `WORKER_JOB_CANCELLED`.
8. Orchestrator emite `PIPELINE_CANCELLED`.

### 3.2 Garantía de latencia

- **SLA de cancelación**: el cese de CPU del worker debe ocurrir en < 200 ms desde `CANCEL_REQUESTED`.
- Para cumplirlo, los loops internos de los workers deben tener checkpoints cada ≤ 50 ms de trabajo (verificado por test de cancelación).

### 3.3 Liberación de recursos tras cancelación

- El worker libera: memoria temporal, Canvas/OffscreenCanvas, instancias de PDF.js/Tesseract/ONNX no reutilizables.
- No se descargan los modelos ONNX ni se destruyen workers del pool; solo se cancela el job. Destruir workers es responsabilidad de `dispose()` del engine, no de la cancelación.

---

## 4. Timeouts

| Job type | Timeout default | Acción al timeout |
|---|---|---|
| `pdf-parse` | 30 s por página | `WORKER_JOB_TIMEOUT` → reintentar 1 vez → `PDF_INVALID` |
| `ocr-page` | 60 s por página | reintentar hasta `maxRetries = 2` → `OCR_PAGE_FAILED` |
| `ner-page` | 20 s por página | reintentar 1 vez → mantener ocurrencias Regex, descartar NER de esa página con warning |
| `render-page` | 10 s por página | reintentar 1 vez → `PREVIEW_PAGE_FAILED` |
| `export-page` | 30 s por página | reintentar 1 vez → `EXPORT_FAILED` |

Los timeouts son `EngineConfig` por sesión y ajustables por el usuario (modo "Documento grande").

---

## 5. Reintentos

Política común:

- `maxRetries` por job type (tabla arriba).
- Backoff exponencial: `delay = baseDelayMs * 2^attempt`, con `baseDelayMs = 250`, cap `2000 ms`.
- Solo se reintenta si el error es `retryable === true` en el `SerializedEngineError`. Semántica canónica (ADR-035 §3): `retryable` significa **auto-reintentable por el pool sin intervención del usuario**; la recuperabilidad por acción del usuario (p. ej. password) se expresa por evento + flujo de UI, nunca por este flag.
- Errores no retryables: `PDF_INVALID`, `PDF_PASSWORD_REQUIRED`, `NER_MODEL_MISSING`, cualquier error de tipo `InvalidInput`.
- Tras `maxRetries`, se emite el evento de fallo correspondiente (tabla por job type).

---

## 6. Colas y prioridades

### 6.1 Estructura de cola

Cada pool tiene una `PriorityQueue<WorkerJob>` ordenada por:

1. `priority` (mayor primero).
2. `createdAt` (FIFO dentro de la misma prioridad).

### 6.2 Prioridades default

| Job type | Default `priority` |
|---|---|
| `pdf-parse` (página visible en UI) | 100 |
| `pdf-parse` (página no visible) | 50 |
| `ocr-page` (página visible) | 90 |
| `ocr-page` (página no visible) | 40 |
| `ner-page` (página visible) | 80 |
| `ner-page` (página no visible) | 30 |
| `render-page` (preview de página visible) | 70 |
| `render-page` (preview de página no visible) | 20 |
| `render-page` (rasterización para OCR, `RasterizePagePayload`) | 90 visible / 40 no visible (espejo de `ocr-page`, a la que alimenta — ADR-036 §4) |
| `export-page` | 1000 (máxima: el usuario está esperando el archivo) |

"Visible" = dentro del viewport de la UI (ver `07_Performance_Strategy.md` sobre virtualización).

> La prioridad 1000 aplica al **camino completo** del export: los `render-page` en `mode: "full"` despachados por el `RenderPageProvider` durante un export también van a 1000 (así lo implementa `orchestrator.ts` desde el Hito 9); los jobs `export-page` propiamente dichos corren en el ExportWorker dedicado y no compiten en cola con nadie (ADR-036 §1).

### 6.3 Backpressure

- Si `queue.length > MAX_QUEUE_PER_POOL`, el pool emite `WORKER_POOL_SATURATED`.
- El Orchestrator pausa el ingreso de nuevos jobs del mismo tipo hasta que la cola baje del 50%.
- `MAX_QUEUE_PER_POOL`: default 32 para PDF/Render, 8 para OCR/NER.

---

## 7. Detalle por Worker

### 7.1 PdfWorker

**Responsabilidad**: parsear páginas de un PDF con PDF.js, extraer `Word[]` con `BoundingBox`, identificar páginas sin texto.

**Ciclo de vida**:
- `INIT`: carga `pdfjs-dist` y su wasm. Publica `READY` con `{ workerId, capabilities: { maxPageBatchSize: 8 } }`.
- `RUN(pdf-parse)`: recibe `{ documentId, buffer, password?, pageRange }`. Transfiere `buffer`. Procesa páginas en lotes. Emite `PROGRESS` por página. Responde `COMPLETED` con `{ pages: Page[], textlessPages: number[] }`.
- `CANCEL`: checkpoint entre páginas.
- `DISPOSE`: libera `pdfjs-dist` worker interno y memoria.

**Memoria típica**: 20–80 MB por PDF activo (depende de tamaño).
**Estado entre jobs**: reutiliza el `PDFDocumentProxy` solo si el `documentId` coincide; si no, lo cierra y abre uno nuevo.

### 7.2 OcrWorker

**Responsabilidad**: ejecutar Tesseract.js sobre la imagen rasterizada de una página sin texto.

**Ciclo de vida**:
- `INIT`: carga `tesseract.js` y descarga/initializa el modelo `spa+eng` (default). Publica `READY` con `{ workerId, languages: ["spa","eng"], modelVersion }`.
- `RUN(ocr-page)`: recibe `{ documentId, pageIndex, imageData, dpi, languages }`. Transfiere `imageData`. Procesa. Emite `PROGRESS`. Responde `COMPLETED` con `{ words: Word[], confidence }`.
- `CANCEL`: checkpoint entre líneas de texto reconocidas (Tesseract expone callback de progreso).
- `DISPOSE`: libera Tesseract worker y memoria temporal.

**Memoria típica**: 150–300 MB por worker (el modelo cargado pesa).
**Modelo**: cacheado en IndexedDB tras primera descarga. No se descarga entre jobs.

### 7.3 NerWorker

**Responsabilidad**: ejecutar el modelo NER local (Transformers.js + ONNX Runtime Web) sobre el texto de una página y devolver `Occurrence[]` con `source: "ner"`.

**Ciclo de vida**:
- `INIT`: carga `@huggingface/transformers` y el modelo ONNX (cuantizado Q8). Publica `READY` con `{ workerId, modelId, quantization: "q8" }`.
- `RUN(ner-page)`: recibe `{ documentId, pageIndex, text, modelId }`. Ejecuta tokenización + inferencia. Emite `PROGRESS`. Responde `COMPLETED` con `{ occurrences: Occurrence[] }`.
- `CANCEL`: checkpoint entre batches de inferencia.
- `DISPOSE`: libera sesión de ONNX y memoria. El modelo cargado se descarga solo si `DISPOSE` lo pide explícitamente (no por cancelación).

**Memoria típica**: 200–400 MB por worker (modelo + sesión de inferencia).
**Modelo**: cacheado en Cache Storage del navegador. Lazy-loaded solo cuando se necesita NER.

### 7.4 RenderWorker

**Responsabilidad**: renderizar una página (original o anonimizada) a `ImageData` o `Blob` PNG/JPEG usando OffscreenCanvas + pdfjs-dist (fe de erratas ADR-030 §5: decía pdf-lib, que es del ExportWorker y está prohibido en Render — `Render_Engine.md` §5). Produce highlight de grupos habilitados.

**Ciclo de vida**:
- `INIT`: crea OffscreenCanvas. Publica `READY`.
- `load-document`: mensaje de **control broadcast** (no es un `WorkerJobType` encolable — un job iría a un solo worker idle y los demás quedarían sin documento; ADR-036 §4): el host lo envía a **cada** worker del pool con `LoadDocumentPayload { documentId, buffer }` (buffer **clonado** por worker, ver §2.3). Crea el `PDFDocumentProxy` interno con pdfjs-dist (ADR-030). Responde `COMPLETED`.
- `RUN(render-page)`: recibe `RenderPagePayload` (`03_Data_Model.md` §18) **o** `RasterizePagePayload { documentId, pageIndex, scale }` (rasterización para OCR, sin eventos de preview — ADR-034 §1/ADR-036 §4). Precondición: documento cargado vía `load-document` (ADR-030). Responde `COMPLETED` con `{ imageData: ImageData }` (transferido) y, en `mode: "full"`, `encoded` (`EncodedPageImage`, ADR-034 §3).
- `CANCEL`: checkpoint entre operaciones de Canvas.
- `DISPOSE`: libera OffscreenCanvas y destruye los `PDFDocumentProxy` cargados.

**Memoria típica**: 40–120 MB por worker.

### 7.5 ExportWorker

**Responsabilidad**: construir el PDF final con pdf-lib, página por página, a partir de las `EncodedPageImage` producidas por el `RenderPageProvider` (ADR-032/ADR-034 §3). Es un **worker único dedicado, sin pool** (ADR-036 §1): lo posee el lado host de `export-engine`; `ExportEngine.export()` sigue en host (dirige el loop y emite `EXPORT_*` — ADR-013 §6) y solo la frontera pdf-lib cruza al worker.

**Ciclo de vida**:
- `INIT`: instancia `PDFDocument` vacío con pdf-lib. Publica `READY`.
- `RUN(export-page)`: recibe `ExportPagePayload { documentId, pageIndex, pageImage, metadata }` (`pageImage` transferido). Adjunta la página al `PDFDocument`. Responde `COMPLETED`.
- `RUN(export-page` con `ExportSavePayload { documentId })`: serializa el `PDFDocument` y responde `COMPLETED` con el `ArrayBuffer` final **transferido** (errata corregida por ADR-036 §4: la serialización era un efecto de `DISPOSE`, que no tiene mensaje de respuesta en `WorkerOutbound`).
- `CANCEL`: checkpoint entre páginas; el `PDFDocument` parcial se descarta.
- `DISPOSE`: libera el documento y memoria (sin respuesta con datos).

**Memoria típica**: 60–200 MB dependiendo del tamaño final.
**Creación**: perezosa al primer `EXPORT_REQUESTED`; disposición tras 60 s idle o `dispose()` del motor (§8).

---

## 8. Inicialización perezosa

Ningún pool se crea al cargar la app. Se crea bajo demanda:

- `PdfPool` se crea al primer `DOCUMENT_IMPORTED`.
- `OcrPool` se crea si `DOCUMENT_PARSED` indica `textlessPages.length > 0`.
- `NerPool` se crea si el usuario no desactivó NER en settings y hay texto para analizar.
- `RenderPool` se crea cuando hay al menos una página lista para preview.
- El **ExportWorker** (worker único de `export-engine`, sin pool — ADR-036 §1; la redacción anterior "`ExportPool`, alias de RenderPool con workers de tipo export" era errata: mezclaba tipos de worker contra §1.1) se crea al primer `EXPORT_REQUESTED`.

Cada pool puede destruirse tras `DOCUMENT_CLOSED` + `idle` por > 60 s para liberar memoria.

---

## 9. Manejo de errores de Worker

| Situación | Acción |
|---|---|
| Worker crashea (uncaught error) | Pool lo marca como dead, lo reemplaza, reintenta el job si `retryable`. |
| Worker no responde a `READY` en 10 s | Pool lo descarta y crea otro. |
| `postMessage` lanza (transfer ya consumido) | Error de programación; lanza en dev, loguea en prod. |
| Worker emite `FAILED` no retryable | Pool emite `WORKER_JOB_FAILED`, Orchestrator emite evento funcional de fallo. |
| `DISPOSE` falla | Loguea `warn`, no bloquea el cierre. |

---

## 10. Configuración (resumen)

```ts
export interface WorkerPoolConfig {
  readonly pdfPoolSize: number;
  readonly ocrPoolSize: number;
  readonly nerPoolSize: number;
  readonly renderPoolSize: number;
  // Por pool (ADR-034 §7): default { pdf: 32, ocr: 8, ner: 8, render: 32 }
  readonly maxQueuePerPool: Readonly<Record<"pdf" | "ocr" | "ner" | "render", number>>;
  readonly timeouts: Readonly<Record<WorkerJobType, number>>;
  readonly maxRetries: Readonly<Record<WorkerJobType, number>>;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly cancelSlaMs: number;            // 200
  readonly idleDisposeMs: number;          // 60000
}
```

Defaults en la tabla por job type más arriba.

---

## 11. Referencias

- `04_Event_System.md` §9 — eventos `WORKER_*`.
- `03_Data_Model.md` §18 — `WorkerJob`, `WorkerJobType`.
- `07_Performance_Strategy.md` — pool sizing, memory budget, cancelación.
- `06_Pipeline.md` — qué job dispara cada etapa.
- `core/Contracts.md` — tipos de payloads de workers.
- `adr/ADR-003-Workers.md` — por qué pools por tipo.
- `adr/ADR-006-NER-Local.md` — por qué ONNX local.
