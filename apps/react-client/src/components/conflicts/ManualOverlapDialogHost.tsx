/**
 * `ManualOverlapDialogHost` — el único consumidor de
 * `manualOverlapController.ts` (ADR-174 §4, ADR-175 §4/§5,
 * `ui/Components.md` §6.3). Se monta una vez, junto a `ToastHost` (`App.tsx`),
 * para que el diálogo se pueda abrir desde cualquiera de las tres vías de
 * agregado manual, desde el ⚠ de una fila y desde el "Resolver" del aviso
 * persistente, sin que ninguna de ellas sea la dueña del `Dialog` — así
 * "está abierto" tiene una sola fuente de verdad.
 *
 * **El aviso persistente es un estado, no un toast de una vez** (ADR-175
 * §5): mientras el diálogo esté cerrado y quede un conflicto `heldManual`
 * sin resolver en cualquier parte del documento, ocupa la única ranura de
 * toast — sin pisar uno que ya esté ahí, y volviendo cuando ese se va. La
 * *regla* de cuándo corresponde es pura y vive en `manualOverlapWarning.ts`
 * (ADR-056); acá solo se conecta con `entities.store` y `toast.ts`.
 */

import { useEffect, useRef, useState } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { dismissToast, showToast, subscribeToToasts, type ToastMessage } from "../common/toast.js";

import {
  openManualOverlapDialog,
  subscribeToManualOverlapDialog,
} from "./manualOverlapController.js";
import { ManualOverlapDialog } from "./ManualOverlapDialog.js";
import { resolveManualOverlapWarning } from "./manualOverlapWarning.js";

export function ManualOverlapDialogHost() {
  const [conflictIds, setConflictIds] = useState<ReadonlyArray<string> | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  /** El `id` del último aviso que ESTE host mostró, mientras siga vigente. */
  const avisoIdRef = useRef<number | null>(null);

  const conflicts = useEntitiesStore((state) => state.conflicts);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const sortOrder = useEntitiesStore((state) => state.sortOrder);

  useEffect(() => subscribeToManualOverlapDialog(setConflictIds), []);
  useEffect(() => subscribeToToasts(setToast), []);

  useEffect(() => {
    const warning = resolveManualOverlapWarning({
      conflicts,
      groupsByType,
      sortOrder,
      dialogOpen: conflictIds !== null,
    });

    if (warning === null) {
      // Ya no corresponde: si el toast en pantalla es el nuestro, se retira
      // (p. ej. el conflicto se resolvió solo al eliminar la detección,
      // ADR-175 §1, mientras el aviso seguía mostrado).
      if (toast !== null && toast.id === avisoIdRef.current) {
        dismissToast();
        avisoIdRef.current = null;
      }
      return;
    }

    // Corresponde, pero la ranura la ocupa otra cosa (o ya la ocupa el
    // aviso vigente): espera — este efecto se vuelve a correr cuando
    // `toast` cambie, incluido cuando se libere.
    if (toast !== null) return;

    const shown = showToast({
      title: `Quedó un choque sin resolver en «${warning.value}».`,
      description: "El export está bloqueado hasta que elijas.",
      tone: "warning",
      persistent: true,
      actions: [{ label: "Resolver", run: () => openManualOverlapDialog(warning.conflictIds) }],
    });
    avisoIdRef.current = shown.id;
  }, [conflicts, groupsByType, sortOrder, conflictIds, toast]);

  if (conflictIds === null) return null;
  return (
    <ManualOverlapDialog conflictIds={conflictIds} open onClose={() => setConflictIds(null)} />
  );
}
