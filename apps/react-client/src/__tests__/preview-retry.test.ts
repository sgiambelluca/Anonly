import { describe, expect, it } from "vitest";

import {
  PREVIEW_RETRY_MAX_ATTEMPTS,
  pagesMissingPreview,
} from "../components/viewer/previewRetry.js";

const base = {
  documentId: "doc-1",
  mountedPageIndices: [0, 1, 2],
  previewByPage: new Map<number, string>(),
  attempts: 0,
} as const;

describe("pagesMissingPreview", () => {
  it("sin ninguna imagen todavía, hay que pedir todas las montadas", () => {
    expect(pagesMissingPreview(base)).toEqual([0, 1, 2]);
  });

  it("pide solo las que faltan, no las que ya llegaron", () => {
    expect(
      pagesMissingPreview({
        ...base,
        previewByPage: new Map([
          [0, "blob:a"],
          [2, "blob:c"],
        ]),
      }),
    ).toEqual([1]);
  });

  it("con todas las imágenes, no hay nada que reintentar — es lo que corta el intervalo", () => {
    expect(
      pagesMissingPreview({
        ...base,
        previewByPage: new Map([
          [0, "blob:a"],
          [1, "blob:b"],
          [2, "blob:c"],
        ]),
      }),
    ).toEqual([]);
  });

  it("sin documento no se pide nada", () => {
    expect(pagesMissingPreview({ ...base, documentId: null })).toEqual([]);
  });

  it("sin páginas montadas no se pide nada", () => {
    expect(pagesMissingPreview({ ...base, mountedPageIndices: [] })).toEqual([]);
  });

  describe("techo de intentos", () => {
    it("sigue pidiendo justo por debajo del techo", () => {
      expect(
        pagesMissingPreview({ ...base, attempts: PREVIEW_RETRY_MAX_ATTEMPTS - 1 }).length,
      ).toBe(3);
    });

    it("deja de pedir en el techo: un render que falla de verdad no deja pidiendo para siempre", () => {
      expect(pagesMissingPreview({ ...base, attempts: PREVIEW_RETRY_MAX_ATTEMPTS })).toEqual([]);
      expect(pagesMissingPreview({ ...base, attempts: PREVIEW_RETRY_MAX_ATTEMPTS + 5 })).toEqual(
        [],
      );
    });
  });
});
