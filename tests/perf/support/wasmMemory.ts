/**
 * `support/wasmMemory.ts` — instrumento de T-11
 * (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4): convierte el "no
 * atribuido (WASM + nativo)" de ADR-159 §8 en una medición por worker, vía
 * CDP (`WebAssembly.Memory.prototype` → `queryObjects` → `callFunctionOn`),
 * reusando la conexión y la clasificación de targets de `cdpHeap.ts` — nunca
 * un segundo cliente CDP (plan §4.6).
 *
 * **Deduplicado de memoria compartida (plan §4.2).** ONNX con hilos comparte
 * un único `SharedArrayBuffer` entre el worker de NER y cada uno de sus
 * pthreads — eso es justo la firma estructural que `classifyTargets` etiqueta
 * como `thread-pool-worker-*`/`unclassified-worker-*` (hijos que REPITEN la
 * misma url de blob, cdpHeap.ts). La regla: dentro de ESE grupo, una memoria
 * `shared: true` del mismo `byteLength` que aparece en más de un target se
 * cuenta una sola vez. Los hijos de `ocr-worker-*`/`ocr-orientation-worker-*`
 * (LSTM vs. OSD) son instancias de WASM independientes por diseño —
 * tesseract.js crea un blob nuevo por `createWorker()`
 * (`Optimizacion_De_Memoria_Plan.md` §1.2), nunca comparten memoria— así que
 * NUNCA se deduplican entre sí aunque coincidieran en tamaño: la clave de
 * deduplicado para cualquier target fuera de un thread-pool es su propio
 * label completo, no el de su padre.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import {
  classifyTargets,
  connectCdpTargetSnapshotter,
  type CdpTargetSnapshotter,
  type ClassifiedTargetHeapSample,
  type ClassifiedTargetWasmSample,
  type RawTargetHeapReading,
  type RawTargetWasmReading,
} from "./cdpHeap.js";
import {
  attributedIsolateBytes,
  closeDocument,
  computeRunDurations,
  formatMB,
  installRunCollector,
  readRun,
  SETTLE_GRACE_MS,
  tabProcessBytes,
  waitForRunSettled,
} from "./memoryProfile.js";
import {
  sampleNear,
  samplesSince,
  startMemorySampling,
  type MemorySample,
  type MemorySampler,
} from "./memorySampler.js";

// ─── Muestreo combinado: WASM + heap por target, en la misma pasada ────────

export interface WasmHeapSample {
  /** Mismo origen que `MemorySample.atMs` de ESTE sampler — no comparable directo contra el de `memorySampler.ts` sin pasar por `startedAtMs`, igual que `HeapSample` de `cdpHeap.ts`. */
  readonly atMs: number;
  readonly heapTargets: ReadonlyArray<ClassifiedTargetHeapSample>;
  readonly wasmTargets: ReadonlyArray<ClassifiedTargetWasmSample>;
}

export interface WasmHeapSampleOnceOptions {
  /** Default `true` (mismo criterio que `cdpHeap.ts`). En `false`: la lectura de heap "antes de GC" de la pregunta 4 del plan §4.4. Nunca afecta a la lectura de WASM, que no tiene una noción de "forzar" propia — es lo que Paso 0 investiga por separado (`queryObjectsForcesGc`). */
  readonly forceGc?: boolean;
}

export interface WasmHeapSampler {
  readonly samples: ReadonlyArray<WasmHeapSample>;
  readonly startedAtMs: number;
  sampleOnce(options?: WasmHeapSampleOnceOptions): Promise<WasmHeapSample>;
  /**
   * Corta el timer periódico sin cerrar la conexión. Necesario antes de
   * cualquier ventana donde una lectura de fondo forzando GC invalidaría lo
   * que se está por medir — la pregunta 4 del plan §4.4 ("antes de GC") es
   * exactamente ese caso: sin esto, el tick de cada segundo durante los 6 s
   * de espera post-cierre ya fuerza GC seis veces (por `collectGarbage` del
   * lado del heap y por el efecto colateral de `queryObjects` del lado de
   * WASM, medido en Paso 0) antes de que la lectura "antes" siquiera se pida.
   */
  pause(): void;
  /** Reanuda el timer cortado por `pause()`. No hace nada si ya está corriendo o si el sampler está `stop()`-eado. */
  resume(): void;
  stop(): void;
}

/**
 * Cada 1 s (plan §4.4: "memoria de WASM y heap de JS por target cada 1 s, en
 * la misma pasada"): un solo `atMs`, no dos samplers en intervalos separados
 * que podrían derivar entre sí con el tiempo (uno tarda más que el otro en
 * algún tick, el `inFlight` de cada uno lo saltea, y las dos series dejan de
 * corresponder al mismo instante). `connection` sirve heap Y wasm porque es
 * la MISMA conexión CDP (`connectCdpTargetSnapshotter`, `cdpHeap.ts`) — nunca
 * dos clientes.
 */
/**
 * `forceGc: false` es la rama "antes de GC" de la pregunta 4 — Paso 0 midió
 * que `queryObjects` por sí solo fuerza una recolección (sin llamar a
 * `collectGarbage`). Correr la lectura de heap sin forzar EN PARALELO con
 * `snapshotWasmByTarget()` (que sí la fuerza como efecto colateral) sería una
 * carrera: la lectura "antes" podría resolver después de que la recolección
 * de la otra ya corrió en el mismo target. Por eso esta rama es
 * estrictamente secuencial — heap primero, WASM después — y nunca
 * `Promise.all`. Con `forceGc: true` las dos fuerzan GC de todos modos (una
 * por su cuenta, la otra de rebote), así que ahí sí van en paralelo por
 * velocidad. Exportada (no una función local de `startWasmHeapSampling`) para
 * poder probar el orden con una conexión falsa, sin depender del tick
 * periódico ni de una conexión CDP real.
 */
export async function readWasmHeapSample(
  connection: CdpTargetSnapshotter,
  forceGc: boolean,
  atMs: number,
): Promise<WasmHeapSample> {
  let rawHeap: ReadonlyArray<RawTargetHeapReading>;
  let rawWasm: ReadonlyArray<RawTargetWasmReading>;
  if (forceGc) {
    [rawHeap, rawWasm] = await Promise.all([
      connection.snapshotHeapByTarget(true),
      connection.snapshotWasmByTarget(),
    ]);
  } else {
    rawHeap = await connection.snapshotHeapByTarget(false);
    rawWasm = await connection.snapshotWasmByTarget();
  }
  return { atMs, heapTargets: classifyTargets(rawHeap), wasmTargets: classifyTargets(rawWasm) };
}

