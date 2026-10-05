import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import type { SmallRegionCase } from "./ocrSmallRegionCorpus.js";

export interface ProductCaseObservation {
  readonly id: string;
  readonly pageIndex: number;
  readonly sourceDpi: number;
  readonly proposedImageRect: SmallRegionCase["imageRect"];
  readonly proposedRegionPresented: SmallRegionCase["imageRect"];
  readonly actualRegions: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly exclusionCause: string | null;
  readonly requiresOCR: boolean;
  readonly nativeWordCount: number;
  readonly productOcrWordCount: number;
  readonly productOcrText: string;
  readonly pipelineOcrFinishedCount: number;
  readonly source: SmallRegionCase["content"];
  readonly truth: ReadonlyArray<string>;
}

export interface ProductDocumentObservation {
  readonly documentId: string;
  readonly pageCount: number;
  readonly sourceKind: string;
  readonly ready: boolean;
  readonly failure: string | null;
  readonly groups: number | null;
  readonly effectiveSettings: {
    readonly performancePreset: string | null;
    readonly settingsVersion: number | null;
    readonly nerEnabled: boolean | null;
    readonly ocrDpi: number;
    readonly ocrPoolSize: number;
    readonly nerPoolSize: number;
  };
  readonly pages: ReadonlyArray<{
    readonly pageIndex: number;
    readonly widthPt: number;
    readonly heightPt: number;
    readonly requiresOCR: boolean;
    readonly ocrCompleted: boolean;
    readonly nativeWordCount: number;
    readonly productOcrWordCount: number;
    readonly productOcrText: string;
  }>;
  readonly ocrRegions: ReadonlyArray<{
    readonly pageIndex: number;
    readonly bbox: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }>;
  readonly ocrEvents: ReadonlyArray<{ readonly pageIndex: number; readonly wordCount: number }>;
  readonly exportRequests: ReadonlyArray<{
    readonly documentId: string;
    readonly options: unknown;
    readonly observedAtEpochMs: number;
  }>;
}

export interface ForcedOcrObservation {
  readonly documentId: string;
  readonly dpi: number;
  readonly imageCount: number;
  readonly pixels: number;
  readonly durationMs: number;
  readonly results: ReadonlyArray<{
    readonly caseId: string;
    readonly wordCount: number;
    readonly text: string;
    readonly words: ReadonlyArray<{
      readonly text: string;
      readonly bbox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly pageIndex: number;
      readonly confidence: number;
      readonly source: "ocr";
    }>;
    readonly durationMs: number;
  }>;
}

export interface EntityDetectionAudit {
  readonly configuration: {
    readonly regexSensitiveDniMatchObserved: boolean;
    readonly nerEnabled: boolean;
    readonly nerModelId: string;
    readonly nerQuantization: string;
    readonly nerBatchSize: number;
  };
  readonly documentCountBefore: number;
  readonly documentCountAfter: number;
  readonly cases: ReadonlyArray<{
    readonly caseId: string;
    readonly truth: ReadonlyArray<{
      readonly entityType: string;
      readonly normalizedValue: string;
    }>;
    readonly ocrText: string;
    readonly ocrWords: ReadonlyArray<string>;
    readonly regex: {
      readonly status: "completed";
      readonly occurrenceCount: number;
      readonly truePositiveCount: number;
      readonly falsePositiveCount: number;
      readonly occurrences: ReadonlyArray<{
        readonly value: string;
        readonly normalizedValue: string;
        readonly entityType: string;
        readonly source: string;
      }>;
    };
    readonly ner: {
      readonly status: "completed";
      readonly truePositiveCount: number;
      readonly falsePositiveCount: number;
      readonly occurrences: ReadonlyArray<{
        readonly value: string;
        readonly normalizedValue: string;
        readonly entityType: string;
        readonly source: string;
      }>;
    };
  }>;
}

interface StudyTerminal {
  readyDocumentId?: string;
  groupCount?: number;
  failure?: string;
  readyAtEpochMs?: number;
  parsed?: {
    readonly documentId: string;
    readonly pageCount: number;
    readonly sourceKind: string;
  };
  readonly ocrEvents: Array<{
    readonly documentId: string;
    readonly pageIndex: number;
    readonly wordCount: number;
  }>;
  readonly renderEvents: Array<{
    readonly documentId: string;
    readonly pageIndices: ReadonlyArray<number>;
  }>;
  readonly exportRequests: Array<{
    readonly documentId: string;
    readonly options: unknown;
    readonly observedAtEpochMs: number;
  }>;
  readonly unlisten: Array<() => void>;
}

