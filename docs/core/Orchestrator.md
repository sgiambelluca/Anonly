<!-- CONTEXT: scope=orchestrator | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-015-UI-Channel-Canonical.md | audiencia=IA-implementador | fase=3 (Hito 9) -->

# Orchestrator — Spec del Componente Host

> Secuencia las etapas del pipeline, invoca los motores, gestiona los pools de workers y la cancelación, y expone el façade público del Core (`createCore` / `IAnonymizationCore`). Es la **composition root**: el único código del Core autorizado a importar motores.

**Componente**: Orchestrator + façade `@anonly/anonymization-core` (no es un motor: **no tiene `EngineId`** y no implementa `IEngine`; este spec adapta la plantilla de 15 secciones de `ai/Module_Specification_Template.md` a un componente host)
**Ubicación**: `packages/anonymization-core/src/`
**Versión del spec**: 1.0.0
**Última actualización**: 2026-07-07
**Estado de implementación**: pendiente (Hito 9). El façade actual (`src/index.ts`) es un placeholder.

---

## 1. Objetivo

Coordinar el ciclo de vida completo de un documento (etapas 0–11 de `06_Pipeline.md`) sin que ningún motor conozca a otro: el Orchestrator escucha los eventos de fin de etapa, decide la etapa siguiente, invoca al motor correspondiente y mantiene el `PipelineState` observable por la UI.

---

## 2. Responsabilidades

- Exponer `createCore(config)` que instancia bus, engines, pools y orchestrator, y devuelve `IAnonymizationCore`.
- Secuenciar las etapas del pipeline según `06_Pipeline.md`: extracción → OCR (si `textlessPages.length > 0`) → normalización → Regex → NER → agrupación → conflictos → preview → edición → render → export.
- Emitir los eventos del canal `pipeline`: `DOCUMENT_IMPORTED`, `PIPELINE_STAGE_CHANGED`, `PIPELINE_PROGRESS`, `PIPELINE_READY`, `PIPELINE_CANCELLED`, `PIPELINE_FAILED`.
- Invocar directamente los motores de entrada/salida pura (`PdfEngine.process`, `OcrEngine.processPages`, `RegexEngine.process`, `NerEngine.processPages`) — estos motores no se suscriben al bus (ADR-014).
- Mediar la fusión OCR→PDF: escuchar `OCR_PAGE_FINISHED`, leer las `Word[]` de `ctx.cache` (clave `ocr-words:<documentId>:<pageIndex>`) e invocar `PdfEngine.fuseOcrPage` (ADR-014).
- Rasterizar páginas sin texto a `ImageData` para el OCR Engine (`06_Pipeline.md` §4).
- Ejecutar la etapa de normalización (`shared`) en main thread.
- Gestionar `WorkerPoolManager` y `AbortRegistry` (`05_Worker_Architecture.md`): creación perezosa de pools, timeouts, reintentos con backoff, backpressure (pausar ingest ante `WORKER_POOL_SATURATED`), traducción de eventos `WORKER_*` a eventos funcionales.
- Gestionar la cancelación: escuchar `CANCEL_REQUESTED`, abortar el `AbortController` del `signalId`, propagar `CANCEL` a los pools, emitir `PIPELINE_CANCELLED` (SLA < 200 ms, `05_Worker_Architecture.md` §3).
- Inyectar el `RenderPageProvider` al Export Engine al inicializar (`core/Export_Engine.md` §6).
- Crear los `blobUrl` en el host (`URL.createObjectURL`) a partir de `ImageData`/`ArrayBuffer` transferidos por Render/Export, y revocarlos al reemplazar o cerrar (`07_Performance_Strategy.md` §8).
- Serializar OCR y NER (no paralelos) cuando `deviceMemory < 4` GB (`07_Performance_Strategy.md` §5.1, §7.1).
- Encolar exports: un segundo `EXPORT_REQUESTED` durante un export en curso se encola, no se superpone (`07_Performance_Strategy.md` §11.6).
- Liberar todos los recursos ante `DOCUMENT_CLOSED` (caches, `Document`, blobUrls; los pools se disponen tras 60 s idle).
- Mantener `PipelineState` por documento, consultable vía `getState`.

