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
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const DialogSelectOpenContext = createContext<(open: boolean) => void>(() => undefined);

/** Connects a portalled Radix Select to the Dialog that contains its trigger. */
export function useDialogSelectOpenChange(): (open: boolean) => void {
  return useContext(DialogSelectOpenContext);
}

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Contenido a la derecha del título, en el mismo renglón (p. ej. "5/9"). */
  readonly titleAside?: ReactNode;
  readonly description?: string;
  readonly children?: ReactNode;
  /** Acciones fijas al pie: no scrollean con el cuerpo. */
  readonly footer?: ReactNode;
  /** Oculta el botón `[x]` de cierre (p. ej. cuando el cierre solo debe pasar por botones explícitos). */
  readonly hideCloseButton?: boolean;
  /**
   * Ancho máximo. `md` es el de siempre; `lg` es para diálogos con contenido
   * en columnas (`AboutDialog`, los diálogos de edición de ADR-169 §10).
   */
  readonly size?: "md" | "lg";
}

const SIZE_CLASS: Readonly<Record<NonNullable<DialogProps["size"]>, string>> = {
  md: "max-w-md",
  lg: "max-w-xl",
};

export function Dialog({
  open,
  onClose,
  title,
  titleAside,
  description,
  children,
  footer,
  hideCloseButton = false,
  size = "md",
}: DialogProps) {
  const [selectOpen, setSelectOpen] = useState(false);
  const handleSelectOpenChange = useCallback((next: boolean) => setSelectOpen(next), []);

  useEffect(() => {
    if (!open) setSelectOpen(false);
  }, [open]);

  return (
    <DialogSelectOpenContext.Provider value={handleSelectOpenChange}>
      <RadixDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
          {/* Radix Select's modal portal disables outside pointer events. Re-enable
              them only over this Dialog while its own Select is open. */}
          <RadixDialog.Content
            style={selectOpen ? { pointerEvents: "auto" } : undefined}
            className={`fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] ${SIZE_CLASS[size]} -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-bg-primary p-5 shadow-md focus:outline-none`}
          >
            <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <RadixDialog.Title className="text-sm font-semibold text-text-primary">
                  {title}
                </RadixDialog.Title>
                {titleAside}
              </div>
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
    </DialogSelectOpenContext.Provider>
  );
}
