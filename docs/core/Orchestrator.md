<!-- CONTEXT: scope=orchestrator | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-015-UI-Channel-Canonical.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md | audiencia=IA-implementador | fase=10 (Hito 9 cerrado; transporte de workers Hito 10, ADR-036; método `reanalyze` Hito 10, ADR-038; fusión OCR→PDF como función pura host-side, ADR-041; mediación de grupos→Render para el preview, ADR-044; discriminación de errores por `code` a través del boundary de Worker, ADR-049) -->

# Orchestrator — Spec del Componente Host

> Secuencia las etapas del pipeline, invoca los motores, gestiona los pools de workers y la cancelación, y expone el façade público del Core (`createCore` / `IAnonymizationCore`). Es la **composition root**: el único código del Core autorizado a importar motores.

**Componente**: Orchestrator + façade `@anonly/anonymization-core` (no es un motor: **no tiene `EngineId`** y no implementa `IEngine`; este spec adapta la plantilla de 15 secciones de `ai/Module_Specification_Template.md` a un componente host)
**Ubicación**: `packages/anonymization-core/src/`
**Versión del spec**: 1.7.1
**Última actualización**: 2026-08-08

> **Nota (v1.7.1, 2026-08-08 — el repintado de línea también en el export; sin ADR: no cambia ningún contrato, corrige una enumeración incompleta de la nota v1.6.0)**: la nota de ADR-058 §5 listaba como puntos de enganche de `lineWords` solo `renderMediatedPreview` y las dos construcciones de input que llaman `buildPageReplacements` — **las tres del panel de preview**. Faltaba la cuarta y la única que produce el archivo que el usuario se lleva: el `RenderPageInput` que arma `makeRenderPageProvider.renderFull` para el export, que se construye desde cero sin pasar por `renderMediatedPreview`. Con esa omisión, el repintado de ADR-058 §2-§6 se activa en el preview y **nunca en el PDF exportado**, que sigue cayendo siempre al shrink-to-fit de §1: correcto, pero exactamente la calidad que el ADR existe para mejorar. Peor todavía, el gate manual de ADR-058 §11 se podría verificar contra el preview y dar por bueno un PR cuyo export no tiene el comportamiento — un falso positivo silencioso. Se especifica: `renderFull` adjunta `lineWords` con la misma función pura y el mismo criterio que el preview, tomando `Page.words` del `Document` retenido en `documents`. **No se toca `RenderPageProvider`**: `lineWords` no es un dato que `export-engine` pueda proveer —es un derivado host-side del `Document` retenido, que Export no tiene por qué conocer— y todo lo necesario (`documentId` del closure, `pageIndex` y `replacements` de los parámetros) ya está dentro de `renderFull`. El puerto de `Export_Engine.md` §6 queda literal, sin ADR de contrato: el contraste es con ADR-059 §5, donde `renderLegend` **sí** exigió extender el puerto porque es Export quien decide que hay leyenda y quien compone las filas. **Orden**: este cableado (los cuatro puntos, no solo `renderFull`) va **después** del PR 5 de `render-engine` — el literal `RenderPageInput` no compila hasta que ese motor declara `lineWords` (`Render_Engine.md` §6), y agregarle el campo desde acá mezclaría dos módulos en un commit (R-1). Es `MVP.md` §4 PR **4b**, no un cierre del PR 4.

> **Nota (v1.7.0, ADR-061, 2026-08-06 — agregado manual de entidades y búsqueda en el documento)**: cuatro entradas nuevas en `IPipelineOrchestrator`. `addManualEntity(documentId, { value, entityType })` orquesta el flujo completo —`reopenSession` (ADR-038 §2, preserva ediciones) → `regex.findLiteral` → `ENTITY_FOUND` con `source: Manual` → `finishSession` (ADR-028, renumeración canónica)— **sin agregar ningún camino nuevo**: el dedup por identidad de ADR-038 §3 hace que repetir un valor, o agregar uno ya detectado, se fusione en silencio en vez de duplicar. `findText(documentId, query)` devuelve los matches con sus bboxes para el buscador del visor: es **la misma búsqueda literal** con otra salida, no una implementación paralela. Y `getPageWords`/`getPageSize` exponen por página lo que el cliente hoy no tiene —`document.store` solo guarda `id`/`name`/`pageCount`/`sourceKind`— habilitando el hit-test de selección sobre el canvas y corrigiendo de paso la estimación de dimensiones de `pageLayout.ts`. **Estado retenido nuevo**: la lista de literales manuales por documento, que se **re-aplica después de cualquier re-detección** — sin eso, un `reanalyze` posterior borra las ocurrencias manuales de las páginas afectadas (`dropOccurrences`) y el dato se exporta sin anonimizar, en silencio (ADR-061 §5). Se descarta en `closeDocument`/`dispose` como el resto del estado por documento.

> **Nota (v1.6.0, ADR-059 §5, 2026-08-06 — mediación de la página de leyenda)**: `RenderPageProvider` —el puerto de `export-engine` que este componente implementa— gana `renderLegend(rows, abortSignal): Promise<EncodedPageImage>`, delegando a `RenderEngine.renderLegendPage`. Es la mediación de siempre y por el mismo motivo: `export-engine` no puede importar `render-engine` (P-1) y este componente es el único autorizado a hablarle a los dos. La leyenda se **rasteriza** en vez de dibujarse con `drawText` (ADR-059 §4) para que el export siga siendo 100% imagen sin excepciones; el costo de esa decisión es exactamente este método. Solo se invoca con `ExportOptions.includeMarkerLegend` activo y con al menos una fila; un fallo se propaga como fallo de página del export.

> **Nota (v1.6.0, ADR-058 §5, 2026-08-06 — selección host-side de las palabras de la línea)**: el kernel de Render necesita las palabras vecinas de cada reemplazo para repintar la línea, y `RenderPagePayload` no las transportaba. Se agrega una **función pura host-side** que filtra desde `Page.words` las que comparten línea con cada reemplazo y las adjunta como `RenderPagePayload.lineWords` / `RenderPageInput.lineWords`. Es el **mismo reparto que `fuseOcrPage`** (ADR-041): lógica pura que necesita el `Document` retenido, ejecutada por el Orchestrator, sin estado propio y sin que ningún motor importe a otro. Se adjuntan **solo cuando algún token de esa página podría no entrar**, estimado con `estimateTokenWidth` (`Contracts.md` §6) y con **margen conservador — ante la duda se adjuntan**: adjuntar de más cuesta payload, adjuntar de menos degrada silenciosamente al shrink-to-fit del motor. Incluye palabras de OCR (`source: "ocr"`) igual que las de PDF, que es lo que hace que el repintado funcione en documentos escaneados. Puntos de enganche: `renderMediatedPreview`, las dos construcciones de input que hoy llaman `buildPageReplacements` y —**corregido en v1.7.1**, esta nota los omitía— el `RenderPageInput` de `makeRenderPageProvider.renderFull`, que es el del export. **No se extrae el texto en el worker** —el kernel tiene el `pageProxy` y podría llamar `getTextContent()`— porque en un PDF escaneado eso devuelve vacío: las únicas palabras que existen son las de OCR, que viven en el `Document` que retiene este componente.

> **Nota (v1.5.4, 2026-07-30 — ADR-052: ningún blob URL sobrevive al cierre, ni el que llega tarde)**: `handlePreviewUpdated` y `handleExportFinished` registraban el blob URL entrante **incondicionalmente**. Un `PREVIEW_UPDATED`/`EXPORT_FINISHED` que llegara después del `revokeByPrefix` de `closeDocument` quedaba registrado para un `documentId` que ningún cierre futuro vuelve a barrer: leak permanente. Las fuentes de una llegada tardía son tres, no una: el preview mediado (su `AbortController` propio de la v1.5.1 nunca se aborta), **la vía por evento de Render** (`handleRenderRequested` usa el `ctx` de `init`, así que ningún render de `RENDER_REQUESTED` es cancelable con `abortRegistry.abort(documentId)`) y el export. Se especifica: (a) los dos handlers, ante un `documentId` que ya no está en `state`, **revocan el URL entrante en el acto** + `warn`, y no lo registran —nunca lo ignoran a secas: el URL ya lo creó el motor (ADR-034 §5) y si el Orchestrator no lo toma, nadie lo revoca—; (b) `mediatedPreviewCtx` pasa a un controlador **por documento** que `closeDocument`/`dispose` abortan y `cancelReanalyze` **no** (ADR-038 §6 intacto: inmune a la *cancelación*, no a la *baja*).

