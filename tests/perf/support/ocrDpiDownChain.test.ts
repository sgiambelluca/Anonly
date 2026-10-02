import { describe, expect, it } from "vitest";

import type { Job } from "./adr190Dpi.js";
import {
  cellInvalidReasons,
  summarizeChain,
  summarizeDispatches,
  type CellValidityInput,
} from "./ocrDpiDownChain.js";

let sequence = 0;
function job(partial: Partial<Job> & Pick<Job, "jobType">): Job {
  sequence += 1;
  return {
    worker: 1,
    jobId: `job-${sequence}`,
    documentId: "doc",
    pageIndex: 0,
    startedAt: sequence,
    finishedAt: sequence + 1,
    dpi: null,
    orientation: 0,
    upscale: 1,
    widthPx: 100,
    heightPx: 100,
    imageBytes: 4,
    terminal: "COMPLETED",
    result: null,
    error: null,
    ...partial,
  };
}
const ocr = (partial: Partial<Job> = {}): Job => job({ jobType: "ocr-page", dpi: 300, ...partial });
const osd = (partial: Partial<Job> = {}): Job =>
  job({ jobType: "ocr-orient", result: { orientation: 0, inkRatio: 0.2 }, ...partial });

describe("summarizeDispatches", () => {
  it("el DPI efectivo es min(pedido, tope): 300 sobre un tope de 301 sale a 300", () => {
    const evidence = summarizeDispatches(
      [ocr({ dpi: 300 })],
      [{ pageIndex: 0, originalCap: 301 }],
      300,
    );
    expect(evidence.expectedDpiByPage).toEqual({ "0": 300 });
    expect(evidence.dispatchesAtExpectedDpi).toBe(true);
    expect(evidence.armEffective).toBe(true);
    expect(evidence.issues).toEqual([]);
  });

  it("brazo no efectivo: tope de 240 con 300 pedidos sale a 240; es válido pero no efectivo", () => {
    const evidence = summarizeDispatches(
      [ocr({ dpi: 240 })],
      [{ pageIndex: 0, originalCap: 240 }],
      300,
    );
    expect(evidence.dispatchesAtExpectedDpi).toBe(true);
    expect(evidence.armEffective).toBe(false);
    expect(evidence.issues).toEqual([]);
    expect(evidence.effectiveDpis).toEqual([240]);
  });

  it("control de fallo: un despacho a otro DPI que el esperado queda marcado", () => {
    const evidence = summarizeDispatches(
      [ocr({ dpi: 300 })],
      [{ pageIndex: 0, originalCap: 301 }],
      200,
    );
    expect(evidence.dispatchesAtExpectedDpi).toBe(false);
    expect(evidence.issues).toContain("effective-dpi-differs-from-expected");
  });

  it("sin despacho ocr-page no hay evidencia: es un motivo, no un cero", () => {
    const evidence = summarizeDispatches([osd()], [{ pageIndex: 0, originalCap: 301 }], 300);
    expect(evidence.issues).toContain("no-ocr-page-dispatch");
    expect(evidence.dispatchesAtExpectedDpi).toBe(false);
  });

  it("un tope no observable impide demostrar el DPI esperado", () => {
    const evidence = summarizeDispatches([ocr()], [{ pageIndex: 0, originalCap: null }], 300);
    expect(evidence.issues).toContain("page-cap-not-observable");
  });

  it("un despacho sin DPI queda marcado", () => {
    const evidence = summarizeDispatches(
      [ocr({ dpi: null })],
      [{ pageIndex: 0, originalCap: 301 }],
      300,
    );
    expect(evidence.issues).toContain("dispatch-dpi-missing");
  });

  it("un reintento de transporte (mismo jobId) se distingue de un paso nuevo", () => {
    const evidence = summarizeDispatches(
      [ocr({ jobId: "a" }), ocr({ jobId: "a" }), ocr({ jobId: "b" })],
      [{ pageIndex: 0, originalCap: 301 }],
      300,
    );
    expect(evidence.dispatches.map((dispatch) => dispatch.transportRetry)).toEqual([
      false,
      true,
      false,
    ]);
  });
});

