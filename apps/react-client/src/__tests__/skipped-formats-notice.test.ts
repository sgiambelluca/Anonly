/**
 * `skippedFormatsText.ts` (ADR-220 §6, ADR-229 §7): los textos del aviso de
 * formatos que no se aplicaron, en la barra y en el diálogo de exportar. Los
 * textos de los casos de la barra salen de `AvisoFormatos.dc.html`, los del
 * diálogo de `ExportarDocumento.dc.html`.
 */
import { describe, expect, it } from "vitest";

import {
  buildSkippedEntries,
  buildSkippedFormatsNotice,
  exportNoticeTitle,
  exportRowGoTo,
  exportRowPages,
  firstGoToPage,
  formatPageList,
  goToPageLabel,
  SKIPPED_FORMATS_WHOLE_DOCUMENT,
} from "../components/toolbar/skippedFormatsText.js";

const NAMES: Readonly<Record<string, string>> = {
  cbu: "CBU",
  cliente: "Cliente",
  legajo: "Legajo de personal",
};
const nameOf = (formatId: string): string => NAMES[formatId] ?? formatId;

describe("formatPageList", () => {
  it("lista de a una, con «y» al final", () => {
    expect(formatPageList([2])).toBe("3");
    expect(formatPageList([2, 3])).toBe("3 y 4");
    expect(formatPageList([2, 3, 6])).toBe("3, 4 y 7");
  });

  it("resume una corrida de tres o más seguidas", () => {
    expect(formatPageList([2, 3, 4, 5])).toBe("3 a 6");
    expect(formatPageList([0, 1, 2, 8, 11])).toBe("1 a 3, 9 y 12");
  });

  it("una lista vacía no dice nada", () => {
    expect(formatPageList([])).toBe("");
  });
});

describe("buildSkippedEntries", () => {
  it("pone nombre, ordena y quita repetidas", () => {
    const [entry] = buildSkippedEntries([{ formatId: "cbu", pageIndices: [3, 2, 3] }], 10, nameOf);
    expect(entry).toEqual({ formatId: "cbu", name: "CBU", pages: [2, 3], wholeDocument: false });
  });

  it("un formato que falló en todas las páginas es «todo el documento» y no lleva páginas", () => {
    const [entry] = buildSkippedEntries(
      [{ formatId: "cliente", pageIndices: [0, 1, 2] }],
      3,
      nameOf,
    );
    expect(entry?.wholeDocument).toBe(true);
    expect(entry?.pages).toEqual([]);
  });

  it("una lista de páginas vacía se trata como todo el documento (el lado seguro)", () => {
    const [entry] = buildSkippedEntries([{ formatId: "cliente", pageIndices: [] }], 3, nameOf);
    expect(entry?.wholeDocument).toBe(true);
  });

  it("descarta páginas fuera del documento cuando se conoce su tamaño", () => {
    const [entry] = buildSkippedEntries(
      [{ formatId: "cbu", pageIndices: [1, 9, -1, 1.5] }],
      4,
      nameOf,
    );
    expect(entry?.pages).toEqual([1]);
  });

  it("con el tamaño desconocido (0 páginas) no descarta ninguna ni lo da por entero", () => {
    const [entry] = buildSkippedEntries([{ formatId: "cbu", pageIndices: [2, 7] }], 0, nameOf);
    expect(entry).toMatchObject({ pages: [2, 7], wholeDocument: false });
  });
});

