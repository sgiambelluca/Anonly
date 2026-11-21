/**
 * `WordSelectionOverlay` (`ui/Components.md` §5.4b, ADR-061 §3/§4 ruta B;
 * selección persistente por ADR-169 §7).
 *
 * Capa transparente sobre el `PageCanvas` del panel activo. En `anonymized`
 * necesita la geometría de interacción vigente para traducir palabras y
 * bloquear regiones cubiertas por reemplazos; sin ese mapa queda inerte.
 *
 * Click o arrastre → `pointerSelectionToPageRect` traduce a coordenadas de
 * página → `wordsInRect` (`@anonly/shared`) hit-test contra `Page.words` →
 * recorte a un renglón (ADR-114 §1). Sin capa de texto de pdf.js (ADR-061
 * Contexto §3): funciona igual en PDFs digitales y escaneados.
 *
 * **La selección persiste** (ADR-169 §7): el recuadro de lo señalado se
 * dibuja con borde punteado de acento animado y **no desaparece** hasta que
 * se agrega la entidad, se cancela, se hace otra selección, se presiona
 * Escape, se conmuta a Anonimizado o se cierra el documento. El estado vive en
 * `PdfViewer` (una sola selección para todo el documento, sobreviva o no la
 * página a la virtualización); esta capa solo la dibuja y la origina.
 *
 * El globo "Agregar «X» como…" es flotante y usa `EntityTypePicker`.
 *
 * **Tooltip de la entidad bajo el puntero** (ADR-226 §4): `useEntityHover` toma los
 * mismos eventos del puntero y `EntityTooltip` flota sobre la página; ver
 * `entityHover.ts` para qué es «bajo el puntero» en cada vista.
 *
 * También pinta el resaltado del resultado activo de la lupa
 * (`activeMatchBbox`) — mismo mecanismo, sentido inverso.
 */

import {
  EntityType,
  wordsInRect,
  type BoundingBox,
  type PreviewInteractionGeometry,
  type Word,
} from "@anonly/anonymization-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDetectionStore } from "../../store/detection.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { useSettingsStore } from "../../store/settings.store.js";
import { Button } from "../common/Button.js";
import { addManualEntityWithFeedback } from "../entities/addManualEntity.js";
import { EntityTypePicker } from "../entities/EntityTypePicker.js";
import { useTypeChoice } from "../entities/useTypeChoice.js";
import { useUserTypes } from "../entities/useUserTypes.js";

import { entityHighlightsOnPage, HIGHLIGHT_PAD_PX, highlightStyle } from "./entityHighlights.js";
import { clickConsumesSelection, isClickGesture } from "./entityHover.js";
import { EntityTooltip } from "./EntityTooltip.js";
import { buildEntityTooltip } from "./entityTooltipContent.js";
import {
  blankStartAnchorIndex,
  pointIsCovered,
  projectWords,
  selectVisibleSpan,
  selectionDirection,
} from "./interactionProjection.js";
import { shiftIntoWindow } from "./popoverShift.js";
import { dominantLineWords } from "./selectionLine.js";
import { useEntityHover } from "./useEntityHover.js";
import { wordsBoundingBox } from "./viewerGestures.js";
import {
  CLICK_TOLERANCE_PX,
  pageRectToScreenRect,
  pointerSelectionToPageRect,
} from "./wordSelectionRect.js";

/** Lo señalado en el original: palabras de un renglón de una página. */
export interface PageSelection {
  readonly pageIndex: number;
  readonly words: ReadonlyArray<Word>;
  readonly wordIndexes: ReadonlyArray<number>;
  readonly interactionRevision: number | null;
  readonly kind: "original" | "anonymized";
}

