<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,architecture/03_Data_Model.md,adr/ADR-006-NER-Local.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md,adr/ADR-024-NerStarted-ModelLoading-BatchSize.md,adr/ADR-025-Migracion-Huggingface-Transformers.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md | audiencia=humanos+IA | fase=10 -->

# ADR-046 — NerEngine dueño de su pool: la clase queda host-side, el worker corre un kernel de inferencia sin estado (tercer espejo de ADR-043/045)

- **Estado**: Accepted
- **Fecha**: 2026-07-24
- **Decidido por**: El planificador, por encargo explícito del humano ("actualiza los docs para que este problema esté solucionado") sobre el informe de ambigüedad que el implementador levantó **antes de tocar código** al arrancar PR15 (`ai/AI_Development_Guide.md` §5). No reabre ninguna decisión de fondo: el patrón host-side + kernel puro ya lo decidió el humano en ADR-043 (render) y lo ratificó en ADR-045 (OCR, opción A del fork de PR14); este ADR lo aplica al tercer motor y resuelve lo que el patrón **no** cubría todavía — el ciclo de vida del modelo NER, que sí produce eventos observables desde dentro del worker.
- **Relacionado con**: ADR-043 (§1–§2: el patrón, primera desviación sancionada de ADR-036 §1), ADR-045 (§1–§4: el espejo más cercano — mismo puerto, mismo `maxRetriesOverride: 0`, misma normalización de timeout), ADR-041 (§5: la fila `ner-engine` "Libre" queda **matizada** acá, ver §9), ADR-036 (§1 "el entry-point corre el motor real" — **tercera excepción sancionada**; §2 `CoreRuntimeOptions`), ADR-035 (fallback in-process bit-idéntico), ADR-021 (§2 fuente única de timeout/retries; §5 mock de la frontera de la librería en tests), ADR-023/ADR-024/ADR-025 (modelo, `batchSize` en palabras, `@huggingface/transformers` v4), ADR-039 (`NerConfig.wasmPaths` — su requisito "debe viajar serializado al worker" se concreta acá, §5), ADR-038 (§8 tabla de PRs: PR15 = NerWorker)

## Contexto

El implementador exploró PR15 (NerWorker) y se detuvo con un informe de ambigüedad: `core/NER_Engine.md` v1.1.0 y `architecture/05_Worker_Architecture.md` §7.3 seguían describiendo el patrón previo a ADR-043/045 — el motor crea su propio `NerPool` en `init` (§15 item 5) y **emite `ENTITY_FOUND` por ocurrencia desde dentro del worker** (§7, §15 item 6) —, mientras que `render-engine` y `ocr-engine` ya migraron al reparto host-side + kernel. `ADR-041` §5 marca a `ner-engine` como "Libre", pero esa auditoría solo miraba **estado retenido por documento**; el fork que bloqueó PR13 y PR14 no es el estado por documento sino **el reparto de eventos y retry a través de la frontera**, y ese fork estaba intacto para NER.

Verificado contra el código (`packages/anonymization-core/ner-engine/src/ner.engine.ts`), el plan viejo llegaba a los mismos cuatro problemas de ADR-045, más uno propio:

