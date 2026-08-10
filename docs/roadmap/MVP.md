<!-- CONTEXT: scope=roadmap-mvp | dependencias=00_Project_Vision.md,01_Technical_Architecture_Document.md,adr/ADR-011-Grouping-First.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=10-cierre (Hitos 1–10 cerrados y mergeados a main; pendientes puntuales diferidos a Hito 11 anotados por hito; antes de arrancar el Hito 11 queda la revisión integral de Hito10_Observaciones_Revision.md y los ADR-053/054/055 de los hallazgos del cierre — ver el bloque CERRADO al final del Hito 10. §4 gana los Hitos **10.5** —legibilidad del reemplazo, ADR-057/058/059— y **10.6** —reemplazo por género, ADR-060—, y **10.7** —agregado manual de entidades, ADR-061—, y **10.8** —texto rotado y páginas con texto nativo parcial, ADR-063 + ADR-064 + ADR-065—, insertados con la convención decimal del repo sin renumerar Hardening ni Release) -->

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
- ~~Pendiente que este hito deja: PR chico de `pdf-engine` para `PdfPasswordRequiredError.retryable = false` + retiro del override `isRetryable` del Orchestrator (ADR-035 §3, no bloqueante).~~ **Absorbido por `adr/ADR-049` §4 (2026-07-30) y dejó de ser no bloqueante**: con transporte real de workers, el override se apoyaba en un `instanceof` que no sobrevive al boundary, así que el pool reintentaba el PDF protegido. Se implementa en los PRs 17.1 (`pdf-engine`) y 17.2 (façade) del Hito 10.
- Hallazgos de revisión resueltos en el mismo PR antes de mergear: casts de frontera `as any` dispersos en `tests/integration/happy-path.test.ts`/`regex-ner-grouping.test.ts` concentrados en el helper `tests/integration/fixtures/mocks.ts` (`Code_Standards.md` §10, precedente `ner-engine`); emisión de `PIPELINE_PROGRESS` (`Orchestrator.md` §8), hasta entonces no-op, implementada en los 4 puntos de emisión (Extracting, OCR, Detección con/sin NER).

### Hito 10 — React Client

