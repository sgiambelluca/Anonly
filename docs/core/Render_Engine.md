<!-- CONTEXT: scope=render-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,ADR-004-Rendering.md,ADR-012-Replacement-Modes.md,ADR-030-RenderEngine-LoadDocument.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-086-El-Detector-De-Degradacion-Mide-El-Ancho.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md | audiencia=IA-implementador | fase=10 (§2/§13 casos 32-33/§14/§15 ítem 29 en fase 10.9: un `Replacement` con `fragments` se expande en unidades de pintado, el token va en el fragmento más ancho y el veredicto de degradación se computa contra ése —ADR-074 §4-§6—; §6/§8/§12/§13 actualizados en fase 10: RENDER_REQUESTED.scale, guard MAX_RENDER_SCALE, cache LRU por escala + límite de bytes, supersede, ADR-037; reparto host/worker para PR13 por ADR-043; retiro del delta render por eventos de grouping por ADR-044; opciones de fuentes/CMaps de pdf.js en el kernel por ADR-053, cierre de fase 10; §2/§8/§13/§14/§15 en fase 11: RENDER_REQUESTED.kind requerido y render de un solo lado por ADR-056; §2/§6/§9/§13/§14/§15 en fase 10.5: shrink-to-fit, repintado de línea por calibración, lineWords y AnnotationKind.Degraded por ADR-058; renderLegendPage y RenderLegendPayload por ADR-059 §5; §6/§13/§14/§15 en fase 10.8: rasterizePage gana region?: BoundingBox —ADR-065 §5, caso 30— y paintReplacements rota el token cuando bbox.rotation es 90/270 —ADR-066 §7, caso 31—; §15 en fase 10.7: ítem 28, el kernel consume sharesVerticalBand de @anonly/shared en vez de su copia local —errata de ADR-061 §2, de-dup diferible—; post-Hito 10.10: §7/§12/§14/§15 por ADR-062 —el veredicto de degradación viaja en `PREVIEW_UPDATED.degraded` y se guarda en la entrada del cache, para que el acierto emita lo mismo que el fallo— y §2/§13 casos 25 y 28/§14/§15 por ADR-086 —el criterio pasa a la razón de anchos, la referencia va sin piso ni redondeo y el piso de dibujo escala; la calibración del caso 26 conserva el piso SIN escalar—) -->

# Render Engine — Spec de Motor

> Renderiza páginas del PDF (original o anonimado) a imágenes usando OffscreenCanvas en Web Workers. Produce highlight de grupos habilitados y aplica reemplazos visualmente según `ReplacementMode`. Soporta preview incremental y render full para export.

**EngineId**: `render`
**Versión del spec**: 1.13.0
**Última actualización**: 2026-08-09

> **Nota (v1.13.0, ADR-066 §7, 2026-08-10 — el reemplazo sobre texto vertical se pinta rotado)**: `paintReplacements` llamaba `fillText` siempre horizontal, con el `maxWidth` limitado al **ancho** del bbox. Sobre una firma digital vertical —franja de 16×173 pt— eso encoge el token hasta el piso de 8 px y lo recorta igual: el dato queda tapado, pero el reemplazo es ilegible. `BoundingBox` gana `rotation` (ADR-066 §6, **supersede ADR-063 §5**) y cuando vale `90` o `270` el kernel rota el contexto —`translate` al centro, `rotate`, dibujar centrado, `restore`— y el shrink-to-fit de ADR-058 §1 mide contra el **lado largo** de la caja en vez de contra `width`. **La garantía dura de ADR-058 §1 no cambia**: nada se derrama fuera del rectángulo; lo único que cambia es contra qué eje se mide para lograrlo. En la firma medida el token pasa de 16 pt de largo disponible a 173, con el cuerpo mandado por el lado corto. `redact` es inmune (rellena el rectángulo) y **180° no se rota** — quedaría cabeza abajo, que es peor que horizontal, y la caja es la misma. Sin `rotation`, el pintado es idéntico al previo. Ver §6, §13 caso 31, §14.

> **Nota (v1.12.0, ADR-065 §5, 2026-08-09 — `rasterizePage` acepta un recorte)**: el OCR por región del Hito 10.8 necesita el raster de **una parte** de la página, no de la página entera. `rasterizePage` gana un quinto parámetro **opcional** `region?: BoundingBox`, en puntos de página (el mismo espacio que cualquier `bbox`, `03_Data_Model.md` §137), que el motor multiplica por `scale` y clampea a los límites de la página. **Ausente es el comportamiento previo, bit a bit**, así que el flujo de OCR de páginas textless no se toca. Va acá y no en el caller —que podría rasterizar entero y recortar host-side— porque así el `ImageData` que cruza el boundary del worker es solo el recorte: a 300 DPI una A4 completa son ~35 MB, y transportarlos para quedarse con el 15% es desperdicio en el punto más caro del pipeline. Sin cambios de eventos, cache LRU ni supersede: el perfil de "render sin efectos" de ADR-034 §1 queda intacto. Ver §6, §13 caso 30, §14.

> **Nota (v1.11.0, ADR-062, 2026-08-09 — el veredicto de degradación sale del motor)**: la anotación `Degraded` de ADR-058 §7 se calculaba con el `groupId` puesto, se pintaba y **se descartaba**: ni `KernelRenderResult` ni `RenderPageOutput` la llevaban, así que el árbol de entidades no tenía forma de saber qué grupo degradó. Se especifica el camino de vuelta, **sin tocar ni el umbral ni la anotación ni el dibujo**: el kernel devuelve las `Degraded` que detectó, el host las guarda en la entrada del cache LRU y las emite en `PREVIEW_UPDATED.degraded` (§7). **El cache hit las emite igual, desde la entrada guardada** — un hit no corre el kernel, y sin esto la marca de la UI se apagaría sola al volver a una página ya vista (ADR-062 §4). El campo es **opcional con ausencia ≡ vacío** (ADR-062 §2), mismo criterio que `lineWords`; en `kind: "original"` va vacío por construcción. Este motor **no** agrega ningún evento ni entrada pública nueva, y sigue siendo el único que juzga legibilidad: la agregación por grupo es estado derivado de la UI (ADR-062 §5). Ver §7, §12, §14 y §15 ítem 8f.

> **Nota (v1.10.0, ADR-059 §5, 2026-08-06 — `renderLegendPage`: el único render que no es de una página del documento)**: la leyenda opcional de marcadores del export **se rasteriza como cualquier otra página** —decisión de ADR-059 §4, para que "el export es 100% imagen" siga siendo auditable en un segundo en vez de convertirse en un juicio sobre el contenido de una capa de texto—, y `export-engine` no tiene canvas. Este motor gana `renderLegendPage(rows, pageWidthPt, pageHeightPt, ctx): Promise<EncodedPageImage>`: un dibujo **puro sobre un `OffscreenCanvas` en blanco**, sin `pageProxy`, sin pdfjs, sin cache LRU, sin supersede y sin eventos — mismo perfil que `rasterizePage` (ADR-034 §1), que ya estableció el precedente de "render sin efectos". **No requiere `loadDocument` previo**, a diferencia de todo el resto del motor: es la única entrada del spec que no habla de un documento. Recibe `MarkerLegendRow`, que son **strings ya compuestos** — el kernel dibuja texto y no gana ninguna dependencia semántica sobre `EntityType`, `EntityGroup` ni labels. Cruza al RenderWorker como `RenderLegendPayload` bajo `jobType: "render-page"`, **sin agregar un `WorkerJobType` nuevo**, sumando un quinto caso al orden estricto de discriminación por forma de ADR-043 §4. Quien lo invoca es el Orchestrator, implementando `RenderPageProvider.renderLegend` para Export (P-1: los motores no se importan entre sí). Ver §2, §6, §13 caso 29, §14 y §15.
>
> **Nota (v1.9.0, ADR-058, 2026-08-06 — el reemplazo deja de derramarse, y la línea afectada se repinta)**: `paintReplacements` derivaba el tamaño de fuente **solo de la altura** del bbox y llamaba `fillText` **sin `maxWidth`**, con el texto centrado: un token más ancho que su caja se derramaba hacia los dos lados, más allá del rectángulo blanco, encima de palabras del original que seguían dibujadas debajo. Afectaba a `mask`, `synthetic` y `placeholder` (`redact` es inmune). Se resuelve con una **cascada de cuatro piezas, de las cuales solo la primera es una garantía**: (1) **shrink-to-fit** con `measureText` — nada se derrama nunca, en ningún caso, y cierra el defecto por sí solo; (2) **repintado de línea**, solo cuando el token no entra: se tapa de la entidad al fin de línea y se redibuja cada palabra siguiente **en su propia x desplazada por el delta** —reposicionamiento, no re-maquetado, para que el error no se acumule y el texto justificado sobreviva—; (3) la tipografía se deduce por **calibración inversa** contra los anchos reales de `lineWords` y el color se **muestrea del canvas** con `getImageData`, sin extraer nada del PDF — lo que hace que funcione **igual en documentos escaneados**; (4) cuando el repintado no es seguro se cae a (1) y, si el encogido pasó `DEGRADED_FONT_RATIO`, se marca con `AnnotationKind.Degraded`. `RenderPagePayload` gana `lineWords?` (seleccionadas host-side por el Orchestrator, precedente `fuseOcrPage`/ADR-041; ausentes es el caso normal y nunca un error). **ADR-004 y ADR-009 quedan intactos**: todo pasa sobre el canvas, antes del `convertToBlob`, y el export sigue siendo raster. El reparto host/worker de ADR-043 tampoco se toca: la lógica nueva vive entera en el kernel sin estado. Ver §6, §9, §13 casos 4-6 reescritos y 25-28 nuevos, §14, §15.
>
> **Nota (v1.8.0, ADR-056, 2026-08-05 — `RENDER_REQUESTED` dice de qué panel viene; el motor renderiza un solo lado)**: `RenderRequested` (`Contracts.md` §8) gana `kind: "original" | "anonymized"` **requerido**, y `handleRenderRequested` deja de reconstruir incondicionalmente los dos `RenderPageInput` por página: renderiza **solo** el `kind` pedido. Renderizar los dos era correcto mientras los dos paneles del visor mostraban siempre el mismo rango (scroll sincronizado por diseño); con el scroll independiente de ADR-054 dejó de serlo, y scrollear un panel refrescaba el otro — el usuario veía recargarse un visor que no había tocado, y la mitad del trabajo de render se iba en páginas que nadie miraba. Restricción dura que acompaña al cambio (ADR-056 §4): la entrada de supersede (`registerPendingRender`, ADR-037 §4) se registra **únicamente para el `kind` pedido** — registrar los dos haría que el pedido de un panel abortara renders en vuelo legítimos del otro, que es el error natural al hacer este cambio de forma mecánica. Interfaz pública de §6: sin cambios de firma (`renderPage`/`renderPages` ya recibían `kind` en su input).