export async function startWasmHeapSampling(
  userDataDir: string,
  intervalMs = 1_000,
): Promise<WasmHeapSampler> {
  const connection: CdpTargetSnapshotter = await connectCdpTargetSnapshotter(userDataDir);
  const samples: WasmHeapSample[] = [];
  const startedAt = Date.now();
  let inFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function readOnce(forceGc: boolean): Promise<WasmHeapSample> {
    return readWasmHeapSample(connection, forceGc, Date.now() - startedAt);
  }

  async function tick(): Promise<void> {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const sample = await readOnce(true);
      if (!stopped) samples.push(sample);
    } finally {
      inFlight = false;
    }
  }

  function startTimer(): void {
    timer = setInterval(() => void tick(), intervalMs);
  }

  startTimer();
  void tick();

  return {
    samples,
    startedAtMs: startedAt,
    async sampleOnce(options?: WasmHeapSampleOnceOptions): Promise<WasmHeapSample> {
      const sample = await readOnce(options?.forceGc ?? true);
      if (!stopped) samples.push(sample);
      return sample;
    },
    pause(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    resume(): void {
      if (timer === undefined && !stopped) startTimer();
    },
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      connection.close();
    },
  };
}

/** Misma búsqueda que `heapSampleNear`/`sampleNear` — la muestra combinada con `atMs` más cercano a `targetMs`. `undefined` si `samples` está vacío. */
export function wasmHeapSampleNear(
  samples: ReadonlyArray<WasmHeapSample>,
  targetMs: number,
): WasmHeapSample | undefined {
  let closest: WasmHeapSample | undefined;
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

/** Mismo criterio que `heapSamplesBetween` — la trayectoria de la pregunta 2 recorre esto dentro de la ventana de OCR. */
export function wasmHeapSamplesBetween(
  samples: ReadonlyArray<WasmHeapSample>,
  fromMs: number,
  toMs: number,
): ReadonlyArray<WasmHeapSample> {
  return samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
}

/** Mismo criterio que `heapSamplesSince` — acota una corrida dentro de un sampler que pudiera abarcar más de una. */
export function wasmHeapSamplesSince(
  samples: ReadonlyArray<WasmHeapSample>,
  sinceMs: number,
): ReadonlyArray<WasmHeapSample> {
  return samples.filter((s) => s.atMs > sinceMs);
}

// ─── Deduplicado de memoria compartida y atribución por dueño (puro) ───────

function poolLabelOf(label: string): string {
  const slash = label.indexOf("/");
  return slash === -1 ? label : label.slice(0, slash);
}

/** Grupos donde `classifyTargets` (cdpHeap.ts) ya detectó hijos que repiten la misma url de blob — la única firma estructural de un pool de pthreads real. Ver el docstring del archivo. */
const THREAD_POOL_LABEL = /^(thread-pool-worker-|unclassified-worker-)/;

function dedupGroupKeyOf(label: string): string {
  return THREAD_POOL_LABEL.test(label) ? poolLabelOf(label) : label;
}

export interface WasmMemoryComponent {
  readonly dedupKey: string;
  readonly byteLengthBytes: number;
  readonly shared: boolean;
  /** Uno para una memoria privada; uno o más para una compartida ya deduplicada entre los targets de su pool. */
  readonly targetLabels: ReadonlyArray<string>;
}

export interface WasmMemoryTotal {
  readonly totalBytes: number;
  readonly components: ReadonlyArray<WasmMemoryComponent>;
}

/**
 * Total de memoria de WASM viva, contando una sola vez cada compartida de un
 * mismo pool de hilos (plan §4.2 — regla declarada en el docstring del
 * archivo). Un target con `readError` no aporta nada: ni cero ni el último
 * valor visto, igual que `attributedIsolateBytes` de `memoryProfile.ts`.
 */
export function computeWasmMemoryTotal(
  targets: ReadonlyArray<ClassifiedTargetWasmSample>,
): WasmMemoryTotal {
  const sharedGroups = new Map<string, { byteLengthBytes: number; targetLabels: Set<string> }>();
  const privateComponents: WasmMemoryComponent[] = [];

  for (const target of targets) {
    if (target.readError !== undefined || target.memories === undefined) continue;
    for (const memory of target.memories) {
      if (memory.shared) {
        const key = `${dedupGroupKeyOf(target.label)}|${memory.byteLengthBytes}`;
        const group = sharedGroups.get(key) ?? {
          byteLengthBytes: memory.byteLengthBytes,
          targetLabels: new Set<string>(),
        };
        group.targetLabels.add(target.label);
        sharedGroups.set(key, group);
      } else {
        privateComponents.push({
          dedupKey: target.label,
          byteLengthBytes: memory.byteLengthBytes,
          shared: false,
          targetLabels: [target.label],
        });
      }
    }
  }

  const sharedComponents: WasmMemoryComponent[] = [...sharedGroups.entries()].map(([key, g]) => ({
    dedupKey: key,
    byteLengthBytes: g.byteLengthBytes,
    shared: true,
    targetLabels: [...g.targetLabels].sort(),
  }));

  const components = [...sharedComponents, ...privateComponents].sort((a, b) =>
    a.dedupKey.localeCompare(b.dedupKey),
  );
  return { totalBytes: components.reduce((acc, c) => acc + c.byteLengthBytes, 0), components };
}

/**
 * Los seis dueños que pide la pregunta 1 del plan §4.4, más dos que aparecen
 * al correr el instrumento contra el build real (Paso 0 y las corridas de
 * §4.4, 2026-09-19):
 *
 * - **`ocr-worker-unclassified`**: `factoryChunk()` (`cdpHeap.ts`) identifica
 *   `orientation-entry` porque ESE chunk lleva el string en su nombre de
 *   archivo (`orientation-entry-<hash>.js`), pero el chunk del `ocr-worker`
 *   normal no — Vite lo nombra igual que cualquier otro motor
 *   (`entry-<hash>.js`, verificado en `build.log` de la corrida real: cinco
 *   chunks `entry-*.js` sin ningún substring distintivo). Sin ese substring,
 *   `factoryChunk()` devuelve `"unknown"` y `classifyTargets` etiqueta el
 *   grupo `unclassified-worker-N` en vez de `ocr-worker-N` — pero **sigue
 *   siendo, con certeza estructural, un motor de Tesseract**: la distinción
 *   `isOcrLike` (hijos con url de blob DISTINTA entre sí) contra
 *   `thread-pool-worker` (hijos que REPITEN la misma url) no depende de
 *   `factoryChunk`, solo la separación LSTM/OSD específica sí. Medido:
 *   `unclassified-worker-1/child-0` y `unclassified-worker-2/child-0`, cada
 *   uno con una memoria privada de ~148 MB — el mismo orden de magnitud que
 *   un motor LSTM completo. `ANONLY_T5_FACTORY_CHUNKS` (cdpHeap.ts) resuelve
 *   esto para la campaña T5 dedicada, que conoce el hash de SU build; T-11 no
 *   fija hashes de un build ajeno, así que reporta el balde honesto en vez de
 *   adivinar cuál de los dos es LSTM.
 * - **`other`**: lo que de verdad no se pudo ubicar en ningún patrón — nunca
 *   debería incluir memoria real de un motor conocido; si aparece con bytes
 *   > 0, es señal de un target no contemplado, no de un dueño ambiguo.
 */
export type WasmMemoryOwner =
  | "main"
  | "tesseract-lstm"
  | "tesseract-osd"
  | "ocr-orientation-osd"
  | "ocr-worker-unclassified"
  | "ner"
  | "leaf-worker"
  | "other";

/**
 * Por estructura del label (`cdpHeap.ts`, `classifyTargets`), nunca por el
 * contenido de una url. El orden importa: `ocr-orientation-worker-*` se
 * revisa ANTES que el sufijo genérico `/tesseract-osd` porque el único hijo
 * de un worker de orientación también termina en ese sufijo (cdpHeap.ts:
 * `orientation ? "tesseract-osd" : ...`) y sin este orden se confundiría con
 * el OSD legado de un `ocr-worker-*` normal — son dos cosas distintas para
 * la pregunta 1.
 */
export function classifyWasmOwner(label: string): WasmMemoryOwner {
  if (/^main(-\d+)?$/.test(label)) return "main";
  if (label.startsWith("ocr-orientation-worker-")) return "ocr-orientation-osd";
  if (label.endsWith("/tesseract-lstm")) return "tesseract-lstm";
  if (label.endsWith("/tesseract-osd")) return "tesseract-osd";
  if (label.startsWith("thread-pool-worker-")) return "ner";
  if (label.startsWith("unclassified-worker-")) return "ocr-worker-unclassified";
  if (label.startsWith("leaf-worker-")) return "leaf-worker";
  return "other";
}

export interface WasmMemoryByOwner {
  readonly owner: WasmMemoryOwner;
  readonly totalBytes: number;
  readonly targetLabels: ReadonlyArray<string>;
}

/** `computeWasmMemoryTotal` ya deduplicado, agregado por dueño en vez de por componente crudo — la forma que pide la pregunta 1 y la pregunta 3 del plan §4.4. */
export function attributeWasmMemoryByOwner(
  targets: ReadonlyArray<ClassifiedTargetWasmSample>,
): ReadonlyArray<WasmMemoryByOwner> {
  const { components } = computeWasmMemoryTotal(targets);
  const byOwner = new Map<WasmMemoryOwner, { totalBytes: number; targetLabels: Set<string> }>();
  for (const component of components) {
    const representative = component.targetLabels[0];
    const owner = representative === undefined ? "other" : classifyWasmOwner(representative);
    const entry = byOwner.get(owner) ?? { totalBytes: 0, targetLabels: new Set<string>() };
    entry.totalBytes += component.byteLengthBytes;
    for (const label of component.targetLabels) entry.targetLabels.add(label);
    byOwner.set(owner, entry);
  }
  return [...byOwner.entries()]
    .map(([owner, v]) => ({
      owner,
      totalBytes: v.totalBytes,
      targetLabels: [...v.targetLabels].sort(),
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
}

// ─── Puntos de interés: fases + un pico sintético, WASM al lado del RSS ────

export interface WasmInstantPoint {
  readonly event: string;
  /** Relativo al sampler de RSS. */
  readonly atMs: number;
  readonly rssTabBytes: number | undefined;
  readonly rssSumBytes: number | undefined;
  /** Relativo al sampler de WASM/heap — distinto origen que `atMs` (`WasmHeapSampler.startedAtMs` != `MemorySampler.startedAtMs`). */
  readonly wasmHeapAtMs: number | undefined;
  readonly wasmHeapLagMs: number | undefined;
  readonly wasmTotalBytes: number | undefined;
  readonly heapAttributedBytes: number | undefined;
  /** `wasmTotalBytes + heapAttributedBytes` — la atribución nueva de T-11 (plan §4.4 pregunta 3), ya no solo heap como en ADR-159 §8. */
  readonly combinedAttributedBytes: number | undefined;
  /** `rssTabBytes - combinedAttributedBytes` — lo que sigue sin atribuir (plan §4.4 pregunta 3: "la diferencia es lo que sigue sin atribuir"). **Puede ser un número limpio y estar igual incompleto** — ver `partial`: `computeWasmMemoryTotal`/`attributedIsolateBytes` saltean en silencio los targets con `readError`, así que un target ocupado (p. ej. el worker de NER en medio de una inferencia) no baja este número a cero, lo deja calculado sobre menos targets de los que existían. */
  readonly stillUnattributedBytes: number | undefined;
  /** Labels de targets de WASM con `readError` en la muestra usada para este punto — vacío si no hubo ninguno o si no hubo muestra. */
  readonly unreadableWasmTargetLabels: ReadonlyArray<string>;
  /** Mismo criterio que `unreadableWasmTargetLabels`, para heap. */
  readonly unreadableHeapTargetLabels: ReadonlyArray<string>;
  /**
   * `true` si algún target sin lectura NO es un hilo pthread de un pool de
   * NER (`thread-pool-worker-N/thread-M`). Esos hilos casi nunca contestan
   * (ADR-159 §6) pero su memoria es la MISMA memoria compartida que ya
   * reporta su padre (`computeWasmMemoryTotal` la deduplica por eso) — que
   * falten no vuelve parcial la lectura. Que falte cualquier otro target
   * (el propio `thread-pool-worker-N`, un `ocr-worker-*`, `main`) sí: ese
   * target no tiene sustituto y su memoria queda fuera de
   * `combinedAttributedBytes`/`stillUnattributedBytes` sin que el número lo
   * anuncie por sí solo.
   */
  readonly partial: boolean;
  readonly byOwner: ReadonlyArray<WasmMemoryByOwner>;
}

/** Hijo de un pool de pthreads de NER (`cdpHeap.ts`: hijos que repiten la misma url de blob) — ver el docstring de `partial`. */
const PTHREAD_CHILD_LABEL = /^thread-pool-worker-\d+\/thread-\d+$/;

function isExemptFromPartial(label: string): boolean {
  return PTHREAD_CHILD_LABEL.test(label);
}

/**
 * Un punto por cada `{event, epochMs}` dado — típicamente los límites de fase
 * de `readRun().phasesEpochMs` MÁS un pico sintético (`RSS_PEAK`, el instante
 * de la pregunta 1). Reusa una sola función para las preguntas 1 y 3 del plan
 * §4.4: las dos son "qué había vivo en tal instante", solo cambia qué
 * instante.
 */
export function computeWasmInstantPoints(
  instants: ReadonlyArray<{ readonly event: string; readonly epochMs: number }>,
  rssSamples: ReadonlyArray<MemorySample>,
  rssSamplerStartedAtMs: number,
  wasmSamples: ReadonlyArray<WasmHeapSample>,
  wasmSamplerStartedAtMs: number,
): ReadonlyArray<WasmInstantPoint> {
  return [...instants]
    .sort((a, b) => a.epochMs - b.epochMs)
    .map(({ event, epochMs }) => {
      const atMs = epochMs - rssSamplerStartedAtMs;
      const wasmAtMs = epochMs - wasmSamplerStartedAtMs;
      const rss = sampleNear(rssSamples, atMs);
      const wasmSample = wasmHeapSampleNear(wasmSamples, wasmAtMs);
      const rssTabBytes = tabProcessBytes(rss);
      const wasmTotal =
        wasmSample === undefined ? undefined : computeWasmMemoryTotal(wasmSample.wasmTargets);
      const heapAttributedBytes =
        wasmSample === undefined ? undefined : attributedIsolateBytes(wasmSample.heapTargets);
      const combinedAttributedBytes =
        wasmTotal === undefined || heapAttributedBytes === undefined
          ? undefined
          : wasmTotal.totalBytes + heapAttributedBytes;
      const unreadableWasmTargetLabels =
        wasmSample?.wasmTargets.filter((t) => t.readError !== undefined).map((t) => t.label) ?? [];
      const unreadableHeapTargetLabels =
        wasmSample?.heapTargets.filter((t) => t.readError !== undefined).map((t) => t.label) ?? [];
      const partial =
        unreadableWasmTargetLabels.some((l) => !isExemptFromPartial(l)) ||
        unreadableHeapTargetLabels.some((l) => !isExemptFromPartial(l));
      return {
        event,
        atMs,
        rssTabBytes,
        rssSumBytes: rss?.sumWorkingSetSizeBytes,
        wasmHeapAtMs: wasmSample?.atMs,
        wasmHeapLagMs: wasmSample === undefined ? undefined : Math.abs(wasmSample.atMs - wasmAtMs),
        wasmTotalBytes: wasmTotal?.totalBytes,
        heapAttributedBytes,
        combinedAttributedBytes,
        stillUnattributedBytes:
          rssTabBytes === undefined || combinedAttributedBytes === undefined
            ? undefined
            : rssTabBytes - combinedAttributedBytes,
        unreadableWasmTargetLabels,
        unreadableHeapTargetLabels,
        partial,
        byOwner: wasmSample === undefined ? [] : attributeWasmMemoryByOwner(wasmSample.wasmTargets),
      };
    });
}

// ─── Trayectoria de Tesseract por página (pregunta 2) ──────────────────────

/** Instalado además de `installRunCollector`: guarda cuándo (reloj de pared) terminó cada página de OCR, dato que `OcrPageSummary` no lleva. Global propio (`__anonlyOcrPageTimings`), no toca `__anonlyMemoryRun` — mismo criterio que `nerPreloadProbe.ts`/`imageDataProfile.ts`. */
declare global {
  var __anonlyOcrPageTimings: Array<{ pageIndex: number; epochMs: number }> | undefined;
}

export async function installOcrPageTimingCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    globalThis.__anonlyOcrPageTimings = [];
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      const p = payload as { pageIndex?: unknown };
      if (typeof p.pageIndex !== "number") return;
      globalThis.__anonlyOcrPageTimings?.push({ pageIndex: p.pageIndex, epochMs: Date.now() });
    });
  });
}

