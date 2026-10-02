import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";

import type { IAnonymizationCore } from "@anonly/anonymization-core";
import type {
  EngineEvents,
  EventChannel,
  EntityGroup,
  EntityGroupCreated,
  EntityGroupUpdated,
  EventPayloadMap,
  IEventBus,
  Occurrence,
} from "@anonly/shared";
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { validateNerGapsImport } from "./support/nerGaps.js";
import type {
  NerGapImport,
  NerGapsArm,
  NerGapsCorpus,
  NerGapsReport,
} from "./support/nerGapsTypes.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

declare global {
  var __anonlyNerGapsCollector:
    | {
        readonly beginImport: (corpus: NerGapsCorpus, sequenceIndex: number) => void;
        readonly finishImport: () => void;
        readonly readImport: () => Promise<NerGapImport>;
        readonly isSettled: () => boolean;
        readonly isPanelObserved: () => boolean;
      }
    | undefined;
}

const RUN_ID = process.env.ANONLY_NER_GAPS_RUN_ID;
const OUTPUT_DIR = process.env.ANONLY_NER_GAPS_OUTPUT_DIR;
const RUN_PATTERN = /^(preflight)-([A468])-(P[12])$|^(time)-([A468])-b([123])$/;
const TIMEOUT_MS = 25 * 60_000;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
type ParsedRun =
  | { readonly phase: "preflight"; readonly arm: NerGapsArm; readonly corpus: "P1" | "P2" }
  | { readonly phase: "timing"; readonly arm: NerGapsArm; readonly block: number };

function parseRunId(value: string): ParsedRun {
  const match = RUN_PATTERN.exec(value);
  if (match === null) throw new Error(`Run id NER gaps inválido: ${value}`);
  if (match[1] === "preflight" && match[2] !== undefined && match[3] !== undefined) {
    return { phase: "preflight", arm: match[2] as NerGapsArm, corpus: match[3] as "P1" | "P2" };
  }
  if (match[4] === "time" && match[5] !== undefined && match[6] !== undefined) {
    return { phase: "timing", arm: match[5] as NerGapsArm, block: Number(match[6]) };
  }
  throw new Error(`Run id NER gaps inválido: ${value}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} es obligatorio.`);
  return value;
}

async function fileFor(corpus: NerGapsCorpus): Promise<E2eFilePayload> {
  if (corpus === "P1") return textTenPagesFile();
  if (corpus === "P2") {
    const bytes = await generateText50p();
    const payload = await getOrGenerateScannedFixture("ner-gaps-p2", new Uint8Array(bytes));
    return { ...payload, name: "p2.pdf" };
  }
  const envName = corpus === "R1" ? "ANONLY_REAL_DOC_R1" : "ANONLY_REAL_DOC_R2";
  const path = requiredEnv(envName);
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    throw new Error(`${envName} no se pudo leer.`);
  }
  return {
    name: corpus === "R1" ? "r1.pdf" : "r2.pdf",
    mimeType: "application/pdf",
    buffer,
  };
}

