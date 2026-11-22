/**
 * Los tipos propios en la interfaz (F7, tanda 3): cómo se mezclan los guardados
 * con los del documento (`userTypes.ts`), cómo se nombran y se colorean
 * (`entityTypeLabels.ts`, `entityTypeColors.ts`) y qué modos ofrecen
 * (`replacementModeOptions.ts`, ADR-229 §4).
 */

import { EntityType, ReplacementMode, type UserEntityTypeId } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  typeBandTint,
  typeColor,
  typeDotStyle,
  userDotStyle,
  USER_TYPE_COLOR,
  ENTITY_TYPE_COLOR,
} from "../components/entities/entityTypeColors.js";
import {
  describeEntityNumber,
  ENTITY_TYPE_ORDER,
  PICKER_TYPE_ORDER,
  typePlural,
  typeSingular,
} from "../components/entities/entityTypeLabels.js";
import { modesForType } from "../components/entities/replacementModeOptions.js";
import {
  findUserType,
  mergeUserTypes,
  NO_USER_TYPES,
  UNKNOWN_USER_TYPE_NAME,
  userTypeDefinitions,
} from "../components/entities/userTypes.js";

import { userType } from "./helpers/detectionFixtures.js";

const legajo = userType(0, "Legajo");
const afiliado = userType(1, "Número de afiliado");
const historia = userType(2, "Historia clínica");

describe("mergeUserTypes", () => {
  it("primero los guardados, después los del documento, en su orden", () => {
    const merged = mergeUserTypes([legajo], [afiliado, historia], new Set());
    expect(merged.map((entry) => entry.definition.name)).toEqual([
      "Legajo",
      "Número de afiliado",
      "Historia clínica",
    ]);
  });

  it("un tipo del documento que no se guardó es «solo de este documento»", () => {
    const merged = mergeUserTypes([legajo], [afiliado], new Set());
    expect(merged.map((entry) => entry.documentOnly)).toEqual([false, true]);
  });

  it("un tipo guardado durante el documento sale una sola vez y deja de ser solo del documento", () => {
    const saved = new Set<UserEntityTypeId>([afiliado.id]);
    // Guardado durante el documento: está en las dos listas.
    const merged = mergeUserTypes([legajo, afiliado], [afiliado, historia], saved);
    expect(merged.map((entry) => entry.definition.id)).toEqual([
      legajo.id,
      afiliado.id,
      historia.id,
    ]);
    expect(merged.map((entry) => entry.documentOnly)).toEqual([false, false, true]);
  });

  it("marca como guardado un tipo del documento que está en `savedDuringDocument`, aunque la config no lo traiga", () => {
    const merged = mergeUserTypes([], [afiliado], new Set([afiliado.id]));
    expect(merged).toEqual([{ definition: afiliado, documentOnly: false }]);
  });

  it("sin nada, no hay tipos", () => {
    expect(mergeUserTypes([], [], new Set())).toEqual([]);
    expect(userTypeDefinitions([])).toEqual(NO_USER_TYPES);
  });

  it("userTypeDefinitions devuelve solo las definiciones", () => {
    expect(userTypeDefinitions(mergeUserTypes([legajo], [afiliado], new Set()))).toEqual([
      legajo,
      afiliado,
    ]);
  });

  it("findUserType busca por id", () => {
    expect(findUserType([legajo, afiliado], afiliado.id)).toBe(afiliado);
    expect(findUserType([legajo], afiliado.id)).toBeUndefined();
  });
});

describe("nombres de tipo", () => {
  it("un tipo base se nombra como siempre", () => {
    expect(typeSingular(EntityType.Person)).toBe("Persona");
    expect(typePlural(EntityType.Person)).toBe("Personas");
    expect(describeEntityNumber(EntityType.Person, 6)).toBe("Persona N.º 06");
  });

  it("un tipo propio se nombra como lo escribió el usuario", () => {
    expect(typeSingular(historia.id, [historia])).toBe("Historia clínica");
    expect(typePlural(historia.id, [historia])).toBe("Historia clínica");
    expect(describeEntityNumber(historia.id, 3, [historia])).toBe("Historia clínica N.º 03");
  });

  it("un tipo propio sin definición conocida no rompe: sale con un nombre neutro", () => {
    expect(typeSingular(historia.id)).toBe(UNKNOWN_USER_TYPE_NAME);
    expect(typePlural(historia.id, [legajo])).toBe(UNKNOWN_USER_TYPE_NAME);
    expect(describeEntityNumber(historia.id, 1)).toBe(`${UNKNOWN_USER_TYPE_NAME} N.º 01`);
  });
});

describe("el selector no ofrece «Custom»", () => {
  it("ofrece los doce tipos base, y el orden completo conserva los trece", () => {
    expect(PICKER_TYPE_ORDER).toHaveLength(12);
    expect(PICKER_TYPE_ORDER).not.toContain(EntityType.Custom);
    expect(ENTITY_TYPE_ORDER).toHaveLength(13);
    expect(ENTITY_TYPE_ORDER).toContain(EntityType.Custom);
  });
});

describe("color y punto de un tipo", () => {
  it("un tipo base usa su color; uno propio, el de acento", () => {
    expect(typeColor(EntityType.Person)).toBe(ENTITY_TYPE_COLOR[EntityType.Person]);
    expect(typeColor(historia.id)).toBe(USER_TYPE_COLOR);
  });

  it("el punto: relleno en un tipo base, hueco en uno propio y punteado si es solo del documento", () => {
    expect(typeDotStyle(EntityType.Person)).toEqual({
      background: ENTITY_TYPE_COLOR[EntityType.Person],
    });
    expect(typeDotStyle(historia.id)).toEqual({ border: "2.2px solid rgb(var(--color-user))" });
    expect(typeDotStyle(historia.id, true)).toEqual({
      border: "2.2px dashed rgb(var(--color-user))",
    });
    expect(userDotStyle(true)).toEqual(typeDotStyle(historia.id, true));
  });

  it("el fondo de la franja usa el acento del tema para un tipo propio", () => {
    expect(typeBandTint(historia.id)).toContain("var(--color-accent)");
    expect(typeBandTint(EntityType.Person)).toContain("16 185 129");
  });
});

describe("modos que ofrece un tipo", () => {
  it("un tipo base ofrece los cuatro", () => {
    expect(modesForType(false)).toHaveLength(4);
    expect(modesForType(false)).toContain(ReplacementMode.Synthetic);
  });

  it("un tipo propio no ofrece «Dato falso» (ADR-229 §4)", () => {
    expect(modesForType(true)).toEqual([
      ReplacementMode.Placeholder,
      ReplacementMode.Mask,
      ReplacementMode.Redact,
    ]);
  });
});
