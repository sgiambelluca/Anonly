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
  type EngineConfig,
  type EngineConfigOverrides,
  type IAnonymizationCore,
  type Unsubscribe,
  type WorkerJobType,
} from "@anonly/anonymization-core";
import ExportWorker from "@anonly/export-engine/worker?worker";
import NerWorker from "@anonly/ner-engine/worker?worker";
import OcrOrientationWorker from "@anonly/ocr-engine/orientation-worker?worker";
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
import { useUnreadableInkStore } from "../store/unreadableInk.store.js";
import { useViewerStore } from "../store/viewer.store.js";

import { subscribe, type Stores } from "./bus-bridge.js";
import { sameEngineConfigOverrides } from "./settingsToEngineConfig.js";

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
  unreadableInk: useUnreadableInkStore,
  getPreviewInteractionRevision: (documentId, pageIndex) =>
    core?.orchestrator.getPreviewInteractionRevision(documentId, pageIndex) ?? null,
};

let core: IAnonymizationCore | undefined;
let unsubscribeBridge: Unsubscribe | undefined;

/**
 * Un `Promise` con `resolve`/`reject` expuestos afuera de su executor —
 * permite a `getCoreAsync` (abajo) esperar la instancia sin poder disparar su
 * creación. Se recrea en cada intento de `createCore` (éxito o fallo, ver
 * `initCore`) para no dejar colgado a un `getCoreAsync` llamado *antes* de
 * que exista ningún intento en curso.
 */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Bug PR17.3: dos consumidores (`App.tsx`, con los overrides de
// `settings.store`, y `PasswordDialog.tsx`, sin config, solo para `core.bus`)
// llaman a este módulo desde sus propios `useEffect` de montaje. En React,
// los efectos de los hijos corren antes que los del padre en el mismo commit
// (`PasswordDialog` es descendiente de `App`) — así que, sin coordinación, el
// caller *sin* config podía ganar la carrera de inicialización y el
// `EngineConfigOverrides` de `App.tsx` (PR16.5, ADR-048 §7 punto 2) se perdía
// en silencio. `creationStarted` + `deferredCore` separan "quién tiene
// autoridad para arrancar `createCore()` con qué config" (solo `initCore`,
// primer caller en ejecutar su cuerpo síncrono) de "quién solo quiere
// esperar la instancia ya en curso" (`getCoreAsync`, que nunca llama
// `createCore`) — el resultado no depende del orden de montaje.
let creationStarted = false;

/**
 * El override con el que se creó el Core vivo (ADR-194 §9), antes de mezclar
 * los overrides de medición. Sale de acá y no del store porque el store ya
 * cambió cuando se necesita compararlo.
 */
let liveOverrides: EngineConfigOverrides | undefined;
/** La recreación en curso al cerrar un documento, si hay una (ADR-194 §9). */
let pendingRecreation: Promise<void> | undefined;
let deferredCore = createDeferred<IAnonymizationCore>();

/**
 * Inicializa el Core (idempotente: una llamada repetida devuelve la misma
 * instancia) y suscribe el bus-bridge a los 6 stores. `config` es un override
 * parcial opcional de `EngineConfig` (`EngineConfigOverrides`, ADR-039 —
 * parciales por sección, ya no exige sub-objetos completos). Desde PR16.5
 * (ADR-048 §7 punto 2), el caller (`App.tsx`) deriva ese override de los
 * settings persistidos vía `settingsToEngineConfig.ts` antes de llamar acá —
 * esta función no lee `settings.store` directamente, solo mergea lo que
 * recibe con, en orden de prioridad creciente: la inyección de
 * `ner.wasmPaths` de acá (el caller puede pisarla si alguna vez hiciera
 * falta) y el canal de overrides del arnés de medición (`readTestEngineOverrides`,
 * ADR-155 — solo activo bajo `DEV`/`VITE_E2E`).
 *
 * Única función con potestad para arrancar `createCore()` — hoy solo
 * `App.tsx` la llama (con `config`). Cualquier otro consumidor que solo
 * necesite la instancia ya en curso (p. ej. `PasswordDialog.tsx`, que solo
 * usa `core.bus`) debe llamar a `getCoreAsync()`, no a esta función: así el
 * `config` de `App.tsx` llega siempre a `createCore()`, sin importar el orden
 * de montaje (PR17.3).
 */
/**
 * Expone la instancia del Core en `window` **solo en dev** para el harness de
 * medición (`tests/measure/`, corre contra el dev server que levanta
 * Playwright).
 *
 * Por qué existe: medir calidad de detección y tiempos por etapa necesita el
 * `bus` —tipo, valor y página de cada entidad, con marca de tiempo— y eso no
 * está en el DOM: el árbol de entidades renderiza el valor canónico de cada
 * grupo pero no su página, así que raspar la UI mediría una renderización, no
 * una detección. `IAnonymizationCore.bus` ya es público (`types.ts`), o sea
 * que esto no expone nada que el contrato no exponga.
 *
 * `import.meta.env.DEV` es una constante que Vite reemplaza literalmente, así
 * que en el build de producción el cuerpo entero se elimina por dead-code
 * elimination: no llega al bundle.
 *
 * **`VITE_E2E` existe porque los E2E dejaron de correr contra el dev server.**
 * Desde ADR-130 corren contra el contenedor, y el contenedor sirve el build de
 * producción — donde esta función ya no existe. Sin la bandera, el escenario
 * que verifica ADR-125 (recrear el core al guardar settings sin documento
 * abierto) no tiene forma de observar la identidad de la instancia.
 *
 * La bandera la pone **solo** `pnpm test:e2e`. El workflow de release no la
 * define, así que el instalador que baja un usuario sigue sin esta función:
 * `import.meta.env.VITE_E2E` es `undefined` ahí y el cuerpo se elimina igual.
 * El costo, que hay que nombrarlo: el binario que prueban los E2E no es
 * byte-a-byte el que se publica — difiere en esta función y en nada más.
 */
function exposeCoreForMeasurement(instance: IAnonymizationCore): void {
  /*
   * Notación de **punto** y no de corchetes. Vite reemplaza `import.meta.env.X`
   * literalmente en el build; con `import.meta.env["X"]` no lo hace, queda una
   * búsqueda en runtime, y entonces la condición entera deja de ser
   * eliminable. Verificado: con corchetes, `__anonlyCore` y `VITE_E2E`
   * aparecían en el bundle de release — o sea el instalador exponía la
   * instancia del Core, que es exactamente lo que esta función promete no
   * hacer fuera de desarrollo.
   */
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== "1") return;
  (globalThis as { __anonlyCore?: IAnonymizationCore }).__anonlyCore = instance;
}

