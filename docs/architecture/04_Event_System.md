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
| `DOCUMENT_IMPORTED` | Orchestrator | UI, PDF Engine | `{ documentId, name, sizeBytes }` | async | sí | none | Dispara `pdf-parse`. |
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
| `OCR_STARTED` | OCR Engine | UI | `{ documentId, pagesToProcess: number[] }` | async | sí | none | |
| `OCR_PAGE_FINISHED` | OCR Engine | Orchestrator, PDF Engine | `{ documentId, pageIndex, wordCount, confidence }` | async | sí | none | PDF Engine fusiona palabras OCR en `Page.words`. |
| `OCR_FINISHED` | OCR Engine | Orchestrator | `{ documentId, durationMs }` | async | sí | none | Dispara detección. |
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
| `PREVIEW_UPDATED` | Render Engine | UI | `{ documentId, pageIndex, canvasBlobUrl }` | async | sí | por-página | Vista previa incremental de una página. |
| `PREVIEW_PAGE_FAILED` | Render Engine | Orchestrator | `{ documentId, pageIndex, error }` | async | sí | none | |
| `RENDER_REQUESTED` | UI | Render Engine | `{ documentId, pageIndices: number[], mode: "preview" \| "full" }` | sync | sí | none | |
| `RENDER_FINISHED` | Render Engine | Orchestrator, UI | `{ documentId, pageIndices, durationMs }` | async | sí | none | |
| `RENDER_FAILED` | Render Engine | Orchestrator | `{ documentId, error }` | async | sí | none | |

---

## 8. Eventos de Export Engine (canal `export`)

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
| `EXPORT_REQUESTED` | UI | Export Engine | `{ documentId, options: ExportOptions }` | sync | sí | none | |
| `EXPORT_STARTED` | Export Engine | UI | `{ documentId }` | async | sí | none | |
| `EXPORT_PROGRESS` | Export Engine | UI | `{ documentId, current, total }` | async | sí | por-página | |
| `EXPORT_FINISHED` | Export Engine | UI | `{ documentId, blobUrl, sizeBytes, durationMs }` | async | sí | none | `blobUrl` es `URL.createObjectURL`. |
| `EXPORT_FAILED` | Export Engine | UI | `{ documentId, error: EngineError }` | async | sí | none | |

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

Inputs del usuario que mutan el estado de grupos/reglas/pipeline. Siempre `sync` para que el Orchestrator pueda validar antes de confirmar.

| Evento | Emisor | Receptores | Payload | Timing | Idempotente | Orden | Notas |
|---|---|---|---|---|---|---|---|
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
| OCR Engine | ✓ | ✓ | ✓ | – | – | – | – | – | – |
| Regex Engine | ✓ | – | – | – | – | – | ✓ | – | – |
| NER Engine | ✓ | ✓ | – | – | – | – | ✓ | – | – |
| Grouping Engine | ✓ | ✓ | – | – | – | – | – | ✓ | – |
| Render Engine | ✓ | ✓ | – | – | – | – | – | – | – |
| Export Engine | – | ✓ | – | – | – | – | – | – | – |

**Invariante**: ningún motor escucha a otro motor excepto Grouping (que escucha `ENTITY_FOUND` de Regex y NER), y Render/Export (que escuchan cambios de grupos vía Orchestrator). Esta matriz se valida con un test de contrato del bus.

---

## 12. Tipos de payload

Todos los payloads están definidos como interfaces en `core/Contracts.md` bajo el namespace `EventPayloads`. Ejemplo:

```ts
export namespace EventPayloads {
  export interface PageParsed { readonly documentId: string; readonly pageIndex: number; readonly wordCount: number; readonly requiresOCR: boolean; }
  export interface EntityGroupCreated { readonly documentId: string; readonly group: EntityGroup; }
  // ... etc, uno por evento
}
```

Reglas para los payloads:
- Todos los campos `readonly`.
- Nunca incluir `Document` completo ni `Page` completa en un payload; usar refs (`documentId`, `pageIndex`).
- `Occurrence` y `EntityGroup` sí pueden viajar completos porque son la unidad funcional.
- Cualquier `ArrayBuffer` va como `Transferable` en el `postMessage` al Worker, no como payload del bus de eventos del host.

---

## 13. Referencias

- `03_Data_Model.md` — tipos de los payloads.
- `core/Contracts.md` — definiciones TypeScript de `EngineEvents` y `EventPayloads`.
- `core/event-system/` (spec) — implementación del bus.
- `05_Worker_Architecture.md` — eventos `WORKER_*`.
- `06_Pipeline.md` — qué evento dispara cada etapa.
