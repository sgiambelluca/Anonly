import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  C1_BLOCK,
  C2_BLOCK,
  C2B_ANCHOR,
  C2B_INSERTION,
  C4_RASTER_BLOCK,
  C4_RENDER_BLOCK,
  PEAK_ARMS,
  armKeeps,
  createPeakArmIdentity,
  parsePeakArm,
  transformPeakSource,
  type PeakSourceFile,
} from "./peakArmsTransform.js";

const ROOT = resolve(__dirname, "../../..");
const SOURCES: ReadonlyArray<[PeakSourceFile, string]> = [
  ["pdf-engine", resolve(ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts")],
  ["orchestrator", resolve(ROOT, "packages/anonymization-core/src/orchestrator.ts")],
  [
    "render-kernel",
    resolve(ROOT, "packages/anonymization-core/render-engine/src/worker/kernel.ts"),
  ],
];
const read = (file: PeakSourceFile): string =>
  readFileSync(SOURCES.find(([name]) => name === file)![1], "utf8");

describe("peakArmsTransform", () => {
  it("each implemented block matches the current product source exactly once", () => {
    expect(read("pdf-engine").split(C1_BLOCK)).toHaveLength(2);
    expect(read("orchestrator").split(C2_BLOCK)).toHaveLength(2);
    expect(read("render-kernel").split(C4_RENDER_BLOCK)).toHaveLength(2);
    expect(read("render-kernel").split(C4_RASTER_BLOCK)).toHaveLength(2);
  });

  it("the head arm returns every source unchanged", () => {
    for (const [file] of SOURCES)
      expect(transformPeakSource(read(file), file, "head")).toBe(read(file));
  });

  it("the base arm removes every implemented change and nothing else", () => {
    expect(transformPeakSource(`a\n${C1_BLOCK}b\n`, "pdf-engine", "base")).toBe("a\nb\n");
    expect(transformPeakSource(`x\n${C2_BLOCK}y\n${C2B_ANCHOR}`, "orchestrator", "base")).toBe(
      `x\ny\n${C2B_ANCHOR}`,
    );
    expect(
      transformPeakSource(`p\n${C4_RENDER_BLOCK}q\n${C4_RASTER_BLOCK}r\n`, "render-kernel", "base"),
    ).toBe("p\nq\nr\n");
  });

  it("the base arm sources no longer call cleanup or release NER", () => {
    expect(transformPeakSource(read("pdf-engine"), "pdf-engine", "base")).not.toContain(
      "pageProxy.cleanup()",
    );
    expect(transformPeakSource(read("orchestrator"), "orchestrator", "base")).not.toContain(
      "this.engines.ner.releaseIdleWorkers()",
    );
    expect(transformPeakSource(read("render-kernel"), "render-kernel", "base")).not.toContain(
      "pageProxy.cleanup()",
    );
  });

  it("each single-change arm keeps only its own change", () => {
    expect(PEAK_ARMS).toEqual(["base", "c1", "c2", "c4", "c14", "c2b", "head"]);
    const keeps = (arm: (typeof PEAK_ARMS)[number]) => SOURCES.map(([file]) => armKeeps(arm, file));
    expect(keeps("base")).toEqual([false, false, false]);
    expect(keeps("c1")).toEqual([true, false, false]);
    expect(keeps("c2")).toEqual([false, true, false]);
    expect(keeps("c4")).toEqual([false, false, true]);
    expect(keeps("c14")).toEqual([true, false, true]);
    expect(keeps("c2b")).toEqual([true, false, true]);
    expect(keeps("head")).toEqual([true, true, true]);
  });

  it("the c4 arm keeps the cleanup only after rasterizing and after full renders", () => {
    const out = transformPeakSource(read("render-kernel"), "render-kernel", "c4");
    expect(out.split("pageProxy.cleanup()")).toHaveLength(3);
    expect(out).toContain('if (mode === "full") pageProxy.cleanup();');
  });

  it("rejects a source where a block is missing or repeated", () => {
    expect(() => transformPeakSource("nada", "pdf-engine", "base")).toThrow(/exactamente una vez/);
    expect(() =>
      transformPeakSource(`${C2_BLOCK}${C2_BLOCK}${C2B_ANCHOR}`, "orchestrator", "head"),
    ).toThrow(/exactamente una vez/);
    expect(() => transformPeakSource(C4_RENDER_BLOCK, "render-kernel", "head")).toThrow(
      /exactamente una vez/,
    );
  });

  it("identity hashes differ only when the arm removes the block", () => {
    const source = `a\n${C1_BLOCK}b\n`;
    const head = createPeakArmIdentity(source, "pdf-engine", "head");
    const base = createPeakArmIdentity(source, "pdf-engine", "base");
    expect(head.kept).toBe(true);
    expect(head.transformedSha256).toBe(head.sourceSha256);
    expect(base.kept).toBe(false);
    expect(base.transformedSha256).not.toBe(base.sourceSha256);
  });

  it("parses only the seven declared arms", () => {
    for (const arm of PEAK_ARMS) expect(parsePeakArm(arm)).toBe(arm);
    expect(() => parsePeakArm("c3")).toThrow(/brazo/);
    expect(() => parsePeakArm(undefined)).toThrow(/brazo/);
  });

  it("c2b moves the NER release from runOcrStage to the first page that needs OCR", () => {
    const out = transformPeakSource(read("orchestrator"), "orchestrator", "c2b");
    expect(out).not.toContain(C2_BLOCK);
    expect(out).toContain(C2B_ANCHOR + C2B_INSERTION);
    expect(out.split("this.engines.ner.releaseIdleWorkers()")).toHaveLength(2);
  });
});
