import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PARSE_CLEANUP_ANCHOR,
  PARSE_CLEANUP_INSERTION,
  createParseCleanupIdentity,
  parseParseCleanupArm,
  transformParseCleanupSource,
} from "./parseCleanupTransform.js";

const PDF_ENGINE = resolve(
  __dirname,
  "../../../packages/anonymization-core/pdf-engine/src/pdf.engine.ts",
);

describe("parseCleanupTransform", () => {
  it("the anchor matches the current product source exactly once", () => {
    const source = readFileSync(PDF_ENGINE, "utf8");
    expect(source.split(PARSE_CLEANUP_ANCHOR)).toHaveLength(2);
  });

  it("arm A returns the source unchanged", () => {
    const source = `a\n${PARSE_CLEANUP_ANCHOR}b\n`;
    expect(transformParseCleanupSource(source, "A")).toBe(source);
  });

  it("arm B inserts the cleanup right after the operator list", () => {
    const source = `a\n${PARSE_CLEANUP_ANCHOR}b\n`;
    expect(transformParseCleanupSource(source, "B")).toBe(
      `a\n${PARSE_CLEANUP_ANCHOR}${PARSE_CLEANUP_INSERTION}b\n`,
    );
  });

  it("rejects a source without the anchor or with two anchors", () => {
    expect(() => transformParseCleanupSource("nada", "B")).toThrow(/exactamente una vez/);
    expect(() =>
      transformParseCleanupSource(`${PARSE_CLEANUP_ANCHOR}${PARSE_CLEANUP_ANCHOR}`, "A"),
    ).toThrow(/exactamente una vez/);
  });

  it("rejects a source that already calls cleanup", () => {
    expect(() =>
      transformParseCleanupSource(`${PARSE_CLEANUP_ANCHOR}pageProxy.cleanup();\n`, "B"),
    ).toThrow(/ya llama/);
  });

  it("identity hashes differ only for arm B", () => {
    const source = `a\n${PARSE_CLEANUP_ANCHOR}b\n`;
    const a = createParseCleanupIdentity(source, "A");
    const b = createParseCleanupIdentity(source, "B");
    expect(a.sourceSha256).toBe(a.transformedSha256);
    expect(b.sourceSha256).toBe(a.sourceSha256);
    expect(b.transformedSha256).not.toBe(b.sourceSha256);
  });

  it("parses only the two declared arms", () => {
    expect(parseParseCleanupArm("A")).toBe("A");
    expect(parseParseCleanupArm("B")).toBe("B");
    expect(() => parseParseCleanupArm("C")).toThrow(/brazo/);
    expect(() => parseParseCleanupArm(undefined)).toThrow(/brazo/);
  });
});
