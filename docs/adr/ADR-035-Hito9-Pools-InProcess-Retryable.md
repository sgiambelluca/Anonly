<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/PDF_Engine.md,architecture/05_Worker_Architecture.md,ai/Code_Standards.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md | audiencia=humanos+IA | fase=9 -->

# ADR-035 — Hito 9: pools in-process, Web Workers reales diferidos al Hito 10 y semántica canónica de `retryable`

- **Estado**: Accepted
- **Fecha**: 2026-07-17
- **Decidido por**: El humano, sobre hallazgos reportados por el implementador del Hito 9 y verificados por el planificador
- **Relacionado con**: ADR-013 (inline en Hito 2, `parsePage` aislada para el job de worker), ADR-021 (motores inline hasta Hito 9), ADR-034 §7 (alcance de pools del Hito 9 = los cuatro)

## Contexto

La implementación del Hito 9 entregó `WorkerPool`/`WorkerPoolManager` (`packages/anonymization-core/src/worker-pool.ts`) con la semántica completa de `05_Worker_Architecture.md` — cola prioritaria, límite de concurrencia por pool, backpressure (`WORKER_POOL_SATURATED`), reintentos con backoff exponencial, traducción a eventos `WORKER_*`, cancelación — pero despachando por **llamada directa** a los métodos públicos ya existentes de cada motor, no por `postMessage` a Web Workers de SO. El implementador lo reportó como decisión pendiente de confirmación en lugar de darla por cerrada. Razones estructurales, verificadas por el planificador:

1. **Los entry-points de worker viven dentro de cada motor.** ADR-013 §6 pide aislar `parsePage` como función pura para que "Hito 9 la envuelva en un job del worker sin modificarla" — es decir, un archivo de worker nuevo dentro de `pdf-engine/` (y equivalentes en `ocr-engine/` y `ner-engine/`, que importan `tesseract.js` y `@huggingface/transformers` respectivamente). El PR del Hito 9 tiene prohibido tocar esos motores (R-1/R-5; ADR-034 autorizó código solo en `shared`, `render-engine` y `export-engine`).
2. **No hay entorno donde ejecutarlos ni testearlos.** `Worker` es API de navegador y `new Worker(new URL(...))` requiere bundler; el Core no usa bundler (`Code_Standards.md` §1: Vite es solo de `apps/react-client`) y su entorno de test es `environment: "node"` (`vitest.config.ts`), sin `Worker` ni `OffscreenCanvas`. Un transporte por hilos reales no podría verificarse antes de que exista la app (Hito 10).

Además, el pool de PDF reintentaba en vano contra `PDF_PASSWORD_REQUIRED` (ninguna cantidad de retries produce un password), lo que destapó una **contradicción doc-doc**: `core/PDF_Engine.md` §11 declara `retryable: PDF_PASSWORD_REQUIRED = true` (y el código `pdf.errors.ts` lo sigue), mientras `architecture/05_Worker_Architecture.md` §5 lo lista entre los errores no retryables. La raíz es que los docs conflaron dos nociones distintas: *recuperable con intervención del usuario* (la UI pide el password y reintenta — columna "Recuperable" de las tablas de errores) y *auto-reintentable por el pool sin intervención*.

## Decisión

### 1. Los pools del Hito 9 son colas de concurrencia in-process (aceptado)

- `WorkerPool`/`WorkerPoolManager` quedan como entrega válida del Hito 9: aportan de forma genuina y testeada la semántica de `05_Worker_Architecture.md` (colas prioritarias, límite de concurrencia, backpressure, retries con backoff, eventos `WORKER_*`, cancelación), despachando por llamada directa a `PdfEngine.process`, `OcrEngine.processPage`, `NerEngine.processPage` y `RenderEngine.renderPage`/`rasterizePage` sin cambiar ninguna interfaz pública (invariante de ADR-013/ADR-021).
- El checklist §15.11 del spec del Orchestrator se da por cumplido **en modo in-process**; el ítem gana la anotación correspondiente.
- El despacho está encapsulado en `worker-pool.ts`: la migración futura a `postMessage` no toca al resto del Orchestrator ni a los motores consumidores.

**Alternativas rechazadas**:

| Alternativa | Por qué no |
|---|---|
| Exigir Web Workers reales dentro del Hito 9 | Requiere PRs sobre `pdf-engine`/`ocr-engine`/`ner-engine` (viola R-1 dentro del hito y obliga a replanificarlo como secuencia multi-motor) y aun así no podría ejecutarse ni testearse: sin bundler en el Core ni `Worker` en el entorno de test, el transporte quedaría muerto hasta el Hito 10. |
| Darle bundler propio al Core para los workers | Rompe `Code_Standards.md` §1 ("El Core no usa bundler") y duplica infraestructura que ya llega con Vite en `apps/react-client`; decisión estructural análoga a la prohibición de libs externas en el Orchestrator (ADR-034 §1, alternativas). |

