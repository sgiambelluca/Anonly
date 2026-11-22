/**
 * La parte pura del generador de formatos (ADR-228): mover y arrastrar piezas,
 * agregar, ajustar, «Se lee», límites y el borrador.
 */

import { EntityType, type FormatDefinition, type FormatPiece } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  addContextWord,
  addVariant,
  appendPiece,
  buildDefinition,
  charsKindOf,
  describeVariant,
  exampleOfVariant,
  hasChanges,
  insertAt,
  isExactly,
  lineStarts,
  moveStep,
  moveToSlot,
  newPiece,
  parseCount,
  pieceAt,
  pieceCard,
  pieceHeading,
  BUILDER_COPY,
  pieceCounter,
  removeAt,
  removeContextWord,
  removeVariant,
  replaceAt,
  replaceVariant,
  resolveBuilderSetup,
  samePath,
  sameSlot,
  slotAfter,
  slotBefore,
  stepExactly,
  stepMax,
  stepMin,
  submitChange,
  toExactMode,
  toggleSeparator,
  toRangeMode,
  typeOptions,
  variantCounter,
  withCharsCase,
  withCharsKind,
  withExactly,
  withRange,
  type CharsPiece,
  type PieceClassId,
  type Pieces,
} from "../components/formats/formatBuilderModel.js";
import { DEFAULT_DETECTION_STATE } from "../store/detectionState.js";

import { stateWith, userFormat, userType, uuid } from "./helpers/detectionFixtures.js";

const D: FormatPiece = { kind: "chars", charClass: "digit", min: 2, max: 2 };
const L: FormatPiece = { kind: "chars", charClass: "letter", min: 1, max: 3 };
const T: FormatPiece = { kind: "text", value: "HC-" };
const S: FormatPiece = { kind: "separator", chars: ["-", "."], optional: true };
const opt = (...pieces: FormatPiece[]): FormatPiece => ({ kind: "optional", pieces });

function kinds(variant: Pieces): string {
  return variant
    .map((piece) =>
      piece.kind === "optional"
        ? `[${piece.pieces.map((inner) => inner.kind[0]).join("")}]`
        : (piece.kind[0] ?? ""),
    )
    .join("");
}

describe("lectura y escritura por ruta", () => {
  const variant: Pieces = [D, opt(L, T), S];

  it("pieceAt ubica una pieza de la variante, una de adentro y una que no existe", () => {
    expect(pieceAt(variant, [0])).toBe(D);
    expect(pieceAt(variant, [1, 1])).toBe(T);
    expect(pieceAt(variant, [0, 0])).toBeUndefined();
    expect(pieceAt(variant, [9])).toBeUndefined();
  });

  it("replaceAt y removeAt no tocan el original", () => {
    expect(kinds(replaceAt(variant, [2], T))).toBe("c[ct]t");
    expect(kinds(replaceAt(variant, [1, 0], T))).toBe("c[tt]s");
    expect(kinds(removeAt(variant, [0]))).toBe("[ct]s");
    expect(kinds(removeAt(variant, [1, 0]))).toBe("c[t]s");
    expect(kinds(variant)).toBe("c[ct]s");
  });

  it("insertAt ubica en la variante o dentro de una parte opcional, y acota el índice", () => {
    expect(kinds(insertAt(variant, { parent: null, index: 99 }, T))).toBe("c[ct]st");
    expect(kinds(insertAt(variant, { parent: 1, index: 0 }, S))).toBe("c[sct]s");
    expect(kinds(insertAt([D], { parent: 0, index: 0 }, S))).toBe("c");
  });

  it("compara rutas y lugares, también con null", () => {
    expect(samePath([1], [1])).toBe(true);
    expect(samePath([1, 0], [1])).toBe(false);
    expect(samePath(null, null)).toBe(true);
    expect(samePath(null, [0])).toBe(false);
    expect(sameSlot({ parent: null, index: 1 }, { parent: null, index: 1 })).toBe(true);
    expect(sameSlot(null, { parent: 0, index: 0 })).toBe(false);
    expect(sameSlot(null, null)).toBe(true);
  });

  it("slotBefore y slotAfter", () => {
    expect(slotBefore([2])).toEqual({ parent: null, index: 2 });
    expect(slotAfter([2])).toEqual({ parent: null, index: 3 });
    expect(slotBefore([1, 0])).toEqual({ parent: 1, index: 0 });
    expect(slotAfter([1, 0])).toEqual({ parent: 1, index: 1 });
  });
});

