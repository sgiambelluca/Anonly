/**
 * `entityTree.ts` — cómputo puro para el árbol de `EntitiesPanel`
 * (`ui/Components.md` §3.1-§3.3, `ui/UX_Guidelines.md` §3).
 *
 * Separado de los componentes React a propósito: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que la única forma
 * de testear esta lógica es extraerla de cualquier código que dependa del DOM
 * (mismo criterio que `components/viewer/visibleRange.ts`).
 */

import {
  isUserEntityType,
  PipelineStage,
  type EntityGroup,
  type EntityTypeId,
} from "@anonly/anonymization-core";

import type { EntitySortOrder } from "../../store/entities.store.js";

/** Búsqueda de `ui/UX_Guidelines.md` §3.2: filtra por `canonicalValue` o `aliases`, case-insensitive. */
export function filterGroups(
  groups: ReadonlyArray<EntityGroup>,
  query: string,
): ReadonlyArray<EntityGroup> {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return groups;
  return groups.filter((group) => groupMatchesQuery(group, normalized));
}

function groupMatchesQuery(group: EntityGroup, normalizedQuery: string): boolean {
  if (group.canonicalValue.toLowerCase().includes(normalizedQuery)) return true;
  return group.aliases.some((alias) => alias.toLowerCase().includes(normalizedQuery));
}

export type CascadeCheckboxState = boolean | "indeterminate";

/**
 * Estado tri-valuado del checkbox de cabecera de `EntityTypeGroup`
 * (`ui/Components.md` §3.2: "Checkbox cabecera → ... para todos los grupos del
 * tipo"; `ui/Components.md` §8.4 documenta el wrapper `Checkbox` con soporte
 * `indeterminate`).
 */
export function cascadeCheckboxState(groups: ReadonlyArray<EntityGroup>): CascadeCheckboxState {
  if (groups.length === 0) return false;
  const enabledCount = groups.filter((group) => group.enabled).length;
  if (enabledCount === 0) return false;
  if (enabledCount === groups.length) return true;
  return "indeterminate";
}

export interface TypeEntryOptions {
  /** Los tipos propios en el orden en que se muestran (`mergeUserTypes`): primero guardados, después del documento. */
  readonly userTypeOrder?: ReadonlyArray<EntityTypeId>;
  /** Tipos que se muestran aunque no tengan grupos: los del documento (`React_Client.md` §3.9). */
  readonly alwaysShow?: ReadonlySet<EntityTypeId>;
}

/**
 * Entradas del árbol: **primero los tipos propios, después los del catálogo**
 * (`Components.md` §13b.6). De los tipos propios se muestran los del documento
 * aunque no tengan grupos (`alwaysShow`) y los guardados solo si tienen alguno
 * (`React_Client.md` §3.9). Los del catálogo, solo con grupos, en el orden fijo
 * del `Map` (`entities.store.ts`, `ui/Components.md` §3.1).
 */
export function visibleTypeEntries(
  groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>,
  sortOrder: EntitySortOrder = "appearance",
  options: TypeEntryOptions = {},
): ReadonlyArray<readonly [EntityTypeId, ReadonlyArray<EntityGroup>]> {
  const order = options.userTypeOrder ?? [];
  const alwaysShow = options.alwaysShow ?? new Set<EntityTypeId>();
  const entries: Array<readonly [EntityTypeId, ReadonlyArray<EntityGroup>]> = [];

  const known = new Set<EntityTypeId>(order);
  const userIds: EntityTypeId[] = [
    ...order,
    // Un grupo de un tipo propio que la interfaz no conoce: se muestra igual, al final de los propios.
    ...Array.from(groupsByType.keys()).filter((type) => isUserEntityType(type) && !known.has(type)),
  ];
  for (const type of userIds) {
    const groups = groupsByType.get(type) ?? [];
    if (groups.length > 0 || alwaysShow.has(type))
      entries.push([type, sortGroups(groups, sortOrder)]);
  }
  for (const [type, groups] of groupsByType) {
    if (isUserEntityType(type) || groups.length === 0) continue;
    entries.push([type, sortGroups(groups, sortOrder)]);
  }
  return entries;
}

/**
 * ADR-169 §2: orden de las filas dentro de cada tipo. **Solo presentación**:
 * no cambia `indexInType` ni emite nada al Core.
 *
 * - `"appearance"`: `indexInType` ascendente (el orden del documento).
 * - `"alpha"`: `canonicalValue` con `localeCompare(…, "es")` — "Álvarez" va
 *   con las A, no después de la Z. Desempate por `indexInType` para que dos
 *   nombres iguales no bailen entre renders.
 */
export function sortGroups(
  groups: ReadonlyArray<EntityGroup>,
  sortOrder: EntitySortOrder,
): ReadonlyArray<EntityGroup> {
  if (sortOrder === "appearance") return sortByDocumentOrder(groups);
  return [...groups].sort(
    (a, b) =>
      a.canonicalValue.localeCompare(b.canonicalValue, "es", { sensitivity: "base" }) ||
      a.indexInType - b.indexInType ||
      a.id.localeCompare(b.id),
  );
}

