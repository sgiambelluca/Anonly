import { describe, expect, it } from "vitest";

import type { Job } from "./adr190Dpi.js";
import { buildCellRecord, detectedByType, type CellObservation } from "./ocrDpiDownCell.js";
import { buildSyntheticSource } from "./ocrDpiDownFixtures.js";

function ocrJob(dpi: number, jobId: string): Job {
  return {
    worker: 1,
    jobId,
    jobType: "ocr-page",
    documentId: "d",
    pageIndex: 0,
    startedAt: 1,
    finishedAt: 2,
    dpi,
    orientation: 0,
    upscale: 1,
    widthPx: 10,
    heightPx: 10,
    imageBytes: 1,
    terminal: "COMPLETED",
    result: { words: [{ text: "SECRETO-TEXTO" }] },
    error: null,
  };
}
const osdJob: Job = {
  ...ocrJob(0, "osd"),
  jobType: "ocr-orient",
  dpi: null,
  result: { orientation: 0, inkRatio: 0.2 },
};

function observation(
  dpi: number,
  entities: CellObservation["entities"],
  patch: Partial<CellObservation> = {},
): CellObservation {
  return {
    ready: true,
    pipelineFailure: null,
    capture: { jobs: [osdJob, ocrJob(dpi, "a")], issues: [] },
    caps: [{ pageIndex: 0, originalCap: 301 }],
    ocrPageEvents: [],
    entities,
    text: "texto observado SECRETO-TEXTO",
    nerFinished: true,
    overrideEffective: true,
    ...patch,
  };
}
const raw = (entityType: string, value: string, x = 0, pageIndex = 0) => ({
  entityType,
  value,
  pageIndex,
  bbox: { x, y: 0, width: 50, height: 10 },
});

describe("buildCellRecord", () => {
  it("sintético: compara contra la verdad y lista lo perdido con su valor (la verdad es inventada)", async () => {
    const { truth } = await buildSyntheticSource("SE");
    const found = truth.entities.filter(
      (entity) => entity.type !== "DNI" || entity.pageIndex !== 1,
    );
    const result = buildCellRecord({
      corpus: { id: "SE", kind: "synthetic", sha256: "abc", truth },
      dpi: 300,
      repetition: 1,
      observation: observation(
        300,
        found.map((entity) => raw(entity.type, entity.value, 0, entity.pageIndex)),
      ),
      reference: null,
    });
    expect(result.record.valid).toBe(true);
    expect(result.record.entitiesVsTruth?.totals).toMatchObject({ expected: 4, missed: 1 });
    expect(result.syntheticDetail?.missedVsTruth).toHaveLength(1);
    expect(result.syntheticDetail?.expectedByType.PERSON).toBe(2);
    expect(result.record.entitiesVsReference).toBeNull();
    expect(result.record.coverageVsReference).toBeNull();
    expect(result.record.armEffective).toBe(true);
    expect(result.syntheticDetail?.detected).toHaveLength(3);
    expect(result.syntheticDetail?.observedText).toContain("SECRETO-TEXTO");
    expect(result.record.truthLostKeys).toHaveLength(1);
  });

  it("contra una referencia: pérdidas, agregados y un IoU por entidad común", async () => {
    const { truth } = await buildSyntheticSource("SE");
    const reference = buildCellRecord({
      corpus: { id: "SE", kind: "synthetic", sha256: "abc", truth },
      dpi: 300,
      repetition: 1,
      observation: observation(300, [raw("DNI", "34.567.891", 0), raw("EMAIL", "a@x.com", 100)]),
      reference: null,
    }).asReference;
    const result = buildCellRecord({
      corpus: { id: "SE", kind: "synthetic", sha256: "abc", truth },
      dpi: 150,
      repetition: 1,
      observation: observation(150, [raw("DNI", "34.567.891", 25), raw("PHONE", "11 1234 5678")]),
      reference,
    });
    expect(result.record.entitiesVsReference?.totals).toMatchObject({
      missed: 1,
      added: 1,
      matched: 1,
    });
    expect(result.record.coverageVsReference?.values).toEqual([0.5]);
    expect(result.record.tokensVsReference?.recall).toBe(1);
    expect(result.record.dispatch?.effectiveDpis).toEqual([150]);
  });

  it("real: ni el texto ni los valores ni las listas con valores salen en el registro", () => {
    const result = buildCellRecord({
      corpus: { id: "R3", kind: "real", sha256: "h", truth: null },
      dpi: 300,
      repetition: 1,
      observation: observation(300, [
        raw("DNI", "VALOR-SECRETO-9"),
        raw("PERSON", "NOMBRE-SECRETO"),
      ]),
      reference: {
        entities: [{ type: "DNI", value: "VALOR-SECRETO-9", pageIndex: 0, box: null }],
        text: "TEXTO-SECRETO",
      },
    });
    const serialized = JSON.stringify(result);
    // Lo único que lleva valores es `asReference`, que el spec conserva en memoria y no escribe.
    const written = JSON.stringify({
      record: result.record,
      syntheticDetail: result.syntheticDetail,
    });
    expect(result.syntheticDetail).toBeNull();
    expect(written).not.toContain("SECRETO");
    expect(serialized).toContain("SECRETO");
    expect(result.record.detectedByType).toEqual({ DNI: 1, PERSON: 1 });
    expect(result.record.entitiesVsReference?.byType.PERSON?.added).toBe(1);
  });

  it("inválida: sin Ready, sin despacho y override no efectivo dejan motivos, no ceros", () => {
    const result = buildCellRecord({
      corpus: { id: "R2", kind: "real", sha256: "h", truth: null },
      dpi: 200,
      repetition: 1,
      observation: observation(200, [], {
        ready: false,
        capture: { jobs: [], issues: [] },
        overrideEffective: false,
        nerFinished: false,
      }),
      reference: null,
    });
    expect(result.record.valid).toBe(false);
    expect(result.record.invalidReasons).toEqual(
      expect.arrayContaining([
        "override-not-effective",
        "not-ready",
        "no-ocr-page-dispatch",
        "no-osd-reading",
        "ner-not-finished",
      ]),
    );
  });

  it("real a 240 dpi nativos: el brazo 300 es válido pero no efectivo", () => {
    const result = buildCellRecord({
      corpus: { id: "R2", kind: "real", sha256: "h", truth: null },
      dpi: 300,
      repetition: 1,
      observation: observation(240, [], { caps: [{ pageIndex: 0, originalCap: 240 }] }),
      reference: null,
    });
    expect(result.record.valid).toBe(true);
    expect(result.record.armEffective).toBe(false);
  });

  it("detectedByType cuenta por tipo en orden estable", () => {
    expect(
      detectedByType([
        { type: "PERSON", value: "a", pageIndex: 0, box: null },
        { type: "DNI", value: "b", pageIndex: 0, box: null },
        { type: "PERSON", value: "c", pageIndex: 1, box: null },
      ]),
    ).toEqual({ DNI: 1, PERSON: 2 });
  });
});
