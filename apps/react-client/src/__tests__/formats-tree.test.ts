/**
 * El modelo del árbol de «Formatos de detección» (`Components.md` §13b.2) y el
 * texto de la tarjeta de `LoadScreen` (§13b.1).
 */

import { EntityType, getCatalog } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  buildFormatsTree,
  describeCounts,
  describeDetectionCard,
  describePendingChanges,
  formatsOfType,
  summarizeBand,
  type FormatRowModel,
  type FormatsTreeModel,
} from "../components/formats/formatsTree.js";
import { DEFAULT_DETECTION_STATE } from "../store/detectionState.js";

import { stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";

function section(tree: FormatsTreeModel, id: "own" | "catalog" | "fixed") {
  const found = tree.sections.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`falta la sección ${id}`);
  return found;
}

function band(tree: FormatsTreeModel, id: "own" | "catalog" | "fixed", name: string) {
  const found = section(tree, id).bands.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`falta la banda ${name}`);
  return found;
}

describe("buildFormatsTree", () => {
  it("sin nada propio: «Tus tipos» está vacía y las otras dos traen el catálogo", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "");
    expect(tree.sections.map((s) => s.id)).toEqual(["own", "catalog", "fixed"]);
    expect(section(tree, "own").bands).toEqual([]);
    expect(section(tree, "catalog").bands.map((b) => b.name)).toEqual([
      "DNI",
      "CUIT",
      "Teléfonos",
      "Matrículas",
      "Patentes",
    ]);
    expect(section(tree, "fixed").bands.map((b) => b.name)).toEqual([
      "Personas",
      "Direcciones",
      "Emails",
      "IBAN",
      "Tarjetas de crédito",
      "Fechas",
    ]);
    expect(tree.hasResults).toBe(true);
  });

  it("toda fila base del catálogo del país aparece una vez, con su ejemplo", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "");
    const rows = tree.sections.flatMap((s) => s.bands.flatMap((b) => b.rows));
    expect(rows.map((row) => row.id).sort()).toEqual(
      getCatalog("AR")
        .map((i) => i.id)
        .sort(),
    );
    for (const row of rows) expect(row.example).not.toBe("");
    expect(tree.counts).toEqual({ on: rows.length, off: 0, own: 0 });
  });

  it("solo los tipos que admiten formatos ofrecen «Nuevo formato»", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "");
    expect(section(tree, "catalog").bands.every((b) => b.admitsFormats)).toBe(true);
    expect(section(tree, "fixed").bands.some((b) => b.admitsFormats)).toBe(false);
  });

  it("las etiquetas y qué se puede hacer con cada fila base", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "");
    const dni: FormatRowModel | undefined = band(tree, "catalog", "DNI").rows[0];
    expect(dni).toMatchObject({
      id: "dni-ar",
      source: "base",
      tag: "Del catálogo",
      canEdit: true,
      canRestore: false,
      canDelete: false,
      enabled: true,
    });
    const cuit = band(tree, "catalog", "CUIT").rows[0];
    expect(cuit).toMatchObject({ tag: "Con control", canEdit: false });
  });

  it("un formato base apagado se muestra apagado y cuenta como apagado", () => {
    const tree = buildFormatsTree(stateWith({ disabledBaseFormats: { AR: ["dni-ar"] } }), "");
    expect(band(tree, "catalog", "DNI").rows[0]?.enabled).toBe(false);
    expect(band(tree, "catalog", "DNI").summary).toBe("1 formato · 1 apagado");
    expect(tree.counts.off).toBe(1);
  });

  it("los tipos propios van en «Tus tipos», con sus formatos y el resumen", () => {
    const type = userType(0, "Historia clínica");
    const tree = buildFormatsTree(
      stateWith({
        userTypes: [type, userType(1, "Legajo")],
        userFormats: [
          userFormat(2, "HC larga", type.id),
          userFormat(3, "HC corta", type.id, { enabled: false }),
        ],
      }),
      "",
    );
    const own = section(tree, "own").bands;
    expect(own.map((b) => b.name)).toEqual(["Historia clínica", "Legajo"]);
    expect(own[0]).toMatchObject({
      isUser: true,
      admitsFormats: true,
      summary: "2 formatos · 1 apagado",
    });
    expect(own[0]?.rows[0]).toMatchObject({
      tag: "Tuyo",
      canEdit: true,
      canDelete: true,
      classLabel: "1 variante",
    });
    expect(own[1]?.summary).toBe("Sin formatos");
    expect(tree.counts.own).toBe(2);
  });

  it("un formato propio de un tipo base va en la banda de ese tipo, y una copia editada reemplaza al original", () => {
    const own = userFormat(0, "Teléfono interno", EntityType.Phone);
    const copy = userFormat(1, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" });
    const tree = buildFormatsTree(stateWith({ userFormats: [own, copy] }), "");

    const phone = band(tree, "catalog", "Teléfonos").rows;
    expect(phone.map((row) => row.name)).toContain("Teléfono interno");
    const dni = band(tree, "catalog", "DNI").rows;
    expect(dni).toHaveLength(1);
    expect(dni[0]).toMatchObject({
      id: copy.id,
      tag: "Editado",
      canRestore: true,
      canDelete: false,
      classLabel: "Copia editada de «DNI»",
    });
    expect(tree.counts.own).toBe(2);
  });

  it("una copia cuyo formato base no es del catálogo del país no se muestra: el Core también la descarta", () => {
    const orphan = userFormat(1, "Huérfana", EntityType.DNI, { basedOn: "cl:rut" });
    const tree = buildFormatsTree(stateWith({ userFormats: [orphan] }), "");
    expect(band(tree, "catalog", "DNI").rows.map((row) => row.id)).toEqual(["dni-ar"]);
  });

  it("la búsqueda no distingue mayúsculas ni tildes y mira tipos y formatos", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "TELEFONO");
    expect(tree.sections.map((s) => s.id)).toEqual(["catalog"]);
    // Coincide el nombre del tipo: va la banda entera.
    expect(band(tree, "catalog", "Teléfonos").rows.length).toBeGreaterThan(1);

    const byFormat = buildFormatsTree(DEFAULT_DETECTION_STATE, "mercosur");
    expect(section(byFormat, "catalog").bands.map((b) => b.name)).toEqual(["Patentes"]);
    expect(section(byFormat, "catalog").bands[0]?.rows.map((r) => r.name)).toEqual([
      "Patente Mercosur",
      "Patente Mercosur de moto",
    ]);
    // El conteo es del árbol entero, no de lo filtrado.
    expect(byFormat.counts.on).toBe(getCatalog("AR").length);
  });

  it("una búsqueda sin resultados lo dice, y con búsqueda activa «Tus tipos» no aparece vacía", () => {
    const tree = buildFormatsTree(DEFAULT_DETECTION_STATE, "zzzz");
    expect(tree.hasResults).toBe(false);
    expect(tree.sections).toEqual([]);
  });

  it("la búsqueda encuentra un tipo propio por su nombre", () => {
    const tree = buildFormatsTree(
      stateWith({ userTypes: [userType(0, "Historia clínica")] }),
      "clinica",
    );
    expect(section(tree, "own").bands.map((b) => b.name)).toEqual(["Historia clínica"]);
  });
});

