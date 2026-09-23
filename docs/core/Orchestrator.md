<!-- CONTEXT: scope=orchestrator | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-015-UI-Channel-Canonical.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md | audiencia=IA-implementador | fase=10 (Hito 9 cerrado; transporte de workers Hito 10, ADR-036; método `reanalyze` Hito 10, ADR-038; fusión OCR→PDF como función pura host-side, ADR-041; mediación de grupos→Render para el preview, ADR-044; discriminación de errores por `code` a través del boundary de Worker, ADR-049; §2/§13/§15 en fase 10.8: enrutar las dos formas de OCR —textlessPages vs ocrRegions, disjuntos—, progreso de etapa textlessPages.length + ocrRegions.length, retención de ocrRegions por documento y reanalyze sobre la unión, ADR-065, casos 1/5/20/28/29, item 23); fase 10.9: §14/§15 ítem 22c — `selectLineWords` evalúa por fragmento y no por envolvente, ADR-074 §8; fase 11: §2/§13/§15 por ADR-143 — la etapa OCR arma descriptores y produce bajo demanda en vez de rasterizar todo el documento por adelantado; fase 11: §13 caso 32/§14/§15 ítem 26 por ADR-151 — la página 1 se precalienta al llegar a Ready (fase 12.5: `addManualEntity` llama a `grouping.liftRemoval` antes de `reopenSession` y la re-aplicación de literales no —ADR-171 §4, §13 caso 38—; fase 12.5: `createEditCheckpoint`/`restoreEditCheckpoint`/`discardEditCheckpoints` coordinan Grouping y los literales manuales retenidos, y `reanalyze` los descarta —ADR-172, §13 casos 39-40—) -->

# Orchestrator — Spec del Componente Host

> Secuencia las etapas del pipeline, invoca los motores, gestiona los pools de workers y la cancelación, y expone el façade público del Core (`createCore` / `IAnonymizationCore`). Es la **composition root**: el único código del Core autorizado a importar motores.

**Componente**: Orchestrator + façade `@anonly/anonymization-core` (no es un motor: **no tiene `EngineId`** y no implementa `IEngine`; este spec adapta la plantilla de 15 secciones de `ai/Module_Specification_Template.md` a un componente host)
**Ubicación**: `packages/anonymization-core/src/`
**Versión del spec**: 1.13.0
**Última actualización**: 2026-09-18

> **Nota (v1.12.0, ADR-163, T-6a — DPI efectivo por request)**: `runOcrStage`
> deja de cerrar sobre un único `scale`. Para cada página completa deriva
> `effectiveDpi = min(config.ocr.dpi, page.ocrDpiCap ?? config.ocr.dpi)`; ese
> valor va simultáneamente a `OcrPageRequest.dpi`, a `estimatedBytes` mediante
> `effectiveDpi/72`, y a `rasterizePage` porque el productor calcula
> `request.dpi/72`. Esa pareja inseparable preserva la geometría de ADR-064 y el
> presupuesto de ADR-143. Para regiones OCR, cap ausente o cap mayor al
> configurado, el resultado es bit-idéntico al actual. Como defensa del boundary,
> un cap no numérico, no finito o `<= 0` también se trata como ausente. Sin estado, eventos,
> errores ni configuración nuevos; `reanalyze` hereda la regla al reutilizar
> `runOcrStage`.

> **Nota (v1.11.0, ADR-157, 2026-09-11 — el pool de OCR se da de baja al terminar su etapa)**: `runOcrStage` da de baja los workers vivos de OCR (`this.engines.ocr.releaseIdleWorkers()`, ADR-157 §1bis) en un `finally` que envuelve toda la etapa — corre en los tres caminos terminales: éxito, cancelación y fallo. Reemplaza esperar los 60 s de inactividad de ADR-080, que para este pool llegan tarde: transcurren justo mientras corre la detección (NER) que sigue, que es donde está el pico de memoria (ADR-157 §2). El Orchestrator **no tiene ninguna referencia** al `OcrPool` desde ADR-045 —lo construye `create-core.ts` e inyecta directo en `OcrEngine`—, así que la baja no puede salir de `WorkerPoolManager`/`this.pools` (`getPool("ocr")` construiría un pool nuevo, vacío y desconectado): la expone el propio motor (`OcrEngine.releaseIdleWorkers()`, `OCR_Engine.md` §6). Esa llamada trae su propia guarda (ADR-080/ADR-157 §1ter): si el pool no está ocioso —un job en cancelación todavía en vuelo— no hace nada, y la memoria la libera igual el temporizador de ADR-080 como hasta hoy. `idleDisposeMs` no cambia: sigue gobernando los cinco pools. El pool queda usable después: un `reanalyze` con `ocr.languages` (caso 20) lo reconstruye perezoso y paga la recarga del modelo de Tesseract como costo declarado. NER no entra en este cambio (ADR-157 §4): su pool ya se libera a tiempo con el temporizador existente. Ver §13 caso 33.
>
> **Nota (v1.10.0, ADR-151, 2026-09-10 — la página 1 se precalienta al llegar a Ready)**: `handleGroupingFinished` invoca `renderPage({ pageIndex: 0, kind: "original", mode: "preview" }, ctx)` en el mismo turno en que emite `PIPELINE_READY` — **nunca antes** (un documento que termina `Cancelled` no llega a esta línea, ver el early return de `state.cancelRequested` que corre antes) **ni al cargar el documento** (se tiraría un render si el usuario cancela a mitad del escaneo). Es una invocación directa, mismo patrón que `renderMediatedPreview`: `RenderEngine` la despacha con prioridad de "preview no visible" (`PREVIEW_PRIORITY_NOT_VISIBLE = 20`, `05_Worker_Architecture.md` §6.2), así que nunca compite con un export. Sin `scale` explícito: cae al `previewScale` default, la misma escala con la que el visor pide al montar con zoom 1. Best-effort — un fallo se loguea y **nunca** escala a `PIPELINE_FAILED`, el preview no es motivo para fallar el pipeline — usando la misma señal `mediatedPreviewCtx(documentId)` que ya usa el seed anonimizado de ADR-044 (inmune a `cancelReanalyze`, abortada por `closeDocument`/`dispose`). **No hace falta tocar el visor ni el store**: `bus-bridge.ts` ya escribe todo `PREVIEW_UPDATED` en `viewer.store.previewByPage` haya o no un visor montado, así que el precalentado queda ahí para cuando la UI monte el panel de trabajo (ADR-150, que además hace que el pase espere este preview). Retira el renglón "First preview (página 1, lado original) < 1.5 s desde import" de `07_Performance_Strategy.md` §1 (medía la pantalla de escaneo, no el dibujo — ADR-151 §1 Contexto) y lo reemplaza por dos métricas medibles del producto que existe. Ver §13 caso 32, §14 y §15 ítem 26.

