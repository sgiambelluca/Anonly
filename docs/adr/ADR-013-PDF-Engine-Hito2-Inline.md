<!-- CONTEXT: scope=adr | dependencias=roadmap/MVP.md,core/Contracts.md,core/PDF_Engine.md,architecture/05_Worker_Architecture.md | audiencia=humanos+IA | fase=5 -->

# ADR-013 — PDF Engine Hito 2: Ejecución Inline + reconciliación de `PdfEngineConfig`

- **Estado**: Accepted
- **Fecha**: 2026-06-18
- **Decidido por**: Planificador (resolución de ambigüedad Hito 2)

## Contexto

El roadmap (`MVP.md` §4 Hito 2) pide "Integración con `PdfPool`", pero `WorkerPoolManager`/`PdfPool` no tienen hito asignado hasta Hito 9 (Orchestrator). Construir el pool en Hito 2 expande el alcance y acopla el motor a infraestructura que aún no existe. Además:

- `PdfEngineConfig` se define en `PDF_Engine.md` §6 pero `EngineConfig` (`Contracts.md` §3.1) **no tiene campo `pdf`** → la config no tiene transporte.
- El timeout por página está duplicado: `PdfEngineConfig.parseTimeoutMsPerPpage` (con typo "doble p") y `WorkerPoolConfig.timeouts["pdf-parse"]` (default 30000, `05_Worker_Architecture.md` §4).

## Decisión

1. **Hito 2**: `PdfEngine` ejecuta **inline** en el host thread (sin workers, sin `PdfPool`). Conserva la interfaz pública (`IEngine` + `PDF_Engine.md` §6), eventos emitidos, outputs, errores y cancelación cooperativa vía `ctx.abortSignal` con checkpoint por página.
2. **Hito 9**: migración a `PdfPool` cuando `WorkerPoolManager` exista. **Sin cambio de interfaz pública**.
3. **Contracts.md §3.1**: agregar `readonly pdf: PdfEngineConfig;` a `EngineConfig`.
4. **Contracts.md §6**: definir `PdfEngineConfig` ahí (source of truth movida desde `PDF_Engine.md` §6, que pasa a referenciarla): `export interface PdfEngineConfig { readonly maxPageCount: number; }` (default 10000).
5. **Timeout por página**: source of truth única = `ctx.config.workerPool.timeouts["pdf-parse"]` (default 30000). Se elimina `parseTimeoutMsPerPage` de `PdfEngineConfig` (corrige además el typo `parseTimeoutMsPerPpage`).
6. **Preparación para Hito 9 (normativa)**: el implementador de Hito 2 debe aislar `parsePage(pdfDoc, pageIndex): Page` como función pura sin supuestos host/worker (Hito 9 la envuelve en un job del worker sin modificarla). La emisión de eventos (`PAGE_PARSED`, `DOCUMENT_PARSED`) queda en el engine (host), no en el worker. No implementar lógica de `Transferable.consume()` en Hito 2 (dead code inline); el `buffer` se trata como `ArrayBuffer` plano hasta la migración.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Construir `WorkerPoolManager` + `PdfPool` en Hito 2 | Expande alcance; acopla motor a infra sin Orchestrator; `OcrPool`/`NerPool`/`RenderPool` quedarían huérfanos de secuenciación. Rompe R-1 (un PR = un módulo). |
| Mantener `parseTimeoutMsPerPage` en `PdfEngineConfig` | Dual source of truth con `WorkerPoolConfig.timeouts`; ambigüedad latente sobre cuál prevalece. |
| No agregar `pdf` a `EngineConfig` y usar defaults hardcodeados | Viola R-19 (tipos en `Contracts.md` primero); no permite override por sesión. |

## Consecuencias

**Positivas**: Hito 2 desacoplado de infraestructura de pools; contrato de config coherente; single source of truth para timeout; migración a pool en Hito 9 sin ruptura de contrato. Tests de Hito 2 (Vitest + mocks de pdfjs) encajan limpio en ADR-010 sin contorsiones worker-aware.

**Negativas**: En Hito 2 el parseo corre en main thread (puede jankear la UI en PDFs grandes); mitigado porque la UI llega en Hito 10 y los tests de perf/cancel reales son Hito 11. El SLA de cancelación < 200 ms no se valida hasta Hito 9/11.

## Validación

- Contract tests de `PdfEngine` pasan en modo inline (eventos, invariantes, errores, `fuseOcrPage`).
- Typecheck: `EngineConfig.pdf: PdfEngineConfig` resuelto en `@anonly/shared`.
- Hito 9: test de migración que verifica misma salida inline vs pool para un PDF dado.

## Referencias

- `roadmap/MVP.md` §4 (Hito 2, Hito 9)
- `core/Contracts.md` §3.1, §6
- `core/PDF_Engine.md` §6, §12, §15
- `architecture/05_Worker_Architecture.md` §4, §7.1
- `adr/ADR-003-Workers.md`
