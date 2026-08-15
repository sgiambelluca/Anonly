/**
 * `actions.ts` — traduce acciones de UI a eventos del canal `ui` o a llamadas
 * directas de `orchestrator` (U-5). Ningún componente emite al bus ni llama al
 * Core directamente; siempre pasa por acá.
 *
 * Fuente de verdad: docs/ui/React_Client.md §2.3 (+ acciones agregadas por
 * ADR-036 §5 y ADR-037/ADR-038: `updateRule`, `deleteRule`, `requestRender`
 * con `scale?`, `reanalyze`, `retryWithPassword`).
 *
 * Hito 10 PR9 (panel de Reglas): `createRule`/`updateRule`/`deleteRule` ahora
 * también sincronizan `rules.store` (además de emitir el evento) — ver el
 * comentario adyacente a `createRule` más abajo para la justificación
 * completa (no hay evento Core→UI para reglas).
 */

import {
  EngineEvents,
  EventChannel,
  type EntityGroup,
  type ExportOptions,
  type ManualEntityRequest,
  type ManualEntityResult,
  type PersonGenderChoice,
  type ReanalyzeConfigPatch,
  type ReplacementMode,
  type Rule,
  type TextMatch,
  type Word,
} from "@anonly/anonymization-core";

import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useViewerStore, type ViewerKind } from "../store/viewer.store.js";

import { getCore } from "./index.js";

/** `null` si no hay documento activo; las acciones que lo requieren no-opean en ese caso. */
function activeDocumentId(): string | null {
  return useDocumentStore.getState().id;
}

