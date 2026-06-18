<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md | audiencia=IA-implementador | fase=3 (Hito 2 cerrado, pendientes: 5b migración a PdfPool, items §15 diferidos a Hito 9/11) -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.1.1
**Última actualización**: 2026-06-18
**Estado de implementación**: Hito 2 cerrado (PRs #6, #7). Pendiente: migración a `PdfPool` en Hito 9 (item §15.5b) y tests stress/cancel/perf en Hito 11.

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
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `BoundingBox`, `DocumentMetadata`
- `architecture/04_Event_System.md`: `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`, `OCR_PAGE_FINISHED` (escucha)

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor (`ocr-engine`, `regex-engine`, etc.)
- `tesseract.js`, `@xenova/transformers`, `onnxruntime-web`, `pdf-lib`
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
  fuseOcrPage(documentId: string, pageIndex: number, words: ReadonlyArray<Word>): Promise<Document>;
  dispose(): Promise<void>;
}
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

---

## 8. Eventos que consume

**El PDF Engine no se suscribe a ningún evento del bus** (preserva la invariante de `04_Event_System.md` §11; ver ADR-014). La fusión de palabras OCR es **mediada por el Orchestrator**:

1. `ocr-engine` emite `OCR_PAGE_FINISHED` (canal `ocr`); el `OcrPool` deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
2. El **Orchestrator** (no el PDF Engine) escucha `OCR_PAGE_FINISHED`, lee las `Word[]` de `ctx.cache` e invoca `PdfEngine.fuseOcrPage(documentId, pageIndex, words)`.
3. `fuseOcrPage` (método público, firma intacta de §6) fusiona y devuelve un nuevo `Document` inmutable.

El PDF Engine **sólo emite** eventos (ver §7); no consume ninguno del bus. En Hito 2, `fuseOcrPage` se testa con llamada directa (sin bus). El wiring Orchestrator→`fuseOcrPage` se completa en Hito 9.

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
| `PDF_INVALID` | `PdfInvalidError` | no es PDF, header inválido, corrupto | no | abortar pipeline, informar al usuario |
| `PDF_CORRUPTED` | `PdfCorruptedError` | PDF.js lanza error de parseo en una página interna | no | abortar pipeline |
| `PDF_TIMEOUT` | `PdfTimeoutError` | timeout por página excedido tras reintentos | sí (reintentar) | retry 1 vez, si persiste → `PDF_INVALID` |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `process` llamado antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `process` llamado tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined o buffer vacío | no | bug del caller |

`retryable`: `PDF_PASSWORD_REQUIRED = true`, `PDF_TIMEOUT = true`, resto `false`.

---

## 12. Consideraciones de rendimiento

- **Hito 2**: corre inline en el host thread (sin `PdfPool`); cancelación vía `AbortSignal` con checkpoint por página.
- **Hito 9**: migra a `PdfPool` (Web Workers dedicados) cuando `WorkerPoolManager` exista. La interfaz pública (§6) no cambia entre ambos modos (ver ADR-013).
- Costo: 0.5–3 s por página con texto; 0.1–0.5 s por página vacía/escaneada.
- Memoria típica: 20–80 MB por PDF activo.
- `buffer` se **transfiere** al worker (zero-copy). El host pierde acceso al buffer. En Hito 2 (inline) el `buffer` se trata como `ArrayBuffer` plano; no implementar lógica de `Transferable.consume()` hasta Hito 9 (sería dead code inline).
- Streaming: `PAGE_PARSED` se emite por página, no al final. La UI puede mostrar páginas a medida que se parsean.
- Tamaño de lote recomendado: 1 página por job (granularidad de cancelación óptima). El pool despacha en paralelo respetando `pdfPoolSize` (aplica desde Hito 9; en Hito 2 el procesamiento es secuencial por página con checkpoint).
- Reutiliza `PDFDocumentProxy` de PDF.js solo si el `documentId` coincide entre jobs; si cambia, lo cierra y abre uno nuevo.
- Memoria del `PDFDocumentProxy` se libera en `dispose()` del engine o al cambiar `documentId`.
- **Preparación para Hito 9 (normativa)**: aísla `parsePage(pdfDoc, pageIndex): Page` como función pura sin supuestos host/worker (Hito 9 la envuelve en un job del worker sin modificarla). La emisión de eventos (`PAGE_PARSED`, `DOCUMENT_PARSED`) queda en el engine (host), no en el worker. No buildar lógica de `Transferable.consume()` en Hito 2.

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
12. **Buffer ya transferido (consumido)**: lanza `InvalidInputError` con detalles.
13. **`process` llamado tras `dispose`**: lanza `EngineDisposedError`.

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
| `parses protected pdf with correct password` | `edge.test.ts` | edge | 2 | caso 3 (requiere `protected.pdf`, ver §15) |
| `throws PdfInvalidError on empty buffer` | `edge.test.ts` | edge | 2 | buffer vacío |
| `throws PdfInvalidError on non-pdf buffer` | `edge.test.ts` | edge | 2 | header inválido |
| `throws PdfInvalidError on corrupt header` | `edge.test.ts` | edge | 2 | caso 6 |
| `throws PdfCorruptedError on internal page corruption` | `edge.test.ts` | edge | 2 | caso 7 |
| `metadata excludes author and XMP sensitive` | `edge.test.ts` | edge | 2 | caso 8 |
| `hasForms = true for AcroForm pdf` | `edge.test.ts` | edge | 2 | caso 9 |
| `ignores embedded JavaScript` | `edge.test.ts` | edge | 2 | caso 10 |
| `0 pages document returns cleanly` | `edge.test.ts` | edge | 2 | caso 1 |
| `fuseOcrPage merges words correctly` | `contract.test.ts` | contract | 2 | integración con OCR (vía llamada directa, sin bus) |
| `dispose releases PDFDocumentProxy` | `contract.test.ts` | contract | 2 | limpieza |
| `process after dispose throws` | `edge.test.ts` | edge | 2 | caso 13 |
| `DocumentModel snapshot stable (3-page deterministic in-memory fixture, 1 textless)` | `snapshot.test.ts` | snapshot | 2 | fixture estable, sin binario |
| `1000 pages document completes within memory budget` | `stress.test.ts` (en `tests/stress/`) | stress | 11 | caso 2; pendiente, requiere `huge-1000p.pdf` (LFS) |
| `cancel aborts within 200ms` | `cancel.test.ts` (en `tests/cancel/`) | cancel | 11 | SLA; pendiente, requiere `PdfPool` + `AbortRegistry` (Hito 9) |

