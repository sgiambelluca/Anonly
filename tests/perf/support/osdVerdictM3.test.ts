import { describe, expect, it } from "vitest";

import { fieldNames, TEXT_FIELD_NAMES } from "./osdVerdictM2Run.js";
import {
  INK_PRESENT_RATIO,
  M3_CELLS,
  M3_PAGES,
  M3_REPETITIONS,
  P2N_NOISE_SHEETS,
  buildM3Run,
  m3FileName,
  m3Key,
  m3PageId,
  m3Plan,
  m3RunIssues,
  p2nNoisePages,
  p2nPlan,
} from "./osdVerdictM3.js";
import type { RunSnapshot } from "./osdVerdictM3Collector.js";
import { makePage, makeProfileReport, makeRun } from "./osdVerdictM3TestSupport.js";

describe("osdVerdictM3: el plan", () => {
  it("son diez celdas: los reales primero, y P2 con el control sin observador", () => {
    expect(M3_CELLS.map((c) => `${c.doc}:${c.arm}`)).toEqual([
      "R1:A",
      "R1:B",
      "R1:C",
      "R4:A",
      "R4:B",
      "P2:A0",
      "P2:A",
      "P2:B",
      "P2N:A",
      "P2N:C",
    ]);
  });

  it("son 30 corridas, tres por celda, con los brazos intercalados dentro de cada documento", () => {
    const plan = m3Plan();
    expect(M3_REPETITIONS).toBe(3);
    expect(plan).toHaveLength(30);
    expect(plan.slice(0, 6).map(m3Key)).toEqual([
      "R1-A-r1",
      "R1-B-r1",
      "R1-C-r1",
      "R1-A-r2",
      "R1-B-r2",
      "R1-C-r2",
    ]);
    expect(plan.map((id) => id.doc)).toEqual([
      ...Array(9).fill("R1"),
      ...Array(6).fill("R4"),
      ...Array(9).fill("P2"),
      ...Array(6).fill("P2N"),
    ]);
    expect(m3FileName({ doc: "P2N", arm: "C", rep: 3 })).toBe("P2N-C-r3.json");
  });

  it("P2 con ruido son 60 páginas: tras cada cinco de P2, una hoja de ruido de las que hoy leen una vez", () => {
    const plan = p2nPlan();
    expect(plan).toHaveLength(60);
    expect(plan.filter((part) => part.kind === "p2")).toHaveLength(50);
    expect(p2nNoisePages()).toEqual([5, 11, 17, 23, 29, 35, 41, 47, 53, 59]);
    expect(plan[5]).toEqual({ kind: "noise", sheet: "RU1" });
    expect(plan[0]).toEqual({ kind: "p2", index: 0 });
    expect(plan[6]).toEqual({ kind: "p2", index: 5 });
    expect(new Set(P2N_NOISE_SHEETS)).toEqual(new Set(["RU1", "RU3", "RU4", "RU5"]));
    expect(M3_PAGES.P2N).toBe(60);
  });

  it("el identificador de una página es neutro", () => {
    expect(m3PageId("R1", 6)).toBe("R1-p07");
    expect(m3PageId("R4", 50)).toBe("R4-p51");
  });
});

