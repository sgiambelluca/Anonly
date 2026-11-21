/**
 * `useEntityHover` — conecta el tooltip de una entidad (`EntityTooltip`) con los
 * eventos del puntero de `WordSelectionOverlay` (ADR-226 §4).
 *
 * La decisión es pura (`entityHover.ts`); acá se mide el tiempo y se lee el DOM:
 *
 * - **aparece** a los `ENTITY_TOOLTIP_DELAY_MS` de dejar el mouse quieto sobre una
 *   entidad: cada movimiento reinicia la espera, y la búsqueda se hace una sola
 *   vez, al vencer;
 * - **se va** al salir de la entidad, con `Esc`, con un clic, al hacer scroll o
 *   `wheel`, y al cambiar el zoom. Tras `Esc` o un clic no vuelve hasta que el
 *   puntero sale de esa entidad;
 * - **no aparece** mientras se arrastra para seleccionar, con una selección en
 *   pantalla, con la página inerte ni con un menú o un diálogo abierto;
 * - **no se ata al foco**: no escucha `focus`.
 *
 * El temporizador se limpia al desmontar (`Code_Standards.md` §8).
 */

import type { PreviewInteractionGeometry } from "@anonly/anonymization-core";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { useViewerStore } from "../../store/viewer.store.js";

import {
  ENTITY_TOOLTIP_DELAY_MS,
  OPEN_OVERLAY_SELECTOR,
  displayToPagePoint,
  hitTestEntity,
  isTooltipSuppressed,
  pointerStaysOn,
  type HoveredEntity,
  type PagePoint,
} from "./entityHover.js";

export interface UseEntityHoverInput {
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly interactionGeometry?: PreviewInteractionGeometry | undefined;
  readonly inert: boolean;
  readonly dragging: boolean;
  readonly hasSelection: boolean;
}

export interface UseEntityHover {
  readonly hovered: HoveredEntity | null;
  readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerLeave: () => void;
  readonly onPointerDown: () => void;
}

function isOverlayOpen(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null;
}

export function useEntityHover(input: UseEntityHoverInput): UseEntityHover {
  const { pageIndex, kind, displayWidth, displayHeight, interactionGeometry } = input;
  const suppressed = isTooltipSuppressed({
    dragging: input.dragging,
    hasSelection: input.hasSelection,
    inert: input.inert,
    // Se lee del DOM al vencer la espera; acá solo importa lo que ya se sabe.
    overlayOpen: false,
  });
  const zoom = useViewerStore((state) => state.zoom);

  const [hovered, setHovered] = useState<HoveredEntity | null>(null);
  const hoveredRef = useRef<HoveredEntity | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tras `Esc` o un clic: la entidad que no debe volver a abrirse hasta salir de ella.
  const dismissedRef = useRef<HoveredEntity | null>(null);
  const lastPointRef = useRef<PagePoint | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback((): void => {
    clearTimer();
    hoveredRef.current = null;
    setHovered(null);
  }, [clearTimer]);

  const dismiss = useCallback((): void => {
    dismissedRef.current = hoveredRef.current ?? dismissedRef.current;
    hide();
  }, [hide]);

  // Un zoom, o pasar a estar suprimido, retira el tooltip.
  useEffect(() => {
    hide();
  }, [zoom, suppressed, kind, hide]);

  // Mientras hay tooltip: `Esc`, scroll y rueda lo cierran.
  useEffect(() => {
    if (hovered === null) return;
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") dismiss();
    }
    function onScroll(): void {
      hide();
    }
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("wheel", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onScroll, true);
    };
  }, [hovered, dismiss, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  const resolve = useCallback((): void => {
    timerRef.current = null;
    const point = lastPointRef.current;
    if (point === null || isOverlayOpen()) return;
    if (
      kind === "anonymized" &&
      (interactionGeometry === undefined ||
        interactionGeometry.revision !== actions.getPreviewInteractionRevision(pageIndex))
    ) {
      return;
    }
    const found = hitTestEntity({
      kind,
      pageIndex,
      point,
      groups: [...useEntitiesStore.getState().groupsByType.values()].flat(),
      geometry: interactionGeometry,
    });
    if (found === null) return;
    hoveredRef.current = found;
    setHovered(found);
  }, [kind, pageIndex, interactionGeometry]);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      if (suppressed) return;
      const pageSize = actions.getPageSize(pageIndex);
      if (pageSize === null) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const point = displayToPagePoint(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        { width: displayWidth, height: displayHeight },
        pageSize,
      );
      if (point === null) return;
      lastPointRef.current = point;

      const current = hoveredRef.current;
      if (current !== null && pointerStaysOn(current, point)) return;
      if (current !== null) hide();

      const dismissed = dismissedRef.current;
      if (dismissed !== null) {
        if (pointerStaysOn(dismissed, point)) return;
        dismissedRef.current = null;
      }

      clearTimer();
      timerRef.current = setTimeout(resolve, ENTITY_TOOLTIP_DELAY_MS);
    },
    [suppressed, pageIndex, displayWidth, displayHeight, hide, clearTimer, resolve],
  );

  const onPointerLeave = useCallback((): void => {
    dismissedRef.current = null;
    lastPointRef.current = null;
    hide();
  }, [hide]);

  // Un clic retira el tooltip (y el visor sigue con lo suyo: arrancar una selección).
  const onPointerDown = useCallback((): void => {
    dismiss();
  }, [dismiss]);

  return { hovered, onPointerMove, onPointerLeave, onPointerDown };
}