**Fixtures**: los binarios `.pdf` siguen el patrón definido en `tests/fixtures/README.md` (source of truth: PDFs < 5 MB commiteados en `tests/fixtures/`, ≥ 5 MB a Git LFS en Hito 11; `generate.ts` ya commiteado en Hito 1). Estado actual en Hito 2: commiteados `text-10p.pdf`, `empty.pdf`, `corrupt.pdf` (generados por `generate.ts`); `protected.pdf` pendiente (Hito 2b, requiere `qpdf`); `huge-1000p.pdf` y resto pendientes Hito 11. Los tests **unit / contract / edge / snapshot** (Hito 2) mockean la frontera `pdfjs-dist` (deterministas, sin wasm, sin dependencia de binarios físicos — consistente con `tests/fixtures/README.md`). Los tests **stress / cancel / perf** (Hito 11) usarán PDFs reales generados por `generate.ts`. `generate.ts` debe saber producir: `text-10p`, `scanned-10p`, `protected` (password "test1234"), `corrupt`, `empty`, `text-50p`, `huge-1000p`, `mixed-30p`.

---

## 15. Checklist de implementación

> **Estado Hito 2 (cerrado en PRs #6, #7)**: items 1–4, 5a, 6, 7 (con mediación de Orchestrator, ver ADR-014), 8, 9 (sólo emisión; suscripción consumida por Orchestrator), 10–17.
>
> **Pendiente**: item 5b (migración a `PdfPool` → Hito 9); item 18 (cancelación con SLA estricto → Hito 11). El item 7 originalmente describía `fuseOcrPage` como escucha del bus; la firma pública no cambia, pero el wiring quedó en el Orchestrator (ver ADR-014 y §8).

- [x] 1. Crear paquete `packages/anonymization-core/pdf-engine/` con `package.json` y `tsconfig.json` extends base.
- [x] 2. Definir `types.ts` con `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput`.
- [x] 3. Definir `errors.ts` con `PdfPasswordRequiredError`, `PdfInvalidError`, `PdfCorruptedError`, `PdfTimeoutError`.
- [x] 4. Implementar `pdf.engine.ts` respetando `IEngine` y la firma pública de §6.
- [x] 5a. (Hito 2) Implementar `init` (cargar pdfjs-dist inline en host, sin `PdfPool`).
- [ ] 5b. (Hito 9) Migrar `init` a `PdfPool` cuando `WorkerPoolManager` exista.
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
- [x] 17. Verificar `no-network-from-core`: ningún `fetch`/`XMLHttpRequest`/`WebSocket` en `src/`.
- [ ] 18. (Hito 9/11) Verificar test de cancelación < 200 ms — requiere `PdfPool` + `AbortRegistry`. En Hito 2 se valida cancelación cooperativa inline (checkpoint por página) sin SLA estricto.

---

## Referencias

- `architecture/06_Pipeline.md` §3 (etapa 1, extracción)
- `architecture/05_Worker_Architecture.md` §7.1 (PdfWorker)
- `architecture/08_Security_Model.md` §5 (strip metadata)
- `adr/ADR-001-Framework.md` (pdfjs-dist)
- `adr/ADR-003-Workers.md` (pools)
