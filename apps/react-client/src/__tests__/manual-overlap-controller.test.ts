/**
 * `manualOverlapController.ts` (ADR-174 §4, ADR-175 §4, ADR-176 §1) —
 * módulo imperativo con suscripción, mismo patrón que `toast.ts`. Sin
 * dependencias del Core: se prueba directo, sin mocks. `openFirstPendingManualOverlap`
 * sí depende de `entities.store` (real, no del Core), así que sus tests
 * siembran el store directo.
 */

import {
  ConflictReason,
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Conflict,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { describe, expect, it, vi } from "vitest";

import {
  closeManualOverlapDialog,
  openFirstPendingManualOverlap,
  openManualOverlapDialog,
  subscribeToManualOverlapDialog,
} from "../components/conflicts/manualOverlapController.js";
import { useEntitiesStore } from "../store/entities.store.js";

describe("manualOverlapController (ADR-174 §4, ADR-175 §4)", () => {
  it("avisa a los suscriptores con TODOS los conflictIds al abrir", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToManualOverlapDialog(listener);

    openManualOverlapDialog(["conflict-1", "conflict-2"]);

    expect(listener).toHaveBeenCalledWith(["conflict-1", "conflict-2"]);
    unsubscribe();
  });

  it("avisa con null al cerrar", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToManualOverlapDialog(listener);

    openManualOverlapDialog(["conflict-1"]);
    closeManualOverlapDialog();

    expect(listener).toHaveBeenNthCalledWith(1, ["conflict-1"]);
    expect(listener).toHaveBeenNthCalledWith(2, null);
    unsubscribe();
  });

  it("un suscriptor desuscripto no recibe más avisos", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToManualOverlapDialog(listener);
    unsubscribe();

    openManualOverlapDialog(["conflict-1"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("avisa a varios suscriptores a la vez (Host global + ConflictBadge/aviso persistente abren el mismo diálogo)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToManualOverlapDialog(first);
    const unsubscribeSecond = subscribeToManualOverlapDialog(second);

    openManualOverlapDialog(["conflict-2"]);

    expect(first).toHaveBeenCalledWith(["conflict-2"]);
    expect(second).toHaveBeenCalledWith(["conflict-2"]);
    unsubscribeFirst();
    unsubscribeSecond();
  });
});

function group(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 01]",
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 01]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function heldConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "g1",
    reason: ConflictReason.Overlap,
    candidates: [
      { source: DetectionSource.Manual, entityType: EntityType.Person, confidence: 1, value: "X" },
      { source: DetectionSource.Regex, entityType: EntityType.DNI, confidence: 1, value: "X" },
    ],
    resolved: false,
    heldManual: true,
    ...overrides,
  };
}

// ADR-176 §1: el "Resolver" del bloqueo de export reusa exactamente esto.
describe("openFirstPendingManualOverlap (ADR-175 §5, reusado por ADR-176 §1)", () => {
  it("abre el diálogo con los heldManual pendientes de la primera fila del árbol", () => {
    useEntitiesStore.getState().reset();
    useEntitiesStore.getState().addGroup(group());
    useEntitiesStore.getState().addConflict(heldConflict({ id: "c1" }));
    useEntitiesStore.getState().addConflict(heldConflict({ id: "c2" }));
    const listener = vi.fn();
    const unsubscribe = subscribeToManualOverlapDialog(listener);

    openFirstPendingManualOverlap();

    expect(listener).toHaveBeenCalledWith(["c1", "c2"]);
    unsubscribe();
  });

  it("sin nada pendiente, no abre nada", () => {
    useEntitiesStore.getState().reset();
    const listener = vi.fn();
    const unsubscribe = subscribeToManualOverlapDialog(listener);

    openFirstPendingManualOverlap();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
