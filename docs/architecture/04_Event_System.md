<!-- CONTEXT: scope=eventos | dependencias=03_Data_Model.md,core/Contracts.md | audiencia=IA+humanos | fase=1 -->

# Anonly — Sistema de Eventos (TAD bloque 7)

> Tabla exhaustiva de **todos** los eventos del sistema. Cada evento tiene: nombre (valor del enum `EngineEvents`), emisor, receptores, payload (tipo exacto), timing, idempotencia, orden y notas. Es la fuente de verdad. Si un evento no está aquí, **no existe** y no debe ser emitido ni escuchado por nadie.

**Principio**: la comunicación motor↔motor y motor↔UI es **únicamente** por eventos. Sin llamadas directas. Sin referencias cruzadas. Ver `01_Technical_Architecture_Document.md` §2 principio A-5.

---

## 1. Convenciones

- **Timing**: `sync` (el emisor espera la entrega) o `async` (fire-and-forward, el emisor no bloquea).
- **Idempotente**: `sí` significa que recibir el mismo evento dos veces no altera el estado observable. Todos los eventos de progreso son idempotentes.
- **Orden**: garantías de orden entre eventos. `por-documento` = ordenados por `documentId`. `por-página` = ordenados por `pageIndex` dentro del mismo emisor. `none` = sin garantía.
- **Channels**: el bus tipado tiene un canal por `EngineId` + un canal `ui` y un canal `pipeline`. Los receptores se suscriben a canales.

---

## 2. Eventos de pipeline (canal `pipeline`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `DOCUMENT_IMPORTED` | Orchestrator | UI | `{ documentId, name, sizeBytes }` | async | sí | none | El PDF Engine no se suscribe: el Orchestrator lo invoca directamente (`PdfEngine.process`), consistente con ADR-014. Ver `core/Orchestrator.md`. |
| `PIPELINE_STAGE_CHANGED` | Orchestrator | UI | `{ documentId, stage: PipelineStage, progress: number }` | async | sí | por-documento | Para la barra de progreso. |
| `PIPELINE_PROGRESS` | Orchestrator | UI | `{ documentId, stage, current, total }` | async | sí | por-documento | Granular por página. |
| `PIPELINE_READY` | Orchestrator | UI | `{ documentId, groupCount, conflictCount }` | async | sí | none | Cuando llega a `Ready`. |
| `PIPELINE_CANCELLED` | Orchestrator | UI, todos los engines | `{ documentId, reason }` | async | sí | none | Todo engine debe liberar recursos. |
| `PIPELINE_FAILED` | Orchestrator | UI | `{ documentId, error: EngineError }` | async | sí | none | Error fatal no recuperable. |
| `CANCEL_REQUESTED` | UI | Orchestrator | `{ documentId, jobId? }` | sync | sí | none | Inicia abort. |

---

## 3. Eventos de PDF Engine (canal `pdf`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `PAGE_PARSED` | PDF Engine | Orchestrator | `{ documentId, pageIndex, wordCount, requiresOCR }` | async | sí | por-página | Una emisión por página. |
| `DOCUMENT_PARSED` | PDF Engine | Orchestrator | `{ documentId, pageCount, textlessPages: number[], sourceKind }` | async | sí | none | Dispara OCR si `textlessPages.length > 0`. |
| `PDF_PASSWORD_REQUIRED` | PDF Engine | UI (vía Orchestrator) | `{ documentId }` | async | sí | none | UI pide password, reenvía input. |
| `PDF_INVALID` | PDF Engine | Orchestrator | `{ documentId, reason }` | async | sí | none | Aborta pipeline. |

---

## 4. Eventos de OCR Engine (canal `ocr`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `OCR_STARTED` | OCR Engine | UI | `{ documentId, pagesToProcess: number[], modelLoading? }` | async | sí | none | |
| `OCR_PAGE_FINISHED` | OCR Engine | Orchestrator | `{ documentId, pageIndex, wordCount, confidence }` | async | sí | none | Orchestrator lee `Word[]` de `ctx.cache` (clave `ocr-words:<documentId>:<pageIndex>`) y llama `PdfEngine.fuseOcrPage` (ver ADR-014). PDF Engine no se suscribe a este evento. |
| `OCR_FINISHED` | OCR Engine | Orchestrator | `{ documentId, durationMs, modelDownloaded? }` | async | sí | none | Dispara detección. |
| `OCR_PAGE_FAILED` | OCR Engine | Orchestrator | `{ documentId, pageIndex, error: EngineError }` | async | sí | none | Reintentable hasta `maxRetries`. |

