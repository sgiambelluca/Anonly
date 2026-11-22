/**
 * La pasada de mejora de UI de la 1.1 (2026-11-21): el resaltado de entidades
 * en la vista Original (`UX_Guidelines.md` §5.2, `Components.md` §5.4b), la línea
 * del documento abierto en la barra (§2.1) y dónde flota el panel de filtros.
 * Todo con datos inventados.
 */
import {
  EntityType,
  FORMAT_MAX_TEXT,
  FORMAT_MAX_VARIANTS,
  type BoundingBox,
  type FormatDefinition,
  type FormatPiece,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { placeFiltersPanel } from "../components/entities/EntityFiltersPopover.js";
import {
  ENTITY_TYPE_COLOR,
  hexToRgbChannels,
  typeColorChannels,
} from "../components/entities/entityTypeColors.js";
import { foldedContextLine } from "../components/formats/ContextWords.js";
import {
  copyVariantName,
  describeOptionalContent,
  draftWithDuplicate,
  draftWithNewVariant,
  draftWithoutVariant,
  draftWithVariantName,
  duplicateVariant,
  OPTIONAL_INNER_MENU,
  variantLabel,
  type BuilderDraft,
} from "../components/formats/formatBuilderModel.js";
import { variantReference } from "../components/formats/formatTexts.js";
import { placeContextMenu } from "../components/formats/PieceContextMenu.js";
import { menuOpensLeft } from "../components/formats/PieceStrip.js";
import { describeOpenDocument } from "../components/toolbar/openDocumentLine.js";
import { entityHighlightsOnPage, highlightStyle } from "../components/viewer/entityHighlights.js";

import { makeGroup, member } from "./helpers/groupFixtures.js";

const box = (x: number, y: number, width = 40, height = 10): BoundingBox => ({
  x,
  y,
  width,
  height,
});

const OWN_TYPE: UserEntityTypeId = "user:00000000-0000-4000-8000-000000000001";

describe("entityHighlightsOnPage", () => {
  it("devuelve una caja por aparición de la página pedida, con su grupo y su tipo", () => {
    const dni = makeGroup({
      id: "dni",
      type: EntityType.DNI,
      members: [
        member({ occurrenceId: "a", pageIndex: 0, bbox: box(10, 10) }),
        member({ occurrenceId: "b", pageIndex: 1, bbox: box(20, 20) }),
      ],
    });
    const highlights = entityHighlightsOnPage([dni], 0);
    expect(highlights).toEqual([
      { key: "a:0", groupId: "dni", type: EntityType.DNI, enabled: true, box: box(10, 10) },
    ]);
  });

  it("una aparición partida en renglones da una caja por fragmento", () => {
    const split = makeGroup({
      members: [
        member({
          occurrenceId: "s",
          bbox: box(0, 0, 200, 30),
          fragments: [box(150, 0, 50, 10), box(0, 20, 60, 10)],
        }),
      ],
    });
    expect(entityHighlightsOnPage([split], 0).map((highlight) => highlight.key)).toEqual([
      "s:0",
      "s:1",
    ]);
    expect(entityHighlightsOnPage([split], 0).map((highlight) => highlight.box)).toEqual([
      box(150, 0, 50, 10),
      box(0, 20, 60, 10),
    ]);
  });

  it("las desactivadas van primero, para que una activa encima se vea entera", () => {
    const on = makeGroup({ id: "on", members: [member({ occurrenceId: "x" })] });
    const off = makeGroup({ id: "off", enabled: false, members: [member({ occurrenceId: "y" })] });
    expect(entityHighlightsOnPage([on, off], 0).map((highlight) => highlight.groupId)).toEqual([
      "off",
      "on",
    ]);
  });

  it("sin apariciones en la página no hay nada que dibujar", () => {
    expect(entityHighlightsOnPage([makeGroup()], 3)).toEqual([]);
  });
});

describe("highlightStyle", () => {
  it("activa: borde del color del tipo y relleno suave, más fuerte bajo el tooltip", () => {
    const channels = hexToRgbChannels(ENTITY_TYPE_COLOR[EntityType.DNI]);
    expect(highlightStyle(EntityType.DNI, true, false)).toEqual({
      borderStyle: "solid",
      borderColor: `rgb(${channels} / 0.85)`,
      backgroundColor: `rgb(${channels} / 0.14)`,
    });
    expect(highlightStyle(EntityType.DNI, true, true).backgroundColor).toBe(
      `rgb(${channels} / 0.3)`,
    );
  });

  it("desactivada: borde punteado gris y sin relleno", () => {
    const style = highlightStyle(EntityType.Person, false, false);
    expect(style.borderStyle).toBe("dashed");
    expect(style.backgroundColor).toBe("transparent");
  });

  it("un tipo propio usa el acento, como su franja", () => {
    expect(typeColorChannels(OWN_TYPE)).toBe("var(--color-accent)");
    expect(highlightStyle(OWN_TYPE, true, false).borderColor).toBe(
      "rgb(var(--color-accent) / 0.85)",
    );
  });
});

describe("describeOpenDocument", () => {
  it("nombre y páginas, en singular o plural", () => {
    expect(describeOpenDocument("doc.pdf", 4)).toBe("doc.pdf · 4 páginas");
    expect(describeOpenDocument("doc.pdf", 1)).toBe("doc.pdf · 1 página");
  });

  it("sin páginas todavía, solo el nombre; sin documento, nada", () => {
    expect(describeOpenDocument("doc.pdf", 0)).toBe("doc.pdf");
    expect(describeOpenDocument(null, 3)).toBeNull();
    expect(describeOpenDocument("  ", 3)).toBeNull();
  });
});

describe("describeOptionalContent (ajuste de una parte opcional)", () => {
  it("vacía, dice que se suma con el «+» de adentro de la caja", () => {
    expect(describeOptionalContent(0)).toContain("Todavía está vacía");
    expect(describeOptionalContent(0)).toContain("«+» de adentro de la caja");
  });

  it("con piezas, cuenta en singular o plural", () => {
    expect(describeOptionalContent(1)).toMatch(/^Tiene 1 pieza\./);
    expect(describeOptionalContent(3)).toMatch(/^Tiene 3 piezas\./);
  });
});

describe("menuOpensLeft (menú «+ Pieza»)", () => {
  it("abre hacia la derecha mientras entra", () => {
    expect(menuOpensLeft({ left: 300 }, 1000, 416)).toBe(false);
  });

  it("abre hacia la izquierda cuando a la derecha se saldría del generador", () => {
    expect(menuOpensLeft({ left: 700 }, 1000, 416)).toBe(true);
  });
});

describe("placeFiltersPanel", () => {
  it("va debajo del botón y alineado a su borde izquierdo", () => {
    expect(placeFiltersPanel({ left: 200, bottom: 160 }, { width: 1440, height: 900 })).toEqual({
      left: 200,
      top: 164,
      maxHeight: 640,
    });
  });

  it("no se sale por la derecha ni por abajo de la ventana", () => {
    const place = placeFiltersPanel({ left: 1300, bottom: 700 }, { width: 1440, height: 800 });
    expect(place.left).toBe(1440 - 360 - 16);
    // Quedan 80 px abajo: el panel no baja de 160 y scrollea por dentro.
    expect(place.maxHeight).toBe(160);
  });

  it("en una ventana angosta ocupa el ancho disponible menos los márgenes", () => {
    expect(placeFiltersPanel({ left: 50, bottom: 100 }, { width: 300, height: 900 }).left).toBe(16);
  });
});

describe("segunda tanda de la pasada (2026-11-21)", () => {
  const digits: FormatPiece = { kind: "chars", charClass: "digit", min: 1, max: 1 };
  const letters: FormatPiece = { kind: "chars", charClass: "letter", min: 1, max: 1 };

  it("duplicateVariant pone la copia justo después de la original", () => {
    expect(duplicateVariant([[digits], [letters]], 0)).toEqual([[digits], [digits], [letters]]);
    expect(duplicateVariant([[digits], [letters]], 1)).toEqual([[digits], [letters], [letters]]);
  });

  it("duplicateVariant no pasa el tope de variantes", () => {
    const full = Array.from({ length: FORMAT_MAX_VARIANTS }, () => [digits]);
    expect(duplicateVariant(full, 0)).toBe(full);
    expect(duplicateVariant([[digits]], 3)).toEqual([[digits]]);
  });

  it("adentro de una parte opcional entran todas las clases menos otra parte opcional", () => {
    expect(OPTIONAL_INNER_MENU.map((entry) => entry.id)).toEqual([
      "digits",
      "letters",
      "alnum",
      "separator",
      "text",
    ]);
  });

  it("«Solo si antes dice…» plegada nombra sus palabras", () => {
    expect(foldedContextLine([])).toBe("Detectarlo solo si antes dice una palabra (opcional)");
    expect(foldedContextLine(["legajo"])).toBe("Solo si antes dice «legajo»");
    expect(foldedContextLine(["legajo", "leg.", "exp"])).toBe(
      "Solo si antes dice «legajo», «leg.» o «exp»",
    );
  });

  it("el menú del clic derecho no se sale de la ventana", () => {
    const viewport = { width: 1280, height: 800 };
    const size = { width: 200, height: 120 };
    expect(placeContextMenu({ x: 300, y: 200 }, size, viewport)).toEqual({ left: 300, top: 200 });
    // Cerca del borde derecho se corre a la izquierda; cerca del de abajo, se abre hacia arriba.
    expect(placeContextMenu({ x: 1250, y: 760 }, size, viewport)).toEqual({ left: 1072, top: 640 });
  });
});

describe("nombres de variante (ADR-233)", () => {
  const digits: FormatPiece = { kind: "chars", charClass: "digit", min: 1, max: 1 };
  const letters: FormatPiece = { kind: "chars", charClass: "letter", min: 1, max: 1 };
  const draft: BuilderDraft = {
    name: "Legajo",
    entityType: EntityType.DNI,
    variants: [[digits], [letters]],
    context: [],
  };

  it("sin nombre, la pestaña dice «Variante N»; con nombre, el nombre", () => {
    expect(variantLabel(draft, 1)).toBe("Variante 2");
    const named = draftWithVariantName(draft, 1, "  Con letras  ");
    expect(variantLabel(named, 1)).toBe("Con letras");
    expect(named.variantNames).toEqual(["", "Con letras"]);
  });

  it("vaciar el único nombre saca variantNames del borrador", () => {
    const named = draftWithVariantName(draft, 0, "Corto");
    expect(draftWithVariantName(named, 0, "   ")).toEqual(draft);
  });

  it("duplicar nombra la copia «Copia de …» y la pone después", () => {
    const copy = draftWithDuplicate(draft, 0);
    expect(copy.variants).toEqual([[digits], [digits], [letters]]);
    expect(copy.variantNames).toEqual(["", "Copia de Variante 1", ""]);
    const named = draftWithDuplicate(draftWithVariantName(draft, 1, "Con letras"), 1);
    expect(named.variantNames).toEqual(["", "Con letras", "Copia de Con letras"]);
  });

  it("el nombre de la copia no pasa el tope de caracteres", () => {
    const long = "x".repeat(FORMAT_MAX_TEXT);
    expect(Array.from(copyVariantName(long))).toHaveLength(FORMAT_MAX_TEXT);
  });

  it("borrar y sumar variantes mueve los nombres con ellas", () => {
    const named = draftWithVariantName(draft, 1, "Con letras");
    expect(draftWithoutVariant(named, 0).variantNames).toEqual(["Con letras"]);
    expect(draftWithoutVariant(named, 1).variantNames).toBeUndefined();
    expect(draftWithNewVariant(named).variantNames).toEqual(["", "Con letras", ""]);
  });

  it("los textos nombran la variante por su nombre si tiene", () => {
    const definition: FormatDefinition = {
      id: "fmt:00000000-0000-4000-8000-000000000002",
      name: "Legajo",
      entityType: EntityType.DNI,
      variants: [[digits], [letters]],
      variantNames: ["", "Con letras"],
      enabled: true,
    };
    expect(variantReference(definition, 0)).toBe("1");
    expect(variantReference(definition, 1)).toBe("«Con letras»");
  });
});
