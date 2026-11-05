import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  C1_BLOCK,
  C2_BLOCK,
  C3_ANCHOR,
  C3_INSERTION,
  C4_ANCHOR,
  C4_INSERTION,
  C4R_RASTER_ANCHOR,
  C4R_RASTER_INSERTION,
  C4R_RENDER_ANCHOR,
  C4R_RENDER_INSERTION,
  armAdds,
  PEAK_ARMS,
  armKeeps,
  createPeakArmIdentity,
  parsePeakArm,
  transformPeakSource,
} from "./peakArmsTransform.js";

const ROOT = resolve(__dirname, "../../..");
const PDF_ENGINE = resolve(ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts");
const ORCHESTRATOR = resolve(ROOT, "packages/anonymization-core/src/orchestrator.ts");
const RENDER_KERNEL = resolve(
  ROOT,
  "packages/anonymization-core/render-engine/src/worker/kernel.ts",
);

describe("peakArmsTransform", () => {
  it("each block matches the current product source exactly once", () => {
    expect(readFileSync(PDF_ENGINE, "utf8").split(C1_BLOCK)).toHaveLength(2);
    expect(readFileSync(ORCHESTRATOR, "utf8").split(C2_BLOCK)).toHaveLength(2);
  });

  it("the head arm returns both sources unchanged", () => {
    const pdf = readFileSync(PDF_ENGINE, "utf8");
    const orchestrator = readFileSync(ORCHESTRATOR, "utf8");
    expect(transformPeakSource(pdf, "pdf-engine", "head")).toBe(pdf);
    expect(transformPeakSource(orchestrator, "orchestrator", "head")).toBe(orchestrator);
  });

  it("the base arm removes both blocks and nothing else", () => {
    const pdf = `a\n${C1_BLOCK}b\n`;
    const orchestrator = `x\n${C2_BLOCK}y\n${C3_ANCHOR}`;
    expect(transformPeakSource(pdf, "pdf-engine", "base")).toBe("a\nb\n");
    expect(transformPeakSource(orchestrator, "orchestrator", "base")).toBe(`x\ny\n${C3_ANCHOR}`);
  });

  it("c1 keeps only the parse cleanup and c2 keeps only the NER release", () => {
    expect(armKeeps("c1", "pdf-engine")).toBe(true);
    expect(armKeeps("c1", "orchestrator")).toBe(false);
    expect(armKeeps("c2", "pdf-engine")).toBe(false);
    expect(armKeeps("c2", "orchestrator")).toBe(true);
    expect(PEAK_ARMS).toEqual(["base", "c1", "c2", "head", "c3", "c4", "c4r"]);
  });

  it("the base arm source no longer calls cleanup or releases NER", () => {
    const pdf = transformPeakSource(readFileSync(PDF_ENGINE, "utf8"), "pdf-engine", "base");
    const orchestrator = transformPeakSource(
      readFileSync(ORCHESTRATOR, "utf8"),
      "orchestrator",
      "base",
    );
    expect(pdf).not.toContain("pageProxy.cleanup()");
    expect(orchestrator).not.toContain("this.engines.ner.releaseIdleWorkers()");
  });

  it("rejects a source where the block is missing or repeated", () => {
    expect(() => transformPeakSource("nada", "pdf-engine", "base")).toThrow(/exactamente una vez/);
    expect(() => transformPeakSource(`${C2_BLOCK}${C2_BLOCK}`, "orchestrator", "head")).toThrow(
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

  it("parses only the four declared arms", () => {
    for (const arm of PEAK_ARMS) expect(parsePeakArm(arm)).toBe(arm);
    expect(() => parsePeakArm("A")).toThrow(/brazo/);
    expect(() => parsePeakArm(undefined)).toThrow(/brazo/);
  });

  it("the C-3 and C-4 anchors match the current product source exactly once", () => {
    expect(readFileSync(ORCHESTRATOR, "utf8").split(C3_ANCHOR)).toHaveLength(2);
    expect(readFileSync(RENDER_KERNEL, "utf8").split(C4_ANCHOR)).toHaveLength(2);
  });

  it("c3 is head plus the parse pool release right after parsing", () => {
    const orchestrator = readFileSync(ORCHESTRATOR, "utf8");
    const out = transformPeakSource(orchestrator, "orchestrator", "c3");
    expect(out).toContain(C2_BLOCK);
    expect(out).toContain(C3_INSERTION + C3_ANCHOR);
    expect(out.split('this.pools.getPool("pdf").releaseIdleWorkers()')).toHaveLength(2);
    expect(transformPeakSource(readFileSync(PDF_ENGINE, "utf8"), "pdf-engine", "c3")).toContain(
      C1_BLOCK,
    );
  });

  it("c4 is head plus a page cleanup after each render", () => {
    const kernel = readFileSync(RENDER_KERNEL, "utf8");
    const out = transformPeakSource(kernel, "render-kernel", "c4");
    expect(out).toContain(C4_ANCHOR + C4_INSERTION);
    expect(out.split("pageProxy.cleanup()")).toHaveLength(2);
    expect(transformPeakSource(kernel, "render-kernel", "head")).toBe(kernel);
  });

  it("only c3 adds to the orchestrator and only c4 or c4r add to the render kernel", () => {
    for (const arm of PEAK_ARMS) {
      expect(armAdds(arm, "orchestrator")).toBe(arm === "c3");
      expect(armAdds(arm, "render-kernel")).toBe(arm === "c4" || arm === "c4r");
      expect(armAdds(arm, "pdf-engine")).toBe(false);
    }
  });

  it("c4r cleans after rasterizing and only after full renders, never after previews", () => {
    const kernel = readFileSync(RENDER_KERNEL, "utf8");
    expect(kernel.split(C4R_RENDER_ANCHOR)).toHaveLength(2);
    expect(kernel.split(C4R_RASTER_ANCHOR)).toHaveLength(2);
    const out = transformPeakSource(kernel, "render-kernel", "c4r");
    expect(out).toContain(C4R_RENDER_ANCHOR + C4R_RENDER_INSERTION);
    expect(out).toContain(C4R_RASTER_ANCHOR + C4R_RASTER_INSERTION);
    expect(out).not.toContain(C4_INSERTION);
    expect(out.split("pageProxy.cleanup()")).toHaveLength(3);
    expect(out).toContain('if (mode === "full") pageProxy.cleanup();');
  });
});
