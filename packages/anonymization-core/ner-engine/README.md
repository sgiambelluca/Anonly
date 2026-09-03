# @anonly/ner-engine

Detecta personas, organizaciones, direcciones y fechas mediante un modelo NER local (`Xenova/bert-base-multilingual-cased-ner-hrl`, Transformers.js + ONNX Runtime Web, cuantizado Q8). Emite `Occurrence[]` con `source: "ner"` y `entityType ∈ {Person, Organization, Address, Date}`.

## Ejecución

Corre en un **Web Worker real** (`NerWorker`), sobre el pool `ner`. Lo que cruza es un **kernel de inferencia sin estado por documento**: la clase `NerEngine` queda host-side (loop por página, partición en batches, retry/timeout, mapeo de spans a `Occurrence` con bbox, emisión de los seis eventos) y despacha la inferencia **por batch** contra su puerto interno `NerJobPool`.

**Las páginas se recorren de forma secuencial, a propósito**: el kernel retiene el modelo por `(modelId, dtype)` y lo reutiliza entre páginas, así que la carga —el costo dominante— se paga una sola vez. `nerPoolSize` es 2 por defecto (1 en equipos chicos), pero el motor no lo usa para poner dos páginas en vuelo.

Sin factory de worker inyectada, el mismo kernel corre in-process con resultado bit-idéntico (ADR-035): así corren los tests.

El protocolo es `RUN(ner-page)` → `COMPLETED { spans }`, **sin bus ni cache puente** para eventos de dominio. La única excepción es el ciclo de vida del modelo —lo único observable desde adentro del worker—: cruza por `PROGRESS` y el motor lo traduce host-side a `NER_MODEL_LOADING`/`NER_MODEL_READY`, deduplicado por instancia (ADR-046).

## Documentación

- **Spec canónico**: [`docs/core/NER_Engine.md`](../../../docs/core/NER_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §5
- Workers: [`docs/architecture/05_Worker_Architecture.md`](../../../docs/architecture/05_Worker_Architecture.md) §7.3 (NerWorker, kernel) y §2.2 (enrutamiento de `PROGRESS`)
- ADRs relevantes: [`ADR-006`](../../../docs/adr/ADR-006-NER-Local.md) (Transformers.js + ONNX), [`ADR-018`](../../../docs/adr/ADR-018-First-Party-Assets.md) (assets first-party), [`ADR-021`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) (inline hasta Hito 9), [`ADR-023`](../../../docs/adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md) (`NerConfig` canónico + modelo multilingüe), [`ADR-024`](../../../docs/adr/ADR-024-NerStarted-ModelLoading-BatchSize.md) (`NerStarted.modelLoading`, `batchSize` en palabras), [`ADR-025`](../../../docs/adr/ADR-025-Migracion-Huggingface-Transformers.md) (migración a `@huggingface/transformers` v4), [`ADR-039`](../../../docs/adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md) (`wasmPaths`), [`ADR-046`](../../../docs/adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md) (reparto host/worker, puerto `NerJobPool`, kernel puro)

## Contenido

- `ner.types.ts` — `NerPageInput`, `NerPageOutput` (`NerConfig` viene de `@anonly/shared`, ADR-023).
- `ner.errors.ts` — `NerModelMissingError`, `NerModelLoadFailedError`, `NerPageFailedError`, `NerTimeoutError`.
- `ner.engine.ts` — clase `NerEngine` (implementa `IEngine`): `init`, `processPage`, `processPages`, `isModelReady`, `getModelId`, `dispose`; puerto interno `NerJobPool` (constructor `pool?`, ADR-046 §2).
- `worker/kernel.ts` — kernel de inferencia sin estado por documento (setup first-party de Transformers.js, carga perezosa con dos intentos, timeout/abort racing, tokenización/agregación BIO, ADR-046 §1/§4/§5); lo invocan tanto el fallback in-process de `ner.engine.ts` como `worker/entry.ts`.
- `worker/entry.ts` — entry-point del `NerWorker` (Hito 10 PR15, ADR-046 §3): pura mensajería alrededor de `kernelClassify`, sin bus/cache puente para eventos de dominio (sí reenvía `PROGRESS` tal cual).

## Reglas

- Nunca importa otro motor ni React (spec §5). Solo `@anonly/shared` y `@huggingface/transformers` (ADR-001, ADR-006, ADR-025) — `onnxruntime-web` no es dependencia directa: v4 bundlea la suya, el motor accede al backend vía `env.backends.onnx`.
- `init()` **no** carga el modelo (lazy loading): solo se carga en el primer `processPage`/`processPages` real, dentro del kernel, si `NerConfig.enabled === true` y hay texto (spec §13 caso 11).
- Modelo servido first-party (ADR-018): `env.allowRemoteModels = false`, `env.localModelPath = "/models/ner/"`. Nunca HuggingFace en runtime. Los wasm de `onnxruntime-web` (bundleados por `@huggingface/transformers`) se sirven igual de first-party desde `/wasm/onnxruntime/` (`env.backends.onnx.wasm.wasmPaths`) o el `wasmPaths` inyectado por config (ADR-039), pin en `assets.lock.json` (ADR-025).
- Cuantización vía `dtype: "q8"` (ADR-025; reemplaza `quantized: true` de v2) — mapea al mismo `model_quantized.onnx` pinneado por ADR-023.
- Mapeo de labels del modelo (ADR-023 §2): `PER→Person`, `ORG→Organization`, `LOC→Address`, `DATE→Date`.
- Batching/checkpoints de cancelación: `NerConfig.batchSize` se interpreta como cantidad de **palabras** por lote (ADR-024 §2). La partición la hace `NerEngine` host-side, que es quien tiene las `Word[]`; cada batch es un despacho independiente al kernel (ADR-046 §3). Checkpoint de `ctx.abortSignal` entre batches, host-side.
- No existe evento `NER_PAGE_FAILED` en el bus (a diferencia de `OCR_PAGE_FAILED`): un fallo de página tras agotar reintentos se descarta silenciosamente (`ctx.logger.warn`) y el pipeline continúa con las demás páginas (spec §11).
- Timeout y reintentos por página: fuente única `ctx.config.workerPool.timeouts["ner-page"]` / `maxRetries["ner-page"]` (ADR-021 §2). El único loop de retry es el del motor (`processPage`); el puerto siempre despacha con `maxRetriesOverride: 0` (ADR-046 §2). Errores que cruzan un worker remoto llegan deserializados y se re-instancian por `code` (`NER_TIMEOUT`/`NER_MODEL_MISSING`) antes de bifurcar.
- Deduplicación de fechas frente a Regex: **no es responsabilidad de este motor** (ADR-023 §2). La resuelve Grouping por overlap.

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
