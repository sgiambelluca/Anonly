import { describe, expect, it } from "vitest";

import {
  correlateMemoryInfra,
  parseMemoryInfraEvents,
  startMemoryInfraProbe,
  type MemoryInfraTransport,
} from "./memoryInfra.js";

describe("memory-infra parser", () => {
  it("parses hex byte fields without combining allocator levels", () => {
    const events = parseMemoryInfraEvents([
      {
        name: "periodic_interval",
        ph: "v",
        pid: 42,
        ts: 120,
        id: "0x0",
        args: {
          dumps: {
            process_totals: { private_footprint_bytes: "2d11000" },
            allocators: {
              malloc: {
                guid: "7",
                attrs: {
                  size: { type: "scalar", units: "bytes", value: "10" },
                  effective_size: { type: "scalar", units: "bytes", value: "f" },
                  allocated_objects_size: { type: "scalar", units: "bytes", value: "8" },
                },
              },
            },
          },
        },
      },
    ]);
    expect(events[0]?.processTotals?.private_footprint_bytes?.bytes).toBe(0x2d11000);
    expect(events[0]?.allocators[0]?.size.bytes).toBe(16);
    expect(events[0]?.allocators[0]?.effectiveSize.bytes).toBe(15);
    expect(events[0]?.allocators[0]?.allocatedObjectsSize.bytes).toBe(8);
  });

  it("rejects missing, non-byte and non-hex values", () => {
    const [dump] = parseMemoryInfraEvents([
      {
        name: "periodic_interval",
        ph: "v",
        pid: 42,
        ts: 120,
        args: {
          dumps: {
            allocators: {
              test: {
                attrs: {
                  size: { units: "objects", value: "10" },
                  effective_size: { units: "bytes", value: "10g" },
                },
              },
            },
          },
        },
      },
    ]);
    expect(dump?.allocators[0]?.size.reason).toBe("unexpected-units");
    expect(dump?.allocators[0]?.effectiveSize.reason).toBe("invalid-hex");
    expect(dump?.allocators[0]?.allocatedObjectsSize.reason).toBe("missing");
  });

  it("correlates by PID and clock-sync window even when response GUID differs", () => {
    const [dump] = parseMemoryInfraEvents([
      {
        name: "periodic_interval",
        ph: "v",
        pid: 42,
        ts: 220,
        id: "0x0",
        args: { dumps: { allocators: {} } },
      },
    ]);
    const correlated = correlateMemoryInfra(
      [dump!],
      [
        {
          requestId: "buffer#1",
          label: "buffer",
          beforeTsUs: 100,
          afterTsUs: 300,
          beforeSyncId: "buffer-before",
          afterSyncId: "buffer-after",
          responseDumpGuid: "0x1",
          pid: 42,
        },
      ],
      [
        { name: "clock_sync", ph: "c", pid: 1, ts: 150, args: { sync_id: "buffer-before" } },
        { name: "clock_sync", ph: "c", pid: 1, ts: 250, args: { sync_id: "buffer-after" } },
      ],
    );
    expect(correlated).toHaveLength(1);
    expect(correlated[0]?.responseGuidMatches).toBe(false);
    expect(correlated[0]?.correlation).toBe("window-and-pid");
  });

  it("cleans listeners when Tracing.start fails and stops idempotently", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const calls: string[] = [];
    const transport: MemoryInfraTransport = {
      send: async (method) => {
        calls.push(method);
        if (method === "Tracing.start") throw new Error("unsupported");
        return {};
      },
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
    };
    await expect(startMemoryInfraProbe(transport)).rejects.toThrow("unsupported");
    expect(listeners.size).toBe(0);
    const okay: MemoryInfraTransport = {
      ...transport,
      send: async (method) => {
        calls.push(method);
        if (method === "Performance.getMetrics")
          return { metrics: [{ name: "Timestamp", value: 1 }] };
        if (method === "Tracing.requestMemoryDump") return { success: false };
        if (method === "Tracing.end") listeners.get("Tracing.tracingComplete")?.({});
        return {};
      },
    };
    const probe = await startMemoryInfraProbe(okay, { completeTimeoutMs: 20 });
    await expect(probe.requestDump("same", 7)).rejects.toThrow("unavailable");
    await probe.stop();
    await probe.stop();
    expect(calls.filter((call) => call === "Tracing.end")).toHaveLength(1);
  });

  it("serializes concurrent requests and waits for the active request before stop", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const order: string[] = [];
    const transport: MemoryInfraTransport = {
      send: async (method) => {
        order.push(method);
        if (method === "Performance.getMetrics")
          return { metrics: [{ name: "Timestamp", value: 1 }] };
        if (method === "Tracing.requestMemoryDump") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { success: true, dumpGuid: `guid-${order.filter((x) => x === method).length}` };
        }
        if (method === "Tracing.end") listeners.get("Tracing.tracingComplete")?.({});
        return {};
      },
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
    };
    const probe = await startMemoryInfraProbe(transport, { completeTimeoutMs: 20 });
    const first = probe.requestDump("same", 1);
    const second = probe.requestDump("same", 1);
    await Promise.all([first, second]);
    await probe.stop();
    expect(order.indexOf("Tracing.end")).toBeGreaterThan(
      order.lastIndexOf("Tracing.recordClockSyncMarker"),
    );
  });

  it("rejects missing and non-finite CDP timestamps and excludes incomplete windows", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const transport: MemoryInfraTransport = {
      send: async (method) => {
        if (method === "Performance.getMetrics")
          return { metrics: [{ name: "Other", value: Number.NaN }] };
        return method === "Tracing.requestMemoryDump" ? { success: true, dumpGuid: "g" } : {};
      },
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
    };
    const probe = await startMemoryInfraProbe(transport, { completeTimeoutMs: 20 });
    await expect(probe.requestDump("missing", 1)).rejects.toThrow("Timestamp unavailable");
    await probe.stop().catch(() => undefined);
    expect(
      correlateMemoryInfra(
        [],
        [
          {
            requestId: "x",
            label: "x",
            beforeTsUs: 0,
            afterTsUs: 10,
            beforeSyncId: "x-b",
            afterSyncId: "x-a",
            responseDumpGuid: "g",
            pid: 1,
          },
        ],
      ),
    ).toHaveLength(0);
  });

  it("marks event and byte limits as truncated", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const transport: MemoryInfraTransport = {
      send: async (method) => {
        if (method === "Tracing.start") {
          listeners.get("Tracing.dataCollected")?.({
            value: [
              { name: "a", ph: "v", pid: 1, ts: 1 },
              { name: "b", ph: "v", pid: 1, ts: 2 },
            ],
          });
        }
        if (method === "Tracing.end") listeners.get("Tracing.tracingComplete")?.({});
        return {};
      },
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
    };
    const probe = await startMemoryInfraProbe(transport, { maxEvents: 1, maxTraceBytes: 1 });
    expect(probe.truncated).toBe(true);
    await probe.stop();
  });
});

