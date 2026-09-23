import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EditPreview,
  type EditPreviewGroup,
  type EntityGroup,
  type OccurrenceRef,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describeEntityLine,
  displayReplacement,
  mergeButtonLabel,
  mergePreviewRequest,
  mergeResult,
  mergeToastText,
  orderMergeTargets,
  splitPreviewRequest,
  splitSlotMessage,
  splitToastText,
  summarizeSplit,
  summarizeTypeChange,
  typeChangeToastText,
  typePreviewRequest,
} from "../components/entities/editPreviews.js";
import {
  replacementSuggestions,
  tightestMember,
  FIT_LABEL,
} from "../components/entities/replacementFit.js";
import {
  REPLACEMENT_MODE_DESCRIPTION,
  REPLACEMENT_MODE_ORDER,
  resolveModePreview,
} from "../components/entities/replacementModeOptions.js";

// ADR-169 §6/§10 + ADR-170: el selector de modo exacto y los diálogos de edición.

function member(id: string, width = 50): OccurrenceRef {
  return {
    occurrenceId: id,
    value: "Juan Pérez",
    pageIndex: 0,
    bbox: { x: 0, y: 0, width, height: 10 },
    source: DetectionSource.NER,
  };
}

function group(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g2",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [member("o1"), member("o2")],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[HOMBRE 02]",
    indexInType: 2,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[HOMBRE 02]",
      mask: "XXXX XXXXX",
      synthetic: "Pedro Gómez",
      placeholderLadder: ["[HOMBRE 02]", "[HOMB 02]", "[HOM-02]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function previewGroup(overrides: Partial<EditPreviewGroup> = {}): EditPreviewGroup {
  return {
    groupId: "g1",
    type: EntityType.Person,
    indexInType: 1,
    canonicalValue: "Juan Pérez",
    memberCount: 3,
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[HOMBRE 01]",
    ...overrides,
  };
}

describe("selector de modo (ADR-169 §6)", () => {
  it("cada modo tiene su descripción fija", () => {
    expect(REPLACEMENT_MODE_ORDER.map((mode) => REPLACEMENT_MODE_DESCRIPTION[mode])).toEqual([
      "Tipo y número, para seguir quién es quién",
      "Tapa cada letra y conserva la forma",
      "Un dato inventado del mismo tipo",
      "Un bloque negro sobre el texto",
    ]);
  });

  it("la vista previa sale de replacementPreviews, exacta para los cuatro", () => {
    const previews = group().replacementPreviews;
    expect(resolveModePreview(ReplacementMode.Placeholder, previews)).toEqual({
      kind: "text",
      value: "[HOMBRE 02]",
    });
    expect(resolveModePreview(ReplacementMode.Mask, previews)).toEqual({
      kind: "text",
      value: "XXXX XXXXX",
    });
    expect(resolveModePreview(ReplacementMode.Synthetic, previews)).toEqual({
      kind: "text",
      value: "Pedro Gómez",
    });
    expect(resolveModePreview(ReplacementMode.Redact, previews)).toEqual({ kind: "bar" });
  });

  it("no depende del modo vigente: elegir otro solo mueve el tilde", () => {
    const a = group({ replacementMode: ReplacementMode.Placeholder });
    const b = group({ replacementMode: ReplacementMode.Mask, replacementValue: "XXXX XXXXX" });
    for (const mode of REPLACEMENT_MODE_ORDER) {
      expect(resolveModePreview(mode, a.replacementPreviews)).toEqual(
        resolveModePreview(mode, b.replacementPreviews),
      );
    }
  });

  it("nivel documento (sin grupo): sin texto, salvo el bloque", () => {
    expect(resolveModePreview(ReplacementMode.Mask, null)).toEqual({ kind: "none" });
    expect(resolveModePreview(ReplacementMode.Redact, null)).toEqual({ kind: "bar" });
  });
});

describe("Fusionar", () => {
  const a = group({ id: "a", indexInType: 7 });
  const b = group({ id: "b", indexInType: 3 });
  const c = group({ id: "c", indexInType: 5 });

  it("pone primero al de menor indexInType (ADR-170 §2)", () => {
    expect(orderMergeTargets([a, b, c])).toEqual(["b", "c", "a"]);
    expect(mergePreviewRequest("src", [a, b])).toEqual({
      kind: "merge",
      sourceGroupId: "src",
      targetGroupIds: ["b", "a"],
    });
  });

  it("sin selección no hay pedido", () => {
    expect(mergePreviewRequest("src", [])).toBeNull();
  });

  it("el resultado es el único grupo de la vista previa", () => {
    const preview: EditPreview = { groups: [previewGroup()] };
    expect(mergeResult(preview)?.indexInType).toBe(1);
    expect(mergeResult(null)).toBeNull();
  });

  it("el botón dice cuántas quedan en una", () => {
    expect(mergeButtonLabel(0)).toBe("Fusionar");
    expect(mergeButtonLabel(2)).toBe("Fusionar 3 entidades");
  });

  it("toast", () => {
    expect(mergeToastText(3, previewGroup({ memberCount: 4 }))).toEqual({
      title: "Fusionaste 3 entidades en «Juan Pérez»",
      description: "Persona N.º 01 · 4 apariciones",
    });
  });
});

describe("Dividir", () => {
  const g = group({ members: [member("o1"), member("o2"), member("o3")] });

  it("pide la vista previa solo con una selección válida", () => {
    expect(splitPreviewRequest(g, [])).toBeNull();
    expect(splitPreviewRequest(g, ["o1", "o2", "o3"])).toBeNull();
    expect(splitPreviewRequest(g, ["o2"])).toEqual({
      kind: "split",
      groupId: "g2",
      occurrenceIds: ["o2"],
    });
  });

  it("las dos tarjetas: quedan y pasan, con el N.º nuevo del Core", () => {
    const preview: EditPreview = {
      groups: [
        previewGroup({ groupId: "g2", indexInType: 2, memberCount: 2 }),
        previewGroup({ groupId: null, indexInType: 6, memberCount: 1 }),
      ],
    };
    expect(summarizeSplit(g, 1, preview)).toEqual({
      stayLabel: "N.º 02",
      stayCount: 2,
      moveLabel: "Persona N.º 06",
      moveCount: 1,
    });
    expect(summarizeSplit(g, 0, null).moveLabel).toBe("Persona nueva");
  });

  it("nota o error en la misma ranura", () => {
    expect(splitSlotMessage(g, 1).kind).toBe("note");
    expect(splitSlotMessage(g, 3)).toEqual({
      kind: "error",
      text: "Tiene que quedar al menos una aparición en N.º 02.",
    });
  });

  it("toast", () => {
    expect(
      splitToastText("Juan Pérez", 2, previewGroup({ groupId: null, indexInType: 6 })),
    ).toEqual({
      title: "Dividiste «Juan Pérez»",
      description: "2 apariciones pasaron a Persona N.º 06",
    });
    expect(splitToastText("X", 1, undefined).description).toBe(
      "1 aparición pasó a una entidad nueva",
    );
  });
});

describe("Cambiar tipo", () => {
  it("un tipo igual al vigente no se previsualiza (no-op, ADR-082 §1)", () => {
    expect(typePreviewRequest(group(), EntityType.Person)).toBeNull();
    expect(typePreviewRequest(group(), EntityType.Organization)).toEqual({
      kind: "type",
      groupId: "g2",
      type: EntityType.Organization,
    });
  });

  it("antes → después, con el N.º nuevo y el aviso del género", () => {
    const summary = summarizeTypeChange(group(), {
      groups: [
        previewGroup({
          type: EntityType.Organization,
          indexInType: 3,
          replacementValue: "[ORGANIZACION 03]",
        }),
      ],
    });
    expect(summary).toEqual({
      before: "[HOMBRE 02]",
      after: "[ORGANIZACION 03]",
      note: "Pasa a Organizaciones con el N.º 03, el próximo libre.",
      dropsGender: true,
    });
    expect(summarizeTypeChange(group(), null)).toBeNull();
  });

  it("de un tipo que no es Persona, no hay aviso de género", () => {
    const summary = summarizeTypeChange(group({ type: EntityType.Address }), {
      groups: [previewGroup({ type: EntityType.Organization })],
    });
    expect(summary?.dropsGender).toBe(false);
  });

  it("toast", () => {
    expect(
      typeChangeToastText(
        "Banco Nación",
        previewGroup({ type: EntityType.Organization, indexInType: 3 }),
      ),
    ).toEqual({
      title: "Cambiaste el tipo de «Banco Nación»",
      description: "Ahora es Organización N.º 03",
    });
  });
});

describe("textos comunes", () => {
  it("describeEntityLine", () => {
    expect(describeEntityLine({ type: EntityType.Person, indexInType: 3, memberCount: 1 })).toBe(
      "Persona N.º 03 · 1 aparición",
    );
  });

  it("redact no tiene texto: se nombra el efecto", () => {
    expect(
      displayReplacement({ replacementMode: ReplacementMode.Redact, replacementValue: "" }),
    ).toBe("Tapado con negro");
  });
});

describe("Editar reemplazo (ADR-169 §10)", () => {
  it("sugerencias: la escalera sin el valor vigente ni lo escrito", () => {
    expect(
      replacementSuggestions(["[HOMBRE 02]", "[HOMB 02]", "[HOM-02]"], "[HOMBRE 02]", ""),
    ).toEqual(["[HOMB 02]", "[HOM-02]"]);
    expect(
      replacementSuggestions(["[HOMBRE 02]", "[HOMB 02]", "[HOM-02]"], "[HOMBRE 02]", "[HOMB 02]"),
    ).toEqual(["[HOM-02]"]);
  });

  it("la aparición más apretada manda", () => {
    const narrow = member("narrow", 20);
    expect(tightestMember([member("wide", 90), narrow])?.member.occurrenceId).toBe("narrow");
    expect(tightestMember([])).toBeNull();
  });

  it("el medidor tiene los tres estados del spec", () => {
    expect([FIT_LABEL.fits, FIT_LABEL.tight, FIT_LABEL.overflows]).toEqual([
      "Entra bien",
      "Queda justo",
      "No entra",
    ]);
  });
});
