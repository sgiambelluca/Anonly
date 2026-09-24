/**
 * `manualOverlapController.ts` (ADR-174 §4, ADR-175 §4) — módulo imperativo
 * con suscripción, mismo patrón que `toast.ts`. Sin dependencias del Core: se
 * prueba directo, sin mocks.
 */

import { describe, expect, it, vi } from "vitest";

import {
  closeManualOverlapDialog,
  openManualOverlapDialog,
  subscribeToManualOverlapDialog,
} from "../components/conflicts/manualOverlapController.js";

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
