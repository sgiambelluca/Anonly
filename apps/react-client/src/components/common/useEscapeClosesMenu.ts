/**
 * `useEscapeClosesMenu` — `Esc` cierra un menú flotante que vive **dentro de un
 * diálogo**, y solo el menú.
 *
 * Radix `Dialog` escucha `keydown` en `document` en fase de captura, así que se
 * entera del `Esc` antes que cualquier handler del menú: un `stopPropagation` en
 * el botón llegaba tarde, y con el generador sin cambios `Esc` cerraba el diálogo
 * entero junto con el menú «+ Pieza» (pasada de UI de la 1.1, 2026-11-21).
 *
 * Este listener va en `window`, también en captura: corre antes que el de Radix,
 * cierra el menú y marca el evento con `preventDefault()`, que es la señal que
 * Radix respeta para no cerrar el diálogo. El segundo `Esc` ya no encuentra el
 * menú abierto y cierra el diálogo como siempre.
 */

import { useEffect } from "react";

export function useEscapeClosesMenu(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  }, [open, close]);
}
