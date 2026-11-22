/**
 * `core-adapter/documentTypesPort.ts` — el acceso real al Core para los tipos del
 * documento (`React_Client.md` §3.9). `entities.store` no importa el adaptador
 * (los workers de `?worker` no cargan en Node); este módulo le da el puerto.
 */

import { useDetectionStore } from "../store/detection.store.js";
import { useDocumentStore } from "../store/document.store.js";
import type { DocumentTypesPort } from "../store/documentTypes.js";
import { setDocumentTypesPort } from "../store/entities.store.js";

import { getCore } from "./index.js";

const corePort: DocumentTypesPort = {
  read() {
    const documentId = useDocumentStore.getState().id;
    if (documentId === null) return [];
    return getCore().orchestrator.getDocumentEntityTypes(documentId);
  },
  define(definition) {
    const documentId = useDocumentStore.getState().id;
    if (documentId === null) throw new Error("Sin documento activo.");
    getCore().orchestrator.defineDocumentEntityType(documentId, definition);
  },
  savedDefinition(id) {
    return useDetectionStore.getState().saved.userTypes.find((type) => type.id === id);
  },
};

export function registerDocumentTypesPort(): void {
  setDocumentTypesPort(corePort);
}
