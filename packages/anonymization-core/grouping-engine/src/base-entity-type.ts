/**
 * Guarda provisional de la 1.1 (F0, Plan_1.1 §7, ADR-219 §1).
 *
 * Los campos que identifican el tipo de una entidad pasaron a `EntityTypeId`,
 * pero las tablas de este motor (etiquetas, máscaras, síntesis) siguen
 * indexadas por `EntityType`. Un tipo propio todavía no puede llegar acá: nada
 * lo produce hasta que F4 deje entrar `DetectionConfig` y F7 la UI. Cuando
 * llegue, F3 reemplaza cada uso de esta guarda por la resolución de su spec
 * (etiquetas, máscara y clave de un tipo propio), y la 1.1 sale sin ella.
 *
 * Privada del paquete: no se exporta desde `index.ts`.
 */

import { InvalidInputError, isUserEntityType } from "@anonly/shared";
import type { EntityType, EntityTypeId } from "@anonly/shared";

export function toBaseEntityType(type: EntityTypeId): EntityType {
  if (isUserEntityType(type)) {
    throw new InvalidInputError(
      "grouping-engine: un tipo propio todavía no tiene etiqueta, máscara ni síntesis (llega con F3)",
      { type },
    );
  }
  return type;
}
