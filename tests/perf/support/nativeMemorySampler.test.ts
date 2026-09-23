import { describe, expect, it } from "vitest";

import {
  createNativeMemorySampling,
  type NativeMemoryProcessSample,
  type NativeMemorySample,
} from "./nativeMemorySampler.js";

describe("NativeMemorySample", () => {
  it("keeps timestamps and process snapshots separate from RSS", () => {
    const sample: NativeMemorySample = {
      atMs: 1_000,
      startedAtEpochMs: 2_000,
      finishedAtEpochMs: 2_093,
      wallDurationMs: 93,
      commandDurationMs: 93,
      processes: [],
    };
    expect(sample.atMs).not.toBe(sample.startedAtEpochMs);
    expect(sample.finishedAtEpochMs - sample.startedAtEpochMs).toBe(sample.wallDurationMs);
    expect(sample.commandDurationMs).toBeGreaterThan(0);
  });

  it("does not overlap periodic and manual reads, and stop drains the in-flight read", async () => {
    let active = 0;
    let maxActive = 0;
    let resolveRead: ((value: ReadonlyArray<NativeMemoryProcessSample>) => void) | undefined;
    const reader = (): Promise<ReadonlyArray<NativeMemoryProcessSample>> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        resolveRead = (value) => {
          active -= 1;
          resolve(value);
        };
      });
    };
    const sampler = createNativeMemorySampling(reader, 1);
    const pending = sampler.sampleOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(maxActive).toBe(1);
    const stopping = sampler.stop();
    resolveRead?.([]);
    await stopping;
    await pending;
    expect(sampler.errors).toEqual([]);
  });

  it("records a rejected probe and still stops cleanly", async () => {
    const sampler = createNativeMemorySampling(async () => {
      throw new Error("probe failed");
    });
    await expect(sampler.sampleOnce()).rejects.toThrow("probe failed");
    expect(sampler.errors).toHaveLength(1);
    expect(sampler.errors[0]?.message).toBe("probe failed");
    await sampler.stop();
  });

  it("records one sample when a manual read shares the periodic read", async () => {
    let resolveRead: ((value: ReadonlyArray<NativeMemoryProcessSample>) => void) | undefined;
    const reader = (): Promise<ReadonlyArray<NativeMemoryProcessSample>> =>
      new Promise((resolve) => {
        resolveRead = resolve;
      });
    const sampler = createNativeMemorySampling(reader, 1);
    const manual = sampler.sampleOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    resolveRead?.([]);
    await manual;
    await sampler.stop();
    expect(sampler.samples).toHaveLength(1);
  });

  it("does not start a read after stop", async () => {
    let calls = 0;
    const sampler = createNativeMemorySampling(async () => {
      calls += 1;
      return [];
    });
    await sampler.stop();
    await expect(sampler.sampleOnce()).rejects.toThrow("native-memory-sampler-stopped");
    expect(calls).toBe(1);
  });
});