export interface WordSelectionOverlayProps {
  readonly pageIndex: number;
  /** Tamaño en pantalla (CSS px) del `PageCanvas` que esta capa cubre. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Bbox de página del resultado activo de la lupa, si hay uno en esta página. */
  readonly activeMatchBboxes?: ReadonlyArray<BoundingBox>;
  readonly kind: "original" | "anonymized";
  /**
   * ADR-213 §6: la página está pintando la imagen del otro lado mientras espera
   * la vigente. La capa no admite selección ni dibuja resaltados: lo que se ve
   * no es lo que su geometría describe.
   */
  readonly inert?: boolean;
  readonly interactionGeometry?: PreviewInteractionGeometry;
  /** La selección vigente si es de esta página, o `null`. */
  readonly selection: PageSelection | null;
  readonly onSelect: (selection: PageSelection) => void;
  readonly onClearSelection: () => void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function distanceSquared(box: BoundingBox, x: number, y: number): number {
  const dx = x < box.x ? box.x - x : x > box.x + box.width ? x - box.x - box.width : 0;
  const dy = y < box.y ? box.y - y : y > box.y + box.height ? y - box.y - box.height : 0;
  return dx * dx + dy * dy;
}

export function WordSelectionOverlay({
  pageIndex,
  displayWidth,
  displayHeight,
  activeMatchBboxes,
  kind,
  inert = false,
  interactionGeometry,
  selection,
  onSelect,
  onClearSelection,
}: WordSelectionOverlayProps) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const dragRevisionRef = useRef<number | null>(null);
  // ADR-226 §4: el tooltip de la entidad bajo el puntero, con los mismos eventos
  // que ya atiende esta capa. Flota; no mueve nada.
  const hover = useEntityHover({
    pageIndex,
    kind,
    displayWidth,
    displayHeight,
    interactionGeometry,
    inert,
    dragging: dragStart !== null,
    hasSelection: selection !== null,
  });
  const userTypes = useUserTypes();
  const detection = useDetectionStore((state) => state.saved);
  // UX_Guidelines.md §5.2: el resaltado de las entidades, solo en el original,
  // con la página mostrando su propia imagen (ADR-213 §6) y si el usuario no lo
  // apagó en Configuración (Components.md §13b.8).
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const highlightsOn = useSettingsStore((state) => state.highlightEntities);
  // El grupo que se acaba de elegir con un clic queda marcado mientras su fila se ilumina.
  const flashGroupId = useEntitiesStore((state) => state.flashGroupId);
  const entityHighlights = useMemo(
    () =>
      kind === "original" && !inert && highlightsOn
        ? entityHighlightsOnPage([...groupsByType.values()].flat(), pageIndex)
        : [],
    [kind, inert, highlightsOn, groupsByType, pageIndex],
  );