describe("summarizeChain", () => {
  it("veredicto del OSD con su inkRatio, por página", () => {
    const chain = summarizeChain(
      [osd({ pageIndex: 3, result: { orientation: 180, inkRatio: 0.05 } }), ocr({ pageIndex: 3 })],
      [],
    );
    expect(chain.osd).toEqual([{ pageIndex: 3, orientation: 180, inkRatio: 0.05 }]);
    expect(chain.issues).toEqual([]);
  });

  it("un resultado de OSD inválido es un problema, no una lectura", () => {
    const chain = summarizeChain([osd({ result: { orientation: 45, inkRatio: 3 } })], []);
    expect(chain.osd).toEqual([]);
    expect(chain.issues[0]).toContain("osd-result-invalid");
  });

  it("los pasos de recuperación son los despachos con otro jobId que el primero de su página", () => {
    const chain = summarizeChain(
      [
        ocr({ pageIndex: 0, jobId: "p0-a" }),
        ocr({ pageIndex: 0, jobId: "p0-b", upscale: 2 }),
        ocr({ pageIndex: 0, jobId: "p0-b", upscale: 2 }),
        ocr({ pageIndex: 1, jobId: "p1-a" }),
      ],
      [],
    );
    expect(chain.recoverySteps).toBe(1);
    expect(chain.upscaledDispatches).toBe(2);
    expect(chain.maxUpscale).toBe(2);
  });

  it("cuenta las páginas con tinta ilegible sin duplicar y los despachos fallidos", () => {
    const chain = summarizeChain(
      [ocr({ terminal: "FAILED" })],
      [
        { pageIndex: 4, unreadableInk: true },
        { pageIndex: 4, unreadableInk: true },
        { pageIndex: 5 },
        null,
        "texto",
      ],
    );
    expect(chain.unreadableInkPages).toBe(1);
    expect(chain.ocrPageFailedDispatches).toBe(1);
  });
});

describe("cellInvalidReasons", () => {
  const valid = (): CellValidityInput => ({
    ready: true,
    pipelineFailure: null,
    captureIssues: [],
    dispatch: summarizeDispatches([ocr()], [{ pageIndex: 0, originalCap: 301 }], 300),
    chain: summarizeChain([osd(), ocr()], []),
    nerExpectedButNotFinished: false,
    overrideEffective: true,
    expectNativeCap: 300,
  });

  it("una celda completa es válida", () => {
    expect(cellInvalidReasons(valid())).toEqual([]);
  });

  it.each<[string, Partial<CellValidityInput>, string]>([
    ["no llegó a Ready", { ready: false }, "not-ready"],
    ["el pipeline falló", { pipelineFailure: { code: "X" } }, "pipeline-failed"],
    ["el override no es efectivo", { overrideEffective: false }, "override-not-effective"],
    ["NER no terminó", { nerExpectedButNotFinished: true }, "ner-not-finished"],
    ["el observador reportó un problema", { captureIssues: ["algo"] }, "capture-issue: algo"],
  ])("inválida: %s", (_label, patch, reason) => {
    expect(cellInvalidReasons({ ...valid(), ...patch })).toContain(reason);
  });

  it("sin lectura de OSD es inválida", () => {
    expect(cellInvalidReasons({ ...valid(), chain: summarizeChain([ocr()], []) })).toContain(
      "no-osd-reading",
    );
  });

  it("sin despacho observado es inválida", () => {
    const input = { ...valid(), dispatch: summarizeDispatches([], [], 300) };
    expect(cellInvalidReasons(input)).toContain("no-ocr-page-dispatch");
  });

  it("un sintético cuya fuente no es de 300 dpi es inválido; la tolerancia es de un dpi", () => {
    const at = (cap: number | null): string[] => [
      ...cellInvalidReasons({
        ...valid(),
        dispatch: summarizeDispatches(
          [ocr({ dpi: cap === null ? 300 : Math.min(300, cap) })],
          [{ pageIndex: 0, originalCap: cap }],
          300,
        ),
      }),
    ];
    expect(at(301)).toEqual([]);
    expect(at(299)).toEqual([]);
    expect(at(240).some((reason) => reason.startsWith("synthetic-source-not-300"))).toBe(true);
    expect(at(null).some((reason) => reason.startsWith("synthetic-source-not-300"))).toBe(true);
  });

  it("un real no exige la fuente de 300 dpi (expectNativeCap null)", () => {
    const input: CellValidityInput = {
      ...valid(),
      expectNativeCap: null,
      dispatch: summarizeDispatches([ocr({ dpi: 240 })], [{ pageIndex: 0, originalCap: 240 }], 300),
    };
    expect(cellInvalidReasons(input)).toEqual([]);
  });
});
