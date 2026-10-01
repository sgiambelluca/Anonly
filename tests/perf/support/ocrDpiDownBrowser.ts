/**
 * Observador de la fase 1 de la campaña de DPI descendente: reusa el de ADR-190 (despachos
 * `ocr-page`, topes de página, Ready, entidades de Regex) y suma las entidades de NER, la
 * confirmación de que NER corrió y la configuración efectiva del Core. Todo corre en la página; el
 * lado Node recibe datos en memoria y decide qué se escribe.
 */

import type { Page } from "@playwright/test";

import { installDocumentControl, readDocumentRun, type BrowserRun } from "./adr190Browser.js";

export interface EffectiveConfig {
  readonly ocrDpi: number | null;
  readonly ocrPoolSize: number | null;
  readonly maxLiveImageBytes: number | null;
  readonly nerEnabled: boolean | null;
}

interface NerState {
  readonly nerEntities: BrowserRun["entities"];
  nerStarted: boolean;
  nerFinished: boolean;
}

declare global {
  var __ocrDpiDown: NerState | undefined;
}

/** Instala los observadores después de que `__anonlyCore` exista y antes de importar el documento. */
export async function installDpiDownObserver(page: Page): Promise<EffectiveConfig> {
  await installDocumentControl(page, "native");
  return page.evaluate((): EffectiveConfig => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: build sin VITE_E2E=1");
    const state: NerState = { nerEntities: [], nerStarted: false, nerFinished: false };
    globalThis.__ocrDpiDown = state;
    core.bus.on("ner", "NER_STARTED", () => {
      state.nerStarted = true;
    });
    core.bus.on("ner", "NER_FINISHED", () => {
      state.nerFinished = true;
    });
    core.bus.on("ner", "ENTITY_FOUND", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("occurrence" in payload)) return;
      const occurrence = payload.occurrence;
      if (typeof occurrence !== "object" || occurrence === null) return;
      const item = occurrence as Record<string, unknown>;
      state.nerEntities.push({
        value: String(item.value),
        entityType: String(item.entityType),
        bbox: item.bbox,
        pageIndex: Number(item.pageIndex),
      });
    });
    const instrumented = core as typeof core & {
      readonly engines?: {
        readonly ocr?: {
          readonly ctx?: {
            readonly config?: {
              readonly workerPool?: { readonly ocrPoolSize?: number };
              readonly ocr?: { readonly dpi?: number; readonly maxLiveImageBytes?: number };
              readonly ner?: { readonly enabled?: boolean };
            };
          };
        };
      };
    };
    const config = instrumented.engines?.ocr?.ctx?.config;
    return {
      ocrDpi: typeof config?.ocr?.dpi === "number" ? config.ocr.dpi : null,
      ocrPoolSize:
        typeof config?.workerPool?.ocrPoolSize === "number" ? config.workerPool.ocrPoolSize : null,
      maxLiveImageBytes:
        typeof config?.ocr?.maxLiveImageBytes === "number" ? config.ocr.maxLiveImageBytes : null,
      nerEnabled: typeof config?.ner?.enabled === "boolean" ? config.ner.enabled : null,
    };
  });
}

export interface DpiDownRun {
  readonly run: Awaited<ReturnType<typeof readDocumentRun>>;
  readonly regexEntities: BrowserRun["entities"];
  readonly nerEntities: BrowserRun["entities"];
  readonly nerStarted: boolean;
  readonly nerFinished: boolean;
}

export async function readDpiDownRun(page: Page): Promise<DpiDownRun> {
  const run = await readDocumentRun(page);
  const ner = await page.evaluate(() => {
    const state = globalThis.__ocrDpiDown;
    if (state === undefined) throw new Error("observador de NER ausente");
    return {
      nerEntities: state.nerEntities,
      nerStarted: state.nerStarted,
      nerFinished: state.nerFinished,
    };
  });
  return { run, regexEntities: run.entities, ...ner };
}
