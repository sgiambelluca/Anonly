/**
 * `EntityTypePicker` — el selector de tipo único de la app (ADR-169 §7,
 * `Components.md` §8.10; ADR-229 §2, `Components.md` §13b.7).
 *
 * Reemplaza al `Select` de tipo y a los chips sueltos en cuatro lugares: la
 * selección sobre el original, la lupa, "Agregar entidad" y "Cambiar tipo".
 *
 * - **«Tipos del catálogo»**: los **doce** tipos base, cada uno con su punto de
 *   color (`Custom` ya no se ofrece, ADR-224 §6).
 * - **«Tus tipos»**: los propios, guardados y del documento. El del documento
 *   lleva el punto punteado y un `title` («Solo en este documento: no se
 *   guarda»). **Sin tipos propios, el cuadro no se monta.**
 * - **«Nuevo tipo» en línea**: una celda punteada al final de «Tus tipos», o una
 *   fila punteada bajo el catálogo si no hay tipos propios. Al activarla se
 *   convierte en un campo de nombre con la vista previa de cómo se reemplaza y
 *   una X para descartar. La celda y el campo ocupan **toda la fila** y miden lo
 *   mismo: activarla no cambia el alto del selector (`UX_Guidelines.md` §11b.8).
 *
 * `role="radiogroup"` + `role="radio"` con `aria-checked`. Las flechas mueven la
 * elección entre los tipos (patrón WAI-ARIA de radio group): un solo tab stop, el
 * del elegido. «Nuevo tipo» se alcanza con `Tab`; las flechas no lo activan.
 *
 * **El contenedor decide el botón** («Crear y agregar» / «Crear y cambiar») y
 * muestra el error de nombre en su línea de pie (`newTypeError` solo marca el
 * campo como inválido). El selector no crea nada: `onNewTypeChange` entrega el
 * borrador y el contenedor lo confirma.
 */

import type { EntityTypeId } from "@anonly/anonymization-core";
import { PlusIcon, XIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { Checkbox } from "../common/Checkbox.js";

import {
  DOCUMENT_ONLY_TOOLTIP,
  NEW_TYPE_BAND_LABEL,
  NEW_TYPE_SAVE_LABEL,
  NEW_TYPE_SAVE_TITLE,
  SAVED_TYPE_TOOLTIP,
} from "./documentTypeCopy.js";
import { PICKER_TYPE_ORDER, typeSingular } from "./entityTypeLabels.js";
import { NEW_TYPE_HINT_ID, previewOfNewType, type NewTypeDraft } from "./newTypeInline.js";
import { TypeDot } from "./TypeDot.js";
import { userTypeDefinitions, type KnownUserType } from "./userTypes.js";

export interface EntityTypePickerProps {
  readonly value: EntityTypeId | "new";
  readonly onChange: (type: EntityTypeId) => void;
  /** Tipo vigente: se muestra marcado "Actual" y no se puede elegir (`ChangeTypeDialog`). */
  readonly current?: EntityTypeId;
  /** Dos columnas en globos, tres en diálogos (`Components.md` §8.10). */
  readonly columns?: 2 | 3;
  /** Los tipos propios, con su marca de «solo de este documento». */
  readonly userTypes?: ReadonlyArray<KnownUserType>;
  /** El campo de «Nuevo tipo»; `null` = la celda punteada. */
  readonly newType?: NewTypeDraft | null;
  /** Activa (`{ name: "" }`), escribe o descarta (`null`) el tipo nuevo. */
  readonly onNewTypeChange?: (draft: NewTypeDraft | null) => void;
  /** El error del nombre, para marcar el campo; el texto lo muestra el contenedor. */
  readonly newTypeError?: string | null;
  /** Enter dentro del campo del nombre: confirmar, como el botón principal. */
  readonly onNewTypeSubmit?: () => void;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
}

const COLUMNS_CLASS: Readonly<Record<2 | 3, string>> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
};

