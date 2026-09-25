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
 * Toma el punto de deshacer **antes** de agregar (ADR-172 §2): un agregado,
 * por cualquiera de las tres vías, es una entrada de la pila, y su toast
 * lleva "Deshacer" junto a "Ver en la lista".
 *
 * **ADR-174 §4 / ADR-175 §3-§4**: si el resultado trae `heldConflictIds`, no
 * hay toast — se abre `ManualOverlapDialog` (vía `manualOverlapController.ts`,
 * porque este módulo no renderiza nada) con **todos** esos ids: una sola
 * decisión para todo el agregado.
 *
 * **N-3 (ronda 1) / ADR-175 §3**: si no encontró nada, no cambió nada
 * (`not-found`/`no-op`), o el resultado rompió el invariante del Core
 * (`"error"`), la entrada de deshacer que se registró antes de agregar se
 * retira (`discardLastEdit`): no hay nada que deshacer.
 *
 * La decisión y el texto son puros (`manualEntityFeedback.ts`); acá solo se
 * emite y se muestra.
 */

import type { ManualEntityRequest } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { showToast } from "../common/toast.js";
import { openManualOverlapDialog } from "../conflicts/manualOverlapController.js";

import { discardLastEdit, editToast, recordEdit } from "./editHistory.js";
import {
  describeManualAdd,
  manualEntityFeedback,
  resolveAddedGroup,
  type ManualEntityFeedback,
} from "./manualEntityFeedback.js";

export async function addManualEntityWithFeedback(
  request: ManualEntityRequest,
): Promise<ManualEntityFeedback> {
  const recorded = recordEdit(`Agregaste «${request.value}»`);
  const result = await actions.addManualEntity(request);
  const feedback = manualEntityFeedback(result);

  // `result !== null` en cada rama es siempre cierto para el feedback que la
  // guarda espera (`manualEntityFeedback` lee esos campos DE `result` para
  // devolverlo), pero el narrowing es del `if`, no de la llamada — se repite
  // la guarda para no necesitar una aserción no-nula.

  if (feedback === "held" && result !== null) {
    openManualOverlapDialog(result.heldConflictIds);
    return feedback;
  }

  if (feedback === "added" && result !== null) {
    const group = resolveAddedGroup(
      useEntitiesStore.getState().groupsByType,
      result.groupIds,
      request.entityType,
    );
    const text = describeManualAdd({
      value: request.value,
      entityType: request.entityType,
      occurrenceCount: result.occurrenceCount,
      group,
    });
    showToast(
      editToast(
        {
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
        },
        recorded,
      ),
    );
    return feedback;
  }

  if (feedback === "error") {
    // ADR-175 §3: `occurrenceCount > 0` sin `heldConflictIds` ni `groupIds`
    // rompe el invariante del Core — nunca se dice "no se encontró" sobre
    // algo que el Core sí encontró. Se retira la entrada fantasma, se avisa
    // con un toast de error y se loguea para poder investigarlo.
    if (recorded) discardLastEdit();
    console.error(
      `No se pudo agregar «${request.value}»: ManualEntityResult rompió su invariante ` +
        "(occurrenceCount > 0 sin heldConflictIds ni groupIds, ADR-175 §3).",
      result,
    );
    showToast({ title: `No se pudo agregar «${request.value}».`, tone: "error" });
    return feedback;
  }

  // "not-found" / "no-op" (o, defensivamente, "held"/"added" sin resultado):
  // nada cambió, la entrada que se registró arriba no tiene qué deshacer
  // (N-3, ronda 1).
  if (recorded) discardLastEdit();
  return feedback;
}
