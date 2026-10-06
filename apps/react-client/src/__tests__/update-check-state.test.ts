import { describe, expect, it, vi } from "vitest";

import { transitionManualUpdateCheck } from "../components/toolbar/updateCheckState.js";
import { subscribeToUpdateEvents, type ShellUpdater, type UpdateEvent } from "../updater/index.js";

describe("confirmación de búsqueda manual de actualizaciones", () => {
  it("solo confirma update-not-available mientras una búsqueda manual está pendiente", () => {
    expect(transitionManualUpdateCheck("idle", { type: "update-not-available" })).toBe("idle");
    expect(transitionManualUpdateCheck("checking", { type: "checking" })).toBe("checking");
    expect(transitionManualUpdateCheck("checking", { type: "update-not-available" })).toBe(
      "up-to-date",
    );
  });

  it("informa que la búsqueda no está disponible solo para una solicitud manual pendiente", () => {
    expect(transitionManualUpdateCheck("idle", { type: "check-unavailable" })).toBe("idle");
    expect(transitionManualUpdateCheck("checking", { type: "check-unavailable" })).toBe(
      "unavailable",
    );
  });

  it.each(["update-available", "update-downloaded", "error"])(
    "%s no deja un mensaje de última versión",
    (type) => {
      expect(transitionManualUpdateCheck("checking", { type } as UpdateEvent)).toBe("idle");
    },
  );

  it("comparte un único listener del puente y permite altas y bajas locales", () => {
    let relay: ((event: UpdateEvent) => void) | undefined;
    const onEvent = vi.fn((listener: (event: UpdateEvent) => void) => {
      relay = listener;
    });
    const updater: ShellUpdater = {
      onEvent,
      check: vi.fn(),
      install: vi.fn(),
      setAutomaticChecks: vi.fn(),
      setInstallOnQuit: vi.fn(),
    };
    const first = vi.fn<(event: UpdateEvent) => void>();
    const second = vi.fn<(event: UpdateEvent) => void>();
    const unsubscribeFirst = subscribeToUpdateEvents(updater, first);
    const unsubscribeSecond = subscribeToUpdateEvents(updater, second);

    expect(onEvent).toHaveBeenCalledTimes(1);
    relay?.({ type: "update-not-available" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    relay?.({ type: "error" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();

    const afterRemount = vi.fn<(event: UpdateEvent) => void>();
    const unsubscribeAfterRemount = subscribeToUpdateEvents(updater, afterRemount);
    expect(onEvent).toHaveBeenCalledTimes(1);
    relay?.({ type: "checking" });
    expect(afterRemount).toHaveBeenCalledTimes(1);
    unsubscribeAfterRemount();
  });
});
