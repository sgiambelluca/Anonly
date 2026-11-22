/**
 * `useUserTypes.ts` — los tipos propios que la interfaz conoce (`userTypes.ts`),
 * leídos de los dos stores que los guardan. El hook es para componentes; la
 * función `currentUserTypes` es para las acciones que no renderizan
 * (`applyEdits`, `addManualEntity`).
 */

import type { UserEntityTypeDefinition } from "@anonly/anonymization-core";
import { useMemo } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";

import { mergeUserTypes, userTypeDefinitions, type KnownUserType } from "./userTypes.js";

/** Todos los tipos propios con la marca de «solo de este documento». */
export function useKnownUserTypes(): ReadonlyArray<KnownUserType> {
  const saved = useDetectionStore((state) => state.saved.userTypes);
  const documentTypes = useEntitiesStore((state) => state.documentTypes);
  const savedDuringDocument = useEntitiesStore((state) => state.savedDuringDocument);
  return useMemo(
    () => mergeUserTypes(saved, documentTypes, savedDuringDocument),
    [saved, documentTypes, savedDuringDocument],
  );
}

/** Solo las definiciones, para nombrar y colorear tipos. */
export function useUserTypes(): ReadonlyArray<UserEntityTypeDefinition> {
  const known = useKnownUserTypes();
  return useMemo(() => userTypeDefinitions(known), [known]);
}

/** Lo mismo, leído en el momento y sin suscribirse. */
export function currentUserTypes(): ReadonlyArray<UserEntityTypeDefinition> {
  return userTypeDefinitions(
    mergeUserTypes(
      useDetectionStore.getState().saved.userTypes,
      useEntitiesStore.getState().documentTypes,
      useEntitiesStore.getState().savedDuringDocument,
    ),
  );
}