describe("moveToSlot (arrastrar)", () => {
  it("reordena dentro de la variante, hacia adelante y hacia atrás", () => {
    const variant: Pieces = [D, L, T];
    const forward = moveToSlot(variant, [0], { parent: null, index: 3 });
    expect(forward?.variant).toEqual([L, T, D]);
    expect(forward?.path).toEqual([2]);
    const backward = moveToSlot(variant, [2], { parent: null, index: 0 });
    expect(backward?.variant).toEqual([T, D, L]);
    expect(backward?.path).toEqual([0]);
  });

  it("mete una pieza en una parte opcional soltándola sobre su caja", () => {
    const result = moveToSlot([D, opt(L)], [0], { parent: 1, index: 1 });
    expect(kinds(result?.variant ?? [])).toBe("[cc]");
    // La parte opcional quedó en el índice 0 al sacar la pieza que estaba antes.
    expect(result?.path).toEqual([0, 1]);
  });

  it("saca una pieza de una parte opcional soltándola afuera", () => {
    const result = moveToSlot([opt(L, T), S], [0, 1], { parent: null, index: 2 });
    expect(kinds(result?.variant ?? [])).toBe("[c]st");
    expect(result?.path).toEqual([2]);
  });

  it("reordena adentro de la misma parte opcional", () => {
    const result = moveToSlot([opt(L, T, S)], [0, 0], { parent: 0, index: 3 });
    expect(kinds(result?.variant ?? [])).toBe("[tsc]");
    expect(result?.path).toEqual([0, 2]);
  });

  it("una parte opcional no entra en otra ni en sí misma", () => {
    expect(moveToSlot([opt(L), opt(T)], [0], { parent: 1, index: 0 })).toBeNull();
    expect(moveToSlot([opt(L)], [0], { parent: 0, index: 0 })).toBeNull();
  });

  it("una parte opcional entera se arrastra por la variante", () => {
    const result = moveToSlot([opt(L), D], [0], { parent: null, index: 2 });
    expect(kinds(result?.variant ?? [])).toBe("c[c]");
  });

  it("una ruta que no existe no mueve nada", () => {
    expect(moveToSlot([D], [5], { parent: null, index: 0 })).toBeNull();
  });
});

describe("moveStep (botones «Mover»)", () => {
  it("intercambia con la vecina", () => {
    expect(moveStep([D, L], [0], 1)?.variant).toEqual([L, D]);
    expect(moveStep([D, L], [1], -1)?.variant).toEqual([L, D]);
  });

  it("en los extremos no hay más lugar", () => {
    expect(moveStep([D, L], [0], -1)).toBeNull();
    expect(moveStep([D, L], [1], 1)).toBeNull();
    expect(moveStep([D], [3], 1)).toBeNull();
  });

  it("una pieza que se acerca a una parte opcional entra, la recorre y sale del otro lado", () => {
    let current: Pieces = [D, opt(L)];
    let path: readonly [number] | readonly [number, number] = [0];
    const trail: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const step = moveStep(current, path, 1);
      expect(step).not.toBeNull();
      current = step?.variant ?? current;
      path = step?.path ?? path;
      trail.push(kinds(current));
    }
    expect(trail).toEqual(["[cc]", "[cc]", "[c]c"]);
  });

  it("hacia la izquierda entra por el final de la parte opcional y sale por el principio", () => {
    const entered = moveStep([opt(L, T), D], [1], -1);
    expect(kinds(entered?.variant ?? [])).toBe("[ctc]");
    expect(entered?.path).toEqual([0, 2]);
    const exited = moveStep([D, opt(L)], [1, 0], -1);
    expect(kinds(exited?.variant ?? [])).toBe("cc[]");
    expect(exited?.path).toEqual([1]);
  });

  it("una parte opcional salta por encima de sus vecinas, aunque sean opcionales", () => {
    const result = moveStep([opt(L), opt(T)], [0], 1);
    expect(kinds(result?.variant ?? [])).toBe("[t][c]");
  });

  it("da el mismo resultado que arrastrar al mismo lugar", () => {
    const variant: Pieces = [D, L, T];
    expect(moveStep(variant, [0], 1)).toEqual(moveToSlot(variant, [0], { parent: null, index: 2 }));
  });
});