describe("buildSkippedFormatsNotice (la barra)", () => {
  const entries = (skipped: Parameters<typeof buildSkippedEntries>[0], pageCount = 20) =>
    buildSkippedEntries(skipped, pageCount, nameOf);

  it("sin formatos salteados no hay aviso", () => {
    expect(buildSkippedFormatsNotice([])).toBeNull();
  });

  it("un formato, varias páginas", () => {
    const notice = buildSkippedFormatsNotice(entries([{ formatId: "cbu", pageIndices: [2, 3] }]));
    expect(notice?.message).toBe(
      "El formato «CBU» no se aplicó en las páginas 3 y 4. Revisalas antes de exportar.",
    );
    expect(notice?.goToPage).toBe(2);
    expect(goToPageLabel(notice?.goToPage ?? 0)).toBe("Ir a la página 3");
  });

  it("un formato, una página", () => {
    const notice = buildSkippedFormatsNotice(entries([{ formatId: "legajo", pageIndices: [6] }]));
    expect(notice?.message).toBe(
      "El formato «Legajo de personal» no se aplicó en la página 7. Revisala antes de exportar.",
    );
    expect(notice?.goToPage).toBe(6);
  });

  it("varios formatos: cuántos y cada uno con sus páginas", () => {
    const notice = buildSkippedFormatsNotice(
      entries([
        { formatId: "cbu", pageIndices: [2, 3] },
        { formatId: "cliente", pageIndices: [6] },
      ]),
    );
    expect(notice?.message).toBe(
      "2 formatos tuyos no se aplicaron en algunas páginas: «CBU» (3 y 4) y «Cliente» (7).",
    );
    expect(notice?.goToPage).toBe(2);
  });

  it("tres formatos se separan con comas y «y»", () => {
    const notice = buildSkippedFormatsNotice(
      entries([
        { formatId: "cbu", pageIndices: [2] },
        { formatId: "cliente", pageIndices: [6] },
        { formatId: "legajo", pageIndices: [9] },
      ]),
    );
    expect(notice?.message).toBe(
      "3 formatos tuyos no se aplicaron en algunas páginas: «CBU» (3), «Cliente» (7) y «Legajo de personal» (10).",
    );
  });

  it("un formato que falló en todo el documento no ofrece ir a ninguna página", () => {
    const notice = buildSkippedFormatsNotice(
      entries([{ formatId: "cliente", pageIndices: [0, 1, 2] }], 3),
    );
    expect(notice?.message).toBe(
      "El formato «Cliente» no se aplicó en todo el documento. Revisalo antes de exportar.",
    );
    expect(notice?.goToPage).toBeNull();
  });

  it("entre varios, el botón lleva a la primera página del primer formato que no falló entero", () => {
    const list = entries(
      [
        { formatId: "cliente", pageIndices: [0, 1, 2] },
        { formatId: "cbu", pageIndices: [1] },
      ],
      3,
    );
    expect(firstGoToPage(list)).toBe(1);
    expect(buildSkippedFormatsNotice(list)?.message).toContain("«Cliente» (todo el documento)");
  });
});

describe("el diálogo de exportar", () => {
  const entries = (skipped: Parameters<typeof buildSkippedEntries>[0], pageCount = 20) =>
    buildSkippedEntries(skipped, pageCount, nameOf);

  it("encabezado de un formato: cuenta las páginas", () => {
    expect(exportNoticeTitle(entries([{ formatId: "cbu", pageIndices: [2, 3] }]))).toBe(
      "El formato «CBU» no se aplicó en 2 páginas",
    );
    expect(exportNoticeTitle(entries([{ formatId: "cbu", pageIndices: [2] }]))).toBe(
      "El formato «CBU» no se aplicó en 1 página",
    );
  });

  it("encabezado de varios formatos", () => {
    expect(
      exportNoticeTitle(
        entries([
          { formatId: "cbu", pageIndices: [2, 3] },
          { formatId: "cliente", pageIndices: [6] },
        ]),
      ),
    ).toBe("2 formatos tuyos no se aplicaron en parte del documento");
  });

  it("encabezado de un formato que falló en todo el documento", () => {
    expect(exportNoticeTitle(entries([{ formatId: "cliente", pageIndices: [0, 1] }], 2))).toBe(
      "El formato «Cliente» no se aplicó en todo el documento",
    );
  });

  it("sin entradas no hay encabezado", () => {
    expect(exportNoticeTitle([])).toBe("");
  });

  it("cada fila dice sus páginas y a dónde ir", () => {
    const [cbu, single] = entries([
      { formatId: "cbu", pageIndices: [2, 3] },
      { formatId: "legajo", pageIndices: [6] },
    ]);
    const [whole] = entries([{ formatId: "cliente", pageIndices: [0, 1, 2] }], 3);
    if (cbu === undefined || single === undefined || whole === undefined) {
      throw new Error("faltan entradas");
    }
    expect(exportRowPages(cbu)).toBe("Páginas 3 y 4");
    expect(exportRowGoTo(cbu)).toBe(2);
    expect(exportRowPages(single)).toBe("Página 7");
    expect(exportRowPages(whole)).toBe(SKIPPED_FORMATS_WHOLE_DOCUMENT);
    expect(exportRowGoTo(whole)).toBeNull();
  });
});