describe("osdVerdictM3: la coherencia con el brazo", () => {
  const spec = (arm: "A" | "A0" | "B" | "C") =>
    makeRun({ doc: "R1", arm, pages: 20, pageSpec: () => ({ ink: 0.001 }) });

  it("un registro coherente de cada brazo no tiene issues", () => {
    for (const arm of ["A", "A0", "B", "C"] as const) expect(m3RunIssues(spec(arm))).toEqual([]);
  });

  it("A recibe lo natural; B y C reciben «sin veredicto» con la tinta que corresponde", () => {
    const b = spec("B").cold.pages[0];
    expect(b?.orientation).toEqual({ orientation: 0, osdHadVerdict: false, inkRatio: 0.001 });
    const c = spec("C").cold.pages[0];
    expect(c?.orientation?.inkRatio).toBe(INK_PRESENT_RATIO);
    expect(c?.natural?.inkRatio).toBe(0.001);
    const a = spec("A").cold.pages[0];
    expect(a?.orientation).toEqual(a?.natural);
  });

  it("detecta un forzado que no llegó como «sin veredicto»", () => {
    const run = spec("B");
    const page = run.cold.pages[3];
    if (page === undefined) throw new Error("sin página");
    const broken = {
      ...run,
      cold: {
        ...run.cold,
        pages: run.cold.pages.map((p) =>
          p === page
            ? { ...p, orientation: { orientation: 90, osdHadVerdict: true, inkRatio: 0.001 } }
            : p,
        ),
      },
    };
    expect(m3RunIssues(broken).join("|")).toContain("frío p04: el forzado no llegó");
  });

  it("detecta una tinta de C que no es el umbral, o que cambió en B", () => {
    const cRun = spec("C");
    const wrongInk = {
      ...cRun,
      hot: {
        ...cRun.hot,
        pages: cRun.hot.pages.map((p, i) =>
          i === 0 && p.orientation !== null
            ? { ...p, orientation: { ...p.orientation, inkRatio: 0.0015 } }
            : p,
        ),
      },
    };
    expect(m3RunIssues(wrongInk).join("|")).toContain(
      "caliente p01: tinta entregada 0.0015, se esperaba 0.002",
    );
    const bRun = spec("B");
    const raised = {
      ...bRun,
      cold: {
        ...bRun.cold,
        pages: bRun.cold.pages.map((p, i) =>
          i === 0 && p.orientation !== null
            ? { ...p, orientation: { ...p.orientation, inkRatio: 0.002 } }
            : p,
        ),
      },
    };
    expect(m3RunIssues(raised).join("|")).toContain(
      "frío p01: tinta entregada 0.002, se esperaba 0.001",
    );
  });

  it("A con un resultado entregado distinto del natural, o un observador que no corresponde, es un issue", () => {
    const run = spec("A");
    const changed = {
      ...run,
      cold: {
        ...run.cold,
        pages: run.cold.pages.map((p, i) =>
          i === 0 && p.orientation !== null
            ? { ...p, orientation: { ...p.orientation, osdHadVerdict: false } }
            : p,
        ),
      },
    };
    expect(m3RunIssues(changed).join("|")).toContain(
      "brazo A con un resultado entregado distinto del natural",
    );
    expect(m3RunIssues({ ...spec("A0"), observerInstalled: true }).join("|")).toContain(
      "el observador no está y el brazo A0 dice lo contrario",
    );
  });

  it("el observador y el bus de workers tienen que contar los mismos reconocimientos", () => {
    const run = spec("B");
    const mismatch = {
      ...run,
      cold: { ...run.cold, ocrPageJobsObserved: run.cold.ocrPageDispatches - 1 },
    };
    expect(m3RunIssues(mismatch).join("|")).toContain("el observador vio");
  });

  it("una cantidad de páginas distinta de la del documento es un issue; una importación fallida no", () => {
    const short = makeRun({ doc: "R1", arm: "A", pages: 19 });
    const wrong = { ...short, pageCount: 20 };
    expect(m3RunIssues(wrong).join("|")).toContain("19 páginas capturadas y el documento tiene 20");
    const failed = { ...makeRun({ doc: "P2", arm: "B", pages: 2 }), pageCount: 50 };
    const failedSide = {
      ...failed,
      cold: { ...failed.cold, ok: false },
      hot: { ...failed.hot, ok: false },
    };
    expect(m3RunIssues(failedSide)).toEqual([]);
  });
});

describe("osdVerdictM3: buildM3Run", () => {
  const snapshot = (arm: "A" | "B"): RunSnapshot => {
    const pages = Array.from({ length: 4 }, (_, i) => makePage(arm, i));
    return {
      observer: true,
      pages,
      ocrPageJobs: pages.reduce((sum, page) => sum + page.attempts.length, 0),
    };
  };

  it("arma el registro con los picos, los tiempos y los despachos del bus de workers", () => {
    const report = makeProfileReport();
    // Los dos informes de prueba despachan 2 ocr-page; las cuatro páginas de A hacen 4 reconocimientos.
    const run = buildM3Run({
      id: { doc: "R1", arm: "A", rep: 2 },
      fixtureSha256: "abc",
      pageCount: 4,
      report,
      cold: { ...snapshot("A"), ocrPageJobs: 2 },
      hot: { ...snapshot("A"), ocrPageJobs: 2 },
    });
    expect(run).toMatchObject({ schema: 3, doc: "R1", arm: "A", rep: 2, observerInstalled: true });
    expect(run.cold).toMatchObject({
      ok: true,
      peakSumBytes: 1500e6,
      readyDurationMs: 1000,
      ocrPageDispatches: 2,
      ocrPageJobsObserved: 2,
    });
    expect(run.hot.hotBaselineSettled).toBe(true);
    // Páginas capturadas = 4, pero el informe de prueba despacha 2: el issue de conteo solo aparece si no coinciden.
    expect(run.issues).toEqual([]);
  });

  it("un observador que cuenta distinto que el bus deja un issue en el registro", () => {
    const run = buildM3Run({
      id: { doc: "R1", arm: "B", rep: 1 },
      fixtureSha256: "abc",
      pageCount: 4,
      report: makeProfileReport(),
      cold: snapshot("B"),
      hot: snapshot("B"),
    });
    expect(run.issues.join("|")).toContain(
      "el observador vio 16 reconocimientos y el bus de workers 2",
    );
  });
});

describe("osdVerdictM3: privacidad", () => {
  it("el registro de una corrida no lleva ningún campo de texto ni cadenas fuera de identificadores", () => {
    const run = makeRun({
      doc: "R1",
      arm: "B",
      pages: 3,
      pageSpec: () => ({ entities: { DNI: 2, PERSON: 1 } }),
    });
    const names = fieldNames(run);
    for (const forbidden of TEXT_FIELD_NAMES) expect(names.has(forbidden)).toBe(false);
    const strings: string[] = [];
    (function collect(value: unknown): void {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
    })(run);
    for (const text of strings) expect(text).toMatch(/^[A-Za-z0-9_:. -]*$/);
  });
});