> **Nota (ADR-167, 2026-09-18 — `runDetectionStage` ya no da de baja el pool de NER)**: ADR-166 había agregado, en un `finally` alrededor de la etapa de detección, la llamada `this.engines.ner.releaseIdleWorkers()`, espejo de la baja de OCR de ADR-157. **Se retira**, junto con ese método del motor. T-8 la midió con A/B intercalado en dos sesiones: soltaba ~450 MB durante los primeros ~70 s, pero le trasladaba al documento siguiente **+1,2 s** y **+500-600 MB de pico**, porque la recarga del modelo caía dentro de su propia ventana (`roadmap/AB_Intercalado_Medicion.md`). El pool de NER se libera ahora por su propio temporizador, `nerIdleDisposeMs` (default 15 s, `Contracts.md` §6), que vive en el `WorkerPool` y no pasa por el Orchestrator: **el Orchestrator no hace nada con el pool de NER al cerrar la detección**. La asimetría con OCR es deliberada y medida: el minuto de OCR transcurría durante la detección, donde está el pico; el de NER, después de `PIPELINE_READY`. El reinicio del ciclo del modelo tras la baja lo resuelve el motor al enterarse por el pool (`NER_Engine.md` §6, ADR-167 §3), sin participación del Orchestrator. Ver §13 caso 37.

> **Nota (v1.9.0, ADR-143, 2026-09-09 — la etapa OCR deja de rasterizar por adelantado)**: `runOcrStage` rasterizaba **todo** el set (`textlessPages` + `ocrRegions`) antes de llamar a `OcrEngine.processPages` — el problema que motivó ADR-143 (`OCR_Engine.md`, "las imágenes de OCR se producen cuando hay lugar"). Este componente pasa a construir descriptores livianos (`OcrPageRequest`, sin imagen: `documentId`, `pageIndex`, `region?`, `dpi`, `languages`, `estimatedBytes`) a partir de `Document.pages[pageIndex].width/height` (o `region.bbox.width/height`) × `scale` — sin rasterizar nada todavía — y llama a `OcrEngine.processSession(requests, produce, ctx)`, donde `produce` es una función que este componente define y que rasteriza **bajo demanda**, llamando a `RenderEngine.rasterizePage(documentId, pageIndex, scale, ctx, request.region)` recién cuando `OcrEngine` tiene lugar para esa imagen (§3 de ADR-143: `C = min(ocrPoolSize, requests.length)` imágenes vivas a la vez, nunca todo el documento). `produce` nunca cruza un `postMessage` ni entra en `EngineConfig` — vive host-side porque llama a `RenderEngine`, y un motor no importa a otro (P-1). El enrutamiento de las dos formas de OCR (ADR-065, §2/§13 caso 28) no cambia: sigue siendo el `region` del descriptor —ahora un campo de `OcrPageRequest` en vez de un argumento posicional de `rasterizePage`— el que distingue página entera de recorte, y la fusión al `OCR_PAGE_FINISHED` sigue exactamente igual (ADR-014/ADR-041, sin tocar). Ver §2, §13 caso 28 y §15 item 25.

> **Nota (v1.8.0, ADR-065, 2026-08-09 — la etapa OCR enruta dos formas de OCR)**: `PdfEngineOutput` gana `ocrRegions`, disjunto de `textlessPages`. Una página sin texto nativo sigue yendo a OCR **entera** (camino intacto); una página **con** texto nativo y una imagen que ningún texto explica va por **región**: `rasterizePage` con `region`, el `OcrPageInput` de siempre, y `fuseOcrRegion` en vez de `fuseOcrPage` al llegar el `OCR_PAGE_FINISHED`. Este componente retiene `ocrRegions` por documento para saber, al llegar el evento, cuál de las dos fusiones corresponde y con qué región. El total de progreso de la etapa pasa a `textlessPages.length + ocrRegions.length`, y la etapa deja de saltarse cuando `textlessPages` está vacío pero hay regiones — que es exactamente el documento que motivó el ADR. Ver §2, §13 casos 1, 28 y 29.

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
- Invocar directamente los motores de entrada/salida pura (`PdfEngine.process`, `OcrEngine.processSession`, `RegexEngine.process`, `NerEngine.processPages`) — estos motores no se suscriben al bus (ADR-014).
- Mediar la fusión OCR→PDF: escuchar `OCR_PAGE_FINISHED`, leer las `Word[]` de `ctx.cache` (clave `ocr-words:<documentId>:<pageIndex>`) e invocar la función pura `fuseOcrPage(document, pageIndex, words)` de `pdf-engine` con el `Document` retenido, persistiendo el resultado como copia canónica — síncrono, host-side, sin pasar por `PdfPool` (ADR-014, ADR-041). En modo pool, las `Word[]` las deposita en `ctx.cache` el lado host del `OcrPool` (ADR-014 §1).
- **Enrutar las dos formas de OCR (ADR-065)**: `PdfEngineOutput` trae `textlessPages` (páginas sin texto nativo, OCR de página entera — camino de siempre) y `ocrRegions` (páginas **con** texto nativo y una imagen que ningún texto explica). Los dos conjuntos son **disjuntos** por contrato, así que cada página entra por exactamente un camino y la clave de cache `ocr-words:<documentId>:<pageIndex>` sigue siendo única. Para una región: el `OcrPageRequest` lleva `region: region.bbox` (ADR-143 §1) — el productor que este componente le pasa a `processSession` lo reenvía a `rasterizePage(documentId, pageIndex, scale, ctx, request.region)` cuando corresponde —, y al `OCR_PAGE_FINISHED` correspondiente **`fuseOcrRegion(document, pageIndex, region.bbox, words)`** en vez de `fuseOcrPage` — invocar la equivocada lanza `InvalidInputError` por los guards espejo de los dos (`PDF_Engine.md` §6). El Orchestrator retiene `ocrRegions` junto al resto del estado por documento para saber, al llegar el evento, cuál de las dos fusiones corresponde y con qué región.
- **Progreso de la etapa OCR (ADR-065)**: el total pasa a ser `textlessPages.length + ocrRegions.length`. Sin eso, un documento cuyo OCR es solo por región mostraría progreso sobre un total de 0.
- **Retener `ocrRegions` por documento y descartarlas al cerrar (ADR-065 §8)**: a diferencia de `textlessPages` —que se recomputa en cualquier momento desde `page.requiresOCR`— las regiones **no viven en el modelo de datos**, así que si este componente no las retiene se pierden apenas termina la extracción. Se guardan en un mapa por documento y se borran en `closeDocument`/`dispose` junto al resto del estado por documento (`retainedInputs`, `effectiveConfigByDocument`, `groupPagesByDocument`, …).
- **`reanalyze` con `ocr.*` tiene que incluir las regiones (ADR-065 §8)**: `runReanalyzeOcr` deriva hoy las páginas a re-escanear de `document.pages.filter((p) => p.requiresOCR)`. Una página con región tiene `requiresOCR === false`, así que quedaría afuera — y si el OCR del documento fue **solo** por región, la guarda `ocrPages.length === 0` convierte el `reanalyze` entero en un **no-op silencioso**. Debe operar sobre la **unión** de las páginas `requiresOCR` y los `pageIndex` de las regiones retenidas, tanto para la guarda de salida temprana como para `dropOccurrences` y para el conjunto `rerunPages` de NER. Sobre una página con región, `dropOccurrences` descarta también las ocurrencias de su **texto nativo**: es correcto —Regex re-corre sobre el documento completo y NER sobre `rerunPages`, así que se vuelven a detectar— pero es visible (una edición manual sobre esa página se pierde igual que en cualquier página re-OCR-eada) y por eso queda escrito.
- Retener el `ArrayBuffer` original de la etapa 0 (lo transferido a `PdfPool` es una copia, `06_Pipeline.md` §3) e invocar `RenderEngine.loadDocument(documentId, buffer, password?)` **una sola vez por documento** (el tercer argumento es opcional y lo agregó ADR-050: se pasa el password retenido cuando el documento venía encriptado): en la etapa 2 si `textlessPages.length > 0`, si no antes del primer preview (etapa 8) (ADR-030, ADR-034 §1).
- **Construir los descriptores de OCR sin rasterizar, y producir bajo demanda (ADR-143)**: por cada página/región a OCR-ear arma un `OcrPageRequest` — `estimatedBytes` sale de `Math.ceil(width × scale) × Math.ceil(height × scale) × 4` (RGBA — **sigue siendo el tamaño decodificado aunque desde ADR-158 §4 lo que viaje sea un PNG**: es lo que el worker materializa, y estimar el transportado aflojaría el presupuesto de ADR-143 entre diez y treinta veces), con `width`/`height` de `Document.pages[pageIndex]` o de `region.bbox`, **sin** llamar a `rasterizePage` todavía — y le pasa a `OcrEngine.processSession(requests, produce, ctx)` un `produce: OcrImageProducer` que recién invoca `RenderEngine.rasterizePage(documentId, pageIndex, scale, ctx, request.region)` cuando `OcrEngine` lo pide (el Orchestrator **no** rasteriza por sí mismo — no puede importar pdfjs, §5). `scale = ctx.config.ocr.dpi / 72`. **El `dpi` que lleva `OcrPageRequest` debe ser el mismo del que derivó ese `scale`** (ADR-064 §3): desde ADR-064 el motor lo usa como divisor para convertir las coordenadas de Tesseract a puntos de página, así que las dos expresiones —`scale = dpi/72` y `dpi: config.ocr.dpi`— tienen que moverse juntas. El motor no puede verificarlo (no conoce el tamaño en puntos de la página); la responsabilidad es de este componente, que las deriva del mismo `ctx.config.ocr.dpi`.
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

