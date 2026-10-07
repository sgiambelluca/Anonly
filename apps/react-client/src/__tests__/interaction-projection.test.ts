import { describe, expect, it } from "vitest";

import {
  pointIsCovered,
  blankStartAnchorIndex,
  projectMatchBoxes,
  projectWords,
  selectionDirection,
  selectVisibleSpan,
} from "../components/viewer/interactionProjection.js";

const words = [
  {
    text: "Ana",
    bbox: { x: 10, y: 10, width: 20, height: 10 },
    pageIndex: 0,
    confidence: 1,
    source: "pdf" as const,
  },
  {
    text: "García",
    bbox: { x: 35, y: 10, width: 30, height: 10 },
    pageIndex: 0,
    confidence: 1,
    source: "pdf" as const,
  },
];

const geometry = {
  revision: 4,
  scale: 2,
  wordPositions: [{ sourceBbox: words[1]!.bbox, bbox: { ...words[1]!.bbox, x: 52 } }],
  coveredRegions: [
    {
      occurrenceId: "occ-a",
      sourceBbox: words[0]!.bbox,
      bbox: { x: 10, y: 12, width: 16, height: 5 },
    },
  ],
};

describe("anonymous preview interaction geometry", () => {
  it("projects visible words and flags any positive source overlap as covered", () => {
    const projected = projectWords(words, geometry);
    expect(projected[0]).toEqual({
      word: { ...words[0], bbox: geometry.coveredRegions[0]!.bbox },
      covered: true,
      wordIndex: 0,
    });
    expect(projected[1]).toEqual({
      word: { ...words[1], bbox: { ...words[1]!.bbox, x: 52 } },
      covered: false,
      wordIndex: 1,
    });
  });

  it("highlights each matched visible box and maps covered matches to the replacement tag", () => {
    expect(
      projectMatchBoxes(
        words,
        {
          pageIndex: 0,
          text: "Ana García",
          bbox: { x: 10, y: 10, width: 55, height: 10 },
          wordSpan: { startIndex: 0, endIndexExclusive: 2 },
        },
        geometry,
      ),
    ).toEqual([geometry.coveredRegions[0]!.bbox, { ...words[1]!.bbox, x: 52 }]);
  });

  it("detects pointer starts over the actually painted label", () => {
    expect(pointIsCovered({ x: 12, y: 13 }, geometry)).toBe(true);
    expect(pointIsCovered({ x: 30, y: 13 }, geometry)).toBe(false);
  });

  it("chooses the first token of the touched dominant line in read direction, including rotated text", () => {
    expect(blankStartAnchorIndex([3, 4, 5], 1)).toBe(3);
    expect(blankStartAnchorIndex([3, 4, 5], -1)).toBe(5);
    expect(blankStartAnchorIndex([], 1)).toBeNull();
    expect(selectionDirection({ x: 0, y: 0, width: 4, height: 8 }, 0, 0, 5, 0)).toBe(1);
    expect(selectionDirection({ x: 0, y: 0, width: 4, height: 8 }, 5, 0, 0, 0)).toBe(-1);
    expect(selectionDirection({ x: 0, y: 0, width: 4, height: 8, rotation: 90 }, 0, 0, 0, 5)).toBe(
      1,
    );
    expect(selectionDirection({ x: 0, y: 0, width: 4, height: 8, rotation: 270 }, 0, 5, 0, 0)).toBe(
      1,
    );
  });

  it("anchors selection at the visible start word, truncates in either direction, and never skips a word", () => {
    const line = projectWords(
      [
        ...words,
        {
          text: "vive",
          bbox: { x: 70, y: 10, width: 18, height: 10 },
          pageIndex: 0,
          confidence: 1,
          source: "pdf" as const,
        },
        {
          text: "bien",
          bbox: { x: 94, y: 10, width: 20, height: 10 },
          pageIndex: 0,
          confidence: 1,
          source: "pdf" as const,
        },
      ],
      {
        ...geometry,
        wordPositions: [],
        coveredRegions: [
          {
            occurrenceId: "occ-a",
            sourceBbox: { x: 70, y: 10, width: 18, height: 10 },
            bbox: { x: 70, y: 10, width: 18, height: 10 },
          },
        ],
      },
    );
    expect(selectVisibleSpan(line, 0, 1, new Set([0, 1, 2, 3]))).toEqual([0, 1]);
    expect(selectVisibleSpan(line, 3, -1, new Set([0, 1, 2, 3]))).toEqual([3]);
    expect(selectVisibleSpan(line, 2, 1, new Set([2, 3]))).toEqual([]);
    expect(selectVisibleSpan(line, 0, 1, new Set([0, 2, 3]))).toEqual([0]);
  });

  it("matches original read-order selection for 90/270 degree lines and clips at covered words", () => {
    const rotatedWords = [100, 120, 140].map((y, index) => ({
      text: `v${index}`,
      bbox: { x: 100, y, width: 8, height: 15, rotation: 90 as const },
      pageIndex: 0,
      confidence: 1,
      source: "pdf" as const,
    }));
    const rotated = projectWords(rotatedWords, {
      revision: 1,
      scale: 1,
      wordPositions: [],
      coveredRegions: [],
    });
    expect(selectVisibleSpan(rotated, 0, 1, new Set([0, 1, 2]))).toEqual([0, 1, 2]);
    expect(selectVisibleSpan(rotated, 2, -1, new Set([0, 1, 2]))).toEqual([0, 1, 2]);

    const clipped = projectWords(rotatedWords, {
      revision: 2,
      scale: 1,
      wordPositions: [],
      coveredRegions: [
        {
          occurrenceId: "rotated-occurrence",
          sourceBbox: rotatedWords[1]!.bbox,
          bbox: { x: 100, y: 120, width: 8, height: 15, rotation: 90 },
        },
      ],
    });
    // The middle label clips even when a thin drag did not touch its bbox.
    expect(selectVisibleSpan(clipped, 0, 1, new Set([0, 2]))).toEqual([0]);
    expect(selectVisibleSpan(clipped, 2, -1, new Set([0, 2]))).toEqual([2]);

    const reverseRotated = rotatedWords.map((word, index) => ({
      ...word,
      bbox: { ...word.bbox, y: 140 - index * 20, rotation: 270 as const },
    }));
    const reverseLine = projectWords(reverseRotated, {
      revision: 3,
      scale: 1,
      wordPositions: [],
      coveredRegions: [],
    });
    expect(selectVisibleSpan(reverseLine, 0, 1, new Set([0, 1, 2]))).toEqual([0, 1, 2]);
    expect(selectVisibleSpan(reverseLine, 2, -1, new Set([0, 1, 2]))).toEqual([0, 1, 2]);
  });
});
