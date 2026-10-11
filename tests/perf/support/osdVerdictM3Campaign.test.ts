import { describe, expect, it } from "vitest";

import { m3Key, type M3Doc } from "./osdVerdictM3.js";
import {
  checkM3,
  expectedRuns,
  formatM3,
  m3ResultLine,
  summarizeM3,
} from "./osdVerdictM3Campaign.js";
import { makeRun } from "./osdVerdictM3TestSupport.js";

const DOCS: ReadonlyArray<M3Doc> = ["R1", "P2"];

function campaign() {
  return expectedRuns(DOCS).map((id) =>
    makeRun({
      doc: id.doc,
      arm: id.arm,
      rep: id.rep,
      pages: id.doc === "R1" ? 20 : 50,
      pageSpec: (index) => ({ textHash: `t${index}` }),
    }),
  );
}

describe("osdVerdictM3Campaign", () => {
  it("las corridas esperadas dependen de los documentos presentes", () => {
    expect(expectedRuns(["R1", "R4", "P2", "P2N"])).toHaveLength(30);
    expect(expectedRuns(["P2", "P2N"])).toHaveLength(15);
    expect(expectedRuns(DOCS)).toHaveLength(18);
    expect(expectedRuns([])).toHaveLength(0);
  });

  it("una campaña completa y coherente está completa", () => {
    const check = checkM3(campaign(), DOCS);
    expect(check).toMatchObject({
      expectedRuns: 18,
      completedRuns: 18,
      complete: true,
      missing: [],
      unexpected: [],
      duplicated: [],
      issues: [],
      failedRuns: [],
    });
  });

  it("lista las que faltan, las repetidas y las inesperadas", () => {
    const runs = campaign();
    const dropped = runs.filter((run) => m3Key(run) !== "R1-B-r2");
    const first = dropped[0];
    if (first === undefined) throw new Error("sin corridas");
    const extra = makeRun({ doc: "R4", arm: "A", pages: 51 });
    const check = checkM3([...dropped, first, extra], DOCS);
    expect(check.complete).toBe(false);
    expect(check.missing).toEqual(["R1-B-r2"]);
    expect(check.duplicated).toEqual(["R1-A-r1"]);
    expect(check.unexpected).toEqual(["R4-A-r1"]);
  });

  it("dos brazos de un documento que no usaron el mismo archivo es un issue", () => {
    const runs = campaign().map((run) =>
      m3Key(run) === "R1-C-r1" ? { ...run, fixtureSha256: "otro" } : run,
    );
    expect(checkM3(runs, DOCS).issues).toEqual([
      { run: "R1-C-r1", issue: "R1: el archivo difiere del de R1-A-r1" },
    ]);
  });

  it("los issues propios de una corrida y las importaciones fallidas se informan aparte", () => {
    const runs = campaign().map((run) => {
      if (m3Key(run) === "P2-B-r3") return { ...run, issues: ["algo salió mal"] };
      if (m3Key(run) === "P2-B-r1") return { ...run, hot: { ...run.hot, ok: false } };
      return run;
    });
    const check = checkM3(runs, DOCS);
    expect(check.complete).toBe(false);
    expect(check.issues).toEqual([{ run: "P2-B-r3", issue: "algo salió mal" }]);
    expect(check.failedRuns).toEqual(["P2-B-r1"]);
  });

  it("las tablas traen los cuatro análisis con los reales primero, y el techo de P2", () => {
    const { check, summary, text } = summarizeM3(campaign(), DOCS);
    expect(check.complete).toBe(true);
    expect(summary.memory.ceiling.some((row) => row.doc === "P2")).toBe(true);
    for (const heading of [
      "## Campaña M-O3",
      "## 1. Memoria",
      "## 2. Tiempo",
      "## 3. Reconocimientos",
      "## 4. Lo que se entrega",
    ])
      expect(text).toContain(heading);
    expect(text.indexOf("R1")).toBeLessThan(text.indexOf("P2 contra el techo"));
    expect(text).toContain("P2 contra el techo de 3,0 GB");
    expect(text).toContain("COMPLETA");
    expect(text).toContain("piso A–A");
    expect(m3ResultLine(check)).toBe("M-O3: 18/18 corridas; completa; fallidas 0.");
  });

  it("una campaña incompleta lo dice", () => {
    const check = checkM3(campaign().slice(0, 5), DOCS);
    expect(formatM3(summarizeM3([], DOCS).summary, check)).toContain("INCOMPLETA");
    expect(m3ResultLine(check)).toContain("INCOMPLETA");
  });
});
