/**
 * La tabla de textos de falla (`UX_Guidelines.md` §11b.16): todo código que
 * llega a la interfaz tiene un texto, con el dato concreto que choca y qué
 * hacer, y los números salen de las constantes de `Contracts.md` §6.
 */

import {
  EntityType,
  FORMAT_MAX_CONTEXT,
  FORMAT_MAX_PIECES,
  FORMAT_MAX_REPEAT,
  FORMAT_MAX_TEXT,
  FORMAT_MAX_VARIANTS,
  USER_TYPE_NAME_MAX,
  validateFormatsFile,
  type FormatDefinition,
  type FormatIssue,
  type FormatIssueCode,
  type FormatPiece,
  type FormatsFileIssueCode,
  type UserEntityTypeDefinition,
  type UserEntityTypeIssueCode,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  admittedTypesList,
  BASE_STRUCTURE_LABEL,
  countPieces,
  deletedFormatToast,
  deletedSavedTypeToast,
  describeFilePath,
  EDIT_BASE_TOOLTIP,
  EDIT_OWN_TOOLTIP,
  FORMAT_EXAMPLE_TOOLTIP,
  IMPORT_REJECTION_HINTS,
  IMPORT_SUMMARY_FOOTNOTE,
  importedTypeDetail,
  importRejectionHint,
  importSummaryLead,
  mergedFormatDetail,
  partialTypeNote,
  restoredFormatToast,
  SECTION_HINTS,
  describeFormatsFileIssues,
  entityTypeName,
  formatIssueReason,
  formatIssueText,
  formatsFileIssueText,
  pieceAtPreorder,
  shortenQuoted,
  userTypeIssueReason,
  userTypeIssueText,
} from "../components/formats/formatTexts.js";

import { userFormat, userType, uuid } from "./helpers/detectionFixtures.js";

// Los `Record` obligan a listar todos los códigos: si el Core suma uno, esto no compila.
const TYPE_CODES: Readonly<Record<UserEntityTypeIssueCode, true>> = {
  name_empty: true,
  name_too_long: true,
  name_invalid_chars: true,
  name_without_letter: true,
  short_label_invalid: true,
  label_taken: true,
  id_invalid: true,
  id_taken: true,
};
const FORMAT_CODES: Readonly<Record<FormatIssueCode, true>> = {
  name_empty: true,
  name_too_long: true,
  name_taken: true,
  no_variants: true,
  too_many_variants: true,
  variant_empty: true,
  variant_without_chars: true,
  too_many_pieces: true,
  chars_range_invalid: true,
  chars_repeat_too_large: true,
  text_empty: true,
  text_too_long: true,
  separator_empty: true,
  optional_empty: true,
  optional_nested: true,
  context_empty: true,
  context_too_long: true,
  too_many_context_words: true,
  too_many_states: true,
  type_unknown: true,
  type_not_admitted: true,
  id_invalid: true,
};
const FILE_CODES: Readonly<Record<FormatsFileIssueCode, true>> = {
  not_json: true,
  wrong_kind: true,
  version_invalid: true,
  version_newer: true,
  schema_invalid: true,
  type_invalid: true,
  format_invalid: true,
  format_type_missing: true,
};

const digits = (min: number, max: number): FormatPiece => ({
  kind: "chars",
  charClass: "digit",
  min,
  max,
});

