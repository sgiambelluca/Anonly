/**
 * `createCore()` — composition root del Core (Contracts.md §3.5,
 * `core/Orchestrator.md` §6). Instancia bus, engines, cache/logger y el
 * Orchestrator, inicializa los 7 motores y devuelve el façade listo para usar.
 *
 * Vive en su propio archivo (no en `index.ts`) siguiendo la convención del
 * resto de los paquetes del Core (`Code_Standards.md` §3: "index.ts es el
 * único punto de export"; la lógica va en un archivo aparte).
 */

import { createEventBus, type EventBus } from "@anonly/event-system";
import { ExportEngine } from "@anonly/export-engine";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { OcrEngine } from "@anonly/ocr-engine";
import { PdfEngine } from "@anonly/pdf-engine";
import { RegexEngine } from "@anonly/regex-engine";
import { RenderEngine } from "@anonly/render-engine";
import type { CoreRuntimeOptions, EngineConfigOverrides } from "@anonly/shared";

import { LruCache } from "./cache.js";
import { mergeEngineConfig } from "./config.js";
import { createNullLogger } from "./logger.js";
import { PipelineOrchestrator } from "./orchestrator.js";
import type { AnonymizationCoreEngines, IAnonymizationCore } from "./types.js";
import { WorkerPool } from "./worker-pool.js";

/**
 * Crea una instancia del Core con todos los motores inicializados y el
 * Orchestrator listo para usar (Contracts.md §3.5).
 *
 * `config` se mergea con los defaults de `core/Contracts.md` §6
 * (`Orchestrator.md` §6). Overrides parciales de dos niveles (ADR-039,
 * `EngineConfigOverrides`): cada sección admite un subconjunto de campos —
 * `mergeEngineConfig` ya hace merge por sub-objeto, esto solo expone esa
 * semántica en el tipo (antes `Partial<EngineConfig>`, shallow, exigía
 * secciones completas). El logger inyectado por defecto no usa `console.*`
 * (P-4, ver `src/logger.ts`): la façade no expone un parámetro de logger
 * propio, así que no hay otra fuente posible.
 *
 * `runtime` (Hito 10, ADR-036 §2, Contracts.md §3.5): factories de `Worker`
 * real por `WorkerEntryKind`, forwarded tal cual al `PipelineOrchestrator`
 * (ver `PipelineOrchestratorOptions.runtime`) para los pools pdf/ner.
 * Ausente => todo in-process, comportamiento idéntico al Hito 9 (parámetro
 * aditivo, no rompe callers existentes).
 *
 * `RenderPool` (ADR-043 §2, Hito 10 PR13) y `OcrPool` (ADR-045 §2, Hito 10
 * PR14): a diferencia de pdf/ner (cuyos pools los crea y posee
 * `PipelineOrchestrator`/`WorkerPoolManager`), estas dos las construye este
 * façade DIRECTO y se inyectan en el constructor del motor correspondiente —
 * el motor despacha internamente contra su propia pool
 * (`RenderEngine.renderPage`/`rasterizePage`/`loadDocument`/`unloadDocument`
 * convergen en `pool.dispatch`/`pool.broadcast`; `OcrEngine.processPage`
 * converge en `pool.dispatch`). El Orchestrator ya no sostiene ninguna
 * referencia a un pool de render u ocr (dejó de envolver esas llamadas, ver
 * `orchestrator.ts#runOcrStage`/`makeRenderPageProvider`). `onWorkerCreated`
 * de `renderPool` cierra sobre `engines.render` (asignado más abajo, tras
 * construir el objeto `engines`) para re-primear un RenderWorker nuevo/
 * reemplazado con los documentos vigentes ANTES de que acepte jobs (ADR-043
 * §5); `ocrPool` no necesita el equivalente — `ocr-engine` no retiene estado
 * por documento (ADR-041 §5, "Ninguno... Libre").
 */
