/**
 * `shortcuts.ts` — **la** tabla de atajos de teclado (`UX_Guidelines.md` §9 y
 * §11b.14, ADR-224 §5, ADR-229 §8).
 *
 * Una sola fuente, para que la ayuda y los atajos no puedan contradecirse: cada
 * entrada declara a la vez **cómo se ve** (`combos`, lo que lista
 * `ShortcutsDialog`) y **cuándo se dispara** (`matches`, lo que usan los
 * listeners). `matchesShortcut(id, event)` reemplaza a las comparaciones de
 * teclas que cada componente tenía escritas por su cuenta.
 *
 * **Hay dos clases de atajo.** Los que llevan `Ctrl/⌘` (abrir, exportar,
 * cancelar, conmutar, deshacer, rehacer, buscar y zoom) los atienden listeners
 * de `window` que consultan esta tabla. Los de la lista (flechas, Espacio,
 * Enter) y `Esc` los resuelven `treeNavigation.ts` y Radix, que tienen su propio
 * contexto; sus filas se declaran acá igual, y la prueba de la tabla comprueba
 * que sus `combos` y su `matches` dicen lo mismo.
 *
 * La 1.1 no suma atajos: esta es la tabla de `UX_Guidelines.md` §9 más deshacer
 * y rehacer (ADR-172).
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/** Lo que de un `KeyboardEvent` hace falta para decidir. */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export type ShortcutId =
  | "open"
  | "export"
  | "cancel"
  | "toggleView"
  | "undo"
  | "undoFormatsDraft"
  | "redo"
  | "search"
  | "navigate"
  | "toggleSelected"
  | "openMenu"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "close";

export type ShortcutGroupId = "document" | "edit" | "list" | "viewer";

/**
 * Una tecla de una combinación. `"Mod"` es `Ctrl` (Windows y Linux) o `⌘` (Mac)
 * y `"Shift"` es `Shift` o `⇧`; el resto se muestra tal cual.
 */
export type KeyToken = string;

export interface ShortcutDefinition {
  readonly id: ShortcutId;
  readonly group: ShortcutGroupId;
  readonly label: string;
  /** Alternativas: cada una es una combinación de teclas. «o» las separa en la ayuda. */
  readonly combos: ReadonlyArray<ReadonlyArray<KeyToken>>;
  readonly matches: (event: ShortcutKeyEvent) => boolean;
}

