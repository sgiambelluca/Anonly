<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md | audiencia=IA-implementador | fase=10 (Hito 2 cerrado, hardening ADR-020; fuseOcrPage función pura y motor sin estado por documento vía ADR-041 — PR12 del Hito 10; `PdfPasswordRequiredError.retryable = false` vía ADR-049 §4 — PR 17.1; CMaps y standard fonts en getDocument vía ADR-053 §5 — cierre de fase 10; pendientes: items §15 diferidos a Hito 11) -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.3.1
**Última actualización**: 2026-07-31
**Estado de implementación**: Hito 2 cerrado (PRs #6, #7); hardening post-review vía ADR-020 (word-splitting, NFC, política de eventos, guard de `fuseOcrPage`, `parsePage` puro); migración a `PdfPool` cerrada en Hito 9 (ADR-035). Pendiente: PdfWorker real (PR12, Hito 10 — incluye la extracción de `fuseOcrPage` a función pura, ADR-041) y tests stress/cancel/perf en Hito 11.

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
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document;
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
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined, buffer vacío, o `fuseOcrPage` sobre página con `requiresOCR === false` (ADR-020 §6) o con `pageIndex` inexistente (ADR-041) | no | bug del caller |

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
- Los `TextItem` que devuelve PDF.js se dividen por whitespace en `Word`s individuales, con `x`/`width` prorrateados linealmente por longitud de caracteres respecto del `TextItem` original; `y`/`height` se conservan (ADR-020 §1).
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
