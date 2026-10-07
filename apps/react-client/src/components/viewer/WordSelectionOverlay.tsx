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
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { addManualEntityWithFeedback } from "../entities/addManualEntity.js";
import { EntityTypePicker } from "../entities/EntityTypePicker.js";

import {
  blankStartAnchorIndex,
  pointIsCovered,
  projectWords,
  selectVisibleSpan,
  selectionDirection,
} from "./interactionProjection.js";
import { dominantLineWords } from "./selectionLine.js";
import { wordsBoundingBox } from "./viewerGestures.js";
import { pageRectToScreenRect, pointerSelectionToPageRect } from "./wordSelectionRect.js";

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
    (activeMatchBboxes?.length ?? 0) > 0 || selection !== null
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
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
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Cuántas veces aparece: la misma búsqueda literal que la lupa. Es una
  // estimación para el texto; lo que cuenta es el `occurrenceCount` real.
  const [count] = useState(() => actions.findText(value).length);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  async function handleConfirm(): Promise<void> {
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
    const feedback = await addManualEntityWithFeedback({ value: currentValue, entityType });
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
      className="absolute z-20 flex w-[22.5rem] max-w-[calc(100%-1rem)] flex-col gap-2.5 rounded-xl border border-border bg-bg-primary p-3.5 text-sm text-text-primary shadow-md"
      style={{ left: Math.max(8, left - 40), top }}
      // El globo vive dentro de la capa que arma la selección: sin esto,
      // cualquier click adentro arrancaría un arrastre nuevo.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="truncate">
        Agregar <b className="font-semibold">«{value}»</b> como…
      </p>
      <EntityTypePicker value={entityType} onChange={setEntityType} aria-label="Tipo de entidad" />
      <p
        aria-live="polite"
        className={`h-5 truncate ${notFound ? "text-error" : "text-text-secondary"}`}
      >
        {notFound
          ? "No se encontró ese valor en el documento."
          : count === 1
            ? "Se va a ocultar su única aparición en el documento."
            : `Se van a ocultar todas sus apariciones: ${count} en el documento.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button variant="primary" loading={submitting} onClick={() => void handleConfirm()}>
          Agregar
        </Button>
      </div>
    </div>
  );
}
