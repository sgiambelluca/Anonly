# @anonly/ocr-engine

Ejecuta OCR con Tesseract.js sobre las páginas sin texto del PDF (`Page.requiresOCR === true`). Devuelve `Word[]` con `BoundingBox` y `confidence`, listas para que el PDF Engine las fusione vía `fuseOcrPage`.

> Hito 3 (`docs/roadmap/MVP.md` §4). Corre **inline** en el host hasta el Hito 9 (ADR-021): sin `OcrPool` propio. tesseract.js crea sus propios workers internos — eso no es el `OcrPool` de `05_Worker_Architecture.md`.

> Hito 10 PR14 (ADR-045, espejo de ADR-043/render-engine): la clase `OcrEngine` queda **entera host-side** (loop por página, retry/timeout, depósito en `ctx.cache`, emisión de los cuatro eventos) y despacha el reconocimiento por página contra un puerto interno `OcrJobPool` — con `OcrPool` real (inyectada por `create-core.ts`), cruza a un `OcrWorker` de SO real; sin ella, invoca el mismo kernel in-process (fallback bit-idéntico, ADR-035). El worker (`worker/entry.ts`) corre un **kernel de reconocimiento sin estado por documento** (`worker/kernel.ts`): `RUN(ocr-page)` → `COMPLETED { words, confidence }`, sin bus/cache puente — la carrera EVENT/COMPLETED que motivó este reparto (ver el ADR) deja de existir por construcción.

## Documentación

- **Spec canónico**: [`docs/core/OCR_Engine.md`](../../../docs/core/OCR_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §4
- Workers: [`docs/architecture/05_Worker_Architecture.md`](../../../docs/architecture/05_Worker_Architecture.md) §7.2 (OcrWorker, kernel)
- ADRs relevantes: [`ADR-021`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) (inline hasta Hito 9), [`ADR-014`](../../../docs/adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md) (fusión mediada por Orchestrator), [`ADR-018`](../../../docs/adr/ADR-018-First-Party-Assets.md) (assets first-party), [`ADR-036`](../../../docs/adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md) (transporte de Web Workers reales), [`ADR-041`](../../../docs/adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md) (auditoría de estado retenido — OCR sin estado por documento), [`ADR-045`](../../../docs/adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md) (reparto host/worker, puerto `OcrJobPool`, kernel puro)

## Contenido

- `ocr.types.ts` — `OcrPageInput`, `OcrPageOutput` (`OcrConfig` viene de `@anonly/shared`).
- `ocr.errors.ts` — `OcrPageFailedError`, `OcrTimeoutError`, `OcrModelMissingError`.
- `ocr.engine.ts` — clase `OcrEngine` (implementa `IEngine`): `init`, `processPage`, `processPages`, `dispose`; puerto interno `OcrJobPool` (constructor `pool?`, ADR-045 §2).
- `worker/kernel.ts` — kernel de reconocimiento sin estado por documento (setup first-party de tesseract.js, timeout/abort racing, extracción defensiva de palabras/confidence, ADR-045 §1/§3); lo invocan tanto el fallback in-process de `ocr.engine.ts` como `worker/entry.ts`.
- `worker/entry.ts` — entry-point del `OcrWorker` (Hito 10 PR14, ADR-045 §3): pura mensajería alrededor de `kernelRecognize`, sin bus/cache puente.

## Reglas

- Nunca importa otro motor ni React (spec §5 "Dependencias prohibidas": ningún otro motor, `pdfjs-dist` incluido). Solo `@anonly/shared` y `tesseract.js` (ADR-001).
- No se suscribe al bus: es un motor de entrada-salida puro (`processPage`/`processPages`), invocado directamente por el Orchestrator (Hito 9). La fusión con `fuseOcrPage` del PDF Engine (ADR-014) se testea con llamada directa, sin bus, del lado de `pdf-engine` (`contract.test.ts`/`unit.test.ts`, ya cubierto desde el Hito 2 con `Word[]` sintético — spec §10, "igual que en Hito 2"); `ocr-engine` no depende de `@anonly/pdf-engine` para nada, ni siquiera en tests.
- Deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` **antes** de emitir `OCR_PAGE_FINISHED`, en ese orden, siempre host-side (`contract.test.ts` → "cache set happens before OCR_PAGE_FINISHED on host", ADR-045 §1/§4).
- Timeout y reintentos por página: fuente única `ctx.config.workerPool.timeouts["ocr-page"]` / `maxRetries["ocr-page"]` (ADR-021 §2). El único loop de retry es el del motor (`processPage`); el puerto siempre despacha con `maxRetriesOverride: 0` (ADR-045 §2).

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