function isMod(event: ShortcutKeyEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function keyIs(event: ShortcutKeyEvent, key: string): boolean {
  return event.key.toLowerCase() === key;
}

function modPlus(key: string): (event: ShortcutKeyEvent) => boolean {
  return (event) => isMod(event) && keyIs(event, key);
}

export const SHORTCUTS: ReadonlyArray<ShortcutDefinition> = [
  {
    id: "open",
    group: "document",
    label: "Abrir un PDF",
    combos: [["Mod", "O"]],
    matches: modPlus("o"),
  },
  {
    id: "export",
    group: "document",
    label: "Exportar",
    combos: [["Mod", "E"]],
    matches: modPlus("e"),
  },
  {
    id: "cancel",
    group: "document",
    label: "Cancelar el análisis",
    combos: [["Mod", "."]],
    matches: modPlus("."),
  },
  {
    id: "toggleView",
    group: "document",
    label: "Cambiar entre Original y Anonimizado",
    combos: [["Mod", "D"]],
    matches: modPlus("d"),
  },
  {
    id: "undo",
    group: "edit",
    label: "Deshacer",
    combos: [["Mod", "Z"]],
    matches: (event) => isMod(event) && !event.altKey && keyIs(event, "z") && !event.shiftKey,
  },
  {
    // `UX_Guidelines.md` §11b.11: en «Formatos de detección» el mismo `Ctrl/⌘+Z`
    // deshace el último cambio del borrador. Es la misma combinación que
    // «Deshacer»; el listener de `DetectionFormatsDialog` sigue siendo suyo.
    id: "undoFormatsDraft",
    group: "edit",
    label: "Deshacer el último cambio en «Formatos de detección»",
    combos: [["Mod", "Z"]],
    matches: (event) => isMod(event) && !event.altKey && keyIs(event, "z") && !event.shiftKey,
  },
  {
    id: "redo",
    group: "edit",
    label: "Rehacer",
    combos: [
      ["Mod", "Y"],
      ["Mod", "Shift", "Z"],
    ],
    matches: (event) =>
      isMod(event) &&
      !event.altKey &&
      ((keyIs(event, "y") && !event.shiftKey) || (keyIs(event, "z") && event.shiftKey)),
  },
  {
    id: "search",
    group: "list",
    label: "Buscar en la lista",
    combos: [["Mod", "F"]],
    matches: modPlus("f"),
  },
  {
    id: "navigate",
    group: "list",
    label: "Moverse entre entidades",
    combos: [["↑"], ["↓"]],
    matches: (event) => event.key === "ArrowUp" || event.key === "ArrowDown",
  },
  {
    id: "toggleSelected",
    group: "list",
    label: "Incluir u ocultar la entidad elegida",
    combos: [["Espacio"]],
    matches: (event) => event.key === " ",
  },
  {
    id: "openMenu",
    group: "list",
    label: "Abrir el menú de la entidad",
    combos: [["Enter"]],
    matches: (event) => event.key === "Enter",
  },
  {
    id: "zoomIn",
    group: "viewer",
    label: "Acercar",
    combos: [["Mod", "+"]],
    // `=` es la tecla de `+` sin `Shift` en el teclado de Estados Unidos.
    matches: (event) => isMod(event) && (event.key === "+" || event.key === "="),
  },
  {
    id: "zoomOut",
    group: "viewer",
    label: "Alejar",
    combos: [["Mod", "−"]],
    matches: (event) => isMod(event) && event.key === "-",
  },
  {
    id: "zoomReset",
    group: "viewer",
    label: "Volver al tamaño normal",
    combos: [["Mod", "0"]],
    matches: (event) => isMod(event) && event.key === "0",
  },
  {
    id: "close",
    group: "viewer",
    label: "Cerrar un menú o un diálogo",
    combos: [["Esc"]],
    matches: (event) => event.key === "Escape",
  },
];

/** `true` si `event` es el atajo `id`. Lo usan los listeners en lugar de comparar teclas. */
export function matchesShortcut(id: ShortcutId, event: ShortcutKeyEvent): boolean {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.matches(event) ?? false;
}

export const SHORTCUT_GROUP_TITLE: Readonly<Record<ShortcutGroupId, string>> = {
  document: "Documento",
  edit: "Edición",
  list: "Lista de entidades",
  viewer: "Visor y diálogos",
};

export const SHORTCUT_GROUP_ORDER: ReadonlyArray<ShortcutGroupId> = [
  "document",
  "edit",
  "list",
  "viewer",
];

export type ShortcutPlatform = "mac" | "other";

/** El texto de una tecla en este sistema: `Mod` y `Shift` cambian, el resto no. */
export function keyLabel(token: KeyToken, platform: ShortcutPlatform): string {
  if (token === "Mod") return platform === "mac" ? "⌘" : "Ctrl";
  if (token === "Shift") return platform === "mac" ? "⇧" : "Shift";
  return token;
}

/** La bajada de la ayuda (`Atajos.dc.html`). */
export function shortcutsLead(platform: ShortcutPlatform): string {
  return platform === "mac"
    ? "Los atajos que ya tiene Anonly. En Mac se usa ⌘ en lugar de Ctrl."
    : "Los atajos que ya tiene Anonly.";
}

export interface ShortcutRow {
  readonly id: ShortcutId;
  readonly label: string;
  /** Cada alternativa, con sus teclas ya escritas para el sistema. */
  readonly combos: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutGroupView {
  readonly id: ShortcutGroupId;
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutRow>;
}

/** La tabla de la ayuda: los grupos en orden, con las teclas de cada sistema. */
export function shortcutGroups(platform: ShortcutPlatform): ReadonlyArray<ShortcutGroupView> {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    id: group,
    title: SHORTCUT_GROUP_TITLE[group],
    rows: SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => ({
      id: shortcut.id,
      label: shortcut.label,
      combos: shortcut.combos.map((combo) => combo.map((token) => keyLabel(token, platform))),
    })),
  }));
}
