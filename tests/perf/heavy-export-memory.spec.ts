import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, resolve } from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";

import {
  EXPORT_DPI,
  EXPORT_IMAGE_FORMAT,
  EXPORT_JPEG_QUALITY,
} from "../../apps/react-client/src/components/export/exportValidation.js";
import { captureDownload, expect, openApp, test } from "../e2e/support/electronApp.js";

import type { HeavyFixture, HeavyProfile } from "./support/heavyPdfFixtures.js";
import { getOrGenerateHeavyFixture } from "./support/heavyPdfFixtures.js";
import { validateExportPdf } from "./support/heavyPdfValidation.js";
import { closeDocument } from "./support/memoryProfile.js";
import { startMemorySampling, type MemorySample } from "./support/memorySampler.js";
import { startNativeMemorySampling } from "./support/nativeMemorySampler.js";
import {
  formatSystemMemoryPressure,
  readSystemMemoryPressure,
} from "./support/systemMemoryPressure.js";

const ENABLED = process.env.ANONLY_HEAVY_EXPORT === "1";
const OUT_DIR = resolve(".measure/heavy-export");
const FIXED_EXPORT = {
  dpi: EXPORT_DPI,
  imageFormat: EXPORT_IMAGE_FORMAT,
  jpegQuality: EXPORT_JPEG_QUALITY,
  includeMarkerLegend: false,
} as const;
const profiles: ReadonlyArray<HeavyProfile> = ["H1", "C0", "H2"];
const fixtureCache = new Map<HeavyProfile, HeavyFixture>();
let rendererBuildSha256: string | null = null;

interface EventRecord {
  readonly type: string;
  readonly atEpochMs: number;
  readonly payload?: unknown;
}

interface ProbeSnapshot {
  readonly events: ReadonlyArray<EventRecord>;
  readonly documentId: string | undefined;
  readonly cancelRequestedAtEpochMs?: number;
  readonly cancelOnFirstExportProgress?: boolean;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashTree(directory: string): Promise<string> {
  const hash = createHash("sha256");
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      hash.update(entry.name);
      hash.update(await hashTree(path));
    } else if (entry.isFile()) {
      hash.update(entry.name);
      hash.update(await readFile(path));
    }
  }
  return hash.digest("hex");
}