> **Nota (v1.7.0, ADR-053, 2026-07-31 — pdf.js dentro del RenderWorker no puede usar la Font Loading API)**: el kernel corre la capa de display de pdf.js dentro de un Web Worker, donde no existe `document`. El registro del `@font-face` falla con un `TypeError` que pdf.js **no loguea**, y como `disableFontFace` queda en `false` (su default en browser), el motor dibuja los `fontChar` del área de uso privado contra una fuente que nunca se registró: todo el texto de esas páginas sale como glifos `.notdef` (cuadrados), en preview **y** en export, que compone el mismo raster. Falla en silencio y solo para los documentos cuyas fuentes están subseteadas o usan encodings no triviales — de ahí que unos PDFs se vieran perfectos y otros no. `kernelLoadDocument` pasa a configurar `getDocument()` según la regla transversal de `05_Worker_Architecture.md` §7: `disableFontFace: true` (glifos por `Path2D`, sin DOM), `useSystemFonts: false`, `useWorkerFetch: false` **explícito**, `cMapUrl`/`cMapPacked`/`standardFontDataUrl` first-party, y **factories propias** de CMap y de standard fonts porque las `DOM*` de pdf.js tocan `document.baseURI` en su primer fetch. Las tres trampas que hacen que omitir cualquiera de esas piezas rompa el visor entero están en ADR-053, Contexto §6. Interfaz pública de §6: sin cambios de firma.
>
> **Nota (v1.6.0, ADR-050, 2026-07-30 — `loadDocument` acepta el password de un PDF protegido)**: `loadDocument` gana un tercer parámetro **opcional** `password?: string`, que el kernel pasa a `getDocument({ data, password })`. Sin él, un PDF protegido abierto con éxito por `PdfEngine` moría acá con `RenderFailedError("No password given")`, rompiendo los tres caminos que dependen de la carga en Render (rasterización para OCR, seed del preview de ADR-044 y export en `mode: "full"`) — bug transporte-independiente, abierto desde ADR-030 y nunca ejercitado porque el Escenario 3 E2E estuvo en `fixme`. El **host** retiene el password junto a `{ buffer, pageCount }` porque lo necesita para re-primear workers nuevos o reemplazados (ADR-043 §5); el **worker no lo retiene** (el `PDFDocumentProxy` ya queda abierto). Ver la enmienda de `08_Security_Model.md` §6 (ADR-050 §3): dónde vive el secreto y hasta cuándo. Para PDFs no protegidos no cambia nada.

> **Nota (ADR-044, 2026-07-23 — el motor deja de escuchar eventos de Grouping; el delta render por overrides se retira)**: los reemplazos autoritativos del preview `anonymized` le llegan al motor por invocación directa del Orchestrator (`renderPage({ kind: "anonymized", mode: "preview", replacements })`, computados desde el snapshot de Grouping — `Orchestrator.md` v1.5.0 §2/§8/§13 casos 26–27). Se retiran de este spec: las suscripciones a `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` (§8), `requestDeltaRender` (§6 — sin callers externos), el estado `groupOverrides` + `apply*Overrides` y el índice `pageIndex → groupIds` (`pageGroupIndex`, §12 — su único consumidor era `requestDeltaRender`). Motivo: el primer render `anonymized` salía con `replacements: []` y dejaba `pageGroupIndex` vacío para siempre (deadlock de arranque del preview), y el mecanismo de overrides era lossy (un toggle off→on no podía resucitar los `Replacement` filtrados del input recordado). `lastAnonymizedInputs`/`lastOriginalInputs` **se conservan** (reconstrucción de `RENDER_REQUESTED`, nota de implementación 1), igual que todo el reparto host/worker, supersede y cache de ADR-043/ADR-037. Canales escuchados: solo `EventChannel.UI`.

> **Nota (ADR-043, 2026-07-22 — reparto host/worker para PR13)**: la clase `RenderEngine` queda **entera host-side** — estado (`documents`, cache LRU, `groupOverrides`, `lastAnonymizedInputs`/`lastOriginalInputs`, `pageGroupIndex`, `pendingRenders`), suscripciones (§8), supersede (ADR-037 §4), delta render y emisión de eventos/blob URLs. Al worker va un **kernel sin estado por documento** (pdfjs + OffscreenCanvas + encode; `05_Worker_Architecture.md` §7.4), salvo los `PDFDocumentProxy` cargados por broadcast. Todas las vías de render convergen en `RenderPool.dispatch({ payload, run })` (seam PR11): con factory despacha al worker; sin factory corre el kernel in-process (fallback bit-idéntico, ADR-035). En modo worker, `documents` retiene `{ buffer, pageCount }` (no proxies — viven en cada worker); `unloadDocument` emite el broadcast `unload-document` (ADR-043 §4) y los workers nuevos/reemplazados se re-primean con `load-document` de todos los documentos vigentes (ADR-043 §5). Interfaz pública de §6: sin cambios de firma.

> **Nota (2026-07-19, hallazgo de revisión Hito 10 PR4)**: alcance del supersede de ADR-037 §4 precisado — participa únicamente el flujo originado en `RENDER_REQUESTED` (§8); las invocaciones directas de `renderPage`/`renderPages` (export del Orchestrator vía `RenderPageProvider`, tests) y el delta render interno son inmunes a las entradas de supersede que ese flujo deja registradas (§13 caso 21). `rasterizePage` nunca participó del mecanismo. Sin cambio de contrato público (detalle de implementación interno del motor; no requiere ADR): interfaz de §6, eventos y la clave `(documentId, pageIndex, kind)` de ADR-037 §4 quedan idénticos.

> **Nota (ADR-034, 2026-07-16)**: dos ampliaciones de contrato para el Hito 9: (1) `rasterizePage(documentId, pageIndex, scale, ctx)` — rasterización pura a `ImageData` para el flujo OCR del Orchestrator, **sin** emisión de eventos ni cache LRU (§6); (2) `RenderPageOutput.encoded?: EncodedPageImage`, presente cuando `mode === "full"`, con los bytes codificados que consume el `RenderPageProvider` del Orchestrator (§6, §10; `EncodedPageImage` es canónico de `Contracts.md` §7 desde ADR-034 §3). La creación real del blob de `PREVIEW_UPDATED` (`convertToBlob`, reemplaza el placeholder inline de ADR-031 §5) también llega en el Hito 9.

> **Nota (ADR-031, 2026-07-16)**: `EngineErrorCode.RENDER_FAILED` se agrega a Contracts.md §4 (la fila de §11 lo referenciaba sin respaldo desde v1.0.0). Erratas: la clave del cache LRU incluye `annotations` en el hash (§15.12); el highlight colorea por `AnnotationKind`, no "por tipo" (§13.7). Cast de frontera pdfjs↔OffscreenCanvas permitido en un único punto documentado (Code_Standards §10).

> **Nota (ADR-030, 2026-07-12)**: se agregan `loadDocument`/`unloadDocument` a la interfaz pública (§6). El motor obtiene el PDF fuente por invocación directa del caller (Orchestrator en Hito 9; façade/tests en Hito 7) y mantiene un `Map<documentId, PDFDocumentProxy>` interno. `RenderPageInput` y los eventos no cambian.

> **Nota (ADR-027, 2026-07-11)**: el tipo de config canónico es `RenderConfig` (Contracts.md §6); el alias `RenderEngineConfig` de §6/§15.2 queda eliminado (mismo patrón que ADR-021 §2, ADR-023 §1 y ADR-026).

> **Nota (ADR-021, 2026-07-09)**: este motor se implementa **inline** en su hito, sin crear su pool propio; `WorkerPoolManager` y los pools llegan con el Orchestrator (Hito 9), sin cambio de interfaz pública (precedentes ADR-013/ADR-020). Leer §12 y los ítems de workers/pool del §15 como Hito 9; cancelación cooperativa con checkpoints inline, el SLA < 200 ms se valida en Hito 9/11. Los tests unit/contract/edge mockean la frontera de la librería externa (Code_Standards §10, ADR-021 §5).

> **Nota (ADR-037, 2026-07-17)**: zoom con re-render real. El pipeline de render ya era paramétrico en escala (`RenderPageInput.scale`, `rasterizePage`); lo que faltaba era transportarla en el evento `RENDER_REQUESTED` (`Contracts.md` §8) — ahora el handler del evento la propaga a `renderPages` (§8). Tres piezas nuevas: (1) guard de rango `0 < scale ≤ MAX_RENDER_SCALE` (`InvalidInputError` en invocación directa, `warn` + no-op por evento — §11, §13); (2) la clave del cache LRU de previews incorpora la escala efectiva, y el cache gana un límite adicional por bytes (`PREVIEW_CACHE_MAX_BYTES`, §12); (3) supersede por página: un `RENDER_REQUESTED` con escala distinta descarta el pendiente en cola de esa página o aborta el que está en vuelo, y nunca emite `PREVIEW_UPDATED` de una escala obsoleta (§8, §13). Todo esto vive íntegramente en este motor; el Orchestrator no se toca (no se suscribe a `RENDER_REQUESTED`, ADR-034 §7).

---

## 1. Objetivo

Recibir requests de renderizado por página (`RENDER_REQUESTED` o invocación directa del Orchestrator) y producir imágenes (PNG/JPEG) de cada página, aplicando reemplazos visuales para el lado "anonimizado" o solo highlight para el lado "original".

---

## 2. Responsabilidades

- Renderizar páginas del PDF a `ImageData` o `Blob` (PNG/JPEG) usando OffscreenCanvas en `RenderPool`.
- Cargar el PDF fuente por `documentId` (`loadDocument`) y mantener un `Map` interno de `PDFDocumentProxy` (pdfjs-dist) hasta `unloadDocument`/`dispose` (ADR-030).
- Para `kind = "original"`: render del PDF sin reemplazos, con highlight de grupos habilitados (borde color sobre bbox).
- **Pintar por fragmento, nunca la envolvente** (ADR-074 §4): un `Replacement` con `fragments` (`03_Data_Model.md` §12) se expande, **antes** del bucle de pintado, en N **unidades de pintado** con un rectángulo simple cada una — una **primaria**, que lleva el `replacementValue` y pasa por el camino completo de siempre (shrink-to-fit, repintado de línea, veredicto de degradación), y N-1 de **solo tapado**, que hacen el mismo fondo sin dibujar texto. Sin `fragments` (el caso normal) hay una sola unidad y el pintado es idéntico al previo al ADR. Este motor **no decide** dónde corta la entidad: recibe los rectángulos ya calculados por quien la detectó.
- Para `kind = "anonymized"`: render del PDF con reemplazos aplicados visualmente según `ReplacementMode`:
  - `placeholder` → texto `[<LABEL> <NN>]` sobre bbox (el label puede venir abreviado por ADR-057; este motor no lo decide, solo lo dibuja).
  - `synthetic` → texto sintético sobre bbox.
  - `mask` → texto censurado (`XX.XXX.XXX`) sobre bbox.
  - `redact` → fill opaco negro sobre bbox (sin texto).
- **Garantizar que ningún texto de reemplazo se salga de su ancho disponible** (ADR-058 §1): medir con `measureText` y ajustar el tamaño de fuente hasta que entre, **con el piso de fuente mínima escalado por la escala de render** (ADR-086 §2(b); era un piso absoluto de 8px hasta entonces, lo que aplicaba dos umbrales visuales distintos a la misma decisión según el zoom). Aplica a los tres modos con texto, siempre. Es la única garantía dura de ADR-058; el resto de sus piezas son calidad.
- Cuando el token **no** entra y las condiciones de ADR-058 §6 se cumplen, **repintar la línea**: tapar de la entidad al fin de línea y redibujar el token más cada palabra siguiente de `lineWords` en su propia x desplazada por el delta, con la tipografía calibrada (§6) y los colores muestreados del canvas. Si el token entra, no se repinta nada.
- Emitir `AnnotationKind.Degraded` sobre las ocurrencias cuyo texto de reemplazo quedó **más angosto que `DEGRADED_FONT_RATIO` de su ancho natural** (ADR-058 §7, criterio reemplazado por **ADR-086 §1**).
- Rasterizar la **página de leyenda** del export (`renderLegendPage`, ADR-059 §5): dibujo puro de filas de texto sobre un canvas en blanco, sin documento, sin eventos y sin cache. Es el único render de este motor que no corresponde a una página de un PDF.
- Soportar dos calidades: `preview` (escala baja, rápido) y `full` (escala alta, para export).
- Emitir `PREVIEW_UPDATED` (por página, preview), `RENDER_FINISHED`, `RENDER_FAILED`, `PREVIEW_PAGE_FAILED`.
- Escuchar `RENDER_REQUESTED` (único evento consumido desde ADR-044; los cambios de grupos llegan mediados por el Orchestrator como invocaciones directas de `renderPage`).
- Transferir zero-copy `ImageData`/`ArrayBuffer` de vuelta al host.
- Propagar `RENDER_REQUESTED.scale` a `renderPages` (ADR-037 §1); validar contra `MAX_RENDER_SCALE` y aplicar el supersede por página de renders obsoletos (ADR-037 §4), registrando la entrada de supersede **solo para el `kind` pedido** (ADR-056 §4).
- Renderizar **únicamente el `kind` que trae `RENDER_REQUESTED`** (ADR-056 §1), nunca los dos: cada panel del visor pide lo suyo y el motor no infiere nada sobre el otro.

