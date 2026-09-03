/**
 * Tests de los INVARIANTES, no del pipeline.
 *
 * Un invariante que nunca falla no prueba nada: cada caso de acá le da una
 * violación construida a mano y verifica que la detecte, más el caso sano que
 * verifica que no ladre de más.
 */
import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EntityGroup,
  type Occurrence,
  type Page,
} from "@anonly/shared";
import { describe, expect, it } from "vitest";

import {
  checkFragments,
  checkIndexInType,
  checkNoOverlapBetweenEnabledGroups,
  checkValueStartsAtWord,
  type PipelineSnapshot,
} from "./checks.js";

const bbox = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: "o1",
    value: "Juan Pérez",
    normalizedValue: "juan perez",
    bbox: bbox(10, 20, 50, 12),
    pageIndex: 0,
    source: DetectionSource.NER,
    confidence: 0.9,
    entityType: EntityType.Person,
    ...overrides,
  };
}

function group(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function page(words: ReadonlyArray<string>): Page {
  return {
    index: 0,
    width: 595,
    height: 842,
    words: words.map((text, i) => ({
      text,
      bbox: bbox(10 + i * 30, 20, 28, 12),
      pageIndex: 0,
      confidence: 1,
      source: "pdf" as const,
    })),
    text: words.join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

const vacio: PipelineSnapshot = { pages: [], occurrences: [], groups: [] };

describe("checkFragments (ADR-074 §1)", () => {
  it("acepta una ocurrencia sin fragments", () => {
    expect(checkFragments({ ...vacio, occurrences: [occurrence()] })).toEqual([]);
  });

  it("acepta fragments que suman exactamente la envolvente", () => {
    const o = occurrence({
      bbox: bbox(0, 0, 100, 30),
      fragments: [bbox(60, 0, 40, 12), bbox(0, 18, 100, 12)],
    });
    expect(checkFragments({ ...vacio, occurrences: [o] })).toEqual([]);
  });

  it("detecta un fragments de un solo elemento", () => {
    const o = occurrence({ fragments: [bbox(10, 20, 50, 12)] });
    const v = checkFragments({ ...vacio, occurrences: [o] });
    expect(v.map((x) => x.invariant)).toContain(
      "fragments presente implica length >= 2 (ADR-074 §1)",
    );
  });

  it("detecta una envolvente que no es la unión", () => {
    const o = occurrence({
      bbox: bbox(0, 0, 999, 30), // más ancha que sus pedazos
      fragments: [bbox(0, 0, 40, 12), bbox(0, 18, 50, 12)],
    });
    const v = checkFragments({ ...vacio, occurrences: [o] });
    expect(v.map((x) => x.invariant)).toContain(
      "bbox es la unión exacta de fragments (ADR-074 §1)",
    );
  });

  it("detecta dos fragments que se solapan verticalmente", () => {
    // Dos pedazos de la MISMA línea no son dos renglones: si se solapan en Y,
    // la descomposición por línea no es tal.
    const o = occurrence({
      bbox: bbox(0, 0, 100, 12),
      fragments: [bbox(0, 0, 40, 12), bbox(50, 0, 50, 12)],
    });
    const v = checkFragments({ ...vacio, occurrences: [o] });
    expect(v.map((x) => x.invariant)).toContain(
      "los fragments no se solapan verticalmente (ADR-074 §1)",
    );
  });
});

describe("checkIndexInType (ADR-028)", () => {
  it("acepta 1..n por tipo", () => {
    const groups = [group({ id: "a", indexInType: 1 }), group({ id: "b", indexInType: 2 })];
    expect(checkIndexInType({ ...vacio, groups })).toEqual([]);
  });

  it("detecta un hueco", () => {
    const groups = [group({ id: "a", indexInType: 1 }), group({ id: "b", indexInType: 3 })];
    expect(checkIndexInType({ ...vacio, groups })).toHaveLength(1);
  });

  it("detecta un repetido", () => {
    const groups = [group({ id: "a", indexInType: 1 }), group({ id: "b", indexInType: 1 })];
    expect(checkIndexInType({ ...vacio, groups })).toHaveLength(1);
  });
});

describe("checkNoOverlapBetweenEnabledGroups (ADR-107)", () => {
  const miembro = (b: ReturnType<typeof bbox>, fragments?: ReturnType<typeof bbox>[]) => ({
    occurrenceId: "o",
    value: "x",
    pageIndex: 0,
    bbox: b,
    source: DetectionSource.NER,
    ...(fragments ? { fragments } : {}),
  });

  it("acepta dos grupos que no se tocan", () => {
    const groups = [
      group({ id: "a", indexInType: 1, members: [miembro(bbox(0, 0, 40, 12))] }),
      group({ id: "b", indexInType: 2, members: [miembro(bbox(100, 0, 40, 12))] }),
    ];
    expect(checkNoOverlapBetweenEnabledGroups({ ...vacio, groups })).toEqual([]);
  });

  it("detecta dos grupos habilitados encimados", () => {
    const groups = [
      group({ id: "a", indexInType: 1, members: [miembro(bbox(0, 0, 40, 12))] }),
      group({ id: "b", indexInType: 2, members: [miembro(bbox(2, 0, 40, 12))] }),
    ];
    expect(checkNoOverlapBetweenEnabledGroups({ ...vacio, groups })).not.toEqual([]);
  });

  it("no ladra por envolventes que se cruzan si los fragments no se tocan", () => {
    // El caso exacto de ADR-107: una entidad partida por un salto de renglón
    // tiene una envolvente que abarca el bloque entero, pero sus pedazos
    // reales no tocan a la vecina.
    const partida = miembro(bbox(0, 0, 561, 30), [bbox(500, 0, 61, 12), bbox(0, 18, 80, 12)]);
    const vecina = miembro(bbox(200, 0, 60, 12));
    const groups = [
      group({ id: "a", indexInType: 1, members: [partida] }),
      group({ id: "b", indexInType: 2, type: EntityType.Organization, members: [vecina] }),
    ];
    expect(checkNoOverlapBetweenEnabledGroups({ ...vacio, groups })).toEqual([]);
  });
});

describe("checkValueStartsAtWord", () => {
  it("acepta un valor que arranca en su primera Word", () => {
    const snapshot: PipelineSnapshot = {
      pages: [page(["teléfono", "de", "contacto"])],
      occurrences: [
        occurrence({ value: "teléfono de", wordSpan: { startIndex: 0, endIndexExclusive: 2 } }),
      ],
      groups: [],
    };
    expect(checkValueStartsAtWord(snapshot)).toEqual([]);
  });

  it("detecta un valor que arranca a mitad de palabra", () => {
    // El caso real: `ORGANIZATION "fono de contacto"` sobre "teléfono de
    // contacto" (`NER_Engine.md` §14.1). El span apunta a la palabra entera
    // pero el valor empieza adentro.
    const snapshot: PipelineSnapshot = {
      pages: [page(["teléfono", "de", "contacto"])],
      occurrences: [
        occurrence({
          value: "fono de contacto",
          wordSpan: { startIndex: 0, endIndexExclusive: 3 },
        }),
      ],
      groups: [],
    };
    expect(checkValueStartsAtWord(snapshot)).toHaveLength(1);
  });
});
