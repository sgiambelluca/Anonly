import { describe, expect, it } from "vitest";

import {
  isCurrentImage,
  KIND_SWITCH_HOLD_MS,
  selectPageImage,
  type SelectPageImageParams,
} from "../components/viewer/kindSwitchHold.js";

// ADR-213 §3/§4: qué imagen pinta una página al conmutar de vista.

const base: SelectPageImageParams = {
  own: { blobUrl: "blob:own", scale: 1.3 },
  other: { blobUrl: "blob:other" },
  expectedScale: 1.3,
  holdActive: true,
  failed: false,
};

describe("KIND_SWITCH_HOLD_MS", () => {
  it("is half a second (ADR-213 §4)", () => {
    expect(KIND_SWITCH_HOLD_MS).toBe(500);
  });
});

describe("isCurrentImage", () => {
  it("is true when the image exists and arrived at the scale of the zoom", () => {
    expect(isCurrentImage({ blobUrl: "blob:x", scale: 1.3 }, 1.3)).toBe(true);
  });

  it("is false when the image arrived at another scale", () => {
    expect(isCurrentImage({ blobUrl: "blob:x", scale: 1 }, 1.3)).toBe(false);
  });

  it("is false without an image or without a noted scale", () => {
    expect(isCurrentImage({ blobUrl: undefined, scale: 1.3 }, 1.3)).toBe(false);
    expect(isCurrentImage({ blobUrl: "blob:x", scale: undefined }, 1.3)).toBe(false);
  });

  it("tolerates floating-point noise in the scale", () => {
    expect(isCurrentImage({ blobUrl: "blob:x", scale: 1 + 0.1 + 0.1 + 0.1 }, 1.3)).toBe(true);
  });
});

describe("selectPageImage", () => {
  it("paints the own image when it is current, even while the hold is active", () => {
    expect(selectPageImage(base)).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("keeps painting the image of the other kind while the own one is not current", () => {
    const choice = selectPageImage({ ...base, own: { blobUrl: "blob:own", scale: 1 } });
    expect(choice).toEqual({ blobUrl: "blob:other", fromOtherKind: true });
  });

  it("keeps painting the image of the other kind while the own one does not exist yet", () => {
    const choice = selectPageImage({ ...base, own: { blobUrl: undefined, scale: undefined } });
    expect(choice).toEqual({ blobUrl: "blob:other", fromOtherKind: true });
  });

  it("changes to the own image as soon as the current one arrives", () => {
    const waiting = selectPageImage({ ...base, own: { blobUrl: "blob:old", scale: 1 } });
    const arrived = selectPageImage({ ...base, own: { blobUrl: "blob:new", scale: 1.3 } });
    expect(waiting.blobUrl).toBe("blob:other");
    expect(arrived).toEqual({ blobUrl: "blob:new", fromOtherKind: false });
  });

  it("paints whatever the own kind has once the hold expired", () => {
    const choice = selectPageImage({
      ...base,
      own: { blobUrl: "blob:own", scale: 1 },
      holdActive: false,
    });
    expect(choice).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("does not hold a failed page", () => {
    const choice = selectPageImage({
      ...base,
      own: { blobUrl: undefined, scale: undefined },
      failed: true,
    });
    expect(choice).toEqual({ blobUrl: undefined, fromOtherKind: false });
  });

  it("falls back to the own image when the other kind has none", () => {
    const choice = selectPageImage({
      ...base,
      own: { blobUrl: "blob:own", scale: 1 },
      other: { blobUrl: undefined },
    });
    expect(choice).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("returns no image when neither kind has one (skeleton)", () => {
    const choice = selectPageImage({
      ...base,
      own: { blobUrl: undefined, scale: undefined },
      other: { blobUrl: undefined },
    });
    expect(choice).toEqual({ blobUrl: undefined, fromOtherKind: false });
  });

  it("decides page by page: the same switch holds one page and not the next", () => {
    const heldPage = selectPageImage({ ...base, own: { blobUrl: "blob:a", scale: 1 } });
    const readyPage = selectPageImage({ ...base, own: { blobUrl: "blob:b", scale: 1.3 } });
    expect(heldPage.fromOtherKind).toBe(true);
    expect(readyPage.fromOtherKind).toBe(false);
  });
});