export async function readOcrPageTimings(
  page: Page,
): Promise<ReadonlyArray<{ readonly pageIndex: number; readonly epochMs: number }>> {
  return page.evaluate(() => globalThis.__anonlyOcrPageTimings ?? []);
}

export interface TesseractPageMemoryPoint {
  readonly pageIndex: number;
  /** Relativo al sampler de WASM. */
  readonly atMs: number;
  readonly lagMs: number | undefined;
  /** Bytes por target Tesseract (LSTM/OSD/orientación) vivo en la muestra más cercana a este punto — sin deduplicar entre sí porque nunca comparten memoria (ver docstring del archivo). */
  readonly byTarget: Readonly<Record<string, number>>;
}

/**
 * El tamaño de cada memoria de Tesseract en cada página completada (plan
 * §4.4 pregunta 2: "¿se estabiliza después de las primeras páginas, o sigue
 * creciendo?"). Como la memoria de WASM solo crece, la lectura más cercana a
 * la finalización de una página ES el máximo de esa memoria hasta esa
 * página — no hace falta un pico dentro de la ventana.
 */
export function computeTesseractPageTrajectory(
  pageTimingsAtMs: ReadonlyArray<{ readonly pageIndex: number; readonly atMs: number }>,
  wasmSamples: ReadonlyArray<WasmHeapSample>,
): ReadonlyArray<TesseractPageMemoryPoint> {
  const tesseractOwners: ReadonlySet<WasmMemoryOwner> = new Set([
    "tesseract-lstm",
    "tesseract-osd",
    "ocr-orientation-osd",
    "ocr-worker-unclassified",
  ]);
  return [...pageTimingsAtMs]
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map(({ pageIndex, atMs }) => {
      const nearest = wasmHeapSampleNear(wasmSamples, atMs);
      const byTarget: Record<string, number> = {};
      if (nearest !== undefined) {
        for (const target of nearest.wasmTargets) {
          if (target.readError !== undefined || target.memories === undefined) continue;
          if (!tesseractOwners.has(classifyWasmOwner(target.label))) continue;
          byTarget[target.label] = target.memories.reduce((acc, m) => acc + m.byteLengthBytes, 0);
        }
      }
      return {
        pageIndex,
        atMs,
        lagMs: nearest === undefined ? undefined : Math.abs(nearest.atMs - atMs),
        byTarget,
      };
    });
}