const ENGINE_OVERRIDES_STORAGE_KEY = "anonly:engine-overrides";
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tipos de valor que el canal de overrides valida. Los dos mapas anidados
 * (`jobNumberMap`, `poolNumberMap`) son los `Record` de `WorkerPoolConfig`:
 * exigen **todas** sus claves, porque el merge del Core es por sección y un
 * mapa incompleto borraría los job types que falten.
 */
type OverrideType =
  | "number"
  | "string"
  | "boolean"
  | "stringArray"
  | "quantization"
  | "imageFormat"
  | "wasmPaths"
  | "jobNumberMap"
  | "poolNumberMap";

/**
 * Un tipo por campo de **cada** sección de `EngineConfig`, y el compilador lo
 * exige: si el Core agrega un campo (o una sección), esta tabla deja de
 * compilar hasta que se lo declare acá; si se borra uno, la clave sobrante
 * también falla (exceso de propiedades). `-?` incluye los campos opcionales,
 * como `ner.wasmPaths`.
 */
type OverrideFieldTypes = {
  readonly [S in keyof EngineConfig]: { readonly [F in keyof EngineConfig[S]]-?: OverrideType };
};

const ENGINE_OVERRIDE_FIELDS = {
  workerPool: {
    pdfPoolSize: "number",
    ocrPoolSize: "number",
    nerPoolSize: "number",
    renderPoolSize: "number",
    maxQueuePerPool: "poolNumberMap",
    timeouts: "jobNumberMap",
    maxRetries: "jobNumberMap",
    baseRetryDelayMs: "number",
    maxRetryDelayMs: "number",
    cancelSlaMs: "number",
    idleDisposeMs: "number",
    nerIdleDisposeMs: "number",
  },
  pdf: { maxPageCount: "number" },
  ner: {
    modelId: "string",
    quantization: "quantization",
    confidenceThreshold: "number",
    batchSize: "number",
    enabled: "boolean",
    wasmPaths: "wasmPaths",
  },
  ocr: { languages: "stringArray", dpi: "number", maxLiveImageBytes: "number" },
  grouping: { similarityThreshold: "number", minAliasFrequency: "number" },
  render: {
    previewScale: "number",
    fullScale: "number",
    jpegQuality: "number",
    cachePages: "number",
  },
  export: { defaultDpi: "number", defaultImageFormat: "imageFormat", defaultJpegQuality: "number" },
} as const satisfies OverrideFieldTypes;

