/**
 * `entityHover.ts` — qué entidad hay bajo el puntero, para el tooltip del visor
 * (`Components.md` §13b.8, `UX_Guidelines.md` §11b.12, ADR-226 §4).
 *
 * Las páginas del visor son imágenes: una entidad no es un elemento del DOM, así
 * que el tooltip se resuelve igual que la selección de texto —con coordenadas de
 * página—:
 *
 * - **Original**: el texto de cada aparición de cada grupo (`OccurrenceRef.bbox`,
 *   o sus `fragments` si cruza renglones). También las de un grupo
 *   **desactivado**: sigue siendo una entidad.
 * - **Anonimizado**: el reemplazo dibujado, que es `coveredRegions[].bbox` de la
 *   geometría de interacción de esa imagen, atada a su aparición por
 *   `occurrenceId`. Un grupo desactivado no se tapa, así que su texto se busca
 *   donde quedó (`wordPositions`).
 *
 * Es una búsqueda lineal sobre los grupos y se hace **una vez**, cuando el mouse
 * lleva ~400 ms quieto, no en cada movimiento.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type {
  BoundingBox,
  EntityGroup,
  OccurrenceRef,
  PreviewInteractionGeometry,
} from "@anonly/anonymization-core";

/** Lo que el mouse tiene que quedarse quieto antes de que aparezca (ADR-226 §4). */
export const ENTITY_TOOLTIP_DELAY_MS = 400;

/**
 * Lo que cuenta como «un menú o un diálogo abierto» (ADR-226 §4): el tooltip no
 * aparece debajo. El cajón de entidades es un `dialog`, pero es la lista misma
 * (mismo criterio que `useHistoryShortcuts`).
 */
export const OPEN_OVERLAY_SELECTOR =
  '[role="alertdialog"], [role="dialog"]:not([data-entities-drawer]), [role="menu"], [role="listbox"]';

export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

export interface HoveredEntity {
  readonly group: EntityGroup;
  /** Las cajas de la aparición bajo el puntero, en coordenadas de página. */
  readonly boxes: ReadonlyArray<BoundingBox>;
  /** La caja sobre la que se ancla el tooltip: la que contiene el puntero. */
  readonly anchor: BoundingBox;
}

export function boxContains(box: BoundingBox, point: PagePoint): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** El puntero sigue sobre la misma aparición: el tooltip se queda donde está. */
export function pointerStaysOn(hovered: HoveredEntity, point: PagePoint): boolean {
  return hovered.boxes.some((box) => boxContains(box, point));
}

/** De coordenadas de pantalla (px CSS dentro de la capa) a coordenadas de página. */
export function displayToPagePoint(
  point: PagePoint,
  display: { readonly width: number; readonly height: number },
  page: { readonly width: number; readonly height: number },
): PagePoint | null {
  if (display.width <= 0 || display.height <= 0) return null;
  return {
    x: (point.x * page.width) / display.width,
    y: (point.y * page.height) / display.height,
  };
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return (
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
  );
}

function union(boxes: ReadonlyArray<BoundingBox>): BoundingBox | null {
  const [first, ...rest] = boxes;
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const box of rest) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Las cajas de texto de una aparición: sus fragmentos si cruza renglones, o su caja. */
function sourceBoxes(member: OccurrenceRef): ReadonlyArray<BoundingBox> {
  return member.fragments !== undefined && member.fragments.length > 0
    ? member.fragments
    : [member.bbox];
}

/** Dónde quedó una caja del original en la imagen anonimizada (las palabras pueden correrse). */
function projectBox(box: BoundingBox, geometry: PreviewInteractionGeometry): BoundingBox {
  const moved = geometry.wordPositions
    .filter((position) => overlaps(position.sourceBbox, box))
    .map((position) => position.bbox);
  return union(moved) ?? box;
}

export interface HitTestInput {
  readonly kind: "original" | "anonymized";
  readonly pageIndex: number;
  readonly point: PagePoint;
  readonly groups: Iterable<EntityGroup>;
  /** Imprescindible en `anonymized`: sin la geometría de esa imagen no hay reemplazos que ubicar. */
  readonly geometry?: PreviewInteractionGeometry | undefined;
}

export function hitTestEntity(input: HitTestInput): HoveredEntity | null {
  const { kind, pageIndex, point } = input;
  const groups = [...input.groups];

  if (kind === "anonymized") {
    const geometry = input.geometry;
    if (geometry === undefined) return null;
    // El reemplazo dibujado: la región cubierta que contiene el puntero.
    const region = geometry.coveredRegions.find((candidate) => boxContains(candidate.bbox, point));
    if (region !== undefined) {
      for (const group of groups) {
        if (group.members.some((member) => member.occurrenceId === region.occurrenceId)) {
          return { group, boxes: [region.bbox], anchor: region.bbox };
        }
      }
      return null;
    }
    // Un grupo desactivado no se tapa: su texto sigue a la vista, donde quedó.
    for (const group of groups) {
      if (group.enabled) continue;
      for (const member of group.members) {
        if (member.pageIndex !== pageIndex) continue;
        const boxes = sourceBoxes(member).map((box) => projectBox(box, geometry));
        const hit = boxes.find((box) => boxContains(box, point));
        if (hit !== undefined) return { group, boxes, anchor: hit };
      }
    }
    return null;
  }

  for (const group of groups) {
    for (const member of group.members) {
      if (member.pageIndex !== pageIndex) continue;
      const boxes = sourceBoxes(member);
      const hit = boxes.find((box) => boxContains(box, point));
      if (hit !== undefined) return { group, boxes, anchor: hit };
    }
  }
  return null;
}

/**
 * Cuándo el tooltip no puede aparecer (ADR-226 §4): mientras se arrastra para
 * seleccionar, con una selección en pantalla (su globo es un diálogo), con la
 * página inerte (la imagen no es la que su geometría describe) y con un menú o
 * un diálogo abierto. Un zoom lo retira el propio visor al cambiar `zoom`.
 */
export function isTooltipSuppressed(state: {
  readonly dragging: boolean;
  readonly hasSelection: boolean;
  readonly inert: boolean;
  readonly overlayOpen: boolean;
}): boolean {
  return state.dragging || state.hasSelection || state.inert || state.overlayOpen;
}

/**
 * ADR-226 §4: un clic es un gesto sin arrastre. Usa la misma tolerancia que la
 * selección de texto (`CLICK_TOLERANCE_PX`, px de pantalla), así un gesto no es
 * a la vez clic y arrastre.
 */
export function isClickGesture(start: PagePoint, end: PagePoint, tolerancePx: number): boolean {
  return Math.abs(end.x - start.x) < tolerancePx && Math.abs(end.y - start.y) < tolerancePx;
}

/**
 * Qué hace un clic sobre lo que hay bajo el puntero (ADR-226 §4): sobre una
 * entidad **activa** la selecciona en la lista; sobre una desactivada, o sobre
 * nada, no selecciona (el tooltip se cierra de todos modos).
 */
export function clickSelectsGroup(hit: HoveredEntity | null): string | null {
  return hit !== null && hit.group.enabled ? hit.group.id : null;
}

/**
 * Un clic sin arrastre que cayó sobre una entidad activa ya cumplió su función
 * (seleccionarla en la lista): el flujo de selección de texto no sigue, así no
 * se abre el globo «Agregar «…» como…». Sobre texto común el clic sigue como antes.
 */
export function clickConsumesSelection(isClick: boolean, hitActiveEntity: boolean): boolean {
  return isClick && hitActiveEntity;
}
