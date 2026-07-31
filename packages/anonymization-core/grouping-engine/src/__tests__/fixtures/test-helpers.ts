/**
 * Mocks y builders compartidos por los tests de @anonly/grouping-engine.
 *
 * A diferencia de regex-engine/ner-engine (motores que solo EMITEN eventos),
 * Grouping Engine también CONSUME `ENTITY_FOUND`/`REGEX_FINISHED`/
 * `NER_FINISHED` vía `ctx.bus.on(...)` dentro de `init()`. Para ejercitar esa
 * ruta de entrada sin duplicar la lógica de despacho del bus, `createEngineContext`
 * usa el `EventBus` REAL de `@anonly/event-system` (permitido en `__tests__`,
 * excepción explícita de la regla P-2) en vez de un mock de `IEventBus`: los
 * tests emiten `ENTITY_FOUND` con `ctx.bus.emit(...)` y eso dispara el handler
 * registrado por el engine, exactamente como en producción. Las aserciones
 * sobre lo que el engine emite hacia afuera (`ENTITY_GROUP_CREATED`, etc.) se
 * hacen con `vi.spyOn(ctx.bus, "emit")`, que sigue registrando la llamada real
 * (spyOn no reemplaza la implementación por default) — mismo criterio que
 * regex-engine/ner-engine usan sobre su bus mockeado.
 */
import { createEventBus } from "@anonly/event-system";
import {
  DetectionSource,
  EntityType,
  type BoundingBox,
  type EngineConfig,
  type EngineContext,
  type ICache,
  type ILogger,
  type Occurrence,
  type ReplacementMode,
  type Rule,
  type RuleScope,
} from "@anonly/shared";
import { vi } from "vitest";

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
      modelId: "test-model",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
    ...overrides,
  };
}

export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
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

let occurrenceSeq = 0;

export function makeBBox(x = 10, y = 100, width = 60, height = 12): BoundingBox {
  return { x, y, width, height };
}

/**
 * Construye una `Occurrence` válida con defaults razonables (tipo DNI). Cada
 * llamada sin `id` explícito genera uno distinto (`occ-N`) para que las
 * aserciones que comparan `members`/`occurrenceId` no choquen entre tests.
 *
 * El `bbox` por defecto varía por llamada (`y` corrido por `occurrenceSeq`):
 * dos `Occurrence` sin bbox explícito representan ubicaciones DISTINTAS del
 * documento (ADR-038 §3: la identidad de dedup es (entityType, pageIndex,
 * bbox, normalizedValue) con igualdad estricta de bbox — dos llamadas con el
 * mismo bbox por "casualidad" del default colisionarían con el invariante de
 * dedup permanente). Los tests que necesitan a propósito el MISMO bbox
 * (overlap/disagree, o el propio test de dedup) lo pasan explícito vía
 * `overrides.bbox`, que siempre gana sobre este default.
 */
export function makeOccurrence(overrides?: Partial<Occurrence>): Occurrence {
  occurrenceSeq += 1;
  return {
    id: `occ-${occurrenceSeq}`,
    value: "34.567.891",
    normalizedValue: "34567891",
    bbox: makeBBox(10, 100 + occurrenceSeq * 20, 60, 12),
    pageIndex: 0,
    source: DetectionSource.Regex,
    confidence: 1.0,
    entityType: EntityType.DNI,
    ...overrides,
  };
}

let ruleSeq = 0;

/** Construye una `Rule` válida. `scope`/`target.kind` siempre coinciden. */
export function makeRule(
  scope: RuleScope,
  mode: ReplacementMode,
  options?: {
    readonly groupId?: string;
    readonly entityType?: EntityType;
    readonly priority?: number;
    readonly enabled?: boolean;
  },
): Rule {
  ruleSeq += 1;
  const now = Date.now();
  return {
    id: `rule-${ruleSeq}`,
    scope,
    target: {
      kind: scope,
      ...(options?.groupId !== undefined ? { groupId: options.groupId } : {}),
      ...(options?.entityType !== undefined ? { entityType: options.entityType } : {}),
    },
    mode,
    priority: options?.priority ?? 1,
    enabled: options?.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}