1. **Doble canal para el mismo dato**: `processPage` emite `ENTITY_FOUND` por cada ocurrencia y `NER_PAGE_FINISHED` al terminar la página (`ner.engine.ts:461-470`), y además **devuelve** esas mismas ocurrencias en `NerPageOutput`. Con el motor corriendo dentro del worker, los eventos viajan por el puente `EVENT` y las ocurrencias por `COMPLETED`: dos mensajes sin orden garantizado entre sí, y el host-bridge no puede re-emitir sin arriesgar duplicados (emitiría lo que el puente ya emitió). Es la misma clase de falla que destapó PR14, con el agravante de que acá el consumidor real —`grouping-engine`— se alimenta **solo** del stream de eventos.
2. **Retry duplicado**: `processPage` ya tiene su loop de reintentos por página (`NerTimeoutError` × `maxRetries["ner-page"]`, `ner.engine.ts:452-479`); el pool tiene el suyo (`05_Worker_Architecture.md` §5). Compuestos: hasta `(maxRetries+1)²` inferencias por página.
3. **Ownership de eventos partido**: `NER_STARTED`/`NER_FINISHED` los emite `processPages`, `NER_PAGE_FINISHED`/`ENTITY_FOUND` los emite `processPage` y `NER_MODEL_LOADING`/`NER_MODEL_READY` los emite `ensureModelLoaded` — si el motor cruza entero, los seis salen del worker; si cruza por página, salen de los dos lados de la frontera. Ninguna de las dos variantes cumple ADR-013 §6 sin un puente que reintroduce el problema 1.
4. **Granularidad del job**: despachar `processPages` completo como un job `ner-page` (lo que hace hoy el Orchestrator, `orchestrator.ts:814`) contradice el propio contrato del job: `workerPool.timeouts["ner-page"]` (20 s) y `maxRetries["ner-page"]` están especificados **por página** (`NER_Engine.md` §11), no por documento; y deja el pipeline sin checkpoint de cancelación observable por el pool.
5. **Problema propio de NER, sin equivalente en OCR**: el modelo se carga *dentro* del worker (es el único lugar donde corre `pipeline()` de `@huggingface/transformers`), pero `NER_MODEL_LOADING` (progreso ∈ [0,1]) y `NER_MODEL_READY` son **eventos observables de dominio** que la UI usa para mostrar "Descargando modelo NER…" (§13 caso 7). Es decir: el patrón "el worker no emite eventos de dominio" (ADR-043/045) no alcanza tal cual — hace falta decidir por qué canal cruza ese progreso. Además, con `nerPoolSize` 1–2, "modelo listo" es un hecho **por worker**, mientras que `NER_MODEL_READY`/`isModelReady()` son per-instancia del motor: alguien tiene que deduplicar, y ese alguien solo puede ser el host.

## Decisión

### 1. Reparto: la clase `NerEngine` queda entera host-side; el worker corre un kernel de inferencia

La clase conserva **todo**: el loop secuencial por página de `processPages` (checkpoint de cancelación entre páginas, política de "página que falla se descarta y se continúa"), el retry/timeout por página de `processPage`, la partición en batches (`computeWordChunks`, ADR-024 §2), el mapeo de spans a `Occurrence` (bbox/`wordSpan` desde `Word[]`, ids), y la emisión de los **seis** eventos. El worker corre un **kernel de inferencia sin estado por documento**: recibe un `NerPagePayload`, tokeniza, infiere y agrega los tokens BIO en spans, y devuelve `{ spans }` por `COMPLETED`. Su único estado es el pipeline de `@huggingface/transformers` cargado para un `(modelId, dtype)` dado — más los archivos del modelo en Cache Storage, como hoy.

**Tercera desviación sancionada de ADR-036 §1** ("el entry-point corre el motor real"): para NER, "el motor real" del worker es el kernel. Precedentes: ADR-043 §1 (render), ADR-045 §1 (OCR).

La secuencia observable de una página queda como una sola ruta de código host-side: `spans del kernel` → `Occurrence[]` (bbox) → `ENTITY_FOUND × N` → `NER_PAGE_FINISHED`. El problema 1 del Contexto deja de existir por construcción, no por parche, y `grouping-engine` sigue recibiendo exactamente el mismo stream que hoy.

### 2. Puerto interno `NerJobPool` con constructor opcional (espejo exacto de `OcrJobPool`)

`new NerEngine(pool?)`: el façade inyecta el `NerPool` real en `create-core.ts` (mismo wiring que `new OcrEngine(ocrPool)` / `new RenderEngine(renderPool)`); sin argumento, un fallback inmediato invoca el kernel in-process — bit-idéntico ADR-035, y lo que los tests existentes del motor ya esperan. Lo único que cruza el puerto es la inferencia:

```ts
this.pool.dispatch({
  jobType: "ner-page",
  payload /* NerPagePayload */,
  run: () => kernelClassify(payload, { timeoutMs, abortSignal, onProgress }),
  signal,
  priority: 80,
  maxRetriesOverride: 0,
  onProgress,
})
```

