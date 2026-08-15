import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSearchDebouncer, SEARCH_DEBOUNCE_MS } from "../components/viewer/searchDebounce.js";

describe("createSearchDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire before the debounce period elapses", () => {
    const debouncer = createSearchDebouncer();
    const callback = vi.fn();

    debouncer.schedule(callback);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);

    expect(callback).not.toHaveBeenCalled();
  });

  it("fires once the debounce period elapses with no further ticks", () => {
    const debouncer = createSearchDebouncer();
    const callback = vi.fn();

    debouncer.schedule(callback);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid keystrokes into a single call with the latest query", () => {
    const debouncer = createSearchDebouncer();
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    debouncer.schedule(first);
    vi.advanceTimersByTime(20);
    debouncer.schedule(second);
    vi.advanceTimersByTime(20);
    debouncer.schedule(third);

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending callback from firing", () => {
    const debouncer = createSearchDebouncer();
    const callback = vi.fn();

    debouncer.schedule(callback);
    debouncer.cancel();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(callback).not.toHaveBeenCalled();
  });

  it("respects a custom delay", () => {
    const debouncer = createSearchDebouncer(50);
    const callback = vi.fn();

    debouncer.schedule(callback);
    vi.advanceTimersByTime(49);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
