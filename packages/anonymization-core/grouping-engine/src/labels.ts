/**
 * Tablas de formato por `EntityType`, usadas para computar `replacementValue`
 * en modo `placeholder` (escalera de abreviaturas, ADR-057) y `mask`
 * (Grouping_Engine.md §"Algoritmos clave" > "replacementValue por modo";
 * adr/ADR-012-Replacement-Modes.md).
 *
 * `MASK_FORMAT_BY_TYPE` es solo el FALLBACK de `mask` (cuando ningún member
 * del grupo trae `Occurrence.maskFormat`, p.ej. grupos formados solo por
 * NER). La resolución real por grupo — que sí distingue patente vieja de
 * Mercosur — vive en `grouping.engine.ts` (`resolveMaskFormatFromRecords`,
 * ADR-029). El valor de `Plate` acá es el fallback Mercosur (vigente).
 *
 * Escalera de abreviaturas del `placeholder` (ADR-057, Hito 10.5, PR 3):
 * `[<TYPE> <NN>]` deja de ser el único formato del modo `placeholder` y pasa
 * a ser el NIVEL 0 de una escalera de tres (ADR-057 §1-§2). La tabla
 * `LADDER_LABELS` de abajo ratifica y completa la tabla que ADR-012
 * §"Formato para placeholder" solo ejemplificaba parcialmente (4 de 13
 * tipos) — la ambigüedad que este archivo documentaba desde su
 * implementación original queda cerrada por ADR-057 §2.
 *
 * La resolución del label pasa de ser por TIPO a ser por GRUPO
 * (`resolveLabelSet`, ADR-057 §3): es una indirección deliberada, no un
 * acceso directo a la tabla — ADR-060 (Hito 10.6) la usa para considerar
 * `group.personGender` sin reescribir la escalera. `LADDER_LABELS` es
 * privada del módulo: ningún otro código debe leerla directo (grep de
 * control de ADR-057).
 *
 * ADR-060 §3 (Hito 10.6): sobre un grupo `Person` con `personGender`
 * resuelto, `resolveLabelSet` devuelve las filas `MUJER`/`HOMBRE` de la
 * tabla de abajo en vez de `LADDER_LABELS[Person]`. Sobre cualquier otro
 * `type`, o sobre `Person` sin `personGender` (sin determinar), el
 * comportamiento es exactamente el de antes de este ADR — cero ramas
 * nuevas fuera de este único punto de decisión.
 */

import {
  estimateTokenWidth,
  EntityType,
  type EntityGroup,
  type PersonGender,
  type OccurrenceRef,
} from "@anonly/shared";

/**
 * Los tres labels de un `EntityType` (más, desde ADR-060, las dos variantes
 * de género de `Person`) que alimentan la escalera de abreviaturas. Tipo
 * interno de `grouping-engine`: no cruza el boundary del motor y no está en
 * `Contracts.md` (ADR-057 §3).
 */
export interface PlaceholderLabelSet {
  readonly level0: string;
  readonly level1: string;
  readonly level2: string;
}

/**
 * Tabla canónica de los tres niveles por `EntityType` (ADR-057 §2). Las
 * columnas repetidas en DNI/CUIT/IBAN son correctas y deliberadas: acortar
 * una sigla ya corta produce tokens ilegibles a cambio de un carácter — la
 * selección de nivel (`selectAbbreviationLevel`) elige el primero que entra,
 * así que los niveles degenerados se saltean solos sin ninguna rama
 * especial. El nivel 0 es exactamente el `TYPE_LABEL_ES` pre-ADR-057: ningún
 * documento cambia de token salvo donde el token no entraba.
 */
const LADDER_LABELS: Readonly<Record<EntityType, PlaceholderLabelSet>> = {
  [EntityType.Person]: { level0: "PERSONA", level1: "PERS", level2: "PRS" },
  [EntityType.Organization]: { level0: "ORGANIZACION", level1: "ORGA", level2: "ORG" },
  [EntityType.Address]: { level0: "DIRECCION", level1: "DIRE", level2: "DIR" },
  [EntityType.DNI]: { level0: "DNI", level1: "DNI", level2: "DNI" },
  [EntityType.CUIT]: { level0: "CUIT", level1: "CUIT", level2: "CUIT" },
  [EntityType.Phone]: { level0: "TELEFONO", level1: "TELE", level2: "TEL" },
  [EntityType.Email]: { level0: "EMAIL", level1: "MAIL", level2: "EML" },
  [EntityType.IBAN]: { level0: "IBAN", level1: "IBAN", level2: "IBAN" },
  [EntityType.CreditCard]: { level0: "TARJETA", level1: "TARJ", level2: "TRJ" },
  [EntityType.Date]: { level0: "FECHA", level1: "FECH", level2: "FEC" },
  [EntityType.License]: { level0: "MATRICULA", level1: "MATR", level2: "MAT" },
  [EntityType.Plate]: { level0: "PATENTE", level1: "PATE", level2: "PAT" },
  [EntityType.Custom]: { level0: "CUSTOM", level1: "CUST", level2: "CST" },
};

