/**
 * `ChangeTypeDialog` (`ui/Components.md` §3.5, ADR-082 §6).
 *
 * Corrige la clasificación de un grupo que el detector erró: NER etiquetando
 * una organización como dirección, o un patrón numérico matcheando un tramo
 * de número de expediente como teléfono (`Post_Hito10.8_Pendientes.md` §4bis).
 *
 * No es cosmético: el tipo gobierna el token del documento anonimizado
 * (`[ORGANIZACION 01]` vs. `[DIRECCION 01]`), su numeración por tipo, qué
 * regla de scope `type` aplica y de qué pool sortea el sintetizador. Un tipo
 * equivocado produce un documento que **afirma algo falso** sobre el dato que
 * ocultó.
 *
 * Sin `ConfirmDialog`, a diferencia de "Eliminar grupo" o "Cerrar documento":
 * la operación es reversible volviendo a elegir el tipo anterior.
 */

import type { EntityType } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select } from "../common/Select.js";

import { ENTITY_TYPE_OPTIONS } from "./entityTypeLabels.js";

export interface ChangeTypeDialogProps {
  readonly groupId: string;
  readonly currentType: EntityType;
  readonly canonicalValue: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ChangeTypeDialog({
  groupId,
  currentType,
  canonicalValue,
  open,
  onClose,
}: ChangeTypeDialogProps) {
  const [nextType, setNextType] = useState<EntityType>(currentType);

  useEffect(() => {
    if (open) setNextType(currentType);
  }, [open, currentType]);

  function handleApply(): void {
    // Un `type` igual al vigente es no-op en el motor (ADR-082 §1), así que
    // no hace falta guardarlo acá — pero se evita el viaje igual.
    if (nextType !== currentType) {
      // **Sin "Deshacer", a propósito.** Reclasificar no es reversible desde
      // la UI: `changeGroupType` (`grouping-engine`) renumera con
      // `nextIndex`, que es monótono, así que volver al tipo anterior devuelve
      // el grupo con OTRO número de token —`[PERSONA 03]` vuelve como
      // `[PERSONA 09]`— y con él cambia el `replacementValue` de
      // `placeholder`/`synthetic`. Además re-escribe `typeCorrections`
      // (ADR-085 §1b), deja `absorbedTypes` con los dos tipos para siempre, y
      // si el grupo era Persona destruye una elección explícita de género y la
      // reemplaza en silencio por una inferida (ADR-082 §2 paso 4).
      //
      // Es exactamente el criterio con el que `undoableEdits.ts` descarta el
      // undo de fusionar y dividir: un "Deshacer" que devuelve algo parecido y
      // no lo mismo miente, y eso es peor que no ofrecerlo. El diálogo ya es
      // la fricción de esta acción.
      actions.updateGroup(groupId, { type: nextType });
    }
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Cambiar categoría">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">
          <span className="font-medium text-text-primary">&quot;{canonicalValue}&quot;</span> se va
          a reemplazar con el formato de la categoría que elijas.
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">Categoría</span>
          <Select
            value={nextType}
            onChange={setNextType}
            options={ENTITY_TYPE_OPTIONS}
            aria-label="Categoría de la entidad"
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Cambiar
        </Button>
      </div>
    </Dialog>
  );
}