**ADR-164 (T-5, revisión 2026-09-15; aceptación pendiente)**: createCore
construye un WorkerPool adicional `ocr-orientation`, job `ocr-orient`, size 1,
maxQueue de OCR, retries 0, mismo backoff/idle y factory
`runtime.workers["ocr-orientation"]`. Lo inyecta como segundo puerto en
OcrEngine y lo dispone junto al pool LSTM. No lo registra en WorkerPoolManager;
PoolKey gana la clave y ManagedPoolKey la excluye junto con export.
Defaults del contrato: timeout ocr-orient 60000 y retries 0. El Orchestrator
sigue usando processSession y releaseIdleWorkers del motor, sin gestionar el
ángulo ni retener referencias al nuevo pool. La app aporta la nueva factory.
La ventana de imágenes se decide en OCR_Engine §6/ADR-164 §2.3: con pool 2
inyectado puede haber tres requests bajo el mismo presupuesto. Esta regla
sustituye el límite de consumidores de la nota histórica v1.9.0; el
Orchestrator conserva su productor bajo demanda y no cambia tamaños de pool
ni retiene una lista de imágenes/ángulos por adelantado.

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
  // addManualEntity / findText / getPageWords / getPageSize: ver Contracts.md §3.5 (ADR-061).
  previewEdit(documentId: string, request: EditPreviewRequest): EditPreview;   // ADR-170 §2
  createEditCheckpoint(documentId: string): string;                            // ADR-172 §1
  restoreEditCheckpoint(documentId: string, checkpointId: string): Promise<void>;
  discardEditCheckpoints(documentId: string): void;
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
- `reanalyze(documentId, patch)` (ADR-038 §1): precondición `stage ∈ {Ready, Failed}`, si no `InvalidInputError`. Actualiza la config efectiva del documento mergeando `patch`, reabre la sesión de Grouping (`reopenSession`) y re-despacha únicamente lo que el patch afecta — ver §13.18-§13.21 para el detalle por combinación de campos. Resuelve cuando el pipeline vuelve a `Ready` (o rechaza si termina en `Failed`); no crea un documento nuevo ni descarta ediciones. Patch vacío, con campos no soportados, o idéntico a la config efectiva → ver §13.21. **Un patch con `ner` y `ocr` a la vez se rechaza** con `InvalidInputError` (ADR-081): la equivalencia que ADR-038 §5 regla 4 prometía nunca se implementó, así que en vez de producir un resultado silenciosamente incorrecto se pide componer dos llamadas, **OCR primero** — ver §13.30.
- `runtime?: CoreRuntimeOptions` (ADR-036 §2): factories de `Worker` por motor: ver `Contracts.md` §3.5. Sin factory para un kind, ese pool despacha in-process (comportamiento de Hito 9).
- `previewEdit(documentId, request)` (ADR-170 §2): **delegación pura** en `GroupingEngine.previewEdit`, sin estado propio, sin emitir y sin pasar por `reopenSession`. Sincrónico. `documentId` sin sesión → `InvalidInputError` (lo lanza el motor). Mismo patrón que `findText` (ADR-061 §8 errata).
- `addManualEntity(documentId, request)` y la eliminación (ADR-171 §4): **antes** de `reopenSession`, llama a `grouping.liftRemoval(documentId, request.value)` — un agregado manual es una decisión nueva del usuario y revierte una eliminación previa de ese valor. La **re-aplicación** de literales retenidos tras una re-detección (ADR-061 §5) **no** la llama: así una entidad agregada a mano y después eliminada no reaparece en el próximo re-análisis.
- `createEditCheckpoint` / `restoreEditCheckpoint` / `discardEditCheckpoints` (ADR-172 §1): el Orchestrator **coordina**: delega en `grouping.createCheckpoint`/`restoreCheckpoint`/`discardCheckpoints` y guarda, **bajo el mismo id**, una copia de la lista de literales manuales retenidos (ADR-061 §5), que restaura junto con la sesión. Sin eso, deshacer un agregado manual dejaría el literal retenido y el próximo re-análisis lo recrearía. Precondición: sesión existente y `stage` fuera de `{Importing, Extracting, OCRing, Detecting, Grouping}` → si no, `InvalidInputError`. `reanalyze` descarta todos los puntos del documento **antes** de reabrir la sesión; `closeDocument` y `dispose` también. El re-render después de restaurar sale solo, por las suscripciones de ADR-044 a los eventos de Grouping.

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