// ─── Basura de después de cerrar: heap antes/después de GC (pregunta 4) ───

export interface HeapGcDeltaEntry {
  readonly sessionId: string;
  readonly label: string;
  /** `undefined` si esa lectura tuvo `readError` — nunca un cero que confunda "no había nada" con "no se pudo leer". */
  readonly beforeBytes: number | undefined;
  readonly afterBytes: number | undefined;
  readonly deltaBytes: number | undefined;
}

function attributedHeapBytesOf(target: ClassifiedTargetHeapSample): number | undefined {
  if (target.readError !== undefined) return undefined;
  return (
    (target.usedSizeBytes ?? 0) +
    (target.embedderHeapUsedSizeBytes ?? 0) +
    (target.backingStorageSizeBytes ?? 0)
  );
}

/** Por target (no la suma): dónde está la diferencia entre "antes" y "después" del GC forzado, 6 s después de cerrar (plan §4.4 pregunta 4). */
export function computeHeapGcDelta(
  before: ReadonlyArray<ClassifiedTargetHeapSample>,
  after: ReadonlyArray<ClassifiedTargetHeapSample>,
): ReadonlyArray<HeapGcDeltaEntry> {
  const beforeBySession = new Map(before.map((t) => [t.sessionId, t]));
  const afterBySession = new Map(after.map((t) => [t.sessionId, t]));
  const allSessionIds = new Set([...beforeBySession.keys(), ...afterBySession.keys()]);
  return [...allSessionIds]
    .map((sessionId) => {
      const b = beforeBySession.get(sessionId);
      const a = afterBySession.get(sessionId);
      const beforeBytes = b === undefined ? undefined : attributedHeapBytesOf(b);
      const afterBytes = a === undefined ? undefined : attributedHeapBytesOf(a);
      return {
        sessionId,
        label: a?.label ?? b?.label ?? sessionId,
        beforeBytes,
        afterBytes,
        deltaBytes:
          beforeBytes === undefined || afterBytes === undefined
            ? undefined
            : afterBytes - beforeBytes,
      };
    })
    .sort((x, y) => x.label.localeCompare(y.label));
}

