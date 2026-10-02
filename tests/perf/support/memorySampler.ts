/**
 * `support/memorySampler.ts` — el instrumento de memoria de H-10 (ADR-146
 * §3): muestrea `app.getAppMetrics()` del proceso main de Electron, leído
 * desde el arnés de test con `electronApp.evaluate()` — nunca desde dentro
 * de la app (ADR-146 §3: "no se agrega IPC de acceso al sistema a la
 * aplicación de producción").
 *
 * Vive en `tests/perf/` y no en `tests/measure/` porque ADR-153 §2 decide
 * que tiempos y memoria salen del mismo proceso, con el mismo arnés
 * (`tests/e2e/support/electronApp.ts`): las dos familias de métricas se
 * pueden leer juntas — "este documento tardó X y llegó a Y MB" — en vez de
 * ser dos números de dos aplicaciones distintas.
 *
 * **Suma RSS, no memoria física única** (ADR-146 §3): `workingSetSize` de
 * cada proceso (Electron lo reporta en **KB**; acá se guarda todo en bytes,
 * ADR-146 §2) se suma sobre todos los procesos vivos — páginas compartidas
 * entre procesos se cuentan más de una vez. Es la métrica disponible y
 * comparable entre sistemas, no memoria privada exacta.
 */
import type { ElectronApplication } from "@playwright/test";

export interface ProcessMemorySample {
  readonly pid: number;
  readonly type: string;
  readonly workingSetSizeBytes: number;
}

export interface MemorySample {
  /** Milisegundos desde que arrancó el muestreo (no desde el import — eso lo marcan las fases del pipeline). */
  readonly atMs: number;
  readonly sumWorkingSetSizeBytes: number;
  readonly perProcess: ReadonlyArray<ProcessMemorySample>;
}

export interface MemorySampler {
  readonly samples: ReadonlyArray<MemorySample>;
  /** Wall time spent collecting each RSS sample, in milliseconds. */
  readonly sampleDurationsMs: ReadonlyArray<number>;
  /**
   * `Date.now()` de cuando arrancó este sampler — mismo reloj de pared que
   * usan los timestamps de fase del renderer (`installRunCollector`,
   * `memoryProfile.ts`, ambos procesos comparten el reloj del sistema).
   * Permite convertir un evento de fase a un `atMs` comparable contra
   * `samples` sin pasar por `performance.now()` (que arranca en la
   * navegación de la página, un origen de tiempo distinto).
   */
  readonly startedAtMs: number;
  /** Une una lectura más antes de cortar — para no perder el pico si cae justo entre dos ticks del intervalo. */
  sampleOnce(): Promise<MemorySample>;
  stop(): void;
}

/**
 * Arranca un muestreo periódico. `intervalMs` es un parámetro del
 * experimento, no un requisito normativo (ADR-146 §5) — punto de partida
 * 100-250 ms, acá 150 ms.
 *
 * Guarda contra solapamiento: si una lectura todavía está en vuelo cuando
 * toca la siguiente, esa se saltea en vez de encolarse — un `evaluate()`
 * lento no debe acumular lecturas atrasadas ni pisarse con la próxima.
 */
export function startMemorySampling(
  electronApp: ElectronApplication,
  intervalMs = 150,
): MemorySampler {
  const samples: MemorySample[] = [];
  const sampleDurationsMs: number[] = [];
  const samplerStartedAt = Date.now();
  let inFlight = false;
  let stopped = false;

  async function readOnce(): Promise<MemorySample> {
    const sampleStartedAt = Date.now();
    const metrics = await electronApp.evaluate(({ app }) => app.getAppMetrics());
    const perProcess: ProcessMemorySample[] = metrics.map((m) => ({
      pid: m.pid,
      type: m.type,
      workingSetSizeBytes: m.memory.workingSetSize * 1024,
    }));
    const sumWorkingSetSizeBytes = perProcess.reduce((acc, p) => acc + p.workingSetSizeBytes, 0);
    sampleDurationsMs.push(Date.now() - sampleStartedAt);
    return { atMs: Date.now() - samplerStartedAt, sumWorkingSetSizeBytes, perProcess };
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
    sampleDurationsMs,
    startedAtMs: samplerStartedAt,
    async sampleOnce(): Promise<MemorySample> {
      const sample = await readOnce();
      if (!stopped) samples.push(sample);
      return sample;
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** El pico de `sumWorkingSetSizeBytes` entre las muestras dadas. `0` si no hay ninguna. */
export function peakSumBytes(samples: ReadonlyArray<MemorySample>): number {
  return samples.reduce((max, s) => Math.max(max, s.sumWorkingSetSizeBytes), 0);
}

/**
 * El mínimo de `sumWorkingSetSizeBytes` entre las muestras dadas — la línea
 * de base caliente de H-10 lo usa sobre una ventana de asentamiento
 * (`memoryProfile.ts`) en vez de una sola lectura, para no capturar basura
 * del documento recién cerrado antes de que el GC la libere. `0` si no hay
 * ninguna muestra (no debería ocurrir con una ventana bien dimensionada, ya
 * que el sampler de fondo sigue corriendo).
 */
export function minSumBytes(samples: ReadonlyArray<MemorySample>): number {
  if (samples.length === 0) return 0;
  return samples.reduce((min, s) => Math.min(min, s.sumWorkingSetSizeBytes), Infinity);
}

/** Las muestras con `atMs` estrictamente posterior a `sinceMs` — para acotar un pico a una ventana (p. ej. "desde que arrancó la corrida caliente"). */
export function samplesSince(
  samples: ReadonlyArray<MemorySample>,
  sinceMs: number,
): ReadonlyArray<MemorySample> {
  return samples.filter((s) => s.atMs > sinceMs);
}

/** Las muestras con `atMs` en `[fromMs, toMs]` (inclusive) — el pico interno de una fase. */
export function samplesBetween(
  samples: ReadonlyArray<MemorySample>,
  fromMs: number,
  toMs: number,
): ReadonlyArray<MemorySample> {
  return samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
}

/**
 * La muestra cuyo `atMs` está más cerca de `targetMs` — el sampler corre
 * cada `SAMPLE_INTERVAL_MS` (150 ms de partida), así que un límite de fase
 * casi nunca cae exacto sobre una muestra. `undefined` si `samples` está
 * vacío.
 */
export function sampleNear(
  samples: ReadonlyArray<MemorySample>,
  targetMs: number,
): MemorySample | undefined {
  let closest: MemorySample | undefined;
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