---

## 5. Eventos de Regex y NER (canales `regex`, `ner`)

Ambos emiten el mismo evento `ENTITY_FOUND` pero con `source` distinto. **`ENTITY_FOUND` es interno**: solo lo escucha el Grouping Engine. La UI **nunca** se suscribe a `ENTITY_FOUND`.

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `ENTITY_FOUND` | Regex Engine, NER Engine | Grouping Engine | `{ documentId, occurrence: Occurrence }` | async | sí | por-página | `occurrence.source ∈ {regex, ner}`. |
| `REGEX_FINISHED` | Regex Engine | Orchestrator | `{ documentId, occurrenceCount, durationMs }` | async | sí | none | |
| `NER_STARTED` | NER Engine | UI | `{ documentId, pageCount, modelId }` | async | sí | none | Para indicar "cargando modelo". |
| `NER_MODEL_LOADING` | NER Engine | UI | `{ modelId, progress: number }` | async | sí | none | Progreso de descarga/carga del modelo ONNX. |
| `NER_MODEL_READY` | NER Engine | UI | `{ modelId }` | async | sí | none | |
| `NER_PAGE_FINISHED` | NER Engine | Orchestrator | `{ documentId, pageIndex, occurrenceCount }` | async | sí | por-página | |
| `NER_FINISHED` | NER Engine | Orchestrator | `{ documentId, occurrenceCount, durationMs }` | async | sí | none | |

---

## 6. Eventos de Grouping Engine (canal `grouping`)

Estos son los eventos que la UI **sí** escucha para construir el árbol de entidades.

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `ENTITY_GROUP_CREATED` | Grouping Engine | UI | `{ documentId, group: EntityGroup }` | async | no | none | Crea un nodo en el árbol. |
| `ENTITY_GROUP_UPDATED` | Grouping Engine | UI | `{ documentId, group: EntityGroup, changes: ReadonlyArray<keyof EntityGroup> }` | async | sí | none | Mutación por copia: el `group` es una nueva ref. |
| `ENTITY_GROUP_REMOVED` | Grouping Engine | UI | `{ documentId, groupId }` | async | sí | none | |
| `GROUP_REPLACEMENT_CHANGED` | Grouping Engine | UI, Render Engine | `{ documentId, groupId, mode, value }` | async | sí | none | Dispara re-render de páginas afectadas. |
| `GROUP_TOGGLED` | Grouping Engine | UI, Render Engine | `{ documentId, groupId, enabled }` | async | sí | none | |
| `CONFLICT_DETECTED` | Grouping Engine | UI | `{ documentId, conflict: Conflict }` | async | sí | none | |
| `CONFLICT_RESOLVED` | Grouping Engine | UI | `{ documentId, conflictId, mode }` | async | sí | none | |
| `GROUPING_FINISHED` | Grouping Engine | Orchestrator | `{ documentId, groupCount, conflictCount, durationMs }` | async | sí | none | Dispara `PIPELINE_READY`. |

---

## 7. Eventos de Render Engine (canal `render`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `PREVIEW_UPDATED` | Render Engine | UI | `{ documentId, pageIndex, kind: "original" \| "anonymized", canvasBlobUrl }` | async | sí | por-página | Vista previa incremental de una página. `kind` indica a qué visor (original o anonimizado) corresponde el blob (ver ADR-016). |
| `PREVIEW_PAGE_FAILED` | Render Engine | Orchestrator | `{ documentId, pageIndex, error }` | async | sí | none | |
| `RENDER_FINISHED` | Render Engine | Orchestrator, UI | `{ documentId, pageIndices, durationMs }` | async | sí | none | |
| `RENDER_FAILED` | Render Engine | Orchestrator | `{ documentId, error }` | async | sí | none | |

> `RENDER_REQUESTED` es un evento emitido por la UI y viaja por el canal `ui` (ver §10 y ADR-015).

---

## 8. Eventos de Export Engine (canal `export`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `EXPORT_STARTED` | Export Engine | UI | `{ documentId }` | async | sí | none | |
| `EXPORT_PROGRESS` | Export Engine | UI | `{ documentId, current, total }` | async | sí | por-página | |
| `EXPORT_FINISHED` | Export Engine | UI, Orchestrator | `{ documentId, blobUrl, sizeBytes, durationMs }` | async | sí | none | `blobUrl` es `URL.createObjectURL`. El Orchestrator lo escucha para transicionar `stage → Done`. |
| `EXPORT_FAILED` | Export Engine | UI, Orchestrator | `{ documentId, error: EngineError }` | async | sí | none | El Orchestrator lo escucha para emitir `PIPELINE_FAILED` tras agotar reintentos (ver `06_Pipeline.md` §13). |

