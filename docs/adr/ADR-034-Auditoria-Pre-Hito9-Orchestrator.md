<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Render_Engine.md,core/Grouping_Engine.md,core/Export_Engine.md,core/Contracts.md,architecture/04_Event_System.md,architecture/06_Pipeline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-033-Test-Infra-Global-Scripts-Alias.md | audiencia=humanos+IA | fase=9 -->

# ADR-034 — Auditoría pre-Hito 9: rasterización OCR vía Render, sesiones de Grouping, salida codificada de Render y matriz de eventos canónica

- **Estado**: Accepted
- **Fecha**: 2026-07-16
- **Decidido por**: El humano, sobre auditoría del planificador previa al Hito 9 (precedente ADR-032, auditoría pre-Hito 8)
- **Relacionado con**: ADR-013/ADR-021 (pools llegan en Hito 9), ADR-014 (mediación del Orchestrator), ADR-030 (`loadDocument`), ADR-031 §5 (pendientes blob/stress), ADR-032 (`EncodedPageImage`, `EXPORT_REQUESTED`), ADR-033 (test-infra global)

## Contexto

La auditoría del spec `core/Orchestrator.md` (v1.0.0, 2026-07-07) previa al Hito 9 encontró que el spec es **anterior** a los cierres de los Hitos 7 y 8: no incorpora las responsabilidades que ADR-030/031/032/033 le difirieron. Además, cuatro ambigüedades de diseño frenarían al implementador:

1. **Rasterización imposible según el propio spec**: §2 asigna al Orchestrator rasterizar páginas sin texto a `ImageData` (con PDF.js según `06_Pipeline.md` §4), pero §5 le prohíbe `pdfjs-dist` — y ningún motor expone rasterización (`PDF_Engine.md` no tiene método alguno; `OCR_Engine.md` §3 la declara "tarea del host o de un RenderWorker ligero"; Render produce `ImageData` pero `renderPage` emite `PREVIEW_UPDATED` como efecto y `loadDocument` estaba especificado recién para la etapa 8).
2. **Nadie invoca `GroupingEngine.startSession`/`finishSession`**: la implementación de Grouping (Hito 6) solo auto-finaliza al recibir **ambos** `REGEX_FINISHED` y `NER_FINISHED` (`grouping.engine.ts`, `maybeFinishSession`), y nunca consulta `config.ner.enabled`. Con NER desactivado (caso límite 6 del spec del Orchestrator) `GROUPING_FINISHED` nunca se emite y el pipeline cuelga; sin `startSession`, toda ocurrencia se descarta por sesión inexistente.
3. **`RenderPageProvider` sin fuente de bytes**: el Orchestrator implementa `RenderPageProvider.renderFull → EncodedPageImage` (ADR-032), pero `RenderPageOutput` solo expone `imageData: ImageData` (el `imageFormat` del input no tiene salida observable) y `07_Performance_Strategy.md` §10 manda codificar con `convertToBlob` donde vive el canvas, no en main thread (§12 del spec prohíbe trabajo pesado al Orchestrator).
4. **Matriz emisor→receptor inconsistente con las suscripciones reales** — y su test de contrato es entregable del Hito 9: `PIPELINE_CANCELLED` declaraba receptores "todos los engines" y `DOCUMENT_CLOSED` "todos", pero PDF/OCR/Regex/NER/Export no registran ninguna suscripción (invariante "PdfEngine has no bus subscriptions", ADR-014); `REGEX_FINISHED`/`NER_FINISHED` omitían a Grouping como receptor (su spec §15.5 y su implementación sí se suscriben); la fila Orchestrator→todos ✓ no reflejaba suscripciones.

## Decisión

### 1. La rasterización para OCR es de Render: `rasterizePage`

`RenderEngine` gana un método público (spec de Render a v1.2.0):

```ts
rasterizePage(
  documentId: string,
  pageIndex: number,
  scale: number,
  ctx: EngineContext
): Promise<ImageData>;
```

