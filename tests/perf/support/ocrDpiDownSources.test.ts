import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { mergeCaveats, mergeSleepDetection, type SourceDetection } from "./campaignDetection.js";
import { createSourcedReader, invalidatedCorporaOf, type CellSource } from "./ocrDpiDownSources.js";
import { invalidatedCell, type CellRecord } from "./ocrDpiDownSummary.js";

const goodCell = (corpus: "S8" | "S10", marker: string): CellRecord => ({
  ...invalidatedCell(corpus, 300, 1, []),
  valid: true,
  fixtureSha256: marker,
});
const file = (corpus: string) => `ocr-dpi-down-cell-${corpus}-d300-rep1.json`;

function source(
  name: string,
  invalidated: Record<string, string[]>,
  cells: Record<string, CellRecord>,
): CellSource {
  return { name, invalidatedCorpora: invalidated, readCell: (fileName) => cells[fileName] };
}

describe("invalidatedCorporaOf", () => {
  it("toma solo los ids corpus-<ID> con su motivo", () => {
    expect(
      invalidatedCorporaOf({
        affectedRunIds: ["corpus-S8", "time-2-P2-r0"],
        reasonsByRunId: { "corpus-S8": ["sleep-wake-event-during-run"] },
      }),
    ).toEqual({ S8: ["sleep-wake-event-during-run"] });
    expect(invalidatedCorporaOf(undefined)).toEqual({});
  });
});

describe("createSourcedReader: la invalidación es por fuente y el corpus sale entero de una carpeta", () => {
  const all = (corpus: "S8" | "S10", marker: string) => ({
    [file(corpus)]: goodCell(corpus, marker),
    [file(corpus).replace("d300-rep1", "d300-rep2")]: goodCell(corpus, marker),
  });
  const arms = [300];

  it("una carpeta posterior con el corpus limpio lo recupera (B-5)", () => {
    const read = createSourcedReader(
      [
        source("primera", { S8: ["sleep-wake-event-during-run"] }, all("S8", "viejo")),
        source("continuacion", {}, all("S8", "nuevo")),
      ],
      arms,
    );
    expect(read("S8", 300, 1)?.fixtureSha256).toBe("nuevo");
    expect(read("S8", 300, 1)?.valid).toBe(true);
  });

  it("control de fallo: sin carpeta limpia, el corpus invalidado sale inválido (no ausente ni válido)", () => {
    const read = createSourcedReader(
      [source("primera", { S8: ["sleep-wake-event-during-run"] }, all("S8", "viejo"))],
      arms,
    );
    const cell = read("S8", 300, 1);
    expect(cell?.valid).toBe(false);
    expect(cell?.invalidReasons).toEqual(["sleep-wake-event-during-run"]);
  });

  it("la invalidación de un corpus no toca a los otros, y una celda que nadie tiene es ausente", () => {
    const read = createSourcedReader([source("primera", { S8: ["x"] }, all("S10", "a"))], arms);
    expect(read("S10", 300, 1)?.valid).toBe(true);
    expect(read("S12", 300, 1)).toBeNull();
  });

  it("toma el corpus de la última carpeta que lo tenga completo", () => {
    const read = createSourcedReader(
      [source("a", {}, all("S8", "a")), source("b", {}, all("S8", "b"))],
      arms,
    );
    expect(read("S8", 300, 1)?.fixtureSha256).toBe("b");
  });

  it("control de fallo: nunca mezcla celdas de dos carpetas: una continuación incompleta no completa a la primera", () => {
    const read = createSourcedReader(
      [
        source("a", {}, all("S8", "a")),
        source("b", {}, { [file("S8")]: goodCell("S8", "b") }), // le falta la repetición 2
      ],
      arms,
    );
    // La completa es "a": todo el corpus sale de ahí, aunque "b" sea posterior.
    expect(read("S8", 300, 1)?.fixtureSha256).toBe("a");
    expect(read("S8", 300, 2)?.fixtureSha256).toBe("a");
  });

  it("si ninguna carpeta lo tiene completo, queda incompleto: la última con celdas, y las que faltan son ausentes", () => {
    const read = createSourcedReader(
      [
        source("a", {}, { [file("S8")]: goodCell("S8", "a") }),
        source("b", {}, { [file("S8")]: goodCell("S8", "b") }),
      ],
      arms,
    );
    expect(read("S8", 300, 1)?.fixtureSha256).toBe("b");
    expect(read("S8", 300, 2)).toBeNull();
  });

  it("una carpeta completa pero invalidada no gana sobre una anterior limpia y completa", () => {
    const read = createSourcedReader(
      [source("a", {}, all("S8", "a")), source("b", { S8: ["x"] }, all("S8", "b"))],
      arms,
    );
    expect(read("S8", 300, 1)?.fixtureSha256).toBe("a");
  });
});

