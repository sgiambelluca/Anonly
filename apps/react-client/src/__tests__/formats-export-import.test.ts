/**
 * Exportar e importar el archivo de formatos (ADR-223 §5 y §6, `Components.md`
 * §13b.4). El archivo de salida se vuelve a validar con `validateFormatsFile`
 * del façade: lo que se exporta tiene que poder importarse.
 */

import {
  EntityType,
  validateFormatsFile,
  type FormatsFileContent,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  allSelectable,
  buildExportLists,
  buildFormatsFile,
  describeExportSelection,
  FORMATS_FILE_NAME,
  serializeFormatsFile,
  toggleFormat,
  toggleType,
  typeCheckState,
} from "../components/formats/formatsExport.js";
import {
  describeImportedItems,
  describeOverlapWarning,
  importRowDot,
  limitRejectionMessages,
  MAX_REJECTION_MESSAGES,
  planFormatsImport,
} from "../components/formats/formatsImport.js";
import { applyDetectionChange, DEFAULT_DETECTION_STATE } from "../store/detectionState.js";

import { sequentialIds, stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";

const legajo = userType(0, "Legajo");
const ownState = stateWith({
  userTypes: [legajo, userType(1, "Expediente")],
  userFormats: [
    userFormat(2, "Legajo largo", legajo.id),
    userFormat(3, "Legajo corto", legajo.id, {
      variants: [[{ kind: "chars", charClass: "upper", min: 2, max: 2 }]],
    }),
    userFormat(4, "Teléfono interno", EntityType.Phone),
    userFormat(5, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" }),
  ],
});

describe("exportar formatos", () => {
  it("el nombre del archivo es formatos.anonly-formatos", () => {
    expect(FORMATS_FILE_NAME).toBe("formatos.anonly-formatos");
  });

  it("arma las dos listas: tipos propios con sus formatos, y formatos propios en tipos del catálogo", () => {
    const lists = buildExportLists(ownState);
    expect(lists.ownTypes.map((entry) => [entry.type.name, entry.formats.length])).toEqual([
      ["Legajo", 2],
      ["Expediente", 0],
    ]);
    expect(lists.catalogFormats.map((entry) => [entry.format.name, entry.typeName])).toEqual([
      ["Teléfono interno", "Teléfono"],
      ["DNI propio", "DNI"],
    ]);
  });

  it("un tipo propio viaja con todos sus formatos; un formato de un tipo base viaja solo", () => {
    const lists = buildExportLists(ownState);
    const entry = lists.ownTypes[0];
    if (entry === undefined) throw new Error("falta el tipo");
    const selection = toggleType(new Set(), entry, true);
    expect(buildFormatsFile(ownState, selection)).toEqual({
      kind: "anonly-formats",
      version: 1,
      types: [legajo],
      formats: [ownState.userFormats[0], ownState.userFormats[1]],
      catalogRefs: [],
    });

    const alone = toggleFormat(new Set(), ownState.userFormats[2]?.id ?? "", true);
    const content = buildFormatsFile(ownState, alone);
    expect(content.types).toEqual([]);
    expect(content.formats.map((format) => format.name)).toEqual(["Teléfono interno"]);
  });

  it("un formato de un tipo propio viaja con su tipo; una copia editada viaja con su `basedOn`", () => {
    const one = toggleFormat(new Set(), ownState.userFormats[1]?.id ?? "", true);
    const content = buildFormatsFile(ownState, one);
    expect(content.types).toEqual([legajo]);
    expect(content.formats.map((format) => format.name)).toEqual(["Legajo corto"]);

    const copy = toggleFormat(new Set(), ownState.userFormats[3]?.id ?? "", true);
    expect(buildFormatsFile(ownState, copy).formats[0]?.basedOn).toBe("dni-ar");
  });

  it("un tipo sin formatos viaja solo, y el país y los formatos base no viajan", () => {
    const empty = buildExportLists(ownState).ownTypes[1];
    if (empty === undefined) throw new Error("falta el tipo");
    const content = buildFormatsFile(ownState, toggleType(new Set(), empty, true));
    expect(content.types.map((type) => type.name)).toEqual(["Expediente"]);
    expect(Object.keys(content).sort()).toEqual([
      "catalogRefs",
      "formats",
      "kind",
      "types",
      "version",
    ]);
  });

  it("el estado mixto de la casilla de un tipo sale de sus formatos", () => {
    const entry = buildExportLists(ownState).ownTypes[0];
    if (entry === undefined) throw new Error("falta el tipo");
    expect(typeCheckState(entry, new Set())).toBe(false);
    const one = toggleFormat(new Set(), entry.formats[0]?.id ?? "", true);
    expect(typeCheckState(entry, one)).toBe("indeterminate");
    const all = toggleType(one, entry, true);
    expect(typeCheckState(entry, all)).toBe(true);
    expect(typeCheckState(entry, toggleType(all, entry, false))).toBe(false);
    expect(typeCheckState(entry, toggleFormat(all, entry.formats[0]?.id ?? "", false))).toBe(
      "indeterminate",
    );
    const empty = buildExportLists(ownState).ownTypes[1];
    if (empty === undefined) throw new Error("falta el tipo");
    expect(typeCheckState(empty, new Set())).toBe(false);
    expect(typeCheckState(empty, toggleType(new Set(), empty, true))).toBe(true);
  });

  it("«Elegir todo» elige todo y el resumen del pie cuenta tipos y formatos", () => {
    const lists = buildExportLists(ownState);
    const everything = buildFormatsFile(ownState, allSelectable(lists));
    expect(everything.types).toHaveLength(2);
    expect(everything.formats).toHaveLength(4);
    expect(describeExportSelection(everything)).toBe("2 tipos y 4 formatos");
    expect(describeExportSelection({ ...everything, types: [legajo], formats: [] })).toBe("1 tipo");
    expect(
      describeExportSelection({
        ...everything,
        types: [],
        formats: everything.formats.slice(0, 1),
      }),
    ).toBe("1 formato");
    expect(describeExportSelection(buildFormatsFile(ownState, new Set()))).toBeNull();
  });

  it("lo exportado pasa por validateFormatsFile y vuelve idéntico", () => {
    const content = buildFormatsFile(ownState, allSelectable(buildExportLists(ownState)));
    const result = validateFormatsFile(serializeFormatsFile(content), "AR");
    expect(result).toEqual({ ok: true, content });
  });
});

describe("importar un archivo", () => {
  // Lejos de los ids de los fixtures de `ownState`, que usan del 0 al 5.
  const ids = () => sequentialIds(10);

  function content(patch: Partial<FormatsFileContent>): FormatsFileContent {
    return {
      kind: "anonly-formats",
      version: 1,
      types: [],
      formats: [],
      catalogRefs: [],
      ...patch,
    };
  }

  it("un tipo nuevo se importa con id nuevo, y sus formatos, prendidos y con ids nuevos", () => {
    const type = userType(0, "Historia clínica");
    const plan = planFormatsImport(
      content({
        types: [type],
        formats: [userFormat(1, "HC", type.id, { enabled: false })],
      }),
      DEFAULT_DETECTION_STATE,
      ids(),
    );
    expect(plan.change?.types).toHaveLength(1);
    expect(plan.change?.types[0]?.id).not.toBe(type.id);
    const format = plan.change?.formats[0];
    expect(format?.id).not.toBe(userFormat(1, "HC", type.id).id);
    expect(format?.entityType).toBe(plan.change?.types[0]?.id);
    expect(format?.enabled).toBe(true);
    expect(plan.summary.imported.map((item) => [item.kind, item.name])).toEqual([
      ["type", "Historia clínica"],
      ["format", "HC"],
    ]);
    expect(plan.summary.merged).toEqual([]);
    expect(plan.summary.skipped).toEqual([]);

    // El cambio entra al reductor sin rechazo.
    const result = applyDetectionChange(
      DEFAULT_DETECTION_STATE,
      plan.change ?? { kind: "importFile", types: [], formats: [], catalogRefs: [] },
    );
    expect(result.ok).toBe(true);
  });

  it("un tipo con la misma etiqueta que uno existente suma sus formatos a ese", () => {
    const incoming = userType(7, "legajo");
    const plan = planFormatsImport(
      content({
        types: [incoming],
        formats: [
          userFormat(1, "Legajo nuevo", incoming.id, {
            variants: [[{ kind: "chars", charClass: "upper", min: 4, max: 4 }]],
          }),
        ],
      }),
      ownState,
      ids(),
    );
    expect(plan.change?.types).toEqual([]);
    expect(plan.change?.formats[0]?.entityType).toBe(legajo.id);
    // `typeId`: el punto de la fila sale del tipo, no del nombre (pasada de UI de la 1.1).
    expect(plan.summary.merged).toEqual([
      { kind: "format", name: "Legajo nuevo", typeName: "Legajo", typeId: legajo.id },
    ]);
    expect(plan.summary.imported).toEqual([]);
  });

  it("un tipo que ya existía y no trae formatos nuevos figura como no importado", () => {
    const plan = planFormatsImport(content({ types: [userType(7, "Legajo")] }), ownState, ids());
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped).toEqual([
      { name: "Legajo", reason: "Ya tenías este tipo y el archivo no trae formatos para sumarle." },
    ]);
  });

  it("un formato idéntico a uno que ya existe no se importa y dice a cuál", () => {
    const same = userFormat(6, "Otro nombre", legajo.id, {
      variants: ownState.userFormats[0]?.variants ?? [],
    });
    const plan = planFormatsImport(
      content({ types: [userType(7, "Legajo")], formats: [same] }),
      ownState,
      ids(),
    );
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped[0]).toEqual({
      name: "Otro nombre",
      reason: "Es idéntico a «Legajo largo», que ya tenés.",
    });
  });

  it("un formato idéntico a uno del catálogo dice el nombre del catálogo", () => {
    const sameAsDni = userFormat(6, "Mi DNI", EntityType.DNI, {
      variants: [
        [
          { kind: "chars", charClass: "digit", min: 1, max: 2 },
          { kind: "separator", chars: ["."], optional: true },
          { kind: "chars", charClass: "digit", min: 3, max: 3 },
          { kind: "separator", chars: ["."], optional: true },
          { kind: "chars", charClass: "digit", min: 3, max: 3 },
        ],
      ],
    });
    const plan = planFormatsImport(
      content({ formats: [sameAsDni] }),
      DEFAULT_DETECTION_STATE,
      ids(),
    );
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped[0]?.reason).toBe("Es idéntico a «DNI», que ya tenés.");
  });

  it("un formato que comparte textos con otro se importa con el aviso", () => {
    const overlapping = userFormat(6, "Teléfono parecido", EntityType.Phone, {
      variants: [[{ kind: "chars", charClass: "digit", min: 3, max: 6 }]],
    });
    const plan = planFormatsImport(content({ formats: [overlapping] }), ownState, ids());
    expect(plan.change?.formats).toHaveLength(1);
    const item = plan.summary.imported[0];
    expect(item?.overlapsWith).toContain("Teléfono interno");
    expect(describeOverlapWarning(item ?? { kind: "format", name: "x" })).toContain(
      "«Teléfono parecido» comparte textos con",
    );
  });

  it("un nombre que el usuario ya usó, sin ser idéntico, es un conflicto: no va a «No se importó»", () => {
    const clash = userFormat(6, "legajo LARGO", legajo.id, {
      variants: [[{ kind: "chars", charClass: "upper", min: 5, max: 6 }]],
    });
    const plan = planFormatsImport(content({ formats: [clash] }), ownState, ids());
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ index: 0, name: "legajo LARGO", code: "name_taken" });
  });

  it("con un nombre nuevo el conflicto se resuelve, se importa y el resumen dice qué se renombró", () => {
    const clash = userFormat(6, "legajo LARGO", legajo.id, {
      variants: [[{ kind: "chars", charClass: "upper", min: 5, max: 6 }]],
    });
    const plan = planFormatsImport(
      content({ formats: [clash] }),
      ownState,
      ids(),
      new Map([[0, "Legajo de cinco"]]),
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.change?.formats[0]?.name).toBe("Legajo de cinco");
    expect(plan.summary.renamed).toEqual([{ from: "legajo LARGO", to: "Legajo de cinco" }]);
  });

  it("un nombre nuevo que sigue chocando, o vacío, sigue siendo conflicto", () => {
    const clash = userFormat(6, "legajo LARGO", legajo.id, {
      variants: [[{ kind: "chars", charClass: "upper", min: 5, max: 6 }]],
    });
    const same = planFormatsImport(
      content({ formats: [clash] }),
      ownState,
      ids(),
      new Map([[0, "LEGAJO corto"]]),
    );
    expect(same.conflicts[0]?.code).toBe("name_taken");
    const empty = planFormatsImport(
      content({ formats: [clash] }),
      ownState,
      ids(),
      new Map([[0, ""]]),
    );
    expect(empty.conflicts[0]?.code).toBe("name_empty");
  });

  it("un formato idéntico con nombre repetido sigue yendo a «No se importó»", () => {
    const same = userFormat(6, "Legajo largo", legajo.id);
    const plan = planFormatsImport(content({ formats: [same] }), ownState, ids());
    expect(plan.conflicts).toEqual([]);
    expect(plan.summary.skipped[0]?.reason).toContain("idéntico");
  });

  it("una referencia a un formato que no existe en los catálogos de esta versión no se importa", () => {
    const plan = planFormatsImport(
      content({
        catalogRefs: [{ id: "ref:1", country: "AR", catalogFormatId: "dni-ar", enabled: true }],
      }),
      DEFAULT_DETECTION_STATE,
      ids(),
    );
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped).toEqual([
      {
        name: "dni-ar",
        reason: "El formato no existe en los catálogos de esta versión de Anonly.",
      },
    ]);
  });

  it("una copia editada entra si su base es editable y no tiene ya una copia; si no, figura", () => {
    const copy = userFormat(6, "DNI nuevo", EntityType.DNI, {
      basedOn: "dni-ar",
      variants: [[{ kind: "chars", charClass: "digit", min: 7, max: 8 }]],
    });
    expect(
      planFormatsImport(content({ formats: [copy] }), DEFAULT_DETECTION_STATE, ids()).change
        ?.formats[0]?.basedOn,
    ).toBe("dni-ar");

    const twice = planFormatsImport(content({ formats: [copy] }), ownState, ids());
    expect(twice.summary.skipped[0]?.reason).toBe(
      "Ya tenés una copia editada de ese formato del catálogo.",
    );

    const unknown = userFormat(6, "Rara", EntityType.DNI, { basedOn: "cuit-ar" });
    expect(
      planFormatsImport(content({ formats: [unknown] }), DEFAULT_DETECTION_STATE, ids()).summary
        .skipped[0]?.reason,
    ).toBe("Es una copia de un formato del catálogo que esta versión no tiene.");
  });

  it("un formato que no valida contra lo que ya hay figura con su motivo y capitalizado", () => {
    const bad = userFormat(6, "Raro", EntityType.Email);
    const plan = planFormatsImport(content({ formats: [bad] }), DEFAULT_DETECTION_STATE, ids());
    expect(plan.change).toBeNull();
    expect(plan.summary.skipped[0]?.reason.startsWith("A «Email»")).toBe(true);
  });

  it("dos formatos del archivo con el mismo nombre: el segundo es un conflicto contra el primero", () => {
    const first = userFormat(6, "Doble", EntityType.Phone);
    const second = userFormat(7, "Doble", EntityType.Phone, {
      variants: [[{ kind: "chars", charClass: "upper", min: 2, max: 2 }]],
    });
    const plan = planFormatsImport(
      content({ formats: [first, second] }),
      DEFAULT_DETECTION_STATE,
      ids(),
    );
    expect(plan.change?.formats).toHaveLength(1);
    expect(plan.conflicts.map((conflict) => conflict.index)).toEqual([1]);
  });

  it("describe las cantidades y limita los motivos del rechazo", () => {
    expect(describeImportedItems([])).toBe("");
    expect(
      describeImportedItems([
        { kind: "format", name: "a" },
        { kind: "format", name: "b" },
        { kind: "type", name: "c" },
      ]),
    ).toBe("2 formatos y 1 tipo");
    expect(
      describeImportedItems([
        { kind: "format", name: "a" },
        { kind: "type", name: "b" },
        { kind: "type", name: "c" },
      ]),
    ).toBe("1 formato y 2 tipos");

    const many = Array.from(
      { length: MAX_REJECTION_MESSAGES + 3 },
      (_unused, index) => `m${index}`,
    );
    const limited = limitRejectionMessages(many);
    expect(limited.shown).toHaveLength(MAX_REJECTION_MESSAGES);
    expect(limited.hidden).toBe(3);
    expect(limitRejectionMessages(["solo"])).toEqual({ shown: ["solo"], hidden: 0 });
  });
});

describe("el punto de una fila del resultado", () => {
  const own = new Set(["Legajo"]);

  it("un tipo propio y un formato que quedó en uno llevan el punto punteado", () => {
    expect(importRowDot({ kind: "type" }, own)).toBe("own");
    expect(importRowDot({ kind: "format", typeName: "Legajo" }, own)).toBe("own");
  });

  it("un formato en otro tipo lleva el punto común", () => {
    expect(importRowDot({ kind: "format", typeName: "Teléfono" }, own)).toBe("other");
    expect(importRowDot({ kind: "format" }, own)).toBe("other");
  });
});