export async function createCore(
  config?: EngineConfigOverrides,
  runtime?: CoreRuntimeOptions,
): Promise<IAnonymizationCore> {
  const mergedConfig = mergeEngineConfig(config);
  const logger = createNullLogger();
  const cache = new LruCache();
  const bus: EventBus = createEventBus({ logger });

  // Casillero mutable (no la binding en sí, que sigue siendo `const`, ver
  // `no-prefer-const`): `onWorkerCreated` es una closure diferida (invocada
  // recién cuando el pool crea un worker real, en dispatchRemote/broadcast)
  // que necesita `engines.render` — todavía no existe en este punto (el
  // propio `RenderEngine` recién se construye más abajo, recibiendo esta
  // pool ya armada). Para cuando la closure se invoca de verdad, `.current`
  // ya está seteado.
  const renderEngineRef: { current?: RenderEngine } = {};
  const renderPool = new WorkerPool({
    poolKey: "render",
    jobType: "render-page",
    size: mergedConfig.workerPool.renderPoolSize,
    maxQueue: mergedConfig.workerPool.maxQueuePerPool.render,
    maxRetries: mergedConfig.workerPool.maxRetries["render-page"],
    baseRetryDelayMs: mergedConfig.workerPool.baseRetryDelayMs,
    maxRetryDelayMs: mergedConfig.workerPool.maxRetryDelayMs,
    bus,
    logger,
    ...(runtime?.workers?.render !== undefined ? { workerFactory: runtime.workers.render } : {}),
    onWorkerCreated: () => renderEngineRef.current?.reprimeWorkers() ?? Promise.resolve(),
  });

  // ADR-045 §2: espejo de renderPool, sin onWorkerCreated (sin estado por
  // documento que re-primear, ADR-041 §5).
  const ocrPool = new WorkerPool({
    poolKey: "ocr",
    jobType: "ocr-page",
    size: mergedConfig.workerPool.ocrPoolSize,
    maxQueue: mergedConfig.workerPool.maxQueuePerPool.ocr,
    maxRetries: mergedConfig.workerPool.maxRetries["ocr-page"],
    baseRetryDelayMs: mergedConfig.workerPool.baseRetryDelayMs,
    maxRetryDelayMs: mergedConfig.workerPool.maxRetryDelayMs,
    bus,
    logger,
    ...(runtime?.workers?.ocr !== undefined ? { workerFactory: runtime.workers.ocr } : {}),
  });

  const engines: AnonymizationCoreEngines = {
    pdf: new PdfEngine(),
    ocr: new OcrEngine(ocrPool),
    regex: new RegexEngine(),
    ner: new NerEngine(),
    grouping: new GroupingEngine(),
    render: new RenderEngine(renderPool),
    export: new ExportEngine(),
  };
  renderEngineRef.current = engines.render;

  // ctx "global" para init(): sin operación abortable propia (init() no hace
  // trabajo de larga duración); el AbortController nunca se aborta durante la
  // sesión — cada operación real (process/renderPage/etc.) recibe su propio
  // ctx por documento, con el abortSignal específico de ese documento
  // (ver PipelineOrchestrator.ctxFor).
  const initAbortController = new AbortController();
  const initCtx = {
    bus,
    logger,
    cache,
    abortSignal: initAbortController.signal,
    config: mergedConfig,
  };

  await Promise.all([
    engines.pdf.init(initCtx),
    engines.ocr.init(initCtx),
    engines.regex.init(initCtx),
    engines.ner.init(initCtx),
    engines.grouping.init(initCtx),
    engines.render.init(initCtx),
    engines.export.init(initCtx),
  ]);

  const orchestrator = new PipelineOrchestrator({
    bus,
    logger,
    cache,
    config: mergedConfig,
    engines,
    ...(runtime !== undefined ? { runtime } : {}),
  });

  return {
    bus,
    engines,
    orchestrator,
    dispose: async (): Promise<void> => {
      initAbortController.abort();
      renderPool.dispose();
      ocrPool.dispose();
      await orchestrator.dispose();
      bus.dispose();
    },
  };
}
