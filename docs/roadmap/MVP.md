<!-- CONTEXT: scope=roadmap-mvp | dependencias=00_Project_Vision.md,01_Technical_Architecture_Document.md,adr/ADR-011-Grouping-First.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=10 (Hitos 1–9 cerrados; pendientes puntuales diferidos a Hito 11 anotados por hito; Hito 10 auditado por ADR-036, con dos decisiones reabiertas por el humano vía ADR-037/038 — tabla de PRs canónica en ADR-038 §8) -->

# Anonly — Roadmap MVP

> Define el alcance exacto del primer release. Cualquier cosa fuera de esta lista **no** entra en MVP. v1.0 y v2.0 viven en sus propios docs.

**Versión objetivo**: 0.1.0
**Criterio de "MVP listo"**: cumple todas las métricas de `00_Project_Vision.md` §7 y todos los gates de `07_Performance_Strategy.md` §11.4.

---

## 1. Objetivo del MVP

Demostrar el producto end-to-end con el mínimo que resuelve el caso de uso base: cargar un PDF, detectar y agrupar entidades, editar reemplazos a nivel grupo, exportar un PDF nuevo no recuperable. **100% local**.

---

## 2. En alcance MVP

### 2.1 Motores (con specs completos)

| Motor | Alcance MVP |
|---|---|
| PDF Engine | parseo de PDF con texto, detección de páginas sin texto, metadata no sensible, password-protected con reintento. |
| OCR Engine | Tesseract.js con modelo `spa+eng`, páginas sin texto, cache IndexedDB. |
| Regex Engine | patrones default AR (DNI, CUIT, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente). Sin patrones custom del usuario. |
| NER Engine | Transformers.js + ONNX, modelo Q8 multilingüe, Person/Org/Address/Date (fechas en lenguaje natural; las numéricas siguen siendo de Regex — ADR-023 §2), con toggle en settings. |
| Grouping Engine | matching exacto + fuzzy Levenshtein, `indexInType` estable, fusión/división manual, conflictos auto-resueltos, reglas group/type/global. |
| Render Engine | OffscreenCanvas, original + anonymized, 4 modos visuales, delta render, LRU cache. |
| Export Engine | pdf-lib, reconstrucción, JPEG q 0.85, DPI 150/300, metadata mínima. |

### 2.2 Pipeline

- Etapas 0–11 completas (ver `06_Pipeline.md`).
- Cancelación en cualquier etapa con SLA < 200 ms.
- Incremental: `ENTITY_GROUP_CREATED` en vivo, preview por página.

### 2.3 UI (4 paneles)

- Toolbar con estado de pipeline, importar, cancelar, exportar.
- Panel de Entidades con árbol por tipo, checkbox cascade, selector de modo, fusión/división.
- Panel de Reglas con creador/editor/eliminador.
- Visor lado a lado (original + anonimizado) con virtualización, highlights, zoom.
- Diálogos: importar, password, conflicto, fusión, división, export, confirmación de cancel.
- Settings: idioma (es default), performance preset, NER toggle, OCR languages.

### 2.4 Tipos de entidad soportados

`Person, Organization, Address, DNI, CUIT, Phone, Email, IBAN, CreditCard, Date, License, Plate`.

### 2.5 Modos de reemplazo

`mask, synthetic, placeholder, redact` (ver `ADR-012-Replacement-Modes.md`).

### 2.6 Seguridad

- 100% local, sin network desde el Core.
- CSP estricta.
- No-recuperabilidad del export (test de CI).
- Strip de metadata sensible.
- Sin persistencia de documentos.

### 2.7 Testing

- Unit, contract, snapshot, edge por motor.
- E2E: 10 escenarios críticos (ver `07_Performance_Strategy.md` §11.3).
- Performance gates, leak, cancel.
- Security gates: `no-recuperability`, `metadata-strip`, `no-network-from-core`, `no-password-in-logs`.

---