> `EXPORT_REQUESTED` es un evento emitido por la UI y viaja por el canal `ui` (ver §10 y ADR-015).

---

## 9. Eventos de Workers (canal `workers`)

No son eventos funcionales; son infraestructura del pool. El Orchestrator los traduce a eventos funcionales.

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `WORKER_JOB_DISPATCHED` | WorkerPool | (logs) | `{ jobId, workerId, type }` | async | sí | none | Solo para telemetría. |
| `WORKER_JOB_COMPLETED` | Worker | WorkerPool | `{ jobId, result: Serializable }` | async | sí | none | |
| `WORKER_JOB_FAILED` | Worker | WorkerPool | `{ jobId, error }` | async | sí | none | |
| `WORKER_JOB_CANCELLED` | Worker | WorkerPool | `{ jobId, signalId }` | async | sí | none | |
| `WORKER_JOB_TIMEOUT` | WorkerPool | Orchestrator | `{ jobId, timeoutMs }` | async | sí | none | Reintento o cancelación según config. |
| `WORKER_POOL_SATURATED` | WorkerPool | Orchestrator | `{ type, queueLength }` | async | sí | none | Para backpressure. |

---

## 10. Eventos de UI (canal `ui`)

Inputs del usuario que mutan el estado de grupos/reglas/pipeline o solicitan trabajo a un motor. **Todo evento emitido por la UI viaja por el canal `ui`** (ADR-015). Siempre `sync` para que el Orchestrator pueda validar antes de confirmar.

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `RENDER_REQUESTED` | UI | Render Engine | `{ documentId, pageIndices: number[], mode: "preview" \| "full" }` | sync | sí | none | Solicitud de render de páginas visibles. |
| `EXPORT_REQUESTED` | UI | Export Engine | `{ documentId, options: ExportOptions }` | sync | sí | none | Dispara el flujo de export. |
| `GROUP_UPDATE_REQUESTED` | UI | Grouping Engine | `{ documentId, groupId, patch: Partial<Pick<EntityGroup, "replacementMode" \| "replacementValue" \| "enabled" \| "canonicalValue">> }` | sync | sí | none | Grouping valida y emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`. |
| `GROUP_MERGE_REQUESTED` | UI | Grouping Engine | `{ documentId, sourceGroupId, targetGroupId }` | sync | sí | none | Fusiona dos grupos en uno. |
| `GROUP_SPLIT_REQUESTED` | UI | Grouping Engine | `{ documentId, groupId, occurrenceIds: string[] }` | sync | sí | none | Crea un grupo nuevo con esas ocurrencias. |
| `RULE_CREATED` | UI | Grouping Engine | `{ documentId, rule: Rule }` | sync | sí | none | |
| `RULE_UPDATED` | UI | Grouping Engine | `{ documentId, ruleId, patch }` | sync | sí | none | |
| `RULE_DELETED` | UI | Grouping Engine | `{ documentId, ruleId }` | sync | sí | none | |
| `CONFLICT_RESOLVE_REQUESTED` | UI | Grouping Engine | `{ documentId, conflictId, mode: ReplacementMode }` | sync | sí | none | |
| `DOCUMENT_CLOSED` | UI | Orchestrator, todos | `{ documentId }` | sync | sí | none | Libera todo: workers, memoria, modelos. |

---

## 11. Matriz emisor → receptor (vista compacta)

| Emisor \ Receptor | Orch | UI | PDF | OCR | Regex | NER | Group | Render | Export |
|---|---|---|---|---|---|---|---|---|---|
| UI | ✓ | – | – | – | – | – | ✓ | ✓ | ✓ |
| Orchestrator | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PDF Engine | ✓ | ✓ | – | – | – | – | – | – | – |
| OCR Engine | ✓ | ✓ | – | – | – | – | – | – | – |
| Regex Engine | ✓ | – | – | – | – | – | ✓ | – | – |
| NER Engine | ✓ | ✓ | – | – | – | – | ✓ | – | – |
| Grouping Engine | ✓ | ✓ | – | – | – | – | – | ✓ | – |
| Render Engine | ✓ | ✓ | – | – | – | – | – | – | – |
| Export Engine | ✓ | ✓ | – | – | – | – | – | – | – |

**Invariante**: ningún motor escucha a otro motor excepto Grouping (que escucha `ENTITY_FOUND` de Regex y NER), y Render/Export (que escuchan cambios de grupos vía Orchestrator). La fusión OCR→PDF es mediada por el Orchestrator (PDF Engine no se suscribe a `OCR_PAGE_FINISHED`; ver ADR-014). Esta matriz se validará con un test de contrato del bus cuando los motores existan (Hito 9; ver ADR-019).

---

## 12. Tipos de payload

Todos los payloads están definidos en `core/Contracts.md` §8 como **interfaces individuales exportadas + un type map (`EventPayloadMap`)** — no como un `namespace` (un `namespace EventPayloads` con indexed access no es compatible con `verbatimModuleSyntax` cuando se importa con `import type`; ver la nota técnica de `Contracts.md` §8). Ejemplo:

```ts
export interface PageParsed { readonly documentId: string; readonly pageIndex: number; readonly wordCount: number; readonly requiresOCR: boolean; }
export interface EntityGroupCreated { readonly documentId: string; readonly group: EntityGroup; }
// ... etc, uno por evento

