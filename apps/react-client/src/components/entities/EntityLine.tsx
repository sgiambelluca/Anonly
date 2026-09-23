/**
 * `EntityLine` — una entidad en una línea, como la muestran los diálogos de
 * edición (ADR-169 §10): punto de color, nombre, "Persona N.º 03 · 2
 * apariciones" y, si viene, el token.
 */

import type { EntityType } from "@anonly/anonymization-core";
import type { ReactNode } from "react";

import { describeEntityLine } from "./editPreviews.js";
import { ENTITY_TYPE_COLOR } from "./entityTypeColors.js";

/** Una entidad en una línea: punto de color, nombre, "Persona N.º 03 · 2 apariciones" y token. */
export function EntityLine({
  group,
  token,
  aside,
}: {
  readonly group: {
    readonly type: EntityType;
    readonly canonicalValue: string;
    readonly indexInType: number;
    readonly memberCount: number;
  };
  readonly token?: string;
  /** Algo más al final de la línea (p. ej. el aviso de espacio justo). */
  readonly aside?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: ENTITY_TYPE_COLOR[group.type] }}
      />
      <b className="min-w-0 truncate font-semibold text-text-primary">{group.canonicalValue}</b>
      <span className="shrink-0 text-text-secondary">{describeEntityLine(group)}</span>
      {token !== undefined ? (
        <span className="ml-auto max-w-[10rem] shrink-0 truncate rounded-md bg-bg-tertiary px-1.5 py-0.5 font-mono text-text-primary">
          {token}
        </span>
      ) : null}
      {aside}
    </div>
  );
}
