/**
 * `formatsTree.ts` — el modelo del árbol tipo → formatos de
 * `DetectionFormatsDialog` (`Components.md` §13b.2, ADR-227 §2).
 *
 * Función pura de un `DetectionState` (el borrador) y la búsqueda: arma las tres
 * secciones —«Tus tipos», «Tipos del catálogo» y «Tipos fijos del catálogo»—,
 * las bandas de cada tipo, las filas de cada formato y el conteo de la barra.
 * Los componentes solo dibujan lo que sale de acá.
 *
 * - Un formato base con **copia editada** se muestra como la copia («Editado»);
 *   «Restaurar original» la borra y vuelve el base (ADR-220 §4).
 * - **Tipos del catálogo** son los que admiten formatos propios
 *   (`FORMAT_ADMITTING_BASE_TYPES`); **fijos**, los demás con formatos base.
 * - La búsqueda no distingue mayúsculas ni tildes (`normalizeForComparison`) y
 *   mira el nombre del tipo y el de cada formato.
 */

import {
  FORMAT_ADMITTING_BASE_TYPES,
  getCatalog,
  normalizeForComparison,
  type CatalogFormatInfo,
  type EntityType,
  type EntityTypeId,
  type FormatDefinition,
  type UserEntityTypeDefinition,
} from "@anonly/anonymization-core";

import { disabledBaseIds, type DetectionState } from "../../store/detectionState.js";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_ORDER } from "../entities/entityTypeLabels.js";

import { baseFormatExample, buildFormatExample } from "./formatExamples.js";
import {
  BASE_CONTROL_LABEL,
  BASE_STRUCTURE_LABEL,
  NO_PENDING_CHANGES,
  SECTION_HINTS,
} from "./formatTexts.js";

export type FormatTag = "Tuyo" | "Editado" | "Del catálogo" | "Con control";

export interface FormatRowModel {
  /** Id del formato: el de la copia o del propio, o el del catálogo para un base. */
  readonly id: string;
  readonly source: "base" | "user";
  readonly name: string;
  /** Qué clase de formato es, debajo del nombre. */
  readonly classLabel: string;
  readonly example: string;
  readonly tag: FormatTag;
  readonly enabled: boolean;
  /** «Editar»: propios y copias; los base de pura forma (como copia). Los de control, no. */
  readonly canEdit: boolean;
  /** «Restaurar original»: solo una copia editada. */
  readonly canRestore: boolean;
  /** «Borrar formato»: solo un formato propio (no una copia). */
  readonly canDelete: boolean;
}

export interface TypeBandModel {
  readonly key: string;
  readonly entityType: EntityTypeId;
  readonly name: string;
  readonly isUser: boolean;
  /** «Nuevo formato»: tipo propio o uno de `FORMAT_ADMITTING_BASE_TYPES`. */
  readonly admitsFormats: boolean;
  readonly rows: ReadonlyArray<FormatRowModel>;
  /** «3 formatos · 1 apagado». */
  readonly summary: string;
}

export type FormatsSectionId = "own" | "catalog" | "fixed";

export interface FormatsSectionModel {
  readonly id: FormatsSectionId;
  readonly title: string;
  /** La aclaración gris junto al título; vacía si la sección no la lleva. */
  readonly hint: string;
  readonly bands: ReadonlyArray<TypeBandModel>;
}

export interface FormatsTreeModel {
  readonly sections: ReadonlyArray<FormatsSectionModel>;
  /** «N prendidos · N apagados · N tuyos»: sobre todo el árbol, con o sin búsqueda. */
  readonly counts: { readonly on: number; readonly off: number; readonly own: number };
  /** `false` con búsqueda sin resultados. */
  readonly hasResults: boolean;
}

