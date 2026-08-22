/**
 * `TooNarrowScreen` — lo que se ve por debajo del ancho mínimo soportado
 * (`layoutMode.ts`, `ui/UX_Guidelines.md` §2).
 *
 * **Dice que no entra, en vez de acomodar los píxeles hasta que "entre".** Una
 * fila del árbol lleva el nombre de la entidad, su contador, su marca de
 * género y su selector de modo; por debajo de 640 px no entran ni con el visor
 * a pantalla completa. Las alternativas eran encoger la tipografía —contra el
 * piso de 14 px de §9, que esta misma branch acaba de establecer— o esconder
 * el selector de modo, que es la mitad del trabajo.
 *
 * El texto **no** pide "usá una computadora": no se sabe en qué está el
 * usuario, y una ventana angosta en un monitor grande es el caso más probable.
 * Dice qué falta (ancho) y qué se puede hacer al respecto (ensanchar), que es
 * lo único accionable. La app sigue viva atrás: al ensanchar, se vuelve sola
 * al panel de trabajo sin perder el documento ni las ediciones.
 */

import { MoveHorizontalIcon } from "lucide-react";

import { LAYOUT_MIN_SUPPORTED_PX } from "./layoutMode.js";

export function TooNarrowScreen() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
      role="status"
    >
      <MoveHorizontalIcon className="h-10 w-10 text-text-secondary" aria-hidden />
      <div className="flex max-w-xs flex-col gap-2">
        <h1 className="text-base font-medium text-text-primary">
          La ventana es muy angosta para revisar el documento
        </h1>
        <p className="text-sm text-text-secondary">
          Revisar datos sensibles necesita ver la lista y el documento a la vez. Anonly necesita al
          menos {LAYOUT_MIN_SUPPORTED_PX} px de ancho.
        </p>
        <p className="text-sm text-text-secondary">
          Ensanchá la ventana y seguís donde estabas: el documento y los cambios siguen abiertos.
        </p>
      </div>
    </div>
  );
}