- **Sin emisión de eventos** (no es un preview: no emite `PREVIEW_UPDATED` ni toca el cache LRU).
- Precondición: documento cargado vía `loadDocument` (`InvalidInputError` si no; ADR-030). Errores: `RENDER_PAGE_FAILED` (retryable) ante fallo de pdfjs/canvas.
- El Orchestrator **adelanta `loadDocument` a la etapa 2** cuando `textlessPages.length > 0` (los bytes retenidos de la etapa 0 ya existen, ADR-030); si no hay páginas sin texto, `loadDocument` queda donde estaba (antes del primer preview, etapa 8). `loadDocument` es una vez por documento: en la etapa 8 no se repite si ya se cargó en la 2.
- El Orchestrator computa `scale = ctx.config.ocr.dpi / 72` y transfiere el `ImageData` resultante al `OcrPool` (zero-copy, 05 §2.3).
- En modo pool (este mismo hito), `rasterizePage` corre como job del `RenderPool` — es el "RenderWorker ligero" que `06_Pipeline.md` §4 ya insinuaba.

**Alternativas rechazadas**:

| Alternativa | Por qué no |
|---|---|
| `PdfEngine.rasterizePage` (reutiliza el `PDFDocumentProxy` del parseo) | Mezcla perfiles parse (texto) y render (canvas) en `PdfPool`, contra `05_Worker_Architecture.md` §1.1 ("no se mezclan tipos en un mismo pool"); expande el scope del motor de extracción; `PdfWorker` necesitaría OffscreenCanvas y recalibrar presupuestos de memoria. |
| Orchestrator con excepción para `pdfjs-dist` | Trabajo pesado en main thread (A-9), doble ownership de pdfjs, tests del coordinador con wasm. La prohibición de libs externas en el Orchestrator es estructural: un dueño por librería habilita mockear fronteras (ADR-021 §5), lazy-load por motor (gate de bundle) y reemplazo sin tocar al coordinador. |

### 2. El Orchestrator gestiona la sesión de Grouping

- `grouping.startSession(documentId)` se invoca **al iniciar la etapa de detección** (antes de despachar Regex/NER), una vez por documento.
- Si `ctx.config.ner.enabled === false`: el Orchestrator invoca `grouping.finishSession(documentId)` tras recibir `REGEX_FINISHED` (el despacho síncrono del bus, `04_Event_System.md` §13, garantiza que todos los `ENTITY_FOUND` de Regex ya fueron procesados por Grouping en ese punto).
- Con NER activo, el auto-finish existente de Grouping (ambos `*_FINISHED`) **no cambia**; `finishSession` ya es defensivo ante sesión inexistente/finalizada (warn + no-op).
- La limpieza en `DOCUMENT_CLOSED` no cambia: Grouping ya se suscribe y libera su sesión.

### 3. `RenderPageOutput.encoded` y promoción de `EncodedPageImage` a `@anonly/shared`

- `RenderPageOutput` gana `readonly encoded?: EncodedPageImage`, **presente cuando `mode === "full"`**: bytes codificados con el `imageFormat` efectivo (default `"jpeg"` para full) y `ctx.config.render.jpegQuality`, generados donde vive el canvas (`convertToBlob` en el worker en modo pool; en el lado host inline), consistente con `07_Performance_Strategy.md` §10. `imageData` se mantiene requerido (los consumidores de Hito 7 no cambian).
- El `RenderPageProvider` del Orchestrator mapea `renderPage({ kind: "anonymized", mode: "full", replacements, imageFormat, ... }) → output.encoded`.
- `EncodedPageImage` (forma intacta de ADR-032 §1: `bytes`, `format`, `widthPx`, `heightPx`) se **promueve a `@anonly/shared`** — apareció el segundo consumidor que ADR-032 §Alternativas anticipó (Render lo produce, Export lo consume, Orchestrator lo transporta). Definición canónica en `Contracts.md` §7; `export-engine` pasa a re-importarlo. El cambio de código viaja en el PR del hito (patrón ADR-029 §4 / ADR-031 §1: docs primero).

### 4. Matriz canónica: "receptor" = suscripción real al bus

El test de contrato de la matriz (`04_Event_System.md` §11, Hito 9) valida **suscripciones registradas**, no flujo lógico. Correcciones a `04_Event_System.md`:

