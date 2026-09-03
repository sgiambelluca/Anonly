/**
 * Corre los invariantes sobre el dataset de referencia.
 *
 * Reusa el arranque de `tests/quality/run-document.ts` (mismo `createCore`,
 * NER apagado por ADR-095 §5) y le suma las **páginas**, que los eventos del
 * bus no llevan: `PAGE_PARSED` trae `wordCount` pero no las `Word`. Se
 * obtienen corriendo `PdfEngine` por separado sobre el mismo buffer — el
 * parseo es determinístico, así que son las mismas páginas.
 */
import { createCore } from "@anonly/anonymization-core";
import { PdfEngine } from "@anonly/pdf-engine";
import {
  EngineEvents,
  EventChannel,
  type EntityFound,
  type EntityGroup,
  type EntityGroupCreated,
  type EntityGroupUpdated,
  type Occurrence,
  type Page,
} from "@anonly/shared";

import type { PipelineSnapshot } from "./checks.js";
import { createEngineContext } from "./context.js";

const NER_DISABLED = {
  modelId: "unused-ner-disabled",
  quantization: "q8" as const,
  confidenceThreshold: 0.7,
  batchSize: 8,
  enabled: false,
};

async function parsePages(buffer: ArrayBuffer, documentId: string): Promise<ReadonlyArray<Page>> {
  const engine = new PdfEngine();
  const ctx = createEngineContext();
  try {
    await engine.init(ctx);
    const output = await engine.process({ documentId, buffer }, ctx);
    return output.document.pages;
  } finally {
    await engine.dispose().catch(() => {});
  }
}

export async function snapshotOf(
  buffer: ArrayBuffer,
  documentId: string,
): Promise<PipelineSnapshot> {
  const core = await createCore({ ner: NER_DISABLED });
  try {
    const occurrencesById = new Map<string, Occurrence>();
    const groupsById = new Map<string, EntityGroup>();

    const collectOccurrence = (payload: EntityFound): void => {
      occurrencesById.set(payload.occurrence.id, payload.occurrence);
    };
    core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, collectOccurrence);
    core.bus.on(EventChannel.Ner, EngineEvents.ENTITY_FOUND, collectOccurrence);
    core.bus.on(
      EventChannel.Grouping,
      EngineEvents.ENTITY_GROUP_CREATED,
      (payload: EntityGroupCreated) => groupsById.set(payload.group.id, payload.group),
    );
    core.bus.on(
      EventChannel.Grouping,
      EngineEvents.ENTITY_GROUP_UPDATED,
      (payload: EntityGroupUpdated) => groupsById.set(payload.group.id, payload.group),
    );

    // La copia es a propósito: `importDocument` consume el buffer.
    const pages = await parsePages(buffer.slice(0), documentId);
    await core.orchestrator.importDocument({
      documentId,
      name: `${documentId}.pdf`,
      buffer: buffer.slice(0),
    });

    return {
      pages,
      occurrences: [...occurrencesById.values()],
      groups: [...groupsById.values()],
    };
  } finally {
    await core.dispose();
  }
}
