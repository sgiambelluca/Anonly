import type { Document, Word } from "@anonly/shared";
import type { Page } from "@playwright/test";

import type { Arm, Capture } from "./adr190Dpi.js";

export interface BrowserRun {
  capture: Capture;
  caps: Array<{
    documentId: string;
    pageIndex: number;
    originalCap: number | null;
    width: number;
    height: number;
  }>;
  ready: boolean;
  failure: unknown;
  ocrPages: unknown[];
  unreadableInkEvents: unknown[];
  entities: Array<{ value: string; entityType: string; bbox: unknown; pageIndex: number }>;
  regions: unknown[];
}
declare global {
  var __adr190: BrowserRun | undefined;
}

/** Observe transport metadata; retain source OSD bytes only for the scale preflight. */
export async function installTransportObserver(
  page: Page,
  options: {
    readonly retainOrientationInputs?: boolean;
    readonly retainOcrPageInputs?: boolean;
    readonly forceOcrPageOrientation?: 0 | 90 | 180 | 270;
  } = {},
): Promise<void> {
  await page.addInitScript((options) => {
    const capture: Capture = { jobs: [], issues: [], workers: [] };
    if (options.retainOrientationInputs) capture.orientationInputs = [];
    if (options.retainOcrPageInputs) capture.ocrPageInputs = [];
    globalThis.__adr190 = {
      capture,
      caps: [],
      ready: false,
      failure: null,
      ocrPages: [],
      unreadableInkEvents: [],
      entities: [],
      regions: [],
    };
    const Original = globalThis.Worker;
    let sequence = 0;
    const forcedOcrPages = new Set<string>();
    globalThis.Worker = class extends Original {
      private readonly observationId: number;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observationId = ++sequence;
        const id = this.observationId;
        capture.workers.push({ id, url: String(url), createdAt: Date.now(), terminatedAt: null });
        this.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as {
            type?: string;
            jobId?: string;
            result?: unknown;
            error?: unknown;
          };
          if (!["COMPLETED", "FAILED", "CANCELLED"].includes(message.type ?? "")) return;
          if (
            message.type === "COMPLETED" &&
            typeof message.result === "object" &&
            message.result !== null &&
            "ocrRegions" in message.result &&
            Array.isArray(message.result.ocrRegions)
          ) {
            globalThis.__adr190?.regions.push(...(message.result.ocrRegions as unknown[]));
          }
          const job = [...capture.jobs]
            .reverse()
            .find(
              (candidate) =>
                candidate.worker === id &&
                candidate.jobId === message.jobId &&
                candidate.terminal === null,
            );
          if (job === undefined) return; // Other engines use the same transport.
          job.finishedAt = Date.now();
          job.terminal = message.type ?? null;
          job.result = message.result ?? null;
          job.error = message.error ?? null;
        });
      }
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const m = message as {
          type?: string;
          jobType?: string;
          jobId?: string;
          payload?: {
            documentId: string;
            pageIndex: number;
            dpi?: number;
            orientation?: number;
            upscale?: number;
            image: {
              widthPx: number;
              heightPx: number;
              format: string;
              bytes: ArrayBuffer;
            };
          };
        };
        let forwardedMessage = message;
        if (m.type === "RUN" && (m.jobType === "ocr-orient" || m.jobType === "ocr-page")) {
          if (!m.payload || !m.jobId) capture.issues.push("OCR RUN missing payload/jobId");
          else {
            const p = m.payload;
            const forced = m.jobType === "ocr-page" ? options.forceOcrPageOrientation : undefined;
            const pageKey = `${p.documentId}:${p.pageIndex}`;
            const shouldForce = forced !== undefined && !forcedOcrPages.has(pageKey);
            if (m.jobType === "ocr-page") forcedOcrPages.add(pageKey);
            const dispatchedOrientation = shouldForce ? forced : p.orientation;
            capture.jobs.push({
              worker: this.observationId,
              jobId: m.jobId,
              jobType: m.jobType,
              documentId: p.documentId,
              pageIndex: p.pageIndex,
              startedAt: Date.now(),
              finishedAt: null,
              dpi: p.dpi ?? null,
              orientation: p.orientation ?? null,
              dispatchedOrientation: dispatchedOrientation ?? null,
              upscale: p.upscale ?? 1,
              widthPx: p.image.widthPx,
              heightPx: p.image.heightPx,
              imageBytes: p.image.bytes.byteLength,
              terminal: null,
              result: null,
              error: null,
            });
            if (m.jobType === "ocr-orient" && capture.orientationInputs) {
              const bytes = new Uint8Array(p.image.bytes).slice();
              let binary = "";
              const chunkSize = 0x8000;
              for (let offset = 0; offset < bytes.length; offset += chunkSize)
                binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
              capture.orientationInputs.push({
                jobId: m.jobId,
                documentId: p.documentId,
                pageIndex: p.pageIndex,
                widthPx: p.image.widthPx,
                heightPx: p.image.heightPx,
                format: p.image.format,
                bytesBase64: btoa(binary),
              });
            }
            if (m.jobType === "ocr-page") {
              if (shouldForce) forwardedMessage = { ...m, payload: { ...p, orientation: forced } };
              if (capture.ocrPageInputs) {
                const bytes = new Uint8Array(p.image.bytes).slice();
                let binary = "";
                const chunkSize = 0x8000;
                for (let offset = 0; offset < bytes.length; offset += chunkSize)
                  binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                capture.ocrPageInputs.push({
                  jobId: m.jobId,
                  documentId: p.documentId,
                  pageIndex: p.pageIndex,
                  dpi: p.dpi ?? null,
                  sourceOrientation: p.orientation ?? null,
                  dispatchedOrientation: dispatchedOrientation ?? null,
                  widthPx: p.image.widthPx,
                  heightPx: p.image.heightPx,
                  format: p.image.format,
                  bytesBase64: btoa(binary),
                });
              }
            }
          }
        }
        if (Array.isArray(transferOrOptions))
          super.postMessage(forwardedMessage, transferOrOptions);
        else super.postMessage(forwardedMessage, transferOrOptions);
      }
      override terminate(): void {
        const worker = capture.workers.find((candidate) => candidate.id === this.observationId);
        if (worker) worker.terminatedAt = Date.now();
        super.terminate();
      }
    };
  }, options);
}