---

## 3. Fuera de alcance

- Parsear, detectar, agrupar, renderizar o exportar (eso es de los motores; el Orchestrator solo coordina).
- Conocer React ni ningún framework de UI.
- Contener lógica de anonimización o decisiones de reemplazo.
- Resolver conflictos entre detectores (Grouping Engine).
- Persistir documentos, hacer network.
- Validar patches de grupos/reglas (Grouping Engine escucha el canal `ui` directamente, ver `core/Grouping_Engine.md` §8).

---

## 4. Dependencias permitidas

Como composition root, es el **único** paquete del Core que puede importar motores (excepción a P-2 documentada en `ai/Code_Standards.md` §12):

- `@anonly/shared` (tipos, contratos, error codes)
- `@anonly/event-system` (bus)
- `@anonly/pdf-engine`, `@anonly/ocr-engine`, `@anonly/regex-engine`, `@anonly/ner-engine`, `@anonly/grouping-engine`, `@anonly/render-engine`, `@anonly/export-engine`
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `EngineConfig`, `PipelineState`, `PipelineStage`, `WorkerJob`, `WorkerPoolConfig`, `ICache`, `ILogger`, `IEventBus`

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- `pdfjs-dist`, `tesseract.js`, `@xenova/transformers`, `onnxruntime-web`, `pdf-lib` (las libs externas pertenecen a los motores, nunca al Orchestrator)
- Node builtins (`fs`, `http`), libs de network

---

## 6. Interfaces públicas

```ts
export interface IAnonymizationCore {
  readonly bus: IEventBus;
  readonly engines: {
    readonly pdf: PdfEngine;
    readonly ocr: OcrEngine;
    readonly regex: RegexEngine;
    readonly ner: NerEngine;
    readonly grouping: GroupingEngine;
    readonly render: RenderEngine;
    readonly export: ExportEngine;
  };
  readonly orchestrator: IPipelineOrchestrator;
  dispose(): Promise<void>;
}

export interface ImportDocumentInput {
  readonly documentId: string;        // UUID v4 generado por el caller
  readonly name: string;
  readonly buffer: ArrayBuffer;       // PDF binario
  readonly password?: string;
}

export interface IPipelineOrchestrator {
  importDocument(input: ImportDocumentInput): Promise<void>;   // dispara etapas 0..7 (hasta Ready)
  retryWithPassword(documentId: string, password: string): Promise<void>;
  cancel(documentId: string, jobId?: string): Promise<void>;
  closeDocument(documentId: string): Promise<void>;
  getState(documentId: string): PipelineState;
  dispose(): Promise<void>;
}

export async function createCore(config?: Partial<EngineConfig>): Promise<IAnonymizationCore>;
```

Notas:

- `importDocument` emite `DOCUMENT_IMPORTED` y encadena las etapas automáticas (1–7). No espera a la edición: resuelve cuando el pipeline llega a `Ready`, `Failed` o `Cancelled`.
- La UI **no** llama a los motores directamente para el flujo del pipeline: usa `orchestrator.importDocument` y los eventos del canal `ui` (`GROUP_*`, `RULE_*`, `RENDER_REQUESTED`, `EXPORT_REQUESTED`, `CANCEL_REQUESTED`, `DOCUMENT_CLOSED`).
- `config` se mergea con los defaults de `core/Contracts.md` §6.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `DOCUMENT_IMPORTED` | al iniciar `importDocument` | `DocumentImported` | async | sí |
| `PIPELINE_STAGE_CHANGED` | en cada transición de etapa | `PipelineStageChanged` | async | sí |
| `PIPELINE_PROGRESS` | progreso granular por página/etapa | `PipelineProgress` | async | sí |
| `PIPELINE_READY` | al recibir `GROUPING_FINISHED` | `PipelineReady` | async | sí |
| `PIPELINE_CANCELLED` | cancelación completada en todos los pools | `PipelineCancelled` | async | sí |
| `PIPELINE_FAILED` | error fatal no recuperable de cualquier etapa | `PipelineFailed` | async | sí |