- **`maxRetriesOverride: 0`**: el pool no reintenta; el único loop de retry es el del motor, que preserva la política de §11 (`NerTimeoutError` reintenta; el resto corta y la página se descarta con `NerPageFailedError`).
- **Normalización en el borde del puerto** (espejo de `normalizeTimeout` de ADR-045 §2, con **dos** códigos en vez de uno): un error que cruzó un worker remoto llega deserializado (`EngineError.deserialize`, `Contracts.md` §4) como instancia genérica con el `code` correcto, que **no** es `instanceof NerTimeoutError` ni `instanceof NerModelMissingError`. Como el motor bifurca por esas dos clases (`NER_TIMEOUT` → reintentar; `NER_MODEL_MISSING` → abortar NER sin envolver en `NerPageFailedError`), ambas se re-instancian por `code` antes del chequeo. Sin esto, la política de reintentos y la de aborto cambiarían de forma según haya pool real o fallback.
- **`priority: 80`**: el valor que el Orchestrator usaba al despachar la etapa (`orchestrator.ts`), preservado tal cual como constante del motor al mover el despacho (mismo criterio que ADR-045 con el 90 de OCR).

### 3. Granularidad: un despacho por **batch**; la partición queda host-side

`NerPagePayload.text` transporta el texto de **un batch** (no el de la página entera). Motivo: la partición se define en **palabras** (ADR-024 §2, `NerConfig.batchSize`) y se calcula desde `Word[]`, que el motor ya tiene en `NerPageInput.words` y necesita igual para el bbox; mandar las `Word[]` al worker solo para que re-derive los offsets duplicaría a ambos lados de la frontera la regla de reconstrucción de `Page.text` (`03_Data_Model.md` §4). Con esto, el checkpoint de cancelación "entre batches de inferencia" (§12 del spec) se queda donde siempre estuvo —el loop host-side— y se suma el `CANCEL` del protocolo para el batch en vuelo. `documentId`/`pageIndex` siguen en el payload para correlación y telemetría.

Cantidad de despachos por página: `ceil(words / batchSize)` — típicamente 1–3 con el default de 256 palabras. El costo de mensajería (un `postMessage` con un slice de texto) es despreciable frente a los 5–15 s de inferencia por página (§12).

### 4. El ciclo de vida del modelo cruza por el canal `PROGRESS` del transporte, no por eventos de dominio

El kernel carga el modelo de forma perezosa en su primer job, con la política de dos intentos ya especificada (§11 `NER_MODEL_LOAD_FAILED` → "re-descargar una vez"; §13 caso 8). Reporta el ciclo de vida con el mensaje **`PROGRESS`** que `WorkerOutbound` ya define (`05_Worker_Architecture.md` §2.2), usando su campo `partial` (`Serializable`) para la fase:

```ts
export type NerKernelProgress =
  | { readonly phase: "model-loading"; readonly modelId: string }   // progress ∈ [0,1] en PROGRESS.progress
  | { readonly phase: "model-ready"; readonly modelId: string }
  | { readonly phase: "model-load-retry"; readonly modelId: string; readonly reason: string };
```

- **`WorkerPool` gana `DispatchParams.onProgress?: (progress: number, partial?: Serializable) => void`**: `handleWorkerMessage` deja de descartar los `PROGRESS` (hoy: `if (READY || PROGRESS) return`) y los enruta al `onProgress` del job pendiente correspondiente, por `jobId`. Reabre `worker-pool.ts` (PR11) con una costura genérica —**tercera costura ajena sancionada del Hito**, precedente ADR-043 §4 (`broadcast`)— útil para cualquier motor que necesite progreso granular (§2.2 ya anticipaba "el progreso granular hacia `PIPELINE_PROGRESS` queda para el host-bridge"). En modo in-process el motor pasa el mismo callback directo al kernel: comportamiento observable idéntico (ADR-035).
- **La traducción a eventos de dominio la hace el motor, en host**: `model-loading` → `NER_MODEL_LOADING { modelId, progress }`; `model-ready` → `NER_MODEL_READY { modelId }` **una sola vez por instancia** (deduplicado host-side: con 2 workers, el segundo carga su propio modelo y reportaría un segundo `model-ready` que no es un cambio de estado observable); `model-load-retry` → `ctx.logger.warn` con el mensaje de `NerModelLoadFailedError` — preserva el diagnóstico actual sin necesitar un puente `LOG` en el worker.
- **Fallo definitivo**: agotados los intentos, el kernel lanza `NerModelMissingError`; cruza como `FAILED`, el motor lo re-instancia por `code` (§2) y lo propaga tal cual — aborta NER sin envolverlo en `NerPageFailedError`, exactamente como hoy (`ensureModelLoaded` corre fuera del loop de retry).
- **`isModelReady()` y `NerStarted.modelLoading`** pasan a leer un flag host-side de la instancia (`modelWarm`, seteado en el primer `model-ready`), en vez de `this.classifier !== null`: misma semántica per-instancia que hoy, válida en ambos modos. Espejo literal de ADR-045 §4. `getModelId()` no cambia (siempre salió de la config, no del clasificador).

