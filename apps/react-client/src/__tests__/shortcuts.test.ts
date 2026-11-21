/**
 * La tabla única de atajos (`UX_Guidelines.md` §9 y §11b.14, ADR-224 §5,
 * ADR-229 §8): lo que lista la ayuda es lo mismo que dispara los atajos. Los
 * textos salen de `Atajos.dc.html`.
 */
import { describe, expect, it } from "vitest";

import { historyCommandFor } from "../components/screens/historyShortcuts.js";
import {
  keyLabel,
  matchesShortcut,
  SHORTCUT_GROUP_ORDER,
  SHORTCUTS,
  shortcutGroups,
  shortcutsLead,
  type ShortcutId,
  type ShortcutKeyEvent,
} from "../components/toolbar/shortcuts.js";

const NO_KEYS: ShortcutKeyEvent = {
  key: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

/** El teclado físico para un token de la ayuda. */
function keyFor(token: string): string {
  switch (token) {
    case "−":
      return "-";
    case "Espacio":
      return " ";
    case "Esc":
      return "Escape";
    case "↑":
      return "ArrowUp";
    case "↓":
      return "ArrowDown";
    default:
      return token;
  }
}

/** El evento que produce una combinación de la ayuda. */
function eventFor(combo: ReadonlyArray<string>): ShortcutKeyEvent {
  const main = combo[combo.length - 1] ?? "";
  return {
    ...NO_KEYS,
    key: keyFor(main),
    ctrlKey: combo.includes("Mod"),
    shiftKey: combo.includes("Shift"),
  };
}

describe("la tabla de atajos", () => {
  it("tiene los quince atajos que ya existen, sin repetir id", () => {
    expect(SHORTCUTS).toHaveLength(15);
    expect(new Set(SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(15);
  });

  it("cada combinación de la ayuda dispara su propio atajo (la ayuda no puede contradecirse)", () => {
    for (const shortcut of SHORTCUTS) {
      for (const combo of shortcut.combos) {
        expect(
          matchesShortcut(shortcut.id, eventFor(combo)),
          `${shortcut.id}: ${combo.join("+")}`,
        ).toBe(true);
      }
    }
  });

  it("ninguna combinación dispara el atajo de otra fila", () => {
    for (const shortcut of SHORTCUTS) {
      for (const combo of shortcut.combos) {
        const fired = SHORTCUTS.filter((other) => other.matches(eventFor(combo))).map(
          (other) => other.id,
        );
        // «Deshacer» y su fila de «Formatos de detección» comparten `Ctrl/⌘+Z` a propósito.
        const expected =
          shortcut.id === "undo" || shortcut.id === "undoFormatsDraft"
            ? ["undo", "undoFormatsDraft"]
            : [shortcut.id];
        expect(fired, `${shortcut.id}: ${combo.join("+")}`).toEqual(expected);
      }
    }
  });

  it("la ayuda lista el deshacer del borrador de «Formatos de detección» (UX §11b.11)", () => {
    const row = shortcutGroups("other")
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.id === "undoFormatsDraft");
    expect(row?.label).toBe("Deshacer el último cambio en «Formatos de detección»");
    expect(row?.combos).toEqual([["Ctrl", "Z"]]);
  });

  it("acepta Cmd en lugar de Ctrl", () => {
    expect(matchesShortcut("export", { ...NO_KEYS, key: "e", metaKey: true })).toBe(true);
    expect(matchesShortcut("export", { ...NO_KEYS, key: "E", ctrlKey: true })).toBe(true);
  });

  it("sin Ctrl/Cmd no dispara los atajos de documento ni de zoom", () => {
    const ids: ReadonlyArray<ShortcutId> = [
      "open",
      "export",
      "cancel",
      "toggleView",
      "search",
      "zoomIn",
      "zoomOut",
      "zoomReset",
    ];
    for (const id of ids) {
      for (const key of ["o", "e", ".", "d", "f", "+", "-", "0"]) {
        expect(matchesShortcut(id, { ...NO_KEYS, key })).toBe(false);
      }
    }
  });

  it("el zoom acepta «=» (el «+» del teclado de Estados Unidos sin Shift)", () => {
    expect(matchesShortcut("zoomIn", { ...NO_KEYS, key: "=", ctrlKey: true })).toBe(true);
  });

  it("deshacer no se confunde con rehacer", () => {
    const z = { ...NO_KEYS, key: "z", ctrlKey: true };
    expect(matchesShortcut("undo", z)).toBe(true);
    expect(matchesShortcut("redo", z)).toBe(false);
    expect(matchesShortcut("redo", { ...z, key: "Z", shiftKey: true })).toBe(true);
    expect(matchesShortcut("redo", { ...NO_KEYS, key: "y", ctrlKey: true })).toBe(true);
    expect(matchesShortcut("redo", { ...NO_KEYS, key: "y", ctrlKey: true, shiftKey: true })).toBe(
      false,
    );
    expect(matchesShortcut("undo", { ...z, altKey: true })).toBe(false);
  });

  it("el deshacer de historyShortcuts sale de la misma tabla", () => {
    expect(historyCommandFor({ ...NO_KEYS, key: "z", ctrlKey: true })).toBe("undo");
    expect(historyCommandFor({ ...NO_KEYS, key: "Z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(historyCommandFor({ ...NO_KEYS, key: "y", ctrlKey: true })).toBe("redo");
    expect(historyCommandFor({ ...NO_KEYS, key: "x", ctrlKey: true })).toBeNull();
  });
});

describe("shortcutGroups (la ayuda)", () => {
  it("los cuatro grupos, en orden, con los títulos del lienzo", () => {
    expect(SHORTCUT_GROUP_ORDER).toEqual(["document", "edit", "list", "viewer"]);
    expect(shortcutGroups("other").map((group) => group.title)).toEqual([
      "Documento",
      "Edición",
      "Lista de entidades",
      "Visor y diálogos",
    ]);
  });

  it("lista las filas de Atajos.dc.html, con Ctrl en Windows y Linux", () => {
    const rows = Object.fromEntries(
      shortcutGroups("other").flatMap((group) =>
        group.rows.map((row) => [row.label, row.combos] as const),
      ),
    );
    expect(rows["Abrir un PDF"]).toEqual([["Ctrl", "O"]]);
    expect(rows["Cancelar el análisis"]).toEqual([["Ctrl", "."]]);
    expect(rows["Cambiar entre Original y Anonimizado"]).toEqual([["Ctrl", "D"]]);
    expect(rows["Rehacer"]).toEqual([
      ["Ctrl", "Y"],
      ["Ctrl", "Shift", "Z"],
    ]);
    expect(rows["Moverse entre entidades"]).toEqual([["↑"], ["↓"]]);
    expect(rows["Incluir u ocultar la entidad elegida"]).toEqual([["Espacio"]]);
    expect(rows["Alejar"]).toEqual([["Ctrl", "−"]]);
    expect(rows["Cerrar un menú o un diálogo"]).toEqual([["Esc"]]);
  });

  it("en Mac se escribe ⌘ y ⇧", () => {
    expect(keyLabel("Mod", "mac")).toBe("⌘");
    expect(keyLabel("Shift", "mac")).toBe("⇧");
    expect(keyLabel("Mod", "other")).toBe("Ctrl");
    expect(keyLabel("Shift", "other")).toBe("Shift");
    expect(keyLabel("O", "mac")).toBe("O");
    const redo = shortcutGroups("mac")
      .flatMap((group) => group.rows)
      .find((row) => row.id === "redo");
    expect(redo?.combos).toEqual([
      ["⌘", "Y"],
      ["⌘", "⇧", "Z"],
    ]);
  });

  it("la bajada cambia en Mac", () => {
    expect(shortcutsLead("other")).toBe("Los atajos que ya tiene Anonly.");
    expect(shortcutsLead("mac")).toBe(
      "Los atajos que ya tiene Anonly. En Mac se usa ⌘ en lugar de Ctrl.",
    );
  });
});