> **Nota (v1.5.3, 2026-07-30 — ADR-050: `retryWithPassword` persiste el password y lo propaga a Render)**: `retryWithPassword` armaba el input con la contraseña como variable local y **nunca reescribía `retainedInputs`**. Como `ensureRenderDocumentLoaded` lee ese mismo `retainedInputs`, `RenderEngine.loadDocument` recibía los bytes todavía encriptados y moría con `RenderFailedError("No password given")` → `PIPELINE_FAILED`: el mismo banner genérico, después de que el usuario hubiera ingresado la contraseña **correcta**. Rompía los tres caminos que dependen de la carga en Render (rasterización para OCR, seed del preview de ADR-044 y export en `mode: "full"`), y no dependía del transporte: fallaba igual con pools in-process. Se especifica: `retryWithPassword` **reescribe** `retainedInputs` con el input que incluye el password antes de re-correr el pipeline, y `ensureRenderDocumentLoaded` pasa `retained.password` como tercer argumento de `loadDocument` (ADR-050 §1/§4). El password se borra donde ya se borraba (`closeDocument`/`dispose`).

> **Nota (v1.5.2, 2026-07-30 — ADR-049: el password-required se discrimina por `code`, no por `instanceof`)**: con transporte real de workers (ADR-036 §2/§3), el `PdfPasswordRequiredError` que lanza el motor dentro del Worker llega al host como `DeserializedEngineError` — `postMessage` no transporta prototipos y `EngineError.deserialize()` no reconstruye la subclase (`Contracts.md` §4). El `instanceof PdfPasswordRequiredError` de `handleExtractionFailure` daba `false` y el caso 3 caía a `failPipeline`: el usuario veía el banner genérico de pipeline fallido en vez del `PasswordDialog` (bug reproducible, PR17/Escenario 3). El mismo `instanceof` en el `isRetryable` propio del despacho de `pdf-parse` hacía que el pool además **reintentara** el PDF protegido. Se especifica: la discriminación es por `err.code === EngineErrorCode.PDF_PASSWORD_REQUIRED` (type-guard `isEngineErrorCode` en `src/errors.ts`), y el override de `isRetryable` **se elimina** porque `PdfPasswordRequiredError.retryable` pasa a `false` (ADR-049 §4, cierra el pendiente de ADR-035 §3). Sin cambio de contrato público ni de eventos.

> **Nota (v1.5.1, 2026-07-23 — el seed/flush del preview mediado usa una señal propia, nunca abortada, sin ADR: precisa un detalle de ADR-044 §3 que quedó subespecificado)**: `cancelReanalyze` (ADR-038 §6) invoca `abortRegistry.abort(documentId)` **antes** de `await finishSession(...)`, y recién crea un `AbortController` nuevo después. Como `finishSession`/`GROUPING_FINISHED` corren síncronos (nota de sincronía de cabecera), el seed de ADR-044 que ese `GROUPING_FINISHED` dispara se ejecutaba con la señal **ya abortada** del documento — `RenderEngine.renderPage` rechazaba con `CancelledError` antes de `rememberInput`, así que el seed nunca llegaba a poblar `lastAnonymizedInputs` en ese camino, contradiciendo lo que §3/§13 caso 26 ya afirman ("se renderizan las páginas... `lastAnonymizedInputs` queda poblado"). No reabre el bug 1 (el documento ya estaba en `Ready` antes del `reanalyze`, con el preview ya poblado por un seed/flush previo), pero es una staleness real y evitable. Se especifica: `seedAnonymizedPreview`/`flushDirtyPages` arman su `EngineContext` con una señal **propia, nunca ligada a `abortRegistry`** (no la del documento, que sí debe seguir siendo cancelable para OCR/NER/export) — consistente con que ADR-044 §3 ya declara estos renders "best-effort... inmunes al supersede"; ahora también son inmunes a la cancelación del documento, sin tocar el orden `abort`/`finishSession` de `cancelReanalyze` (ADR-038 intacto).

> **Nota (ADR-044, 2026-07-23 — el preview anonimizado recibe los reemplazos reales por mediación del Orchestrator)**: el Orchestrator se suscribe a `ENTITY_GROUP_CREATED`/`ENTITY_GROUP_UPDATED`/`ENTITY_GROUP_REMOVED` (canal `grouping`), computa los reemplazos autoritativos desde `grouping.getSnapshot(documentId)` con `buildPageReplacements` (compartida con `export-engine`, que la exporta desde su `index.ts`) e invoca `RenderEngine.renderPage({ kind: "anonymized", mode: "preview", replacements })` directo — patrón ADR-014, call site directo preexistente por ADR-043. Seed inicial en el handler de `GROUPING_FINISHED` (incluida la vía suprimida por cancelación de `reanalyze`, ADR-038 §6); ediciones posteriores acumulan páginas sucias y se coalescen en un flush por microtask (§13 casos 26–27). El RenderEngine deja de escuchar `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` (retiro sancionado por ADR-044 §2; `Render_Engine.md` v1.5.0). Cierra el deadlock de arranque del preview (primer render `anonymized` con `replacements: []` irreversible) y el toggle off→on lossy del delta render por overrides.

> **Nota (v1.4.1, 2026-07-23 — visor en blanco para documentos con texto nativo, sin ADR: no cambia ningún contrato, restaura una invariante ya especificada en §2)**: la invariante de §2 ("invocar `RenderEngine.loadDocument(documentId, buffer)` una sola vez por documento: en la etapa 2 si `textlessPages.length > 0`, si no antes del primer preview") nunca se materializó para la rama `else` — el único call site fuera de `runOcrStage` era `runExport` (§13 casos 23/24). Un documento con texto nativo (sin páginas `textless`) llegaba a `Ready` con el documento **sin cargar** en `RenderEngine`; la UI monta el visor y emite `RENDER_REQUESTED` en cuanto observa `Ready` (antes de cualquier export), y `RenderEngine` lo descarta con un `warn` silencioso por documento no cargado (`Render_Engine.md` §8) — el preview queda en blanco indefinidamente (hasta que algún export posterior dispare el primer `loadDocument` real). Se especifica: el Orchestrator invoca `RenderEngine.loadDocument` también al cerrar la etapa de extracción cuando `textlessPages.length === 0` (mismo guard idempotente `renderLoadedDocuments`, misma copia `slice(0)` del buffer retenido que ya usan `runOcrStage`/`runExport`), **antes** de iniciar la etapa de detección — y por lo tanto antes de la cascada síncrona que termina en `PIPELINE_READY` (ver la nota de sincronía de cabecera de `orchestrator.ts`: el fix no puede vivir dentro de `handleGroupingFinished`, que debe seguir resolviendo síncrono). Ver §13 caso 25 y §14 (test nuevo + corrección del test de caso 23 que fijaba el bug como comportamiento esperado).

> **Nota (ADR-041, 2026-07-22)**: la fusión OCR→PDF mediada (ADR-014) pasa a invocar la **función pura** `fuseOcrPage(document, pageIndex, words)` de `pdf-engine` — síncrona, host-side, con el `Document` retenido por el Orchestrator como entrada y su resultado persistido como copia canónica. `PdfEngine.releaseDocument` desaparece (el motor ya no retiene documentos); `closeDocument` deja de invocarlo. La ejecución síncrona en el handler de `OCR_PAGE_FINISHED` elimina la carrera lost-update entre fusiones cercanas.