const ENGINE_CONFIG_SECTIONS: ReadonlySet<string> = new Set(Object.keys(ENGINE_OVERRIDE_FIELDS));

/** Las claves de cada mapa anidado, verificadas contra `WorkerJobType` y los pools de `WorkerPoolConfig`. */
const JOB_TYPE_KEYS = [
  "pdf-parse",
  "ocr-page",
  "ocr-orient",
  "ner-page",
  "render-page",
  "export-page",
] as const satisfies ReadonlyArray<WorkerJobType>;
const POOL_KEYS = ["pdf", "ocr", "ner", "render"] as const satisfies ReadonlyArray<
  keyof EngineConfig["workerPool"]["maxQueuePerPool"]
>;

// Cierra el "satisfies" de arriba en el otro sentido: sin esto, agregar un
// `WorkerJobType` (o un pool) nuevo no obligaría a actualizar las listas, y el
// canal aceptaría mapas sin la clave nueva.
type MissingJobTypes = Exclude<WorkerJobType, (typeof JOB_TYPE_KEYS)[number]>;
type MissingPoolKeys = Exclude<
  keyof EngineConfig["workerPool"]["maxQueuePerPool"],
  (typeof POOL_KEYS)[number]
>;
const KEYS_ARE_COMPLETE: [MissingJobTypes, MissingPoolKeys] extends [never, never] ? true : never =
  true;
void KEYS_ARE_COMPLETE;

/** Objeto plano con **exactamente** `keys` y un número finito en cada una. */
function isCompleteNumberMap(value: unknown, keys: ReadonlyArray<string>): boolean {
  return (
    isPlainObject(value) &&
    keys.every((key) => key in value) &&
    Object.entries(value).every(
      ([key, item]) => keys.includes(key) && typeof item === "number" && Number.isFinite(item),
    )
  );
}

function matchesOverrideType(type: OverrideType, value: unknown): boolean {
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "stringArray":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "quantization":
      return value === "q8" || value === "q4" || value === "f32";
    case "imageFormat":
      return value === "png" || value === "jpeg";
    case "wasmPaths":
      return (
        typeof value === "string" ||
        (isPlainObject(value) &&
          Object.entries(value).every(
            ([key, item]) => (key === "wasm" || key === "mjs") && typeof item === "string",
          ))
      );
    case "jobNumberMap":
      return isCompleteNumberMap(value, JOB_TYPE_KEYS);
    case "poolNumberMap":
      return isCompleteNumberMap(value, POOL_KEYS);
  }
}