## 3. Fuera de alcance MVP

- Word, Excel, imágenes como entrada (v2.0).
- Patrones Regex custom del usuario (v1.0).
- Modo "texto preservado" en export (v2.0).
- Pausa/reanudación parcial del pipeline (v1.0).
- Modo oscuro (v1.0).
- Multi-idioma UI (v1.0; MVP solo español).
- Colaboración multi-usuario (future).
- NER entrenado para Argentina (future).
- Plugins / extensibilidad (v2.0).
- Batch de múltiples documentos (v2.0).
- Modo offline instalable PWA (v1.0).
- Modo "alta calidad" PDF/A (future).
- Marca de agua "Anonimizado por Anonly" (v1.0, opcional).
- WebGPU backend para NER (v1.0+, si soporte amplio).
- Modo blur/pixelate como variante de redact (v1.0+).
- mobile nativo (React Native) (future).

---

## 4. Hitos de implementación

Orden sugerido (cada hito = un set de PRs):

### Hito 1 — Fundación
- Monorepo con pnpm workspaces.
- `@anonly/shared` con todos los tipos, enums, error codes (`core/Contracts.md` completo).
- `@anonly/event-system` con `IEventBus` y test de contrato.
- `tsconfig.base.json`, ESLint, Prettier, Vitest, Playwright setup.
- CI con gates de lint + typecheck + test.
- Fixtures en `tests/fixtures/`.

