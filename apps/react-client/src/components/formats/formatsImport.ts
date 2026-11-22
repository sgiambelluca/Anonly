/**
 * `formatsImport.ts` — lo que pasa con cada elemento de un archivo de formatos
 * ya validado (ADR-223 §6, `Components.md` §13b.4).
 *
 * `validateFormatsFile` valida el archivo **entero** antes; acá se resuelven los
 * cruces con lo que el usuario ya tiene:
 *
 * | Caso | Qué pasa |
 * |---|---|
 * | Tipo con la misma etiqueta que uno existente | Sus formatos se suman al existente |
 * | Formato idéntico a uno existente (`compareFormat`) | No se importa; figura en el resumen |
 * | Formato que comparte textos con otro | Se importa con el aviso |
 * | Referencia a un formato que no existe en los catálogos de esta versión | No se importa; figura en el resumen |
 * | Todo lo demás | Se importa prendido, con ids nuevos |
 *
 * Además de lo que dice ADR-223 §6, un formato que no pasa `validateFormat`
 * contra lo que ya hay (por ejemplo, un nombre que el usuario ya usó) no se
 * importa y figura con su motivo: la importación nunca deja el borrador en un
 * estado que `load()` después descartaría.
 *
 * Función pura: el generador de ids se inyecta. No toca el borrador; devuelve
 * el `DetectionChange` (un solo cambio) y el resumen que muestra
 * `ImportFormatsResultDialog`.
 */