// ─── Paso 0 — verificar el instrumento, ejecutándolo (plan §4.3) ──────────

const STEP0_MAIN_MEMORY_PAGES = 480;
const STEP0_MAIN_MEMORY_BYTES = 31_457_280; // 480 * 65536, plan §4.3 punto 1
const STEP0_SHARED_MEMORY_PAGES = 16;
const STEP0_SHARED_MEMORY_BYTES = 1_048_576; // 16 * 65536, plan §4.3 punto 2
/** Tamaño del `Float64Array` de sonda para la pregunta "¿`queryObjects` fuerza GC?" — mismo orden de magnitud que la sonda ya probada en `cdpHeap.ts` (20 MB, ver su docstring). */
const GC_PROBE_FLOAT64_LENGTH = 2_500_000; // ~20 MB

function findByteLength(
  reading: RawTargetWasmReading,
  byteLengthBytes: number,
  shared: boolean,
): boolean {
  return (reading.memories ?? []).some(
    (m) => m.byteLengthBytes === byteLengthBytes && m.shared === shared,
  );
}

function depthOf(sessionId: string, parentOf: ReadonlyMap<string, string | undefined>): number {
  let depth = 0;
  let current = parentOf.get(sessionId);
  while (current !== undefined) {
    depth += 1;
    current = parentOf.get(current);
  }
  return depth;
}

export interface WasmStep0Result {
  readonly mainMemoryBytes: number | undefined;
  readonly nestedWorkerMemoryBytes: number | undefined;
  readonly nestedWorkerDepth: number | undefined;
  readonly sharedMemoryBytes: number | undefined;
  readonly sharedMemoryMarkedShared: boolean | undefined;
  readonly disappearedAfterRelease: boolean;
  /** `undefined` si la sonda de GC no pudo leerse (target ocupado) — nunca se afirma sin evidencia. */
  readonly queryObjectsForcesGc: boolean | undefined;
  readonly queryObjectsGcEvidence:
    | { readonly beforeBytes: number; readonly afterBytes: number }
    | undefined;
  readonly tesseractSeenNonZero: boolean;
  readonly tesseractOwnersSeen: ReadonlyArray<WasmMemoryOwner>;
  readonly failures: ReadonlyArray<string>;
  readonly passed: boolean;
}

/**
 * Ejecuta los cuatro puntos de plan §4.3, en orden, contra la app real —
 * "condición de parada: si `queryObjects` no encuentra la memoria de prueba,
 * no responde en targets de worker, o no ve a Tesseract, se detiene la tarea
 * y se reporta". `page`/`electronApp`/`userDataDir` son de la MISMA instancia
 * (item 4 abre un documento real en el mismo Electron que items 1-3, no una
 * instancia nueva: Paso 0 es una verificación, no una de las corridas de
 * §4.4 que sí exigen una importación en frío por instancia).
 */
