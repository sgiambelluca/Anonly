/**
 * ADR-115 §1: `normalizeEntityValue` es la normalización de
 * `Occurrence.normalizedValue`, o sea la clave con la que `grouping-engine`
 * agrupa. Los valores son los medidos sobre un expediente escaneado.
 */
import { describe, expect, it } from "vitest";

import { normalizeEntityValue, normalizeForComparison } from "../normalize-for-comparison.js";

describe("normalizeEntityValue (ADR-115 §1)", () => {
  it("las tres formas del mismo apellido dan la misma clave", () => {
    // `SUAREZ,` en el sello, `“SUAREZ,` en la carátula del cuerpo y `Suarez.`
    // al final de una oración: `Word.text` trae la puntuación pegada porque la
    // palabra es la unidad más fina que existe (ADR-089 §3).
    expect(normalizeEntityValue("SUAREZ,")).toBe("suarez");
    expect(normalizeEntityValue("“SUAREZ,")).toBe("suarez");
    expect(normalizeEntityValue("Suarez.")).toBe("suarez");
    expect(normalizeEntityValue("SUAREZ")).toBe("suarez");
  });

  it("no toca la puntuación INTERNA", () => {
    // Un abreviado y un identificador dependen de sus puntos y guiones.
    expect(normalizeEntityValue("A.C.")).toBe("a.c");
    expect(normalizeEntityValue("20-12345678-9")).toBe("20-12345678-9");
    expect(normalizeEntityValue("Empresa S.A.")).toBe("empresa s.a");
  });

  it("conserva todo lo que ya hacía normalizeForComparison", () => {
    expect(normalizeEntityValue("  Pérez   Juan  ")).toBe("perez juan");
    expect(normalizeEntityValue("MARÍA")).toBe("maria");
  });

  it("un valor sin bordes que recortar es idéntico a normalizeForComparison", () => {
    for (const value of ["Juan Pérez", "empresa", "NNNNNN"]) {
      expect(normalizeEntityValue(value)).toBe(normalizeForComparison(value));
    }
  });

  it("un valor de pura puntuación queda vacío, no rompe", () => {
    expect(normalizeEntityValue("—")).toBe("");
    expect(normalizeEntityValue("")).toBe("");
  });

  it("normalizeForComparison NO recorta los bordes", () => {
    // La no regresión que justifica que sean dos funciones: las claves del
    // léxico de género se generan con la de comparación (ADR-060 §4), y el
    // script de build y el lookup de runtime tienen que coincidir.
    expect(normalizeForComparison("SUAREZ,")).toBe("suarez,");
  });
});
