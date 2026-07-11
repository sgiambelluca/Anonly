/**
 * Tablas de formato por `EntityType`, usadas para computar `replacementValue`
 * en modo `placeholder` (`[<TYPE_LABEL> <NN>]`) y `mask` (Grouping_Engine.md
 * §"Algoritmos clave" > "replacementValue por modo"; adr/ADR-012-Replacement-Modes.md).
 *
 * AMBIGÜEDAD DOCUMENTADA (reportada, no bloqueante — ver mensaje final del PR):
 * - `MASK_FORMAT_BY_TYPE`: ADR-012 §"Formato por tipo para mask" da un valor
 *   fijo por tipo para 12 de los 13 EntityType, EXCEPTO Plate, que lista DOS
 *   formatos ("XXX XXX" Mercosur / "XXX XXXX" vieja) sin indicar cuál usa un
 *   grupo (Grouping opera a nivel de EntityType, no conoce qué sub-patrón de
 *   Regex generó cada Occurrence — `Occurrence` no tiene un campo
 *   "patternId"). Se asume "XXX XXX" (Mercosur, formato AR vigente) como
 *   default. Custom es explícitamente "configurable" en el ADR sin mecanismo
 *   de configuración definido en este Hito; se usa "XXXXXXXX" como placeholder
 *   fijo.
 * - `TYPE_LABEL_ES`: ADR-012 §"Formato para placeholder" solo da 4 ejemplos
 *   (DNI, PERSONA, DIRECCION, CUIT) de los 13 valores de `EntityType`; no hay
 *   una tabla completa en Contracts.md, Grouping_Engine.md, Data_Model.md ni
 *   ui/Components.md (que Data_Model.md §10 cita como dueño de "un label
 *   internacionalizable" pero no lo define). Los 9 restantes son una
 *   traducción directa y de bajo riesgo (son solo strings de UI, no afectan
 *   contratos ni seguridad) que debería confirmarse formalmente (ADR o
 *   actualización de ui/Components.md) antes de v1.0.
 */

import { EntityType } from "@anonly/shared";

export const TYPE_LABEL_ES: Readonly<Record<EntityType, string>> = {
  [EntityType.Person]: "PERSONA",
  [EntityType.Organization]: "ORGANIZACION",
  [EntityType.Address]: "DIRECCION",
  [EntityType.DNI]: "DNI",
  [EntityType.CUIT]: "CUIT",
  [EntityType.Phone]: "TELEFONO",
  [EntityType.Email]: "EMAIL",
  [EntityType.IBAN]: "IBAN",
  [EntityType.CreditCard]: "TARJETA",
  [EntityType.Date]: "FECHA",
  [EntityType.License]: "MATRICULA",
  [EntityType.Plate]: "PATENTE",
  [EntityType.Custom]: "CUSTOM",
};

export const MASK_FORMAT_BY_TYPE: Readonly<Record<EntityType, string>> = {
  [EntityType.DNI]: "XX.XXX.XXX",
  [EntityType.CUIT]: "XX-XXXXXXXX-X",
  [EntityType.Phone]: "+XX XXX XXX-XXXX",
  [EntityType.Email]: "xxxx@xxxx.xx",
  [EntityType.IBAN]: "XX00 XXXX XXXX XXXX XXXX",
  [EntityType.CreditCard]: "XXXX XXXX XXXX XXXX",
  [EntityType.Person]: "XXXXX XXXXX",
  [EntityType.Organization]: "XXXXXXXX",
  [EntityType.Address]: "XXXXXX XXX",
  [EntityType.Date]: "XX/XX/XXXX",
  [EntityType.License]: "XX-XXXX-XX",
  // Asunción documentada arriba: variante Mercosur (formato AR vigente).
  [EntityType.Plate]: "XXX XXX",
  [EntityType.Custom]: "XXXXXXXX",
};

/** `<NN>` de `[<TYPE_LABEL> <NN>]`: `indexInType` con padding a 2 dígitos. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildPlaceholderValue(type: EntityType, indexInType: number): string {
  return `[${TYPE_LABEL_ES[type]} ${pad2(indexInType)}]`;
}