export async function runWasmStep0(
  page: Page,
  userDataDir: string,
  ocrFile: E2eFilePayload,
  ocrImportTimeoutMs: number,
): Promise<WasmStep0Result> {
  const failures: string[] = [];
  const connection = await connectCdpTargetSnapshotter(userDataDir);
  try {
    // Puntos 1 y 2: memoria de prueba en el hilo principal, en un worker
    // ANIDADO (hijo de otro worker — dos niveles desde main, como Tesseract
    // dentro de OcrWorker) y una compartida.
    await page.evaluate(
      ({ mainPages, sharedPages }) => {
        (
          globalThis as typeof globalThis & {
            __anonlyWasmProbeMain?: WebAssembly.Memory;
            __anonlyWasmProbeShared?: WebAssembly.Memory;
          }
        ).__anonlyWasmProbeMain = new WebAssembly.Memory({ initial: mainPages });
        (
          globalThis as typeof globalThis & { __anonlyWasmProbeShared?: WebAssembly.Memory }
        ).__anonlyWasmProbeShared = new WebAssembly.Memory({
          initial: sharedPages,
          maximum: sharedPages,
          shared: true,
        });
      },
      { mainPages: STEP0_MAIN_MEMORY_PAGES, sharedPages: STEP0_SHARED_MEMORY_PAGES },
    );

    await page.evaluate(
      (mainPages) =>
        new Promise<void>((resolvePromise, rejectPromise) => {
          const nestedSource = `self.__anonlyWasmProbeNested = new WebAssembly.Memory({ initial: ${mainPages} }); postMessage("nested-ready");`;
          const nestedUrl = URL.createObjectURL(
            new Blob([nestedSource], { type: "text/javascript" }),
          );
          const outerSource = `
            const child = new Worker(${JSON.stringify(nestedUrl)});
            child.onmessage = () => postMessage("outer-ready");
            child.onerror = (e) => postMessage("outer-error:" + e.message);
            self.__anonlyWasmProbeChild = child;
          `;
          const outerUrl = URL.createObjectURL(
            new Blob([outerSource], { type: "text/javascript" }),
          );
          const outer = new Worker(outerUrl);
          outer.onmessage = (e: MessageEvent) => {
            if (e.data === "outer-ready") resolvePromise();
            else rejectPromise(new Error(String(e.data)));
          };
          outer.onerror = (e: ErrorEvent) => rejectPromise(new Error(e.message));
          (
            globalThis as typeof globalThis & { __anonlyWasmProbeOuter?: Worker }
          ).__anonlyWasmProbeOuter = outer;
        }),
      STEP0_MAIN_MEMORY_PAGES,
    );

    const withProbes = await connection.snapshotWasmByTarget();
    const parentOf = new Map(withProbes.map((r) => [r.sessionId, r.parentSessionId]));

    const mainReading = withProbes.find(
      (r) =>
        depthOf(r.sessionId, parentOf) === 0 && findByteLength(r, STEP0_MAIN_MEMORY_BYTES, false),
    );
    if (mainReading === undefined) {
      failures.push(
        `no se encontro la memoria de prueba (${STEP0_MAIN_MEMORY_BYTES} bytes) en el hilo principal.`,
      );
    }

    const nestedReading = withProbes.find(
      (r) =>
        depthOf(r.sessionId, parentOf) >= 2 && findByteLength(r, STEP0_MAIN_MEMORY_BYTES, false),
    );
    if (nestedReading === undefined) {
      failures.push(
        `no se encontro la memoria de prueba (${STEP0_MAIN_MEMORY_BYTES} bytes) en un worker anidado (profundidad >= 2).`,
      );
    }

    const sharedReading = withProbes.find((r) =>
      findByteLength(r, STEP0_SHARED_MEMORY_BYTES, true),
    );
    if (sharedReading === undefined) {
      failures.push(
        `no se encontro la memoria compartida de prueba (${STEP0_SHARED_MEMORY_BYTES} bytes, shared: true).`,
      );
    }

    // Punto 3: soltar + GC + releer -> tiene que desaparecer. El worker
    // anidado se libera terminando su cadena completa (no hay forma de
    // desreferenciar una global DENTRO de otro realm sin mensajearlo, y
    // terminar el worker es la vía real por la que ADR-157 da de baja un
    // pool) — main y la compartida se sueltan in situ.
    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          __anonlyWasmProbeMain?: unknown;
          __anonlyWasmProbeShared?: unknown;
          __anonlyWasmProbeOuter?: Worker | undefined;
        }
      ).__anonlyWasmProbeMain = undefined;
      const root = globalThis as typeof globalThis & {
        __anonlyWasmProbeShared?: unknown;
        __anonlyWasmProbeOuter?: Worker | undefined;
      };
      root.__anonlyWasmProbeShared = undefined;
      root.__anonlyWasmProbeOuter?.terminate();
      root.__anonlyWasmProbeOuter = undefined;
    });
    await connection.snapshotHeapByTarget(true); // fuerza GC en cada target vivo (main incluido)
    const afterRelease = await connection.snapshotWasmByTarget();
    const disappearedAfterRelease =
      !afterRelease.some((r) => findByteLength(r, STEP0_MAIN_MEMORY_BYTES, false)) &&
      !afterRelease.some((r) => findByteLength(r, STEP0_SHARED_MEMORY_BYTES, true));
    if (!disappearedAfterRelease) {
      failures.push(
        "la memoria de prueba siguio apareciendo despues de soltar la referencia y forzar GC " +
          "(releaseObjectGroup no estaria liberando lo que el instrumento retuvo).",
      );
    }

    // "Averiguar si queryObjects fuerza una recoleccion" (plan §4.2): una
    // sonda de ~20 MB retenida solo por una global, dereferenciada, leida SIN
    // forzar GC, despues de la cual se llama SOLO a queryObjects (ninguna
    // llamada propia a collectGarbage) y se vuelve a leer sin forzar. Si el
    // backing store bajo, queryObjects tuvo que haber corrido una GC.
    await page.evaluate((n) => {
      (globalThis as typeof globalThis & { __anonlyGcProbe?: Float64Array }).__anonlyGcProbe =
        new Float64Array(n);
    }, GC_PROBE_FLOAT64_LENGTH);
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { __anonlyGcProbe?: unknown }).__anonlyGcProbe = undefined;
    });
    const beforeQuery = await connection.snapshotHeapByTarget(false);
    const beforeMain = beforeQuery.find((r) => depthOf(r.sessionId, parentOf) === 0);
    await connection.snapshotWasmByTarget(); // el efecto bajo prueba: NO se llama a collectGarbage acá.
    const afterQuery = await connection.snapshotHeapByTarget(false);
    const afterMain = afterQuery.find((r) => depthOf(r.sessionId, parentOf) === 0);
    const beforeBytes =
      beforeMain?.readError === undefined ? beforeMain?.backingStorageSizeBytes : undefined;
    const afterBytes =
      afterMain?.readError === undefined ? afterMain?.backingStorageSizeBytes : undefined;
    const queryObjectsGcEvidence =
      beforeBytes === undefined || afterBytes === undefined
        ? undefined
        : { beforeBytes, afterBytes };
    // ~20 MB de Float64Array liberados: un margen de 5 MB deja afuera el
    // ruido de asignaciones chicas del propio runtime sin exigir que el
    // recolector devuelva el 100% exacto del backing store.
    const queryObjectsForcesGc =
      queryObjectsGcEvidence === undefined
        ? undefined
        : queryObjectsGcEvidence.beforeBytes - queryObjectsGcEvidence.afterBytes > 5_000_000;

    // Punto 4: durante una corrida de P2, cada target tesseract-* tiene que
    // ver memoria > 0 en algun momento.
    await installRunCollector(page, { captureOcrWords: false });
    const chooser = page.getByRole("button", { name: "Elegir archivo" });
    await chooser.waitFor({ state: "visible" });
    await page.locator('input[type="file"]').setInputFiles(ocrFile);
    const seenOwners = new Set<WasmMemoryOwner>();
    const tesseractOwners: ReadonlyArray<WasmMemoryOwner> = [
      "tesseract-lstm",
      "tesseract-osd",
      "ocr-orientation-osd",
      "ocr-worker-unclassified",
    ];
    const pollUntilReady = async (): Promise<void> => {
      for (;;) {
        const raw = await connection.snapshotWasmByTarget();
        const classified = classifyTargets(raw);
        for (const target of classified) {
          if (target.readError !== undefined || target.memories === undefined) continue;
          if (target.memories.some((m) => m.byteLengthBytes > 0)) {
            const owner = classifyWasmOwner(target.label);
            if (tesseractOwners.includes(owner)) seenOwners.add(owner);
          }
        }
        const settled = await page
          .evaluate(() => {
            const r = globalThis.__anonlyMemoryRun;
            return r !== undefined && ("PIPELINE_READY" in r.phases || r.failedAt !== undefined);
          })
          .catch(() => false);
        if (settled) return;
      }
    };
    await Promise.race([
      pollUntilReady(),
      waitForRunSettled(page, ocrImportTimeoutMs).then(() => pollUntilReady()),
    ]);
    if (seenOwners.size === 0) {
      failures.push("ningun target tesseract-* reporto memoria > 0 durante la corrida de P2.");
    }
    await closeDocument(page);

    return {
      mainMemoryBytes: mainReading === undefined ? undefined : STEP0_MAIN_MEMORY_BYTES,
      nestedWorkerMemoryBytes: nestedReading === undefined ? undefined : STEP0_MAIN_MEMORY_BYTES,
      nestedWorkerDepth:
        nestedReading === undefined ? undefined : depthOf(nestedReading.sessionId, parentOf),
      sharedMemoryBytes: sharedReading === undefined ? undefined : STEP0_SHARED_MEMORY_BYTES,
      sharedMemoryMarkedShared: sharedReading === undefined ? undefined : true,
      disappearedAfterRelease,
      queryObjectsForcesGc,
      queryObjectsGcEvidence,
      tesseractSeenNonZero: seenOwners.size > 0,
      tesseractOwnersSeen: [...seenOwners].sort(),
      failures,
      passed: failures.length === 0,
    };
  } finally {
    connection.close();
  }
}

