/**
 * Los invariantes, sobre los 26 documentos del dataset de referencia.
 *
 * A diferencia de `tests/quality/`, esto **no mide calidad de detección**: no
 * necesita ground truth y no le importa si el motor encontró mucho o poco. Le
 * importa que lo que produjo sea internamente consistente con lo que el
 * contrato del repo promete.
 *
 * Por eso es un gate y no un informe: una violación es un defecto o una
 * promesa que el documento hace y el código no cumple. Las dos cosas hay que
 * arreglarlas.
 *
 * Corre con NER apagado (ADR-095 §5, el modelo no resuelve en Node). Los
 * invariantes con NER encendido corren en el browser, ver
 * `tests/measure/README.md`.
 */
import { describe, expect, it } from "vitest";

import { loadReferenceDataset } from "../quality/load-reference-dataset.js";

import { checkAll, type Violation } from "./checks.js";
import { snapshotOf } from "./run-dataset.js";

function format(documentId: string, violations: ReadonlyArray<Violation>): string {
  return violations
    .map((v) => `  ${documentId}: ${v.invariant}\n    ${v.where} — ${v.detail}`)
    .join("\n");
}

describe("invariantes sobre el dataset de referencia", () => {
  it("ningún documento viola un invariante del pipeline", { timeout: 180_000 }, async () => {
    const dataset = await loadReferenceDataset();
    const fallas: string[] = [];

    for (const doc of dataset) {
      const snapshot = await snapshotOf(doc.pdfBuffer, doc.entry.documentId);
      const violations = checkAll(snapshot);
      if (violations.length > 0) fallas.push(format(doc.entry.documentId, violations));
    }

    expect(fallas.join("\n"), `violaciones:\n${fallas.join("\n")}`).toBe("");
  });
});
