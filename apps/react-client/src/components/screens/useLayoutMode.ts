/**
 * `useLayoutMode` — observa el ancho de la ventana y devuelve el modo de
 * layout que decide `layoutMode.ts` (donde vive el porqué de los tres modos).
 *
 * Se suscribe a `resize` y no a un `matchMedia` por umbral porque los umbrales
 * son dos y crecerían con cada breakpoint nuevo; un solo listener que relee el
 * ancho mantiene la decisión en un único lugar puro y testeable.
 */

import { useEffect, useState } from "react";

import { resolveLayoutMode, type LayoutMode } from "./layoutMode.js";

function currentMode(): LayoutMode {
  return resolveLayoutMode(window.innerWidth);
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(currentMode);

  useEffect(() => {
    function onResize(): void {
      // `setState` con el mismo valor no re-renderiza (React lo compara con
      // `Object.is`), así que no hace falta throttlear: un `resize` sostenido
      // dispara este handler muchas veces pero produce a lo sumo dos cambios.
      setMode(currentMode());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return mode;
}
