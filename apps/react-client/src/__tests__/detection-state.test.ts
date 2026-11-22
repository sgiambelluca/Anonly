/**
 * El reductor y la lectura validada de `detectionState.ts` (`React_Client.md`
 * §3.8, ADR-223 §3, ADR-227 §3). Usa las funciones reales del Core
 * (`validateUserEntityType`, `validateFormat`, `getCatalog`).
 */

import { EntityType } from "@anonly/anonymization-core";
import { describe, expect, it, vi } from "vitest";

import {
  applyDetectionChange,
  DEFAULT_DETECTION_STATE,
  disabledBaseIds,
  parseDetectionState,
  type DetectionChange,
  type DetectionState,
} from "../store/detectionState.js";

import { stateWith, userFormat, userType, uuid } from "./helpers/detectionFixtures.js";

function applied(state: DetectionState, change: DetectionChange): DetectionState {
  const result = applyDetectionChange(state, change);
  if (!result.ok) throw new Error(`rechazado: ${result.reason}`);
  return result.state;
}

function reason(state: DetectionState, change: DetectionChange): string {
  const result = applyDetectionChange(state, change);
  return result.ok ? "ok" : result.reason;
}

describe("detectionState: formatos base", () => {
  it("apagar un formato base lo agrega a los apagados del país y prenderlo lo saca", () => {
    const off = applied(DEFAULT_DETECTION_STATE, {
      kind: "setBaseFormatEnabled",
      formatId: "dni-ar",
      enabled: false,
    });
    expect(disabledBaseIds(off)).toEqual(["dni-ar"]);
    // No muta el estado de entrada.
    expect(disabledBaseIds(DEFAULT_DETECTION_STATE)).toEqual([]);

    const again = applied(off, {
      kind: "setBaseFormatEnabled",
      formatId: "dni-ar",
      enabled: false,
    });
    expect(disabledBaseIds(again)).toEqual(["dni-ar"]);

    const on = applied(off, { kind: "setBaseFormatEnabled", formatId: "dni-ar", enabled: true });
    expect(disabledBaseIds(on)).toEqual([]);
  });

  it("rechaza un id que no es del catálogo del país", () => {
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "setBaseFormatEnabled",
        formatId: "no-existe",
        enabled: false,
      }),
    ).toBe("unknown_format");
  });
});

describe("detectionState: tipos propios", () => {
  it("crea, edita y borra un tipo; borrar un tipo borra sus formatos (ADR-223 §4)", () => {
    const type = userType(0, "Historia clínica");
    let state = applied(DEFAULT_DETECTION_STATE, { kind: "createType", definition: type });
    expect(state.userTypes).toEqual([type]);

    state = applied(state, {
      kind: "createFormat",
      definition: userFormat(1, "HC larga", type.id),
    });
    state = applied(state, {
      kind: "createFormat",
      definition: userFormat(2, "Otro teléfono", EntityType.Phone),
    });

    state = applied(state, {
      kind: "editType",
      definition: { ...type, name: "Historia clínica nueva" },
    });
    expect(state.userTypes[0]?.name).toBe("Historia clínica nueva");

    state = applied(state, { kind: "deleteType", typeId: type.id });
    expect(state.userTypes).toEqual([]);
    expect(state.userFormats.map((format) => format.name)).toEqual(["Otro teléfono"]);
  });

  it("rechaza un tipo con etiqueta repetida, o con una etiqueta de un tipo base", () => {
    const state = applied(DEFAULT_DETECTION_STATE, {
      kind: "createType",
      definition: userType(0, "Legajo"),
    });
    expect(reason(state, { kind: "createType", definition: userType(1, "legajo") })).toBe(
      "invalid_type",
    );
    // MUJER y HOMBRE son etiquetas de tipo base (Contracts.md §5.2).
    expect(reason(state, { kind: "createType", definition: userType(2, "Mujer") })).toBe(
      "invalid_type",
    );
    expect(reason(state, { kind: "createType", definition: userType(3, "") })).toBe("invalid_type");
  });

  it("editar o borrar un tipo que no existe se rechaza", () => {
    expect(
      reason(DEFAULT_DETECTION_STATE, { kind: "editType", definition: userType(0, "Legajo") }),
    ).toBe("unknown_type");
    expect(
      reason(DEFAULT_DETECTION_STATE, { kind: "deleteType", typeId: userType(0, "Legajo").id }),
    ).toBe("unknown_type");
  });

  it("editar un tipo no se compara contra sí mismo, pero sí contra los demás", () => {
    let state = applied(DEFAULT_DETECTION_STATE, {
      kind: "createType",
      definition: userType(0, "Legajo"),
    });
    state = applied(state, { kind: "createType", definition: userType(1, "Expediente") });
    expect(reason(state, { kind: "editType", definition: userType(0, "Legajo") })).toBe("ok");
    expect(reason(state, { kind: "editType", definition: userType(0, "Expediente") })).toBe(
      "invalid_type",
    );
  });
});

