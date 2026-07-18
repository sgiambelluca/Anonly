/**
 * `actions.ts` — traduce acciones de UI a eventos del canal `ui` o a llamadas
 * directas de `orchestrator` (U-5). Ningún componente emite al bus ni llama al
 * Core directamente; siempre pasa por acá.
 *
 * Fuente de verdad: docs/ui/React_Client.md §2.3 (+ acciones agregadas por
 * ADR-036 §5 y ADR-037/ADR-038: `updateRule`, `deleteRule`, `requestRender`
 * con `scale?`, `reanalyze`, `retryWithPassword`).
 */

import {
  EngineEvents,
  EventChannel,
  type EntityGroup,
  type ExportOptions,
  type ReanalyzeConfigPatch,
  type ReplacementMode,
  type Rule,
} from "@anonly/anonymization-core";

import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useViewerStore } from "../store/viewer.store.js";

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
    patch: Partial<
      Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">
    >,
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

  createRule(rule: Rule): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_CREATED, { documentId, rule });
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
  },

  deleteRule(ruleId: string): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_DELETED, { documentId, ruleId });
  },

  // Sin parámetro `kind`: el payload RenderRequested no lo tiene; Render decide
  // solo (original primero, anonimizado después — 06_Pipeline.md §10).
  // `scale?` (ADR-037 §1/§5): ausente → previewScale/fullScale según mode;
  // ZoomControls la pasa como previewScale × zoom tras el debounce de 150 ms.
  requestRender(
    pageIndices: ReadonlyArray<number>,
    mode: "preview" | "full" = "preview",
    scale?: number,
  ): void {
    const documentId = activeDocumentId();
    if (documentId === null) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId,
      pageIndices,
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
