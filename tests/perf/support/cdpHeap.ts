/**
 * `support/cdpHeap.ts` — ADR-159 §2: la retención se lee del heap de cada
 * target por separado (hilo principal, cada worker propio, cada worker de
 * tesseract.js anidado dentro de un worker de OCR), con recolección forzada
 * antes de cada lectura — nunca de la suma de RSS (ADR-159 §1: el RSS mezcla
 * retención con la pereza del recolector y no hay forma de separarlas desde
 * afuera).
 *
 * **Por qué un cliente CDP propio y no algo de Playwright.** Playwright solo
 * expone `BrowserContext.newCDPSession()` para un `Page`/`Frame` que él mismo
 * gestiona — no hay forma pública de pedir la sesión CDP de un worker
 * dedicado, y mucho menos la de un worker anidado dentro de otro worker (el
 * caso exacto de tesseract.js dentro de OcrWorker). El propio protocolo
 * documenta el mecanismo que hace falta («You might want to call this
 * recursively for auto-attached targets to attach to all available
 * targets» — `Target.setAutoAttach`), así que este archivo lo implementa
 * directo sobre el WebSocket nativo: `electronApp.ts` lanza Electron con
 * `--remote-debugging-port=0` (un flag de Chromium, no algo propio) y
 * Chromium escribe `<userDataDir>/DevToolsActivePort` — el mismo mecanismo
 * que usan Puppeteer/Selenium para descubrir el puerto efímero. Sin
 * dependencia nueva (R-12): `WebSocket`/`fetch` son globals de Node desde la
 * 22 LTS, que es el mínimo del repo (`Code_Standards.md` §1, CLAUDE.md
 * §Entorno).
 *
 * **Verificado corriendo, no solo leído** (precedente: los tres defectos de
 * instrumento de H-10 §4, ninguno se manifestó como error). Con la app real
 * procesando el perfil P2:
 * - Un worker de OCR levanta exactamente DOS hijos con `url` `blob:`
 *   DISTINTA entre sí — dos llamadas independientes a `createWorker()` en
 *   `ocr-engine/src/worker/kernel.ts` (`ensureWorkerLoaded` para
 *   reconocimiento, `ensureOsdWorkerLoaded` para OSD legacy, ADR-119 §1),
 *   cada una envuelta en su propio blob por `workerBlobURL: true` (default
 *   de tesseract.js). Por construcción son siempre dos, nunca más, y la de
 *   reconocimiento se crea primero (`kernelRecognize` llama
 *   `ensureWorkerLoaded` antes de `detectOrientation`).
 * - El worker de NER, con su backend WASM habilitado para hilos, levanta
 *   varios hijos que comparten la MISMA `url` `blob:` entre sí — el pool de
 *   pthreads de onnxruntime-web reusa un único script compilado para todo el
 *   pool, a diferencia de tesseract.js que crea un blob nuevo por
 *   `createWorker()`.
 *
 * Esa diferencia —urls hijas distintas vs. urls hijas repetidas— es la que
 * separa "ocr" de cualquier otro worker que levante hijos, sin asumir un
 * tamaño de pool fijo ni tocar código de producción (`classifyTargets`, más
 * abajo). Lo que este instrumento NO puede hacer sin tocar `apps/`: separar
 * entre sí a pdf/render/export (los tres son, vistos por CDP, un worker sin
 * hijos con la url genérica que le da el bundler — `entry-<hash>.js` — y
 * Vite no les pasa un `name` de instancia porque `core-adapter/index.ts`
 * llama a las factories sin argumentos). Se reportan como
 * `leaf-worker-N`, honestamente sin identidad de motor, en vez de adivinar.
 */
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// ─── Slice mínimo del protocolo CDP que este archivo usa ───────────────────
//
// No se importa `playwright-core/types/protocol` porque no es una
// dependencia declarada de este workspace (playwright-core es transitivo de
// `@playwright/test`, no resuelve como paquete propio bajo pnpm estricto) —
// depender de una ruta no declarada sería una dependencia fantasma. Estos
// tipos son el subconjunto exacto de los métodos/eventos que se llaman acá.

interface CdpTargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
}

interface CdpAttachedToTargetParams {
  readonly sessionId: string;
  readonly targetInfo: CdpTargetInfo;
}

interface CdpDetachedFromTargetParams {
  readonly sessionId: string;
}

/**
 * Los 4 campos que devuelve `Runtime.getHeapUsage` — no solo los 2 primeros.
 * **Verificado corriendo** (no en la documentación del protocolo): una
 * asignación deliberada de un `Float64Array` de 20 MB retenido en un global
 * NO mueve `usedSize`/`totalSize` (que reflejan el heap gestionado de V8 —
 * objetos, closures, strings) pero sí mueve `backingStorageSize` en
 * exactamente esos ~20 MB — es el backing store del `ArrayBuffer`, y es
 * donde vive un `ImageData`/`OffscreenCanvas` grande. Sin este campo el
 * instrumento reportaría "sin cambios" ante una retención real de 20 MB.
 */
interface CdpGetHeapUsageResult {
  readonly usedSize: number;
  readonly totalSize: number;
  readonly embedderHeapUsedSize: number;
  readonly backingStorageSize: number;
}

/**
 * Subconjunto de `Runtime.RemoteObject` (T-11, plan §4.2): `objectId` cuando
 * el resultado es una referencia viva (el caso de `WebAssembly.Memory.prototype`
 * y del array que devuelve `queryObjects`), `value` cuando se pidió
 * `returnByValue: true` (el array final de `{byteLength, shared}`).
 */
