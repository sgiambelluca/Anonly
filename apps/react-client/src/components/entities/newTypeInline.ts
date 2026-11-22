/**
 * `newTypeInline.ts` — el «Nuevo tipo» en línea del `EntityTypePicker`
 * (`Components.md` §13b.7, ADR-229 §2): valida el nombre mientras se escribe y
 * arma la definición al confirmar.
 *
 * **Pide solo el nombre**: las versiones cortas se arman solas (ADR-219 §2) y se
 * cambian después desde el menú ⋯ del tipo. La validación es la de siempre
 * (`validateUserEntityType`, por `evaluateTypeForm`) y el texto de cada falla
 * sale de la tabla de `UX_Guidelines.md` §11b.16.
 *
 * Puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  userTypeLabel,
  type CountryCode,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

import { buildUserTypeDefinition, evaluateTypeForm } from "../formats/userTypeForm.js";

/** El `id` de la línea de ayuda del contenedor, a la que apunta el campo (§11b.17). */
export const NEW_TYPE_HINT_ID = "new-type-hint";

/** El estado del campo en línea; `null` en el picker es «sin campo» (la celda punteada). */
export interface NewTypeDraft {
  readonly name: string;
  /**
   * «Guardarlo», tildada: al confirmar, el tipo también se guarda para los
   * próximos documentos (ADR-225 §5, precisión del 2026-11-21).
   */
  readonly save?: boolean;
}

/**
 * Un id con forma válida (`user:` + UUID v4) solo para validar mientras se
 * escribe: el de verdad se genera al confirmar.
 */
const PROBE_ID: UserEntityTypeId = "user:00000000-0000-4000-8000-000000000000";

/** Cómo va a reemplazarse el tipo nuevo: `[NUMERO DE AFILIADO 01]`; vacío sin nombre. */
export function previewOfNewType(draft: NewTypeDraft): string {
  const label = userTypeLabel(draft.name);
  return label === "" ? "" : `[${label} 01]`;
}

export interface NewTypeEvaluation {
  /** El texto de la línea de pie del contenedor; `null` si no hay error que mostrar. */
  readonly error: string | null;
  /** El botón principal se puede apretar: nombre válido. */
  readonly canSubmit: boolean;
  /** Cómo va a reemplazarse: `[NUMERO DE AFILIADO 01]`; vacío sin nombre. */
  readonly preview: string;
}

export function evaluateNewType(
  draft: NewTypeDraft,
  existing: ReadonlyArray<UserEntityTypeDefinition>,
  country: CountryCode,
): NewTypeEvaluation {
  const result = evaluateTypeForm(
    PROBE_ID,
    { name: draft.name, level1: "", level2: "" },
    existing,
    country,
  );
  return {
    error: result.slot.kind === "error" ? result.slot.text : null,
    canSubmit: result.canSubmit,
    preview: previewOfNewType(draft),
  };
}

/** La definición con un id nuevo, para confirmar «Crear y agregar» / «Crear y cambiar». */
export function createNewTypeDefinition(
  draft: NewTypeDraft,
  newId: () => string = () => crypto.randomUUID(),
): UserEntityTypeDefinition {
  return buildUserTypeDefinition(`user:${newId()}`, {
    name: draft.name,
    level1: "",
    level2: "",
  });
}

/** El texto del botón principal del contenedor (`Components.md` §13b.7). */
export function confirmLabel(
  base: string,
  creating: boolean,
  createVerb: "agregar" | "cambiar",
): string {
  return creating ? `Crear y ${createVerb}` : base;
}
