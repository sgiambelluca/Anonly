import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  C1_BLOCK,
  C2_BLOCK,
  PEAK_ARMS,
  armKeeps,
  createPeakArmIdentity,
  parsePeakArm,
  transformPeakSource,
} from "./peakArmsTransform.js";

const ROOT = resolve(__dirname, "../../..");
const PDF_ENGINE = resolve(ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts");
const ORCHESTRATOR = resolve(ROOT, "packages/anonymization-core/src/orchestrator.ts");

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
    const orchestrator = `x\n${C2_BLOCK}y\n`;
    expect(transformPeakSource(pdf, "pdf-engine", "base")).toBe("a\nb\n");
    expect(transformPeakSource(orchestrator, "orchestrator", "base")).toBe("x\ny\n");
  });

  it("c1 keeps only the parse cleanup and c2 keeps only the NER release", () => {
    expect(armKeeps("c1", "pdf-engine")).toBe(true);
    expect(armKeeps("c1", "orchestrator")).toBe(false);
    expect(armKeeps("c2", "pdf-engine")).toBe(false);
    expect(armKeeps("c2", "orchestrator")).toBe(true);
    expect(PEAK_ARMS).toEqual(["base", "c1", "c2", "head"]);
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
});
