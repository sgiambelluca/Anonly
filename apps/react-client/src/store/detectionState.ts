/**
 * `detectionState.ts` — la parte pura de `detection.store.ts` (`React_Client.md`
 * §3.8, ADR-223 §3, ADR-227 §3): el estado persistido, la unión cerrada de
 * cambios del borrador, el reductor que los aplica y la lectura validada de
 * `localStorage`.
 *
 * Sale del store para probarlo sin Zustand ni `window`. Todo es inmutable: cada
 * función devuelve un estado nuevo y no toca el que recibe.
 *
 * **Validación antes de escribir**: el reductor solo acepta tipos que pasan
 * `validateUserEntityType` y formatos que pasan `validateFormat`. Un cambio que
 * no valida se rechaza entero (`{ ok: false }`) y el estado queda como estaba.
 * La interfaz valida antes de armar el cambio, así que el rechazo es la red de
 * seguridad y no el camino normal.
 */

import {
  getCatalog,
  validateFormat,
  validateUserEntityType,
  type CatalogFormatRef,
  type CountryCode,
  type FormatDefinition,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

/** Lo que se persiste en `localStorage["anonly:detection"]`. Versionado. */
export interface DetectionState {
  readonly version: 1;
  readonly country: CountryCode;
  /** Ids de formatos base apagados, por país (ADR-221 §5: al volver a un país, está lo suyo). */
  readonly disabledBaseFormats: Readonly<Partial<Record<CountryCode, ReadonlyArray<string>>>>;
  /** Los tipos guardados. */
  readonly userTypes: ReadonlyArray<UserEntityTypeDefinition>;
  /** Propios y copias editadas (`basedOn`). */
  readonly userFormats: ReadonlyArray<FormatDefinition>;
  /** Vacío en la 1.1. */
  readonly catalogRefs: ReadonlyArray<CatalogFormatRef>;
}

export const DETECTION_STORAGE_KEY = "anonly:detection";

export const DEFAULT_DETECTION_STATE: DetectionState = {
  version: 1,
  country: "AR",
  disabledBaseFormats: {},
  userTypes: [],
  userFormats: [],
  catalogRefs: [],
};

/**
 * Unión cerrada de lo que se puede hacer sobre el borrador (`React_Client.md`
 * §3.8). Cada una cuenta como **un** cambio en `pendingChanges`, también la
 * importación entera.
 */
export type DetectionChange =
  /** Prende o apaga un formato base del catálogo del país activo. */
  | { readonly kind: "setBaseFormatEnabled"; readonly formatId: string; readonly enabled: boolean }
  /** Prende o apaga un formato propio o una copia editada. */
  | { readonly kind: "setUserFormatEnabled"; readonly formatId: string; readonly enabled: boolean }
  | { readonly kind: "createType"; readonly definition: UserEntityTypeDefinition }
  | { readonly kind: "editType"; readonly definition: UserEntityTypeDefinition }
  /** Borra el tipo y todos sus formatos (ADR-223 §4). */
  | { readonly kind: "deleteType"; readonly typeId: UserEntityTypeId }
  | { readonly kind: "createFormat"; readonly definition: FormatDefinition }
  | { readonly kind: "editFormat"; readonly definition: FormatDefinition }
  | { readonly kind: "deleteFormat"; readonly formatId: string }
  /** Copia editada de un formato base `structure`: lleva `basedOn` (ADR-220 §4). */
  | { readonly kind: "createEditedCopy"; readonly definition: FormatDefinition }
  /** «Restaurar original»: borra la copia editada y el formato base vuelve a correr. */
  | { readonly kind: "restoreOriginal"; readonly formatId: string }
  /** Un archivo ya validado y resuelto por `planFormatsImport` (ADR-223 §6). */
  | {
      readonly kind: "importFile";
      readonly types: ReadonlyArray<UserEntityTypeDefinition>;
      readonly formats: ReadonlyArray<FormatDefinition>;
      readonly catalogRefs: ReadonlyArray<CatalogFormatRef>;
    };

export type DetectionRejection =
  | "unknown_format"
  | "unknown_type"
  | "invalid_type"
  | "invalid_format"
  | "invalid_copy"
  | "invalid_import";

export type DetectionChangeResult =
  | { readonly ok: true; readonly state: DetectionState }
  | { readonly ok: false; readonly reason: DetectionRejection };

function accept(state: DetectionState): DetectionChangeResult {
  return { ok: true, state };
}

function reject(reason: DetectionRejection): DetectionChangeResult {
  return { ok: false, reason };
}

function formatRefs(
  formats: ReadonlyArray<FormatDefinition>,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  return formats.map(({ id, name }) => ({ id, name }));
}

/** Los formatos base apagados del país activo. */
export function disabledBaseIds(state: DetectionState): ReadonlyArray<string> {
  return state.disabledBaseFormats[state.country] ?? [];
}

function withDisabledBase(state: DetectionState, ids: ReadonlyArray<string>): DetectionState {
  return {
    ...state,
    disabledBaseFormats: { ...state.disabledBaseFormats, [state.country]: ids },
  };
}

function validTypeFor(
  state: DetectionState,
  definition: UserEntityTypeDefinition,
  others: ReadonlyArray<UserEntityTypeDefinition>,
): boolean {
  return validateUserEntityType(definition, { country: state.country, existing: others }).ok;
}

function validFormatFor(
  definition: FormatDefinition,
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
  others: ReadonlyArray<FormatDefinition>,
): boolean {
  return validateFormat(definition, { userTypes, existingFormats: formatRefs(others) }).ok;
}

/** ¿`basedOn` es un formato `structure` del catálogo del país activo? (ADR-220 §4) */
function isEditableBase(state: DetectionState, catalogId: string): boolean {
  return getCatalog(state.country).some(
    (info) => info.id === catalogId && info.kind === "structure",
  );
}

/**
 * Aplica un cambio sobre un estado y devuelve el nuevo, o el motivo del
 * rechazo. No toca `state`.
 */
export function applyDetectionChange(
  state: DetectionState,
  change: DetectionChange,
): DetectionChangeResult {
  switch (change.kind) {
    case "setBaseFormatEnabled": {
      if (!getCatalog(state.country).some((info) => info.id === change.formatId)) {
        return reject("unknown_format");
      }
      const without = disabledBaseIds(state).filter((id) => id !== change.formatId);
      return accept(
        withDisabledBase(state, change.enabled ? without : [...without, change.formatId]),
      );
    }
    case "setUserFormatEnabled": {
      if (!state.userFormats.some((format) => format.id === change.formatId)) {
        return reject("unknown_format");
      }
      return accept({
        ...state,
        userFormats: state.userFormats.map((format) =>
          format.id === change.formatId ? { ...format, enabled: change.enabled } : format,
        ),
      });
    }
    case "createType": {
      if (!validTypeFor(state, change.definition, state.userTypes)) return reject("invalid_type");
      return accept({ ...state, userTypes: [...state.userTypes, change.definition] });
    }
    case "editType": {
      const others = state.userTypes.filter((type) => type.id !== change.definition.id);
      if (others.length === state.userTypes.length) return reject("unknown_type");
      if (!validTypeFor(state, change.definition, others)) return reject("invalid_type");
      return accept({
        ...state,
        userTypes: state.userTypes.map((type) =>
          type.id === change.definition.id ? change.definition : type,
        ),
      });
    }
    case "deleteType": {
      if (!state.userTypes.some((type) => type.id === change.typeId)) return reject("unknown_type");
      return accept({
        ...state,
        userTypes: state.userTypes.filter((type) => type.id !== change.typeId),
        userFormats: state.userFormats.filter((format) => format.entityType !== change.typeId),
      });
    }
    case "createFormat": {
      if (change.definition.basedOn !== undefined) return reject("invalid_format");
      if (!validFormatFor(change.definition, state.userTypes, state.userFormats)) {
        return reject("invalid_format");
      }
      return accept({ ...state, userFormats: [...state.userFormats, change.definition] });
    }
    case "editFormat": {
      const others = state.userFormats.filter((format) => format.id !== change.definition.id);
      if (others.length === state.userFormats.length) return reject("unknown_format");
      if (!validFormatFor(change.definition, state.userTypes, others)) {
        return reject("invalid_format");
      }
      return accept({
        ...state,
        userFormats: state.userFormats.map((format) =>
          format.id === change.definition.id ? change.definition : format,
        ),
      });
    }
    case "deleteFormat": {
      if (!state.userFormats.some((format) => format.id === change.formatId)) {
        return reject("unknown_format");
      }
      return accept({
        ...state,
        userFormats: state.userFormats.filter((format) => format.id !== change.formatId),
      });
    }
    case "createEditedCopy": {
      const basedOn = change.definition.basedOn;
      if (basedOn === undefined || !isEditableBase(state, basedOn)) return reject("invalid_copy");
      // Una sola copia por formato base: si no, correrían dos a la vez.
      if (state.userFormats.some((format) => format.basedOn === basedOn)) {
        return reject("invalid_copy");
      }
      if (!validFormatFor(change.definition, state.userTypes, state.userFormats)) {
        return reject("invalid_format");
      }
      return accept({ ...state, userFormats: [...state.userFormats, change.definition] });
    }
    case "restoreOriginal": {
      const target = state.userFormats.find((format) => format.id === change.formatId);
      if (target === undefined || target.basedOn === undefined) return reject("unknown_format");
      return accept({
        ...state,
        userFormats: state.userFormats.filter((format) => format.id !== change.formatId),
      });
    }
    case "importFile": {
      let types = state.userTypes;
      for (const definition of change.types) {
        if (!validTypeFor(state, definition, types)) return reject("invalid_import");
        types = [...types, definition];
      }
      let formats = state.userFormats;
      for (const definition of change.formats) {
        if (!validFormatFor(definition, types, formats)) return reject("invalid_import");
        formats = [...formats, definition];
      }
      return accept({
        ...state,
        userTypes: types,
        userFormats: formats,
        catalogRefs: [...state.catalogRefs, ...change.catalogRefs],
      });
    }
  }
}

// ─── Lectura validada de localStorage ───

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCatalogRefShape(value: unknown): value is CatalogFormatRef {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    value["country"] === "AR" &&
    typeof value["catalogFormatId"] === "string" &&
    typeof value["enabled"] === "boolean"
  );
}

