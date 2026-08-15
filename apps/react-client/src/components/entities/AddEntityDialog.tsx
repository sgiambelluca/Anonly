/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §3 ruta A).
 *
 * Selector de `EntityType` + valor + confirmar → `actions.addManualEntity`.
 * Mismo patrón que `RuleCreatorDialog`/`SettingsDialog`: `open`/`onClose`
 * levantado al llamador (acá `EntitiesPanel`), formulario re-sincronizado al
 * abrir, confirmar es `async` y cierra recién cuando la acción resuelve.
 *
 * **Sin feedback de "no se encontró"** (Components.md §3.4c lo pide): el
 * diálogo cierra siempre al confirmar. `addManualEntity` devuelve
 * `Promise<void>` — no hay forma de que el llamador sepa si `findLiteral`
 * encontró 0 ocurrencias o creó/fusionó un grupo. Es una ambigüedad de
 * contrato reportada (requiere que `IPipelineOrchestrator.addManualEntity`
 * devuelva `occurrenceCount`, cambio de `Contracts.md` fuera de alcance de
 * este PR), no una omisión.
 */

import { EntityType, type ManualEntityRequest } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select, type SelectOption } from "../common/Select.js";

import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";

// Orden fijo de ui/Components.md §3.1 (mismo criterio que entities.store.ts
// y RuleFormFields.tsx).
const ENTITY_TYPE_OPTIONS: ReadonlyArray<SelectOption<EntityType>> = [
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
  EntityType.DNI,
  EntityType.CUIT,
  EntityType.Phone,
  EntityType.Email,
  EntityType.IBAN,
  EntityType.CreditCard,
  EntityType.Date,
  EntityType.License,
  EntityType.Plate,
  EntityType.Custom,
].map((type) => ({ value: type, label: ENTITY_TYPE_LABEL[type] }));

export interface AddEntityDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AddEntityDialog({ open, onClose }: AddEntityDialogProps) {
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Re-sincroniza el formulario cada vez que se abre (mismo criterio que
  // MergeDialog/RuleCreatorDialog/SettingsDialog).
  useEffect(() => {
    if (!open) return;
    setEntityType(EntityType.Person);
    setValue("");
    setSubmitting(false);
  }, [open]);

  const trimmedValue = value.trim();

  async function handleConfirm(): Promise<void> {
    if (trimmedValue.length === 0) return;
    setSubmitting(true);
    const request: ManualEntityRequest = { value: trimmedValue, entityType };
    await actions.addManualEntity(request);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Agregar entidad">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-text-secondary">
          Buscá un valor exacto en el documento para marcarlo como entidad. La búsqueda no distingue
          mayúsculas ni acentos, pero no encuentra variantes: si el documento nombra lo mismo de dos
          formas (&quot;José Pérez&quot; y &quot;J. Pérez&quot;), agregá las dos por separado.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Tipo</span>
          <Select
            value={entityType}
            onChange={setEntityType}
            options={ENTITY_TYPE_OPTIONS}
            aria-label="Tipo de entidad"
            disabled={submitting}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Valor</span>
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={submitting}
            placeholder="Ej: José Pérez"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          disabled={trimmedValue.length === 0 || submitting}
          loading={submitting}
          onClick={() => void handleConfirm()}
        >
          Agregar
        </Button>
      </div>
    </Dialog>
  );
}
