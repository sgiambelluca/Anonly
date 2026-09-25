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
  type ReplacementMode,
} from "@anonly/anonymization-core";
import { create } from "zustand";

export interface EntitiesSlice {
  readonly groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>;
  readonly conflicts: ReadonlyArray<Conflict>;
  addGroup(group: EntityGroup): void;
  updateGroup(group: EntityGroup): void;
  removeGroup(groupId: string): void;
  updateReplacement(groupId: string, mode: ReplacementMode, value: string): void;
  addConflict(conflict: Conflict): void;
  /** `resolvedType` (ADR-083 §3): el tipo con el que quedó clasificado el grupo. */
  resolveConflict(conflictId: string, resolvedType?: EntityType): void;
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
  reset(): void;
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

function emptyGroupsByType(): ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>> {
  return new Map(ENTITY_TYPE_ORDER.map((type) => [type, []]));
}

/** Busca en qué bucket de tipo vive un `groupId`; `undefined` si no existe. */
function findGroupType(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
  groupId: string,
): EntityType | undefined {
  for (const [type, groups] of groupsByType) {
    if (groups.some((group) => group.id === groupId)) return type;
  }
  return undefined;
}

type EntitiesData = Pick<
  EntitiesSlice,
  "groupsByType" | "conflicts" | "sortOrder" | "flashGroupId"
>;

const initialState: EntitiesData = {
  groupsByType: emptyGroupsByType(),
  conflicts: [],
  sortOrder: "appearance",
  flashGroupId: null,
};

export const useEntitiesStore = create<EntitiesSlice>((set) => ({
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

      const targetBucket = next.get(group.type) ?? [];
      next.set(
        group.type,
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
    set((state) => ({ conflicts: [...state.conflicts, conflict] }));
  },
  resolveConflict(conflictId, resolvedType) {
    set((state) => ({
      conflicts: state.conflicts.map((conflict) =>
        conflict.id === conflictId
          ? {
              ...conflict,
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
  reset() {
    // `sortOrder` se conserva: es una preferencia de la sesión de la app, no
    // del documento (ADR-169 §2).
    set({ groupsByType: emptyGroupsByType(), conflicts: [], flashGroupId: null });
  },
}));
