<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md | audiencia=IA-implementador | fase=10.8 (Hito 2 cerrado, hardening ADR-020; fuseOcrPage función pura y motor sin estado por documento vía ADR-041 — PR12 del Hito 10; `PdfPasswordRequiredError.retryable = false` vía ADR-049 §4 — PR 17.1; CMaps y standard fonts en getDocument vía ADR-053 §5 — cierre de fase 10; `decodePdfEngineOutput` vía ADR-055 §10 — D3.1; bbox derivado de la matriz completa vía ADR-063 — Hito 10.8 paso 1; OCR por región (`ocrRegions`, `fuseOcrRegion`) vía ADR-065 — paso 2; texto de anotaciones y `BoundingBox.rotation` vía ADR-066 — paso 3; orden de lectura por runs rotados vía ADR-067 — paso 4; origen de run corrido por word-spacing vía ADR-068 — paso 5, cierre del hito; pendientes: items §15 diferidos a Hito 11) -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.7.0
**Última actualización**: 2026-08-10

> **Nota (v1.7.0, ADR-066, 2026-08-10 — el texto de las anotaciones se lee)**: `getTextContent()` extrae **solo el content stream**; el texto de una anotación vive en su *appearance stream* y era invisible para el motor. Pero `render-engine` **sí lo dibuja** (pdf.js lo hace por default) y el export es raster (ADR-009), así que el nombre y la fecha de una firma digital salían en claro en el PDF anonimizado. `parsePage` pasa a extraer los runs de texto entre `beginAnnotation`/`endAnnotation` del **mismo** operator list que ya pide la compuerta 1 de ADR-065 (costo nulo: `getOperatorList()` ya incluye anotaciones por default — 197 ops contra 103 con `DISABLE` en el documento medido). **Sin OCR**: es texto nativo y exacto. Tres trampas que el spec fija en §12: la transformación que ubica la anotación viaja en el **tercer argumento de `beginAnnotation`**, no como op `transform`; su pila debe ser **separada** de la de `save`/`restore` (no están balanceadas entre sí); y todo word extraído se **valida contra el `rect`** de la anotación, descartando con `warn` lo que caiga afuera. `BoundingBox` gana `rotation` (ADR-066 §6, supersede ADR-063 §5) y el motor la puebla — el ángulo ya lo derivaba ADR-063 §1 y lo descartaba. Ver §6, §12, §13 casos 28-33, §14, §15 ítem 24.

> **Nota (v1.6.0, ADR-065, 2026-08-09 — OCR de páginas con texto nativo parcial)**: `requiresOCR = words.length === 0` dejaba fuera de OCR a cualquier página con **una sola** palabra nativa. En un documento real, un sello de firma digital aportaba esa palabra y una imagen del 55% de la página —con el nombre de una persona adentro— nunca se escaneó: el dato se exportó sin anonimizar. El motor gana **dos compuertas** en `parsePage` (§12) que producen `PdfEngineOutput.ocrRegions`: la primera descarta con `getOperatorList()` toda página sin image XObjects (**3,7 ms**, el único costo que paga un documento de puro texto); la segunda mide el **mayor rectángulo vacío inscrito en cada imagen, normalizado por el área de esa imagen**, que es lo que separa un escaneo ya buscable (11-20%) de una imagen con texto oculto (102%). Se OCR-ea **la región, no la página**, y por construcción esa región no tiene texto nativo encima, así que la fusión (`fuseOcrRegion`, §6) concatena sin dedupe. `requiresOCR`, `textlessPages` y `sourceKind` **no cambian de semántica**. Ver §6, §10, §12, §13 casos 22-26, §14, §15 ítem 24.
**Estado de implementación**: Hito 2 cerrado (PRs #6, #7); hardening post-review vía ADR-020 (word-splitting, NFC, política de eventos, guard de `fuseOcrPage`, `parsePage` puro); migración a `PdfPool` cerrada en Hito 9 (ADR-035). Pendiente: PdfWorker real (PR12, Hito 10 — incluye la extracción de `fuseOcrPage` a función pura, ADR-041) y tests stress/cancel/perf en Hito 11.

> **Nota (ADR-063, 2026-08-09)**: la geometría de `Word` deja de derivarse solo de la traslación de la matriz (`transform[4]`/`[5]`) y pasa a usar la **matriz completa**. De `[a, b, c, d]` salen los versores de avance y de ascenso; el `BoundingBox` es la envolvente axis-aligned del paralelogramo del run, y el prorrateo por token de ADR-020 §1 se desplaza sobre el eje de avance en vez de sobre `x`. Motivo: un sello de firma vertical (matriz `[0, 16, -16, 0]`) producía una caja de 173×16 pt horizontal donde el texto real ocupa 16×173 pt vertical — cajas que no se solapan. **Para 0° la definición nueva se reduce exactamente a la anterior**, así que el texto horizontal no cambia de bbox y los snapshots no se regeneran. `BoundingBox` **no** cambia (sigue sin campo de rotación) y el orden de lectura `y`→`x` se conserva. Ver §12, §13 casos 18-21, §14.

> **Nota (ADR-055 §10, 2026-08-05)**: el paquete gana un segundo export puro, `decodePdfEngineOutput(value: unknown): PdfEngineOutput` (§6), y su error dedicado (§11). Motivo: `pdf-engine` es el único motor sin puerto interno de despacho —el `PdfWorker` corre el motor real completo (ADR-036 §3), no un kernel— así que el consumidor de su `COMPLETED.result` es el façade. El decoder lo escribe y exporta **este** motor, que es el que conoce el contrato de su worker (ADR-055 §8); el façade lo invoca host-side sobre un `dispatch<unknown>`, misma forma que `fuseOcrPage` (ADR-041). El motor, el worker y `PdfEngineOutput` **no cambian**: `process()` sigue devolviendo el tipo concreto y nadie lo decodifica en el camino in-process del propio motor.

> **Nota (ADR-041, 2026-07-22)**: `fuseOcrPage` deja de ser método de la clase y pasa a **función pura** exportada por el paquete — `(document, pageIndex, words) → Document`, síncrona, ejecutada host-side por el Orchestrator con su copia retenida. El motor **no retiene documentos** (se elimina el `Map` interno) y `releaseDocument` desaparece de la interfaz pública (ADR-020 §7 superseded). El guard de `requiresOCR` (ADR-020 §6) y la normalización NFC (ADR-020 §2) se preservan en la función.

---

## 1. Objetivo

Recibir un `ArrayBuffer` con un PDF binario y producir un `DocumentModel` con páginas, palabras y bounding boxes, identificando qué páginas carecen de texto y requieren OCR.

---

## 2. Responsabilidades

- Parsear el PDF con PDF.js en un Web Worker.
- Extraer `Word[]` (texto + `BoundingBox` + `confidence`) por página.
- Detectar páginas sin texto (`requiresOCR = true`).
- Fusionar palabras OCR que llegan vía `OCR_PAGE_FINISHED` en las páginas correspondientes.
- Extraer `DocumentMetadata` no sensible.
- Emitir `PAGE_PARSED` por página y `DOCUMENT_PARSED` al finalizar.
- Manejar PDFs protegidos pidiendo password vía `PDF_PASSWORD_REQUIRED`.
- Transferir zero-copy el `ArrayBuffer` del host al worker.

---

## 3. Fuera de alcance

- Hacer OCR (es tarea de `ocr-engine`).
- Detectar entidades (Regex/NER).
- Renderizar el PDF (es tarea de `render-engine`).
- Conocer React ni ningún framework de UI.
- Persistir el documento (FS, localStorage, network).
- Conservar metadata sensible (author, creator personal, XMP sensible).

---

## 4. Dependencias permitidas

- `@anonly/shared` (tipos, contratos, error codes)
- `pdfjs-dist` (justificado en ADR-001)
  - **Configuración de `getDocument()` (ADR-053 §5)**: además de `data`, `password` y el `useWorkerFetch: false` que ya lleva, la llamada configura `cMapUrl: "/pdfjs/cmaps/"` + `cMapPacked: true`, `standardFontDataUrl: "/pdfjs/standard_fonts/"` y **factories propias** de CMap y de standard fonts (las `DOM*` de pdf.js tocan `document.baseURI` en su primer fetch, y este motor corre dentro de un Worker). Motivo: sin CMaps, un PDF con fuentes CID de CMap predefinido se **extrae** con unicode incorrecto, y ese texto es la entrada de `regex-engine` y `ner-engine` — o sea que degrada la detección de entidades, no solo el dibujo. **No** lleva `disableFontFace`: esta ruta no rasteriza nada, así que el registro del `@font-face` le es indiferente (a diferencia de `render-engine`, ver la regla transversal de `05_Worker_Architecture.md` §7). Los dos prefijos son constantes nombradas del módulo, no config.
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `BoundingBox`, `DocumentMetadata`
- `architecture/04_Event_System.md`: `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`, `OCR_PAGE_FINISHED` (escucha)

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor (`ocr-engine`, `regex-engine`, etc.)
- `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins (`fs`, `http`, etc.)
- Cualquier lib de network (`axios`, `fetch` wrapper, etc.)

---

## 6. Interfaces públicas

```ts
// PdfEngineConfig se define en core/Contracts.md §6 (source of truth) y se importa de @anonly/shared.
// Solo contiene maxPageCount; el timeout por página se lee de ctx.config.workerPool.timeouts["pdf-parse"]
// (default 30000, single source of truth, ver ADR-013).
export interface PdfEngineConfig {
  readonly maxPageCount: number;        // default 10000
}

export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;         // PDF binario, se transfiere (zero-copy) — en Hito 2 se trata como ArrayBuffer plano (ver §12)
  readonly password?: string;           // si el PDF está protegido
}