Canal: `EventChannel.Pipeline`.

## 8. Eventos que consume

| Evento (canal) | Acción |
|---|---|
| `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID` (`pdf`) | progreso; decidir OCR vs detección; propagar password-required a UI; abortar en invalid |
| `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED` (`ocr`) | progreso; **fusión mediada**: leer `ctx.cache` e invocar `PdfEngine.fuseOcrPage` (ADR-014); al `OCR_FINISHED`, iniciar detección |
| `REGEX_FINISHED` (`regex`), `NER_PAGE_FINISHED`, `NER_FINISHED` (`ner`) | progreso; bookkeeping de fin de detección |
| `GROUPING_FINISHED` (`grouping`) | emitir `PIPELINE_READY`, stage → `Ready` |
| `PREVIEW_PAGE_FAILED`, `RENDER_FINISHED`, `RENDER_FAILED` (`render`) | reintento (1) / `PIPELINE_FAILED` según `06_Pipeline.md` §12 |
| `EXPORT_FINISHED`, `EXPORT_FAILED` (`export`) | stage → `Done` / reintento → `PIPELINE_FAILED` (`06_Pipeline.md` §13) |
| `CANCEL_REQUESTED` (`pipeline`) | abortar `AbortRegistry` + `CANCEL` a pools + `PIPELINE_CANCELLED` |
| `DOCUMENT_CLOSED` (`ui`) | `closeDocument`: liberar recursos |
| `WORKER_JOB_TIMEOUT`, `WORKER_POOL_SATURATED` (`workers`) | reintento/cancelación según config; backpressure (pausar ingest hasta que la cola baje del 50%) |

El Orchestrator **no** escucha `ENTITY_FOUND` (interno Regex/NER → Grouping) ni los eventos `ENTITY_GROUP_*` (Grouping → UI/Render).

---

## 9. Entradas

`ImportDocumentInput` (ver §6). Restricciones:

- `buffer.byteLength > 0`; si no, rechaza con `InvalidInputError` sin emitir eventos.
- `documentId` único en la sesión; repetirlo con un documento abierto rechaza con `InvalidInputError`.
- `input` `null`/`undefined` → `InvalidInputError`.

## 10. Salidas

No retorna datos de documento. Expone:

- `PipelineState` inmutable vía `getState(documentId)` (`03_Data_Model.md` §17). Lanza `InvalidInputError` si el `documentId` no existe.
- Eventos del canal `pipeline` (§7).
- Efectos: blobUrls creados/revocados en el host, jobs despachados a pools.

---

## 11. Errores posibles

El Orchestrator **no define códigos de error nuevos**: propaga `SerializedEngineError` de los motores dentro de `PIPELINE_FAILED` y usa los códigos genéricos de `core/Contracts.md` §4.

| Code | Cuándo | Recuperable | Acción |
|---|---|---|---|
| `INVALID_INPUT` | input inválido en `importDocument`/`getState` | no | bug del caller |
| `ENGINE_NOT_INITIALIZED` | uso antes de `createCore` completo | no | bug del caller |
| `ENGINE_DISPOSED` | uso tras `dispose()` | no | bug del caller |
| `CANCELLED` | etapa abortada por cancelación | – | flujo normal de cancelación |
| (propagados) | cualquier `EngineError` fatal de un motor | según `retryable` | reintento según `05_Worker_Architecture.md` §5; agotado → `PIPELINE_FAILED` |

---

## 12. Consideraciones de rendimiento

