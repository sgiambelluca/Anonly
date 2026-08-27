import {
  ConflictReason,
  DetectionSource,
  EntityType,
  type Conflict,
  type ConflictCandidate,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  candidateTypes,
  defaultCandidate,
  spellingChoices,
} from "../components/conflicts/conflictResolution.js";

function makeCandidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    source: DetectionSource.Regex,
    entityType: EntityType.DNI,
    confidence: 1,
    value: "34.567.891",
    ...overrides,
  };
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "group-1",
    reason: ConflictReason.Overlap,
    candidates: [
      makeCandidate({ source: DetectionSource.Regex, confidence: 1.0 }),
      makeCandidate({
        source: DetectionSource.NER,
        entityType: EntityType.Person,
        confidence: 0.65,
      }),
    ],
    resolved: false,
    ...overrides,
  };
}

describe("defaultCandidate (ADR-083 §4)", () => {
  it("elige el candidato de mayor confidence", () => {
    const conflict = makeConflict({
      candidates: [
        makeCandidate({ source: DetectionSource.Regex, confidence: 0.5 }),
        makeCandidate({ source: DetectionSource.NER, confidence: 0.9 }),
      ],
    });
    expect(defaultCandidate(conflict).source).toBe(DetectionSource.NER);
  });

  it("en empate de confidence prefiere regex (determinístico)", () => {
    const conflict = makeConflict({
      candidates: [
        makeCandidate({ source: DetectionSource.NER, confidence: 0.8 }),
        makeCandidate({ source: DetectionSource.Regex, confidence: 0.8 }),
      ],
    });
    expect(defaultCandidate(conflict).source).toBe(DetectionSource.Regex);
  });

  // La razón por la que ADR-083 §4 pudo unificar las dos ramas que este
  // módulo tenía antes (una para `overlap` y otra para `disagree`): con
  // `confidence: 1.0` de regex, "mayor confidence" YA es "gana regex".
  it("con la confidence real de regex (1.0), el default de un disagree es regex sin regla propia", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Disagree,
      candidates: [
        makeCandidate({
          source: DetectionSource.NER,
          entityType: EntityType.Person,
          confidence: 0.65,
        }),
        makeCandidate({
          source: DetectionSource.Regex,
          entityType: EntityType.DNI,
          confidence: 1.0,
        }),
      ],
    });
    expect(defaultCandidate(conflict).source).toBe(DetectionSource.Regex);
  });

  it("lanza si el conflicto no tiene candidatos (invariante de 03 §15)", () => {
    expect(() => defaultCandidate(makeConflict({ candidates: [] }))).toThrow();
  });
});

describe("candidateTypes (ADR-083 §5)", () => {
  it("devuelve los tipos distintos, con el default primero", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Disagree,
      candidates: [
        makeCandidate({
          source: DetectionSource.NER,
          entityType: EntityType.Address,
          confidence: 0.88,
        }),
        makeCandidate({
          source: DetectionSource.Regex,
          entityType: EntityType.Organization,
          confidence: 1.0,
        }),
      ],
    });
    expect(candidateTypes(conflict)).toEqual([EntityType.Organization, EntityType.Address]);
  });

  it("dedupe: candidatos que comparten tipo devuelven UN solo tipo", () => {
    // Es el caso de `low_confidence`/`ambiguous_canonical`: no hay
    // clasificación en disputa, así que el diálogo solo permite descartar.
    const conflict = makeConflict({
      reason: ConflictReason.LowConfidence,
      candidates: [
        makeCandidate({ source: DetectionSource.NER, entityType: EntityType.DNI, confidence: 0.4 }),
        makeCandidate({
          source: DetectionSource.Regex,
          entityType: EntityType.DNI,
          confidence: 1.0,
        }),
      ],
    });
    expect(candidateTypes(conflict)).toEqual([EntityType.DNI]);
  });
});

describe("spellingChoices (ADR-106)", () => {
  it("devuelve las escrituras empatadas, sin repetir", () => {
    const conflict = makeConflict({
      reason: ConflictReason.AmbiguousCanonical,
      candidates: [
        makeCandidate({ value: "Empresa S.A." }),
        makeCandidate({ value: "EMPRESA S.A." }),
        makeCandidate({ value: "Empresa S.A." }),
      ],
    });

    expect(spellingChoices(conflict)).toEqual(["Empresa S.A.", "EMPRESA S.A."]);
  });

  it("con una sola forma no hay elección que ofrecer", () => {
    // El caso de `low_confidence`: un candidato, nada entre qué elegir. El
    // diálogo cae a "Descartar" (ADR-106 §3).
    const conflict = makeConflict({
      reason: ConflictReason.LowConfidence,
      candidates: [makeCandidate({ value: "Juan Pérez" })],
    });

    expect(spellingChoices(conflict)).toHaveLength(1);
  });
});