### Hito 2 — PDF Engine
- ~~Implementar `pdf-engine` siguiendo `core/PDF_Engine.md`.~~ **CERRADO** (PRs #6, #7).
- ~~Tests contract + unit + edge + snapshot.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `snapshot.test.ts` commiteados en `packages/anonymization-core/pdf-engine/src/__tests__/`. Pendientes: `stress.test.ts` y `cancel.test.ts` → Hito 11.
- ~~Ejecución **inline** (sin `PdfPool`); integración con `PdfPool` difiere al Hito 9 (ver ADR-013).~~ **CERRADO** — ejecución inline confirmada; specs `core/PDF_Engine.md` v1.1.1, `core/Contracts.md` y ADRs 013/014 ya reconciliados. Migración a `PdfPool` queda en Hito 9.

### Hito 3 — OCR Engine
- ~~Implementar `ocr-engine` siguiendo `core/OCR_Engine.md`.~~ **CERRADO** (PR #10).
- ~~Assets de Tesseract servidos first-party: script `scripts/mirror-assets.ts` + `assets.lock.json` (ver ADR-018).~~ **CERRADO** (PR #11).
- ~~Integración con PDF Engine (`fuseOcrPage`).~~ **CERRADO** (PR #10).
- ~~Tests completos.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts` commiteados en `packages/anonymization-core/ocr-engine/src/__tests__/`.
- Pendiente: verificación de integridad en runtime de assets (ADR-018 punto 3) → Hito 11.

### Hito 4 — Regex Engine
- ~~Implementar `regex-engine` con `DEFAULT_PATTERNS_AR`.~~ **CERRADO** (PR #13).
- ~~Tests completos con casos límite por patrón.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `snapshot.test.ts` commiteados en `packages/anonymization-core/regex-engine/src/__tests__/`, cobertura 99.61% líneas. Pendientes: `cancel.test.ts` y `perf.test.ts` (§14 del spec) → Hito 11 (ver `core/Regex_Engine.md` §15).
- Corrección de contrato: patrón "Phone (AR mobile)" ajustado con límites de palabra (`\b`) porque el regex literal rompía el caso límite 3 del spec; formalizado en `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md`. `core/Regex_Engine.md` pasa a v1.0.1.

### Hito 5 — NER Engine
- ~~Implementar `ner-engine` con Transformers.js + ONNX. Config canónica `NerConfig` (Contracts.md §6; alias `NerEngineConfig` eliminado) y modelo multilingüe default `Xenova/bert-base-multilingual-cased-ner-hrl` fijados en `adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md`.~~ **CERRADO** (PR #14).
- ~~Modelo NER servido first-party (`env.allowRemoteModels = false`, `env.localModelPath`): agregar la entrada del modelo a `assets.lock.json` y correr `pnpm assets:mirror`.~~ **CERRADO** (PR #14) — modelo Q8 (178 MB) + tokenizer/config pinneados por hash (revision `263e82c0…`) y mirrorados a `public/models/ner/` (ADR-018, ADR-023 §2).
- ~~Cache del modelo en Cache Storage.~~ **CERRADO** (PR #14).
- ~~Migración de `@xenova/transformers` (v2, deprecada) a `@huggingface/transformers` (v4) por `adr/ADR-025-Migracion-Huggingface-Transformers.md`.~~ **CERRADO** (PR #15) — `@huggingface/transformers@^4.2.0` con `dtype: "q8"` (assets del modelo intactos), wasm de onnxruntime pinneados y mirrorados a `public/wasm/onnxruntime/` (cierra el gap de `wasmPaths` detectado post-PR #14), override `onnx-proto>protobufjs` eliminado, `pnpm audit` limpio.
- Tests: `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `snapshot.test.ts`, `cancel.test.ts` commiteados en `packages/anonymization-core/ner-engine/src/__tests__/` (56 tests), cobertura 97.77% líneas. Pendientes: `stress.test.ts` (OOM/pool) → Hito 11 (junto con la infra `tests/stress/`; corregido de "Hito 9" por ADR-034 §6); `perf.test.ts` (recall ≥ 85% / precision ≥ 90%, informativas en MVP, §6) → Hito 11.
- Correcciones de contrato del hito: mapeo `DATE → Date` y contrato de salida de NER ampliado a cuatro tipos (ADR-023 §2); `NerStarted.modelLoading?` y `batchSize` en palabras (ADR-024).
- Los tests de integración con Regex (ambos emiten `ENTITY_FOUND`) viven en `tests/integration/` y son Hito 9 (Orchestrator) (ADR-010, `core/Orchestrator.md:239`, precedente `core/OCR_Engine.md:225`).
- Pendiente: verificación de integridad en runtime del modelo (ADR-018 punto 3, `core/NER_Engine.md` §15.19) → Hito 11.

### Hito 6 — Grouping Engine
- ~~Implementar `grouping-engine` con matching, conflictos, reglas, fusión/división.~~ **CERRADO** (PR #16).
- ~~Tests completos (es el motor más complejo en lógica).~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `snapshot.test.ts`, `cancel.test.ts` commiteados en `packages/anonymization-core/grouping-engine/src/__tests__/` (66 tests), cobertura 96.95% líneas.
- Renumeración canónica de `indexInType` en `finishSession` (`adr/ADR-028-IndexInType-Renumeracion-Canonica.md`): resuelve la contradicción entre `06_Pipeline.md` §8 (orden documental) y el pseudocódigo original del spec (orden de llegada) — los índices son provisionales durante la sesión y se renumeran una sola vez, antes de `GROUPING_FINISHED`.
- `Occurrence.maskFormat` opcional y resolución de `mask` por grupo (`adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md`): corrige de paso un error de datos en `adr/ADR-012-Replacement-Modes.md` (los formatos de máscara de patente vieja/Mercosur estaban invertidos).
- Pendiente: PR chico de `regex-engine` para poblar `Occurrence.maskFormat` desde el patrón matcheado y corregir `default-ar.ts` (ADR-029 §4) → no bloqueante, el fallback actual mantiene el comportamiento previo sin regresión.
- Los tests de integración con Regex/NER reales (ambos emiten `ENTITY_FOUND`) viven en `tests/integration/` y son Hito 9 (mismo criterio que Hito 5).

### Hito 7 — Render Engine
- ~~Implementar `render-engine` con OffscreenCanvas, 4 modos, delta render, LRU.~~ **CERRADO** (PR #17).
- ~~Tests con visores en headless browser.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `cancel.test.ts`, `stress.test.ts` commiteados en `packages/anonymization-core/render-engine/src/__tests__/` (49 tests), cobertura 94.19% líneas / 100% funciones (threshold 85/80/80 en `vitest.config.ts`). La frontera de pdfjs-dist va mockeada (ADR-021 §5) en lugar de visores en headless browser; validación visual real → Hito 10 (UI).
- `RenderEngine.loadDocument`/`unloadDocument` (`adr/ADR-030-RenderEngine-LoadDocument.md`): resuelve la ambigüedad reportada por el implementador (ningún doc definía cómo Render obtiene el PDF fuente por `documentId`); spec de Render a v1.1.0, fe de erratas en `05_Worker_Architecture.md` §7.4 (decía pdf-lib).
- `EngineErrorCode.RENDER_FAILED` + erratas del spec (`adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md`): el code faltaba en Contracts.md §4 (solo existía como evento; precedente `EXPORT_FAILED`); clave de cache LRU con `annotations`, highlight por `AnnotationKind`, cast de frontera pdfjs↔OffscreenCanvas sancionado en Code_Standards §10. Spec a v1.1.1. La línea en `enums.ts` viaja en el PR del hito (patrón ADR-029 §4).
- Pendientes diferidos a Hito 9 (ADR-031 §5 + observaciones no bloqueantes del revisor, PR #17):
  - `PREVIEW_UPDATED.canvasBlobUrl` real (`convertToBlob` en host; inline es placeholder de bytes crudos). Incluye la **revocación de blob URLs**: al recibir `PREVIEW_UPDATED` para `(documentId, pageIndex, kind)`, revocar el URL anterior de esa clave; en `DOCUMENT_CLOSED`, revocar todos. **Incorporado al spec del Orchestrator v1.1.0** (ADR-034 §5: crean los motores, revoca el Orchestrator) y al spec de Render §15.7c.
  - Mover `stress.test.ts` a `tests/stress/` cuando exista la infra (requiere hoistear `pdfjs-dist`) → **Hito 11** (ADR-034 §6).
  - Rama defensiva de `RENDER_FAILED` en `renderPages` (hoy inalcanzable: `renderPage` no lanza `RenderFailedError`): revisitar cuando el pool defina el fatal de batch real. `renderPages` secuencial → el paralelismo lo aporta el pool (ADR-021).

### Hito 8 — Export Engine
- ~~Implementar `export-engine` con pdf-lib.~~ **CERRADO** (PR #18).
- ~~Tests de `no-recuperability` y `metadata-strip`.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `cancel.test.ts`, `stress.test.ts` commiteados en `packages/anonymization-core/export-engine/src/__tests__/`; `no-recuperability` en `tests/security/security.test.ts` (`pnpm test:security`). 44 tests, cobertura ≥85% líneas (threshold en `vitest.config.ts`).
- Auditoría previa del spec (`adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md`): `RenderPageProvider.renderFull` devuelve `EncodedPageImage` (bytes codificados; pdf-lib no embebe `ImageData`), `EXPORT_REQUESTED` lo escucha el Orchestrator (patrón ADR-014), `EXPORT_NO_ENABLED_GROUPS` es `logger.warn` + continuar (confirmación pre-export), `ExportOptions`/`ExportMetadata` formalizados en `03_Data_Model.md` §19. Spec a v1.1.0.
- Test-infra global reconciliada (`adr/ADR-033-Test-Infra-Global-Scripts-Alias.md`): los cinco scripts `test:<dir>` (`security`/`cancel`/`leak`/`perf`/`stress`) usaban `--dir`, roto contra el `include` glob de Vitest — pasan a filtro posicional; se ratifica el alias `resolve.alias`/`paths` por motor, a demanda, para que tests de `tests/` importen motores (primer caso: `security.test.ts` → `@anonly/export-engine`). ADR-032 queda con nota de corrección. Hito 9 hereda los cinco scripts funcionales y la convención documentada.
- Pendientes diferidos a Hito 9 (observación no bloqueante del revisor, PR #18): `Replacement.originalValue` usa el `canonicalValue` del grupo (`export.engine.ts:111`) porque `OccurrenceRef` no guarda el valor original por ocurrencia — aproximación semántica, sin consumidores de esa garantía hoy. Revisitar si Render (consumidor real del `RenderPageProvider`) llega a depender de `originalValue`.

### Hito 9 — Orchestrator
- ~~Implementar según `core/Orchestrator.md` **v1.1.0** (spec del componente host + façade `createCore`), reconciliado por la auditoría pre-hito `adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md`.~~ **CERRADO** (PR #19).
- ~~Pipeline orchestrator que secuencia etapas, despacha jobs, maneja cancelación.~~ **CERRADO** — `contract.test.ts`, `unit.test.ts`, `edge.test.ts` commiteados en `packages/anonymization-core/src/__tests__/` (43 tests), cobertura 95.66% líneas / 87.55% branches (threshold 85/80 en `vitest.config.ts`).
- ~~Integración de todos los engines via bus; test de contrato de la matriz emisor→receptor (`04_Event_System.md` §11 corregida por ADR-034 §4).~~ **CERRADO**.
- ~~Migración de los motores pesados a sus **cuatro** pools (`PdfPool`, `OcrPool`, `NerPool`, `RenderPool`); `WorkerPoolManager` + `AbortRegistry` (ver ADR-013, ADR-021). Los pools del Hito 9 son colas de concurrencia in-process con la semántica completa de `05_Worker_Architecture.md`; los Web Workers de SO reales → Hito 10 (ADR-035 §1/§2).~~ **CERRADO** — cola prioritaria, backpressure, retry con backoff exponencial, eventos `WORKER_*` (`worker-pool.ts`).
- ~~Wiring Orchestrator→`PdfEngine.fuseOcrPage` para fusión OCR→PDF (ver ADR-014).~~ **CERRADO**.
- ~~Decisiones ADR-034 que amplían contratos (cambios de código de `shared`/`render-engine`/`export-engine` viajan en los PRs del hito, docs primero): `RenderEngine.rasterizePage` + `RenderPageOutput.encoded` (Render v1.2.0); gestión de sesión de Grouping (`startSession`/`finishSession` con NER off); `EncodedPageImage` promovido a `@anonly/shared`; `WorkerPoolConfig.maxQueuePerPool` por pool; blob URLs creados por motores y revocados por el Orchestrator.~~ **CERRADO**.
- ~~Crear `tests/integration/` (pares críticos mínimos de ADR-034 §6: Regex+NER→Grouping, OCR→PDF vía Orchestrator, happy path `createCore`→`PIPELINE_READY`), con script `test:integration`, alias por motor y exclusión de `tests/tsconfig.json` removida (ADR-033).~~ **CERRADO** — `regex-ner-grouping.test.ts`, `ocr-pdf-fusion.test.ts`, `happy-path.test.ts` (3 tests), motores reales con solo las fronteras de libs pesadas mockeadas (ADR-021 §5).
- Pendientes que hereda este hito de PRs anteriores: `PREVIEW_UPDATED.canvasBlobUrl` real + revocación (Hito 7); revisitar `Replacement.originalValue` del Export si Render llega a depender de él (Hito 8) — verificado en Hito 9: Render no lo consume, cerrado (ADR-035 §4); PR chico de `regex-engine` para `Occurrence.maskFormat` (ADR-029 §4, no bloqueante).
- Pendiente que este hito deja: PR chico de `pdf-engine` para `PdfPasswordRequiredError.retryable = false` + retiro del override `isRetryable` del Orchestrator (ADR-035 §3, no bloqueante).
- Hallazgos de revisión resueltos en el mismo PR antes de mergear: casts de frontera `as any` dispersos en `tests/integration/happy-path.test.ts`/`regex-ner-grouping.test.ts` concentrados en el helper `tests/integration/fixtures/mocks.ts` (`Code_Standards.md` §10, precedente `ner-engine`); emisión de `PIPELINE_PROGRESS` (`Orchestrator.md` §8), hasta entonces no-op, implementada en los 4 puntos de emisión (Extracting, OCR, Detección con/sin NER).

### Hito 10 — React Client

Auditoría pre-hito: `adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md` (reconcilia los docs de UI con ADR-014/015/032/034/035, fija el transporte de workers; pools ≠ workers — cuatro pools, cinco entry-points). El humano revisó la auditoría y pidió reabrir dos de sus decisiones "MVP-conservadoras": `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` (zoom con re-render real en vez de escalado CSS, supersede ADR-036 §6) y `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`Orchestrator.reanalyze` preservando ediciones del usuario en vez de recrear el core, supersede ADR-036 §5). La tabla de PRs canónica (17 PRs) es la de ADR-038 §8, que reemplaza a la de ADR-036 §8.

- `apps/react-client` con Vite + Tailwind + Radix + Zustand (scaffold primero; CSP `08_Security_Model.md` §3.2).
- `grouping-engine`: `reopenSession`/`dropOccurrences`/dedup por identidad/`finishSession` re-ejecutable (ADR-038 §2-§4; spec v1.1.0).
- `packages/anonymization-core/src` (+ `shared`): `Orchestrator.reanalyze`/`ReanalyzeConfigPatch`, config efectiva por documento, transiciones nuevas, cancelación preservando estado (ADR-038 §1, §5-§6; spec v1.2.0).
- `render-engine` (+ `shared`): `RenderRequested.scale`, `MAX_RENDER_SCALE`, cache LRU por escala + `PREVIEW_CACHE_MAX_BYTES`, supersede de renders obsoletos (ADR-037; spec v1.3.0).
- `core-adapter` (bus bridge, actions **completas** — incluye `updateRule`/`deleteRule`/`requestRender(..., scale?)`/`retryWithPassword`/`reanalyze` —, snapshots, mapeo settings→`EngineConfig`; ADR-036 §5, ADR-038 §7) sobre el core **in-process** del Hito 9.
- 4 paneles, todos los componentes de `ui/Components.md` (incluye los agregados por ADR-036 §7: `PasswordDialog`, `ConfirmDialog`, `SettingsDialog`).
- E2E con Playwright (base antes de la migración de workers; suite completa al cierre — escenarios de `07_Performance_Strategy.md` §11.3, incluidos el 9 reescrito —preserva ediciones— y el 11 nuevo —zoom—).
- Migrar los **cuatro pools** de in-process a Web Workers de SO reales, con **cinco entry-points de worker** (pools ≠ workers, ADR-036 §1): PdfWorker, OcrWorker, NerWorker, RenderWorker y ExportWorker (único, sin pool propio — ensamblado pdf-lib secuencial). PRs por motor (R-1), bundling vía Vite (`?worker` + subpath `"./worker"` por paquete), factories inyectadas en `createCore` (`CoreRuntimeOptions`, ADR-036 §2), transferables `05` §2.3 corregidos (ADR-036 §4; ADR-035 §2).

Orden canónico de PRs (ADR-038 §8; los PRs 2-4 no dependen del scaffold y pueden correr en paralelo con el PR 1):

| # | PR | Módulo |
|---|---|---|
| 1 | Scaffold | `apps/react-client` |
| 2 | Grouping re-análisis | `grouping-engine` |
| 3 | Orchestrator `reanalyze` | `packages/anonymization-core/src` (+ `shared`) |
| 4 | Render zoom | `render-engine` (+ `shared`) |
| 5 | `core-adapter` | `apps/react-client` |
| 6 | Toolbar + diálogos de flujo | `apps/react-client` |
| 7 | Visor | `apps/react-client` |
| 8 | Panel Entidades + conflictos | `apps/react-client` |
| 9 | Panel Reglas + Export | `apps/react-client` |
| 10 | E2E base | `tests/e2e/` |
| 11 | Transporte de workers | `packages/anonymization-core/src` |
| 12–16 | Workers, uno por PR | `pdf-engine`, `render-engine`, `ocr-engine`, `ner-engine`, `export-engine` |
| 17 | E2E completa | `tests/e2e/` |

### Hito 11 — Hardening
- Performance gates (todas las métricas de `00_Project_Vision.md` §7).
- Leak tests, cancel tests.
- Security tests.
- Verificación de integridad en runtime de modelos/wasm (`crypto.subtle.digest` contra `assets.lock.json`, ADR-018 punto 3) en `ocr-engine` y `ner-engine`; hash mismatch → `OCR_MODEL_MISSING` / `NER_MODEL_LOAD_FAILED`. Incluye test de integridad: asset con hash alterado → error tipado, no se carga.
- Audit `pnpm audit`.
- Bundle size check.

### Hito 12 — Release 0.1.0
- Docs finales, README del repo, demo, deploy a CDN estático.

---

## 5. Métricas de aceptación (contractuales)

| Métrica | Target MVP | Cómo se mide |
|---|---|---|
| Recall Regex | ≥ 90% | dataset de referencia (`tests/fixtures/README.md` §Dataset de referencia) |
| Precision Regex | ≥ 98% | dataset de referencia |
| Recall NER | ≥ 85% — **informativa en MVP, gate en v1.0** | dataset de referencia |
| Precision NER | ≥ 90% — **informativa en MVP, gate en v1.0** | dataset de referencia |
| Falsos negativos post-export | 0 (Regex); < 1% (NER) — **NER informativa en MVP, gate en v1.0** | `no-recuperability` test |
| Recuperabilidad info original | 0% | `no-recuperability` test |
| PDF 10p texto end-to-end | < 8 s | perf test |
| PDF 10p escaneado end-to-end | < 60 s | perf test |
| Pico de memoria 50p | < 512 MB | leak test |
| Bundle inicial (sin modelos) | < 800 KB gz | bundle analyzer |
| Cancelación | < 200 ms | cancel test |
| First preview página 1 | < 1.5 s | perf test |
| Delta render 1 grupo | < 150 ms | perf test |

Si alguna métrica **gate** no se cumple, el MVP **no** se libera. Las métricas NER son **informativas** en MVP (se miden y reportan pero no bloquean el release) y pasan a gate en v1.0 — consistente con `00_Project_Vision.md` §7, que asigna los objetivos de calidad NER a v1.0, y con `core/NER_Engine.md` §14.

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Modelo NER Q8 demasiado pesado para móviles | media | medio | serializar NER con OCR si `deviceMemory < 4` GB; ofrecer desactivar NER |
| Tesseract.js tiene issues con ESM puro | media | medio | ADR específico si aparece; pin de versión |
| PDF.js con ciertos PDFs corruptos crashea el worker | baja | medio | catch + `PdfCorruptedError` + reintento |
| Bundle initial > 800 KB | media | bajo | code splitting agresivo, lazy load engines |
| Cancelación > 200 ms en NER | media | medio | checkpoints más finos en el loop de inferencia |
| `no-recuperability` falla por texto residual en imagen | baja | alto | fill opaco confirmado en render; test estricto |

---

## 7. Referencias

- `00_Project_Vision.md` §7 (métricas)
- `01_Technical_Architecture_Document.md` (arquitectura completa)
- `roadmap/Version_1.0.md` (qué sigue)
- `adr/ADR-001-Framework.md` a `ADR-012-Replacement-Modes.md`
- `ai/AI_Development_Guide.md` (cómo se implementa)