describe("textos de tipos propios", () => {
  const type: UserEntityTypeDefinition = {
    id: `user:${uuid(0)}`,
    name: "Historia clínica",
  };

  it("todo código tiene un texto que dice qué hacer y nunca muestra el código", () => {
    for (const code of Object.keys(TYPE_CODES) as UserEntityTypeIssueCode[]) {
      const text = userTypeIssueText(code, type);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain(code);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  it("dice el dato concreto que choca", () => {
    expect(userTypeIssueText("name_empty", { ...type, name: "" })).toBe(
      "El tipo necesita un nombre. Escribí cómo querés llamarlo, por ejemplo «Historia clínica».",
    );
    const long = { ...type, name: "x".repeat(USER_TYPE_NAME_MAX + 5) };
    expect(userTypeIssueText("name_too_long", long)).toBe(
      `El nombre tiene ${USER_TYPE_NAME_MAX + 5} caracteres y el máximo es 40. Acortalo.`,
    );
    expect(userTypeIssueText("name_invalid_chars", { ...type, name: "Legajo #4" })).toBe(
      "El nombre tiene «#», y solo se admiten letras, números, espacios y guiones. Sacalo o cambialo.",
    );
    expect(userTypeIssueText("name_without_letter", { ...type, name: "1234" })).toContain(
      "necesita al menos una letra",
    );
    expect(
      userTypeIssueText("short_label_invalid", {
        ...type,
        shortLabels: { level1: "AB CD", level2: "OK" },
      }),
    ).toBe(
      "La versión corta «AB CD» tiene que tener de 1 a 8 letras o números, sin espacios ni signos. Corregila, o dejala vacía para usar la automática.",
    );
    expect(
      userTypeIssueText("short_label_invalid", {
        ...type,
        shortLabels: { level2: "toolongvalue" },
      }),
    ).toContain("«toolongval…» tiene que tener de 1 a 8");
    expect(userTypeIssueText("label_taken", type)).toBe(
      "Ya hay un tipo que se reemplaza como HISTORIA CLINICA, y en el documento no se distinguirían. Elegí otro nombre.",
    );
    expect(userTypeIssueText("id_invalid", type)).toBe(
      "Este tipo quedó dañado y no se puede guardar. Crealo de nuevo.",
    );
    expect(userTypeIssueText("id_taken", type)).toBe(
      "Este tipo choca con otro guardado y no se puede guardar. Crealo de nuevo.",
    );
  });

  it("el motivo es el «por qué» en minúscula y sin el «qué hacer»", () => {
    expect(userTypeIssueReason("name_empty", type)).toBe("el tipo necesita un nombre");
    expect(userTypeIssueReason("label_taken", type)).toBe(
      "ya hay un tipo que se reemplaza como HISTORIA CLINICA, y en el documento no se distinguirían",
    );
  });
});

describe("textos de formatos", () => {
  const definition: FormatDefinition = userFormat(0, "Legajo largo", EntityType.Phone, {
    variants: [
      [
        digits(0, 5),
        { kind: "text", value: "x".repeat(45) },
        { kind: "optional", pieces: [digits(1, 99)] },
      ],
      [],
    ],
    contextBefore: ["a", "palabra".repeat(8), ""],
  });

  function text(code: FormatIssueCode, issue: Partial<FormatIssue> = {}): string {
    return formatIssueText({ code, ...issue }, definition, []);
  }

  it("todo código tiene un texto que dice qué hacer y nunca muestra el código", () => {
    for (const code of Object.keys(FORMAT_CODES) as FormatIssueCode[]) {
      const full = text(code, { variantIndex: 0, pieceIndex: 0 });
      expect(full).not.toContain(code);
      expect(full.endsWith(".")).toBe(true);
      expect(full.length).toBeGreaterThan(20);
    }
  });

  it("los números salen de las constantes, y la variante y la pieza se cuentan desde 1", () => {
    expect(text("too_many_variants")).toContain(
      `hasta ${FORMAT_MAX_VARIANTS} variantes y este tiene 2`,
    );
    expect(text("too_many_pieces", { variantIndex: 0 })).toBe(
      `La variante 1 tiene 4 piezas y el máximo es ${FORMAT_MAX_PIECES}, contando las de las partes opcionales. Juntá bloques o borrá alguna.`,
    );
    expect(text("chars_range_invalid", { variantIndex: 0, pieceIndex: 0 })).toBe(
      "En la pieza 1 de la variante 1, «Cuántos» va de 0 a 5: el mínimo tiene que ser 1 o más y no pasar del máximo. Corregí los números.",
    );
    expect(text("chars_repeat_too_large", { variantIndex: 0, pieceIndex: 3 })).toBe(
      `En la pieza 4 de la variante 1, el máximo es 99 y un bloque admite hasta ${FORMAT_MAX_REPEAT}. Bajalo o partí el dato en dos bloques.`,
    );
    expect(text("text_too_long", { variantIndex: 0, pieceIndex: 1 })).toBe(
      `El texto fijo de la pieza 2 (variante 1) tiene 45 caracteres y el máximo es ${FORMAT_MAX_TEXT}. Acortalo.`,
    );
    expect(text("too_many_context_words")).toContain(
      `hasta ${FORMAT_MAX_CONTEXT} palabras de contexto y este tiene 3`,
    );
    expect(text("context_too_long")).toContain(`tiene ${"palabra".repeat(8).length} caracteres`);
    expect(text("name_too_long")).toContain("El nombre tiene 12 caracteres");
  });

  it("nombra el dato que choca", () => {
    expect(text("name_taken")).toBe(
      "Ya tenés un formato llamado «Legajo lar…». Elegí otro nombre para distinguirlos en la lista.",
    );
    expect(text("variant_empty", { variantIndex: 1 })).toBe(
      "La variante 2 no tiene piezas. Sumá una con «+ Pieza» o borrá la variante.",
    );
    expect(text("optional_empty", { variantIndex: 0 })).toContain("en la variante 1");
    expect(text("optional_nested", { variantIndex: 0 })).toContain("(variante 1)");
    expect(text("separator_empty", { variantIndex: 0, pieceIndex: 2 })).toContain("pieza 3");
    expect(text("text_empty", { variantIndex: 0, pieceIndex: 1 })).toContain("pieza 2");
    expect(text("no_variants")).toBe(
      "El formato no tiene ninguna variante. Sumá una con «+ Variante».",
    );
    expect(text("variant_without_chars", { variantIndex: 0 })).toContain(
      "La variante 1 tiene solo",
    );
  });

  it("el tipo se nombra como la interfaz lo muestra, y `{TIPOS ADMITIDOS}` sale de la lista de admitidos", () => {
    expect(admittedTypesList()).toBe("DNI, CUIT, Teléfono, Matrícula, Patente");
    const email: FormatDefinition = { ...definition, entityType: EntityType.Email };
    expect(formatIssueText({ code: "type_not_admitted" }, email, [])).toBe(
      "A «Email» no se le pueden sumar formatos propios. En «Es un…» elegí DNI, CUIT, Teléfono, Matrícula, Patente o uno de tus tipos.",
    );
    const own = userType(0, "Legajo");
    const ofOwn: FormatDefinition = { ...definition, entityType: own.id };
    expect(formatIssueText({ code: "type_unknown" }, ofOwn, [])).toContain("«sin nombre»");
    expect(formatIssueText({ code: "type_unknown" }, ofOwn, [own])).toContain("«Legajo»");
    expect(entityTypeName(EntityType.Phone, [])).toBe("Teléfono");
  });

  it("el motivo no lleva el «qué hacer» y empieza en minúscula", () => {
    expect(formatIssueReason({ code: "no_variants" }, definition, [])).toBe(
      "el formato no tiene ninguna variante",
    );
  });

  it("con datos que no coinciden con el issue, los números caen a cero sin romper", () => {
    expect(
      formatIssueText(
        { code: "chars_range_invalid", variantIndex: 7, pieceIndex: 7 },
        definition,
        [],
      ),
    ).toContain("va de 0 a 0");
    expect(formatIssueText({ code: "too_many_pieces", variantIndex: 7 }, definition, [])).toContain(
      "tiene 0 piezas",
    );
    expect(
      formatIssueText({ code: "text_too_long", variantIndex: 0, pieceIndex: 0 }, definition, []),
    ).toContain("tiene 0 caracteres");
    const noContext: FormatDefinition = { ...definition, contextBefore: ["a"] };
    expect(formatIssueText({ code: "context_too_long" }, noContext, [])).toContain("«»");
    expect(
      formatIssueText({ code: "too_many_context_words" }, userFormat(0, "Sin contexto"), []),
    ).toContain("tiene 0");
  });
});

describe("valores largos entre « »", () => {
  it("acorta el valor y deja entero el texto que lo rodea", () => {
    expect(shortenQuoted("corto")).toBe("corto");
    expect(shortenQuoted("1234567890")).toBe("1234567890");
    expect(shortenQuoted("12345678901")).toBe("1234567890…");
    expect(shortenQuoted("abcdef", 3)).toBe("abc…");
    expect(shortenQuoted("")).toBe("");
    // Un carácter fuera del plano básico cuenta como uno, no se parte a la mitad.
    expect(shortenQuoted("😀".repeat(11))).toBe(`${"😀".repeat(10)}…`);
  });

  it("la versión corta larga conserva «tiene que tener de 1 a N»", () => {
    const text = userTypeIssueText("short_label_invalid", {
      ...userType(0, "Legajo"),
      shortLabels: { level1: "una versión corta larguísima" },
    });
    expect(text).toContain("«una versió…» tiene que tener de 1 a 8 letras o números");
    expect(text).not.toContain("larguísima");
  });

  it("los nombres largos de formato, tipo y palabra de contexto también se acortan", () => {
    const big = "N".repeat(30);
    const own = userType(0, big);
    const definition: FormatDefinition = {
      ...userFormat(0, big, own.id),
      contextBefore: ["palabra".repeat(8)],
    };
    expect(formatIssueText({ code: "name_taken" }, definition, [own])).toContain(
      `«${"N".repeat(10)}…»`,
    );
    expect(formatIssueText({ code: "type_unknown" }, definition, [own])).toContain(
      `«${"N".repeat(10)}…»`,
    );
    expect(formatIssueText({ code: "context_too_long" }, definition, [])).toContain(
      "«palabrapal…» tiene 56 caracteres",
    );
  });
});

describe("piezas en preorden", () => {
  const variant: ReadonlyArray<FormatPiece> = [
    digits(1, 2),
    { kind: "optional", pieces: [{ kind: "text", value: "x" }, digits(3, 3)] },
    { kind: "separator", chars: ["-"], optional: false },
  ];

  it("cuenta el optional y las piezas de adentro, y las ubica por índice", () => {
    expect(countPieces(variant)).toBe(5);
    expect(pieceAtPreorder(variant, 0)).toEqual(digits(1, 2));
    expect(pieceAtPreorder(variant, 1)?.kind).toBe("optional");
    expect(pieceAtPreorder(variant, 2)).toEqual({ kind: "text", value: "x" });
    expect(pieceAtPreorder(variant, 3)).toEqual(digits(3, 3));
    expect(pieceAtPreorder(variant, 4)?.kind).toBe("separator");
    expect(pieceAtPreorder(variant, 5)).toBeUndefined();
  });
});

describe("textos de un archivo rechazado", () => {
  it("todo código tiene un texto, sin mostrar el código", () => {
    for (const code of Object.keys(FILE_CODES) as FormatsFileIssueCode[]) {
      const full = formatsFileIssueText(code);
      expect(full).not.toContain(code);
      expect(full.length).toBeGreaterThan(20);
    }
    expect(formatsFileIssueText("schema_invalid", "el tipo 2")).toContain(
      "el tipo 2 no tiene la forma esperada",
    );
  });

  it("textos fijos, textuales", () => {
    expect(formatsFileIssueText("not_json")).toBe(
      "No se pudo leer el archivo: está dañado o no es un archivo de formatos. Elegí otro archivo.",
    );
    expect(formatsFileIssueText("wrong_kind")).toBe(
      "El archivo no es de formatos de Anonly. Elegí uno exportado desde «Exportar formatos».",
    );
    expect(formatsFileIssueText("version_newer")).toContain(
      "Actualizá Anonly y volvé a importarlo.",
    );
    expect(formatsFileIssueText("version_invalid")).toContain("no dice de qué versión es");
  });

  it("la ubicación se dice en palabras, nunca con el path crudo", () => {
    expect(describeFilePath("types[1]")).toBe("el tipo 2");
    expect(describeFilePath("formats[2]")).toBe("el formato 3");
    expect(describeFilePath("catalogRefs[0]")).toBe("la referencia 1");
    expect(describeFilePath("types")).toBe("la lista de tipos");
    expect(describeFilePath("formats")).toBe("la lista de formatos");
    expect(describeFilePath("catalogRefs")).toBe("la lista de referencias");
    expect(describeFilePath("version")).toBe("el archivo");
    expect(describeFilePath(undefined)).toBe("el archivo");
  });

  function file(content: object): string {
    return JSON.stringify({
      kind: "anonly-formats",
      version: 1,
      types: [],
      formats: [],
      catalogRefs: [],
      ...content,
    });
  }

  function messages(text: string): ReadonlyArray<string> {
    const validation = validateFormatsFile(text, "AR");
    if (validation.ok) throw new Error("se esperaba un rechazo");
    return describeFormatsFileIssues(text, validation.issues, "AR");
  }

  it("un tipo inválido dice cuál es y por qué, con el motivo del Core", () => {
    const text = file({
      types: [
        { id: `user:${uuid(0)}`, name: "Legajo" },
        { id: `user:${uuid(1)}`, name: "legajo" },
      ],
    });
    expect(messages(text)).toEqual([
      "El tipo «Legajo» del archivo no se puede crear: ya hay un tipo que se reemplaza como LEGAJO, y en el documento no se distinguirían. Corregilo donde se creó y exportalo de nuevo.",
      "El tipo «legajo» del archivo no se puede crear: ya hay un tipo que se reemplaza como LEGAJO, y en el documento no se distinguirían. Corregilo donde se creó y exportalo de nuevo.",
    ]);
  });

  it("un formato inválido dice cuál es y el motivo de su primer código", () => {
    const text = file({
      formats: [userFormat(0, "Sin variantes", EntityType.Phone, { variants: [] })],
    });
    expect(messages(text)).toEqual([
      "El formato «Sin variantes» del archivo tiene un problema: el formato no tiene ninguna variante. Corregilo donde se creó y exportalo de nuevo.",
    ]);
  });

  it("un formato de un tipo que no viene en el archivo lo dice sin pedir un motivo", () => {
    const text = file({ formats: [userFormat(0, "Huérfano", userType(3, "Otro").id)] });
    expect(messages(text)).toEqual([
      "El formato «Huérfano» es de un tipo que no viene en el archivo. Exportalo de nuevo junto con su tipo.",
    ]);
  });

  it("un archivo mal formado dice dónde, en palabras", () => {
    expect(messages(file({ types: [5] }))).toEqual([
      "El archivo está incompleto o se modificó a mano: el tipo 1 no tiene la forma esperada. Exportalo de nuevo desde Anonly.",
    ]);
    expect(messages("no es json")).toEqual([formatsFileIssueText("not_json")]);
    expect(messages(JSON.stringify({ kind: "otro" }))).toEqual([
      formatsFileIssueText("wrong_kind"),
    ]);
  });

  it("sin el texto del archivo a mano, el motivo cae a una frase genérica", () => {
    const issues = [
      { code: "type_invalid", path: "types[9]" },
      { code: "format_invalid", path: "formats[9]" },
    ] as const;
    expect(describeFormatsFileIssues("{}", issues, "AR")).toEqual([
      "El tipo «sin nombre» del archivo no se puede crear: no cumple lo que pide un tipo. Corregilo donde se creó y exportalo de nuevo.",
      "El formato «sin nombre» del archivo tiene un problema: no cumple lo que pide un formato. Corregilo donde se creó y exportalo de nuevo.",
    ]);
    expect(describeFormatsFileIssues("no es json", issues, "AR")).toHaveLength(2);
    expect(describeFormatsFileIssues("[]", issues, "AR")).toHaveLength(2);
  });
});

describe("textos de «Formatos de detección» (pasada de textos F7)", () => {
  it("las etiquetas, aclaraciones y tooltips de la lista", () => {
    expect(BASE_STRUCTURE_LABEL).toBe("Del catálogo · se edita como copia");
    expect(SECTION_HINTS.own).toBe("Los creaste vos: se pueden editar y borrar");
    expect(SECTION_HINTS.catalog).toContain("Vienen con Anonly, para Argentina");
    expect(FORMAT_EXAMPLE_TOOLTIP).toBe("Ejemplo de lo que reconoce");
    expect(EDIT_BASE_TOOLTIP).toBe("Editar: se edita una copia; el original queda guardado");
    expect(EDIT_OWN_TOOLTIP).toBe("Editar el formato");
  });

  it("los avisos de restaurar, borrar un formato y borrar un tipo", () => {
    expect(restoredFormatToast("DNI")).toEqual({
      title: "Volvió el formato original «DNI»",
      description: "Se borró tu copia editada.",
    });
    expect(deletedFormatToast("Legajo")).toEqual({
      title: "Se borró el formato «Legajo»",
      description: "Se aplica cuando guardes.",
    });
    expect(deletedSavedTypeToast("Legajo", 2).description).toBe(
      "Con sus 2 formatos. Se aplica cuando guardes.",
    );
    expect(deletedSavedTypeToast("Legajo", 1).description).toBe(
      "Con su formato. Se aplica cuando guardes.",
    );
    expect(deletedSavedTypeToast("Legajo", 0).description).toBe("Se aplica cuando guardes.");
  });

  it("exportar e importar", () => {
    expect(partialTypeNote(1, 3)).toBe("Va con 1 de 3");
    expect(importSummaryLead("formatos.anonly-formatos")).toBe(
      "De formatos.anonly-formatos. Todo llega prendido y se aplica cuando guardes.",
    );
    expect(importedTypeDetail(2)).toBe("tipo nuevo · 2 formatos");
    expect(importedTypeDetail(1)).toBe("tipo nuevo · 1 formato");
    expect(importedTypeDetail(0)).toBe("tipo nuevo");
    expect(mergedFormatDetail("HC de guardia")).toBe("suma «HC de guardia»");
    expect(IMPORT_SUMMARY_FOOTNOTE).toBe("Cada formato se puede apagar o borrar desde la lista.");
  });

  it("la línea gris del rechazo según qué falló", () => {
    expect(importRejectionHint(["wrong_kind"])).toBe(IMPORT_REJECTION_HINTS.notAnonly);
    expect(importRejectionHint(["not_json"])).toBe(IMPORT_REJECTION_HINTS.notAnonly);
    expect(importRejectionHint(["format_invalid"])).toBe(IMPORT_REJECTION_HINTS.invalid);
    expect(importRejectionHint(["version_newer"])).toBeNull();
  });
});