export interface PdfEngineOutput {
  readonly document: Document;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>; // índices que requieren OCR de página entera
  readonly sourceKind: "text" | "scanned" | "mixed";
  // ADR-065 §4: regiones a OCR-ear en páginas que SÍ tienen texto nativo (una
  // imagen cuyo interior ningún texto explica). Disjunto de textlessPages:
  // ningún pageIndex aparece en los dos. Como máximo una región por página
  // (ADR-065 §2). Vacío es el caso normal.
  readonly ocrRegions: ReadonlyArray<OcrRegion>;
}

export class PdfEngine implements IEngine {
  readonly id = EngineId.Pdf;
  init(ctx: EngineContext): Promise<void>;
  process(input: PdfEngineInput, ctx: EngineContext): Promise<PdfEngineOutput>;
  dispose(): Promise<void>;
}

// ADR-041: función pura y síncrona, sin instancia ni estado retenido. El caller
// (Orchestrator) provee el Document que él mismo retiene y persiste el resultado
// como copia canónica. Reemplaza al método PdfEngine.fuseOcrPage; releaseDocument
// desaparece con el Map interno (ADR-020 §7 superseded: sin retención no hay nada
// que evictar). Lanza InvalidInputError si pageIndex no existe o si la página
// tiene requiresOCR === false (guard ADR-020 §6).
// ADR-064: las `words` entrantes deben venir en PUNTOS DE PÁGINA, igual que
// las nativas (03_Data_Model.md §137). Esta función no reescala nada — no
// conoce el DPI del raster ni tiene por qué; la conversión px→pt es
// responsabilidad de `ocr-engine` (OCR_Engine.md §10).
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document;

// ADR-065 §6: espejo INVERTIDO de fuseOcrPage, para el otro camino de OCR.
// Mismo perfil (pura, síncrona, host-side, el caller provee y persiste el
// Document), tres diferencias deliberadas:
//   1. Guard invertido: exige requiresOCR === false. Una página textless va
//      por fuseOcrPage; invocar la equivocada es un bug de wiring y lanza
//      InvalidInputError (mismo criterio que ADR-020 §6, al revés).
//   2. TRASLADA: las words llegan en puntos relativos al RECORTE (ADR-064
//      convierte px->pt, pero el origen sigue siendo el del recorte). Se les
//      suma region.x/region.y para llevarlas a coordenadas de página. Es el
//      único lugar que conoce esa traslación — por eso recibe `region`.
//   3. CONCATENA en vez de reemplazar: las palabras nativas se conservan, las
//      de OCR se suman, y se reordena por orden de lectura recalculando
//      Page.text. Seguro sin dedupe: la región es, por construcción de la
//      compuerta 2 (§12), área sin una sola palabra nativa encima.
// Marca ocrCompleted = true dejando requiresOCR intacto en false (ADR-065 §7:
// el invariante de 03_Data_Model.md §4 se relajó para admitir este caso).
export function fuseOcrRegion(
  document: Document,
  pageIndex: number,
  region: BoundingBox,
  words: ReadonlyArray<Word>,
): Document;

// ADR-055 §10: función pura, sin instancia ni estado. Verifica en RUNTIME que un
// valor que cruzó el PdfWorker tenga la forma de PdfEngineOutput, y lo devuelve
// tipado. La escribe este motor (es el que conoce el contrato de su worker,
// ADR-055 §8) y la invoca el façade, que es el único consumidor de ese resultado
// remoto — pdf-engine no tiene puerto interno de despacho que angostar.
// Verificación superficial y deliberada (§13 caso 17): los CINCO campos de
// PdfEngineOutput —incluido `ocrRegions` (ADR-065 §4)—, más que `document`
// tenga `id: string` y `pages: Array`. NO recorre words/bboxes de las páginas:
// correría por cada import sobre documentos de miles de páginas, y una
// corrupción parcial de ese nivel no es el modo de falla que ADR-055 cierra
// (un sobre con forma distinta lo es). `ocrRegions` SÍ se recorre elemento a
// elemento, igual que `textlessPages`: tiene a lo sumo una entrada por página
// (ADR-065 §2), o sea la misma clase de costo — la línea que traza ADR-055 es
// contra los datos no acotados por página, no contra los arrays en general.
// Ante cualquier otra forma LANZA InvalidInputError con details.receivedShape
// (§11). Devolver un default en silencio está prohibido (ADR-055 §3).
export function decodePdfEngineOutput(value: unknown): PdfEngineOutput;
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `PAGE_PARSED` | al finalizar parseo de una página | `PageParsed` | async | sí |
| `DOCUMENT_PARSED` | al finalizar todas las páginas | `DocumentParsed` | async | sí |
| `PDF_PASSWORD_REQUIRED` | PDF protegido sin password o password incorrecto | `PdfPasswordRequired` | async | sí |
| `PDF_INVALID` | no es un PDF válido o corrupto | `PdfInvalid` | async | sí |

Canal: `EventChannel.Pdf`.

**Política de señalización (ADR-020)**: todo error fatal de parseo emite su evento antes de lanzar. Los fallos de página interna (`PdfCorruptedError`) emiten `PDF_INVALID` con `reason` (no existe un evento `PDF_CORRUPTED` en el bus; el código de error sí distingue el caso, ver §11).

---

## 8. Eventos que consume

**El PDF Engine no se suscribe a ningún evento del bus** (preserva la invariante de `04_Event_System.md` §11; ver ADR-014). La fusión de palabras OCR es **mediada por el Orchestrator**:

1. `ocr-engine` emite `OCR_PAGE_FINISHED` (canal `ocr`); el `OcrPool` deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
2. El **Orchestrator** (no el PDF Engine) escucha `OCR_PAGE_FINISHED`, lee las `Word[]` de `ctx.cache` e invoca la función pura `fuseOcrPage(document, pageIndex, words)` con el `Document` que él mismo retiene (ADR-041).
3. `fuseOcrPage` fusiona y devuelve un nuevo `Document` inmutable; el Orchestrator lo persiste como copia canónica. La ejecución es síncrona y host-side: no pasa por `PdfPool` ni por ningún worker (ADR-041 §3).

El PDF Engine **sólo emite** eventos (ver §7); no consume ninguno del bus. `fuseOcrPage` se testea con llamada directa (sin bus ni instancia del motor).

---

## 9. Entradas

```ts
PdfEngineInput {
  documentId: string;            // UUID v4, ya generado por el Orchestrator
  buffer: ArrayBuffer;           // PDF binario completo; se transfiere al worker
  password?: string;             // optional; si el PDF está protegido
}
```

**Restricciones**:
- `buffer.byteLength > 0`. Si `byteLength === 0`, lanza `PdfInvalidError`.
- `buffer` debe comenzar con `%PDF-`. Si no, lanza `PdfInvalidError`.
- `password` si se provee debe ser string no vacío.
- `documentId` debe ser único en la sesión.

**Si input es `null`/`undefined`**: lanza `InvalidInputError` (genérico).

---

## 10. Salidas

```ts
PdfEngineOutput {
  document: Document;            // inmutable, todas las props readonly
  pageCount: number;             // === document.pages.length
  textlessPages: ReadonlyArray<number>; // índices con requiresOCR = true
  sourceKind: "text" | "scanned" | "mixed";
}
```

