import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type BoundingBox,
  type EntityGroup,
  type OccurrenceRef,
  type TextMatch,
  type Word,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describeResultCount,
  matchContext,
  resolveMatchStatus,
  summarizeMatchStatuses,
} from "../components/viewer/searchResults.js";

// ADR-169 §7: la lista de resultados de la lupa.

function word(text: string, x: number): Word {
  return {
    text,
    bbox: { x, y: 10, width: 20, height: 10 },
    pageIndex: 0,
    confidence: 1,
    source: "pdf",
  };
}

const WORDS = ["la", "señora", "María", "Laura", "Fernández", "refiere", "conocerla"].map((t, i) =>
  word(t, i * 30),
);

function match(bbox: BoundingBox, start = 4, end = 5, pageIndex = 0): TextMatch {
  return {
    pageIndex,
    bbox,
    text: "Fernández",
    wordSpan: { startIndex: start, endIndexExclusive: end },
  };
}

function member(bbox: BoundingBox, fragments?: ReadonlyArray<BoundingBox>): OccurrenceRef {
  return {
    occurrenceId: "o",
    value: "Fernández",
    pageIndex: 0,
    bbox,
    source: DetectionSource.NER,
    ...(fragments !== undefined ? { fragments } : {}),
  };
}

function group(members: ReadonlyArray<OccurrenceRef>): EntityGroup {
  return {
    id: "g2",
    type: EntityType.Person,
    canonicalValue: "María Laura Fernández",
    members,
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 02]",
    indexInType: 2,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 02]",
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 02]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("matchContext", () => {
  it("arma la frase alrededor con el wordSpan", () => {
    expect(matchContext(WORDS, match({ x: 120, y: 10, width: 20, height: 10 }), 2)).toEqual({
      before: "María Laura ",
      match: "Fernández",
      after: " refiere conocerla",
    });
  });

  it("en el borde de la página no inventa contexto", () => {
    const first = matchContext(WORDS, match({ x: 0, y: 10, width: 20, height: 10 }, 0, 1), 3);
    expect(first.before).toBe("");
    expect(first.match).toBe("la");
  });

  it("sin palabras cae al texto del resultado", () => {
    expect(matchContext([], match({ x: 0, y: 0, width: 1, height: 1 }))).toEqual({
      before: "",
      match: "Fernández",
      after: "",
    });
  });
});

describe("resolveMatchStatus", () => {
  const box = { x: 120, y: 10, width: 20, height: 10 };

  it("oculto como el grupo cuyo miembro cubre el resultado", () => {
    const status = resolveMatchStatus(
      match(box),
      new Map([[EntityType.Person, [group([member({ x: 60, y: 10, width: 80, height: 10 })])]]]),
    );
    expect(status).toEqual({
      kind: "hidden",
      groupId: "g2",
      type: EntityType.Person,
      indexInType: 2,
    });
  });

  it("se compara contra los fragmentos, no contra la envolvente (ADR-074)", () => {
    // Envolvente de dos renglones que cubre todo; el resultado cae en el hueco.
    const envelope = { x: 0, y: 0, width: 600, height: 40 };
    const fragments = [
      { x: 400, y: 0, width: 200, height: 10 },
      { x: 0, y: 30, width: 50, height: 10 },
    ];
    const status = resolveMatchStatus(
      match(box),
      new Map([[EntityType.Person, [group([member(envelope, fragments)])]]]),
    );
    expect(status.kind).toBe("unhidden");
  });

  it("otra página no cuenta", () => {
    const status = resolveMatchStatus(
      match(box, 4, 5, 1),
      new Map([[EntityType.Person, [group([member(box)])]]]),
    );
    expect(status.kind).toBe("unhidden");
  });

  it("el resumen cuenta los dos estados, los dos siempre presentes", () => {
    expect(
      summarizeMatchStatuses([
        { kind: "unhidden" },
        { kind: "hidden", groupId: "g", type: EntityType.DNI, indexInType: 1 },
      ]),
    ).toEqual({ hidden: 1, unhidden: 1 });
    expect(summarizeMatchStatuses([])).toEqual({ hidden: 0, unhidden: 0 });
  });
});

describe("describeResultCount", () => {
  it("vacío con menos de dos letras; singular y plural", () => {
    expect(describeResultCount("a", 3)).toBe("");
    expect(describeResultCount("ab", 1)).toBe("1 resultado");
    expect(describeResultCount("ab", 7)).toBe("7 resultados");
  });
});
