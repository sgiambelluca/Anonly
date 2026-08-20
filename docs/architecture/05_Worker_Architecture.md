<!-- CONTEXT: scope=workers | dependencias=03_Data_Model.md,04_Event_System.md,06_Pipeline.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-042-WorkerOutbound-Completed-Result-Unknown.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md | audiencia=IA+humanos | fase=1 (actualizado en fase 9/10: entrega por fases ADR-035; transporte, EVENT, payloads y ExportWorker por ADR-036; COMPLETED.result unknown por ADR-042; RenderWorker kernel, unload-document y re-priming por ADR-043; OcrWorker kernel por ADR-045; NerWorker kernel y enrutamiento de PROGRESS por ADR-046; invariante de decodificación en §2.2 por ADR-055 y regla transversal de pdf.js-en-Worker en §7 por ADR-053, ambos del cierre de fase 10) -->

# Anonly — Arquitectura de Workers (TAD bloque 8)

> Define **cada Worker**, sus responsabilidades, mensajes, timeouts, cancelaciones, reintentos, colas y prioridades. Es lo más explícito posible para que un implementador no tenga que tomar decisiones de concurrencia.

**Principio rector**: todo procesamiento pesado ocurre en Workers (principio A-9 del TAD). El main thread solo orquesta y renderiza UI.

**Entrega por fases (ADR-035)**: el Hito 9 implementa los cuatro pools como colas de concurrencia **in-process** con la semántica completa de este documento (colas prioritarias, límites, backpressure, reintentos, eventos `WORKER_*`, cancelación), despachando por llamada directa a los métodos públicos de cada motor. El transporte por Web Workers de SO reales (`postMessage`, transferables §2.3, entry-points por motor) llega en el Hito 10, donde existe el bundler de `apps/react-client`. Este documento sigue siendo la arquitectura objetivo.

**Pools ≠ workers (ADR-036 §1)**: hay **cuatro pools** (§1.1) y **cinco entry-points de worker** (§7.1–§7.5). El ExportWorker (§7.5) es un worker único dedicado sin `WorkerPool` propio: lo posee el lado host de `export-engine`, no hay quinta clave en `WorkerPoolConfig`. Los `Worker` reales entran al Core por factories inyectadas en `createCore` (`CoreRuntimeOptions`, `Contracts.md` §3.5); sin factory para un kind, ese despacho queda in-process (ADR-035 §1) — la migración es motor por motor. Cada motor entrega dos mitades en su propio paquete: el **entry-point** (corre el motor real en el worker con un `EngineContext` puente) y el **host-bridge** (re-emite los eventos en el bus real del host — ADR-013 §6 — y completa efectos de host: blob URLs, depósito en `ctx.cache`). **Excepciones sancionadas al "corre el motor real"**: RenderWorker (ADR-043), OcrWorker (ADR-045) y NerWorker (ADR-046) corren **kernels sin estado por documento** — la clase del motor, con su estado, eventos y efectos de cache, queda entera host-side y despacha a su pool por un puerto interno; en esos tres, el entry-point no necesita bus puente ni cache local. En el NerWorker, además, el ciclo de vida del modelo (lo único observable que solo puede ocurrir dentro del worker) viaja por `PROGRESS` y lo traduce a eventos el motor, en host (ADR-046 §4). El **ExportWorker** (ADR-047) es la cuarta excepción y la única **con estado**: es un ensamblador de un documento a la vez (el `PDFDocument` de pdf-lib se construye incrementalmente y no puede quedarse en host), con reglas explícitas de reset e idempotencia en §7.5 — el resto del motor sigue host-side igual que los otros tres.

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
| ExportWorker (único, **no** es un pool) | `export-page` | `1` fijo | Ensamblado pdf-lib estrictamente secuencial sobre un solo `PDFDocument` (no thread-safe); una cola multi-worker no aporta. Dueño: lado host de `export-engine` (ADR-036 §1). Desde ADR-047 §2 su transporte es una instancia de `WorkerPool` con `size: 1` construida por el façade — reuso de mensajería, **no** un quinto pool: sigue sin clave propia en `WorkerPoolConfig` y sin cola prioritaria. |

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