export function printWasmStep0Report(result: WasmStep0Result): void {
  process.stdout.write(
    `\n=== T-11 — Paso 0 (plan §4.3) ===\n` +
      `  memoria de prueba, hilo principal: ${result.mainMemoryBytes ?? "?"} bytes\n` +
      `  memoria de prueba, worker anidado (profundidad ${result.nestedWorkerDepth ?? "?"}): ${result.nestedWorkerMemoryBytes ?? "?"} bytes\n` +
      `  memoria compartida de prueba: ${result.sharedMemoryBytes ?? "?"} bytes, marcada compartida: ${result.sharedMemoryMarkedShared ?? "?"}\n` +
      `  desaparece tras soltar + GC: ${result.disappearedAfterRelease}\n` +
      `  queryObjects fuerza GC: ${result.queryObjectsForcesGc ?? "? (sin evidencia)"} ` +
      (result.queryObjectsGcEvidence === undefined
        ? ""
        : `(antes ${formatMB(result.queryObjectsGcEvidence.beforeBytes)}, despues ${formatMB(result.queryObjectsGcEvidence.afterBytes)})`) +
      `\n  ve a Tesseract durante P2: ${result.tesseractSeenNonZero} (dueños vistos: ${result.tesseractOwnersSeen.join(", ") || "ninguno"})\n` +
      `  PASA: ${result.passed}\n` +
      (result.failures.length === 0
        ? ""
        : `  fallas:\n${result.failures.map((f) => `    - ${f}`).join("\n")}\n`),
  );
}

export async function writeWasmStep0Report(result: WasmStep0Result, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, "wasm-step0.json");
  await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}

// ─── Las cuatro corridas de §4.4 ────────────────────────────────────────────