1. **PDF sin páginas textless**: salta la etapa OCR **si además `ocrRegions` está vacío** (ADR-065). Con regiones, la etapa OCR corre igual aunque `textlessPages` esté vacío: es exactamente el documento que motivó ADR-065 (texto nativo en todas las páginas, una con una imagen sin explicar).
2. **Todas las páginas textless**: `sourceKind = "scanned"`; OCR de todas antes de detección.
3. **`PDF_PASSWORD_REQUIRED`**: stage queda en `Extracting`; la UI llama `retryWithPassword`; el pipeline reintenta desde la etapa 1. El fallo de extracción se reconoce **por `code`** (`isEngineErrorCode(err, EngineErrorCode.PDF_PASSWORD_REQUIRED)`), nunca por `instanceof PdfPasswordRequiredError`: con transporte real el error llega deserializado y el `instanceof` da `false`, con lo que el caso caía a `PIPELINE_FAILED` (v1.5.2, ADR-049). El despacho de `pdf-parse` **no** lleva `isRetryable` propio: el predicado por defecto del pool alcanza, porque `PdfPasswordRequiredError.retryable === false` (ADR-049 §4) y el flag sí sobrevive al boundary. `retryWithPassword` **reescribe `retainedInputs`** con el input que incluye la contraseña (v1.5.3, ADR-050 §4): todo lo que corre después lee de ahí — `ensureRenderDocumentLoaded` la pasa a `RenderEngine.loadDocument`, sin lo cual el documento protegido se abre en `PdfEngine` pero no en Render, y el pipeline muere igual con el banner genérico.
4. **`PDF_INVALID`**: `PIPELINE_FAILED` inmediato; recursos de la importación liberados.
5. **OCR falla en una página tras reintentos**: esa página queda sin texto; la detección la salta; el pipeline continúa con warning (no `PIPELINE_FAILED`). **Si lo que falló fue una región** (ADR-065 §9), la página **conserva su texto nativo** y su `requiresOCR` sigue en `false`: lo único que se pierde es el contenido de esa región, con `ocrCompleted = false`.
6. **NER desactivado en settings**: la etapa 5 se salta; tras `REGEX_FINISHED` el Orchestrator invoca `grouping.finishSession(documentId)` y Grouping emite `GROUPING_FINISHED` con solo lo de Regex (ADR-034 §2).
7. **NER falla en una página**: se descartan las ocurrencias NER de esa página; las Regex se conservan.
8. **Cancelación durante cualquier etapa**: aborto de todos los jobs del `documentId`, `PIPELINE_CANCELLED`, estado `Cancelled`, documento queda cargado en el último estado estable. **`Cancelled` es terminal (ADR-134)**: abortar la señal no detiene los jobs ya despachados, y sus handlers seguían llamando `setStage`/`emitProgress` — el usuario veía "Cancelado" y medio segundo después el pipeline reportando progreso otra vez. Ningún evento tardío pisa el stage ni emite progreso para un documento cancelado. Lo que esto **no** hace es detener el trabajo en vuelo: eso pide que cada kernel mire su `AbortSignal`, y sigue pendiente.
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
20. **`reanalyze` con `ocr.languages`** (documento con páginas `requiresOCR` **o con `ocrRegions` retenidas**, ADR-065 §8 — las páginas con región tienen `requiresOCR === false` y quedarían afuera del filtro, volviendo el `reanalyze` un no-op silencioso si el OCR del documento fue solo por región): stage → `OCRing`; `dropOccurrences` de las páginas afectadas (todas sus ocurrencias, incluidas Regex); re-rasterización + OCR + `fuseOcrPage` (páginas enteras) o `fuseOcrRegion` (páginas con región, re-rasterizadas con su `bbox`) según corresponda; stage → `Detecting`: Regex sobre el documento completo (el dedup de Grouping descarta los duplicados de páginas intactas) + NER solo sobre las páginas re-OCR si está activo → `Ready` (ADR-038 §5.3). **Sin páginas `requiresOCR` y sin regiones retenidas**: no-op (nada que re-detectar). Que la guarda mire la unión y no solo `requiresOCR` es lo que evita el no-op silencioso de ADR-065 §8.
21. **`reanalyze` con `stage` fuera de `{Ready, Done, Failed}`** (un `reanalyze`/`importDocument` ya en curso): `InvalidInputError`, sin efectos — esto además hace que un segundo `reanalyze` concurrente se rechace solo (durante una corrida el stage está en `Detecting`/`OCRing`/`Exporting`/etc.). `Done` aceptado desde ADR-040 (equivalente operativo de `Ready`; habilita `SettingsDialog` post-export). Patch vacío o con campos no soportados por `ReanalyzeConfigPatch`: `InvalidInputError`. Patch idéntico a la config efectiva vigente: no-op, resuelve sin emitir eventos (ADR-038 §1).
22. **`CANCEL_REQUESTED` durante un `reanalyze`**: se abortan los jobs OCR/NER en vuelo; las ocurrencias ya mergeadas se conservan; el Orchestrator invoca `grouping.finishSession` (renumeración determinista) **antes** de emitir `PIPELINE_CANCELLED`, suprimiendo el `PIPELINE_READY` derivado de ese `GROUPING_FINISHED`; el stage final es `Ready`, no `Cancelled` — a diferencia de cancelar un `importDocument` (caso 8), acá sí hay un estado editable previo al que volver (ADR-038 §6).
23. **Un motor deja detached el buffer que recibió** (pdfjs-dist transfiere a su worker interno, v1.2.1): sin efecto sobre el resto del pipeline — cada motor recibió su propia copia (`slice(0)`); el buffer retenido del Orchestrator sigue íntegro (`byteLength > 0`) para `retryWithPassword`, `runOcrStage` y `runExport`.
24. **Fallo en la preparación del export** (`loadDocument` rechaza, o no hay buffer retenido con el documento aún presente): `failPipeline` → `PIPELINE_FAILED` (stage `Failed`) visible en la UI; **nunca** un unhandled rejection ni un pipeline congelado en `Ready`/`Exporting` (v1.2.1). `EXPORT_FAILED` **no** se emite en este camino — es un evento del Export Engine y `export.export()` nunca llegó a invocarse (errata de v1.2.1 corregida en v1.3.1; `EXPORT_FAILED` solo aparece cuando el fallo ocurre dentro de `export.export()`, y ahí `handleExportFailed` → `failPipeline` igual). El guard "documento no disponible" (race con `DOCUMENT_CLOSED`) sigue siendo warn + return silencioso — ahí no hay pipeline que fallar.
25. **Documento con texto nativo, sin páginas `textless`**: `RenderEngine.loadDocument` se invoca al cerrar la etapa de extracción (antes de `Detecting`), simétrico al caso 2 (OCR) — ya no queda diferido hasta el export (v1.4.1). Evita que el primer `RENDER_REQUESTED` (la UI lo emite en cuanto el pipeline llega a `Ready`) se descarte en silencio por documento no cargado (`Render_Engine.md` §8).
26. **Seed del preview anonimizado (ADR-044)**: los `ENTITY_GROUP_*` que llegan durante las etapas pre-`Ready` (`Importing`/`Extracting`/`OCRing`/`Detecting`/`Grouping`) solo actualizan el mapa y acumulan; ningún render se dispara hasta el seed de `GROUPING_FINISHED`. Como esa cascada es síncrona hasta `Ready` y `renderPage` registra su input síncrono (`rememberInput` antes de cualquier `await`), el primer `RENDER_REQUESTED` de la UI reconstruye con reemplazos reales. Los seeds son invocaciones directas: inmunes al supersede de `RENDER_REQUESTED` (`Render_Engine.md` §13 caso 21). Páginas sin ningún reemplazo habilitado no se siembran (anonymized = original; la reconstrucción default con `[]` ya es correcta).
27. **Flush incremental (ADR-044)**: fuera de las etapas pre-`Ready` — incluye `Ready`, `Done` y `Exporting` (caso 15: la edición fluye a Grouping sin pasar por el pipeline) — las páginas sucias se procesan en un flush por microtask: una ráfaga de `ENTITY_GROUP_UPDATED` (regla `type`, merge, renumeración) produce **un** render por página afectada. `ENTITY_GROUP_REMOVED` (payload sin `members`) toma las páginas del mapa retenido. Un toggle off→on queda correcto por construcción: el flush recomputa del snapshot, no de un estado filtrado previo. Fallo de un render del flush: `warn` + continuar.
28. **Documento con `ocrRegions` (ADR-065)**: la etapa OCR arma un `OcrPageRequest` con `region: region.bbox` (ADR-143 §1) para cada región; el productor que este componente le pasa a `processSession` rasteriza **solo el recorte** cuando `OcrEngine` lo pide, lo manda a OCR como cualquier página y fusiona con `fuseOcrRegion`, que traslada las palabras por el origen de la región y las **concatena** con las nativas. `requiresOCR` de esa página sigue en `false` y `ocrCompleted` pasa a `true` (invariante relajado, `03_Data_Model.md` §4). El progreso de la etapa cuenta `textlessPages.length + ocrRegions.length`.
30. **`reanalyze` con `ner` y `ocr` en el mismo patch** (ADR-081): rechaza con `InvalidInputError` en `validateReanalyzePatch`, o sea **antes** de tocar cualquier estado — no actualiza la config efectiva, no emite ningún evento, no cambia el `stage`. Motivo: con ambos campos se entraba solo por `runReanalyzeOcrFlow`, que por diseño toca únicamente las páginas re-OCR; apagar NER dejaba sus ocurrencias vivas en el resto del documento, y encenderlo solo lo corría sobre las páginas escaneadas. Los dos fallaban en silencio, con el pipeline llegando a `Ready`. El resultado que la regla retirada prometía se obtiene con dos llamadas secuenciales (`{ocr}` y después `{ner}`), que es lo que `SettingsDialog` hace desde el PR6 del Hito 10 — el orden importa: al revés, el flujo de NER correría sobre un texto que el OCR posterior invalida.
31. **Página en `textlessPages` y en `ocrRegions` a la vez**: no puede ocurrir — los dos conjuntos son disjuntos por contrato de `PdfEngineOutput` (ADR-065 §4). Si un `PdfEngineOutput` los trajera solapados sería un bug de `pdf-engine`: el Orchestrator no lo compensa, y la doble fusión fallaría ruidosamente por los guards espejo de `fuseOcrPage`/`fuseOcrRegion`.
32. **Precalentado de la página 1 al llegar a `Ready` (ADR-151)**: `handleGroupingFinished` dispara `prewarmFirstPagePreview` solo cuando la cascada llega a emitir `PIPELINE_READY` — un documento que corta antes por `state.cancelRequested` (caso 22, reanalyze cancelado) no precalienta nada, porque ese camino retorna antes de la línea que lo invoca. El fallo del render precalentado es best-effort: se loguea y no toca `stage` ni emite `PIPELINE_FAILED`, igual que el seed/flush del preview mediado (ADR-044, casos 26/27).
33. **Baja del pool de OCR al terminar `runOcrStage` (ADR-157)**: `this.engines.ocr.releaseIdleWorkers()` corre en un `finally` que envuelve toda la etapa. **Camino feliz**: `processSession` ya resolvió con todas las páginas asentadas, el pool está ocioso, la baja ocurre — el próximo `reanalyze` con `ocr.languages` (caso 20) reconstruye el pool perezoso y paga la recarga del modelo. **Cancelación o fallo a mitad de etapa**: la llamada puede encontrar el pool NO ocioso (un job todavía en vuelo) — `releaseIdleWorkers()` trae su propia guarda y no hace nada en ese caso, sin lanzar ni enmascarar el error/cancelación real de la etapa; la memoria la libera el temporizador de ADR-080 (60 s) como hasta hoy. Ninguna de las dos ramas dispone el motor (`dispose()`): sigue usable en ambas.
34. **Página completa con `ocrDpiCap = 200` y config 300** (ADR-163): el descriptor lleva `dpi: 200`, la reserva se estima a escala `200/72` y el productor rasteriza a esa misma escala.
35. **Cap ausente, inválido, cap 400 con config 300 o request de región** (ADR-163): todos conservan `dpi: 300` y `scale: 300/72`; inválido incluye no numérico, no finito o `<= 0` recibido a través del boundary superficial.
36. **Dos páginas con caps distintos** (ADR-163): cada invocación del productor deriva la escala de su propio `request.dpi`; una escala global capturada es una regresión aunque el primer request pase.
37. **`runDetectionStage` no da de baja el pool de NER** (ADR-167, reemplaza el caso de ADR-166): la etapa termina sin ninguna llamada de baja sobre NER, en éxito, cancelación o fallo. El pool se libera solo cuando lleva `nerIdleDisposeMs` sin trabajo, y un documento o reanálisis que llega antes lo encuentra con el modelo cargado. El caso que agregó ADR-166 salió numerado **35**, repitiendo el número del caso de ADR-163 que ya existía; se retiró de ese lugar y el 35 vuelve a ser solo el de ADR-163.
38. **Eliminar y re-analizar (ADR-171 §3-§4)**: una entidad agregada a mano (su literal queda retenido, ADR-061 §5) y después eliminada por `GROUP_REMOVE_REQUESTED` **no** reaparece tras un `reanalyze`: la re-aplicación del literal emite su `ENTITY_FOUND` y Grouping lo descarta por la supresión. Un `addManualEntity` posterior del mismo valor sí la vuelve a crear, porque llama a `liftRemoval`.
39. **Deshacer un agregado manual (ADR-172 §1)**: `createEditCheckpoint` → `addManualEntity(v)` → `restoreEditCheckpoint` deja la sesión **y** la lista de literales retenidos como antes; un `reanalyze` posterior **no** recrea `v`.
40. **Los puntos no cruzan un re-análisis (ADR-172 §1)**: tras `reanalyze`, restaurar un punto anterior → `InvalidInputError`. `createEditCheckpoint` durante una pasada (`Detecting`, etc.) → `InvalidInputError`.

