/**
 * `EditReplacementDialog` (`ui/Components.md` §3.4b, ADR-076 §2).
 *
 * El único punto de entrada por el que el usuario escribe un
 * `replacementValue` propio. Todo lo de abajo ya existía —el campo, la acción,
 * la precedencia decidida en los once puntos de recálculo (ADR-076), la marca
 * de "editado a mano" (ADR-078)— y lo único que faltaba era el input: hasta
 * este componente, `actions.updateGroup(id, { replacementValue })` no tenía
 * **ningún** call site en la app.
 *
 * Es **por entidad**, no por tipo: `EntityGroup` es una entidad concreta ("Juan
 * Pérez"), y todas sus ocurrencias comparten el valor (invariante de ADR-012).
 * Para darle otro valor a una aparición suelta hay que **dividirla** a un grupo
 * propio primero (`SplitDialog`).
 *
 * **No se ofrece en `redact`** (ADR-012): ahí el valor es `""` y la censura es
 * visual — un bloque negro tiene una sola forma, así que no hay texto que
 * elegir. `GroupContextMenu` no muestra la entrada en ese modo.
 */

import type { EntityGroup } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import { estimateReplacementFit, type ReplacementFit } from "./replacementFit.js";

export interface EditReplacementDialogProps {
  readonly group: EntityGroup;
  readonly open: boolean;
  readonly onClose: () => void;
}

const FIT_MESSAGE: Readonly<Record<ReplacementFit, string | null>> = {
  fits: null,
  tight: "Puede quedar justo en la aparición más chica.",
  overflows: "Es probable que no entre en la aparición más chica y se vea encogido.",
  unknown: null,
};

export function EditReplacementDialog({ group, open, onClose }: EditReplacementDialogProps) {
  const [value, setValue] = useState(group.replacementValue);

  useEffect(() => {
    if (open) setValue(group.replacementValue);
  }, [open, group.replacementValue]);

  function handleApply(): void {
    actions.updateGroup(group.id, { replacementValue: value });
    onClose();
  }

  const fit = estimateReplacementFit(value, group.members);
  const fitMessage = FIT_MESSAGE[fit];

  return (
    <Dialog open={open} onClose={onClose} title="Editar reemplazo">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">
          Con qué se reemplaza{" "}
          <span className="font-medium text-text-primary">&quot;{group.canonicalValue}&quot;</span>{" "}
          en las {group.members.length} apariciones donde figura.
        </p>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`replacement-${group.id}`}
            className="text-sm font-medium text-text-secondary"
          >
            Texto de reemplazo
          </label>
          <input
            id={`replacement-${group.id}`}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {fitMessage !== null ? (
            <p className="text-sm text-warning" role="status">
              {fitMessage}
            </p>
          ) : null}
        </div>
        {/*
          ADR-076 §3: un cambio del `replacementMode` EFECTIVO recalcula el
          valor y apaga la marca de edición manual. Es la única forma de perder
          lo que se escribe acá, y se avisa porque el disparador (el selector de
          la fila, o una regla que empiece a aplicar) está lejos de este
          diálogo.
        */}
        <p className="text-sm text-text-secondary">
          Si después cambiás el modo de reemplazo de este grupo, el texto vuelve al calculado.
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Guardar
        </Button>
      </div>
    </Dialog>
  );
}
