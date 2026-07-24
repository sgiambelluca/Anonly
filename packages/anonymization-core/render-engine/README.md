# @anonly/render-engine

Renderiza páginas del PDF (original o anonimizado) a `ImageData` usando `OffscreenCanvas` + `pdfjs-dist`. Aplica highlight de grupos habilitados en el lado "original" y los 4 modos de reemplazo visual (`mask`/`synthetic`/`placeholder`/`redact`) en el lado "anonimizado". Soporta preview incremental y cache LRU en host.

> Reparto host/worker (ADR-043, Hito 10 PR13): la clase queda entera host-side; el kernel de rasterización/composición vive en `./worker/`. Desde ADR-044, el motor deja de escuchar eventos de `Grouping` — el re-render por cambio de grupo lo media el Orchestrator con invocaciones directas de `renderPage` (reemplazos ya resueltos desde el snapshot de Grouping). Mantiene `{ buffer, pageCount }` por documento (ADR-030/ADR-043 §3): el caller (façade/Orchestrator) entrega el PDF fuente vía `loadDocument`.

## Documentación

- **Spec canónico**: [`docs/core/Render_Engine.md`](../../../docs/core/Render_Engine.md) (v1.5.0)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Pipeline: [`docs/architecture/06_Pipeline.md`](../../../docs/architecture/06_Pipeline.md) §10, §12 (etapas 8 y 10)
- Workers: [`docs/architecture/05_Worker_Architecture.md`](../../../docs/architecture/05_Worker_Architecture.md) §7.4 (RenderWorker; fe de erratas ADR-030 §5: pdfjs-dist, no pdf-lib)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §7, §10
- ADRs relevantes: [`ADR-004`](../../../docs/adr/ADR-004-Rendering.md) (reconstrucción, no redacción in-place), [`ADR-012`](../../../docs/adr/ADR-012-Replacement-Modes.md) (modos de reemplazo), [`ADR-021`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) (motores inline hasta Hito 9), [`ADR-027`](../../../docs/adr/ADR-027-RenderConfig-ExportConfig-Canonical.md) (`RenderConfig` canónico), [`ADR-030`](../../../docs/adr/ADR-030-RenderEngine-LoadDocument.md) (`loadDocument`/`unloadDocument`), [`ADR-031`](../../../docs/adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md) (`EngineErrorCode.RENDER_FAILED` + erratas de cache key/highlight + cast pdfjs↔OffscreenCanvas)

## Contenido

- `render.types.ts` — `RenderPageInput`, `RenderPageOutput` (`RenderConfig` viene de `@anonly/shared`, ADR-027).
- `render.errors.ts` — `RenderPageFailedError`, `RenderTimeoutError`, `RenderFailedError`.
- `render.engine.ts` — clase `RenderEngine` (implementa `IEngine`): `init`, `loadDocument`/`unloadDocument`, `renderPage`, `renderPages`, `rasterizePage`, `dispose`.
- `worker/` — kernel sin estado por documento (pdfjs + OffscreenCanvas + encode, ADR-043); todas las vías de render convergen en `RenderPool.dispatch`.

## Reglas

- Nunca importa otro motor ni React (spec §5). Solo `@anonly/shared` y `pdfjs-dist`.
- `loadDocument`/`unloadDocument`: en modo worker, el host retiene `{ buffer, pageCount }` (los proxies viven en cada worker/kernel, ADR-043 §3); `loadDocument` toma posesión del buffer y recarga determinísticamente; `unloadDocument`/`dispose` liberan los proxies (broadcast `unload-document`/`DISPOSE`). Sin `loadDocument` previo, `renderPage`/`renderPages` lanzan `InvalidInputError`; la vía por evento (`RENDER_REQUESTED`) solo loguea `warn` y no hace nada (ADR-030 §3).
- Decisiones de diseño no triviales, documentadas también como comentario en `render.engine.ts`:
  - `RENDER_REQUESTED` no trae `kind`/`replacements`/`annotations` (Contracts.md §8); el motor reconstruye ambos lados (`original` + `anonymized`) por página a partir del último `RenderPageInput` recordado para esa página (o valores vacíos si nunca se renderizó).
  - (Retirado por ADR-044) El delta render por `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` (índice `pageIndex → groupIds`, `groupOverrides`, `requestDeltaRender`) se retira: el re-render por cambio de grupo lo media el Orchestrator con invocaciones directas de `renderPage`, con reemplazos ya resueltos desde el snapshot de Grouping (`buildPageReplacements`, `export-engine`). El motor pasa a escuchar solo `EventChannel.UI` (`RENDER_REQUESTED`).
  - La clave de cache LRU es `hash(replacements ++ annotations)` (spec §15 item 12, letra corregida por ADR-031 §2 — la versión previa decía `hash(replacements)`, que para `kind: "original"` sin `replacements` colisionaría entre distintos conjuntos de `annotations`).
  - El highlight en `kind: "original"` colorea por `AnnotationKind` (spec §13.7, letra corregida por ADR-031 §3 — `Annotation` no expone `EntityType`, así que no puede colorear "por tipo" como decía la versión previa del spec).
  - `PREVIEW_UPDATED.canvasBlobUrl` lo arma el propio motor (inline, sin host separado en Hito 7) envolviendo los bytes crudos de `ImageData` en un `Blob` con el `imageFormat` solicitado como tipo MIME (sin codificación real de imagen). Aceptado como placeholder de Hito 7 (ADR-031 §5): la codificación real y el armado del blob en el host (spec §7, `convertToBlob`) llegan con el Orchestrator en Hito 9.
  - `renderPageOntoContext` tiene el único `as unknown as` de todo el Core fuera de un helper de test: `pdfjs-dist@4.x` tipa `PDFPageProxy.render({ canvasContext })` como `CanvasRenderingContext2D` (DOM), pero exige `OffscreenCanvas` (spec §1, ADR-030 §5); ambos tipos no tienen overlap estructural suficiente para un `as` simple y los tipos re-exportados por `pdfjs-dist` son alias (no admiten `declare module` merging). Excepción aprobada explícitamente por ADR-031 §4, concentrada en ese único punto del motor.

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
