/**
 * La búsqueda de la entidad bajo el puntero, para el tooltip del visor
 * (`Components.md` §13b.8, ADR-226 §4).
 */
import type { BoundingBox, PreviewInteractionGeometry } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  boxContains,
  displayToPagePoint,
  ENTITY_TOOLTIP_DELAY_MS,
  hitTestEntity,
  isTooltipSuppressed,
  OPEN_OVERLAY_SELECTOR,
  pointerStaysOn,
} from "../components/viewer/entityHover.js";

import { makeGroup, member } from "./helpers/groupFixtures.js";

const box = (x: number, y: number, width = 40, height = 10): BoundingBox => ({
  x,
  y,
  width,
  height,
});

const geometry = (
  overrides: Partial<PreviewInteractionGeometry> = {},
): PreviewInteractionGeometry => ({
  revision: 1,
  scale: 1,
  wordPositions: [],
  coveredRegions: [],
  ...overrides,
});

describe("constantes", () => {
  it("la espera es de ~400 ms (ADR-226 §4)", () => {
    expect(ENTITY_TOOLTIP_DELAY_MS).toBe(400);
  });

  it("un menú o un diálogo abierto suprimen el tooltip, salvo el cajón de entidades", () => {
    expect(OPEN_OVERLAY_SELECTOR).toContain('[role="dialog"]:not([data-entities-drawer])');
    expect(OPEN_OVERLAY_SELECTOR).toContain('[role="menu"]');
  });
});

describe("boxContains / displayToPagePoint", () => {
  it("incluye los bordes", () => {
    expect(boxContains(box(10, 10), { x: 10, y: 10 })).toBe(true);
    expect(boxContains(box(10, 10), { x: 50, y: 20 })).toBe(true);
    expect(boxContains(box(10, 10), { x: 50.1, y: 20 })).toBe(false);
  });

  it("pasa de píxeles de pantalla a coordenadas de página", () => {
    expect(
      displayToPagePoint(
        { x: 100, y: 50 },
        { width: 200, height: 100 },
        { width: 600, height: 800 },
      ),
    ).toEqual({ x: 300, y: 400 });
  });

  it("una capa sin tamaño no da punto", () => {
    expect(
      displayToPagePoint({ x: 1, y: 1 }, { width: 0, height: 100 }, { width: 600, height: 800 }),
    ).toBeNull();
  });
});

describe("hitTestEntity en Original", () => {
  const juan = makeGroup({
    id: "juan",
    members: [member({ occurrenceId: "o1", pageIndex: 0, bbox: box(10, 10) })],
  });
  const ana = makeGroup({
    id: "ana",
    enabled: false,
    members: [member({ occurrenceId: "o2", pageIndex: 0, bbox: box(100, 100) })],
  });

  it("encuentra el grupo cuyo texto está bajo el puntero", () => {
    const hit = hitTestEntity({
      kind: "original",
      pageIndex: 0,
      point: { x: 20, y: 15 },
      groups: [juan, ana],
    });
    expect(hit?.group.id).toBe("juan");
    expect(hit?.anchor).toEqual(box(10, 10));
  });

  it("también encuentra una entidad desactivada", () => {
    const hit = hitTestEntity({
      kind: "original",
      pageIndex: 0,
      point: { x: 110, y: 105 },
      groups: [juan, ana],
    });
    expect(hit?.group.id).toBe("ana");
    expect(hit?.group.enabled).toBe(false);
  });

  it("ignora las apariciones de otra página y los lugares sin entidad", () => {
    expect(
      hitTestEntity({ kind: "original", pageIndex: 1, point: { x: 20, y: 15 }, groups: [juan] }),
    ).toBeNull();
    expect(
      hitTestEntity({ kind: "original", pageIndex: 0, point: { x: 300, y: 300 }, groups: [juan] }),
    ).toBeNull();
  });

  it("una aparición que cruza renglones se ancla en el fragmento bajo el puntero", () => {
    const split = makeGroup({
      id: "split",
      members: [
        member({
          pageIndex: 0,
          bbox: box(10, 10, 100, 40),
          fragments: [box(60, 10, 40), box(10, 30, 40)],
        }),
      ],
    });
    const hit = hitTestEntity({
      kind: "original",
      pageIndex: 0,
      point: { x: 20, y: 35 },
      groups: [split],
    });
    expect(hit?.anchor).toEqual(box(10, 30, 40));
    expect(hit?.boxes).toHaveLength(2);
    // Entre los dos fragmentos (el hueco que deja la caja unida) no hay entidad.
    expect(
      hitTestEntity({ kind: "original", pageIndex: 0, point: { x: 20, y: 15 }, groups: [split] }),
    ).toBeNull();
  });
});