describe("agregar piezas", () => {
  it("cada clase del menú arma su pieza", () => {
    const ids: ReadonlyArray<PieceClassId> = [
      "digits",
      "letters",
      "alnum",
      "separator",
      "text",
      "optional",
    ];
    expect(ids.map((id) => newPiece(id).kind)).toEqual([
      "chars",
      "chars",
      "chars",
      "separator",
      "text",
      "optional",
    ]);
    expect(newPiece("alnum")).toMatchObject({ charClass: "alnum" });
  });

  it("appendPiece suma al final de la variante o de la parte opcional", () => {
    const root = appendPiece([D], T, null);
    expect(root.path).toEqual([1]);
    const inside = appendPiece([opt(L)], T, 0);
    expect(inside.path).toEqual([0, 1]);
    expect(kinds(inside.variant)).toBe("[ct]");
    // Una parte opcional inexistente: queda sin cambios.
    expect(appendPiece([D], T, 4).variant).toEqual([D]);
  });
});

describe("ajuste de un bloque", () => {
  const digits: CharsPiece = { kind: "chars", charClass: "digit", min: 2, max: 2 };

  it("«Qué va» y «Escritas»", () => {
    expect(charsKindOf("upper")).toBe("letter");
    expect(charsKindOf("alnum")).toBe("alnum");
    expect(withCharsKind(digits, "digit")).toBe(digits);
    expect(withCharsKind(digits, "letter").charClass).toBe("letter");
    expect(withCharsKind(digits, "alnum").charClass).toBe("alnum");
    expect(withCharsCase({ ...digits, charClass: "letter" }, "upper").charClass).toBe("upper");
  });

  it("«Cuántos»: exactamente y entre", () => {
    expect(isExactly(digits)).toBe(true);
    expect(withExactly(digits, 5)).toMatchObject({ min: 5, max: 5 });
    expect(withRange(digits, 1, 4)).toMatchObject({ min: 1, max: 4 });
    expect(toRangeMode(digits, 64)).toMatchObject({ min: 2, max: 3 });
    expect(toRangeMode({ ...digits, min: 64, max: 64 }, 64)).toMatchObject({ min: 63, max: 64 });
    expect(toRangeMode({ ...digits, min: 1, max: 1 }, 1)).toMatchObject({ min: 1, max: 1 });
    const range = withRange(digits, 1, 4);
    expect(toRangeMode(range, 64)).toBe(range);
    expect(toExactMode(range)).toMatchObject({ min: 1, max: 1 });
    expect(toExactMode(digits)).toBe(digits);
  });

  it("parseCount toma un número o 0", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount("")).toBe(0);
    expect(parseCount("x")).toBe(0);
  });

  it("toggleSeparator mantiene el orden canónico", () => {
    expect(toggleSeparator(["-"], " ")).toEqual([" ", "-"]);
    expect(toggleSeparator([" ", "-", "/"], "-")).toEqual([" ", "/"]);
    expect(toggleSeparator(["-"], "-")).toEqual([]);
  });
});

describe("la ficha de una pieza", () => {
  it("dice qué es, cuánto o cuál, y un ejemplo", () => {
    expect(pieceCard(D)).toEqual({ title: "Dígitos", detail: "Exactamente 2", example: "12" });
    expect(pieceCard(L)).toMatchObject({ title: "Letras", detail: "Entre 1 y 3" });
    expect(pieceCard({ ...D, charClass: "upper" }).detail).toBe("Exactamente 2 · MAYÚSCULAS");
    expect(pieceCard({ ...D, charClass: "lower" }).detail).toBe("Exactamente 2 · minúsculas");
    expect(pieceCard({ ...D, charClass: "alnum" }).title).toBe("Letras o dígitos");
    expect(pieceCard(S)).toEqual({ title: "Separador", detail: "Puede faltar", example: "- ." });
    expect(pieceCard({ kind: "separator", chars: [" "], optional: false })).toMatchObject({
      detail: "Siempre está",
      example: "␣",
    });
    expect(pieceCard(T)).toEqual({ title: "Texto fijo", detail: "Siempre igual", example: "HC-" });
    expect(pieceCard(opt(D))).toMatchObject({ title: "Parte opcional", example: "12" });
  });
});