- `document.pages[i].index === i` para todo `i`.
- `document.pages[i].words` está ordenado por `bbox.y` asc, luego `bbox.x` asc.
- `textlessPages` está ordenado asc.
- `sourceKind === "scanned"` si todas las páginas son `requiresOCR`, `"text"` si ninguna, `"mixed"` si hay mix. **No lo afectan las `ocrRegions`** (ADR-065 §10): una página con texto nativo y una imagen con texto oculto *tiene* texto nativo, y `sourceKind` describe de dónde sale el texto de las páginas, no cuánto OCR se va a correr.
- `ocrRegions` está ordenado asc por `pageIndex`, tiene como máximo una entrada por página (ADR-065 §2) y **ningún `pageIndex` suyo aparece en `textlessPages`** (ADR-065 §4). Cada `bbox` está contenido en el rectángulo de la imagen que lo originó.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `PDF_PASSWORD_REQUIRED` | `PdfPasswordRequiredError` | PDF protegido sin password o password incorrecto | sí | UI pide password, reintentar con `password` |
| `PDF_INVALID` | `PdfInvalidError` | no es PDF, header inválido, corrupto a nivel de documento (incl. `maxPageCount` excedido y errores desconocidos de `getDocument()`, ver ADR-020 §4) | no | abortar pipeline, informar al usuario |
| `PDF_CORRUPTED` | `PdfCorruptedError` | PDF.js lanza error de parseo en una página interna (`getPage`/`getTextContent`); aplica solo a este caso, nunca a fallos a nivel de documento (ADR-020 §4) | no | abortar pipeline |
| `PDF_TIMEOUT` | `PdfTimeoutError` | timeout por página excedido | sí (reintentar) | Hito 2 (inline): no reintenta, se propaga directo. Hito 9: retry es responsabilidad del `WorkerPool` (`maxRetries["pdf-parse"]`, ADR-020 §5); si persiste → `PDF_INVALID` |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `process` llamado antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `process` llamado tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined, buffer vacío, o `fuseOcrPage` sobre página con `requiresOCR === false` (ADR-020 §6) o con `pageIndex` inexistente (ADR-041), o `decodePdfEngineOutput` sobre una forma que no es `PdfEngineOutput` (ADR-055 §3/§10) | no | bug del caller; en el caso del decoder, un desajuste entre el `PdfWorker` y su consumidor → `failPipeline` |

**Sobre el error del decoder (ADR-055 §10)**: es `InvalidInputError` a secas —sin clase ni `EngineErrorCode` nuevos— por dos motivos. `PdfInvalidError`/`PDF_INVALID` sería **mentirle al usuario**: significa "tu archivo no es un PDF válido", cuando el archivo puede estar perfecto y lo roto ser el sobre del worker. Y a diferencia de `ner-engine` —que sí necesitó una subclase interna para distinguir "el sobre está roto, es sistémico" de un fallo tolerable de página— acá ningún caller discrimina: el façade manda todo lo que no es `PDF_PASSWORD_REQUIRED` ni cancelación a `failPipeline`, que es exactamente el fallo ruidoso que ADR-055 §3 pide. El `details` lleva `receivedShape` con la **forma** del valor (claves y tipos), nunca su contenido (`Code_Standards.md` §9: no loguear contenido del documento).

`retryable`: `PDF_TIMEOUT = true`, resto `false` — incluido `PDF_PASSWORD_REQUIRED` (errata ADR-035 §3: `retryable` significa auto-reintentable por el pool sin intervención del usuario; la recuperación por password es del flujo UI → `retryWithPassword`, no del flag). El fix del flag en `pdf.errors.ts` (`super(..., true, ...)` → `false`) es el **PR 17.1** de ADR-049 §4/§7: dejó de ser cosmético al llegar el transporte real de workers — el override `isRetryable` con el que el Orchestrator lo compensaba se apoyaba en un `instanceof` que no sobrevive al boundary, así que el pool reintentaba el PDF protegido (ADR-049, Contexto §3). El flag **sí** sobrevive; por eso corregirlo permite retirar el override.

---

## 12. Consideraciones de rendimiento

- **Hito 2**: corre inline en el host thread (sin `PdfPool`); cancelación vía `AbortSignal` con checkpoint por página.
- **Hito 9**: migra a `PdfPool` in-process (cola de concurrencia del `WorkerPoolManager`, ADR-035 §1); el despacho a Web Workers dedicados llega en el Hito 10 (ADR-035 §2). La interfaz pública (§6) no cambia entre los tres modos (ver ADR-013).
- Costo: 0.5–3 s por página con texto; 0.1–0.5 s por página vacía/escaneada.
- Memoria típica: 20–80 MB por PDF activo.
- `buffer` se **transfiere** al worker (zero-copy). El host pierde acceso al buffer. En Hito 2 (inline) el `buffer` se trata como `ArrayBuffer` plano; no implementar lógica de `Transferable.consume()` hasta Hito 9 (sería dead code inline).
- Streaming: `PAGE_PARSED` se emite por página, no al final. La UI puede mostrar páginas a medida que se parsean.
- Tamaño de lote recomendado: 1 página por job (granularidad de cancelación óptima). El pool despacha en paralelo respetando `pdfPoolSize` (aplica desde Hito 9; en Hito 2 el procesamiento es secuencial por página con checkpoint).
- El `PDFDocumentProxy` se destruye al finalizar cada `process()` (ADR-020 §8; reemplaza el hint de reuse por `documentId` que documentaba esta sección — obsoleto en el modelo inline, nunca implementado, y descartado por riesgo de leak sin beneficio).
- Los `TextItem` que devuelve PDF.js se dividen por whitespace en `Word`s individuales, con el avance prorrateado linealmente por longitud de caracteres respecto del `TextItem` original (ADR-020 §1). El desplazamiento de cada token corre sobre el **eje de avance** del run, no sobre `x` (ADR-063 §3): para texto horizontal las dos formulaciones son idénticas.
- **Geometría del bbox (ADR-063 §1-§2)**: se deriva de la matriz completa `[a, b, c, d, e, f]` de PDF.js, no solo de la traslación. `dir = (a, b)/|(a, b)|` es el versor de avance y `up = (c, d)/|(c, d)|` el de ascenso; `item.width` es el avance total del run y `item.height` el cuerpo, **medidos sobre esos ejes**. El `BoundingBox` es la envolvente axis-aligned del paralelogramo `(e, f) → +dir·width → +up·height`, convertida a origen arriba-izquierda con `y = pageHeight - yMax`. Es **exacta** para 0°/90°/180°/270° y **conservadora** (cubre de más) para ángulos arbitrarios. Para 0° se reduce carácter por carácter a la fórmula previa: el texto horizontal no cambia de bbox.
- El texto rotado no es un caso exótico: los sellos de firma digital, marcas de agua y folios laterales de expedientes judiciales se dibujan a 90° sobre el margen, y aparecen en **todas** las páginas del documento (ADR-063, Contexto §3). El `BoundingBox` de esos words lleva `rotation` (ADR-066 §6): el ángulo sale de los mismos versores que ya calcula la geometría, y solo se puebla para 0/90/180/270 — en un ángulo arbitrario queda ausente y el pintado es horizontal (ADR-066 §8).
- **Texto de anotaciones (ADR-066 §1-§4)**, del mismo operator list de la compuerta 1:
  - Se extraen los runs `showText`/`showSpacedText` que caen entre `beginAnnotation` y `endAnnotation`, reconstruyendo el string desde el campo `unicode` de cada glifo. Los `Word` llevan `source: "pdf"` (es texto nativo) y se suman a los de `getTextContent()`. **No hay duplicado**: `getTextContent()` no lee appearance streams, así que las dos fuentes son disjuntas por construcción.
  - **La cadena de composición es `textMatrix × transformInterno × beginAnnotation.transform × CTM`.** El tercer argumento de `beginAnnotation` es la transformación que ubica la anotación en la página y **no** llega como op `transform`; ignorarla manda todo el texto al origen de la página (verificado: los cinco runs de la firma medida caen en `y = 0` en vez de dentro de su rect).
  - **`textMatrix` NO se puebla solo desde `setTextMatrix`** (ADR-066 §2, corrección). La regla completa es `Trm = [Tfs·Th, 0, 0, Tfs, 0, Ts] × Tm × CTM` (PDF 32000-1 §9.4.4): `Tm` se mantiene desde `setTextMatrix` **y** desde los operadores de posicionamiento (`Td`, `TD`, `T*` con su interlineado `TL`), y el cuerpo (`Tfs`, de `Tf`) y el escalado horizontal (`Th`, de `Tz`) se aplican como factores sobre las magnitudes. `Tfs`/`Th` son estado gráfico: `save`/`restore` los preservan. Un appearance stream **aplanado** trae el cuerpo en la escala de `Tm` (`setTextMatrix [8,0,0,8,…]` + `setFont [f,1]`); el idioma **normal** lo trae en `Tf` y la posición en `Td` (`setFont [f,8]` + `moveText [0,42.66]`, sin ningún `Tm`). Soportar solo la primera forma deja al documento real con cuerpo 1, avances 8 veces cortos y todos los runs apilados en el mismo origen — medido: los 26 words de la firma en `x = 59,0` con 1 pt de ancho, contra `x = 9,3…48,4` con cuerpo 8.
  - **La pila de `beginAnnotation` es independiente de la de `save`/`restore`.** Las dos anidaciones no están balanceadas entre sí; compartir una sola pila desincroniza el CTM (verificado: produce `x = -679`, fuera de la página).
  - **El `rect` del segundo argumento de `beginAnnotation` es el oráculo**, y la prueba es de **solapamiento, no de contención estricta**: la intersección del bbox del word con el `rect` debe ser **≥ 50% del área del word**. El que no llega, se **descarta con `warn`** — si la composición falló, la posición no es confiable, y una caja negra mal puesta destruye contenido y esconde el error (ADR-066 §3). **La contención estricta NO sirve**: el versor de ascenso extiende la caja del glifo más allá de la línea de base, y el `rect` está ajustado a la tinta visible, así que un word legítimo se sale una fracción de punto (medido: 0,66 pt sobre la firma real, que con contención estricta se descartaba entera). El word real solapa 91,8%; los dos modos de falla de composición dan 0% o marginal.
  - Se leen todas las anotaciones con texto **salvo** las marcadas `Hidden`/`NoView`: lo que no se dibuja no puede filtrarse por el export. **No** se filtra por `subtype` (ADR-066 §4). *Nota de implementación*: el motor **no** tiene código propio para ese filtro — lo hereda de `pdf.js`, que no emite `beginAnnotation` para una anotación no visible (`annotation.mustBeViewed(...)` aguas arriba de `getOperatorList()`). El invariante se cumple, pero por composición y no por un guard local; el test de `edge.test.ts` lo fija.
  - El walker de imágenes de la compuerta 1 aplica **el mismo** `transform` de `beginAnnotation` (ADR-066 §5): sin eso, una imagen dentro de una anotación se ubica mal.
