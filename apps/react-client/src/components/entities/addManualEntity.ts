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
 * **ADR-174 §4**: si el resultado trae `heldConflictIds`, no hay toast — se
 * abre `ManualOverlapDialog` (vía `manualOverlapController.ts`, porque este
 * módulo no renderiza nada) para el primer conflicto retenido. Si el agregado
 * quedó en más de un conflicto a la vez (varias apariciones del mismo valor
 * chocando con detecciones distintas), los demás siguen visibles como el
 * aviso ⚠ de sus propias filas (`ConflictBadge`) y se resuelven desde ahí —
 * no está en el spec abrir varios diálogos en cadena.
 *
 * **N-3**: si no encontró nada o no cambió nada (`not-found`/`no-op`), la
 * entrada de deshacer que se registró antes de agregar se retira
 * (`discardLastEdit`): no hay nada que deshacer.
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
  findAddedGroup,
  manualEntityFeedback,
  type ManualEntityFeedback,
} from "./manualEntityFeedback.js";

export async function addManualEntityWithFeedback(
  request: ManualEntityRequest,
): Promise<ManualEntityFeedback> {
  const recorded = recordEdit(`Agregaste «${request.value}»`);
  const result = await actions.addManualEntity(request);

  const group =
    result === null
      ? undefined
      : findAddedGroup(useEntitiesStore.getState().groupsByType, request.value, request.entityType);

  const feedback = manualEntityFeedback(result, group !== undefined);

  // `result !== null` acá siempre es cierto cuando `feedback === "held"`
  // (`manualEntityFeedback` solo lo devuelve tras leer
  // `result.heldConflictIds`), pero el narrowing es del `if`, no de la
  // llamada — se repite la guarda para no necesitar una aserción no-nula.
  if (feedback === "held" && result !== null) {
    const [firstHeldConflictId] = result.heldConflictIds;
    if (firstHeldConflictId !== undefined) openManualOverlapDialog(firstHeldConflictId);
    return feedback;
  }

  if (feedback !== "added" || result === null) {
    // "not-found" / "no-op" (o, defensivamente, "held" sin resultado): nada
    // cambió, la entrada que se registró arriba no tiene qué deshacer (N-3).
    if (recorded) discardLastEdit();
    return feedback;
  }

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