### 2. Web Workers reales → Hito 10 (React Client)

- Los entry-points de worker por motor (`pdf-engine`, `ocr-engine`, `ner-engine`; `RenderPool`/`ExportWorker` según `05` §7.4/§7.5) se implementan en el Hito 10, en PRs por motor (R-1), bundleados por el Vite de `apps/react-client`.
- Los transferables (`05` §2.3) y la lógica de `Transferable.consume()` se difieren junto con el transporte (coherente con ADR-013 §6 y `PDF_Engine.md` §12, que ya la vetaban como dead code inline).
- `05_Worker_Architecture.md` **sigue siendo la arquitectura objetivo** (principio A-9); gana una nota de entrega por fases, no una reescritura.
- La exposición a bloqueo del main thread entre los Hitos 9 y 10 replica la mitigación ya aceptada en ADR-013 §Consecuencias: no existe UI que se congele hasta el Hito 10 — que es exactamente donde llegan los hilos reales.
- `roadmap/MVP.md` §4 Hito 10 gana el ítem de migración; el ítem de pools del Hito 9 queda anotado como cumplido en modo in-process.

### 3. Semántica canónica de `retryable`: auto-reintentable por el pool

- `EngineError.retryable` (y su reflejo `SerializedEngineError.retryable`) significa una sola cosa: **el pool puede reintentar el job sin intervención del usuario**.
- La recuperabilidad por acción del usuario se expresa por evento + flujo de UI (`PDF_PASSWORD_REQUIRED` → modal → `retryWithPassword`), y por la columna "Recuperable" de las tablas §11 de los specs — nunca por el flag.
- Por lo tanto `PDF_PASSWORD_REQUIRED` → `retryable = false`. Erratas: `PDF_Engine.md` §11 (línea del flag) y `05_Worker_Architecture.md` §5 (aclaración de semántica).
- El cambio de código — `pdf-engine/src/pdf.errors.ts`, segundo argumento del `super(...)` de `PdfPasswordRequiredError`: `true` → `false` — y el retiro del override `isRetryable` del Orchestrator van en un **PR chico de `pdf-engine` posterior al cierre del Hito 9** (R-1; mismo patrón que el PR chico de `Occurrence.maskFormat`, ADR-029 §4). Hasta entonces, el override documentado en `orchestrator.ts` mantiene el comportamiento correcto.

### 4. Hallazgos menores del implementador (confirmados, sin acción)

- **Etapa 3 (normalización)**: no existe función de normalización adicional en `shared` que invocar; la NFC ya vive en pdf-engine/ocr-engine y `normalizedValue` lo computan regex-engine/ner-engine. El no-op del Orchestrator en esa etapa queda documentado en código.
- **`Replacement.originalValue`**: el `RenderPageProvider` real no lo consume (`RenderEngine.paintReplacements` usa solo `mode`/`replacementValue`) — cierra el pendiente del Hito 8 tal como ADR-034 §7 preveía ("si Render no consume `originalValue`, se documenta y se cierra en el PR del hito").
- **Fixture mecánico de `maxQueuePerPool`** en pdf/ocr/regex/ner/grouping-engine y `tests/security/`: consecuencia directa del cambio de tipo autorizado por ADR-034 §7, una línea por fixture, sin lógica tocada.

## Consecuencias

**Positivas**: el Hito 9 cierra con la semántica de concurrencia implementada y testeada (saturación, retries, backpressure — spec §14) sin abrir PRs multi-motor ni infraestructura intesteable; la migración a hilos reales queda localizada (worker-pool.ts + entry-points nuevos) y con hito asignado; `retryable` deja de ser ambiguo y el reintento en vano contra password queda imposible por contrato.

**Negativas**: hasta el Hito 10 el procesamiento pesado corre en el thread del host (mitigación idéntica a ADR-013: no hay UI que lo observe); divergencia transitoria entre `PDF_Engine.md` §11 (errata aplicada: `false`) y `pdf.errors.ts` (flag viejo: `true`) hasta el PR chico (mitigada: el override del Orchestrator ya alinea el comportamiento en runtime); el cumplimiento "en modo in-process" del checklist §15.11 obliga a no perder de vista el ítem nuevo del Hito 10 (mitigado: roadmap + nota de fases en `05`).

## Referencias

- `core/Orchestrator.md` §15.11 — `core/PDF_Engine.md` §11, §12
- `architecture/05_Worker_Architecture.md` §1, §2.3, §5, §7 — `ai/Code_Standards.md` §1
- `adr/ADR-013` §6, §Consecuencias — `adr/ADR-021` — `adr/ADR-029` §4 — `adr/ADR-034` §1, §7
- `packages/anonymization-core/src/worker-pool.ts` (header) — `packages/anonymization-core/pdf-engine/src/pdf.errors.ts`
- `roadmap/MVP.md` §4 (Hito 9, Hito 10)
