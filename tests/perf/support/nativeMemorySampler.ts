import type { ElectronApplication } from "@playwright/test";

import { readNativeMemory, type NativeMemorySnapshot } from "./nativeMemory.js";

export interface NativeMemoryProcessSample extends NativeMemorySnapshot {
  readonly type: string;
}

export interface NativeMemorySample {
  readonly atMs: number;
  readonly startedAtEpochMs: number;
  readonly finishedAtEpochMs: number;
  /** Wall-clock duration of the complete sample, including app metrics and probes. */
  readonly wallDurationMs: number;
  readonly processes: ReadonlyArray<NativeMemoryProcessSample>;
  /** Sum of child command durations; commands run in parallel and this is not latency. */
  readonly commandDurationMs: number;
}

export interface NativeMemorySamplerError {
  readonly atEpochMs: number;
  readonly message: string;
}

export interface NativeMemorySampler {
  readonly startedAtMs: number;
  readonly samples: ReadonlyArray<NativeMemorySample>;
  sampleOnce(): Promise<NativeMemorySample>;
  stop(): Promise<void>;
  readonly errors: ReadonlyArray<NativeMemorySamplerError>;
}

type NativeMemoryProcessReader = () => Promise<ReadonlyArray<NativeMemoryProcessSample>>;

export function createNativeMemorySampling(
  readProcesses: NativeMemoryProcessReader,
  intervalMs = 1_000,
): NativeMemorySampler {
  const startedAtMs = Date.now();
  const samples: NativeMemorySample[] = [];
  const errors: NativeMemorySamplerError[] = [];
  let stopped = false;
  let inFlight: Promise<NativeMemorySample> | undefined;

  async function readOnce(): Promise<NativeMemorySample> {
    const startedAtEpochMs = Date.now();
    const readings = await readProcesses();
    const commandDurationMs = readings.reduce((sum, reading) => sum + reading.commandDurationMs, 0);
    const finishedAtEpochMs = Date.now();
    return {
      atMs: startedAtEpochMs - startedAtMs,
      startedAtEpochMs,
      finishedAtEpochMs,
      wallDurationMs: finishedAtEpochMs - startedAtEpochMs,
      processes: readings,
      commandDurationMs,
    };
  }

  function beginRead(): Promise<NativeMemorySample> {
    if (stopped) return Promise.reject(new Error("native-memory-sampler-stopped"));
    if (inFlight !== undefined) return inFlight;
    const pending = readOnce();
    inFlight = pending;
    void pending.then(
      (sample) => {
        samples.push(sample);
        if (inFlight === pending) inFlight = undefined;
      },
      (error: unknown) => {
        if (inFlight === pending) inFlight = undefined;
        errors.push({
          atEpochMs: Date.now(),
          message: error instanceof Error ? error.message : "native-memory-read-failed",
        });
      },
    );
    return pending;
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      await beginRead();
    } catch {
      // beginRead records the reason in `errors`; the periodic timer must not
      // create an unhandled rejection or stop future observations.
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return {
    startedAtMs,
    samples,
    sampleOnce: async (): Promise<NativeMemorySample> => {
      return beginRead();
    },
    errors,
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}

export function startNativeMemorySampling(
  electronApp: ElectronApplication,
  intervalMs = 1_000,
): NativeMemorySampler {
  return createNativeMemorySampling(async () => {
    const metrics = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type })),
    );
    return Promise.all(
      metrics
        .filter((metric) => metric.type === "Tab" || metric.type === "GPU")
        .map(async (metric) => ({
          ...metric,
          ...(await readNativeMemory(metric.pid)),
        })),
    );
  }, intervalMs);
}