`COMPLETED.result` queda tipado `unknown` a este nivel de transporte (ADR-042) — misma regla que `INIT.config`/`RUN.payload` (§2.1, ADR-019) y que `EVENT.payload` (ADR-036 §3): el tipo concreto se afina al cruzar la frontera, acá en el **host-bridge** de cada motor, que lo estrecha a su `*EngineOutput` esperado (los `*EngineOutput` son `interface`s, no asignables a un index signature — microsoft/TypeScript#15300). `PROGRESS.partial` y `LOG.meta` **conservan** `Serializable`: transportan literales ad-hoc (que sí chequean contra el index signature), y la garantía estática de clonabilidad ahí es gratis.

**Invariante de decodificación (ADR-055 §1)**: "afinar" significa **verificar la forma en runtime**, no afirmarla con un tipo. Ningún valor que haya cruzado la frontera de un Worker se consume sin decodificar — ni el `result` de `COMPLETED`, ni el `partial` de un `PROGRESS` que un motor interprete. Un cast anotado con un comentario de frontera **no** alcanza: el parámetro de tipo de `dispatch<T>` es una afirmación que el compilador no puede verificar, porque del otro lado hay un `postMessage`. Fue exactamente el modo de falla de ADR-055 (el `NerWorker` posteaba `{ spans }` y el host iteraba el resultado como si fuera un array, con el `TypeError` tragado por un logger nulo).

El mecanismo que lo impone: **cada motor angosta su propio puerto interno de despacho a `Promise<unknown>`** (`NerJobPool`, `OcrJobPool`, `RenderJobPool` y el equivalente de Export — todos viven dentro del archivo de su motor). A partir de ahí el compilador obliga a pasar por un guard, porque `unknown` no se puede iterar, indexar ni desestructurar. `worker-pool.ts` **no** cambia: es transporte, y el transporte no conoce el contrato del payload de cada motor. Un decoder que ante una forma inesperada devuelva `[]`, `undefined` o cualquier default **está prohibido** (ADR-055 §3): lanza un `EngineError` de la subclase que corresponda. Que falle ruidosamente es el punto.

**Excepción de ubicación — `pdf-engine` (ADR-055 §10)**: los cuatro puertos de arriba existen porque sus motores se partieron en mitad host + kernel (§7.2-§7.5; ADR-043/045/046/047). `pdf-engine` conserva el modelo original de ADR-036 §3 —el entry-point corre el **motor real** completo (§7.1)— así que no tiene puerto interno ni host-bridge propio: el consumidor de su `COMPLETED.result` es el **façade** (`orchestrator.ts`, stage de extracción). El invariante aplica igual y el decoder sigue siendo del motor (`decodePdfEngineOutput`, exportado por `pdf-engine`, `core/PDF_Engine.md` §6); lo único distinto es que lo **invoca** el façade, host-side — misma forma que `fuseOcrPage` (ADR-041). Angostar ahí significa `dispatch<unknown>` en el call site, no un puerto nuevo.

**Qué se transfiere y qué se clona (ADR-079)**: `postMessage` **clona** por defecto, y hasta ADR-079 ningún entry-point ni `dispatchRemote` pasaba transfer list — o sea que todo lo que cruzaba era un `memcpy` completo, pese a que este doc y ADR-047 decían "transferido". La regla es transferir solo lo que el emisor no vuelve a mirar:

| Payload | Dirección | ¿Transfer? | Por qué |
|---|---|---|---|
| `EncodedPageImage` (preview, export, rasterizado) | worker → host | **sí** | El kernel lo postea y no guarda referencia. Es el caso más frecuente: uno por página por render. |
| `ArrayBuffer` del PDF final (`save`) | worker → host | **sí** | El assembler llama `discardState()` justo después. |
| `OcrPagePayload.imageData` (~8 MB por página A4 a 300 dpi) | host → worker | **sí** | El host lo rasteriza para ese job y lo suelta. |
| `LoadDocumentPayload.buffer` (el PDF entero) | host → worker | **NO, nunca** | Es el buffer retenido del Orchestrator, y viaja por `broadcast` al mismo tiempo a N workers: el primer transfer lo detacharía y los N-1 restantes recibirían 0 bytes. Transferirlo reintroduce el bug #6 del PR10. |

Regla de fondo: **worker → host siempre es seguro** (el worker descarta o muere después de postear); **host → worker se justifica caso por caso**. Por eso `broadcast()` no acepta transfer list — es la garantía estructural de que nadie puede transferir un `load-document` por error.

El canal de errores tiene su equivalente ya resuelto: la identidad de clase tampoco sobrevive al `postMessage`, y se discrimina por `code` (ADR-049).

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

**Enrutamiento de `PROGRESS` (ADR-046 §4)**: `WorkerPool` deja de descartar los `PROGRESS` — `DispatchParams` gana `onProgress?: (progress: number, partial?: Serializable) => void` y el pool entrega al job pendiente (por `jobId`) lo que su worker reporte; un `PROGRESS` de un job ya resuelto se descarta en silencio. Es el canal para telemetría de transporte que el host necesita traducir a eventos de dominio (primer consumidor: el ciclo de vida del modelo NER → `NER_MODEL_LOADING`/`NER_MODEL_READY`, ADR-046 §4); **no** es una vía para emitir eventos observables desde el worker, que sigue siendo terreno de `EVENT` + host-bridge (ADR-013 §6, ADR-036 §3). En modo in-process el motor pasa el mismo callback directo al kernel: comportamiento observable idéntico (ADR-035).

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
- **Lo que cruza el boundary es el `SerializedEngineError`, no la clase** (ADR-049): el worker postea `FAILED` con `err.serialize()` y el host reconstruye con `EngineError.deserialize()` un `DeserializedEngineError` genérico — `postMessage` no transporta prototipos. Sobreviven `code`, `engineId`, `message`, `retryable` y `details`; la subclase concreta no. Por eso tanto la política de reintentos como cualquier caso especial de un consumidor se deciden por el **flag** o por el **`code`**, nunca por `instanceof <SubclaseConcreta>` (`ai/Code_Standards.md` §7). `instanceof EngineError` sigue siendo válido. **Excepción por construcción**: la cancelación no pasa por este camino — el entry-point discrimina `CancelledError` antes del `FAILED` y postea un frame `CANCELLED`, con el que el host instancia un `CancelledError` real (§2 y §3, paso 6).
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

**Regla transversal — pdf.js hospedado en un Worker (ADR-053 §1)**: aplica a todo entry-point que corra la **capa de display** de `pdfjs-dist` dentro de un Web Worker; hoy, PdfWorker (§7.1) y RenderWorker (§7.4).

Dentro de un Worker no existe `document`, así que la Font Loading API de pdf.js no está disponible: `FontLoader.isFontLoadingAPISupported` da `false` y el registro del `@font-face` falla con un `TypeError` que pdf.js **no loguea**. Con `disableFontFace` en `false` (su default en browser — solo se auto-activa bajo Node), el resultado es que pdf.js dibuja los `fontChar` del área de uso privado contra una fuente que nunca se registró: todo el texto sale como glifos `.notdef` (cuadrados). Falla en silencio y solo para algunos documentos, según cómo esté codificada cada fuente.

Por lo tanto, todo `getDocument()` invocado desde un Worker configura:

| Opción | Valor | Por qué |
|---|---|---|
| `disableFontFace` | `true` | Dibuja los glifos como `Path2D` desde el programa de fuente embebido, sin tocar el DOM. Además es lo que hace que el hilo de pdf.js construya y envíe las siluetas (`buildFontPaths`). **Solo para kernels que rasterizan**; el que solo extrae texto no lo lleva. |
| `useSystemFonts` | `false` | Evita el camino `loadSystemFont`, que sin Font Loading API llega a un `unreachable()`. |
| `useWorkerFetch` | `false` | **Obligatorio y explícito.** El default de pdf.js evalúa `document.baseURI`; hoy no explota solo porque `cMapUrl` es `null` y la cadena `&&` corta antes. Al pasar las URLs sin fijarlo, tira `ReferenceError` dentro del Worker. |
| `cMapUrl` + `cMapPacked` | `"/pdfjs/cmaps/"`, `true` | Fuentes CID con CMap predefinido. Sin esto también se degrada la **extracción** de texto, no solo el dibujo. |
| `standardFontDataUrl` | `"/pdfjs/standard_fonts/"` | Fuentes no embebidas (standard-14 y sustituciones). |

Y **factories propias** para `CMapReaderFactory`/`StandardFontDataFactory`, inyectadas por `getDocument`: las `DOM*` de pdf.js tocan `document.baseURI` en su primer fetch, así que servir los assets no alcanza si quien los pide no puede pedirlos. El contrato de esas factories y las rutas de los assets están en ADR-053 §2/§4.

### 7.1 PdfWorker

**Responsabilidad**: parsear páginas de un PDF con PDF.js, extraer `Word[]` con `BoundingBox`, identificar páginas sin texto.

**Ciclo de vida**:
- `INIT`: carga `pdfjs-dist` y su wasm. Publica `READY` con `{ workerId, capabilities: { maxPageBatchSize: 8 } }`.
- `RUN(pdf-parse)`: recibe `{ documentId, buffer, password?, pageRange }`. Transfiere `buffer`. Procesa páginas en lotes. Emite `PROGRESS` por página. Responde `COMPLETED` con `{ pages: Page[], textlessPages: number[] }`. Su `getDocument()` sigue la regla transversal de §7 **sin** `disableFontFace`: esta ruta no rasteriza, así que el registro del `@font-face` le es indiferente; sí lleva `cMapUrl`/`cMapPacked`/`standardFontDataUrl` y las factories propias, porque sin CMaps un PDF con CID predefinido se **extrae** mal y eso degrada la detección de entidades aguas abajo (ADR-053 §5).
- `CANCEL`: checkpoint entre páginas.
- `DISPOSE`: libera `pdfjs-dist` worker interno y memoria.

**Memoria típica**: 20–80 MB por PDF activo (depende de tamaño).
**Estado entre jobs**: reutiliza el `PDFDocumentProxy` solo si el `documentId` coincide; si no, lo cierra y abre uno nuevo.

### 7.2 OcrWorker

**Responsabilidad**: ejecutar Tesseract.js sobre la imagen rasterizada de una página sin texto.

**Ciclo de vida** (el OcrWorker es un **kernel de reconocimiento sin estado por documento**, ADR-045 §1: la clase `OcrEngine` — loop por página, retry/timeout, eventos, depósito en `ctx.cache` — vive entera host-side y le despacha por su puerto interno con `maxRetriesOverride: 0`; el único estado del kernel es la instancia tesseract con su set de idiomas):
- `INIT`: carga `tesseract.js` y descarga/initializa el modelo `spa+eng` (default). Publica `READY` con `{ workerId, languages: ["spa","eng"], modelVersion }`.
- `RUN(ocr-page)`: recibe `OcrPagePayload { documentId, pageIndex, imageData, dpi, languages }` (`03_Data_Model.md` §18; `imageData` transferida, §2.3). Si `languages` difiere del set cargado, re-crea la instancia tesseract (cubre `reanalyze` con `ocr.languages`, ADR-038 §5.3). Reconoce. Emite `PROGRESS` (opcional). Responde `COMPLETED` con `{ words: Word[], confidence }` — **sin** emitir eventos de dominio ni tocar cache: `OCR_PAGE_FINISHED` y el depósito de las `Word[]` los hace el motor en el host al resolver el job, en ese orden (ADR-014 §1, ADR-045 §4).
- `CANCEL`: checkpoint entre líneas de texto reconocidas (Tesseract expone callback de progreso).
- `DISPOSE`: libera Tesseract worker y memoria temporal.

**Memoria típica**: 150–300 MB por worker (el modelo cargado pesa).
**Modelo**: cacheado en IndexedDB tras primera descarga. No se descarga entre jobs.

### 7.3 NerWorker

**Responsabilidad**: ejecutar el modelo NER local (Transformers.js + ONNX Runtime Web) sobre el texto de una página y devolver `Occurrence[]` con `source: "ner"`.

**Ciclo de vida** (el NerWorker es un **kernel de inferencia sin estado por documento**, ADR-046 §1: la clase `NerEngine` —loop por página, partición en batches, retry/timeout, mapeo de spans a `Occurrence` con bbox y los seis eventos— vive entera host-side y le despacha por su puerto interno con `maxRetriesOverride: 0`; el único estado del kernel es el pipeline de `@huggingface/transformers` cargado para un `(modelId, dtype)` dado):
- `INIT`: publica `READY` con `{ workerId, capabilities }`. **No** carga el modelo: la carga es perezosa, en el primer `RUN` (§8; lazy loading del spec §2), con la política de dos intentos de `NER_Engine.md` §11/§13 caso 8.
- `RUN(ner-page)`: recibe `NerPagePayload { documentId, pageIndex, text, modelId, quantization, wasmPaths? }` (`03_Data_Model.md` §18), donde `text` es el texto de **un batch** de `NerConfig.batchSize` palabras — la partición la hace el motor host-side, que es quien tiene las `Word[]` (ADR-046 §3). Configura el entorno de Transformers.js contra el origen propio (`wasmPaths` del payload, ADR-039/ADR-046 §5), tokeniza, infiere y agrega los tokens BIO. Responde `COMPLETED` con `{ spans: NerKernelSpan[] }` — offsets relativos al texto del batch, **sin** `bbox` ni ids: el mapeo a `Occurrence` y la emisión de `ENTITY_FOUND`/`NER_PAGE_FINISHED` los hace el motor en el host.
- `PROGRESS`: ciclo de vida del modelo, con `NerKernelProgress` en `partial` (`model-loading` con `progress ∈ [0,1]`, `model-ready`, `model-load-retry`). Es el **único** canal por el que el worker reporta algo observable; el motor lo traduce a `NER_MODEL_LOADING`/`NER_MODEL_READY` (dedup a uno por instancia) y a `logger.warn`. Sin eventos de dominio ni bus puente desde acá.
- `CANCEL`: aborta el batch en vuelo (checkpoint en el borde de la llamada a la librería); el checkpoint *entre* batches es host-side, en el loop del motor.
- `DISPOSE`: libera sesión de ONNX y memoria. El modelo cacheado en Cache Storage no se borra (una recarga posterior no vuelve a descargar).

**Memoria típica**: 200–400 MB por worker (modelo + sesión de inferencia).
**Modelo**: cacheado en Cache Storage del navegador. Lazy-loaded solo cuando se necesita NER; cada worker carga su propia instancia (el `model-ready` del segundo worker no produce un `NER_MODEL_READY` nuevo — `NER_Engine.md` §13 caso 17).
**Dueño de la pool**: el propio `ner-engine` (ADR-046 §2/§7) — el `NerPool` lo construye el façade en `create-core.ts` y se inyecta al motor por constructor, como ya ocurre con `RenderPool` y `OcrPool`; el Orchestrator no lo envuelve.

### 7.4 RenderWorker

**Responsabilidad**: renderizar una página (original o anonimizada) a `ImageData` o `Blob` PNG/JPEG usando OffscreenCanvas + pdfjs-dist (fe de erratas ADR-030 §5: decía pdf-lib, que es del ExportWorker y está prohibido en Render — `Render_Engine.md` §5). Produce highlight de grupos habilitados.

**Ciclo de vida** (el RenderWorker es un **kernel sin estado por documento** salvo los `PDFDocumentProxy`; todo el estado del motor — cache, overrides, supersede, suscripciones — vive en la clase `RenderEngine` host-side, ADR-043 §1):
- `INIT`: crea OffscreenCanvas. Publica `READY`.
- `load-document`: mensaje de **control broadcast** (no es un `WorkerJobType` encolable — un job iría a un solo worker idle y los demás quedarían sin documento; ADR-036 §4): el host lo envía a **cada** worker del pool con `LoadDocumentPayload { documentId, buffer, password? }` (buffer **clonado** por worker, ver §2.3). Crea el `PDFDocumentProxy` interno con pdfjs-dist, `getDocument({ data, password, ...opciones de la regla transversal de §7 })` (ADR-030; `password` por ADR-050; fuentes, CMaps y factories propias por ADR-053 — este kernel **sí** lleva `disableFontFace: true`, porque rasteriza). Responde `COMPLETED` con `{ pageCount }` (el host lo retiene junto al buffer — ADR-043 §3). **El worker no retiene el `password`**: lo usa para abrir el proxy y lo descarta de su scope (`08_Security_Model.md` §6.1.4). El que sí lo retiene es el host, junto al buffer, para el re-priming de §7.4/ADR-043 §5 — sin eso, un worker reemplazado tras crash no podría recargar un documento protegido.
- `unload-document`: control broadcast simétrico (`UnloadDocumentPayload { documentId }`, ADR-043 §4): libera el `PDFDocumentProxy` de ese documento en cada worker a mitad de sesión (`DOCUMENT_CLOSED`). Idempotente. Responde `COMPLETED`.
- `RUN(render-page)`: recibe `RenderPagePayload` (`03_Data_Model.md` §18) **o** `RasterizePagePayload { documentId, pageIndex, scale, region? }` (rasterización para OCR, sin eventos de preview — ADR-034 §1/ADR-036 §4; `region` opcional en puntos de página desde ADR-065 §5 — ausente es la página entera, y **no altera la discriminación por forma**, que sigue siendo `"pageIndex" in payload`) **o** `RenderLegendPayload { rows, pageWidthPt, pageHeightPt }` (página de leyenda del export — ADR-059 §5). Precondición: documento cargado vía `load-document` (ADR-030) — **salvo `RenderLegendPayload`, que es la única excepción**: no corresponde a ninguna página de ningún PDF, es un dibujo puro sobre un canvas en blanco y no toca pdfjs. Responde `COMPLETED` con `{ imageData: ImageData }` (transferido) y, en `mode: "full"`, `encoded` (`EncodedPageImage`, ADR-034 §3); la leyenda responde directamente con `encoded`.
- `CANCEL`: checkpoint entre operaciones de Canvas.
- `DISPOSE`: libera OffscreenCanvas y destruye los `PDFDocumentProxy` cargados.

**Wire shape de los controles (ADR-043 §4)**: `load-document`/`unload-document` viajan como `RUN` con `jobType: "render-page"` enviado **directo a cada worker, sin cola** (por eso tienen `jobId` y responden `COMPLETED`; `WorkerInbound` no cambia). El entry-point discrimina el payload por forma, en este orden: `"buffer" in payload` → load; `"rows" in payload` → legend (ADR-059 §5, quinto caso); `"kind" in payload` → render; `"pageIndex" in payload` → rasterize; si no → unload. El caso `legend` va temprano y es inequívoco: es el único payload de `render-page` **sin `documentId`**, así que no puede colisionar con ninguno de los otros cuatro. `WorkerPool` expone la operación genérica `broadcast(payload)` para estos envíos (in-process: una sola invocación del kernel local). "Sin cola" implica además que **no consumen un slot de concurrencia**: apuntan a workers que ya existen, no piden uno libre, así que no cuentan contra el gate `active < size` del pool (contarlos hacía que un `render-page` concurrente con un re-priming muriera con el error de invariante de slots, sin reintento). Simétricamente, un job encolado no se entrega a su worker mientras haya un control de estos en vuelo: mutan el estado por documento del worker (`load-document` recrea el `PDFDocumentProxy`), y un `render-page` entregado en el medio trabaja contra un proxy que se está destruyendo.

**Re-priming (ADR-043 §5)**: un worker nuevo o reemplazado tras crash (§9) recibe `INIT` + `load-document` de todos los documentos vigentes (buffers retenidos por el host) **antes** de aceptar jobs `render-page`.

**Memoria típica**: 40–120 MB por worker.

### 7.5 ExportWorker

**Responsabilidad**: construir el PDF final con pdf-lib, página por página, a partir de las `EncodedPageImage` producidas por el `RenderPageProvider` (ADR-032/ADR-034 §3). Es un **worker único dedicado, sin pool** (ADR-036 §1): lo posee el lado host de `export-engine`; `ExportEngine.export()` sigue en host (dirige el loop y emite `EXPORT_*` — ADR-013 §6) y solo la frontera pdf-lib cruza al worker.

**Ciclo de vida** (el ExportWorker es un **ensamblador con estado de un documento a la vez**, ADR-047 §1 — **no** un kernel sin estado como §7.2/§7.3/§7.4: retiene el `PDFDocument` en construcción porque pdf-lib ensambla incrementalmente y no es thread-safe. El resto de `ExportEngine` —validación, loop, `RenderPageProvider`, retry/timeout, los cuatro eventos, sanitización y blob URL— vive host-side):
- `INIT`: publica `READY`. El `PDFDocument` se crea perezosamente al primer `append-page`.
- `RUN(export-page)` con `ExportPagePayload { documentId, pageIndex, pageImage, imageFormat, pageWidthPt, pageHeightPt }` (`03_Data_Model.md` §18; `pageImage` transferido) → **`append-page`**: `embedJpg`/`embedPng` según `imageFormat`, `addPage([pageWidthPt, pageHeightPt])`, `drawImage`. Responde `COMPLETED`. **Idempotente por `pageIndex`** (ADR-047 §4): un índice ya adjuntado responde `COMPLETED` sin volver a adjuntar — hace seguro el reintento del host cuando un mensaje se completó del otro lado pero el host lo dio por perdido (sin esto, el PDF final tendría páginas duplicadas y ningún error visible). Un `documentId` distinto del retenido descarta el parcial y arranca un documento nuevo.
- `RUN(export-page)` con `ExportSavePayload { documentId, metadata }` → **`save`**: aplica la metadata (ya sanitizada en host), serializa y responde `COMPLETED` con el `ArrayBuffer` final **transferido** (errata corregida por ADR-036 §4: la serialización era un efecto de `DISPOSE`, que no tiene mensaje de respuesta en `WorkerOutbound`). Tras un `save` exitoso el worker limpia su estado.
- Discriminación por forma en el entry-point (ADR-047 §3, mismo criterio que §7.4): `"pageImage" in payload` → append; si no → save.
- `CANCEL`: checkpoint entre páginas; el `PDFDocument` parcial se descarta.
- `DISPOSE`: libera el documento y memoria (sin respuesta con datos).

**Memoria típica**: 60–200 MB dependiendo del tamaño final.
**Creación**: el `Worker` real lo crea perezosamente su pool en el primer despacho (= al primer `EXPORT_REQUESTED`, §8). La disposición tras 60 s idle sigue pendiente, como en render/ocr/ner (deuda común: los pools construidos por el façade no reciben `idleDisposeMs`).
**Transporte (ADR-047 §2)**: `WorkerPool` con `size: 1` construido por el façade en `create-core.ts` e inyectado al motor por constructor. Sigue **sin** ser un pool en el sentido de §1.1 — no hay quinta clave en `WorkerPoolConfig` ni cola prioritaria multi-worker (ADR-036 §1 se conserva en su sustancia); lo que se reusa es la mensajería (`jobId`, `CANCEL`, `FAILED`, crash, fallback in-process). `PoolKey` gana la etiqueta `"export"` solo como identificador interno; `WorkerPoolManager` mantiene su unión de cuatro (`ManagedPoolKey`).

---

## 8. Inicialización perezosa

Ningún pool se crea al cargar la app. Se crea bajo demanda:

- `PdfPool` se crea al primer `DOCUMENT_IMPORTED`.
- `OcrPool` se crea si `DOCUMENT_PARSED` indica `textlessPages.length > 0`.
- `NerPool` se crea si el usuario no desactivó NER en settings y hay texto para analizar.
- `RenderPool` se crea cuando hay al menos una página lista para preview.
- El **ExportWorker** (worker único de `export-engine`, sin pool — ADR-036 §1; la redacción anterior "`ExportPool`, alias de RenderPool con workers de tipo export" era errata: mezclaba tipos de worker contra §1.1) se crea al primer `EXPORT_REQUESTED`.

### 8.1 Liberación por inactividad (ADR-080)

Cada pool libera **sus workers** tras `idleDisposeMs` de inactividad (`WorkerPoolConfig`, default 60 s). El temporizador vive en el propio `WorkerPool` —no en `WorkerPoolManager`, que solo administra el pool de `pdf` desde ADR-043/045/046/047—, porque es el único que puede evaluar la condición.

**Ocioso** son las cuatro condiciones a la vez:

```
active === 0  &&  queue.length === 0  &&  pendingRemoteJobs.size === 0  &&  inFlightBroadcasts.size === 0
```

Las dos últimas no son redundantes: un job remoto puede estar en vuelo sin contar en `active` según el camino, y un `broadcast` de re-priming (§7.4, ADR-043 §5) **no pasa por la cola ni por `pump()`**, así que no aparece en ninguna de las dos primeras. Sin ellas, un idle-dispose podría caer sobre un re-priming en curso.

El temporizador se **rearma al quedar ocioso** (no al acceder al pool) y se **cancela al entrar un job**: un job de diez minutos no dispara la liberación a los sesenta segundos.

**`releaseIdleWorkers()` no es `dispose()`**: termina los `WorkerLike` vivos y limpia `remoteWorkers`, pero el pool **sigue usable** — el próximo `dispatch` reconstruye el worker por el camino perezoso de arriba y, si el pool tiene `onWorkerCreated`, lo re-primea antes del primer job. `dispose()` sigue siendo terminal. `idleDisposeMs: 0` desactiva el mecanismo (lo usan los tests, que no pueden depender de temporizadores reales).

> La redacción anterior era *"cada pool puede destruirse tras `DOCUMENT_CLOSED` + idle > 60 s"*. El `DOCUMENT_CLOSED` se retira a propósito: el pool es infraestructura y **no escucha el bus**. La condición de arriba es más general y lo cubre — cerrar un documento deja de generar jobs, así que el pool cae en ocioso solo. Y cubre además el caso que la redacción vieja dejaba afuera: un documento abierto y quieto veinte minutos.

---

## 9. Manejo de errores de Worker

| Situación | Acción |
|---|---|
| Worker crashea (uncaught error) | Pool lo marca como dead, lo reemplaza, y **rechaza sus jobs en vuelo con `WorkerCrashedError`** (`WORKER_CRASHED`, `retryable: true`, ADR-077) — o sea que se reintentan: en el pool si no hay `maxRetriesOverride: 0`, y en el loop del motor dueño si lo hay (ocr/ner/export, ADR-045/046/047). Hasta ADR-077 el rechazo era un `InvalidInputError` no-retryable y el job **se perdía en silencio**, contra lo que esta fila decía. |
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