function probeHarness(
  handle: (method: string) => Promise<unknown> = async () => ({}),
  emitCompletion = true,
): {
  readonly transport: MemoryInfraTransport;
  readonly listeners: Map<string, (payload: unknown) => void>;
  readonly calls: string[];
} {
  const listeners = new Map<string, (payload: unknown) => void>();
  const calls: string[] = [];
  return {
    listeners,
    calls,
    transport: {
      send: async (method) => {
        calls.push(method);
        if (method === "Tracing.end" && emitCompletion)
          listeners.get("Tracing.tracingComplete")?.({});
        return handle(method);
      },
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      off: (event) => {
        listeners.delete(event);
      },
    },
  };
}

it("cleans up a timed-out start, including a bounded remote end attempt", async () => {
  const harness = probeHarness(async (method) =>
    method === "Tracing.start" ? new Promise<unknown>(() => {}) : {},
  );
  await expect(startMemoryInfraProbe(harness.transport, { commandTimeoutMs: 10 })).rejects.toThrow(
    "Tracing.start timeout",
  );
  expect(harness.calls).toContain("Tracing.end");
  expect(harness.listeners.size).toBe(0);
});

it("bounds a missing tracingComplete and removes listeners on rejection", async () => {
  const harness = probeHarness(undefined, false);
  const probe = await startMemoryInfraProbe(harness.transport, { completeTimeoutMs: 10 });
  const stop = probe.stop();
  expect(probe.stop()).toBe(stop);
  await expect(stop).rejects.toThrow("Tracing.tracingComplete timeout");
  expect(harness.listeners.size).toBe(0);
  await expect(probe.requestDump("late", 1)).rejects.toThrow("stopped");
});

