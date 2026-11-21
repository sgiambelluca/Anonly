/**
 * `documentTypeEdits.ts` — crear, editar, borrar y guardar un tipo del documento
 * como acciones del usuario (`React_Client.md` §3.9, §3.12; ADR-225).
 *
 * Mismo patrón que `applyEdits.ts`: `recordEdit` **antes** de pedirle algo al
 * Core (un punto de restauración que ya incluye las definiciones, ADR-225 §6),
 * los pedidos por `actions` y el aviso con «Deshacer». Guardar un tipo para los
 * próximos documentos **no** es una edición del documento (ADR-225 §5): sin
 * `recordEdit`, y su «Deshacer» no lleva la pista `Ctrl+Z`.
 */

import type { UserEntityTypeDefinition } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { showToast } from "../common/toast.js";

import {
  createdTypeToast,
  CREATED_TYPE_HINT,
  removedTypeHint,
  removedTypeToast,
  savedTypeToast,
  SAVED_TYPE_HINT,
  TYPE_ACTION_FAILED_TOAST,
  updatedTypeHint,
  updatedTypeToast,
} from "./documentTypeCopy.js";
import { discardLastEdit, editToast, recordEdit } from "./editHistory.js";

function failed(recorded: boolean): false {
  if (recorded) discardLastEdit();
  showToast({ title: TYPE_ACTION_FAILED_TOAST, tone: "error" });
  return false;
}

/** «Nuevo tipo» de la banda. Devuelve si el tipo quedó creado. */
export function applyCreateDocumentType(definition: UserEntityTypeDefinition): boolean {
  const title = createdTypeToast(definition.name);
  const recorded = recordEdit(title);
  try {
    actions.defineDocumentType(definition);
  } catch {
    return failed(recorded);
  }
  showToast(editToast({ title, description: CREATED_TYPE_HINT, tone: "success" }, recorded));
  return true;
}

/** «Editar nombre y abreviaturas…». Devuelve si el cambio se aplicó. */
export async function applyUpdateDocumentType(
  definition: UserEntityTypeDefinition,
): Promise<boolean> {
  const title = updatedTypeToast(definition.name);
  const recorded = recordEdit(title);
  try {
    await actions.updateDocumentType(definition);
  } catch {
    return failed(recorded);
  }
  showToast(editToast({ title, description: updatedTypeHint(definition.name) }, recorded));
  return true;
}

/** «Borrar tipo…» ya confirmado. Devuelve si el tipo se borró. */
export async function applyRemoveDocumentType(
  definition: UserEntityTypeDefinition,
): Promise<boolean> {
  const title = removedTypeToast(definition.name);
  const freed = (useEntitiesStore.getState().groupsByType.get(definition.id) ?? []).map(
    (group) => group.canonicalValue,
  );
  const recorded = recordEdit(title);
  try {
    await actions.removeDocumentType(definition.id);
  } catch {
    return failed(recorded);
  }
  showToast(editToast({ title, description: removedTypeHint(freed), tone: "deletion" }, recorded));
  return true;
}

/**
 * «Guardar para los próximos documentos». El aviso trae «Deshacer», que lo quita
 * de lo guardado, y **no** la pista `Ctrl+Z` ni la marca de edición: `Ctrl+Z` no
 * lo alcanza (ADR-225 §5).
 */
export function applySaveDocumentType(definition: UserEntityTypeDefinition): void {
  if (!actions.saveDocumentType(definition.id)) return;
  showToast({
    title: savedTypeToast(definition.name),
    description: SAVED_TYPE_HINT,
    tone: "success",
    actions: [{ label: "Deshacer", run: () => actions.unsaveDocumentType(definition.id) }],
  });
}