describe("detectionState: formatos propios", () => {
  it("crea, prende y apaga, edita y borra un formato propio", () => {
    let state = applied(DEFAULT_DETECTION_STATE, {
      kind: "createFormat",
      definition: userFormat(0, "Interno"),
    });
    state = applied(state, {
      kind: "setUserFormatEnabled",
      formatId: `fmt:${uuid(0)}`,
      enabled: false,
    });
    expect(state.userFormats[0]?.enabled).toBe(false);

    state = applied(state, {
      kind: "editFormat",
      definition: userFormat(0, "Interno 2", EntityType.Phone, { enabled: false }),
    });
    expect(state.userFormats[0]?.name).toBe("Interno 2");

    state = applied(state, { kind: "deleteFormat", formatId: `fmt:${uuid(0)}` });
    expect(state.userFormats).toEqual([]);
  });

  it("rechaza un formato inválido, de un tipo no admitido o que no existe", () => {
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createFormat",
        definition: userFormat(0, "Sin variantes", EntityType.Phone, { variants: [] }),
      }),
    ).toBe("invalid_format");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createFormat",
        definition: userFormat(0, "Mail", EntityType.Email),
      }),
    ).toBe("invalid_format");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createFormat",
        definition: userFormat(0, "Con base", EntityType.Phone, { basedOn: "dni-ar" }),
      }),
    ).toBe("invalid_format");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "setUserFormatEnabled",
        formatId: "fmt:x",
        enabled: true,
      }),
    ).toBe("unknown_format");
    expect(
      reason(DEFAULT_DETECTION_STATE, { kind: "editFormat", definition: userFormat(0, "Nada") }),
    ).toBe("unknown_format");
    expect(reason(DEFAULT_DETECTION_STATE, { kind: "deleteFormat", formatId: "fmt:x" })).toBe(
      "unknown_format",
    );
  });

  it("rechaza un nombre repetido y valida editando contra los otros formatos", () => {
    let state = applied(DEFAULT_DETECTION_STATE, {
      kind: "createFormat",
      definition: userFormat(0, "Interno"),
    });
    expect(reason(state, { kind: "createFormat", definition: userFormat(1, "interno") })).toBe(
      "invalid_format",
    );
    state = applied(state, { kind: "createFormat", definition: userFormat(1, "Externo") });
    expect(reason(state, { kind: "editFormat", definition: userFormat(1, "Interno") })).toBe(
      "invalid_format",
    );
  });
});

describe("detectionState: copias editadas", () => {
  const copy = userFormat(0, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" });

  it("crea una copia de un formato base `structure` y la restaura borrándola", () => {
    const state = applied(DEFAULT_DETECTION_STATE, { kind: "createEditedCopy", definition: copy });
    expect(state.userFormats).toEqual([copy]);
    const restored = applied(state, { kind: "restoreOriginal", formatId: copy.id });
    expect(restored.userFormats).toEqual([]);
  });

  it("rechaza copiar un formato de control, uno inexistente o uno ya copiado", () => {
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createEditedCopy",
        definition: userFormat(0, "CUIT propio", EntityType.CUIT, { basedOn: "cuit-ar" }),
      }),
    ).toBe("invalid_copy");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createEditedCopy",
        definition: userFormat(0, "Nada", EntityType.DNI, { basedOn: "no-existe" }),
      }),
    ).toBe("invalid_copy");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createEditedCopy",
        definition: userFormat(0, "Sin base", EntityType.DNI),
      }),
    ).toBe("invalid_copy");
    const state = applied(DEFAULT_DETECTION_STATE, { kind: "createEditedCopy", definition: copy });
    expect(
      reason(state, {
        kind: "createEditedCopy",
        definition: userFormat(1, "Otra copia", EntityType.DNI, { basedOn: "dni-ar" }),
      }),
    ).toBe("invalid_copy");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "createEditedCopy",
        definition: userFormat(1, "", EntityType.DNI, { basedOn: "dni-ar" }),
      }),
    ).toBe("invalid_format");
  });

  it("«Restaurar original» solo vale para una copia", () => {
    const state = applied(DEFAULT_DETECTION_STATE, {
      kind: "createFormat",
      definition: userFormat(0, "Propio"),
    });
    expect(reason(state, { kind: "restoreOriginal", formatId: `fmt:${uuid(0)}` })).toBe(
      "unknown_format",
    );
    expect(reason(state, { kind: "restoreOriginal", formatId: "fmt:x" })).toBe("unknown_format");
  });
});

