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
import { CheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { subscribeToToasts, type ToastMessage } from "./toast.js";

const TOAST_DURATION_MS = 6000;

export function ToastHost() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => subscribeToToasts(setToast), []);

  return (
    <RadixToast.Provider duration={TOAST_DURATION_MS} swipeDirection="right">
      {toast !== null ? (
        <RadixToast.Root
          // `key` con el id monótono: sin esto, dos toasts seguidos reusan el
          // mismo nodo y el temporizador del primero sigue corriendo, así que
          // el segundo se cierra antes de tiempo.
          key={toast.id}
          // ADR-174 §4: un toast persistente no expira solo (`Infinity`
          // desactiva el temporizador de Radix); el resto sigue con el de la
          // `Provider` (`TOAST_DURATION_MS`), así que la prop `duration` ni se
          // pasa — `exactOptionalPropertyTypes` no deja pasarla en `undefined`.
          {...(toast.persistent === true ? { duration: Infinity } : {})}
          className="anonly-toast-in flex w-[23.75rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border border-border bg-bg-primary py-3 pl-3.5 pr-3 shadow-md"
          onOpenChange={(open) => {
            if (!open) setToast(null);
          }}
        >
          <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              toast.tone === "success"
                ? "bg-success/15 text-text-primary"
                : toast.tone === "warning"
                  ? "bg-warning/15 text-warning-strong"
                  : "bg-bg-tertiary text-text-secondary"
            }`}
          >
            {toast.tone === "success" ? (
              <CheckIcon className="h-4 w-4" />
            ) : toast.tone === "warning" ? (
              <TriangleAlertIcon className="h-4 w-4" />
            ) : (
              <InfoIcon className="h-4 w-4" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <RadixToast.Title className="text-sm font-semibold text-text-primary">
              {toast.title}
            </RadixToast.Title>
            {toast.description !== undefined ? (
              <RadixToast.Description className="text-sm text-text-secondary">
                {toast.description}
              </RadixToast.Description>
            ) : null}
            {toast.actions !== undefined && toast.actions.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {toast.actions.map((action) => (
                  <RadixToast.Action
                    key={action.label}
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </RadixToast.Close>
        </RadixToast.Root>
      ) : null}
      <RadixToast.Viewport className="fixed bottom-5 right-5 z-[100] flex max-w-[calc(100vw-2.5rem)] flex-col outline-none" />
    </RadixToast.Provider>
  );
}
