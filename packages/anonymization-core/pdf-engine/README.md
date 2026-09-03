# @anonly/pdf-engine

Extrae texto y posiciones de un PDF con `pdfjs-dist`: devuelve `Page[]` con `Word[]` en **puntos de página**, marca las páginas sin texto extraíble (`requiresOCR`) y fusiona después las palabras que produce el OCR.

## Ejecución

Corre en un **Web Worker real** (`PdfWorker`), sobre el pool `pdf` — cuyo tamaño escala con `hardwareConcurrency` (2 en equipos chicos).

**Es el único motor sin puerto de pool propio**, y la diferencia importa: los otros cuatro motores con worker mandan al otro lado un *kernel* sin estado y conservan la clase host-side, pero acá el `worker/entry.ts` corre **el motor real completo** (ADR-036 §3). Por eso `PdfEngine` no recibe una pool por constructor: el despacho lo hace el **Orchestrator**, que llama `pools.getPool("pdf").dispatch(...)` con el `PdfParsePayload` y angosta el resultado con `decodePdfEngineOutput` —el decoder lo exporta este motor, porque es el que conoce el contrato de su propio worker (ADR-055 §8)—.

Dentro de esa pasada, **las páginas se recorren secuencialmente**, con checkpoint de cancelación entre una y otra.

Sin factory de worker inyectada, el mismo `process()` corre in-process con resultado bit-idéntico (ADR-035): así corren los tests y así funciona un cliente que no wirea workers.

> El buffer que recibe puede quedar **detached**: `pdfjs-dist` lo transfiere a su propio worker interno. El Orchestrator siempre entrega una copia y nunca suelta el original que retiene.

## Documentación

- **Spec canónico**: [`docs/core/PDF_Engine.md`](../../../docs/core/PDF_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Modelo de datos (`Page`, `Word`, `BoundingBox`): [`docs/architecture/03_Data_Model.md`](../../../docs/architecture/03_Data_Model.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md)
- Workers: [`docs/architecture/05_Worker_Architecture.md`](../../../docs/architecture/05_Worker_Architecture.md)
- ADRs relevantes: [`ADR-013`](../../../docs/adr/ADR-013-PDF-Engine-Hito2-Inline.md) (ejecución inline en el Hito 2), [`ADR-014`](../../../docs/adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md) (la fusión OCR→PDF la media el Orchestrator), [`ADR-020`](../../../docs/adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md) (granularidad de `Word`, bbox prorrateado, NFC), [`ADR-036`](../../../docs/adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md) §3 (el worker corre el motor completo), [`ADR-041`](../../../docs/adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md) (`fuseOcrPage` pura, sin estado retenido), [`ADR-055`](../../../docs/adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md) §8 (el decoder vive en el motor)

## Contenido

- `pdf.engine.ts` — clase `PdfEngine` (implementa `IEngine`): `process`, `fuseOcrPage`, `fuseOcrRegion`, `releaseDocument`, y el orden de lectura de la página.
- `pdf.errors.ts` — errores tipados del motor (`PdfInvalidError`, `PdfPasswordRequiredError`, `PdfCorruptedError`, timeouts).
- `worker/entry.ts` — entry-point del `PdfWorker`: mensajería `INIT`/`RUN(pdf-parse)`/`CANCEL`/`DISPOSE` alrededor del motor real.

## Lo que este motor decide

- **Qué es una palabra**: los `item` de `pdfjs-dist` no coinciden con palabras; se parten y se les prorratea el bbox (ADR-020). Desde ADR-109 la caja de una palabra es su **caja de tinta** —del descenso al ascenso de su fuente—, no un alto derivado del cuerpo.
- **El orden de lectura**, que es de lo que depende que un span de texto mapee a las palabras correctas: renglones como grupo y no como coordenada con tolerancia (ADR-110), corte por columnas (ADR-113), y una hoja escaneada torcida leída en el orden de su versión enderezada (ADR-120).
- **Qué página necesita OCR** (`requiresOCR`) y dónde encaja el resultado: `fuseOcrPage`/`fuseOcrRegion` son **funciones puras** que el Orchestrator invoca host-side (ADR-041). Las palabras del OCR se reordenan con el mismo criterio de esta página, así que el orden que ve el detector sale siempre de acá.

## Reglas

- Nunca importa otro motor ni React. Solo `@anonly/shared` y `pdfjs-dist`.
- No se suscribe al bus para el flujo del pipeline: es entrada-salida pura, invocado por el Orchestrator.
- Todo `bbox` que sale de acá está en **puntos de página**, nunca en píxeles de un raster (`03_Data_Model.md` §137).

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