- `PIPELINE_CANCELLED`: receptores **UI** (los motores no se suscriben; la cancelación les llega por `AbortSignal`/`CANCEL` a pools, `05` §3).
- `DOCUMENT_CLOSED`: receptores **Orchestrator, Grouping Engine** (los demás motores liberan por invocación directa del Orchestrator: `PdfEngine.releaseDocument`, `RenderEngine.unloadDocument`, caches/blobUrls — ADR-020 §7, ADR-021 §7, ADR-030).
- `REGEX_FINISHED` / `NER_FINISHED`: ganan **Grouping Engine** como receptor (además del Orchestrator).
- `PDF_PASSWORD_REQUIRED`: la UI se suscribe **directamente** al canal `pdf` (deja de decir "vía Orchestrator"); el Orchestrator también lo escucha, solo para dejar el stage en `Extracting` a la espera de `retryWithPassword`.
- Matriz §11: fila Orchestrator emite solo hacia UI (✓ UI, resto –); celda UI→Export pasa a – (`EXPORT_REQUESTED` lo escucha el Orchestrator, ADR-032 §2).

### 5. Blob URLs: los crean los motores (lado host), el Orchestrator los revoca

- `PREVIEW_UPDATED.canvasBlobUrl` y `EXPORT_FINISHED.blobUrl` los crea el **lado host del motor emisor** (`convertToBlob` + `URL.createObjectURL`), como ya ocurre en el código de Hitos 7/8. En Hito 9, el placeholder inline de Render (bytes crudos sin codificación, ADR-031 §5) se reemplaza por la codificación real.
- El **Orchestrator** se suscribe a `PREVIEW_UPDATED` y `EXPORT_FINISHED`, registra los URLs por clave `(documentId, pageIndex, kind)` (export: por `documentId`) y **revoca el anterior** de esa clave al recibir un reemplazo; en `DOCUMENT_CLOSED` revoca todos (cierra ADR-031 §5 y cumple `07` §8).
- El bullet de §2 del spec del Orchestrator que decía "crear los blobUrl en el host" queda corregido: crear es del motor; **rastrear y revocar** es del Orchestrator.
- **Completado por ADR-052 (2026-07-30) — llegadas tardías**: "en `DOCUMENT_CLOSED` revoca todos" no alcanzaba, porque `PREVIEW_UPDATED`/`EXPORT_FINISHED` pueden llegar **después** del barrido (renders en vuelo que el cierre no cancela) y quedaban registrados para un `documentId` que ningún cierre futuro vuelve a barrer. Regla agregada: ante un `documentId` ya cerrado, el Orchestrator **revoca el URL entrante en el acto** y no lo registra. Ignorarlo sin revocar sería peor que registrarlo: el URL ya existe —lo creó el motor— y nadie más lo va a liberar. El reparto de esta sección no cambia.

### 6. Test-infra del Hito 9: `tests/integration/` y stress

- `tests/integration/` se crea en el Hito 9 con los **pares críticos mínimos**: (a) Regex + NER → Grouping vía `ENTITY_FOUND` (diferido de Hitos 5/6); (b) `OCR_PAGE_FINISHED` → Orchestrator → `PdfEngine.fuseOcrPage` (ADR-014 §Validación); (c) happy path `createCore` → `importDocument` → `PIPELINE_READY` con motores reales y fronteras de libs mockeadas (ADR-021 §5).
- Corre bajo `pnpm test` (el `include` global de `vitest.config.ts` ya la cubre) y gana script `test:integration` con **filtro posicional** (ADR-033); fila nueva en la tabla canónica de gates `07` §11.4.
- Con el primer test: quitar `integration/**` del `exclude` de `tests/tsconfig.json` y agregar alias/`paths` por motor **a demanda** (ADR-033).
- **Stress**: la infra `tests/stress/` y las movidas de los stress de Render (ADR-031 §5) y NER quedan en **Hito 11**, como la tabla de gates ya decía — corrige la mención "→ Hito 9" del roadmap (Hito 5). El comportamiento de pool en Hito 9 se cubre con tests unit/edge del propio paquete (saturación, retries, backpressure; spec §14).

### 7. Erratas y reflejos menores que acompañan

