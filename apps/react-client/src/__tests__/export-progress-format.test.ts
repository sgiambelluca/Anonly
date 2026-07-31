import { describe, expect, it } from "vitest";

import {
  exportProgressPercent,
  formatExportProgressLabel,
  formatFileSize,
} from "../components/export/exportProgressFormat.js";

describe("formatExportProgressLabel", () => {
  it("shows a preparing message when progress is null", () => {
    expect(formatExportProgressLabel(null)).toBe("Preparando exportación…");
  });

  it("shows a preparing message when total is 0", () => {
    expect(formatExportProgressLabel({ current: 0, total: 0 })).toBe("Preparando exportación…");
  });

  it("shows current/total page counts", () => {
    expect(formatExportProgressLabel({ current: 3, total: 10 })).toBe("Página 3 de 10");
  });
});

describe("exportProgressPercent", () => {
  it("is 0 when progress is null", () => {
    expect(exportProgressPercent(null)).toBe(0);
  });

  it("is 0 when total is 0", () => {
    expect(exportProgressPercent({ current: 0, total: 0 })).toBe(0);
  });

  it("computes a rounded percentage", () => {
    expect(exportProgressPercent({ current: 3, total: 10 })).toBe(30);
    expect(exportProgressPercent({ current: 1, total: 3 })).toBe(33);
  });

  it("clamps to 100 even if current exceeds total", () => {
    expect(exportProgressPercent({ current: 12, total: 10 })).toBe(100);
  });
});

describe("formatFileSize", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatFileSize(1_258_291)).toBe("1.2 MB");
  });

  it("returns '0 B' for negative or non-finite input", () => {
    expect(formatFileSize(-1)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
  });
});
