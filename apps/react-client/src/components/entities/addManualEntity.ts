/**
 * `addManualEntity.ts` — el camino común de las tres vías de agregado
 * (ADR-061 §3, ADR-169 §7): el diálogo "Agregar entidad", la selección sobre
 * el original y la lupa.
 *
 * Espera el resultado (ADR-114 §2: con la promesa suelta, "no se encontró" y
 * "se agregaron 18" se veían igual) y, si se agregó, muestra el toast de
 * confirmación con "Ver en la lista", que lleva la fila a la vista y la
 * resalta (`entities.store.flashGroupId`). Hasta ADR-169 ninguna de las tres
 * vías confirmaba nada: el usuario no sabía si se había agregado.
 *
 * La decisión y el texto son puros (`manualEntityFeedback.ts`); acá solo se
 * emite y se muestra.
 */

import type { ManualEntityRequest } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { showToast } from "../common/toast.js";

import {
  describeManualAdd,
  findAddedGroup,
  manualEntityFeedback,
  type ManualEntityFeedback,
} from "./manualEntityFeedback.js";

export async function addManualEntityWithFeedback(
  request: ManualEntityRequest,
): Promise<ManualEntityFeedback> {
  const result = await actions.addManualEntity(request);
  const feedback = manualEntityFeedback(result);
  if (feedback !== "added" || result === null) return feedback;

  const group = findAddedGroup(
    useEntitiesStore.getState().groupsByType,
    request.value,
    request.entityType,
  );
  const text = describeManualAdd({
    value: request.value,
    entityType: request.entityType,
    occurrenceCount: result.occurrenceCount,
    group,
  });
  showToast({
    ...text,
    tone: "success",
    ...(group !== undefined
      ? {
          actions: [
            {
              label: "Ver en la lista",
              run: () => useEntitiesStore.getState().setFlashGroupId(group.id),
            },
          ],
        }
      : {}),
  });
  return feedback;
}