---

## 3. Fuera de alcance

- Ensamblar el PDF final (es tarea de `export-engine`).
- Detectar entidades.
- Agrupar ocurrencias.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Decidir el modo de reemplazo (lo decide Grouping; Render solo lo aplica).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `pdfjs-dist` (para render del PDF a canvas; ADR-001)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `BoundingBox`, `EntityGroup`, `Replacement`, `ReplacementMode`, `Annotation`, `RenderConfig`, `Word`, `EncodedPageImage` (ADR-034 §3)
- `architecture/04_Event_System.md`: `RENDER_REQUESTED`, `RENDER_FINISHED`, `RENDER_FAILED`, `PREVIEW_UPDATED`, `PREVIEW_PAGE_FAILED` (`GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` retirados de este motor por ADR-044 — ver nota de cabecera)

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib` (pdf-lib es del export-engine)
- Node builtins, libs de network

---

## 6. Interfaces públicas

```ts
// RenderConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-027).
export interface RenderConfig {
  readonly previewScale: number;     // default 1.0 (relativo a 72 DPI)
  readonly fullScale: number;        // default 2.08 (~150 DPI)
  readonly jpegQuality: number;      // default 0.85
  readonly cachePages: number;       // default 16 (LRU)
}

export interface RenderPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;  // si kind = "anonymized"
  readonly annotations?: ReadonlyArray<Annotation>;     // highlights, conflicts
  readonly scale?: number;                              // override
  readonly imageFormat?: "png" | "jpeg";               // default png preview, jpeg full
  readonly lineWords?: ReadonlyArray<Word>;             // ADR-058 §5; ver abajo
}

export interface RenderPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly imageData: ImageData;   // transferido (zero-copy) al host
  readonly encoded?: EncodedPageImage; // presente si mode === "full": bytes codificados
                                       // (imageFormat efectivo + config.render.jpegQuality),
                                       // generados donde vive el canvas (ADR-034 §3)
  readonly durationMs: number;
}

