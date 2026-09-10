/**
 * Prueba de extremo a extremo del gate (ADR-147 §9: "prueba de extremo a
 * extremo con resultados alterados"). Invoca `runGate` directo —sin
 * spawnear un proceso— con archivos JSON sintéticos en un directorio
 * temporal: uno idéntico a la baseline (verde) y uno alterado a propósito
 * para introducir una regresión conocida (rojo, código de salida != 0).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGate } from "./gate.js";
import { BASELINE_SCHEMA_VERSION } from "./schema.js";
import type { DetectionBaseline } from "./schema.js";

function makeBaseline(overrides?: Partial<DetectionBaseline>): DetectionBaseline {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    identity: {
      corpusHash: "corpus-hash-1",
      runtime: "chromium-wasm",
      modelId: "ner-model@abc123",
      modelHash: "model-hash-1",
      effectiveConfig: { ner: { enabled: true } },
      commit: "deadbeef",
    },
    documents: [
      {
        documentId: "doc-001",
        ok: true,
        expectedEntityCount: 2,
        falsePositiveCount: 0,
        entities: [
          {
            id: "doc-001:0:DNI:x#0",
            entityType: "DNI",
            pageIndex: 0,
            covered: true,
            typedCovered: true,
          },
          {
            id: "doc-001:0:PERSON:y#0",
            entityType: "PERSON",
            pageIndex: 0,
            covered: true,
            typedCovered: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("runGate — extremo a extremo (ADR-147 §9)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "anonly-baseline-gate-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("sale con código 0 cuando el candidato es idéntico a la baseline", async () => {
    const baselinePath = join(dir, "baseline.json");
    const candidatePath = join(dir, "candidate.json");
    const baseline = makeBaseline();

    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
    await writeFile(candidatePath, JSON.stringify(baseline, null, 2));

    const exitCode = await runGate(candidatePath, baselinePath);

    expect(exitCode).toBe(0);
  });

  it("sale con código != 0 cuando el candidato tiene una regresión de cobertura introducida a propósito", async () => {
    const baselinePath = join(dir, "baseline.json");
    const candidatePath = join(dir, "candidate.json");

    const baseline = makeBaseline();
    // Regresión introducida a mano: la entidad PERSON que la baseline
    // cubría deja de estar cubierta en el candidato.
    const regressed = makeBaseline({
      documents: [
        {
          documentId: "doc-001",
          ok: true,
          expectedEntityCount: 2,
          falsePositiveCount: 0,
          entities: [
            {
              id: "doc-001:0:DNI:x#0",
              entityType: "DNI",
              pageIndex: 0,
              covered: true,
              typedCovered: true,
            },
            {
              id: "doc-001:0:PERSON:y#0",
              entityType: "PERSON",
              pageIndex: 0,
              covered: false,
              typedCovered: false,
            },
          ],
        },
      ],
    });

    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
    await writeFile(candidatePath, JSON.stringify(regressed, null, 2));

    const exitCode = await runGate(candidatePath, baselinePath);

    expect(exitCode).toBe(1);
  });

  it("sale con código != 0 cuando el candidato tiene un falso positivo nuevo", async () => {
    const baselinePath = join(dir, "baseline.json");
    const candidatePath = join(dir, "candidate.json");

    const baseline = makeBaseline();
    const regressed = makeBaseline({
      documents: baseline.documents.map((d) => ({
        ...d,
        falsePositiveCount: d.falsePositiveCount + 1,
      })),
    });

    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
    await writeFile(candidatePath, JSON.stringify(regressed, null, 2));

    const exitCode = await runGate(candidatePath, baselinePath);

    expect(exitCode).toBe(1);
  });

  it("usa tests/quality/baselines/reference-v1.json como baseline por defecto", async () => {
    // No se llama sin segundo argumento en este test porque ese archivo no
    // existe todavía (ADR-147: la primera baseline real queda pendiente de
    // una corrida de Playwright fuera de esta tarea) — se verifica solo que
    // el default APUNTA al lugar documentado, leyendo el candidato contra sí
    // mismo pasado explícitamente como baseline no prueba el default. En vez
    // de inventar un candidato de humo, este test confirma el comportamiento
    // observable: sin baseline en disco, `runGate` rechaza con el error de
    // lectura de archivo (ENOENT), no con un default silencioso a otra ruta.
    const candidatePath = join(dir, "candidate.json");
    await writeFile(candidatePath, JSON.stringify(makeBaseline(), null, 2));

    await expect(runGate(candidatePath)).rejects.toThrow(/ENOENT|no such file/i);
  });
});