**Por qué no el puente `EVENT`**: emitir `NER_MODEL_LOADING`/`NER_MODEL_READY` como eventos de dominio desde el worker reintroduce el problema 1 justo en los dos eventos que el contrato obliga a ordenar contra los datos (`emits NER_MODEL_READY before first ENTITY_FOUND`, §14), y contradice ADR-013 §6. `PROGRESS` viaja por el mismo canal `postMessage` que el `COMPLETED` del mismo job, así que su orden relativo **sí** está garantizado, y no es un evento observable: es telemetría de transporte que el host traduce.

### 5. `configureTransformersEnv` corre en el kernel; `wasmPaths` viaja en el payload

`env.allowRemoteModels = false`, `env.allowLocalModels = true`, `env.localModelPath` y `env.backends.onnx.wasm.wasmPaths` se configuran donde se carga el modelo: el kernel. `NerPagePayload` gana `quantization` y `wasmPaths?` para transportar lo que ADR-039 definió como config inyectada por la app. Esto **concreta** el requisito que ADR-039 había dejado escrito contra `INIT` ("debe viajar serializado al worker"): `WorkerPool` todavía no transporta `INIT` con la config real —gap conocido y compartido con Pdf/Render/Ocr—, y hacerlo viajar en el propio job lo resuelve sin depender de ese gap. La semántica de ADR-039 no cambia: presente → se asigna **tal cual**, ausente → default `/wasm/onnxruntime/`. El caso límite 16 del spec sigue valiendo; lo que cambia es dónde se verifica (kernel, no motor).

### 6. Eventos y semántica pública intactos

Los seis eventos conservan payload, canal (`EventChannel.Ner`) y orden: `NER_STARTED` (con `modelLoading?` de ADR-024) → `NER_MODEL_LOADING*` → `NER_MODEL_READY` → por página (`ENTITY_FOUND × N` → `NER_PAGE_FINISHED`) → `NER_FINISHED`. Todos emitidos en host (ADR-013 §6 se cumple naturalmente, sin puente). El contrato de `NerPageOutput` no cambia. `grouping-engine` y el Orchestrator no se enteran del cambio.

### 7. Wiring del façade y del Orchestrator

`create-core.ts` construye el `NerPool` (espejo campo por campo de `ocrPool`: `poolKey: "ner"`, `jobType: "ner-page"`, `nerPoolSize`, `maxQueuePerPool.ner`, `maxRetries["ner-page"]`, `workerFactory` de `runtime.workers.ner`) **sin** `onWorkerCreated` —`ner-engine` no retiene estado por documento que re-primear (ADR-041 §5)— y lo inyecta: `new NerEngine(nerPool)`. `dispose()` del façade dispone también `nerPool`.

El Orchestrator **deja de envolver** `processPages` en `pools.getPool("ner").dispatch({ run })` en sus **dos** call sites (`runDetectionStage` y `runReanalyzeNerOnFlow`, ADR-038 §5.1) e invoca el método del motor directo, igual que ya hace con OCR (ADR-045 §2) y render (ADR-043 §2). `poolWorkerFactories.ner` queda como dead code inofensivo, mismo tratamiento que `ocr` y `render` (limpieza conjunta de las tres, candidata a un PR futuro).

### 8. Qué no cambia

La interfaz pública de `NER_Engine.md` §6 (solo se agrega el constructor opcional, igual que Ocr/Render); `NerConfig`/`NerPageInput`/`NerPageOutput`; `IEngine`; el loop secuencial por página (el despacho paralelo de páginas dentro del motor queda como mejora futura, no requisito — misma decisión que ADR-045 §5); la política de timeout/retry por página y su fuente única (`workerPool.timeouts/maxRetries["ner-page"]`, ADR-021 §2); el cache del modelo en Cache Storage y su no-descarte en cancelación (§13 caso 10); `WorkerJobType`/`WorkerInbound`/`WorkerOutbound` (ninguna variante nueva: `PROGRESS` ya existía); los tamaños de pool.

