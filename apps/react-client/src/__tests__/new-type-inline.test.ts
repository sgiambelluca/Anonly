/**
 * «Nuevo tipo» en línea del `EntityTypePicker` (`Components.md` §13b.7, ADR-229 §2):
 * la validación del nombre, la vista previa de la etiqueta y las transiciones de la
 * elección que comparten los cuatro contenedores.
 */

import { EntityType } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  confirmLabel,
  createNewTypeDefinition,
  evaluateNewType,
  previewOfNewType,
} from "../components/entities/newTypeInline.js";
import {
  chooseType,
  editNewType,
  evaluateChoice,
  initialChoice,
  resolveChoice,
} from "../components/entities/typeChoice.js";

import { userType, uuid } from "./helpers/detectionFixtures.js";

const legajo = userType(0, "Legajo");

describe("evaluateNewType", () => {
  it("un nombre válido deja confirmar y muestra cómo se va a reemplazar", () => {
    const result = evaluateNewType({ name: "Número de afiliado" }, [], "AR");
    expect(result).toEqual({ error: null, canSubmit: true, preview: "[NUMERO DE AFILIADO 01]" });
  });

  it("sin nombre todavía no hay error que mostrar, pero no se puede confirmar", () => {
    expect(evaluateNewType({ name: "" }, [], "AR")).toEqual({
      error: null,
      canSubmit: false,
      preview: "",
    });
    expect(evaluateNewType({ name: "   " }, [], "AR").error).toBeNull();
  });

  it("un nombre repetido dice por qué, en la línea de pie, y apaga el botón", () => {
    const result = evaluateNewType({ name: "legajo" }, [legajo], "AR");
    expect(result.canSubmit).toBe(false);
    expect(result.error).toBeTypeOf("string");
    expect(result.error).not.toBe("");
  });

  it("un nombre que ya es el de un tipo del catálogo se rechaza", () => {
    const result = evaluateNewType({ name: "Teléfono" }, [], "AR");
    expect(result.canSubmit).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("previewOfNewType normaliza la etiqueta (mayúsculas, sin tildes)", () => {
    expect(previewOfNewType({ name: "historia clínica" })).toBe("[HISTORIA CLINICA 01]");
    expect(previewOfNewType({ name: "" })).toBe("");
  });
});

describe("createNewTypeDefinition", () => {
  it("arma la definición con un id nuevo y sin versiones cortas (se arman solas)", () => {
    const definition = createNewTypeDefinition({ name: "  Legajo interno " }, () => uuid(5));
    expect(definition).toEqual({ id: `user:${uuid(5)}`, name: "Legajo interno" });
  });

  it("sin generador de ids usa un UUID de verdad", () => {
    expect(createNewTypeDefinition({ name: "Legajo" }).id).toMatch(
      /^user:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("confirmLabel", () => {
  it("el contenedor decide el botón", () => {
    expect(confirmLabel("Agregar", false, "agregar")).toBe("Agregar");
    expect(confirmLabel("Agregar", true, "agregar")).toBe("Crear y agregar");
    expect(confirmLabel("Cambiar tipo", true, "cambiar")).toBe("Crear y cambiar");
  });
});

describe("la elección de tipo", () => {
  it("arranca en el tipo dado y sin campo de tipo nuevo", () => {
    expect(initialChoice(EntityType.Person)).toEqual({ value: EntityType.Person, newType: null });
  });

  it("elegir un tipo existente cierra el campo de «Nuevo tipo»", () => {
    const editing = editNewType(
      initialChoice(EntityType.Person),
      { name: "Leg" },
      EntityType.Person,
    );
    expect(editing).toEqual({ value: "new", newType: { name: "Leg" } });
    expect(chooseType(editing, EntityType.Address)).toEqual({
      value: EntityType.Address,
      newType: null,
    });
  });

  it("descartar el tipo nuevo vuelve al tipo con el que se abrió", () => {
    const editing = editNewType(initialChoice(EntityType.DNI), { name: "x" }, EntityType.DNI);
    expect(editNewType(editing, null, EntityType.DNI)).toEqual({
      value: EntityType.DNI,
      newType: null,
    });
  });

  it("descartar sin haber elegido «Nuevo tipo» conserva la elección", () => {
    const state = chooseType(initialChoice(EntityType.Person), EntityType.Email);
    expect(editNewType(state, null, EntityType.Person)).toEqual({
      value: EntityType.Email,
      newType: null,
    });
  });

  it("resolveChoice con un tipo existente no crea nada", () => {
    expect(resolveChoice(initialChoice(EntityType.Email), [], "AR")).toEqual({
      entityType: EntityType.Email,
    });
  });

  it("resolveChoice con «Nuevo tipo» válido trae la definición y su id como tipo", () => {
    const state = editNewType(
      initialChoice(EntityType.Person),
      { name: "Legajo interno" },
      EntityType.Person,
    );
    const resolved = resolveChoice(state, [], "AR", () => uuid(7));
    expect(resolved?.newType).toEqual({ id: `user:${uuid(7)}`, name: "Legajo interno" });
    expect(resolved?.entityType).toBe(`user:${uuid(7)}`);
  });

  it("resolveChoice con un nombre inválido o vacío no resuelve", () => {
    const empty = editNewType(initialChoice(EntityType.Person), { name: "" }, EntityType.Person);
    expect(resolveChoice(empty, [], "AR")).toBeNull();
    const repeated = editNewType(
      initialChoice(EntityType.Person),
      { name: "Legajo" },
      EntityType.Person,
    );
    expect(resolveChoice(repeated, [legajo], "AR")).toBeNull();
    // «new» sin campo (estado inconsistente): tampoco.
    expect(resolveChoice({ value: "new", newType: null }, [], "AR")).toBeNull();
  });

  it("evaluateChoice solo evalúa cuando hay un campo de tipo nuevo", () => {
    expect(evaluateChoice(initialChoice(EntityType.Person), [], "AR")).toBeNull();
    const editing = editNewType(
      initialChoice(EntityType.Person),
      { name: "Legajo" },
      EntityType.Person,
    );
    expect(evaluateChoice(editing, [legajo], "AR")?.canSubmit).toBe(false);
  });
});
