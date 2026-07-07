<!-- CONTEXT: scope=ocr-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md | audiencia=IA-implementador | fase=3 -->

# OCR Engine — Spec de Motor

> Ejecuta OCR sobre las páginas sin texto del PDF. Solo corre si `PdfEngineOutput.textlessPages.length > 0`. Devuelve `Word[]` con `BoundingBox` y `confidence` que el PDF Engine fusiona.

**EngineId**: `ocr`
**Versión del spec**: 1.0.0
**Última actualización**: 2026-06-17

---

## 1. Objetivo

Recibir `ImageData` de páginas sin texto y producir `Word[]` con posiciones y confianza, reutilizando el modelo Tesseract cargado en cada worker del pool.

---

## 2. Responsabilidades

- Cargar Tesseract.js y el modelo `spa+eng` (default) en cada worker del `OcrPool`.
- Recibir `ImageData` por página y ejecutar OCR.
- Producir `Word[]` con `BoundingBox`, `confidence`, `source: "ocr"`.
- Cache el modelo en IndexedDB tras primera descarga.
- Emitir `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED`.
- Transferir zero-copy `ImageData` al worker.
- Depositar las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` y notificar al PDF Engine vía `OCR_PAGE_FINISHED`.

---

## 3. Fuera de alcance

- Rasterizar el PDF a `ImageData` (es tarea del host o de un `RenderWorker` ligero).
- Detectar entidades (Regex/NER).
- Fusionar las palabras en `Page` (es tarea del PDF Engine vía `fuseOcrPage`).
- Renderizar el PDF final.
- Conocer React ni UI.
- Persistir documentos.

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `tesseract.js` (justificado en ADR-001)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Word`, `BoundingBox`, `OcrConfig`
- `architecture/04_Event_System.md`: `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED`

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `pdf-lib`, `@xenova/transformers`, `onnxruntime-web`
- Node builtins (`fs`, `http`), libs de network

---

## 6. Interfaces públicas

```ts
export interface OcrEngineConfig {
  readonly languages: ReadonlyArray<string>; // default ["spa", "eng"]
  readonly dpi: number;                       // default 300 (calidad OCR)
  readonly pageTimeoutMs: number;             // default 60000
  readonly maxRetries: number;                // default 2
}

export interface OcrPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly imageData: ImageData;              // se transfiere (zero-copy)
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

export interface OcrPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly words: ReadonlyArray<Word>;
  readonly confidence: number;                // promedio
  readonly durationMs: number;
}

export class OcrEngine implements IEngine {
  readonly id = EngineId.Ocr;
  init(ctx: EngineContext): Promise<void>;
  processPage(input: OcrPageInput, ctx: EngineContext): Promise<OcrPageOutput>;
  processPages(inputs: ReadonlyArray<OcrPageInput>, ctx: EngineContext): Promise<ReadonlyArray<OcrPageOutput>>;
  dispose(): Promise<void>;
}
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `OCR_STARTED` | al iniciar el procesamiento de un set de páginas | `OcrStarted` | async | sí |
| `OCR_PAGE_FINISHED` | al finalizar una página | `OcrPageFinished` | async | sí |
| `OCR_FINISHED` | al finalizar todas las páginas del set | `OcrFinished` | async | sí |
| `OCR_PAGE_FAILED` | al fallar una página tras reintentos | `OcrPageFailed` | async | sí |

Canal: `EventChannel.Ocr`.

---

## 8. Eventos que consume

No consume eventos. Es un motor de "entrada-salida" puro; el Orchestrator lo invoca directamente vía `processPage`/`processPages`.

---

## 9. Entradas

```ts
OcrPageInput {
  documentId: string;
  pageIndex: number;
  imageData: ImageData;     // rasterización de la página; se transfiere
  dpi: number;              // default 300
  languages: ReadonlyArray<string>;  // default ["spa", "eng"]
}
```

**Restricciones**:
- `imageData.width > 0 && imageData.height > 0`. Si no, lanza `InvalidInputError`.
- `pageIndex >= 0`.
- `languages` debe contener al menos un idioma cargado en el modelo del worker.
- `imageData` se transfiere (zero-copy). El host pierde acceso tras `processPage`.

---

## 10. Salidas

```ts
OcrPageOutput {
  documentId: string;
  pageIndex: number;
  words: ReadonlyArray<Word>; // ordenadas por bbox.y asc, luego bbox.x asc
  confidence: number;          // promedio [0,1]
  durationMs: number;
}
```

- `words[i].source === "ocr"`.
- `words[i].pageIndex === input.pageIndex`.
- `words[i].confidence ∈ [0,1]`.
- Las `Word[]` también se depositan en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` para que el PDF Engine las fusione al recibir `OCR_PAGE_FINISHED`.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `OCR_PAGE_FAILED` | `OcrPageFailedError` | Tesseract lanza error en una página tras `maxRetries` | no | esa página queda sin OCR; las detecciones posteriores se saltan sus ocurrencias; warning al usuario |
| `OCR_TIMEOUT` | `OcrTimeoutError` | timeout por página excedido | sí | reintentar hasta `maxRetries`, luego `OCR_PAGE_FAILED` |
| `OCR_MODEL_MISSING` | `OcrModelMissingError` | no se pudo cargar/descargar el modelo Tesseract | no | abortar OCR; el usuario debe reintentar o desactivar OCR |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `processPage` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `processPage` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined o `imageData` vacío | no | bug del caller |

