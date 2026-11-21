/**
 * `UserTypeDialog` — crear y editar un tipo propio (`Components.md` §13b.3,
 * ADR-227 §4). Un solo formulario para cuatro casos, según `scope`
 * (`"saved"` | `"document"`) y `mode` (`"create"` | `"edit"`).
 *
 * - Campos: el nombre, la caja «Cómo se reemplaza» con los tres largos de la
 *   escalera (ADR-057) y las dos versiones cortas, opcionales, con la
 *   automática como marcador de posición.
 * - Validación en vivo con `validateUserEntityType`, en una **ranura de alto
 *   fijo**: el error no mueve el diseño (`UX_Guidelines.md` §11b.8). Con
 *   error, el botón principal se apaga y la ranura dice por qué y qué hacer
 *   (§11b.16, textos en `formatTexts.ts`).
 * - Nota al pie: para `saved`, que se guarda en el equipo y aplica a los
 *   próximos documentos; para `document`, que es solo de este documento.
 *
 * El componente no sabe a quién entrega la definición: `onSubmit` lo resuelve
 * el que lo monta (el borrador de `detection.store` para `saved`; el
 * Orchestrator para `document`, que arma `PanelDeEntidades`). `existing` es la
 * lista contra la que se compara la etiqueta, **sin el tipo que se edita**.
 */

import type {
  CountryCode,
  UserEntityTypeDefinition,
  UserEntityTypeId,
} from "@anonly/anonymization-core";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import {
  evaluateTypeForm,
  fieldsOf,
  replacementLadder,
  TYPE_FORM_COPY,
  typeFormLead,
  typeFormNote,
  type UserTypeFields,
  type UserTypeMode,
  type UserTypeScope,
} from "./userTypeForm.js";

export interface UserTypeDialogProps {
  readonly open: boolean;
  readonly scope: UserTypeScope;
  readonly mode: UserTypeMode;
  /** El tipo que se edita; ausente al crear. */
  readonly initial?: UserEntityTypeDefinition;
  /** Los tipos propios contra los que se compara la etiqueta, sin el que se edita. */
  readonly existing: ReadonlyArray<UserEntityTypeDefinition>;
  readonly country: CountryCode;
  /** Cuántos formatos tiene el tipo que se edita (`saved`): para «Sus N formatos no cambian». */
  readonly formatCount?: number;
  readonly onSubmit: (definition: UserEntityTypeDefinition) => void;
  readonly onClose: () => void;
}

function newTypeId(): UserEntityTypeId {
  return `user:${crypto.randomUUID()}`;
}

export function UserTypeDialog({
  open,
  scope,
  mode,
  initial,
  existing,
  country,
  formatCount = 0,
  onSubmit,
  onClose,
}: UserTypeDialogProps) {
  const [fields, setFields] = useState<UserTypeFields>(() => fieldsOf(initial));
  // Un id por apertura: crear dos tipos seguidos no repite id.
  const [freshId, setFreshId] = useState<UserEntityTypeId>(newTypeId);

  useEffect(() => {
    if (!open) return;
    setFields(fieldsOf(initial));
    setFreshId(newTypeId());
  }, [open, initial]);

  const id = initial?.id ?? freshId;
  const result = useMemo(
    () => evaluateTypeForm(id, fields, existing, country),
    [id, fields, existing, country],
  );
  const ladder = replacementLadder(fields);
  const editing = mode === "edit";
  const hasError = result.slot.kind === "error";

  function update(patch: Partial<UserTypeFields>): void {
    setFields((current) => ({ ...current, ...patch }));
  }

  function submit(): void {
    if (!result.canSubmit) return;
    onSubmit(result.definition);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? TYPE_FORM_COPY.editTitle : TYPE_FORM_COPY.createTitle}
      description={typeFormLead(scope, mode, formatCount)}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!result.canSubmit} onClick={submit}>
            {editing ? TYPE_FORM_COPY.editButton : TYPE_FORM_COPY.createButton}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-text-primary">
            {TYPE_FORM_COPY.nameLabel}
          </span>
          <input
            type="text"
            value={fields.name}
            onChange={(event) => update({ name: event.target.value })}
            aria-invalid={hasError}
            autoFocus
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>

        {/* Ranura de alto fijo (UX-10): el texto de reposo y el error ocupan el mismo lugar. */}
        <div
          role={hasError ? "alert" : undefined}
          aria-live="polite"
          className={`flex h-14 items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-snug ${
            hasError
              ? "border-error bg-error/10 font-medium text-error"
              : "border-border bg-bg-secondary text-text-secondary"
          }`}
        >
          {hasError ? (
            <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span className="line-clamp-2">
            {result.slot.kind === "error" ? result.slot.text : TYPE_FORM_COPY.idleSlot}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="text-sm font-semibold text-text-primary">
            {TYPE_FORM_COPY.ladderTitle}
          </span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt className="text-text-secondary">Largo</dt>
            <dd className="font-mono text-text-primary">{ladder.level0 || "—"}</dd>
            <dt className="text-text-secondary">Corto</dt>
            <dd className="font-mono text-text-primary">{ladder.level1 || "—"}</dd>
            <dt className="text-text-secondary">Más corto</dt>
            <dd className="font-mono text-text-primary">{ladder.level2 || "—"}</dd>
          </dl>
          <span className="text-sm font-semibold text-text-primary">
            {TYPE_FORM_COPY.shortLabelsTitle}{" "}
            <span className="font-normal text-text-secondary">{TYPE_FORM_COPY.optional}</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {TYPE_FORM_COPY.shortLevel1Label}
              <input
                type="text"
                value={fields.level1}
                placeholder={ladder.level1}
                onChange={(event) => update({ level1: event.target.value })}
                className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {TYPE_FORM_COPY.shortLevel2Label}
              <input
                type="text"
                value={fields.level2}
                placeholder={ladder.level2}
                onChange={(event) => update({ level2: event.target.value })}
                className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </div>
          <span className="text-xs text-text-secondary">{TYPE_FORM_COPY.shortLabelsHint}</span>
        </div>

        <p className="text-sm text-text-secondary">{TYPE_FORM_COPY.replacementInfo}</p>
        <p className="text-sm text-text-secondary">{typeFormNote(scope, mode)}</p>
        {/* Enter dentro de un campo envía el formulario; el botón del pie es el visible. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
