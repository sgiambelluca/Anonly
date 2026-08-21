/**
 * `ToastHost` (`ui/Components.md` §8.6) — el único consumidor de `toast.ts`.
 *
 * Se monta una sola vez, en `App`. Muestra el último toast emitido durante
 * `TOAST_DURATION_MS` (5 s, `UX_Guidelines.md` §8 "auto-dismiss en 3-5 s").
 *
 * **No roba el foco**: `role="status"` + `aria-live="polite"` sobre el
 * viewport (lo que Radix ya hace) anuncia el texto sin interrumpir lo que el
 * usuario está haciendo. Un toast que capturara el foco para ofrecer
 * "Deshacer" sería peor que no ofrecerlo — el usuario acaba de aplicar un
 * modo y está mirando el árbol, no el toast.
 *
 * Un solo toast a la vez: aplicar dos modos seguidos reemplaza el aviso en
 * vez de apilarlos. Apilar tendría sentido si cada uno describiera una acción
 * independiente, pero acá el segundo cambio hace obsoleto el "Deshacer" del
 * primero — mostrarlos juntos ofrecería deshacer algo que ya no está vigente.
 */

import * as RadixToast from "@radix-ui/react-toast";
import { useEffect, useState } from "react";

import { subscribeToToasts, type ToastMessage } from "./toast.js";

const TOAST_DURATION_MS = 5000;

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
          className="flex items-center gap-4 rounded-md border border-border bg-bg-primary px-4 py-3 shadow-md"
          onOpenChange={(open) => {
            if (!open) setToast(null);
          }}
        >
          <RadixToast.Description className="text-sm text-text-primary">
            {toast.text}
          </RadixToast.Description>
          {toast.action !== undefined ? (
            <RadixToast.Action
              altText={toast.action.label}
              onClick={toast.action.run}
              className="shrink-0 rounded px-2 py-1 text-sm font-medium text-accent hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {toast.action.label}
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ) : null}
      <RadixToast.Viewport className="fixed bottom-4 left-1/2 z-[100] w-max max-w-[90vw] -translate-x-1/2" />
    </RadixToast.Provider>
  );
}
