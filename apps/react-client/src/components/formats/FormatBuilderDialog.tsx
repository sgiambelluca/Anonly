/**
 * `FormatBuilderDialog` — el generador de formatos (`Components.md` §13b.5,
 * ADR-228).
 *
 * **STUB de la tanda 1 de F7.** Esta tanda deja solo el punto de entrada: el
 * contrato de props (`FormatBuilderDialogProps`) y el pedido
 * (`FormatBuilderRequest`) que `DetectionFormatsDialog` ya usa desde «Nuevo
 * formato» y «Editar». La tanda 2 reemplaza el cuerpo de este archivo por el
 * generador real sin tocar a quien lo monta.
 *
 * Contrato que la tanda 2 respeta:
 * - `request` dice qué se abrió: un formato nuevo en un tipo, la edición de un
 *   formato propio o de una copia editada, o la edición de un formato base
 *   `structure` (que crea una copia con `basedOn`, ADR-220 §4);
 * - `state` es el borrador: de ahí salen los tipos guardados y los formatos
 *   existentes para `validateFormat`/`compareFormat`;
 * - `onSubmit` entrega **un** `DetectionChange` (`createFormat`, `editFormat` o
 *   `createEditedCopy`): cuenta como un cambio en `pendingChanges`;
 * - `onClose` cierra sin cambios. Cerrar con cambios sin guardar pide
 *   confirmación dentro del generador (`UX_Guidelines.md` §11b.5).
 */

import type { EntityTypeId } from "@anonly/anonymization-core";

import type { DetectionChange, DetectionState } from "../../store/detectionState.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

export type FormatBuilderRequest =
  /** «Nuevo formato» en la banda de un tipo. */
  | { readonly kind: "create"; readonly entityType: EntityTypeId }
  /** «Editar» un formato propio o una copia editada, por su id. */
  | { readonly kind: "edit"; readonly formatId: string }
  /** «Editar» un formato base `structure`: se edita como copia, por el id del catálogo. */
  | { readonly kind: "editBase"; readonly catalogId: string };

export interface FormatBuilderDialogProps {
  /** `null` = cerrado. */
  readonly request: FormatBuilderRequest | null;
  /** El borrador del árbol. */
  readonly state: DetectionState;
  readonly onSubmit: (change: DetectionChange) => void;
  readonly onClose: () => void;
}

export function FormatBuilderDialog({ request, onClose }: FormatBuilderDialogProps) {
  return (
    <Dialog
      open={request !== null}
      onClose={onClose}
      title="Generador de formatos"
      description="Llega en la próxima tanda de la 1.1."
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary">
        Por ahora podés prender y apagar formatos, y crear tipos propios.
      </p>
    </Dialog>
  );
}
