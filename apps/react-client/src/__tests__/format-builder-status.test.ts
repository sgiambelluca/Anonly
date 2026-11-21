/**
 * La caja de estado y la prueba del generador (ADR-228 §6 y §7).
 */

import { EntityType, type FormatDefinition, type FormatPiece } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  buildSegments,
  clampPanelOffset,
  contextRanges,
  evaluateBuilder,
  identicalText,
  initialPanelOffset,
  runFormatTest,
  TEST_PANEL_SIZE,
} from "../components/formats/formatBuilderStatus.js";
import { describeOverlapWarning } from "../components/formats/formatsImport.js";
import { describeOverlap } from "../components/formats/formatTexts.js";
import { DEFAULT_DETECTION_STATE } from "../store/detectionState.js";

import { stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";

const digits = (min: number, max: number): FormatPiece => ({
  kind: "chars",
  charClass: "digit",
  min,
  max,
});

function format(overrides: Partial<FormatDefinition> = {}): FormatDefinition {
  return userFormat(1, "Mi formato", EntityType.Phone, {
    variants: [[digits(4, 4), { kind: "text", value: "Z" }]],
    ...overrides,
  });
}

describe("evaluateBuilder", () => {
  it("verde: listo para crear o para guardar", () => {
    const create = evaluateBuilder(format(), DEFAULT_DETECTION_STATE, "create");
    expect(create.status).toEqual({ tone: "ready", text: "Listo para crear.", canSubmit: true });
    expect(evaluateBuilder(format(), DEFAULT_DETECTION_STATE, "edit").status.text).toBe(
      "Listo para guardar.",
    );
    expect(create.variantsWithIssues.size).toBe(0);
  });

  it("rojo: falta el nombre, con el texto de la tabla y sin dejar crear", () => {
    const result = evaluateBuilder(format({ name: "" }), DEFAULT_DETECTION_STATE, "create");
    expect(result.status.tone).toBe("error");
    expect(result.status.canSubmit).toBe(false);
    expect(result.status.text).toContain("El formato necesita un nombre");
    expect(result.comparison).toBeNull();
  });

  it("rojo: una variante sin dígitos ni letras marca su pestaña", () => {
    const result = evaluateBuilder(
      format({
        variants: [[digits(2, 2)], [{ kind: "text", value: "HC" }]],
      }),
      DEFAULT_DETECTION_STATE,
      "create",
    );
    expect(result.status.tone).toBe("error");
    expect(result.status.text).toContain("variante 2");
    expect([...result.variantsWithIssues]).toEqual([1]);
  });

  it("rojo: demasiado amplio", () => {
    const wide = evaluateBuilder(
      format({
        variants: Array.from({ length: 8 }, () => [
          { kind: "chars", charClass: "alnum", min: 1, max: 64 } as const,
          { kind: "chars", charClass: "alnum", min: 1, max: 64 } as const,
          { kind: "chars", charClass: "alnum", min: 1, max: 64 } as const,
          { kind: "chars", charClass: "alnum", min: 1, max: 64 } as const,
        ]),
      }),
      DEFAULT_DETECTION_STATE,
      "create",
    );
    expect(wide.status.canSubmit).toBe(false);
    expect(wide.status.text).toContain("demasiado complejo");
  });

  it("rojo: el nombre ya lo usa otro formato", () => {
    const state = stateWith({ userFormats: [userFormat(2, "Mi formato")] });
    const result = evaluateBuilder(format(), state, "create");
    expect(result.status.text).toContain("Ya tenés un formato llamado «Mi formato»");
  });

  it("rojo: ya existe un formato igual (entre los propios, aunque esté apagado)", () => {
    const other = userFormat(2, "Otro", EntityType.Phone, {
      variants: format().variants,
      enabled: false,
    });
    const result = evaluateBuilder(format(), stateWith({ userFormats: [other] }), "create");
    expect(result.status).toEqual({
      tone: "error",
      text: identicalText("Otro"),
      canSubmit: false,
    });
  });

  it("editar un formato no se compara consigo mismo", () => {
    const own = format();
    const result = evaluateBuilder(own, stateWith({ userFormats: [own] }), "edit");
    expect(result.status.tone).toBe("ready");
  });

  it("la copia de un formato base no es «idéntica» a su original, que dejó de correr", () => {
    const copy = userFormat(3, "DNI propio", EntityType.DNI, {
      basedOn: "dni-ar",
      variants: [
        [digits(2, 2), { kind: "separator", chars: ["."], optional: false }, digits(3, 3)],
      ],
    });
    const result = evaluateBuilder(copy, DEFAULT_DETECTION_STATE, "copy");
    expect(result.comparison?.identicalTo).toBeNull();
  });

  it("amarillo: comparte textos con otro formato, con un ejemplo, y deja crear", () => {
    const other = userFormat(2, "Teléfono interno", EntityType.Phone, {
      variants: [[digits(3, 6)]],
    });
    const mine = format({ variants: [[digits(4, 8)]] });
    const result = evaluateBuilder(mine, stateWith({ userFormats: [other] }), "create");
    expect(result.status.tone).toBe("warning");
    expect(result.status.canSubmit).toBe(true);
    expect(result.status.text).toContain("«Mi formato» comparte textos con");
    expect(result.status.text).toContain("«Teléfono interno»");
    expect(result.status.text).toContain("Por ejemplo, «");
  });

  it("un tipo propio que ya no existe es un error con su texto", () => {
    const result = evaluateBuilder(
      format({ entityType: `user:${userType(4, "x").id.slice(5)}` }),
      DEFAULT_DETECTION_STATE,
      "create",
    );
    expect(result.status.text).toContain("ya no existe");
  });
});

describe("describeOverlap: el mismo aviso en el generador y al importar", () => {
  it("nombra al formato y a los otros", () => {
    expect(describeOverlap("A", [{ name: "B" }])).toBe(
      "«A» comparte textos con «B». Si están prendidos a la vez, un mismo texto puede reconocerse más de una vez.",
    );
    expect(describeOverlap(null, [{ name: "B" }, { name: "C", example: "12" }])).toContain(
      "Este formato comparte textos con «B» y «C». Por ejemplo, «12» también lo reconoce «C».",
    );
    expect(describeOverlap("  ", [{ name: "B" }])).toMatch(/^Este formato/);
  });

  it("con muchos formatos resume el resto", () => {
    const text = describeOverlap("A", [{ name: "1" }, { name: "2" }, { name: "3" }, { name: "4" }]);
    expect(text).toContain("«1», «2» y 2 más");
    expect(describeOverlap("A", [{ name: "1" }, { name: "2" }, { name: "3" }])).toContain(
      "«1», «2» y «3»",
    );
  });

  it("describeOverlapWarning usa el mismo texto, con ejemplos si los hay", () => {
    expect(
      describeOverlapWarning({
        kind: "format",
        name: "A",
        overlapsWith: ["B"],
        overlapExamples: ["123"],
      }),
    ).toBe(describeOverlap("A", [{ name: "B", example: "123" }]));
    expect(describeOverlapWarning({ kind: "format", name: "A" })).toContain("comparte textos con");
  });
});

describe("«Probar con un texto»", () => {
  it("resalta lo que se detectaría y cuenta las coincidencias", () => {
    const outcome = runFormatTest(format(), "tel 1234Z y 5678Z.");
    expect(outcome.count).toBe(2);
    expect(outcome.segments.map((s) => [s.kind, s.text])).toEqual([
      ["plain", "tel "],
      ["hit", "1234Z"],
      ["plain", " y "],
      ["hit", "5678Z"],
      ["plain", "."],
    ]);
  });

  it("sin texto no hay nada que mostrar", () => {
    expect(runFormatTest(format(), "")).toEqual({ count: 0, segments: [] });
  });

  it("respeta el contexto y marca la palabra con el subrayado punteado", () => {
    const withContext = format({ contextBefore: ["legajo"] });
    const outcome = runFormatTest(withContext, "Legajo 1234Z y 5678Z");
    expect(outcome.count).toBe(1);
    expect(outcome.segments[0]).toEqual({ text: "Legajo", kind: "context" });
    expect(outcome.segments.some((s) => s.kind === "hit" && s.text === "1234Z")).toBe(true);
  });

  it("buildSegments: lo detectado gana sobre el contexto y los rangos se acotan", () => {
    const segments = buildSegments(
      "abcdef",
      [{ start: 2, end: 4 }],
      [
        { start: -3, end: 3 },
        { start: 5, end: 99 },
      ],
    );
    expect(segments.map((s) => [s.kind, s.text])).toEqual([
      ["context", "ab"],
      ["hit", "cd"],
      ["plain", "e"],
      ["context", "f"],
    ]);
    expect(buildSegments("", [], [])).toEqual([]);
  });

  it("contextRanges: sin distinguir mayúsculas, varias apariciones, ignora las vacías", () => {
    expect(contextRanges("Leg y leg", ["LEG", " ", ""])).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 9 },
    ]);
    // `İ` cambia de largo al pasar a minúscula: se busca en el original.
    expect(contextRanges("İ x", ["x"])).toEqual([{ start: 2, end: 3 }]);
  });
});

