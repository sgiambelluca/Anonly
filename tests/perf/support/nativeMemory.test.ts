import { describe, expect, it } from "vitest";

import { parseFootprintOutput, readNativeMemory } from "./nativeMemory.js";

describe("readNativeMemory", () => {
  it("reports an invalid pid without invoking a system probe", async () => {
    const result = await readNativeMemory(0);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("invalid-pid");
    expect(result.commandDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("parses the byte format without applying decimal unit conversions", () => {
    const parsed = parseFootprintOutput(`
Footprint: 12345678 B
        Dirty         Clean   Reclaimable    Regions    Category
   1000000 B      200000 B       300000 B          7    app-specific tag 14
        ---           ---           ---        ---    ---
  1000000 B      200000 B       300000 B          7    TOTAL
Auxiliary data:
    phys_footprint_peak: 23456789 B
    phys_footprint: 12345678 B
`);
    expect(parsed.physicalFootprintBytes).toBe(12_345_678);
    expect(parsed.physicalFootprintPeakBytes).toBe(23_456_789);
    expect(parsed.categories).toEqual([
      {
        dirtyBytes: 1_000_000,
        cleanBytes: 200_000,
        reclaimableBytes: 300_000,
        regions: 7,
        name: "app-specific tag 14",
      },
    ]);
  });

  it("rejects formatted units because only footprint -f bytes is comparable", () => {
    const parsed = parseFootprintOutput("phys_footprint: 12 MB\nphys_footprint_peak: 13 MB");
    expect(parsed.physicalFootprintBytes).toBeUndefined();
    expect(parsed.physicalFootprintPeakBytes).toBeUndefined();
  });

  it("leaves incomplete output unavailable instead of manufacturing zero", () => {
    const parsed = parseFootprintOutput("Footprint: unavailable");
    expect(parsed.physicalFootprintBytes).toBeUndefined();
    expect(parsed.categories).toEqual([]);
  });

  it("returns a structured result for the current process on macOS", async () => {
    const result = await readNativeMemory(process.pid);
    if (process.platform === "darwin") {
      expect(result.available).toBe(true);
      expect(result.physicalFootprintBytes).toBeGreaterThan(0);
      expect(result.categories.length).toBeGreaterThan(0);
    } else {
      expect(result.available).toBe(false);
    }
  });
});
