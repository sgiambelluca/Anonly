/**
 * Tablas de formato por `EntityType`, usadas para computar `replacementValue`
 * en modo `placeholder` (`[<TYPE_LABEL> <NN>]`) y `mask` (Grouping_Engine.md
 * §"Algoritmos clave" > "replacementValue por modo"; adr/ADR-012-Replacement-Modes.md).
 *
 * `MASK_FORMAT_BY_TYPE` es solo el FALLBACK de `mask` (cuando ningún member
 * del grupo trae `Occurrence.maskFormat`, p.ej. grupos formados solo por
 * NER). La resolución real por grupo — que sí distingue patente vieja de
 * Mercosur — vive en `grouping.engine.ts` (`resolveMaskFormatFromRecords`,
 * ADR-029). El valor de `Plate` acá es el fallback Mercosur (vigente).
 *
 * AMBIGÜEDAD DOCUMENTADA (reportada, no bloqueante — ver mensaje final del PR):
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
  // Fallback Mercosur, vigente desde 2016 (ADR-029 §2). Solo se usa si
  // ningún member del grupo trae `Occurrence.maskFormat`.
  [EntityType.Plate]: "XX XXX XX",
  [EntityType.Custom]: "XXXXXXXX",
};

/** `<NN>` de `[<TYPE_LABEL> <NN>]`: `indexInType` con padding a 2 dígitos. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildPlaceholderValue(type: EntityType, indexInType: number): string {
  return `[${TYPE_LABEL_ES[type]} ${pad2(indexInType)}]`;
}