export interface WasmAttributionReport {
  readonly runId: string;
  readonly profile: string;
  readonly identity: {
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string | undefined;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly capturedAt: string;
  readonly ok: boolean;
  readonly totalMs: number | null;
  readonly groupCount: number;
  readonly entityCount: number;
  /** Pregunta 1 + pregunta 3: fases del pipeline y el pico global de RSS, cada uno con su atribución WASM+heap. */
  readonly instantPoints: ReadonlyArray<WasmInstantPoint>;
  /** Pregunta 2. */
  readonly tesseractPageTrajectory: ReadonlyArray<TesseractPageMemoryPoint>;
  /** Pregunta 4 — `null` si la corrida falló antes de poder cerrar el documento. */
  readonly postCloseGc: {
    readonly atMs: number;
    readonly deltaByTarget: ReadonlyArray<HeapGcDeltaEntry>;
  } | null;
  readonly rssSamples: ReadonlyArray<MemorySample>;
  readonly wasmSamples: ReadonlyArray<WasmHeapSample>;
}

const POST_CLOSE_GC_DELAY_MS = 6_000;

export async function runWasmAttribution(
  page: Page,
  electronApp: ElectronApplication,
  userDataDir: string,
  runId: string,
  profile: string,
  file: E2eFilePayload,
  importTimeoutMs: number,
): Promise<WasmAttributionReport> {
  const rssSampler: MemorySampler = startMemorySampling(electronApp, 150);
  const wasmSampler = await startWasmHeapSampling(userDataDir, 1_000);
  try {
    await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
    await installRunCollector(page, { captureOcrWords: false });
    await installOcrPageTimingCollector(page);

    const rssSinceMs = rssSampler.samples.at(-1)?.atMs ?? 0;
    const wasmSinceMs = wasmSampler.samples.at(-1)?.atMs ?? 0;

    await page.locator('input[type="file"]').setInputFiles(file);
    await waitForRunSettled(page, importTimeoutMs);
    await page.waitForTimeout(SETTLE_GRACE_MS);
    await rssSampler.sampleOnce();
    await wasmSampler.sampleOnce();

    const run = await readRun(page);
    const durations = computeRunDurations(run.phasesEpochMs, rssSampler.startedAtMs);
    const pageTimings = await readOcrPageTimings(page);

    const runRssSamples = samplesSince(rssSampler.samples, rssSinceMs);
    const runWasmSamples = wasmHeapSamplesSince(wasmSampler.samples, wasmSinceMs);

    const peakRssSample = runRssSamples.reduce<MemorySample | undefined>(
      (max, s) =>
        max === undefined || s.sumWorkingSetSizeBytes > max.sumWorkingSetSizeBytes ? s : max,
      undefined,
    );
    const instants = Object.entries(run.phasesEpochMs).map(([event, epochMs]) => ({
      event,
      epochMs,
    }));
    if (peakRssSample !== undefined) {
      instants.push({ event: "RSS_PEAK", epochMs: rssSampler.startedAtMs + peakRssSample.atMs });
    }
    const instantPoints = computeWasmInstantPoints(
      instants,
      runRssSamples,
      rssSampler.startedAtMs,
      runWasmSamples,
      wasmSampler.startedAtMs,
    );

    const pageTimingsAtMs = pageTimings.map((t) => ({
      pageIndex: t.pageIndex,
      atMs: t.epochMs - wasmSampler.startedAtMs,
    }));
    const tesseractPageTrajectory = computeTesseractPageTrajectory(pageTimingsAtMs, runWasmSamples);

    let postCloseGc: WasmAttributionReport["postCloseGc"] = null;
    // Se persisten aparte de `runWasmSamples` (ya filtrado más arriba, antes
    // de que estas dos lecturas existieran) para que la serie cruda del
    // reporte incluya el instante de la pregunta 4, no solo el delta ya
    // calculado — mismo criterio de "persistir la serie, no solo el máximo"
    // que el resto del arnés (ADR-146 §7 punto 3).
    const postCloseWasmSamples: WasmHeapSample[] = [];
    if (run.failedAt === undefined) {
      // Sin esto, el tick de cada segundo del sampler periódico sigue
      // corriendo durante los 6 s de espera de abajo y fuerza GC en cada
      // target seis veces antes de que la lectura "antes de GC" siquiera se
      // pida — invalidaría exactamente lo que esta corrida quiere medir (ver
      // el docstring de `WasmHeapSampler.pause`).
      wasmSampler.pause();
      await closeDocument(page);
      await page.waitForTimeout(POST_CLOSE_GC_DELAY_MS);
      const beforeGc = await wasmSampler.sampleOnce({ forceGc: false });
      const afterGc = await wasmSampler.sampleOnce({ forceGc: true });
      postCloseWasmSamples.push(beforeGc, afterGc);
      postCloseGc = {
        atMs: afterGc.atMs,
        deltaByTarget: computeHeapGcDelta(beforeGc.heapTargets, afterGc.heapTargets),
      };
    }

    return {
      runId,
      profile,
      identity: {
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
      },
      capturedAt: new Date().toISOString(),
      ok: run.failedAt === undefined,
      totalMs: durations.totalMs,
      groupCount: run.groupCount,
      entityCount: run.entityCount,
      instantPoints,
      tesseractPageTrajectory,
      postCloseGc,
      rssSamples: runRssSamples,
      wasmSamples: [...runWasmSamples, ...postCloseWasmSamples],
    };
  } finally {
    rssSampler.stop();
    wasmSampler.stop();
  }
}

function formatOwners(byOwner: ReadonlyArray<WasmMemoryByOwner>): string {
  if (byOwner.length === 0) return "(sin muestra de WASM)";
  return byOwner
    .filter((o) => o.totalBytes > 0)
    .map((o) => `${o.owner}=${formatMB(o.totalBytes)}`)
    .join(" ");
}

/** Labels que efectivamente disparan `partial` — nunca los hilos pthread exentos, para no ensuciar la nota con lo esperado. */
function partialTriggerLabels(point: WasmInstantPoint): ReadonlyArray<string> {
  const all = [...point.unreadableWasmTargetLabels, ...point.unreadableHeapTargetLabels];
  return [...new Set(all.filter((l) => !isExemptFromPartial(l)))];
}

export function printWasmAttributionReport(report: WasmAttributionReport): void {
  const lines = [
    `\n=== T-11 — ${report.runId} (${report.profile}) — ok: ${report.ok}, total: ${report.totalMs?.toFixed(0) ?? "?"} ms, grupos: ${report.groupCount} ===`,
    ...report.instantPoints.map((p) => {
      const partialNote = p.partial ? ` (parcial: ${partialTriggerLabels(p).join(", ")})` : "";
      return (
        `  ${p.event}: Tab=${p.rssTabBytes === undefined ? "?" : formatMB(p.rssTabBytes)} ` +
        `WASM=${p.wasmTotalBytes === undefined ? "?" : formatMB(p.wasmTotalBytes)} ` +
        `heapJS=${p.heapAttributedBytes === undefined ? "?" : formatMB(p.heapAttributedBytes)} ` +
        `atribuido=${p.combinedAttributedBytes === undefined ? "?" : formatMB(p.combinedAttributedBytes)} ` +
        `sin atribuir=${p.stillUnattributedBytes === undefined ? "?" : formatMB(p.stillUnattributedBytes)}${partialNote} ` +
        `(lag ${p.wasmHeapLagMs?.toFixed(0) ?? "?"}ms) — ${formatOwners(p.byOwner)}`
      );
    }),
    `  trayectoria de Tesseract (${report.tesseractPageTrajectory.length} páginas):`,
    ...report.tesseractPageTrajectory.map((pt) => {
      const entries = Object.entries(pt.byTarget)
        .map(([label, bytes]) => `${label}=${formatMB(bytes)}`)
        .join(" ");
      return `    página ${pt.pageIndex}: ${entries || "(sin Tesseract vivo)"}`;
    }),
    report.postCloseGc === null
      ? "  post-cierre (6s): (corrida no llegó a cerrar el documento)"
      : `  post-cierre (6s), heap por target antes/después de GC forzado:\n${report.postCloseGc.deltaByTarget
          .map(
            (d) =>
              `    ${d.label}: antes=${d.beforeBytes === undefined ? "?" : formatMB(d.beforeBytes)} ` +
              `después=${d.afterBytes === undefined ? "?" : formatMB(d.afterBytes)} ` +
              `delta=${d.deltaBytes === undefined ? "?" : formatMB(d.deltaBytes)}`,
          )
          .join("\n")}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function writeWasmAttributionReport(
  report: WasmAttributionReport,
  outDir: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `wasm-${report.runId}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}