interface CdpRemoteObject {
  readonly type: string;
  readonly objectId?: string;
  readonly value?: unknown;
}

interface CdpEvaluateResult {
  readonly result: CdpRemoteObject;
  readonly exceptionDetails?: { readonly text: string };
}

interface CdpMethodMap {
  readonly "Target.setAutoAttach": {
    readonly params: {
      readonly autoAttach: boolean;
      readonly waitForDebuggerOnStart: boolean;
      readonly flatten: boolean;
    };
    readonly result: Record<string, never>;
  };
  readonly "HeapProfiler.enable": {
    readonly params: Record<string, never>;
    readonly result: Record<string, never>;
  };
  readonly "HeapProfiler.collectGarbage": {
    readonly params: Record<string, never>;
    readonly result: Record<string, never>;
  };
  readonly "Runtime.getHeapUsage": {
    readonly params: Record<string, never>;
    readonly result: CdpGetHeapUsageResult;
  };
  /**
   * T-11 (plan §4.2, paso 1): `WebAssembly.Memory.prototype` en el target,
   * para pasarle su `objectId` a `queryObjects`. También se usa para crear
   * las memorias de prueba del Paso 0 (§4.3) — `expression` alcanza para
   * ambos usos, no hace falta un método CDP distinto.
   */
  readonly "Runtime.evaluate": {
    readonly params: {
      readonly expression: string;
      readonly objectGroup?: string;
      readonly returnByValue?: boolean;
      readonly awaitPromise?: boolean;
    };
    readonly result: CdpEvaluateResult;
  };
  /** T-11 (plan §4.2, paso 2): todas las instancias vivas de un prototipo dado, como un array remoto. */
  readonly "Runtime.queryObjects": {
    readonly params: { readonly prototypeObjectId: string; readonly objectGroup?: string };
    readonly result: { readonly objects: CdpRemoteObject };
  };
  /** T-11 (plan §4.2, paso 3): mapea el array remoto a `{byteLength, shared}[]` por valor. */
  readonly "Runtime.callFunctionOn": {
    readonly params: {
      readonly objectId: string;
      readonly functionDeclaration: string;
      readonly returnByValue?: boolean;
      readonly objectGroup?: string;
    };
    readonly result: CdpEvaluateResult;
  };
  /**
   * T-11 (plan §4.2, paso 4): **siempre** en un `finally`, incluso si algo
   * falló arriba — sin esto el inspector retiene las memorias que alcanzó a
   * leer y el instrumento se convierte en una fuga (ver `readWasmForTarget`).
   */
  readonly "Runtime.releaseObjectGroup": {
    readonly params: { readonly objectGroup: string };
    readonly result: Record<string, never>;
  };
}

type CdpMethod = keyof CdpMethodMap;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCdpTargetInfo(value: unknown): value is CdpTargetInfo {
  return (
    isRecord(value) &&
    typeof value.targetId === "string" &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.url === "string"
  );
}

function isAttachedToTargetParams(value: unknown): value is CdpAttachedToTargetParams {
  return (
    isRecord(value) && typeof value.sessionId === "string" && isCdpTargetInfo(value.targetInfo)
  );
}

function isDetachedFromTargetParams(value: unknown): value is CdpDetachedFromTargetParams {
  return isRecord(value) && typeof value.sessionId === "string";
}

function isGetHeapUsageResult(value: unknown): value is CdpGetHeapUsageResult {
  return (
    isRecord(value) &&
    typeof value.usedSize === "number" &&
    typeof value.totalSize === "number" &&
    typeof value.embedderHeapUsedSize === "number" &&
    typeof value.backingStorageSize === "number"
  );
}

/** La forma cruda que devuelve el `functionDeclaration` de `queryWasmMemories` — antes de mapear `byteLength` a `byteLengthBytes`. */
function isWasmMemoryReadingList(
  value: unknown,
): value is ReadonlyArray<{ readonly byteLength: number; readonly shared: boolean }> {
  return (
    Array.isArray(value) &&
    value.every(
      (v: unknown) =>
        isRecord(v) && typeof v.byteLength === "number" && typeof v.shared === "boolean",
    )
  );
}

interface CdpErrorPayload {
  readonly code: number;
  readonly message: string;
}

interface CdpResponseMessage {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: CdpErrorPayload;
}

interface CdpEventMessage {
  readonly method: string;
  readonly params?: unknown;
  /**
   * A qué sesión pertenece este evento, en modo flat — CDP lo omite para un
   * evento del nivel raíz (la conexión al target del navegador) y lo llena
   * con la sesión que hizo `Target.setAutoAttach` para cualquier evento
   * reenviado desde un target hijo. Es justamente el dato que hace falta
   * para reconstruir el árbol: el PADRE de un `attachedToTarget` es el
   * `sessionId` del propio mensaje que lo trae, nunca hay que inferirlo.
   */
  readonly sessionId?: string;
}

function isCdpErrorPayload(value: unknown): value is CdpErrorPayload {
  return isRecord(value) && typeof value.code === "number" && typeof value.message === "string";
}

function isCdpResponseMessage(value: unknown): value is CdpResponseMessage {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    (value.error === undefined || isCdpErrorPayload(value.error))
  );
}

function isCdpEventMessage(value: unknown): value is CdpEventMessage {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    value.id === undefined &&
    (value.sessionId === undefined || typeof value.sessionId === "string")
  );
}

// ─── Descubrimiento del endpoint CDP del navegador ─────────────────────────