- **Alcance de pools del Hito 9 = los cuatro** (`PdfPool`, `OcrPool`, `NerPool`, `RenderPool`), como ADR-021 ya mandaba ("los ítems de checklist de pools se leen como Hito 9"); el checklist §15.11 del spec del Orchestrator listaba solo `PdfPool`. En modo pool, las `Word[]` de OCR las deposita en `ctx.cache` el lado host del `OcrPool` (ADR-014 §1) y los eventos se emiten siempre en host (ADR-013 §6).
- `WorkerPoolConfig.maxQueuePerPool` pasa de `number` a `Readonly<Record<"pdf" | "ocr" | "ner" | "render", number>>`: el default documentado ("32 PDF/Render, 8 OCR/NER") no era expresable con un escalar. Código en el PR del hito.
- El façade (`IAnonymizationCore`, `IPipelineOrchestrator`, `ImportDocumentInput`, `createCore`) se refleja en `Contracts.md` §3.5 — resuelve el condicional del checklist §15.1 del spec ("si se comparten"): sí se comparten, la UI los importa (`ui/React_Client.md` §2.1/§4).
- `03_Data_Model.md` §18 gana las definiciones de `WorkerJobPayload` y los cinco payloads concretos (`PdfParsePayload`, `OcrPagePayload`, `NerPagePayload`, `RenderPagePayload`, `ExportPagePayload`) — ya existen en `shared/src/types.ts`; `05` §2.1 los referenciaba ahí sin que estuvieran (P-10).
- `ui/React_Client.md` §2.1: `core.stores` no existe en `IAnonymizationCore`; los stores son del adapter.
- `02_System_Diagrams.md` §4 (diagrama maestro de eventos): `DOCUMENT_IMPORTED` estaba atribuido al PDF Engine (lo emite el Orchestrator, `04` §2) y `EXPORT_REQUESTED` dibujado hacia Export (lo recibe el Orchestrator, ADR-032 §2).
- Erratas del spec del Orchestrator (§8/§12): `EXPORT_REQUESTED` y `PREVIEW_UPDATED` faltaban entre los eventos consumidos; el `visibleRange` **no** llega al Orchestrator (la priorización por visibilidad la aplica Render al despachar a su pool); `RENDER_FAILED` agotado encadena a `EXPORT_FAILED` según `06` §12 (no a `PIPELINE_FAILED` directo; a `PIPELINE_FAILED` se llega recién vía `EXPORT_FAILED` agotado, `06` §13).
- El pendiente del Hito 8 (`Replacement.originalValue` ≈ `canonicalValue`, roadmap) se verifica al implementar el provider real: si Render no consume `originalValue`, se documenta y se cierra en el PR del hito.

## Consecuencias

**Positivas**: el spec del Orchestrator queda implementable sin frenadas (sube a v1.1.0 incorporando ADR-030/031/032/033 y este ADR); la clase de ambigüedad "responsabilidad asignada sin capacidad" (rasterización) se resuelve sin romper el principio de un-dueño-por-librería; el cuelgue de pipeline con NER off queda cerrado antes de existir; la matriz que el test de contrato valida es una sola y coincide con el código; `EncodedPageImage` tiene una definición canónica única.

**Negativas**: `RenderPageOutput` transporta `imageData` + `encoded` en renders full (doble representación transitoria por página, secuencial — aceptado por compatibilidad con Hito 7 y simplicidad del contrato); Render gana un método más (`rasterizePage`) que amplía su superficie pública; el Orchestrator asume bookkeeping adicional de blob URLs (mitigado: es exactamente su rol de gestor de recursos del host).

## Referencias

- `core/Orchestrator.md` §2, §5, §8, §12, §13, §15 — `core/Render_Engine.md` §6, §7, §10, §14, §15
- `core/Grouping_Engine.md` §6 — `core/Export_Engine.md` §6 — `core/Contracts.md` §3.5, §6, §7
- `architecture/04_Event_System.md` §2, §3, §5, §10, §11 — `architecture/06_Pipeline.md` §4, §10 — `architecture/07_Performance_Strategy.md` §8, §10, §11.4
- `adr/ADR-013` §6 — `adr/ADR-014` §1 — `adr/ADR-021` — `adr/ADR-030` — `adr/ADR-031` §5 — `adr/ADR-032` §1, §2 — `adr/ADR-033`
- `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`maybeFinishSession`) — `shared/src/types.ts` (payloads)
