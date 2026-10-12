/**
 * El diálogo del aviso de espacio justo (ADR-215 §1, `Components.md` §3.3b):
 * las opciones según el modo del grupo, el rótulo del segundo renglón, lo que
 * dibuja, la aclaración, el botón por opción, el caso sin sugerencias y el
 * rótulo de páginas.
 */

import { ReplacementMode } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { pagesLabel } from "../components/entities/degradedMessage.js";
import { todayPhrase } from "../components/entities/phraseContent.js";
import {
  resolveTightChoice,
  tightApplyLabel,
  tightClarification,
  tightOptions,
  tightResultContent,
  tightResultLabel,
} from "../components/entities/tightSpaceDialog.js";

describe("tightOptions", () => {
  it("ofrece las tres salidas, en el orden de ADR-215 §1", () => {
    expect(tightOptions(ReplacementMode.Placeholder).map((option) => option.id)).toEqual([
      "shorter",
      "redact",
      "visible",
    ]);
    expect(tightOptions(ReplacementMode.Placeholder).map((option) => option.title)).toEqual([
      "Usar un texto más corto",
      "Tapar con negro",
      "Dejarlo a la vista",
    ]);
  });

  it("lleva la descripción literal de cada una", () => {
    expect(tightOptions(ReplacementMode.Mask).map((option) => option.description)).toEqual([
      "Se abre el editor, con sugerencias que sí entran.",
      "Un bloque negro sobre el texto. Siempre entra.",
      "No se oculta: el dato se va a poder leer.",
    ]);
  });

  it("no ofrece tapar con negro si el grupo ya está en redact", () => {
    expect(tightOptions(ReplacementMode.Redact).map((option) => option.id)).toEqual([
      "shorter",
      "visible",
    ]);
  });
});

describe("resolveTightChoice", () => {
  const options = tightOptions(ReplacementMode.Placeholder);

  it("preselecciona la primera opción", () => {
    expect(resolveTightChoice(null, options)).toBe("shorter");
  });

  it("respeta la elegida", () => {
    expect(resolveTightChoice("visible", options)).toBe("visible");
  });

  it("vuelve a la primera si la elegida ya no se ofrece", () => {
    expect(resolveTightChoice("redact", tightOptions(ReplacementMode.Redact))).toBe("shorter");
  });
});

describe("tightResultLabel", () => {
  it("rotula el segundo renglón de cada opción", () => {
    expect(tightResultLabel("shorter", true)).toBe("Con un texto más corto (ejemplo)");
    expect(tightResultLabel("redact", true)).toBe("Con el bloque negro");
    expect(tightResultLabel("visible", true)).toBe("Sin ocultar");
  });

  it("sin sugerencias, el rótulo no promete un ejemplo", () => {
    expect(tightResultLabel("shorter", false)).toBe("Con un texto más corto");
  });

  it("las otras dos opciones no dependen de las sugerencias", () => {
    expect(tightResultLabel("redact", false)).toBe("Con el bloque negro");
    expect(tightResultLabel("visible", false)).toBe("Sin ocultar");
  });
});

describe("tightResultContent", () => {
  it("un texto más corto dibuja la primera sugerencia", () => {
    expect(tightResultContent("shorter", ["[TESTIGO 04]", "[T04]"])).toEqual({
      kind: "text",
      text: "[TESTIGO 04]",
    });
  });

  it("sin sugerencias dibuja el lugar vacío, con el ancho del original", () => {
    expect(tightResultContent("shorter", [])).toEqual({ kind: "empty" });
  });

  it("tapar con negro dibuja el bloque", () => {
    expect(tightResultContent("redact", ["[X]"])).toEqual({ kind: "block" });
  });

  it("dejarlo a la vista dibuja el original", () => {
    expect(tightResultContent("visible", ["[X]"])).toEqual({ kind: "original" });
  });
});

describe("tightClarification", () => {
  it("por defecto aclara que es un problema de lectura, sin advertir", () => {
    for (const choice of ["shorter", "redact"] as const) {
      expect(tightClarification(choice)).toEqual({
        text: "El dato sigue oculto: es un problema de lectura, no de privacidad.",
        warning: false,
      });
    }
  });

  it("con «Dejarlo a la vista» advierte que el dato va a quedar legible", () => {
    expect(tightClarification("visible")).toEqual({
      text: "El dato va a quedar legible en el documento exportado.",
      warning: true,
    });
  });
});

describe("tightApplyLabel", () => {
  it("abrir el editor no aplica nada todavía; las otras dos aplican", () => {
    expect(tightApplyLabel("shorter")).toBe("Abrir el editor");
    expect(tightApplyLabel("redact")).toBe("Aplicar");
    expect(tightApplyLabel("visible")).toBe("Aplicar");
  });
});

describe("pagesLabel", () => {
  // El `pageIndex` del Core es 0-based; el usuario cuenta desde 1. Que se le
  // diga "Página 0" es el error más fácil de cometer acá.
  it("una página, en singular y contada desde 1", () => {
    expect(pagesLabel([0])).toBe("Página 1");
    expect(pagesLabel([2])).toBe("Página 3");
  });

  it("dos páginas", () => {
    expect(pagesLabel([2, 6])).toBe("Páginas 3 y 7");
  });

  it("hasta tres, separa con comas y cierra con «y»", () => {
    expect(pagesLabel([2, 6, 11])).toBe("Páginas 3, 7 y 12");
  });

  it("con más de tres lista las tres primeras y cuenta el resto", () => {
    expect(pagesLabel([2, 6, 11, 13, 14, 15, 16, 17])).toBe("Páginas 3, 7, 12 y 5 más");
  });

  it("con una sola de más dice «y 1 más»", () => {
    expect(pagesLabel([2, 6, 11, 13])).toBe("Páginas 3, 7, 12 y 1 más");
  });

  it("sin páginas, vacío", () => {
    expect(pagesLabel([])).toBe("");
  });

  // Regla de ADR-062: el aviso lo lee alguien que no sabe qué es un token.
  it("el texto no filtra jerga técnica", () => {
    const texto = pagesLabel([0, 3, 5, 8, 9]);
    for (const jerga of ["token", "placeholder", "bbox", "degrad", "ratio"]) {
      expect(texto.toLowerCase()).not.toContain(jerga);
    }
  });
});

describe("todayPhrase", () => {
  const base = { enabled: true, replacementMode: ReplacementMode.Placeholder } as const;

  it("muestra el reemplazo vigente", () => {
    expect(todayPhrase({ ...base, replacementValue: "[PERSONA 04]" })).toEqual({
      kind: "text",
      text: "[PERSONA 04]",
    });
  });

  it("en modo redact muestra el bloque negro", () => {
    expect(
      todayPhrase({ enabled: true, replacementMode: ReplacementMode.Redact, replacementValue: "" }),
    ).toEqual({ kind: "block" });
  });

  it("con el grupo deshabilitado muestra el original", () => {
    expect(todayPhrase({ ...base, enabled: false, replacementValue: "[PERSONA 04]" })).toEqual({
      kind: "original",
    });
    expect(
      todayPhrase({
        enabled: false,
        replacementMode: ReplacementMode.Redact,
        replacementValue: "",
      }),
    ).toEqual({ kind: "original" });
  });
});