declare global {
  interface Window {
    __smallRegionStudy?: StudyTerminal;
  }
}

export async function installSmallRegionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __anonlyCore?: {
        readonly bus: {
          on(channel: string, event: string, handler: (payload: unknown) => void): () => void;
        };
      };
    };
    const core = scope.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente en la app construida.");
    const state: StudyTerminal = {
      ocrEvents: [],
      renderEvents: [],
      exportRequests: [],
      unlisten: [],
    };
    const subscribe = (
      channel: string,
      event: string,
      handler: (payload: unknown) => void,
    ): void => {
      const unlisten: unknown = core.bus.on(channel, event, handler);
      if (typeof unlisten !== "function")
        throw new Error(`El bus no devolvió cleanup para ${channel}/${event}`);
      state.unlisten.push(() => unlisten());
    };
    subscribe("pdf", "DOCUMENT_PARSED", (value) => {
      if (typeof value !== "object" || value === null) return;
      const payload = value as {
        documentId?: unknown;
        pageCount?: unknown;
        sourceKind?: unknown;
      };
      if (
        typeof payload.documentId === "string" &&
        typeof payload.pageCount === "number" &&
        typeof payload.sourceKind === "string"
      ) {
        state.parsed = {
          documentId: payload.documentId,
          pageCount: payload.pageCount,
          sourceKind: payload.sourceKind,
        };
      }
    });
    subscribe("ocr", "OCR_PAGE_FINISHED", (value) => {
      if (typeof value !== "object" || value === null) return;
      const payload = value as { documentId?: unknown; pageIndex?: unknown; wordCount?: unknown };
      if (
        typeof payload.documentId === "string" &&
        typeof payload.pageIndex === "number" &&
        typeof payload.wordCount === "number"
      ) {
        state.ocrEvents.push({
          documentId: payload.documentId,
          pageIndex: payload.pageIndex,
          wordCount: payload.wordCount,
        });
      }
    });
    subscribe("pipeline", "PIPELINE_READY", (value) => {
      if (typeof value !== "object" || value === null) return;
      const payload = value as { documentId?: unknown; groupCount?: unknown };
      if (typeof payload.documentId === "string") {
        state.readyDocumentId = payload.documentId;
        if (typeof payload.groupCount === "number") state.groupCount = payload.groupCount;
        state.readyAtEpochMs = Date.now();
      }
    });
    subscribe("pipeline", "PIPELINE_FAILED", (value) => {
      state.failure = JSON.stringify(value) ?? "unknown failure";
    });
    subscribe("render", "RENDER_FINISHED", (value) => {
      if (typeof value !== "object" || value === null) return;
      const payload = value as { documentId?: unknown; pageIndices?: unknown };
      if (typeof payload.documentId === "string" && Array.isArray(payload.pageIndices)) {
        const pageIndices = payload.pageIndices.filter(
          (index): index is number => typeof index === "number",
        );
        state.renderEvents.push({ documentId: payload.documentId, pageIndices });
      }
    });
    subscribe("ui", "EXPORT_REQUESTED", (value) => {
      if (typeof value !== "object" || value === null) return;
      const payload = value as { documentId?: unknown; options?: unknown };
      if (typeof payload.documentId === "string") {
        state.exportRequests.push({
          documentId: payload.documentId,
          options: payload.options,
          observedAtEpochMs: Date.now(),
        });
      }
    });
    window.__smallRegionStudy = state;
  });
}

export async function waitForSmallRegionReady(page: Page): Promise<string> {
  await page.waitForFunction(
    () =>
      window.__smallRegionStudy?.readyDocumentId !== undefined ||
      window.__smallRegionStudy?.failure !== undefined,
    undefined,
    { timeout: 600_000 },
  );
  const state = await page.evaluate(() => {
    const study = window.__smallRegionStudy;
    if (study === undefined) throw new Error("observador small region ausente");
    return { documentId: study.readyDocumentId, failure: study.failure };
  });
  if (state.failure !== undefined) throw new Error(`PIPELINE_FAILED: ${state.failure}`);
  if (state.documentId === undefined) throw new Error("PIPELINE_READY sin documentId");
  return state.documentId;
}

