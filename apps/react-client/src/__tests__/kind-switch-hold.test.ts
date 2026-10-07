import { describe, expect, it } from "vitest";

import {
  isCurrentImage,
  KIND_SWITCH_HOLD_MS,
  selectPageImage,
  type SelectPageImageParams,
} from "../components/viewer/kindSwitchHold.js";

// ADR-213 §3/§4: qué imagen pinta una página al conmutar de vista. Hacia Original se
// sostiene la anonimizada hasta que llega la vigente; hacia Anonimizado NUNCA se pinta
// la original (enmienda del mantenedor).

/** Se pasa a Original: `own` es la original, `other` la anonimizada. */
const toOriginal: SelectPageImageParams = {
  viewing: "original",
  own: { blobUrl: "blob:own", scale: 1.3 },
  other: { blobUrl: "blob:other" },
  expectedScale: 1.3,
  holdActive: true,
  failed: false,
};

/** Se pasa a Anonimizado: `own` es la anonimizada, `other` la original. */
const toAnonymized: SelectPageImageParams = { ...toOriginal, viewing: "anonymized" };

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

describe("selectPageImage — switching to Original", () => {
  it("paints the own image when it is current, even while the hold is active", () => {
    expect(selectPageImage(toOriginal)).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("keeps painting the anonymized image while the own one is not current", () => {
    const choice = selectPageImage({ ...toOriginal, own: { blobUrl: "blob:own", scale: 1 } });
    expect(choice).toEqual({ blobUrl: "blob:other", fromOtherKind: true });
  });

  it("keeps painting the anonymized image while the own one does not exist yet", () => {
    const choice = selectPageImage({
      ...toOriginal,
      own: { blobUrl: undefined, scale: undefined },
    });
    expect(choice).toEqual({ blobUrl: "blob:other", fromOtherKind: true });
  });

  it("changes to the own image as soon as the current one arrives", () => {
    const waiting = selectPageImage({ ...toOriginal, own: { blobUrl: "blob:old", scale: 1 } });
    const arrived = selectPageImage({ ...toOriginal, own: { blobUrl: "blob:new", scale: 1.3 } });
    expect(waiting.blobUrl).toBe("blob:other");
    expect(arrived).toEqual({ blobUrl: "blob:new", fromOtherKind: false });
  });

  it("paints whatever the own kind has once the hold expired", () => {
    const choice = selectPageImage({
      ...toOriginal,
      own: { blobUrl: "blob:own", scale: 1 },
      holdActive: false,
    });
    expect(choice).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("does not hold a failed page", () => {
    const choice = selectPageImage({
      ...toOriginal,
      own: { blobUrl: undefined, scale: undefined },
      failed: true,
    });
    expect(choice).toEqual({ blobUrl: undefined, fromOtherKind: false });
  });

  it("falls back to the own image when there is no anonymized image to hold", () => {
    const choice = selectPageImage({
      ...toOriginal,
      own: { blobUrl: "blob:own", scale: 1 },
      other: { blobUrl: undefined },
    });
    expect(choice).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("returns no image when neither kind has one (loading state)", () => {
    const choice = selectPageImage({
      ...toOriginal,
      own: { blobUrl: undefined, scale: undefined },
      other: { blobUrl: undefined },
    });
    expect(choice).toEqual({ blobUrl: undefined, fromOtherKind: false });
  });

  it("decides page by page: the same switch holds one page and not the next", () => {
    const heldPage = selectPageImage({ ...toOriginal, own: { blobUrl: "blob:a", scale: 1 } });
    const readyPage = selectPageImage({ ...toOriginal, own: { blobUrl: "blob:b", scale: 1.3 } });
    expect(heldPage.fromOtherKind).toBe(true);
    expect(readyPage.fromOtherKind).toBe(false);
  });
});

describe("selectPageImage — switching to Anonymized (never paints the original)", () => {
  it("paints the own anonymized image when it is current", () => {
    expect(selectPageImage(toAnonymized)).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("paints the own anonymized image at another scale instead of the original one", () => {
    const choice = selectPageImage({ ...toAnonymized, own: { blobUrl: "blob:own", scale: 1 } });
    expect(choice).toEqual({ blobUrl: "blob:own", fromOtherKind: false });
  });

  it("paints the loading state, not the original, when there is no anonymized image", () => {
    const choice = selectPageImage({
      ...toAnonymized,
      own: { blobUrl: undefined, scale: undefined },
    });
    expect(choice).toEqual({ blobUrl: undefined, fromOtherKind: false });
  });

  it("never returns the other kind's image, whatever the hold, scale or failure state", () => {
    for (const holdActive of [true, false]) {
      for (const failed of [true, false]) {
        for (const own of [
          { blobUrl: undefined, scale: undefined },
          { blobUrl: "blob:own", scale: 1 },
          { blobUrl: "blob:own", scale: 1.3 },
        ]) {
          const choice = selectPageImage({ ...toAnonymized, own, holdActive, failed });
          expect(choice.blobUrl).not.toBe("blob:other");
          expect(choice.fromOtherKind).toBe(false);
        }
      }
    }
  });
});