Auditoría pre-hito: `adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md` (reconcilia los docs de UI con ADR-014/015/032/034/035, fija el transporte de workers; pools ≠ workers — cuatro pools, cinco entry-points). El humano revisó la auditoría y pidió reabrir dos de sus decisiones "MVP-conservadoras": `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` (zoom con re-render real en vez de escalado CSS, supersede ADR-036 §6) y `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`Orchestrator.reanalyze` preservando ediciones del usuario en vez de recrear el core, supersede ADR-036 §5). La tabla de PRs canónica (17 PRs) es la de ADR-038 §8, que reemplaza a la de ADR-036 §8. Al arrancar PR12 (PdfWorker), el implementador destapó una ambigüedad bloqueante — `fuseOcrPage` dependía del estado retenido de la instancia de `PdfEngine`, incompatible con un pool multi-worker sin afinidad — resuelta por `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md`: la fusión pasa a función pura ejecutada host-side por el Orchestrator, el motor queda sin estado por documento (`releaseDocument` eliminado) y el transporte no se toca; el ADR además audita el estado retenido de los demás motores y marca el de `render-engine` como decisión bloqueante previa a PR13, resuelta por `adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md` (la clase queda host-side; el worker corre un kernel sin estado; broadcast `unload-document` y re-priming nuevos). El mismo fork reapareció en los dos PRs siguientes y se resolvió con el mismo patrón: `adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md` (PR14, decidido por el humano sobre el fork que destapó el implementador: carrera EVENT/COMPLETED, retry duplicado) y `adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md` (PR15, detectado por el implementador **antes** de tocar código; agrega la única pieza que el patrón no cubría: el ciclo de vida del modelo NER cruza por el canal `PROGRESS` del transporte —`DispatchParams.onProgress` nuevo en `worker-pool.ts`— y el motor lo traduce en host a `NER_MODEL_LOADING`/`NER_MODEL_READY`). Los tres motores pesados comparten hoy un único patrón: clase host-side dueña de su pool, kernel sin estado por documento en el worker. `adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md` (PR16) lo cierra para el quinto entry-point con la única variante inevitable —el ExportWorker retiene el `PDFDocument` incremental, así que es un **ensamblador de un documento a la vez**, no un kernel puro— y completa `ExportPagePayload`, que estaba inejecutable. `adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md` (PR17) audita el cierre E2E: el gate `test:e2e` exige `pnpm assets:mirror` previo (los assets first-party no se commitean, ADR-018) y el job de CI nunca lo corría; los fixtures pesados se generan en runtime en vez de commitearse; y sus dos puntos de alcance quedaron **ratificados por el humano** (2026-07-24): `protected.pdf` se commitea como único fixture de test binario (pdf-lib no encripta), y se inserta **PR16.5** —bootstrap `settings.store` → `EngineConfig`, `apps/react-client`— que cierra el bug de producto del toggle de NER sin documento abierto y desbloquea el Escenario 8, en `fixme` desde PR10. Ya dentro de PR17, el Escenario 3 destapó un bug real del transporte que el implementador rastreó hasta su causa raíz: `adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md` — la subclase concreta de un `EngineError` no sobrevive al `postMessage` (`deserialize()` devuelve siempre un `DeserializedEngineError`), así que el `instanceof PdfPasswordRequiredError` del Orchestrator daba `false` y un PDF protegido mostraba el banner de pipeline fallido en vez del `PasswordDialog`, además de reintentarse en el pool. Se discrimina por `code`, `deserialize()` no se toca, y el fix se parte en **PR 17.1** (`pdf-engine`: el `retryable` que ADR-035 §3 dejó pendiente resulta ser la otra mitad del bug) y **PR 17.2** (façade: type-guard por `code`, retiro del override, des-`fixme` del Escenario 3).

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
| 16.5 | Bootstrap `settings.store` → `EngineConfig` (ADR-048 §7) | `apps/react-client` |
| 17 | E2E completa | `tests/e2e/` |
| 17.1 | `PdfPasswordRequiredError.retryable = false` (ADR-049 §4) | `pdf-engine` |
| 17.2 | Discriminación de errores por `code` en el Orchestrator + des-`fixme` del Escenario 3 (ADR-049 §5–§7) | `packages/anonymization-core/src` |
| 17.3 | Fix de race en `initCore()` (sin ADR) | `apps/react-client` |
| 17.4 | `loadDocument(documentId, buffer, password?)` (ADR-050 §1–§3) | `render-engine` (+ `shared`) |
| 17.5 | `retryWithPassword` persiste y propaga el password; cierre del Escenario 3 con preview (ADR-050 §4) | `packages/anonymization-core/src` |
| 17.6 | Rutas de tesseract: archivo en `workerPath` + absolutización contra `self.location.origin` (erratas `OCR_Engine.md` v1.2.1/v1.2.2, ADR-018 §2; sin ADR) | `ocr-engine` |
| 17.7 | `CloseDocumentButton` en el Toolbar + cierre del Escenario 7 (ADR-051) | `apps/react-client` |
| 17.8 | Blob URLs tardíos tras cerrar documento: guard que revoca + señal de baja del preview mediado (ADR-052) | `packages/anonymization-core/src` |

**CERRADO (2026-07-31)** — los 17 PRs de la tabla mergeados a `main`. Gates de CI verdes de punta a punta por primera vez: `lint`, `typecheck`, `test` (75 suites / 911 tests, thresholds de cobertura por paquete), `audit` y `e2e` (12 escenarios sobre Chromium real). El cierre destapó dos gates que **nunca habían corrido en CI** y que se arreglaron en la propia rama: el job `test` dependía de assets mirroreados que no se commitean (resuelto con un stub de resolución en `vitest.config.ts`, sin atar la suite unitaria a una descarga de 219 MB) y el Escenario 11 esperaba un ciclo de render con un presupuesto fijo de 800 ms en vez de esperar por la condición.

**Pendiente, antes de arrancar el Hito 11**: revisión integral con el planificador de **todas** las observaciones no bloqueantes acumuladas en `Hito10_Observaciones_Revision.md` — el documento tiene entradas abiertas desde el PR2 y nunca se barrió completo. Incluye, con prioridad y ya diagnosticados, los cinco hallazgos de prueba manual del cierre (sección "Cierre del Hito 10" de ese doc), de los cuales tres tienen ADR pendiente de escribir y uno es **crítico**:

- **ADR-055 + PR `ner-engine`** — NER no detecta ninguna entidad con `NerPool` real (desajuste de sobre `{ spans }` entre worker y host). Ningún test de ningún nivel verifica que una entidad NER llegue a la UI: ese es el agujero de fondo que el ADR debe cerrar.
- **ADR-053 + 3 PRs** (app / `render-engine` / `pdf-engine`) — texto reconstruido como cuadrados `.notdef`: pdf.js corre su capa de display dentro de un Worker, sin Font Loading API, con `disableFontFace` en `false`.
- **ADR-054 + PR `apps/react-client`** — scroll independiente por panel más un control opcional de sincronización a nivel de píxel; cierra los tres defectos compuestos del salto de scroll.
- Sin ADR: pdf.js degrada a "fake worker" dentro de todo Web Worker (solo rendimiento, candidato a este hito 11); ruido de blob URLs revocados al scrollear; y una página escaneada suelta dentro de un PDF textual que no recibe cobertura de OCR (**único de los cinco con causa sin cerrar**, requiere diagnóstico propio).

**Los tres ADRs quedaron escritos el 2026-07-31**, con los specs que cada uno enmienda ya actualizados (`Render_Engine.md` v1.7.0, `PDF_Engine.md` v1.3.1, `NER_Engine.md` v1.2.1, `05_Worker_Architecture.md` §2.2/§7, `React_Client.md` §3.5/§3.6/§7, `Components.md` §5.1/§5.3/§5.6, `07_Performance_Strategy.md` §3.1, `Code_Standards.md` §7, más notas de amendment en ADR-018 y ADR-042). Los PRs quedan listos para asignarse al implementador, en este orden:

| # | PR | Módulo | ADR | Prioridad |
|---|---|---|---|---|
| A1 | Puerto `unknown` + decoder del sobre `{ spans }` + tests de sobre | `ner-engine` | ADR-055 §9 | **Crítica** — sin esto NER no detecta nada |
| A2 | E2E que verifica una entidad NER en la UI | `tests/e2e/` | ADR-055 §6 | Alta |
| B1 | Copia de `cmaps`/`standard_fonts` a `public/pdfjs/` + `predev`/`prebuild` + `.gitignore` | `apps/react-client` | ADR-053 §9 | Alta — bloquea B2/B3 |
| B2 | `disableFontFace` + assets + factories propias en `kernelLoadDocument` | `render-engine` | ADR-053 §9 | Alta |
| B3 | cMaps + standard fonts + factories propias en la extracción | `pdf-engine` | ADR-053 §5 | Media |
| C1 | Scroll independiente por panel + `ScrollSyncToggle` + estado del visor por-kind | `apps/react-client` | ADR-054 §10 | Media |
| D1, D2, D4 | Puerto `unknown` + decoder, uno por motor | `ocr-engine`, `render-engine`, `export-engine` | ADR-055 §7 | Preventiva, sin fecha |
| D3.1 → D3.2 | `decodePdfEngineOutput` exportado, después el call site del façade a `unknown` + decoder. **Orden estricto**, dos módulos, dos PRs (mismo reparto que ADR-049 → PR 17.1/17.2) | `pdf-engine` → `packages/anonymization-core/src` (façade) | ADR-055 §10 | Preventiva, sin fecha |
| E1 | `PageCanvas` no reasigna dimensiones si no cambiaron (mata el parpadeo del visor al scrollear) | `apps/react-client` | ADR-056 §5 | Alta |
| E2 | `RenderRequested.kind` requerido + handler por kind + supersede acotado + emisores | `shared` + `render-engine` + `apps/react-client` (**atómico**, excepción a R-1 justificada en ADR-056 §7) | ADR-056 §1–§4, §7 | Alta |

A y B y C son independientes entre sí y pueden correr en paralelo; dentro de B, el orden es estricto.

**E1/E2 (ADR-056, 2026-08-05)** — cierran el bug reportado por el humano tras C1: con scroll independiente y sincronización apagada, scrollear rápido un panel recargaba constantemente el otro. Son dos defectos que se componen (el evento no dice de qué panel viene → el motor renderiza los dos lados; y un `blobUrl` nuevo por acierto de cache hacía que `PageCanvas` se borrara), independientes entre sí: E1 mata el síntoma visible y no depende de nada, E2 elimina el trabajo de render desperdiciado. E1 va primero por criterio de alivio, pero no bloquea a E2. **El ADR y todas las actualizaciones de spec/doc ya están mergeados en `main`** (excepción explícita a R-21 pedida por el humano, ADR-056 §7): los implementadores arrancan con la documentación al día.

### Hito 10.5 — Legibilidad del reemplazo

Convención decimal, sin renumerar Hardening ni Release — la misma que el repo ya usa para PR16.5 (ADR-048 §7) y PR17.1–17.8 (ADR-049/050/051/052).

**El problema**: `paintReplacements` derivaba el tamaño de fuente **solo de la altura** del bbox y llamaba `fillText` **sin `maxWidth`**, con el texto centrado. Un token más largo que el dato que reemplaza —`[PERSONA 01]` sobre "Ana"— se derramaba hacia los dos lados, más allá del rectángulo blanco, encima de palabras del original que seguían dibujadas debajo. Afecta a `mask`, `synthetic` y `placeholder`; `redact` es inmune. Es el punto 5 de `Cambios para hacer.txt`.

**La forma de la solución**: una cascada de cuatro pasos, cada uno absorbiendo lo que el anterior no pudo. Cada paso cierra con gates verdes y entrega valor por sí solo — se puede frenar en cualquiera de ellos.

- **Paso 1 — que nada se derrame nunca** (ADR-058 §1). Shrink-to-fit con `measureText` dentro del kernel. **Es la única garantía dura de todo el hito**: si los pasos 2-4 no se hicieran nunca, el defecto reportado igual quedaría cerrado. Va primero por criterio de alivio, como el PR 1 de ADR-056.
- **Paso 2 — escalera de abreviaturas** (ADR-057). `[PERSONA 01]` → `[PERS 01]` → `[PRS-01]`, con el nivel elegido **por grupo** desde la ocurrencia más apretada y aplicado a todas, para conservar el invariante de ADR-012. Se resuelve entero en `grouping-engine`; la UI muestra el token abreviado sin ningún cambio, porque el árbol ya lee `group.replacementValue`. Cierra además la tabla de labels incompleta que `labels.ts` arrastraba documentada. **Requisito no negociable de este paso**: la resolución del label pasa de ser por *tipo* a ser por *grupo* (`resolveLabelSet`, ADR-057 §3) — sin esa indirección, el Hito 10.6 obliga a reescribir la escalera entera, y cuesta lo mismo hacerlo bien ahora.
- **Paso 3 — repintado de línea** (ADR-058 §2-§6). Solo cuando el token no entra: se tapa de la entidad al fin de línea y se redibuja cada palabra siguiente en su propia x desplazada por el delta. La tipografía se deduce **calibrando** contra los anchos reales de la línea y el color se **muestrea del canvas** — sin extraer fuentes del PDF, lo que hace que funcione **igual en documentos escaneados**. Es el paso grande y el único cuyo criterio de aceptación es visual.
- **Paso 4 — aviso y leyenda** (ADR-058 §7, ADR-059). Marca de degradación con umbral (razón, no píxeles) sobre una palanca que **ya existía y era invisible**: editar el `replacementValue` del grupo. Más el checkbox opcional de referencia de marcadores en el export, con la regla dura `token → tipo`, nunca valores originales, garantizada por tipo. La leyenda **se rasteriza** como cualquier otra página: se evaluó dibujarla con `drawText` de pdf-lib —mucho más barato— y se rechazó para que "el export es 100% imagen" siga siendo auditable en un segundo en vez de volverse un juicio sobre el contenido de una capa de texto (ADR-059 §4).

**Lo que este hito no toca**: ADR-004 y ADR-009 quedan intactos, **sin erratas ni salvedades** —todo pasa sobre el canvas, antes del `convertToBlob`, y ninguna página del export lleva capa de texto—; el reparto host/worker de ADR-043; y `pdf-engine`, que no necesita ninguna metadata nueva. Se descartó explícitamente redibujar el documento entero (es el "modo texto preservado" de `Version_1.0.md`/`Version_2.0.md:41`, con ADR y research propios) y expandir el bbox hacia el blanco vecino (subsumido por el paso 3).

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | Shrink-to-fit en `paintReplacements` (ADR-058 §1) | `render-engine` | — |
| 2 | Tipos: `lineWords`, `AnnotationKind.Degraded`, `DEGRADED_FONT_RATIO`, `estimateTokenWidth` + sus constantes, `includeMarkerLegend`, `MarkerLegendEntry`, `MarkerLegendRow`, `RenderLegendPayload` | `shared` | — |
| 3 | Tablas de los tres niveles, `resolveLabelSet` por grupo, selección de nivel (ADR-057) | `grouping-engine` | 2 |
| 4 | `selectLineWords`: la función pura de selección host-side (ADR-058 §5), **sin cablear** — `RenderPageInput` todavía no declara el campo y agregárselo es de `render-engine` (R-1) | `packages/anonymization-core/src` | 2 |
| 5 | `RenderPageInput.lineWords` + su reenvío al `RenderPagePayload`, y encima calibración, muestreo de color, repintado y condiciones de activación (ADR-058 §2-§4, §6). El campo es scope de este PR aunque nadie lo pase todavía: `Render_Engine.md` §6 ya lo declara y sin él el kernel no lo recibe ni aunque el host lo adjunte | `render-engine` | 2, 4 |
| 4b | Cablear `selectLineWords` en los **cuatro** puntos de enganche: los tres del preview y el `renderFull` del `RenderPageProvider` — sin este último el repintado del PR 5 no existe en el PDF exportado (`Orchestrator.md` v1.7.1; **sin cambio de firma del puerto**) | `packages/anonymization-core/src` | **5** (el literal no compila hasta que `RenderPageInput` declara el campo) |
| 6 | Umbral y emisión de `AnnotationKind.Degraded` (ADR-058 §7) | `render-engine` | 5 |
| 7 | `renderLegendPage` + `RenderLegendPayload` en el entry-point (ADR-059 §5) | `render-engine` | 2 |
| 8 | Proyección, `buildMarkerLegend`, `RenderPageProvider.renderLegend` + su mediación, embebido en `savePdf` (ADR-059 §5-§6) | `export-engine` + `packages/anonymization-core/src` (**atómico**, excepción a R-1 justificada en ADR-059 §7) | 2, 7 |
| 9 | Checkbox de leyenda en el diálogo de export. **Sin la marca de degradación** — ver ADR-062 y las tres filas de abajo | `apps/react-client` | 2 |

**La marca de degradación en el árbol sale del hito (ADR-062).** El veredicto que necesita ya se calcula, con el `groupId` puesto, y se descarta dentro del kernel: ni `KernelRenderResult` ni `RenderPageOutput` lo llevan. Es un problema de transporte, y resolverlo cruza `Contracts.md` → ADR primero (R-2/R-19). Se descartó explícitamente estimarlo en el cliente con `estimateTokenWidth`: sería una tercera fuente de verdad, junto al preview y al export, capaz de discrepar de los dos —justo lo que el umbral por razón de ADR-058 §7 existe para evitar— y sus falsos positivos mandan al usuario a arreglar grupos que se renderizan bien. Mientras tanto la señal no desaparece: el PR 6 ya pinta el recuadro `Degraded` sobre el canvas del preview; lo que falta es la afordancia accionable del árbol.

| # | PR (posterior al hito, ADR-062 §7) | Módulo | Depende de |
|---|---|---|---|
| A | `PreviewUpdated.degraded?` (ADR-062 §1-§2) | `shared` | — |
| B | `KernelRenderResult.degraded`, `InternalCacheEntry.degraded`, emisión desde `emitPreviewUpdated` **también en cache hit** (ADR-062 §4) | `render-engine` | A |
| C | Mapa por página con reemplazo (no acumulación), filtro por `kind`, agregación por grupo y marca en el árbol con sus tres salidas (ADR-062 §3, §5) | `apps/react-client` | B |

El campo va **opcional a propósito** (ADR-062 §2) para que esas tres caigan en commits de un módulo cada una con los gates verdes — la misma trampa de ordenamiento que produjo `RenderPageInput.lineWords` en este hito.

Los PRs 1 y 2 no dependen de nada y pueden correr en paralelo. **El 4b va después del 5, no antes**: es un cableado de `packages/anonymization-core/src` cuyo literal `RenderPageInput` no compila hasta que `render-engine` declara `lineWords`, y meter esa línea en el commit del 4b mezclaría dos módulos (R-1). El orden 4 → 5 → 4b resuelve la cadena sin ninguna excepción; el gate manual del PR 5 se corre **al final, con el 4b puesto**, porque hasta entonces no llega ni un `lineWords` al motor y el repintado no se puede ver ni en el preview ni en el export. **El ADR y todas las actualizaciones de spec/doc se escriben antes de los PRs de implementación**, mismo criterio y misma excepción explícita a R-21 que ADR-056 §7: los implementadores arrancan con la documentación al día.

**Gate propio del PR 5**: verificación manual en browser real (ADR-058 §11), con cuatro documentos —texto con nombres cortos, escaneado, tablas/justificado, sello—. El criterio de aceptación es que **las líneas repintadas no se distingan de las que no se tocaron a tamaño de lectura**, y ninguna suite headless puede juzgar eso. **Se verifica sobre el PDF exportado, no solo sobre el preview** (`Orchestrator.md` v1.7.1): son dos caminos de render distintos, y el export es el archivo que el usuario se lleva. Si el preview repinta y el export no, el gate está dando un falso positivo. Mismo criterio que ADR-053 §8, ADR-054 §9 y ADR-056 §9. Si la costura canta, el escalón siguiente —anotado, no incluido— es extender `Word` con `fontName` y la escala de la matriz.

### Hito 10.6 — Reemplazo por género

Punto 6 de `Cambios para hacer.txt`. Independiente del 10.5 salvo por el requisito del paso 2: **no arranca antes de que el PR 3 esté mergeado**.

**El problema**: con placeholders neutros, el texto anonimizado pierde su coherencia referencial. *"[PERSONA 03] y [PERSONA 04] arreglaron para juntarse en la casa de ella"* deja de ser interpretable — el "ella" sigue ahí, pero perdió su antecedente. Con `[MUJER 03] y [HOMBRE 04]` vuelve a entenderse sin el original a mano.

**Diseño** (ADR-060): **no** es un `ReplacementMode` nuevo — el modo sigue siendo `placeholder` y cambia el label resuelto, apoyándose en la indirección que ADR-057 §3 dejó puesta. `EntityGroup` gana `personGender?: "f" | "m"`, inferido de un léxico first-party sobre el `canonicalValue` y corregible por el usuario, que gana siempre. **Ante cualquier duda no se decide**: nombre ausente, ambiguo ("Andrea", "Cruz") o iniciales → token neutro y marca en el árbol. Sin heurística de terminación: un error acá se imprime en un documento que va a manos de un tercero. `indexInType` no se segmenta por género.

**Consideración de privacidad, que va en el ADR y no como nota al pie**: es la primera función del producto que **agrega** un atributo al documento anonimizado en vez de quitarlo, y el género es una categoría sensible que reduce activamente el conjunto de candidatos de reidentificación (`08_Security_Model.md` §9.1). Trade-off aceptado, opt-in por grupo, documentado.

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 10 | `PersonGender`, `EntityGroup.personGender` | `shared` | PR 3 del Hito 10.5 |
| 11 | Léxico + inferencia + variantes de label + marca de "sin determinar" | `grouping-engine` | 10, y el punto abierto de ADR-060 §9 |
| 12 | `PersonGenderSelect` por grupo + marca en el árbol | `apps/react-client` | 10 |

**El léxico** (ADR-060 §9-§11): dos fuentes, las dos **CC-BY**. [Nombres — Buenos Aires Data](https://data.buenosaires.gob.ar/dataset/nombres) (CC-BY-2.5-AR) como base **autoritativa**: trae el género declarado por el registro con tres valores `F`/`M`/`A`, y la `A` ya marca los nombres que no determinan género — o sea que la ambigüedad local no hay que inferirla. Y [Gender by Name — UCI](https://archive.ics.uci.edu/dataset/591/gender+by+name) (CC BY 4.0) **solo para nombres ausentes de la base**, con su probabilidad como criterio de confianza. Buenos Aires **no se contrasta** contra UCI ni cuando discrepan: "Andrea" es `F` acá y `M` en datos anglosajones, y en un documento argentino la respuesta correcta es `F`.

**Cómo viaja**: los CSV no entran al repo. Un script de build determinista los procesa y emite un artefacto `nombre → f | m | ambiguo` —se descartan conteos, probabilidades, origen y significado— que **sí** se commitea (precedente ADR-048 §7). En runtime lo sirve la propia app, mismo origen, con carga a demanda + Cache Storage, igual que el modelo de NER. **Nada se descarga de terceros en tiempo de ejecución**: la CSP lo impide. No entra en el bundle inicial; el PR mide y reporta contra el gate de §5 (< 800 KB gz).

**Lo que hay que cerrar en el PR 11**: la **atribución CC-BY visible en el producto** (créditos / "Acerca de", no solo el README), más procedencia y hash del artefacto en el repo. Es obligación de licencia, no cortesía. El punto abierto sobre el marcado de unisex quedó **resuelto** (los tres valores `F`/`M`/`A`, ADR-060 §9).

### Hito 10.7 — Agregado manual de entidades

Punto 1 de `Cambios para hacer.txt`. **Independiente de los Hitos 10.5 y 10.6**: no comparte contratos ni módulos críticos con ellos y puede correr en paralelo. La única primitiva compartida es la agrupación de palabras por línea, que ADR-058 §5 introduce y este hito reusa.

**El problema**: si el detector no encuentra una entidad, **no hay ninguna forma de agregarla**. El usuario puede fusionar, dividir, deshabilitar y editar grupos existentes; no puede crear uno. Y no es un caso raro: el recall del NER es una métrica **informativa** en MVP (§5, pasa a gate recién en v1.0), o sea que el propio roadmap asume que se escapan entidades y hoy no hay red de contención. Lo que se escapa se exporta sin anonimizar.

**Diseño** (ADR-061): una **búsqueda literal sobre `Page.words`**, no una re-corrida de detección. Al NER no se le puede pedir que busque un valor —es un clasificador de tokens, no un buscador—, y cuando el usuario escribió el valor exacto no hay nada que inferir. `RegexEngine` gana `findLiteral`, que emite `ENTITY_FOUND` con `source: Manual`, y de ahí en adelante el camino es el de siempre: Grouping agrupa, el dedup por identidad de ADR-038 §3 hace segura la repetición, `finishSession` renumera.

**Tres vías de entrada, un solo camino interno**: el botón con tipo + valor escrito; la selección sobre el panel `original`; y los resultados del buscador. La selección es **hit-test contra `Page.words`, no capa de texto** — porque en un PDF escaneado no hay texto que seleccionar, y es justo donde más falta hace corregir a mano. Las palabras de OCR tienen bbox igual que las de PDF, así que el hit-test no distingue el origen y no hay una sola rama por tipo de documento.

**Lo que hace esto barato**: la mitad ya existe. `mapSpanToWords` (el bbox unión de un rango de texto), `DetectionSource.Manual`, `RegexEngine.addPattern` documentado como *"runtime, para UI"*, y toda la maquinaria de `reopenSession`/`dropOccurrences`/dedup de ADR-038. El código nuevo es sobre todo cableado y UI.

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | `wordsInRect`, `TextMatch`, `ManualEntityRequest` y tipos de los accesores | `shared` | — |
| 2 | `findLiteral` + matcheo de secuencias de palabras normalizado | `regex-engine` | 1 |
| 3 | `addManualEntity`, `findText`, `getPageWords`, `getPageSize`; retención y re-aplicación de literales manuales | `packages/anonymization-core/src` | 1, 2 |
| 4 | Botón + diálogo "Agregar entidad" sobre el árbol | `apps/react-client` | 3 |
| 5 | Hit-test sobre el canvas del `original` + "Agregar entidad como…" | `apps/react-client` | 3 |
| 6 | Lupa de búsqueda con navegación y resaltado (punto 4 de `Cambios para hacer.txt`) | `apps/react-client` | 3 |

Los PRs 4, 5 y 6 son independientes entre sí una vez mergeado el 3. **El punto 4 sale de la misma primitiva que el punto 1** — es la misma búsqueda literal con otra UI encima —, por eso van juntos: separarlos significaría escribir dos veces el mismo matcheo.

**Cierra de paso un hueco preexistente**: el cliente no tiene dimensiones reales de página (`PageCanvas` las estima en `pageLayout.ts`, con un comentario reconociéndolo). El hit-test las necesita, así que `getPageSize` corrige esa aproximación.

**Dos cosas asumidas conscientemente**: la búsqueda es exacta —insensible a mayúsculas y acentos, pero "J. Pérez" no encuentra "José Pérez"—, anotada como trabajo futuro en `Future_Ideas.md`; y cada agregado dispara `finishSession`, así que los índices de los grupos ya vistos pueden correrse (ADR-028 se conserva intacto, decisión explícita).

### Hito 10.8 — Texto rotado y páginas con texto nativo parcial

No sale de `Cambios para hacer.txt`: sale de **probar la herramienta sobre una pericia judicial real**. Sobre ese documento, una página se anonimizaba mal de dos formas independientes, y las dos son bugs con respuesta correcta conocida — no decisiones de producto.

**Paso 0 — las palabras de OCR salían en píxeles** (ADR-064). Apareció al especificar el paso 2 y **lo bloquea**, pero es un defecto vivo e independiente del hito: `03_Data_Model.md` §137 exige que todo `bbox` esté en puntos PDF, y el kernel de OCR devolvía los píxeles crudos de Tesseract sobre una imagen rasterizada a `ocr.dpi / 72` — **4,1667×** con el default de 300 DPI. No existía la conversión inversa en ningún lado del Core, y `render-engine` los volvía a escalar al pintar, asumiéndolos puntos. Resultado: **en toda página escaneada la censura caía fuera de lugar y el dato sensible quedaba a la vista**. Ningún test lo detectaba porque ninguno fija el espacio de coordenadas. El fix es de un módulo: el kernel convierte con `pt = px · 72 / dpi`, después de ordenar para que la tolerancia de misma-línea siga siendo de 1px y el orden quede bit-idéntico.

**Paso 1 — el bbox del texto rotado** (ADR-063). `convertTextItemsToWords` usa solo la traslación de la matriz de PDF.js e ignora `[a, b, c, d]`, que es donde vive la rotación. Un sello de firma vertical (matriz `[0, 16, -16, 0]`) producía una caja de 173×16 pt horizontal donde el texto real ocupa 16×173 pt vertical: cajas que **no se solapan**, y la errónea invadía la imagen de la firma. Se resuelve derivando la geometría de la matriz completa y tomando la envolvente axis-aligned del paralelogramo del run. Para 0° la fórmula nueva es idéntica a la anterior, así que el texto horizontal no puede regresionar. No toca `BoundingBox` ni el orden de lectura. El texto rotado no es exótico: sellos, marcas de agua y folios laterales de expedientes se dibujan a 90° y aparecen en **todas** las páginas.

**Paso 2 — OCR de páginas con texto nativo parcial** (ADR-065; requiere el paso 0 mergeado). `requiresOCR = words.length === 0`: basta **una** palabra nativa para que la página nunca vaya a OCR. En la pericia, la firma digital aportaba esa palabra, y por eso el 55% de la página —una imagen con el fiscal responsable adentro— no se escaneó nunca. El dato salió sin anonimizar. El diseño está calibrado contra seis arquetipos de página (medición previa al ADR): una compuerta por presencia de image XObjects vía `getOperatorList()` —**3,7 ms/página**, 0,7 s en 200 páginas contra 160 s de presupuesto— y una segunda por **mayor rectángulo vacío inscrito dentro de cada imagen, normalizado por el área de esa imagen**. Esa normalización es lo que separa un escaneo ya buscable (11-20%, el hueco es una franja de margen) de una imagen con texto oculto (102% en el caso real): dos métricas más simples —área de imagen sin texto, y mayor región contigua— se probaron primero y **fallan** sobre el escaneo con capa OCR, que es el falso positivo que haría 10x más lento cualquier expediente escaneado. El recorte que devuelve la métrica es, literalmente, lo que se manda a OCR: se OCR-ea la región, no la página, y por construcción no hay solapamiento con texto nativo, así que la fusión es concatenación y no necesita dedupe.

| # | PR | Módulo | Estado |
|---|---|---|---|
| 1 | ADR-063 + `PDF_Engine.md` (docs) | — | ✅ |
| 2 | Geometría del bbox desde la matriz completa | `pdf-engine` | ✅ |
| 3 | ADR-064 + `OCR_Engine.md`, `Orchestrator.md`, `PDF_Engine.md` (docs) | — | ✅ |
| 4 | Conversión px→pt en el kernel de OCR | `ocr-engine` | ✅ |
| 5 | ADR-065 + `Contracts.md`, `Render_Engine.md`, `PDF_Engine.md`, `OCR_Engine.md`, `Orchestrator.md`, `03_Data_Model.md` (docs) | — | ✅ |
| 5b | `OcrRegion` | `shared` | ✅ |
| 6 | Región en `rasterizePage` | `render-engine` | ✅ |
| 6b | `RasterizePagePayload.region` + docs del protocolo, y limpieza del tipo local | `shared`, `render-engine` | ✅ |
| 7 | Compuertas 1 y 2, `fuseOcrRegion`, decoder | `pdf-engine` | ✅ |
| 7b | Fixtures del façade y de integración adaptados a `ocrRegions` y al `OPS` real | `tests/`, façade | ✅ |
| 8 | Cableado del stage de OCR por región | `packages/anonymization-core/src` | ✅ |
| 9 | **Test de integración de punta a punta** (ADR-065, Validación) | `tests/integration` | ⬜ |
| 10 | **Verificación manual sobre la pericia real** | — | ⬜ |

Las filas `b` no estaban en el plan original: salieron de ambigüedades que los implementadores detectaron y reportaron en vez de decidir en silencio (`AI_Development_Guide.md` §5). Las dos últimas son lo que falta para cerrar el hito.

Los pasos 1 y 2 son independientes entre sí: el orden 1→2 es por tamaño y aislamiento, no por dependencia técnica (se verificó que el bbox erróneo **no** corrompe la métrica de la compuerta 2 en el documento medido: 55,5% contra 55,1%). El paso 0, en cambio, **sí** bloquea al 2: no se puede especificar la traducción de coordenadas de un recorte cuando la de la página entera está rota.

**Dos cosas que este hito deja anotadas y no resuelve**, las dos por decisión explícita del humano: el **riesgo latente de solapamiento** (ADR-063 §6) — un bbox correcto sobre un sello que pisa el cuerpo del texto tapa lo que hay debajo, medido en 10-14 fragmentos por página, hoy inactivo porque nada dentro de ese sello se detecta; y la **discrepancia de rotación a nivel de página** (ADR-063 §7) — `Render_Engine.md` §13 caso 15 promete una garantía que el motor no da, sin ningún dato para calibrarla porque las páginas medidas tienen `rotate = 0`.

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
| Recuperabilidad info original | 0% | `no-recuperability` test, **más `no-recuperability-with-legend`** (ADR-059 §7): la página de leyenda es la única del export con capa de texto, así que es el único lugar donde un valor original podría entrar por error |
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
| La calibración del repintado de línea produce costura visible en documentos reales | media | medio | el criterio de aceptación es visual y es gate del PR 5 (ADR-058 §11), con cuatro documentos en browser real. Si canta, el escalón siguiente está anotado: extender `Word` con `fontName` y la escala de la matriz. El paso 1 garantiza que igual no se derrame nada |
| El usuario cree que el agregado manual falló porque no encuentra las variantes | media | bajo | la búsqueda es exacta por decisión (ADR-061 §2); el diálogo lo dice por adelantado en vez de dejar que se descubra. La búsqueda difusa está anotada en `Future_Ideas.md` §5.1b, no olvidada |
| Una ocurrencia manual desaparece tras un `reanalyze` | baja | **alto** | el Orchestrator retiene los literales manuales y los re-aplica tras cualquier re-detección (ADR-061 §5). Sin eso el dato se exporta sin anonimizar **en silencio**; hay un test unitario dedicado a ese modo de falla |
| Se incumple la atribución CC-BY de las fuentes del léxico | media | alto | las dos licencias exigen crédito **visible en el producto**, no solo en el README (ADR-060 §11). Va como ítem propio del checklist del PR 11, con procedencia y hash auditables al estilo ADR-018 |
| Se infiere un género equivocado y se imprime en el documento | baja | alto | la fuente base es el registro civil y marca los unisex con `A` (ADR-060 §9); ante ausencia, `A` o baja probabilidad, **no se decide**: token neutro y marca en el árbol. Sin heurística de terminación. El override del usuario gana siempre |

---

## 7. Referencias

- `00_Project_Vision.md` §7 (métricas)
- `01_Technical_Architecture_Document.md` (arquitectura completa)
- `roadmap/Version_1.0.md` (qué sigue)
- `adr/ADR-001-Framework.md` a `ADR-012-Replacement-Modes.md`
- `adr/ADR-057` (escalera de abreviaturas) — `adr/ADR-058` (repintado de línea) — `adr/ADR-059` (leyenda de marcadores) — `adr/ADR-060` (reemplazo por género) — `adr/ADR-061` (agregado manual de entidades): los cinco de los Hitos 10.5 a 10.7
- `ai/AI_Development_Guide.md` (cómo se implementa)
