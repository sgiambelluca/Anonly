<!-- CONTEXT: scope=render-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,ADR-004-Rendering.md,ADR-012-Replacement-Modes.md,ADR-030-RenderEngine-LoadDocument.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md | audiencia=IA-implementador | fase=10 (§6/§8/§12/§13 actualizados en fase 10: RENDER_REQUESTED.scale, guard MAX_RENDER_SCALE, cache LRU por escala + límite de bytes, supersede, ADR-037; reparto host/worker para PR13 por ADR-043; retiro del delta render por eventos de grouping por ADR-044; opciones de fuentes/CMaps de pdf.js en el kernel por ADR-053, cierre de fase 10) -->

# Render Engine — Spec de Motor

> Renderiza páginas del PDF (original o anonimado) a imágenes usando OffscreenCanvas en Web Workers. Produce highlight de grupos habilitados y aplica reemplazos visualmente según `ReplacementMode`. Soporta preview incremental y render full para export.

**EngineId**: `render`
**Versión del spec**: 1.7.0
**Última actualización**: 2026-07-31

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
- Para `kind = "anonymized"`: render del PDF con reemplazos aplicados visualmente según `ReplacementMode`:
  - `placeholder` → texto `[<TYPE> <NN>]` sobre bbox.
  - `synthetic` → texto sintético sobre bbox.
  - `mask` → texto censurado (`XX.XXX.XXX`) sobre bbox.
  - `redact` → fill opaco negro sobre bbox (sin texto).
- Soportar dos calidades: `preview` (escala baja, rápido) y `full` (escala alta, para export).
- Emitir `PREVIEW_UPDATED` (por página, preview), `RENDER_FINISHED`, `RENDER_FAILED`, `PREVIEW_PAGE_FAILED`.
- Escuchar `RENDER_REQUESTED` (único evento consumido desde ADR-044; los cambios de grupos llegan mediados por el Orchestrator como invocaciones directas de `renderPage`).
- Transferir zero-copy `ImageData`/`ArrayBuffer` de vuelta al host.
- Propagar `RENDER_REQUESTED.scale` a `renderPages` (ADR-037 §1); validar contra `MAX_RENDER_SCALE` y aplicar el supersede por página de renders obsoletos (ADR-037 §4).

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
  rasterizePage(documentId: string, pageIndex: number, scale: number, ctx: EngineContext): Promise<ImageData>; // ADR-034 §1
  dispose(): Promise<void>;
}
```

> `requestDeltaRender` retirado por ADR-044 (sus únicos callers eran los handlers de `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`, también retirados; el re-render por cambio de grupo lo dispara el Orchestrator con `renderPage` y reemplazos del snapshot).

Validación de `scale` (ADR-037 §2): rango válido `0 < scale ≤ MAX_RENDER_SCALE` (`Contracts.md` §6, default 4). Vía invocación directa (`renderPage`/`renderPages`), `scale` inválido o no finito → `InvalidInputError` — endurece una laguna previa (el campo no declaraba validación). Vía evento (`RENDER_REQUESTED`), `scale` inválido → `warn` + no-op del evento (no hay caller al que lanzarle, mismo tratamiento que documento no cargado).

Semántica de `rasterizePage` (ADR-034 §1):

- Rasteriza la página **sin reemplazos ni highlights** (uso: alimentar el OCR desde el Orchestrator, que no puede importar pdfjs).
- **No emite eventos** (`PREVIEW_UPDATED` incluido) y **no toca el cache LRU** de previews.
- Precondición: documento cargado vía `loadDocument`; si no, `InvalidInputError` (ADR-030). `pageIndex` fuera de rango o `scale <= 0` → `InvalidInputError`. Fallo de pdfjs/canvas → `RenderPageFailedError` (retryable).
- En modo pool corre como job del `RenderPool`; el `ImageData` se transfiere zero-copy al host.

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
| `PREVIEW_UPDATED` | al renderizar preview de una página | `PreviewUpdated` con `kind` (`"original" \| "anonymized"`, ver ADR-016) y `canvasBlobUrl` | async | sí |
| `PREVIEW_PAGE_FAILED` | al fallar preview de una página | `PreviewPageFailed` | async | sí |
| `RENDER_FINISHED` | al terminar un batch de render | `RenderFinished` | async | sí |
| `RENDER_FAILED` | al fallar un batch | `RenderFailed` | async | sí |

Canal: `EventChannel.Render`.

> Nota: `PREVIEW_UPDATED.canvasBlobUrl` es `URL.createObjectURL(blob)` creado en el host a partir del `ImageData` transferido. El motor (worker) devuelve `ImageData`; el host genera el blob URL. Esto evita `createObjectURL` en el worker (no siempre disponible).

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `RENDER_REQUESTED` (canal `ui`) | usuario pide preview/export | `renderPages` con los `pageIndices` indicados y el `scale` recibido (ausente → `previewScale`/`fullScale` según `mode`, ADR-037 §1); si hay un render pendiente en cola o en vuelo para la misma `(documentId, pageIndex, kind)` con otra escala, se descarta/aborta sin emitir `PREVIEW_UPDATED` (supersede, ADR-037 §4 — solo entre renders originados por `RENDER_REQUESTED`; las invocaciones directas de `renderPage`/`renderPages` no participan, caso 21) |

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
}
```

