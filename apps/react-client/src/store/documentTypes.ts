/**
 * `documentTypes.ts` — cómo se vuelven a leer los tipos del documento
 * (`React_Client.md` §3.9, ADR-225 §6).
 *
 * El Core no emite eventos por las definiciones de tipo, así que la interfaz las
 * lee después de cada acción que las toca y de cada `undo`/`redo`. Esa lectura
 * tiene una segunda mitad: **un tipo que el usuario guardó durante este
 * documento no se pierde por deshacer**. Si una restauración se lo llevó de la
 * sesión, se vuelve a definir con la definición de `detection.saved.userTypes`
 * (vuelve vacío: sus entidades son del estado que se deshizo).
 *
 * Puro: el acceso al Core entra por `DocumentTypesPort`, que arma
 * `core-adapter` (y que una prueba reemplaza por un fake).
 */

import type { UserEntityTypeDefinition, UserEntityTypeId } from "@anonly/anonymization-core";

export interface DocumentTypesPort {
  /** `orchestrator.getDocumentEntityTypes`, en orden de creación; sin sesión, `[]`. */
  read(): ReadonlyArray<UserEntityTypeDefinition>;
  /** `orchestrator.defineDocumentEntityType`; rechaza (lanza) si el Core lo rechaza. */
  define(definition: UserEntityTypeDefinition): void;
  /** La definición guardada para los próximos documentos (`detection.saved.userTypes`), si existe. */
  savedDefinition(id: UserEntityTypeId): UserEntityTypeDefinition | undefined;
}

/**
 * Lee los tipos del documento y repone los guardados durante el documento que la
 * sesión ya no tiene. Devuelve la lista final.
 */
export function reconcileDocumentTypes(
  port: DocumentTypesPort,
  savedDuringDocument: ReadonlySet<UserEntityTypeId>,
): ReadonlyArray<UserEntityTypeDefinition> {
  const current = port.read();
  if (savedDuringDocument.size === 0) return current;

  const present = new Set(current.map((definition) => definition.id));
  let redefined = false;
  for (const id of savedDuringDocument) {
    if (present.has(id)) continue;
    const definition = port.savedDefinition(id);
    if (definition === undefined) continue;
    try {
      port.define(definition);
      redefined = true;
    } catch {
      // La sesión rechazó la definición (por ejemplo, ya no hay sesión): no hay
      // nada que reponer, y la lectura de abajo dice cómo quedó.
    }
  }
  return redefined ? port.read() : current;
}
