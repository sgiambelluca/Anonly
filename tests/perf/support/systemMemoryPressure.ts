/**
 * `support/systemMemoryPressure.ts` — A-1
 * (`docs/roadmap/Instrumento_De_Memoria_Arreglo_Plan.md` §2): presión de
 * memoria del SISTEMA, no del árbol de procesos de la app. `memorySampler.ts`
 * ya mide el RSS de la app; lo que faltaba es la variable que la
 * re-caracterización del 2026-09-17 encontró que mueve M2 un 53% entre dos
 * tandas del MISMO commit/build (ADR-146 §7ter, contexto): con el compresor
 * de macOS ya apretado por horas de uso, el mismo trabajo del documento se
 * acomoda en memoria residente libre en vez de pedirle más al sistema, y eso
 * no vive en ningún proceso de la app — sin este campo, dos corridas del
 * mismo perfil tomadas en condiciones distintas son indistinguibles leyendo
 * el reporte.
 *
 * **Nunca un cero silencioso** (mandato explícito del plan): una plataforma o
 * campo sin lector implementado devuelve `available: false`/`undefined` con
 * motivo explícito, nunca `0`.
 *
 * - **macOS**: `vm_stat` (páginas libres, páginas ocupadas por el compresor,
 *   tamaño de página — los tres del mismo header/cuerpo) + `sysctl
 *   vm.swapusage` (swap usado; `vm_stat` no lo trae).
 * - **Linux** (incluye WSL, que es donde corre el desarrollo en Windows —
 *   CLAUDE.md §Entorno, por lo que `os.platform()` ahí también da `"linux"`,
 *   nunca `"win32"`): `/proc/meminfo` (`MemFree`/`SwapTotal`/`SwapFree`).
 *   Sin concepto estándar de compresor de páginas (zswap/zram no son
 *   universales): ese campo queda `undefined` con motivo, no en 0.
 * - Cualquier otra plataforma: `available: false` con motivo.
 *
 * Sin dependencia nueva (R-12): `node:child_process`/`node:fs` son built-ins;
 * `execFileSync` desde `node:child_process` ya es un patrón establecido en
 * `tests/quality/baseline/identity.ts`, acá se usa la variante async.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SystemMemoryPressureReading {
  readonly available: true;
  readonly freeBytes: number;
  /** `undefined` en plataformas sin concepto de compresor de páginas — ver `compressorUnavailableReason`. */
  readonly compressorBytes: number | undefined;
  readonly compressorUnavailableReason: string | undefined;
  readonly swapUsedBytes: number;
}

export interface SystemMemoryPressureUnavailable {
  readonly available: false;
  readonly reason: string;
}

export type SystemMemoryPressureSample =
  | SystemMemoryPressureReading
  | SystemMemoryPressureUnavailable;

/**
 * Parsea la salida de `vm_stat`. Separado de la llamada al proceso para
 * poder testear contra texto fijo, sin depender de correr en macOS.
 * `pageSizeBytes` sale del propio header (`"(page size of 16384 bytes)"` en
 * Apple Silicon, `4096` en Intel) — nunca asumido fijo, ya que hardcodearlo
 * daría números incorrectos en la arquitectura que no se probó.
 */
export function parseVmStatOutput(vmStatOut: string): {
  readonly pageSizeBytes: number | undefined;
  readonly freePages: number | undefined;
  readonly compressorPages: number | undefined;
} {
  const pageSizeMatch = /page size of (\d+) bytes/.exec(vmStatOut);
  const freePagesMatch = /Pages free:\s+(\d+)\./.exec(vmStatOut);
  const compressorPagesMatch = /Pages occupied by compressor:\s+(\d+)\./.exec(vmStatOut);
  return {
    pageSizeBytes: pageSizeMatch?.[1] === undefined ? undefined : Number(pageSizeMatch[1]),
    freePages: freePagesMatch?.[1] === undefined ? undefined : Number(freePagesMatch[1]),
    compressorPages:
      compressorPagesMatch?.[1] === undefined ? undefined : Number(compressorPagesMatch[1]),
  };
}

/** Parsea `sysctl vm.swapusage` (formato `"vm.swapusage: total = 1024.00M  used = 6.75M  free = ..."`). `vm_stat` no trae swap. */
export function parseSwapUsageOutput(swapUsageOut: string): number | undefined {
  const usedMatch = /used\s*=\s*([\d.]+)M/.exec(swapUsageOut);
  if (usedMatch?.[1] === undefined) return undefined;
  return Math.round(Number(usedMatch[1]) * 1024 * 1024);
}

