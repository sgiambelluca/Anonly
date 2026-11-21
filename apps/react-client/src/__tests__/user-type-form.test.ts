/**
 * La lógica del formulario de `UserTypeDialog` (`Components.md` §13b.3):
 * validación en vivo con `validateUserEntityType`, ranura de alto fijo y la
 * caja «Cómo se reemplaza».
 */

import { describe, expect, it } from "vitest";

import {
  buildUserTypeDefinition,
  evaluateTypeForm,
  fieldsOf,
  replacementLadder,
  TYPE_FORM_COPY,
  typeFormNote,
} from "../components/formats/userTypeForm.js";

import { userType } from "./helpers/detectionFixtures.js";

const ID = userType(0, "x").id;
const fields = (name: string, level1 = "", level2 = "") => ({ name, level1, level2 });

describe("userTypeForm", () => {
  it("fieldsOf lee un tipo existente o devuelve campos vacíos al crear", () => {
    expect(fieldsOf(undefined)).toEqual(fields(""));
    expect(fieldsOf({ id: ID, name: "Legajo", shortLabels: { level1: "LEG" } })).toEqual(
      fields("Legajo", "LEG", ""),
    );
  });

  it("la definición recorta el nombre y no lleva versiones cortas vacías (= automática)", () => {
    expect(buildUserTypeDefinition(ID, fields("  Legajo  "))).toEqual({ id: ID, name: "Legajo" });
    expect(buildUserTypeDefinition(ID, fields("Legajo", " LEG ", ""))).toEqual({
      id: ID,
      name: "Legajo",
      shortLabels: { level1: "LEG" },
    });
    expect(buildUserTypeDefinition(ID, fields("Legajo", "", "LE"))).toEqual({
      id: ID,
      name: "Legajo",
      shortLabels: { level2: "LE" },
    });
  });

  it("«Cómo se reemplaza» muestra los tres largos, con las versiones automáticas de ADR-219 §2", () => {
    expect(replacementLadder(fields("Historia clínica"))).toEqual({
      level0: "HISTORIA CLINICA",
      level1: "HIST",
      level2: "HIS",
    });
    expect(replacementLadder(fields("Historia clínica", "hc", "h"))).toEqual({
      level0: "HISTORIA CLINICA",
      level1: "HC",
      level2: "H",
    });
    expect(replacementLadder(fields(""))).toEqual({ level0: "", level1: "", level2: "" });
    expect(replacementLadder(fields("A-1")).level1).toBe("A1");
  });

  it("un tipo válido deja la ranura en reposo y habilita el botón", () => {
    const result = evaluateTypeForm(ID, fields("Historia clínica"), [], "AR");
    expect(result.slot).toEqual({ kind: "idle" });
    expect(result.canSubmit).toBe(true);
    expect(result.definition.name).toBe("Historia clínica");
  });

  it("un nombre todavía vacío no es un error a mostrar, pero apaga el botón", () => {
    const result = evaluateTypeForm(ID, fields(""), [], "AR");
    expect(result.slot).toEqual({ kind: "idle" });
    expect(result.canSubmit).toBe(false);
    expect(evaluateTypeForm(ID, fields("   "), [], "AR").canSubmit).toBe(false);
  });

  it("un error muestra el texto de §11b.16 y apaga el botón", () => {
    const result = evaluateTypeForm(ID, fields("Legajo #4"), [], "AR");
    expect(result.canSubmit).toBe(false);
    expect(result.slot).toEqual({
      kind: "error",
      text: "El nombre tiene «#», y solo se admiten letras, números, espacios y guiones. Sacalo o cambialo.",
    });
  });

  it("una etiqueta repetida, de otro tipo o de un tipo base, dice cómo se reemplazaría", () => {
    const taken = evaluateTypeForm(ID, fields("legajo"), [userType(1, "Legajo")], "AR");
    expect(taken.slot).toEqual({
      kind: "error",
      text: "Ya hay un tipo que se reemplaza como LEGAJO, y en el documento no se distinguirían. Elegí otro nombre.",
    });
    const base = evaluateTypeForm(ID, fields("Mujer"), [], "AR");
    expect(base.slot.kind).toBe("error");
  });

  it("una versión corta inválida muestra cuál es", () => {
    const result = evaluateTypeForm(ID, fields("Legajo", "ab cd"), [], "AR");
    expect(result.slot.kind === "error" && result.slot.text).toContain("«ab cd»");
  });

  it("la nota al pie depende del alcance", () => {
    expect(typeFormNote("saved")).toBe(TYPE_FORM_COPY.noteSaved);
    expect(typeFormNote("saved")).toContain("próximos documentos");
    expect(typeFormNote("document")).toBe("Este tipo es solo de este documento.");
  });
});