function isValidOverrideSection(section: string, value: Record<string, unknown>): boolean {
  // `Object.hasOwn`: una clave como "constructor" o "__proto__" no es una sección.
  if (!Object.hasOwn(ENGINE_OVERRIDE_FIELDS, section)) return false;
  const fields: Readonly<Record<string, OverrideType>> =
    ENGINE_OVERRIDE_FIELDS[section as keyof typeof ENGINE_OVERRIDE_FIELDS];
  return Object.entries(value).every(([key, fieldValue]) => {
    if (!Object.hasOwn(fields, key)) return false;
    const expectedType = fields[key];
    return expectedType !== undefined && matchesOverrideType(expectedType, fieldValue);
  });
}

/**
 * Canal de overrides del arnés de medición (ADR-155, autorizado por el
 * planificador para H-10: atribuir memoria pool por pool exige mover
 * `ocrPoolSize`/`nerPoolSize`/etc. por separado, y el único lever expuesto a
 * los settings del usuario es el preset bucketado — ver
 * `settingsToEngineConfig.ts`). Documentado también en `React_Client.md` §3.7
 * y `tests/perf/README.md`: la documentación es condición de la
 * autorización, no un extra (`Post_Hito10.8_Pendientes.md` §30 — la misma
 * deuda que dejó `nerEnabled` vivo solo para los tests, ahora escrita antes
 * de repetirse).
 *
 * Reglas de ADR-155 §2, las cuatro no negociables:
 * - Se lee **una sola vez**, acá, en el boot — no hay setter ni suscripción.
 * - **Falla cerrado y en silencio**: JSON inválido, algo que no sea un
 *   objeto plano, una clave fuera de `EngineConfig`, o una sección que no sea
 *   un objeto, descartan el valor **entero** — no se aplica parcialmente — y
 *   el boot sigue con los settings normales.
 * - No es una preferencia: no vive en `SettingsSlice`, la app nunca la
 *   escribe, no tiene control de UI.
 * - No hay tipo nuevo: el valor es un `EngineConfigOverrides` (ADR-039), el
 *   mismo que `createCore` ya acepta.
 */
function readTestEngineOverrides(): EngineConfigOverrides | undefined {
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== "1") return undefined;
  try {
    const raw = window.localStorage.getItem(ENGINE_OVERRIDES_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return undefined;
    for (const [key, value] of Object.entries(parsed)) {
      if (!ENGINE_CONFIG_SECTIONS.has(key)) return undefined;
      if (!isPlainObject(value) || !isValidOverrideSection(key, value)) return undefined;
    }
    return parsed as EngineConfigOverrides;
  } catch {
    return undefined;
  }
}

/**
 * Mergea `testOverrides` por encima de `config` (ADR-155 §1), sección por
 * sección — no un `{...config, ...testOverrides}` plano, que borraría el
 * resto de una sección si el canal de test solo fija un campo (p. ej.
 * `{ workerPool: { ocrPoolSize: 1 } }` no puede pisar `nerPoolSize` de
 * `config.workerPool`). Mismo criterio que `mergeEngineConfig`
 * (`packages/anonymization-core/src/config.ts`) al mergear contra defaults.
 */
function mergeTestEngineOverrides(
  config: EngineConfigOverrides | undefined,
  testOverrides: EngineConfigOverrides | undefined,
): EngineConfigOverrides {
  if (testOverrides === undefined) return config ?? {};
  return {
    workerPool: { ...config?.workerPool, ...testOverrides.workerPool },
    pdf: { ...config?.pdf, ...testOverrides.pdf },
    ner: { ...config?.ner, ...testOverrides.ner },
    ocr: { ...config?.ocr, ...testOverrides.ocr },
    grouping: { ...config?.grouping, ...testOverrides.grouping },
    render: { ...config?.render, ...testOverrides.render },
    export: { ...config?.export, ...testOverrides.export },
  };
}

