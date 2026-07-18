/**
 * `bus-bridge.ts` — suscribe el `IEventBus` del Core a los 6 stores de
 * Zustand (U-4: "El estado del cliente se actualiza por eventos del bus vía
 * un adapter"). Ningún componente muta un store directamente; todo pasa por
 * acá o por `actions.ts` (en sentido inverso).
 *
 * Fuente de verdad: docs/ui/React_Client.md §2.2.
 *
 * Nota sobre `document.store` (DocumentSlice, §3.1): su único setter,
 * `setPage(id, name, pageCount, sourceKind)`, requiere las 4 columnas de una
 * sola vez. Pero el Core entrega esos datos en dos eventos separados:
 * `DOCUMENT_IMPORTED` (canal `pipeline`) trae `id`/`name` al iniciar el
 * import; `DOCUMENT_PARSED` (canal `pdf`) trae `pageCount`/`sourceKind` al
 * terminar el parseo. Si se difiriera todo hasta `DOCUMENT_PARSED`,
 * `document.store.id` quedaría `null` durante toda la etapa `Extracting` —
 * exactamente cuando `PDF_PASSWORD_REQUIRED` puede requerir
 * `actions.retryWithPassword`, que depende de `document.store.id` para saber
 * qué documento reintentar (`React_Client.md` §2.3). Este bridge resuelve el
 * caso usando el `setState` propio de Zustand (presente en todo store creado
 * con `create()`, más allá de las acciones que declare `DocumentSlice`) para
 * aplicar parches parciales en dos pasos, sin tocar el contrato público de
 * `DocumentSlice` (sigue exponiendo solo `setPage`/`reset`, tal como documenta
 * `React_Client.md` §3.1).
 */

import {
  EngineEvents,
  EventChannel,
  PipelineStage,
  type IEventBus,
  type Unsubscribe,
} from "@anonly/anonymization-core";

import type { useDocumentStore } from "../store/document.store.js";
import type { useEntitiesStore } from "../store/entities.store.js";
import type { usePipelineStore } from "../store/pipeline.store.js";
import type { useRulesStore } from "../store/rules.store.js";
import type { useSettingsStore } from "../store/settings.store.js";
import type { useViewerStore } from "../store/viewer.store.js";

/** Bundle de los 6 stores de Zustand (React_Client.md §3), inyectado para poder testear sin montar la app. */
export interface Stores {
  readonly document: typeof useDocumentStore;
  readonly entities: typeof useEntitiesStore;
  readonly rules: typeof useRulesStore;
  readonly pipeline: typeof usePipelineStore;
  readonly viewer: typeof useViewerStore;
  readonly settings: typeof useSettingsStore;
}

/**
 * Suscribe `stores` a los eventos del bus documentados en React_Client.md §2.2.
 * Devuelve un `Unsubscribe` combinado (desuscribe todos los handlers).
 */
