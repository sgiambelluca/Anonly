/**
 * `RemoveEntityDialog` (ADR-215 §2, `Components.md` §3.5b): la frase de
 * apariciones en plural y en singular, y los textos fijos. Qué muestra "Hoy"
 * (reemplazo, bloque u original) lo cubre `todayPhrase` en
 * `tight-space-dialog.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  REMOVE_DESCRIPTION,
  REMOVE_IF_REMOVED_LABEL,
  REMOVE_LIST_CONSEQUENCE,
  REMOVE_NO_OCCURRENCE,
  REMOVE_REANALYZE_CONSEQUENCE,
  REMOVE_TITLE,
  REMOVE_TODAY_LABEL,
  REMOVE_UNDO_HINT_LEAD,
  visibleConsequence,
} from "../components/entities/removeEntityCopy.js";

describe("visibleConsequence", () => {
  it("con varias apariciones dice cuántas son", () => {
    expect(visibleConsequence(3)).toEqual({
      strong: "Su texto queda a la vista",
      rest: " en el documento exportado, en las 3 apariciones.",
    });
  });

  it("con dos ya es plural", () => {
    expect(visibleConsequence(2).rest).toBe(" en el documento exportado, en las 2 apariciones.");
  });

  it("con una sola dice «en su única aparición»", () => {
    expect(visibleConsequence(1)).toEqual({
      strong: "Su texto queda a la vista",
      rest: " en el documento exportado, en su única aparición.",
    });
  });

  it("la oración completa se lee de corrido", () => {
    const { strong, rest } = visibleConsequence(3);
    expect(`${strong}${rest}`).toBe(
      "Su texto queda a la vista en el documento exportado, en las 3 apariciones.",
    );
  });

  it("sin apariciones la consecuencia no menciona la cantidad", () => {
    // `Components.md` §3.5b: sin aparición utilizable la caja dice que no hay
    // qué mostrar y la primera consecuencia no cuenta nada.
    expect(visibleConsequence(0).rest).toBe(" en el documento exportado.");
    expect(visibleConsequence(0).rest).not.toMatch(/[0-9]/);
  });
});

describe("textos fijos", () => {
  it("son los literales de ADR-215 §2", () => {
    expect(REMOVE_TITLE).toBe("¿Eliminar esta entidad?");
    expect(REMOVE_DESCRIPTION).toBe("Deja de ocultarse en todo el documento.");
    expect(REMOVE_TODAY_LABEL).toBe("Hoy");
    expect(REMOVE_IF_REMOVED_LABEL).toBe("Si la eliminás");
    expect(REMOVE_LIST_CONSEQUENCE).toBe("Sale de la lista de entidades.");
    expect(REMOVE_REANALYZE_CONSEQUENCE).toBe(
      "Si un nuevo análisis la vuelve a encontrar, sigue eliminada.",
    );
    expect(REMOVE_UNDO_HINT_LEAD).toBe("Podés deshacerlo con");
    expect(REMOVE_NO_OCCURRENCE).toBe("No hay una aparición para mostrar.");
  });

  it("conservan los tres datos de la confirmación anterior", () => {
    // Queda a la vista, sale de la lista y un nuevo análisis no la trae de vuelta.
    const all = [
      visibleConsequence(2).strong,
      REMOVE_LIST_CONSEQUENCE,
      REMOVE_REANALYZE_CONSEQUENCE,
    ].join(" ");
    expect(all).toContain("a la vista");
    expect(all).toContain("lista");
    expect(all).toContain("sigue eliminada");
  });
});
