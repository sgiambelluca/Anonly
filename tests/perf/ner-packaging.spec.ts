import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { IAnonymizationCore } from "@anonly/anonymization-core";
import {
  DetectionSource,
  type EngineEvents,
  type EntityGroup,
  type EntityGroupCreated,
  type EventChannel,
  type EventPayloadMap,
  type Occurrence,
} from "@anonly/shared";
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { MeasuredDocument, EventTiming } from "../measure/collect.js";
import { compareBaselines } from "../quality/baseline/compare.js";
import { buildCandidateDocument } from "../quality/baseline/generate-candidate.js";
import { computeIdentity } from "../quality/baseline/identity.js";
import {
  BASELINE_SCHEMA_VERSION,
  parseDetectionBaseline,
  type DetectionBaseline,
} from "../quality/baseline/schema.js";
import { loadReferenceDataset } from "../quality/load-reference-dataset.js";

import {
  canonicalNerFootprints,
  compareFootprintArrays,
  compareExperimentalQuality,
  parseNerOccurrenceFootprints,
} from "./support/nerPackaging.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(HERE, "../quality/baselines/reference-v1.json");

interface PackagingCollector {
  readonly documentId: string;
  readonly occurrences: Array<Occurrence>;
  readonly groups: Map<string, EntityGroup>;
  readonly timings: Map<string, { first: number; last: number; count: number }>;
  readonly startedAt: number;
  readonly isOk: () => boolean;
}

declare global {
  var __anonlyNerPackagingCollector: PackagingCollector | undefined;
}

const TIMED: ReadonlyArray<readonly [string, string]> = [
  ["ner", "NER_STARTED"],
  ["ner", "NER_MODEL_LOADING"],
  ["ner", "NER_MODEL_READY"],
  ["ner", "NER_PAGE_FINISHED"],
  ["ner", "NER_FINISHED"],
  ["pipeline", "PIPELINE_READY"],
  ["pipeline", "PIPELINE_FAILED"],
];

async function waitForCore(page: Page): Promise<void> {
  // Electron already owns the initial app:// navigation. Reuse the E2E
  // helper to reload cleanly between corpus documents.
  await openApp(page, "networkidle");
  await page.waitForFunction(() => globalThis.__anonlyCore !== undefined, undefined, {
    timeout: 60_000,
  });
}