async function installCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
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
    const candidate = globalThis.__anonlyCore;
    if (!isCoreWithContracts(candidate))
      throw new Error("__anonlyCore ausente; build requiere VITE_E2E=1");
    const core: IAnonymizationCore = candidate;
    function on<E extends EngineEvents>(
      channel: EventChannel,
      event: E,
      handler: (payload: EventPayloadMap[E]) => void,
    ): void {
      core.bus.on(channel, event, (payload) => handler(payload as EventPayloadMap[E]));
    }
    type TimedMark =
      | "DOCUMENT_IMPORTED"
      | "NER_STARTED"
      | "NER_MODEL_LOADING"
      | "NER_MODEL_READY"
      | "NER_FINISHED"
      | "PIPELINE_READY"
      | "PIPELINE_FAILED";
    type BrowserImport = {
      corpus: NerGapsCorpus;
      sequenceIndex: number;
      documentId?: string;
      marks: Record<TimedMark | "selection", number | null>;
      nerSignatures: string[];
      groups: Map<string, EntityGroup>;
      pageCount: number;
      ocrPageSummaries: Array<readonly [number, number, number]>;
      peakNerJobs: number;
      activeJobs: Set<string>;
      nerJobCount: number;
      selectionAt: number;
      panelAt: number | null;
      panelVisible: boolean;
      errors: string[];
      previousReadyAt: number | null;
      disconnectObserver?: () => void;
    };
    let current: BrowserImport | undefined;
    let lastReadyAt: number | null = null;
    const digest = async (parts: ReadonlyArray<string>): Promise<string> => {
      const normalized = [...parts].sort().join("\n");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const findVisibleExportButton = (): boolean =>
      [...document.querySelectorAll("button")].some((button) => {
        if (button.textContent?.trim() !== "Exportar") return false;
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
    const tryPanelMark = (): void => {
      if (current === undefined || current.panelAt !== null || !findVisibleExportButton()) return;
      current.panelAt = performance.now();
      current.panelVisible = true;
      current.disconnectObserver?.();
    };
    const newImport = (corpus: NerGapsCorpus, sequenceIndex: number): BrowserImport => ({
      corpus,
      sequenceIndex,
      marks: {
        selection: null,
        DOCUMENT_IMPORTED: null,
        NER_STARTED: null,
        NER_MODEL_LOADING: null,
        NER_MODEL_READY: null,
        NER_FINISHED: null,
        PIPELINE_READY: null,
        PIPELINE_FAILED: null,
      },
      nerSignatures: [],
      groups: new Map(),
      pageCount: 0,
      ocrPageSummaries: [],
      peakNerJobs: 0,
      activeJobs: new Set(),
      nerJobCount: 0,
      selectionAt: performance.now(),
      panelAt: null,
      panelVisible: false,
      errors: [],
      previousReadyAt: lastReadyAt,
    });
    const markAt = (name: TimedMark, at: number): void => {
      if (current !== undefined && current.marks[name] === null) current.marks[name] = at;
    };
    const documentIdFromPayload = (payload: unknown): string | null => {
      if (typeof payload !== "object" || payload === null || !("documentId" in payload))
        return null;
      return typeof payload.documentId === "string" ? payload.documentId : null;
    };
    const originalEmit = core.bus.emit;
    core.bus.emit = function <E extends EngineEvents>(
      this: IEventBus,
      channel: EventChannel,
      event: E,
      payload: EventPayloadMap[E],
    ): void {
      const eventName: string = event;
      const isTimedEvent =
        eventName === "DOCUMENT_IMPORTED" ||
        eventName === "NER_STARTED" ||
        eventName === "NER_MODEL_LOADING" ||
        eventName === "NER_MODEL_READY" ||
        eventName === "NER_FINISHED" ||
        eventName === "PIPELINE_READY" ||
        eventName === "PIPELINE_FAILED";
      const emittedAt = isTimedEvent ? performance.now() : null;
      const eventDocumentId = documentIdFromPayload(payload);
      const activeDocument = current?.documentId;
      if (eventName === "DOCUMENT_IMPORTED" && current !== undefined) {
        if (eventDocumentId !== null) current.documentId = eventDocumentId;
        if (emittedAt !== null) markAt("DOCUMENT_IMPORTED", emittedAt);
      } else if (
        eventName === "NER_STARTED" &&
        activeDocument !== undefined &&
        eventDocumentId === activeDocument
      ) {
        if (emittedAt !== null) markAt("NER_STARTED", emittedAt);
      } else if (eventName === "NER_MODEL_LOADING") {
        if (emittedAt !== null) markAt("NER_MODEL_LOADING", emittedAt);
      } else if (eventName === "NER_MODEL_READY") {
        if (emittedAt !== null) markAt("NER_MODEL_READY", emittedAt);
      } else if (
        eventName === "NER_FINISHED" &&
        activeDocument !== undefined &&
        eventDocumentId === activeDocument
      ) {
        if (emittedAt !== null) markAt("NER_FINISHED", emittedAt);
      } else if (
        eventName === "PIPELINE_READY" &&
        activeDocument !== undefined &&
        eventDocumentId === activeDocument
      ) {
        if (emittedAt !== null) {
          markAt("PIPELINE_READY", emittedAt);
          lastReadyAt = emittedAt;
        }
      } else if (
        eventName === "PIPELINE_FAILED" &&
        activeDocument !== undefined &&
        eventDocumentId === activeDocument
      ) {
        if (emittedAt !== null) markAt("PIPELINE_FAILED", emittedAt);
        current?.errors.push("pipeline-failed");
      }
      return originalEmit.call(this, channel, event, payload);
    };
    on(
      "pipeline" as EventChannel,
      "DOCUMENT_IMPORTED" as EngineEvents.DOCUMENT_IMPORTED,
      (payload) => {
        if (current !== undefined) current.documentId = payload.documentId;
      },
    );
    on("pipeline" as EventChannel, "PIPELINE_READY" as EngineEvents.PIPELINE_READY, (payload) => {
      if (current?.documentId !== payload.documentId) return;
      tryPanelMark();
    });
    on("pipeline" as EventChannel, "PIPELINE_FAILED" as EngineEvents.PIPELINE_FAILED, (payload) => {
      if (current?.documentId !== payload.documentId) return;
      // Entry timestamps and failure state were captured before consumers in emit().
    });
    on("pdf" as EventChannel, "DOCUMENT_PARSED" as EngineEvents.DOCUMENT_PARSED, (payload) => {
      if (current?.documentId === payload.documentId) current.pageCount = payload.pageCount;
    });
    on("ocr" as EventChannel, "OCR_PAGE_FINISHED" as EngineEvents.OCR_PAGE_FINISHED, (payload) => {
      if (current !== undefined)
        current.ocrPageSummaries.push([payload.pageIndex, payload.wordCount, payload.confidence]);
    });
    on("ner" as EventChannel, "ENTITY_FOUND" as EngineEvents.ENTITY_FOUND, (payload) => {
      if (current === undefined) return;
      const item: Occurrence = payload.occurrence;
      current.nerSignatures.push(
        JSON.stringify([
          item.pageIndex,
          item.entityType,
          item.value,
          item.normalizedValue,
          item.confidence,
          item.bbox,
          item.fragments ?? null,
        ]),
      );
    });
    const storeGroup = (payload: EntityGroupCreated | EntityGroupUpdated): void => {
      current?.groups.set(payload.group.id, payload.group);
    };
    on(
      "grouping" as EventChannel,
      "ENTITY_GROUP_CREATED" as EngineEvents.ENTITY_GROUP_CREATED,
      storeGroup,
    );
    on(
      "grouping" as EventChannel,
      "ENTITY_GROUP_UPDATED" as EngineEvents.ENTITY_GROUP_UPDATED,
      storeGroup,
    );
    on(
      "grouping" as EventChannel,
      "ENTITY_GROUP_REMOVED" as EngineEvents.ENTITY_GROUP_REMOVED,
      (payload) => {
        current?.groups.delete(payload.groupId);
      },
    );
    on(
      "workers" as EventChannel,
      "WORKER_JOB_DISPATCHED" as EngineEvents.WORKER_JOB_DISPATCHED,
      (payload) => {
        if (current === undefined || payload.type !== "ner-page") return;
        current.activeJobs.add(payload.jobId);
        current.nerJobCount += 1;
        current.peakNerJobs = Math.max(current.peakNerJobs, current.activeJobs.size);
      },
    );
    const finishNerJob = (jobId: string): void => {
      current?.activeJobs.delete(jobId);
    };
    on(
      "workers" as EventChannel,
      "WORKER_JOB_COMPLETED" as EngineEvents.WORKER_JOB_COMPLETED,
      (payload) => finishNerJob(payload.jobId),
    );
    on(
      "workers" as EventChannel,
      "WORKER_JOB_FAILED" as EngineEvents.WORKER_JOB_FAILED,
      (payload) => finishNerJob(payload.jobId),
    );
    on(
      "workers" as EventChannel,
      "WORKER_JOB_CANCELLED" as EngineEvents.WORKER_JOB_CANCELLED,
      (payload) => finishNerJob(payload.jobId),
    );
    on(
      "workers" as EventChannel,
      "WORKER_JOB_TIMEOUT" as EngineEvents.WORKER_JOB_TIMEOUT,
      (payload) => finishNerJob(payload.jobId),
    );
    globalThis.__anonlyNerGapsCollector = {
      beginImport(corpus, sequenceIndex) {
        current = newImport(corpus, sequenceIndex);
        current.marks.selection = current.selectionAt;
        const observer = new MutationObserver(tryPanelMark);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-hidden"],
        });
        current.disconnectObserver = () => observer.disconnect();
      },
      finishImport() {
        current?.disconnectObserver?.();
      },
      async readImport() {
        if (current === undefined) throw new Error("import NER gaps ausente");
        const state = current;
        const candidateRef = globalThis.__anonlyCore;
        if (!isCoreWithContracts(candidateRef))
          throw new Error("core desapareció durante la importación");
        const coreRef: IAnonymizationCore = candidateRef;
        const pageWordCounts: number[] = [];
        const pageCharacterCounts: number[] = [];
        const ocrWordSignatures: string[] = [];
        if (state.documentId !== undefined) {
          for (let pageIndex = 0; pageIndex < state.pageCount; pageIndex += 1) {
            const words = coreRef.orchestrator.getPageWords(state.documentId, pageIndex);
            pageWordCounts.push(words.length);
            pageCharacterCounts.push(words.reduce((total, word) => total + word.text.length, 0));
            for (const word of words) {
              if (word.source === "ocr") {
                ocrWordSignatures.push(
                  JSON.stringify([word.pageIndex, word.text, word.confidence, word.bbox]),
                );
              }
            }
          }
        }
        const groupSignatures = [...state.groups.values()].map((group) =>
          JSON.stringify([
            group.type,
            group.canonicalValue,
            group.replacementValue,
            group.enabled,
            group.replacementMode,
            group.members.map((member) => [
              member.pageIndex,
              member.value,
              member.source,
              member.bbox,
              member.fragments ?? null,
            ]),
          ]),
        );
        const imported = state.marks.DOCUMENT_IMPORTED;
        const ready = state.marks.PIPELINE_READY;
        const panel = state.panelAt;
        const nerStart = state.marks.NER_STARTED;
        const nerEnd = state.marks.NER_FINISHED;
        const loadStart = state.marks.NER_MODEL_LOADING;
        const loadEnd = state.marks.NER_MODEL_READY;
        const interval =
          state.previousReadyAt === null ? null : state.selectionAt - state.previousReadyAt;
        return {
          corpus: state.corpus,
          sequenceIndex: state.sequenceIndex,
          ok: state.marks.PIPELINE_READY !== null && state.marks.PIPELINE_FAILED === null,
          marks: state.marks,
          durationMs: {
            selectionToPanelMs: panel === null ? null : panel - state.selectionAt,
            importedToPanelMs: panel === null || imported === null ? null : panel - imported,
            importedToReadyMs: ready === null || imported === null ? null : ready - imported,
            readyToPanelMs: ready === null || panel === null ? null : panel - ready,
            nerMs: nerStart === null || nerEnd === null ? null : nerEnd - nerStart,
            modelReadyToNerFinishedMs:
              loadEnd === null || nerEnd === null ? null : nerEnd - loadEnd,
            loadMs:
              loadStart === null && loadEnd === null
                ? null
                : loadStart === null || loadEnd === null
                  ? null
                  : loadEnd - loadStart,
          },
          panel: { visible: state.panelVisible, observedAtMs: panel },
          peakNerJobs: state.peakNerJobs,
          ner: { count: state.nerSignatures.length, sha256: await digest(state.nerSignatures) },
          ocr: {
            count: ocrWordSignatures.length,
            sha256: await digest([
              ...ocrWordSignatures,
              ...state.ocrPageSummaries.map((summary) => JSON.stringify(summary)),
            ]),
          },
          grouping: { count: groupSignatures.length, sha256: await digest(groupSignatures) },
          pageCount: state.pageCount,
          pageWordCounts,
          pageCharacterCounts,
          nerJobCount: state.nerJobCount,
          intervalFromPreviousReadyToSelectionMs: interval,
          errors: [...state.errors],
        } satisfies NerGapImport;
      },
      isSettled() {
        return (
          current !== undefined &&
          (current.marks.PIPELINE_READY !== null || current.marks.PIPELINE_FAILED !== null)
        );
      },
      isPanelObserved() {
        return current?.panelAt !== null && current !== undefined;
      },
    };
  });
}