/**
 * Espera a que Chromium escriba `DevToolsActivePort` en `userDataDir` (lo
 * hace al levantar con `--remote-debugging-port=0`, ver `electronApp.ts`) y
 * devuelve el puerto elegido. Mismo mecanismo que usan Puppeteer/Selenium
 * para descubrir un puerto efímero — no es específico de Electron ni de
 * este repo.
 */
async function waitForDevToolsActivePort(userDataDir: string, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const filePath = `${userDataDir}/DevToolsActivePort`;
  for (;;) {
    try {
      const content = await readFile(filePath, "utf-8");
      const [portLine] = content.split("\n");
      const port = Number(portLine);
      if (Number.isFinite(port) && port > 0) return port;
    } catch {
      // Todavía no se escribió — Electron lo hace poco después de abrir la
      // primera ventana, no es instantáneo al lanzar el proceso.
    }
    if (Date.now() > deadline) {
      throw new Error(`DevToolsActivePort no aparecio en ${timeoutMs}ms (${filePath})`);
    }
    await delay(200);
  }
}

interface CdpVersionInfo {
  readonly webSocketDebuggerUrl: string;
}

function isCdpVersionInfo(value: unknown): value is CdpVersionInfo {
  return isRecord(value) && typeof value.webSocketDebuggerUrl === "string";
}

async function discoverBrowserWebSocketUrl(userDataDir: string): Promise<string> {
  const port = await waitForDevToolsActivePort(userDataDir);
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const response = await fetch(versionUrl);
  const body: unknown = await response.json();
  if (!isCdpVersionInfo(body)) {
    throw new Error(`Respuesta de ${versionUrl} sin webSocketDebuggerUrl: ${JSON.stringify(body)}`);
  }
  return body.webSocketDebuggerUrl;
}

// ─── Cliente CDP mínimo, con auto-attach recursivo ─────────────────────────

interface LiveTarget {
  readonly info: CdpTargetInfo;
  readonly parentSessionId: string | undefined;
  readonly attachedAtMs: number;
}

/**
 * Lectura cruda de un target vivo — sin clasificar (ver `classifyTargets`).
 *
 * **`usedSizeBytes`/`totalSizeBytes` NO ven todo.** Son el heap gestionado
 * de V8 (objetos, closures, strings) — verificado corriendo: un
 * `Float64Array` de 20 MB retenido no los mueve un byte. Lo que sí lo
 * refleja es `backingStorageSizeBytes` (backing store de `ArrayBuffer`s y
 * strings externos — un `ImageData`/`OffscreenCanvas` grande vive ahí).
 * **Ninguno de los cuatro campos refleja `WebAssembly.Memory`** — verificado
 * con una asignación de 20 MB, incluso escribiendo cada página para
 * descartar que fuera un problema de páginas todavía no comprometidas: sin
 * movimiento perceptible en ningún campo. Eso quiere decir que la memoria
 * lineal de WASM de tesseract.js/onnxruntime-web —el "heap" que ADR-159 §2
 * más quiere ver— **no es visible con este mecanismo**. Reportado en el
 * mensaje final de la tarea como ambigüedad abierta, no resuelto acá.
 */
/**
 * Los cinco campos que identifican un target dentro de un snapshot, comunes
 * a cualquier lectura que se le haga (heap, T-1; WASM, T-11) — extraído para
 * que `classifyTargets` clasifique por estructura sin acoplarse a qué se
 * leyó de cada uno.
 */
export interface TargetIdentity {
  readonly sessionId: string;
  readonly parentSessionId: string | undefined;
  readonly type: string;
  readonly url: string;
  readonly attachedAtMs: number;
}

export interface RawTargetHeapReading extends TargetIdentity {
  readonly usedSizeBytes: number | undefined;
  readonly totalSizeBytes: number | undefined;
  readonly embedderHeapUsedSizeBytes: number | undefined;
  readonly backingStorageSizeBytes: number | undefined;
  /** Motivo por el que no se pudo leer — `undefined` si la lectura salió bien. */
  readonly readError: string | undefined;
}

/** Una instancia viva de `WebAssembly.Memory` en un target (T-11, plan §4.2). */
export interface WasmMemoryReading {
  readonly byteLengthBytes: number;
  /** `buffer instanceof SharedArrayBuffer` — ONNX con hilos comparte una entre el worker de NER y cada uno de sus pthreads (plan §4.2). */
  readonly shared: boolean;
}

export interface RawTargetWasmReading extends TargetIdentity {
  /** Todas las `WebAssembly.Memory` vivas en este target. `undefined` si `readError` está seteado — nunca un array vacío por falta de lectura. */
  readonly memories: ReadonlyArray<WasmMemoryReading> | undefined;
  readonly readError: string | undefined;
}