export function subscribe(bus: IEventBus, stores: Stores): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  // ─── Pipeline (canal `pipeline`) ───

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, (payload) => {
      stores.document.setState({ id: payload.documentId, name: payload.name });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, (payload) => {
      stores.pipeline.setState({ stage: payload.stage, progress: payload.progress });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, (payload) => {
      stores.pipeline.setState({ current: payload.current, total: payload.total });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, (payload) => {
      stores.pipeline.setState({
        stage: PipelineStage.Ready,
        groupCount: payload.groupCount,
        conflictCount: payload.conflictCount,
      });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, () => {
      stores.pipeline.setState({ stage: PipelineStage.Cancelled });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, (payload) => {
      stores.pipeline.setState({ stage: PipelineStage.Failed, error: payload.error });
    }),
  );

  // ─── PDF (canal `pdf`) ───
  // Solo DOCUMENT_PARSED: PDF_PASSWORD_REQUIRED lo escucha directo el
  // PasswordDialog (Components.md §2.7, ADR-034 §4), no este bridge.
  // PDF_INVALID no se re-suscribe acá: el Orchestrator lo traduce siempre a
  // PIPELINE_FAILED (Orchestrator.md §13 caso 4), ya cubierto arriba.

  unsubs.push(
    bus.on(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, (payload) => {
      stores.document.setState({ pageCount: payload.pageCount, sourceKind: payload.sourceKind });
    }),
  );

  // ─── NER (canal `ner`) ───

  unsubs.push(
    bus.on(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, (payload) => {
      stores.pipeline.setState({
        modelLoading: { modelId: payload.modelId, progress: payload.progress },
      });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Ner, EngineEvents.NER_MODEL_READY, () => {
      stores.pipeline.setState({ modelLoading: null });
    }),
  );

  // ─── Grouping (canal `grouping`) ───

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, (payload) => {
      stores.entities.getState().addGroup(payload.group);
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, (payload) => {
      stores.entities.getState().updateGroup(payload.group);
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, (payload) => {
      stores.entities.getState().removeGroup(payload.groupId);
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, (payload) => {
      stores.entities.getState().updateReplacement(payload.groupId, payload.mode, payload.value);
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.CONFLICT_DETECTED, (payload) => {
      stores.entities.getState().addConflict(payload.conflict);
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, (payload) => {
      stores.entities.getState().resolveConflict(payload.conflictId);
    }),
  );

  // ─── Render (canal `render`) ───
  // PREVIEW_PAGE_FAILED no necesita wiring propio: al no llegar nunca un
  // PREVIEW_UPDATED para esa página, `viewer.previewByPage` no tiene entrada
  // y `PageCanvas` ya dibuja el skeleton gris por defecto cuando `!blobUrl`
  // (Components.md §5.4) — exactamente el comportamiento pedido por
  // React_Client.md §8 sin mutar el store.

  unsubs.push(
    bus.on(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, (payload) => {
      stores.viewer.getState().setPreview(payload.pageIndex, payload.kind, payload.canvasBlobUrl);
    }),
  );

  // ─── Export (canal `export`) ───

  unsubs.push(
    bus.on(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, (payload) => {
      stores.pipeline.setState({
        exportProgress: { current: payload.current, total: payload.total },
      });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Export, EngineEvents.EXPORT_FINISHED, (payload) => {
      stores.pipeline.setState({
        exportResult: { blobUrl: payload.blobUrl, sizeBytes: payload.sizeBytes },
      });
    }),
  );

  unsubs.push(
    bus.on(EventChannel.Export, EngineEvents.EXPORT_FAILED, (payload) => {
      stores.pipeline.setState({ error: payload.error });
    }),
  );

  return () => {
    unsubs.forEach((unsub) => {
      unsub();
    });
  };
}

/**
 * Suscripción **directa** de la UI al canal `pdf` para `PDF_PASSWORD_REQUIRED`
 * (`ui/Components.md` §2.7, `ADR-034-Auditoria-Pre-Hito9-Orchestrator.md` §4:
 * "la UI se suscribe directamente al canal pdf", a diferencia del resto de los
 * eventos de esta suscripción-adaptador — deliberadamente **no** incluidos en
 * `subscribe()` de arriba porque no mutan ningún store (el comentario junto a
 * `DOCUMENT_PARSED` ya lo aclaraba). Vive acá, y no en el componente, porque
 * `ui/Components.md` §13 regla 6 exige que las suscripciones al bus vivan en
 * `core-adapter`, no en componentes: `PasswordDialog` llama a esta función
 * dentro de su propio `useEffect`, que solo conecta el callback del adapter al
 * estado local del diálogo (abrir/cerrar), sin tocar el bus directamente.
 *
 * No hay evento equivalente para "contraseña incorrecta": el mismo
 * `PDF_PASSWORD_REQUIRED` se re-emite para el mismo `documentId` cuando el
 * reintento de `retryWithPassword` vuelve a fallar (`core/Orchestrator.md` §13
 * caso 3) — el handler recibe la misma notificación las veces que haga falta.
 */
export function subscribePasswordRequired(
  bus: IEventBus,
  handler: (documentId: string) => void,
): Unsubscribe {
  return bus.on(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, (payload) => {
    handler(payload.documentId);
  });
}