**Restricciones**:
- El `documentId` debe haber sido cargado con `loadDocument` antes de `renderPage`/`renderPages`; si no, `InvalidInputError` (ADR-030). En las vías por eventos, documento no cargado → `warn` + no-op (ver §8).
- `pageIndex ∈ [0, pageCount)`.
- Si `kind = "anonymized"`, `replacements` debe estar poblado.
- `scale` si se omite usa `previewScale` o `fullScale` según `mode`.
- `imageFormat` default: `"png"` para preview (calidad), `"jpeg"` para full (tamaño).

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
- Cache LRU: `cachePages = 16` páginas preview cacheadas en host. Si la página solicitada está en cache, no se re-renderiza. La clave incorpora la escala efectiva: `documentId:pageIndex:kind:mode:scale:hash(replacements ++ annotations)` (extiende la clave de ADR-031 §2 con `scale` — ADR-037 §3); entradas de escalas distintas coexisten y compiten por los mismos slots. Además del límite por items, el cache tiene un límite por bytes `PREVIEW_CACHE_MAX_BYTES = 200 MB` (`Contracts.md` §6, ADR-037 §3). Sin invalidación activa al cambiar de escala: las entradas viejas se evictan por LRU natural. Un cambio de escala **siempre re-renderiza** (no hay resampling del bitmap anterior en el motor; ese escalado transitorio es responsabilidad de la UI, ver `ui/Components.md` §5.2).
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
4. **Modo `mask`**: texto censurado (`XX.XXX.XXX`) centrado sobre el bbox, con fondo blanco y texto negro.
5. **Modo `placeholder`**: `[DNI 01]` centrado sobre bbox. Fuente monospace si está disponible, fallback sans-serif.
6. **Modo `synthetic`**: valor sintético (`39.123.456`) centrado sobre bbox, con la misma fuente del texto original si es accesible.
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
| `RENDER_REQUESTED propagates scale to renderPages` | `contract.test.ts` | contract | ADR-037 §1 |
| `scale out of range warns and no-ops via event, throws InvalidInputError via direct call` | `edge.test.ts` | edge | caso 19 (ADR-037 §2) |
| `superseded render in queue is discarded without PREVIEW_UPDATED` | `edge.test.ts` | edge | caso 18 (ADR-037 §4) |
| `superseded render in flight aborts at next checkpoint without PREVIEW_UPDATED` | `edge.test.ts` | edge | caso 18 (ADR-037 §4) |
| `direct full render (export) ignores supersede entry left by a completed event render at another scale` | `edge.test.ts` | edge | caso 21 (hallazgo PR4 Hito 10) |
| `direct preview render (mediated) ignores supersede entry at another scale (group change is not lost)` | `edge.test.ts` | edge | caso 21 (hallazgo PR4 Hito 10; reformulado sobre `renderPage` directo por ADR-044) |
| `cache key includes scale; different scales coexist` | `unit.test.ts` | unit | caso 20 (ADR-037 §3) |
| `cache evicts by PREVIEW_CACHE_MAX_BYTES in addition to cachePages` | `unit.test.ts` | unit | ADR-037 §3 |

Fixtures: `tests/fixtures/text-10p.pdf`, `scanned-10p.pdf`, una página con rotación.

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
- [ ] 9. Implementar highlight de grupos habilitados y conflicto en `kind = "original"`.
- [ ] 10. Implementar `renderPages` (paralelo, prioridad visible-first).
- [ ] 11. ~~Implementar `requestDeltaRender` (index `pageIndex → groupIds`, lookup, re-render solo afectadas).~~ **Retirado por ADR-044** (junto con `groupOverrides`/`apply*Overrides`/`pageGroupIndex`); el re-render por cambio de grupo lo media el Orchestrator.
- [ ] 12. Implementar LRU cache en host (clave `documentId:pageIndex:kind:mode:scale:hash(replacements ++ annotations)`; ADR-031 §2, extendida con `scale` por ADR-037 §3) con límite adicional por bytes (`PREVIEW_CACHE_MAX_BYTES`).
- [ ] 12b. Implementar guard de `scale` (`MAX_RENDER_SCALE`) y el supersede por página de renders obsoletos al recibir `RENDER_REQUESTED` con escala distinta (ADR-037 §2, §4).
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
- `ui/Components.md` §5.2 (`ZoomControls`, CSS inmediato + debounce)