### 9. Errata de ADR-041 §5 para la fila `ner-engine`

La fila decía "Ninguno por documento… **Libre**", y es correcta *en lo que audita* (estado retenido por documento). Se aclara: esa auditoría **no** cubre el reparto de eventos/retry a través de la frontera, que es lo que bloqueó PR13 y PR14 y lo que este ADR resuelve para PR15. Con ADR-046, los tres motores pesados del Hito 10 comparten un único patrón; la fila de `export-engine` (PR16) queda igualmente pendiente de esa segunda lectura — pero su caso ya está decidido por ADR-036 §1 (worker único, propiedad del lado host, `ExportEngine.export()` sigue en host).

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Motor completo en el worker** (ADR-036 §1 literal, plan del spec v1.1.0) | Deja los cinco problemas del Contexto sin resolver: `ENTITY_FOUND` × ocurrencia y las mismas ocurrencias en `COMPLETED` por dos canales sin orden garantizado; retry motor × pool; los seis eventos emitidos del lado equivocado de la frontera; y el timeout/retry `ner-page` deja de ser por página. Precedente directo en contra: la carrera que destapó PR14. |
| **Despacho por página con la partición en el worker** | El kernel tendría que re-derivar los batches: o recibe `Word[]` (payload mucho más pesado, y las palabras solo se usan para el bbox, que es host-side) o re-implementa la regla `Page.text = words.join(" ")` — duplicando a ambos lados de la frontera una invariante de `03_Data_Model.md` §4 y la semántica de `batchSize` en palabras de ADR-024 §2. Mueve el checkpoint de cancelación al worker sin ganancia: la inferencia WASM no es preemptable en ninguno de los dos lados. |
| **`NER_MODEL_LOADING`/`NER_MODEL_READY` por el puente `EVENT`** | Reintroduce el doble canal exactamente en los eventos que el contrato obliga a ordenar contra los datos (§14: `NER_MODEL_READY` antes del primer `ENTITY_FOUND`) y contradice ADR-013 §6; además obligaría igual a deduplicar host-side el `READY` de cada worker. |
| **Renunciar al progreso de carga** (emitir `NER_MODEL_READY` con el primer `COMPLETED`, sin `NER_MODEL_LOADING`) | Barato, pero la UI pierde el progreso de una descarga de ~150–180 MB (§13 caso 7, `NerModelLoading.progress` es contrato publicado): degradación visible del producto para ahorrar una costura de 10 líneas en `worker-pool.ts`. |
| **Mantener el `NerPool` en `WorkerPoolManager`** (el motor recibiría solo un despachador) | El Orchestrator seguiría siendo quien despacha, así que o envuelve `processPages` entero (problema 4) o pasa a orquestar batches — conocimiento interno del motor filtrado al Orchestrator. Los tres motores con pool propio ya establecieron el reparto contrario. |

## Consecuencias

**Positivas**: los cinco problemas se resuelven con un patrón ya probado dos veces en el repo (cero mecanismos nuevos, salvo el `onProgress` genérico); el orden contractual `NER_MODEL_READY` → `ENTITY_FOUND` → `NER_PAGE_FINISHED` → `NER_FINISHED` queda garantizado por una única ruta host-side; el timeout/retry `ner-page` recupera su granularidad por página especificada; ADR-039 (`wasmPaths`) obtiene por fin un transporte real al worker, sin depender del gap de `INIT`; el fallback in-process queda bit-idéntico sin código condicional en el motor; `grouping-engine` no cambia en nada.

**Negativas**: se reabre `worker-pool.ts` por tercera vez en el Hito (`onProgress`), fuera del paquete del PR — sancionado acá, con el mismo criterio que `broadcast` en ADR-043; `ner.engine.ts` se parte (inferencia + agregación BIO + `configureTransformersEnv` se extraen a `worker/kernel.ts`), diff mayor que el que habría producido la opción "motor entero al worker"; la traducción `PROGRESS` → eventos de dominio agrega una indirección que solo NER usa por ahora.

