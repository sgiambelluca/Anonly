<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md | audiencia=IA-implementador | fase=3 -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.0.0
**Última actualización**: 2026-06-17

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
export interface PdfEngineConfig {
  readonly maxPageCount: number;        // default 10000
  readonly parseTimeoutMsPerPpage: number; // default 30000
}

export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;         // PDF binario, se transfiere (zero-copy)
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

| Evento | Cuándo | Payload | Acción |
|---|---|---|---|
| `OCR_PAGE_FINISHED` | cuando `ocr-engine` termina una página | `OcrPageFinished` + un side-channel con las `Word[]` (vía callback en `ctx` o payload extendido) | llama a `fuseOcrPage` para fusionar las palabras OCR en la `Page` correspondiente |

> Nota de implementación: las `Word[]` no viajan en el evento (sería pesado). El `OcrPool` las deposita en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` y `OCR_PAGE_FINISHED` notifica al PDF Engine para que las lea de cache y fusione.

Canal escuchado: `EventChannel.Ocr`.

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

- Corre en `PdfPool` (Web Workers dedicados).
- Costo: 0.5–3 s por página con texto; 0.1–0.5 s por página vacía/escaneada.
- Memoria típica: 20–80 MB por PDF activo.
- `buffer` se **transfiere** al worker (zero-copy). El host pierde acceso al buffer.
- Streaming: `PAGE_PARSED` se emite por página, no al final. La UI puede mostrar páginas a medida que se parsean.
- Tamaño de lote recomendado: 1 página por job (granularidad de cancelación óptima). El pool despacha en paralelo respetando `pdfPoolSize`.
- Reutiliza `PDFDocumentProxy` de PDF.js solo si el `documentId` coincide entre jobs; si cambia, lo cierra y abre uno nuevo.
- Memoria del `PDFDocumentProxy` se libera en `dispose()` del engine o al cambiar `documentId`.

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

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits PAGE_PARSED for each page` | `contract.test.ts` | contract | valida un `PAGE_PARSED` por página |
| `emits DOCUMENT_PARSED after all pages` | `contract.test.ts` | contract | valida `DOCUMENT_PARSED` al final |
| `output has pageCount === pages.length` | `contract.test.ts` | contract | invariante |
| `pages[i].index === i` | `contract.test.ts` | contract | invariante |
| `words sorted by y then x` | `unit.test.ts` | unit | orden de lectura |
| `textlessPages sorted asc` | `unit.test.ts` | unit | invariante |
| `sourceKind = scanned when all textless` | `edge.test.ts` | edge | caso límite 11 |
| `sourceKind = text when none textless` | `edge.test.ts` | edge | caso base |
| `sourceKind = mixed` | `edge.test.ts` | edge | mixto |
| `throws PdfPasswordRequiredError on protected without password` | `edge.test.ts` | edge | caso 4 |
| `throws PdfPasswordRequiredError on wrong password` | `edge.test.ts` | edge | caso 4 |
| `parses protected pdf with correct password` | `edge.test.ts` | edge | caso 3 |
| `throws PdfInvalidError on empty buffer` | `edge.test.ts` | edge | buffer vacío |
| `throws PdfInvalidError on non-pdf buffer` | `edge.test.ts` | edge | header inválido |
| `throws PdfInvalidError on corrupt header` | `edge.test.ts` | edge | caso 6 |
| `throws PdfCorruptedError on internal page corruption` | `edge.test.ts` | edge | caso 7 |
| `metadata excludes author and XMP sensitive` | `edge.test.ts` | edge | caso 8 |
| `hasForms = true for AcroForm pdf` | `edge.test.ts` | edge | caso 9 |
| `ignores embedded JavaScript` | `edge.test.ts` | edge | caso 10 |
| `0 pages document returns cleanly` | `edge.test.ts` | edge | caso 1 |
| `1000 pages document completes within memory budget` | `stress.test.ts` (en `tests/stress/`) | stress | caso 2 |
| `fuseOcrPage merges words correctly` | `contract.test.ts` | contract | integración con OCR |
| `dispose releases PDFDocumentProxy` | `contract.test.ts` | contract | limpieza |
| `process after dispose throws` | `edge.test.ts` | edge | caso 13 |
| `cancel aborts within 200ms` | `cancel.test.ts` (en `tests/cancel/`) | cancel | SLA |
| `DocumentModel snapshot stable for text-10p.pdf` | `snapshot.test.ts` | snapshot | fixture estable |

Fixtures: `tests/fixtures/text-10p.pdf`, `scanned-10p.pdf`, `protected.pdf` (password "test1234"), `corrupt.pdf`, `empty.pdf`, `text-50p.pdf`, `huge-1000p.pdf`, `mixed-30p.pdf`.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/pdf-engine/` con `package.json` y `tsconfig.json` extends base.
- [ ] 2. Definir `types.ts` con `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput`.
- [ ] 3. Definir `errors.ts` con `PdfPasswordRequiredError`, `PdfInvalidError`, `PdfCorruptedError`, `PdfTimeoutError`.
- [ ] 4. Implementar `pdf.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (cargar pdfjs-dist en worker, crear `PdfPool`).
- [ ] 6. Implementar `process` con `AbortSignal`, transferencia de buffer, `PAGE_PARSED` por página, `DOCUMENT_PARSED` al final.
- [ ] 7. Implementar `fuseOcrPage` (escucha `OCR_PAGE_FINISHED`, lee cache, fusiona).
- [ ] 8. Implementar `dispose` (libera `PDFDocumentProxy` y workers inactivos).
- [ ] 9. Cablear eventos emitidos/consumidos contra `IEventBus`.
- [ ] 10. Escribir `contract.test.ts` con todos los tests contractuales de §14.
- [ ] 11. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 12. Escribir `edge.test.ts` con todos los casos límite de §13.
- [ ] 13. Escribir `snapshot.test.ts` con `DocumentModel` de `text-10p.pdf`.
- [ ] 14. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y verificar verde.
- [ ] 15. Verificar que `index.ts` exporta solo `PdfEngine`, `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput` y los errores.
- [ ] 16. Verificar que ninguna dependencia prohibida aparece en imports (`grep -r 'react\|tesseract\|onnx\|pdf-lib' src/`).
- [ ] 17. Verificar `no-network-from-core`: ningún `fetch`/`XMLHttpRequest`/`WebSocket` en `src/`.
- [ ] 18. Verificar test de cancelación < 200 ms.

---

## Referencias

- `architecture/06_Pipeline.md` §3 (etapa 1, extracción)
- `architecture/05_Worker_Architecture.md` §7.1 (PdfWorker)
- `architecture/08_Security_Model.md` §5 (strip metadata)
- `adr/ADR-001-Framework.md` (pdfjs-dist)
- `adr/ADR-003-Workers.md` (pools)
