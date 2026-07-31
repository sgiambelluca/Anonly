/**
 * `entityTypeLabels.ts` — etiquetas legibles (es) para `EntityType`, usadas por
 * `EntityTypeGroup`/`EntitiesPanel` (`ui/UX_Guidelines.md` §3: "Personas",
 * "DNI", "Direcciones", etc.). Presentacional puro: el Core no conoce estas
 * cadenas (no están en `core/Contracts.md`, no hace falta que lo estén — es
 * i18n de UI, igual que `settings.store.language`, `ui/React_Client.md` §3.7).
 */

import { EntityType } from "@anonly/anonymization-core";

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
