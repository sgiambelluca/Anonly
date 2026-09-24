/**
 * `ManualOverlapDialogHost` — el único consumidor de
 * `manualOverlapController.ts` (ADR-174 §4, `ui/Components.md` §6.3). Se
 * monta una vez, junto a `ToastHost` (`App.tsx`), para que el diálogo se
 * pueda abrir desde cualquiera de las tres vías de agregado manual y desde
 * el "Resolver" del toast de advertencia persistente, sin que ninguna de
 * ellas sea la dueña del `Dialog`.
 *
 * Mismo patrón que `ToastHost`: un `useState` local que se suscribe al
 * módulo imperativo y desmonta el diálogo (en vez de solo cerrarlo) cuando no
 * hay nada que mostrar.
 */

import { useEffect, useState } from "react";

import { subscribeToManualOverlapDialog } from "./manualOverlapController.js";
import { ManualOverlapDialog } from "./ManualOverlapDialog.js";

export function ManualOverlapDialogHost() {
  const [conflictId, setConflictId] = useState<string | null>(null);

  useEffect(() => subscribeToManualOverlapDialog(setConflictId), []);

  if (conflictId === null) return null;
  return <ManualOverlapDialog conflictId={conflictId} open onClose={() => setConflictId(null)} />;
}
