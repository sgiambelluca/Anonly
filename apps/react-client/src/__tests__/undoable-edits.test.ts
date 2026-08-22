import { describe, expect, it } from "vitest";

import { enabledToastText, groupsToToggle } from "../components/entities/undoableEdits.js";

describe("groupsToToggle", () => {
  it("devuelve solo los que cambian, con el valor que tenían antes", () => {
    expect(
      groupsToToggle(
        [
          { id: "a", enabled: true },
          { id: "b", enabled: false },
          { id: "c", enabled: true },
        ],
        false,
      ),
    ).toEqual([
      { groupId: "a", enabled: true },
      { groupId: "c", enabled: true },
    ]);
  });

  it("excluye los que ya estaban en el estado pedido", () => {
    // Incluirlos inflaría el contador del toast ("12 grupos" cuando el usuario
    // cambió 3) y haría que el undo emitiera escrituras que no deshacen nada.
    expect(groupsToToggle([{ id: "a", enabled: false }], false)).toEqual([]);
  });

  it("sin cambios no hay nada que deshacer", () => {
    expect(
      groupsToToggle(
        [
          { id: "a", enabled: true },
          { id: "b", enabled: true },
        ],
        true,
      ),
    ).toEqual([]);
  });

  it("el snapshot conserva el valor por grupo, no uno global", () => {
    // En una cascada la mitad de las filas podía estar ya en ese estado; el
    // undo tiene que devolver a cada una lo suyo.
    expect(
      groupsToToggle(
        [
          { id: "a", enabled: false },
          { id: "b", enabled: true },
        ],
        true,
      ),
    ).toEqual([{ groupId: "a", enabled: false }]);
  });
});

describe("enabledToastText", () => {
  it("una fila se nombra por su valor", () => {
    expect(enabledToastText({ count: 1, label: "María Gómez", isType: false, next: false })).toBe(
      "«María Gómez» no se anonimiza",
    );
    expect(enabledToastText({ count: 1, label: "María Gómez", isType: false, next: true })).toBe(
      "«María Gómez» se anonimiza",
    );
  });

  it("un tipo dice cuántos grupos cambiaron", () => {
    expect(enabledToastText({ count: 6, label: "Personas", isType: true, next: false })).toBe(
      "Personas: 6 grupos no se anonimizan",
    );
  });

  it("un solo grupo dentro de un tipo no dice «1 grupos»", () => {
    expect(enabledToastText({ count: 1, label: "Personas", isType: true, next: true })).toBe(
      "Personas: 1 grupo se anonimiza",
    );
  });
});
