<!-- CONTEXT: scope=orchestrator | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-015-UI-Channel-Canonical.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md | audiencia=IA-implementador | fase=3 (Hito 9) -->

# Orchestrator — Spec del Componente Host

> Secuencia las etapas del pipeline, invoca los motores, gestiona los pools de workers y la cancelación, y expone el façade público del Core (`createCore` / `IAnonymizationCore`). Es la **composition root**: el único código del Core autorizado a importar motores.

**Componente**: Orchestrator + façade `@anonly/anonymization-core` (no es un motor: **no tiene `EngineId`** y no implementa `IEngine`; este spec adapta la plantilla de 15 secciones de `ai/Module_Specification_Template.md` a un componente host)
**Ubicación**: `packages/anonymization-core/src/`
**Versión del spec**: 1.1.0
**Última actualización**: 2026-07-16
**Estado de implementación**: pendiente (Hito 9). El façade actual (`src/index.ts`) es un placeholder.

> **Nota (ADR-034, 2026-07-16)**: este spec incorpora los cierres de Hitos 7–8 que le fueron diferidos y las decisiones de la auditoría pre-Hito 9: rasterización para OCR vía `RenderEngine.rasterizePage` (§2, §8); gestión de la sesión de Grouping (`startSession`/`finishSession`, incluido el caso NER desactivado — §2, §13.6); `RenderPageProvider` implementado sobre `RenderPageOutput.encoded` (§2); blob URLs creados por los motores y **revocados** por el Orchestrator (§2, §8); consumo de `EXPORT_REQUESTED` y `PREVIEW_UPDATED` (§8, ADR-032/031); `RenderEngine.loadDocument`/`unloadDocument` y retención del buffer original (§2, ADR-030); migración a los **cuatro** pools (§15.11, ADR-021).

---

## 1. Objetivo

Coordinar el ciclo de vida completo de un documento (etapas 0–11 de `06_Pipeline.md`) sin que ningún motor conozca a otro: el Orchestrator escucha los eventos de fin de etapa, decide la etapa siguiente, invoca al motor correspondiente y mantiene el `PipelineState` observable por la UI.

---

## 2. Responsabilidades