describe("mergeSleepDetection y mergeCaveats (N-3)", () => {
  const src = (
    name: string,
    detection: SourceDetection["detection"],
    contributes = true,
    caveats: SourceDetection["caveats"] = [],
  ): SourceDetection => ({ name, contributes, detection, caveats });
  const ok = { available: true, note: null } as const;

  it("disponible solo si lo fue en todas las fuentes que aportan celdas", () => {
    expect(mergeSleepDetection([src("a", ok), src("b", ok)])).toEqual({
      available: true,
      note: null,
    });
  });

  it("control de fallo: una continuación sin detección deja la salvedad aunque la primera la tuviera", () => {
    const merged = mergeSleepDetection([src("a", ok), src("b", undefined)]);
    expect(merged?.available).toBeNull();
    expect(merged?.note).toContain("b");
  });

  it("una fuente con detección no disponible (false) manda sobre las demás", () => {
    const merged = mergeSleepDetection([
      src("a", { available: false, note: "falló" }),
      src("b", undefined),
    ]);
    expect(merged).toMatchObject({ available: false });
    expect(merged?.note).toContain("a: falló");
  });

  it("una fuente que no aporta celdas no cuenta; sin ninguna que aporte, no hay dato", () => {
    expect(mergeSleepDetection([src("a", ok), src("b", undefined, false)])?.available).toBe(true);
    expect(mergeSleepDetection([src("b", undefined, false)])).toBeUndefined();
  });

  it("las salvedades de todas las carpetas llegan, rotuladas por carpeta si hay más de una", () => {
    const merged = mergeCaveats([
      src("a", ok, true, [{ id: "x", note: "n1" }]),
      src("b", ok, true, [{ id: "y", note: "n2" }]),
    ]);
    expect(merged).toEqual([
      { id: "x", note: "n1 [a]" },
      { id: "y", note: "n2 [b]" },
    ]);
    expect(mergeCaveats([src("a", ok, true, [{ id: "x", note: "n1" }])])).toEqual([
      { id: "x", note: "n1" },
    ]);
  });
});

describe("CLI de la fase 1: umbral crudo y humo (B-1, B-2)", () => {
  it("un umbral con coma llega crudo, no apaga el criterio 2, y un humo no emite veredictos de pasa", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpi-cli-"));
    try {
      writeFileSync(
        join(dir, "ocr-dpi-down-run.json"),
        JSON.stringify({ smoke: true, corpora: ["S10"], arms: [300, 150], skippedCorpora: [] }),
      );
      const result = spawnSync(
        "pnpm",
        ["exec", "tsx", resolve(__dirname, "summarizeOcrDpiDownCli.ts"), dir, dir],
        {
          encoding: "utf8",
          cwd: resolve(__dirname, "../../.."),
          env: { ...process.env, ANONLY_OCR_DPI_DOWN_MIN_COVERAGE: "0,9" },
          shell: process.platform === "win32",
        },
      );
      expect(result.status).toBe(1); // celdas ausentes: tanda incompleta
      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as {
        decisionRule: { minCoverageRaw: string; minCoverage: number; minCoverageOfficial: boolean };
        arms: Record<string, { verdict: string | null }>;
      };
      expect(summary.decisionRule).toMatchObject({
        minCoverageRaw: "0,9",
        minCoverage: 0.95,
        minCoverageOfficial: false,
      });
      expect(summary.arms["150"]?.verdict).toBe("parcial");
      expect(result.stdout).toContain("PARCIAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
