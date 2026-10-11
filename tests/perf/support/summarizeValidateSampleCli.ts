import { existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import { summarizeV1, V1_DOCS, v1Key, type V1Run } from "./validateSampleCampaign.js";
import {
  checkV1Identity,
  inspectV1RunFiles,
  invalidV1BatchSeals,
  v1BatchSealReasons,
  V1_REQUIRED_SNAPSHOTS,
  V1_OPTIONAL_SNAPSHOTS,
} from "./validateSampleIdentity.js";
import {
  projectV1Manifest,
  projectV1Run,
  safeV1ErrorName,
  V1_BATCH_PATTERN,
} from "./validateSamplePrivacy.js";
import {
  formatIncompleteDiagnostic,
  type V1PartialDiagnostic,
} from "./validateSampleSummaryDiagnostic.js";

function optional(directory: string, name: string): unknown {
  const path = join(directory, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null;
}
function invalidBatches(value: unknown): string[] {
  if (value === null) return [];
  if (
    typeof value !== "object" ||
    !("affectedRunIds" in value) ||
    !Array.isArray(value.affectedRunIds) ||
    value.affectedRunIds.some((id: unknown) => typeof id !== "string" || !V1_BATCH_PATTERN.test(id))
  )
    throw new Error("M-V1 invalid suspension record");
  return value.affectedRunIds.filter((id: unknown): id is string => typeof id === "string");
}
function safeCaveats(value: unknown) {
  const known = [
    "product-tree-uncommitted",
    "sleep-prevention-lost",
    "sleep-prevention-unavailable",
    "concurrent-process-guard-unavailable-Playwright",
    "concurrent-process-guard-unavailable-Vitest",
  ];
  if (
    typeof value !== "object" ||
    value === null ||
    !("items" in value) ||
    !Array.isArray(value.items)
  )
    return { items: [] };
  return {
    items: value.items.map((item: unknown) => {
      const id =
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof item.id === "string" &&
        known.includes(item.id)
          ? item.id
          : "unclassified-runner-caveat";
      return { id, note: "Runner caveat present; arbitrary detail omitted" };
    }),
  };
}
function safeSleep(value: unknown) {
  if (typeof value !== "object" || value === null)
    return { available: false, platform: "unknown", note: "SleepDetectionUnavailable" };
  return {
    available: "available" in value && value.available === true,
    platform:
      "platform" in value && (value.platform === "windows" || value.platform === "darwin")
        ? value.platform
        : "unknown",
    note: "note" in value && value.note !== null ? "SleepDetectionCaveat" : null,
  };
}
function table(summary: ReturnType<typeof summarizeV1>, real: boolean): string[] {
  const cell = (
    values: ReturnType<typeof summarizeV1>["cells"][number]["originalReadyMs"],
    divisor: number,
  ): string =>
    values.median === null
      ? "—"
      : `${(values.median / divisor).toFixed(1)} (${((values.min ?? 0) / divisor).toFixed(1)}–${((values.max ?? 0) / divisor).toFixed(1)})`;
  const out = [
    `## ${real ? "Reales — resultados principales" : "Matriz sintética"}`,
    "",
    "Mediana (mín–máx), segundos y MB decimales. Cada celda debe tener tres corridas.",
    "",
    "| Doc | Páginas | Nivel | n | Original Ready s | Original OCR s | Original M2 MB | Export s | Export MB | Reimport Ready s | Reimport OCR s | Reimport M2 MB |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of summary.cells.filter(
    (value) => (value.doc === "R1" || value.doc === "R4") === real,
  ))
    out.push(
      `| ${row.doc} | ${row.pages} | ${row.preset} | ${row.successfulRuns} | ${cell(row.originalReadyMs, 1000)} | ${cell(row.originalOcrMs, 1000)} | ${cell(row.originalM2Bytes, 1e6)} | ${cell(row.exportMs, 1000)} | ${cell(row.exportBytes, 1e6)} | ${cell(row.reimportReadyMs, 1000)} | ${cell(row.reimportOcrMs, 1000)} | ${cell(row.reimportM2Bytes, 1e6)} |`,
    );
  return out;
}
let summaryStep = "load-manifest";
let partialDiagnostic: V1PartialDiagnostic | null = null;
function readPartialDiagnostic(): V1PartialDiagnostic | null {
  return partialDiagnostic;
}
function main(): number {
  const argument = process.argv[2];
  if (argument === undefined) throw new Error("Usage: summarizeValidateSampleCli.ts <output-dir>");
  const directory = resolve(argument);
  const manifest = projectV1Manifest(
    JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
  );
  summaryStep = "load-run-records";
  const inventory = inspectV1RunFiles(readdirSync(directory));
  const runs = inventory.runFiles.map((name) => {
    const run = projectV1Run(JSON.parse(readFileSync(join(directory, name), "utf8")) as V1Run);
    if (`${v1Key(run)}.json` !== name) throw new Error("M-V1 record filename identity mismatch");
    return run;
  });
  summaryStep = "load-validity";
  const suspended = invalidBatches(optional(directory, "validity.json"));
  const batchIds = [...new Set(runs.map((run) => run.batchId))];
  const seals = Object.fromEntries(
    batchIds.map((id) => {
      // A partial/corrupt seal is as unsealed as an absent one, and can be resumed.
      try {
        return [id, optional(directory, `batch-${id}.json`)];
      } catch {
        return [id, null];
      }
    }),
  );
  const unsealed = invalidV1BatchSeals(batchIds, seals);
  const invalid = [...new Set([...suspended, ...unsealed])];
  const validity = {
    affectedRunIds: invalid,
    reasonsByRunId: Object.fromEntries(
      invalid.map((id) => [
        id,
        [
          ...new Set([
            ...(suspended.includes(id) ? ["sleep-wake-event-during-run"] : []),
            ...v1BatchSealReasons(id, seals[id]),
          ]),
        ],
      ]),
    ),
  };
  const historyFiles = inventory.historyFiles;
  summaryStep = "load-identity";
  const snapshots = Object.fromEntries(
    [...V1_REQUIRED_SNAPSHOTS, ...V1_OPTIONAL_SNAPSHOTS].map((name) => {
      const first = join(directory, "first", name);
      const current = join(directory, name);
      return [
        name,
        {
          first: existsSync(first) ? readFileSync(first, "utf8") : null,
          current: existsSync(current) ? readFileSync(current, "utf8") : null,
        },
      ];
    }),
  );
  const identityIssues = [...inventory.issues, ...checkV1Identity(manifest, runs, snapshots)];
  // Availability cannot shrink the required matrix: missing real sources leave
  // the full 36-cell campaign incomplete, even if all synthetic cells finished.
  summaryStep = "aggregate";
  const measured = summarizeV1(runs, V1_DOCS, invalid);
  const summary = {
    ...measured,
    check: {
      ...measured.check,
      complete: measured.check.complete && identityIssues.length === 0,
      issues: [...measured.check.issues, ...identityIssues],
    },
    cells: identityIssues.length === 0 ? measured.cells : summarizeV1([], V1_DOCS).cells,
  };
  const caveats = safeCaveats(optional(directory, "caveats.json"));
  const result = {
    generatedAtUtc: new Date().toISOString(),
    ...summary,
    validity,
    caveats,
    archivedAttemptFiles: historyFiles,
    sleepDetection: safeSleep(optional(directory, "sleep-detection.json")),
    perRun: runs.map((run) => ({
      id: v1Key(run),
      batchId: run.batchId,
      failedAt: run.failedAt,
      failureKind: run.failureKind,
      errorName: run.errorName,
      conflictPreparation: run.conflictPreparation,
      original:
        run.original === null
          ? null
          : {
              readyMs: run.original.report.readyDurationMs,
              ocrMs: run.original.report.ocrDurationMs,
              m2Bytes: run.original.report.peakSumBytes,
              postReadyBytes: run.original.report.postReadyPeakBytes,
              groups: run.original.report.groupCount,
              entities: run.original.report.entityCount,
              ...run.original.snapshot,
            },
      exported: run.exported,
      reimport:
        run.reimport === null
          ? null
          : {
              readyMs: run.reimport.report.readyDurationMs,
              ocrMs: run.reimport.report.ocrDurationMs,
              m2Bytes: run.reimport.report.peakSumBytes,
              postReadyBytes: run.reimport.report.postReadyPeakBytes,
              groups: run.reimport.report.groupCount,
              entities: run.reimport.report.entityCount,
              ...run.reimport.snapshot,
            },
    })),
  };
  partialDiagnostic = {
    expectedRuns: summary.check.expectedRuns,
    recordedRuns: summary.check.recordedRuns,
    missingRuns: summary.check.missing.length,
    failedRuns: summary.check.failedRuns.map((run) => ({
      id: run.id,
      stage: run.stage ?? "unknown",
      kind: run.kind,
    })),
    issues: summary.check.issues.map(
      (issue) => issue.split(":").at(-1)?.trim() ?? "instrument-issue",
    ),
  };
  summaryStep = "format-tables";
  const text = [
    "# M-V1 — costo de leer la copia exportada",
    "",
    `Esperadas ${summary.check.expectedRuns}; registradas ${summary.check.recordedRuns}; faltantes ${summary.check.missing.length}; fallidas ${summary.check.failedRuns.length}; inválidas por suspensión, detección no confirmada o guarda incompleta ${summary.check.invalidRuns.length}; errores del instrumento ${summary.check.issues.length}.`,
    "",
    ...table(summary, true),
    "",
    ...table(summary, false),
    "",
    "## Repeticiones, avisos y pico posterior a Ready",
    "",
    "| Corrida | Original Ready/OCR s | Reimport Ready/OCR s | Original postReady MB | Reimport postReady MB | Avisos original/reimport | Cubiertas | Estado |",
    "| --- | --- | --- | ---: | ---: | --- | ---: | --- |",
    ...runs
      .sort((a, b) => v1Key(a).localeCompare(v1Key(b)))
      .map((run) => {
        const value = (n: number | null | undefined, scale: number): string =>
          n === null || n === undefined ? "—" : (n / scale).toFixed(1);
        const original = run.original?.report;
        const reimport = run.reimport?.report;
        const status = summary.check.invalidRuns.includes(v1Key(run))
          ? `inválida: ${validity.reasonsByRunId[run.batchId]?.join(", ") ?? "batch-guard-not-sealed"}`
          : run.failedAt !== null
            ? `${run.failureKind}: ${run.failedAt}`
            : identityIssues.length > 0 ||
                summary.check.issues.some((issue) => issue.startsWith(`${v1Key(run)}:`))
              ? "incoherencia del instrumento"
              : "éxito";
        return `| ${v1Key(run)} | ${value(original?.readyDurationMs, 1000)}/${value(original?.ocrDurationMs, 1000)} | ${value(reimport?.readyDurationMs, 1000)}/${value(reimport?.ocrDurationMs, 1000)} | ${value(original?.postReadyPeakBytes, 1e6)} | ${value(reimport?.postReadyPeakBytes, 1e6)} | ${run.original?.snapshot.unreadableInkPageIndices.length ?? "—"}/${run.reimport?.snapshot.unreadableInkPageIndices.length ?? "—"} | ${run.exported?.coveredPages.length ?? "—"} | ${status} |`;
      }),
    "",
    "## Preparación de conflictos (fuera del tiempo medido de importación)",
    "",
    "| Corrida | Estado | Duración ms | Pendientes antes/después | Confirmados | heldManual bloqueados | Defaults inconsistentes | Grupos iguales | Conflictos iguales | Export habilitado |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...runs.map((run) => {
      const preparation = run.conflictPreparation;
      return preparation === null
        ? `| ${v1Key(run)} | sin registrar | — | — | — | — | — | — | — | — |`
        : `| ${v1Key(run)} | ${preparation.status} | ${preparation.durationMs.toFixed(1)} | ${preparation.pendingBefore}/${preparation.pendingAfter} | ${preparation.resolvedCount} | ${preparation.heldManualCount} | ${preparation.defaultInconsistentCount} | ${preparation.groupInvariantsPreserved ? "sí" : "no"} | ${preparation.conflictInvariantsPreserved ? "sí" : "no"} | ${preparation.exportEnabled ? "sí" : "no"} |`;
    }),
    "",
    "La reimportación ejecuta OCR, NER y agrupación: aproxima el costo, no mide un verificador aún inexistente. Los tiempos OCR se informan aparte del total hasta Ready.",
    "Las medianas incluyen únicamente recorridos completos exitosos. Las fallas de producto son resultados observados de la campaña, y se muestran aparte; las incoherencias del instrumento y tandas suspendidas, sin detección confirmada en ambos extremos o con guarda incompleta requieren repetir las celdas afectadas.",
    "M2 suma los procesos de Electron; excluye el Buffer del export retenido por Node. Su tamaño está informado en la columna Export MB. Los procesos nuevos vuelven a alojar el archivo importado como en el instrumento vigente.",
    "Los sintéticos escaneados se generan a 216 DPI fuera de Electron medido; fechas CreationDate y ModDate de digital10, scan10 y scan50 se fijan en memoria a 2026-01-01T00:00:00Z antes del hash/import. No se cambian bytes reales.",
    `Salvedades del runner: ${JSON.stringify(caveats)}.`,
    ...summary.check.issues.map((issue) => `Error de instrumento: ${issue}`),
    ...summary.check.failedRuns.map(
      (run) =>
        `Falla de ${run.kind}: ${run.id}, ${run.stage}, ${run.errorName ?? "sin error adicional"}`,
    ),
    "",
    summary.check.complete ? "COMPLETA" : "INCOMPLETA",
  ].join("\n");
  writeFileSync(join(directory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(directory, "summary-tables.txt"), `${text}\n`);
  writeSync(1, `${text}\n`);
  return summary.check.issues.length > 0 || summary.check.duplicates.length > 0
    ? 2
    : summary.check.complete
      ? 0
      : 1;
}
try {
  process.exitCode = main();
} catch (error: unknown) {
  const errorName = safeV1ErrorName(error);
  writeSync(2, `${errorName}: ${summaryStep}\n`);
  // Never leave an old COMPLETE summary visible after malformed identity/data.
  const argument = process.argv[2];
  if (argument !== undefined) {
    try {
      const diagnostic = readPartialDiagnostic();
      writeFileSync(
        join(resolve(argument), "summary.json"),
        `${JSON.stringify(
          {
            generatedAtUtc: new Date().toISOString(),
            complete: false,
            check:
              diagnostic === null
                ? null
                : {
                    expectedRuns: diagnostic.expectedRuns,
                    recordedRuns: diagnostic.recordedRuns,
                    missingRuns: diagnostic.missingRuns,
                    failedRuns: diagnostic.failedRuns,
                    issues: diagnostic.issues,
                  },
            issues: ["campaign:summary-validation-failed"],
            errorName,
            failureStep: summaryStep,
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(resolve(argument), "summary-tables.txt"),
        `${formatIncompleteDiagnostic(errorName, summaryStep, diagnostic)}\n`,
      );
    } catch {
      /* Exit status still marks the infrastructure failure. */
    }
  }
  process.exitCode = 2;
}