- Exponer `createCore(config)` que instancia bus, engines, pools y orchestrator, y devuelve `IAnonymizationCore`.
- Secuenciar las etapas del pipeline según `06_Pipeline.md`: extracción → OCR (si `textlessPages.length > 0`) → normalización → Regex → NER → agrupación → conflictos → preview → edición → render → export.
- Emitir los eventos del canal `pipeline`: `DOCUMENT_IMPORTED`, `PIPELINE_STAGE_CHANGED`, `PIPELINE_PROGRESS`, `PIPELINE_READY`, `PIPELINE_CANCELLED`, `PIPELINE_FAILED`.
- Invocar directamente los motores de entrada/salida pura (`PdfEngine.process`, `OcrEngine.processPages`, `RegexEngine.process`, `NerEngine.processPages`) — estos motores no se suscriben al bus (ADR-014).
- Mediar la fusión OCR→PDF: escuchar `OCR_PAGE_FINISHED`, leer las `Word[]` de `ctx.cache` (clave `ocr-words:<documentId>:<pageIndex>`) e invocar `PdfEngine.fuseOcrPage` (ADR-014). En modo pool, las `Word[]` las deposita en `ctx.cache` el lado host del `OcrPool` (ADR-014 §1).
- Retener el `ArrayBuffer` original de la etapa 0 (lo transferido a `PdfPool` es una copia, `06_Pipeline.md` §3) e invocar `RenderEngine.loadDocument(documentId, buffer)` **una sola vez por documento**: en la etapa 2 si `textlessPages.length > 0`, si no antes del primer preview (etapa 8) (ADR-030, ADR-034 §1).
- Obtener el `ImageData` de páginas sin texto para el OCR Engine vía `RenderEngine.rasterizePage(documentId, pageIndex, scale, ctx)` con `scale = ctx.config.ocr.dpi / 72` (ADR-034 §1; el Orchestrator **no** rasteriza por sí mismo — no puede importar pdfjs, §5).
- Gestionar la sesión de Grouping: invocar `grouping.startSession(documentId)` al iniciar la etapa de detección (antes de despachar Regex/NER); si `ctx.config.ner.enabled === false`, invocar `grouping.finishSession(documentId)` tras `REGEX_FINISHED` (ADR-034 §2). Con NER activo, Grouping auto-finaliza al recibir ambos `*_FINISHED`.
- Ejecutar la etapa de normalización (`shared`) en main thread.
- Gestionar `WorkerPoolManager` y `AbortRegistry` (`05_Worker_Architecture.md`): creación perezosa de pools, timeouts, reintentos con backoff, backpressure (pausar ingest ante `WORKER_POOL_SATURATED`), traducción de eventos `WORKER_*` a eventos funcionales.
- Gestionar la cancelación: escuchar `CANCEL_REQUESTED`, abortar el `AbortController` del `signalId`, propagar `CANCEL` a los pools, emitir `PIPELINE_CANCELLED` (SLA < 200 ms, `05_Worker_Architecture.md` §3).
- Escuchar `EXPORT_REQUESTED` (canal `ui`): armar `ExportEngineInput` (documento, grupos/reglas desde `grouping.getSnapshot`, `options`) e invocar `ExportEngine.export()` directamente — Export no se suscribe a eventos (ADR-032 §2, patrón ADR-014).
- Implementar el `RenderPageProvider` (preconfigurado con las `ExportOptions` del request) sobre `RenderEngine.renderPage({ kind: "anonymized", mode: "full", ... })`, devolviendo `output.encoded` (`EncodedPageImage`; ADR-034 §3), e inyectarlo al Export Engine (`core/Export_Engine.md` §6).
- Gestionar el ciclo de vida de los blob URLs: los **crean** los motores en su lado host (`PREVIEW_UPDATED.canvasBlobUrl`, `EXPORT_FINISHED.blobUrl`); el Orchestrator los registra por clave (`documentId`, `pageIndex`, `kind` — export: por `documentId`), **revoca el anterior** de la clave al recibir un reemplazo, y revoca todos en `DOCUMENT_CLOSED` (ADR-034 §5, ADR-031 §5, `07_Performance_Strategy.md` §8).
- Serializar OCR y NER (no paralelos) cuando `deviceMemory < 4` GB (`07_Performance_Strategy.md` §5.1, §7.1).
- Encolar exports: un segundo `EXPORT_REQUESTED` durante un export en curso se encola, no se superpone (`07_Performance_Strategy.md` §11.6).
- Liberar todos los recursos ante `DOCUMENT_CLOSED`: invocar `PdfEngine.releaseDocument(documentId)` (ADR-020 §7) y `RenderEngine.unloadDocument(documentId)` (ADR-030; patrón general para motores con estado por documento, ADR-021 §7), soltar el buffer retenido, limpiar caches y revocar blobUrls; Grouping limpia su sesión por suscripción propia. Los pools se disponen tras 60 s idle.
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
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib` (las libs externas pertenecen a los motores, nunca al Orchestrator)
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
| `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID` (`pdf`) | progreso; decidir OCR vs detección; en password-required, dejar el stage en `Extracting` a la espera de `retryWithPassword` (la UI se suscribe al canal `pdf` directamente, ADR-034 §4); abortar en invalid |
| `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED` (`ocr`) | progreso; **fusión mediada**: leer `ctx.cache` e invocar `PdfEngine.fuseOcrPage` (ADR-014); al `OCR_FINISHED`, iniciar detección |
| `REGEX_FINISHED` (`regex`), `NER_PAGE_FINISHED`, `NER_FINISHED` (`ner`) | progreso; bookkeeping de fin de detección; si `ner.enabled === false`, tras `REGEX_FINISHED` invocar `grouping.finishSession(documentId)` (ADR-034 §2) |
| `GROUPING_FINISHED` (`grouping`) | emitir `PIPELINE_READY`, stage → `Ready` |
| `PREVIEW_UPDATED` (`render`) | registrar `canvasBlobUrl` por clave `(documentId, pageIndex, kind)` y revocar el URL anterior de esa clave (ADR-034 §5) |
| `PREVIEW_PAGE_FAILED`, `RENDER_FINISHED`, `RENDER_FAILED` (`render`) | según `06_Pipeline.md` §10/§12: preview fallido → placeholder en UI; `RENDER_FAILED` agotado el reintento → `EXPORT_FAILED` (la cadena a `PIPELINE_FAILED` pasa por `06` §13) |
| `EXPORT_REQUESTED` (`ui`) | armar `ExportEngineInput` + `RenderPageProvider` preconfigurado con las `options` e invocar `ExportEngine.export()` directamente; si hay un export en curso, encolar (ADR-032 §2) |
| `EXPORT_FINISHED`, `EXPORT_FAILED` (`export`) | stage → `Done`, registrar/revocar `blobUrl` por `documentId` / reintento agotado → `PIPELINE_FAILED` (`06_Pipeline.md` §13) |
| `CANCEL_REQUESTED` (`pipeline`) | abortar `AbortRegistry` + `CANCEL` a pools + `PIPELINE_CANCELLED` |
| `DOCUMENT_CLOSED` (`ui`) | `closeDocument`: `PdfEngine.releaseDocument(documentId)` + `RenderEngine.unloadDocument(documentId)` + soltar buffer retenido, liberar caches y revocar todos los blobUrls (ADR-021 §7, ADR-030, ADR-034 §5); Grouping se limpia solo (suscripción propia) |
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
- Prioridades de jobs por visibilidad de página (`05_Worker_Architecture.md` §6.2): la priorización por visibilidad la aplica **Render** al despachar a su pool (recibe `RENDER_REQUESTED` con los `pageIndices` visibles); el Orchestrator no se suscribe a `RENDER_REQUESTED` (errata corregida, ADR-034 §7).
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
6. **NER desactivado en settings**: la etapa 5 se salta; tras `REGEX_FINISHED` el Orchestrator invoca `grouping.finishSession(documentId)` y Grouping emite `GROUPING_FINISHED` con solo lo de Regex (ADR-034 §2).
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
| `NER disabled skips stage 5 and finishes grouping after REGEX_FINISHED` | `edge.test.ts` | edge | caso 6 (ADR-034 §2) |
| `startSession invoked before dispatching detection` | `contract.test.ts` | contract | ADR-034 §2 |
| `textless pages rasterized via RenderEngine before OCR dispatch` | `contract.test.ts` | contract | ADR-034 §1 |
| `EXPORT_REQUESTED builds provider and calls export directly` | `contract.test.ts` | contract | ADR-032 §2 |
| `PREVIEW_UPDATED replaces and revokes previous blob URL for same key` | `unit.test.ts` | unit | ADR-034 §5 |
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

Los tests de contract/unit/edge mockean los motores (interfaces de `Contracts.md`); la integración real con motores vive en `tests/integration/` (Hito 9) y E2E (Hito 10). Pares críticos mínimos de `tests/integration/` (ADR-034 §6): Regex+NER → Grouping vía `ENTITY_FOUND`; `OCR_PAGE_FINISHED` → Orchestrator → `PdfEngine.fuseOcrPage` (ADR-014); happy path `createCore` → `PIPELINE_READY` con motores reales y fronteras de libs mockeadas (ADR-021 §5). Corre bajo `pnpm test` y con `pnpm test:integration` (filtro posicional, ADR-033); al crearla, quitar `integration/**` del `exclude` de `tests/tsconfig.json` y agregar alias/`paths` por motor a demanda.

---

## 15. Checklist de implementación

- [ ] 1. Definir `types.ts` con `IAnonymizationCore`, `IPipelineOrchestrator`, `ImportDocumentInput`, reflejados en `core/Contracts.md` §3.5 (ADR-034 §7: sí se comparten — la UI los importa).
- [ ] 2. Implementar `EngineContext` real: bus, logger, cache LRU, abortSignal, config mergeada con defaults.
- [ ] 3. Implementar `WorkerPoolManager` + `AbortRegistry` según `05_Worker_Architecture.md` (pools, colas prioritarias, timeouts, reintentos, backpressure).
- [ ] 4. Implementar `orchestrator.ts`: máquina de estados de `PipelineStage` con transiciones de `06_Pipeline.md` y `02_System_Diagrams.md` §7.
- [ ] 5. Implementar `importDocument` (etapas 0–7) con invocación directa de motores, suscripciones de §8, retención del buffer original y gestión de sesión de Grouping (`startSession` al iniciar detección; `finishSession` tras `REGEX_FINISHED` si NER off — ADR-034 §2).
- [ ] 6. Implementar mediación OCR→PDF (ADR-014) y rasterización de páginas para OCR vía `RenderEngine.loadDocument` (adelantado a etapa 2) + `rasterizePage` (ADR-034 §1).
- [ ] 7. Implementar cancelación (abort + CANCEL a pools + `PIPELINE_CANCELLED`).
- [ ] 8. Implementar cola de export + `RenderPageProvider` sobre `renderPage(mode: "full")` → `output.encoded` (ADR-034 §3), inyectado al Export Engine.
- [ ] 9. Implementar registro y revocación de blobUrls (por clave en `PREVIEW_UPDATED`/`EXPORT_FINISHED`; todos en `DOCUMENT_CLOSED` — ADR-034 §5).
- [ ] 10. Implementar `closeDocument`/`dispose` con liberación total (`releaseDocument`, `unloadDocument`, buffer retenido, caches, blobUrls).
- [ ] 11. Migrar los motores pesados a sus **cuatro** pools: `PdfPool` (item §15.5b de `core/PDF_Engine.md`, ADR-013, verificando misma salida inline vs pool), `OcrPool`, `NerPool` y `RenderPool` (ítems de pool de cada spec de motor, ADR-021; eventos siempre emitidos en host — ADR-013 §6; `ocr-words` al cache lo deposita el lado host del `OcrPool` — ADR-014 §1). En Hito 9 los pools son colas de concurrencia **in-process** (ADR-035 §1); el despacho por `postMessage` a Web Workers reales → Hito 10 (ADR-035 §2).
- [ ] 12. Implementar `createCore` (façade) exportado desde `src/index.ts`.
- [ ] 13. Escribir `contract.test.ts`, `unit.test.ts`, `edge.test.ts` según §14; agregar el glob del paquete a `thresholds` de `vitest.config.ts`.
- [ ] 14. Test de contrato de la matriz emisor→receptor (§14; la matriz canónica es la de `04_Event_System.md` §11 corregida por ADR-034 §4 — "receptor" = suscripción real).
- [ ] 15. Crear `tests/integration/` con los pares críticos mínimos (ADR-034 §6): quitar `integration/**` del `exclude` de `tests/tsconfig.json`, alias/`paths` por motor a demanda (ADR-033), script `test:integration` con filtro posicional.
- [ ] 16. `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 17. Verificar que solo este paquete importa motores (ESLint lo permite únicamente en `packages/anonymization-core/src/`).
- [ ] 18. Verificar `no-network-from-core`.

---

## Referencias

- `architecture/06_Pipeline.md` (etapas y transiciones)
- `architecture/05_Worker_Architecture.md` (pools, cancelación, reintentos)
- `architecture/04_Event_System.md` (tabla de eventos y matriz §11)
- `architecture/07_Performance_Strategy.md` §5, §7, §8, §11.6
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md`, `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md`, `adr/ADR-015-UI-Channel-Canonical.md`
- `adr/ADR-030-RenderEngine-LoadDocument.md` (carga del PDF fuente en Render), `adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md` §5 (blob real), `adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md` (provider/export), `adr/ADR-033-Test-Infra-Global-Scripts-Alias.md` (scripts/alias), `adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md` (decisiones de este spec v1.1.0)
- `ui/React_Client.md` §4 (cómo la UI consume el façade)