---

## 14. Casos de prueba

**T-5 / ADR-164**: tests de createCore deben afirmar que la factory
ocr-orientation recibe RUN de ocr-orient, que dos páginas orientadas pasan al
pool ocr-page con sus propios ángulos y que dispose libera ambos pools. Dos
Core no comparten workers OSD. Los tests del manager verifican que no administra
la nueva clave. Fakes remotos resuelven el sobre real, no ejecutan run().

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `restoring a checkpoint also restores the retained manual literals` | `unit.test.ts` | unit | caso 39 (ADR-172) — **con el `GroupingEngine` real, no simulado**: el simulado ocultó que `reopenSession` descartaba los puntos (errata de `Grouping_Engine.md` §13 caso 53) |
| `reanalyze discards edit checkpoints; checkpoints are refused during a detection pass` | `edge.test.ts` | edge | caso 40 |
| `addManualEntity lifts a previous removal; the reanalyze re-application does not` | `unit.test.ts` | unit | caso 38 (ADR-171 §4) |
| `previewEdit delegates to grouping.previewEdit and does not alter the snapshot` | `unit.test.ts` | unit | ADR-170 §2 |
| `los jobs en vuelo no resucitan el stage ni emiten progreso` | `edge.test.ts` | edge | ADR-134: se cancela con un job de PDF colgado y se lo libera **después**; el stage sigue en `Cancelled` y no se emite `PIPELINE_PROGRESS`. Verificado que falla sin la guarda (`Expected "cancelled"`, `Received "detecting"`) |
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
| **`selectLineWords picks the neighbours of the fragment's line, not the envelope's`** | `unit.test.ts` | unit | ADR-074 §8 — con la envolvente, `mightOverflow` e `isLineNeighbor` fallan los dos y el repintado no se activa nunca sobre una entidad multi-línea |
| `selectLineWords with single-rect replacements returns exactly what it returned before` | `unit.test.ts` | unit | ADR-074 §8 — no-regresión del caso mayoritario |
| `renderLegend delegates to RenderEngine.renderLegendPage and returns its EncodedPageImage` | `contract.test.ts` | contract | ADR-059 §5 |
| `renderLegend is not invoked when includeMarkerLegend is false` | `unit.test.ts` | unit | ADR-059 §5 |
| `addManualEntity produces a new group visible in the grouping snapshot` | `contract.test.ts` | contract | ADR-061 §6 |
| `adding an already-detected value merges instead of duplicating` | `contract.test.ts` | contract | ADR-061 §6 (dedup ADR-038 §3) |
| `adding the same value twice is idempotent` | `contract.test.ts` | contract | ADR-061 §6 |
| **`manual literals are re-applied after a reanalyze that drops their pages`** | `unit.test.ts` | unit | ADR-061 §5 — **el test del modo de falla silencioso**: sin él, el dato desaparece del árbol sin aviso y se exporta sin anonimizar |
| `manual literal list is discarded on closeDocument` | `unit.test.ts` | unit | ADR-061 §5 |
| `getPageWords/getPageSize on unknown documentId or pageIndex throw InvalidInputError` | `edge.test.ts` | edge | ADR-061 §4 |
| `findText returns the same matches as regex.searchText over the retained document, including OCR pages` | `unit.test.ts` | unit | ADR-061 §8 |
| `findText on an unknown documentId throws InvalidInputError, same as getPageWords/getPageSize` | `unit.test.ts` | unit | ADR-061 §8 errata |
| **`findText does not alter the grouping snapshot`** | `contract.test.ts` | contract | ADR-061 §8 errata — **el test de que buscar no anonimiza**: sin él, la regresión que la errata describe vuelve sin que nada la note |
| `addManualEntity with a value absent from the document returns occurrenceCount 0, does not throw, and creates no group` | `contract.test.ts` | contract | ADR-061 §6 errata |
| `addManualEntity with a value present N times returns occurrenceCount N, including when every occurrence merges by dedup and the group tree does not change` | `contract.test.ts` | contract | ADR-061 §6 errata |
| `manual literal is retained even when findLiteral found zero occurrences, and a later reanalyze searches for it again` | `unit.test.ts` | unit | ADR-061 §6 errata, punto 6 |
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
| `export preparation failure emits PIPELINE_FAILED, no hang` | `edge.test.ts` | edge | caso 24 (v1.2.1; errata corregida en v1.3.1 — decía `EXPORT_FAILED`, imposible en este camino. **Relabelado 2026-08-18**: el nombre anterior era `loadDocument failure during export…`, pero desde el fix de v1.4.1 —`loadDocument` corre antes de `Ready`— ese ya no puede ser el disparador y el test fuerza el fallo con `getSnapshot`. El mecanismo verificado no cambia: cualquier fallo dentro del `try` de `runExport` enruta a `failPipeline`) |
| `EXPORT_REQUESTED handler never produces unhandled rejection` | `edge.test.ts` | edge | caso 24 (v1.2.1; seatbelt `.catch` sobre `enqueueExport`) |
| `reanalyze accepted from Done stage` | `edge.test.ts` | edge | caso 21 (ADR-040; post-export → `Detecting`/…→ `Ready`) |
| `reanalyze still rejected during Exporting` | `edge.test.ts` | edge | caso 21 (ADR-040; el auto-rechazo concurrente se preserva) |
| `reanalyze with both ner and ocr in one patch is rejected without side effects` | `edge.test.ts` | edge | caso 30 (ADR-081): rechaza con `InvalidInputError` **y** el estado queda idéntico — sin evento, sin cambio de stage, sin config efectiva actualizada |
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
| `renderiza la página 1, lado original, en preview, en el mismo turno en que se alcanza Ready` | `unit.test.ts` | unit | caso 32 (ADR-151 §1): verifica `pageIndex: 0`, `kind: "original"`, `mode: "preview"` y ausencia de `scale` (cae al `previewScale` default) |
| `no precalienta un documento que terminó Cancelled` | `unit.test.ts` | unit | caso 32 (ADR-151 §1: solo Ready/Done — fuerza el camino de reanalyze cancelado, caso 22, y verifica que `renderPage` nunca recibe `kind: "original"`) |
| `un fallo del precalentado no escala a PIPELINE_FAILED` | `unit.test.ts` | unit | caso 32 (ADR-151 §1, best-effort — mismo criterio que `seed render failure warns without PIPELINE_FAILED`, caso 27) |