> **Nota (ADR-040, 2026-07-22)**: `Done` es el equivalente operativo de `Ready` ("`Ready` con un export ya completado", informativo para la UI, no restrictivo): `reanalyze` acepta `stage ∈ {Ready, Done, Failed}` (§13.21; amenda la precondición de ADR-038). Sin transición `Done → Ready` ni cambio de `PipelineStage`.
**Estado de implementación**: implementado (Hito 9, PR #19; pools en modo in-process — ADR-035 §1). Pendientes de Hito 10: transporte por Web Workers reales vía `CoreRuntimeOptions` (ADR-036 §2); método `reanalyze` para re-análisis parcial preservando ediciones (ADR-038 §1, §5-§6).

> **Nota (ADR-034, 2026-07-16)**: este spec incorpora los cierres de Hitos 7–8 que le fueron diferidos y las decisiones de la auditoría pre-Hito 9: rasterización para OCR vía `RenderEngine.rasterizePage` (§2, §8); gestión de la sesión de Grouping (`startSession`/`finishSession`, incluido el caso NER desactivado — §2, §13.6); `RenderPageProvider` implementado sobre `RenderPageOutput.encoded` (§2); blob URLs creados por los motores y **revocados** por el Orchestrator (§2, §8); consumo de `EXPORT_REQUESTED` y `PREVIEW_UPDATED` (§8, ADR-032/031); `RenderEngine.loadDocument`/`unloadDocument` y retención del buffer original (§2, ADR-030); migración a los **cuatro** pools (§15.11, ADR-021).
>
> **Nota (v1.2.1, 2026-07-22 — bug #6 del Escenario 1 E2E, sin ADR: no cambia ningún contrato, restaura invariantes ya especificadas)**: la invariante de §2/§12 ("lo entregado a un motor es una copia; el buffer retenido nunca se reutiliza tras una transferencia") quedó sin materializar cuando ADR-035 dejó los pools in-process: el Orchestrator pasaba `input.buffer` (el retenido) directo a `PdfEngine.process`, y `pdfjs-dist` lo **transfiere a su worker interno** (configurado real desde el Hito 10 PR10 vía `GlobalWorkerOptions.workerSrc`), dejándolo detached (`byteLength = 0`). La primera víctima es `RenderEngine.loadDocument` (rechaza con `InvalidInputError` por buffer vacío) — en `runExport` para PDFs con texto, en `runOcrStage` para escaneados. Se especifica explícito: **toda entrega de bytes del documento a un motor es una copia (`slice(0)`)**; el retenido es del Orchestrator y jamás sale de él (§13.23). Segunda parte del bug: en `runExport`, `loadDocument` corría **fuera** del `try/catch` que enruta a `failPipeline`, y como `EXPORT_REQUESTED` dispara con `void enqueueExport(...)`, el rechazo era un unhandled rejection silencioso — pipeline congelado sin `EXPORT_FAILED`. Se especifica: toda la preparación del export (incluido `loadDocument` y el guard de buffer retenido ausente, que pasa a lanzar en vez de log-warn-return) queda dentro del `try/catch` → `failPipeline`, y el handler de `EXPORT_REQUESTED` agrega un `.catch` terminal de última instancia (§13.24). Los tests en Node nunca lo detectaron: mockean `pdfjs-dist` (ADR-021 §5), que sin worker real no transfiere nada.

---

## 1. Objetivo

Coordinar el ciclo de vida completo de un documento (etapas 0–11 de `06_Pipeline.md`) sin que ningún motor conozca a otro: el Orchestrator escucha los eventos de fin de etapa, decide la etapa siguiente, invoca al motor correspondiente y mantiene el `PipelineState` observable por la UI.

---

## 2. Responsabilidades

- Exponer `createCore(config)` que instancia bus, engines, pools y orchestrator, y devuelve `IAnonymizationCore`.
- Secuenciar las etapas del pipeline según `06_Pipeline.md`: extracción → OCR (si `textlessPages.length > 0`) → normalización → Regex → NER → agrupación → conflictos → preview → edición → render → export.
- Emitir los eventos del canal `pipeline`: `DOCUMENT_IMPORTED`, `PIPELINE_STAGE_CHANGED`, `PIPELINE_PROGRESS`, `PIPELINE_READY`, `PIPELINE_CANCELLED`, `PIPELINE_FAILED`.
- Invocar directamente los motores de entrada/salida pura (`PdfEngine.process`, `OcrEngine.processPages`, `RegexEngine.process`, `NerEngine.processPages`) — estos motores no se suscriben al bus (ADR-014).
- Mediar la fusión OCR→PDF: escuchar `OCR_PAGE_FINISHED`, leer las `Word[]` de `ctx.cache` (clave `ocr-words:<documentId>:<pageIndex>`) e invocar la función pura `fuseOcrPage(document, pageIndex, words)` de `pdf-engine` con el `Document` retenido, persistiendo el resultado como copia canónica — síncrono, host-side, sin pasar por `PdfPool` (ADR-014, ADR-041). En modo pool, las `Word[]` las deposita en `ctx.cache` el lado host del `OcrPool` (ADR-014 §1).
- Retener el `ArrayBuffer` original de la etapa 0 (lo transferido a `PdfPool` es una copia, `06_Pipeline.md` §3) e invocar `RenderEngine.loadDocument(documentId, buffer)` **una sola vez por documento**: en la etapa 2 si `textlessPages.length > 0`, si no antes del primer preview (etapa 8) (ADR-030, ADR-034 §1).
- Obtener el `ImageData` de páginas sin texto para el OCR Engine vía `RenderEngine.rasterizePage(documentId, pageIndex, scale, ctx)` con `scale = ctx.config.ocr.dpi / 72` (ADR-034 §1; el Orchestrator **no** rasteriza por sí mismo — no puede importar pdfjs, §5).
- Gestionar la sesión de Grouping: invocar `grouping.startSession(documentId)` al iniciar la etapa de detección (antes de despachar Regex/NER); si `ctx.config.ner.enabled === false`, invocar `grouping.finishSession(documentId)` tras `REGEX_FINISHED` (ADR-034 §2). Con NER activo, Grouping auto-finaliza al recibir ambos `*_FINISHED`.
- Re-analizar un documento ya cargado (`reanalyze`, ADR-038 §1) sin perder las ediciones manuales del usuario: mantener una `EngineConfig` efectiva por documento que el patch actualiza, reabrir la sesión de Grouping (`grouping.reopenSession`) en vez de crear una nueva, invocar `grouping.dropOccurrences` para las ocurrencias que dejan de ser válidas, y re-despachar solo los motores de detección/OCR afectados por el patch (§13.18-§13.21, ADR-038 §5).
- Ejecutar la etapa de normalización (`shared`) en main thread.
- Gestionar `WorkerPoolManager` y `AbortRegistry` (`05_Worker_Architecture.md`): creación perezosa de pools, timeouts, reintentos con backoff, backpressure (pausar ingest ante `WORKER_POOL_SATURATED`), traducción de eventos `WORKER_*` a eventos funcionales.
- Gestionar la cancelación: escuchar `CANCEL_REQUESTED`, abortar el `AbortController` del `signalId`, propagar `CANCEL` a los pools, emitir `PIPELINE_CANCELLED` (SLA < 200 ms, `05_Worker_Architecture.md` §3).
- Escuchar `EXPORT_REQUESTED` (canal `ui`): armar `ExportEngineInput` (documento, grupos/reglas desde `grouping.getSnapshot`, `options`) e invocar `ExportEngine.export()` directamente — Export no se suscribe a eventos (ADR-032 §2, patrón ADR-014).
- Implementar el `RenderPageProvider` (preconfigurado con las `ExportOptions` del request) sobre `RenderEngine.renderPage({ kind: "anonymized", mode: "full", ... })`, devolviendo `output.encoded` (`EncodedPageImage`; ADR-034 §3), e inyectarlo al Export Engine (`core/Export_Engine.md` §6). El `RenderPageInput` que arma `renderFull` adjunta `lineWords` con la **misma** función pura y el mismo criterio que el preview (ADR-058 §5, v1.7.1): sin eso el repintado de línea no existe en el PDF exportado. La firma del puerto **no cambia** — `lineWords` sale del `Document` retenido, no de Export.
- Mediar el estado de grupos hacia el preview (ADR-044): escuchar `ENTITY_GROUP_CREATED`/`UPDATED`/`REMOVED`, mantener por documento el mapa `groupId → Set<pageIndex>` (alimentado por los payloads; limpiado en `DOCUMENT_CLOSED`) y re-renderizar las páginas afectadas vía `RenderEngine.renderPage({ kind: "anonymized", mode: "preview", replacements })` con los reemplazos computados del snapshot de Grouping (`buildPageReplacements`). Seed inicial en `GROUPING_FINISHED`; flush coalescido por microtask fuera de las etapas pre-`Ready` (§13 casos 26–27). Errores de estos renders: `warn` + continuar (preview best-effort, nunca `PIPELINE_FAILED`).
- Gestionar el ciclo de vida de los blob URLs: los **crean** los motores en su lado host (`PREVIEW_UPDATED.canvasBlobUrl`, `EXPORT_FINISHED.blobUrl`); el Orchestrator los registra por clave (`documentId`, `pageIndex`, `kind` — export: por `documentId`), **revoca el anterior** de la clave al recibir un reemplazo, y revoca todos en `DOCUMENT_CLOSED` (ADR-034 §5, ADR-031 §5, `07_Performance_Strategy.md` §8).
- Serializar OCR y NER (no paralelos) cuando `deviceMemory < 4` GB (`07_Performance_Strategy.md` §5.1, §7.1).
- Encolar exports: un segundo `EXPORT_REQUESTED` durante un export en curso se encola, no se superpone (`07_Performance_Strategy.md` §11.6).
- Liberar todos los recursos ante `DOCUMENT_CLOSED`: invocar `RenderEngine.unloadDocument(documentId)` (ADR-030; patrón general para motores con estado por documento, ADR-021 §7), soltar el buffer retenido, limpiar caches y revocar blobUrls; Grouping limpia su sesión por suscripción propia. Desde ADR-041, `PdfEngine` no retiene documentos y no requiere liberación (`releaseDocument` eliminado). Los pools se disponen tras 60 s idle.
- Mantener `PipelineState` por documento, consultable vía `getState`.

---

## 3. Fuera de alcance

- Parsear, detectar, agrupar, renderizar o exportar (eso es de los motores; el Orchestrator solo coordina).
- Conocer React ni ningún framework de UI.
- Contener lógica de anonimización o decisiones de reemplazo.
- Resolver conflictos entre detectores (Grouping Engine).
- Persistir documentos, hacer network.
- Validar patches de grupos/reglas (Grouping Engine escucha el canal `ui` directamente, ver `core/Grouping_Engine.md` §8).

---

## 4. Dependencias permitidas

Como composition root, es el **único** paquete del Core que puede importar motores (excepción a P-2 documentada en `ai/Code_Standards.md` §12):

- `@anonly/shared` (tipos, contratos, error codes)
- `@anonly/event-system` (bus)
- `@anonly/pdf-engine`, `@anonly/ocr-engine`, `@anonly/regex-engine`, `@anonly/ner-engine`, `@anonly/grouping-engine`, `@anonly/render-engine`, `@anonly/export-engine`
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `EngineConfig`, `PipelineState`, `PipelineStage`, `WorkerJob`, `WorkerPoolConfig`, `ICache`, `ILogger`, `IEventBus`

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib` (las libs externas pertenecen a los motores, nunca al Orchestrator)
- Node builtins (`fs`, `http`), libs de network

---

## 6. Interfaces públicas

```ts
export interface IAnonymizationCore {
  readonly bus: IEventBus;
  readonly engines: {
    readonly pdf: PdfEngine;
    readonly ocr: OcrEngine;
    readonly regex: RegexEngine;
    readonly ner: NerEngine;
    readonly grouping: GroupingEngine;
    readonly render: RenderEngine;
    readonly export: ExportEngine;
  };
  readonly orchestrator: IPipelineOrchestrator;
  dispose(): Promise<void>;
}

export interface ImportDocumentInput {
  readonly documentId: string;        // UUID v4 generado por el caller
  readonly name: string;
  readonly buffer: ArrayBuffer;       // PDF binario
  readonly password?: string;
}

export interface ReanalyzeConfigPatch {
  readonly ner?: { readonly enabled: boolean };
  readonly ocr?: { readonly languages: ReadonlyArray<string> };
}

export interface IPipelineOrchestrator {
  importDocument(input: ImportDocumentInput): Promise<void>;   // dispara etapas 0..7 (hasta Ready)
  retryWithPassword(documentId: string, password: string): Promise<void>;
  reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void>;
  cancel(documentId: string, jobId?: string): Promise<void>;
  closeDocument(documentId: string): Promise<void>;
  getState(documentId: string): PipelineState;
  dispose(): Promise<void>;
}

export async function createCore(config?: Partial<EngineConfig>, runtime?: CoreRuntimeOptions): Promise<IAnonymizationCore>;
```

Notas:

- `importDocument` emite `DOCUMENT_IMPORTED` y encadena las etapas automáticas (1–7). No espera a la edición: resuelve cuando el pipeline llega a `Ready`, `Failed` o `Cancelled`.
- La UI **no** llama a los motores directamente para el flujo del pipeline: usa `orchestrator.importDocument` y los eventos del canal `ui` (`GROUP_*`, `RULE_*`, `RENDER_REQUESTED`, `EXPORT_REQUESTED`, `CANCEL_REQUESTED`, `DOCUMENT_CLOSED`).
- `config` se mergea con los defaults de `core/Contracts.md` §6.
- `reanalyze(documentId, patch)` (ADR-038 §1): precondición `stage ∈ {Ready, Failed}`, si no `InvalidInputError`. Actualiza la config efectiva del documento mergeando `patch`, reabre la sesión de Grouping (`reopenSession`) y re-despacha únicamente lo que el patch afecta — ver §13.18-§13.21 para el detalle por combinación de campos. Resuelve cuando el pipeline vuelve a `Ready` (o rechaza si termina en `Failed`); no crea un documento nuevo ni descarta ediciones. Patch vacío, con campos no soportados, o idéntico a la config efectiva → ver §13.21.
- `runtime?: CoreRuntimeOptions` (ADR-036 §2): factories de `Worker` por motor: ver `Contracts.md` §3.5. Sin factory para un kind, ese pool despacha in-process (comportamiento de Hito 9).

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `DOCUMENT_IMPORTED` | al iniciar `importDocument` | `DocumentImported` | async | sí |
| `PIPELINE_STAGE_CHANGED` | en cada transición de etapa | `PipelineStageChanged` | async | sí |
| `PIPELINE_PROGRESS` | progreso granular por página/etapa | `PipelineProgress` | async | sí |
| `PIPELINE_READY` | al recibir `GROUPING_FINISHED` (puede repetirse por documento: una vez por `reanalyze` exitoso, ADR-038 §5) | `PipelineReady` | async | sí |
| `PIPELINE_CANCELLED` | cancelación completada en todos los pools | `PipelineCancelled` | async | sí |
| `PIPELINE_FAILED` | error fatal no recuperable de cualquier etapa | `PipelineFailed` | async | sí |

Canal: `EventChannel.Pipeline`.

## 8. Eventos que consume

| Evento (canal) | Acción |
|---|---|
| `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID` (`pdf`) | progreso; decidir OCR vs detección; en password-required, dejar el stage en `Extracting` a la espera de `retryWithPassword` (la UI se suscribe al canal `pdf` directamente, ADR-034 §4); abortar en invalid |
| `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED` (`ocr`) | progreso; **fusión mediada**: leer `ctx.cache` e invocar la función pura `fuseOcrPage` con el `Document` retenido, persistiendo el resultado (ADR-014, ADR-041); al `OCR_FINISHED`, iniciar detección |
| `REGEX_FINISHED` (`regex`), `NER_PAGE_FINISHED`, `NER_FINISHED` (`ner`) | progreso; bookkeeping de fin de detección; si `ner.enabled === false`, tras `REGEX_FINISHED` invocar `grouping.finishSession(documentId)` (ADR-034 §2) |
| `ENTITY_GROUP_CREATED`, `ENTITY_GROUP_UPDATED`, `ENTITY_GROUP_REMOVED` (`grouping`) | actualizar el mapa `groupId → Set<pageIndex>` del documento y marcar sucias las páginas afectadas (actuales ∪ previamente conocidas del grupo); flush coalescido por microtask salvo en etapas pre-`Ready` (ahí cubre el seed de `GROUPING_FINISHED`) — ADR-044, §13 casos 26–27 |
| `GROUPING_FINISHED` (`grouping`) | emitir `PIPELINE_READY`, stage → `Ready`; **seed del preview anonimizado** (ADR-044): `renderPage({ kind: "anonymized", mode: "preview" })` por cada página con ≥ 1 reemplazo habilitado según `grouping.getSnapshot` — también en la vía suprimida por cancelación de `reanalyze` (§13.22, ADR-038 §6) |
| `PREVIEW_UPDATED` (`render`) | registrar `canvasBlobUrl` por clave `(documentId, pageIndex, kind)` y revocar el URL anterior de esa clave (ADR-034 §5) |
| `PREVIEW_PAGE_FAILED`, `RENDER_FINISHED`, `RENDER_FAILED` (`render`) | según `06_Pipeline.md` §10/§12: preview fallido → placeholder en UI; `RENDER_FAILED` agotado el reintento → `EXPORT_FAILED` (la cadena a `PIPELINE_FAILED` pasa por `06` §13) |
| `EXPORT_REQUESTED` (`ui`) | armar `ExportEngineInput` + `RenderPageProvider` preconfigurado con las `options` e invocar `ExportEngine.export()` directamente; si hay un export en curso, encolar (ADR-032 §2) |
| `EXPORT_FINISHED`, `EXPORT_FAILED` (`export`) | stage → `Done`, registrar/revocar `blobUrl` por `documentId` / reintento agotado → `PIPELINE_FAILED` (`06_Pipeline.md` §13) |
| `CANCEL_REQUESTED` (`pipeline`) | abortar `AbortRegistry` + `CANCEL` a pools + `PIPELINE_CANCELLED` |
| `DOCUMENT_CLOSED` (`ui`) | `closeDocument`: `RenderEngine.unloadDocument(documentId)` + soltar buffer retenido, liberar caches y revocar todos los blobUrls (ADR-021 §7, ADR-030, ADR-034 §5; `PdfEngine` sin liberación por documento desde ADR-041); Grouping se limpia solo (suscripción propia) |
| `WORKER_JOB_TIMEOUT`, `WORKER_POOL_SATURATED` (`workers`) | reintento/cancelación según config; backpressure (pausar ingest hasta que la cola baje del 50%) |

El Orchestrator **no** escucha `ENTITY_FOUND` (interno Regex/NER → Grouping) ni `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` (redundantes para la mediación: sus dos únicos puntos de emisión en Grouping acompañan siempre a un `ENTITY_GROUP_UPDATED` — ADR-044 §Contexto).

---

## 9. Entradas

`ImportDocumentInput` (ver §6). Restricciones:

- `buffer.byteLength > 0`; si no, rechaza con `InvalidInputError` sin emitir eventos.
- `documentId` único en la sesión; repetirlo con un documento abierto rechaza con `InvalidInputError`.
- `input` `null`/`undefined` → `InvalidInputError`.

## 10. Salidas

No retorna datos de documento. Expone:

- `PipelineState` inmutable vía `getState(documentId)` (`03_Data_Model.md` §17). Lanza `InvalidInputError` si el `documentId` no existe.
- Eventos del canal `pipeline` (§7).
- Efectos: blobUrls creados/revocados en el host, jobs despachados a pools.

---

## 11. Errores posibles

El Orchestrator **no define códigos de error nuevos**: propaga `SerializedEngineError` de los motores dentro de `PIPELINE_FAILED` y usa los códigos genéricos de `core/Contracts.md` §4.

| Code | Cuándo | Recuperable | Acción |
|---|---|---|---|
| `INVALID_INPUT` | input inválido en `importDocument`/`getState` | no | bug del caller |
| `ENGINE_NOT_INITIALIZED` | uso antes de `createCore` completo | no | bug del caller |
| `ENGINE_DISPOSED` | uso tras `dispose()` | no | bug del caller |
| `CANCELLED` | etapa abortada por cancelación | – | flujo normal de cancelación |
| (propagados) | cualquier `EngineError` fatal de un motor | según `retryable` | reintento según `05_Worker_Architecture.md` §5; agotado → `PIPELINE_FAILED` |

---

## 12. Consideraciones de rendimiento

- Corre en **main thread**: solo coordina; nunca ejecuta trabajo pesado (A-9). Todo lo pesado va a pools.
- Creación perezosa de pools (`05_Worker_Architecture.md` §8); dispose tras 60 s idle.
- Prioridades de jobs por visibilidad de página (`05_Worker_Architecture.md` §6.2): la priorización por visibilidad la aplica **Render** al despachar a su pool (recibe `RENDER_REQUESTED` con los `pageIndices` visibles); el Orchestrator no se suscribe a `RENDER_REQUESTED` (errata corregida, ADR-034 §7).
- Si `deviceMemory < 4` GB o `hardwareConcurrency < 4`: pools reducidos y OCR/NER serializados (`07_Performance_Strategy.md` §5.1).
- Regex y Grouping en main thread (< 5% del total, `06_Pipeline.md` §14); si crecen, migran a pool vía ADR.
- Los `ArrayBuffer`/`ImageData` viajan como `Transferable` (zero-copy); el Orchestrator garantiza no reutilizar buffers transferidos. Con pools in-process (ADR-035) la transferencia igual ocurre **dentro** del motor (pdfjs-dist transfiere el buffer a su worker interno), así que la garantía se cumple entregando siempre una copia (`slice(0)`) del buffer retenido a `PdfEngine.process` y a `RenderEngine.loadDocument` — nunca el original (v1.2.1; costo: una copia transitoria por entrega, el pico de memoria ya estaba presupuestado en `06_Pipeline.md` §3).
- Handlers del bus no bloqueantes (< 1 ms de trabajo propio; el resto se delega).

---

## 13. Casos límite

1. **PDF sin páginas textless**: salta la etapa OCR; `Extracting → Detecting` directo.
2. **Todas las páginas textless**: `sourceKind = "scanned"`; OCR de todas antes de detección.
3. **`PDF_PASSWORD_REQUIRED`**: stage queda en `Extracting`; la UI llama `retryWithPassword`; el pipeline reintenta desde la etapa 1. El fallo de extracción se reconoce **por `code`** (`isEngineErrorCode(err, EngineErrorCode.PDF_PASSWORD_REQUIRED)`), nunca por `instanceof PdfPasswordRequiredError`: con transporte real el error llega deserializado y el `instanceof` da `false`, con lo que el caso caía a `PIPELINE_FAILED` (v1.5.2, ADR-049). El despacho de `pdf-parse` **no** lleva `isRetryable` propio: el predicado por defecto del pool alcanza, porque `PdfPasswordRequiredError.retryable === false` (ADR-049 §4) y el flag sí sobrevive al boundary. `retryWithPassword` **reescribe `retainedInputs`** con el input que incluye la contraseña (v1.5.3, ADR-050 §4): todo lo que corre después lee de ahí — `ensureRenderDocumentLoaded` la pasa a `RenderEngine.loadDocument`, sin lo cual el documento protegido se abre en `PdfEngine` pero no en Render, y el pipeline muere igual con el banner genérico.
4. **`PDF_INVALID`**: `PIPELINE_FAILED` inmediato; recursos de la importación liberados.
5. **OCR falla en una página tras reintentos**: esa página queda sin texto; la detección la salta; el pipeline continúa con warning (no `PIPELINE_FAILED`).
6. **NER desactivado en settings**: la etapa 5 se salta; tras `REGEX_FINISHED` el Orchestrator invoca `grouping.finishSession(documentId)` y Grouping emite `GROUPING_FINISHED` con solo lo de Regex (ADR-034 §2).
7. **NER falla en una página**: se descartan las ocurrencias NER de esa página; las Regex se conservan.
8. **Cancelación durante cualquier etapa**: aborto de todos los jobs del `documentId`, `PIPELINE_CANCELLED`, estado `Cancelled`, documento queda cargado en el último estado estable.
9. **Cancelación durante export**: el `PDFDocument` parcial se descarta; no se emite `EXPORT_FINISHED`.
10. **Doble `EXPORT_REQUESTED`**: el segundo se encola y corre al terminar el primero.
11. **`DOCUMENT_CLOSED` con pipeline corriendo**: equivale a cancelar + liberar todo. **Invariante (v1.5.4, ADR-052 §1)**: tras el cierre no queda vivo **ningún** blob URL de ese documento — ni los vigentes al momento del barrido, ni los que lleguen después en un `PREVIEW_UPDATED`/`EXPORT_FINISHED` tardío (esos los revoca el guard de los handlers, §8). El cierre **no** espera a los renders en vuelo: los aborta y sigue (`DOCUMENT_CLOSED` tiene que ser inmediato — la UI lo usa para volver al estado vacío).
12. **Segundo `importDocument` con otro documento** (MVP: un documento activo): el anterior debe cerrarse primero; si no, `InvalidInputError`.
13. **`WORKER_POOL_SATURATED`**: pausa el ingest de jobs de ese tipo hasta que la cola baje del 50%; no OOM.
14. **Worker crashea**: el pool lo reemplaza y reintenta si `retryable` (`05_Worker_Architecture.md` §9); el Orchestrator solo observa.
15. **Edición del usuario mientras NER corre**: los eventos `ui` fluyen a Grouping sin pasar por el Orchestrator; el pipeline no se ve afectado.
16. **`getState` de documento inexistente**: `InvalidInputError`.
17. **`dispose()` global**: cancela todo, dispone todos los engines y pools, dessuscribe todos los handlers.
18. **`reanalyze` con `ner.enabled: false → true`**: stage → `Detecting`; `grouping.reopenSession(documentId, { expectRegex: false, expectNer: true })`; solo NER se despacha sobre el documento retenido; `NER_FINISHED` → auto-finish → `Ready`. Regex no se re-corre (ADR-038 §5.1).
19. **`reanalyze` con `ner.enabled: true → false`**: stage → `Grouping` (transitorio, sin despacho asíncrono); `reopenSession(..., { expectRegex: false, expectNer: false })` + `dropOccurrences(documentId, { source: DetectionSource.NER })` + `finishSession(documentId)` directo → `Ready` (ADR-038 §5.2).
20. **`reanalyze` con `ocr.languages`** (documento con páginas `requiresOCR`): stage → `OCRing`; `dropOccurrences` de las páginas afectadas (todas sus ocurrencias, incluidas Regex); re-rasterización + OCR + `fuseOcrPage` de esas páginas; stage → `Detecting`: Regex sobre el documento completo (el dedup de Grouping descarta los duplicados de páginas intactas) + NER solo sobre las páginas re-OCR si está activo → `Ready` (ADR-038 §5.3). Sin páginas `requiresOCR`: no-op (nada que re-detectar).
21. **`reanalyze` con `stage` fuera de `{Ready, Done, Failed}`** (un `reanalyze`/`importDocument` ya en curso): `InvalidInputError`, sin efectos — esto además hace que un segundo `reanalyze` concurrente se rechace solo (durante una corrida el stage está en `Detecting`/`OCRing`/`Exporting`/etc.). `Done` aceptado desde ADR-040 (equivalente operativo de `Ready`; habilita `SettingsDialog` post-export). Patch vacío o con campos no soportados por `ReanalyzeConfigPatch`: `InvalidInputError`. Patch idéntico a la config efectiva vigente: no-op, resuelve sin emitir eventos (ADR-038 §1).
22. **`CANCEL_REQUESTED` durante un `reanalyze`**: se abortan los jobs OCR/NER en vuelo; las ocurrencias ya mergeadas se conservan; el Orchestrator invoca `grouping.finishSession` (renumeración determinista) **antes** de emitir `PIPELINE_CANCELLED`, suprimiendo el `PIPELINE_READY` derivado de ese `GROUPING_FINISHED`; el stage final es `Ready`, no `Cancelled` — a diferencia de cancelar un `importDocument` (caso 8), acá sí hay un estado editable previo al que volver (ADR-038 §6).
23. **Un motor deja detached el buffer que recibió** (pdfjs-dist transfiere a su worker interno, v1.2.1): sin efecto sobre el resto del pipeline — cada motor recibió su propia copia (`slice(0)`); el buffer retenido del Orchestrator sigue íntegro (`byteLength > 0`) para `retryWithPassword`, `runOcrStage` y `runExport`.
24. **Fallo en la preparación del export** (`loadDocument` rechaza, o no hay buffer retenido con el documento aún presente): `failPipeline` → `PIPELINE_FAILED` (stage `Failed`) visible en la UI; **nunca** un unhandled rejection ni un pipeline congelado en `Ready`/`Exporting` (v1.2.1). `EXPORT_FAILED` **no** se emite en este camino — es un evento del Export Engine y `export.export()` nunca llegó a invocarse (errata de v1.2.1 corregida en v1.3.1; `EXPORT_FAILED` solo aparece cuando el fallo ocurre dentro de `export.export()`, y ahí `handleExportFailed` → `failPipeline` igual). El guard "documento no disponible" (race con `DOCUMENT_CLOSED`) sigue siendo warn + return silencioso — ahí no hay pipeline que fallar.
25. **Documento con texto nativo, sin páginas `textless`**: `RenderEngine.loadDocument` se invoca al cerrar la etapa de extracción (antes de `Detecting`), simétrico al caso 2 (OCR) — ya no queda diferido hasta el export (v1.4.1). Evita que el primer `RENDER_REQUESTED` (la UI lo emite en cuanto el pipeline llega a `Ready`) se descarte en silencio por documento no cargado (`Render_Engine.md` §8).
26. **Seed del preview anonimizado (ADR-044)**: los `ENTITY_GROUP_*` que llegan durante las etapas pre-`Ready` (`Importing`/`Extracting`/`OCRing`/`Detecting`/`Grouping`) solo actualizan el mapa y acumulan; ningún render se dispara hasta el seed de `GROUPING_FINISHED`. Como esa cascada es síncrona hasta `Ready` y `renderPage` registra su input síncrono (`rememberInput` antes de cualquier `await`), el primer `RENDER_REQUESTED` de la UI reconstruye con reemplazos reales. Los seeds son invocaciones directas: inmunes al supersede de `RENDER_REQUESTED` (`Render_Engine.md` §13 caso 21). Páginas sin ningún reemplazo habilitado no se siembran (anonymized = original; la reconstrucción default con `[]` ya es correcta).
27. **Flush incremental (ADR-044)**: fuera de las etapas pre-`Ready` — incluye `Ready`, `Done` y `Exporting` (caso 15: la edición fluye a Grouping sin pasar por el pipeline) — las páginas sucias se procesan en un flush por microtask: una ráfaga de `ENTITY_GROUP_UPDATED` (regla `type`, merge, renumeración) produce **un** render por página afectada. `ENTITY_GROUP_REMOVED` (payload sin `members`) toma las páginas del mapa retenido. Un toggle off→on queda correcto por construcción: el flush recomputa del snapshot, no de un estado filtrado previo. Fallo de un render del flush: `warn` + continuar.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `createCore returns wired IAnonymizationCore` | `contract.test.ts` | contract | bus, engines, orchestrator poblados |
| `importDocument emits DOCUMENT_IMPORTED then PIPELINE_STAGE_CHANGED` | `contract.test.ts` | contract | orden de eventos |
| `pipeline reaches Ready on GROUPING_FINISHED` | `contract.test.ts` | contract | secuencia feliz con engines mockeados |
| `textless pages trigger OCR stage` | `contract.test.ts` | contract | caso 2 |
| `no textless pages skip OCR stage` | `contract.test.ts` | contract | caso 1 |
| `OCR_PAGE_FINISHED triggers fuseOcrPage with cached words` | `contract.test.ts` | contract | mediación ADR-014; función pura host-side desde ADR-041 |
| `line-word selection is pure: same input, same output, no retained state` | `unit.test.ts` | unit | ADR-058 §5 (mismo criterio que los tests de `fuseOcrPage`) |
| `groups by vertical band and returns only words to the right of the replacement` | `unit.test.ts` | unit | ADR-058 §5 |
| `page where every token fits omits lineWords from the payload` | `unit.test.ts` | unit | ADR-058 §5 |
| `OCR words (source: "ocr") are selected like PDF words` | `edge.test.ts` | edge | ADR-058 §5 — la propiedad que hace entrar a los escaneados |
| **`renderFull attaches the same lineWords as the preview for the same page`** | `contract.test.ts` | contract | v1.7.1 — **el test del falso positivo del gate**: sin él, el repintado queda solo en el preview y el PDF exportado no lo tiene, en silencio |
| `renderFull omits lineWords when every token of the page fits` | `unit.test.ts` | unit | v1.7.1 — el export no paga payload en el caso mayoritario, igual que el preview |
| `renderLegend delegates to RenderEngine.renderLegendPage and returns its EncodedPageImage` | `contract.test.ts` | contract | ADR-059 §5 |
| `renderLegend is not invoked when includeMarkerLegend is false` | `unit.test.ts` | unit | ADR-059 §5 |
| `addManualEntity produces a new group visible in the grouping snapshot` | `contract.test.ts` | contract | ADR-061 §6 |
| `adding an already-detected value merges instead of duplicating` | `contract.test.ts` | contract | ADR-061 §6 (dedup ADR-038 §3) |
| `adding the same value twice is idempotent` | `contract.test.ts` | contract | ADR-061 §6 |
| **`manual literals are re-applied after a reanalyze that drops their pages`** | `unit.test.ts` | unit | ADR-061 §5 — **el test del modo de falla silencioso**: sin él, el dato desaparece del árbol sin aviso y se exporta sin anonimizar |
| `manual literal list is discarded on closeDocument` | `unit.test.ts` | unit | ADR-061 §5 |
| `getPageWords/getPageSize on unknown documentId or pageIndex throw InvalidInputError` | `edge.test.ts` | edge | ADR-061 §4 |
| `findText returns matches with bboxes over both PDF- and OCR-sourced words` | `unit.test.ts` | unit | ADR-061 §8 |
| `PdfEngine has no bus subscriptions` | `contract.test.ts` | contract | invariante matriz §11 |
| `matrix emitter→receiver holds for all subscriptions` | `contract.test.ts` | contract | valida `04_Event_System.md` §11 |
| `password retry re-runs extraction` | `edge.test.ts` | edge | caso 3 |
| `deserialized PDF_PASSWORD_REQUIRED keeps stage at Extracting` | `edge.test.ts` | edge | caso 3 (ADR-049; el mock **debe** rechazar con `EngineError.deserialize(new PdfPasswordRequiredError(id).serialize())` — con la clase concreta el test pasa igual con el bug vivo) |
| `deserialized PDF_PASSWORD_REQUIRED is not retried by the pool` | `edge.test.ts` | edge | caso 3 (ADR-049 §4; una sola invocación del despacho, sin backoff) |
| `retryWithPassword persists the password in retainedInputs` | `edge.test.ts` | edge | caso 3 (ADR-050 §4) |
| `render loadDocument receives the password after a successful retry` | `edge.test.ts` | edge | caso 3 (ADR-050 §4; spy sobre `render.loadDocument`, tercer argumento) |
| `closeDocument leaves no password behind` | `unit.test.ts` | unit | ADR-050 §2 (`08_Security_Model.md` §6.2) |
| `PDF_INVALID emits PIPELINE_FAILED and frees resources` | `edge.test.ts` | edge | caso 4 |
| `failed OCR page skipped with warning, pipeline continues` | `edge.test.ts` | edge | caso 5 |
| `NER disabled skips stage 5 and finishes grouping after REGEX_FINISHED` | `edge.test.ts` | edge | caso 6 (ADR-034 §2) |
| `startSession invoked before dispatching detection` | `contract.test.ts` | contract | ADR-034 §2 |
| `con runtime.workers.pdf configurado, pdf-parse se despacha por postMessage (PR12, ADR-036 §2/§3)` | `unit.test.ts` | unit | PR12 (transporte); desde ADR-055 §10 (D3.2) es además el test de sobre del §5 de ADR-055 en su único consumidor: el pool fake **ignora `run()`** y resuelve el `PdfEngineOutput` que postea el `PdfWorker` — el pipeline avanza igual |
| `garbage from the pdf pool fails the pipeline loudly` | `edge.test.ts` | edge | ADR-055 §3/§10 (D3.2): el mismo fake resolviendo `{}`/`null` → `PIPELINE_FAILED` con `INVALID_INPUT`, nunca un avance silencioso con un `Document` roto |
| `an enveloped pdf result fails the pipeline instead of advancing silently` | `edge.test.ts` | edge | ADR-055 §10 (D3.2): un `PdfEngineOutput` correcto pero envuelto (`{ output: {...} }`) — la regresión exacta de Contexto §1 (el sobre `{ spans }` de NER) trasladada a PDF — también falla ruidoso en vez de avanzar con campos `undefined` |
| `textless pages rasterized via RenderEngine before OCR dispatch` | `contract.test.ts` | contract | ADR-034 §1 |
| `EXPORT_REQUESTED builds provider and calls export directly` | `contract.test.ts` | contract | ADR-032 §2 |
| `PREVIEW_UPDATED replaces and revokes previous blob URL for same key` | `unit.test.ts` | unit | ADR-034 §5 |
| `double export queues second request` | `edge.test.ts` | edge | caso 10 |
| `DOCUMENT_CLOSED during pipeline cancels and frees` | `edge.test.ts` | edge | caso 11 |
| `second importDocument while active rejects` | `edge.test.ts` | edge | caso 12 |
| `saturated pool pauses ingest until 50%` | `unit.test.ts` | unit | caso 13 |
| `retry with exponential backoff honors maxRetries` | `unit.test.ts` | unit | `05` §5 |
| `low-memory device serializes OCR and NER` | `unit.test.ts` | unit | `07` §5.1 |
| `getState returns immutable snapshot` | `unit.test.ts` | unit | §10 |
| `cancel aborts all jobs of documentId within SLA` | `cancel.test.ts` (en `tests/cancel/`) | cancel | caso 8, Hito 11 |
| `dispose cleans all subscriptions and pools` | `contract.test.ts` | contract | caso 17 |
| `blobUrls revoked on close` | `unit.test.ts` | unit | leak de object URLs |
| `engines receive a copy: retained buffer stays intact if engine detaches its input` | `edge.test.ts` | edge | caso 23 (v1.2.1; el mock de PdfEngine debe simular el detach — `structuredClone(buf, {transfer:[buf]})`) |
| `no-OCR document loads Render right after extraction, before Ready` | `edge.test.ts` | edge | caso 25 (v1.4.1; corrige la premisa de v1.2.1 abajo — `loadDocument` ya no queda diferido al export) |
| `export after import reuses the already-loaded Render document (no reload)` | `edge.test.ts` | edge | caso 23 (v1.4.1; antes "primera llamada real a `loadDocument` en el flujo con texto" — dejó de serlo al resolverse el caso 25) |
| `loadDocument failure during export emits PIPELINE_FAILED, no hang` | `edge.test.ts` | edge | caso 24 (v1.2.1; errata corregida en v1.3.1 — decía `EXPORT_FAILED`, imposible en este camino) |
| `EXPORT_REQUESTED handler never produces unhandled rejection` | `edge.test.ts` | edge | caso 24 (v1.2.1; seatbelt `.catch` sobre `enqueueExport`) |
| `reanalyze accepted from Done stage` | `edge.test.ts` | edge | caso 21 (ADR-040; post-export → `Detecting`/…→ `Ready`) |
| `reanalyze still rejected during Exporting` | `edge.test.ts` | edge | caso 21 (ADR-040; el auto-rechazo concurrente se preserva) |
| `GROUPING_FINISHED seeds anonymized preview with snapshot replacements` | `contract.test.ts` | contract | caso 26 (ADR-044; verificar el `RenderPageInput` exacto: `kind`, `mode`, `replacements`) |
| `group events during detection accumulate without rendering` | `contract.test.ts` | contract | caso 26 (ADR-044; cero llamadas a `renderPage` antes de `GROUPING_FINISHED`) |
| `burst of ENTITY_GROUP_UPDATED coalesces into one render per page` | `unit.test.ts` | unit | caso 27 (ADR-044) |
| `ENTITY_GROUP_REMOVED re-renders pages the group occupied` | `unit.test.ts` | unit | caso 27 (ADR-044; páginas tomadas del mapa retenido) |
| `toggle off then on restores the replacement in preview` | `edge.test.ts` | edge | caso 27 (ADR-044; bug 2 — el flush recomputa del snapshot) |
| `group edit during Exporting flushes preview render` | `edge.test.ts` | edge | caso 27 (ADR-044) |
| `seed also runs on suppressed GROUPING_FINISHED after cancelled reanalyze` | `edge.test.ts` | edge | caso 26 (ADR-044, ADR-038 §6; v1.5.1 — el mock de `render.renderPage` debe rechazar con `CancelledError` si recibe `ctx.abortSignal.aborted === true`, igual que el motor real, para que el test no pase de forma vacía con una señal abortada) |
| `seed render failure warns without PIPELINE_FAILED` | `edge.test.ts` | edge | caso 27 (ADR-044; preview best-effort) |
| `group page map cleared on DOCUMENT_CLOSED` | `unit.test.ts` | unit | ADR-044 (sin leak entre documentos) |
| `late PREVIEW_UPDATED after closeDocument revokes its blob url` | `edge.test.ts` | edge | caso 11 (ADR-052 §2; el render mediado queda pendiente **a través** del cierre y resuelve después — es el test que el E2E no puede dar de forma confiable) |
| `late EXPORT_FINISHED after closeDocument revokes its blob url` | `edge.test.ts` | edge | caso 11 (ADR-052 §2) |
| `PREVIEW_UPDATED during unloadDocument await is registered and swept` | `edge.test.ts` | edge | caso 11 (ADR-052 §2; el guard no debe adelantarse al `revokeByPrefix`) |
| `cancelReanalyze still lets the mediated seed run` | `edge.test.ts` | edge | ADR-052 §3 + ADR-038 §6 (no-regresión de la v1.5.1: el controlador nuevo se ata a la baja, no a la cancelación) |

Los tests de contract/unit/edge mockean los motores (interfaces de `Contracts.md`); la integración real con motores vive en `tests/integration/` (Hito 9) y E2E (Hito 10). Pares críticos mínimos de `tests/integration/` (ADR-034 §6): Regex+NER → Grouping vía `ENTITY_FOUND`; `OCR_PAGE_FINISHED` → Orchestrator → `fuseOcrPage` (función pura, ADR-014/ADR-041); happy path `createCore` → `PIPELINE_READY` con motores reales y fronteras de libs mockeadas (ADR-021 §5). Corre bajo `pnpm test` y con `pnpm test:integration` (filtro posicional, ADR-033); al crearla, quitar `integration/**` del `exclude` de `tests/tsconfig.json` y agregar alias/`paths` por motor a demanda.

---

## 15. Checklist de implementación

- [ ] 1. Definir `types.ts` con `IAnonymizationCore`, `IPipelineOrchestrator`, `ImportDocumentInput`, reflejados en `core/Contracts.md` §3.5 (ADR-034 §7: sí se comparten — la UI los importa).
- [ ] 2. Implementar `EngineContext` real: bus, logger, cache LRU, abortSignal, config mergeada con defaults.
- [ ] 3. Implementar `WorkerPoolManager` + `AbortRegistry` según `05_Worker_Architecture.md` (pools, colas prioritarias, timeouts, reintentos, backpressure).
- [ ] 4. Implementar `orchestrator.ts`: máquina de estados de `PipelineStage` con transiciones de `06_Pipeline.md` y `02_System_Diagrams.md` §7.
- [ ] 5. Implementar `importDocument` (etapas 0–7) con invocación directa de motores, suscripciones de §8, retención del buffer original y gestión de sesión de Grouping (`startSession` al iniciar detección; `finishSession` tras `REGEX_FINISHED` si NER off — ADR-034 §2).
- [ ] 6. Implementar mediación OCR→PDF (ADR-014) y rasterización de páginas para OCR vía `RenderEngine.loadDocument` (adelantado a etapa 2) + `rasterizePage` (ADR-034 §1).
- [ ] 7. Implementar cancelación (abort + CANCEL a pools + `PIPELINE_CANCELLED`).
- [ ] 8. Implementar cola de export + `RenderPageProvider` sobre `renderPage(mode: "full")` → `output.encoded` (ADR-034 §3), inyectado al Export Engine.
- [ ] 8b. (ADR-044) Implementar la mediación grupos→Render del preview: suscripciones `ENTITY_GROUP_CREATED`/`UPDATED`/`REMOVED`, mapa `groupId → Set<pageIndex>` por documento, seed en `GROUPING_FINISHED`, flush coalescido por microtask (§13 casos 26–27), `buildPageReplacements` importada de `@anonly/export-engine`. Limpieza del mapa en `DOCUMENT_CLOSED`.
- [ ] 9. Implementar registro y revocación de blobUrls (por clave en `PREVIEW_UPDATED`/`EXPORT_FINISHED`; todos en `DOCUMENT_CLOSED` — ADR-034 §5).
- [ ] 10. Implementar `closeDocument`/`dispose` con liberación total (`unloadDocument`, buffer retenido, caches, blobUrls; `PdfEngine` sin liberación por documento desde ADR-041).
- [ ] 11a. Implementar `reanalyze(documentId, patch)` (ADR-038 §1, §5-§6): config efectiva por documento, `grouping.reopenSession`/`dropOccurrences`, los cuatro flujos por combinación de patch (§13.18-§13.21) y la cancelación con cierre a `Ready` (§13.22). Depende del PR de `grouping-engine` que agrega `reopenSession`/`dropOccurrences`/dedup (ADR-038 §2-§4).
- [ ] 11. Migrar los motores pesados a sus **cuatro** pools: `PdfPool` (item §15.5b de `core/PDF_Engine.md`, ADR-013, verificando misma salida inline vs pool), `OcrPool`, `NerPool` y `RenderPool` (ítems de pool de cada spec de motor, ADR-021; eventos siempre emitidos en host — ADR-013 §6; `ocr-words` al cache lo deposita el lado host del `OcrPool` — ADR-014 §1). En Hito 9 los pools son colas de concurrencia **in-process** (ADR-035 §1); el despacho por `postMessage` a Web Workers reales → Hito 10 (ADR-035 §2).
- [ ] 12. Implementar `createCore` (façade) exportado desde `src/index.ts`.
- [ ] 13. Escribir `contract.test.ts`, `unit.test.ts`, `edge.test.ts` según §14; agregar el glob del paquete a `thresholds` de `vitest.config.ts`.
- [ ] 14. Test de contrato de la matriz emisor→receptor (§14; la matriz canónica es la de `04_Event_System.md` §11 corregida por ADR-034 §4 — "receptor" = suscripción real).
- [ ] 15. Crear `tests/integration/` con los pares críticos mínimos (ADR-034 §6): quitar `integration/**` del `exclude` de `tests/tsconfig.json`, alias/`paths` por motor a demanda (ADR-033), script `test:integration` con filtro posicional.
- [ ] 16. `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 17. Verificar que solo este paquete importa motores (ESLint lo permite únicamente en `packages/anonymization-core/src/`).
- [ ] 18. Verificar `no-network-from-core`.
- [ ] 19. (ADR-049, PR 17.2 — depende del PR 17.1 de `pdf-engine`) `isEngineErrorCode` en `src/errors.ts`; `handleExtractionFailure` discrimina por `code` (§13 caso 3); retiro del `isRetryable` propio del despacho de `pdf-parse` y del import huérfano de `PdfPasswordRequiredError`; los dos tests de §14 con el error **deserializado**; des-`fixme` de `tests/e2e/scenario-3-protected-pdf.spec.ts`. Grep de control: ningún `instanceof` de subclase concreta de `EngineError` —salvo `CancelledError`, exento por el frame `CANCELLED` del transporte— en `packages/anonymization-core/src/`.
- [ ] 20. (ADR-050, PR 17.5 — depende del PR 17.4 de `render-engine`) `retryWithPassword` reescribe `retainedInputs` con el input que incluye el password; `ensureRenderDocumentLoaded` lo pasa como tercer argumento de `loadDocument`. Los tres tests de §14 (persistencia, propagación, limpieza en `closeDocument`) y el cierre del Escenario 3 E2E **con preview visible**.
- [ ] 21. (ADR-052, PR 17.8) Guard en `handlePreviewUpdated`/`handleExportFinished`: `documentId` fuera de `state` → `URL.revokeObjectURL` del URL entrante + `warn`, sin registrar. `mediatedPreviewCtx` pasa a un `AbortController` por documento, abortado por `closeDocument`/`dispose` y **no** por `cancelReanalyze`, limpiado como el resto del estado por documento. Los cuatro tests de §14. Grep de control: ningún `blobTracker.set` sin guard en `orchestrator.ts`.
- [x] 22a. (Hito 10.5, PR 4 — ADR-058 §5) `selectLineWords(pageWords, replacements)` como función pura host-side en `src/line-words.ts` (precedente `fuseOcrPage`/ADR-041), con sus tests. Queda **sin cablear**: `RenderPageInput` todavía no declara `lineWords` y el campo es de `render-engine` (R-1).
- [ ] 22b. (Hito 10.5, PR **4b** — v1.7.1; **después del PR 5**, que es el que agrega `RenderPageInput.lineWords`) Cablear `selectLineWords` en los **cuatro** puntos: `renderMediatedPreview`, las dos construcciones que llaman `buildPageReplacements`, y `makeRenderPageProvider.renderFull` tomando `Page.words` de `documents.get(documentId)`. Sin firma nueva en `RenderPageProvider` (`Export_Engine.md` §6 queda literal). Los dos tests de §14. **El cuarto punto es lo que hace que el repintado exista en el PDF exportado y no solo en el preview**; sin él el gate manual de ADR-058 §11 puede dar verde sobre un export que nunca repinta. Grep de control: ninguna construcción de `RenderPageInput` con `kind: "anonymized"` en `orchestrator.ts` sin `lineWords`. Al cablear, corregir el comentario de `line-words.ts` que hoy dice "el cableado real es del PR 5".

---

## Referencias

- `architecture/06_Pipeline.md` (etapas y transiciones)
- `architecture/05_Worker_Architecture.md` (pools, cancelación, reintentos)
- `architecture/04_Event_System.md` (tabla de eventos y matriz §11)
- `architecture/07_Performance_Strategy.md` §5, §7, §8, §11.6
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md`, `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md`, `adr/ADR-015-UI-Channel-Canonical.md`
- `adr/ADR-030-RenderEngine-LoadDocument.md` (carga del PDF fuente en Render), `adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md` §5 (blob real), `adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md` (provider/export), `adr/ADR-033-Test-Infra-Global-Scripts-Alias.md` (scripts/alias), `adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md` (decisiones de la v1.1.0), `adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md` (transporte de workers, `CoreRuntimeOptions`), `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`reanalyze`, decisiones de la v1.2.0)
- `core/Grouping_Engine.md` §6 (`reopenSession`/`dropOccurrences`, ADR-038 §2-§4)
- `adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md` (mediación grupos→Render del preview, decisiones de la v1.5.0)
- `adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md` (discriminación por `code` en `handleExtractionFailure`, retiro del override `isRetryable`, decisiones de la v1.5.2)
- `ui/React_Client.md` §4 (cómo la UI consume el façade)
