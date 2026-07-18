/**
 * `core-adapter/index.ts` — inicializa el Core y arranca el bus-bridge.
 *
 * Fuente de verdad: docs/ui/React_Client.md §2.1.
 *
 * Este PR (Hito 10, PR5) conecta el Core **in-process**, sin `CoreRuntimeOptions`
 * todavía: el wiring de Web Workers reales es el PR 11+ del hito
 * (ADR-036 §2, `React_Client.md` §2.4 — no aplica acá).
 */

import {
  createCore,
  type EngineConfig,
  type IAnonymizationCore,
  type Unsubscribe,
} from "@anonly/anonymization-core";

import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useViewerStore } from "../store/viewer.store.js";

import { subscribe, type Stores } from "./bus-bridge.js";

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
};

let core: IAnonymizationCore | undefined;
let unsubscribeBridge: Unsubscribe | undefined;

/**
 * Inicializa el Core (idempotente: una llamada repetida devuelve la misma
 * instancia) y suscribe el bus-bridge a los 6 stores. `config` es un override
 * parcial opcional de `EngineConfig`, pasado tal cual a `createCore` — este
 * PR no deriva un `EngineConfig` desde `settings.store` (ver nota de
 * ambigüedad en el reporte del PR: `Partial<EngineConfig>` exige sub-objetos
 * completos por campo, y el cliente no tiene visibilidad de varios defaults
 * internos del Core que no están en `core/Contracts.md` §6).
 */
export async function initCore(config?: Partial<EngineConfig>): Promise<IAnonymizationCore> {
  if (core) return core;
  const instance = await createCore(config);
  unsubscribeBridge = subscribe(instance.bus, stores);
  core = instance;
  return core;
}

export function getCore(): IAnonymizationCore {
  if (!core) throw new Error("Core not initialized");
  return core;
}

/**
 * Libera la instancia actual del Core y desuscribe el bus-bridge. No forma
 * parte del contrato de UI (`React_Client.md` §2.1 no lo declara): existe
 * para poder testear `initCore`/`getCore` de forma aislada entre casos y,
 * eventualmente, para un flujo futuro de recreación del core (ADR-038 §7,
 * `performancePreset` sin documento abierto).
 */
export async function disposeCore(): Promise<void> {
  if (unsubscribeBridge) {
    unsubscribeBridge();
    unsubscribeBridge = undefined;
  }
  if (core) {
    await core.dispose();
    core = undefined;
  }
}
