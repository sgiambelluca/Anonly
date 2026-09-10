/**
 * El comparador de baselines (ADR-147 §9), ejercitado con datos sintéticos
 * construidos a mano — nunca desde el dataset real (mismo criterio que
 * `matching.test.ts` para la regla de matcheo). Puro, sin I/O.
 */
import { describe, it, expect } from "vitest";

import { compareBaselines } from "./compare.js";
import { BASELINE_SCHEMA_VERSION } from "./schema.js";
import type {
  BaselineDocument,
  BaselineEntity,
  BaselineIdentity,
  DetectionBaseline,
} from "./schema.js";

function identity(overrides?: Partial<BaselineIdentity>): BaselineIdentity {
  return {
    corpusHash: "corpus-hash-1",
    runtime: "chromium-wasm",
    modelId: "ner-model@abc123",
    modelHash: "model-hash-1",
    effectiveConfig: { ner: { enabled: true } },
    commit: "deadbeef",
    ...overrides,
  };
}

function entity(id: string, overrides?: Partial<BaselineEntity>): BaselineEntity {
  return {
    id,
    entityType: "DNI",
    pageIndex: 0,
    covered: true,
    typedCovered: true,
    ...overrides,
  };
}

function doc(documentId: string, overrides?: Partial<BaselineDocument>): BaselineDocument {
  return {
    documentId,
    ok: true,
    expectedEntityCount: 1,
    falsePositiveCount: 0,
    entities: [entity(`${documentId}:0:DNI:x#0`)],
    ...overrides,
  };
}

function makeBaseline(
  documents: ReadonlyArray<BaselineDocument>,
  overrides?: Partial<DetectionBaseline>,
): DetectionBaseline {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    identity: identity(),
    documents,
    ...overrides,
  };
}

describe("compareBaselines — igualdad (ADR-147 §9)", () => {
  it("dos baselines idénticas dan veredicto verde", () => {
    const a = makeBaseline([doc("doc-001"), doc("doc-002")]);
    const b = makeBaseline([doc("doc-001"), doc("doc-002")]);
    const result = compareBaselines(a, b);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("un corpus vacío en ambos lados también da verde (sin nada que perder)", () => {
    const a = makeBaseline([]);
    const b = makeBaseline([]);
    const result = compareBaselines(a, b);
    // Vacío en ambos lados no es una regresión, pero ADR-147 §3 lo marca
    // como fallo explícito de todos modos ("un corpus vacío... fallan") —
    // ver el test dedicado más abajo.
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "empty-corpus")).toBe(true);
  });
});

