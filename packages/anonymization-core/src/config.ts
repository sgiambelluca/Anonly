/**
 * Defaults de `EngineConfig` (Contracts.md §6, "Constantes nombradas") +
 * merge con el `Partial<EngineConfig>` de `createCore(config?)`.
 *
 * Ajuste dinámico por hardware (`07_Performance_Strategy.md` §5.1): si
 * `navigator.deviceMemory < 4` GB o `navigator.hardwareConcurrency < 4`, los
 * pools de OCR/NER bajan a 1 y PDF/Render a 2 ("serializar" OCR y NER en
 * dispositivos chicos). `navigator.deviceMemory` es una extensión no
 * estándar (Device Memory API) ausente de los tipos DOM de TypeScript y del
 * runtime Node de los tests; se lee de forma defensiva.
 */

import type { EngineConfig, WorkerJobType } from "@anonly/shared";

const DEFAULT_TIMEOUTS: Readonly<Record<WorkerJobType, number>> = {
  "pdf-parse": 30_000,
  "ocr-page": 60_000,
  "ner-page": 20_000,
  "render-page": 10_000,
  "export-page": 30_000,
};

const DEFAULT_MAX_RETRIES: Readonly<Record<WorkerJobType, number>> = {
  "pdf-parse": 1,
  "ocr-page": 2,
  "ner-page": 1,
  "render-page": 1,
  "export-page": 1,
};

// ADR-034 §7: default 32 para PDF/Render, 8 para OCR/NER.
const DEFAULT_MAX_QUEUE_PER_POOL: Readonly<Record<"pdf" | "ocr" | "ner" | "render", number>> = {
  pdf: 32,
  ocr: 8,
  ner: 8,
  render: 32,
};

export interface DeviceHints {
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
}

type NavigatorWithDeviceMemory = Navigator & { readonly deviceMemory?: number };

/** Lectura defensiva de las señales de hardware; `{}` si no hay `navigator` (Node, tests). */
export function readDeviceHints(): DeviceHints {
  if (typeof globalThis.navigator === "undefined") return {};
  const nav = globalThis.navigator as NavigatorWithDeviceMemory;
  return {
    ...(nav.deviceMemory !== undefined ? { deviceMemory: nav.deviceMemory } : {}),
    ...(nav.hardwareConcurrency !== undefined
      ? { hardwareConcurrency: nav.hardwareConcurrency }
      : {}),
  };
}

function isLowResourceDevice(hints: DeviceHints): boolean {
  return (
    (hints.deviceMemory !== undefined && hints.deviceMemory < 4) ||
    (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency < 4)
  );
}

function scaledPoolSize(hardwareConcurrency: number | undefined): number {
  const nCpu = hardwareConcurrency ?? 4;
  return Math.min(Math.max(nCpu - 1, 1), 4);
}

export function buildDefaultEngineConfig(hints?: DeviceHints): EngineConfig {
  const resolvedHints = hints ?? readDeviceHints();
  const lowResource = isLowResourceDevice(resolvedHints);

  return {
    workerPool: {
      pdfPoolSize: lowResource ? 2 : scaledPoolSize(resolvedHints.hardwareConcurrency),
      ocrPoolSize: lowResource ? 1 : 2,
      nerPoolSize: lowResource ? 1 : 2,
      renderPoolSize: lowResource ? 2 : scaledPoolSize(resolvedHints.hardwareConcurrency),
      maxQueuePerPool: DEFAULT_MAX_QUEUE_PER_POOL,
      timeouts: DEFAULT_TIMEOUTS,
      maxRetries: DEFAULT_MAX_RETRIES,
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60_000,
    },
    pdf: { maxPageCount: 10_000 },
    ner: {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
  };
}

/**
 * Mergea `overrides` (parcial, de `createCore(config?)`) sobre los defaults.
 * Merge de un nivel por sub-objeto (cada sub-objeto de `EngineConfig` es
 * plano; no hace falta un deep-merge recursivo genérico).
 */
export function mergeEngineConfig(
  overrides?: Partial<EngineConfig>,
  hints?: DeviceHints,
): EngineConfig {
  const base = buildDefaultEngineConfig(hints);
  if (overrides === undefined) return base;
  return {
    workerPool: { ...base.workerPool, ...overrides.workerPool },
    pdf: { ...base.pdf, ...overrides.pdf },
    ner: { ...base.ner, ...overrides.ner },
    ocr: { ...base.ocr, ...overrides.ocr },
    grouping: { ...base.grouping, ...overrides.grouping },
    render: { ...base.render, ...overrides.render },
    export: { ...base.export, ...overrides.export },
  };
}
