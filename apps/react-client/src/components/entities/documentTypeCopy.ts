/**
 * `documentTypeCopy.ts` — los textos y las cuentas de los tipos del documento
 * (`Components.md` §13b.6, `UX_Guidelines.md` §11b.10, §11b.15).
 *
 * Puro y separado de los componentes: los tests de `apps/react-client` corren en
 * Node sin jsdom.
 */

import {
  userTypeLabel,
  type Conflict,
  type EntityGroup,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

/** La leyenda de la banda de un tipo que vive solo en este documento. */
export const DOCUMENT_ONLY_CAPTION = "solo en este documento";
/** La leyenda de la banda de un tipo del documento que el usuario guardó (ADR-225 §5). */
export const SAVED_CAPTION = "guardado";
/** El `title` del punto punteado del selector (ADR-229 §2). */
export const DOCUMENT_ONLY_TOOLTIP = "Solo en este documento: no se guarda";
/** El `title` del punto de un tipo guardado en el selector. */
export const SAVED_TYPE_TOOLTIP = "Guardado en este equipo";
/** El `title` de la leyenda «guardado» de la banda de un tipo. */
export const SAVED_CAPTION_TOOLTIP =
  "Tipo guardado en este equipo: aparece en los próximos documentos";

/** El pie del selector con «Nuevo tipo» elegido y sin error (Cambiar tipo). */
export const NEW_TYPE_CHANGE_FOOTNOTE = "Después lo editás o lo guardás desde ⋯ en el panel.";
/** El pie de «Agregar entidad» con «Nuevo tipo» elegido y sin error. */
export const NEW_TYPE_ADD_FOOTNOTE = `Tipo nuevo, solo de este documento. ${NEW_TYPE_CHANGE_FOOTNOTE}`;
/** El mismo pie con «Guardarlo» tildada (ADR-225 §5, precisión del 2026-11-21). */
export const NEW_TYPE_SAVED_FOOTNOTE = "Tipo nuevo: queda guardado para los próximos documentos.";
/** El texto de la casilla del campo «Nuevo tipo», y su `title`. */
export const NEW_TYPE_SAVE_LABEL = "Guardarlo";
export const NEW_TYPE_SAVE_TITLE = "Guardarlo también para los próximos documentos";

export const EMPTY_TYPE_TEXT =
  "Todavía no tiene entidades. Seleccioná el texto en el PDF o agregalo desde acá.";
export const EMPTY_TYPE_ACTION = "Agregar entidad";

export const NEW_TYPE_BAND_LABEL = "Nuevo tipo";
export const NEW_TYPE_BAND_HINT = "Un tipo solo de este documento";

export const MENU_EDIT_LABEL = "Editar nombre y abreviaturas…";
export const MENU_SAVE_LABEL = "Guardar para los próximos documentos";
export const MENU_DELETE_LABEL = "Borrar tipo…";

/** Lo que dice el aviso de «Entidades libres y descubiertas» (`UX_Guidelines.md` §11b.10). */
export const FREED_ENTITIES_LEAD = "Sus entidades quedan libres y descubiertas.";
export const FREED_ENTITIES_REST =
  "Dejan de tener tipo y de ocultarse: se van a ver tal cual en el documento y en la copia que exportes.";
export const FREED_ENTITIES_WARNING = `${FREED_ENTITIES_LEAD} ${FREED_ENTITIES_REST}`;
/** Sugerencia que acompaña al aviso (ADR-225 §4: «sugiere cambiarles el tipo antes»). */
export const CHANGE_TYPE_FIRST_HINT = "Si querés seguir ocultándolas, cambiales el tipo antes.";

/** La línea bajo el título de «Borrar tipo…»: cuántas entidades y apariciones se pierden. */
export function removeTypeLead(entityCount: number, occurrenceCount: number): string {
  if (entityCount === 0) return "No tiene entidades. Se borra solo de este documento.";
  const entities = entityCount === 1 ? "1 entidad" : `${entityCount} entidades`;
  const occurrences = occurrenceCount === 1 ? "1 aparición" : `${occurrenceCount} apariciones`;
  return `Tiene ${entities} con ${occurrences}.`;
}

export function removeTypeTitle(name: string): string {
  return `¿Borrar el tipo «${name}»?`;
}

/** «Borrar tipo y entidad(es)»; un tipo vacío no tiene entidades que nombrar. */
export function removeTypeConfirmLabel(entityCount: number): string {
  if (entityCount === 0) return "Borrar tipo";
  return entityCount === 1 ? "Borrar tipo y entidad" : "Borrar tipo y entidades";
}

/**
 * Cuántos choques sin resolver tocan al tipo (`UX_Guidelines.md` §11b.10): los
 * conflictos sin resolver de los grupos del tipo y los `heldManual` con un
 * candidato de ese tipo. Se cuenta desde los conflictos del store, sin método
 * nuevo del Core.
 */
export function unresolvedConflictCount(
  conflicts: ReadonlyArray<Conflict>,
  groups: ReadonlyArray<EntityGroup>,
  typeId: UserEntityTypeId,
): number {
  const groupIds = new Set(groups.map((group) => group.id));
  return conflicts.filter(
    (conflict) =>
      !conflict.resolved &&
      (groupIds.has(conflict.groupId) ||
        (conflict.heldManual === true &&
          conflict.candidates.some((candidate) => candidate.entityType === typeId))),
  ).length;
}

/** El aviso de choques de `UX_Guidelines.md` §11b.10, con «choque(s)» en singular o plural. */
export function unresolvedConflictsWarning(count: number): string {
  const noun = count === 1 ? "choque sin resolver" : "choques sin resolver";
  return `Hay ${String(count)} ${noun} con entidades de este tipo. Si borrás el tipo, esas entidades también se borran y sus choques se descartan: queda lo que se detectó. Conviene resolver los choques antes de borrar.`;
}

/** Las apariciones de una entidad de la lista del diálogo: «3 apariciones». */
export function occurrencesLabel(count: number): string {
  return count === 1 ? "1 aparición" : `${String(count)} apariciones`;
}

// ─── Avisos de las acciones ─────────────────────────────────────────────────

export function createdTypeToast(name: string): string {
  return `Creaste el tipo «${name}»`;
}

export function updatedTypeToast(name: string): string {
  return `Cambiaste el tipo «${name}»`;
}

export function removedTypeToast(name: string): string {
  return `Borraste el tipo «${name}»`;
}

export function savedTypeToast(name: string): string {
  return `«${name}» se guardó para los próximos documentos`;
}

/** El subtítulo del aviso de crear un tipo del documento. */
export const CREATED_TYPE_HINT =
  "Ahora seleccioná en el PDF lo que es de este tipo, o usá «Agregar entidad».";

/** El subtítulo del aviso de guardar un tipo del documento. */
/** El detalle del aviso de creado cuando también se guardó (ADR-225 §5, precisión del 2026-11-21). */
export const CREATED_AND_SAVED_TYPE_HINT =
  "También quedó guardado para los próximos documentos. Ahora seleccioná en el PDF lo que es de este tipo.";

export const SAVED_TYPE_HINT =
  "Va a estar en los próximos documentos. Desde ahora se edita en «Formatos de detección».";

/** El subtítulo del aviso de editar un tipo: cómo se reemplaza ahora (con el primer número). */
export function updatedTypeHint(name: string): string {
  return `Ahora es «${name}» y se reemplaza como [${userTypeLabel(name)} 01].`;
}

/** El subtítulo del aviso de borrar un tipo: qué pasó con sus entidades. */
export function removedTypeHint(values: ReadonlyArray<string>): string {
  if (values.length === 0) return "No tenía entidades.";
  if (values.length === 1) return `«${values[0] ?? ""}» quedó libre y descubierta.`;
  return `${values.length} entidades quedaron libres y descubiertas.`;
}

export const TYPE_ACTION_FAILED_TOAST = "No se pudo aplicar el cambio al tipo.";
