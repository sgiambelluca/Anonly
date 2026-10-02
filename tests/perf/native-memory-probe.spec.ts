import { expect, openApp, test } from "../e2e/support/electronApp.js";

import { readNativeMemory } from "./support/nativeMemory.js";

interface ElectronProcessMetric {
  readonly pid: number;
  readonly type: string;
}

interface ProcessFootprint {
  readonly pid: number;
  readonly type: string;
  readonly available: boolean;
  readonly footprintBytes: number | undefined;
  readonly commandDurationMs: number;
  readonly reason: string | undefined;
}

declare global {
  interface Window {
    __anonlyNativeProbe?:
      | {
          readonly bytes: ArrayBuffer;
          readonly canvas: HTMLCanvasElement | undefined;
          readonly imageData: ImageData | undefined;
        }
      | undefined;
  }
}

test("sonda macOS — control sintético de huella física de buffer y canvas+ImageData", async ({
  page,
  electronApp,
}) => {
  test.skip(
    process.env.ANONLY_NATIVE_MEMORY_PROBE !== "1",
    "sonda opt-in: ANONLY_NATIVE_MEMORY_PROBE=1",
  );
  test.skip(process.platform !== "darwin", "footprint es una sonda específica de macOS");
  test.setTimeout(120_000);
  await openApp(page, "networkidle");

  const metrics = await electronApp.evaluate(
    ({ app }): ReadonlyArray<ElectronProcessMetric> =>
      app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type })),
  );
  const renderer = metrics.find((metric) => metric.type === "Tab");
  expect(renderer, "el target renderer debe estar ocupado para observarlo").toBeDefined();
  if (renderer === undefined) return;

  const gpu = metrics.find((metric) => metric.type === "GPU");
  const readProcesses = async (): Promise<ReadonlyArray<ProcessFootprint>> => {
    const targets = gpu === undefined ? [renderer] : [renderer, gpu];
    const readings = await Promise.all(targets.map((target) => readNativeMemory(target.pid)));
    return readings.flatMap((reading, index) => {
      const target = targets[index];
      if (target === undefined) return [];
      return [
        {
          pid: target.pid,
          type: target.type,
          available: reading.available,
          footprintBytes: reading.physicalFootprintBytes,
          commandDurationMs: reading.commandDurationMs,
          reason: reading.reason,
        },
      ];
    });
  };

  const before = await readProcesses();
  expect(before.some((reading) => reading.type === "Tab")).toBe(true);

  await page.evaluate(() => {
    const bytes = new ArrayBuffer(32_000_000);
    const view = new Uint8Array(bytes);
    for (let index = 0; index < view.length; index += 4096) view[index] = index % 251;
    window.__anonlyNativeProbe = { bytes, canvas: undefined, imageData: undefined };
  });
  const afterAllocation = await readProcesses();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await page.evaluate(() => {
    window.__anonlyNativeProbe = undefined;
  });
  await cdp.send("HeapProfiler.collectGarbage");
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  const afterRelease = await readProcesses();
  const beforeCanvas = afterRelease;
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 4096;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no se pudo crear el contexto 2D del control");
    context.fillStyle = "rgb(17, 31, 47)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    window.__anonlyNativeProbe = {
      bytes: new ArrayBuffer(0),
      canvas,
      imageData,
    };
  });
  const afterCanvas = await readProcesses();
  await page.evaluate(() => {
    window.__anonlyNativeProbe = undefined;
  });
  await cdp.detach();

  // Los umbrales son tolerancias del control sintético para discriminar si la
  // sonda observa una asignación conocida; no son un presupuesto del producto.
  console.log(
    JSON.stringify({
      pid: renderer.pid,
      before,
      afterAllocation,
      afterRelease,
      beforeCanvas,
      afterCanvas,
    }),
  );
  const footprint = (samples: ReadonlyArray<ProcessFootprint>, type: string): number | undefined =>
    samples.find((sample) => sample.type === type)?.footprintBytes;
  const tabBefore = footprint(before, "Tab");
  const tabAfterAllocation = footprint(afterAllocation, "Tab");
  const tabAfterRelease = footprint(afterRelease, "Tab");
  const tabBeforeCanvas = footprint(beforeCanvas, "Tab");
  const tabAfterCanvas = footprint(afterCanvas, "Tab");
  const gpuBeforeCanvas = footprint(beforeCanvas, "GPU");
  const gpuAfterCanvas = footprint(afterCanvas, "GPU");
  expect(tabBefore).toBeDefined();
  expect(tabAfterAllocation).toBeDefined();
  expect(tabAfterRelease).toBeDefined();
  expect(tabAfterAllocation! - tabBefore!).toBeGreaterThan(16_000_000);
  expect(tabAfterRelease! - tabAfterAllocation!).toBeLessThan(-8_000_000);
  const canvasDeltaTab =
    tabAfterCanvas === undefined || tabBeforeCanvas === undefined
      ? undefined
      : tabAfterCanvas - tabBeforeCanvas;
  const canvasDeltaGpu =
    gpuAfterCanvas === undefined || gpuBeforeCanvas === undefined
      ? undefined
      : gpuAfterCanvas - gpuBeforeCanvas;
  expect(
    (canvasDeltaTab !== undefined && canvasDeltaTab > 16_000_000) ||
      (canvasDeltaGpu !== undefined && canvasDeltaGpu > 16_000_000),
  ).toBe(true);
});
