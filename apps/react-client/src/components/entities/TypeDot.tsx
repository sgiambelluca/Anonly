/**
 * `TypeDot` — el punto de un tipo de entidad, **un solo componente** para todos
 * los lugares donde aparece (panel, selector de tipo, tooltip, Formatos,
 * exportar e importar). `Components.md` §9, lienzo `.udot`.
 *
 * Un tipo del catálogo es un círculo relleno con su color. Un tipo propio es un
 * **aro**: círculo de 9 px, sin relleno, borde de 2,2 px del color `--color-user`;
 * si es solo de este documento, el aro va **punteado**. Es decorativo (`aria-hidden`).
 */

import { isUserEntityType, type EntityTypeId } from "@anonly/anonymization-core";
import type { CSSProperties } from "react";

import { USER_DOT_COLOR, typeDotStyle, userDotStyle } from "./entityTypeColors.js";

export interface TypeDotProps {
  readonly type: EntityTypeId;
  /** Un tipo propio que vive solo en este documento: aro punteado. */
  readonly documentOnly?: boolean;
}

/** Un aro de tipo propio, sin conocer el tipo (p. ej. la lista de formatos salteados). */
export interface UserTypeDotProps {
  readonly documentOnly?: boolean;
}

const BASE_CLASS = "inline-block h-[9px] w-[9px] shrink-0 box-border rounded-full";

/** Aro cortado limpio a 9 px: un `border: dashed` del navegador sale con muy pocos trazos. */
function DashedRing() {
  return (
    <svg aria-hidden viewBox="0 0 9 9" className="h-[9px] w-[9px] shrink-0">
      <circle
        cx="4.5"
        cy="4.5"
        r="3.4"
        fill="none"
        stroke={USER_DOT_COLOR}
        strokeWidth="2.2"
        strokeDasharray="2.4 1.6"
      />
    </svg>
  );
}

export function TypeDot({ type, documentOnly = false }: TypeDotProps) {
  if (documentOnly && isUserEntityType(type)) return <DashedRing />;
  return <span aria-hidden className={BASE_CLASS} style={typeDotStyle(type, documentOnly)} />;
}

export function UserTypeDot({ documentOnly = false }: UserTypeDotProps) {
  if (documentOnly) return <DashedRing />;
  const style: CSSProperties = { ...userDotStyle(documentOnly) };
  return <span aria-hidden className={BASE_CLASS} style={style} />;
}
