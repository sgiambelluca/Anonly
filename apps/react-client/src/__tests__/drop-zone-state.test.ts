import { describe, expect, it } from "vitest";

import { looksLikePdf, resolveDropZoneState } from "../components/screens/dropZoneState.js";
import {
  PRODUCT_LICENSE,
  REPORT_ISSUE_URL,
  REPOSITORY_URL,
} from "../components/screens/externalLinks.js";

// ADR-168 §2: cuatro estados en el mismo recuadro.

describe("resolveDropZoneState", () => {
  it("sin nada: reposo", () => {
    expect(resolveDropZoneState({ dragging: false, opening: false, hasError: false })).toBe("idle");
  });

  it("dragover: arrastrando", () => {
    expect(resolveDropZoneState({ dragging: true, opening: false, hasError: false })).toBe(
      "dragging",
    );
  });

  it("arrastrar encima gana al error (el usuario ya está corrigiendo)", () => {
    expect(resolveDropZoneState({ dragging: true, opening: false, hasError: true })).toBe(
      "dragging",
    );
  });

  it("abrir gana a todo", () => {
    expect(resolveDropZoneState({ dragging: true, opening: true, hasError: true })).toBe("opening");
  });

  it("error sin arrastre", () => {
    expect(resolveDropZoneState({ dragging: false, opening: false, hasError: true })).toBe("error");
  });
});

describe("looksLikePdf", () => {
  it("acepta el MIME de PDF", () => {
    expect(looksLikePdf({ type: "application/pdf", name: "a.bin" })).toBe(true);
  });

  it("con MIME vacío cae a la extensión", () => {
    expect(looksLikePdf({ type: "", name: "Informe.PDF" })).toBe(true);
    expect(looksLikePdf({ type: "", name: "informe.docx" })).toBe(false);
  });

  it("rechaza otro MIME aunque la extensión diga .pdf", () => {
    expect(looksLikePdf({ type: "text/plain", name: "a.pdf" })).toBe(false);
  });
});

describe("externalLinks (ADR-070 §3 extendido por ADR-168 §3)", () => {
  it("las dos URLs del proyecto son las que fija el ADR", () => {
    expect(REPOSITORY_URL).toBe("https://github.com/sgiambelluca/Anonly");
    expect(REPORT_ISSUE_URL).toBe("https://github.com/sgiambelluca/Anonly/issues/new");
  });

  it("la licencia del producto es la del LICENSE del repo", () => {
    expect(PRODUCT_LICENSE).toBe("MIT");
  });
});
