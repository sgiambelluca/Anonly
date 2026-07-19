import { describe, expect, it } from "vitest";

import { computeScrollSyncTarget } from "../components/viewer/scrollSync.js";

describe("computeScrollSyncTarget", () => {
  it("returns undefined when the change originated in this virtualizer's own scroll", () => {
    // lastReportedStart === targetPageIndex: este visor ya reportó ese rango,
    // así que currentPageIndex vino de su propio IntersectionObserver.
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 5,
        lastReportedStart: 5,
        currentScrollTop: 999, // no importa: no debe leerlo si ya cortó por lastReportedStart.
        pageSize: 800,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing has been reported yet and the container is already at the target", () => {
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 0,
        lastReportedStart: undefined,
        currentScrollTop: 0,
        pageSize: 800,
      }),
    ).toBeUndefined();
  });

  it("returns the target scrollTop when another virtualizer moved and this one has not caught up", () => {
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 5,
        lastReportedStart: 0,
        currentScrollTop: 0,
        pageSize: 800,
      }),
    ).toBe(4000); // 5 * 800
  });

  it("tolerates sub-pixel rounding: within 1px of the target is treated as already synced", () => {
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 5,
        lastReportedStart: 0,
        currentScrollTop: 4000.4,
        pageSize: 800,
      }),
    ).toBeUndefined();
  });

  it("returns a target exactly at the 1px tolerance boundary is still treated as a real move", () => {
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 5,
        lastReportedStart: 0,
        currentScrollTop: 3998.9, // |3998.9 - 4000| = 1.1 >= 1
        pageSize: 800,
      }),
    ).toBe(4000);
  });

  it("re-syncs to page 0 after having last reported a different page", () => {
    expect(
      computeScrollSyncTarget({
        targetPageIndex: 0,
        lastReportedStart: 5,
        currentScrollTop: 4000,
        pageSize: 800,
      }),
    ).toBe(0);
  });
});