it("bounds a stuck dump and lets stop drain the failed request", async () => {
  const harness = probeHarness(async (method) => {
    if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
    if (method === "Tracing.requestMemoryDump") return new Promise<unknown>(() => {});
    return {};
  });
  const probe = await startMemoryInfraProbe(harness.transport, { commandTimeoutMs: 10 });
  const request = probe.requestDump("stuck", 1);
  const rejected = expect(request).rejects.toThrow("Tracing.requestMemoryDump timeout");
  const stopped = probe.stop();
  await rejected;
  await stopped;
  expect(harness.calls.indexOf("Tracing.end")).toBeGreaterThan(
    harness.calls.indexOf("Tracing.requestMemoryDump"),
  );
  expect(harness.listeners.size).toBe(0);
});

it("counts UTF8 bytes and stops collecting after the first truncation", async () => {
  const event = { name: "é漢", ph: "v", pid: 1, ts: 1 };
  const harness = probeHarness();
  const probe = await startMemoryInfraProbe(harness.transport, {
    maxTraceBytes: Buffer.byteLength(JSON.stringify(event), "utf8") - 1,
  });
  harness.listeners.get("Tracing.dataCollected")?.({ value: [event] });
  harness.listeners.get("Tracing.dataCollected")?.({
    value: [{ name: "a", ph: "v", pid: 1, ts: 2 }],
  });
  expect(probe.truncated).toBe(true);
  expect(probe.events).toHaveLength(0);
  await probe.stop();
});

it("enforces the event count independently of the byte limit", async () => {
  const harness = probeHarness();
  const probe = await startMemoryInfraProbe(harness.transport, { maxEvents: 1 });
  harness.listeners.get("Tracing.dataCollected")?.({
    value: [
      { name: "a", ph: "v", pid: 1, ts: 1 },
      { name: "b", ph: "v", pid: 1, ts: 2 },
    ],
  });
  expect(probe.events).toHaveLength(1);
  expect(probe.truncated).toBe(true);
  await probe.stop();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects a non-finite Timestamp (%s)",
  async (value) => {
    const harness = probeHarness(async (method) =>
      method === "Performance.getMetrics" ? { metrics: [{ name: "Timestamp", value }] } : {},
    );
    const probe = await startMemoryInfraProbe(harness.transport);
    await expect(probe.requestDump("bad-clock", 1)).rejects.toThrow("Timestamp unavailable");
    await probe.stop();
  },
);

it("rejects missing or duplicate markers and excludes events outside the window", () => {
  const fragments = parseMemoryInfraEvents(
    [9, 15, 21].map((ts) => ({
      name: "periodic_interval",
      ph: "v",
      pid: 1,
      ts,
      id: "0x0",
      args: { dumps: { allocators: {} } },
    })),
  );
  const windows = [
    {
      requestId: "r",
      label: "phase",
      beforeTsUs: 0,
      afterTsUs: 100,
      beforeSyncId: "before",
      afterSyncId: "after",
      responseDumpGuid: "0x1",
      pid: 1,
    },
  ];
  const before = { name: "clock_sync", ph: "c", pid: 1, ts: 10, args: { sync_id: "before" } };
  const after = { name: "clock_sync", ph: "c", pid: 1, ts: 20, args: { sync_id: "after" } };
  expect(correlateMemoryInfra(fragments, windows, [before])).toHaveLength(0);
  expect(correlateMemoryInfra(fragments, windows, [before, before, after])).toHaveLength(0);
  const matches = correlateMemoryInfra(fragments, windows, [before, after]);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.traceTsUs).toBe(15);
});
