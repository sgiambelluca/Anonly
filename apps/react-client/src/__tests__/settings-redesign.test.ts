import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeTheme,
  OCR_LANGUAGES_SLOT_TEXT,
  PERFORMANCE_PRESET_DESCRIPTION,
  resolveOcrLanguagesSlot,
  THEME_LABEL,
  THEME_ORDER,
  UPDATE_NETWORK_NOTICE,
} from "../components/toolbar/settingsCopy.js";
import { dismissHint, useSettingsStore, withDismissedHint } from "../store/settings.store.js";

// ADR-169 §7/§8: Configuración rediseñada y avisos de descubrimiento.

describe("Configuración (ADR-169 §8)", () => {
  it("tres temas, en este orden", () => {
    expect(THEME_ORDER).toEqual(["system", "light", "dark"]);
    expect(THEME_ORDER.map((theme) => THEME_LABEL[theme])).toEqual([
      "Como el sistema",
      "Claro",
      "Oscuro",
    ]);
    expect(describeTheme("system")).toContain("sistema");
    expect(describeTheme("dark")).toBe("Se aplica al guardar.");
  });

  it("los tres perfiles tienen descripción (un renglón fijo)", () => {
    for (const preset of ["auto", "low", "high"] as const) {
      expect(PERFORMANCE_PRESET_DESCRIPTION[preset].length).toBeGreaterThan(0);
    }
  });

  it("el aviso de red sigue diciendo que GitHub ve la IP y la versión (ADR-131 §5)", () => {
    expect(UPDATE_NETWORK_NOTICE).toContain("GitHub");
    expect(UPDATE_NETWORK_NOTICE).toContain("IP");
    expect(UPDATE_NETWORK_NOTICE).toContain("versión");
  });

  describe("ranura de idiomas (alto fijo, UX-10)", () => {
    it("sin idiomas: error", () => {
      expect(resolveOcrLanguagesSlot({ selected: [], saved: ["spa"], documentOpen: true })).toBe(
        "empty",
      );
    });

    it("cambiados con documento abierto: aviso de re-análisis", () => {
      expect(
        resolveOcrLanguagesSlot({ selected: ["spa", "eng"], saved: ["spa"], documentOpen: true }),
      ).toBe("reanalyze");
    });

    it("sin cambios o sin documento: texto neutro", () => {
      expect(
        resolveOcrLanguagesSlot({ selected: ["spa"], saved: ["spa"], documentOpen: true }),
      ).toBe("idle");
      expect(
        resolveOcrLanguagesSlot({ selected: ["eng"], saved: ["spa"], documentOpen: false }),
      ).toBe("idle");
    });

    it("los tres estados tienen texto", () => {
      expect(Object.values(OCR_LANGUAGES_SLOT_TEXT).every((text) => text.length > 0)).toBe(true);
    });
  });
});

describe("avisos de descubrimiento (settings.store.dismissedHints, ADR-169 §7)", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    useSettingsStore.setState({ dismissedHints: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("withDismissedHint agrega sin repetir", () => {
    expect(withDismissedHint([], "selection-hint")).toEqual(["selection-hint"]);
    expect(withDismissedHint(["selection-hint"], "selection-hint")).toEqual(["selection-hint"]);
  });

  it("cerrar un aviso lo persiste: cerrado una vez, no vuelve", () => {
    dismissHint("panel-footer-hint");
    expect(useSettingsStore.getState().dismissedHints).toEqual(["panel-footer-hint"]);

    useSettingsStore.setState({ dismissedHints: [] });
    useSettingsStore.getState().load();
    expect(useSettingsStore.getState().dismissedHints).toEqual(["panel-footer-hint"]);
  });

  it("al leer descarta claves desconocidas", () => {
    storage.set(
      "anonly:settings",
      JSON.stringify({ dismissedHints: ["selection-hint", "otra-cosa", 42] }),
    );
    useSettingsStore.getState().load();
    expect(useSettingsStore.getState().dismissedHints).toEqual(["selection-hint"]);
  });
});
