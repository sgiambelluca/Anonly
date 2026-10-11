import { describe, expect, it } from "vitest";

import {
  OBSERVATIONS_PER_PDF,
  checkCampaign,
  expectedObservations,
  summarizeCampaign,
} from "./osdVerdictCampaign.js";
import { corpusEntries } from "./osdVerdictCorpus.js";
import type { ObservationRecord } from "./osdVerdictRun.js";
import { makeObservation, makePdf } from "./osdVerdictTestSupport.js";

const KEYS = ["full-150-0", "two-lines-150-180", "N7-300-90", "blank-150-0"];
const entries = corpusEntries().filter((entry) => KEYS.includes(entry.key));

const forcedAll = {
  0: { reading: { reliable: 3, confidence: 0.4 } },
  90: {},
  180: {},
  270: { reading: { reliable: 4, confidence: 0.9, allTokens: true }, final: { present: true } },
} as const;

function campaign(): ObservationRecord[] {
  return KEYS.flatMap((key) => makePdf({ key, forced: forcedAll }));
}

describe("osdVerdictCampaign", () => {
  describe("expectedObservations", () => {
    it("son cinco por PDF: producción y un veredicto forzado a cada ángulo", () => {
      expect(OBSERVATIONS_PER_PDF).toBe(5);
      const all = expectedObservations(corpusEntries());
      expect(all).toHaveLength(700);
      expect(all.filter((item) => item.forcedAngle === null)).toHaveLength(140);
      expect(all.slice(0, 5).map((item) => item.file)).toEqual([
        "full-150-0-production.json",
        "full-150-0-forced-0.json",
        "full-150-0-forced-90.json",
        "full-150-0-forced-180.json",
        "full-150-0-forced-270.json",
      ]);
    });
  });

  describe("checkCampaign", () => {
    it("una campaña completa y coherente está completa", () => {
      const check = checkCampaign(campaign(), entries);
      expect(check).toMatchObject({
        expectedPdfs: 4,
        expectedObservations: 20,
        completedObservations: 20,
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
      const dropped = observations.filter(
        (item) => !(item.key === "N7-300-90" && item.forcedAngle === 90),
      );
      const first = dropped[0];
      const extra = makeObservation({ key: "N1-150-0", forcedAngle: null });
      if (first === undefined) throw new Error("sin observaciones");
      const check = checkCampaign([...dropped, first, extra], entries);
      expect(check.complete).toBe(false);
      expect(check.missing).toEqual(["N7-300-90|90"]);
      expect(check.duplicated).toEqual(["full-150-0|prod"]);
      expect(check.unexpected).toEqual(["N1-150-0|prod"]);
    });

    it("una observación con issues, o con un hash que no es el del manifiesto, falla la campaña", () => {
      const observations = campaign();
      const broken = observations.map((item, index) =>
        index === 2 ? { ...item, issues: ["algo salió mal"] } : item,
      );
      const withIssue = checkCampaign(broken, entries);
      expect(withIssue.complete).toBe(false);
      expect(withIssue.issues).toEqual([{ id: "full-150-0|90", issue: "algo salió mal" }]);

      const hashes = Object.fromEntries(KEYS.map((key) => [key, `pdf-${key}`]));
      expect(checkCampaign(campaign(), entries, hashes).complete).toBe(true);
      const mismatch = checkCampaign(campaign(), entries, { ...hashes, "full-150-0": "otro" });
      expect(mismatch.complete).toBe(false);
      expect(mismatch.issues.map((item) => item.issue)).toContain(
        "el hash del PDF difiere del manifiesto",
      );
    });

    it("revisa de nuevo la coherencia interna de cada registro", () => {
      const observations = campaign();
      const tampered = observations.map((item) =>
        item.key === "full-150-0" && item.forcedAngle === 180
          ? { ...item, delivered: { ...item.delivered, osdHadVerdict: false } }
          : item,
      );
      const check = checkCampaign(tampered, entries);
      expect(check.complete).toBe(false);
      expect(check.issues.some((item) => item.issue.startsWith("al revisar:"))).toBe(true);
    });

    it("las lecturas de un PDF tienen que haberse hecho sobre el mismo ráster", () => {
      const observations = campaign().map((item) =>
        item.key === "two-lines-150-180" && item.forcedAngle === 90
          ? makeObservation({ key: item.key, forcedAngle: 90, sha: "otro-raster" })
          : item,
      );
      const check = checkCampaign(observations, entries);
      expect(check.complete).toBe(false);
      expect(check.issues).toEqual([
        {
          id: "two-lines-150-180|90",
          issue: "las lecturas de un PDF no se hicieron sobre el mismo ráster",
        },
      ]);
    });

    it("un PDF distinto entre observaciones del mismo PDF es un issue", () => {
      const observations = campaign().map((item) =>
        item.key === "N7-300-90" && item.forcedAngle === 0
          ? makeObservation({ key: item.key, forcedAngle: 0, fixtureSha: "otro-pdf" })
          : item,
      );
      expect(checkCampaign(observations, entries).issues.map((item) => item.issue)).toContain(
        "las observaciones de un PDF no usaron el mismo archivo",
      );
    });

    it("un veredicto natural o un OSD crudo que cambian entre observaciones son un hallazgo, no un fallo", () => {
      const observations = campaign().map((item) =>
        item.key === "full-150-0" && item.forcedAngle === 270
          ? { ...item, natural: { ...item.natural, osdHadVerdict: true } }
          : item.key === "N7-300-90" && item.forcedAngle === 90
            ? { ...item, rawOsd: { orientation: 90, confidence: 5, error: null } }
            : item,
      );
      const check = checkCampaign(observations, entries);
      expect(check.complete).toBe(true);
      expect(check.warnings).toEqual([
        {
          id: "full-150-0|270",
          warning: "el veredicto natural del OSD cambió entre observaciones",
        },
        { id: "N7-300-90|90", warning: "el OSD crudo cambió entre observaciones" },
      ]);
    });

    it("los datos del registro tienen que ser los de la entrada del corpus", () => {
      const observations = campaign().map((item) =>
        item.key === "full-150-0" ? { ...item, sourceDpi: 300 } : item,
      );
      expect(checkCampaign(observations, entries).issues[0]?.issue).toBe(
        "los datos del registro no son los de la entrada del corpus",
      );
    });
  });

  describe("summarizeCampaign", () => {
    it("arma las cinco preguntas, los controles y la evidencia de rama", () => {
      const summary = summarizeCampaign(campaign(), entries);
      expect(summary.check.complete).toBe(true);
      expect(summary.q1.total.pdfs).toBe(3);
      expect(summary.q2.total.observations).toBe(9);
      expect(summary.production.total.observations).toBe(3);
      expect(summary.q3).toHaveLength(11);
      expect(summary.q3bis).toHaveLength(2);
      expect(summary.q4).toHaveLength(11);
      expect(summary.controls).toEqual([
        {
          label: "blank",
          observations: 5,
          withUnreadableInk: 0,
          withFinalReliableWords: 0,
          withDniEntity: 0,
        },
      ]);
      // Los tres PDF con texto no tuvieron veredicto natural (la fábrica lo deja en `had: false`).
      expect(summary.branchEvidence.map((item) => item.key)).toEqual([
        "full-150-0",
        "two-lines-150-180",
        "N7-300-90",
      ]);
      expect(summary.branchEvidence[0]).toEqual({
        key: "full-150-0",
        productionAngles: [0],
        forcedZeroAngles: [0],
      });
    });
  });
});
