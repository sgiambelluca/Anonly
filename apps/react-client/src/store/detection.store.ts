/**
 * `detection.store.ts` — la configuración de detección del usuario
 * (`React_Client.md` §3.8, ADR-223 §3, ADR-227 §3).
 *
 * Es **configuración**, como `settings.store`, pero con clave propia
 * (`anonly:detection`) y un ciclo distinto: se edita sobre un **borrador** y
 * se guarda a pedido. Nada del borrador llega a `saved` ni a `localStorage`
 * antes de `commit()`.
 *
 * - `saved` es lo último guardado y lo que alimenta al Core.
 * - `draft` es la copia de trabajo de `DetectionFormatsDialog`; `null` = cerrado.
 * - `draftHistory` guarda los borradores anteriores, uno por cambio: es lo que
 *   hace posible `undoLastDraftChange()` (el «Deshacer» de los avisos del
 *   diálogo) y de donde sale `pendingChanges`.
 * - `commit()` persiste, deriva el override y, **solo si cambió**, recrea el
 *   Core por el camino de ADR-125 §2 y §3, con el diálogo todavía abierto.
 *
 * **Qué nunca entra a este store** (`08_Security_Model.md` §10.2): valores
 * detectados, apariciones, texto del documento, el texto de prueba del
 * generador ni un tipo del documento que el usuario no guardó.
 *
 * «Borrar datos locales» no lo toca (ADR-223 §3).
 */

import type { UserEntityTypeDefinition, UserEntityTypeId } from "@anonly/anonymization-core";
import { create } from "zustand";

import { recreateCore } from "../core-adapter/index.js";
import {
  deriveCoreOverrides,
  sameEngineConfigOverrides,
} from "../core-adapter/settingsToEngineConfig.js";

import {
  applyDetectionChange,
  DEFAULT_DETECTION_STATE,
  DETECTION_STORAGE_KEY,
  parseDetectionState,
  type DetectionChange,
  type DetectionState,
} from "./detectionState.js";
import { useSettingsStore } from "./settings.store.js";

export interface DetectionSlice {
  /** Lo último guardado: es lo que alimenta al Core. */
  readonly saved: DetectionState;
  /** Copia de trabajo de `DetectionFormatsDialog`; `null` = cerrado. */
  readonly draft: DetectionState | null;
  /** Los borradores anteriores, del más viejo al más nuevo: uno por cambio aplicado y no deshecho. */
  readonly draftHistory: ReadonlyArray<DetectionState>;
  /** Cambios aplicados al borrador y no deshechos. */
  readonly pendingChanges: number;
  /** `draft = saved`. */
  openDraft(): void;
  applyToDraft(change: DetectionChange): void;
  /** El «Deshacer» de los avisos del diálogo. */
  undoLastDraftChange(): void;
  /** `saved = draft`, `persist()`, y recrea el Core si hace falta. Rechaza si recrear falla y deja el borrador. */
  commit(): Promise<void>;
  discardDraft(): void;
  /** ADR-225 §5: guarda para los próximos documentos un tipo creado con el documento abierto. */
  saveDocumentType(definition: UserEntityTypeDefinition): void;
  /** El «Deshacer» de ese aviso. */
  unsaveDocumentType(id: UserEntityTypeId): void;
  persist(): void;
  load(): void;
}

export const useDetectionStore = create<DetectionSlice>((set, get) => ({
  saved: DEFAULT_DETECTION_STATE,
  draft: null,
  draftHistory: [],
  pendingChanges: 0,

  openDraft() {
    set({ draft: get().saved, draftHistory: [], pendingChanges: 0 });
  },

  applyToDraft(change) {
    const { draft, draftHistory } = get();
    if (draft === null) return;
    const result = applyDetectionChange(draft, change);
    if (!result.ok) {
      // La interfaz valida antes de armar el cambio: llegar acá es un defecto,
      // no un caso de uso. Sin contenido del cambio en el log.
      console.warn(`Cambio de detección rechazado (${result.reason}).`);
      return;
    }
    const history = [...draftHistory, draft];
    set({ draft: result.state, draftHistory: history, pendingChanges: history.length });
  },

  undoLastDraftChange() {
    const { draftHistory } = get();
    const previous = draftHistory[draftHistory.length - 1];
    if (previous === undefined) return;
    const history = draftHistory.slice(0, -1);
    set({ draft: previous, draftHistory: history, pendingChanges: history.length });
  },

  async commit() {
    const { draft, saved } = get();
    if (draft === null) return;
    const settings = useSettingsStore.getState();
    const next = deriveCoreOverrides(settings, draft);
    // Se compara el override DERIVADO (ADR-125 §2): un cambio que el Core no
    // lee —por ejemplo, un formato apagado y vuelto a prender— no cuesta
    // recrear los workers.
    if (!sameEngineConfigOverrides(deriveCoreOverrides(settings, saved), next)) {
      // Con el diálogo todavía abierto (ADR-125 §3): si falla, el borrador queda.
      await recreateCore(next);
    }
    set({ saved: draft, draft: null, draftHistory: [], pendingChanges: 0 });
    get().persist();
  },

  discardDraft() {
    set({ draft: null, draftHistory: [], pendingChanges: 0 });
  },

  saveDocumentType(definition) {
    const { saved } = get();
    if (saved.userTypes.some((type) => type.id === definition.id)) return;
    const result = applyDetectionChange(saved, { kind: "createType", definition });
    if (!result.ok) {
      console.warn(`El tipo del documento no se pudo guardar (${result.reason}).`);
      return;
    }
    set({ saved: result.state });
    get().persist();
  },

  unsaveDocumentType(id) {
    const { saved } = get();
    if (!saved.userTypes.some((type) => type.id === id)) return;
    const result = applyDetectionChange(saved, { kind: "deleteType", typeId: id });
    if (!result.ok) return;
    set({ saved: result.state });
    get().persist();
  },

  persist() {
    try {
      window.localStorage.setItem(DETECTION_STORAGE_KEY, JSON.stringify(get().saved));
    } catch (error) {
      // localStorage puede fallar (quota excedida, modo privado). No es fatal:
      // lo guardado queda en memoria para la sesión actual.
      console.warn("No se pudo persistir la configuración de detección.", error);
    }
  },

  load() {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(DETECTION_STORAGE_KEY);
    } catch (error) {
      console.warn("No se pudo leer la configuración de detección persistida.", error);
      return;
    }
    if (raw === null) return;
    const parsed = parseDetectionState(raw);
    if (parsed === null) {
      console.warn("Configuración de detección persistida ilegible, se ignora.");
      return;
    }
    if (parsed.discarded > 0) {
      // Solo el número: nunca el contenido de lo descartado.
      console.warn(`Se descartaron ${parsed.discarded} elementos de detección que ya no validan.`);
    }
    set({ saved: parsed.state });
  },
}));