**Neutras**: memoria por worker igual (200–400 MB, §12); el `NerPool` pasa de creación perezosa + idle-dispose de `WorkerPoolManager` a un objeto construido en `createCore`, exactamente como ya ocurrió con `RenderPool` y `OcrPool` (deuda común a los tres; el costo real es el objeto de cola, porque los `Worker` de SO se siguen creando perezosamente en el primer despacho); el handshake `INIT`/`READY` conserva el mismo gap conocido que Pdf/Render/Ocr (el pool no envía `INIT`; el kernel se auto-inicializa con defaults) — no se resuelve acá, mismo criterio que PR12/PR13/PR14.

## Docs actualizados por este ADR

- `core/NER_Engine.md` v1.2.0: nota de cabecera, §2, §6 (constructor `pool?` + semántica del despacho), §7 (dónde se emite cada evento), §11, §12, §13 (casos 16–18), §14 (tests nuevos), §15 (items 20–24 de PR15).
- `architecture/05_Worker_Architecture.md`: §7.3 reescrito como kernel, nota de excepciones de §1 (tercera), §2.2 (enrutamiento de `PROGRESS` vía `onProgress`).
- `architecture/03_Data_Model.md` §18: `NerPagePayload` (batch, `quantization`, `wasmPaths?`) + `NerKernelSpan`/`NerKernelProgress` como formas de wire.
- `adr/ADR-041` §5: matiz de la fila `ner-engine` (ver §9) y nota en Estado.
- `roadmap/MVP.md` (Hito 10) y `roadmap/Hito10_Observaciones_Revision.md`: entrada PR15 + tarea de seguimiento resuelta.

## Validación

- **Unit del kernel**: `kernelClassify` devuelve los mismos spans que el camino in-process sobre una fixture compartida; reporta `model-loading` con `progress ∈ [0,1]`, luego `model-ready`; tras dos fallos de `pipeline()` lanza `NerModelMissingError` habiendo reportado `model-load-retry`; `wasmPaths` del payload se asigna tal cual y el default se aplica cuando está ausente (caso 16).
- **Unit del entry-point**: `RUN` con `jobType ≠ "ner-page"` responde `FAILED`; `CANCEL` por `signalId` aborta el batch en vuelo y responde `CANCELLED`.
- **Contract del motor**: firma de §6 sin cambios; los seis eventos, sus payloads y su orden son idénticos con y sin pool inyectado (fallback ADR-035); todo despacho lleva `maxRetriesOverride: 0`; `NER_MODEL_READY` se emite una sola vez por instancia aunque lleguen varios `model-ready`.
- **Unit de normalización**: un `NER_TIMEOUT` deserializado (remoto) se reintenta como lo hace el local; un `NER_MODEL_MISSING` deserializado aborta `processPages` sin emitir `NER_PAGE_FINISHED` ni envolverse en `NerPageFailedError`.
- **Unit de `worker-pool.ts`**: un `PROGRESS` con `jobId` de un job pendiente llega a su `onProgress`; uno de un job ya resuelto se descarta sin lanzar.
- **Integration/E2E de PR15**: pipeline real con NerWorker; `NER_MODEL_LOADING` observable en la UI durante la primera carga; ocurrencias NER idénticas a las del modo in-process sobre la fixture de referencia; gates completos verdes al cierre.

## Referencias

- `core/NER_Engine.md` §6–§7, §11–§15 — `architecture/05_Worker_Architecture.md` §2.2, §5, §7.3 — `architecture/03_Data_Model.md` §18
- `adr/ADR-013` §6 — `adr/ADR-021` §2/§5 — `adr/ADR-023` — `adr/ADR-024` §2 — `adr/ADR-025` — `adr/ADR-035` — `adr/ADR-036` §1/§2 — `adr/ADR-039` — `adr/ADR-041` §5 — `adr/ADR-043` §1–§2 — `adr/ADR-045` §1–§4
- `packages/anonymization-core/ner-engine/src/ner.engine.ts` (loop de retry, batches, emisión por ocurrencia, `ensureModelLoaded`) — `packages/anonymization-core/ocr-engine/src/{ocr.engine.ts,worker/kernel.ts,worker/entry.ts}` (el espejo a copiar) — `packages/anonymization-core/src/worker-pool.ts` (`maxRetriesOverride`, `handleWorkerMessage`) — `packages/anonymization-core/src/create-core.ts` (wiring de `ocrPool`/`renderPool`) — `packages/anonymization-core/src/orchestrator.ts` (`runDetectionStage`, `runReanalyzeNerOnFlow`)