- **Corrección del origen por word spacing (ADR-068)**: `getTextContent()` aplica el word spacing (`Tw`) a los espacios que después **descarta** del `str`, y el renderer **no** lo aplica (PDF 32000-1 §9.3.3 lo restringe al código de un byte 32). Para un run con espacios iniciales y `Tw ≠ 0` el `transform` reportado queda a la izquierda del glifo real — medido sobre la pericia: `190,20` reportado contra `248,5` de tinta, **58,3 pt**. El `width` sí es correcto. Del mismo recorrido del operator list sale, por cada `showText`/`showSpacedText` **de página**, el par `from` (origen que reportará `getTextContent()`, avance **con** `Tw`) y `to` (el que dibuja el renderer, **sin** `Tw`); `convertTextItemsToWords` corrige un item **solo si** su origen coincide con un `from` dentro de 0,05 pt. Sin coincidencia el item queda intacto: un documento sin `Tw` no cambia en nada, y si pdf.js arregla el defecto la corrección se desactiva sola. De este recorrido no sale ni una palabra — el texto sigue viniendo de `getTextContent()`.
- **Orden de lectura con runs rotados (ADR-067)**, en `sortWordsByReadingOrder` — la única función que fija el orden de `Page.words` y, con él, el de `Page.text`:
  - Un `Word` con `bbox.rotation` **ausente o `0`** se ordena como siempre: `bbox.y` asc, luego `bbox.x` asc, con tolerancia de misma-línea de 1. Una página sin texto rotado produce el array **idéntico** palabra por palabra, así que el snapshot no se regenera (si cambia, el cambio rompió texto horizontal).
  - Los words con `rotation` 90/180/270 se agrupan en **runs**: misma coordenada transversal —`bbox.x` para 90/270, `bbox.y` para 180— con tolerancia 1, **y** contiguos sobre el eje de avance con hueco ≤ **2 cuerpos** (`bbox.width` para 90/270, `bbox.height` para 180). Los dos criterios hacen falta: en la firma medida, la marca de agua y el run `Date:` comparten columna con 1,1 pt de diferencia y solo el corte por hueco (30 cuerpos contra los 0,44-0,58 de un espacio real) los separa.
  - Dentro de un run el orden es el del **avance**: `y` descendente en 90 (el texto sube en pantalla), `y` ascendente en 270, `x` descendente en 180. Ordenar por `y` ascendente invierte el run — es el defecto que ADR-067 corrige.
  - Los runs se emiten en una **pasada aparte, después de todo el texto horizontal**: `Page.words` es `[…horizontal…, …runs…]`, con dos `sort` independientes (los runs entre sí, por el bbox de su primera palabra en orden de lectura). La contigüidad del run es lo que necesita el detector: sin ella, `Albarracin, Rocio de los Milagros` llegaba a NER como `… Milagros … los … de … Rocio … Albarracin,` intercalado con los otros cuatro runs de la firma.
  - **Un run NUNCA se intercala en el texto horizontal.** Ubicarlo por su ancla dentro del mismo `sort` parte una línea al medio: el comparador tiene tolerancia 1 y no es transitivo, así que un ancla que cae dentro de la tolerancia de una palabra de la línea pero fuera de la de otra se encaja entre las dos. Como `mapSpanToWords` une el rango de índices completo de un match, el bbox de la entidad partida se traga el run entero — medido sobre la pericia de 5 páginas: una ocurrencia en `x = 250` salía en `x = 10`. Con las pasadas separadas, el orden del texto horizontal es **idéntico** al previo a ADR-067 en cualquier página, tenga o no texto rotado.
  - `ocr-engine` **no** se toca: sus words nunca llevan `rotation` (`OCR_Engine.md` §10), así que la rama nueva no los alcanza.