Los tests de contract/unit/edge mockean los motores (interfaces de `Contracts.md`); la integración real con motores vive en `tests/integration/` (Hito 9) y E2E (Hito 10). Pares críticos mínimos de `tests/integration/` (ADR-034 §6): Regex+NER → Grouping vía `ENTITY_FOUND`; `OCR_PAGE_FINISHED` → Orchestrator → `fuseOcrPage` (función pura, ADR-014/ADR-041); happy path `createCore` → `PIPELINE_READY` con motores reales y fronteras de libs mockeadas (ADR-021 §5). Corre bajo `pnpm test` y con `pnpm test:integration` (filtro posicional, ADR-033); al crearla, quitar `integration/**` del `exclude` de `tests/tsconfig.json` y agregar alias/`paths` por motor a demanda.

---

## 15. Checklist de implementación

- [ ] 28. (ADR-164, T-5-F) Conectar orientationPool size 1 según §6; nuevos
  defaults de config y PoolKey/ManagedPoolKey; dispose de ambos pools y pruebas
  de §14. Sin cambio en runOcrStage ni en los otros motores. Scopes/medición en
  `roadmap/T5_OSD_Compartido_Handoff.md`.

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
- [x] 19. (ADR-049, PR 17.2 — depende del PR 17.1 de `pdf-engine`) `isEngineErrorCode` en `src/errors.ts`; `handleExtractionFailure` discrimina por `code` (§13 caso 3); retiro del `isRetryable` propio del despacho de `pdf-parse` y del import huérfano de `PdfPasswordRequiredError`; los dos tests de §14 con el error **deserializado**; des-`fixme` de `tests/e2e/scenario-3-protected-pdf.spec.ts`. Grep de control: ningún `instanceof` de subclase concreta de `EngineError` —salvo `CancelledError`, exento por el frame `CANCELLED` del transporte— en `packages/anonymization-core/src/`.
- [x] 20. (ADR-050, PR 17.5 — depende del PR 17.4 de `render-engine`) `retryWithPassword` reescribe `retainedInputs` con el input que incluye el password; `ensureRenderDocumentLoaded` lo pasa como tercer argumento de `loadDocument`. Los tres tests de §14 (persistencia, propagación, limpieza en `closeDocument`) y el cierre del Escenario 3 E2E **con preview visible**.
- [x] 21. (ADR-052, PR 17.8) Guard en `handlePreviewUpdated`/`handleExportFinished`: `documentId` fuera de `state` → `URL.revokeObjectURL` del URL entrante + `warn`, sin registrar. `mediatedPreviewCtx` pasa a un `AbortController` por documento, abortado por `closeDocument`/`dispose` y **no** por `cancelReanalyze`, limpiado como el resto del estado por documento. Los cuatro tests de §14. Grep de control: ningún `blobTracker.set` sin guard en `orchestrator.ts`.
- [x] 22a. (Hito 10.5, PR 4 — ADR-058 §5) `selectLineWords(pageWords, replacements)` como función pura host-side en `src/line-words.ts` (precedente `fuseOcrPage`/ADR-041), con sus tests. Queda **sin cablear**: `RenderPageInput` todavía no declara `lineWords` y el campo es de `render-engine` (R-1).
- [x] 22c. (Hito 10.9, PR 10 — ADR-074 §8) `selectLineWords` evalúa sus dos criterios **por fragmento** (`fragments ?? [bbox]` de cada `Replacement`), no sobre la envolvente. Con una entidad partida en dos líneas la envolvente rompe los dos: `mightOverflow` compara el token contra ~557 pt de ancho y decide que entra sobrado, e `isLineNeighbor` exige `word.bbox.x >= bbox.x + bbox.width`, que con ese ancho no lo cumple ninguna palabra de ninguna de las dos líneas — o sea que hoy el repintado de línea **no se activa nunca** sobre estas ocurrencias, ni en el preview ni en el export. Sigue siendo pura, sin estado retenido, y sigue devolviendo `undefined` cuando ningún reemplazo de la página podría no entrar. Con un solo rectángulo, resultado idéntico al previo (test de no regresión). El PR de `shared` que declara el campo (Hito 10.9 PR 4) es precondición; los cuatro puntos de enganche del ítem 22b no cambian.
- [ ] 22b. (Hito 10.5, PR **4b** — v1.7.1; **después del PR 5**, que es el que agrega `RenderPageInput.lineWords`) Cablear `selectLineWords` en los **cuatro** puntos: `renderMediatedPreview`, las dos construcciones que llaman `buildPageReplacements`, y `makeRenderPageProvider.renderFull` tomando `Page.words` de `documents.get(documentId)`. Sin firma nueva en `RenderPageProvider` (`Export_Engine.md` §6 queda literal). Los dos tests de §14. **El cuarto punto es lo que hace que el repintado exista en el PDF exportado y no solo en el preview**; sin él el gate manual de ADR-058 §11 puede dar verde sobre un export que nunca repinta. Grep de control: ninguna construcción de `RenderPageInput` con `kind: "anonymized"` en `orchestrator.ts` sin `lineWords`. Al cablear, corregir el comentario de `line-words.ts` que hoy dice "el cableado real es del PR 5".
- [x] 23. (Hito 10.8, paso 2 — ADR-065) Cablear el stage de OCR por región: retener `ocrRegions` por documento y descartarlas en `closeDocument`/`dispose` (§8); rasterizar con `region.bbox`; rutear la fusión a `fuseOcrRegion` cuando el `pageIndex` del `OCR_PAGE_FINISHED` tiene región retenida; total de progreso `textlessPages.length + ocrRegions.length`; la etapa deja de saltarse cuando `textlessPages` está vacío pero hay regiones; `runReanalyzeOcrFlow` sobre la **unión** (guarda, `dropOccurrences` y `rerunPages`). Casos 1, 5, 20, 28 y 29 de §13.
- [x] 24. (Hito 10.7, PR 3 — ADR-061 §4/§5/§6; v1.7.0) Tres de las cuatro entradas nuevas de `IPipelineOrchestrator`: `addManualEntity` orquestando `reopenSession` → `regex.findLiteral` → `finishSession`; `getPageWords`/`getPageSize` por página y a demanda, con `InvalidInputError` sobre `documentId`/`pageIndex` inexistente. La cuarta, `findText`, es el ítem 24c: el motor no tenía todavía una entrada de solo lectura sobre la que apoyarla (errata de ADR-061 §8). **Estado retenido nuevo**: la lista de `{ value, entityType }` por documento, **re-aplicada después de toda re-detección** — en la práctica, el único flujo de re-detección que puede dropear ocurrencias `Manual` es `runReanalyzeOcrFlow` (`runReanalyzeNerOffFlow` filtra por `source: NER` y nunca las toca) — y descartada en `closeDocument`/`dispose`. El test de la re-aplicación tras `reanalyze` (§14) es el que protege el modo de falla silencioso de ADR-061 §5 — sin él el dato desaparece del árbol sin aviso y se exporta sin anonimizar.
- [x] 24b. (Hito 10.7, PR 3 — ADR-061 §2 errata) `line-words.ts` consume `sharesVerticalBand` de `@anonly/shared` (`Contracts.md` §6) y borra su copia local. De-dup puro, **sin cambio de comportamiento**: el criterio promovido es idéntico al que esta función ya usaba, y sus tests actuales lo prueban. Va en este PR y no en uno propio porque es el mismo módulo (R-1 no se toca). `selectLineWords` **no** se mueve a `shared`: opera sobre `Replacement[]` y selecciona vecinas a la derecha, una forma que es del façade y de nadie más — lo compartido es el criterio de "misma línea", no el envoltorio.
- [x] 24c. (Hito 10.7, PR **3d** — ADR-061 §8 errata; **después del PR 3c** de `regex-engine`, que agrega `searchText`) `findText(documentId, query): ReadonlyArray<TextMatch>` entra a `IPipelineOrchestrator`: resuelve el `Document` retenido, delega en `regex.searchText` y devuelve. **Sincrónico** (`Contracts.md` §3.5 lo declara sin `Promise`, y `searchText` lo es). `documentId` inexistente → `InvalidInputError`, igual que `getPageWords`/`getPageSize`. Se borró la nota de ausencia que el PR 3 había dejado en `src/types.ts`. **No** pasa por `reopenSession`/`finishSession` ni emite nada: buscar no es agregar — el test de que el snapshot de Grouping no cambia (§14) es lo que lo protege. Desbloqueó el PR 6 (la lupa).
- [x] 24d. (Hito 10.7, PR **4c** — ADR-061 §6 errata) `addManualEntity` devuelve `Promise<ManualEntityResult>` (`Contracts.md` §3.5) en vez de `Promise<void>`: propaga el `occurrenceCount` del `RegexEngineOutput` que `regex.findLiteral` ya devuelve y que antes se descartaba. **Cero sigue sin lanzar** — es un resultado, no un error (ADR-061 §6). El conteo es el de `findLiteral`, o sea apariciones **antes** del dedup de Grouping: no se reinterpreta ni se recalcula contra el árbol. Cambio **aditivo**: los call sites que ignoran el retorno siguen compilando, así que los tests del PR 3 fueron la no regresión. `ManualEntityResult` se declaró en `src/types.ts`, junto a `ImportDocumentInput` y **no** en `shared` — ningún motor lo toca (errata de §6, punto 5). Los tres tests de §14. Desbloqueó el PR 4 (diálogo de agregado).
- [x] 25. (Hito 11, ADR-143) `runOcrStage` deja de rasterizar por adelantado: arma `OcrPageRequest[]` desde `Document.pages[pageIndex].width/height`/`region.bbox` × `scale` (`estimateRasterBytes`, función de módulo) y llama a `OcrEngine.processSession(requests, produce, ctx)` con un `produce: OcrImageProducer` que rasteriza vía `RenderEngine.rasterizePage` recién cuando `OcrEngine` lo pide. **No** toca el enrutamiento de página/región (ADR-065, `region` ahora vive en el descriptor en vez de ser un argumento posicional de `rasterizePage`) ni la mediación de fusión (ADR-014/ADR-041, sin tocar). `runReanalyzeOcrFlow` hereda el fix automáticamente: sigue llamando a `runOcrStage`.
- [x] 26. (Hito 11, ADR-151) `prewarmFirstPagePreview(documentId)`: invocación directa de `renderPage({pageIndex: 0, kind: "original", mode: "preview"}, mediatedPreviewCtx(documentId))`, disparada desde `handleGroupingFinished` en el mismo turno que `PIPELINE_READY`, después del early return de `cancelRequested`. Best-effort (catch + `logger.warn`, nunca `PIPELINE_FAILED`). Sin cambios en `Contracts.md`, el visor ni el store — `bus-bridge.ts` ya deja todo `PREVIEW_UPDATED` en `viewer.store.previewByPage`. Los tres tests de §14 (caso 32).

