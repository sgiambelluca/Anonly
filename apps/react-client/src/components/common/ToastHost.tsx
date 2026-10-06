/**
 * `ToastHost` (`ui/Components.md` §8.6) — el único consumidor de `toast.ts`.
 *
 * **Abajo a la derecha y flotante** (ADR-169, UX-10): no desplaza nada.
 * Tarjeta con ícono, título, una línea de detalle, hasta dos acciones y un
 * botón para cerrarla. Dura `TOAST_DURATION_MS`.
 *
 * **No roba el foco**: `role="status"` + `aria-live="polite"` sobre el
 * viewport (lo que Radix ya hace) anuncia el texto sin interrumpir lo que el
 * usuario está haciendo.
 *
 * Un solo toast a la vez: una acción nueva reemplaza al aviso anterior en vez
 * de apilarlos — el "Deshacer" de un toast viejo ofrecería deshacer algo que
 * ya no es lo último (ADR-172 §3).
 */

import * as RadixToast from "@radix-ui/react-toast";
import {
  CheckIcon,
  InfoIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  dismissToastIfCurrent,
  subscribeToToasts,
  TOAST_DURATION_MS,
  TOAST_EXIT_DURATION_MS,
  type ToastMessage,
} from "./toast.js";

interface VisibleToast {
  readonly toast: ToastMessage;
  readonly exiting: boolean;
}

export function ToastHost() {
  const [visible, setVisible] = useState<VisibleToast | null>(null);
  const toastRootRef = useRef<HTMLLIElement | null>(null);

  useEffect(
    () =>
      subscribeToToasts((toast) => {
        setVisible((current) =>
          toast === null
            ? current === null || current.exiting
              ? current
              : { ...current, exiting: true }
            : { toast, exiting: false },
        );
      }),
    [],
  );

  useEffect(() => {
    if (visible === null || !visible.exiting) return;
    const toastId = visible.toast.id;
    const timeout = window.setTimeout(() => {
      setVisible((current) => (current?.toast.id === toastId && current.exiting ? null : current));
    }, TOAST_EXIT_DURATION_MS + 80);
    return () => window.clearTimeout(timeout);
  }, [visible]);

  useLayoutEffect(() => {
    const root = toastRootRef.current;
    if (root === null) return;
    // Radix ToastViewport puede intentar enfocar su LI al avanzar con Tab,
    // incluso cuando tiene aria-hidden y tabIndex=-1. El atributo inert
    // nativo bloquea también ese foco programático durante el cierre.
    root.inert = visible?.exiting ?? false;
    if (visible === null || !visible.exiting) return;
    const activeElement = document.activeElement;
    if (root?.contains(activeElement) && activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }, [visible]);

  function finishExit(toastId: number): void {
    setVisible((current) => (current?.toast.id === toastId && current.exiting ? null : current));
  }

  return (
    <RadixToast.Provider duration={TOAST_DURATION_MS} swipeDirection="right">
      {visible !== null ? (
        <RadixToast.Root
          // `key` con el id monótono: sin esto, dos toasts seguidos reusan el
          // mismo nodo y el temporizador del primero sigue corriendo, así que
          // el segundo se cierra antes de tiempo.
          key={visible.toast.id}
          ref={toastRootRef}
          open={!visible.exiting}
          {...(visible.exiting ? { tabIndex: -1 } : {})}
          // ADR-174 §4: un toast persistente no expira solo (`Infinity`
          // desactiva el temporizador de Radix); el resto sigue con el de la
          // `Provider` (`TOAST_DURATION_MS`), así que la prop `duration` ni se
          // pasa — `exactOptionalPropertyTypes` no deja pasarla en `undefined`.
          {...(visible.toast.persistent === true ? { duration: Infinity } : {})}
          aria-hidden={visible.exiting}
          className={`${visible.exiting ? "anonly-toast-out pointer-events-none" : "anonly-toast-in"} flex w-[23.75rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border bg-bg-primary py-3 pl-3.5 pr-3 shadow-md ${
            visible.toast.tone === "deletion" ? "border-error/30" : "border-border"
          }`}
          {...(visible.toast.tone === "deletion"
            ? {
                style: {
                  backgroundImage:
                    "linear-gradient(rgb(var(--color-error) / 0.04), rgb(var(--color-error) / 0.04))",
                },
              }
            : {})}
          onOpenChange={(open) => {
            // `dismissToast()`, no `setToast(null)`: cuando el toast se va
            // solo (por tiempo, swipe o el botón de cerrar) hay que avisarle
            // a TODOS los suscriptores de `toast.ts`, no solo a este
            // componente — `ManualOverlapDialogHost` (ADR-175 §5) necesita
            // saber que la ranura quedó libre para volver a mostrar su
            // aviso persistente.
            if (!open) dismissToastIfCurrent(visible.toast.id);
          }}
          onAnimationEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.animationName === "anonly-toast-out"
            ) {
              finishExit(visible.toast.id);
            }
          }}
        >
          <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              visible.toast.tone === "deletion"
                ? "bg-error/10 text-error"
                : visible.toast.tone === "success"
                  ? "bg-success/15 text-text-primary"
                  : visible.toast.tone === "warning"
                    ? "bg-warning/15 text-warning-strong"
                    : visible.toast.tone === "error"
                      ? "bg-error/10 text-error"
                      : "bg-bg-tertiary text-text-secondary"
            }`}
          >
            {visible.toast.tone === "deletion" ? (
              <Trash2Icon className="h-4 w-4" />
            ) : visible.toast.tone === "success" ? (
              <CheckIcon className="h-4 w-4" />
            ) : visible.toast.tone === "warning" ? (
              <TriangleAlertIcon className="h-4 w-4" />
            ) : visible.toast.tone === "error" ? (
              <XCircleIcon className="h-4 w-4" />
            ) : (
              <InfoIcon className="h-4 w-4" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <RadixToast.Title className="text-sm font-semibold text-text-primary">
              {visible.toast.title}
            </RadixToast.Title>
            {visible.toast.description !== undefined ? (
              <RadixToast.Description className="text-sm text-text-secondary">
                {visible.toast.description}
              </RadixToast.Description>
            ) : null}
            {visible.toast.actions !== undefined && visible.toast.actions.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {visible.toast.actions.map((action) => (
                  <RadixToast.Action
                    key={action.label}
                    disabled={visible.exiting}
                    altText={
                      action.shortcut ? `${action.label} (${action.shortcut})` : action.label
                    }
                    onClick={action.run}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-accent/10 px-2.5 text-sm font-semibold text-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {action.label}
                    {action.shortcut !== undefined ? (
                      <kbd className="rounded border border-current px-1 font-sans text-sm font-medium opacity-75">
                        {action.shortcut}
                      </kbd>
                    ) : null}
                  </RadixToast.Action>
                ))}
              </div>
            ) : null}
          </div>
          <RadixToast.Close
            aria-label="Cerrar aviso"
            disabled={visible.exiting}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </RadixToast.Close>
        </RadixToast.Root>
      ) : null}
      <RadixToast.Viewport className="fixed bottom-[var(--anonly-toast-bottom,1.25rem)] right-5 z-[100] flex max-w-[calc(100vw-2.5rem)] flex-col outline-none" />
    </RadixToast.Provider>
  );
}