  function pointFromEvent(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    dragRevisionRef.current = actions.getPreviewInteractionRevision(pageIndex);
    if (kind === "anonymized") {
      const geometry = interactionGeometry;
      if (
        geometry === undefined ||
        geometry.revision !== actions.getPreviewInteractionRevision(pageIndex)
      )
        return;
      const size = actions.getPageSize(pageIndex);
      if (size === null) return;
      const pagePoint = {
        x: (point.x * size.width) / displayWidth,
        y: (point.y * size.height) / displayHeight,
      };
      if (pointIsCovered(pagePoint, geometry)) return;
    }
    setDragStart(point);
    setDragCurrent(point);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return;
    setDragCurrent(pointFromEvent(event));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return;
    const end = pointFromEvent(event);
    setDragStart(null);
    setDragCurrent(null);
    // ADR-226 §4: un clic sin arrastre sobre una entidad activa la selecciona en la lista.
    // Y no sigue como selección de texto (no abre el globo de agregar).
    const isClick = isClickGesture(dragStart, end, CLICK_TOLERANCE_PX);
    if (clickConsumesSelection(isClick, isClick && hover.onClick(end))) {
      dragRevisionRef.current = null;
      return;
    }
    if (dragRevisionRef.current !== actions.getPreviewInteractionRevision(pageIndex)) {
      dragRevisionRef.current = null;
      return;
    }
    dragRevisionRef.current = null;

    const pageSize = actions.getPageSize(pageIndex);
    if (pageSize === null) return;

    const rect = pointerSelectionToPageRect({
      startX: dragStart.x,
      startY: dragStart.y,
      endX: end.x,
      endY: end.y,
      displayWidth,
      displayHeight,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    });

    const sourceWords = actions.getPageWords(pageIndex);
    const geometry = kind === "anonymized" ? interactionGeometry : undefined;
    if (
      kind === "anonymized" &&
      (geometry === undefined ||
        geometry.revision !== actions.getPreviewInteractionRevision(pageIndex))
    )
      return;
    const projected =
      geometry === undefined
        ? sourceWords.map((word, wordIndex) => ({ word, covered: false, wordIndex }))
        : projectWords(sourceWords, geometry);
    const pageWords = projected.map((item) => item.word);
    // ADR-114 §1: al renglón dominante. El valor se arma con `join(" ")` y la
    // búsqueda literal exige palabras consecutivas de una misma línea.
    const touched = wordsInRect(pageWords, rect);
    const selectedLine = dominantLineWords(pageWords, touched, rect);
    let wordIndexes: ReadonlyArray<number> = selectedLine.map((word) => pageWords.indexOf(word));
    if (geometry !== undefined && touched.length > 0) {
      const startX = (dragStart.x * pageSize.width) / displayWidth;
      const endX = (end.x * pageSize.width) / displayWidth;
      const startY = (dragStart.y * pageSize.height) / displayHeight;
      const endY = (end.y * pageSize.height) / displayHeight;
      const startRect = pointerSelectionToPageRect({
        startX: dragStart.x,
        startY: dragStart.y,
        endX: dragStart.x,
        endY: dragStart.y,
        displayWidth,
        displayHeight,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
      });
      const startCandidates = [...wordsInRect(pageWords, startRect)];
      const startWord = startCandidates.sort(
        (a, b) => distanceSquared(a.bbox, startX, startY) - distanceSquared(b.bbox, startX, startY),
      )[0];
      const lineDirection = selectionDirection(
        selectedLine[0]?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
        startX,
        startY,
        endX,
        endY,
      );
      const fallbackIndex = blankStartAnchorIndex(
        selectedLine.map((word) => pageWords.indexOf(word)),
        lineDirection,
      );
      // Un inicio sobre una palabra visible conserva el ancla original. Si
      // cae en blanco, el rectángulo ya eligió el renglón dominante según
      // ADR-114; anclamos su primer token en la dirección del gesto.
      const fallbackWord =
        startWord === undefined
          ? fallbackIndex === null
            ? undefined
            : pageWords[fallbackIndex]
          : undefined;
      const anchorWord = startWord ?? fallbackWord;
      if (anchorWord === undefined) return;
      const direction = selectionDirection(anchorWord.bbox, startX, startY, endX, endY);
      const anchorIndex = pageWords.indexOf(anchorWord);
      const touchedIndices = new Set(touched.map((word) => pageWords.indexOf(word)));
      wordIndexes = selectVisibleSpan(projected, anchorIndex, direction, touchedIndices);
      if (geometry.revision !== actions.getPreviewInteractionRevision(pageIndex)) return;
    }
    // Un click en un lugar sin palabras no borra la selección que había: solo
    // "otra selección" la reemplaza (ADR-169 §7).
    const words = wordIndexes
      .map((index) => pageWords[index])
      .filter((word): word is Word => word !== undefined);
    if (words.length === 0) return;
    onSelect({
      pageIndex,
      words,
      wordIndexes,
      interactionRevision: actions.getPreviewInteractionRevision(pageIndex),
      kind,
    });
  }

  const pageSize =
    (activeMatchBboxes?.length ?? 0) > 0 ||
    selection !== null ||
    hover.hovered !== null ||
    entityHighlights.length > 0
      ? actions.getPageSize(pageIndex)
      : null;
  const toScreen = (box: BoundingBox) =>
    pageSize === null
      ? null
      : // Spread en un literal fresco: `CSSProperties` no acepta un tipo con
        // nombre aunque calce estructuralmente.
        {
          ...pageRectToScreenRect(
            box,
            { displayWidth, displayHeight },
            { pageWidth: pageSize.width, pageHeight: pageSize.height },
          ),
        };