- [x] 27. (ADR-163, T-6a) `runOcrStage`: helper puro para el DPI efectivo de página completa; construir cada `OcrPageRequest` con su `dpi` y su `estimatedBytes` derivados de la misma escala. El `OcrImageProducer` usa `request.dpi / 72`, nunca una variable global. Regiones conservan `ctx.config.ocr.dpi`. No tocar `OcrConfig`, Render, OCR, eventos, fusión ni progreso. Tests de casos 34-36 y no-regresión cuando el campo falta.
- [x] 28. (Hito 12.5 — ADR-170 §2) `previewEdit(documentId, request)` en `IPipelineOrchestrator`: delegación en `GroupingEngine.previewEdit`, sincrónica, sin estado ni eventos. Un test en §14.
- [x] 29. (Hito 12.5 — ADR-171 §4) `addManualEntity` llama a `grouping.liftRemoval` antes de `reopenSession`; la re-aplicación de literales retenidos no. Caso 38 y su test.
- [x] 30. (Hito 12.5 — ADR-172 §1) `createEditCheckpoint`/`restoreEditCheckpoint`/`discardEditCheckpoints`: delegación en Grouping + copia de los literales retenidos bajo el mismo id; descarte en `reanalyze` (antes de `reopenSession`), `closeDocument` y `dispose`; precondición de etapa. Casos 39-40.

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
