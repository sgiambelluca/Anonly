export interface MemoryInfraTraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly ts: number;
  readonly id?: string;
  readonly args?: Readonly<Record<string, unknown>>;
}
export interface MemoryInfraRequestWindow {
  readonly requestId: string;
  readonly label: string;
  readonly beforeTsUs: number;
  readonly afterTsUs: number;
  readonly beforeSyncId: string;
  readonly afterSyncId: string;
  readonly responseDumpGuid: string;
  readonly pid: number;
}
export interface MemoryInfraNumber {
  readonly bytes: number | undefined;
  readonly raw: string | undefined;
  readonly reason: string | undefined;
}
export interface MemoryInfraAllocator {
  readonly name: string;
  readonly guid: string | undefined;
  readonly size: MemoryInfraNumber;
  readonly effectiveSize: MemoryInfraNumber;
  readonly allocatedObjectsSize: MemoryInfraNumber;
}
export interface MemoryInfraDump {
  readonly pid: number;
  readonly traceTsUs: number;
  readonly dumpGuid: string | undefined;
  readonly processTotals: Readonly<Record<string, MemoryInfraNumber>> | undefined;
  readonly allocators: ReadonlyArray<MemoryInfraAllocator>;
  readonly rawGraph: unknown;
  readonly fragmentKind: "process-total" | "allocator-graph" | "mixed";
  readonly source: "memory-infra";
}
export interface CorrelatedMemoryInfraDump extends MemoryInfraDump {
  readonly phase: string;
  readonly responseGuidMatches: boolean;
  readonly correlation: "window-and-pid";
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseHexBytes(value: unknown): MemoryInfraNumber {
  if (typeof value !== "string") return { bytes: undefined, raw: undefined, reason: "missing" };
  if (!/^[0-9a-f]+$/i.test(value)) return { bytes: undefined, raw: value, reason: "invalid-hex" };
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed)
    ? { bytes: parsed, raw: value, reason: undefined }
    : { bytes: undefined, raw: value, reason: "unsafe-integer" };
}
function numberAttr(attrs: Readonly<Record<string, unknown>>, name: string): MemoryInfraNumber {
  const attr = attrs[name];
  if (!record(attr)) return { bytes: undefined, raw: undefined, reason: "missing" };
  if (attr.units !== "bytes")
    return {
      bytes: undefined,
      raw: typeof attr.value === "string" ? attr.value : undefined,
      reason: "unexpected-units",
    };
  return parseHexBytes(attr.value);
}
function parseDumpEvent(event: MemoryInfraTraceEvent): MemoryInfraDump | undefined {
  const dumps = event.args?.dumps;
  if (!record(dumps)) return undefined;
  const allocators: MemoryInfraAllocator[] = [];
  if (record(dumps.allocators))
    for (const [name, raw] of Object.entries(dumps.allocators)) {
      if (!record(raw)) continue;
      const attrs = record(raw.attrs) ? raw.attrs : {};
      allocators.push({
        name,
        guid: typeof raw.guid === "string" ? raw.guid : undefined,
        size: numberAttr(attrs, "size"),
        effectiveSize: numberAttr(attrs, "effective_size"),
        allocatedObjectsSize: numberAttr(attrs, "allocated_objects_size"),
      });
    }
  let processTotals: Readonly<Record<string, MemoryInfraNumber>> | undefined;
  if (record(dumps.process_totals)) {
    const totals: Record<string, MemoryInfraNumber> = {};
    for (const name of ["private_footprint_bytes", "peak_resident_set_size"])
      if (name in dumps.process_totals) totals[name] = parseHexBytes(dumps.process_totals[name]);
    processTotals = totals;
  }
  return {
    pid: event.pid,
    traceTsUs: event.ts,
    dumpGuid: event.id,
    processTotals,
    allocators,
    rawGraph: dumps.allocators_graph,
    fragmentKind:
      dumps.allocators !== undefined && dumps.process_totals !== undefined
        ? "mixed"
        : dumps.allocators !== undefined
          ? "allocator-graph"
          : "process-total",
    source: "memory-infra",
  };
}
export function parseMemoryInfraEvents(
  events: ReadonlyArray<MemoryInfraTraceEvent>,
): ReadonlyArray<MemoryInfraDump> {
  return events
    .filter((e) => e.ph === "v" && e.name === "periodic_interval")
    .map(parseDumpEvent)
    .filter((x): x is MemoryInfraDump => x !== undefined);
}
export function correlateMemoryInfra(
  dumps: ReadonlyArray<MemoryInfraDump>,
  windows: ReadonlyArray<MemoryInfraRequestWindow>,
  traceEvents: ReadonlyArray<MemoryInfraTraceEvent> = [],
): ReadonlyArray<CorrelatedMemoryInfraDump> {
  const markers = new Map<string, number>();
  const duplicateMarkers = new Set<string>();
  for (const e of traceEvents) {
    const id = e.args?.sync_id;
    if (e.name === "clock_sync" && typeof id === "string") {
      if (markers.has(id)) duplicateMarkers.add(id);
      markers.set(id, e.ts);
    }
  }
  return windows.flatMap((w) => {
    const before = markers.get(w.beforeSyncId),
      after = markers.get(w.afterSyncId);
    if (
      duplicateMarkers.has(w.beforeSyncId) ||
      duplicateMarkers.has(w.afterSyncId) ||
      before === undefined ||
      after === undefined ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      after < before
    )
      return [];
    return dumps
      .filter((d) => d.pid === w.pid && d.traceTsUs >= before && d.traceTsUs <= after)
      .map((d) => ({
        ...d,
        phase: w.label,
        responseGuidMatches: d.dumpGuid === w.responseDumpGuid,
        correlation: "window-and-pid" as const,
      }));
  });
}
export interface MemoryInfraTransport {
  send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
}
export interface MemoryInfraProbe {
  readonly events: MemoryInfraTraceEvent[];
  readonly requestDump: (label: string, pid: number) => Promise<MemoryInfraRequestWindow>;
  readonly stop: () => Promise<void>;
  readonly truncated: boolean;
}
export interface MemoryInfraProbeOptions {
  readonly commandTimeoutMs?: number;
  readonly completeTimeoutMs?: number;
  readonly maxEvents?: number;
  readonly maxTraceBytes?: number;
}
function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
function metricTimestamp(value: unknown): number {
  if (!record(value) || !Array.isArray(value.metrics))
    throw new Error("Performance.Timestamp unavailable");
  const metric = value.metrics.find((x) => record(x) && x.name === "Timestamp");
  if (!record(metric) || typeof metric.value !== "number" || !Number.isFinite(metric.value))
    throw new Error("Performance.Timestamp unavailable");
  return metric.value * 1_000_000;
}
export async function startMemoryInfraProbe(
  transport: MemoryInfraTransport,
  options: MemoryInfraProbeOptions = {},
): Promise<MemoryInfraProbe> {
  const commandTimeoutMs = options.commandTimeoutMs ?? 10000;
  const completeTimeoutMs = options.completeTimeoutMs ?? 10000;
  const maxEvents = options.maxEvents ?? 20000;
  const maxTraceBytes = options.maxTraceBytes ?? 50000000;
  const events: MemoryInfraTraceEvent[] = [];
  let bytes = 0,
    truncated = false,
    stopped = false,
    seq = 0;
  const send = (m: string, p?: Readonly<Record<string, unknown>>) =>
    timeout(transport.send(m, p), commandTimeoutMs, m);
  const onData = (payload: unknown): void => {
    if (truncated || !record(payload) || !Array.isArray(payload.value)) return;
    for (const x of payload.value) {
      if (
        !record(x) ||
        typeof x.name !== "string" ||
        typeof x.ph !== "string" ||
        typeof x.pid !== "number" ||
        typeof x.ts !== "number"
      )
        continue;
      const e: MemoryInfraTraceEvent = {
        name: x.name,
        ph: x.ph,
        pid: x.pid,
        ts: x.ts,
        ...(typeof x.id === "string" ? { id: x.id } : {}),
        ...(record(x.args) ? { args: x.args } : {}),
      };
      const size = Buffer.byteLength(JSON.stringify(e), "utf8");
      if (events.length >= maxEvents || bytes + size > maxTraceBytes) {
        truncated = true;
        return;
      }
      bytes += size;
      events.push(e);
    }
  };
  let completeResolve: () => void = () => {};
  const completed = new Promise<void>((r) => {
    completeResolve = r;
  });
  const onComplete = (): void => completeResolve();
  transport.on("Tracing.dataCollected", onData);
  transport.on("Tracing.tracingComplete", onComplete);
  try {
    await send("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        recordMode: "recordUntilFull",
        includedCategories: ["disabled-by-default-memory-infra"],
        excludedCategories: ["*"],
        memoryDumpConfig: {},
      },
    });
  } catch (error) {
    // A timed-out start may still have enabled tracing in the remote process.
    if (error instanceof Error && error.message.startsWith("Tracing.start timeout")) {
      await send("Tracing.end").catch(() => undefined);
    }
    transport.off("Tracing.dataCollected", onData);
    transport.off("Tracing.tracingComplete", onComplete);
    throw error;
  }
  let tail = Promise.resolve();
  let stopPromise: Promise<void> | undefined;
  return {
    events,
    get truncated() {
      return truncated;
    },
    async requestDump(label, pid) {
      if (stopped) throw new Error("MemoryInfra probe stopped");
      const operation = tail.then(async () => {
        const requestId = `${label}#${++seq}`,
          beforeSyncId = `${requestId}-before`,
          afterSyncId = `${requestId}-after`;
        const before = metricTimestamp(await send("Performance.getMetrics"));
        await send("Tracing.recordClockSyncMarker", { syncId: beforeSyncId });
        const response = await send("Tracing.requestMemoryDump", {
          deterministic: false,
          levelOfDetail: "detailed",
        });
        await send("Tracing.recordClockSyncMarker", { syncId: afterSyncId });
        const after = metricTimestamp(await send("Performance.getMetrics"));
        if (!record(response) || response.success !== true || typeof response.dumpGuid !== "string")
          throw new Error(`${requestId} requestMemoryDump unavailable`);
        return {
          requestId,
          label,
          beforeTsUs: before,
          afterTsUs: after,
          beforeSyncId,
          afterSyncId,
          responseDumpGuid: response.dumpGuid,
          pid,
        };
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    stop() {
      if (stopPromise !== undefined) return stopPromise;
      stopPromise = (async () => {
        stopped = true;
        await tail;
        try {
          await send("Tracing.end");
          await timeout(completed, completeTimeoutMs, "Tracing.tracingComplete");
        } finally {
          transport.off("Tracing.dataCollected", onData);
          transport.off("Tracing.tracingComplete", onComplete);
        }
      })();
      return stopPromise;
    },
  };
}