function maxInWindow(
  samples: ReadonlyArray<MemorySample>,
  startedAtMs: number,
  fromEpochMs: number,
  toEpochMs: number,
): number | null {
  const values = samples
    .filter(
      (sample) =>
        sample.atMs + startedAtMs >= fromEpochMs && sample.atMs + startedAtMs <= toEpochMs,
    )
    .map((sample) => sample.sumWorkingSetSizeBytes);
  return values.length === 0 ? null : Math.max(...values);
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type CoreHarness = {
      readonly bus: {
        on(channel: string, event: string, handler: (payload: unknown) => void): () => void;
        emit(channel: string, event: string, payload: unknown): void;
      };
      readonly orchestrator: { cancel(documentId: string): Promise<void> };
    };
    const scope = window as unknown as {
      __anonlyCore?: CoreHarness;
      __anonlyHeavyProbe?: {
        events: EventRecord[];
        documentId: string | undefined;
        cancelOnFirstExportProgress?: boolean;
        cancelRequestedAtEpochMs?: number;
      };
    };
    if (scope.__anonlyHeavyProbe !== undefined) {
      scope.__anonlyHeavyProbe.events.length = 0;
      scope.__anonlyHeavyProbe.documentId = undefined;
      return;
    }
    const core = scope.__anonlyCore;
    if (!core) throw new Error("__anonlyCore ausente; build requiere VITE_E2E=1");
    const probe: {
      events: EventRecord[];
      documentId: string | undefined;
      cancelOnFirstExportProgress?: boolean;
      cancelRequestedAtEpochMs?: number;
    } = { events: [], documentId: undefined };
    scope.__anonlyHeavyProbe = probe;
    const bindings: ReadonlyArray<readonly [string, string]> = [
      ["pipeline", "DOCUMENT_IMPORTED"],
      ["pipeline", "PIPELINE_READY"],
      ["pipeline", "PIPELINE_FAILED"],
      ["pipeline", "PIPELINE_CANCELLED"],
      ["pdf", "DOCUMENT_PARSED"],
      ["render", "RENDER_FINISHED"],
      ["render", "RENDER_FAILED"],
      ["export", "EXPORT_STARTED"],
      ["export", "EXPORT_PROGRESS"],
      ["export", "EXPORT_FINISHED"],
      ["export", "EXPORT_FAILED"],
      ["workers", "WORKER_JOB_DISPATCHED"],
      ["workers", "WORKER_JOB_COMPLETED"],
      ["workers", "WORKER_JOB_FAILED"],
      ["workers", "WORKER_JOB_CANCELLED"],
      ["workers", "WORKER_JOB_TIMEOUT"],
    ];
    for (const [channel, event] of bindings) {
      core.bus.on(channel, event, (payload) => {
        const data = payload as { documentId?: string };
        if (
          event !== "DOCUMENT_IMPORTED" &&
          data.documentId &&
          probe.documentId &&
          data.documentId !== probe.documentId
        )
          return;
        if (event === "DOCUMENT_IMPORTED") probe.documentId = data.documentId;
        const safePayload = event.startsWith("WORKER_JOB_")
          ? (() => {
              const job = payload as {
                jobId?: string;
                type?: string;
                timeoutMs?: number;
                error?: { code?: string };
              };
              return {
                jobId: job.jobId,
                type: job.type,
                timeoutMs: job.timeoutMs,
                errorCode: job.error?.code,
              };
            })()
          : payload;
        probe.events.push({ type: event, atEpochMs: Date.now(), payload: safePayload });
        const progress = payload as { current?: number; documentId?: string };
        if (
          event === "EXPORT_PROGRESS" &&
          probe.cancelOnFirstExportProgress === true &&
          (progress.current ?? 0) >= 1 &&
          probe.cancelRequestedAtEpochMs === undefined &&
          progress.documentId
        ) {
          probe.cancelRequestedAtEpochMs = Date.now();
          probe.cancelOnFirstExportProgress = false;
          core.bus.emit("pipeline", "CANCEL_REQUESTED", { documentId: progress.documentId });
        }
      });
    }
  });
}

async function readProbe(page: Page): Promise<ProbeSnapshot> {
  return page.evaluate(() => {
    const scope = window as unknown as { __anonlyHeavyProbe?: ProbeSnapshot };
    if (!scope.__anonlyHeavyProbe) throw new Error("Sonda de eventos perdida");
    const cancelRequestedAtEpochMs = scope.__anonlyHeavyProbe.cancelRequestedAtEpochMs;
    const cancelOnFirstExportProgress = scope.__anonlyHeavyProbe.cancelOnFirstExportProgress;
    return {
      events: [...scope.__anonlyHeavyProbe.events],
      documentId: scope.__anonlyHeavyProbe.documentId,
      ...(cancelRequestedAtEpochMs === undefined ? {} : { cancelRequestedAtEpochMs }),
      ...(cancelOnFirstExportProgress === undefined ? {} : { cancelOnFirstExportProgress }),
    };
  });
}

async function waitForEvent(
  page: Page,
  eventName: string,
  timeoutMs: number,
): Promise<EventRecord> {
  await page.waitForFunction(
    (name) => {
      const probe = (window as unknown as { __anonlyHeavyProbe?: ProbeSnapshot })
        .__anonlyHeavyProbe;
      return probe?.events.some((event) => event.type === name) ?? false;
    },
    eventName,
    { timeout: timeoutMs },
  );
  const snapshot = await readProbe(page);
  const found = snapshot.events.find((event) => event.type === eventName);
  if (!found) throw new Error(`Evento ${eventName} no registrado`);
  return found;
}

