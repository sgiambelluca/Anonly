/**
 * `formatsExport.ts` — qué viaja en el archivo de formatos (ADR-223 §5,
 * `Components.md` §13b.4) y el modelo de las dos listas de
 * `ExportFormatsDialog`.
 *
 * Lo que viaja con cada elemento:
 * - **un tipo propio** viaja con todos sus formatos;
 * - **un formato de un tipo propio** viaja con su tipo;
 * - **un formato de un tipo base** viaja solo y nombra su tipo por el valor de
 *   `EntityType`;
 * - **una copia editada** viaja como formato propio, con su `basedOn`.
 *
 * No viajan el país ni el estado de los formatos base. Las referencias a otro
 * país (`catalogRefs`) no tienen lista: en la 1.1 no hay otro catálogo y el
 * archivo las lleva vacías.
 *
 * La selección es un conjunto de ids (de tipos y de formatos). El estado de la
 * casilla de un tipo con formatos sale de sus formatos; el de un tipo sin
 * formatos, de su propio id.
 */

import type {
  EntityTypeId,
  FormatDefinition,
  FormatsFileContent,
  UserEntityTypeDefinition,
} from "@anonly/anonymization-core";

import type { DetectionState } from "../../store/detectionState.js";

import { entityTypeName } from "./formatTexts.js";

export const FORMATS_FILE_NAME = "formatos.anonly-formatos";
export const FORMATS_FILE_MIME = "application/json";

export type ExportSelection = ReadonlySet<string>;

export interface ExportTypeEntry {
  readonly type: UserEntityTypeDefinition;
  readonly formats: ReadonlyArray<FormatDefinition>;
}

export interface ExportCatalogEntry {
  readonly format: FormatDefinition;
  /** El tipo base, para mostrar bajo el nombre. */
  readonly typeName: string;
}

export interface ExportLists {
  /** «Tus tipos · viajan con todos sus formatos». */
  readonly ownTypes: ReadonlyArray<ExportTypeEntry>;
  /** «Tuyos, en tipos del catálogo · viajan solos». */
  readonly catalogFormats: ReadonlyArray<ExportCatalogEntry>;
}

export function buildExportLists(state: DetectionState): ExportLists {
  const userTypeIds = new Set<EntityTypeId>(state.userTypes.map((type) => type.id));
  return {
    ownTypes: state.userTypes.map((type) => ({
      type,
      formats: state.userFormats.filter((format) => format.entityType === type.id),
    })),
    catalogFormats: state.userFormats
      .filter((format) => !userTypeIds.has(format.entityType))
      .map((format) => ({
        format,
        typeName: entityTypeName(format.entityType, state.userTypes),
      })),
  };
}

/** Todo lo que se puede elegir: ids de tipos y de formatos. */
export function allSelectable(lists: ExportLists): ExportSelection {
  return new Set<string>([
    ...lists.ownTypes.flatMap((entry) => [
      entry.type.id,
      ...entry.formats.map((format) => format.id),
    ]),
    ...lists.catalogFormats.map((entry) => entry.format.id),
  ]);
}

/** Estado de la casilla de un tipo: marcada, vacía o mixta (algunos de sus formatos). */
export function typeCheckState(
  entry: ExportTypeEntry,
  selection: ExportSelection,
): boolean | "indeterminate" {
  if (entry.formats.length === 0) return selection.has(entry.type.id);
  const chosen = entry.formats.filter((format) => selection.has(format.id)).length;
  if (chosen === 0) return false;
  return chosen === entry.formats.length ? true : "indeterminate";
}

/** Marca o desmarca un tipo con todos sus formatos. */
export function toggleType(
  selection: ExportSelection,
  entry: ExportTypeEntry,
  on: boolean,
): ExportSelection {
  const next = new Set(selection);
  for (const id of [entry.type.id, ...entry.formats.map((format) => format.id)]) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Marca o desmarca un formato suelto. */
export function toggleFormat(
  selection: ExportSelection,
  formatId: string,
  on: boolean,
): ExportSelection {
  const next = new Set(selection);
  if (on) next.add(formatId);
  else next.delete(formatId);
  return next;
}

/**
 * El contenido del archivo para la selección. Un formato elegido de un tipo
 * propio lleva su tipo; un tipo elegido sin formatos viaja solo.
 */
export function buildFormatsFile(
  state: DetectionState,
  selection: ExportSelection,
): FormatsFileContent {
  const formats = state.userFormats.filter((format) => selection.has(format.id));
  const carriedTypeIds = new Set<EntityTypeId>(formats.map((format) => format.entityType));
  const types = state.userTypes.filter(
    (type) => carriedTypeIds.has(type.id) || selection.has(type.id),
  );
  return { kind: "anonly-formats", version: 1, types, formats, catalogRefs: [] };
}

export function serializeFormatsFile(content: FormatsFileContent): string {
  return JSON.stringify(content, null, 2);
}

/** El resumen del pie: «2 tipos y 3 formatos». `null` sin selección (el botón queda apagado). */
export function describeExportSelection(content: FormatsFileContent): string | null {
  if (content.types.length === 0 && content.formats.length === 0) return null;
  const parts: string[] = [];
  if (content.types.length > 0) {
    parts.push(`${content.types.length} ${content.types.length === 1 ? "tipo" : "tipos"}`);
  }
  if (content.formats.length > 0) {
    parts.push(
      `${content.formats.length} ${content.formats.length === 1 ? "formato" : "formatos"}`,
    );
  }
  return parts.join(" y ");
}
