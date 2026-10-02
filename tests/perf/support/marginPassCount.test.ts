import { describe, expect, it } from "vitest";

import { MarginPassCountParseError, parseMarginPassCountEntries } from "./marginPassCount.js";

describe("parseMarginPassCountEntries", () => {
  it("suma conteos enteros no negativos", () => {
    expect(parseMarginPassCountEntries([0, 4, 8])).toBe(12);
  });

  it("rechaza registros que no son conteos", () => {
    expect(() => parseMarginPassCountEntries([1, -1])).toThrow(MarginPassCountParseError);
    expect(() => parseMarginPassCountEntries([1.5])).toThrow(MarginPassCountParseError);
    expect(() => parseMarginPassCountEntries(["2"])).toThrow(MarginPassCountParseError);
  });
});