export async function initCore(config?: EngineConfigOverrides): Promise<IAnonymizationCore> {
  if (core) return core;
  if (creationStarted) return deferredCore.promise;
  creationStarted = true;

  const withTestOverrides = mergeTestEngineOverrides(config, readTestEngineOverrides());
  const mergedConfig: EngineConfigOverrides = {
    ...withTestOverrides,
    ner: { wasmPaths: { wasm: ortWasmUrl, mjs: ortWasmMjsUrl }, ...withTestOverrides.ner },
  };

  try {
    const instance = await createCore(mergedConfig, {
      workers: {
        pdf: () => new PdfWorker(),
        render: () => new RenderWorker(),
        ocr: () => new OcrWorker(),
        "ocr-orientation": () => new OcrOrientationWorker(),
        ner: () => new NerWorker(),
        export: () => new ExportWorker(),
      },
    });
    unsubscribeBridge = subscribe(instance.bus, stores);
    core = instance;
    for (const consumer of busConsumers) consumer.detach = consumer.attach(instance.bus);
    liveOverrides = config ?? {};
    exposeCoreForMeasurement(instance);
    deferredCore.resolve(instance);
    return instance;
  } catch (error) {
    // Permite reintentar: un próximo `initCore()` vuelve a poder arrancar
    // `createCore()` (mismo comportamiento que antes de PR17.3). El
    // `deferredCore` viejo rechaza para quien ya lo esperaba; uno nuevo queda
    // listo para el próximo intento.
    creationStarted = false;
    const failed = deferredCore;
    deferredCore = createDeferred<IAnonymizationCore>();
    failed.reject(error);
    throw error;
  }
}

/**
 * Espera la instancia del Core ya en curso (o ya lista) sin poder influir en
 * su `config`: a diferencia de `initCore`, nunca llama a `createCore()` — si
 * nadie lo hizo todavía, espera a que alguien (hoy, `App.tsx`) lo haga. Para
 * consumidores de solo lectura como `PasswordDialog.tsx` (PR17.3).
 */
export function getCoreAsync(): Promise<IAnonymizationCore> {
  return core ? Promise.resolve(core) : deferredCore.promise;
}

export function getCore(): IAnonymizationCore {
  if (!core) throw new Error("Core not initialized");
  return core;
}

/**
 * Recrea el Core con un `EngineConfigOverrides` nuevo (ADR-125 §2, que
 * implementa lo que ADR-038 §7 ya había decidido: "sin documento abierto, la
 * UI recrea el core al vuelo — nada que perder").
 *
 * Existe porque `createCore` congela su `mergedConfig` y lo reparte por `ctx`
 * a cada motor: no hay forma de reconfigurarlo, y `reanalyze` —la única vía
 * de cambio en caliente— necesita un `documentId`. Sin esto, un `nerEnabled`
 * cambiado antes de cargar el primer PDF se guardaría y el análisis correría
 * igual con la config de cuando cargó la página.
 *
 * **El llamador es responsable de que no haya documento abierto.** Entre el
 * `dispose` y el `init` no hay core, y `getCore()` lanza: `SettingsDialog` lo
 * llama con su modal todavía arriba, que es lo que hace que no haya dónde
 * soltar un PDF mientras tanto (ADR-125 §3).
 */
export function recreateCore(config: EngineConfigOverrides): Promise<void> {
  return runExclusive(() => recreateCoreNow(config));
}

async function recreateCoreNow(config: EngineConfigOverrides): Promise<void> {
  let disposeError: unknown;
  try {
    await disposeCore();
  } catch (error) {
    // `disposeCore` ya dejó el estado limpio: el Core viejo se da por perdido
    // y se crea el nuevo, con su bridge y sus consumidores.
    disposeError = error;
  }
  await initCore(config);
  if (disposeError !== undefined) {
    console.error("El Core anterior no se liberó del todo.", disposeError);
  }
}

/**
 * Dos recreaciones no corren a la vez (ADR-194 §9): cada una espera a la
 * pendiente. `pendingRecreation` nunca rechaza; el error le llega solo a
 * quien pidió la recreación.
 */
function runExclusive(task: () => Promise<void>): Promise<void> {
  const previous = pendingRecreation;
  const run = (async () => {
    if (previous !== undefined) await previous;
    await task();
  })();
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  pendingRecreation = settled;
  void settled.then(() => {
    if (pendingRecreation === settled) pendingRecreation = undefined;
  });
  return run;
}