export function EntityTypePicker({
  value,
  onChange,
  current,
  columns = 2,
  userTypes = [],
  newType = null,
  onNewTypeChange,
  newTypeError = null,
  onNewTypeSubmit,
  ...aria
}: EntityTypePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const offersNew = onNewTypeChange !== undefined;
  const definitions = userTypeDefinitions(userTypes);
  const selectable: ReadonlyArray<EntityTypeId> = [
    ...PICKER_TYPE_ORDER,
    ...userTypes.map((entry) => entry.definition.id),
  ].filter((type) => type !== current);
  // Un solo tab stop: el elegido, o el primero elegible si todavía no hay uno.
  const focusType = value !== "new" && selectable.includes(value) ? value : selectable[0];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Dentro del campo del nombre (y su casilla «Guardarlo») las flechas no mueven la elección.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-new-type="field"]') !== null
    ) {
      return;
    }
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = value === "new" ? -1 : selectable.indexOf(value);
    const next = selectable[(index + step + selectable.length) % selectable.length];
    if (next === undefined) return;
    onChange(next);
    containerRef.current?.querySelector<HTMLButtonElement>(`[data-entity-type="${next}"]`)?.focus();
  }

  function cell(type: EntityTypeId, documentOnly: boolean, saved = false) {
    const isCurrent = type === current;
    const checked = type === value && !isCurrent;
    return (
      <button
        key={type}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-disabled={isCurrent}
        disabled={isCurrent}
        data-entity-type={type}
        tabIndex={type === focusType ? 0 : -1}
        {...(documentOnly
          ? { title: DOCUMENT_ONLY_TOOLTIP }
          : saved
            ? { title: SAVED_TYPE_TOOLTIP }
            : {})}
        onClick={() => {
          if (!isCurrent) onChange(type);
        }}
        className={`flex h-8 min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          checked
            ? "border-accent bg-bg-primary font-semibold text-text-primary ring-2 ring-accent/15"
            : isCurrent
              ? "cursor-default border-transparent text-text-secondary"
              : "border-transparent text-text-primary hover:border-border hover:bg-bg-primary"
        }`}
      >
        <TypeDot type={type} documentOnly={documentOnly} />
        <span className="min-w-0 flex-1 truncate">{typeSingular(type, definitions)}</span>
        {isCurrent ? (
          <span className="shrink-0 text-sm text-text-secondary">Actual</span>
        ) : (
          <span
            aria-hidden
            className={`h-3.5 w-3.5 shrink-0 rounded-full ${
              // `text-secondary`: el círculo vacío tiene que verse (3:1, `Components.md` §8.4).
              checked ? "border-4 border-accent" : "border-[1.5px] border-text-secondary/70"
            }`}
          />
        )}
      </button>
    );
  }

  const newTypeSlot = !offersNew ? null : newType === null ? (
    <button
      type="button"
      data-new-type="cell"
      onClick={() => onNewTypeChange({ name: "" })}
      className="col-span-full flex h-8 min-w-0 items-center gap-2 rounded-md border border-dashed border-border-strong px-2 text-left text-sm font-medium text-accent hover:bg-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <PlusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {NEW_TYPE_BAND_LABEL}
    </button>
  ) : (
    <div
      data-new-type="field"
      className={`col-span-full flex h-8 min-w-0 items-center gap-2 rounded-md border border-dashed bg-bg-primary px-2 text-sm ${
        newTypeError !== null ? "border-error" : "border-accent"
      }`}
    >
      <input
        type="text"
        value={newType.name}
        autoFocus
        autoComplete="off"
        placeholder="Nombre del tipo"
        aria-label="Nombre del tipo nuevo"
        aria-invalid={newTypeError !== null}
        aria-describedby={NEW_TYPE_HINT_ID}
        onChange={(event) => onNewTypeChange({ ...newType, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onNewTypeSubmit?.();
          } else if (event.key === "Escape") {
            // Descarta el campo, no el diálogo que lo contiene.
            event.preventDefault();
            event.stopPropagation();
            onNewTypeChange(null);
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent text-text-primary outline-none placeholder:text-text-secondary"
      />
      <span
        aria-live="polite"
        title="Así se va a reemplazar"
        className="min-w-0 max-w-[35%] shrink truncate font-mono text-text-secondary"
      >
        {previewOfNewType(newType)}
      </span>
      {/* Guardarlo al crearlo, no solo desde el ⋯ (ADR-225 §5, precisión del 2026-11-21). */}
      <span title={NEW_TYPE_SAVE_TITLE} className="flex shrink-0 items-center">
        <Checkbox
          id="new-type-save"
          checked={newType.save === true}
          onCheckedChange={(save) => onNewTypeChange({ ...newType, save })}
          label={<span className="whitespace-nowrap">{NEW_TYPE_SAVE_LABEL}</span>}
        />
      </span>
      <button
        type="button"
        aria-label="Descartar el tipo nuevo"
        onClick={() => onNewTypeChange(null)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );

  const hasUserTypes = userTypes.length > 0;

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      {...(aria["aria-label"] !== undefined ? { "aria-label": aria["aria-label"] } : {})}
      {...(aria["aria-labelledby"] !== undefined
        ? { "aria-labelledby": aria["aria-labelledby"] }
        : {})}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2 rounded-lg border border-border bg-bg-tertiary p-1.5"
    >
      <section aria-label="Tipos del catálogo" className="flex flex-col gap-0.5">
        <h3 className="px-1 text-sm font-semibold text-text-secondary">Tipos del catálogo</h3>
        <div className={`grid gap-0.5 ${COLUMNS_CLASS[columns]}`}>
          {PICKER_TYPE_ORDER.map((type) => cell(type, false))}
          {hasUserTypes ? null : newTypeSlot}
        </div>
      </section>
      {hasUserTypes ? (
        <section aria-label="Tus tipos" className="flex flex-col gap-0.5">
          <h3 className="px-1 text-sm font-semibold text-text-secondary">Tus tipos</h3>
          <div className={`grid gap-0.5 ${COLUMNS_CLASS[columns]}`}>
            {userTypes.map((entry) => cell(entry.definition.id, entry.documentOnly, true))}
            {newTypeSlot}
          </div>
        </section>
      ) : null}
    </div>
  );
}