describe("compareBaselines — regla central: perder cobertura (ADR-147 §3)", () => {
  it("una entidad covered:true en la baseline que pasa a covered:false es rojo, identificada", () => {
    const base = makeBaseline([
      doc("doc-001", { entities: [entity("doc-001:0:DNI:x#0", { covered: true })] }),
    ]);
    const cand = makeBaseline([
      doc("doc-001", { entities: [entity("doc-001:0:DNI:x#0", { covered: false })] }),
    ]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    const lost = result.failures.find((f) => f.kind === "lost-coverage");
    expect(lost).toBeDefined();
    expect(lost?.entityId).toBe("doc-001:0:DNI:x#0");
    expect(lost?.documentId).toBe("doc-001");
  });

  it("una entidad ausente en el candidato (no solo covered:false) también es lost-coverage", () => {
    const base = makeBaseline([doc("doc-001", { entities: [entity("doc-001:0:DNI:x#0")] })]);
    const cand = makeBaseline([doc("doc-001", { entities: [] })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "lost-coverage")).toBe(true);
  });

  it("una entidad NO cubierta en la baseline que sigue sin estarlo NO es una regresión", () => {
    const base = makeBaseline([
      doc("doc-001", {
        entities: [entity("doc-001:0:DNI:x#0", { covered: false, typedCovered: false })],
      }),
    ]);
    const cand = makeBaseline([
      doc("doc-001", {
        entities: [entity("doc-001:0:DNI:x#0", { covered: false, typedCovered: false })],
      }),
    ]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(true);
  });

  it("una MEJORA en un documento (no cubierta -> cubierta) NO compensa una PÉRDIDA en otro", () => {
    const base = makeBaseline([
      doc("doc-001", {
        entities: [entity("doc-001:0:DNI:a#0", { covered: false, typedCovered: false })],
      }),
      doc("doc-002", { entities: [entity("doc-002:0:DNI:b#0", { covered: true })] }),
    ]);
    const cand = makeBaseline([
      // Mejora: doc-001 ahora cubre su entidad.
      doc("doc-001", { entities: [entity("doc-001:0:DNI:a#0", { covered: true })] }),
      // Pérdida: doc-002 deja de cubrir la suya.
      doc("doc-002", { entities: [entity("doc-002:0:DNI:b#0", { covered: false })] }),
    ]);

    const result = compareBaselines(base, cand);

    // El agregado de cobertura SUBE (0/2 -> ... en realidad sigue 1/2, pero
    // lo que importa es que el veredicto es rojo por la pérdida puntual,
    // pase lo que pase con el total).
    expect(result.ok).toBe(false);
    expect(result.failures.filter((f) => f.kind === "lost-coverage")).toHaveLength(1);
    expect(result.failures.find((f) => f.kind === "lost-coverage")?.documentId).toBe("doc-002");
  });
});

describe("compareBaselines — documentos (ADR-147 §3)", () => {
  it("un documento en la baseline ausente en el candidato es rojo", () => {
    const base = makeBaseline([doc("doc-001"), doc("doc-002")]);
    const cand = makeBaseline([doc("doc-001")]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    const missing = result.failures.find((f) => f.kind === "missing-document");
    expect(missing?.documentId).toBe("doc-002");
  });

  it("un documento en el candidato ausente en la baseline (asimetría) también es rojo", () => {
    const base = makeBaseline([doc("doc-001")]);
    const cand = makeBaseline([doc("doc-001"), doc("doc-999")]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    const missing = result.failures.find((f) => f.kind === "missing-document");
    expect(missing?.documentId).toBe("doc-999");
  });

  it("un documento fallido (ok:false) en la baseline es rojo", () => {
    const base = makeBaseline([doc("doc-001", { ok: false })]);
    const cand = makeBaseline([doc("doc-001", { ok: true })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "failed-document")).toBe(true);
  });

  it("un documento fallido (ok:false) en el candidato es rojo", () => {
    const base = makeBaseline([doc("doc-001", { ok: true })]);
    const cand = makeBaseline([doc("doc-001", { ok: false })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "failed-document")).toBe(true);
  });
});

describe("compareBaselines — precisión: falsos positivos nuevos (ADR-147 §3)", () => {
  it("más falsos positivos en el candidato que en la baseline es rojo", () => {
    const base = makeBaseline([doc("doc-001", { falsePositiveCount: 0 })]);
    const cand = makeBaseline([doc("doc-001", { falsePositiveCount: 1 })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "new-false-positives")).toBe(true);
  });

  it("igual o menos falsos positivos no falla", () => {
    const base = makeBaseline([doc("doc-001", { falsePositiveCount: 2 })]);
    const cand = makeBaseline([doc("doc-001", { falsePositiveCount: 1 })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(true);
  });

  it("sin tolerance explícita (o con {}) el default es tolerancia cero", () => {
    const base = makeBaseline([doc("doc-001", { falsePositiveCount: 0 })]);
    const cand = makeBaseline([doc("doc-001", { falsePositiveCount: 1 })]);

    expect(compareBaselines(base, cand).ok).toBe(false);
    expect(compareBaselines(base, cand, {}).ok).toBe(false);
  });

  it("una tolerancia explícita por métrica se respeta", () => {
    const base = makeBaseline([doc("doc-001", { falsePositiveCount: 0 })]);
    const cand = makeBaseline([doc("doc-001", { falsePositiveCount: 1 })]);

    const result = compareBaselines(base, cand, { falsePositiveCount: 1 });

    expect(result.ok).toBe(true);
  });
});

describe("compareBaselines — identidad (ADR-147 §6)", () => {
  it("runtime distinto es rojo con mensaje de rebaseline, sin comparar cobertura", () => {
    const base = makeBaseline([doc("doc-001", { entities: [entity("x", { covered: true })] })], {
      identity: identity({ runtime: "chromium-wasm" }),
    });
    const cand = makeBaseline([doc("doc-001", { entities: [entity("x", { covered: true })] })], {
      identity: identity({ runtime: "node" }),
    });

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe("identity-mismatch");
    expect(result.failures[0]?.message).toMatch(/rebaseline/i);
    // No se calculó ningún total de cobertura: no hay runtime comparable.
    expect(result.summary).toBeUndefined();
  });

  it("modelHash distinto es rojo con mensaje de rebaseline", () => {
    const base = makeBaseline([doc("doc-001")], { identity: identity({ modelHash: "hash-a" }) });
    const cand = makeBaseline([doc("doc-001")], { identity: identity({ modelHash: "hash-b" }) });

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.kind === "identity-mismatch" && /rebaseline/i.test(f.message)),
    ).toBe(true);
  });

  it("corpusHash distinto es rojo con mensaje de rebaseline", () => {
    const base = makeBaseline([doc("doc-001")], { identity: identity({ corpusHash: "corpus-a" }) });
    const cand = makeBaseline([doc("doc-001")], { identity: identity({ corpusHash: "corpus-b" }) });

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.kind === "identity-mismatch" && /rebaseline/i.test(f.message)),
    ).toBe(true);
  });
});

describe("compareBaselines — denominador (ADR-147 §3)", () => {
  it("expectedEntityCount distinto para el mismo documento es rojo", () => {
    const base = makeBaseline([doc("doc-001", { expectedEntityCount: 3 })]);
    const cand = makeBaseline([doc("doc-001", { expectedEntityCount: 4 })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "denominator-mismatch")).toBe(true);
  });
});

describe("compareBaselines — corpus vacío y NaN (ADR-147 §3)", () => {
  it("un documento con expectedEntityCount:0 no produce NaN en el resumen informativo", () => {
    const base = makeBaseline([doc("doc-trap", { expectedEntityCount: 0, entities: [] })]);
    const cand = makeBaseline([doc("doc-trap", { expectedEntityCount: 0, entities: [] })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(true);
    expect(result.summary?.baselineCoverageRate).toBe(1);
    expect(result.summary?.candidateCoverageRate).toBe(1);
    expect(Number.isNaN(result.summary?.baselineCoverageRate)).toBe(false);
  });

  it("un corpus vacío en un solo lado es rojo (además de las asimetrías de documento)", () => {
    const base = makeBaseline([doc("doc-001")]);
    const cand = makeBaseline([]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "empty-corpus")).toBe(true);
  });

  it("un conteo no finito (NaN) es rojo", () => {
    const base = makeBaseline([doc("doc-001", { falsePositiveCount: 0 })]);
    const cand = makeBaseline([doc("doc-001", { falsePositiveCount: Number.NaN })]);

    const result = compareBaselines(base, cand);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "invalid-metric")).toBe(true);
  });
});