/**
 * Variantes de género de `Person` (ADR-060 §3): mismo formato de tres
 * niveles que `LADDER_LABELS`, con `MUJER` repetido en nivel 0/1 (5
 * caracteres, acortarlo no compra nada legible — igual que DNI/CUIT/IBAN en
 * `LADDER_LABELS`; `selectAbbreviationLevel` los saltea solos, sin rama
 * especial).
 */
const GENDERED_PERSON_LABELS: Readonly<Record<PersonGender, PlaceholderLabelSet>> = {
  f: { level0: "MUJER", level1: "MUJER", level2: "MUJ" },
  m: { level0: "HOMBRE", level1: "HOMB", level2: "HOM" },
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

/** `<NN>` de `[<LABEL> <NN>]`: `indexInType` con padding a 2 dígitos, en los tres niveles. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Resuelve el conjunto de labels de un grupo (ADR-057 §3, ADR-060 §3). Único
 * punto de acceso a `LADDER_LABELS`/`GENDERED_PERSON_LABELS` (grep de
 * control de ADR-057). `personGender` solo se considera sobre `type ===
 * Person`; sobre cualquier otro tipo, o sobre `Person` sin género resuelto
 * (sin determinar, ADR-060 §5), el resultado es el lookup por tipo de
 * siempre — `EntityGroup.personGender` fuera de `Person` se ignora por
 * invariante (`03_Data_Model.md` §9), y acá simplemente nunca se lee.
 */
export function resolveLabelSet(group: EntityGroup): PlaceholderLabelSet {
  if (group.type === EntityType.Person && group.personGender !== undefined) {
    return GENDERED_PERSON_LABELS[group.personGender];
  }
  return LADDER_LABELS[group.type];
}

/** Nivel 0/1: `[<LABEL> <NN>]`; nivel 2: colapsa el separador a guion (`[<CORTO>-<NN>]`). */
function tokenForLevel(labels: PlaceholderLabelSet, level: 0 | 1 | 2, indexInType: number): string {
  const nn = pad2(indexInType);
  if (level === 0) return `[${labels.level0} ${nn}]`;
  if (level === 1) return `[${labels.level1} ${nn}]`;
  return `[${labels.level2}-${nn}]`;
}

/** ¿El token estimado entra en TODOS los bbox de `members`? (ADR-057 §4, peor caso). */
function fitsAllMembers(
  token: string,
  members: ReadonlyArray<Pick<OccurrenceRef, "bbox">>,
): boolean {
  return members.every(
    (member) => estimateTokenWidth(token.length, member.bbox.height) <= member.bbox.width,
  );
}

/**
 * Selección de nivel por el PEOR CASO de todos los `members` del grupo
 * (ADR-057 §4): el primer nivel `[0, 1, 2]` cuyo token estimado entra en
 * TODOS los bbox del grupo; si ninguno cumple, nivel 2. No es una garantía
 * de que entre — el shrink-to-fit del render (ADR-058 §1) es quien resuelve
 * ese caso; acá solo se reduce el problema con una estimación pura
 * (`estimateTokenWidth`, sin canvas — Grouping no lo tiene ni debe tenerlo).
 */
function selectAbbreviationLevel(
  labels: PlaceholderLabelSet,
  indexInType: number,
  members: ReadonlyArray<Pick<OccurrenceRef, "bbox">>,
): 0 | 1 | 2 {
  for (const level of [0, 1, 2] as const) {
    if (fitsAllMembers(tokenForLevel(labels, level, indexInType), members)) return level;
  }
  return 2;
}

/**
 * `replacementValue` del modo `placeholder` para un grupo, en el nivel de
 * abreviatura que corresponda a sus `members` (ADR-057). Lee `type`,
 * `indexInType` y `members` directamente del grupo — el caller (siempre un
 * `InternalGroup`, estructuralmente compatible con `EntityGroup`) ya tiene
 * esos tres campos actualizados en el momento de llamar.
 */
export function buildPlaceholderValue(group: EntityGroup): string {
  const labels = resolveLabelSet(group);
  const level = selectAbbreviationLevel(labels, group.indexInType, group.members);
  return tokenForLevel(labels, level, group.indexInType);
}