- Corre en **main thread**: solo coordina; nunca ejecuta trabajo pesado (A-9). Todo lo pesado va a pools.
- Creación perezosa de pools (`05_Worker_Architecture.md` §8); dispose tras 60 s idle.
- Prioridades de jobs por visibilidad de página (`05_Worker_Architecture.md` §6.2): el Orchestrator recibe el `visibleRange` implícitamente vía `RENDER_REQUESTED` y prioriza.
- Si `deviceMemory < 4` GB o `hardwareConcurrency < 4`: pools reducidos y OCR/NER serializados (`07_Performance_Strategy.md` §5.1).
- Regex y Grouping en main thread (< 5% del total, `06_Pipeline.md` §14); si crecen, migran a pool vía ADR.
- Los `ArrayBuffer`/`ImageData` viajan como `Transferable` (zero-copy); el Orchestrator garantiza no reutilizar buffers transferidos.
- Handlers del bus no bloqueantes (< 1 ms de trabajo propio; el resto se delega).

---

## 13. Casos límite

1. **PDF sin páginas textless**: salta la etapa OCR; `Extracting → Detecting` directo.
2. **Todas las páginas textless**: `sourceKind = "scanned"`; OCR de todas antes de detección.
3. **`PDF_PASSWORD_REQUIRED`**: stage queda en `Extracting`; la UI llama `retryWithPassword`; el pipeline reintenta desde la etapa 1.
4. **`PDF_INVALID`**: `PIPELINE_FAILED` inmediato; recursos de la importación liberados.
5. **OCR falla en una página tras reintentos**: esa página queda sin texto; la detección la salta; el pipeline continúa con warning (no `PIPELINE_FAILED`).
6. **NER desactivado en settings**: la etapa 5 se salta; `GROUPING_FINISHED` se emite al terminar solo Regex.
7. **NER falla en una página**: se descartan las ocurrencias NER de esa página; las Regex se conservan.
8. **Cancelación durante cualquier etapa**: aborto de todos los jobs del `documentId`, `PIPELINE_CANCELLED`, estado `Cancelled`, documento queda cargado en el último estado estable.
9. **Cancelación durante export**: el `PDFDocument` parcial se descarta; no se emite `EXPORT_FINISHED`.
10. **Doble `EXPORT_REQUESTED`**: el segundo se encola y corre al terminar el primero.
11. **`DOCUMENT_CLOSED` con pipeline corriendo**: equivale a cancelar + liberar todo.
12. **Segundo `importDocument` con otro documento** (MVP: un documento activo): el anterior debe cerrarse primero; si no, `InvalidInputError`.
13. **`WORKER_POOL_SATURATED`**: pausa el ingest de jobs de ese tipo hasta que la cola baje del 50%; no OOM.
14. **Worker crashea**: el pool lo reemplaza y reintenta si `retryable` (`05_Worker_Architecture.md` §9); el Orchestrator solo observa.
15. **Edición del usuario mientras NER corre**: los eventos `ui` fluyen a Grouping sin pasar por el Orchestrator; el pipeline no se ve afectado.
16. **`getState` de documento inexistente**: `InvalidInputError`.
17. **`dispose()` global**: cancela todo, dispone todos los engines y pools, dessuscribe todos los handlers.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `createCore returns wired IAnonymizationCore` | `contract.test.ts` | contract | bus, engines, orchestrator poblados |
| `importDocument emits DOCUMENT_IMPORTED then PIPELINE_STAGE_CHANGED` | `contract.test.ts` | contract | orden de eventos |
| `pipeline reaches Ready on GROUPING_FINISHED` | `contract.test.ts` | contract | secuencia feliz con engines mockeados |
| `textless pages trigger OCR stage` | `contract.test.ts` | contract | caso 2 |
| `no textless pages skip OCR stage` | `contract.test.ts` | contract | caso 1 |
| `OCR_PAGE_FINISHED triggers fuseOcrPage with cached words` | `contract.test.ts` | contract | mediación ADR-014 |
| `PdfEngine has no bus subscriptions` | `contract.test.ts` | contract | invariante matriz §11 |
| `matrix emitter→receiver holds for all subscriptions` | `contract.test.ts` | contract | valida `04_Event_System.md` §11 |
| `password retry re-runs extraction` | `edge.test.ts` | edge | caso 3 |
| `PDF_INVALID emits PIPELINE_FAILED and frees resources` | `edge.test.ts` | edge | caso 4 |
| `failed OCR page skipped with warning, pipeline continues` | `edge.test.ts` | edge | caso 5 |
| `NER disabled skips stage 5` | `edge.test.ts` | edge | caso 6 |
| `double export queues second request` | `edge.test.ts` | edge | caso 10 |
| `DOCUMENT_CLOSED during pipeline cancels and frees` | `edge.test.ts` | edge | caso 11 |
| `second importDocument while active rejects` | `edge.test.ts` | edge | caso 12 |
| `saturated pool pauses ingest until 50%` | `unit.test.ts` | unit | caso 13 |
| `retry with exponential backoff honors maxRetries` | `unit.test.ts` | unit | `05` §5 |
| `low-memory device serializes OCR and NER` | `unit.test.ts` | unit | `07` §5.1 |
| `getState returns immutable snapshot` | `unit.test.ts` | unit | §10 |
| `cancel aborts all jobs of documentId within SLA` | `cancel.test.ts` (en `tests/cancel/`) | cancel | caso 8, Hito 11 |
| `dispose cleans all subscriptions and pools` | `contract.test.ts` | contract | caso 17 |
| `blobUrls revoked on close` | `unit.test.ts` | unit | leak de object URLs |