export class RenderEngine implements IEngine {
  readonly id = EngineId.Render;
  init(ctx: EngineContext): Promise<void>;
  loadDocument(documentId: string, buffer: ArrayBuffer, password?: string): Promise<void>; // password: ADR-050
  unloadDocument(documentId: string): Promise<void>;
  renderPage(input: RenderPageInput, ctx: EngineContext): Promise<RenderPageOutput>;
  renderPages(inputs: ReadonlyArray<RenderPageInput>, ctx: EngineContext): Promise<ReadonlyArray<RenderPageOutput>>;
  // ADR-034 §1; `region` (opcional) desde ADR-065 §5: recorte en PUNTOS de
  // página (mismo espacio que cualquier BoundingBox), que el motor multiplica
  // por `scale` y clampea a los límites de la página. AUSENTE = página entera,
  // bit a bit el comportamiento previo a ADR-065.
  rasterizePage(documentId: string, pageIndex: number, scale: number, ctx: EngineContext, region?: BoundingBox): Promise<ImageData>;
  renderLegendPage(                                                                        // ADR-059 §5
    rows: ReadonlyArray<MarkerLegendRow>,
    pageWidthPt: number,
    pageHeightPt: number,
    ctx: EngineContext,
  ): Promise<EncodedPageImage>;
  dispose(): Promise<void>;
}
```

> `requestDeltaRender` retirado por ADR-044 (sus únicos callers eran los handlers de `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`, también retirados; el re-render por cambio de grupo lo dispara el Orchestrator con `renderPage` y reemplazos del snapshot).

Semántica de `lineWords` y del repintado de línea (ADR-058 §2-§6):

- **Quién las produce**: el Orchestrator, con una función pura host-side que filtra desde `Page.words` las palabras que comparten línea con cada reemplazo. Mismo reparto que `fuseOcrPage` (ADR-041): lógica pura que necesita el `Document` completo, ejecutada por el host, sin estado retenido y sin que ningún motor importe a otro. **Incluye palabras de OCR** (`source: "ocr"`) exactamente igual que las de PDF — es lo que hace que el repintado funcione en documentos escaneados.
- **Cuándo llegan**: solo cuando algún token de esa página podría no entrar, estimado con `estimateTokenWidth` (`Contracts.md` §6) y con margen conservador — ante la duda, se adjuntan. En una página donde todo entra van ausentes y el transporte no cambia respecto de antes de ADR-058.
- **Ausentes nunca es un error.** Si el kernel mide que el token no entra y no tiene `lineWords`, cae al shrink-to-fit (ADR-058 §1) y produce un resultado correcto.
- **Por qué no las extrae el worker**: el kernel tiene el `pageProxy` y podría llamar `getTextContent()` él mismo, ahorrando el cambio de contrato — pero en un PDF escaneado eso devuelve vacío, y las únicas palabras que existen son las de OCR, que viven en el `Document` del Orchestrator. Sería duplicar acá una responsabilidad de `pdf-engine` para obtener un resultado peor.
- **Calibración de la tipografía**: se prueban candidatos —familia genérica (`serif`/`sans-serif`/`monospace`) × peso × estilo, tamaño desde `REPLACEMENT_FONT_HEIGHT_RATIO`— y se elige el que minimiza el error entre `measureText` y los anchos reales de las palabras de la línea. **Se ajusta sobre el conjunto de la línea, no palabra por palabra**: ADR-020 prorratea el ancho dentro de cada run, así que la suma es exacta y los individuales aproximados. **Solo familias genéricas**: el kernel corre con `disableFontFace: true` dentro de un Worker (ADR-053), donde no hay Font Loading API. Si el mejor candidato queda por encima del umbral de error, **no se calibra** y se cae al fallback: una calibración mala produce exactamente la costura visible que se quería evitar.
- **Colores**: `getImageData` sobre el bbox de la palabra original, **antes** de tapar nada y una sola vez por línea repintada. El píxel más oscuro dentro del glifo es la tinta; el color dominante del borde de la caja es el fondo. `REPLACEMENT_BG_COLOR`/`REPLACEMENT_TEXT_COLOR` dejan de ser constantes fijas en este camino, lo que resuelve de paso los fondos de color y sombreados. En una página sin reemplazos que no entren, este mecanismo no agrega ni una lectura del backing store.
- **Reposicionamiento, no re-maquetado**: cada palabra se redibuja en su propia x más un desplazamiento **uniforme**. Es lo que evita que el error de calibración se acumule a lo largo del renglón y lo que preserva el espaciado del texto justificado.

Validación de `scale` (ADR-037 §2): rango válido `0 < scale ≤ MAX_RENDER_SCALE` (`Contracts.md` §6, default 4). Vía invocación directa (`renderPage`/`renderPages`), `scale` inválido o no finito → `InvalidInputError` — endurece una laguna previa (el campo no declaraba validación). Vía evento (`RENDER_REQUESTED`), `scale` inválido → `warn` + no-op del evento (no hay caller al que lanzarle, mismo tratamiento que documento no cargado).

Semántica de `rasterizePage` (ADR-034 §1):

- Rasteriza la página **sin reemplazos ni highlights** (uso: alimentar el OCR desde el Orchestrator, que no puede importar pdfjs).
- **No emite eventos** (`PREVIEW_UPDATED` incluido) y **no toca el cache LRU** de previews.
- Precondición: documento cargado vía `loadDocument`; si no, `InvalidInputError` (ADR-030). `pageIndex` fuera de rango o `scale <= 0` → `InvalidInputError`. Fallo de pdfjs/canvas → `RenderPageFailedError` (retryable).
- En modo pool corre como job del `RenderPool`; el `ImageData` se transfiere zero-copy al host.

Semántica de `renderLegendPage` (ADR-059 §5):

- Dibuja la **página de leyenda del export** sobre un `OffscreenCanvas` en blanco del tamaño pedido y devuelve un `EncodedPageImage`. Es el único método del motor que **no requiere `loadDocument` previo** y que no corresponde a ninguna página de ningún PDF: no toca `pageProxy`, no toca pdfjs.
- **No emite eventos, no toca el cache LRU y no participa del supersede por escala** — mismo perfil que `rasterizePage` (ADR-034 §1).
- **Recibe strings ya compuestos** (`MarkerLegendRow`), no `EntityType` ni `EntityGroup`. La proyección desde los grupos y el armado de las filas viven del lado de Export/host; este motor dibuja texto y nada más, y no gana ninguna dependencia semántica nueva. Es lo que mantiene barato el cambio.
- **Layout**: una tabla de hasta 13 filas (cota de `EntityType`, ADR-059 §2) a `y` incremental con columnas a `x` fijas. Sin salto de línea, sin paginación, sin caso multipágina.
- **Quién lo invoca**: el Orchestrator, implementando `RenderPageProvider.renderLegend` para `export-engine` — que no puede importar este motor (P-1). Solo se invoca con `ExportOptions.includeMarkerLegend` activo.
- Cruza al RenderWorker como `RenderLegendPayload` bajo `jobType: "render-page"`, sin `WorkerJobType` nuevo; el entry-point lo discrimina por forma como quinto caso del orden de ADR-043 §4.
- Un fallo se propaga como `RenderPageFailedError` y el Export lo trata como fallo de página (retry, y si persiste `EXPORT_FAILED`): una leyenda que no se pudo dibujar **no** degrada a "export sin leyenda" en silencio (`Export_Engine.md` §13 caso 25).

Semántica de `loadDocument`/`unloadDocument` (ADR-030; precisiones de modo worker por ADR-043 §3-§5):

- `loadDocument` invoca `getDocument({ data: buffer, password })` de pdfjs-dist (el `password` solo si el caller lo pasó — ADR-050 §1) y guarda el `PDFDocumentProxy` en un `Map<string, PDFDocumentProxy>` interno. **Toma posesión del buffer**: el caller no debe reutilizarlo (coherente con la semántica de transferencia del Hito 9). En modo worker (PR13), el host retiene `{ buffer, pageCount }` (el `pageCount` lo devuelve el `COMPLETED` del broadcast `load-document`; los proxies viven en cada worker — buffer clonado por worker, `05_Worker_Architecture.md` §2.3) y usa el buffer para re-primear workers nuevos/reemplazados.
- `loadDocument` sobre un `documentId` ya cargado destruye el proxy anterior y carga el nuevo (re-carga determinística, sin leak).
- **Opciones de fuentes y CMaps (ADR-053)**: ese `getDocument()` lleva además `disableFontFace: true`, `useSystemFonts: false`, `useWorkerFetch: false`, `cMapUrl: "/pdfjs/cmaps/"` + `cMapPacked: true`, `standardFontDataUrl: "/pdfjs/standard_fonts/"`, y las factories propias de CMap/standard fonts. Las cinco opciones y las dos factories son **solidarias**: omitir `useWorkerFetch: false` hace que pdf.js evalúe `document.baseURI` y tire `ReferenceError` dentro del Worker, que `kernelLoadDocument` reclasifica como `RenderFailedError` — o sea, el visor entero deja de cargar documentos con un error que no menciona fuentes. Los dos prefijos son constantes nombradas del kernel, no config (ADR-053 §3); los assets los sirve la app bajo `/pdfjs/` (ADR-053 §4).
- **Password (ADR-050)**: el `password` que recibe `loadDocument` se retiene **host-side** junto a `{ buffer, pageCount }` —es lo que permite re-primear un worker nuevo o reemplazado con el mismo documento protegido (ADR-043 §5)— y se borra en `unloadDocument`/`dispose`, igual que el buffer. Viaja en `LoadDocumentPayload.password` a cada worker del broadcast; el **kernel lo usa en `getDocument` y no lo guarda** en ningún estado. Nunca se loguea ni se emite en un evento (`08_Security_Model.md` §6, enmendada por ADR-050 §3).
- `unloadDocument` destruye el proxy y libera la entrada; sobre un `documentId` desconocido es no-op idempotente. En modo worker, emite el broadcast `unload-document` (`UnloadDocumentPayload`, ADR-043 §4) para liberar el proxy de ese documento en cada worker.
- `dispose()` destruye todos los proxies cargados.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `PREVIEW_UPDATED` | al renderizar preview de una página, **y también en cache hit** | `PreviewUpdated` con `kind` (`"original" \| "anonymized"`, ver ADR-016), `canvasBlobUrl` y `degraded?` (ADR-062 §1) | async | sí |
| `PREVIEW_PAGE_FAILED` | al fallar preview de una página | `PreviewPageFailed` | async | sí |
| `RENDER_FINISHED` | al terminar un batch de render | `RenderFinished` | async | sí |
| `RENDER_FAILED` | al fallar un batch | `RenderFailed` | async | sí |

Canal: `EventChannel.Render`.

> Nota: `PREVIEW_UPDATED.canvasBlobUrl` es `URL.createObjectURL(blob)` creado en el host a partir del `ImageData` transferido. El motor (worker) devuelve `ImageData`; el host genera el blob URL. Esto evita `createObjectURL` en el worker (no siempre disponible).

> **Nota (ADR-062, `PREVIEW_UPDATED.degraded`)**: las anotaciones `Degraded` que el kernel detectó en **ese** render, devueltas al host junto con la imagen y emitidas con ella en un solo evento — la página que el usuario ve y el veredicto sobre esa página viajan juntos, nunca desfasados. Reglas del campo:
>
> - **Ausente ≡ vacío** (ADR-062 §2): las dos formas significan "esta página, ahora mismo, no tiene reemplazos degradados". La ausencia **nunca** significa "no sé". El campo es opcional para que `shared` → `render-engine` → `apps/react-client` puedan caer en commits separados con los gates verdes (mismo criterio que `lineWords`, ADR-058 §5).
> - **En `kind: "original"` va vacío** por construcción: ese render no pinta reemplazos. El consumidor igual tiene que filtrar por `kind` (ADR-062 §3) — no es responsabilidad de este motor.
> - **El cache hit lo emite desde la entrada guardada** (§12, ADR-062 §4). Es la regla que no se puede omitir: un hit no corre el kernel, y emitir vacío ahí apagaría la marca de la UI al volver a una página ya vista.
> - Este motor **no** agrega ni conserva estado por esto: emite el veredicto de cada render y se olvida. Agregar por grupo, reemplazar por página y decidir qué se muestra es de la UI (ADR-062 §5).

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `RENDER_REQUESTED` (canal `ui`) | un panel del visor pide preview/export de sus páginas | `renderPages` con los `pageIndices` indicados, **un solo `RenderPageInput` por página, del `kind` recibido** (ADR-056 §1), y el `scale` recibido (ausente → `previewScale`/`fullScale` según `mode`, ADR-037 §1); si hay un render pendiente en cola o en vuelo para la misma `(documentId, pageIndex, kind)` con otra escala, se descarta/aborta sin emitir `PREVIEW_UPDATED` (supersede, ADR-037 §4 — solo entre renders originados por `RENDER_REQUESTED`; las invocaciones directas de `renderPage`/`renderPages` no participan, caso 21) |

> **Reconstrucción del input y `kind` (ADR-056 §1/§4)**: el payload sigue sin traer `replacements`/`annotations`, así que el input se reconstruye desde el último recordado para esa página (`lastOriginalInputs`/`lastAnonymizedInputs`, nota de implementación 1) — pero **solo el del `kind` pedido**; el mapa del otro lado ni se consulta. Igual con `registerPendingRender`: se registra una sola entrada, la del `kind` pedido. Registrar las dos deja una entrada de supersede sobre la clave del **otro** panel y aborta renders en vuelo legítimos de ese panel apenas las escalas difieran. Antes de ADR-056 el handler reconstruía los dos lados sin condición posible, lo que era correcto mientras el visor tenía scroll sincronizado y dejó de serlo con ADR-054.

Canales escuchados: `EventChannel.UI` (único desde ADR-044; las suscripciones a `EventChannel.Grouping` — `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` → `requestDeltaRender` — se retiraron: ese camino era el deadlock de arranque + toggle lossy, ver nota de cabecera).

> Precondición (ADR-030): estas vías por eventos requieren que el documento esté cargado vía `loadDocument`. Si el `documentId` no está cargado, el motor loguea `warn` y no hace nada (no hay caller al que lanzarle) — mismo tratamiento que el Orchestrator da a `groupId` inexistente (06_Pipeline.md §11).

> **Cancelación de la vía por eventos (precisión ADR-052, 2026-07-30)**: `handleRenderRequested` corre con el `ctx` que el motor recibió en `init()` —el de la instancia, no el del documento—, así que un render originado en `RENDER_REQUESTED` **no** es cancelable con el `AbortSignal` por documento del Orchestrator (`abortRegistry.abort(documentId)`). Puede seguir en vuelo y emitir su `PREVIEW_UPDATED` después de un `DOCUMENT_CLOSED`; quien se hace cargo de ese caso es el Orchestrator, revocando el blob URL tardío (ADR-052 §2, `Orchestrator.md` §13 caso 11). El único mecanismo de descarte de esta vía es el supersede por escala (ADR-037 §4). No es un defecto del motor —el contrato de `IEngine.init(ctx)` es por instancia— pero conviene tenerlo escrito: sorprendió una vez.

---

## 9. Entradas

```ts
RenderPageInput {
  documentId: string;
  pageIndex: number;
  kind: "original" | "anonymized";
  mode: "preview" | "full";
  replacements?: ReadonlyArray<Replacement>;
  annotations?: ReadonlyArray<Annotation>;
  scale?: number;
  imageFormat?: "png" | "jpeg";
  lineWords?: ReadonlyArray<Word>;
}
```

**Restricciones**:
- El `documentId` debe haber sido cargado con `loadDocument` antes de `renderPage`/`renderPages`; si no, `InvalidInputError` (ADR-030). En las vías por eventos, documento no cargado → `warn` + no-op (ver §8).
- `pageIndex ∈ [0, pageCount)`.
- Si `kind = "anonymized"`, `replacements` debe estar poblado.
- `scale` si se omite usa `previewScale` o `fullScale` según `mode`.
- `imageFormat` default: `"png"` para preview (calidad), `"jpeg"` para full (tamaño).
- `lineWords` es **opcional y su ausencia no es un error** (ADR-058 §5): habilita el repintado de línea cuando está, y el motor cae al shrink-to-fit cuando no. No se valida contra `Page.words` ni contra `pageIndex`: el motor confía en la selección host-side y, si viniera vacío o incoherente, las condiciones de §13 caso 26 lo llevan al fallback sin error.

---

## 10. Salidas

```ts
RenderPageOutput {
  documentId: string;
  pageIndex: number;
  kind: "original" | "anonymized";
  imageData: ImageData;  // transferido
  encoded?: EncodedPageImage; // solo mode "full" (ADR-034 §3)
  durationMs: number;
}
```

El `ImageData` se transfiere zero-copy al host. El host lo convierte a `Blob` y luego `blobUrl` para la UI. En `mode: "full"`, `encoded` trae además los bytes PNG/JPEG ya codificados (`convertToBlob` donde vive el canvas, `07_Performance_Strategy.md` §10): es lo que consume el `RenderPageProvider` del Orchestrator para el Export (ADR-034 §3).

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `RENDER_PAGE_FAILED` | `RenderPageFailedError` | error de renderizado de una página (PDF.js lanza, OOM en canvas) | sí | reintentar 1 vez, si persiste emitir `PREVIEW_PAGE_FAILED` y continuar con otras páginas |
| `RENDER_TIMEOUT` | `RenderTimeoutError` | timeout (default 10 s por página preview, 30 s full) | sí | reintentar 1 vez |
| `RENDER_FAILED` | `RenderFailedError` | error fatal en batch, o `getDocument()` falla en `loadDocument` (PDF ilegible para pdfjs; excepcional, la etapa 1 ya lo validó — ADR-030) | no | emitir `RENDER_FAILED`, abortar batch |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `renderPage` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `renderPage` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined, `pageIndex` fuera de rango, `documentId` no cargado (`loadDocument` pendiente), buffer vacío/null en `loadDocument` (ADR-030), o `scale` fuera de `(0, MAX_RENDER_SCALE]`/no finito en invocación directa (ADR-037 §2) | no | bug del caller |

`retryable`: `RENDER_PAGE_FAILED = true`, `RENDER_TIMEOUT = true`. Resto `false`.

---

## 12. Consideraciones de rendimiento

- Corre en `RenderPool` (workers con OffscreenCanvas).
- Costo: 100–500 ms por página preview; 300–1500 ms por página full (150 DPI).
- **Costo de `disableFontFace: true` (ADR-053)**: dibujar cada glifo como `Path2D` es más lento que `ctx.fillText`, y el impacto crece con la densidad de texto de la página. Es el precio de que el render sea correcto dentro de un Worker, no una opción a revisar: sin eso, las páginas con fuentes subseteadas salen en cuadrados. El PR que lo introduce **mide y reporta** el antes/después; optimizarlo (p. ej. cachear `Path2D` por glifo) es trabajo aparte, no de ese PR.
- Memoria: 40–120 MB por worker (canvas + PDF.js worker para render).
- `ImageData` se transfiere zero-copy de vuelta al host.
- Cache LRU: `cachePages = 16` páginas preview cacheadas en host. Si la página solicitada está en cache, no se re-renderiza. La clave incorpora la escala efectiva: `documentId:pageIndex:kind:mode:scale:hash(replacements ++ annotations)` (extiende la clave de ADR-031 §2 con `scale` — ADR-037 §3); entradas de escalas distintas coexisten y compiten por los mismos slots. Además del límite por items, el cache tiene un límite por bytes `PREVIEW_CACHE_MAX_BYTES = 200 MB` (`Contracts.md` §6, ADR-037 §3). Sin invalidación activa al cambiar de escala: las entradas viejas se evictan por LRU natural. Un cambio de escala **siempre re-renderiza** (no hay resampling del bitmap anterior en el motor; ese escalado transitorio es responsabilidad de la UI, ver `ui/Components.md` §5.2). **La entrada guarda además las anotaciones `Degraded` de ese render** (ADR-062 §4), y el hit las emite en `PREVIEW_UPDATED.degraded` igual que el miss: es lo que hace que el veredicto sobreviva al cache en vez de apagarse al volver a una página ya vista. La clave no cambia — `hash(replacements ++ annotations)` ya invalida cuando el usuario edita el `replacementValue`, que es exactamente el momento en que el veredicto tiene que recalcularse.
- Virtualización: solo se renderizan páginas visibles + 1 antes + 1 después. El host envía `RENDER_REQUESTED` solo para visibles.
- Re-render por cambio de grupo (ADR-044): lo dispara el Orchestrator — solo las páginas afectadas, con reemplazos recomputados del snapshot de Grouping (`Orchestrator.md` §13 caso 27). El motor ya no mantiene el índice `pageIndex → groupIds` ni overrides; cada invocación llega autocontenida y el cache LRU absorbe los inputs idénticos.
- Preview primero: si el usuario pide export (full), el motor prioriza preview de la página visible por encima del full de las demás.
- Cancelación: entre operaciones de Canvas (fill, drawImage, convertToBlob). SLA < 200 ms.
- Compresión: `convertToBlob({ type: "image/jpeg", quality: 0.85 })` para full; PNG para preview (sin pérdida, más rápido de comprimir en canvas chicos).

---

## 13. Casos límite

1. **Página sin entidades**: render del PDF sin reemplazos. `kind = "anonymized"` con `replacements = []` → idéntico al original (sin highlights).
2. **Grupo `enabled = false`**: las ocurrencias del grupo no se reemplazan en el render anonimizado. Aparecen como texto original.
3. **Modo `redact`**: fill opaco negro sobre bbox. El texto debajo no se incluye (se pinta antes del `convertToBlob`).
4. **Modo `mask`** (reescrito por ADR-058): texto censurado (`XX.XXX.XXX`) sobre el bbox, **ajustado a su ancho disponible** (`measureText` + `maxWidth`, ADR-058 §1). Es el modo con más riesgo de derrame porque sus formatos son de longitud fija por tipo y no se pueden acortar: el `mask` de IBAN son 24 caracteres, quepan o no.
5. **Modo `placeholder`** (reescrito por ADR-058): `[DNI 01]` sobre bbox, ajustado a su ancho disponible. El label puede llegar ya abreviado por ADR-057 (`[PERS 01]`, `[PRS-01]`); **este motor no elige el nivel, solo dibuja lo que recibe**. Fuente monospace si está disponible, fallback sans-serif — salvo en el camino de repintado, donde la familia sale de la calibración (§6).
6. **Modo `synthetic`** (reescrito por ADR-058): valor sintético (`39.123.456`) sobre bbox, ajustado a su ancho disponible. En el camino de repintado, la fuente sale de la calibración contra la línea real (§6), que es lo más cerca que se puede estar de "la misma fuente del texto original" sin extraer metadata del PDF.
7. **Highlight en `kind = "original"`**: borde color por `AnnotationKind` (ADR-031; `Annotation` no expone `EntityType`) sobre el bbox de cada ocurrencia de grupos habilitados. Sin fill, solo borde.
8. **Conflicto**: en `kind = "original"`, marca adicional (borde rojo o icono) sobre el bbox en conflicto.
9. **Página muy grande (A3 o más)**: preview scale reduce, full scale 150 DPI. Si el canvas excede limites del navegador (área máxima), se divide en tiles y se cosen (futuro; MVP limita a A4 150 DPI).
10. **1000 páginas**: virtualización + LRU cache. Solo se renderizan visibles. Memoria pico controlada por `cachePages`.
11. **(Retirado por ADR-044)** Delta render sin páginas afectadas: el caso vivía en `requestDeltaRender`; la selección de páginas afectadas por un cambio de grupo es ahora responsabilidad del Orchestrator (`Orchestrator.md` §13 caso 27).
12. **Cancelación entre páginas**: aborta en < 200 ms. El `ImageData` parcial se descarta.
13. **`renderPage` tras `dispose`**: lanza `EngineDisposedError`.
14. **OffscreenCanvas no disponible (Safari viejo)**: fallback a canvas en main thread (más lento). Detectar con `typeof OffscreenCanvas`. v1.0 puede requerir OffscreenCanvas y mostrar warning si no está.
15. **PDF con rotate (páginas rotadas 90/180/270)**: el render respeta la rotación de la página. Los bbox están en coords de página ya rotada (lo garantiza PDF Engine).
16. **`renderPage` sin `loadDocument` previo**: lanza `InvalidInputError`. Por evento (`RENDER_REQUESTED`): `warn` + no-op (ADR-030).
17. **`loadDocument` dos veces con el mismo `documentId`**: destruye el proxy anterior y carga el nuevo. `unloadDocument` de un id desconocido: no-op idempotente (ADR-030).
18. **Zoom cambia mientras hay un render en cola/en vuelo para la misma página (ADR-037 §4)**: el pendiente en cola se descarta sin ejecutarse; el que está en vuelo se aborta en su próximo checkpoint de Canvas; ninguno de los dos emite `PREVIEW_UPDATED`. Solo el request final (post-debounce de la UI) llega a completarse.
19. **`RENDER_REQUESTED.scale` fuera de rango o no finito**: `warn` + no-op del evento (sin caller al que lanzarle); vía `renderPage`/`renderPages` directo: `InvalidInputError` (ADR-037 §2).
20. **Cache a distintas escalas del mismo `(documentId, pageIndex, kind, mode)`**: coexisten como entradas separadas del LRU (clave incluye `scale`); compiten por `cachePages` y `PREVIEW_CACHE_MAX_BYTES` igual que cualquier otra entrada (ADR-037 §3).
21. **Invocación directa vs. supersede (hallazgo de revisión Hito 10 PR4; alcance simplificado por ADR-044)**: las entradas de supersede que registra el flujo de `RENDER_REQUESTED` solo afectan a renders originados por ese mismo flujo. Una invocación directa (`renderPage`/`renderPages` — el export del Orchestrator en `mode: "full"`, los renders mediados del preview de ADR-044 en `mode: "preview"`, tests) nunca las consulta: un export posterior a un preview por evento a otra escala se ejecuta siempre, aunque la entrada del preview siga registrada. Las entradas persisten hasta `unloadDocument`/`loadDocument` (reload)/`dispose` — deliberadamente NO se limpian al completar un render: limpiarlas reintroduce la carrera en la que un render en cola ya superado deja de detectar su reemplazo si el ganador completa y borra la entrada primero. `rasterizePage` no participa del mecanismo (ADR-034 §1).
22. **PDF protegido (ADR-050)**: `loadDocument` sin `password` sobre un PDF encriptado falla en `getDocument` (pdfjs: "No password given") y se mapea a `RenderFailedError` como cualquier otro fallo de carga (§11) — mismo tratamiento que ya tenía, no un camino nuevo. Con `password` correcto carga normal. El password retenido host-side sobrevive a un crash de worker (re-priming, ADR-043 §5) y muere con `unloadDocument`/`dispose`. Un `loadDocument` de re-carga (caso 17) sobre el mismo `documentId` reemplaza también el password retenido, incluido el caso "antes sin password, ahora con".
23. **`RENDER_REQUESTED` de un panel no toca al otro (ADR-056 §1)**: un evento con `kind: "original"` produce exactamente los renders de `original` para sus `pageIndices` — cero renders y cero `PREVIEW_UPDATED` de `anonymized`, aunque el otro panel esté mostrando esas mismas páginas. Simétrico para `anonymized`. El motor no tiene ninguna vía para inferir que el otro lado hace falta: si hace falta, el otro panel emite su propio evento.
24. **Supersede acotado al `kind` pedido (ADR-056 §4)**: un `RENDER_REQUESTED { kind: "original", scale: S }` **no** deja entrada de supersede sobre `(documentId, pageIndex, "anonymized")`. Un render de `anonymized` en vuelo a otra escala, originado por el pedido del otro panel, sobrevive y emite su `PREVIEW_UPDATED` normalmente. Es el caso que protege contra la implementación mecánica del cambio (registrar los dos kinds "porque antes se registraban los dos").
25. **Token más ancho que su bbox (ADR-058 §1)**: se encoge hasta entrar, con el piso de fuente mínima **escalado por la escala de render** (ADR-086 §2(b)), y **nunca** se dibuja fuera del ancho disponible. Vale para los tres modos con texto, con `lineWords` o sin ellas, se cumplan o no las condiciones de repintado. Es el caso que representa la garantía del ADR: si algún otro caso de esta lista falla, éste tiene que seguir valiendo.
26. **Condiciones de repintado no cumplidas (ADR-058 §6)**: el repintado se activa de forma conservadora y **cualquier duda cae al caso 25**. Requiere las cinco: (a) `lineWords` trae al menos una palabra a la derecha compartiendo banda vertical; (b) los huecos entre palabras consecutivas están en un rango plausible — un hueco desproporcionado delata una fila de tabla o columnas, no una línea; (c) la línea está alineada a la izquierda, inferido de las posiciones — en una centrada o alineada a la derecha, desplazar hacia la derecha es la operación equivocada; (d) el desplazamiento cabe antes del extremo derecho de la caja de texto inferida; (e) la calibración cerró bajo su umbral de error. En documentos con mucha tabla o mucho texto centrado el repintado casi no se va a activar, y eso es el comportamiento buscado, no una falla.
27. **Texto rotado (ADR-058 §6, gap conocido)**: `Word` no lleva rotación. *(Errata ADR-065: esta línea decía además que "`pdf-engine` descarta `transform[0]`/`[3]`", lo cual dejó de ser cierto con ADR-063 — el motor ya deriva el bbox de la matriz completa. La conclusión del caso no cambia: el bbox es correcto, pero `BoundingBox` sigue sin campo de rotación por decisión explícita de ADR-063 §5, así que el repintado sigue sin poder distinguir la orientación.)* El texto a **90°/270°** no pasa la condición (a) del caso 26 (sus palabras no comparten banda vertical) y se filtra solo. El texto a **180°** sí comparte banda y **no es distinguible con los datos disponibles**: gap residual reconocido, no bloqueante — el peor caso es una línea de sello o marca de agua repintada con las palabras corridas hacia el lado equivocado, sin superposición. Se verifica en el E2E manual con un PDF sellado. Cerrarlo requiere extender `Word` con la escala de la matriz, que es trabajo aparte con ADR propio.
28. **Aviso de degradación (ADR-058 §7, criterio reemplazado por ADR-086)**: si `anchoDisponible / anchoNatural` —donde `anchoNatural` es lo que el texto mediría a `boxHeight × REPLACEMENT_FONT_HEIGHT_RATIO`— cae por debajo de `DEGRADED_FONT_RATIO`, la ocurrencia se marca con `AnnotationKind.Degraded`, que `paintAnnotations` dibuja como cualquier otro `AnnotationKind`. **El umbral es una razón y no un tamaño en píxeles**, deliberadamente: preview y export renderizan a escalas distintas y un piso absoluto los haría discrepar sobre si el mismo reemplazo degrada.

    **Qué razón, y por qué cambió** (ADR-086): el criterio original medía `tamañoEfectivo / tamañoNatural`, o sea el encogido **vertical** de la fuente. Esa es justamente la compresión que en una caja de cuerpo de texto no puede ocurrir —los dos términos chocaban contra el piso de fuente mínima y el cociente daba 1,00 por construcción—, así que el aviso era inalcanzable fuera de titulares. Lo que arruina la legibilidad es el aplastado **horizontal** de `fillText(..., maxWidth)` (caso 25), y es lo que ahora se mide. No son dos mediciones: el producto de las dos compresiones se simplifica exactamente a la razón de anchos, porque el tamaño final se cancela.

    Y la invariancia de escala pasa de afirmada a **exacta**: el tamaño de referencia va sin piso y sin redondeo (nunca se dibuja), y `REPLACEMENT_MIN_FONT_PX` se multiplica por la escala de render al acotar el bucle de dibujo. Sin las dos cosas la razón derivaba con el zoom, y la misma ocurrencia daba sana a escala 1 y degradada a escala 2. **El piso escalado es del bucle de dibujo y solo de ahí**: la calibración del repintado (caso 26) usa el piso sin escalar, porque su `sizePx` tiene que aproximar el tamaño real de la línea en la página y un piso escalado lo infla hasta apagar el repintado por umbral de error. Caer al fallback **no** basta para avisar — si la señal apareciera en cada fallback aparecería en medio documento y el usuario aprendería a ignorarla. **Se pinta solo en `mode: "preview"`** (ADR-058, nota 2026-08-09): el veredicto se calcula igual en los dos modos, pero `mode: "full"` nunca lo dibuja — es el archivo que un tercero recibe, y hoy no hay ninguna afordancia (ADR-062 dejó la marca del árbol fuera de este hito) que le dé sentido a un recuadro de aviso ahí.
29. **`renderLegendPage` sin documento cargado (ADR-059 §5)**: funciona. Es la **única excepción** a la precondición de `loadDocument` que rige todo el resto del motor (casos 16 y 22): no hay documento del que hablar, es un dibujo sobre un canvas en blanco. Tampoco emite eventos, ni toca el cache LRU, ni deja entradas de supersede — mismo perfil que `rasterizePage`. Recibe filas de strings ya compuestos: si alguna vez apareciera un `EntityType` o un `EntityGroup` en esa firma, es una regresión de ADR-059 §5, no una mejora.

    > **Layout con salto de línea (precisión 2026-08-19, sin ADR — ADR-059 §5 declara el estilo visual explícitamente fuera de spec)**. La redacción anterior decía "columnas a `x` fijas, **sin salto de línea**", y eso producía un defecto visible en un export real: la celda de prefijos crece con la escalera de abreviaturas (ADR-057, 3 niveles) por las variantes de género (ADR-060), así que un tipo `Person` puede acumular hasta 9 prefijos —`"HOMB, PRS, MUJ, HOMBRE, HOM, MUJER"` medido— y en una sola línea **se superpone con la columna del nombre del tipo**. La referencia queda ilegible justo donde tiene que explicar qué significa cada marcador. Ahora:
    >
    > - **Cada celda se envuelve** por palabras contra el ancho de su columna (`measureText`, el mismo mecanismo del shrink-to-fit de ADR-058 §1), y el **alto de fila sigue al contenido** en vez de ser fijo.
    > - **Los offsets de columna son fracciones del ancho útil**, no puntos absolutos. Eran `0/220/420 pt`, tuneados para A4: en un documento más angosto que ~520 pt la tercera columna se dibujaba **fuera de la página** (la leyenda usa el ancho de la primera página del documento, no A4 fijo). Las fracciones `0 / 0.43 / 0.81` reproducen el layout de A4 a un punto de distancia.
    > - **El título también se envuelve**, por el mismo motivo (48 caracteres a 16 px no entran en una página angosta).
    > - **Sigue sin haber paginación** (ADR-059 §5): si la tabla no entrara, se corta en el margen inferior en vez de dibujar fuera de la página. Con los 13 tipos que acota ADR-059 §2 y los prefijos reales no se alcanza — es una guarda, no un camino esperado.
30. **`rasterizePage` con `region` (ADR-065 §5)**: devuelve el `ImageData` **solo del recorte**, de tamaño `region.width × scale` por `region.height × scale` **redondeado a píxeles enteros**: el clampeo redondea cada **borde** del rectángulo (no el ancho y el alto por separado, que introduciría un sesgo acumulado en la posición), así que la dimensión resultante puede diferir del producto exacto en ≤ 1 px. Sigue sin emitir eventos, sin tocar el cache LRU y sin dejar entradas de supersede — el perfil de `rasterizePage` no cambia, solo el área. Una `region` que se sale de la página se **clampea** a sus límites; una `region` de área cero (o negativa) tras el clampeo lanza `InvalidInputError`, igual que `scale <= 0`. **Sin `region` el resultado es idéntico al previo a ADR-065**, que es lo que mantiene intacto el flujo de OCR de páginas textless.
31. **Reemplazo sobre un bbox con `rotation: 90` o `270` (ADR-066 §7)**: el token se dibuja rotado, centrado en la caja, y el shrink-to-fit mide contra el **lado largo**. Sigue valiendo la garantía del caso 25: nada se dibuja fuera del rectángulo. Con `rotation: 180` **no** se rota (quedaría cabeza abajo y la caja es la misma que en 0°); sin `rotation`, el pintado es idéntico al previo a ADR-066 — ésa es la no regresión. `redact` es inmune en los cuatro casos: rellena el rectángulo y no dibuja texto. El caso 27 (texto rotado como gap del **repintado de línea**) no cambia: `rotation` orienta el token del reemplazo, no habilita el repintado de la línea vecina.
32. **Reemplazo de una entidad partida en varias líneas (ADR-074 §4/§5)**: el `Replacement` llega con `fragments` y se expande en N unidades de pintado. Se tapan **los N** rectángulos y el `replacementValue` se dibuja **una sola vez**, en el **más ancho** (empate → el primero en orden de lectura). La envolvente no se pinta nunca: es lo que producía la barra de 557 pt que destruía las dos líneas enteras. En `redact` no hay unidad primaria — los N son fill negro, sin texto, que es lo correcto y lo que el usuario espera. Sin `fragments` no hay expansión y el pintado es **idéntico bit a bit** al previo al ADR: ésa es la no regresión.
   **Por qué el más ancho y no el primero**: el primer fragmento suele ser el trozo corto que quedó al final del renglón (`Pablo`, en el caso medido), y meter ahí `[PERSONA 03]` lo manda al shrink-to-fit y a la marca de degradación del caso 28, habiendo un rectángulo holgado un renglón más abajo. Es una decisión de **este** motor y se puede revisar sin tocar ningún contrato.
33. **Degradación y repintado sobre una unidad de pintado (ADR-074 §4/§6)**: el veredicto del caso 28 se computa contra el fragmento **donde se dibuja**, no contra la envolvente — hoy una entidad de dos líneas mide contra 557 pt de ancho, el token entra sobrado y la marca **nunca se enciende**, justo en el caso peor. Consecuencia esperada: algunas entidades multi-línea encienden la marca que hoy no encienden, con su remedio ya documentado (editar el valor a mano, ADR-058 §4 / ADR-062, que ADR-076 vuelve confiable). Las unidades de solo tapado **no** producen `Degraded` —no dibujan texto, no pueden degradarlo—, así que sigue habiendo como mucho una `Annotation` por `occurrenceId` y su `id` no colisiona. El repintado de línea del caso 26 opera también por unidad: `otherReplacements` ve a los fragmentos vecinos como reemplazos independientes, que es lo correcto para el límite de "no cruzar hacia el territorio de otra entidad".

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `renderPage returns ImageData with correct dimensions` | `contract.test.ts` | contract | invariante |
| `emits PREVIEW_UPDATED after preview render` | `contract.test.ts` | contract | invariante |
| `emits RENDER_FINISHED after batch` | `contract.test.ts` | contract | invariante |
| `original kind renders no replacements` | `unit.test.ts` | unit | caso 1/7 |
| `anonymized kind with empty replacements = original` | `edge.test.ts` | edge | caso 1 |
| `disabled group's occurrences appear as original text` | `edge.test.ts` | edge | caso 2 |
| `redact mode paints opaque black over bbox` | `edge.test.ts` | edge | caso 3 |
| `mask mode renders censored text over bbox` | `edge.test.ts` | edge | caso 4 |
| `placeholder mode renders [TYPE NN] over bbox` | `edge.test.ts` | edge | caso 5 |
| `synthetic mode renders synthetic value over bbox` | `edge.test.ts` | edge | caso 6 |
| `highlight border on original kind` | `unit.test.ts` | unit | caso 7 |
| `conflict marker on original kind` | `edge.test.ts` | edge | caso 8 |
| `no subscriptions on grouping channel` | `contract.test.ts` | contract | ADR-044 (reemplaza a `delta render only re-renders affected pages`; la matriz de `04_Event_System.md` §11 lo cubre además desde el Orchestrator) |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 12 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 13 |
| `LRU cache evicts oldest when full` | `unit.test.ts` | unit | cache |
| `cache hit skips render` | `unit.test.ts` | unit | cache |
| `rotated page renders with correct orientation` | `edge.test.ts` | edge | caso 15 |
| `throws InvalidInputError when document not loaded` | `edge.test.ts` | edge | caso 16 |
| `rasterizePage returns ImageData without emitting events nor touching cache` | `contract.test.ts` | contract | ADR-034 §1 |
| `rasterizePage throws InvalidInputError when document not loaded or scale <= 0` | `edge.test.ts` | edge | ADR-034 §1 |
| `rasterizePage with a region returns only the cropped ImageData` | `unit.test.ts` | unit | caso 30 (ADR-065 §5): tamaño = `region × scale` |
| `rasterizePage without a region is unchanged` | `unit.test.ts` | unit | caso 30: garantía de no regresión del flujo OCR de páginas textless |
| `rasterizePage clamps a region that exceeds the page` | `edge.test.ts` | edge | caso 30 |
| `rasterizePage throws InvalidInputError on an empty region` | `edge.test.ts` | edge | caso 30 |
| `replacement over a rotated bbox is drawn rotated` | `unit.test.ts` | unit | caso 31 (ADR-066 §7): `rotation: 90` rota el contexto y centra el token |
| `shrink-to-fit measures against the long axis when rotated` | `unit.test.ts` | unit | caso 31: en 16×173 el token dispone de 173, no de 16 |
| `replacement without rotation is drawn exactly as before` | `unit.test.ts` | unit | caso 31: garantía de no regresión de ADR-066 §7 |
| `rotated replacement never draws outside its bbox` | `unit.test.ts` | unit | caso 31 + caso 25: la garantía de ADR-058 §1 se conserva |
| `rotation 180 is not rotated` | `unit.test.ts` | unit | caso 31 (ADR-066 §7) |
| **`a replacement with two fragments paints two boxes and one fillText`** | `unit.test.ts` | unit | caso 32 (ADR-074 §4/§5) — **el test que define el ADR** de este lado: el texto va en el fragmento **más ancho** |
| **`a replacement without fragments produces the exact same canvas calls as before`** | `unit.test.ts` | unit | caso 32 — **no-regresión bit a bit** del caso normal |
| `redact with N fragments paints N black boxes and no text` | `unit.test.ts` | unit | caso 32 (ADR-074 §4) |
| `the degradation verdict is computed against the chosen fragment, not the envelope` | `unit.test.ts` | unit | caso 33 (ADR-074 §6) — un caso que hoy no degrada y que con el ADR sí |
| `at most one Degraded annotation per occurrenceId, however many fragments` | `edge.test.ts` | edge | caso 33 (ADR-074 §4) |
| `line repaint sees sibling fragments as independent replacements` | `unit.test.ts` | unit | caso 33 + caso 26 — el límite de "no cruzar hacia otra entidad" |
| `full mode output includes encoded bytes with effective format and quality` | `contract.test.ts` | contract | ADR-034 §3 |
| `preview mode output has no encoded field` | `unit.test.ts` | unit | ADR-034 §3 |
| `RENDER_REQUESTED for unloaded document warns and no-ops` | `edge.test.ts` | edge | caso 16 |
| `loadDocument twice replaces previous proxy` | `edge.test.ts` | edge | caso 17 |
| `unloadDocument on unknown id is a no-op` | `edge.test.ts` | edge | caso 17 |
| `loadDocument with password opens an encrypted PDF` | `edge.test.ts` | edge | caso 22 (ADR-050; fixture `protected.pdf`) |
| `loadDocument without password on an encrypted PDF fails with RenderFailedError` | `edge.test.ts` | edge | caso 22 (ADR-050; es el bug que motivó el ADR) |
| `re-primed worker reloads a password-protected document` | `unit.test.ts` | unit | caso 22 (ADR-050 §2 + ADR-043 §5; el host retiene el password, el kernel no) |
| `dispose destroys loaded PDFDocumentProxies` | `contract.test.ts` | contract | limpieza (ADR-030) |
| `1000 pages only render visible + adjacent` | `stress.test.ts` (en `src/__tests__/` hasta que exista `tests/stress/`; ADR-031 §5) | stress | caso 10 |
| `OffscreenCanvas fallback when unavailable` | `edge.test.ts` | edge | caso 14 |
| `RENDER_REQUESTED propagates scale to renderPages` | `contract.test.ts` | contract | ADR-037 §1 (adaptado por ADR-056: un solo `kind` por evento, ya no `>= 2` renders) |
| `RENDER_REQUESTED with kind "original" renders only original (no anonymized render, no PREVIEW_UPDATED)` | `contract.test.ts` | contract | caso 23 (ADR-056 §1) |
| `RENDER_REQUESTED with kind "anonymized" renders only anonymized` | `contract.test.ts` | contract | caso 23 (ADR-056 §1) |
| `RENDER_REQUESTED registers a supersede entry only for the requested kind` | `edge.test.ts` | edge | caso 24 (ADR-056 §4) |
| `an in-flight anonymized render is not aborted by an original request at another scale` | `edge.test.ts` | edge | caso 24 (ADR-056 §4) |
| `scale out of range warns and no-ops via event, throws InvalidInputError via direct call` | `edge.test.ts` | edge | caso 19 (ADR-037 §2) |
| `superseded render in queue is discarded without PREVIEW_UPDATED` | `edge.test.ts` | edge | caso 18 (ADR-037 §4) |
| `superseded render in flight aborts at next checkpoint without PREVIEW_UPDATED` | `edge.test.ts` | edge | caso 18 (ADR-037 §4) |
| `direct full render (export) ignores supersede entry left by a completed event render at another scale` | `edge.test.ts` | edge | caso 21 (hallazgo PR4 Hito 10) |
| `direct preview render (mediated) ignores supersede entry at another scale (group change is not lost)` | `edge.test.ts` | edge | caso 21 (hallazgo PR4 Hito 10; reformulado sobre `renderPage` directo por ADR-044) |
| `cache key includes scale; different scales coexist` | `unit.test.ts` | unit | caso 20 (ADR-037 §3) |
| `cache evicts by PREVIEW_CACHE_MAX_BYTES in addition to cachePages` | `unit.test.ts` | unit | ADR-037 §3 |
| **`replacement text never exceeds its available width` (propiedad, sobre casos generados)** | `unit.test.ts` | unit | caso 25 (ADR-058 §1) — **es la aserción que representa la garantía; la única de ADR-058 que no puede quedar en amarillo** |
| `token much wider than its bbox is drawn at the 8px floor without overflow` | `edge.test.ts` | edge | caso 25 |
| `all three text modes respect the fit; redact is unchanged` | `edge.test.ts` | edge | caso 25 |
| `line repaint does not trigger when the token fits (current path preserved)` | `unit.test.ts` | unit | ADR-058 §2 — no-regresión |
| `token that does not fit with lineWords absent falls back without error` | `unit.test.ts` | unit | ADR-058 §5 |
| `calibration picks the lowest-error candidate over a known set of widths` | `unit.test.ts` | unit | ADR-058 §3 |
| `shift is uniform: relative distances between repainted words are preserved` | `unit.test.ts` | unit | ADR-058 §2 — protege la decisión de reposicionar en vez de re-maquetar |
| `no trailing word to the right → fallback` | `edge.test.ts` | edge | caso 26 (a) |
| `disproportionate gap (table row) → fallback` | `edge.test.ts` | edge | caso 26 (b) |
| `centered line → fallback` | `edge.test.ts` | edge | caso 26 (c) |
| `no room before the right margin → fallback` | `edge.test.ts` | edge | caso 26 (d) |
| `calibration error above threshold → fallback` | `edge.test.ts` | edge | caso 26 (e) |
| `90° rotated text does not activate repaint (no shared vertical band)` | `edge.test.ts` | edge | caso 27 |
| `ink and background colours sampled from a page with a non-white background` | `edge.test.ts` | edge | ADR-058 §4 |
| `OCR words (source: "ocr") drive the repaint like PDF words` | `edge.test.ts` | edge | ADR-058 §5 — la propiedad que hace que los escaneados entren sin código propio |
| `Degraded annotation emitted only below DEGRADED_FONT_RATIO, not on every fallback` | `unit.test.ts` | unit | caso 28 (ADR-058 §7) |
| `same replacement yields the same degraded verdict across scales` | `unit.test.ts` | unit | caso 28 — prueba de que el umbral es invariante a la escala |
| `Degraded annotation is never painted in mode: full, regardless of severity` | `unit.test.ts` | unit | caso 28 — ADR-058, nota 2026-08-09 (preview-only) |
| `un token largo en una caja de cuerpo de texto SÍ degrada` | `unit.test.ts` | unit | **ADR-086 §1** — el defecto que motivó el ADR: con el criterio anterior este caso daba veredicto vacío sobre un reemplazo ilegible |
| `un placeholder normal en una caja apretada NO degrada` | `unit.test.ts` | unit | ADR-086 §3 — la otra dirección del umbral, con `[PERSONA 01]` y `[ORGANIZACION 01]`. Cae si el umbral vuelve a 0,6 |
| `el piso de dibujo llega escalado al fitting: a escala 2 no se dibuja a 8px` | `unit.test.ts` | unit | ADR-086 §2(b) sobre el **call site** — el test puro de `kernel.test.ts` verifica la función, no que `paintReplacements` le pase el piso escalado |
| `el veredicto es idéntico a toda escala, también cuando el bucle toca el piso` | `unit.test.ts` | unit | ADR-086 §2, de punta a punta |
| `widthRatio es idéntico a toda escala, también cuando el piso muerde` | `kernel.test.ts` | unit | ADR-086 §2 — invariancia **exacta** (`toBeCloseTo`, 6 decimales). El evento solo expone un booleano, y un booleano no distingue "invariante" de "varía pero siempre cruza el umbral" |
| `el piso de dibujo escala: a escala 2 el bucle frena en 16px, no en 8` | `kernel.test.ts` | unit | ADR-086 §2(b) sobre la función pura |
| `naturalSizePx no tiene piso ni redondeo` | `kernel.test.ts` | unit | ADR-086 §2(a) |
| `un texto que entra holgado no degrada, y el vacío tampoco` | `kernel.test.ts` | unit | ADR-086 §1 — el `Math.min(1, …)` y la guarda de ancho natural 0 (división por cero) |
| `fitsNaturally mide contra el tamaño de dibujo: a fullScale un token que no entra repinta` | `unit.test.ts` | unit | ADR-086 §2, **tercera categoría**: `fitsNaturally` es la condición de activación de §2 —no un veredicto— así que mide contra el tamaño de DIBUJO, no contra la referencia. La geometría discrimina las tres variantes sobre el mismo ancho disponible |
| `fitsNaturally mide contra el tamaño de dibujo: a fullScale un token que entra no repinta` | `unit.test.ts` | unit | La bicondicional de §2 (**"si el token entra, no se repinta nada"**), que hasta ADR-086 no estaba falsificada por ningún test a ninguna escala. El `originalValue` mide exactamente lo que la caja declara: sin esa consistencia la calibración rechaza el plan por la condición (e) y el test pasa sin ejercitar `fitsNaturally` |
| `line repaint still activates at fullScale on a body-text box` | `unit.test.ts` | unit | ADR-058 §6(e) — **regresión de ADR-086**: el piso escalado se había filtrado a la calibración y apagaba el repintado en el export. Los demás tests de repintado corren a `previewScale: 1`, donde el piso escalado y el absoluto coinciden |
| `renderLegendPage returns EncodedPageImage with the requested dimensions` | `contract.test.ts` | contract | caso 29 (ADR-059 §5) |
| `renderLegendPage works without a loaded document` | `contract.test.ts` | contract | caso 29 — la única excepción a la precondición de `loadDocument` |
| `renderLegendPage emits no events, does not touch the LRU cache nor supersede` | `contract.test.ts` | contract | caso 29 — mismo perfil que `rasterizePage` |
| `13 rows fit in one legend page, drawn at incremental y with fixed columns` | `unit.test.ts` | unit | ADR-059 §5 |
| `una celda de prefijos larga se corta en varias líneas y no invade la columna siguiente` | `unit.test.ts` | unit | §13 caso 29, precisión de layout — es el defecto medido en un export real (prefijos de `Person` superpuestos con el nombre del tipo) |
| `una fila que se parte en varias líneas empuja a la siguiente hacia abajo` | `unit.test.ts` | unit | §13 caso 29: el alto de fila sigue al contenido |
| `en una página angosta ningún texto se dibuja fuera de la página` | `unit.test.ts` | unit | §13 caso 29: offsets como fracción del ancho útil. Reemplaza a un test que usaba 400 pt y afirmaba el conteo de `fillText` — pasaba mientras la tercera columna se dibujaba **entera fuera** de la página |
| `worker entry-point discriminates RenderLegendPayload without colliding with the other four render-page shapes` | `unit.test.ts` | unit | ADR-043 §4, quinto caso |
| `PREVIEW_UPDATED carries the Degraded annotations of that render, with groupId and occurrenceId` | `unit.test.ts` | unit | ADR-062 §1. **El `occurrenceId` viaja en `Annotation.id`**: `Annotation` (`Contracts.md` §5) no tiene un campo con ese nombre y el kernel pone ahí el de la ocurrencia. El nombre del test se conserva tal cual — es el que este spec fijó — pero la aserción es sobre `id`. |
| `a render without degradation emits an empty degraded array` | `unit.test.ts` | unit | ADR-062 §2 — ni ausente por accidente ni poblado |
| **`a cache hit emits the same degraded as the miss that populated it`** | `unit.test.ts` | unit | ADR-062 §4 — **el test del modo de falla**: sin él la marca de la UI se apaga al volver a una página ya vista y reaparece al invalidar, sin causa aparente |
| `a render with kind "original" emits an empty degraded array` | `unit.test.ts` | unit | ADR-062 §3 |

