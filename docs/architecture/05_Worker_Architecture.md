<!-- CONTEXT: scope=workers | dependencias=03_Data_Model.md,04_Event_System.md,06_Pipeline.md | audiencia=IA+humanos | fase=1 -->

# Anonly — Arquitectura de Workers (TAD bloque 8)

> Define **cada Worker**, sus responsabilidades, mensajes, timeouts, cancelaciones, reintentos, colas y prioridades. Es lo más explícito posible para que un implementador no tenga que tomar decisiones de concurrencia.

**Principio rector**: todo procesamiento pesado ocurre en Workers (principio A-9 del TAD). El main thread solo orquesta y renderiza UI.

---

## 1. Modelo general

### 1.1 Pools por tipo

Cada tipo de trabajo tiene su **propio pool**, separado. No se mezclan tipos en un mismo pool porque tienen perfiles de CPU/memoria muy distintos y requirements de reentrancia distintos.

| Pool | Tipo de job | Tamaño default | Justificación del tamaño |
|---|---|---|---|
| `PdfPool` | `pdf-parse` | `min(max(nCPU-1, 1), 4)` | CPU-bound al parsear, pero PDF.js es mayormente sync en worker. |
| `OcrPool` | `ocr-page` | `1` a `2` | Tesseract.js es muy pesado de memoria y CPU. Más de 2 satura RAM en móviles. |
| `NerPool` | `ner-page` | `1` a `2` | ONNX Runtime Web con WASM/SIMD: un modelo cargado por worker. Más workers = más RAM. |
| `RenderPool` | `render-page`, `export-page` | `min(max(nCPU-1, 1), 4)` | Canvas + pdf-lib son razonablemente paralelizables. |

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

```ts
interface WorkerInbound {
  readonly type: "RUN" | "CANCEL" | "INIT" | "DISPOSE";
  readonly jobId: string;            // para RUN, CANCEL
  readonly signalId: string;         // para RUN, CANCEL
  readonly jobType: WorkerJobType;   // para RUN, INIT
  readonly payload: WorkerJobPayload; // para RUN, INIT; Transferable donde aplique
  readonly config?: EngineConfig;    // para INIT
}
```

### 2.2 Mensaje Worker → Host

```ts
type WorkerOutbound =
  | { readonly type: "READY"; readonly workerId: string; readonly capabilities: WorkerCapabilities }
  | { readonly type: "PROGRESS"; readonly jobId: string; readonly progress: number; readonly partial?: Serializable }
  | { readonly type: "COMPLETED"; readonly jobId: string; readonly result: Serializable; readonly transferred?: Transferable[] }
  | { readonly type: "FAILED"; readonly jobId: string; readonly error: SerializedEngineError }
  | { readonly type: "CANCELLED"; readonly jobId: string; readonly signalId: string }
  | { readonly type: "LOG"; readonly level: LogLevel; readonly message: string; readonly meta?: Serializable };
```

### 2.3 Transferencia zero-copy

Cualquier `ArrayBuffer` que viaje Host→Worker o Worker→Host se transfiere con `postMessage(msg, [buffer])`, no con structured clone. Esto vacía el buffer del lado emisor (zero-copy). Aplica a:

- `pdf-parse`: el `ArrayBuffer` del PDF se transfiere al worker (no se clona).
- `ocr-page`: la `ImageData` de la página rasterizada se transfiere.
- `render-page`: la `ImageData` resultante se transfiere de vuelta.
- `export-page`: el `ArrayBuffer` final del PDF se transfiere de vuelta.

El orchestrator debe asegurar que **no** se use el buffer transferido después de transferirlo. El type system lo garantiza con un wrapper `Transferable<T>` que se consume una sola vez.

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
- Solo se reintenta si el error es `retryable === true` en el `SerializedEngineError`.
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
| `export-page` | 1000 (máxima: el usuario está esperando el archivo) |

"Visible" = dentro del viewport de la UI (ver `07_Performance_Strategy.md` sobre virtualización).

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
- `INIT`: carga `@xenova/transformers` y el modelo ONNX (cuantizado Q8). Publica `READY` con `{ workerId, modelId, quantization: "q8" }`.
- `RUN(ner-page)`: recibe `{ documentId, pageIndex, text, modelId }`. Ejecuta tokenización + inferencia. Emite `PROGRESS`. Responde `COMPLETED` con `{ occurrences: Occurrence[] }`.
- `CANCEL`: checkpoint entre batches de inferencia.
- `DISPOSE`: libera sesión de ONNX y memoria. El modelo cargado se descarga solo si `DISPOSE` lo pide explícitamente (no por cancelación).

**Memoria típica**: 200–400 MB por worker (modelo + sesión de inferencia).
**Modelo**: cacheado en Cache Storage del navegador. Lazy-loaded solo cuando se necesita NER.

### 7.4 RenderWorker

**Responsabilidad**: renderizar una página (original o anonimizada) a `ImageData` o `Blob` PNG/JPEG usando OffscreenCanvas + pdf-lib. Produce highlight de grupos habilitados.

**Ciclo de vida**:
- `INIT`: crea OffscreenCanvas. Publica `READY`.
- `RUN(render-page)`: recibe `{ documentId, pageIndex, kind: "original" | "anonymized", replacements?, scale }`. Transfiere `replacements` y referencias. Responde `COMPLETED` con `{ imageData: ImageData }` (transferido) o `{ blob: ArrayBuffer }`.
- `CANCEL`: checkpoint entre operaciones de Canvas.
- `DISPOSE`: libera OffscreenCanvas.

**Memoria típica**: 40–120 MB por worker.

### 7.5 ExportWorker

**Responsabilidad**: construir el PDF final con pdf-lib, página por página, a partir de los `render-page` ya procesados (modo anonimizado) o regenerando directamente.

**Ciclo de vida**:
- `INIT`: instancia `PDFDocument` vacío con pdf-lib. Publica `READY`.
- `RUN(export-page)`: recibe `{ documentId, pageIndex, pageImage: ArrayBuffer, metadata: ExportMetadata }`. Adjunta la página al `PDFDocument`. Responde `COMPLETED`.
- `CANCEL`: checkpoint entre páginas.
- `DISPOSE`: serializa el `PDFDocument` a `ArrayBuffer` final (transferido), libera el documento.

**Memoria típica**: 60–200 MB dependiendo del tamaño final.

---

## 8. Inicialización perezosa

Ningún pool se crea al cargar la app. Se crea bajo demanda:

- `PdfPool` se crea al primer `DOCUMENT_IMPORTED`.
- `OcrPool` se crea si `DOCUMENT_PARSED` indica `textlessPages.length > 0`.
- `NerPool` se crea si el usuario no desactivó NER en settings y hay texto para analizar.
- `RenderPool` se crea cuando hay al menos una página lista para preview.
- `ExportPool` (alias de RenderPool con workers de tipo export) se crea al primer `EXPORT_REQUESTED`.

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
  readonly maxQueuePerPool: number;
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