export const SECTION_TITLES: Readonly<Record<FormatsSectionId, string>> = {
  own: "Tus tipos",
  catalog: "Tipos del catálogo",
  fixed: "Tipos fijos del catálogo",
};

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** «3 formatos · 1 apagado»; sin formatos, «Sin formatos». */
export function summarizeBand(rows: ReadonlyArray<FormatRowModel>): string {
  if (rows.length === 0) return "Sin formatos";
  const off = rows.filter((row) => !row.enabled).length;
  const head = pluralize(rows.length, "formato", "formatos");
  return off === 0 ? head : `${head} · ${pluralize(off, "apagado", "apagados")}`;
}

function variantsLabel(definition: FormatDefinition): string {
  return pluralize(definition.variants.length, "variante", "variantes");
}

function userRow(
  definition: FormatDefinition,
  catalog: ReadonlyArray<CatalogFormatInfo>,
): FormatRowModel {
  const original =
    definition.basedOn === undefined
      ? undefined
      : catalog.find((info) => info.id === definition.basedOn);
  const isCopy = definition.basedOn !== undefined;
  return {
    id: definition.id,
    source: "user",
    name: definition.name,
    classLabel: isCopy
      ? `Copia editada de «${original?.name ?? "un formato del catálogo"}»`
      : variantsLabel(definition),
    example: buildFormatExample(definition),
    tag: isCopy ? "Editado" : "Tuyo",
    enabled: definition.enabled,
    canEdit: true,
    canRestore: isCopy,
    canDelete: !isCopy,
  };
}

function baseRow(info: CatalogFormatInfo, enabled: boolean): FormatRowModel {
  const isStructure = info.kind === "structure";
  return {
    id: info.id,
    source: "base",
    name: info.name,
    classLabel: isStructure ? BASE_STRUCTURE_LABEL : BASE_CONTROL_LABEL,
    example: baseFormatExample(info.id),
    tag: isStructure ? "Del catálogo" : "Con control",
    enabled,
    canEdit: isStructure,
    canRestore: false,
    canDelete: false,
  };
}

/** Las filas de un tipo base: el catálogo (o su copia editada) y los formatos propios del tipo. */
function baseTypeRows(type: EntityType, state: DetectionState): ReadonlyArray<FormatRowModel> {
  const catalog = getCatalog(state.country);
  const disabled = new Set(disabledBaseIds(state));
  const rows: FormatRowModel[] = [];
  for (const info of catalog) {
    if (info.entityType !== type) continue;
    const copy = state.userFormats.find((format) => format.basedOn === info.id);
    rows.push(copy === undefined ? baseRow(info, !disabled.has(info.id)) : userRow(copy, catalog));
  }
  for (const format of state.userFormats) {
    if (format.entityType === type && format.basedOn === undefined) {
      rows.push(userRow(format, catalog));
    }
  }
  return rows;
}

function userTypeBand(type: UserEntityTypeDefinition, state: DetectionState): TypeBandModel {
  const catalog = getCatalog(state.country);
  const rows = state.userFormats
    .filter((format) => format.entityType === type.id)
    .map((format) => userRow(format, catalog));
  return {
    key: type.id,
    entityType: type.id,
    name: type.name,
    isUser: true,
    admitsFormats: true,
    rows,
    summary: summarizeBand(rows),
  };
}

function baseTypeBand(type: EntityType, state: DetectionState): TypeBandModel {
  const rows = baseTypeRows(type, state);
  return {
    key: type,
    entityType: type,
    name: ENTITY_TYPE_LABEL[type],
    isUser: false,
    admitsFormats: FORMAT_ADMITTING_BASE_TYPES.has(type),
    rows,
    summary: summarizeBand(rows),
  };
}

function matches(text: string, normalizedQuery: string): boolean {
  return normalizeForComparison(text).includes(normalizedQuery);
}

/** Aplica la búsqueda a una banda: la banda entera si coincide su nombre, o solo sus filas que coinciden. */
function filterBand(band: TypeBandModel, normalizedQuery: string): TypeBandModel | null {
  if (normalizedQuery === "" || matches(band.name, normalizedQuery)) return band;
  const rows = band.rows.filter((row) => matches(row.name, normalizedQuery));
  return rows.length === 0 ? null : { ...band, rows };
}