Fixtures: `tests/fixtures/text-10p.pdf`, `scanned-10p.pdf`, una página con rotación.

> **El criterio de aceptación de ADR-058 §2-§4 es visual y ninguna suite automatizada puede juzgarlo.** Los tests de arriba garantizan que nada se derrama, que el fallback dispara donde debe y que las invariantes se cumplen; **no** garantizan que la línea repintada se vea bien. Eso se verifica a mano, en browser real, con cuatro documentos —texto con nombres cortos, escaneado, tablas/justificado, sello— y es **gate del PR de repintado** (ADR-058 §11), mismo criterio que ADR-053 §8, ADR-054 §9 y ADR-056 §9.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/render-engine/`.
- [ ] 2. Definir `types.ts` con `RenderPageInput`, `RenderPageOutput` (`RenderConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-027).
- [ ] 3. Definir `errors.ts` con `RenderPageFailedError`, `RenderTimeoutError`, `RenderFailedError`.
- [ ] 4. Implementar `render.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (crear `RenderPool` con OffscreenCanvas workers, fallback a main thread si no disponible).
- [ ] 6. Implementar `loadDocument`/`unloadDocument` (`Map<documentId, PDFDocumentProxy>` interno, posesión del buffer, re-carga determinística; ADR-030).
- [ ] 7. Implementar `renderPage` con `AbortSignal`, transferencia de `ImageData` zero-copy, `PREVIEW_UPDATED` por página.
- [ ] 7b. (Hito 9) Implementar `rasterizePage` (sin eventos, sin cache LRU; ADR-034 §1).
- [ ] 7c. (Hito 9) Implementar `RenderPageOutput.encoded` para `mode: "full"` (`convertToBlob` donde vive el canvas; ADR-034 §3) y la codificación real del blob de `PREVIEW_UPDATED` (reemplaza el placeholder de ADR-031 §5).
- [ ] 8. Implementar los 4 modos de reemplazo visual (mask/synthetic/placeholder/redact).
- [ ] 8b. (Hito 10.5, PR 1 — ADR-058 §1) Shrink-to-fit en `paintReplacements`: `measureText` + ajuste del tamaño de fuente con piso de 8px, más `maxWidth` en el `fillText` como red final. **No depende de nada más de ADR-058 y cierra el defecto por sí solo** — va primero por criterio de alivio, como el PR 1 de ADR-056. Caso 25 y su test de propiedad en §14.
- [ ] 8c. (Hito 10.5, PR 5 — ADR-058 §2-§4, §6) `RenderPageInput.lineWords` (§6) y su reenvío al `RenderPagePayload` en `render.engine.ts` — **scope de este PR aunque ningún caller lo pase todavía**: el cableado host-side es el PR 4b y no compila hasta que este campo exista, pero meterlo allá mezclaría dos módulos (R-1). Y encima, el repintado de línea: calibración inversa de la tipografía contra `lineWords`, muestreo de tinta y fondo con `getImageData`, tapado de la entidad al fin de línea y redibujado palabra por palabra con desplazamiento **uniforme**. Las cinco condiciones de activación del caso 26 y el gap de rotación del caso 27. **Gate del PR: la verificación manual en browser real de ADR-058 §11** — el criterio de aceptación es visual y no automatizable. Se juzga sobre el **PDF exportado**, no solo sobre el preview: son dos caminos de render distintos (`mode: "full"` vía `RenderPageProvider` vs `mode: "preview"`), y el `lineWords` del export lo adjunta el Orchestrator en `renderFull` (`Orchestrator.md` v1.7.1, ítem 22b). Si ese cableado falta, el kernel de este motor no ve `lineWords` en el export, cae al shrink-to-fit sin error y el gate pasa mirando solo el preview. Como el 4b va **después** de este PR, el gate se corre al final de la cadena, con el 4b ya puesto: antes de eso no llega ni un `lineWords` y no hay repintado que juzgar en ningún panel.
- [x] 8d. (Hito 10.5, PR 6 — ADR-058 §7) Umbral `DEGRADED_FONT_RATIO` (razón, no píxeles) y emisión de `AnnotationKind.Degraded` por `paintAnnotations`. Caso 28. **Pintado restringido a `mode: "preview"`** (ADR-058, nota 2026-08-09): en `mode: "full"` el veredicto se calcula igual pero nunca se dibuja.
- [x] 8g. (Posterior al Hito 10.10 — **ADR-086**) El veredicto pasa a medir el **ancho**: `anchoDisponible / anchoNatural < DEGRADED_FONT_RATIO`, con el umbral en 0,5. `naturalReferenceSize` separa el tamaño de **referencia** —sin piso ni redondeo, porque nunca se dibuja: se usa solo para medir el veredicto adentro de `fitReplacementFontSized`— del tamaño de **dibujo**, cuyo piso pasa a multiplicarse por la escala de render. Sin esto el aviso era inalcanzable en cuerpo de texto —los dos términos del cociente viejo chocaban contra el mismo piso— y el veredicto dependía del zoom.

  **Tres categorías de tamaño, y confundirlas rompe cosas distintas** (se intentó y se revirtió, ver §14): (1) la **referencia del veredicto**, sin piso; (2) el **tamaño de dibujo**, con piso escalado — y `fitsNaturally`, la condición de activación del repintado de ADR-058 §2, mide contra **éste**, porque si midiera contra la referencia dejaría de implicar "se dibuja sin aplastar"; (3) el `sizePx` de `calibrateLineFont`, que no es ninguna de las dos sino una estimación del tamaño **real de la línea original**, y conserva el piso **sin escalar** (ADR-086 no lo decide; escalarlo apaga el repintado en el export por umbral de error).

  Once tests entre `unit.test.ts` y `kernel.test.ts`, todos falsificados contra la implementación que violarían.
- [ ] 8e. (Hito 10.5, PR 7 — ADR-059 §5) `renderLegendPage(rows, pageWidthPt, pageHeightPt, ctx)`: dibujo puro sobre `OffscreenCanvas` en blanco, sin documento, sin eventos, sin cache, sin supersede. `RenderLegendPayload` como quinto caso de la discriminación por forma del entry-point (ADR-043 §4). **La firma recibe `MarkerLegendRow` (strings compuestos) y no debe ganar nunca `EntityType` ni `EntityGroup`** — es lo que mantiene a este motor sin dependencias semánticas del dominio de entidades. Caso 29.
- [x] 8f. (Posterior al Hito 10.5, PR 2 de ADR-062) Camino de vuelta del veredicto de degradación: `KernelRenderResult` devuelve las `Degraded` que `paintReplacements` ya detecta, `InternalCacheEntry` las guarda, y `emitPreviewUpdated` las emite en `PREVIEW_UPDATED.degraded` **desde la entrada** — así el cache hit emite el mismo veredicto que el miss (ADR-062 §4). Sin umbral nuevo, sin anotación nueva, sin dibujo nuevo: ADR-058 §7 queda intacto. Los cuatro tests de §14. Grep de control: ningún `emitPreviewUpdated` que arme el payload sin `degraded`.
- [ ] 9. Implementar highlight de grupos habilitados y conflicto en `kind = "original"`.
- [ ] 10. Implementar `renderPages` (paralelo, prioridad visible-first).
- [ ] 11. ~~Implementar `requestDeltaRender` (index `pageIndex → groupIds`, lookup, re-render solo afectadas).~~ **Retirado por ADR-044** (junto con `groupOverrides`/`apply*Overrides`/`pageGroupIndex`); el re-render por cambio de grupo lo media el Orchestrator.
- [ ] 12. Implementar LRU cache en host (clave `documentId:pageIndex:kind:mode:scale:hash(replacements ++ annotations)`; ADR-031 §2, extendida con `scale` por ADR-037 §3) con límite adicional por bytes (`PREVIEW_CACHE_MAX_BYTES`).
- [ ] 12b. Implementar guard de `scale` (`MAX_RENDER_SCALE`) y el supersede por página de renders obsoletos al recibir `RENDER_REQUESTED` con escala distinta (ADR-037 §2, §4).
- [ ] 12c. (Fase 11, ADR-056) `handleRenderRequested` construye **un solo** `RenderPageInput` por página, del `kind` del evento, y registra la entrada de supersede **solo para ese kind** (§8, casos 23–24).
- [ ] 13. Implementar `dispose` (libera OffscreenCanvas, workers inactivos y destruye los `PDFDocumentProxy` cargados; ADR-030).
- [ ] 14. Escuchar `RENDER_REQUESTED` del bus (~~`GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED`~~ retirados por ADR-044).
- [ ] 15. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 16. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 17. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 18. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 19. Verificar `index.ts` exporta solo `RenderEngine`, tipos, errores.
- [ ] 20. Verificar imports sin dependencias prohibidas (`grep -r 'react\|tesseract\|onnx\|transformers\|pdf-lib' src/`).
- [ ] 21. Verificar test de cancelación < 200 ms.
- [ ] 22. (Hito 10, PR13 — ADR-043) Extraer el kernel de rasterización/composición a `worker/` (entry-point §7.4: discriminación por forma de los 4 payloads de `render-page` en el orden de ADR-043 §4) y hacer converger todas las vías de render en `RenderPool.dispatch({ payload, run })` (preview incluido; el Orchestrator deja de envolver `rasterizePage`/`renderPage` en `pool.dispatch`).
- [ ] 23. (Hito 10, PR13 — ADR-043) Modo worker de `loadDocument`/`unloadDocument`: `documents` host con `{ buffer, pageCount }`, broadcast `load-document`/`unload-document` (`WorkerPool.broadcast`), re-priming de workers nuevos/reemplazados.
- [ ] 24. (Hito 10, PR13 — ADR-043) Subpath export `"./worker"` + wiring en la app; E2E: preview real vía workers, `DOCUMENT_CLOSED` libera proxies por worker, crash-replace re-primea.
- [ ] 25. (Hito 10, PR 17.4 — ADR-050) `loadDocument(documentId, buffer, password?)`: tercer parámetro opcional, `LoadDocumentPayload.password`, `getDocument({ data, password })` en el kernel. El password se retiene **solo host-side** (junto a `{ buffer, pageCount }`, para el re-priming de ADR-043 §5) y se borra en `unloadDocument`/`dispose`; el kernel **no** lo guarda. Nunca en logs ni eventos (`08_Security_Model.md` §6, enmendada por ADR-050 §3). Tests del caso 22 en §14. Habilita el PR 17.5 del façade.
- [x] 26. (Hito 10.8, paso 2 — ADR-065 §5) `rasterizePage` gana `region?: BoundingBox` (§6): conversión a píxeles por `scale`, clampeo a los límites de la página, `InvalidInputError` si el área clampeada es cero o negativa. **Sin `region`, resultado idéntico** — el test de no regresión de §14 es lo que garantiza que el flujo OCR de páginas textless no se toca. Cruza al RenderWorker dentro del payload existente, sin `WorkerJobType` nuevo: el campo se declara en `RasterizePagePayload` de `@anonly/shared` (`03_Data_Model.md` §18, `05_Worker_Architecture.md` §7.4), **no** en un tipo local de este motor — mismo criterio que `lineWords` en `RenderPagePayload` (ADR-058 §5), porque el wire shape de `RUN(render-page)` está documentado centralmente y tiene que ser fiel. *(Errata: la primera redacción de este ítem daba por hecho ese campo sin agregarlo a la definición canónica; el PR de `shared` que lo declara es precondición de este.)* Caso 30 de §13 y cuatro filas de §14. Habilita el cableado del Orchestrator.
- [x] 27. (Hito 10.8, paso 3 — ADR-066 §7) `paintReplacements` rota el contexto cuando `bbox.rotation` es `90`/`270` (`translate` al centro, `rotate`, dibujo centrado, `restore`) y el shrink-to-fit de ADR-058 §1 mide contra el lado largo. `180` **no** se rota. Sin `rotation`, pintado bit-idéntico — el test de no regresión de §14 es lo que lo garantiza. La garantía de ADR-058 §1 (nada fuera del rectángulo) se conserva y tiene su propio test. El `BoundingBox.rotation` de `@anonly/shared` es precondición. Caso 31 de §13 y cinco filas nuevas en §14.
- [x] 28. (Hito 10.7, PR 7 — ADR-061 §2 errata) El kernel consume `sharesVerticalBand` de `@anonly/shared` (`Contracts.md` §6) y borra su copia local, la de `worker/kernel.ts` que hoy lleva el comentario "duplicado acá porque el kernel no puede importar `packages/anonymization-core/src`". El criterio promovido es **idéntico** al que esta copia ya usaba, así que es de-dup puro sin cambio de comportamiento y sin tests nuevos: los del caso 26 (condición (a) del repintado) son los que lo prueban. **Diferible**: no bloquea nada del Hito 10.7, y va en su propio PR porque este motor no se toca en el mismo cambio que los otros consumidores (R-1). `overlapsBbox` —el overlap 2D genérico de al lado— **no** se promueve: es otra pregunta (¿se pisan estas dos cajas?), tiene un solo consumidor y confundirla con la banda vertical sería el error que la promoción viene a evitar.
- [x] 29. (Hito 10.9, PR 9 — ADR-074 §4-§6) **Expandir** cada `Replacement` con `fragments` en N unidades de pintado **antes** del bucle de `paintReplacements`: una primaria con el `replacementValue` en el fragmento **más ancho** (empate → el primero en orden de lectura) y N-1 de solo tapado, sin `fillText`. El bucle que ya existe no se reescribe: recibe unidades de un rectángulo, que es lo que siempre asumió. En `redact` no hay primaria. Sin `fragments`, **una** unidad y pintado bit-idéntico (§14). El veredicto de degradación del caso 28 y el repintado del caso 26 pasan a operar por unidad, así que `otherReplacements` ve a los fragmentos vecinos como reemplazos independientes. **No** tocar la garantía de ADR-058 §1 ni la rotación del ítem 27. El PR de `shared` que declara el campo (Hito 10.9 PR 4) es precondición. Casos 32-33 de §13 y seis filas nuevas en §14.

---

## Referencias

- `architecture/06_Pipeline.md` §10, §11 (etapas 8 y 10)
- `architecture/05_Worker_Architecture.md` §7.4 (RenderWorker)
- `architecture/07_Performance_Strategy.md` §3 (virtualización), §6 (cache), §10 (compresión)
- `adr/ADR-004-Rendering.md` (reconstrucción)
- `adr/ADR-012-Replacement-Modes.md` (modos visuales)
- `adr/ADR-030-RenderEngine-LoadDocument.md` (carga del PDF fuente)
- `adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md` (error code + erratas)
- `adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md` (retiro del delta render por eventos; reemplazos mediados por el Orchestrator)
- `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` (zoom con re-render real, decisiones de la v1.3.0)
- `adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md` (quién decide el token que este motor dibuja)
- `adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md` (la cascada de la v1.9.0)
- `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (precedente del reparto host-side de `lineWords`)
- `ui/Components.md` §5.2 (`ZoomControls`, CSS inmediato + debounce)