export async function observeProductDocument(
  page: Page,
  documentId: string,
): Promise<ProductDocumentObservation> {
  return page.evaluate(
    ({ docId }) => {
      const scope = window as typeof window & {
        __anonlyCore?: {
          readonly orchestrator: {
            readonly documents: Map<
              string,
              {
                readonly id: string;
                readonly sourceKind: string;
                readonly pages: ReadonlyArray<{
                  readonly index: number;
                  readonly width: number;
                  readonly height: number;
                  readonly requiresOCR: boolean;
                  readonly ocrCompleted: boolean;
                  readonly words: ReadonlyArray<{ readonly text: string; readonly source: string }>;
                }>;
              }
            >;
            readonly ocrRegionsByDocument: Map<
              string,
              ReadonlyArray<{
                readonly pageIndex: number;
                readonly bbox: {
                  readonly x: number;
                  readonly y: number;
                  readonly width: number;
                  readonly height: number;
                };
              }>
            >;
          };
          readonly engines: {
            readonly ocr: {
              readonly ctx?: {
                readonly config: {
                  readonly ocr: { readonly dpi: number };
                  readonly ner: { readonly enabled: boolean };
                  readonly workerPool: {
                    readonly ocrPoolSize: number;
                    readonly nerPoolSize: number;
                  };
                };
              };
            };
          };
        };
      };
      const core = scope.__anonlyCore;
      const state = window.__smallRegionStudy;
      const document = core?.orchestrator.documents.get(docId);
      if (core === undefined || state === undefined || document === undefined) {
        throw new Error("No se pudo inspeccionar el documento real del Orchestrator.");
      }
      const regions = core.orchestrator.ocrRegionsByDocument.get(docId) ?? [];
      const ocrEvents = state.ocrEvents
        .filter((event) => event.documentId === docId)
        .map(({ pageIndex, wordCount }) => ({ pageIndex, wordCount }));
      const pages = document.pages.map((page) => {
        const productOcr = page.words.filter((word) => word.source === "ocr");
        return {
          pageIndex: page.index,
          widthPt: page.width,
          heightPt: page.height,
          requiresOCR: page.requiresOCR,
          ocrCompleted: page.ocrCompleted,
          nativeWordCount: page.words.filter((word) => word.source !== "ocr").length,
          productOcrWordCount: productOcr.length,
          productOcrText: productOcr.map((word) => word.text).join(" "),
        };
      });
      const config = core.engines.ocr.ctx?.config;
      const rawSettings = window.localStorage.getItem("anonly:settings");
      let settings: { performancePreset?: unknown; settingsVersion?: unknown } = {};
      try {
        settings = rawSettings === null ? {} : (JSON.parse(rawSettings) as typeof settings);
      } catch {
        settings = {};
      }
      return {
        documentId: docId,
        pageCount: document.pages.length,
        sourceKind: document.sourceKind,
        ready: state.readyDocumentId === docId,
        failure: state.failure ?? null,
        groups: state.groupCount ?? null,
        effectiveSettings: {
          performancePreset:
            typeof settings.performancePreset === "string" ? settings.performancePreset : null,
          settingsVersion:
            typeof settings.settingsVersion === "number" ? settings.settingsVersion : null,
          nerEnabled: config === undefined ? null : config.ner.enabled,
          ocrDpi: config?.ocr.dpi ?? 0,
          ocrPoolSize: config?.workerPool.ocrPoolSize ?? 0,
          nerPoolSize: config?.workerPool.nerPoolSize ?? 0,
        },
        pages,
        ocrRegions: regions.map((region) => ({ pageIndex: region.pageIndex, bbox: region.bbox })),
        ocrEvents,
        exportRequests: state.exportRequests.filter((request) => request.documentId === docId),
      };
    },
    { docId: documentId },
  );
}

