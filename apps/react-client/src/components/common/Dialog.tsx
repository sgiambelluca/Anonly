/**
 * `Dialog` — wrapper sobre Radix `Dialog` con focus trap, escape para cerrar y
 * backdrop (`ui/Components.md` §8.2). Base de `ConfirmDialog`, `SettingsDialog`
 * y `PasswordDialog`.
 *
 * **Alto acotado y cuerpo scrolleable.** Sin el tope, un diálogo con mucho
 * contenido —Configuración, desde que ganó apariencia y actualizaciones— crece
 * hasta pasarse de la ventana, y como está centrado con `-translate-y-1/2` lo
 * que se sale lo hace **por arriba y por abajo a la vez**: el título deja de
 * verse y los botones quedan fuera de alcance, sin barra de scroll que avise.
 *
 * El `footer` va aparte del cuerpo a propósito: los botones de acción no
 * scrollean con el contenido. Un "Guardar" al que hay que llegar scrolleando
 * es un "Guardar" que la mitad de la gente no encuentra.
 */

import * as RadixDialog from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  /** Acciones fijas al pie: no scrollean con el cuerpo. */
  readonly footer?: ReactNode;
  /** Oculta el botón `[x]` de cierre (p. ej. cuando el cierre solo debe pasar por botones explícitos). */
  readonly hideCloseButton?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hideCloseButton = false,
}: DialogProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-bg-primary p-5 shadow-md focus:outline-none">
          <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
            <RadixDialog.Title className="text-sm font-semibold text-text-primary">
              {title}
            </RadixDialog.Title>
            {hideCloseButton ? null : (
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
                >
                  <XIcon className="h-4 w-4" aria-hidden />
                </button>
              </RadixDialog.Close>
            )}
          </div>
          {description ? (
            <RadixDialog.Description className="mb-3 shrink-0 text-sm text-text-secondary">
              {description}
            </RadixDialog.Description>
          ) : null}
          {/*
            `-mx-5 px-5`: el padding horizontal se reaplica adentro del área
            que scrollea para que la barra quede pegada al borde del diálogo y
            no flotando en el medio del padding.
          */}
          <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">{children}</div>
          {footer ? <div className="mt-4 shrink-0">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
