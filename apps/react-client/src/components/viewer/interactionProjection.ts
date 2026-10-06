import type {
  BoundingBox,
  PreviewInteractionGeometry,
  TextMatch,
  Word,
} from "@anonly/anonymization-core";

function sameBox(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.rotation ?? 0) === (b.rotation ?? 0)
  );
}

function overlapArea(a: BoundingBox, b: BoundingBox): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

export interface ProjectedWord {
  readonly word: Word;
  readonly covered: boolean;
  readonly wordIndex: number;
}

export function projectWords(
  words: ReadonlyArray<Word>,
  geometry: PreviewInteractionGeometry,
): ReadonlyArray<ProjectedWord> {
  return words.map((word, wordIndex) => {
    const coveredRegion = geometry.coveredRegions.find((region) => {
      return overlapArea(word.bbox, region.sourceBbox) > 0;
    });
    if (coveredRegion !== undefined)
      return { word: { ...word, bbox: coveredRegion.bbox }, covered: true, wordIndex };
    const moved = geometry.wordPositions.find((position) =>
      sameBox(position.sourceBbox, word.bbox),
    );
    return {
      word: moved === undefined ? word : { ...word, bbox: moved.bbox },
      covered: false,
      wordIndex,
    };
  });
}

/** Search highlights use the matched word span and keep each visible box independent. */
export function projectMatchBoxes(
  words: ReadonlyArray<Word>,
  match: TextMatch,
  geometry: PreviewInteractionGeometry,
): ReadonlyArray<BoundingBox> {
  const projected = projectWords(words, geometry);
  const boxes: BoundingBox[] = [];
  for (const item of projected.slice(match.wordSpan.startIndex, match.wordSpan.endIndexExclusive)) {
    if (!boxes.some((box) => sameBox(box, item.word.bbox))) boxes.push(item.word.bbox);
  }
  return boxes;
}

export function pointIsCovered(
  point: { readonly x: number; readonly y: number },
  geometry: PreviewInteractionGeometry,
): boolean {
  return geometry.coveredRegions.some(
    ({ bbox }) =>
      point.x >= bbox.x &&
      point.x <= bbox.x + bbox.width &&
      point.y >= bbox.y &&
      point.y <= bbox.y + bbox.height,
  );
}

/** Read-order direction of a drag for the word's painted orientation. */
export function selectionDirection(
  box: BoundingBox,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): 1 | -1 {
  const rotation = (((box.rotation ?? 0) % 360) + 360) % 360;
  const vertical = rotation === 90 || rotation === 270;
  const pointerForward = vertical ? endY >= startY : endX >= startX;
  return pointerForward === (rotation !== 180 && rotation !== 270) ? 1 : -1;
}

/** First token of the dominant line in read order for a blank-start drag. */
export function blankStartAnchorIndex(
  lineIndexes: ReadonlyArray<number>,
  direction: 1 | -1,
): number | null {
  if (lineIndexes.length === 0) return null;
  return direction === 1 ? (lineIndexes[0] ?? null) : (lineIndexes[lineIndexes.length - 1] ?? null);
}

export function selectVisibleSpan(
  projected: ReadonlyArray<ProjectedWord>,
  anchorIndex: number,
  direction: 1 | -1,
  touchedIndices: ReadonlySet<number>,
): ReadonlyArray<number> {
  const anchor = projected[anchorIndex]?.word.bbox;
  if (anchor === undefined || projected[anchorIndex]?.covered) return [];
  const rotation = (((anchor.rotation ?? 0) % 360) + 360) % 360;
  const vertical = rotation === 90 || rotation === 270;
  const reverseAxis = rotation === 180 || rotation === 270;
  const sameLine = (a: BoundingBox, b: BoundingBox): boolean =>
    vertical
      ? Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
      : Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  const advance = (box: BoundingBox): number =>
    (vertical ? box.y + box.height / 2 : box.x + box.width / 2) * (reverseAxis ? -1 : 1);
  let start = anchorIndex;
  let end = anchorIndex;
  while (start > 0) {
    const previous = projected[start - 1]?.word.bbox;
    const current = projected[start]?.word.bbox;
    if (
      previous === undefined ||
      current === undefined ||
      advance(previous) > advance(current) ||
      !sameLine(previous, anchor)
    )
      break;
    start -= 1;
  }
  while (end + 1 < projected.length) {
    const current = projected[end]?.word.bbox;
    const next = projected[end + 1]?.word.bbox;
    if (
      current === undefined ||
      next === undefined ||
      advance(next) < advance(current) ||
      !sameLine(next, anchor)
    )
      break;
    end += 1;
  }
  const selected: number[] = [];
  for (let index = anchorIndex; index >= start && index <= end; index += direction) {
    const item = projected[index];
    if (item === undefined || item.covered) break;
    if (index !== anchorIndex && !touchedIndices.has(index)) break;
    selected.push(index);
  }
  return selected.sort((a, b) => a - b);
}
