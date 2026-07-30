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
 * (ver `PipelineOrchestratorOptions.runtime`) para el pool pdf.
 * Ausente => todo in-process, comportamiento idéntico al Hito 9 (parámetro
 * aditivo, no rompe callers existentes).
 *
 * `RenderPool` (ADR-043 §2, Hito 10 PR13), `OcrPool` (ADR-045 §2, Hito 10
 * PR14), `NerPool` (ADR-046 §2/§7, Hito 10 PR15) y `exportPool` (ADR-047 §2,
 * Hito 10 PR16): a diferencia de pdf (cuyo pool lo crea y posee
 * `PipelineOrchestrator`/`WorkerPoolManager`), estas cuatro las construye
 * este façade DIRECTO y se inyectan en el constructor del motor
 * correspondiente — el motor despacha internamente contra su propia pool
 * (`RenderEngine.renderPage`/`rasterizePage`/`loadDocument`/
 * `unloadDocument` convergen en `pool.dispatch`/`pool.broadcast`;
 * `OcrEngine.processPage`/`NerEngine.processPage`/`ExportEngine.export`
 * (internamente, por página y en el `save` final) convergen en
 * `pool.dispatch`). El Orchestrator ya no sostiene ninguna referencia a un
 * pool de render, ocr, ner o export (dejó de envolver esas llamadas, ver
 * `orchestrator.ts#runOcrStage`/`makeRenderPageProvider`/
 * `runDetectionStage`/`runReanalyzeNerOnFlow`/`runReanalyzeOcrFlow`; el
 * campo `exportWorkerFactory` que retenía la factory sin consumidor se
 * retiró en PR16). `onWorkerCreated` de `renderPool` cierra sobre
 * `engines.render` (asignado más abajo, tras construir el objeto `engines`)
 * para re-primear un RenderWorker nuevo/reemplazado con los documentos
 * vigentes ANTES de que acepte jobs (ADR-043 §5); `ocrPool`/`nerPool`/
 * `exportPool` no necesitan el equivalente — ni `ocr-engine` ni `ner-engine`
 * retienen estado por documento (ADR-041 §5/§9, "Ninguno... Libre"), y el
 * único estado con el que carga `export-engine` (el `PDFDocument` en
 * construcción) vive en el propio ExportWorker, no en algo que este façade
 * deba re-enviar.
 *
 * `exportPool` (ADR-047 §2): `WorkerPool` de `size: 1` — no es un quinto pool
 * en el sentido de `05_Worker_Architecture.md` §1.1 (`PoolKey` lo etiqueta
 * "export" solo como identificador interno; `WorkerPoolManager` sigue
 * gestionando únicamente los cuatro pools "de verdad" vía `ManagedPoolKey` —
 * ver `worker-pool.ts`). `maxQueue` usa el literal `EXPORT_QUEUE_LIMIT`
 * (comentario junto a su construcción, más abajo): ADR-047 §2 lo nombra pero
 * no fija un valor.
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

  // ADR-046 §2/§7: tercer espejo de renderPool/ocrPool, sin onWorkerCreated
  // (sin estado por documento que re-primear, ADR-041 §5/§9).
  const nerPool = new WorkerPool({
    poolKey: "ner",
    jobType: "ner-page",
    size: mergedConfig.workerPool.nerPoolSize,
    maxQueue: mergedConfig.workerPool.maxQueuePerPool.ner,
    maxRetries: mergedConfig.workerPool.maxRetries["ner-page"],
    baseRetryDelayMs: mergedConfig.workerPool.baseRetryDelayMs,
    maxRetryDelayMs: mergedConfig.workerPool.maxRetryDelayMs,
    bus,
    logger,
    ...(runtime?.workers?.ner !== undefined ? { workerFactory: runtime.workers.ner } : {}),
  });

  // ADR-047 §2/§7: transporte del ExportWorker único, reusando `WorkerPool`
  // con `size: 1` (espejo de `ocrPool`/`nerPool`; sin onWorkerCreated, sin
  // estado por documento que re-primear — el ensamblador retiene su propio
  // `PDFDocument` del otro lado de la frontera, `export-engine/src/worker/entry.ts`).
  // `EXPORT_QUEUE_LIMIT`: sin fuente documentada de valor (ADR-047 §2 lo
  // nombra pero no lo define; no es una clave nueva de `WorkerPoolConfig`,
  // ADR-036 §1 se conserva). Se usa el mismo default que `ocr`/`ner`
  // (`MAX_QUEUE_PER_POOL`, Contracts.md §6) por ser el pool de tamaño
  // comparable (1-2); reportado como asunción a confirmar en el reporte del PR.
  const EXPORT_QUEUE_LIMIT = 8;
  const exportPool = new WorkerPool({
    poolKey: "export",
    jobType: "export-page",
    size: 1,
    maxQueue: EXPORT_QUEUE_LIMIT,
    maxRetries: mergedConfig.workerPool.maxRetries["export-page"],
    baseRetryDelayMs: mergedConfig.workerPool.baseRetryDelayMs,
    maxRetryDelayMs: mergedConfig.workerPool.maxRetryDelayMs,
    bus,
    logger,
    ...(runtime?.workers?.export !== undefined ? { workerFactory: runtime.workers.export } : {}),
  });

  const engines: AnonymizationCoreEngines = {
    pdf: new PdfEngine(),
    ocr: new OcrEngine(ocrPool),
    regex: new RegexEngine(),
    ner: new NerEngine(nerPool),
    grouping: new GroupingEngine(),
    render: new RenderEngine(renderPool),
    export: new ExportEngine(exportPool),
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
      nerPool.dispose();
      exportPool.dispose();
      await orchestrator.dispose();
      bus.dispose();
    },
  };
}