/**
 * Arma el árbol del borrador. Con búsqueda, las bandas y filas que no coinciden
 * se ocultan, y una sección sin resultados desaparece; sin búsqueda, «Tus tipos»
 * siempre está (lleva la banda punteada «Nuevo tipo»).
 */
export function buildFormatsTree(state: DetectionState, query: string): FormatsTreeModel {
  const normalizedQuery = normalizeForComparison(query);
  const searching = normalizedQuery !== "";

  const own = state.userTypes.map((type) => userTypeBand(type, state));
  const catalogTypes = ENTITY_TYPE_ORDER.filter((type) => FORMAT_ADMITTING_BASE_TYPES.has(type));
  const catalog = catalogTypes.map((type) => baseTypeBand(type, state));
  const fixed = ENTITY_TYPE_ORDER.filter((type) => !FORMAT_ADMITTING_BASE_TYPES.has(type))
    .map((type) => baseTypeBand(type, state))
    .filter((band) => band.rows.length > 0);

  const allRows = [...own, ...catalog, ...fixed].flatMap((band) => band.rows);
  const counts = {
    on: allRows.filter((row) => row.enabled).length,
    off: allRows.filter((row) => !row.enabled).length,
    own: allRows.filter((row) => row.source === "user").length,
  };

  function visible(bands: ReadonlyArray<TypeBandModel>): ReadonlyArray<TypeBandModel> {
    return bands.flatMap((band) => {
      const filtered = filterBand(band, normalizedQuery);
      return filtered === null ? [] : [filtered];
    });
  }

  const all: ReadonlyArray<FormatsSectionModel> = [
    { id: "own", title: SECTION_TITLES.own, hint: SECTION_HINTS.own, bands: visible(own) },
    {
      id: "catalog",
      title: SECTION_TITLES.catalog,
      hint: SECTION_HINTS.catalog,
      bands: visible(catalog),
    },
    { id: "fixed", title: SECTION_TITLES.fixed, hint: "", bands: visible(fixed) },
  ];
  // Sin búsqueda, «Tus tipos» siempre está (lleva la banda punteada «Nuevo tipo»).
  const sections = all.filter(
    (section) => (!searching && section.id === "own") || section.bands.length > 0,
  );

  return {
    sections,
    counts,
    hasResults: sections.some((section) => section.bands.length > 0),
  };
}

/** «N prendidos · N apagados · N tuyos». */
export function describeCounts(counts: FormatsTreeModel["counts"]): string {
  return `${counts.on} prendidos · ${counts.off} apagados · ${counts.own} tuyos`;
}

/** El resumen de «N cambios sin guardar» del pie. */
export function describePendingChanges(count: number): string {
  if (count === 0) return NO_PENDING_CHANGES;
  return count === 1 ? "1 cambio sin guardar" : `${count} cambios sin guardar`;
}

/** Los formatos que se borran con un tipo propio (`DeleteUserTypeDialog`, ADR-223 §4). */
export function formatsOfType(
  state: DetectionState,
  typeId: EntityTypeId,
): ReadonlyArray<FormatDefinition> {
  return state.userFormats.filter((format) => format.entityType === typeId);
}

const COUNTRY_NAME: Readonly<Record<DetectionState["country"], string>> = { AR: "Argentina" };

/**
 * El texto de la tarjeta de detección de `LoadScreen` (`Components.md` §13b.1).
 * N cuenta formatos propios, copias editadas y referencias (ADR-226 §1).
 */
export function describeDetectionCard(saved: DetectionState): string {
  const own = saved.userFormats.length + saved.catalogRefs.length;
  const country = COUNTRY_NAME[saved.country];
  return own > 0
    ? `Formatos de ${country}, ${pluralize(own, "tuyo", "tuyos")} y un modelo que reconoce nombres.`
    : `Formatos de ${country} para DNI y CUIT, y un modelo que reconoce nombres.`;
}
