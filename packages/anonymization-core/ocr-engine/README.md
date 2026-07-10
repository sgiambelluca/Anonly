# @anonly/ocr-engine

Ejecuta OCR con Tesseract.js sobre las páginas sin texto del PDF (`Page.requiresOCR === true`). Devuelve `Word[]` con `BoundingBox` y `confidence`, listas para que el PDF Engine las fusione vía `fuseOcrPage`.

> Hito 3 (`docs/roadmap/MVP.md` §4). Corre **inline** en el host hasta el Hito 9 (ADR-021): sin `OcrPool` propio. tesseract.js crea sus propios workers internos — eso no es el `OcrPool` de `05_Worker_Architecture.md`.

## Documentación

- **Spec canónico**: [`docs/core/OCR_Engine.md`](../../../docs/core/OCR_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §4
- ADRs relevantes: [`ADR-021`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) (inline hasta Hito 9), [`ADR-014`](../../../docs/adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md) (fusión mediada por Orchestrator), [`ADR-018`](../../../docs/adr/ADR-018-First-Party-Assets.md) (assets first-party)

## Contenido

- `ocr.types.ts` — `OcrPageInput`, `OcrPageOutput` (`OcrConfig` viene de `@anonly/shared`).
- `ocr.errors.ts` — `OcrPageFailedError`, `OcrTimeoutError`, `OcrModelMissingError`.
- `ocr.engine.ts` — clase `OcrEngine` (implementa `IEngine`): `init`, `processPage`, `processPages`, `dispose`.

## Reglas

- Nunca importa otro motor ni React (spec §5 "Dependencias prohibidas": ningún otro motor, `pdfjs-dist` incluido). Solo `@anonly/shared` y `tesseract.js` (ADR-001).
- No se suscribe al bus: es un motor de entrada-salida puro (`processPage`/`processPages`), invocado directamente por el Orchestrator (Hito 9). La fusión con `fuseOcrPage` del PDF Engine (ADR-014) se testea con llamada directa, sin bus, del lado de `pdf-engine` (`contract.test.ts`/`unit.test.ts`, ya cubierto desde el Hito 2 con `Word[]` sintético — spec §10, "igual que en Hito 2"); `ocr-engine` no depende de `@anonly/pdf-engine` para nada, ni siquiera en tests.
- Deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` (`contract.test.ts` → "deposits words in ctx.cache").
- Timeout y reintentos por página: fuente única `ctx.config.workerPool.timeouts["ocr-page"]` / `maxRetries["ocr-page"]` (ADR-021 §2).

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
