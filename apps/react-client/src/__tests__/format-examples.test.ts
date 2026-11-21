/**
 * Los ejemplos de cada fila (ADR-227 §5): «Todo formato base muestra un
 * ejemplo», y los del generador se arman con las piezas.
 */

import { EntityType, getCatalog, type FormatDefinition } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  baseFormatExample,
  BASE_FORMAT_EXAMPLES,
  buildFormatExample,
} from "../components/formats/formatExamples.js";

import { userFormat } from "./helpers/detectionFixtures.js";

describe("formatExamples", () => {
  it("todo formato base del catálogo de Argentina tiene su ejemplo, y no sobra ninguno", () => {
    const ids = getCatalog("AR").map((info) => info.id);
    for (const id of ids) expect(baseFormatExample(id), id).not.toBe("");
    expect(Object.keys(BASE_FORMAT_EXAMPLES).sort()).toEqual([...ids].sort());
  });

  it("un id que el catálogo no tiene da un ejemplo vacío", () => {
    expect(baseFormatExample("no-existe")).toBe("");
  });

  it("arma el ejemplo de un formato con sus piezas, con cada bloque en su largo mínimo", () => {
    const definition: FormatDefinition = userFormat(0, "Mixto", EntityType.License, {
      variants: [
        [
          { kind: "text", value: "MP" },
          { kind: "separator", chars: ["-", "."], optional: true },
          { kind: "chars", charClass: "digit", min: 3, max: 5 },
          { kind: "optional", pieces: [{ kind: "chars", charClass: "upper", min: 2, max: 2 }] },
          { kind: "chars", charClass: "lower", min: 2, max: 2 },
          { kind: "chars", charClass: "letter", min: 1, max: 1 },
          { kind: "chars", charClass: "alnum", min: 12, max: 12 },
        ],
      ],
    });
    expect(buildFormatExample(definition)).toBe("MP-123ABabA" + "A1B2C3D4E5A1");
  });

  it("un separador sin caracteres no aporta nada y un formato sin variantes no tiene ejemplo", () => {
    const empty: FormatDefinition = userFormat(0, "Vacío", EntityType.Plate, {
      variants: [[{ kind: "separator", chars: [], optional: false }]],
    });
    expect(buildFormatExample(empty)).toBe("");
    expect(
      buildFormatExample(userFormat(1, "Sin variantes", EntityType.Plate, { variants: [] })),
    ).toBe("");
  });
});