async function writeReport(path: string, report: NerGapsReport, flag: "wx" | "w"): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag });
}

test("NER carga y panel visibles; secuencia real por brazo", async ({ page, electronApp }) => {
  test.skip(
    RUN_ID === undefined || OUTPUT_DIR === undefined,
    "opt-in: ejecutar tests/perf/run-ner-gaps.sh",
  );
  test.setTimeout(60 * 60_000);
  const runId = requiredEnv("ANONLY_NER_GAPS_RUN_ID");
  const outputDir = resolve(requiredEnv("ANONLY_NER_GAPS_OUTPUT_DIR"));
  const parsed = parseRunId(runId);
  const arm = requiredEnv("ANONLY_NER_GAPS_ARM") as NerGapsArm;
  if (arm !== parsed.arm) throw new Error("arm env y run id no coinciden");
  const sequence: ReadonlyArray<NerGapsCorpus> =
    parsed.phase === "preflight" ? [parsed.corpus] : ["R1", "R1", "R2", "R2"];
  const reportPath = resolve(outputDir, `ner-gaps-${runId}.json`);
  await mkdir(outputDir, { recursive: true });
  const pageRef = page;
  const imports: NerGapImport[] = [];
  let activeSequenceIndex = -1;
  const modelFile = resolve(
    "apps/react-client/dist/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx",
  );
  const buildDigest = (await readFile(resolve(outputDir, `digest-${arm}.txt`), "utf8")).trim();
  const versions = await electronApp.evaluate(() => process.versions);
  const base = {
    schemaVersion: 1 as const,
    runId,
    phase: parsed.phase,
    arm,
    block: parsed.phase === "timing" ? parsed.block : null,
    corpus: parsed.phase === "preflight" ? parsed.corpus : null,
    host: {
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      totalMemBytes: os.totalmem(),
      electronVersion: versions.electron ?? "unknown",
      nodeVersion: versions.node ?? "unknown",
    },
    product: {
      commit: requiredEnv("ANONLY_NER_GAPS_COMMIT"),
      dirty: requiredEnv("ANONLY_NER_GAPS_DIRTY") === "1",
      sourceSha256: requiredEnv(`ANONLY_NER_GAPS_SOURCE_SHA_${arm}`),
      buildSha256: buildDigest,
      modelSha256: createHash("sha256")
        .update(await readFile(modelFile))
        .digest("hex"),
      requestedThreads: arm === "A" ? "automatic" : Number(arm),
      observedThreads: null,
    },
    imports,
    completed: false,
    createdAt: new Date().toISOString(),
  } satisfies NerGapsReport;
  const persist = async (): Promise<void> =>
    writeReport(
      reportPath,
      { ...base, imports: [...imports], completed: imports.length === sequence.length },
      "w",
    );
  const initialReport: NerGapsReport = { ...base, imports: [], completed: false };
  await writeReport(reportPath, initialReport, "wx");

  try {
    await openApp(page, "networkidle");
    await installCollector(page);
    for (const [index, corpus] of sequence.entries()) {
      const file = await fileFor(corpus);
      await pageRef.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
      await pageRef.evaluate(
        ({ corpusKey, sequenceIndex }) => {
          globalThis.__anonlyNerGapsCollector?.beginImport(corpusKey, sequenceIndex);
        },
        { corpusKey: corpus, sequenceIndex: index },
      );
      activeSequenceIndex = index;
      await pageRef.locator('input[type="file"]').setInputFiles(file);
      await pageRef.waitForFunction(
        () => globalThis.__anonlyNerGapsCollector?.isSettled() === true,
        undefined,
        { timeout: TIMEOUT_MS },
      );
      await pageRef
        .waitForFunction(
          () => globalThis.__anonlyNerGapsCollector?.isPanelObserved() === true,
          undefined,
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      const collected = await pageRef.evaluate(
        async () => await globalThis.__anonlyNerGapsCollector?.readImport(),
      );
      if (collected === undefined) throw new Error("no se pudo recolectar importación");
      imports.push(collected);
      await pageRef.evaluate(() => globalThis.__anonlyNerGapsCollector?.finishImport());
      activeSequenceIndex = -1;
      await persist();
      const validation = validateNerGapsImport(collected);
      expect(
        validation.reasons,
        `${runId} import ${index + 1}: ${validation.reasons.join(", ")}`,
      ).toEqual([]);
      if (index < sequence.length - 1) {
        const closeButton = pageRef.getByRole("button", { name: "Cerrar documento" });
        await closeButton.click();
        const confirmDialog = pageRef.getByRole("dialog", { name: "Cerrar documento" });
        await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();
        await pageRef.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
      }
    }
  } catch (error) {
    await pageRef
      .evaluate(() => globalThis.__anonlyNerGapsCollector?.finishImport())
      .catch(() => undefined);
    if (activeSequenceIndex >= 0) {
      const partial = await pageRef
        .evaluate(
          async () =>
            await globalThis.__anonlyNerGapsCollector?.readImport().catch(() => undefined),
        )
        .catch(() => undefined);
      if (partial !== undefined) {
        imports.push({
          ...partial,
          ok: false,
          errors: [...partial.errors, error instanceof Error ? error.name : "unknown-error"],
        });
      } else {
        const corpus = sequence[activeSequenceIndex] ?? "R1";
        imports.push({
          corpus,
          sequenceIndex: activeSequenceIndex,
          ok: false,
          marks: {
            selection: null,
            DOCUMENT_IMPORTED: null,
            NER_STARTED: null,
            NER_MODEL_LOADING: null,
            NER_MODEL_READY: null,
            NER_FINISHED: null,
            PIPELINE_READY: null,
            PIPELINE_FAILED: null,
          },
          durationMs: {
            selectionToPanelMs: null,
            importedToPanelMs: null,
            importedToReadyMs: null,
            readyToPanelMs: null,
            nerMs: null,
            modelReadyToNerFinishedMs: null,
            loadMs: null,
          },
          panel: { visible: false, observedAtMs: null },
          peakNerJobs: 0,
          ner: { count: 0, sha256: EMPTY_SHA256 },
          ocr: { count: 0, sha256: EMPTY_SHA256 },
          grouping: { count: 0, sha256: EMPTY_SHA256 },
          pageCount: 0,
          pageWordCounts: [],
          pageCharacterCounts: [],
          nerJobCount: 0,
          intervalFromPreviousReadyToSelectionMs: null,
          errors: [error instanceof Error ? error.name : "unknown-error"],
        });
      }
    }
    if (imports.length === 0) {
      imports.push({
        corpus: sequence[0] ?? "R1",
        sequenceIndex: 0,
        ok: false,
        marks: {
          selection: null,
          DOCUMENT_IMPORTED: null,
          NER_STARTED: null,
          NER_MODEL_LOADING: null,
          NER_MODEL_READY: null,
          NER_FINISHED: null,
          PIPELINE_READY: null,
          PIPELINE_FAILED: null,
        },
        durationMs: {
          selectionToPanelMs: null,
          importedToPanelMs: null,
          importedToReadyMs: null,
          readyToPanelMs: null,
          nerMs: null,
          modelReadyToNerFinishedMs: null,
          loadMs: null,
        },
        panel: { visible: false, observedAtMs: null },
        peakNerJobs: 0,
        ner: { count: 0, sha256: EMPTY_SHA256 },
        ocr: { count: 0, sha256: EMPTY_SHA256 },
        grouping: { count: 0, sha256: EMPTY_SHA256 },
        pageCount: 0,
        pageWordCounts: [],
        pageCharacterCounts: [],
        nerJobCount: 0,
        intervalFromPreviousReadyToSelectionMs: null,
        errors: [error instanceof Error ? error.name : "unknown-error"],
      });
    }
    await persist();
    throw error;
  }
  await persist();
});
