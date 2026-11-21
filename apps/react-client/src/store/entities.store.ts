/**
 * `entities.store.ts` — árbol de grupos de entidades + conflictos (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.2. Orden fijo de tipos:
 * docs/ui/Components.md §3.1 ("Person, Organization, Address, DNI, CUIT,
 * Phone, Email, IBAN, CreditCard, Date, License, Plate, Custom").
 *
 * Placeholder de Hito 10 PR1 (scaffold): store puramente local, sin conexión
 * al bus todavía (eso es `bus-bridge.ts`, PR5 `core-adapter`).
 */

import {
  EntityType,
  type Conflict,
  type EntityGroup,
  type EntityTypeId,
  type ReplacementMode,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";
import { create } from "zustand";

import { reconcileDocumentTypes, type DocumentTypesPort } from "./documentTypes.js";

/**
 * Los filtros del panel (`React_Client.md` §3.10, ADR-224 §3). Dentro de un
 * conjunto alcanza con una opción; entre conjuntos hay que cumplir todos.
 */
export type ReviewFilter = "disabled" | "conflict" | "manual";

export interface EntityFilters {
  /** «Tus formatos»: solo ids de formatos del usuario (ADR-226 §3). */
  readonly formatIds: ReadonlySet<string>;
  /** «Modo de reemplazo». */
  readonly modes: ReadonlySet<ReplacementMode>;
  /** «Para revisar». */
  readonly review: ReadonlySet<ReviewFilter>;
}

export const NO_FILTERS: EntityFilters = {
  formatIds: new Set(),
  modes: new Set(),
  review: new Set(),
};

export interface EntitiesSlice {
  /** Indexado por `EntityTypeId` (ADR-219 §1): los tipos propios se agregan al llegar su primer grupo. */
  readonly groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>;
  readonly conflicts: ReadonlyArray<Conflict>;
  addGroup(group: EntityGroup): void;
  updateGroup(group: EntityGroup): void;
  removeGroup(groupId: string): void;
  updateReplacement(groupId: string, mode: ReplacementMode, value: string): void;
  addConflict(conflict: Conflict): void;
  /** `resolvedType` (ADR-083 §3): el tipo con el que quedó clasificado el grupo. */
  resolveConflict(conflictId: string, resolvedType?: EntityTypeId): void;
  /**
   * ADR-169 §2: orden de presentación de las filas. **Solo UI**: no cambia
   * `indexInType` ni emite nada al Core. Vale para todos los tipos y se
   * recuerda mientras la app está abierta — `reset()` (cerrar el documento) no
   * lo toca, y no persiste.
   */
  readonly sortOrder: EntitySortOrder;
  setSortOrder(order: EntitySortOrder): void;
  /**
   * ADR-169 §7: grupo a llevar a la vista y resaltar un momento ("Ver en la
   * lista" del toast de un agregado). `null` cuando no hay nada que resaltar.
   */
  readonly flashGroupId: string | null;
  setFlashGroupId(groupId: string | null): void;
  /** Espejo de `orchestrator.getDocumentEntityTypes(documentId)`, en orden de creación (§3.9). */
  readonly documentTypes: ReadonlyArray<UserEntityTypeDefinition>;
  /** Tipos del documento que el usuario guardó durante este documento (ADR-225 §5). */
  readonly savedDuringDocument: ReadonlySet<UserEntityTypeId>;
  /**
   * Vuelve a leer los tipos del documento. El Core no emite eventos por las
   * definiciones (ADR-225 §6): se llama después de cada acción que las toca y de
   * `undo`/`redo`. Si una restauración se llevó un tipo que el usuario guardó
   * durante el documento, lo vuelve a definir (invariante de ADR-225 §6).
   */
  refreshDocumentTypes(): void;
  /** Reemplaza el espejo tal cual: lo usa `refreshDocumentTypes` y las pruebas. */
  setDocumentTypes(types: ReadonlyArray<UserEntityTypeDefinition>): void;
  markTypeSaved(id: UserEntityTypeId): void;
  unmarkTypeSaved(id: UserEntityTypeId): void;
  /** Filtros del panel (§3.10): de la interfaz, no emiten nada ni entran a la pila de deshacer. */
  readonly filters: EntityFilters;
  setFilters(filters: EntityFilters): void;
  clearFilters(): void;
  reset(): void;
}

let documentTypesPort: DocumentTypesPort | null = null;

/**
 * El acceso al Core para leer y volver a definir los tipos del documento. Lo
 * registra `core-adapter`: este store no importa el adaptador (los workers de
 * `?worker` no cargan en Node) y se prueba con un puerto falso.
 */
export function setDocumentTypesPort(port: DocumentTypesPort | null): void {
  documentTypesPort = port;
}

/** `"appearance"` = `indexInType` ascendente; `"alpha"` = `canonicalValue` A–Z (ADR-169 §2). */
export type EntitySortOrder = "appearance" | "alpha";

// Orden fijo de ui/Components.md §3.1.
const ENTITY_TYPE_ORDER: ReadonlyArray<EntityType> = [
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
  EntityType.DNI,
  EntityType.CUIT,
  EntityType.Phone,
  EntityType.Email,
  EntityType.IBAN,
  EntityType.CreditCard,
  EntityType.Date,
  EntityType.License,
  EntityType.Plate,
  EntityType.Custom,
];

function emptyGroupsByType(): ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>> {
  return new Map(ENTITY_TYPE_ORDER.map((type) => [type, []]));
}

/** Busca en qué bucket de tipo vive un `groupId`; `undefined` si no existe. */
function findGroupType(
  groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>,
  groupId: string,
): EntityTypeId | undefined {
  for (const [type, groups] of groupsByType) {
    if (groups.some((group) => group.id === groupId)) return type;
  }
  return undefined;
}

/** ADR-175 §1 / ADR-191 §3: ningún camino deja `resolved: true` con `heldManual`. */
function withoutHeldManual(conflict: Conflict): Conflict {
  const { heldManual: _heldManual, ...rest } = conflict;
  return rest;
}

type EntitiesData = Pick<
  EntitiesSlice,
  | "groupsByType"
  | "conflicts"
  | "sortOrder"
  | "flashGroupId"
  | "documentTypes"
  | "savedDuringDocument"
  | "filters"
>;

const initialState: EntitiesData = {
  groupsByType: emptyGroupsByType(),
  conflicts: [],
  sortOrder: "appearance",
  flashGroupId: null,
  documentTypes: [],
  savedDuringDocument: new Set(),
  filters: NO_FILTERS,
};

export const useEntitiesStore = create<EntitiesSlice>((set, get) => ({
  ...initialState,
  addGroup(group) {
    set((state) => {
      const next = new Map(state.groupsByType);
      const bucket = next.get(group.type) ?? [];
      next.set(group.type, [...bucket, group]);
      return { groupsByType: next };
    });
  },
  updateGroup(group) {
    set((state) => {
      // ADR-082: el grupo puede haber CAMBIADO de tipo, así que el bucket
      // donde está hoy y el bucket al que pertenece pueden ser distintos.
      // Reemplazarlo solo en el bucket viejo lo dejaba dentro de la categoría
      // equivocada del árbol para siempre, aunque el motor ya lo hubiera
      // reclasificado bien.
      const previousType = findGroupType(state.groupsByType, group.id);
      const next = new Map(state.groupsByType);

      if (previousType !== undefined && previousType !== group.type) {
        next.set(
          previousType,
          (state.groupsByType.get(previousType) ?? []).filter((g) => g.id !== group.id),
        );
      }

      const targetType = group.type;
      const targetBucket = next.get(targetType) ?? [];
      next.set(
        targetType,
        targetBucket.some((g) => g.id === group.id)
          ? targetBucket.map((existing) => (existing.id === group.id ? group : existing))
          : [...targetBucket, group],
      );
      return { groupsByType: next };
    });
  },
  removeGroup(groupId) {
    set((state) => {
      const type = findGroupType(state.groupsByType, groupId);
      if (type === undefined) return state;
      const bucket = state.groupsByType.get(type) ?? [];
      const next = new Map(state.groupsByType);
      next.set(
        type,
        bucket.filter((group) => group.id !== groupId),
      );
      return { groupsByType: next };
    });
  },
  updateReplacement(groupId, mode, value) {
    set((state) => {
      const type = findGroupType(state.groupsByType, groupId);
      if (type === undefined) return state;
      const bucket = state.groupsByType.get(type) ?? [];
      const next = new Map(state.groupsByType);
      next.set(
        type,
        bucket.map((group) =>
          group.id === groupId
            ? { ...group, replacementMode: mode, replacementValue: value }
            : group,
        ),
      );
      return { groupsByType: next };
    });
  },
  addConflict(conflict) {
    // ADR-191 §3: CONFLICT_DETECTED es idempotente por `id`; reemplaza en el lugar.
    set((state) => ({
      conflicts: state.conflicts.some((existing) => existing.id === conflict.id)
        ? state.conflicts.map((existing) => (existing.id === conflict.id ? conflict : existing))
        : [...state.conflicts, conflict],
    }));
  },
  resolveConflict(conflictId, resolvedType) {
    set((state) => ({
      conflicts: state.conflicts.map((conflict) =>
        conflict.id === conflictId
          ? {
              ...withoutHeldManual(conflict),
              resolved: true,
              // ADR-083 §3: el tipo con el que quedó clasificado el grupo. Sin
              // esto, el diálogo muestra el `resolvedType` que traía el
              // `CONFLICT_DETECTED` original — el tipo VIEJO.
              ...(resolvedType !== undefined ? { resolvedType } : {}),
            }
          : conflict,
      ),
    }));
  },
  setSortOrder(order) {
    set({ sortOrder: order });
  },
  setFlashGroupId(groupId) {
    set({ flashGroupId: groupId });
  },
  refreshDocumentTypes() {
    if (documentTypesPort === null) return;
    const types = reconcileDocumentTypes(documentTypesPort, get().savedDuringDocument);
    set({ documentTypes: types });
  },
  setDocumentTypes(types) {
    set({ documentTypes: types });
  },
  markTypeSaved(id) {
    set((state) => ({ savedDuringDocument: new Set([...state.savedDuringDocument, id]) }));
  },
  unmarkTypeSaved(id) {
    set((state) => {
      if (!state.savedDuringDocument.has(id)) return state;
      const next = new Set(state.savedDuringDocument);
      next.delete(id);
      return { savedDuringDocument: next };
    });
  },
  setFilters(filters) {
    set({ filters });
  },
  clearFilters() {
    set({ filters: NO_FILTERS });
  },
  reset() {
    // `sortOrder` se conserva: es una preferencia de la sesión de la app, no
    // del documento (ADR-169 §2). Los filtros duran lo que dura el documento (§3.10).
    set({
      groupsByType: emptyGroupsByType(),
      conflicts: [],
      flashGroupId: null,
      documentTypes: [],
      savedDuringDocument: new Set(),
      filters: NO_FILTERS,
    });
  },
}));

/**
 * ¿Esta página tiene alguna entidad? (ADR-190 §4, `ui/Components.md` §5.4 y
 * §7.1 — misma regla en el aviso de `PageCanvas` y en la lista de pendientes
 * de `ExportDialog`.) Cuenta cualquier miembro con ese `pageIndex`,
 * automático o manual, del grupo esté `enabled` o no: lo que importa acá es
 * si hay algo marcado sobre la página, no si se está tapando.
 *
 * Un grupo eliminado (ADR-171/ADR-177) no ocupa lugar en `groupsByType`
 * —`removeGroup` lo saca del todo—, así que no hace falta filtrarlo acá: todo
 * lo que este mapa contiene ya es "no eliminado".
 */
export function pageHasEntity(
  groupsByType: ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>>,
  pageIndex: number,
): boolean {
  for (const groups of groupsByType.values()) {
    for (const group of groups) {
      if (group.members.some((member) => member.pageIndex === pageIndex)) return true;
    }
  }
  return false;
}