export const actions = {
  async importDocument(file: File): Promise<void> {
    const documentId = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    // DOCUMENT_IMPORTED lo emite el Orchestrator; la UI nunca invoca motores
    // directamente para el flujo del pipeline (core/Orchestrator.md §6).
    await getCore().orchestrator.importDocument({ documentId, name: file.name, buffer });
  },

  updateGroup(
    groupId: string,
    // `personGender` no sale del `Pick` de `EntityGroup`: su tercer estado
    // ("neutral") no existe como valor almacenado, borra el campo en vez de
    // reflejarlo (ADR-069 §4, `Contracts.md` §8 `GroupUpdateRequested.patch`).
    patch: Partial<
      Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">
    > & { readonly personGender?: PersonGenderChoice },
  ): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId,
      groupId,
      patch,
    });
  },

  mergeGroups(sourceGroupId: string, targetGroupId: string): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, {
      documentId,
      sourceGroupId,
      targetGroupId,
    });
  },

  splitGroup(groupId: string, occurrenceIds: ReadonlyArray<string>): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, {
      documentId,
      groupId,
      occurrenceIds,
    });
  },

  // `rules.store` no tiene ningún evento Core→UI que lo alimente (a
  // diferencia de `entities.store`, poblado vía `ENTITY_GROUP_*`):
  // RULE_CREATED/RULE_UPDATED/RULE_DELETED son estrictamente UI→Grouping
  // Engine (`04_Event_System.md`: "UI | Grouping Engine | ... | none" — sin
  // evento de vuelta) y el payload ya lleva el `Rule`/patch completo que la UI
  // construyó; el Core solo recomputa `replacementMode` de los grupos
  // afectados (`ENTITY_GROUP_UPDATED`, ya cubierto por `bus-bridge.ts`). Por
  // eso estas tres acciones son la única fuente de verdad para `rules.store`
  // (`ui/Components.md` §13 regla 2: los componentes nunca mutan el store
  // directamente, siempre vía una acción) — agregado en el Hito 10 PR9
  // (panel de Reglas), mismo criterio que `subscribePasswordRequired` en
  // `bus-bridge.ts` (agregada por un PR de UI anterior por la misma razón:
  // plomería de `core-adapter` que un componente necesita).

  createRule(rule: Rule): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_CREATED, { documentId, rule });
    useRulesStore.getState().addRule(rule);
  },

  resolveConflict(conflictId: string, mode: ReplacementMode): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
      documentId,
      conflictId,
      mode,
    });
  },

  // Acciones agregadas por ADR-036 §5 (Components.md ya las invocaba):

  updateRule(ruleId: string, patch: Partial<Rule>): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_UPDATED, { documentId, ruleId, patch });
    useRulesStore.getState().updateRule(ruleId, patch);
  },

  deleteRule(ruleId: string): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_DELETED, { documentId, ruleId });
    useRulesStore.getState().removeRule(ruleId);
  },

  // `kind` REQUERIDO (ADR-056 §1): identifica el panel que pide, y el motor
  // renderiza solo ese lado. Lo pasa siempre el panel emisor — NUNCA se deriva
  // de `settings.scrollSyncEnabled` (ADR-056 §2: sería una segunda fuente de
  // verdad sobre quién necesita píxeles, capaz de desincronizarse del scroll
  // real).
  // `scale?` (ADR-037 §1/§5): ausente → previewScale/fullScale según mode;
  // ZoomControls la pasa como previewScale × zoom tras el debounce de 150 ms.
  requestRender(
    pageIndices: ReadonlyArray<number>,
    kind: ViewerKind,
    mode: "preview" | "full" = "preview",
    scale?: number,
  ): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId,
      pageIndices,
      kind,
      mode,
      ...(scale !== undefined ? { scale } : {}),
    });
  },

  // Re-análisis parcial preservando ediciones (ADR-038 §1, §7). Reemplaza el
  // flujo "recrear el core" superseded de ADR-036 §5: con documento abierto,
  // el SettingsDialog confirma y llama esta acción en vez de
  // closeDocument+dispose+createCore+reimport.
  async reanalyze(patch: ReanalyzeConfigPatch): Promise<void> {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    await getCore().orchestrator.reanalyze(documentId, patch);
  },

  // ADR-061 §6: agrega a mano una entidad que el detector no encontró. Las
  // tres vías de entrada (diálogo, hit-test sobre el original, buscador)
  // convergen acá. `null` es solo "no hay documento activo" — un estado en
  // el que el llamador no puede estar abierto — y nunca "no se encontró"
  // (ADR-061 §6 errata, Components.md §3.4c): el caller no debe colapsar los
  // dos casos.
  async addManualEntity(request: ManualEntityRequest): Promise<ManualEntityResult | null> {
    const documentId = activeDocumentId();
    if (documentId === null) return null;
    return getCore().orchestrator.addManualEntity(documentId, request);
  },

  // ADR-061 §4: habilitan el hit-test de selección sobre el canvas del
  // `original` (WordSelectionOverlay) — sincrónicas, igual que el
  // orchestrator. Sin documento activo, `getPageWords` no tiene nada que
  // señalar (`[]`) y `getPageSize` no tiene con qué escalar (`null`).
  getPageWords(pageIndex: number): ReadonlyArray<Word> {
    const documentId = activeDocumentId();
    if (documentId === null) return [];
    return getCore().orchestrator.getPageWords(documentId, pageIndex);
  },

  getPageSize(pageIndex: number): { readonly width: number; readonly height: number } | null {
    const documentId = activeDocumentId();
    if (documentId === null) return null;
    return getCore().orchestrator.getPageSize(documentId, pageIndex);
  },

  // ADR-061 §8: misma búsqueda literal, de solo lectura, para el buscador
  // del visor (DocumentSearchBox). Sincrónica igual que el orchestrator.
  findText(query: string): ReadonlyArray<TextMatch> {
    const documentId = activeDocumentId();
    if (documentId === null) return [];
    return getCore().orchestrator.findText(documentId, query);
  },

  // PDF_PASSWORD_REQUIRED → PasswordDialog → esta acción. La UI NUNCA llama a
  // engines.pdf.process (Orchestrator.md §6; errata corregida, ADR-036 §5).
  async retryWithPassword(password: string): Promise<void> {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    await getCore().orchestrator.retryWithPassword(documentId, password);
  },

  requestExport(options: ExportOptions): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId, options });
  },

  // CANCEL_REQUESTED viaja por el canal `pipeline` (excepción documentada de
  // ADR-015: el canal se determina por el emisor, salvo este caso histórico).
  cancel(): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, { documentId });
  },

  closeDocument(): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, { documentId });
    useDocumentStore.getState().reset();
    useEntitiesStore.getState().reset();
    useRulesStore.getState().reset();
    useViewerStore.getState().reset();
    usePipelineStore.getState().reset();
  },
};