`retryable`: `OCR_TIMEOUT = true`, resto `false`.

---

## 12. Consideraciones de rendimiento

- Corre en `OcrPool` (1–2 workers default; 1 en móviles).
- Costo: 3–10 s por página A4 a 300 DPI (depende de densidad de texto).
- Memoria: 150–300 MB por worker (modelo cargado). El modelo se reutiliza entre jobs.
- `imageData` se transfiere (zero-copy).
- Paralelismo: el pool despacha en paralelo respetando `ocrPoolSize`. Backpressure si `queue > MAX_QUEUE_PER_POOL = 8`.
- Cancelación: Tesseract expone callback de progreso; el worker chequea `shouldCancel` entre líneas y aborta en < 200 ms.
- Modelo cacheado en IndexedDB tras primera descarga (~30 MB). Sesiones posteriores no descargan.
- `dpi` recomendado: 300 para OCR preciso. 200 acceptable para texto grande. 600 innecesario (más lento sin beneficio).
- Progreso: Tesseract reporta progreso 0..1 por palabra/línea; el worker emite `PROGRESS` al pool, el Orchestrator traduce a `PIPELINE_PROGRESS`.

---

## 13. Casos límite

1. **Página completamente vacía (blanca)**: `words = []`, `confidence = 0`. `OCR_PAGE_FINISHED` se emite normalmente.
2. **Página con imagen sin texto**: `words = []`, `confidence = 0`. Normal.
3. **Página con texto muy pequeño (calidad baja)**: `confidence < 0.5`. El usuario puede ver warning; las ocurrencias NER posteriores tendrán `confidence = min(ocrConf, nerConf)`.
4. **`imageData` ya transferido**: lanza `InvalidInputError`.
5. **Idioma no cargado en el modelo**: lanza `OcrModelMissingError`.
6. **Timeout por página**: reintentar 2 veces. Si persiste, `OCR_PAGE_FAILED` y se continúa con las demás páginas.
7. **Worker crashea (OOM)**: el pool reemplaza el worker, reintenta el job si `retryable`.
8. **Cancelación a mitad de página**: aborta en < 200 ms, libera memoria temporal, responde `CANCELLED`.
9. **100 páginas escaneadas**: se procesan en paralelo (pool size 2). Memoria pico ~600 MB (2 workers × 300 MB). El host vigila memory budget y serializa si `deviceMemory < 4` GB.
10. **Modelo no descargado todavía (primera vez)**: `OCR_STARTED` indica `modelLoading: true`, `OCR_FINISHED` al final incluye `modelDownloaded: true`. La UI muestra "Descargando modelo OCR…".
11. **`processPage` tras `dispose`**: lanza `EngineDisposedError`.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits OCR_STARTED before pages` | `contract.test.ts` | contract | invariante de orden |
| `emits OCR_PAGE_FINISHED per page` | `contract.test.ts` | contract | uno por página |
| `emits OCR_FINISHED after all pages` | `contract.test.ts` | contract | al final |
| `words sorted by bbox y then x` | `unit.test.ts` | unit | orden |
| `confidence in [0,1]` | `unit.test.ts` | unit | rango |
| `word.source === "ocr"` | `contract.test.ts` | contract | invariante |
| `deposits words in ctx.cache` | `contract.test.ts` | contract | integración con PDF Engine |
| `empty page returns empty words` | `edge.test.ts` | edge | caso 1 |
| `image-only page returns empty words` | `edge.test.ts` | edge | caso 2 |
| `low confidence warns` | `edge.test.ts` | edge | caso 3 |
| `throws on already-transferred imageData` | `edge.test.ts` | edge | caso 4 |
| `throws on unknown language` | `edge.test.ts` | edge | caso 5 |
| `retries on timeout up to maxRetries` | `edge.test.ts` | edge | caso 6 |
| `replaces crashed worker and retries` | `stress.test.ts` (en `tests/stress/`) | stress | caso 7 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 8 |
| `100 pages complete within memory budget` | `stress.test.ts` | stress | caso 9 |
| `model cached in IndexedDB after first run` | `integration.test.ts` (en `tests/integration/`) | integration | caso 10 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 11 |

Fixtures: `tests/fixtures/scanned-10p.pdf` (rasterizado a `ImageData` por el host), imagen blanca, imagen con texto pequeño.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/ocr-engine/`.
- [ ] 2. Definir `types.ts` con `OcrEngineConfig`, `OcrPageInput`, `OcrPageOutput`.
- [ ] 3. Definir `errors.ts` con `OcrPageFailedError`, `OcrTimeoutError`, `OcrModelMissingError`.
- [ ] 4. Implementar `ocr.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (crear `OcrPool`, cargar Tesseract y modelo `spa+eng` en cada worker, cache en IndexedDB).
- [ ] 6. Implementar `processPage` con transferencia de `ImageData`, `AbortSignal`, `PROGRESS` callback de Tesseract → `OCR_PAGE_FINISHED`.
- [ ] 7. Implementar `processPages` (ordena por prioridad visible, despacha al pool, backpressure).
- [ ] 8. Implementar depósito en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
- [ ] 9. Implementar `dispose` (libera Tesseract workers y memoria temporal; NO descarga el modelo cacheado).
- [ ] 10. Cablear eventos emitidos contra `IEventBus`.
- [ ] 11. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 12. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 13. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 14. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 15. Verificar `index.ts` exporta solo lo público.
- [ ] 16. Verificar imports sin dependencias prohibidas (`grep -r 'react\|pdfjs\|pdf-lib\|onnx\|transformers' src/`).
- [ ] 17. Verificar `no-network-from-core` (sin `fetch`/`XMLHttpRequest` propios). Configurar Tesseract.js con `langPath`/`corePath`/`workerPath` apuntando al origen propio (`/models/tesseract/`, `/wasm/tesseract/`): los assets se sirven first-party con hash verificado según ADR-018 — nunca desde jsDelivr/GitHub en runtime.
- [ ] 18. Verificar test de cancelación < 200 ms.

---

## Referencias

- `architecture/06_Pipeline.md` §4 (etapa 2, OCR)
- `architecture/05_Worker_Architecture.md` §7.2 (OcrWorker)
- `architecture/07_Performance_Strategy.md` §2.2 (carga de wasm y modelo)
- `adr/ADR-001-Framework.md` (tesseract.js)
- `adr/ADR-003-Workers.md` (pools)