describe("detectionState: importar un archivo", () => {
  it("suma tipos, formatos y referencias en un solo cambio", () => {
    const type = userType(0, "Legajo");
    const state = applied(DEFAULT_DETECTION_STATE, {
      kind: "importFile",
      types: [type],
      formats: [userFormat(1, "Legajo largo", type.id), userFormat(2, "Teléfono interno")],
      catalogRefs: [],
    });
    expect(state.userTypes).toHaveLength(1);
    expect(state.userFormats).toHaveLength(2);
  });

  it("rechaza todo el archivo si un elemento no valida", () => {
    const type = userType(0, "Legajo");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "importFile",
        types: [type, userType(1, "legajo")],
        formats: [],
        catalogRefs: [],
      }),
    ).toBe("invalid_import");
    expect(
      reason(DEFAULT_DETECTION_STATE, {
        kind: "importFile",
        types: [],
        formats: [userFormat(0, "Sin tipo", userType(5, "Fantasma").id)],
        catalogRefs: [],
      }),
    ).toBe("invalid_import");
  });
});

describe("detectionState: parseDetectionState (lo que lee load())", () => {
  it("lee un estado válido tal cual", () => {
    const type = userType(0, "Legajo");
    const state = stateWith({
      disabledBaseFormats: { AR: ["dni-ar"] },
      userTypes: [type],
      userFormats: [
        userFormat(1, "Legajo largo", type.id),
        userFormat(2, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" }),
      ],
    });
    const parsed = parseDetectionState(JSON.stringify(state));
    expect(parsed?.discarded).toBe(0);
    expect(parsed?.state).toEqual(state);
  });

  it("devuelve null con un JSON roto, un valor que no es objeto o una versión que no es la 1", () => {
    expect(parseDetectionState("{no es json")).toBeNull();
    expect(parseDetectionState("[]")).toBeNull();
    expect(
      parseDetectionState(JSON.stringify({ ...DEFAULT_DETECTION_STATE, version: 2 })),
    ).toBeNull();
  });

  it("descarta, contando solo el número, lo que ya no valida", () => {
    const type = userType(0, "Legajo");
    const raw = JSON.stringify({
      version: 1,
      country: "AR",
      disabledBaseFormats: { AR: ["dni-ar", "ya-no-existe"] },
      userTypes: [type, { id: "user:roto" }, null],
      userFormats: [
        userFormat(1, "Bueno", type.id),
        userFormat(2, "De un tipo descartado", `user:${uuid(6)}`),
        "no es un objeto",
        { basedOn: "no-existe" },
      ],
      catalogRefs: [{ id: "ref:1", country: "AR", catalogFormatId: "x", enabled: true }, { id: 3 }],
    });
    const parsed = parseDetectionState(raw);
    expect(parsed?.state.userTypes).toEqual([type]);
    expect(parsed?.state.userFormats.map((format) => format.name)).toEqual(["Bueno"]);
    expect(disabledBaseIds(parsed?.state ?? DEFAULT_DETECTION_STATE)).toEqual(["dni-ar"]);
    expect(parsed?.state.catalogRefs).toHaveLength(1);
    // 1 base + 2 tipos + 3 formatos + 1 referencia.
    expect(parsed?.discarded).toBe(7);
  });

  it("tolera campos ausentes o de otra forma y usa los defaults", () => {
    const parsed = parseDetectionState(
      JSON.stringify({ version: 1, disabledBaseFormats: "x", userTypes: 5 }),
    );
    expect(parsed?.state).toEqual({ ...DEFAULT_DETECTION_STATE, disabledBaseFormats: { AR: [] } });
    expect(parsed?.discarded).toBe(0);
  });

  it("no loguea nada: es una función pura", () => {
    const warn = vi.spyOn(console, "warn");
    parseDetectionState("{no es json");
    expect(warn).not.toHaveBeenCalled();
  });
});
