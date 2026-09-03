/**
 * ADR-105 — la frase que rodea a una ocurrencia.
 */
import { describe, expect, it } from "vitest";

import { buildOccurrenceContext, OCCURRENCE_CONTEXT_CHARS } from "../occurrence-context.js";

const TEXTO =
  "Se deja constancia de que el perito entrevistó a Facundo en la sede central, " +
  "y que posteriormente declaró Abril ante la misma autoridad interviniente.";

function ocurrencia(valor: string): { start: number; end: number } {
  const start = TEXTO.indexOf(valor);
  return { start, end: start + valor.length };
}

describe("buildOccurrenceContext (ADR-105)", () => {
  it("devuelve la frase de los dos lados, sin repetir el valor", () => {
    const { start, end } = ocurrencia("Facundo");
    const ctx = buildOccurrenceContext(TEXTO, start, end)!;

    expect(ctx.before).toContain("entrevistó a");
    expect(ctx.after).toContain("en la sede");
    // El valor NO se repite: ya viaja en `Occurrence.value` (ADR-104 §1).
    expect(ctx.before).not.toContain("Facundo");
    expect(ctx.after).not.toContain("Facundo");
  });

  it("distingue dos apariciones que comparten el valor", () => {
    // El caso que motivó el ADR: con el valor solo, estas dos filas son
    // idénticas en el separador.
    const texto = "declaró Juan por la mañana y más tarde firmó Juan el acta";
    const primera = buildOccurrenceContext(
      texto,
      texto.indexOf("Juan"),
      texto.indexOf("Juan") + 4,
    )!;
    const segunda = buildOccurrenceContext(
      texto,
      texto.lastIndexOf("Juan"),
      texto.lastIndexOf("Juan") + 4,
    )!;

    expect(primera).not.toEqual(segunda);
  });

  it("no corta palabras por la mitad", () => {
    const { start, end } = ocurrencia("Abril");
    const ctx = buildOccurrenceContext(TEXTO, start, end)!;

    // Lo que quede a la izquierda tiene que empezar en una palabra entera:
    // el índice crudo de la ventana cae en medio de una, y se recorta.
    const antes = TEXTO.slice(0, start);
    expect(antes.endsWith(ctx.before)).toBe(true);
    expect(antes.slice(0, antes.length - ctx.before.length)).toMatch(/(^|\s)$/);
  });

  it("acota la ventana a los caracteres declarados", () => {
    const largo = `${"palabra ".repeat(40)}NOMBRE${" palabra".repeat(40)}`;
    const start = largo.indexOf("NOMBRE");
    const ctx = buildOccurrenceContext(largo, start, start + 6)!;

    // El recorte a límite de palabra solo puede ACHICAR la ventana.
    expect(ctx.before.length).toBeLessThanOrEqual(OCCURRENCE_CONTEXT_CHARS);
    expect(ctx.after.length).toBeLessThanOrEqual(OCCURRENCE_CONTEXT_CHARS);
  });

  it("devuelve undefined cuando no hay nada alrededor", () => {
    // Distinguir "no hay contexto" de "el contexto es vacío" es la razón por
    // la que el campo es opcional (ADR-105 §4).
    expect(buildOccurrenceContext("Facundo", 0, 7)).toBeUndefined();
  });

  it("devuelve undefined ante un rango imposible, en vez de recortar mal", () => {
    expect(buildOccurrenceContext(TEXTO, -1, 5)).toBeUndefined();
    expect(buildOccurrenceContext(TEXTO, 5, 5)).toBeUndefined();
    expect(buildOccurrenceContext(TEXTO, 0, TEXTO.length + 10)).toBeUndefined();
  });
});
