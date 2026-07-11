# @anonly/ner-engine

Detecta personas, organizaciones, direcciones y fechas mediante un modelo NER local (`Xenova/bert-base-multilingual-cased-ner-hrl`, Transformers.js + ONNX Runtime Web, cuantizado Q8). Emite `Occurrence[]` con `source: "ner"` y `entityType ∈ {Person, Organization, Address, Date}`.

> Hito 5 (`docs/roadmap/MVP.md` §4). Corre **inline** en el host hasta el Hito 9 (ADR-021): sin `NerPool` propio.

## Documentación

- **Spec canónico**: [`docs/core/NER_Engine.md`](../../../docs/core/NER_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §5
- ADRs relevantes: [`ADR-006`](../../../docs/adr/ADR-006-NER-Local.md) (Transformers.js + ONNX), [`ADR-018`](../../../docs/adr/ADR-018-First-Party-Assets.md) (assets first-party), [`ADR-021`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) (inline hasta Hito 9), [`ADR-023`](../../../docs/adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md) (`NerConfig` canónico + modelo multilingüe), [`ADR-025`](../../../docs/adr/ADR-025-Migracion-Huggingface-Transformers.md) (migración a `@huggingface/transformers` v4)

## Contenido

- `ner.types.ts` — `NerPageInput`, `NerPageOutput` (`NerConfig` viene de `@anonly/shared`, ADR-023).
- `ner.errors.ts` — `NerModelMissingError`, `NerModelLoadFailedError`, `NerPageFailedError`, `NerTimeoutError`.
- `ner.engine.ts` — clase `NerEngine` (implementa `IEngine`): `init`, `processPage`, `processPages`, `isModelReady`, `getModelId`, `dispose`.

## Reglas

- Nunca importa otro motor ni React (spec §5). Solo `@anonly/shared` y `@huggingface/transformers` (ADR-001, ADR-006, ADR-025) — `onnxruntime-web` no es dependencia directa: v4 bundlea la suya, el motor accede al backend vía `env.backends.onnx`.
- `init()` **no** carga el modelo (lazy loading): solo se carga en el primer `processPage`/`processPages` real, si `NerConfig.enabled === true` y hay texto (spec §13 caso 11; mismo patrón que `ocr-engine` con `ensureWorkerLoaded`).
- Modelo servido first-party (ADR-018): `env.allowRemoteModels = false`, `env.localModelPath = "/models/ner/"`. Nunca HuggingFace en runtime. Los wasm de `onnxruntime-web` (bundleados por `@huggingface/transformers`) se sirven igual de first-party desde `/wasm/onnxruntime/` (`env.backends.onnx.wasm.wasmPaths`), pin en `assets.lock.json` (ADR-025).
- Cuantización vía `dtype: "q8"` (ADR-025; reemplaza `quantized: true` de v2) — mapea al mismo `model_quantized.onnx` pinneado por ADR-023.
- Mapeo de labels del modelo (ADR-023 §2): `PER→Person`, `ORG→Organization`, `LOC→Address`, `DATE→Date`.
- Batching/checkpoints de cancelación: `NerConfig.batchSize` se interpreta como cantidad de **palabras** por lote (no tokens de wordpiece reales — no hay tokenizer real disponible fuera de la llamada mockeada a Transformers.js en este hito inline, ADR-021 §5). Un checkpoint de `ctx.abortSignal` por lote.
- No existe evento `NER_PAGE_FAILED` en el bus (a diferencia de `OCR_PAGE_FAILED`): un fallo de página tras agotar reintentos se descarta silenciosamente (`ctx.logger.warn`) y el pipeline continúa con las demás páginas (spec §11).
- Deduplicación de fechas frente a Regex: **no es responsabilidad de este motor** (ADR-023 §2). La resuelve Grouping por overlap.

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
