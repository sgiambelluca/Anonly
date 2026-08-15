/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §3 ruta A, §6 errata).
 *
 * Selector de `EntityType` + valor + confirmar → `actions.addManualEntity`.
 * Mismo patrón que `RuleCreatorDialog`/`SettingsDialog`: `open`/`onClose`
 * levantado al llamador (acá `EntitiesPanel`), formulario re-sincronizado al
 * abrir, confirmar es `async`.
 *
 * Lee `occurrenceCount` del resultado: `0` no cierra el diálogo y muestra
 * "no se encontró" para que el usuario corrija el typo; `> 0` cierra. `null`
 * (sin documento activo, `actions.ts`) no puede pasar con el diálogo abierto
 * y se trata como no-op, nunca como "no se encontró".
 */

import { EntityType, type ManualEntityRequest } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select } from "../common/Select.js";

import { ENTITY_TYPE_OPTIONS } from "./entityTypeLabels.js";
import { manualEntityFeedback } from "./manualEntityFeedback.js";

export interface AddEntityDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AddEntityDialog({ open, onClose }: AddEntityDialogProps) {
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Re-sincroniza el formulario cada vez que se abre (mismo criterio que
  // MergeDialog/RuleCreatorDialog/SettingsDialog).
  useEffect(() => {
    if (!open) return;
    setEntityType(EntityType.Person);
    setValue("");
    setSubmitting(false);
    setNotFound(false);
  }, [open]);

  const trimmedValue = value.trim();

  async function handleConfirm(): Promise<void> {
    if (trimmedValue.length === 0) return;
    setSubmitting(true);
    setNotFound(false);
    const request: ManualEntityRequest = { value: trimmedValue, entityType };
    const result = await actions.addManualEntity(request);
    switch (manualEntityFeedback(result)) {
      case "added":
        onClose();
        return;
      case "not-found":
        setSubmitting(false);
        setNotFound(true);
        return;
      case "no-op":
        setSubmitting(false);
        return;
    }
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
        {notFound ? (
          <p role="alert" className="text-xs text-error">
            No se encontró ese texto en el documento.
          </p>
        ) : null}
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
