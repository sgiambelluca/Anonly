/**
 * ADR-190 §4 — "una página con tinta no sale vacía en silencio" del lado del
 * cliente: el store por página, la regla compartida de "tiene entidad", la
 * lista de pendientes del export y cuándo se muestra el aviso de
 * `PageCanvas`. Cuatro casos exigidos por §"Pruebas exigidas" del ADR:
 *
 * - el marcador de la página aparece con `unreadableInk` y no desplaza el
 *   layout;
 * - la lista de pendientes excluye las páginas con alguna entidad (automática
 *   o manual, habilitada o no) y las que no tienen `unreadableInk`;
 * - la confirmación se abre solo si la lista no está vacía, y "Tapar página
 *   entera" viaja en `coveredPages`;
 * - la marca se borra con `closeDocument` y se recalcula con un `reanalyze`
 *   de OCR.
 */

import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildCoveredPages,
  computePendingPages,
  shouldConfirmPendingPages,
} from "../components/export/unreadableExportConfirmation.js";
import { shouldShowUnreadableInkWarning } from "../components/viewer/unreadableInkWarning.js";
import { pageHasEntity } from "../store/entities.store.js";
import { selectPageHasUnreadableInk, useUnreadableInkStore } from "../store/unreadableInk.store.js";

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSON 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSON 01]",
      mask: "[PERSON 01]",
      synthetic: "[PERSON 01]",
      placeholderLadder: ["[PERSON 01]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function memberOnPage(pageIndex: number, overrides: Partial<EntityGroup["members"][number]> = {}) {
  return {
    occurrenceId: `occ-${pageIndex}`,
    value: "Juan Pérez",
    pageIndex,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    source: DetectionSource.Regex,
    ...overrides,
  };
}

describe("unreadableInk.store", () => {
  beforeEach(() => {
    useUnreadableInkStore.getState().reset();
  });

  it("marca una página y la refleja el selector", () => {
    useUnreadableInkStore.getState().setPageVerdict(3, true);
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 3)).toBe(true);
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 0)).toBe(false);
  });

  // "la marca ... se recalcula con un reanalyze de OCR": un reanalyze de OCR
  // vuelve a emitir `OCR_PAGE_FINISHED` para las páginas reprocesadas, y el
  // bridge llama de nuevo a `setPageVerdict` — el store tiene que poder
  // apagar una marca que ya no aplica, no solo encenderla.
  it("un reanalyze que vuelve a leer la página apaga su marca", () => {
    useUnreadableInkStore.getState().setPageVerdict(1, true);
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 1)).toBe(true);

    useUnreadableInkStore.getState().setPageVerdict(1, false);
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 1)).toBe(false);
  });

  it("reemplaza el veredicto de una página sin tocar las demás", () => {
    useUnreadableInkStore.getState().setPageVerdict(1, true);
    useUnreadableInkStore.getState().setPageVerdict(2, true);
    useUnreadableInkStore.getState().setPageVerdict(1, false);

    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 1)).toBe(false);
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 2)).toBe(true);
  });

  // "la marca se borra con closeDocument": `actions.closeDocument()` llama a
  // `reset()` (`core-adapter/actions.ts`) — acá se afirma el contrato del
  // store que esa llamada usa.
  it("reset limpia todo: la marca es del documento abierto", () => {
    useUnreadableInkStore.getState().setPageVerdict(1, true);
    useUnreadableInkStore.getState().reset();
    expect(selectPageHasUnreadableInk(useUnreadableInkStore.getState(), 1)).toBe(false);
  });

  it("un veredicto idéntico conserva la referencia (evita re-renders de más)", () => {
    useUnreadableInkStore.getState().setPageVerdict(1, true);
    const first = useUnreadableInkStore.getState().pages;

    useUnreadableInkStore.getState().setPageVerdict(1, true);
    expect(useUnreadableInkStore.getState().pages).toBe(first);
  });
});

