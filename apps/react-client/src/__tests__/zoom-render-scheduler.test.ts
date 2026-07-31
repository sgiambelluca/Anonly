import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createZoomRenderScheduler,
  ZOOM_RERENDER_DEBOUNCE_MS,
} from "../components/viewer/zoomRenderScheduler.js";

describe("createZoomRenderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire before the debounce period elapses", () => {
    const scheduler = createZoomRenderScheduler();
    const callback = vi.fn();

    scheduler.schedule(callback);
    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS - 1);

    expect(callback).not.toHaveBeenCalled();
  });

  it("fires once the debounce period elapses with no further ticks", () => {
    const scheduler = createZoomRenderScheduler();
    const callback = vi.fn();

    scheduler.schedule(callback);
    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid ticks (rueda/pinch) into a single call with the latest callback", () => {
    const scheduler = createZoomRenderScheduler();
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    // Simula ticks cada ~16ms, muy por debajo del debounce de 150ms.
    scheduler.schedule(first);
    vi.advanceTimersByTime(16);
    scheduler.schedule(second);
    vi.advanceTimersByTime(16);
    scheduler.schedule(third);

    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending callback from firing", () => {
    const scheduler = createZoomRenderScheduler();
    const callback = vi.fn();

    scheduler.schedule(callback);
    scheduler.cancel();
    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS * 2);

    expect(callback).not.toHaveBeenCalled();
  });

  it("cancel() without a pending schedule is a no-op", () => {
    const scheduler = createZoomRenderScheduler();
    expect(() => scheduler.cancel()).not.toThrow();
  });

  it("can be re-armed after firing", () => {
    const scheduler = createZoomRenderScheduler();
    const first = vi.fn();
    const second = vi.fn();

    scheduler.schedule(first);
    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS);
    expect(first).toHaveBeenCalledTimes(1);

    scheduler.schedule(second);
    vi.advanceTimersByTime(ZOOM_RERENDER_DEBOUNCE_MS);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("respects a custom delay", () => {
    const scheduler = createZoomRenderScheduler(50);
    const callback = vi.fn();

    scheduler.schedule(callback);
    vi.advanceTimersByTime(49);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
