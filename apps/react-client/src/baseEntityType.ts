/**
 * Guarda provisional de la 1.1 (F0, Plan_1.1 §7, ADR-219 §1).
 *
 * Los campos que identifican el tipo de una entidad pasaron a `EntityTypeId`,
 * pero las tablas de la interfaz (etiquetas, colores, modos) siguen indexadas
 * por `EntityType`. Un tipo propio todavía no puede llegar: nada lo produce
 * hasta que F4 deje entrar `DetectionConfig` y F7 agregue «Nuevo tipo». Cuando
 * llegue, F7 reemplaza cada uso de esta guarda por el nombre y el color del
 * tipo propio, y la 1.1 sale sin ella.
 */

import { isUserEntityType } from "@anonly/anonymization-core";
import type { EntityType, EntityTypeId } from "@anonly/anonymization-core";

export function toBaseEntityType(type: EntityTypeId): EntityType {
  if (isUserEntityType(type)) {
    throw new Error(
      `Un tipo propio todavía no se puede mostrar en la interfaz (llega con F7): ${type}`,
    );
  }
  return type;
}