export type EventPayloadMap = {
  [EngineEvents.PAGE_PARSED]: PageParsed;
  [EngineEvents.ENTITY_GROUP_CREATED]: EntityGroupCreated;
  // ... uno por cada valor de EngineEvents
};
```

Reglas para los payloads:
- Todos los campos `readonly`.
- Nunca incluir `Document` completo ni `Page` completa en un payload; usar refs (`documentId`, `pageIndex`).
- `Occurrence` y `EntityGroup` sí pueden viajar completos porque son la unidad funcional.
- Cualquier `ArrayBuffer` va como `Transferable` en el `postMessage` al Worker, no como payload del bus de eventos del host.

---

## 13. API del bus (implementación `@anonly/event-system`)

La implementación concreta de `IEventBus` (`core/Contracts.md` §3.2) vive en `packages/anonymization-core/event-system/`. Reglas de la implementación, más allá del contrato de tipos (ver `adr/ADR-007-Event-Bus.md` y su nota de actualización, y `adr/ADR-019-Hito1-Hardening.md`):

- `createEventBus(options)`: factory público. `options.logger: ILogger` es **requerido** (no hay fallback a `console.*`; cumple P-4 de forma estricta). El único logger válido es el que el Orchestrator inyecta vía `EngineContext` (o, en tests, un logger de prueba).
- `dispose()` / `isDisposed()`: libera todos los handlers registrados y marca el bus como dispuesto. Tras `dispose()`:
  - `on`, `once`, `emit`, `emitAsync` **lanzan** (error de programación: usar un bus muerto es un bug real).
  - `off()` (y el `Unsubscribe` devuelto por `on()`/`once()`) es **no-op seguro**: un engine puede invocar su propio cleanup sin conocer si el bus ya fue dispuesto.
- `subscriberCount(channel, event)` / `channelCount()`: utilidades de solo lectura para tests (no forman parte de `IEventBus`, son específicas de la clase `EventBus`).
- **Semántica de `emit`**: despacho **síncrono en línea** a los handlers suscritos en el momento de la llamada. Si no hay suscriptores para `(channel, event)`, es un no-op silencioso (no es un error). Un handler que lanza se loguea vía `logger.error(...)` y no interrumpe la notificación al resto de los handlers ni al emisor.
- **Semántica de `emitAsync`**: hoy es un alias awaitable de `emit` (los handlers siguen siendo síncronos). Existe para que los callers puedan `await` desde ya, dejando la puerta abierta a handlers async futuros sin cambiar el contrato público de `IEventBus`.
- El freeze-shallow del payload prometido originalmente por ADR-007 **no está implementado y se descartó formalmente** (ADR-019): la inmutabilidad se garantiza por tipos (`readonly` en `EventPayloadMap`) y tests, no por costo de runtime en el hot path de `emit`.

---

## 14. Referencias

- `03_Data_Model.md` — tipos de los payloads.
- `core/Contracts.md` — definiciones TypeScript de `EngineEvents` y `EventPayloadMap`.
- `core/event-system/` (spec) — implementación del bus.
- `05_Worker_Architecture.md` — eventos `WORKER_*`.
- `06_Pipeline.md` — qué evento dispara cada etapa.
- `adr/ADR-007-Event-Bus.md`, `adr/ADR-019-Hito1-Hardening.md` — decisiones sobre la implementación del bus.