/** Parsea `/proc/meminfo` (formato `"MemFree:        123456 kB"` por línea). */
export function parseMemInfo(meminfoOut: string): {
  readonly freeBytes: number | undefined;
  readonly swapUsedBytes: number | undefined;
} {
  const memFreeMatch = /^MemFree:\s+(\d+)\s+kB/m.exec(meminfoOut);
  const swapTotalMatch = /^SwapTotal:\s+(\d+)\s+kB/m.exec(meminfoOut);
  const swapFreeMatch = /^SwapFree:\s+(\d+)\s+kB/m.exec(meminfoOut);
  const freeBytes = memFreeMatch?.[1] === undefined ? undefined : Number(memFreeMatch[1]) * 1024;
  const swapUsedBytes =
    swapTotalMatch?.[1] === undefined || swapFreeMatch?.[1] === undefined
      ? undefined
      : Number(swapTotalMatch[1]) * 1024 - Number(swapFreeMatch[1]) * 1024;
  return { freeBytes, swapUsedBytes };
}

async function readDarwinMemoryPressure(): Promise<SystemMemoryPressureSample> {
  let vmStatOut: string;
  let swapUsageOut: string;
  try {
    [{ stdout: vmStatOut }, { stdout: swapUsageOut }] = await Promise.all([
      execFileAsync("vm_stat"),
      execFileAsync("sysctl", ["vm.swapusage"]),
    ]);
  } catch (err) {
    return { available: false, reason: `vm_stat/sysctl fallaron: ${(err as Error).message}` };
  }
  const { pageSizeBytes, freePages, compressorPages } = parseVmStatOutput(vmStatOut);
  if (pageSizeBytes === undefined || freePages === undefined) {
    return {
      available: false,
      reason: `vm_stat no trajo "page size"/"Pages free" reconocibles: ${vmStatOut.slice(0, 200)}`,
    };
  }
  const swapUsedBytes = parseSwapUsageOutput(swapUsageOut);
  if (swapUsedBytes === undefined) {
    return {
      available: false,
      reason: `sysctl vm.swapusage no trajo "used" reconocible: ${swapUsageOut.slice(0, 200)}`,
    };
  }
  return {
    available: true,
    freeBytes: freePages * pageSizeBytes,
    compressorBytes: compressorPages === undefined ? undefined : compressorPages * pageSizeBytes,
    compressorUnavailableReason:
      compressorPages === undefined ? 'vm_stat no trajo "Pages occupied by compressor"' : undefined,
    swapUsedBytes,
  };
}

async function readLinuxMemoryPressure(): Promise<SystemMemoryPressureSample> {
  let meminfoOut: string;
  try {
    meminfoOut = await readFile("/proc/meminfo", "utf-8");
  } catch (err) {
    return { available: false, reason: `/proc/meminfo no se pudo leer: ${(err as Error).message}` };
  }
  const { freeBytes, swapUsedBytes } = parseMemInfo(meminfoOut);
  if (freeBytes === undefined || swapUsedBytes === undefined) {
    return {
      available: false,
      reason: "/proc/meminfo no trajo MemFree/SwapTotal/SwapFree reconocibles",
    };
  }
  return {
    available: true,
    freeBytes,
    compressorBytes: undefined,
    compressorUnavailableReason:
      "Linux no tiene un concepto estándar de compresor de páginas (zswap/zram no son universales)",
    swapUsedBytes,
  };
}

/** Punto de entrada único — despacha por `os.platform()`. Nunca lanza: una plataforma o lectura sin soporte vuelve `{ available: false, reason }`. */
export async function readSystemMemoryPressure(): Promise<SystemMemoryPressureSample> {
  const platform = os.platform();
  if (platform === "darwin") return readDarwinMemoryPressure();
  if (platform === "linux") return readLinuxMemoryPressure();
  return {
    available: false,
    reason: `plataforma "${platform}" sin lector de presión de memoria implementado`,
  };
}

export function formatSystemMemoryPressure(sample: SystemMemoryPressureSample): string {
  if (!sample.available) return `no disponible (${sample.reason})`;
  const compressor =
    sample.compressorBytes === undefined
      ? `? (${sample.compressorUnavailableReason ?? "sin motivo"})`
      : `${(sample.compressorBytes / 1_000_000).toFixed(1)} MB`;
  return (
    `libres ${(sample.freeBytes / 1_000_000).toFixed(1)} MB, ` +
    `compresor ${compressor}, ` +
    `swap ${(sample.swapUsedBytes / 1_000_000).toFixed(1)} MB`
  );
}