import {
  compareFormat,
  getCatalog,
  isUserEntityType,
  userTypeLabel,
  validateFormat,
  type CatalogFormatRef,
  type EntityTypeId,
  type FormatDefinition,
  type FormatsFileContent,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

import {
  disabledBaseIds,
  type DetectionChange,
  type DetectionState,
} from "../../store/detectionState.js";

import { describeOverlap, entityTypeName, formatIssueReason } from "./formatTexts.js";

export interface ImportedItem {
  readonly kind: "type" | "format";
  readonly name: string;
  /** Solo un formato: el tipo en el que quedó. */
  readonly typeName?: string;
  /** Solo un formato: el id de ese tipo, para pintar su punto con el color del catálogo. */
  readonly typeId?: EntityTypeId;
  /** Formatos con los que comparte textos: el aviso amarillo. */
  readonly overlapsWith?: ReadonlyArray<string>;
  /** El texto más corto que comparte con cada formato de `overlapsWith`, en el mismo orden. */
  readonly overlapExamples?: ReadonlyArray<string>;
}

export interface SkippedItem {
  readonly name: string;
  readonly reason: string;
}

export interface ImportSummary {
  /** «Se importó». */
  readonly imported: ReadonlyArray<ImportedItem>;
  /** «Se sumó a un tipo que ya tenías»: formatos que entraron a un tipo propio existente. */
  readonly merged: ReadonlyArray<ImportedItem>;
  /** «No se importó», con el motivo de cada uno. */
  readonly skipped: ReadonlyArray<SkippedItem>;
  /** Formatos que el usuario renombró en el paso de conflictos de nombre. */
  readonly renamed: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/** Un formato del archivo cuyo nombre choca con uno que ya hay (o no es válido) y no es idéntico a ninguno. */
export interface NameConflict {
  /** Posición del formato en `content.formats`: la clave de `renames`. */
  readonly index: number;
  /** El nombre que se probó (el del archivo, o el último que escribió el usuario). */
  readonly name: string;
  /** La definición con ese nombre, para armar el texto de `name_taken` y compañía. */
  readonly definition: FormatDefinition;
  readonly code: "name_taken" | "name_empty" | "name_too_long";
}

export type ImportChange = Extract<DetectionChange, { readonly kind: "importFile" }>;

export interface ImportPlan {
  /** `null` si no entra nada: no se cuenta un cambio vacío. */
  readonly change: ImportChange | null;
  readonly summary: ImportSummary;
  /**
   * Formatos con conflicto de nombre (ADR-223 §6, `Components.md` §13b.4): hay que
   * resolverlos en su paso antes de importar. Con alguno, `change` es solo el
   * resto y no debe aplicarse hasta que la lista quede vacía.
   */
  readonly conflicts: ReadonlyArray<NameConflict>;
}

const NAME_CODES: ReadonlySet<string> = new Set(["name_taken", "name_empty", "name_too_long"]);

const SKIP_NO_NEW_FORMATS = "Ya tenías este tipo y el archivo no trae formatos para sumarle.";
const SKIP_UNKNOWN_REF = "El formato no existe en los catálogos de esta versión de Anonly.";
const SKIP_BASE_MISSING = "Es una copia de un formato del catálogo que esta versión no tiene.";
const SKIP_COPY_EXISTS = "Ya tenés una copia editada de ese formato del catálogo.";

function catalogName(id: string, state: DetectionState): string | undefined {
  const bare = id.startsWith("fmt:base:") ? id.slice("fmt:base:".length) : id;
  return getCatalog(state.country).find((info) => info.id === bare)?.name;
}

export function nameOfFormat(
  id: string,
  state: DetectionState,
  accepted: ReadonlyArray<FormatDefinition>,
): string {
  return (
    [...state.userFormats, ...accepted].find((format) => format.id === id)?.name ??
    catalogName(id, state) ??
    "otro formato"
  );
}

/**
 * Resuelve el archivo contra el borrador. `newId` da un UUID v4 (por defecto
 * `crypto.randomUUID`): los tipos y formatos importados llevan ids nuevos.
 */
export function planFormatsImport(
  content: FormatsFileContent,
  state: DetectionState,
  newId: () => string = () => crypto.randomUUID(),
  /** Nombres nuevos por posición en `content.formats`, del paso de conflictos de nombre. */
  renames: ReadonlyMap<number, string> = new Map(),
): ImportPlan {
  const imported: ImportedItem[] = [];
  const merged: ImportedItem[] = [];
  const skipped: SkippedItem[] = [];
  const conflicts: NameConflict[] = [];
  const renamed: { from: string; to: string }[] = [];

  // Tipos: misma etiqueta que uno existente → se suman a ese; si no, id nuevo.
  const existingByLabel = new Map<string, UserEntityTypeDefinition>(
    state.userTypes.map((type) => [userTypeLabel(type.name), type]),
  );
  const idMap = new Map<string, UserEntityTypeId>();
  const newTypes: UserEntityTypeDefinition[] = [];
  const mergedTypeIds = new Set<UserEntityTypeId>();
  for (const type of content.types) {
    const existing = existingByLabel.get(userTypeLabel(type.name));
    if (existing !== undefined) {
      idMap.set(type.id, existing.id);
      mergedTypeIds.add(existing.id);
      continue;
    }
    const created: UserEntityTypeDefinition = { ...type, id: `user:${newId()}` };
    idMap.set(type.id, created.id);
    newTypes.push(created);
    imported.push({ kind: "type", name: created.name });
  }
  const allTypes = [...state.userTypes, ...newTypes];

  const baseFormats = disabledBaseIds(state).map((formatId) => ({ formatId, enabled: false }));
  const catalog = getCatalog(state.country);
  const acceptedFormats: FormatDefinition[] = [];
  const formatsPerMergedType = new Map<UserEntityTypeId, number>();

  for (const [index, format] of content.formats.entries()) {
    const newName = renames.get(index);
    const mappedType = idMap.get(format.entityType) ?? format.entityType;
    const candidate: FormatDefinition = {
      ...format,
      ...(newName !== undefined ? { name: newName } : {}),
      id: `fmt:${newId()}`,
      entityType: mappedType,
      enabled: true,
    };

    if (candidate.basedOn !== undefined) {
      const basedOn = candidate.basedOn;
      const editable = catalog.some((info) => info.id === basedOn && info.kind === "structure");
      if (!editable) {
        skipped.push({ name: format.name, reason: SKIP_BASE_MISSING });
        continue;
      }
      const alreadyCopied = [...state.userFormats, ...acceptedFormats].some(
        (other) => other.basedOn === basedOn,
      );
      if (alreadyCopied) {
        skipped.push({ name: format.name, reason: SKIP_COPY_EXISTS });
        continue;
      }
    }

    const others = [...state.userFormats, ...acceptedFormats];
    const validation = validateFormat(candidate, {
      userTypes: allTypes,
      existingFormats: others.map(({ id, name }) => ({ id, name })),
    });
    const firstIssue = validation.issues[0];
    const onlyNameIssues =
      firstIssue !== undefined && validation.issues.every((issue) => NAME_CODES.has(issue.code));
    if (firstIssue !== undefined && !onlyNameIssues) {
      const why = formatIssueReason(firstIssue, candidate, allTypes);
      skipped.push({ name: format.name, reason: `${why.charAt(0).toUpperCase()}${why.slice(1)}.` });
      continue;
    }

    const comparison = compareFormat(candidate, {
      country: state.country,
      baseFormats,
      userFormats: others,
      catalogRefs: state.catalogRefs,
    });
    if (firstIssue !== undefined && comparison.identicalTo === null) {
      // Solo el nombre falla y no es idéntico: lo resuelve el usuario (ADR-223 §6).
      conflicts.push({
        index,
        name: candidate.name,
        definition: candidate,
        code: firstIssue.code as NameConflict["code"],
      });
      continue;
    }
    if (comparison.identicalTo !== null) {
      skipped.push({
        name: format.name,
        reason: `Es idéntico a «${nameOfFormat(comparison.identicalTo, state, acceptedFormats)}», que ya tenés.`,
      });
      continue;
    }

    acceptedFormats.push(candidate);
    if (newName !== undefined && newName !== format.name) {
      renamed.push({ from: format.name, to: newName });
    }
    const typeName = entityTypeName(mappedType, allTypes);
    const overlapsWith = comparison.overlaps.map((overlap) =>
      nameOfFormat(overlap.formatId, state, acceptedFormats),
    );
    const item: ImportedItem = {
      kind: "format",
      name: candidate.name,
      typeName,
      typeId: mappedType,
      ...(overlapsWith.length > 0
        ? { overlapsWith, overlapExamples: comparison.overlaps.map((overlap) => overlap.example) }
        : {}),
    };
    if (isUserEntityType(mappedType) && mergedTypeIds.has(mappedType)) {
      merged.push(item);
      formatsPerMergedType.set(mappedType, (formatsPerMergedType.get(mappedType) ?? 0) + 1);
    } else {
      imported.push(item);
    }
  }

  // Un tipo del archivo que ya existía y no aporta ningún formato nuevo.
  for (const type of content.types) {
    const target = idMap.get(type.id);
    if (target !== undefined && mergedTypeIds.has(target) && !formatsPerMergedType.has(target)) {
      skipped.push({ name: type.name, reason: SKIP_NO_NEW_FORMATS });
    }
  }

  // Referencias: en la 1.1 no hay otro catálogo, así que ninguna existe (ADR-221 §7).
  const refs: CatalogFormatRef[] = [];
  for (const ref of content.catalogRefs) {
    const exists =
      ref.country !== state.country &&
      getCatalog(ref.country).some((info) => info.id === ref.catalogFormatId);
    if (exists) refs.push({ ...ref, id: `ref:${newId()}`, enabled: true });
    else skipped.push({ name: ref.catalogFormatId, reason: SKIP_UNKNOWN_REF });
  }

  const nothingToAdd = newTypes.length === 0 && acceptedFormats.length === 0 && refs.length === 0;
  return {
    change: nothingToAdd
      ? null
      : { kind: "importFile", types: newTypes, formats: acceptedFormats, catalogRefs: refs },
    summary: { imported, merged, skipped, renamed },
    conflicts,
  };
}

/** «2 formatos y 1 tipo» de una lista de ítems importados. */
export function describeImportedItems(items: ReadonlyArray<ImportedItem>): string {
  const types = items.filter((item) => item.kind === "type").length;
  const formats = items.length - types;
  const parts: string[] = [];
  if (formats > 0) parts.push(`${formats} ${formats === 1 ? "formato" : "formatos"}`);
  if (types > 0) parts.push(`${types} ${types === 1 ? "tipo" : "tipos"}`);
  return parts.join(" y ");
}

/** Cuántos motivos muestra el rechazo antes de resumir el resto. */
export const MAX_REJECTION_MESSAGES = 5;

/** Los primeros motivos y cuántos quedaron afuera: el diálogo no crece con un archivo con muchos problemas. */
export function limitRejectionMessages(messages: ReadonlyArray<string>): {
  readonly shown: ReadonlyArray<string>;
  readonly hidden: number;
} {
  return {
    shown: messages.slice(0, MAX_REJECTION_MESSAGES),
    hidden: Math.max(0, messages.length - MAX_REJECTION_MESSAGES),
  };
}

/**
 * El aviso amarillo de un formato importado que comparte textos con otros: el
 * mismo texto que la caja de estado del generador (`describeOverlap`).
 */
export function describeOverlapWarning(item: ImportedItem): string {
  return describeOverlap(
    item.name,
    (item.overlapsWith ?? []).map((name, index) => {
      const example = item.overlapExamples?.[index];
      return example === undefined ? { name } : { name, example };
    }),
  );
}

/**
 * El punto de una fila del resultado: «own» (punteado) para un tipo propio o un
 * formato que quedó en uno (el nombre del tipo está entre los propios del
 * resumen), «other» para el resto, de quien el archivo no dice si es del catálogo.
 */
export function importRowDot(
  item: { readonly kind?: "type" | "format"; readonly typeName?: string },
  ownTypeNames: ReadonlySet<string>,
): "own" | "other" {
  if (item.kind === "type") return "own";
  return item.typeName !== undefined && ownTypeNames.has(item.typeName) ? "own" : "other";
}