export async function forceOcrExcludedRegions(
  page: Page,
  originalDocumentId: string,
  originalPdfBytes: Uint8Array,
  cases: ReadonlyArray<SmallRegionCase>,
  excludedPageIndexes: ReadonlySet<number>,
  releaseWorkersAfter = true,
): Promise<ForcedOcrObservation> {
  const researchDocumentId = `small-region-forced-${randomUUID()}`;
  return page.evaluate(
    async ({ originalId, researchId, caseList, pdfBytes, releaseWorkersAfter }) => {
      type Region = {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      type EncodedPageImage = {
        readonly bytes: ArrayBuffer;
        readonly widthPx: number;
        readonly heightPx: number;
        readonly format: "png" | "jpeg";
      };
      type Request = {
        readonly documentId: string;
        readonly pageIndex: number;
        readonly region: Region;
        readonly dpi: number;
        readonly languages: ReadonlyArray<string>;
        readonly estimatedBytes: number;
      };
      type Output = {
        readonly pageIndex: number;
        readonly words: ReadonlyArray<{
          readonly text: string;
          readonly bbox: {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
          };
          readonly pageIndex: number;
          readonly confidence: number;
          readonly source: "ocr";
        }>;
        readonly durationMs: number;
      };
      type Context = {
        readonly abortSignal: AbortSignal;
        readonly config: {
          readonly ocr: { readonly dpi: number; readonly languages: ReadonlyArray<string> };
        };
      };
      type Core = {
        readonly engines: {
          readonly render: {
            readonly ctx?: Context;
            loadDocument(documentId: string, bytes: Uint8Array): Promise<void>;
            unloadDocument(documentId: string): void;
            rasterizePage(
              documentId: string,
              pageIndex: number,
              scale: number,
              ctx: Context,
              region?: Region,
            ): Promise<EncodedPageImage>;
          };
          readonly ocr: {
            readonly ctx?: Context;
            processSession(
              requests: ReadonlyArray<Request>,
              produce: (request: Request, signal: AbortSignal) => Promise<EncodedPageImage>,
              ctx: Context,
            ): Promise<ReadonlyArray<Output>>;
            releaseIdleWorkers(): void;
          };
        };
      };
      const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
      const renderContext = core?.engines.render.ctx;
      const ocrContext = core?.engines.ocr.ctx;
      if (core === undefined || renderContext === undefined || ocrContext === undefined) {
        throw new Error("Contexto real de Render/OCR no disponible.");
      }
      const selectedCases = caseList;
      const dpi = ocrContext.config.ocr.dpi;
      const originalBytes = Uint8Array.from(atob(pdfBytes), (character) => character.charCodeAt(0));
      const requests: Request[] = selectedCases.map((item, requestIndex) => {
        const region = {
          x: item.imageRect.x,
          y: item.pageHeightPt - item.imageRect.y - item.imageRect.height,
          width: item.imageRect.width,
          height: item.imageRect.height,
        };
        return {
          documentId: researchId,
          pageIndex: requestIndex,
          region,
          dpi,
          languages: ocrContext.config.ocr.languages,
          estimatedBytes:
            Math.ceil((region.width * dpi) / 72) * Math.ceil((region.height * dpi) / 72) * 4,
        };
      });
      let pixels = 0;
      const startedAt = performance.now();
      let outputs: ReadonlyArray<Output> = [];
      let sourceLoaded = false;
      try {
        await core.engines.render.loadDocument(originalId, originalBytes);
        sourceLoaded = true;
        outputs = await core.engines.ocr.processSession(
          requests,
          async (request, signal) => {
            const item = selectedCases[request.pageIndex];
            if (item === undefined)
              throw new Error(`Caso OCR forzado ausente: índice ${request.pageIndex}`);
            const region = request.region;
            const encoded = await core.engines.render.rasterizePage(
              originalId,
              item.pageIndex,
              request.dpi / 72,
              { ...renderContext, abortSignal: signal },
              region,
            );
            pixels += encoded.widthPx * encoded.heightPx;
            return encoded;
          },
          ocrContext,
        );
      } finally {
        if (releaseWorkersAfter) core.engines.ocr.releaseIdleWorkers();
        if (sourceLoaded) core.engines.render.unloadDocument(originalId);
      }
      return {
        documentId: researchId,
        dpi,
        imageCount: outputs.length,
        pixels,
        durationMs: performance.now() - startedAt,
        results: outputs.map((output) => ({
          caseId: selectedCases[output.pageIndex]?.id ?? `page-${output.pageIndex}`,
          wordCount: output.words.length,
          text: output.words.map((word) => word.text).join(" "),
          words: output.words,
          durationMs: output.durationMs,
        })),
      };
    },
    {
      originalId: originalDocumentId,
      researchId: researchDocumentId,
      pdfBytes: Buffer.from(originalPdfBytes).toString("base64"),
      releaseWorkersAfter,
      caseList: cases
        .filter((item) => excludedPageIndexes.has(item.pageIndex))
        .map((item) => ({
          ...item,
          pageHeightPt: item.pageHeightPt,
        })),
    },
  );
}

export async function auditForcedOcrEntityDetectors(
  page: Page,
  forced: ForcedOcrObservation,
  cases: ReadonlyArray<SmallRegionCase>,
): Promise<EntityDetectionAudit> {
  return page.evaluate(
    async ({ forcedResults, caseList }) => {
      type Word = {
        readonly text: string;
        readonly bbox: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        };
        readonly pageIndex: number;
        readonly confidence: number;
        readonly source: "ocr";
      };
      type Occurrence = {
        readonly value: string;
        readonly normalizedValue: string;
        readonly entityType: string;
        readonly source: string;
      };
      type Context = {
        readonly abortSignal: AbortSignal;
        readonly config: {
          readonly ner: {
            readonly enabled: boolean;
            readonly modelId: string;
            readonly quantization: string;
            readonly batchSize: number;
          };
          readonly workerPool: { readonly timeouts: Readonly<Record<string, number>> };
        };
        readonly bus: {
          on(
            channel: string,
            event: string,
            handler: (payload: {
              readonly documentId: string;
              readonly occurrence: Occurrence;
            }) => void,
          ): () => void;
        };
        readonly logger: {
          debug(message: string, meta?: Readonly<Record<string, unknown>>): void;
          info(message: string, meta?: Readonly<Record<string, unknown>>): void;
          warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
          error(message: string, meta?: Readonly<Record<string, unknown>>): void;
        };
        readonly cache: {
          get<T>(key: string): T | undefined;
          set<T>(key: string, value: T, bytes?: number): void;
          delete(key: string): void;
          clear(): void;
          readonly size: number;
          readonly bytes: number;
        };
      };
      type PageInput = {
        readonly documentId: string;
        readonly pageIndex: number;
        readonly text: string;
        readonly words: ReadonlyArray<Word>;
      };
      type Core = {
        readonly engines: {
          readonly regex: {
            readonly ctx?: Context;
            process(
              input: {
                readonly document: {
                  readonly id: string;
                  readonly name: string;
                  readonly pageCount: number;
                  readonly pages: ReadonlyArray<{
                    readonly index: number;
                    readonly width: number;
                    readonly height: number;
                    readonly words: ReadonlyArray<Word>;
                    readonly text: string;
                    readonly requiresOCR: boolean;
                    readonly ocrCompleted: boolean;
                  }>;
                  readonly metadata: {
                    readonly pdfVersion: string;
                    readonly encrypted: boolean;
                    readonly hasForms: boolean;
                  };
                  readonly sourceKind: "scanned";
                  readonly importedAt: number;
                };
              },
              ctx: Context,
            ): Promise<{ readonly occurrenceCount: number }>;
          };
          readonly ner: {
            readonly ctx?: Context;
            processPage(
              input: PageInput,
              ctx: Context,
            ): Promise<{ readonly occurrences: ReadonlyArray<Occurrence> }>;
          };
        };
        readonly orchestrator: { readonly documents: Map<string, unknown> };
      };
      const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
      const regexContext = core?.engines.regex.ctx;
      const nerContext = core?.engines.ner.ctx;
      if (core === undefined || regexContext === undefined || nerContext === undefined) {
        throw new Error("Los contextos reales de Regex/NER no están disponibles.");
      }
      if (!nerContext.config.ner.enabled) {
        throw new Error(
          "NER está deshabilitado; no se puede auditar configuración Intermedio real.",
        );
      }
      const documentCountBefore = core.orchestrator.documents.size;
      const auditCases: EntityDetectionAudit["cases"][number][] = [];
      for (const item of caseList) {
        const source = forcedResults.find((result) => result.caseId === item.id);
        if (source === undefined) throw new Error(`OCR words ausentes para ${item.id}.`);
        const regexDocumentId = `small-region-detector-regex-${item.id}`;
        const nerDocumentId = `small-region-detector-ner-${item.id}`;
        if (
          core.orchestrator.documents.has(regexDocumentId) ||
          core.orchestrator.documents.has(nerDocumentId)
        ) {
          throw new Error("ID de documento de auditoría ya registrado en el pipeline.");
        }
        const words = source.words.map((word) => ({ ...word, pageIndex: 0 }));
        const text = words.map((word) => word.text).join(" ");
        const truth = item.truth.map((normalizedValue) => ({
          entityType: "DNI",
          normalizedValue,
        }));
        const regexOccurrences: Occurrence[] = [];
        const unsubscribe = regexContext.bus.on("regex", "ENTITY_FOUND", (payload) => {
          if (payload.documentId === regexDocumentId) regexOccurrences.push(payload.occurrence);
        });
        let regexCount = 0;
        try {
          const regexResult = await core.engines.regex.process(
            {
              document: {
                id: regexDocumentId,
                name: `${item.id}-isolated-detector-audit.pdf`,
                pageCount: 1,
                pages: [
                  {
                    index: 0,
                    width: item.pageWidthPt,
                    height: item.pageHeightPt,
                    words,
                    text,
                    requiresOCR: false,
                    ocrCompleted: true,
                  },
                ],
                metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
                sourceKind: "scanned",
                importedAt: Date.now(),
              },
            },
            regexContext,
          );
          regexCount = regexResult.occurrenceCount;
        } finally {
          unsubscribe();
        }
        const nerResult = await core.engines.ner.processPage(
          { documentId: nerDocumentId, pageIndex: 0, text, words },
          nerContext,
        );
        const score = (occurrences: ReadonlyArray<Occurrence>) => {
          const truePositiveCount = occurrences.filter((occurrence) =>
            truth.some(
              (expected) =>
                expected.entityType === occurrence.entityType &&
                expected.normalizedValue === occurrence.normalizedValue,
            ),
          ).length;
          return {
            truePositiveCount,
            falsePositiveCount: occurrences.length - truePositiveCount,
            occurrences,
          };
        };
        const regexScore = score(regexOccurrences);
        const nerScore = score(nerResult.occurrences);
        if (regexCount !== regexOccurrences.length) {
          throw new Error(`Conteo de eventos Regex inconsistente para ${item.id}.`);
        }
        auditCases.push({
          caseId: item.id,
          truth,
          ocrText: text,
          ocrWords: words.map((word) => word.text),
          regex: { status: "completed", occurrenceCount: regexCount, ...regexScore },
          ner: { status: "completed", ...nerScore },
        });
      }
      const documentCountAfter = core.orchestrator.documents.size;
      if (documentCountAfter !== documentCountBefore) {
        throw new Error("La auditoría de motores alteró el conjunto de documentos del pipeline.");
      }
      return {
        configuration: {
          regexSensitiveDniMatchObserved: auditCases.some((item) =>
            item.regex.occurrences.some((occurrence) => occurrence.entityType === "DNI"),
          ),
          nerEnabled: nerContext.config.ner.enabled,
          nerModelId: nerContext.config.ner.modelId,
          nerQuantization: nerContext.config.ner.quantization,
          nerBatchSize: nerContext.config.ner.batchSize,
        },
        documentCountBefore,
        documentCountAfter,
        cases: auditCases,
      };
    },
    {
      forcedResults: forced.results,
      caseList: cases.map((item) => ({
        id: item.id,
        truth: item.truth,
        pageWidthPt: item.pageWidthPt,
        pageHeightPt: item.pageHeightPt,
      })),
    },
  );
}

export async function releaseSmallRegionOcrWorkers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = (
      window as typeof window & {
        __anonlyCore?: { readonly engines?: { readonly ocr?: { releaseIdleWorkers(): void } } };
      }
    ).__anonlyCore;
    core?.engines?.ocr?.releaseIdleWorkers();
  });
}

export async function removeSmallRegionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__smallRegionStudy;
    if (state !== undefined) {
      for (const unlisten of state.unlisten) unlisten();
      delete window.__smallRegionStudy;
    }
  });
}