/**
 * ADR-169 §2 + ADR-087 §6.1: el N.º (y el token) no se muestran hasta que la
 * pasada de detección terminó — durante el escaneo cada entidad nueva renumera
 * los índices, y la columna sería el único lugar donde eso se vería. Vuelve a
 * ocultarse durante un re-análisis por la misma razón.
 */
const INDEX_VISIBLE_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Ready,
  PipelineStage.Rendering,
  PipelineStage.Exporting,
  PipelineStage.Done,
]);

export function isIndexInTypeVisible(stage: PipelineStage): boolean {
  return INDEX_VISIBLE_STAGES.has(stage);
}

/** Resumen de la cabecera del panel: "12 entidades en 4 tipos" (ADR-169 §2). */
export function summarizeEntities(
  entries: ReadonlyArray<readonly [EntityTypeId, ReadonlyArray<EntityGroup>]>,
): string {
  const total = entries.reduce((sum, [, groups]) => sum + groups.length, 0);
  // Un tipo del documento sin entidades se muestra pero no cuenta como tipo con entidades.
  const types = entries.filter(([, groups]) => groups.length > 0).length;
  return `${total} ${total === 1 ? "entidad" : "entidades"} en ${types} ${
    types === 1 ? "tipo" : "tipos"
  }`;
}

/*
 * El store acumula por orden de LLEGADA (`entities.store.ts#addGroup`:
 * `[...bucket, group]`), y eso coincidía con el orden del documento **por
 * accidente**, porque todo el pipeline corría en serie. ADR-101 paralelizó el
 * despacho de OCR y el accidente se terminó: las entidades empezaron a
 * aparecer en la lista en el orden en que el motor las encontró, con sus
 * números salteados.
 *
 * `indexInType` es la fuente correcta: ADR-028 lo renumera canónicamente por
 * **primera aparición documental** antes de `GROUPING_FINISHED`, justamente
 * porque el orden de llegada de `ENTITY_FOUND` ya se declaraba
 * no-determinístico. O sea que el dato siempre estuvo bien y lo único que
 * faltaba era que la lista lo respetara.
 *
 * Desempate por `id` para que el orden sea estable mientras el pipeline
 * todavía corre y hay grupos con índice provisional.
 */
function sortByDocumentOrder(groups: ReadonlyArray<EntityGroup>): ReadonlyArray<EntityGroup> {
  return [...groups].sort((a, b) => a.indexInType - b.indexInType || a.id.localeCompare(b.id));
}

/** Busca un `EntityGroup` por `id` en cualquier bucket de tipo. `undefined` si no existe. */
export function findGroupById(
  groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>,
  groupId: string,
): EntityGroup | undefined {
  for (const groups of groupsByType.values()) {
    const found = groups.find((group) => group.id === groupId);
    if (found) return found;
  }
  return undefined;
}

/** `true` si hay al menos un grupo en cualquier tipo (`App.tsx` decide con esto si monta `EntitiesPanel`). */
export function hasAnyGroup(
  groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>,
): boolean {
  for (const groups of groupsByType.values()) {
    if (groups.length > 0) return true;
  }
  return false;
}

/** Los grupos de un tipo repartidos en niveles (`FormatSubgroup`, ADR-226 §2). */
export interface TypeLevels {
  /** Van directo bajo el tipo: sin formato, o con un formato del catálogo. */
  readonly direct: ReadonlyArray<EntityGroup>;
  /** Uno por formato del usuario, en el orden de su primer grupo. Vacío si el subnivel no separa nada. */
  readonly subgroups: ReadonlyArray<{
    readonly formatId: string;
    readonly groups: ReadonlyArray<EntityGroup>;
  }>;
}

/**
 * ADR-226 §2: los grupos cuyo formato es del usuario van en un subnivel con el
 * nombre del formato; el resto, directo bajo el tipo y primero. **El subnivel
 * aparece solo si separa algo**: un tipo cuyo contenido sale todo de un único
 * formato del usuario no lo muestra (tampoco uno sin ningún formato del usuario).
 * Los grupos llegan en el orden de la vista (aparición o A–Z) y lo conservan
 * dentro de cada nivel.
 */
export function splitByFormat(
  groups: ReadonlyArray<EntityGroup>,
  isUserFormat: (formatId: string) => boolean,
): TypeLevels {
  const direct: EntityGroup[] = [];
  const byFormat = new Map<string, EntityGroup[]>();
  for (const group of groups) {
    const formatId = group.formatId;
    if (formatId === undefined || !isUserFormat(formatId)) {
      direct.push(group);
      continue;
    }
    const bucket = byFormat.get(formatId);
    if (bucket === undefined) byFormat.set(formatId, [group]);
    else bucket.push(group);
  }
  const levels = (direct.length > 0 ? 1 : 0) + byFormat.size;
  if (byFormat.size === 0 || levels < 2) return { direct: groups, subgroups: [] };
  return {
    direct,
    subgroups: Array.from(byFormat, ([formatId, members]) => ({ formatId, groups: members })),
  };
}

/** Los grupos en el orden en que se dibujan: los directos y después cada subnivel. */
export function levelsInOrder(levels: TypeLevels): ReadonlyArray<EntityGroup> {
  return [...levels.direct, ...levels.subgroups.flatMap((subgroup) => subgroup.groups)];
}
