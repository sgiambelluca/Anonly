<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md,adr/ADR-063-Bbox-De-Texto-Rotado.md | audiencia=IA-implementador | fase=10.8 (Hito 2 cerrado, hardening ADR-020; fuseOcrPage función pura y motor sin estado por documento vía ADR-041 — PR12 del Hito 10; `PdfPasswordRequiredError.retryable = false` vía ADR-049 §4 — PR 17.1; CMaps y standard fonts en getDocument vía ADR-053 §5 — cierre de fase 10; `decodePdfEngineOutput` vía ADR-055 §10 — D3.1; bbox derivado de la matriz completa vía ADR-063 — Hito 10.8 paso 1; pendientes: items §15 diferidos a Hito 11) -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.5.0
**Última actualización**: 2026-08-09
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
  readonly textlessPages: ReadonlyArray<number>; // índices que requieren OCR
  readonly sourceKind: "text" | "scanned" | "mixed";
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

// ADR-055 §10: función pura, sin instancia ni estado. Verifica en RUNTIME que un
// valor que cruzó el PdfWorker tenga la forma de PdfEngineOutput, y lo devuelve
// tipado. La escribe este motor (es el que conoce el contrato de su worker,
// ADR-055 §8) y la invoca el façade, que es el único consumidor de ese resultado
// remoto — pdf-engine no tiene puerto interno de despacho que angostar.
// Verificación superficial y deliberada (§13 caso 17): los cuatro campos de
// PdfEngineOutput, más que `document` tenga `id: string` y `pages: Array`. NO
// recorre words/bboxes: correría por cada import sobre documentos de miles de
// páginas, y una corrupción parcial de ese nivel no es el modo de falla que
// ADR-055 cierra (un sobre con forma distinta lo es).
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
- `sourceKind === "scanned"` si todas las páginas son `requiresOCR`, `"text"` si ninguna, `"mixed"` si hay mix.

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
- El texto rotado no es un caso exótico: los sellos de firma digital, marcas de agua y folios laterales de expedientes judiciales se dibujan a 90° sobre el margen, y aparecen en **todas** las páginas del documento (ADR-063, Contexto §3).
- `Word.text` y, por lo tanto, `Page.text`, se normalizan a NFC (invariante `03_Data_Model.md` §4; ADR-020 §2).
- **Preparación para Hito 9 (normativa)**: `parsePage(pdfDoc, documentId, pageIndex, timeoutMs): Promise<Page>` es una función pura a nivel de módulo, sin supuestos host/worker (Hito 9 la envuelve en un job del worker sin modificarla). La emisión de eventos (`PAGE_PARSED`, `DOCUMENT_PARSED`) queda en el engine (host), no en el worker. No buildar lógica de `Transferable.consume()` en Hito 2.

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
17. **`decodePdfEngineOutput` sobre cualquier otra forma** (`null`, `undefined`, un string, `[]`, `{}`, un objeto al que le falta un campo o le sobra con el tipo equivocado, o un `{ output: {...} }` que envuelva el resultado): lanza `InvalidInputError` con `details.receivedShape`. La verificación es superficial por diseño (§6): valida los cuatro campos de `PdfEngineOutput` y que `document` tenga `id: string` y `pages: Array`, pero **no** recorre `words`/`bbox` — un `document.pages` con elementos corruptos adentro pasa el decoder. Es deliberado: el modo de falla que ADR-055 cierra es el sobre de forma distinta, no la corrupción campo a campo, y un walk profundo correría por cada import sobre documentos de miles de páginas (§12).
18. **`TextItem` rotado 90°/180°/270°** (matriz del tipo `[0, s, -s, 0, e, f]`): el bbox tiene `width` y `height` intercambiados respecto de `item.width`/`item.height`, con el origen en la envolvente del paralelogramo (ADR-063 §2). Los tokens de un run multi-palabra se desplazan sobre el eje de avance, no sobre `x` (ADR-063 §3).
19. **`TextItem` con rotación arbitraria** (p. ej. 45°, marca de agua diagonal): el bbox es la envolvente axis-aligned de los cuatro vértices — cubre **más** área que los glifos. Deliberado: para censura, cubrir de más nunca deja un dato expuesto (ADR-063 §2).
20. **`TextItem` con matriz degenerada** (`a = b = 0`, o `c = d = 0`): no se divide por cero; el versor correspondiente cae al comportamiento horizontal (`dir = (1, 0)` / `up = (0, 1)`).
21. **`TextItem` horizontal** (matriz `[s, 0, 0, s, e, f]`): el bbox es **idéntico** al que producía la fórmula previa a ADR-063. Es la garantía de no regresión del cambio, no un caso nuevo de comportamiento (ADR-063 §2).

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Hito | Descripción |
|---|---|---|---|---|
| `emits PAGE_PARSED for each page` | `contract.test.ts` | contract | 2 | valida un `PAGE_PARSED` por página |
| `emits DOCUMENT_PARSED after all pages` | `contract.test.ts` | contract | 2 | valida `DOCUMENT_PARSED` al final |
| `output has pageCount === pages.length` | `contract.test.ts` | contract | 2 | invariante |
| `pages[i].index === i` | `contract.test.ts` | contract | 2 | invariante |
| `words sorted by y then x` | `unit.test.ts` | unit | 2 | orden de lectura |
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
- `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (`fuseOcrPage` función pura host-side, motor sin estado por documento, `releaseDocument` eliminado)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` (geometría del bbox desde la matriz completa; riesgo latente de solapamiento en §6; discrepancia abierta de rotación de página en §7)