describe("pageHasEntity", () => {
  it("true si algún grupo tiene un miembro en esa página", () => {
    const groupsByType = new Map([
      [EntityType.Person, [makeGroup({ members: [memberOnPage(2)] })]],
    ]);
    expect(pageHasEntity(groupsByType, 2)).toBe(true);
    expect(pageHasEntity(groupsByType, 5)).toBe(false);
  });

  // "automática o manual, habilitada o no": ninguna de las dos condiciones
  // filtra. Un grupo deshabilitado o un miembro manual cuentan igual.
  it("cuenta un grupo deshabilitado y un miembro manual", () => {
    const groupsByType = new Map([
      [
        EntityType.Person,
        [
          makeGroup({
            id: "g-disabled",
            enabled: false,
            members: [memberOnPage(4, { source: DetectionSource.Manual })],
          }),
        ],
      ],
    ]);
    expect(pageHasEntity(groupsByType, 4)).toBe(true);
  });

  it("un grupo eliminado no ocupa lugar: no está en el mapa, no cuenta", () => {
    // `removeGroup` (entities.store.ts) saca el grupo del todo del mapa —acá
    // se simula ese estado, sin el grupo, para afirmar que la ausencia basta.
    const groupsByType = new Map([[EntityType.Person, []]]);
    expect(pageHasEntity(groupsByType, 0)).toBe(false);
  });
});

describe("computePendingPages / shouldConfirmPendingPages / buildCoveredPages (ADR-190 §4)", () => {
  it("excluye las páginas con alguna entidad y las que no tienen unreadableInk", () => {
    // Página 0: unreadableInk, sin entidad → pendiente.
    // Página 1: unreadableInk, CON entidad → no pendiente.
    // Página 2: sin unreadableInk → nunca entra al set de entrada.
    const unreadableInkPages = new Set([0, 1]);
    const groupsByType = new Map([
      [EntityType.Person, [makeGroup({ members: [memberOnPage(1)] })]],
    ]);

    expect(computePendingPages(unreadableInkPages, groupsByType)).toEqual([0]);
  });

  it("ordena las pendientes en orden ascendente de página", () => {
    const unreadableInkPages = new Set([5, 1, 3]);
    expect(computePendingPages(unreadableInkPages, new Map())).toEqual([1, 3, 5]);
  });

  it("lista vacía cuando no hay unreadableInk en ninguna página", () => {
    expect(computePendingPages(new Set(), new Map())).toEqual([]);
  });

  it("la confirmación se abre solo si la lista no está vacía", () => {
    expect(shouldConfirmPendingPages([])).toBe(false);
    expect(shouldConfirmPendingPages([0])).toBe(true);
  });

  it("Tapar página entera marcado por defecto: todas las pendientes viajan en coveredPages", () => {
    expect(buildCoveredPages([0, 2, 4], new Set())).toEqual([0, 2, 4]);
  });

  it("destildar una fila la saca de coveredPages, sin tocar las demás", () => {
    expect(buildCoveredPages([0, 2, 4], new Set([2]))).toEqual([0, 4]);
  });
});

describe("shouldShowUnreadableInkWarning (PageCanvas, ADR-190 §4)", () => {
  // El aviso va en una ranura absoluta sobre la imagen (mismo mecanismo que
  // el overlay de `failed` en PageCanvas.tsx), así que nunca cambia el
  // tamaño del contenedor `relative` que lo envuelve: la única condición que
  // decide si se pinta es esta función pura.
  it("aparece con unreadableInk y ninguna entidad", () => {
    expect(shouldShowUnreadableInkWarning(true, false)).toBe(true);
  });

  it("no aparece si la página ya tiene una entidad", () => {
    expect(shouldShowUnreadableInkWarning(true, true)).toBe(false);
  });

  it("no aparece si la página no tiene unreadableInk", () => {
    expect(shouldShowUnreadableInkWarning(false, false)).toBe(false);
    expect(shouldShowUnreadableInkWarning(false, true)).toBe(false);
  });
});
