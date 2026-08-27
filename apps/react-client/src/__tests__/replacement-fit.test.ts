/**
 * `estimateReplacementFit` (`components/entities/replacementFit.ts`).
 *
 * Es el aviso que compensa que una edición manual **saltee la escalera de
 * abreviaturas** (ADR-057 §7): sin él, el usuario escribe un token largo, el
 * render lo encoge (ADR-058) y se entera recién al exportar.
 */

import { DetectionSource, type OccurrenceRef } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { estimateReplacementFit } from "../components/entities/replacementFit.js";

function member(
  width: number,
  height: number,
  fragments?: ReadonlyArray<[number, number]>,
): OccurrenceRef {
  return {
    occurrenceId: `occ-${String(width)}-${String(height)}`,
    value: "valor",
    pageIndex: 0,
    bbox: { x: 0, y: 0, width, height },
    source: DetectionSource.Regex,
    ...(fragments !== undefined
      ? { fragments: fragments.map(([w, h]) => ({ x: 0, y: 0, width: w, height: h })) }
      : {}),
  };
}

describe("estimateReplacementFit", () => {
  it("un token corto entra en una caja holgada", () => {
    expect(estimateReplacementFit("[PERITO]", [member(200, 12)])).toBe("fits");
  });

  it("un token largo no entra en la caja más chica", () => {
    expect(estimateReplacementFit("[PERITO DESIGNADO DE OFICIO]", [member(60, 12)])).toBe(
      "overflows",
    );
  });

  // ADR-057 §4: manda el PEOR caso, porque todas las ocurrencias comparten el
  // valor (invariante de ADR-012). Con una caja holgada y una apretada, el
  // veredicto lo da la apretada.
  it("manda la ocurrencia más apretada, no la primera ni la más holgada", () => {
    const holgada = member(400, 12);
    const apretada = member(40, 12);
    expect(estimateReplacementFit("[PERITO]", [holgada])).toBe("fits");
    expect(estimateReplacementFit("[PERITO]", [holgada, apretada])).toBe("overflows");
  });

  // ADR-074 §7: con `fragments`, se evalúa cada fragmento y NO la envolvente —
  // una entidad partida en dos líneas tiene una envolvente ancha que no
  // aprieta nada, y usarla daría un "entra" falso.
  it("con fragments evalúa cada fragmento, no la envolvente", () => {
    const partida = member(500, 12, [
      [30, 12],
      [40, 12],
    ]);
    expect(estimateReplacementFit("[PERITO]", [partida])).toBe("overflows");
  });

  it("la banda intermedia se reporta como justo", () => {
    // ~0.9-1.0 del ancho disponible: la estimación no es exacta (sin
    // measureText), así que ahí no se afirma que entra.
    const verdicts = [40, 44, 48, 52, 56, 60].map((w) =>
      estimateReplacementFit("[PERITO]", [member(w, 12)]),
    );
    expect(verdicts).toContain("tight");
  });

  it("sin members utilizables no inventa un veredicto", () => {
    expect(estimateReplacementFit("[PERITO]", [])).toBe("unknown");
    expect(estimateReplacementFit("[PERITO]", [member(0, 0)])).toBe("unknown");
  });

  it("el valor vacío siempre entra — es redactar por texto, no un desborde", () => {
    expect(estimateReplacementFit("", [member(10, 12)])).toBe("fits");
  });
});