Los tests de contract/unit/edge mockean los motores (interfaces de `Contracts.md`); la integración real con motores vive en `tests/integration/` (Hito 9) y E2E (Hito 10).

---

## 15. Checklist de implementación

- [ ] 1. Definir `types.ts` con `IAnonymizationCore`, `IPipelineOrchestrator`, `ImportDocumentInput` (y reflejarlos en `core/Contracts.md` si se comparten).
- [ ] 2. Implementar `EngineContext` real: bus, logger, cache LRU, abortSignal, config mergeada con defaults.
- [ ] 3. Implementar `WorkerPoolManager` + `AbortRegistry` según `05_Worker_Architecture.md` (pools, colas prioritarias, timeouts, reintentos, backpressure).
- [ ] 4. Implementar `orchestrator.ts`: máquina de estados de `PipelineStage` con transiciones de `06_Pipeline.md` y `02_System_Diagrams.md` §7.
- [ ] 5. Implementar `importDocument` (etapas 0–7) con invocación directa de motores y suscripciones de §8.
- [ ] 6. Implementar mediación OCR→PDF (ADR-014) y rasterización de páginas para OCR.
- [ ] 7. Implementar cancelación (abort + CANCEL a pools + `PIPELINE_CANCELLED`).
- [ ] 8. Implementar cola de export + inyección de `RenderPageProvider`.
- [ ] 9. Implementar creación/revocación de blobUrls en host.
- [ ] 10. Implementar `closeDocument`/`dispose` con liberación total.
- [ ] 11. Migrar `pdf-engine` a `PdfPool` (item diferido §15.5b de `core/PDF_Engine.md`, ADR-013) verificando misma salida inline vs pool.
- [ ] 12. Implementar `createCore` (façade) exportado desde `src/index.ts`.
- [ ] 13. Escribir `contract.test.ts`, `unit.test.ts`, `edge.test.ts` según §14; agregar el glob del paquete a `thresholds` de `vitest.config.ts`.
- [ ] 14. Test de contrato de la matriz emisor→receptor (§14).
- [ ] 15. `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 16. Verificar que solo este paquete importa motores (ESLint lo permite únicamente en `packages/anonymization-core/src/`).
- [ ] 17. Verificar `no-network-from-core`.

---

## Referencias

- `architecture/06_Pipeline.md` (etapas y transiciones)
- `architecture/05_Worker_Architecture.md` (pools, cancelación, reintentos)
- `architecture/04_Event_System.md` (tabla de eventos y matriz §11)
- `architecture/07_Performance_Strategy.md` §5, §7, §8, §11.6
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md`, `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md`, `adr/ADR-015-UI-Channel-Canonical.md`
- `ui/React_Client.md` §4 (cómo la UI consume el façade)
