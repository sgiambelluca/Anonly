/**
 * Dobles de test compartidos por las suites de los motores del Core (ADR-129).
 *
 * Acá vive **solo lo que era idéntico** entre los ocho `test-helpers.ts`:
 * `createMockLogger` y `createMockCache` lo eran byte a byte en los seis
 * motores, `createMockBus` en los cinco que lo tenían, y el bloque `workerPool`
 * de `createMockConfig` en los seis. Lo propio de cada motor se queda en su
 * paquete.
 *
 * **Nunca se publica ni se bundlea** (`private: true`, `devDependency`): estos
 * dobles usan `vi.fn()`, y por eso no pueden vivir en `@anonly/shared`, que
 * declara "sin dependencias externas" (`Code_Standards.md` §5) y sí se bundlea.
 */

import { createEventBus } from "@anonly/event-system";
import type {
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Unsubscribe,
} from "@anonly/shared";
import { vi } from "vitest";

export function createMockBus(): IEventBus {
  return {
    on: vi.fn((): Unsubscribe => vi.fn()),
    once: vi.fn((): Unsubscribe => vi.fn()),
    off: vi.fn(),
    emit: vi.fn(),
    emitAsync: vi.fn(() => Promise.resolve()),
  };
}

export function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

export function createMockCache(): ICache {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    size: 0,
    bytes: 0,
  };
}

/*
 * Los valores son los que hoy comparten las seis copias. Cada motor sigue
 * pidiendo lo suyo por `overrides` —`ner.modelId`, `ocr.languages`,
 * `render.*`—, que es el mecanismo que esas copias ya usaban; lo que cambia es
 * que el `workerPool` tiene **un solo lugar** donde actualizarse cuando
 * `EngineConfig` gana un campo.
 */
export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 2,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 2,
      maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
      timeouts: {
        "pdf-parse": 30000,
        "ocr-page": 60000,
        "ner-page": 20000,
        "render-page": 10000,
        "export-page": 30000,
      },
      maxRetries: {
        "pdf-parse": 1,
        "ocr-page": 2,
        "ner-page": 1,
        "render-page": 1,
        "export-page": 1,
      },
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60000,
    },
    pdf: { maxPageCount: 10000 },
    ner: {
      modelId: "test",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 1,
      enabled: false,
    },
    ocr: { languages: ["spa"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
    ...overrides,
  };
}

/** `EngineContext` con bus **mockeado**: para los motores que solo verifican qué emitieron. */
export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  const abortController = new AbortController();

  return {
    bus: createMockBus(),
    logger: createMockLogger(),
    cache: createMockCache(),
    abortSignal: abortController.signal,
    config: createMockConfig(),
    ...overrides,
  };
}

/**
 * `EngineContext` con bus **real**.
 *
 * Lo necesita `grouping-engine`, el único motor que además de emitir
 * **consume** eventos: sus tests necesitan un bus que de verdad entregue, no
 * uno que registre llamadas. `render-engine` ya tenía esta segunda forma.
 */
export function createEngineContextWithRealBus(overrides?: Partial<EngineContext>): EngineContext {
  const abortController = new AbortController();
  const logger = createMockLogger();

  return {
    bus: createEventBus({ logger }),
    logger,
    cache: createMockCache(),
    abortSignal: abortController.signal,
    config: createMockConfig(),
    ...overrides,
  };
}