export async function installDocumentControl(page: Page, arm: Arm): Promise<void> {
  await page.evaluate((selectedArm) => {
    const core = (
      globalThis as unknown as {
        __anonlyCore?: {
          bus: { on(channel: string, event: string, handler: (payload: unknown) => void): unknown };
          orchestrator: { documents: Map<string, Document> };
        };
      }
    ).__anonlyCore;
    const run = globalThis.__adr190;
    if (!core || !run || !(core.orchestrator.documents instanceof Map))
      throw new Error("VITE_E2E documents/observer unavailable");
    const documents = core.orchestrator.documents;
    const originalSet = documents.set.bind(documents);
    const recorded = new Set<string>();
    documents.set = (id, document) => {
      if (!recorded.has(id)) {
        recorded.add(id);
        for (const p of document.pages)
          run.caps.push({
            documentId: id,
            pageIndex: p.index,
            originalCap: p.ocrDpiCap ?? null,
            width: p.width,
            height: p.height,
          });
      }
      // Intentionally identical to removeDpiCaps; serialized evaluate cannot close over imports.
      const inserted =
        selectedArm === "native"
          ? document
          : {
              ...document,
              pages: document.pages.map((p) => {
                if (p.ocrDpiCap === undefined) return p;
                const { ocrDpiCap: _cap, ...withoutCap } = p;
                return withoutCap;
              }),
            };
      return originalSet(id, inserted);
    };
    core.bus.on("pipeline", "PIPELINE_READY", () => {
      run.ready = true;
    });
    core.bus.on("pipeline", "PIPELINE_FAILED", (payload) => {
      run.failure = payload;
    });
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
      run.ocrPages.push(payload);
      if (typeof payload === "object" && payload !== null && "unreadableInk" in payload)
        run.unreadableInkEvents.push(payload);
    });
    core.bus.on("regex", "ENTITY_FOUND", (payload) => {
      const p = payload as { occurrence: BrowserRun["entities"][number] };
      run.entities.push(p.occurrence);
    });
  }, arm);
}

export async function readDocumentRun(
  page: Page,
): Promise<BrowserRun & { words: ReadonlyArray<Word> }> {
  return page.evaluate(() => {
    const run = globalThis.__adr190;
    const core = (
      globalThis as unknown as {
        __anonlyCore: { orchestrator: { documents: Map<string, Document> } };
      }
    ).__anonlyCore;
    if (!run) throw new Error("observer missing");
    return {
      ...run,
      words: [...core.orchestrator.documents.values()].flatMap((document) =>
        document.pages.flatMap((p) => p.words),
      ),
    };
  });
}