describe("el panel flotante", () => {
  const viewport = { width: 1400, height: 900 };

  it("se abre a la derecha del diálogo si hay lugar", () => {
    const dialog = { left: 300, top: 100, width: 700, height: 600 };
    expect(initialPanelOffset(dialog, viewport)).toEqual({ x: 712, y: 0 });
  });

  it("si no hay lugar, queda encima de su borde derecho", () => {
    const dialog = { left: 300, top: 100, width: 900, height: 600 };
    const offset = initialPanelOffset(dialog, viewport);
    const left = dialog.left + offset.x;
    expect(left).toBe(1200 - TEST_PANEL_SIZE.width / 2);
    expect(left + TEST_PANEL_SIZE.width).toBeLessThanOrEqual(viewport.width);
  });

  it("se mantiene dentro de la ventana al arrastrarlo", () => {
    const dialog = { left: 300, top: 100, width: 700, height: 600 };
    const far = clampPanelOffset({ x: 9999, y: 9999 }, dialog, viewport);
    expect(dialog.left + far.x + TEST_PANEL_SIZE.width).toBeLessThanOrEqual(viewport.width);
    expect(dialog.top + far.y + TEST_PANEL_SIZE.height).toBeLessThanOrEqual(viewport.height);
    const near = clampPanelOffset({ x: -9999, y: -9999 }, dialog, viewport);
    expect(dialog.left + near.x).toBeGreaterThanOrEqual(0);
    expect(dialog.top + near.y).toBeGreaterThanOrEqual(0);
    // Una ventana más chica que el panel no rompe la cuenta.
    expect(clampPanelOffset({ x: 0, y: 0 }, dialog, { width: 100, height: 100 })).toBeDefined();
  });
});
