/**
 * M-D1: el observador que corre dentro de la aplicación. Escucha el bus del Core (el hook `__anonlyCore` que
 * expone el build con `VITE_E2E=1`) y, cuando el pipeline llega a `Ready`, devuelve el texto de cada página
 * tal como lo extrajo la app, todas las ocurrencias de cualquier tipo y la configuración efectiva. Todo
 * corre en la página; el lado Node recibe datos en memoria y decide qué se escribe.
 */

import type { Page } from "@playwright/test";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import type { ObservedConfig, ObservedPage, RunObservation } from "./addressHeightRun.js";

interface BrowserState {
  readonly occurrences: Map<string, ObservedOccurrence>;
  ready: boolean;
  failure: unknown;
  nerFinished: boolean;
}

declare global {
  var __addressHeight: BrowserState | undefined;
}

/** Instala los observadores después de que `__anonlyCore` exista y antes de importar el documento. */
export async function installAddressHeightObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: build sin VITE_E2E=1");
    const state: BrowserState = {
      occurrences: new Map(),
      ready: false,
      failure: null,
      nerFinished: false,
    };
    globalThis.__addressHeight = state;
    const collect = (payload: unknown): void => {
      if (typeof payload !== "object" || payload === null || !("occurrence" in payload)) return;
      const occurrence = payload.occurrence;
      if (typeof occurrence !== "object" || occurrence === null) return;
      const item = occurrence as Record<string, unknown>;
      const span = item.wordSpan;
      const spanRecord =
        typeof span === "object" && span !== null ? (span as Record<string, unknown>) : null;
      const id = String(item.id);
      state.occurrences.set(id, {
        id,
        entityType: String(item.entityType),
        value: String(item.value),
        normalizedValue: typeof item.normalizedValue === "string" ? item.normalizedValue : null,
        source: String(item.source),
        confidence: typeof item.confidence === "number" ? item.confidence : null,
        pageIndex: Number(item.pageIndex),
        wordSpan:
          spanRecord !== null &&
          typeof spanRecord.startIndex === "number" &&
          typeof spanRecord.endIndexExclusive === "number"
            ? {
                startIndex: spanRecord.startIndex,
                endIndexExclusive: spanRecord.endIndexExclusive,
              }
            : null,
      });
    };
    core.bus.on("regex", "ENTITY_FOUND", collect);
    core.bus.on("ner", "ENTITY_FOUND", collect);
    core.bus.on("ner", "NER_FINISHED", () => {
      state.nerFinished = true;
    });
    core.bus.on("pipeline", "PIPELINE_READY", () => {
      state.ready = true;
    });
    core.bus.on("pipeline", "PIPELINE_FAILED", (payload) => {
      state.failure = payload ?? true;
    });
  });
}

/** Espera `Ready` o fallo del pipeline. */
export async function waitForPipelineEnd(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = globalThis.__addressHeight;
      return state !== undefined && (state.ready || state.failure !== null);
    },
    undefined,
    { timeout: timeoutMs },
  );
}

export async function readAddressHeightRun(page: Page): Promise<RunObservation> {
  return page.evaluate((): RunObservation => {
    const state = globalThis.__addressHeight;
    if (state === undefined) throw new Error("observador ausente");
    const core = globalThis.__anonlyCore as
      | {
          readonly orchestrator: {
            readonly documents: Map<
              string,
              {
                readonly sourceKind: string;
                readonly pages: ReadonlyArray<{
                  readonly index: number;
                  readonly text: string;
                  readonly requiresOCR: boolean;
                  readonly words: ReadonlyArray<{ readonly text: string }>;
                }>;
              }
            >;
          };
          readonly engines?: {
            readonly ocr?: {
              readonly ctx?: {
                readonly config?: { readonly ner?: { readonly enabled?: boolean } };
              };
            };
          };
        }
      | undefined;
    if (core === undefined) throw new Error("__anonlyCore ausente");
    const documents = [...core.orchestrator.documents.values()];
    const document = documents[0];
    const pages: ObservedPage[] =
      documents.length === 1 && document !== undefined
        ? document.pages.map((page) => ({
            pageIndex: page.index,
            text: page.text,
            words: page.words.map((word) => word.text),
            requiresOCR: page.requiresOCR,
          }))
        : [];
    let preset: string | null = null;
    let overridesPresent = true;
    try {
      const raw = globalThis.localStorage.getItem("anonly:settings");
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && "performancePreset" in parsed)
        preset = String((parsed as { performancePreset: unknown }).performancePreset);
      overridesPresent = globalThis.localStorage.getItem("anonly:engine-overrides") !== null;
    } catch {
      preset = null;
    }
    const nerEnabled = core.engines?.ocr?.ctx?.config?.ner?.enabled;
    const config: ObservedConfig = {
      nerEnabled: typeof nerEnabled === "boolean" ? nerEnabled : null,
      performancePreset: preset,
      engineOverridesPresent: overridesPresent,
    };
    return {
      ready: state.ready,
      pipelineFailure: state.failure,
      nerFinished: state.nerFinished,
      sourceKind: documents.length === 1 && document !== undefined ? document.sourceKind : null,
      pages: documents.length === 1 ? pages : [],
      occurrences: [...state.occurrences.values()],
      config,
    };
  });
}
