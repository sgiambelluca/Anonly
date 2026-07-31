import { afterEach, describe, expect, it } from "vitest";

import { disposeCore, getCore, initCore } from "../core-adapter/index.js";

describe("core-adapter/index", () => {
  afterEach(async () => {
    await disposeCore();
  });

  it("getCore throws before initCore resolves", () => {
    expect(() => getCore()).toThrow("Core not initialized");
  });

  it("initCore wires a usable IAnonymizationCore and getCore returns it afterwards", async () => {
    const core = await initCore();

    expect(core.bus).toBeDefined();
    expect(core.orchestrator).toBeDefined();
    expect(core.engines.grouping).toBeDefined();
    expect(getCore()).toBe(core);
  });

  it("initCore is idempotent: a second call returns the same instance", async () => {
    const first = await initCore();
    const second = await initCore();

    expect(second).toBe(first);
  });

  it("disposeCore releases the instance so getCore throws again", async () => {
    await initCore();
    await disposeCore();

    expect(() => getCore()).toThrow("Core not initialized");
  });
});
