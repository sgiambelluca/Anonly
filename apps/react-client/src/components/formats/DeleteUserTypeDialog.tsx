/**
 * `DeleteUserTypeDialog` — la confirmación de «Borrar tipo…» de un tipo guardado
 * (`Components.md` §13b.3, ADR-223 §4).
 *
 * Es un `alertdialog`: interrumpe, y lista los formatos que se borran con el
 * tipo, porque borrar un tipo propio borra sus formatos. Botón «Borrar tipo y
 * formatos». El borrado va al borrador y se deshace desde su aviso hasta que se
 * guarda (`UX_Guidelines.md` §11b.11).
 */

import type { FormatDefinition, UserEntityTypeDefinition } from "@anonly/anonymization-core";
import { Trash2Icon } from "lucide-react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import { buildFormatExample } from "./formatExamples.js";

export interface DeleteUserTypeDialogProps {
  readonly open: boolean;
  readonly type: UserEntityTypeDefinition | null;
  /** Los formatos que se borran con el tipo. */
  readonly formats: ReadonlyArray<FormatDefinition>;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const DELETE_TYPE_LINES = {
  noMoreDetection: "Los documentos que abras después ya no van a detectarlos.",
  exported: "Lo que ya exportaste no cambia. Hasta que guardes, lo podés deshacer.",
} as const;

/** La línea bajo el título, según cuántos formatos se pierden. */
export function describeTypeDeletion(formatCount: number): string {
  if (formatCount === 0) return "El tipo no tiene formatos. Se borra de tus tipos.";
  return formatCount === 1
    ? "Se borran el tipo y su formato:"
    : `Se borran el tipo y sus ${formatCount} formatos:`;
}

export function DeleteUserTypeDialog({
  open,
  type,
  formats,
  onConfirm,
  onCancel,
}: DeleteUserTypeDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={type === null ? "Borrar tipo" : `¿Borrar el tipo «${type.name}»?`}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-error/10 text-error">
          <Trash2Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Borrar tipo y formatos
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-secondary">{describeTypeDeletion(formats.length)}</p>
        {formats.length > 0 ? (
          <ul className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-border bg-bg-secondary text-sm text-text-primary">
            {formats.map((format, index) => (
              <li
                key={format.id}
                className={`flex items-center gap-3 px-3 py-2 ${index === 0 ? "" : "border-t border-border"}`}
              >
                <span className="min-w-0 flex-1 truncate">{format.name}</span>
                <span className="max-w-[45%] shrink-0 truncate font-mono text-xs text-text-secondary">
                  {buildFormatExample(format)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {formats.length > 0 ? (
          <p className="text-sm text-text-primary">{DELETE_TYPE_LINES.noMoreDetection}</p>
        ) : null}
        <p className="text-sm text-text-secondary">{DELETE_TYPE_LINES.exported}</p>
      </div>
    </Dialog>
  );
}
