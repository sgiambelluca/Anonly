<!-- CONTEXT: scope=roadmap-mvp | dependencias=00_Project_Vision.md,01_Technical_Architecture_Document.md,adr/ADR-011-Grouping-First.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md | audiencia=humanos+IA | fase=5 (Hito 2 cerrado vía PRs #6, #7; Hito 3 cerrado vía PRs #10, #11, pendiente diferido a Hito 11; Hito 4 cerrado vía PR #13, pendiente diferido a Hito 11) -->

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
- Implementar `ner-engine` con Transformers.js + ONNX. Config canónica `NerConfig` (Contracts.md §6; alias `NerEngineConfig` eliminado) y modelo multilingüe default `Xenova/bert-base-multilingual-cased-ner-hrl` fijados en `adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md`.
- Modelo NER servido first-party (`env.allowRemoteModels = false`, `env.localModelPath`): agregar la entrada del modelo (URL de origen + `revision` + `sha256` + `sizeBytes`, destino `public/models/ner/`) a `assets.lock.json` y correr `pnpm assets:mirror` — mismo patrón que OCR en PR #11 (ver ADR-018, ADR-023 §2).
- Cache del modelo en Cache Storage.
- Los tests de integración con Regex (ambos emiten `ENTITY_FOUND`) viven en `tests/integration/` y son Hito 9 (Orchestrator), **no** de este PR (ADR-010, `core/Orchestrator.md:239`, precedente `core/OCR_Engine.md:225`).
- Pendiente: verificación de integridad en runtime del modelo (ADR-018 punto 3, `core/NER_Engine.md` §15.19) → Hito 11.

### Hito 6 — Grouping Engine
- Implementar `grouping-engine` con matching, conflictos, reglas, fusión/división.
- Tests completos (es el motor más complejo en lógica).

### Hito 7 — Render Engine
- Implementar `render-engine` con OffscreenCanvas, 4 modos, delta render, LRU.
- Tests con visores en headless browser.

### Hito 8 — Export Engine
- Implementar `export-engine` con pdf-lib.
- Tests de `no-recuperability` y `metadata-strip`.

### Hito 9 — Orchestrator
- Implementar según `core/Orchestrator.md` (spec del componente host + façade `createCore`).
- Pipeline orchestrator que secuencia etapas, despacha jobs, maneja cancelación.
- Integración de todos los engines via bus.
- Migración de `pdf-engine` (y demás motores pesados) a sus pools (`PdfPool`, `OcrPool`, `NerPool`, `RenderPool`); `WorkerPoolManager` + `AbortRegistry` (ver ADR-013).
- Wiring Orchestrator→`PdfEngine.fuseOcrPage` para fusión OCR→PDF (ver ADR-014).

### Hito 10 — React Client
- `apps/react-client` con Vite + Tailwind + Radix + Zustand.
- `core-adapter` (bus bridge, actions, snapshots).
- 4 paneles, todos los componentes de `ui/Components.md`.
- E2E con Playwright.

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
