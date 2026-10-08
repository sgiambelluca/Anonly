/**
 * `ReleaseNotesMenu` — el botón de versión del pie de `LoadScreen` y el panel
 * de "Novedades" que abre (`ui/Components.md` §2.9b, ADR-216 §1-§2).
 *
 * El botón dice **"Anonly {versión}"**, *"Novedades"* en texto secundario y una
 * flecha. El panel se abre **hacia arriba**, anclado al botón, y no desplaza
 * nada (UX-10): 400 px de ancho y hasta 452 px de alto con scroll interno. Si no
 * entra en el área visible se acota y se desplaza con la regla de ADR-207
 * (`menuPlacement.ts`, la misma de `GroupContextMenu`).
 *
 * Es un **disclosure hecho a mano**, con el criterio de `Components.md` §3.5: el
 * botón lleva `aria-expanded` y `aria-controls`, y el panel es una región con
 * nombre. **No usa `role="menu"` ni `aria-haspopup`**: ese rol promete
 * navegación por flechas y foco gestionado que acá no existen; es un panel de
 * lectura, y se recorre con Tab como cualquier contenido. Las etiquetas
 * (Nuevo / Mejora / Arreglo) se distinguen por su texto y no solo por el color.
 *
 * Cierra con `Escape`, clic afuera, el botón de cierre o el mismo botón de
 * versión. Con `Escape`, el botón de cierre y el botón de versión el foco vuelve
 * al botón de versión; un clic afuera no le roba el foco a lo que se clickeó.
 *
 * **Sin enlaces y sin red** (ADR-216 §2): el contenido es `releaseNotes.ts`,
 * compilado con la interfaz. La lógica pura —orden, "Instalada", fecha larga—
 * está en `releaseNotesView.ts`, con tests.
 */

import { ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { observeMenuLayout, type MenuLayout } from "../entities/menuPlacement.js";

import { RELEASE_NOTES, type ReleaseNoteKind } from "./releaseNotes.js";
import {
  formatReleaseDate,
  isInstalledVersion,
  orderReleaseNotes,
  RELEASE_NOTE_LABEL,
} from "./releaseNotesView.js";

/** Alto máximo del panel (ADR-216 §2). */
const PANEL_MAX_HEIGHT = 452;
/** Separación entre el botón y el panel. */
const PANEL_GAP = 8;

/**
 * Fondo de cada etiqueta; el texto de la etiqueta es lo que la distingue. Las
 * tres llevan el color del texto principal (contraste, `UX_Guidelines.md` §9).
 */
const KIND_CLASS: Readonly<Record<ReleaseNoteKind, string>> = {
  new: "bg-accent/10",
  improvement: "bg-success/15",
  fix: "bg-bg-tertiary",
};

export interface ReleaseNotesMenuProps {
  /** La versión que corre (`__ANONLY_VERSION__`): la entrada igual lleva "Instalada". */
  readonly installedVersion: string;
}

export function ReleaseNotesMenu({ installedVersion }: ReleaseNotesMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<MenuLayout>({
    placement: "top",
    top: 0,
    maxHeight: 0,
  });
  const panelId = useId();
  const titleId = useId();

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const panel = panelRef.current;
    if (container === null || panel === null) return;
    return observeMenuLayout(
      container,
      panel,
      (next) => {
        setLayout((previous) =>
          previous.placement === next.placement &&
          previous.top === next.top &&
          previous.maxHeight === next.maxHeight
            ? previous
            : next,
        );
      },
      { preferred: "top", maxHeight: PANEL_MAX_HEIGHT, gap: PANEL_GAP },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      // En un evento de mouse del documento, `target` es siempre un `Node`
      // real (narrowing seguro; mismo criterio que `GroupContextMenu`).
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        close(false);
      }
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") close(true);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [open]);

  const entries = orderReleaseNotes(RELEASE_NOTES);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
        className={`group inline-flex min-h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open
            ? "border-accent bg-bg-tertiary ring-2 ring-accent/15"
            : "border-border bg-bg-primary hover:bg-bg-tertiary"
        }`}
      >
        Anonly {installedVersion}
        {/* Texto secundario solo sobre `bg-primary`: sobre `bg-tertiary` no llega a 4.5:1. */}
        <span
          className={`font-normal group-hover:text-text-primary ${
            open ? "text-text-primary" : "text-text-secondary"
          }`}
        >
          Novedades
        </span>
        <ChevronUpIcon className="h-3.5 w-3.5 text-text-secondary" aria-hidden />
      </button>

      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          aria-labelledby={titleId}
          data-placement={layout.placement}
          style={{ top: `${layout.top}px`, maxHeight: `${layout.maxHeight}px` }}
          className="absolute left-0 z-30 w-[400px] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-bg-primary text-sm text-text-primary shadow-md"
        >
          {/* Fijo arriba mientras el cuerpo scrollea. */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-primary py-2.5 pl-4 pr-2.5">
            <h2 id={titleId} className="text-sm font-semibold text-text-primary">
              Novedades
            </h2>
            <button
              type="button"
              aria-label="Cerrar novedades"
              onClick={() => close(true)}
              className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <XIcon className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="px-4">
            {entries.map((entry) => (
              <div
                key={entry.version}
                className="flex flex-col gap-2.5 border-t border-border py-3.5 first:border-t-0"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-text-primary">{entry.version}</h3>
                  {isInstalledVersion(entry.version, installedVersion) ? (
                    <span className="rounded-md bg-success/15 px-2 py-px text-sm font-semibold text-text-primary">
                      Instalada
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-text-secondary">
                    {formatReleaseDate(entry.date)}
                  </span>
                </div>
                {entry.summary !== undefined ? <p>{entry.summary}</p> : null}
                {entry.notes.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {entry.notes.map((note) => (
                      <li key={`${note.kind}:${note.text}`} className="flex items-start gap-2.5">
                        <span
                          className={`w-[4.5rem] shrink-0 rounded-md py-px text-center text-sm font-semibold text-text-primary ${KIND_CLASS[note.kind]}`}
                        >
                          {RELEASE_NOTE_LABEL[note.kind]}
                        </span>
                        <span>{note.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
