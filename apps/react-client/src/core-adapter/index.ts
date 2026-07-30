/**
 * `core-adapter/index.ts` — inicializa el Core y arranca el bus-bridge.
 *
 * Fuente de verdad: docs/ui/React_Client.md §2.1.
 *
 * Wiring de Web Workers reales (ADR-036 §2, Hito 10 PR12/PR13): `@anonly/pdf-engine`
 * fue el primer motor con transporte real — `import PdfWorker from
 * "@anonly/pdf-engine/worker?worker"` (subpath export del propio paquete)
 * solo lo puede resolver Vite (única capa con bundler, `Code_Standards.md`
 * §1); se inyecta acá vía `runtime: { workers: { pdf: () => new PdfWorker() } }`.
 * `@anonly/render-engine` (PR13, ADR-043) es el segundo: mismo patrón,
 * `RenderWorker` corre el kernel de rasterización/composición/encode (la
 * clase `RenderEngine` queda host-side). `@anonly/ocr-engine` (PR14, ADR-045)
 * es el tercero, mismo reparto host/worker que Render: `OcrWorker` corre el
 * kernel de reconocimiento (tesseract.js) sin estado por documento; la clase
 * `OcrEngine` (loop por página, retry, depósito en cache, eventos) queda
 * host-side y despacha por página contra su propia `OcrPool` (construida en
 * `create-core.ts`, no acá — esta factory solo llega hasta esa pool).
 * `@anonly/ner-engine` (PR15, ADR-046) es el cuarto, mismo reparto host/
 * worker: `NerWorker` corre el kernel de inferencia
 * (`@huggingface/transformers`) sin estado por documento; la clase
 * `NerEngine` (loop por página, partición en batches, retry, mapeo bbox,
 * eventos) queda host-side y despacha por batch contra su propia `NerPool`
 * (construida en `create-core.ts`, no acá). `@anonly/export-engine` (PR16,
 * ADR-047) es el quinto y último: `ExportWorker` corre el ensamblador
 * pdf-lib (`append-page`/`save`) — a diferencia de los otros tres, SÍ
 * retiene estado (el `PDFDocument` en construcción, un documento a la vez);
 * la clase `ExportEngine` (validación, loop por página, `RenderPageProvider`,
 * retry/timeout, los cuatro eventos, sanitización, blob URL) queda host-side
 * y despacha contra su propio `WorkerPool` de `size: 1` (construido en
 * `create-core.ts`, no acá).
 */

import {
  createCore,
  type EngineConfigOverrides,
  type IAnonymizationCore,
  type Unsubscribe,
} from "@anonly/anonymization-core";
import ExportWorker from "@anonly/export-engine/worker?worker";
import NerWorker from "@anonly/ner-engine/worker?worker";
import OcrWorker from "@anonly/ocr-engine/worker?worker";
import PdfWorker from "@anonly/pdf-engine/worker?worker";
import RenderWorker from "@anonly/render-engine/worker?worker";

// ADR-039: `onnxruntime-web` (vía `ner-engine`) hace un `import()` dinámico
// ESM de su glue `.mjs`, que Vite rechaza si el archivo vive en `public/`
// (destino previo, ADR-025 punto 3). Movidos a `src/assets/` (ADR-039 §3,
// `assets.lock.json`), la app —única capa con bundler— los resuelve acá con
// `?url` y los inyecta vía `NerConfig.wasmPaths`, mismo patrón que
// `GlobalWorkerOptions.workerSrc` de pdfjs-dist en `main.tsx`.
import ortWasmMjsUrl from "../assets/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "../assets/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm?url";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useViewerStore } from "../store/viewer.store.js";

import { subscribe, type Stores } from "./bus-bridge.js";

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
};

let core: IAnonymizationCore | undefined;
let unsubscribeBridge: Unsubscribe | undefined;

/**
 * Inicializa el Core (idempotente: una llamada repetida devuelve la misma
 * instancia) y suscribe el bus-bridge a los 6 stores. `config` es un override
 * parcial opcional de `EngineConfig` (`EngineConfigOverrides`, ADR-039 —
 * parciales por sección, ya no exige sub-objetos completos), mergeado con la
 * inyección de `ner.wasmPaths` de acá (el caller puede pisarla si alguna vez
 * hiciera falta). Desde PR16.5 (ADR-048 §7 punto 2), el caller (`App.tsx`)
 * deriva ese override de los settings persistidos vía
 * `settingsToEngineConfig.ts` antes de llamar acá — esta función no lee
 * `settings.store` directamente, solo mergea lo que recibe.
 */
export async function initCore(config?: EngineConfigOverrides): Promise<IAnonymizationCore> {
  if (core) return core;
  const mergedConfig: EngineConfigOverrides = {
    ...config,
    ner: { wasmPaths: { wasm: ortWasmUrl, mjs: ortWasmMjsUrl }, ...config?.ner },
  };
  const instance = await createCore(mergedConfig, {
    workers: {
      pdf: () => new PdfWorker(),
      render: () => new RenderWorker(),
      ocr: () => new OcrWorker(),
      ner: () => new NerWorker(),
      export: () => new ExportWorker(),
    },
  });
  unsubscribeBridge = subscribe(instance.bus, stores);
  core = instance;
  return core;
}

export function getCore(): IAnonymizationCore {
  if (!core) throw new Error("Core not initialized");
  return core;
}

/**
 * Libera la instancia actual del Core y desuscribe el bus-bridge. No forma
 * parte del contrato de UI (`React_Client.md` §2.1 no lo declara): existe
 * para poder testear `initCore`/`getCore` de forma aislada entre casos y,
 * eventualmente, para un flujo futuro de recreación del core (ADR-038 §7,
 * `performancePreset` sin documento abierto).
 */
export async function disposeCore(): Promise<void> {
  if (unsubscribeBridge) {
    unsubscribeBridge();
    unsubscribeBridge = undefined;
  }
  if (core) {
    await core.dispose();
    core = undefined;
  }
}
