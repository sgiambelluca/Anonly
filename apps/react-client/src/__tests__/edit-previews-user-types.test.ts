/**
 * Las vistas previas y los textos de edición con tipos propios (F7, tanda 3):
 * ya no hay una guarda provisional que rompa con un tipo propio
 * (`baseEntityType.ts` se retiró), y «Cambiar tipo» avisa que una entidad en «Dato
 * falso» pasa a «Etiquetar» (ADR-229 §3).
 */

import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EditPreviewGroup,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { candidateTypes } from "../components/conflicts/conflictResolution.js";
import {
  BECOMES_LABEL_NOTE,
  describeEntityLine,
  mergeToastText,
  splitToastText,
  summarizeSplit,
  summarizeTypeChange,
  typeChangeToastText,
  typePreviewRequest,
} from "../components/entities/editPreviews.js";
import {
  describeManualAdd,
  resolveAddedGroup,
} from "../components/entities/manualEntityFeedback.js";

import { userType } from "./helpers/detectionFixtures.js";
import { groupsMap, makeConflict, makeGroup } from "./helpers/groupFixtures.js";

const afiliado = userType(0, "Número de afiliado");

function previewGroup(overrides: Partial<EditPreviewGroup> = {}): EditPreviewGroup {
  return {
    groupId: "g1",
    type: afiliado.id,
    indexInType: 1,
    canonicalValue: "20-1234",
    memberCount: 2,
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[NUMERO DE AFILIADO 01]",
    ...overrides,
  };
}

describe("cambiar a un tipo propio", () => {
  it("pide la vista previa con el id del tipo propio", () => {
    expect(typePreviewRequest(makeGroup({ id: "g1" }), afiliado.id)).toEqual({
      kind: "type",
      groupId: "g1",
      type: afiliado.id,
    });
    expect(typePreviewRequest(makeGroup({ type: afiliado.id }), afiliado.id)).toBeNull();
  });

  it("una entidad en «Dato falso» que pasa a un tipo propio avisa que pasa a «Etiquetar»", () => {
    const summary = summarizeTypeChange(
      makeGroup({ replacementMode: ReplacementMode.Synthetic }),
      { groups: [previewGroup()] },
      [afiliado],
    );
    expect(summary?.becomesLabel).toBe(true);
    expect(summary?.note).toBe("Pasa a Número de afiliado con el N.º 01, el próximo libre.");
    expect(BECOMES_LABEL_NOTE).toContain("Etiquetar");
  });

  it("si la entidad no estaba en «Dato falso», o el destino no es un tipo propio, no avisa", () => {
    expect(
      summarizeTypeChange(makeGroup(), { groups: [previewGroup()] }, [afiliado])?.becomesLabel,
    ).toBe(false);
    expect(
      summarizeTypeChange(makeGroup({ replacementMode: ReplacementMode.Synthetic }), {
        groups: [previewGroup({ type: EntityType.Organization })],
      })?.becomesLabel,
    ).toBe(false);
  });

  it("un tipo base conserva «Dato falso»; uno propio pasa a «Etiquetar»", () => {
    const synthetic = makeGroup({ replacementMode: ReplacementMode.Synthetic });
    expect(
      summarizeTypeChange(synthetic, {
        groups: [previewGroup({ type: EntityType.Organization })],
      })?.keepsSynthetic,
    ).toBe(true);
    expect(
      summarizeTypeChange(synthetic, { groups: [previewGroup()] }, [afiliado])?.keepsSynthetic,
    ).toBe(false);
    expect(
      summarizeTypeChange(makeGroup(), {
        groups: [previewGroup({ type: EntityType.Organization })],
      })?.keepsSynthetic,
    ).toBe(false);
  });

  it("el toast nombra el tipo propio", () => {
    expect(
      typeChangeToastText(
        "20-1234",
        afiliado.name,
        previewGroup({ replacementValue: "[NUMERO DE AFILIADO 01]" }),
      ),
    ).toEqual({
      title: "«20-1234» ahora es Número de afiliado",
      description: "Se reemplaza como [NUMERO DE AFILIADO 01].",
    });
  });
});

describe("textos de los diálogos con un tipo propio", () => {
  it("la línea de una entidad nombra el tipo propio", () => {
    expect(
      describeEntityLine({ type: afiliado.id, indexInType: 3, memberCount: 2 }, [afiliado]),
    ).toBe("Número de afiliado N.º 03 · 2 apariciones");
  });

  it("fusionar y dividir nombran el tipo propio", () => {
    expect(mergeToastText(2, previewGroup(), [afiliado]).description).toBe(
      "Número de afiliado N.º 01 · 2 apariciones",
    );
    expect(
      splitToastText("20-1234", 1, previewGroup({ groupId: null, indexInType: 2 }), [afiliado])
        .description,
    ).toBe("1 aparición pasó a Número de afiliado N.º 02");
    const group = makeGroup({ type: afiliado.id, members: [makeGroup().members[0]!] });
    expect(summarizeSplit(group, 1, null, [afiliado]).moveLabel).toBe("Número de afiliado nueva");
  });

  it("el aviso de un agregado a mano nombra el tipo propio, con o sin grupo", () => {
    const group = makeGroup({ id: "g1", type: afiliado.id, indexInType: 4 });
    expect(
      describeManualAdd({
        value: "20-1234",
        entityType: afiliado.id,
        occurrenceCount: 1,
        group,
        userTypes: [afiliado],
      }).description,
    ).toBe("Número de afiliado N.º 04 · 1 aparición oculta");
    expect(
      describeManualAdd({
        value: "20-1234",
        entityType: afiliado.id,
        occurrenceCount: 2,
        group: undefined,
        userTypes: [afiliado],
      }).description,
    ).toBe("Número de afiliado · 2 apariciones ocultas");
  });

  it("resolveAddedGroup prefiere el grupo del tipo propio pedido", () => {
    const own = makeGroup({ id: "own", type: afiliado.id });
    const other = makeGroup({ id: "other", type: EntityType.Person });
    expect(resolveAddedGroup(groupsMap(other, own), ["other", "own"], afiliado.id)).toBe(own);
  });
});

describe("el panel de conflicto con tipos propios", () => {
  it("candidateTypes conserva el tipo propio de un candidato, sin repetir", () => {
    const conflict = makeConflict({
      candidates: [
        { source: DetectionSource.Manual, entityType: afiliado.id, confidence: 1, value: "x" },
        { source: DetectionSource.Regex, entityType: EntityType.DNI, confidence: 0.9, value: "x" },
        { source: DetectionSource.NER, entityType: afiliado.id, confidence: 0.5, value: "x" },
      ],
    });
    expect(candidateTypes(conflict)).toEqual([afiliado.id, EntityType.DNI]);
  });
});
