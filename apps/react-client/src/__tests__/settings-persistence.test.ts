/**
 * Las dos mitades de ADR-126 §3, que son asimétricas a propósito:
 *
 * - `persist()` **no** escribe `nerEnabled`. Desde ADR-126 la detección de
 *   nombres no es una preferencia y nada en la app la apaga, así que no hay
 *   nada que guardar. Si volviera a escribirse, un `false` que quedara en
 *   `localStorage` dejaría la app sin detección de nombres para siempre y sin
 *   ningún control con el que volver, que es exactamente el modo de falla que
 *   el ADR evita.
 * - `load()` **sí** lo lee si está presente. Es el canal de override por el
 *   que seis specs E2E arrancan sin NER (`tests/e2e/support/settingsOverride.ts`)
 *   en vez de descargar y correr el modelo en cada uno. Si esta mitad se cae,
 *   la suite sigue en verde y se vuelve mucho más lenta, sin que nada avise.
 *
 * `localStorage` se stubea porque los tests de `apps/react-client` corren en
 * Node sin jsdom (mismo criterio que el resto de este directorio).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../store/settings.store.js";

const STORAGE_KEY = "anonly:settings";

function stubLocalStorage(initial?: string): { readonly written: () => string | null } {
  let stored: string | null = initial ?? null;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === STORAGE_KEY ? stored : null),
      setItem: (key: string, value: string) => {
        if (key === STORAGE_KEY) stored = value;
      },
    },
  });
  return { written: () => stored };
}

describe("settings.store persistence", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      language: "es",
      performancePreset: "auto",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not write nerEnabled, so a stale false can never outlive the session", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ nerEnabled: false });

    useSettingsStore.getState().persist();

    const raw = storage.written();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).not.toHaveProperty("nerEnabled");
  });

  it("still writes the settings that are the user's to choose", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ language: "en", performancePreset: "low", ocrLanguages: ["spa"] });

    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).toMatchObject({
      language: "en",
      performancePreset: "low",
      ocrLanguages: ["spa"],
    });
  });

  it("clears a nerEnabled left over by an older version on the first persist", () => {
    const storage = stubLocalStorage(JSON.stringify({ language: "es", nerEnabled: false }));

    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).not.toHaveProperty("nerEnabled");
  });

  it("still honours a persisted nerEnabled on load: it is the E2E override channel", () => {
    stubLocalStorage(JSON.stringify({ nerEnabled: false }));

    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().nerEnabled).toBe(false);
  });

  it("leaves nerEnabled on when nothing overrode it", () => {
    stubLocalStorage(JSON.stringify({ language: "en" }));

    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().nerEnabled).toBe(true);
  });
});