/**
 * ADR-194 §9: al quedar la aplicación sin documento, si el override derivado
 * difiere del que tiene el Core vivo, lo recrea. Sin diferencia no hace nada.
 *
 * Arranca de forma síncrona y deja la recreación en `pendingRecreation`:
 * quien importa un documento espera `getCoreWhenReady()`, así que un PDF
 * soltado mientras se recrea espera al Core nuevo en vez de encontrar ninguno
 * (acá no hay modal, a diferencia de ADR-125 §3). La comparación se hace
 * cuando le toca el turno, contra el Core que quede vivo. Si recrear falla,
 * vuelve a crear el Core con el override anterior: la app queda usable.
 */
export function recreateCoreIfOverridesChanged(next: EngineConfigOverrides): void {
  void runExclusive(async () => {
    const previous = liveOverrides;
    if (previous === undefined || core === undefined) return;
    if (sameEngineConfigOverrides(previous, next)) return;
    try {
      await recreateCoreNow(next);
    } catch (error) {
      console.error("No se pudo aplicar el perfil de rendimiento.", error);
      await initCore(previous);
    }
  });
}

/** El Core, esperando antes una recreación en curso (`recreateCoreIfOverridesChanged`). */
export async function getCoreWhenReady(): Promise<IAnonymizationCore> {
  while (pendingRecreation !== undefined) await pendingRecreation;
  return getCoreAsync();
}

type BusConsumer = {
  readonly attach: (bus: IAnonymizationCore["bus"]) => Unsubscribe;
  detach?: Unsubscribe | undefined;
};
const busConsumers = new Set<BusConsumer>();

/**
 * Suscribe un consumidor al bus del Core **vivo** (ADR-194 §9). Cada Core
 * tiene su propio bus: quien se suscribe una sola vez queda escuchando el de
 * un Core que ya no existe. `attach` se llama con el bus de cada Core nuevo,
 * y la suscripción anterior se suelta antes (al liberar el Core viejo), así
 * que nunca hay dos a la vez. Si todavía no hay Core, se suscribe cuando
 * `initCore` lo cree. Devuelve la función que da de baja al consumidor.
 */
export function subscribeToLiveCore(attach: BusConsumer["attach"]): Unsubscribe {
  const consumer: BusConsumer = { attach };
  busConsumers.add(consumer);
  if (core !== undefined) consumer.detach = attach(core.bus);
  return () => {
    consumer.detach?.();
    consumer.detach = undefined;
    busConsumers.delete(consumer);
  };
}

function detachBusConsumers(): void {
  for (const consumer of busConsumers) {
    consumer.detach?.();
    consumer.detach = undefined;
  }
}

/**
 * Libera la instancia actual del Core y desuscribe el bus-bridge y los consumidores
 * del bus. Si `dispose` del Core falla, igual deja el estado limpio y propaga el error. No forma
 * parte del contrato de UI (`React_Client.md` §2.1 no lo declara): existe
 * para poder testear `initCore`/`getCore` de forma aislada entre casos y,
 * eventualmente, para un flujo futuro de recreación del core (ADR-038 §7,
 * `performancePreset` sin documento abierto).
 */
export async function disposeCore(): Promise<void> {
  detachBusConsumers();
  if (unsubscribeBridge) {
    unsubscribeBridge();
    unsubscribeBridge = undefined;
  }
  const instance = core;
  core = undefined;
  try {
    if (instance) await instance.dispose();
  } finally {
    // Resetea también el estado de arranque (PR17.3): sin esto, un
    // `getCoreAsync()` posterior a `disposeCore()` colgaría esperando el
    // `deferredCore` ya resuelto/rechazado del ciclo anterior en vez de uno
    // limpio para el próximo `initCore()`.
    creationStarted = false;
    liveOverrides = undefined;
    deferredCore = createDeferred<IAnonymizationCore>();
  }
}
