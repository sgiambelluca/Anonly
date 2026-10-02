/**
 * `entityTypeLabels.ts` — etiquetas legibles (es) para `EntityType`, usadas por
 * `EntityTypeGroup`/`EntitiesPanel` (`ui/UX_Guidelines.md` §3: "Personas",
 * "DNI", "Direcciones", etc.). Presentacional puro: el Core no conoce estas
 * cadenas (no están en `core/Contracts.md`, no hace falta que lo estén — es
 * i18n de UI, igual que `settings.store.language`, `ui/React_Client.md` §3.7).
 */

import { EntityType } from "@anonly/anonymization-core";

import type { SelectOption } from "../common/Select.js";

export const ENTITY_TYPE_LABEL: Readonly<Record<EntityType, string>> = {
  [EntityType.Person]: "Personas",
  [EntityType.Organization]: "Organizaciones",
  [EntityType.Address]: "Direcciones",
  [EntityType.DNI]: "DNI",
  [EntityType.CUIT]: "CUIT",
  [EntityType.Phone]: "Teléfonos",
  [EntityType.Email]: "Emails",
  [EntityType.IBAN]: "IBAN",
  [EntityType.CreditCard]: "Tarjetas de crédito",
  [EntityType.Date]: "Fechas",
  [EntityType.License]: "Matrículas",
  [EntityType.Plate]: "Patentes",
  [EntityType.Custom]: "Personalizado",
};

// Orden fijo de ui/Components.md §3.1. Usado por los selectores de tipo del
// agregado manual (AddEntityDialog, WordSelectionOverlay) — mismo criterio de
// reuso de ENTITY_TYPE_LABEL que ya usa RuleFormFields.tsx.
export const ENTITY_TYPE_OPTIONS: ReadonlyArray<SelectOption<EntityType>> = [
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
  EntityType.DNI,
  EntityType.CUIT,
  EntityType.Phone,
  EntityType.Email,
  EntityType.IBAN,
  EntityType.CreditCard,
  EntityType.Date,
  EntityType.License,
  EntityType.Plate,
  EntityType.Custom,
].map((type) => ({ value: type, label: ENTITY_TYPE_LABEL[type] }));

/**
 * ADR-169 §7: nombre de **una** entidad del tipo — el que usan el selector de
 * tipo (`EntityTypePicker`), la lupa ("oculto como Persona N.º 02") y los
 * toasts ("Persona N.º 06"). `ENTITY_TYPE_LABEL` sigue siendo el plural de las
 * franjas del árbol.
 */
export const ENTITY_TYPE_SINGULAR: Readonly<Record<EntityType, string>> = {
  [EntityType.Person]: "Persona",
  [EntityType.Organization]: "Organización",
  [EntityType.Address]: "Dirección",
  [EntityType.DNI]: "DNI",
  [EntityType.CUIT]: "CUIT",
  [EntityType.Phone]: "Teléfono",
  [EntityType.Email]: "Email",
  [EntityType.IBAN]: "IBAN",
  [EntityType.CreditCard]: "Tarjeta de crédito",
  [EntityType.Date]: "Fecha",
  [EntityType.License]: "Matrícula",
  [EntityType.Plate]: "Patente",
  [EntityType.Custom]: "Otro",
};

/** Los 13 tipos en el orden fijo de `Components.md` §3.1. */
export const ENTITY_TYPE_ORDER: ReadonlyArray<EntityType> = ENTITY_TYPE_OPTIONS.map(
  (option) => option.value,
);

/**
 * ADR-169 §2: el N.º de la lista es `indexInType` con dos dígitos (`04`), el
 * mismo número del token (`[PERSONA 04]`). Con tres o más dígitos se muestra
 * tal cual.
 */
export function formatIndexInType(indexInType: number): string {
  return String(indexInType).padStart(2, "0");
}

/** "Persona N.º 06": cómo se nombra una entidad concreta fuera de la fila. */
export function describeEntityNumber(type: EntityType, indexInType: number): string {
  return `${ENTITY_TYPE_SINGULAR[type]} N.º ${formatIndexInType(indexInType)}`;
}
