import type { Page } from "@playwright/test";

export interface RcN1Job {
  readonly workerId: number;
  readonly jobId: string;
  readonly jobType: "ocr-orient" | "ocr-page";
  readonly documentId: string;
  readonly pageIndex: number;
  readonly dpi: number | null;
  readonly orientation: number | null;
  readonly dispatchedOrientation: number | null;
  readonly upscale: number;
  readonly imageBase64: string;
  terminal: string | null;
  result: unknown;
}

export interface RcN1Run {
  ready: boolean;
  failure: unknown;
  jobs: RcN1Job[];
  unreadable: unknown[];
  entities: Array<{ value: string; bbox: unknown; pageIndex: number }>;
  cacheEvents: Array<{ key: string; pageIndex: number; wordCount: number }>;
  deliveredWords: Array<{ text: string; confidence: number }>;
}

interface RcN1CoreView {
  readonly bus: {
    on(channel: string, event: string, callback: (payload: unknown) => void): () => void;
  };
  readonly orchestrator: {
    readonly cache: { get<T>(key: string): T | undefined };
    readonly documents: ReadonlyMap<
      string,
      {
        readonly pages: ReadonlyArray<{
          readonly index: number;
          readonly words: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
        }>;
      }
    >;
  };
}

declare global {
  var __rcN1: RcN1Run | undefined;
  var __anonlyCore: RcN1CoreView | undefined;
}

/** Observe natural worker traffic without changing either the payload or result. */
export async function installRcN1TransportObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const run: RcN1Run = {
      ready: false,
      failure: null,
      jobs: [],
      unreadable: [],
      entities: [],
      cacheEvents: [],
      deliveredWords: [],
    };
    globalThis.__rcN1 = run;
    const OriginalWorker = globalThis.Worker;
    let workerSequence = 0;
    globalThis.Worker = class extends OriginalWorker {
      private readonly observerWorkerId: number;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observerWorkerId = ++workerSequence;
        this.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as {
            type?: string;
            jobId?: string;
            result?: unknown;
          };
          if (!message.jobId || !["COMPLETED", "FAILED", "CANCELLED"].includes(message.type ?? ""))
            return;
          const job = [...run.jobs]
            .reverse()
            .find(
              (candidate) =>
                candidate.jobId === message.jobId &&
                candidate.terminal === null &&
                candidate.workerId === this.observerWorkerId,
            );
          if (job === undefined) return;
          job.terminal = message.type ?? null;
          job.result = message.result ?? null;
        });
      }

      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const request = message as {
          type?: string;
          jobType?: string;
          jobId?: string;
          payload?: {
            documentId: string;
            pageIndex: number;
            dpi?: number;
            orientation?: number;
            upscale?: number;
            image: { widthPx: number; heightPx: number; format: string; bytes: ArrayBuffer };
          };
        };
        if (
          request.type === "RUN" &&
          (request.jobType === "ocr-orient" || request.jobType === "ocr-page") &&
          request.jobId &&
          request.payload
        ) {
          const payload = request.payload;
          let binary = "";
          const bytes = new Uint8Array(payload.image.bytes);
          for (let offset = 0; offset < bytes.length; offset += 0x8000)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          run.jobs.push({
            workerId: this.observerWorkerId,
            jobId: request.jobId,
            jobType: request.jobType,
            documentId: payload.documentId,
            pageIndex: payload.pageIndex,
            dpi: payload.dpi ?? null,
            orientation: payload.orientation ?? null,
            dispatchedOrientation: payload.orientation ?? null,
            upscale: payload.upscale ?? 1,
            imageBase64: btoa(binary),
            terminal: null,
            result: null,
          });
        }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    };
  });
}

/** Attach after app startup, before importing a fixture. */
export async function attachRcN1DocumentObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const run = globalThis.__rcN1;
    const core = globalThis.__anonlyCore;
    if (
      run === undefined ||
      core === undefined ||
      typeof core.orchestrator.cache?.get !== "function"
    )
      throw new Error("RC N1 observer or orchestrator cache unavailable");
    core.bus.on("pipeline", "PIPELINE_READY", () => {
      run.ready = true;
    });
    core.bus.on("pipeline", "PIPELINE_FAILED", (payload) => {
      run.failure = payload;
    });
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
      const event = payload as {
        documentId?: unknown;
        pageIndex?: unknown;
        wordCount?: unknown;
        unreadableInk?: unknown;
      };
      if (event.unreadableInk === true) run.unreadable.push(payload);
      if (typeof event.documentId === "string" && typeof event.pageIndex === "number") {
        const key = "ocr-words:" + event.documentId + ":" + event.pageIndex;
        const cached = core.orchestrator.cache.get<ReadonlyArray<{ text: string }>>(key);
        run.cacheEvents.push({
          key,
          pageIndex: event.pageIndex,
          wordCount: Array.isArray(cached) ? cached.length : -1,
        });
      }
    });
    for (const channel of ["regex", "ner"])
      core.bus.on(channel, "ENTITY_FOUND", (payload) => {
        const occurrence = (payload as { occurrence?: RcN1Run["entities"][number] }).occurrence;
        if (occurrence !== undefined) run.entities.push(occurrence);
      });
  });
}

export async function readRcN1Run(page: Page): Promise<RcN1Run> {
  return page.evaluate(() => {
    if (globalThis.__rcN1 === undefined || globalThis.__anonlyCore === undefined)
      throw new Error("RC N1 observer unavailable");
    return {
      ...globalThis.__rcN1,
      deliveredWords: [...globalThis.__anonlyCore.orchestrator.documents.values()].flatMap(
        (document) => document.pages.flatMap((page) => page.words),
      ),
    };
  });
}

/** Reset only after the prior document was exported and closed. */
export async function resetRcN1Run(page: Page): Promise<void> {
  await page.evaluate(() => {
    const run = globalThis.__rcN1;
    if (run === undefined) throw new Error("RC N1 observer unavailable");
    run.ready = false;
    run.failure = null;
    run.jobs.length = 0;
    run.unreadable.length = 0;
    run.entities.length = 0;
    run.cacheEvents.length = 0;
    run.deliveredWords.length = 0;
  });
}