- `Word.text` y, por lo tanto, `Page.text`, se normalizan a NFC (invariante `03_Data_Model.md` §4; ADR-020 §2).
- **Compuertas de OCR por región (ADR-065 §1)**, dentro de `parsePage`, después de construir las `Word`:
  - **Compuerta 1 — ¿hay imágenes?** De `page.getOperatorList()` se toman los ops `paintImageXObject`, `paintImageMaskXObject` y `paintInlineImageXObject`; simulando `save`/`restore`/`transform` se compone la CTM vigente en cada uno, y aplicándola al cuadrado unidad sale el rectángulo de esa imagen en puntos de página. **`paintJpegXObject` no existe** en `pdfjs-dist` 4.10.38 (las JPEG salen por `paintImageXObject`); las variantes agrupadas y repetidas del optimizador de pdf.js —`paintImageXObjectRepeat`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintInlineImageXObjectGroup`, `paintSolidColorImageMask`— quedan **fuera de alcance** por decisión explícita: su modo de falla es un falso negativo idéntico al comportamiento previo a ADR-065 (ver la errata de ADR-065 §1). Una página sin ninguno de esos ops **termina acá**, sin rasterizar ni cargar Tesseract. Costo medido: **3,7 ms de media** en páginas sin imágenes (`pdfjs-dist` 4.10.38) → ~0,7 s en 200 páginas, contra los 160 s del presupuesto de `07_Performance_Strategy.md` §1.
  - **Filtro por rectángulo**: se descarta toda imagen de área **< 1% de la página**, aplicado **por rectángulo y nunca sobre el agregado**, para que varios logos chicos no sumen hasta cruzar el umbral.
  - **Compuerta 2 — ¿esa imagen tiene texto encima?** Sobre una grilla de 64×64 celdas se marcan las celdas de la imagen y las de los `bbox` de las palabras nativas **dilatados** 0,5× del cuerpo del glifo en horizontal y 0,8× en vertical (la dilatación evita que el interlineado cuente como hueco). Dentro de cada imagen se busca el **mayor rectángulo vacío axis-aligned** (histograma + pila, O(GRID²)). Es región candidata si su área es **≥ 40% del área de esa imagen** y sus **dos lados miden ≥ 100 pt**.
  - El rectángulo se **clampea al rect de la imagen** antes de emitirse: la cuantización de la grilla lo hace desbordar (102-103% en la calibración).
  - Si una página tiene más de una candidata se emite **solo la mayor** (ADR-065 §2).
  - La métrica está normalizada **por el área de la imagen, no de la página**: es lo que separa un escaneo con capa OCR previa (11-20%) de una imagen con texto oculto (102%). Dos métricas más simples —área de imagen sin texto, y mayor región contigua— se probaron primero y **fallan** sobre el escaneo ya buscable (ADR-065, Contexto §2).
- **Preparación para Hito 9 (normativa)**: `parsePage(pdfDoc, documentId, pageIndex, timeoutMs)` es una función pura a nivel de módulo, sin supuestos host/worker. Devuelve `ParsePageResult { page: Page; ocrRegionBbox?: BoundingBox }` desde ADR-065: las compuertas corren adentro (necesitan el `pageProxy` que la función ya obtuvo **y** las `Word` que acaba de construir, así que separarlas en un helper obligaría a exponer el proxy o a pagar un `getPage` de más). **`ParsePageResult` es interno**: no se exporta ni aparece en §6 — la superficie pública que este spec fija es la de esa sección, y ahí `PdfEngineOutput` es lo que cambia. Lo que el mandato de ADR-013 §6 exige de `parsePage` es pureza y portabilidad host/worker, no un tipo de retorno literal; las dos se conservan (Hito 9 la envuelve en un job del worker sin modificarla). La emisión de eventos (`PAGE_PARSED`, `DOCUMENT_PARSED`) queda en el engine (host), no en el worker. No buildar lógica de `Transferable.consume()` en Hito 2.

---

## 13. Casos límite

1. **PDF vacío (0 páginas)**: `process` retorna con `pageCount = 0`, `textlessPages = []`, `sourceKind = "text"`. Emite `DOCUMENT_PARSED` con `pageCount = 0`.
2. **PDF con 1000 páginas**: procesa en paralelo (respetando pool size). Emite 1000 `PAGE_PARSED`. Memoria pico gestionada por LRU del `PDFDocumentProxy` (pdfjs descarta páginas procesadas).
3. **PDF protegido con password correcto**: parseo normal.
4. **PDF protegido con password incorrecto**: lanza `PdfPasswordRequiredError`. El caller reintenta con password correcto.
5. **Página sin texto**: `requiresOCR = true`, `words = []`, `text = ""`. Se agrega a `textlessPages`.
6. **PDF corrupto (header inválido)**: lanza `PdfInvalidError` sin parsear nada.
7. **PDF corrupto (página interna inválida)**: lanza `PdfCorruptedError` indicando `pageIndex`.
8. **PDF con metadata sensible (author, XMP)**: se extrae solo `DocumentMetadata` no sensible; el resto se descarta.
9. **PDF con forms (AcroForm)**: `metadata.hasForms = true`. Forms no se parsean a `Word[]` (se ignoran; el export no los replica).
10. **PDF con JavaScript embebido**: `process` lo ignora. No se ejecuta. No se replica en export.
11. **PDF con 100 páginas todas escaneadas**: `sourceKind = "scanned"`, `textlessPages = [0..99]`.
12. **Buffer ya transferido (consumido)**: lanza `InvalidInputError` con detalles (Hito 9; inline es indistinguible de buffer vacío → `PdfInvalidError`).
13. **`process` llamado tras `dispose`**: lanza `EngineDisposedError`.
14. **`fuseOcrPage` sobre página con texto nativo** (`requiresOCR === false`): lanza `InvalidInputError`; la fusión OCR solo aplica a páginas textless (ADR-020 §6; función pura desde ADR-041 — el caso "documento no encontrado" desapareció, el caller provee el `Document`).
15. **`fuseOcrPage` con `pageIndex` fuera de rango**: lanza `InvalidInputError` con `details: { pageIndex }` (ADR-041).
16. **`decodePdfEngineOutput` sobre un `PdfEngineOutput` válido** (la forma que postea `worker/entry.ts` y la que devuelve `process()` in-process — son la **misma**, este motor no envuelve el resultado en ningún sobre): lo devuelve tal cual, sin copiarlo ni normalizarlo.
17. **`decodePdfEngineOutput` sobre cualquier otra forma** (`null`, `undefined`, un string, `[]`, `{}`, un objeto al que le falta un campo o le sobra con el tipo equivocado, o un `{ output: {...} }` que envuelva el resultado): lanza `InvalidInputError` con `details.receivedShape`. La verificación es superficial por diseño (§6): valida los **cinco** campos de `PdfEngineOutput` —incluido `ocrRegions`, recorrido elemento a elemento (`pageIndex: number` y un `bbox` de cuatro números), igual que `textlessPages` y por el mismo motivo: está acotado a una entrada por página (ADR-065 §2)— y que `document` tenga `id: string` y `pages: Array`, pero **no** recorre `words`/`bbox` de las páginas — un `document.pages` con elementos corruptos adentro pasa el decoder. Es deliberado: el modo de falla que ADR-055 cierra es el sobre de forma distinta, no la corrupción campo a campo, y un walk profundo correría por cada import sobre documentos de miles de páginas (§12).
18. **`TextItem` rotado 90°/180°/270°** (matriz del tipo `[0, s, -s, 0, e, f]`): el bbox tiene `width` y `height` intercambiados respecto de `item.width`/`item.height`, con el origen en la envolvente del paralelogramo (ADR-063 §2). Los tokens de un run multi-palabra se desplazan sobre el eje de avance, no sobre `x` (ADR-063 §3).
19. **`TextItem` con rotación arbitraria** (p. ej. 45°, marca de agua diagonal): el bbox es la envolvente axis-aligned de los cuatro vértices — cubre **más** área que los glifos. Deliberado: para censura, cubrir de más nunca deja un dato expuesto (ADR-063 §2).
20. **`TextItem` con matriz degenerada** (`a = b = 0`, o `c = d = 0`): no se divide por cero; el versor correspondiente cae al comportamiento horizontal (`dir = (1, 0)` / `up = (0, 1)`).
21. **`TextItem` horizontal** (matriz `[s, 0, 0, s, e, f]`): el bbox es **idéntico** al que producía la fórmula previa a ADR-063. Es la garantía de no regresión del cambio, no un caso nuevo de comportamiento (ADR-063 §2).
22. **Página sin ningún image XObject**: `ocrRegions` no gana entradas y la compuerta 2 no corre. Es el caso de toda página born-digital y el que mantiene el costo del OCR por región en 3,7 ms (ADR-065 §1).
23. **Página con un logo o membrete chico** (< 1% del área de página): descartado por el filtro de tamaño antes de medir nada. El logo de 37×37 pt de la calibración da 0,27%.
24. **Página escaneada con capa OCR previa** (imagen a página completa + texto nativo distribuido encima): **no** produce región. Es el falso positivo caro —dispararlo metería un OCR de página entera en cada página de un expediente escaneado— y la calibración lo deja en 11% (márgenes normales) y 20% (márgenes anchos), contra un umbral de 40% (ADR-065, Contexto §3).
25. **Página con texto nativo y una imagen grande sin texto encima**: produce una región, clampeada al rect de la imagen. Es el caso que motivó ADR-065: 102% de la imagen en el documento real.
26. **Página con dos imágenes candidatas**: se emite **solo la de mayor rectángulo vacío** (ADR-065 §2). La segunda queda sin escanear — fuga conocida y aceptada, no una regresión: antes de ADR-065 no se escaneaba ninguna.
27. **`fuseOcrRegion` sobre página con `requiresOCR === true`**: lanza `InvalidInputError`. Esa página va por `fuseOcrPage` (página entera); invocar la función equivocada es un bug de wiring (ADR-065 §6, espejo del caso 14).
28. **Anotación con texto** (p. ej. un `Widget`/`Sig` de firma digital): produce `Word`s con `source: "pdf"`, sumados a los de `getTextContent()` sin duplicarse. Es el caso que motivó ADR-066: el nombre y la fecha del firmante salían en claro en el export.
29. **Anotación cuyo `transform` de `beginAnnotation` se ignora**: los words caen en el origen de la página, fuera del `rect`, y el guard del caso 31 los descarta. Es el modo de falla que ADR-066, Contexto §3 documenta como ya ocurrido dos veces al medir.
30. **Anotación con `save`/`restore` desbalanceados respecto de `beginAnnotation`/`endAnnotation`**: no corrompe el CTM del resto de la página — las dos pilas son independientes (ADR-066 §2).
31. **Word extraído cuyo solapamiento con el `rect` es < 50% de su área**: se descarta con `warn`; no entra en `Page.words` y no se recorta al rect (ADR-066 §3). **Un word que se sale una fracción de punto NO se descarta**: la caja del glifo se extiende desde la línea de base por el ascenso y el `rect` está ajustado a la tinta, así que el texto real de la firma medida se sale 0,66 pt y solapa 91,8% — con contención estricta se perdían los cinco runs.
32. **Anotación con flag `Hidden` o `NoView`**: no produce words. Lo que no se dibuja no puede filtrarse por el export (ADR-066 §4).
33. **Imagen dentro de una anotación**: la compuerta 1 la ubica aplicando el `transform` de `beginAnnotation` (ADR-066 §5). Sin eso quedaría en coordenadas de página y la compuerta 2 la evaluaría contra el área equivocada.
34. **Página sin ningún word rotado**: el orden de lectura es literalmente el previo a ADR-067, palabra por palabra. Es la garantía de no regresión que fija el snapshot.
35. **Varios runs rotados paralelos y solapados en `y`** (los cinco de una firma digital): cada uno sale íntegro y contiguo en `Page.text`, no intercalado (ADR-067 §2, §4). Es el caso que motivó el ADR: sin esto el nombre del firmante no produce grupo de Persona.
36. **Dos runs rotados en la misma columna, separados por un hueco > 2 cuerpos** (marca de agua arriba, firma abajo): quedan como dos runs. Con la tolerancia transversal sola se fusionarían — están a 1,1 pt (ADR-067 §2).
37. **Run rotado de un solo word**: es un run válido de un elemento y, como cualquier run, sale después del texto horizontal — nunca en el medio de una línea.
41. **Run de página con espacios iniciales y `setWordSpacing` distinto de cero**: el `Word` se ubica en el origen que dibuja el renderer, no en el que reporta `getTextContent()` (ADR-068). Sin `Tw`, o si el origen reportado no coincide con ninguna corrección, el item queda intacto.
40. **Anotación cuyo appearance stream posiciona con `Tf` + `Td` en vez de `Tm`** (el idioma normal de PDF, y el que usa el documento original): produce los mismos `Word` que la forma aplanada. Soportar solo `Tm` deja cuerpo 1, avances 8 veces cortos y todos los runs en el mismo origen (ADR-066 §2, corrección).
39. **Run rotado cuya ancla cae entre dos palabras de la misma línea horizontal** (la marca de agua del margen y una línea del cuerpo, a menos de 1 pt de diferencia en `y`): el run **no** parte la línea. Es la regresión medida sobre la pericia de 5 páginas — con el run intercalado, el bbox de `La Plata` arrancaba 240 pt a la izquierda de donde está el texto (ADR-067 §4, corrección).
38. **Word con `rotation: 0` explícito**: se ordena por la rama horizontal, junto a los que no tienen el campo (`Contracts.md` §5, ausente ≡ 0).

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Hito | Descripción |
|---|---|---|---|---|
| `emits PAGE_PARSED for each page` | `contract.test.ts` | contract | 2 | valida un `PAGE_PARSED` por página |
| `emits DOCUMENT_PARSED after all pages` | `contract.test.ts` | contract | 2 | valida `DOCUMENT_PARSED` al final |
| `output has pageCount === pages.length` | `contract.test.ts` | contract | 2 | invariante |
| `pages[i].index === i` | `contract.test.ts` | contract | 2 | invariante |
| `words sorted by y then x` | `unit.test.ts` | unit | 2 | orden de lectura |
| `reading order is unchanged for a page without rotated text` | `unit.test.ts` | unit | 10.8 | ADR-067 §1: no regresión, caso 34 |
| `a 90° run comes out in advance order, not reversed` | `unit.test.ts` | unit | 10.8 | ADR-067 §3 |
| `parallel rotated runs stay contiguous in Page.text` | `unit.test.ts` | unit | 10.8 | ADR-067 §2/§4, caso 35 |
| `two runs in the same column split on the advance gap` | `unit.test.ts` | unit | 10.8 | ADR-067 §2, caso 36 |
| `rotation 270 orders by y asc and 180 by x desc` | `unit.test.ts` | unit | 10.8 | ADR-067 §3 |
| `moves the word to the origin the renderer draws, not the reported one` | `unit.test.ts` | unit | 10.8 | ADR-068 §1/§2, caso 41 |
| `leaves the origin untouched when there is no word spacing` | `unit.test.ts` | unit | 10.8 | ADR-068 §2: no regresión |
| `leaves an item untouched when its origin matches no correction` | `unit.test.ts` | unit | 10.8 | ADR-068 §2: el guard |
| `a run positioned with Tf + Td yields the same bbox as the flattened Tm form` | `unit.test.ts` | unit | 10.8 | ADR-066 §2 (corrección), caso 40 |
| `two runs positioned with Td land at different origins` | `unit.test.ts` | unit | 10.8 | ADR-066 §2 (corrección): sin `Td` se apilaban en el mismo origen |
| `a rotated run never splits a horizontal line` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección), caso 39 — la regresión de `La Plata` |
| `horizontal order is identical with and without rotated text` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección): garantía de no regresión del texto horizontal |
| `emits the runs after all horizontal text, ordered among themselves` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección) |
| `explicit rotation 0 sorts with the horizontal branch` | `edge.test.ts` | edge | 10.8 | ADR-067 §1, caso 38 |
| `single-word rotated run` | `edge.test.ts` | edge | 10.8 | ADR-067, caso 37 |
| `fuseOcrRegion preserves native rotated runs` | `unit.test.ts` | unit | 10.8 | ADR-067 §6 |
| `textlessPages sorted asc` | `unit.test.ts` | unit | 2 | invariante |
| `sourceKind = scanned when all textless` | `edge.test.ts` | edge | 2 | caso límite 11 |
| `sourceKind = text when none textless` | `edge.test.ts` | edge | 2 | caso base |
| `sourceKind = mixed` | `edge.test.ts` | edge | 2 | mixto |
| `throws PdfPasswordRequiredError on protected without password` | `edge.test.ts` | edge | 2 | caso 4 (requiere `protected.pdf`, ver §15) |
| `throws PdfPasswordRequiredError on wrong password` | `edge.test.ts` | edge | 2 | caso 4 (requiere `protected.pdf`, ver §15) |
| `PdfPasswordRequiredError is not retryable` | `edge.test.ts` | edge | 2 | ADR-049 §4 (`retryable === false`; el flag es lo único que el pool ve tras el boundary) |
| `parses protected pdf with correct password` | `edge.test.ts` | edge | 2 | caso 3 (requiere `protected.pdf`, ver §15) |
| `throws PdfInvalidError on empty buffer` | `edge.test.ts` | edge | 2 | buffer vacío |
| `throws PdfInvalidError on non-pdf buffer` | `edge.test.ts` | edge | 2 | header inválido |
| `throws PdfInvalidError on corrupt header` | `edge.test.ts` | edge | 2 | caso 6 |
| `throws PdfCorruptedError on internal page corruption` | `edge.test.ts` | edge | 2 | caso 7 |
| `metadata excludes author and XMP sensitive` | `edge.test.ts` | edge | 2 | caso 8 |
| `hasForms = true for AcroForm pdf` | `edge.test.ts` | edge | 2 | caso 9 |
| `ignores embedded JavaScript` | `edge.test.ts` | edge | 2 | caso 10 |
| `0 pages document returns cleanly` | `edge.test.ts` | edge | 2 | caso 1 |
| `fuseOcrPage merges words correctly` | `contract.test.ts` | contract | 2 | integración con OCR (llamada directa, sin bus; función pura desde ADR-041) |
| `dispose releases PDFDocumentProxy` | `contract.test.ts` | contract | 2 | limpieza |
| `process after dispose throws` | `edge.test.ts` | edge | 2 | caso 13 |
| `DocumentModel snapshot stable (3-page deterministic in-memory fixture, 1 textless)` | `snapshot.test.ts` | snapshot | 2 | fixture estable, sin binario |
| `splits multi-word TextItems into individual words with prorated bboxes` | `unit.test.ts` | unit | 2 | ADR-020 §1 |
| `normalizes word text to NFC` | `unit.test.ts` | unit | 2 | ADR-020 §2 |
| `throws PdfTimeoutError with documentId when page parse exceeds timeout` | `unit.test.ts` | unit | 2 | ADR-020 §5 (bug de `documentId` vacío) |
| `throws PdfInvalidError when page count exceeds maxPageCount` | `edge.test.ts` | edge | 2 | ADR-020 §3 |
| `throws PdfInvalidError on empty password string` | `edge.test.ts` | edge | 2 | ADR-020 §3 |
| `emits PDF_INVALID before throwing on fatal parse errors` | `edge.test.ts` | edge | 2 | ADR-020 §3, §4 |
| `fuseOcrPage on non-OCR page throws InvalidInputError` | `contract.test.ts` | contract | 2 | caso 14; ADR-020 §6 (función pura desde ADR-041) |
| `engine never subscribes to the bus (ADR-014)` | `contract.test.ts` | contract | 2 | ratifica ADR-014 |
| `fuseOcrPage on unknown pageIndex throws InvalidInputError` | `unit.test.ts` | unit | 10 | caso 15 (ADR-041; reemplaza al test de `releaseDocument`, eliminado con el método — ADR-020 §7 superseded) |
| `decodePdfEngineOutput returns a valid PdfEngineOutput unchanged` | `unit.test.ts` | unit | 10 | caso 16 (ADR-055 §10); identidad referencial, no copia |
| `decodePdfEngineOutput accepts the exact shape PdfWorker posts` | `unit.test.ts` | unit | 10 | ADR-055 §5 (paridad remoto/in-process): el valor lo produce el mismo helper que arma el `COMPLETED.result` del entry-point, no un literal escrito a mano. Es el test que se pondría rojo el día que alguien envuelva el resultado en un sobre |
| `decodePdfEngineOutput throws InvalidInputError on garbage` | `edge.test.ts` | edge | 10 | caso 17 (ADR-055 §3): `null`, `undefined`, `"x"`, `42`, `[]`, `{}` |
| `decodePdfEngineOutput throws on missing or mistyped fields` | `edge.test.ts` | edge | 10 | caso 17: falta `document`/`pageCount`/`textlessPages`/`sourceKind`, `sourceKind` fuera del union, `pages` no-array, `document.id` no-string |
| `decodePdfEngineOutput throws on an enveloped result` | `edge.test.ts` | edge | 10 | caso 17: `{ output: <válido> }` — la regresión concreta de ADR-055 (Contexto §1) trasladada a PDF |
| `decodePdfEngineOutput error details carry shape, never content` | `edge.test.ts` | edge | 10 | `Code_Standards.md` §9: `receivedShape` lista claves y tipos, nunca texto del documento |
| `rotated 90 TextItem yields a swapped bbox` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §2): matriz `[0, s, -s, 0, e, f]` → `width = item.height`, `height = item.width`, origen en la envolvente |
| `rotated 180 and 270 TextItems yield the correct envelope` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §2) |
| `horizontal TextItem bbox is unchanged by the matrix-aware formula` | `unit.test.ts` | unit | 10.8 | caso 21 (ADR-063 §2): garantía de no regresión — el test que se pone rojo si el cambio tocó texto horizontal |
| `prorated tokens of a rotated run advance along the writing axis` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §3): en un run a 90°, `x` constante y `y` decreciente token a token |
| `arbitrary rotation yields an envelope containing all four corners` | `unit.test.ts` | unit | 10.8 | caso 19 (ADR-063 §2): 45°, envolvente conservadora |
| `degenerate transform matrix does not divide by zero` | `edge.test.ts` | edge | 10.8 | caso 20 |
| `page without image XObjects yields no ocr regions` | `unit.test.ts` | unit | 10.8 | caso 22 (ADR-065 §1): la compuerta 2 no corre |
| `image smaller than 1 percent of the page is discarded` | `unit.test.ts` | unit | 10.8 | caso 23 (ADR-065 §1): filtro por rectángulo, no sobre el agregado |
| `full-page image covered by native text yields no region` | `unit.test.ts` | unit | 10.8 | caso 24 (ADR-065, Contexto §3): el falso positivo caro |
| `large image with no native text yields a clamped region` | `unit.test.ts` | unit | 10.8 | caso 25 (ADR-065 §1): región contenida en el rect de la imagen |
| `page with two candidate images yields only the largest` | `unit.test.ts` | unit | 10.8 | caso 26 (ADR-065 §2) |
| `ocrRegions and textlessPages are disjoint` | `contract.test.ts` | contract | 10.8 | invariante de ADR-065 §4 |
| `fuseOcrRegion translates words by the region origin and concatenates` | `unit.test.ts` | unit | 10.8 | ADR-065 §6: suma `region.x`/`region.y`, conserva las nativas, reordena |
| `fuseOcrRegion on a textless page throws InvalidInputError` | `unit.test.ts` | unit | 10.8 | caso 27 (ADR-065 §6): guard invertido |
| `decodePdfEngineOutput throws on a malformed ocrRegions` | `edge.test.ts` | edge | 10.8 | caso 17 (ADR-065 §4): falta el campo, no es array, un elemento sin `pageIndex: number`, o con `bbox` incompleto/no-numérico |
| `annotation text runs become words inside the annotation rect` | `unit.test.ts` | unit | 10.8 | caso 28 (ADR-066 §1-§2): con el `transform` medido, origen (17.34, 60) y `rotation: 90` |
| `ignoring the beginAnnotation transform pushes words out of the rect` | `unit.test.ts` | unit | 10.8 | caso 29 (ADR-066 §2): fija el error de composición que ya ocurrió al medir |
| `annotation stack is independent from the save/restore stack` | `unit.test.ts` | unit | 10.8 | caso 30 (ADR-066 §2) |
| `words outside the annotation rect are dropped with a warning` | `edge.test.ts` | edge | 10.8 | caso 31 (ADR-066 §3): solapamiento < 50% del área del word; no se recortan al rect |
| `a word overhanging the rect by a fraction of a point is kept` | `edge.test.ts` | edge | 10.8 | caso 31: el `rect` real `[10,60,60,560]` con el run medido — se sale 0,66 pt y solapa 91,8%. Es el test que se pone rojo si alguien vuelve a la contención estricta |
| `hidden annotations produce no words` | `edge.test.ts` | edge | 10.8 | caso 32 (ADR-066 §4) |
| `image inside an annotation is placed with the annotation transform` | `unit.test.ts` | unit | 10.8 | caso 33 (ADR-066 §5) |
| `bbox rotation is populated only for right angles` | `unit.test.ts` | unit | 10.8 | ADR-066 §6/§8: ausente en horizontal, `90` a 90°, ausente en un ángulo arbitrario |
| `1000 pages document completes within memory budget` | `stress.test.ts` (en `tests/stress/`) | stress | 11 | caso 2; pendiente, requiere `huge-1000p.pdf` (LFS) |
| `cancel aborts within 200ms` | `cancel.test.ts` (en `tests/cancel/`) | cancel | 11 | SLA; pendiente, requiere `PdfPool` + `AbortRegistry` (Hito 9) |

**Fixtures**: los binarios `.pdf` siguen el patrón definido en `tests/fixtures/README.md` (source of truth: PDFs < 5 MB commiteados en `tests/fixtures/`, ≥ 5 MB a Git LFS en Hito 11; `generate.ts` ya commiteado en Hito 1). Estado actual en Hito 2: commiteados `text-10p.pdf`, `empty.pdf`, `corrupt.pdf` (generados por `generate.ts`); `protected.pdf` pendiente (Hito 2b, requiere `qpdf`); `huge-1000p.pdf` y resto pendientes Hito 11. Los tests **unit / contract / edge / snapshot** (Hito 2) mockean la frontera `pdfjs-dist` (deterministas, sin wasm, sin dependencia de binarios físicos — consistente con `tests/fixtures/README.md`). Los tests **stress / cancel / perf** (Hito 11) usarán PDFs reales generados por `generate.ts`. `generate.ts` debe saber producir: `text-10p`, `scanned-10p`, `protected` (password "test1234"), `corrupt`, `empty`, `text-50p`, `huge-1000p`, `mixed-30p`.

---

## 15. Checklist de implementación

> **Estado Hito 2 (cerrado en PRs #6, #7)**: items 1–4, 5a, 6, 7 (con mediación de Orchestrator, ver ADR-014), 8, 9 (sólo emisión; suscripción consumida por Orchestrator), 10–17.
>
> **Pendiente**: item 18 (cancelación con SLA estricto → Hito 11); item 20 (ADR-041 → PR12, Hito 10). El item 7 originalmente describía `fuseOcrPage` como escucha del bus; el wiring quedó en el Orchestrator (ver ADR-014 y §8), y desde ADR-041 la firma es la función pura de §6 (los items 7, 8 y 19 describen el estado histórico previo).

- [x] 1. Crear paquete `packages/anonymization-core/pdf-engine/` con `package.json` y `tsconfig.json` extends base.
- [x] 2. Definir `types.ts` con `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput`.
- [x] 3. Definir `errors.ts` con `PdfPasswordRequiredError`, `PdfInvalidError`, `PdfCorruptedError`, `PdfTimeoutError`.
- [x] 4. Implementar `pdf.engine.ts` respetando `IEngine` y la firma pública de §6.
- [x] 5a. (Hito 2) Implementar `init` (cargar pdfjs-dist inline en host, sin `PdfPool`).
- [x] 5b. (Hito 9) Migrar `init` a `PdfPool` cuando `WorkerPoolManager` exista. **Cerrado en Hito 9** (pools in-process, ADR-035; MVP.md §4). El despacho a Web Worker real llega en PR12 (ADR-036, ADR-041).
- [x] 6. Implementar `process` con `AbortSignal`, `PAGE_PARSED` por página, `DOCUMENT_PARSED` al final. En Hito 2 el `buffer` se trata como `ArrayBuffer` plano (sin transferencia zero-copy; ver §12 y ADR-013).
- [x] 7. Implementar `fuseOcrPage` (firma intacta de §6; la escucha de `OCR_PAGE_FINISHED` y la lectura de `ctx.cache` quedan en el Orchestrator — ver ADR-014 y §8).
- [x] 8. Implementar `dispose` (libera `PDFDocumentProxy` y limpia el cache interno de documentos).
- [x] 9. Cablear eventos **emitidos** contra `IEventBus` (`PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`). PDF Engine no se suscribe a ningún evento del bus (§8).
- [x] 10. Escribir `contract.test.ts` con los tests contractuales de §14 correspondientes a Hito 2.
- [x] 11. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [x] 12. Escribir `edge.test.ts` con los casos límite de §13 correspondientes a Hito 2.
- [x] 13. Escribir `snapshot.test.ts` con `DocumentModel` de fixture determinista en memoria (3 páginas, 1 textless).
- [x] 14. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y verificar verde.
- [x] 15. Verificar que `index.ts` exporta solo `PdfEngine`, `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput` y los errores.
- [x] 16. Verificar que ninguna dependencia prohibida aparece en imports (`grep -r 'react\|tesseract\|onnx\|pdf-lib' src/`).
- [x] 17. Verificar `no-network-from-core`: ningún `fetch`/`XMLHttpRequest`/`WebSocket` en `src/`, salvo el `fetch()` same-origin de las factories de CMap/standard-fonts (`/pdfjs/cmaps/`, `/pdfjs/standard_fonts/`), sancionado por ADR-053 §2.
- [ ] 18. (Hito 9/11) Verificar test de cancelación < 200 ms — requiere `PdfPool` + `AbortRegistry`. En Hito 2 se valida cancelación cooperativa inline (checkpoint por página) sin SLA estricto.
- [x] 19. Hardening post-review (ADR-020): word-splitting, NFC, política de eventos, guard de `fuseOcrPage`, `releaseDocument`, `parsePage` puro.
- [ ] 20. (Hito 10, PR12 — ADR-041) Extraer `fuseOcrPage` a función pura exportada (§6: sin `Map` interno, sin asserts de instancia, síncrona; conserva guard ADR-020 §6, validación de `pageIndex` y NFC); eliminar `releaseDocument` y el estado por documento del engine; adaptar los tests de fusión (casos 14–15 de §13, filas de §14) y `tests/integration/ocr-pdf-fusion.test.ts`.
- [ ] 21. (Hito 10, PR 17.1 — ADR-049 §4) `PdfPasswordRequiredError`: segundo argumento del `super(...)`, `true` → `false` (§11). Fila nueva en §14. Debe mergearse **antes** del PR 17.2 del façade, que retira el override `isRetryable` que hoy lo compensa.
- [x] 22. (Hito 10.8, paso 1 — ADR-063) `convertTextItemsToWords`: derivar la geometría de la matriz completa (§12). Versores de avance/ascenso desde `[a, b, c, d]`, bbox como envolvente axis-aligned del paralelogramo, prorrateo del token sobre el eje de avance. **No** tocar `BoundingBox` (sin campo de rotación, ADR-063 §5), **no** tocar el orden de lectura (ADR-063 §4) y **no** regenerar el snapshot de `snapshot.test.ts`: si cambia, el cambio rompió texto horizontal. Casos 18-21 de §13 y seis filas nuevas en §14.
- [x] 23. (Hito 10.8, paso 2 — ADR-065) Compuertas 1 y 2 en `parsePage` (§12) produciendo `PdfEngineOutput.ocrRegions` (§6, §10), y `fuseOcrRegion` como export puro nuevo (§6). **No** tocar `requiresOCR`, `textlessPages` ni `sourceKind` (ADR-065 §10). El `OcrRegion` de `@anonly/shared` es precondición (`Contracts.md` §5). Casos 22-27 de §13 y ocho filas nuevas en §14.
- [x] 24. (Hito 10.8, paso 3 — ADR-066) Lectura del texto de anotaciones en `parsePage` (§12): runs entre `beginAnnotation`/`endAnnotation`, composición `textMatrix × transformInterno × beginAnnotation.transform × CTM`, **pila de anotación separada** de la de `save`/`restore`, validación contra el `rect` descartando con `warn`, exclusión de `Hidden`/`NoView`. Poblar `bbox.rotation` (solo 0/90/180/270). Corregir el walker de la compuerta 1 para que aplique el mismo `transform` (§5). El `BoundingBox.rotation` de `@anonly/shared` es precondición (`Contracts.md` §5). Casos 28-33 de §13 y siete filas nuevas en §14.

- [x] 25. (Hito 10.8, paso 4 — ADR-067) `sortWordsByReadingOrder`: agrupar los words con `bbox.rotation` 90/180/270 en runs (columna con tolerancia 1 **y** hueco de avance ≤ 2 cuerpos), ordenarlos en su dirección de avance y emitirlos en una **pasada aparte, después de todo el texto horizontal** — nunca intercalados (§12, ADR-067 §4 y su corrección). La rama sin rotación **no cambia** y el snapshot de `snapshot.test.ts` **no se regenera**. **No** tocar `ocr-engine` (ADR-067 §5) ni `fuseOcrPage`/`fuseOcrRegion`, que heredan el orden sin cambios (§6). Casos 34-39 de §13 y once filas nuevas en §14.

- [x] 26. (Hito 10.8, paso 5 — ADR-068) En el mismo recorrido del operator list, emitir por cada `showText`/`showSpacedText` **de página** el par `from`/`to` del origen cuando `Tw ≠ 0` y el run tiene espacios iniciales; `convertTextItemsToWords` corrige un item solo si su origen coincide con un `from` (§12). **No** tocar `item.width` ni el prorrateo de ADR-020 §1. El snapshot **no se regenera**. Caso 41 de §13 y tres filas nuevas en §14.

---

## Referencias

- `architecture/06_Pipeline.md` §3 (etapa 1, extracción)
- `architecture/05_Worker_Architecture.md` §7.1 (PdfWorker)
- `architecture/08_Security_Model.md` §5 (strip metadata)
- `adr/ADR-001-Framework.md` (pdfjs-dist)
- `adr/ADR-003-Workers.md` (pools)
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md` (ejecución inline, `parsePage` puro)
- `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` (`fuseOcrPage`, PDF Engine no se suscribe al bus)
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` (word-splitting, NFC, política de eventos, guard `fuseOcrPage`, `releaseDocument`, `parsePage` puro)
- `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` (orden de lectura con runs rotados; supersede ADR-063 §4)
- `adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md` (corrección del origen que reporta `getTextContent()`)
- `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (`fuseOcrPage` función pura host-side, motor sin estado por documento, `releaseDocument` eliminado)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` (geometría del bbox desde la matriz completa; riesgo latente de solapamiento en §6; discrepancia abierta de rotación de página en §7)
- `adr/ADR-064-Palabras-De-OCR-En-Puntos.md` (precondición de espacio de coordenadas de las `words` que entran a `fuseOcrPage`/`fuseOcrRegion`)
- `adr/ADR-065-OCR-Por-Region.md` (compuertas de OCR por región, `ocrRegions`, `fuseOcrRegion`)
- `adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md` (lectura del texto de anotaciones, `bbox.rotation`; supersede ADR-063 §5)