  const highlightRects = inert
    ? []
    : (activeMatchBboxes ?? []).map(toScreen).filter((rect) => rect !== null);
  const selectionBox = selection !== null && !inert ? wordsBoundingBox(selection.words) : null;
  const selectionRect = selectionBox !== null ? toScreen(selectionBox) : null;

  const tooltipRect = hover.hovered !== null ? toScreen(hover.hovered.anchor) : null;

  const dragRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x),
          top: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <div
      className={`absolute inset-0 select-none ${!inert && (kind === "original" || interactionGeometry !== undefined) ? "cursor-crosshair" : "pointer-events-none"}`}
      onPointerDown={(event) => {
        hover.onPointerDown();
        handlePointerDown(event);
      }}
      onPointerMove={(event) => {
        handlePointerMove(event);
        hover.onPointerMove(event);
      }}
      onPointerLeave={hover.onPointerLeave}
      onPointerUp={handlePointerUp}
    >
      {/* Debajo de todo lo demás: la lupa, el arrastre y la selección se ven encima. */}
      {entityHighlights.map((highlight) => {
        const rect = toScreen(highlight.box);
        if (rect === null) return null;
        return (
          <div
            key={highlight.key}
            aria-hidden
            className="pointer-events-none absolute rounded-[2px] border-[1.5px]"
            style={{
              left: rect.left - HIGHLIGHT_PAD_PX.x,
              top: rect.top - HIGHLIGHT_PAD_PX.y,
              width: rect.width + HIGHLIGHT_PAD_PX.x * 2,
              height: rect.height + HIGHLIGHT_PAD_PX.y * 2,
              ...highlightStyle(
                highlight.type,
                highlight.enabled,
                hover.hovered?.group.id === highlight.groupId || flashGroupId === highlight.groupId,
              ),
            }}
          />
        );
      })}
      {highlightRects.map((rect, index) => (
        <div
          key={index}
          className="pointer-events-none absolute border-2 border-warning-strong bg-warning/30"
          style={rect}
        />
      ))}
      {dragRect ? (
        <div
          className="pointer-events-none absolute border border-accent bg-accent/20"
          style={dragRect}
        />
      ) : null}
      {hover.hovered !== null && tooltipRect !== null ? (
        <EntityTooltip
          rect={tooltipRect}
          type={hover.hovered.group.type}
          content={buildEntityTooltip(hover.hovered.group, userTypes, detection)}
        />
      ) : null}
      {selection !== null && !inert && selectionRect !== null ? (
        <>
          <div
            aria-hidden
            className="anonly-selection pointer-events-none absolute rounded-sm"
            style={{
              left: selectionRect.left - 2,
              top: selectionRect.top - 2,
              width: selectionRect.width + 4,
              height: selectionRect.height + 4,
            }}
          />
          <SelectionPopover
            key={selection.words.map((word) => word.text).join(" ")}
            value={selection.words.map((word) => word.text).join(" ")}
            left={selectionRect.left}
            top={selectionRect.top + selectionRect.height + 10}
            pageIndex={pageIndex}
            wordIndexes={selection.wordIndexes}
            interactionRevision={selection.interactionRevision}
            kind={selection.kind}
            {...(interactionGeometry !== undefined ? { interactionGeometry } : {})}
            onClose={onClearSelection}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * El globo "Agregar «X» como…" (ADR-169 §7): `EntityTypePicker`, cuántas
 * apariciones se van a ocultar y Cancelar / Agregar. Flotante: no mueve nada.
 * El "no se encontró" ocupa una ranura de alto fijo (UX-10).
 */
function SelectionPopover({
  value,
  left,
  top,
  pageIndex,
  wordIndexes,
  interactionRevision,
  kind,
  interactionGeometry,
  onClose,
}: {
  readonly value: string;
  readonly left: number;
  readonly top: number;
  readonly pageIndex: number;
  readonly wordIndexes: ReadonlyArray<number>;
  readonly interactionRevision: number | null;
  readonly kind: "original" | "anonymized";
  readonly interactionGeometry?: PreviewInteractionGeometry;
  readonly onClose: () => void;
}) {
  const choice = useTypeChoice(EntityType.Person);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Cuántas veces aparece: la misma búsqueda literal que la lupa. Es una
  // estimación para el texto; lo que cuenta es el `occurrenceCount` real.
  const [count] = useState(() => actions.findText(value).length);
  // Que el globo quede entero dentro de la ventana (no se corta por la derecha).
  const ref = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const next = shiftIntoWindow(rect.left - shiftX, rect.right - shiftX, window.innerWidth);
    if (next !== shiftX) setShiftX(next);
  }, [left, shiftX]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  async function handleConfirm(): Promise<void> {
    const resolved = choice.resolve();
    if (resolved === null) return;
    setSubmitting(true);
    if (
      interactionRevision !== null &&
      (interactionRevision !== actions.getPreviewInteractionRevision(pageIndex) ||
        (kind === "anonymized" && interactionGeometry?.revision !== interactionRevision))
    ) {
      setSubmitting(false);
      onClose();
      return;
    }
    const currentWords = actions.getPageWords(pageIndex);
    const projected =
      kind === "original" || interactionGeometry === undefined
        ? currentWords.map((word) => ({ word, covered: false }))
        : projectWords(currentWords, interactionGeometry);
    const selected = wordIndexes.map((index) => projected[index]);
    if (selected.some((item) => item === undefined || item.covered)) {
      setSubmitting(false);
      onClose();
      return;
    }
    const currentValue = selected.map((item) => item?.word.text ?? "").join(" ");
    // ADR-114 §2: se espera el resultado — "no se encontró" y "se agregaron
    // 18" no pueden verse igual. Con éxito, el toast de ADR-169 §7.
    const feedback = await addManualEntityWithFeedback(
      { value: currentValue, entityType: resolved.entityType },
      resolved.newType,
      resolved.saveNewType === true,
    );
    setSubmitting(false);
    if (feedback === "not-found") {
      setNotFound(true);
      return;
    }
    // ADR-174 §4 / ADR-175 §3: "held" cierra este globo igual que "added" —
    // lo que sigue es `ManualOverlapDialog`. "error" también cierra: el
    // toast de error ya lo dice.
    if (feedback === "added" || feedback === "held" || feedback === "error") onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Agregar la selección como entidad"
      ref={ref}
      className="absolute z-20 flex w-[22.5rem] max-w-[calc(100%-1rem)] flex-col gap-2.5 rounded-xl border border-border bg-bg-primary p-3.5 text-sm text-text-primary shadow-md"
      style={{ left: Math.max(8, left - 40) + shiftX, top }}
      // El globo vive dentro de la capa que arma la selección: sin esto,
      // cualquier click adentro arrancaría un arrastre nuevo.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="truncate">
        Agregar <b className="font-semibold">«{value}»</b> como…
      </p>
      <EntityTypePicker
        {...choice.pickerProps}
        onNewTypeSubmit={() => void handleConfirm()}
        aria-label="Tipo de entidad"
      />
      {/* La línea de pie: el error del nombre del tipo nuevo ocupa su lugar (ADR-229 §2). */}
      <p
        aria-live="polite"
        className={`h-5 truncate ${notFound || choice.error !== null ? "text-error" : "text-text-secondary"}`}
      >
        {choice.error !== null
          ? choice.error
          : notFound
            ? "No se encontró ese valor en el documento."
            : count === 1
              ? "Se va a ocultar su única aparición en el documento."
              : `Se van a ocultar todas sus apariciones: ${count} en el documento.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          loading={submitting}
          disabled={!choice.canConfirm}
          onClick={() => void handleConfirm()}
        >
          {choice.creating ? "Crear y agregar" : "Agregar"}
        </Button>
      </div>
    </div>
  );
}