describe("renglones y límites", () => {
  it("lineStarts marca las piezas que empiezan un renglón", () => {
    expect(lineStarts([0, 0, 0])).toEqual([]);
    expect(lineStarts([0, 0, 40, 40, 80])).toEqual([2, 4]);
    expect(lineStarts([])).toEqual([]);
    expect(lineStarts([10, 10.5])).toEqual([]);
  });

  it("los contadores aparecen solo cerca del tope (8 variantes, 16 piezas)", () => {
    expect(variantCounter(3).visible).toBe(false);
    expect(variantCounter(6)).toEqual({ visible: true, text: "6 de 8 variantes", atLimit: false });
    expect(variantCounter(8).atLimit).toBe(true);
    const many: Pieces = Array.from({ length: 12 }, () => D);
    expect(pieceCounter(many).visible).toBe(false);
    const nearly: Pieces = [...many, opt(D, D)];
    expect(pieceCounter(nearly)).toMatchObject({ visible: true, text: "15 de 16 piezas" });
    expect(pieceCounter([...nearly, D]).atLimit).toBe(true);
  });
});

describe("«Se lee» y «Ejemplo»", () => {
  it("dice la variante en palabras", () => {
    expect(describeVariant([], [])).toBe("Todavía no tiene piezas.");
    expect(describeVariant([D, S, L], [])).toBe(
      "2 dígitos, un guion o punto (puede faltar), de 1 a 3 letras.",
    );
    expect(describeVariant([{ ...D, min: 1, max: 1 }], [])).toBe("1 dígito.");
    expect(describeVariant([T, opt(D)], [])).toBe("El texto «HC-», (opcional: 2 dígitos).");
  });

  it("nombra cada clase de letra y los separadores", () => {
    const text = describeVariant(
      [
        { kind: "chars", charClass: "upper", min: 1, max: 1 },
        { kind: "chars", charClass: "lower", min: 2, max: 2 },
        { kind: "chars", charClass: "alnum", min: 1, max: 2 },
        { kind: "separator", chars: [], optional: false },
        { kind: "separator", chars: [" ", "-", "/"], optional: false },
        opt(),
      ],
      [],
    );
    expect(text).toBe(
      "1 letra mayúscula, 2 letras minúsculas, de 1 a 2 letras o dígitos, un separador sin elegir, un espacio, guion o barra, una parte opcional vacía.",
    );
  });

  it("incluye las palabras de contexto", () => {
    expect(describeVariant([D], ["legajo"])).toBe("Después de «legajo»: 2 dígitos.");
    expect(describeVariant([D], ["legajo", "leg."])).toBe(
      "Después de «legajo» o «leg.»: 2 dígitos.",
    );
    expect(describeVariant([D], ["a", "b", "c"])).toBe("Después de «a», «b» o «c»: 2 dígitos.");
    expect(describeVariant([D], ["  "])).toBe("2 dígitos.");
  });

  it("el ejemplo se arma con las piezas de la variante pedida", () => {
    const definition = userFormat(0, "X");
    expect(exampleOfVariant([T, D], definition)).toBe("HC-12");
    expect(exampleOfVariant([], definition)).toBe("");
  });
});

describe("palabras de contexto", () => {
  it("suma recortada, sin repetir y hasta el tope", () => {
    expect(addContextWord([], "  legajo ", 5)).toEqual(["legajo"]);
    expect(addContextWord(["legajo"], "LEGAJO", 5)).toEqual(["legajo"]);
    expect(addContextWord([], "   ", 5)).toEqual([]);
    expect(addContextWord(["a"], "b", 1)).toEqual(["a"]);
    expect(removeContextWord(["a", "b"], 0)).toEqual(["b"]);
  });
});

