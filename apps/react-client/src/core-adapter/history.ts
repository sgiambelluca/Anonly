/**
 * `core-adapter/history.ts` — la pila de deshacer conectada al Core
 * (`ui/React_Client.md` §3.6c, ADR-172).
 *
 * `store/history.store.ts` tiene la lógica y no conoce al Core; acá se le da
 * el puerto real: los tres métodos de puntos de restauración del
 * `orchestrator`, sobre el documento activo.
 *
 * **Después de restaurar se rehidrata `rules.store`** desde el snapshot de
 * Grouping (U-6): las reglas son el único estado que la UI origina y que los
 * eventos de Grouping no le devuelven. Grupos y conflictos llegan solos, por
 * los `ENTITY_GROUP_*`/`CONFLICT_*` que emite la restauración (`bus-bridge`).
 */

import { useDocumentStore } from "../store/document.store.js";
import { createHistoryStore, type EditCheckpointPort } from "../store/history.store.js";
import { useRulesStore } from "../store/rules.store.js";

import { getGroupingSnapshot } from "./snapshots.js";

import { getCore } from "./index.js";

const coreCheckpoints: EditCheckpointPort = {
  create() {
    const documentId = useDocumentStore.getState().id;
    if (documentId === null) return null;
    return getCore().orchestrator.createEditCheckpoint(documentId);
  },
  async restore(checkpointId) {
    const documentId = useDocumentStore.getState().id;
    if (documentId === null) throw new Error("Sin documento activo.");
    await getCore().orchestrator.restoreEditCheckpoint(documentId, checkpointId);
    useRulesStore.getState().replaceRules(getGroupingSnapshot(documentId).rules);
  },
  discard() {
    const documentId = useDocumentStore.getState().id;
    if (documentId === null) return;
    getCore().orchestrator.discardEditCheckpoints(documentId);
  },
};

export const useHistoryStore = createHistoryStore(coreCheckpoints);
