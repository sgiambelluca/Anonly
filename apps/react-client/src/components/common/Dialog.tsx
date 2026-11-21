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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import { dialogLayerFor, dialogZIndex } from "./dialogLayers.js";

/** Cuántos diálogos modales hay abiertos: el siguiente que abre toma esa capa. */
let openDialogCount = 0;

/**
 * La capa del diálogo en la pila (§11b.17): un diálogo abierto sobre otro sube
 * una capa, para que su fondo desenfoque también al de abajo.
 */
function useDialogLayer(open: boolean): number {
  const [layer, setLayer] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    setLayer(dialogLayerFor(openDialogCount));
    openDialogCount += 1;
    return () => {
      openDialogCount -= 1;
    };
  }, [open]);
  return layer;
}

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
  /**
   * Ícono a la izquierda del título y de la descripción (ADR-215 §3,
   * `Components.md` §8.2). Es decorativo (`aria-hidden`): lo que el diálogo
   * dice ya está en el título. Quien lo pasa dibuja su propia caja (fondo y
   * color). Sin esta prop el encabezado queda como siempre.
   */
  readonly icon?: ReactNode;
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
  readonly size?: "md" | "lg" | "xl" | "2xl";
  /**
   * `alertdialog` para una confirmación que interrumpe (rechazo de una
   * importación, borrar un tipo con sus formatos). Radix lo deja en `dialog` por
   * defecto; sin la prop, nada cambia.
   */
  readonly role?: "alertdialog";
  /** Acciones del encabezado, a la izquierda del botón de cierre (p. ej. «Importar…» y «Exportar…»). */
  readonly headerActions?: ReactNode;
  /**
   * `Esc` antes de cerrar: quien lo pasa puede frenar el cierre con
   * `event.preventDefault()` (el generador de formatos lo usa para cerrar su
   * panel de prueba flotante primero, `UX_Guidelines.md` §11b.7).
   */
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Usa hasta el 92 % del alto de la ventana en vez del 85 % (el generador de formatos). */
  readonly tall?: boolean;
  /** La descripción va en la columna del título, sin un renglón propio debajo (el generador). */
  readonly descriptionInline?: boolean;
}

const SIZE_CLASS: Readonly<Record<NonNullable<DialogProps["size"]>, string>> = {
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  // 1140 px, el ancho del tablero de Formatos; con `w-[calc(100%-2rem)]` entra en 1280.
  "2xl": "max-w-[71.25rem]",
};

export function Dialog({
  open,
  onClose,
  title,
  titleAside,
  icon,
  description,
  children,
  footer,
  hideCloseButton = false,
  size = "md",
  role,
  headerActions,
  onEscapeKeyDown,
  tall = false,
  descriptionInline = false,
}: DialogProps) {
  const [selectOpen, setSelectOpen] = useState(false);
  const zIndex = dialogZIndex(useDialogLayer(open));
  const handleSelectOpenChange = useCallback((next: boolean) => setSelectOpen(next), []);

  useEffect(() => {
    if (!open) setSelectOpen(false);
  }, [open]);

  const titleNode = (
    <RadixDialog.Title className="text-sm font-semibold text-text-primary">
      {title}
    </RadixDialog.Title>
  );
  const closeButton = (
    <RadixDialog.Close asChild>
      <button
        type="button"
        aria-label="Cerrar"
        className="shrink-0 rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </RadixDialog.Close>
  );

  return (
    <DialogSelectOpenContext.Provider value={handleSelectOpenChange}>
      <RadixDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <RadixDialog.Portal>
          {/* Velo oscuro y desenfoque leve (§11b.17); el z-index sigue la pila de diálogos. */}
          <RadixDialog.Overlay
            onClick={onClose}
            style={{ zIndex: zIndex.overlay }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[3px]"
          />
          {/* Radix Select's modal portal disables outside pointer events. Re-enable
              them only over this Dialog while its own Select is open. */}
          <RadixDialog.Content
            {...(role !== undefined ? { role } : {})}
            {...(onEscapeKeyDown !== undefined ? { onEscapeKeyDown } : {})}
            style={{
              zIndex: zIndex.content,
              ...(selectOpen ? { pointerEvents: "auto" as const } : {}),
            }}
            className={`fixed left-1/2 top-1/2 flex ${tall ? "max-h-[92vh]" : "max-h-[85vh]"} w-[calc(100%-2rem)] ${SIZE_CLASS[size]} -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-bg-primary p-5 shadow-md focus:outline-none`}
          >
            {icon !== undefined ? (
              // ADR-215 §3: con ícono, el título y la descripción van en una
              // columna a su derecha; el botón de cierre sigue al final.
              <div className="mb-3 flex shrink-0 items-start gap-3">
                <span aria-hidden className="shrink-0">
                  {icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {titleNode}
                    {titleAside}
                  </div>
                  {description ? (
                    <RadixDialog.Description className="text-sm text-text-secondary">
                      {description}
                    </RadixDialog.Description>
                  ) : null}
                </div>
                {headerActions}
                {hideCloseButton ? null : closeButton}
              </div>
            ) : (
              <>
                <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-baseline gap-2">
                      {titleNode}
                      {titleAside}
                    </div>
                    {descriptionInline && description ? (
                      <RadixDialog.Description className="text-sm text-text-secondary">
                        {description}
                      </RadixDialog.Description>
                    ) : null}
                  </div>
                  {/* Las acciones van pegadas a la X, no repartidas por `justify-between`. */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {headerActions}
                    {headerActions !== undefined && !hideCloseButton ? (
                      <span aria-hidden className="mx-1 h-7 w-px bg-border" />
                    ) : null}
                    {hideCloseButton ? null : closeButton}
                  </div>
                </div>
                {description && !descriptionInline ? (
                  <RadixDialog.Description className="mb-3 shrink-0 text-sm text-text-secondary">
                    {description}
                  </RadixDialog.Description>
                ) : null}
              </>
            )}
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