describe("hitTestEntity en Anonimizado", () => {
  const enabled = makeGroup({
    id: "tapada",
    members: [member({ occurrenceId: "o1", pageIndex: 0, bbox: box(10, 10) })],
  });
  const off = makeGroup({
    id: "visible",
    enabled: false,
    members: [member({ occurrenceId: "o2", pageIndex: 0, bbox: box(100, 100) })],
  });

  it("sin la geometría de la imagen no hay reemplazos que ubicar", () => {
    expect(
      hitTestEntity({
        kind: "anonymized",
        pageIndex: 0,
        point: { x: 20, y: 15 },
        groups: [enabled],
      }),
    ).toBeNull();
  });

  it("encuentra el reemplazo dibujado, por su occurrenceId", () => {
    const hit = hitTestEntity({
      kind: "anonymized",
      pageIndex: 0,
      point: { x: 15, y: 12 },
      groups: [off, enabled],
      geometry: geometry({
        coveredRegions: [{ occurrenceId: "o1", sourceBbox: box(10, 10), bbox: box(8, 8, 50, 14) }],
      }),
    });
    expect(hit?.group.id).toBe("tapada");
    expect(hit?.anchor).toEqual(box(8, 8, 50, 14));
    expect(hit?.boxes).toEqual([box(8, 8, 50, 14)]);
  });

  it("un reemplazo cuya aparición no está en ningún grupo no da tooltip", () => {
    expect(
      hitTestEntity({
        kind: "anonymized",
        pageIndex: 0,
        point: { x: 15, y: 12 },
        groups: [enabled],
        geometry: geometry({
          coveredRegions: [
            { occurrenceId: "otro", sourceBbox: box(10, 10), bbox: box(8, 8, 50, 14) },
          ],
        }),
      }),
    ).toBeNull();
  });

  it("una entidad desactivada sigue a la vista: se busca donde quedó su texto", () => {
    const hit = hitTestEntity({
      kind: "anonymized",
      pageIndex: 0,
      point: { x: 110, y: 105 },
      groups: [enabled, off],
      geometry: geometry(),
    });
    expect(hit?.group.id).toBe("visible");
  });

  it("si las palabras se corrieron, sigue el texto a su lugar nuevo", () => {
    const moved = box(100, 130);
    const geo = geometry({ wordPositions: [{ sourceBbox: box(100, 100), bbox: moved }] });
    expect(
      hitTestEntity({
        kind: "anonymized",
        pageIndex: 0,
        point: { x: 110, y: 105 },
        groups: [off],
        geometry: geo,
      }),
    ).toBeNull();
    const hit = hitTestEntity({
      kind: "anonymized",
      pageIndex: 0,
      point: { x: 110, y: 135 },
      groups: [off],
      geometry: geo,
    });
    expect(hit?.group.id).toBe("visible");
    expect(hit?.anchor).toEqual(moved);
  });

  it("una desactivada de otra página no cuenta", () => {
    expect(
      hitTestEntity({
        kind: "anonymized",
        pageIndex: 3,
        point: { x: 110, y: 105 },
        groups: [off],
        geometry: geometry(),
      }),
    ).toBeNull();
  });
});

describe("pointerStaysOn", () => {
  it("el tooltip se queda mientras el puntero sigue sobre la misma aparición", () => {
    const hovered = {
      group: makeGroup(),
      boxes: [box(10, 10), box(10, 30)],
      anchor: box(10, 10),
    };
    expect(pointerStaysOn(hovered, { x: 20, y: 35 })).toBe(true);
    expect(pointerStaysOn(hovered, { x: 200, y: 200 })).toBe(false);
  });
});

describe("isTooltipSuppressed (ADR-226 §4)", () => {
  const free = { dragging: false, hasSelection: false, inert: false, overlayOpen: false };

  it("libre, no está suprimido", () => {
    expect(isTooltipSuppressed(free)).toBe(false);
  });

  it.each([
    ["se arrastra para seleccionar", { dragging: true }],
    ["hay una selección en pantalla", { hasSelection: true }],
    ["la página está inerte", { inert: true }],
    ["hay un menú o un diálogo abierto", { overlayOpen: true }],
  ])("no aparece cuando %s", (_name, patch) => {
    expect(isTooltipSuppressed({ ...free, ...patch })).toBe(true);
  });
});