async function importAndRender(
  page: Page,
  fixture: HeavyFixture,
): Promise<{
  readonly documentId: string;
  readonly importStart: number;
  readonly readyAt: number;
  readonly renderStart: number;
  readonly renderEnd: number;
  readonly renderIndices: ReadonlyArray<number>;
}> {
  await page
    .getByRole("button", { name: "Elegir archivo" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await installProbe(page);
  const importStart = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${fixture.profile}.pdf`,
    mimeType: "application/pdf",
    buffer: fixture.bytes,
  });
  await waitForEvent(page, "PIPELINE_READY", 600_000);
  const afterReady = await readProbe(page);
  const pipelineFailed = afterReady.events.find((event) => event.type === "PIPELINE_FAILED");
  if (pipelineFailed) throw new Error(`PIPELINE_FAILED: ${JSON.stringify(pipelineFailed.payload)}`);
  const documentId = afterReady.documentId;
  if (!documentId) throw new Error("DOCUMENT_IMPORTED no proporcionó documentId");
  const readyEvent = afterReady.events.find((event) => event.type === "PIPELINE_READY");
  if (!readyEvent) throw new Error("PIPELINE_READY ausente");
  const renderStart = Date.now();
  await page.evaluate(
    ({ docId, pageCount }) => {
      const scope = window as unknown as {
        __anonlyCore?: {
          readonly bus: { emit(channel: string, event: string, payload: unknown): void };
        };
      };
      scope.__anonlyCore?.bus.emit("ui", "RENDER_REQUESTED", {
        documentId: docId,
        pageIndices: Array.from({ length: pageCount }, (_, index) => index),
        mode: "full",
        kind: "anonymized",
      });
    },
    { docId: documentId, pageCount: fixture.pageCount },
  );
  const expectedIndices = Array.from({ length: fixture.pageCount }, (_, index) => index);
  await page.waitForFunction(
    ({ docId, indices }) => {
      const events =
        (window as unknown as { __anonlyHeavyProbe?: ProbeSnapshot }).__anonlyHeavyProbe?.events ??
        [];
      return events.some(
        (event) =>
          event.type === "RENDER_FINISHED" &&
          (event.payload as { documentId?: string; pageIndices?: number[] }).documentId === docId &&
          JSON.stringify((event.payload as { pageIndices?: number[] }).pageIndices) ===
            JSON.stringify(indices),
      );
    },
    { docId: documentId, indices: expectedIndices },
    { timeout: 300_000 },
  );
  const renderFinish = (await readProbe(page)).events.find(
    (event) =>
      event.type === "RENDER_FINISHED" &&
      (event.payload as { documentId?: string }).documentId === documentId &&
      JSON.stringify((event.payload as { pageIndices?: number[] }).pageIndices) ===
        JSON.stringify(expectedIndices),
  );
  if (!renderFinish) throw new Error("Render full completo no observado");
  const indices = (renderFinish.payload as { pageIndices?: number[] }).pageIndices ?? [];
  expect(indices).toEqual(expectedIndices);
  return {
    documentId,
    importStart,
    readyAt: readyEvent.atEpochMs,
    renderStart,
    renderEnd: renderFinish.atEpochMs,
    renderIndices: indices,
  };
}

async function exportAndCapture(
  page: Page,
  app: ElectronApplication,
  destination: string,
  cancelAfterFirstProgress = false,
): Promise<{ readonly bytes?: Buffer; readonly cancel: unknown }> {
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 30_000 });
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await expect(dialog).toBeVisible();
  const options = FIXED_EXPORT;
  if (cancelAfterFirstProgress) {
    await page.evaluate(() => {
      const probe = (window as unknown as { __anonlyHeavyProbe?: ProbeSnapshot })
        .__anonlyHeavyProbe;
      if (!probe) throw new Error("Sonda ausente para cancelación inmediata");
      (probe as { cancelOnFirstExportProgress?: boolean }).cancelOnFirstExportProgress = true;
    });
  }
  await dialog.getByRole("button", { name: "Exportar" }).click();
  const noGroupsDialog = page.getByRole("dialog", { name: "Exportar sin nada anonimizado" });
  const noGroupsConfirmationShown = await noGroupsDialog
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (noGroupsConfirmationShown) {
    await noGroupsDialog.getByRole("button", { name: "Continuar" }).click();
  }

  if (cancelAfterFirstProgress) {
    await page.waitForFunction(
      () => {
        const probe = (window as unknown as { __anonlyHeavyProbe?: ProbeSnapshot })
          .__anonlyHeavyProbe;
        return (
          probe?.events.some(
            (event) =>
              event.type === "EXPORT_PROGRESS" &&
              (event.payload as { current?: number }).current! >= 1,
          ) ?? false
        );
      },
      undefined,
      { timeout: 240_000 },
    );
    await waitForEvent(page, "PIPELINE_CANCELLED", 30_000);
    const afterCancel = await readProbe(page);
    const finished = afterCancel.events.some((event) => event.type === "EXPORT_FINISHED");
    const linkVisible = await dialog
      .getByRole("link", { name: "Descargar" })
      .isVisible()
      .catch(() => false);
    expect(finished).toBe(false);
    expect(linkVisible).toBe(false);
    return {
      cancel: {
        exercised: true,
        requestedAtEpochMs: afterCancel.cancelRequestedAtEpochMs ?? null,
        cancelledAtEpochMs:
          afterCancel.events.find((event) => event.type === "PIPELINE_CANCELLED")?.atEpochMs ??
          null,
        latencyMs:
          afterCancel.cancelRequestedAtEpochMs === undefined
            ? null
            : (afterCancel.events.find((event) => event.type === "PIPELINE_CANCELLED")?.atEpochMs ??
                afterCancel.cancelRequestedAtEpochMs) - afterCancel.cancelRequestedAtEpochMs,
        pipelineCancelled: true,
        exportFinished: finished,
        downloadAvailable: linkVisible,
        noGroupsConfirmationShown,
      },
    };
  }

  // La confirmación de preflight está anidada y puede cerrar el diálogo padre
  // al confirmar. El evento del Core es la señal de finalización; después
  // reabrimos el diálogo si hace falta para llegar al blobUrl vigente.
  await waitForEvent(page, "EXPORT_FINISHED", 240_000);
  let resultDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  let link = resultDialog.getByRole("link", { name: "Descargar" });
  const linkVisible = await link.isVisible().catch(() => false);
  if (!linkVisible) {
    const toolbarExport = page.getByRole("button", { name: "Exportar" });
    await expect(toolbarExport).toBeVisible({ timeout: 10_000 });
    await toolbarExport.click();
    resultDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    link = resultDialog.getByRole("link", { name: "Descargar" });
  }
  await expect(link).toBeVisible({ timeout: 10_000 });
  const downloadName = await link.getAttribute("download");
  if (downloadName === null) throw new Error("El enlace de descarga no declara filename");
  const artifactFilename = basename(destination);
  const bytes = await captureDownload(app, () => link.click(), destination, 120_000);
  await resultDialog.getByRole("button", { name: "Listo" }).click();
  return {
    bytes,
    cancel: {
      exercised: false,
      artifactFilename,
      downloadName,
      options,
      noGroupsConfirmationShown,
    },
  };
}

async function runProfile(
  page: Page,
  app: ElectronApplication,
  fixture: HeavyFixture,
  repetition: number,
): Promise<void> {
  await openApp(page);
  const sampler = startMemorySampling(app, 150);
  const nativeSampler = startNativeMemorySampling(app, 1_000);
  const pressureStart = await readSystemMemoryPressure();
  const processVersions = await app.evaluate(() => ({
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
  }));
  const phases: Array<{
    phase: string;
    startEpochMs: number;
    endEpochMs: number;
    samples: number;
    peakBytes: number | null;
  }> = [];
  const runReports: unknown[] = [];
  let coldBaseBytes: number | null = null;

  for (const temperature of ["cold", "hot"] as const) {
    const pipeline = await importAndRender(page, fixture);
    const importEnd = pipeline.readyAt;
    const importSamples = sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= pipeline.importStart &&
        sample.atMs + sampler.startedAtMs <= importEnd,
    );
    phases.push({
      phase: `${temperature}-import`,
      startEpochMs: pipeline.importStart,
      endEpochMs: importEnd,
      samples: importSamples.length,
      peakBytes: importSamples.length
        ? Math.max(...importSamples.map((sample) => sample.sumWorkingSetSizeBytes))
        : null,
    });
    phases.push({
      phase: `${temperature}-render-full`,
      startEpochMs: pipeline.renderStart,
      endEpochMs: pipeline.renderEnd,
      samples: sampler.samples.filter(
        (sample) =>
          sample.atMs + sampler.startedAtMs >= pipeline.renderStart &&
          sample.atMs + sampler.startedAtMs <= pipeline.renderEnd,
      ).length,
      peakBytes: maxInWindow(
        sampler.samples,
        sampler.startedAtMs,
        pipeline.renderStart,
        pipeline.renderEnd,
      ),
    });

    const downloadPath = resolve(OUT_DIR, `r${repetition}-${fixture.profile}-${temperature}.pdf`);
    await mkdir(OUT_DIR, { recursive: true });
    const exportStart = Date.now();
    const exportResult = await exportAndCapture(page, app, downloadPath);
    const exportEnd = Date.now();
    const afterExportOpenStart = Date.now();
    await page.waitForTimeout(3_000);
    const afterExportOpenEnd = Date.now();
    const afterExportOpenSamples = sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= afterExportOpenStart &&
        sample.atMs + sampler.startedAtMs <= afterExportOpenEnd,
    );
    phases.push({
      phase: `${temperature}-post-export-document-open`,
      startEpochMs: afterExportOpenStart,
      endEpochMs: afterExportOpenEnd,
      samples: afterExportOpenSamples.length,
      peakBytes: afterExportOpenSamples.length
        ? Math.max(...afterExportOpenSamples.map((sample) => sample.sumWorkingSetSizeBytes))
        : null,
    });
    const fidelity = exportResult.bytes
      ? await validateExportPdf(
          fixture.bytes,
          exportResult.bytes,
          fixture.pageCount,
          fixture.profile,
        )
      : null;
    expect(fidelity?.valid, fidelity?.failures.join(", ") ?? "sin descarga para validar").toBe(
      true,
    );
    const exportSamples = sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= exportStart &&
        sample.atMs + sampler.startedAtMs <= exportEnd,
    );
    phases.push({
      phase: `${temperature}-export`,
      startEpochMs: exportStart,
      endEpochMs: exportEnd,
      samples: exportSamples.length,
      peakBytes: exportSamples.length
        ? Math.max(...exportSamples.map((sample) => sample.sumWorkingSetSizeBytes))
        : null,
    });
    runReports.push({
      temperature,
      documentId: pipeline.documentId,
      renderIndices: pipeline.renderIndices,
      exportSizeBytes: exportResult.bytes?.byteLength ?? null,
      exportSha256: exportResult.bytes ? sha256(exportResult.bytes) : null,
      fidelity,
      cancel: exportResult.cancel,
      events: (await readProbe(page)).events,
    });
    await closeDocument(page);
    const closeAt = Date.now();
    await page.waitForTimeout(4_000);
    const closedAt = Date.now();
    const closedSamples = sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= closeAt &&
        sample.atMs + sampler.startedAtMs <= closedAt,
    );
    phases.push({
      phase: `${temperature}-post-close`,
      startEpochMs: closeAt,
      endEpochMs: closedAt,
      samples: closedSamples.length,
      peakBytes: closedSamples.length
        ? Math.max(...closedSamples.map((sample) => sample.sumWorkingSetSizeBytes))
        : null,
    });
    if (temperature === "cold") {
      const baselineSamples = closedSamples;
      coldBaseBytes = baselineSamples.length
        ? Math.min(...baselineSamples.map((sample) => sample.sumWorkingSetSizeBytes))
        : null;
    }
  }

  const postStart = Date.now();
  await page.waitForTimeout(3_000);
  const postEnd = Date.now();
  phases.push({
    phase: "post-export-rest",
    startEpochMs: postStart,
    endEpochMs: postEnd,
    samples: sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= postStart &&
        sample.atMs + sampler.startedAtMs <= postEnd,
    ).length,
    peakBytes: maxInWindow(sampler.samples, sampler.startedAtMs, postStart, postEnd),
  });
  const pressureEnd = await readSystemMemoryPressure();
  sampler.stop();
  await nativeSampler.stop();
  const samples = [...sampler.samples];
  const nativeSamples = [...nativeSampler.samples];
  const importPeaks = phases
    .filter((phase) => phase.phase === "cold-import" || phase.phase === "hot-import")
    .map((phase) => phase.peakBytes)
    .filter((value): value is number => value !== null);
  const peakForPhase = (name: string): number | null =>
    phases.find((phase) => phase.phase === name)?.peakBytes ?? null;
  const report = {
    schemaVersion: 3,
    runId: `${new Date().toISOString()}-r${repetition}-${fixture.profile}`,
    repetition,
    fixture: {
      profile: fixture.profile,
      generatorVersion: fixture.generatorVersion,
      seed: fixture.seed,
      pageCount: fixture.pageCount,
      pageWidthPt: fixture.pageWidthPt,
      pageHeightPt: fixture.pageHeightPt,
      imageWidthPx: fixture.imageWidthPx,
      imageHeightPx: fixture.imageHeightPx,
      visualMode: fixture.visualMode,
      codec: fixture.codec,
      encodedColorSpace: fixture.encodedColorSpace,
      sourceBytes: fixture.sizeBytes,
      sourceSha256: fixture.sha256,
    },
    exportConfig: optionsForReport(),
    build: {
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      rendererDistSha256: rendererBuildSha256,
      ...processVersions,
      cpuModel: os.cpus()[0]?.model ?? null,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    appConfiguration: {
      nerEnabled: true,
      ocrEnabled: true,
      ocrLanguages: ["spa", "eng"],
      performancePreset: "auto",
    },
    memory: {
      definition: "sum of Electron workingSetSize (RSS; shared pages may be double-counted)",
      samples,
      phases,
      m2ImportPeakBytes: importPeaks.length ? Math.max(...importPeaks) : null,
      coldFullRenderPeakBytes: peakForPhase("cold-render-full"),
      hotFullRenderPeakBytes: peakForPhase("hot-render-full"),
      coldExportPeakBytes: peakForPhase("cold-export"),
      hotExportPeakBytes: peakForPhase("hot-export"),
      coldPostExportDocumentOpenPeakBytes: peakForPhase("cold-post-export-document-open"),
      hotPostExportDocumentOpenPeakBytes: peakForPhase("hot-post-export-document-open"),
      coldPostClosePeakBytes: peakForPhase("cold-post-close"),
      hotPostClosePeakBytes: peakForPhase("hot-post-close"),
      postExportRestPeakBytes: peakForPhase("post-export-rest"),
      native: {
        status: nativeSamples.length ? "observable" : "not observable",
        samplingIntervalMs: 1_000,
        samples: nativeSamples,
        errors: [...nativeSampler.errors],
      },
      heapAndWasm: {
        status: "not observed",
        reason:
          "Existing CDP heap/WASM probes force garbage collection; omitting them avoids changing the import/render/export workload measured here.",
      },
    },
    sampler: {
      declaredIntervalMs: 150,
      sampleCount: samples.length,
      effectiveCadenceMs:
        samples.length > 1
          ? samples
              .slice(1)
              .reduce(
                (sum, sample, index) => sum + sample.atMs - (samples[index]?.atMs ?? sample.atMs),
                0,
              ) /
            (samples.length - 1)
          : null,
      samplingWindowMs:
        samples.length > 0 ? samples[samples.length - 1]!.atMs - samples[0]!.atMs : null,
      probeCost:
        "not isolated; each observation calls app.getAppMetrics() and returns all process working sets",
    },
    m1: {
      status:
        coldBaseBytes === null
          ? "no observable settled baseline"
          : "estimated lower-bound difference per ADR-146",
      coldPostCloseBaselineBytes: coldBaseBytes,
      hotImportPeakBytes: peakForPhase("hot-import"),
      differenceBytes:
        coldBaseBytes === null || peakForPhase("hot-import") === null
          ? null
          : peakForPhase("hot-import")! - coldBaseBytes,
    },
    systemMemoryPressure: {
      start: pressureStart,
      end: pressureEnd,
      startText: formatSystemMemoryPressure(pressureStart),
      endText: formatSystemMemoryPressure(pressureEnd),
    },
    attribution: {
      sourcePdfBytes: { status: "observable", bytes: fixture.sizeBytes },
      downloadedPdfBytes: {
        status: "observable",
        bytes: runReports.map(
          (entry) => (entry as { exportSizeBytes: number | null }).exportSizeBytes,
        ),
      },
      pageEncodedImageBytes: {
        status: "not observable",
        reason: "public Render events expose no encoded page buffer",
      },
      rgbaRasterUpperBoundPerInstance: {
        status: "estimated",
        bytes:
          fixture.imageWidthPx && fixture.imageHeightPx
            ? fixture.imageWidthPx * fixture.imageHeightPx * 4
            : null,
        instances: "not observable",
      },
      pdfLibAssemblyBuffer: { status: "not observable" },
      simultaneousPdfCopies: { status: "not observable" },
    },
    runs: runReports,
  };
  const jsonPath = resolve(OUT_DIR, `r${repetition}-${fixture.profile}.json`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await test.info().attach(`${fixture.profile}-r${repetition}-raw`, {
    path: jsonPath,
    contentType: "application/json",
  });
}

function optionsForReport(): typeof FIXED_EXPORT {
  return FIXED_EXPORT;
}

test.describe("heavy PDF import, full render and export characterization (opt-in)", () => {
  test.skip(!ENABLED, "ANONLY_HEAVY_EXPORT=1 opt-in characterization only");
  test.setTimeout(2_100_000);

  test.beforeAll(async () => {
    rendererBuildSha256 = await hashTree(resolve("apps/react-client/dist"));
    for (const profile of ["H1", "C0", "H2"] as const) {
      fixtureCache.set(profile, await getOrGenerateHeavyFixture(profile));
    }
  });

  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const profile of profiles) {
      test(`${profile} repetition ${repetition}`, async ({ page, electronApp }) => {
        const fixture = fixtureCache.get(profile);
        if (!fixture) throw new Error(`Fixture ${profile} not prepared`);
        await runProfile(page, electronApp, fixture, repetition);
      });
    }
  }

  test("H1 cancellation after observable progress does not finish or download", async ({
    page,
    electronApp,
  }) => {
    const fixture = fixtureCache.get("H1");
    if (!fixture) throw new Error("Fixture H1 not prepared");
    await openApp(page);
    const sampler = startMemorySampling(electronApp, 150);
    const nativeSampler = startNativeMemorySampling(electronApp, 1_000);
    await importAndRender(page, fixture);
    const cancelledDownloadPath = resolve(OUT_DIR, "cancelled-h1-must-not-exist.pdf");
    const exportResult = await exportAndCapture(page, electronApp, cancelledDownloadPath, true);
    const postCancelStart = Date.now();
    await page.waitForTimeout(3_000);
    const postCancelEnd = Date.now();
    const snapshot = await readProbe(page);
    const cancellation = exportResult.cancel as {
      readonly exercised: boolean;
      readonly requestedAtEpochMs?: number;
      readonly cancelledAtEpochMs?: number;
      readonly latencyMs?: number | null;
      readonly exportFinished?: boolean;
      readonly downloadAvailable?: boolean;
    };
    const partialFileExists = await access(cancelledDownloadPath)
      .then(() => true)
      .catch(() => false);
    expect(partialFileExists).toBe(false);
    const postCancelSamples = sampler.samples.filter(
      (sample) =>
        sample.atMs + sampler.startedAtMs >= postCancelStart &&
        sample.atMs + sampler.startedAtMs <= postCancelEnd,
    );
    sampler.stop();
    await nativeSampler.stop();
    const report = {
      schemaVersion: 3,
      fixture: { profile: "H1", sha256: fixture.sha256, sourceBytes: fixture.sizeBytes },
      cancellation,
      partialFileExists,
      events: snapshot.events,
      memory: {
        samples: sampler.samples,
        peakBytes: sampler.samples.length
          ? Math.max(...sampler.samples.map((sample) => sample.sumWorkingSetSizeBytes))
          : null,
        postCancelRest: {
          startEpochMs: postCancelStart,
          endEpochMs: postCancelEnd,
          samples: postCancelSamples.length,
          peakBytes: postCancelSamples.length
            ? Math.max(...postCancelSamples.map((sample) => sample.sumWorkingSetSizeBytes))
            : null,
        },
        nativeSamples: [...nativeSampler.samples],
        nativeErrors: [...nativeSampler.errors],
      },
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      resolve(OUT_DIR, "h1-cancellation.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
});
