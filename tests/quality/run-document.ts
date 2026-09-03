/**
 * Corre el pipeline real (`createCore()` + `importDocument`) sobre UN
 * documento del dataset de referencia, con NER desactivado
 * (`ner.enabled: false` — ADR-095 §5: el kernel de NER resuelve el modelo
 * contra `env.localModelPath = "/models/ner/"`, una ruta de servidor que en
 * Node no existe, así que la suite no puede correr inferencia real; medirla
 * mockeada no mide nada).
 *
 * Mismo arranque que `tests/integration/qa-stamp-detection.test.ts`:
 * `pdfjs-dist` SIN mockear — el PDF se lee del disco de verdad — y el
 * `OffscreenCanvas` stub de `tests/integration/fixtures/mocks.ts`, porque
 * `render-engine` genera thumbnails con canvas incluso para un PDF sin
 * imágenes. `@huggingface/transformers` se mockea desde el archivo de test
 * que importa este módulo (`vi.mock` hoistea por archivo, no puede vivir
 * acá) — con NER apagado el kernel nunca lo invoca, pero el criterio es el
 * mismo que el resto de la suite de integración (cabecera de
 * `ocr-pdf-fusion.test.ts`: "se mockea igual por higiene de import").
 */
import { createCore } from "@anonly/anonymization-core";
import {
  EngineEvents,
  EventChannel,
  type EntityFound,
  type EntityGroup,
  type EntityGroupCreated,
  type EntityGroupUpdated,
  type Occurrence,
} from "@anonly/shared";

import { classifyGroups, type GroupClassification } from "./classify-groups.js";

/**
 * `NerConfig` completo aunque `enabled: false` lo apague: es un objeto, no
 * `Partial`, y `createCore`/`mergeEngineConfig` mergean por sub-objeto
 * (Contracts.md §3.5, ADR-039) — los otros campos nunca se leen porque
 * `ner-engine` corta antes de tocar el kernel (`ner.engine.ts`, "Caso 11").
 */
const NER_DISABLED_CONFIG = {
  modelId: "unused-ner-disabled",
  quantization: "q8" as const,
  confidenceThreshold: 0.7,
  batchSize: 8,
  enabled: false,
};

export async function runDocument(
  buffer: ArrayBuffer,
  documentId: string,
): Promise<GroupClassification> {
  const core = await createCore({ ner: NER_DISABLED_CONFIG });

  try {
    const occurrencesById = new Map<string, Occurrence>();
    const groupsById = new Map<string, EntityGroup>();

    const collectOccurrence = (payload: EntityFound): void => {
      occurrencesById.set(payload.occurrence.id, payload.occurrence);
    };
    core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, collectOccurrence);
    core.bus.on(EventChannel.Ner, EngineEvents.ENTITY_FOUND, collectOccurrence);

    // Por id y con el ÚLTIMO estado: un grupo gana `enabled`/`needsReview`
    // por ENTITY_GROUP_UPDATED (p. ej. al promoverse, ADR-094 §3), así que
    // quedarse con el payload de creación contaría de menos.
    core.bus.on(
      EventChannel.Grouping,
      EngineEvents.ENTITY_GROUP_CREATED,
      (payload: EntityGroupCreated) => {
        groupsById.set(payload.group.id, payload.group);
      },
    );
    core.bus.on(
      EventChannel.Grouping,
      EngineEvents.ENTITY_GROUP_UPDATED,
      (payload: EntityGroupUpdated) => {
        groupsById.set(payload.group.id, payload.group);
      },
    );

    await core.orchestrator.importDocument({ documentId, name: `${documentId}.pdf`, buffer });

    return classifyGroups([...groupsById.values()], occurrencesById);
  } finally {
    await core.dispose();
  }
}
