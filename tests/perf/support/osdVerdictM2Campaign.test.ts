import { describe, expect, it } from "vitest";

import { REAL_DOC_IDS, corpusEntriesM2 } from "./osdVerdictCorpusM2.js";
import { OBSERVATIONS_PER_PAGE, checkM2, expectedM2, summarizeM2 } from "./osdVerdictM2Campaign.js";
import { formatM2, m2ResultLine } from "./osdVerdictM2Tables.js";
import { makeM2Observation, makeM2Page } from "./osdVerdictM2TestSupport.js";
import { makePdf } from "./osdVerdictTestSupport.js";

const KEYS = ["RU3-150-0", "M1-150-0", "R2-p01"];
const entries = corpusEntriesM2(["R2"]).filter((entry) => KEYS.includes(entry.key));

const forcedAll = {
  0: { reading: { reliable: 3, conf: 0.4 } },
  90: {},
  180: {},
  270: { reading: { reliable: 4, conf: 0.9 } },
} as const;

const campaign = () => KEYS.flatMap((key) => makeM2Page({ key, forced: forcedAll }));

describe("osdVerdictM2Campaign", () => {
  it("son cinco observaciones por página: 645 con los cuatro documentos reales, 240 sin ninguno", () => {
    expect(OBSERVATIONS_PER_PAGE).toBe(5);
    expect(expectedM2(corpusEntriesM2(REAL_DOC_IDS))).toHaveLength(645);
    expect(expectedM2(corpusEntriesM2([]))).toHaveLength(240);
    expect(
      expectedM2(corpusEntriesM2([]))
        .slice(0, 5)
        .map((item) => item.file),
    ).toEqual([
      "RU1-150-0-production.json",
      "RU1-150-0-forced-0.json",
      "RU1-150-0-forced-90.json",
      "RU1-150-0-forced-180.json",
      "RU1-150-0-forced-270.json",
    ]);
  });

  describe("checkM2", () => {
    it("una campaña completa y coherente está completa", () => {
      const check = checkM2(campaign(), entries);
      expect(check).toMatchObject({
        expectedPages: 3,
        expectedObservations: 15,
        completedObservations: 15,
        complete: true,
        missing: [],
        unexpected: [],
        duplicated: [],
        issues: [],
        warnings: [],
      });
    });

    it("lista las faltantes, las repetidas y las inesperadas", () => {
      const observations = campaign();
      const dropped = observations.filter((o) => !(o.key === "M1-150-0" && o.forcedAngle === 90));
      const first = dropped[0];
      if (first === undefined) throw new Error("sin observaciones");
      const extra = makeM2Observation({ key: "RU1-150-0", forcedAngle: null });
      const check = checkM2([...dropped, first, extra], entries);
      expect(check.complete).toBe(false);
      expect(check.missing).toEqual(["M1-150-0|90"]);
      expect(check.duplicated).toEqual(["RU3-150-0|prod"]);
      expect(check.unexpected).toEqual(["RU1-150-0|prod"]);
    });

    it("un hash distinto del manifiesto, un ráster distinto o issues propios fallan la campaña", () => {
      const hashes = Object.fromEntries(KEYS.map((key) => [key, `pdf-${key}`]));
      expect(checkM2(campaign(), entries, hashes).complete).toBe(true);
      const mismatch = checkM2(campaign(), entries, { ...hashes, "R2-p01": "otro" });
      expect(mismatch.issues.map((i) => i.issue)).toContain(
        "el hash del PDF difiere del manifiesto",
      );

      const raster = campaign().map((o) =>
        o.key === "M1-150-0" && o.forcedAngle === 90
          ? makeM2Observation({
              key: o.key,
              forcedAngle: 90,
              attempts: [{ angle: 90, sha: "otro" }],
            })
          : o,
      );
      expect(checkM2(raster, entries).issues).toEqual([
        {
          id: "M1-150-0|90",
          issue: "las lecturas de una página no se hicieron sobre el mismo ráster",
        },
      ]);

      const withIssue = campaign().map((o, index) =>
        index === 2 ? { ...o, issues: ["algo salió mal"] } : o,
      );
      expect(checkM2(withIssue, entries).issues[0]?.issue).toBe("algo salió mal");
    });

    it("un veredicto natural que cambia entre observaciones es un hallazgo, no un fallo", () => {
      const observations = campaign().map((o) =>
        o.key === "RU3-150-0" && o.forcedAngle === 270
          ? { ...o, natural: { ...o.natural, osdHadVerdict: true } }
          : o,
      );
      const check = checkM2(observations, entries);
      expect(check.complete).toBe(true);
      expect(check.warnings).toEqual([
        { id: "RU3-150-0|270", warning: "el veredicto natural del OSD cambió entre observaciones" },
      ]);
    });

    it("el registro tiene que ser el de la entrada del corpus", () => {
      const observations = campaign().map((o) =>
        o.key === "R2-p01" ? { ...o, sourceDpi: 300 } : o,
      );
      expect(checkM2(observations, entries).issues[0]?.issue).toBe(
        "los datos del registro no son los de la entrada del corpus",
      );
    });
  });

  describe("summarizeM2", () => {
    const m1 = makePdf({
      key: "two-lines-150-180",
      verdict: { orientation: 0, had: false },
      forced: {
        0: { reading: { reliable: 1, confidence: 0.7 } },
        90: {},
        180: {
          reading: { reliable: 4, confidence: 0.95, allTokens: true },
          final: { present: true },
        },
        270: {},
      },
    });
    const summary = summarizeM2({ m1, m2: campaign(), entries });

    it("arma los análisis, el ruido y los documentos reales presentes", () => {
      expect(summary.check.complete).toBe(true);
      expect(summary.realDocs).toEqual(["R2"]);
      expect(summary.noiseRows.map((row) => row.key)).toEqual(["RU3-150-0"]);
      expect(summary.noiseRows[0]).toMatchObject({
        label: "RU3",
        rotation: 0,
        productionUnreadable: false,
      });
      expect(summary.rc.noiseTotal.readings).toBe(4);
      expect(summary.cp.validation.runs).toBeGreaterThan(0);
      expect(summary.real.R1).toBeNull();
      expect(summary.real["R2 a R4"]?.pages).toBe(1);
      expect(Object.keys(summary.sv.cells).length).toBeGreaterThan(0);
    });

    it("las tablas dicen que son simulaciones y no traen texto de las páginas reales", () => {
      const text = formatM2(summary);
      for (const heading of [
        "## Campaña M-O2",
        "## Validez de la simulación",
        "## Parte A.",
        "## RC:",
        "## CP:",
        "## Parte C.",
        "## SV:",
        "## Parte B.",
      ])
        expect(text).toContain(heading);
      expect(text).toContain("SIMULACIÓN sobre lecturas medidas, no el producto");
      expect(text).toContain("Documentos reales presentes: R2.");
      expect(text).toContain("R1:\n  no disponible");
      expect(m2ResultLine(summary)).toMatch(/^M-O2: 15\/15 observaciones; completa;/);
    });

    it("sin documentos reales las tablas lo dicen", () => {
      const none = summarizeM2({ m1, m2: [], entries: corpusEntriesM2([]).slice(0, 1) });
      expect(formatM2(none)).toContain("ninguno (corrieron solo las partes sintéticas)");
      expect(m2ResultLine(none)).toContain("INCOMPLETA");
    });
  });
});
