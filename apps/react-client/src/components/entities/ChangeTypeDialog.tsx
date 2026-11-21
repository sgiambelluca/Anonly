/**
 * `ChangeTypeDialog` — "Cambiar tipo" (`ui/Components.md` §3.8, ADR-082 §6;
 * rediseñado por ADR-169 §10 con la vista previa de ADR-170).
 *
 * Corrige la clasificación de un grupo que el detector erró. No es cosmético:
 * el tipo gobierna el token del documento anonimizado, su numeración por tipo,
 * qué regla de scope `type` aplica y de qué pool sortea el sintetizador. Un
 * tipo equivocado produce un documento que **afirma algo falso** sobre el dato
 * que ocultó.
 *
 * - La entidad arriba (punto de color, nombre, "Persona N.º 06 · N
 *   apariciones").
 * - `EntityTypePicker` con el tipo actual marcado "Actual" y no seleccionable.
 * - Una caja **"Cómo queda"** de alto fijo con el token antes → después
 *   (`[PERSONA 06]` → `[ORGANIZACION 03]`), calculado por el Core
 *   (`previewEdit({ kind: "type" })`), y —si deja de ser Persona— *"El género
 *   se borra: solo se usa para personas"* en su ranura.
 *
 * Acción: `actions.updateGroup(groupId, { type })`. Un tipo igual al vigente
 * es no-op (el motor no emite nada, ADR-082 §1); el picker ni lo ofrece.
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import { applyTypeChange } from "./applyEdits.js";
import { BECOMES_LABEL_NOTE, summarizeTypeChange, typePreviewRequest } from "./editPreviews.js";
import { EntityLine } from "./EntityLine.js";
import { EntityTypePicker } from "./EntityTypePicker.js";
import { previewOfNewType } from "./newTypeInline.js";
import { useTypeChoice } from "./useTypeChoice.js";
import { useUserTypes } from "./useUserTypes.js";

export interface ChangeTypeDialogProps {
  readonly group: EntityGroup;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ChangeTypeDialog({ group, open, onClose }: ChangeTypeDialogProps) {
  // Arranca en el tipo vigente, que el picker muestra como "Actual" y no deja
  // elegir: sin elección todavía no hay nada que previsualizar.
  const currentType = group.type;
  const choice = useTypeChoice(currentType);
  const resetChoice = choice.reset;
  const userTypes = useUserTypes();
  const nextType = choice.state.value;

  useEffect(() => {
    if (open) resetChoice(currentType);
  }, [open, currentType, resetChoice]);

  // Con «Nuevo tipo» el tipo todavía no existe: el Core no puede previsualizar el cambio.
  const preview = useMemo(() => {
    if (!open || nextType === "new") return null;
    const request = typePreviewRequest(group, nextType);
    return request === null ? null : actions.previewEdit(request);
  }, [open, group, nextType]);
  const summary = summarizeTypeChange(group, preview, userTypes);
  const canApply = nextType !== currentType && choice.canConfirm;

  function handleApply(): void {
    if (!canApply) return;
    const resolved = choice.resolve();
    if (resolved === null) return;
    if (!applyTypeChange(group, resolved.entityType, preview?.groups[0], resolved.newType)) return;
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cambiar tipo"
      description="Si el análisis clasificó mal un dato, elegí qué es en realidad."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="min-w-[8rem]"
            disabled={!canApply}
            onClick={handleApply}
          >
            {/* «Crear y cambiar» (ADR-229 §2): el contenedor decide el botón. */}
            {choice.creating ? "Crear y cambiar" : "Cambiar tipo"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <EntityLine
          group={{
            type: group.type,
            canonicalValue: group.canonicalValue,
            indexInType: group.indexInType,
            memberCount: group.members.length,
          }}
        />

        <div className="flex flex-col gap-1.5">
          <span id="change-type-pick" className="font-semibold text-text-secondary">
            Es un…
          </span>
          <EntityTypePicker
            {...choice.pickerProps}
            current={currentType}
            columns={3}
            onNewTypeSubmit={handleApply}
            aria-labelledby="change-type-pick"
          />
        </div>

        {/* Caja "Cómo queda" de alto fijo (UX-10). */}
        <div
          aria-live="polite"
          className="flex h-[10.5rem] flex-col gap-2 rounded-lg border border-accent/35 bg-accent/5 px-3.5 py-3"
        >
          <span className="font-semibold text-text-primary">Cómo queda</span>
          {choice.creating ? (
            // Línea de pie del contenedor: el error del nombre y, si es válido, lo que se crea.
            <>
              <span
                className={`line-clamp-3 ${choice.error !== null ? "text-error" : "text-text-secondary"}`}
              >
                {choice.error ??
                  (choice.state.newType !== null && choice.canConfirm
                    ? `Se crea el tipo «${choice.state.newType.name.trim()}» solo para este documento y la entidad pasa a ser ${previewOfNewType(choice.state.newType)}.`
                    : "Escribí el nombre del tipo nuevo.")}
              </span>
              <span className="h-5 text-text-secondary">
                {group.replacementMode === ReplacementMode.Synthetic ? BECOMES_LABEL_NOTE : ""}
              </span>
            </>
          ) : summary !== null ? (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span className="max-w-[10rem] truncate rounded-md bg-bg-tertiary px-1.5 py-0.5 font-mono text-text-primary">
                  {summary.before}
                </span>
                <ArrowRightIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                <span className="max-w-[10rem] truncate rounded-md bg-bg-tertiary px-1.5 py-0.5 font-mono text-text-primary">
                  {summary.after}
                </span>
              </span>
              <span className="truncate text-text-secondary">{summary.note}</span>
              <span className="h-5 text-text-secondary">
                {summary.dropsGender ? "El género se borra: solo se usa para personas." : ""}
              </span>
              <span className="h-5 text-text-secondary">
                {summary.becomesLabel ? BECOMES_LABEL_NOTE : ""}
              </span>
            </>
          ) : (
            <span className="text-text-secondary">Elegí un tipo para ver cómo queda.</span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