describe("variantes", () => {
  it("suma, reemplaza y borra, pero nunca deja cero", () => {
    expect(addVariant([[D]])).toEqual([[D], []]);
    expect(replaceVariant([[D], [L]], 1, [T])).toEqual([[D], [T]]);
    expect(removeVariant([[D], [L]], 0)).toEqual([[L]]);
    expect(removeVariant([[D]], 0)).toEqual([[D]]);
  });
});

describe("el borrador y el pedido", () => {
  const ids = (): string => uuid(3);

  it("un formato nuevo arranca vacío, en el tipo de la banda", () => {
    const setup = resolveBuilderSetup(
      { kind: "create", entityType: EntityType.Phone },
      DEFAULT_DETECTION_STATE,
      ids,
    );
    expect(setup).toMatchObject({
      mode: "create",
      title: "Nuevo formato",
      submitLabel: "Crear formato",
      id: `fmt:${uuid(3)}`,
      typeLocked: false,
      notice: null,
    });
    expect(setup?.draft).toEqual({
      name: "",
      entityType: EntityType.Phone,
      variants: [[]],
      context: [],
    });
  });

  it("editar uno propio conserva su id y su estado; una copia editada fija el tipo", () => {
    const own = userFormat(1, "Legajo", EntityType.Phone, { enabled: false });
    const copy = userFormat(2, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" });
    const state = stateWith({ userFormats: [own, copy] });
    const editOwn = resolveBuilderSetup({ kind: "edit", formatId: own.id }, state, ids);
    expect(editOwn).toMatchObject({
      mode: "edit",
      title: "Editar «Legajo»",
      submitLabel: "Guardar cambios",
      id: own.id,
      enabled: false,
      typeLocked: false,
    });
    const editCopy = resolveBuilderSetup({ kind: "edit", formatId: copy.id }, state, ids);
    expect(editCopy).toMatchObject({ typeLocked: true, basedOn: "dni-ar", notice: null });
    expect(resolveBuilderSetup({ kind: "edit", formatId: "fmt:nada" }, state, ids)).toBeNull();
  });

  it("editar uno base de pura forma arma una copia con aviso, id nuevo y basedOn", () => {
    const setup = resolveBuilderSetup(
      { kind: "editBase", catalogId: "dni-ar" },
      DEFAULT_DETECTION_STATE,
      ids,
    );
    expect(setup).toMatchObject({
      mode: "copy",
      submitLabel: "Guardar copia",
      id: `fmt:${uuid(3)}`,
      basedOn: "dni-ar",
      typeLocked: true,
      enabled: true,
    });
    expect(setup?.notice).toContain("el original se apaga");
    expect(setup?.draft.variants.length).toBeGreaterThan(0);
    // Un formato con control no se edita; uno que no existe tampoco.
    expect(
      resolveBuilderSetup({ kind: "editBase", catalogId: "email" }, DEFAULT_DETECTION_STATE, ids),
    ).toBeNull();
    expect(
      resolveBuilderSetup({ kind: "editBase", catalogId: "nada" }, DEFAULT_DETECTION_STATE, ids),
    ).toBeNull();
  });

  it("buildDefinition solo pone contextBefore y basedOn si hay, y recorta el nombre", () => {
    const setup = resolveBuilderSetup(
      { kind: "create", entityType: EntityType.Phone },
      DEFAULT_DETECTION_STATE,
      ids,
    );
    if (setup === null) throw new Error("setup");
    const plain = buildDefinition({ ...setup.draft, name: "  Mi formato " }, setup);
    expect(plain.name).toBe("Mi formato");
    expect("contextBefore" in plain).toBe(false);
    expect("basedOn" in plain).toBe(false);
    const withContext = buildDefinition({ ...setup.draft, context: ["leg"] }, setup);
    expect(withContext.contextBefore).toEqual(["leg"]);
    expect(buildDefinition(setup.draft, { ...setup, basedOn: "dni-ar" }).basedOn).toBe("dni-ar");
  });

  it("submitChange elige el cambio según el caso", () => {
    const definition: FormatDefinition = userFormat(1, "X");
    const base = {
      title: "",
      submitLabel: "",
      draft: { name: "", entityType: EntityType.Phone, variants: [[]], context: [] },
      id: definition.id,
      enabled: true,
      typeLocked: false,
      notice: null,
    } as const;
    expect(submitChange({ ...base, mode: "create" }, definition).kind).toBe("createFormat");
    expect(submitChange({ ...base, mode: "edit" }, definition).kind).toBe("editFormat");
    expect(submitChange({ ...base, mode: "copy" }, definition).kind).toBe("createEditedCopy");
  });

  it("hasChanges compara el borrador con el inicial", () => {
    const draft = { name: "a", entityType: EntityType.Phone, variants: [[D]], context: [] };
    expect(hasChanges(draft, { ...draft })).toBe(false);
    expect(hasChanges(draft, { ...draft, name: "b" })).toBe(true);
  });

  it("«Es un…» lista los tipos del usuario y los base que admiten formatos", () => {
    const legajo = userType(1, "Legajo");
    const options = typeOptions([legajo], EntityType.DNI);
    expect(options[0]).toMatchObject({ value: legajo.id, label: "Legajo" });
    const baseLabels = options.slice(1).map((option) => option.label);
    expect(baseLabels).toEqual(expect.arrayContaining(["DNI", "CUIT", "Teléfono"]));
    expect(baseLabels).not.toContain("Persona");
    // Un tipo que ya no existe se conserva para que el selector no quede vacío.
    const gone = typeOptions([], `user:${uuid(5)}`);
    expect(gone[gone.length - 1]?.label).toBe("sin nombre");
  });
});

describe("textos del ajuste de pieza (pasada de textos F7)", () => {
  const digits: FormatPiece = { kind: "chars", charClass: "digit", min: 2, max: 2 };

  it("el título dice qué número de pieza es y de qué clase", () => {
    expect(pieceHeading([1], 5, digits)).toBe("Pieza 2 de 5 · Dígitos");
    expect(pieceHeading([1, 0], 5, digits)).toBe("Pieza 2.1 · Dígitos");
  });

  it("el estado vacío es el de UX_Guidelines.md §11b.15", () => {
    expect(BUILDER_COPY.noPieceSelected).toBe(
      "Elegí una pieza para ajustarla, o sumá una con «Pieza». Arrastralas para cambiarles el orden; con clic derecho, las movés o las borrás.",
    );
  });

  it("el separador opcional da ejemplos con su carácter", () => {
    expect(BUILDER_COPY.separatorOptional("-")).toBe(
      "Puede faltar: «12-345» y «12345» valen igual",
    );
    expect(BUILDER_COPY.separatorOptional(".")).toContain("«12.345»");
  });

  it("el verde dice que no se pisa con nada", () => {
    expect(BUILDER_COPY.readyDetail).toBe("No se pisa con ningún formato prendido.");
  });
});

describe("los botones − y + de la cantidad", () => {
  const digits = (min: number, max: number): CharsPiece => ({
    kind: "chars",
    charClass: "digit",
    min,
    max,
  });

  it("«Exactamente» mueve los dos extremos juntos y respeta 1 y el tope", () => {
    expect(stepExactly(digits(3, 3), 1, 8)).toEqual(digits(4, 4));
    expect(stepExactly(digits(1, 1), -1, 8)).toEqual(digits(1, 1));
    expect(stepExactly(digits(8, 8), 1, 8)).toEqual(digits(8, 8));
  });

  it("el mínimo de «Entre» no pasa al máximo ni baja de 1", () => {
    expect(stepMin(digits(2, 4), 1)).toEqual(digits(3, 4));
    expect(stepMin(digits(4, 4), 1)).toEqual(digits(4, 4));
    expect(stepMin(digits(1, 4), -1)).toEqual(digits(1, 4));
  });

  it("el máximo de «Entre» no baja del mínimo ni pasa el tope", () => {
    expect(stepMax(digits(2, 4), -1, 8)).toEqual(digits(2, 3));
    expect(stepMax(digits(2, 2), -1, 8)).toEqual(digits(2, 2));
    expect(stepMax(digits(2, 8), 1, 8)).toEqual(digits(2, 8));
  });
});