describe("textos del árbol", () => {
  it("el resumen de una banda", () => {
    const row = (enabled: boolean): FormatRowModel => ({
      id: "x",
      source: "user",
      name: "x",
      classLabel: "",
      example: "",
      tag: "Tuyo",
      enabled,
      canEdit: true,
      canRestore: false,
      canDelete: true,
    });
    expect(summarizeBand([])).toBe("Sin formatos");
    expect(summarizeBand([row(true)])).toBe("1 formato");
    expect(summarizeBand([row(true), row(true), row(true)])).toBe("3 formatos");
    expect(summarizeBand([row(true), row(false), row(false)])).toBe("3 formatos · 2 apagados");
  });

  it("el conteo de la barra y el contador del pie", () => {
    expect(describeCounts({ on: 14, off: 1, own: 2 })).toBe("14 prendidos · 1 apagados · 2 tuyos");
    expect(describePendingChanges(0)).toBe("Sin cambios");
    expect(describePendingChanges(1)).toBe("1 cambio sin guardar");
    expect(describePendingChanges(3)).toBe("3 cambios sin guardar");
  });

  it("los formatos que se borran con un tipo", () => {
    const type = userType(0, "Legajo");
    const mine = userFormat(1, "Mío", type.id);
    const state = stateWith({
      userTypes: [type],
      userFormats: [mine, userFormat(2, "Ajeno", EntityType.Phone)],
    });
    expect(formatsOfType(state, type.id)).toEqual([mine]);
  });
});

describe("describeDetectionCard (LoadScreen)", () => {
  it("sin formatos del usuario: el texto de siempre", () => {
    expect(describeDetectionCard(DEFAULT_DETECTION_STATE)).toBe(
      "Formatos de Argentina para DNI y CUIT, y un modelo que reconoce nombres.",
    );
  });

  it("con formatos del usuario: cuenta propios, copias editadas y referencias", () => {
    const own = userFormat(0, "Propio", EntityType.Phone);
    const copy = userFormat(1, "Copia", EntityType.DNI, { basedOn: "dni-ar" });
    expect(describeDetectionCard(stateWith({ userFormats: [own] }))).toBe(
      "Formatos de Argentina, 1 tuyo y un modelo que reconoce nombres.",
    );
    expect(
      describeDetectionCard(
        stateWith({
          userFormats: [own, copy],
          catalogRefs: [{ id: "ref:1", country: "AR", catalogFormatId: "x", enabled: true }],
        }),
      ),
    ).toBe("Formatos de Argentina, 3 tuyos y un modelo que reconoce nombres.");
  });
});
