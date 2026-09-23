import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";

import {
  correlateMemoryInfra,
  parseMemoryInfraEvents,
  startMemoryInfraProbe,
  type MemoryInfraRequestWindow,
  type MemoryInfraTransport,
} from "./support/memoryInfra.js";

const SESSION_ID = `${new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, "")
  .slice(0, 14)}-${Math.random().toString(16).slice(2, 10)}`;
const OUT_DIR = resolve(process.cwd(), ".measure/memory-infra-control", SESSION_ID);

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

declare global {
  interface Window {
    __anonlyMemoryInfraControl?:
      | {
          readonly buffer?: ArrayBuffer;
          readonly canvas?: HTMLCanvasElement;
          readonly imageData?: ImageData;
          readonly wasm?: WebAssembly.Memory;
        }
      | undefined;
  }
}

test("MemoryInfra — controles sintéticos separados y correlación PID/clock", async ({
  page,
  electronApp,
}) => {
  test.skip(
    process.env.ANONLY_MEMORY_INFRA_CONTROL !== "1",
    "control opt-in: ANONLY_MEMORY_INFRA_CONTROL=1",
  );
  test.setTimeout(120_000);
  await openApp(page, "networkidle");
  const cdp = await page.context().newCDPSession(page);
  const transport: MemoryInfraTransport = {
    send: async (method, params) => {
      if (method === "Tracing.start") return cdp.send("Tracing.start", params);
      if (method === "Tracing.end") return cdp.send("Tracing.end");
      if (method === "Tracing.recordClockSyncMarker") {
        const syncId = params?.syncId;
        if (typeof syncId !== "string") throw new Error("syncId requerido");
        return cdp.send("Tracing.recordClockSyncMarker", { syncId });
      }
      if (method === "Tracing.requestMemoryDump")
        return cdp.send("Tracing.requestMemoryDump", params);
      if (method === "Performance.getMetrics") return cdp.send("Performance.getMetrics");
      throw new Error(`método no permitido: ${method}`);
    },
    on: (event, listener) => {
      if (event === "Tracing.dataCollected") cdp.on("Tracing.dataCollected", listener);
      if (event === "Tracing.tracingComplete") cdp.on("Tracing.tracingComplete", listener);
    },
    off: (event, listener) => {
      if (event === "Tracing.dataCollected") cdp.off("Tracing.dataCollected", listener);
      if (event === "Tracing.tracingComplete") cdp.off("Tracing.tracingComplete", listener);
    },
  };
  let activeProbe: Awaited<ReturnType<typeof startMemoryInfraProbe>> | undefined;
  const requests: MemoryInfraRequestWindow[] = [];
  try {
    await cdp.send("Performance.enable");
    const probe = await startMemoryInfraProbe(transport);
    activeProbe = probe;
    const tab = (await electronApp.evaluate(({ app }) => app.getAppMetrics())).find(
      (metric) => metric.type === "Tab",
    );
    expect(tab, "el target Tab debe estar ocupado").toBeDefined();
    if (tab === undefined) return;

    requests.push(await probe.requestDump("baseline", tab.pid));
    await page.evaluate(() => {
      const buffer = new ArrayBuffer(32 * 1024 * 1024);
      new Uint8Array(buffer).fill(7);
      window.__anonlyMemoryInfraControl = { ...window.__anonlyMemoryInfraControl, buffer };
    });
    requests.push(await probe.requestDump("buffer", tab.pid));
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 4096;
      canvas.height = 4096;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no se pudo crear el contexto 2D");
      context.fillRect(0, 0, canvas.width, canvas.height);
      window.__anonlyMemoryInfraControl = {
        ...window.__anonlyMemoryInfraControl,
        canvas,
      };
    });
    requests.push(await probe.requestDump("canvas-only", tab.pid));
    await page.evaluate(() => {
      const control = window.__anonlyMemoryInfraControl;
      if (control?.canvas === undefined) throw new Error("canvas control missing");
      const context = control.canvas.getContext("2d");
      if (context === null) throw new Error("no se pudo recuperar el contexto 2D");
      window.__anonlyMemoryInfraControl = {
        ...control,
        imageData: context.getImageData(0, 0, control.canvas.width, control.canvas.height),
      };
    });
    requests.push(await probe.requestDump("imageData", tab.pid));
    await page.evaluate(() => {
      const wasm = new WebAssembly.Memory({ initial: 1024 });
      new Uint8Array(wasm.buffer).fill(11);
      window.__anonlyMemoryInfraControl = { ...window.__anonlyMemoryInfraControl, wasm };
    });
    requests.push(await probe.requestDump("wasm", tab.pid));
    await page.evaluate(() => {
      window.__anonlyMemoryInfraControl = undefined;
    });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    requests.push(await probe.requestDump("release-forced-gc", tab.pid));
    await probe.stop();

    const parsed = parseMemoryInfraEvents(probe.events);
    const correlated = correlateMemoryInfra(parsed, requests, probe.events);
    await mkdir(OUT_DIR, { recursive: true });
    const versions = await electronApp.evaluate(() => process.versions);
    const assetDir = resolve(process.cwd(), "apps/react-client/dist/assets");
    const assetNames = (await readdir(assetDir)).sort();
    const assetHashes = Object.fromEntries(
      await Promise.all(
        assetNames.map(async (name) => [name, await sha256(resolve(assetDir, name))]),
      ),
    );
    await writeFile(
      resolve(OUT_DIR, "manifest.json"),
      `${JSON.stringify(
        {
          sessionId: SESSION_ID,
          probe: "memoryInfra-v1",
          configuration: {
            maxEvents: 20_000,
            maxTraceBytes: 50_000_000,
            controls: requests.map((x) => x.label),
          },
          runtime: versions,
          build: {
            shellMainSha256: await sha256("apps/desktop-shell/dist/main.js"),
            reactAssetsSha256: assetHashes,
          },
          truncated: probe.truncated,
          capturedAtEpochMs: Date.now(),
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(resolve(OUT_DIR, "requests.json"), `${JSON.stringify(requests, null, 2)}\n`);
    await writeFile(
      resolve(OUT_DIR, "summary.json"),
      `${JSON.stringify(
        {
          sessionId: SESSION_ID,
          pid: tab.pid,
          controlLabels: requests.map((window) => window.label),
          eventCount: probe.events.length,
          parsedDumpCount: parsed.length,
          correlatedDumpCount: correlated.length,
          responseGuidMatches: correlated.map((dump) => dump.responseGuidMatches),
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(resolve(OUT_DIR, "trace.json"), `${JSON.stringify(probe.events)}\n`);
    expect(parsed.length).toBeGreaterThan(0);
    const phaseNames = new Set(correlated.map((dump) => dump.phase));
    expect(phaseNames.has("imageData")).toBe(true);
    expect(phaseNames.has("buffer")).toBe(true);
    expect(phaseNames.has("canvas-only")).toBe(true);
    expect(phaseNames.has("wasm")).toBe(true);
    expect(phaseNames.has("release-forced-gc")).toBe(true);
    expect(probe.truncated).toBe(false);
    const arrayBufferBytes = (phase: string): number => {
      const counters = correlated
        .filter((fragment) => fragment.phase === phase)
        .flatMap((fragment) => fragment.allocators)
        .filter((allocator) => allocator.name === "partition_alloc/partitions/array_buffer")
        .map((allocator) => allocator.allocatedObjectsSize.bytes);
      expect(counters, `contador único de ArrayBuffer: ${phase}`).toHaveLength(1);
      const bytes = counters[0];
      if (bytes === undefined) throw new Error(`ArrayBuffer no disponible en ${phase}`);
      return bytes;
    };
    const baselineBytes = arrayBufferBytes("baseline");
    const phaseDelta = (phase: string): number => arrayBufferBytes(phase) - baselineBytes;
    const controlToleranceBytes = 128 * 1024;
    expect(Math.abs(phaseDelta("buffer") - 32 * 1024 * 1024)).toBeLessThanOrEqual(
      controlToleranceBytes,
    );
    expect(Math.abs(phaseDelta("canvas-only") - 32 * 1024 * 1024)).toBeLessThanOrEqual(
      controlToleranceBytes,
    );
    expect(Math.abs(phaseDelta("imageData") - 96 * 1024 * 1024)).toBeLessThanOrEqual(
      controlToleranceBytes,
    );
    expect(Math.abs(phaseDelta("wasm") - 96 * 1024 * 1024)).toBeLessThanOrEqual(
      controlToleranceBytes,
    );
    expect(Math.abs(phaseDelta("release-forced-gc"))).toBeLessThanOrEqual(controlToleranceBytes);
    expect(correlated.every((dump) => dump.pid === tab.pid)).toBe(true);
    expect(correlated.every((dump) => dump.correlation === "window-and-pid")).toBe(true);
    // Counters above validate known allocations; these are not product budgets.
    expect(
      parsed.some((dump) => dump.allocators.length > 0 || dump.processTotals !== undefined),
    ).toBe(true);
  } finally {
    try {
      await page.evaluate(() => {
        window.__anonlyMemoryInfraControl = undefined;
      });
    } finally {
      try {
        await activeProbe?.stop();
      } finally {
        await cdp.detach();
      }
    }
  }
});
