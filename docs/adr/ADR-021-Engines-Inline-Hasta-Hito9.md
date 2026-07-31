<!-- CONTEXT: scope=adr | dependencias=roadmap/MVP.md,core/OCR_Engine.md,core/NER_Engine.md,core/Render_Engine.md,core/Export_Engine.md,core/Contracts.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md | audiencia=humanos+IA | fase=5 -->

# ADR-021 — Motores restantes inline hasta Hito 9 + reconciliación del spec OCR

- **Estado**: Accepted (§7 superseded por ADR-041 en lo que respecta a Pdf, 2026-07-22: `PdfEngine.releaseDocument` eliminado — el motor ya no retiene documentos; el patrón sigue vigente para Render `unloadDocument`)
- **Fecha**: 2026-07-09
- **Decidido por**: Repaso documental post-hardening de Hitos 1 y 2, aprobado por el humano

## Contexto

Los specs de OCR, NER, Render y Export mandan crear sus pools (`OcrPool`, `NerPool`, `RenderPool`)
en sus hitos de implementación (3, 5, 7, 8), pero `WorkerPoolManager` y los pools llegan recién con
el Orchestrator (Hito 9). Es la misma contradicción que ADR-013 resolvió para el PDF Engine en el
Hito 2, replicada en cada hito futuro. Además, el spec del OCR retiene redacción previa a ADR-014,
duplica la fuente de verdad de timeout/retries (mismo defecto que ADR-013 corrigió) y promete
campos de payload que no existen en `Contracts.md`.

## Decisión

### 1. Todos los motores restantes corren inline hasta Hito 9

OCR (Hito 3), NER (Hito 5), Render (Hito 7) y Export (Hito 8) se implementan **inline** en el host
thread, sin crear pools propios (precedentes: ADR-013 y ADR-020 para PDF). Conservan interfaz
pública, eventos, outputs y errores de sus specs; cancelación cooperativa vía `ctx.abortSignal` con
checkpoints; el SLA estricto de cancelación < 200 ms se valida en Hito 9/11. Los ítems de checklist
de pools se leen como Hito 9. **Nota OCR**: tesseract.js crea sus propios workers internos — eso no
es el `OcrPool` de `05_Worker_Architecture.md` y no cuenta como violación del modo inline. La
transferencia zero-copy y el caso "imageData/buffer ya transferido" quedan diferidos a Hito 9
(precedente ADR-020 §9).

### 2. Config del OCR: fuente única de timeout/retries (precedente ADR-013)

`OcrConfig` (nombre canónico de `Contracts.md` §6; el alias `OcrEngineConfig` del spec se elimina)
queda con `languages` y `dpi`. Se elimina `pageTimeoutMs`: la fuente única es
`ctx.config.workerPool.timeouts["ocr-page"]` (default 60000) y
`ctx.config.workerPool.maxRetries["ocr-page"]` (default 2). A diferencia del PDF (ADR-020 §5), en
OCR el retry es **contrato funcional** (página que falla se reintenta y el pipeline continúa,
`06_Pipeline.md`): inline, el engine reintenta con un loop simple hasta `maxRetries`; en Hito 9 la
responsabilidad pasa al pool.

### 3. Señal de descarga de modelo: campos opcionales en payloads (opción A)

`OcrStarted` gana `readonly modelLoading?: boolean` y `OcrFinished` gana
`readonly modelDownloaded?: boolean` (Contracts.md §8 y `shared/src/events.ts`), habilitando el
caso límite 10 del spec OCR ("Descargando modelo OCR…") sin inventar eventos nuevos.

### 4. El spec OCR se reconcilia con ADR-014

El PDF Engine **no** recibe `OCR_PAGE_FINISHED`: el Orchestrator lee `ctx.cache`
(`ocr-words:<documentId>:<pageIndex>`) e invoca `PdfEngine.fuseOcrPage`. En Hito 3, la integración
con `fuseOcrPage` se testea con llamada directa (sin bus), igual que en Hito 2.

### 5. Mocks de frontera y fixtures en tests de motores

Los tests unit/contract/edge de motores con librerías externas **mockean la frontera** de la lib
(determinista, sin wasm ni descargas; patrón de helper único con cast documentado,
`Code_Standards.md` §10, precedente `mockGetDocumentResult`). Los tests stress/cancel/integration
y los fixtures binarios reales (`scanned-10p.pdf`) son Hito 11.

### 6. Precisión de P-6: cache de assets públicos permitido

P-6 prohíbe persistir **documentos y datos del usuario**. Cachear assets públicos (modelo
Tesseract en IndexedDB, modelo NER en Cache Storage) está permitido y es responsabilidad interna
de la librería (tesseract.js/Transformers.js), configurada contra origen propio según ADR-018.

### 7. `DOCUMENT_CLOSED` invoca `releaseDocument`

El Orchestrator, al procesar `DOCUMENT_CLOSED`, invoca `PdfEngine.releaseDocument(documentId)`
(ADR-020 §7) además de liberar caches y blobUrls. Patrón general: todo motor con estado por
documento expone un método de evicción individual idempotente.

## Consecuencias

**Positivas**: la clase entera de ambigüedad "spec exige pool inexistente" queda resuelta por
adelantado para los 4 motores restantes; el spec del OCR queda implementable sin frenadas; una
sola fuente de verdad para timeout/retries de OCR; contratos de payload completos.

**Negativas**: OCR inline puede bloquear el main thread en documentos muy escaneados; mitigado
porque la UI llega en Hito 10 y los pools en Hito 9. Los campos opcionales de payload agregan
superficie de contrato; aceptado por ser la señal de UX mínima para la descarga del modelo.

## Referencias

- `adr/ADR-013-PDF-Engine-Hito2-Inline.md`, `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md`,
  `adr/ADR-018-First-Party-Assets.md`, `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md`
- `core/OCR_Engine.md`, `core/NER_Engine.md`, `core/Render_Engine.md`, `core/Export_Engine.md`
- `core/Contracts.md` §6, §8 — `architecture/06_Pipeline.md` — `ai/Code_Standards.md` §10, §12
