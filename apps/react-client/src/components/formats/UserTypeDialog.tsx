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
import { Checkbox } from "../common/Checkbox.js";
import { Dialog } from "../common/Dialog.js";
import { FieldHint } from "../common/FieldHint.js";
import { fieldBorderClass } from "../common/fieldHintText.js";

import {
  evaluateTypeForm,
  fieldsOf,
  replacementLadder,
  replacementTokens,
  SHORT_LABEL_HELP,
  TYPE_FORM_COPY,
  typeFormLead,
  typeFormNote,
  typeNameHelp,
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
  /**
   * `save`: al crear un tipo del documento, si se tildó «Guardarlo también para
   * los próximos documentos» (ADR-225 §5, precisión del 2026-11-21). En los
   * otros casos, siempre `false`.
   */
  readonly onSubmit: (definition: UserEntityTypeDefinition, save: boolean) => void;
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
  const [save, setSave] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields(fieldsOf(initial));
    setFreshId(newTypeId());
    setSave(false);
  }, [open, initial]);

  const id = initial?.id ?? freshId;
  const result = useMemo(
    () => evaluateTypeForm(id, fields, existing, country),
    [id, fields, existing, country],
  );
  const ladder = replacementLadder(fields);
  const editing = mode === "edit";
  // La casilla de guardar solo existe al crear un tipo del documento.
  const offersSave = scope === "document" && !editing;
  const errorText = result.slot.kind === "error" ? result.slot.text : null;
  const nameError = result.errorField === "name" ? errorText : null;
  const shortError = result.errorField === "short" ? errorText : null;

  function update(patch: Partial<UserTypeFields>): void {
    setFields((current) => ({ ...current, ...patch }));
  }

  function submit(): void {
    if (!result.canSubmit) return;
    onSubmit(result.definition, offersSave && save);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? TYPE_FORM_COPY.editTitle : TYPE_FORM_COPY.createTitle}
      description={typeFormLead(scope, mode, formatCount)}
      size="lg"
      // Alto: con la casilla de guardar, a 1366 × 700 scrolleaba por 3 px (§11b.18).
      tall
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
      {/* `gap-4`: el segundo renglón de un error largo (`FieldHint`) entra en el espacio entre bloques. */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-text-primary">
              {TYPE_FORM_COPY.nameLabel}
            </span>
            <input
              type="text"
              value={fields.name}
              onChange={(event) => update({ name: event.target.value })}
              aria-invalid={nameError !== null}
              aria-describedby="user-type-name-hint"
              autoFocus
              className={`rounded-lg border ${fieldBorderClass(nameError !== null)} bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            />
          </label>
          {/* Línea de ayuda (§11b.17): el contador y cómo queda; con error, el error. */}
          <FieldHint id="user-type-name-hint" help={typeNameHelp(fields)} error={nameError} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">
            {TYPE_FORM_COPY.ladderTitle}
          </span>
          <ul className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2.5">
            {replacementTokens(ladder).map((token, index) => (
              <li key={index} className="flex min-w-0 flex-col gap-1">
                <span className="truncate whitespace-nowrap rounded-md border border-border bg-bg-secondary px-2 py-1 font-mono text-sm font-semibold text-text-primary">
                  {token}
                </span>
                <span className="text-sm text-text-secondary">
                  {TYPE_FORM_COPY.ladderCaptions[index]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text-primary">
            {TYPE_FORM_COPY.shortLabelsTitle}{" "}
            <span className="font-normal text-text-secondary">{TYPE_FORM_COPY.optional}</span>
          </span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="w-14 shrink-0">{TYPE_FORM_COPY.shortLevel1Label}</span>
              <input
                type="text"
                value={fields.level1}
                placeholder={ladder.level1}
                onChange={(event) => update({ level1: event.target.value })}
                aria-invalid={shortError !== null}
                aria-describedby="user-type-short-hint"
                className={`min-w-0 flex-1 rounded-lg border ${fieldBorderClass(shortError !== null)} bg-bg-primary px-3 py-1.5 font-mono text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="w-14 shrink-0">{TYPE_FORM_COPY.shortLevel2Label}</span>
              <input
                type="text"
                value={fields.level2}
                placeholder={ladder.level2}
                onChange={(event) => update({ level2: event.target.value })}
                aria-invalid={shortError !== null}
                aria-describedby="user-type-short-hint"
                className={`min-w-0 flex-1 rounded-lg border ${fieldBorderClass(shortError !== null)} bg-bg-primary px-3 py-1.5 font-mono text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
              />
            </label>
          </div>
          <FieldHint id="user-type-short-hint" help={SHORT_LABEL_HELP} error={shortError} />
        </div>

        <p className="flex items-start gap-2 text-sm text-text-secondary">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>{TYPE_FORM_COPY.replacementInfo}</span>
        </p>
        {offersSave ? (
          // Un tipo del documento se pierde al cerrarlo: es lo único de este diálogo
          // que puede costarle trabajo al usuario. El aviso trae cómo evitarlo, en
          // el momento de crearlo (ADR-225 §5, precisión del 2026-11-21). Las dos
          // versiones miden lo mismo: dos renglones y la casilla (UX-10).
          <div
            className={`flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm text-text-primary ${
              save ? "border-accent/35 bg-accent/10" : "border-warning-strong bg-warning/15"
            }`}
          >
            <p className="flex min-h-10 items-start gap-2">
              {save ? (
                <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              ) : (
                <TriangleAlertIcon
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
                  aria-hidden
                />
              )}
              <span className="line-clamp-2">{typeFormNote(scope, mode, save)}</span>
            </p>
            <div className="pl-6">
              <Checkbox
                id="user-type-save"
                checked={save}
                onCheckedChange={setSave}
                label={<span className="font-medium">{TYPE_FORM_COPY.saveForLater}</span>}
              />
            </div>
          </div>
        ) : scope === "document" ? (
          <p className="flex items-start gap-2 rounded-lg border border-warning-strong bg-warning/15 px-3 py-2 text-sm text-text-primary">
            <TriangleAlertIcon
              className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
              aria-hidden
            />
            <span>{typeFormNote(scope, mode)}</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>{typeFormNote(scope, mode)}</span>
          </p>
        )}
        {/* Enter dentro de un campo envía el formulario; el botón del pie es el visible. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
