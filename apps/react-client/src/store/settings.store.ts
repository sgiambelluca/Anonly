/**
 * `settings.store.ts` — settings del usuario, persistidos en `localStorage`
 * (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.6. Defaults:
 * - `language`/`defaultReplacementMode`: docs/roadmap/MVP.md §2.3 (es default)
 *   y docs/ui/UX_Guidelines.md UX-7 ("placeholder por defecto, más informativo").
 * - `performancePreset`: "auto" (docs/ui/React_Client.md §3.7: "auto = defaults
 *   ... derivados de hardwareConcurrency").
 * - `nerEnabled`/`ocrLanguages`: mismos defaults que `EngineConfig` del Core
 *   (`ner.enabled = true`, `ocr.languages = ["spa", "eng"]`), replicados acá
 *   a propósito — el cliente no importa el façade del Core para esto porque
 *   este PR bootea sin Core (no hay `core-adapter` todavía, ver
 *   docs/roadmap/MVP.md, Hito 10, orden de PRs); `ocr.languages` coincide con
 *   docs/roadmap/MVP.md §2.1 ("Tesseract.js con modelo spa+eng").
 *
 * Solo settings van a `localStorage`, nunca documentos
 * (docs/architecture/08_Security_Model.md §10.2).
 *
 * `persist()`/`load()` son los únicos puntos de escritura/lectura de
 * `localStorage` de este store; los campos individuales se mutan con el
 * `setState` que expone el propio hook de Zustand (`useSettingsStore.setState`),
 * ya que el spec (§3.6) no declara setters por campo.
 */

import { ReplacementMode } from "@anonly/anonymization-core";
import { create } from "zustand";

export type Language = "es" | "en";
export type PerformancePreset = "auto" | "low" | "high";

export interface SettingsSlice {
  readonly language: Language;
  readonly performancePreset: PerformancePreset;
  readonly defaultReplacementMode: ReplacementMode;
  readonly nerEnabled: boolean;
  readonly ocrLanguages: ReadonlyArray<string>;
  persist(): void;
  load(): void;
}

const STORAGE_KEY = "anonly:settings";

type SettingsData = Pick<
  SettingsSlice,
  "language" | "performancePreset" | "defaultReplacementMode" | "nerEnabled" | "ocrLanguages"
>;

const DEFAULT_SETTINGS: SettingsData = {
  language: "es",
  performancePreset: "auto",
  defaultReplacementMode: ReplacementMode.Placeholder,
  nerEnabled: true,
  ocrLanguages: ["spa", "eng"],
};

type PersistedSettings = Partial<SettingsData>;

function isPersistedSettings(value: unknown): value is PersistedSettings {
  return typeof value === "object" && value !== null;
}

export const useSettingsStore = create<SettingsSlice>((set, get) => ({
  ...DEFAULT_SETTINGS,
  persist() {
    const state = get();
    const toStore: PersistedSettings = {
      language: state.language,
      performancePreset: state.performancePreset,
      defaultReplacementMode: state.defaultReplacementMode,
      nerEnabled: state.nerEnabled,
      ocrLanguages: state.ocrLanguages,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      // localStorage puede fallar (quota excedida, modo privado). No es
      // fatal: los settings quedan en memoria para la sesión actual.
      console.warn("No se pudieron persistir los settings.", error);
    }
  },
  load() {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("No se pudieron leer los settings persistidos.", error);
      return;
    }
    if (raw === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("Settings persistidos corruptos, se ignoran.", error);
      return;
    }
    if (!isPersistedSettings(parsed)) return;

    set({
      ...(parsed.language !== undefined ? { language: parsed.language } : {}),
      ...(parsed.performancePreset !== undefined
        ? { performancePreset: parsed.performancePreset }
        : {}),
      ...(parsed.defaultReplacementMode !== undefined
        ? { defaultReplacementMode: parsed.defaultReplacementMode }
        : {}),
      ...(parsed.nerEnabled !== undefined ? { nerEnabled: parsed.nerEnabled } : {}),
      ...(parsed.ocrLanguages !== undefined ? { ocrLanguages: parsed.ocrLanguages } : {}),
    });
  },
}));