/** `applyDetectionChange` sobre datos que vienen de afuera: una forma rota cuenta como rechazo, no como excepción. */
function tryApply(state: DetectionState, change: DetectionChange): DetectionChangeResult {
  try {
    return applyDetectionChange(state, change);
  } catch {
    return reject("invalid_import");
  }
}

export interface ParsedDetectionState {
  readonly state: DetectionState;
  /** Cuántos tipos, formatos o referencias se descartaron por no validar. Solo el número: nunca su contenido. */
  readonly discarded: number;
}

/**
 * Lee lo persistido. `null` si no es JSON, no es un objeto o su versión no es
 * la 1: el llamador usa los defaults. Lo que ya no valida se descarta y se
 * cuenta (el Core haría lo mismo, `Orchestrator.md` caso 47); un formato cuyo
 * tipo propio se descartó se descarta también.
 */
export function parseDetectionState(raw: string): ParsedDetectionState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["version"] !== 1) return null;

  const country: CountryCode = "AR";
  let discarded = 0;

  const rawDisabled = parsed["disabledBaseFormats"];
  const disabledForCountry =
    isRecord(rawDisabled) && isStringArray(rawDisabled[country]) ? rawDisabled[country] : [];
  const knownIds = new Set(getCatalog(country).map((info) => info.id));
  const disabled = disabledForCountry.filter((id) => knownIds.has(id));
  discarded += disabledForCountry.length - disabled.length;

  const base: DetectionState = withDisabledBase({ ...DEFAULT_DETECTION_STATE, country }, disabled);
  let state: DetectionState = base;

  const rawTypes: ReadonlyArray<unknown> = Array.isArray(parsed["userTypes"])
    ? parsed["userTypes"]
    : [];
  for (const candidate of rawTypes) {
    // Frontera con `localStorage`: la forma la comprueba `validateUserEntityType`
    // dentro del reductor, y lo que lance se cuenta como descartado.
    const result = tryApply(state, {
      kind: "createType",
      definition: candidate as UserEntityTypeDefinition,
    });
    if (result.ok) state = result.state;
    else discarded += 1;
  }

  const rawFormats: ReadonlyArray<unknown> = Array.isArray(parsed["userFormats"])
    ? parsed["userFormats"]
    : [];
  for (const candidate of rawFormats) {
    // Frontera con `localStorage`, igual que arriba.
    const definition = candidate as FormatDefinition;
    const result = tryApply(
      state,
      isRecord(candidate) && candidate["basedOn"] !== undefined
        ? { kind: "createEditedCopy", definition }
        : { kind: "createFormat", definition },
    );
    if (result.ok) state = result.state;
    else discarded += 1;
  }

  const rawRefs: ReadonlyArray<unknown> = Array.isArray(parsed["catalogRefs"])
    ? parsed["catalogRefs"]
    : [];
  const refs = rawRefs.filter(isCatalogRefShape);
  discarded += rawRefs.length - refs.length;
  state = { ...state, catalogRefs: refs };

  return { state, discarded };
}