class CdpBrowserConnection {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { readonly resolve: (result: unknown) => void; readonly reject: (err: Error) => void }
  >();
  private readonly targets = new Map<string, LiveTarget>();
  private readonly liveSessionIds = new Set<string>();
  /** Sufijo único por lectura de WASM — cada una usa su propio `objectGroup` para no liberar de más entre lecturas concurrentes del mismo target. */
  private nextWasmObjectGroupId = 0;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event: MessageEvent) => this.handleMessage(event));
  }

  static async connect(userDataDir: string): Promise<CdpBrowserConnection> {
    const url = await discoverBrowserWebSocketUrl(userDataDir);
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`No se pudo conectar a ${url}`)), {
        once: true,
      });
    });
    const connection = new CdpBrowserConnection(ws);
    // Recursivo: cada sesión recién atada vuelve a pedir auto-attach sobre sí
    // misma en `handleEvent`, para llegar a los hijos de un worker (los dos
    // de tesseract.js dentro de OcrWorker, el pool de NER si aplica).
    await connection.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    return connection;
  }

  private handleMessage(event: MessageEvent): void {
    const raw: unknown = JSON.parse(String(event.data));
    if (isCdpResponseMessage(raw)) {
      const pending = this.pending.get(raw.id);
      if (pending === undefined) return;
      this.pending.delete(raw.id);
      if (raw.error !== undefined)
        pending.reject(new Error(`${raw.error.message} (CDP ${raw.error.code})`));
      else pending.resolve(raw.result);
      return;
    }
    if (isCdpEventMessage(raw)) this.handleEvent(raw);
  }

  /**
   * `message.sessionId` (el de la ENVOLTURA del mensaje, modo flat) es el
   * PADRE de lo que trae el evento — CDP lo omite para un `attachedToTarget`
   * del nivel raíz (ninguna sesión todavía) y lo llena con la sesión que
   * hizo el `Target.setAutoAttach` correspondiente para cualquier evento
   * reenviado desde más abajo. Verificado corriendo (no inferido): con esta
   * lectura, los dos hijos de tesseract.js de un OcrWorker llegan con
   * `sessionId` = la sesión de ESE worker, nunca la de la página ni la de un
   * OcrWorker hermano — no hace falta estado propio para reconstruir el
   * árbol, y por lo tanto no hay carrera posible entre attaches hermanos que
   * llegan casi al mismo tiempo (el riesgo real de la alternativa "guardar
   * el último padre en una variable de instancia").
   */
  private handleEvent(message: CdpEventMessage): void {
    if (message.method === "Target.attachedToTarget" && isAttachedToTargetParams(message.params)) {
      const { sessionId, targetInfo } = message.params;
      this.targets.set(sessionId, {
        info: targetInfo,
        parentSessionId: message.sessionId,
        attachedAtMs: Date.now(),
      });
      this.liveSessionIds.add(sessionId);
      // Recursivo (ver docstring de la clase / comentario en `connect`): sin
      // esto, `attachedToTarget` solo llega para los hijos directos de la
      // sesión del navegador (los 5 workers propios), nunca para los
      // anidados (tesseract.js dentro de OcrWorker).
      void this.send(
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        },
        sessionId,
      );
      return;
    }
    if (
      message.method === "Target.detachedFromTarget" &&
      isDetachedFromTargetParams(message.params)
    ) {
      this.liveSessionIds.delete(message.params.sessionId);
    }
  }

  send<M extends CdpMethod>(
    method: M,
    params: CdpMethodMap[M]["params"],
    sessionId?: string,
  ): Promise<CdpMethodMap[M]["result"]> {
    const id = ++this.nextId;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    }) as Promise<CdpMethodMap[M]["result"]>;
  }

  /**
   * Heap + GC forzado de cada target VIVO en este instante (ADR-159 §2),
   * TODOS en paralelo (`Promise.all`, no un `for` secuencial) y cada uno
   * acotado por `HEAP_READ_TIMEOUT_MS`.
   *
   * **Por qué el timeout no es opcional.** Medido corriendo el perfil P2
   * real: sin él, esta función se quedaba colgada para siempre y el test
   * entero moría en su timeout de 300s. Causa encontrada — no solo
   * sospechada —: un isolate de tesseract.js pasa la enorme mayoría del
   * tiempo de la fase de OCR **adentro de una llamada síncrona de WASM**
   * (`worker.recognize()`, y las pasadas de franjas rotadas de ADR-121 antes
   * de eso), y un target así **no procesa ningún mensaje de CDP entrante**
   * hasta que esa llamada retorna — ni `HeapProfiler.enable` responde. Sin
   * timeout, `await this.send(...)` para ESE target nunca resuelve, y con
   * el `for` secuencial original ni siquiera se llegaba a leer el resto.
   *
   * Con el timeout, un target ocupado queda marcado `readError` (no se
   * descarta el snapshot entero) y el resto se lee igual. La consecuencia
   * que hay que leer en el reporte, no esconder: **durante buena parte de la
   * fase de OCR, el/los targets de tesseract van a aparecer como "sin
   * lectura" más que con un número** — es la naturaleza del problema (un
   * hilo ocupado en cómputo síncrono no es inspeccionable desde afuera sin
   * pausarlo), no un defecto de este instrumento en particular.
   */
  /**
   * `forceGc` (default `true`, T-11 plan §4.4 punto 4): la corrida estándar
   * (T-1, ADR-159 §2) siempre fuerza GC antes de leer — esta firma no cambia
   * para ningún llamador existente. T-11 necesita además la lectura SIN
   * forzar, para comparar "antes/después de GC" a los 6 s de cerrar (la
   * corrida estándar solo tenía el "después").
   */
  async snapshotHeapByTarget(forceGc = true): Promise<ReadonlyArray<RawTargetHeapReading>> {
    const sessionIds = [...this.liveSessionIds];
    const readings = await Promise.all(
      sessionIds.map((sessionId) => this.readOneTarget(sessionId, forceGc)),
    );
    return readings.filter((r): r is RawTargetHeapReading => r !== undefined);
  }

  private async readOneTarget(
    sessionId: string,
    forceGc: boolean,
  ): Promise<RawTargetHeapReading | undefined> {
    const target = this.targets.get(sessionId);
    if (target === undefined) return undefined;
    const base = {
      sessionId,
      parentSessionId: target.parentSessionId,
      type: target.info.type,
      url: target.info.url,
      attachedAtMs: target.attachedAtMs,
    };
    try {
      const heap = await withTimeout(
        this.readHeapUsage(sessionId, forceGc),
        HEAP_READ_TIMEOUT_MS,
        `sin respuesta de CDP en ${HEAP_READ_TIMEOUT_MS}ms — target probablemente ocupado en una llamada sincronica (WASM u otra)`,
      );
      if (!isGetHeapUsageResult(heap)) {
        return {
          ...base,
          usedSizeBytes: undefined,
          totalSizeBytes: undefined,
          embedderHeapUsedSizeBytes: undefined,
          backingStorageSizeBytes: undefined,
          readError: `Runtime.getHeapUsage devolvio una forma inesperada: ${JSON.stringify(heap)}`,
        };
      }
      return {
        ...base,
        usedSizeBytes: heap.usedSize,
        totalSizeBytes: heap.totalSize,
        embedderHeapUsedSizeBytes: heap.embedderHeapUsedSize,
        backingStorageSizeBytes: heap.backingStorageSize,
        readError: undefined,
      };
    } catch (err: unknown) {
      return {
        ...base,
        usedSizeBytes: undefined,
        totalSizeBytes: undefined,
        embedderHeapUsedSizeBytes: undefined,
        backingStorageSizeBytes: undefined,
        readError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async readHeapUsage(sessionId: string, forceGc: boolean): Promise<unknown> {
    await this.send("HeapProfiler.enable", {}, sessionId);
    if (forceGc) await this.send("HeapProfiler.collectGarbage", {}, sessionId);
    return this.send("Runtime.getHeapUsage", {}, sessionId);
  }

  /**
   * T-11 (plan §4.2): `WebAssembly.Memory` vivas de cada target, mismo patrón
   * que `snapshotHeapByTarget` (paralelo entre targets, tope por target) —
   * reusa la MISMA conexión y el MISMO árbol de targets, nunca un segundo
   * cliente CDP.
   */
  async snapshotWasmByTarget(): Promise<ReadonlyArray<RawTargetWasmReading>> {
    const sessionIds = [...this.liveSessionIds];
    const readings = await Promise.all(
      sessionIds.map((sessionId) => this.readWasmForTarget(sessionId)),
    );
    return readings.filter((r): r is RawTargetWasmReading => r !== undefined);
  }

  private async readWasmForTarget(sessionId: string): Promise<RawTargetWasmReading | undefined> {
    const target = this.targets.get(sessionId);
    if (target === undefined) return undefined;
    const base = {
      sessionId,
      parentSessionId: target.parentSessionId,
      type: target.info.type,
      url: target.info.url,
      attachedAtMs: target.attachedAtMs,
    };
    const objectGroup = `anonly-wasm-probe-${sessionId}-${this.nextWasmObjectGroupId}`;
    this.nextWasmObjectGroupId += 1;
    try {
      const memories = await withTimeout(
        this.queryWasmMemories(sessionId, objectGroup),
        HEAP_READ_TIMEOUT_MS,
        `sin respuesta de CDP en ${HEAP_READ_TIMEOUT_MS}ms — target probablemente ocupado en una llamada sincronica (WASM u otra)`,
      );
      return { ...base, memories, readError: undefined };
    } catch (err: unknown) {
      return {
        ...base,
        memories: undefined,
        readError: err instanceof Error ? err.message : String(err),
      };
    } finally {
      // Plan §4.2 punto 4: SIEMPRE, incluso si algo de arriba falló o
      // timeouteó. No se espera la confirmación con `await`: si el target
      // sigue ocupado, el mensaje queda en su cola de CDP y se procesa en
      // cuanto atiende de nuevo — bloquear acá con `await` reproduciría el
      // mismo colgado que `HEAP_READ_TIMEOUT_MS` existe para evitar.
      void this.send("Runtime.releaseObjectGroup", { objectGroup }, sessionId).catch(() => {
        // Sesión ya desconectada u otro error de transporte: nada que
        // liberar del lado del inspector si el target ya no existe.
      });
    }
  }

  private async queryWasmMemories(
    sessionId: string,
    objectGroup: string,
  ): Promise<ReadonlyArray<WasmMemoryReading>> {
    const proto = await this.send(
      "Runtime.evaluate",
      { expression: "WebAssembly.Memory.prototype", objectGroup, returnByValue: false },
      sessionId,
    );
    if (proto.exceptionDetails !== undefined) {
      throw new Error(`Runtime.evaluate fallo: ${proto.exceptionDetails.text}`);
    }
    const prototypeObjectId = proto.result.objectId;
    if (prototypeObjectId === undefined) {
      throw new Error(`Runtime.evaluate no devolvio objectId: ${JSON.stringify(proto.result)}`);
    }

    const queried = await this.send(
      "Runtime.queryObjects",
      { prototypeObjectId, objectGroup },
      sessionId,
    );
    const arrayObjectId = queried.objects.objectId;
    if (arrayObjectId === undefined) {
      throw new Error(`Runtime.queryObjects no devolvio un array: ${JSON.stringify(queried)}`);
    }

    const listed = await this.send(
      "Runtime.callFunctionOn",
      {
        objectId: arrayObjectId,
        // `SharedArrayBuffer` puede no existir como global si el target no
        // es cross-origin-isolated; `typeof` lo cubre sin arriesgar un
        // ReferenceError dentro del target medido.
        functionDeclaration:
          "function () { " +
          "return this.map(function (m) { " +
          "return { byteLength: m.buffer.byteLength, " +
          "shared: typeof SharedArrayBuffer !== 'undefined' && m.buffer instanceof SharedArrayBuffer }; " +
          "}); }",
        returnByValue: true,
        objectGroup,
      },
      sessionId,
    );
    if (listed.exceptionDetails !== undefined) {
      throw new Error(`Runtime.callFunctionOn fallo: ${listed.exceptionDetails.text}`);
    }
    const value = listed.result.value;
    if (!isWasmMemoryReadingList(value)) {
      throw new Error(
        `Runtime.callFunctionOn devolvio una forma inesperada: ${JSON.stringify(value)}`,
      );
    }
    return value.map((v) => ({ byteLengthBytes: v.byteLength, shared: v.shared }));
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Superficie mínima que necesita un consumidor externo para leer heap y WASM
 * sobre la MISMA conexión (T-11, plan §4.6: "extender cdpHeap.ts... no
 * duplicar el cliente CDP"). `CdpBrowserConnection` la satisface tal cual —
 * esto solo evita exportar la clase entera (y con ella `send`, el parseo de
 * mensajes, etc.) a un módulo que no necesita tocar nada de eso.
 */
export interface CdpTargetSnapshotter {
  snapshotHeapByTarget(forceGc?: boolean): Promise<ReadonlyArray<RawTargetHeapReading>>;
  snapshotWasmByTarget(): Promise<ReadonlyArray<RawTargetWasmReading>>;
  close(): void;
}

/** Abre una conexión nueva (mismo mecanismo que `startHeapSampling`) para un consumidor que orquesta su propio muestreo — hoy, `support/wasmMemory.ts`. */
export async function connectCdpTargetSnapshotter(
  userDataDir: string,
): Promise<CdpTargetSnapshotter> {
  return CdpBrowserConnection.connect(userDataDir);
}

/**
 * Cuánto se espera, por target, a que responda `HeapProfiler`/`Runtime`
 * antes de darlo por ocupado — ver el docstring de `snapshotHeapByTarget`
 * para la evidencia de por qué existe.
 *
 * 400 ms, no 1200: con la lectura rala ya aceptada (ADR-159 §6 — un target
 * ocupado se reporta como tal, con cobertura declarada, no es un fallo del
 * instrumento), un timeout más corto no pierde nada que 1200ms sí capturara
 * — un target que no contestó en 400ms sobre CDP local, sin red de por
 * medio, está ocupado igual — y baja el piso de cuánto puede tardar un
 * snapshot completo (el peor caso ya no lo marca el target más lento, sino
 * este número) a una cuarta parte. Es un valor elegido, no medido por
 * separado del de 1200: si la cadencia real sigue resultando pobre durante
 * OCR pesado, es la primera perilla a mover.
 */
const HEAP_READ_TIMEOUT_MS = 400;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

// ─── Clasificación estructural (pura, sin CDP — ver el docstring del archivo) ──

/**
 * Los cuatro campos que agrega la clasificación — separados de
 * `ClassifiedTargetHeapSample` para que `classifyTargets` sea genérica sobre
 * cualquier lectura que comparta `TargetIdentity` (T-11 la reusa para
 * `RawTargetWasmReading`, sin reimplementar la estructura padre/hijos).
 */
export interface TargetClassification {
  /** Etiqueta estable dentro de un mismo snapshot: `"main"`, `"ocr-worker-1"`, `"ocr-worker-1/tesseract-lstm"`, `"thread-pool-worker-1"`, `"leaf-worker-2"`, etc. */
  readonly label: string;
  /** Por qué se le puso esa etiqueta — para que un reporte no la presente como más certeza de la que tiene. */
  readonly note: string;
  /** Chunk/factory evidence observed in the parent target, when the Vite build exposes it. */
  readonly factoryChunk: "ocr-entry" | "orientation-entry" | "unknown";
  /** Role inferred from the factory chunk; unknown stays unknown rather than becoming LSTM. */
  readonly workerRole: "lstm" | "orientation" | "unknown";
}

export interface ClassifiedTargetHeapSample extends RawTargetHeapReading, TargetClassification {}

/** T-11: misma clasificación estructural, aplicada a lecturas de WASM en vez de heap. */
export interface ClassifiedTargetWasmSample extends RawTargetWasmReading, TargetClassification {}

function factoryChunk(url: string): ClassifiedTargetHeapSample["factoryChunk"] {
  const configured = process.env.ANONLY_T5_FACTORY_CHUNKS;
  if (configured !== undefined) {
    try {
      const parsed: unknown = JSON.parse(configured);
      if (isRecord(parsed)) {
        for (const [chunk, role] of Object.entries(parsed)) {
          if (url.includes(chunk) && (role === "ocr-entry" || role === "orientation-entry")) {
            return role;
          }
        }
      }
    } catch {
      // El arnés conserva la topología cruda y deja la clasificación en unknown.
    }
  }
  if (/orientation-entry/i.test(url)) return "orientation-entry";
  if (/ocr[-_]entry|worker[-_]entry/i.test(url)) return "ocr-entry";
  return "unknown";
}

/**
 * Clasifica un snapshot de targets vivos por estructura (padre/hijos e
 * igualdad de `url` entre hermanos) — nunca por el contenido de `url`, que es
 * un hash de build sin significado estable entre corridas. Ver el docstring
 * del archivo para la evidencia medida detrás de cada regla.
 */
export function classifyTargets<T extends TargetIdentity>(
  readings: ReadonlyArray<T>,
): ReadonlyArray<T & TargetClassification> {
  const byParent = new Map<string | undefined, T[]>();
  for (const reading of readings) {
    const siblings = byParent.get(reading.parentSessionId) ?? [];
    siblings.push(reading);
    byParent.set(reading.parentSessionId, siblings);
  }
  for (const siblings of byParent.values())
    siblings.sort((a, b) => a.attachedAtMs - b.attachedAtMs);

  const labels = new Map<string, { readonly label: string; readonly note: string }>();

  // Declarados ANTES de usarlos: `labelChildrenOf` es una function
  // declaration (hoisted, se puede llamar antes de su definición textual),
  // pero las variables que cierra sobre ellas son `let` — si el `forEach` de
  // abajo corriera antes de que estas líneas se ejecuten, cada incremento
  // reventaría con "Cannot access before initialization" (zona muerta
  // temporal). Verificado: es exactamente lo que pasaba con el orden
  // anterior de este archivo.
  let ocrCount = 0;
  let threadPoolCount = 0;
  let leafCount = 0;

  function labelChildrenOf(parentSessionId: string): void {
    const children = byParent.get(parentSessionId) ?? [];
    for (const worker of children) {
      const grandchildren = byParent.get(worker.sessionId) ?? [];
      if (grandchildren.length === 0) {
        leafCount += 1;
        labels.set(worker.sessionId, {
          label: `leaf-worker-${leafCount}`,
          note:
            "worker sin hijos: candidato a pdf-parse/render-page/export-page. " +
            "No distinguible entre esos tres solo con CDP (mismo patron visual: " +
            "url de chunk propio, sin nombre de instancia — core-adapter/index.ts " +
            "llama a las factories de Vite sin pasarles `name`).",
        });
        continue;
      }

      const distinctChildUrls = new Set(grandchildren.map((c) => c.url)).size;
      const isOcrLike = distinctChildUrls === grandchildren.length;
      if (isOcrLike && factoryChunk(worker.url) !== "unknown") {
        ocrCount += 1;
        const parentChunk = factoryChunk(worker.url);
        const orientation = parentChunk === "orientation-entry";
        const ocrLabel = orientation
          ? `ocr-orientation-worker-${ocrCount}`
          : `ocr-worker-${ocrCount}`;
        labels.set(worker.sessionId, {
          label: ocrLabel,
          note:
            `worker con ${grandchildren.length} hijo(s) de url blob: DISTINTA entre si — ` +
            `factory chunk ${parentChunk}; ` +
            (orientation
              ? "corresponde a orientation-entry y su único worker Tesseract es OSD."
              : "corresponde a ocr-entry; el rol del hijo solo se afirma si el chunk lo permite."),
        });
        grandchildren.forEach((child, index) => {
          const childName = orientation
            ? "tesseract-osd"
            : index === 0
              ? "tesseract-lstm"
              : index === 1
                ? "tesseract-osd"
                : `tesseract-${index}`;
          labels.set(child.sessionId, {
            label: `${ocrLabel}/${childName}`,
            note: `hijo #${index + 1} (orden de attach) de ${ocrLabel} — ver nota de ${ocrLabel}.`,
          });
        });
      } else {
        threadPoolCount += 1;
        const poolLabel = isOcrLike
          ? `unclassified-worker-${threadPoolCount}`
          : `thread-pool-worker-${threadPoolCount}`;
        labels.set(worker.sessionId, {
          label: poolLabel,
          note: isOcrLike
            ? `worker con ${grandchildren.length} hijo(s) de url distinta entre sí, pero sin chunk/factory identificable; no se atribuye a LSTM u OSD.`
            : `worker con ${grandchildren.length} hijo(s) que REPITEN la misma url blob: entre si — ` +
              "firma de un pool de hilos que reusa un unico script compilado (medido: " +
              "coincide con el pool de pthreads de onnxruntime-web que arma ner-engine " +
              "cuando su backend WASM habilita hilos). No confirmado por CDP solo.",
        });
        grandchildren.forEach((child, index) => {
          labels.set(child.sessionId, {
            label: isOcrLike ? `${poolLabel}/child-${index}` : `${poolLabel}/thread-${index}`,
            note: `hijo #${index + 1} (orden de attach) de ${poolLabel} — ver nota de ${poolLabel}.`,
          });
        });
      }
    }
  }

  const roots = byParent.get(undefined) ?? [];
  roots.forEach((root, index) => {
    const rootLabel = roots.length === 1 ? "main" : `main-${index + 1}`;
    labels.set(root.sessionId, {
      label: rootLabel,
      note: "hilo principal (target sin padre en la sesion del navegador).",
    });
    labelChildrenOf(root.sessionId);
  });

  return readings.map((reading) => {
    const found = labels.get(reading.sessionId);
    return {
      ...reading,
      label: found?.label ?? `unclassified-${reading.sessionId.slice(0, 8)}`,
      note:
        found?.note ??
        "no se pudo ubicar en el arbol de targets (padre desconocido en este snapshot).",
      factoryChunk:
        found?.label.startsWith("ocr-orientation-worker-") === true
          ? "orientation-entry"
          : found?.label.startsWith("ocr-worker-") === true
            ? "ocr-entry"
            : "unknown",
      workerRole:
        found?.label.startsWith("ocr-orientation-worker-") === true
          ? "orientation"
          : found?.label.startsWith("ocr-worker-") === true
            ? "lstm"
            : found?.label.includes("tesseract-lstm") === true
              ? "lstm"
              : "unknown",
    };
  });
}

// ─── Sampler periódico (mismo shape que `MemorySampler` de `memorySampler.ts`) ──

export interface HeapSample {
  /** Mismo origen de reloj que `MemorySample.atMs` (`Date.now() - startedAtMs` de ESTE sampler) — no comparable directo contra el de `memorySampler.ts` salvo por epoch absoluto; usar `startedAtMs` de cada uno para convertir, igual que hace `computePhaseSegments`. */
  readonly atMs: number;
  readonly targets: ReadonlyArray<ClassifiedTargetHeapSample>;
}

export interface HeapSampler {
  readonly samples: ReadonlyArray<HeapSample>;
  readonly startedAtMs: number;
  sampleOnce(): Promise<HeapSample>;
  stop(): void;
}

/**
 * Intervalo de partida para el heap-por-target. Más espaciado que
 * `SAMPLE_INTERVAL_MS` (RSS, 150 ms) a propósito: cada tick fuerza GC en
 * cada target vivo (10+ en el perfil P2 con OCR corriendo), y ADR-159 "en
 * contra" ya anticipa que ese costo no es gratis.
 *
 * **Una primera versión sin timeout por request se colgó corriendo el
 * perfil P2 real** (300s de test timeout agotados, `snapshotHeapByTarget`
 * nunca resolvía) — causa: un isolate de tesseract.js ocupado en una llamada
 * síncrona de WASM no contesta CDP hasta que esa llamada retorna, y sin
 * timeout la promesa de ese target no resuelve nunca (ver el docstring de
 * `snapshotHeapByTarget`, que ya tiene `HEAP_READ_TIMEOUT_MS` para esto). Con
 * ese timeout en su lugar, el riesgo de colgarse desaparece
 * estructuralmente.
 *
 * **1000 ms, no 5000.** Con 5000 ms, corriendo P2 real, la muestra de heap
 * más cercana a un límite de fase llegó a estar 2751 ms de ese límite — más
 * que suficiente para que el pool de OCR terminara de darse de baja (ADR-157)
 * y el de NER ya hubiera arrancado adentro de esa ventana, ensuciando el
 * residuo "no atribuido" de `memoryProfile.ts` (`computeUnattributedResidual`:
 * un residuo de ~1,2 MB que no era real, era dos pools sumados a la vez
 * contra un RSS de un instante distinto). Bajar a 1000 ms no lo elimina —un
 * evento de ciclo de vida sub-segundo todavía podría caer justo en el medio—
 * pero achica la ventana de riesgo a una quinta parte, a cambio de cinco
 * veces más forzado-GC. Es una eleccion de compromiso, no una garantía: la
 * alternativa que sí lo resolvería de raíz —anclar el snapshot al límite de
 * fase bajo demanda, en vez de al muestreo periódico más cercano— queda
 * sin tomar (T-1, más grande que el ajuste de un número).
 */
export const HEAP_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Arranca el muestreo de heap-por-target sobre la instancia de Electron cuyo
 * `userDataDir` se pasa (mismo directorio que ya crea `electronApp.ts` para
 * el perfil de usuario — `--remote-debugging-port=0` hace que Chromium
 * escriba `DevToolsActivePort` ahi). A diferencia de `startMemorySampling`
 * (sincronica), esta es async porque conectar por CDP requiere un handshake
 * de WebSocket antes de poder considerarse "arrancado".
 */
export async function startHeapSampling(
  userDataDir: string,
  intervalMs = HEAP_SAMPLE_INTERVAL_MS,
): Promise<HeapSampler> {
  const connection = await CdpBrowserConnection.connect(userDataDir);
  const samples: HeapSample[] = [];
  const startedAt = Date.now();
  let inFlight = false;
  let stopped = false;

  async function readOnce(): Promise<HeapSample> {
    const raw = await connection.snapshotHeapByTarget();
    return { atMs: Date.now() - startedAt, targets: classifyTargets(raw) };
  }

  async function tick(): Promise<void> {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const sample = await readOnce();
      if (!stopped) samples.push(sample);
    } finally {
      inFlight = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  void tick();

  return {
    samples,
    startedAtMs: startedAt,
    async sampleOnce(): Promise<HeapSample> {
      const sample = await readOnce();
      if (!stopped) samples.push(sample);
      return sample;
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
      connection.close();
    },
  };
}

/** La muestra de heap con `atMs` mas cercano a `targetMs` — mismo criterio que `sampleNear` de `memorySampler.ts`, para asociar un snapshot a un limite de fase. `undefined` si `samples` esta vacio. */
export function heapSampleNear(
  samples: ReadonlyArray<HeapSample>,
  targetMs: number,
): HeapSample | undefined {
  let closest: HeapSample | undefined;
  let closestDiffMs = Infinity;
  for (const sample of samples) {
    const diffMs = Math.abs(sample.atMs - targetMs);
    if (diffMs < closestDiffMs) {
      closest = sample;
      closestDiffMs = diffMs;
    }
  }
  return closest;
}

/** Las muestras de heap con `atMs` en `[fromMs, toMs]` (inclusive) — mismo criterio que `samplesBetween` de `memorySampler.ts`. */
export function heapSamplesBetween(
  samples: ReadonlyArray<HeapSample>,
  fromMs: number,
  toMs: number,
): ReadonlyArray<HeapSample> {
  return samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
}

/** Las muestras de heap con `atMs` estrictamente posterior a `sinceMs` — mismo criterio que `samplesSince` de `memorySampler.ts`, para acotar una corrida (fría o caliente) dentro de un `HeapSampler` que abarca las dos. */
export function heapSamplesSince(
  samples: ReadonlyArray<HeapSample>,
  sinceMs: number,
): ReadonlyArray<HeapSample> {
  return samples.filter((s) => s.atMs > sinceMs);
}