async function captureDocument(
  page: Page,
  documentId: string,
  pdfBuffer: ArrayBuffer,
): Promise<MeasuredDocument> {
  await waitForCore(page);
  await page.evaluate(
    ({ timed, id }: { timed: ReadonlyArray<readonly [string, string]>; id: string }) => {
      function isCoreWithContracts(
        value: typeof globalThis.__anonlyCore,
      ): value is NonNullable<typeof value> & IAnonymizationCore {
        return (
          value !== undefined &&
          "engines" in value &&
          "orchestrator" in value &&
          "dispose" in value &&
          typeof value.dispose === "function"
        );
      }
      const browserCore = globalThis.__anonlyCore;
      if (!isCoreWithContracts(browserCore)) throw new Error("__anonlyCore ausente o inválido");
      const core = browserCore;
      const timings = new Map<string, { first: number; last: number; count: number }>();
      const occurrences: Occurrence[] = [];
      const groups = new Map<string, EntityGroup>();
      let ok = true;
      const mark = (event: string): void => {
        const now = performance.now();
        const previous = timings.get(event);
        timings.set(
          event,
          previous === undefined
            ? { first: now, last: now, count: 1 }
            : { first: previous.first, last: now, count: previous.count + 1 },
        );
      };
      function on<E extends EngineEvents>(
        channel: EventChannel,
        event: E,
        handler: (payload: EventPayloadMap[E]) => void,
      ): void {
        core.bus.on(channel, event, handler);
      }
      for (const [channel, event] of timed) {
        // The tuples above are constants from the public Contracts enum; casts narrow their wire strings.
        on(channel as EventChannel, event as EngineEvents, () => {
          mark(event);
          if (event === "PIPELINE_FAILED") ok = false;
        });
      }
      const collectOccurrence = (payload: { readonly occurrence: Occurrence }): void => {
        occurrences.push(payload.occurrence);
      };
      on("regex" as EventChannel, "ENTITY_FOUND" as EngineEvents.ENTITY_FOUND, collectOccurrence);
      on("ner" as EventChannel, "ENTITY_FOUND" as EngineEvents.ENTITY_FOUND, collectOccurrence);
      const collectGroup = (payload: EntityGroupCreated): void => {
        groups.set(payload.group.id, payload.group);
      };
      on(
        "grouping" as EventChannel,
        "ENTITY_GROUP_CREATED" as EngineEvents.ENTITY_GROUP_CREATED,
        collectGroup,
      );
      on(
        "grouping" as EventChannel,
        "ENTITY_GROUP_UPDATED" as EngineEvents.ENTITY_GROUP_UPDATED,
        collectGroup,
      );
      globalThis.__anonlyNerPackagingCollector = {
        documentId: id,
        occurrences,
        groups,
        timings,
        startedAt: performance.now(),
        isOk: () => ok,
      };
    },
    { timed: TIMED, id: documentId },
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: `${documentId}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBuffer),
  });
  await page.waitForFunction(
    () => {
      const collector = globalThis.__anonlyNerPackagingCollector;
      return (
        collector !== undefined &&
        (collector.timings.has("PIPELINE_READY") || collector.timings.has("PIPELINE_FAILED"))
      );
    },
    undefined,
    { timeout: 600_000 },
  );

  return page.evaluate((): MeasuredDocument => {
    const collector = globalThis.__anonlyNerPackagingCollector;
    if (collector === undefined) throw new Error("collector ausente");
    const ready =
      collector.timings.get("PIPELINE_READY") ?? collector.timings.get("PIPELINE_FAILED");
    const timings: EventTiming[] = [...collector.timings.entries()].map(([event, value]) => ({
      event,
      ...value,
    }));
    return {
      documentId: collector.documentId,
      startedAt: collector.startedAt,
      readyAt: ready?.last ?? collector.startedAt,
      timings,
      occurrences: [...collector.occurrences],
      groups: [...collector.groups.values()],
      ok: collector.isOk(),
    };
  });
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} es obligatorio.`);
  return value;
}

