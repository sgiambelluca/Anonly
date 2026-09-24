/**
 * Opt-in NER ONNX thread-count campaign, from Rendimiento_Experimentos_Plan.md §1.
 * A single Electron instance, document and NER worker are measured per run.
 * Real-document paths are read only into memory and never included in reports.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import { hostIdentity, runTimedImport } from "./support/timeProfile.js";
import { runWasmAttribution, type WasmAttributionReport } from "./support/wasmMemory.js";

declare global {
  var __anonlyNerThreadsProbe:
    | {
        readonly startedAtMs: number | null;
        readonly modelReadyAtMs: number | null;
        readonly finishedAtMs: number | null;
        readonly cancelledAtMs: number | null;
        readonly cancelRequestedAtMs: number | null;
        readonly peakNerJobs: number;
        readonly signatures: ReadonlyArray<string>;
        readonly groupSignatures: ReadonlyArray<string>;
      }
    | undefined;
}

const RUN_ID = process.env.ANONLY_NER_THREADS_RUN;
const OUTPUT_DIR = process.env.ANONLY_NER_THREADS_OUTPUT_DIR;
const CANCEL_SLA_MS = 200;
type Profile = "P1" | "P2" | "R1" | "R2";

async function p2File(): Promise<E2eFilePayload> {
  return getOrGenerateScannedFixture(
    "ner-threads-p2-scanned-50p",
    new Uint8Array(await generateText50p()),
  );
}

async function fixture(profile: Profile): Promise<E2eFilePayload> {
  if (profile === "P1") return textTenPagesFile();
  if (profile === "P2") return p2File();
  const envKey = profile === "R1" ? "ANONLY_REAL_DOC_R1" : "ANONLY_REAL_DOC_R2";
  const path = process.env[envKey];
  if (path === undefined || path === "") throw new Error(`${envKey} no está definido.`);
  const buffer = await readFile(path);
  return { name: `${profile.toLowerCase()}.pdf`, mimeType: "application/pdf", buffer };
}

function requiredOutputDir(): string {
  if (OUTPUT_DIR === undefined || OUTPUT_DIR === "") {
    throw new Error("ANONLY_NER_THREADS_OUTPUT_DIR no está definido.");
  }
  return OUTPUT_DIR;
}

async function installProbe(page: Page, cancelActive: boolean): Promise<void> {
  await page.evaluate((shouldCancel) => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: build sin VITE_E2E=1");
    const state = {
      startedAtMs: null as number | null,
      modelReadyAtMs: null as number | null,
      finishedAtMs: null as number | null,
      cancelledAtMs: null as number | null,
      cancelRequestedAtMs: null as number | null,
      peakNerJobs: 0,
      signatures: [] as string[],
      groupSignatures: [] as string[],
    };
    globalThis.__anonlyNerThreadsProbe = state;
    let documentId: string | undefined;
    let cancelStartedAt: number | undefined;
    const nerJobs = new Set<string>();
    core.bus.on("pipeline", "DOCUMENT_IMPORTED", (payload: unknown) => {
      const event = payload as { documentId?: unknown };
      if (typeof event.documentId === "string") documentId = event.documentId;
    });
    core.bus.on("ner", "NER_STARTED", () => {
      state.startedAtMs = Date.now();
    });
    core.bus.on("ner", "NER_MODEL_READY", () => {
      state.modelReadyAtMs ??= Date.now();
      if (shouldCancel && cancelStartedAt === undefined) {
        // Let the first inference enter ONNX before exercising cancellation.
        globalThis.setTimeout(() => {
          if (documentId === undefined) throw new Error("documentId no recibido");
          cancelStartedAt = Date.now();
          state.cancelRequestedAtMs = cancelStartedAt;
          if (!("emit" in core.bus) || typeof core.bus.emit !== "function") {
            throw new Error("El bus del Core no expone emit para cancelar.");
          }
          core.bus.emit("pipeline", "CANCEL_REQUESTED", { documentId });
        }, 100);
      }
    });
    core.bus.on("ner", "ENTITY_FOUND", (payload: unknown) => {
      const event = payload as { occurrence?: Record<string, unknown> };
      const occurrence = event.occurrence;
      if (occurrence === undefined) return;
      // Entity values stay in renderer memory. Only their digest is written.
      state.signatures.push(
        JSON.stringify([
          occurrence.pageIndex,
          occurrence.entityType,
          occurrence.value,
          occurrence.normalizedValue,
          occurrence.confidence,
          occurrence.bbox,
          occurrence.fragments,
        ]),
      );
    });
    core.bus.on("ner", "NER_FINISHED", () => {
      state.finishedAtMs = Date.now();
    });
    core.bus.on("grouping", "ENTITY_GROUP_CREATED", (payload: unknown) => {
      const event = payload as { group?: Record<string, unknown> };
      const group = event.group;
      if (group === undefined) return;
      const members = Array.isArray(group.members)
        ? group.members.map((member: unknown) => {
            const item = member as Record<string, unknown>;
            return [item.pageIndex, item.value, item.normalizedValue, item.source];
          })
        : [];
      state.groupSignatures.push(
        JSON.stringify([
          group.type,
          group.canonicalValue,
          group.replacementValue,
          group.enabled,
          members,
        ]),
      );
    });
    core.bus.on("pipeline", "PIPELINE_CANCELLED", () => {
      state.cancelledAtMs = Date.now();
    });
    core.bus.on("workers", "WORKER_JOB_DISPATCHED", (payload: unknown) => {
      const event = payload as { jobId?: unknown; type?: unknown };
      if (event.type !== "ner-page" || typeof event.jobId !== "string") return;
      nerJobs.add(event.jobId);
      state.peakNerJobs = Math.max(state.peakNerJobs, nerJobs.size);
    });
    for (const eventName of [
      "WORKER_JOB_COMPLETED",
      "WORKER_JOB_FAILED",
      "WORKER_JOB_CANCELLED",
      "WORKER_JOB_TIMEOUT",
    ] as const) {
      core.bus.on("workers", eventName, (payload: unknown) => {
        const event = payload as { jobId?: unknown };
        if (typeof event.jobId === "string") nerJobs.delete(event.jobId);
      });
    }
  }, cancelActive);
}

async function readProbe(page: Page): Promise<{
  readonly nerMs: number | null;
  readonly loadMs: number | null;
  readonly cancelLatencyMs: number | null;
  readonly peakNerJobs: number;
  readonly occurrenceCount: number;
  readonly occurrenceSha256: string;
  readonly groupEventCount: number;
  readonly groupEventSha256: string;
  readonly groupCount: number | null;
  readonly groupSha256: string | null;
  readonly environment: {
    readonly crossOriginIsolated: boolean;
    readonly sharedArrayBuffer: boolean;
  };
}> {
  return page.evaluate(async () => {
    const probe = globalThis.__anonlyNerThreadsProbe;
    const core = globalThis.__anonlyCore;
    if (probe === undefined || core === undefined) throw new Error("probe/Core no disponible");
    const digest = async (parts: ReadonlyArray<string>): Promise<string> => {
      const bytes = new TextEncoder().encode([...parts].sort().join("\n"));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const groupParts = probe.groupSignatures;
    return {
      nerMs:
        probe.startedAtMs !== null && probe.finishedAtMs !== null
          ? probe.finishedAtMs - probe.startedAtMs
          : null,
      loadMs:
        probe.startedAtMs !== null && probe.modelReadyAtMs !== null
          ? probe.modelReadyAtMs - probe.startedAtMs
          : null,
      cancelLatencyMs:
        probe.cancelledAtMs !== null && probe.cancelRequestedAtMs !== null
          ? probe.cancelledAtMs - probe.cancelRequestedAtMs
          : null,
      peakNerJobs: probe.peakNerJobs,
      occurrenceCount: probe.signatures.length,
      occurrenceSha256: await digest(probe.signatures),
      groupEventCount: probe.groupSignatures.length,
      groupEventSha256: await digest(probe.groupSignatures),
      groupCount: groupParts.length,
      groupSha256: await digest(groupParts),
      environment: {
        crossOriginIsolated: globalThis.crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      },
    };
  });
}

function observedThreadCount(report: WasmAttributionReport): {
  readonly effectiveThreads: number;
  readonly ownerUrls: ReadonlyArray<string>;
} | null {
  let max = 0;
  const ownerUrls = new Set<string>();
  for (const sample of report.wasmSamples) {
    const owners = sample.wasmTargets.filter((target) =>
      /^(?:thread-pool-worker|unclassified-worker)-\d+$/.test(target.label),
    );
    for (const owner of owners) {
      const children = sample.wasmTargets.filter((target) =>
        new RegExp(`^${owner.label}/(?:thread|child)-\\d+$`).test(target.label),
      );
      const effectiveThreads = children.length + 1;
      if (children.length > 0 && effectiveThreads > max) {
        max = effectiveThreads;
        ownerUrls.clear();
        ownerUrls.add(owner.url);
      } else if (children.length > 0 && effectiveThreads === max) {
        ownerUrls.add(owner.url);
      }
    }
  }
  return max === 0 ? null : { effectiveThreads: max, ownerUrls: [...ownerUrls].sort() };
}

test("NER ONNX thread-count campaign — selected run", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  if (RUN_ID === undefined || RUN_ID === "") throw new Error("ANONLY_NER_THREADS_RUN no definido.");
  const match = /^(A|4|6|8)-(P1|P2|R1|R2)-r([0-2])$/.exec(RUN_ID);
  const timingMatch = /^time-(A|4|6|8)-(P1|P2|R1|R2)-r([0-2])$/.exec(RUN_ID);
  const qualityMatch = /^quality-(A|4|6|8)-(P1|P2|R1|R2)$/.exec(RUN_ID);
  const cancelMatch = /^cancel-(A|4|6|8)-(P1|P2|R1|R2)$/.exec(RUN_ID);
  if (match === null && timingMatch === null && qualityMatch === null && cancelMatch === null)
    throw new Error(`Corrida desconocida: ${RUN_ID}`);
  const profile = (match?.[2] ??
    timingMatch?.[2] ??
    qualityMatch?.[2] ??
    cancelMatch?.[2] ??
    "P2") as Profile;
  const isTimingOnly = timingMatch !== null || qualityMatch !== null;
  const isCancel = cancelMatch !== null;
  const longProfile = profile === "P2" || profile === "R2";
  test.setTimeout(isCancel ? 300_000 : longProfile ? 1_800_000 : 600_000);
  const file = await fixture(profile);
  await openApp(page, "networkidle");
  await installProbe(page, isCancel);

  let report: WasmAttributionReport | undefined;
  let timingReport: Awaited<ReturnType<typeof runTimedImport>> | undefined;
  if (isTimingOnly) {
    timingReport = await runTimedImport(page, file, "cold", longProfile ? 600_000 : 300_000);
  } else if (!isCancel) {
    report = await runWasmAttribution(
      page,
      electronApp,
      electronUserDataDir,
      RUN_ID,
      `ner-threads-${profile}`,
      file,
      longProfile ? 600_000 : 300_000,
    );
  } else {
    await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.waitForFunction(
      () => globalThis.__anonlyNerThreadsProbe?.cancelledAtMs !== null,
      undefined,
      { timeout: 240_000 },
    );
  }

  const probe = await readProbe(page);
  const observedThreads = report === undefined ? null : observedThreadCount(report);
  const payload = {
    runId: RUN_ID,
    profile,
    requestedThreads:
      (match?.[1] ?? timingMatch?.[1] ?? qualityMatch?.[1] ?? cancelMatch?.[1]) === "A"
        ? "automatic"
        : Number(match?.[1] ?? timingMatch?.[1] ?? qualityMatch?.[1] ?? cancelMatch?.[1]),
    observedThreads,
    threadObservation:
      observedThreads === null ? "not observable" : "pthread target count + NER worker",
    probe,
    report,
    timingReport,
    timingHost: isTimingOnly ? hostIdentity() : null,
  };
  const outDir = requiredOutputDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(
    resolve(outDir, `ner-threads-${RUN_ID}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  );

  expect(probe.environment.crossOriginIsolated).toBe(true);
  expect(probe.environment.sharedArrayBuffer).toBe(true);
  expect(probe.peakNerJobs).toBeLessThanOrEqual(1);
  if (isCancel) {
    expect(
      probe.cancelLatencyMs,
      "se canceló NER con trabajo activo dentro del SLA contractual",
    ).not.toBeNull();
    expect(probe.cancelLatencyMs).toBeLessThanOrEqual(CANCEL_SLA_MS);
    expect(probe.nerMs).toBeNull();
  } else if (isTimingOnly) {
    expect(timingReport?.ok).toBe(true);
    expect(timingReport?.intervalsMs.nerMs).not.toBeNull();
    expect(timingReport?.entityCount).toBeGreaterThan(0);
    expect(timingReport?.groupCount).toBeGreaterThan(0);
    expect(probe.occurrenceCount).toBeGreaterThan(0);
    expect(probe.groupEventCount).toBeGreaterThan(0);
  } else {
    expect(report?.ok).toBe(true);
    expect(report?.entityCount).toBeGreaterThan(0);
    expect(report?.groupCount).toBeGreaterThan(0);
    expect(probe.nerMs).not.toBeNull();
    expect(probe.occurrenceCount).toBeGreaterThan(0);
    expect(probe.groupCount).toBeGreaterThan(0);
  }
});