test("NER packaging compatibility and ADR-147 quality gate", async ({ page }) => {
  test.skip(
    process.env.ANONLY_NER_PACKAGING_ARM === undefined,
    "experimento opt-in; ejecutar tests/perf/run-ner-packaging.sh",
  );
  test.setTimeout(45 * 60_000);
  const arm = requireEnvironment("ANONLY_NER_PACKAGING_ARM");
  if (arm !== "A" && arm !== "B") throw new Error(`Brazo inválido: ${arm}.`);
  const outputDir = resolve(requireEnvironment("ANONLY_NER_PACKAGING_OUTPUT_DIR"));
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("app://local/") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(url);
    }
  });

  const dataset = await loadReferenceDataset();
  expect(dataset.length, "el corpus de referencia completo no debe estar vacío").toBeGreaterThan(0);
  const results: MeasuredDocument[] = [];
  for (const document of dataset) {
    const measured = await captureDocument(page, document.entry.documentId, document.pdfBuffer);
    expect(measured.ok, `${document.entry.documentId}: el pipeline debe llegar a Ready`).toBe(true);
    const ready = measured.timings.find((timing) => timing.event === "PIPELINE_READY");
    expect(ready, `${document.entry.documentId}: falta PIPELINE_READY`).toBeDefined();
    results.push(measured);
  }

  expect(
    results.reduce(
      (sum, result) =>
        sum +
        result.occurrences.filter((occurrence) => occurrence.source === DetectionSource.NER).length,
      0,
    ),
    "el corpus de referencia completo debe producir detecciones NER",
  ).toBeGreaterThan(0);
  expect(externalRequests, "la app no debe solicitar recursos a terceros").toEqual([]);
  if (arm === "B") {
    expect(
      results.some((result) => result.timings.some((timing) => timing.event === "NER_MODEL_READY")),
      "el brazo candidato debe emitir NER_MODEL_READY",
    ).toBe(true);
  }

  const candidateDocuments = results.map((measured, index) => {
    const truth = dataset[index]?.truth;
    if (truth === undefined) throw new Error(`Truth faltante para ${measured.documentId}.`);
    return buildCandidateDocument(measured, truth);
  });
  if (arm === "A") {
    const candidate: DetectionBaseline = {
      schemaVersion: BASELINE_SCHEMA_VERSION,
      identity: await computeIdentity("chromium-wasm"),
      documents: candidateDocuments,
    };
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      resolve(outputDir, "quality-A-candidate.json"),
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
    const referenceRaw = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as unknown;
    const reference = parseDetectionBaseline(referenceRaw, BASELINE_PATH);
    const gate = compareBaselines(reference, candidate);
    expect(gate.ok, `ADR-147 rechazó el brazo A. ${JSON.stringify(gate)}`).toBe(true);
    await writeFile(
      resolve(outputDir, "quality-A.json"),
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
  }

  if (arm === "B") {
    const armAPath = resolve(outputDir, "gate-A.json");
    const armA = JSON.parse(await readFile(armAPath, "utf8")) as unknown;
    if (typeof armA !== "object" || armA === null || !("results" in armA)) {
      throw new Error("La salida del brazo A tiene una forma inválida.");
    }
    const previousResults = armA.results;
    if (!Array.isArray(previousResults) || previousResults.length !== results.length) {
      throw new Error("El brazo A no contiene el corpus completo.");
    }
    const armAQuality = parseDetectionBaseline(
      JSON.parse(await readFile(resolve(outputDir, "quality-A.json"), "utf8")) as unknown,
      resolve(outputDir, "quality-A.json"),
    );
    const experimentalQuality = compareExperimentalQuality(
      armAQuality.documents,
      candidateDocuments,
    );
    expect(
      experimentalQuality,
      "B debe mantener la cobertura de A por entidad y no agregar falsos positivos",
    ).toEqual({
      missingDocuments: [],
      failedDocuments: [],
      denominatorMismatches: [],
      lostCoverage: [],
      addedFalsePositives: [],
    });
    for (const result of results) {
      const prior = previousResults.find(
        (entry): entry is { readonly documentId: string; readonly nerFootprints: unknown } =>
          typeof entry === "object" &&
          entry !== null &&
          "documentId" in entry &&
          entry.documentId === result.documentId &&
          "nerFootprints" in entry,
      );
      if (prior === undefined) throw new Error(`El brazo A no incluye ${result.documentId}.`);
      const baselineFootprints = parseNerOccurrenceFootprints(prior.nerFootprints);
      const candidateOccurrences = result.occurrences.filter(
        (occurrence) => occurrence.source === DetectionSource.NER,
      );
      const exactDifference = compareFootprintArrays(
        baselineFootprints,
        canonicalNerFootprints(candidateOccurrences),
      );
      expect(
        exactDifference,
        `${result.documentId}: la huella de ocurrencias NER debe ser idéntica por entidad`,
      ).toEqual({ missing: [], added: [], changed: [] });
    }
  }

  await mkdir(outputDir, { recursive: true });
  const exactResults = results.map((result) => ({
    documentId: result.documentId,
    nerFootprints: canonicalNerFootprints(
      result.occurrences.filter((occurrence) => occurrence.source === DetectionSource.NER),
    ),
  }));
  await writeFile(
    resolve(outputDir, `gate-${arm}.json`),
    `${JSON.stringify({ arm, results: exactResults }, null, 2)}\n`,
  );
  if (arm === "B") {
    await writeFile(
      resolve(outputDir, "experimental-quality-B.json"),
      `${JSON.stringify(
        {
          scope:
            "Experimental comparison to A by document and entity; no ADR-147 asset identity is assigned to B.",
          result: candidateDocuments,
        },
        null,
        2,
      )}\n`,
    );
  }
});
