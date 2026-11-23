/**
 * Prototipos de los formatos de la tanda 1, segunda medición (Plan_1.1.1.md §5,
 * «Sobre la medición de la tanda 1» y «Las propuestas técnicas del planificador»).
 * Parten del informe de investigación 2026-11-22 (§1 a §5 y §11) con los cambios
 * que el mantenedor decidió sobre la primera medición.
 *
 * `optional` queda solo para las formas que el mantenedor todavía no decidió
 * (`uy:ci-guion`, `uy:ci-guion-sc`, `cl:phone-mobile-parentesis`). Todo lo demás
 * es lo que el Plan manda llevar a la tanda.
 *
 * Decisiones de prototipo que el informe no fija, anotadas en `note`.
 * Nada acá toca los motores.
 */

import {
  CL_AREA_CODES,
  normalizeDigits,
  normalizePhoneBo,
  normalizePhoneCl,
  normalizePhonePy,
  normalizePhoneUy,
  normalizePyRuc,
  normalizeRut,
  normalizeUpperNoSep,
  validCbu,
  validPyRuc,
  validRut,
  validUyCi,
  validUyRut,
} from "./checks.js";
import { fromPieces, fromRegex } from "./engine.js";
import type { Piece, ProtoFormat } from "./types.js";

const d = (min: number, max = min): Piece => ({ k: "chars", cls: "digit", min, max });
const up = (min: number, max = min): Piece => ({ k: "chars", cls: "upper", min, max });
const t = (value: string): Piece => ({ k: "text", value });
const sp = (chars: string): Piece => ({ k: "sep", chars });
const spo = (chars: string): Piece => ({ k: "sep", chars, optional: true });

const yes = (): boolean => true;

/** Etiquetas de los normalizadores y controles, para la tabla final propuesta. */
const NORM = {
  digits: "solo dígitos",
  rut: "cuerpo-DV (DV en mayúscula, sin puntos ni espacios)",
  upper: "mayúsculas, sin separadores",
  phoneCl: "dígitos con prefijo 56",
  phoneUy: "dígitos con prefijo 598 (sin el 0 inicial)",
  phonePy: "dígitos con prefijo 595 (sin el 0 inicial)",
  phoneBo: "dígitos con prefijo 591",
  pyRuc: "cuerpo-DV, sin puntos",
  boCi: "número/extensión (extensión en mayúscula, sin puntos)",
} as const;

const PLATE_CONTEXT = ["Patente", "Placa", "Chapa", "Dominio"] as const;
/** Uruguay llama «matrícula» a la patente: es la quinta palabra (duda para el mantenedor). */
const UY_PLATE_CONTEXT = ["Matrícula", ...PLATE_CONTEXT] as const;

// ─── Chile ───

const clAreaAlt = (): string => {
  const byTens = new Map<string, string[]>();
  for (const c of CL_AREA_CODES) {
    byTens.set(c[0] ?? "", [...(byTens.get(c[0] ?? "") ?? []), c[1] ?? ""]);
  }
  return [...byTens.entries()].map(([tens, units]) => `${tens}[${units.join("")}]`).join("|");
};

/** Las 18 letras de la patente chilena de 4 letras (sin fuente primaria, informe §11.7). */
const CL_PLATE_LETTERS = "BCDFGHJKLPRSTVWXYZ";

export function chileFormats(): ProtoFormat[] {
  const base = { country: "CL" } as const;
  return [
    fromRegex({
      ...base,
      id: "cl:rut",
      entityType: "DNI",
      source: "\\d{1,2}\\.?\\d{3}\\.?\\d{3}-[\\dkK]",
      normalize: normalizeRut,
      normalizerName: NORM.rut,
      control: validRut,
      controlName: "dígito verificador, módulo 11",
      maskFormat: "XX.XXX.XXX-X",
      note: "Informe §1.2: patrón con guion + dígito verificador módulo 11. Bajo DNI («RUT»), decisión del mantenedor.",
    }),
    fromRegex({
      ...base,
      id: "cl:rut-ctx",
      entityType: "DNI",
      source: "\\d{1,2}\\.?\\d{3}\\.?\\d{3}[\\s-]?[\\dkK]",
      normalize: normalizeRut,
      normalizerName: NORM.rut,
      contextBefore: ["RUT", "RUN", "R.U.T.", "R.U.N."],
      maskFormat: "XX.XXX.XXX-X",
      note: "Plan §5: el RUT sin guion (`123456785`, `12.345.678 5`) entra solo con RUT o RUN antes, y sin verificador, de modo que cubre también el DV mal tipeado. Unifica `cl:rut-singuion` y la `cl:rut-ctx` de la primera medición: tenían el mismo contexto y el mismo tipo; solo diferían en llevar o no el guion.",
    }),
    fromPieces({
      ...base,
      id: "cl:phone-mobile",
      entityType: "PHONE",
      variants: [
        [t("+56"), spo(" -"), t("9"), spo(" -"), d(4), spo(" -"), d(4)],
        [t("56"), sp(" -"), t("9"), spo(" -"), d(4), spo(" -"), d(4)],
        [t("9"), sp(" -"), d(4), sp(" -"), d(4)],
        [t("9"), sp(" -"), d(8)],
      ],
      normalize: normalizePhoneCl,
      normalizerName: NORM.phoneCl,
      maskFormat: "+XX X XXXX XXXX",
      note: "Informe §1.3: las cuatro variantes de piezas. Es `structure`.",
    }),
    fromPieces({
      ...base,
      id: "cl:phone-mobile-parentesis",
      entityType: "PHONE",
      optional: true,
      variants: [[t("(+56)"), spo(" -"), t("9"), spo(" -"), d(4), spo(" -"), d(4)]],
      normalize: normalizePhoneCl,
      normalizerName: NORM.phoneCl,
      maskFormat: "(+XX) X XXXX XXXX",
      note: "Informe §1.3: `(+56)` no es separador; se agrega como `text`. Sin confirmar si se quiere (el Plan no la decide).",
    }),
    fromPieces({
      ...base,
      id: "cl:phone-mobile-ctx",
      entityType: "PHONE",
      variants: [[t("9"), d(8)]],
      contextBefore: ["Teléfono", "Tel.", "Fono", "Celular", "Cel."],
      normalize: normalizePhoneCl,
      normalizerName: NORM.phoneCl,
      maskFormat: "X XXXX XXXX",
      note: "Plan §5: el celular sin prefijo (`987654321`) entra solo con una palabra de teléfono antes. Reemplaza a `cl:phone-mobile-pelado` (sin contexto, que sale) y a su `-ctx` de 10 palabras (recortada a 5).",
    }),
    fromRegex({
      ...base,
      id: "cl:phone-landline",
      entityType: "PHONE",
      source:
        "(?:\\+?56[\\s-]?)?(?:\\(0?2\\)|2)[\\s-]?\\d[\\s-]?\\d{3}[\\s-]?\\d{4}" +
        `|(?:\\+?56[\\s-]?)?\\(?(?:${clAreaAlt()})\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}`,
      normalize: normalizePhoneCl,
      normalizerName: NORM.phoneCl,
      control: yes,
      controlName: "lista de 23 códigos de zona (Subtel 2006) y Santiago `2`",
      maskFormat: "+XX X XXXX XXXX",
      note: "Plan §5: Santiago es `2` más 8 cifras, agrupadas 1+3+4 (por eso `29 345 6789` se detecta); los códigos de zona son los 23 de la lista de Subtel, que incluye `6[13457]` (61, 63, 64, 65 y 67; el informe lo trae como `6[1345 7]`, con un espacio). El Plan llama «celular» a ese prefijo `6[13457]`, pero los celulares chilenos empiezan en 9 y `6[13457]` son códigos de zona fijos: duda anotada. Separadores opcionales entre grupos.",
    }),
    fromRegex({
      ...base,
      id: "cl:plate-4l2d",
      entityType: "PLATE",
      source: `[${CL_PLATE_LETTERS}]{4}[\\s.-]?\\d{2}|[${CL_PLATE_LETTERS}]{2}\\.[${CL_PLATE_LETTERS}]{2}\\.\\d{2}`,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      control: yes,
      controlName: "lista de 18 letras (sin fuente primaria)",
      maskFormat: "XXXX-XX",
      note: "Informe §1.4 y Plan §5: 4 letras de la lista de 18 + 2 dígitos, se tapa siempre; suma la grafía con puntos `BC.DF.12`. La lista de letras no tiene fuente primaria.",
    }),
    fromPieces({
      ...base,
      id: "cl:plate-4l2d-ctx",
      entityType: "PLATE",
      variants: [
        [up(4), spo(" -."), d(2)],
        [up(2), sp("."), up(2), sp("."), d(2)],
      ],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXXX-XX",
      note: "Plan §5: con otras letras que las de la lista (la forma `lax` de la primera medición), solo con palabra de patente antes. Con las letras de la lista la tapa también `cl:plate-4l2d`, sin contexto.",
    }),
    fromPieces({
      ...base,
      id: "cl:plate-2l4d",
      entityType: "PLATE",
      variants: [
        [up(2), spo(" -."), d(4)],
        [up(2), spo(" -."), d(2), sp(" -."), d(2)],
      ],
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XX-XXXX",
      note: "Informe §1.4: autos 1985-2007, siguen circulando. 0 falsos positivos: no cambia.",
    }),
    fromPieces({
      ...base,
      id: "cl:plate-moto-3l2d",
      entityType: "PLATE",
      variants: [[up(3), spo(" -"), d(2)]],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX-XX",
      note: "Informe §1.4: motos desde 2014. Plan §5: exige palabra de patente antes (daba 10 de 54 falsos positivos). El separador ` -` es mi elección (el informe dice `sep?`).",
    }),
    fromPieces({
      ...base,
      id: "cl:plate-moto-2l3d",
      entityType: "PLATE",
      variants: [[up(2), spo(" -."), d(3)]],
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XX-XXX",
      note: "Informe §1.4: motos hasta 2014. 0 falsos positivos en el corpus normal (1 en las copias en mayúsculas): el Plan no la cambia.",
    }),
  ];
}

// ─── Uruguay ───

const UY_PHONE_PREFIX = "(?:\\(?(?:\\+|00)?598\\)?[\\s-]?)";

export function uruguayFormats(): ProtoFormat[] {
  const base = { country: "UY" } as const;
  return [
    fromRegex({
      ...base,
      id: "uy:ci",
      entityType: "DNI",
      source: "\\d\\.\\d{3}\\.\\d{3}-\\d|(?<!\\d\\.)\\d{3}\\.\\d{3}-\\d",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "X.XXX.XXX-X",
      note: "Plan §5: escrita con puntos y guion se tapa siempre, pase o no el verificador (sin control). La de 6 dígitos no empieza justo después de un dígito y un punto (`12.345.678-2` no deja un tramo).",
    }),
    fromRegex({
      ...base,
      id: "uy:ci-digitos",
      entityType: "DNI",
      source: "\\d{7,8}",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      control: validUyCi,
      controlName: "dígito verificador de python-stdnum (sin fuente oficial)",
      maskFormat: "XXXXXXXX",
      note: "Plan §5: solo dígitos (cuerpo de 6 o 7 + DV), solo si pasa el verificador de python-stdnum. Queda como estaba.",
    }),
    fromRegex({
      ...base,
      id: "uy:ci-guion",
      entityType: "DNI",
      optional: true,
      source: "\\d{6,7}-\\d",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      control: validUyCi,
      controlName: "dígito verificador de python-stdnum (sin fuente oficial)",
      maskFormat: "XXXXXXX-X",
      note: "Forma intermedia (guion sin puntos), con verificador. El Plan §5 no la decide: sigue como opcional.",
    }),
    fromRegex({
      ...base,
      id: "uy:ci-guion-sc",
      entityType: "DNI",
      optional: true,
      replaces: "uy:ci-guion",
      source: "\\d{6,7}-\\d",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "XXXXXXX-X",
      note: "La misma forma intermedia, sin verificador (se tapa siempre). El Plan §5 no la decide.",
    }),
    fromRegex({
      ...base,
      id: "uy:ci-sindv-ctx",
      entityType: "DNI",
      source: "\\d\\.\\d{3}\\.\\d{3}|(?<!\\d\\.)\\d{3}\\.\\d{3}",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      contextBefore: ["CI", "C.I.", "Cédula", "Cédula de identidad", "Documento"],
      maskFormat: "X.XXX.XXX",
      note: "Plan §5: la CI sin DV, con puntos, solo con una palabra de documento antes (la forma sin contexto sale). Recortada de 7 a 5 palabras (salen `Doc.` y `C.I. N°`). La de 6 dígitos no empieza justo después de un dígito y un punto.",
    }),
    fromRegex({
      ...base,
      id: "uy:rut",
      entityType: "CUIT",
      source: "\\d{12}",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      control: validUyRut,
      controlName: "dígito verificador módulo 11 (sin fuente oficial), serie 01-22, tipo 001",
      maskFormat: "XXXXXXXXXXXX",
      note: "Informe §2.3 / Plan §5: 12 dígitos seguidos, solo si pasa el verificador (serie 01-22, tipo 001). Sin fuente oficial.",
    }),
    fromRegex({
      ...base,
      id: "uy:rut-separado",
      entityType: "CUIT",
      source: "\\d{2}[\\s.-]\\d{6}[\\s.-]001[\\s.-]\\d",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "XXXXXXXXXXXX",
      note: "Plan §5: escrito con separadores se tapa siempre (sin control). El Plan dice «puntos y guion»; acepto también el espacio del informe (`21 234567 001 5`).",
    }),
    fromRegex({
      ...base,
      id: "uy:phone-mobile",
      entityType: "PHONE",
      source: `${UY_PHONE_PREFIX}0?9[1-9][\\s-]?\\d{3}[\\s-]?\\d{3}|09[1-9][\\s-]?\\d{3}[\\s-]?\\d{3}`,
      normalize: normalizePhoneUy,
      normalizerName: NORM.phoneUy,
      control: yes,
      controlName: "prefijos 091-099 (patrón)",
      maskFormat: "0XX XXX XXX",
      note: "Informe §2.4: prefijos 091-099; sin prefijo de país se exige el 0 inicial. Acepta `+598 099 …` (error común).",
    }),
    fromRegex({
      ...base,
      id: "uy:phone-landline",
      entityType: "PHONE",
      source:
        `${UY_PHONE_PREFIX}\\(?[24]\\d{3}\\)?[\\s-]?\\d{4}` +
        "|[24]\\d{3}[\\s-]\\d{4}|[24]\\d{3}[\\s-]\\d{2}[\\s-]\\d{2}|[24][\\s-]\\d{3}[\\s-]\\d{4}" +
        "|\\(0?2\\)[\\s-]?\\d{3}[\\s-]?\\d{4}",
      normalize: normalizePhoneUy,
      normalizerName: NORM.phoneUy,
      control: yes,
      controlName: "primer dígito 2 o 4 (patrón)",
      maskFormat: "XXXX XXXX",
      note: "Informe §2.4: sin prefijo de país exige al menos un separador (choque con la CI de 8 dígitos). Plan §5: la forma de 8 dígitos pegados no entra.",
    }),
    fromPieces({
      ...base,
      id: "uy:plate",
      entityType: "PLATE",
      variants: [[up(3), spo(" -"), d(4)]],
      contextBefore: UY_PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXXX",
      note: "Informe §2.5: 3 letras + 4 dígitos. Plan §5: exige palabra de patente antes (daba 1 falso positivo). «Matrícula» es mía: Uruguay las llama así.",
    }),
    fromPieces({
      ...base,
      id: "uy:plate-moto",
      entityType: "PLATE",
      variants: [[up(3), spo(" -"), d(3)]],
      contextBefore: UY_PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXX",
      note: "Informe §2.5: idéntica a `plate-vieja-ar`. Plan §5: exige palabra de patente antes (daba 2 falsos positivos). Con el mismo contexto y el mismo tipo que `uy:plate`, solo difiere en 3 dígitos en lugar de 4 (y en la máscara).",
    }),
    fromPieces({
      ...base,
      id: "uy:account-brou",
      entityType: "BANK_ACCOUNT",
      variants: [[d(9), sp("-"), d(5)]],
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "XXXXXXXXX-XXXXX",
      note: "Informe §2.6: solo BROU, 9 + guion + 5. Las fuentes del BROU no son coherentes entre sí.",
    }),
  ];
}

// ─── Paraguay ───

const PY_CI_CONTEXT = ["C.I.", "CI", "CIC", "Cédula", "Cédula de identidad"] as const;

export function paraguayFormats(): ProtoFormat[] {
  const base = { country: "PY" } as const;
  return [
    fromPieces({
      ...base,
      id: "py:ci",
      entityType: "DNI",
      variants: [
        [d(1), sp("."), d(3), sp("."), d(3)],
        [d(3), sp("."), d(3)],
      ],
      contextBefore: PY_CI_CONTEXT,
      notAfter: /\d\.$/,
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "X.XXX.XXX",
      note: "Informe §3.2 y Plan §5: con puntos obligatorios, y solo con una palabra de cédula antes («Nº» sale de la lista). Misma forma que `dni-ar` de 7 dígitos. No empieza justo después de un dígito y un punto (para las dos variantes; el Plan lo dice de la de 6 dígitos).",
    }),
    fromPieces({
      ...base,
      id: "py:ci-ctx",
      entityType: "DNI",
      variants: [[d(5, 8)]],
      contextBefore: PY_CI_CONTEXT,
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      maskFormat: "XXXXXXX",
      note: "Informe §3.2: 5 a 8 dígitos pelados, con una palabra de cédula antes («Nº», «C.I. N°» y «C.I.C.» salen; entra «Cédula de identidad», que son 5 palabras). Tiene el mismo contexto que `py:ci`: podrían ser un solo formato con tres variantes.",
    }),
    fromRegex({
      ...base,
      id: "py:ruc",
      entityType: "CUIT",
      source: "\\d{1,2}\\.?\\d{3}\\.?\\d{3}-\\d|\\d{5,8}-\\d",
      normalize: normalizePyRuc,
      normalizerName: NORM.pyRuc,
      control: validPyRuc,
      controlName: "dígito verificador módulo 11 de la DNIT (el algoritmo manda)",
      maskFormat: "XXXXXXXX-X",
      note: "Informe §3.3: cuerpo + guion + DV (módulo 11 de DNIT). Plan §5: el algoritmo manda; los dos ejemplos del informe que no cerraban (`80012345-7` y `2345678-0`) se corrigieron en `lib/examples.ts` (`80012345-0` y `2345678-7`).",
    }),
    fromRegex({
      ...base,
      id: "py:phone-mobile",
      entityType: "PHONE",
      source:
        "(?:(?:\\+|00)?595[\\s-]?\\(?0?9\\d{2}\\)?|\\(?09\\d{2}\\)?)[\\s-]?\\d{3}[\\s-]?\\d{3}",
      normalize: normalizePhonePy,
      normalizerName: NORM.phonePy,
      control: yes,
      controlName: "prefijo 09XX (patrón)",
      maskFormat: "09XX XXX XXX",
      note: "Informe §3.4 y §11.8: `9` + 8 cifras; sin prefijo de país se exige el 0.",
    }),
    fromRegex({
      ...base,
      id: "py:phone-landline",
      entityType: "PHONE",
      source: "(?:(?:\\+|00)?595[\\s-]?\\(?0?|\\(?0)[2-8]\\d{1,2}\\)?[\\s-]?\\d{3}[\\s-]?\\d{3,4}",
      normalize: normalizePhonePy,
      normalizerName: NORM.phonePy,
      control: yes,
      controlName: "prefijo de país o 0 inicial + código 2-8 (patrón)",
      maskFormat: "0XX XXX XXXX",
      note: "Plan §5: la versión estricta (prefijo de país o 0 inicial, como el celular); la literal del informe §3.4 sale (acertaba el 79 % de los números de 8 y 9 dígitos al azar).",
    }),
    fromPieces({
      ...base,
      id: "py:plate-3l3d",
      entityType: "PLATE",
      variants: [[up(3), spo(" -"), d(3)]],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXX",
      note: "Informe §3.5: 2000-2019. Plan §5: exige palabra de patente antes (daba 6 de 36 falsos positivos).",
    }),
    fromPieces({
      ...base,
      id: "py:plate-moto-3d3l",
      entityType: "PLATE",
      variants: [[d(3), spo(" -"), up(3)]],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXX",
      note: "Informe §3.5: motos 2000-2019. Plan §5: exige palabra de patente antes.",
    }),
    fromPieces({
      ...base,
      id: "py:plate-mercosur",
      entityType: "PLATE",
      variants: [[up(4), spo(" -"), d(3)]],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXXX XXX",
      note: "Informe §3.5: desde 2019. Plan §5: exige palabra de patente antes (daba 3 falsos positivos).",
    }),
    fromPieces({
      ...base,
      id: "py:plate-moto-mercosur",
      entityType: "PLATE",
      variants: [[d(3), spo(" -"), up(4)]],
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXXX",
      note: "Informe §3.5: motos desde 2019. 0 falsos positivos: no cambia.",
    }),
  ];
}

// ─── Bolivia ───

const BO_EXT = ["LP", "SC", "CB", "OR", "PT", "CH", "TJ", "BN", "PD"]
  .map((e) => `${e[0] ?? ""}\\.${e[1] ?? ""}\\.|${e[0] ?? ""}\\.${e[1] ?? ""}|${e}`)
  .join("|");

/** `numero/extension`, extensión en mayúscula y sin puntos. El complemento no se mide (Plan §5). */
export function normalizeBoCi(raw: string): string {
  const m = /^(\d+)[\s-]+([A-Za-z.]+)$/.exec(raw.trim());
  if (m === null) return raw.toUpperCase();
  return `${m[1] ?? ""}/${(m[2] ?? "").replace(/\./g, "").toUpperCase()}`;
}

/** Alternativa para la medición de D-7: solo el número, sin extensión. */
export function normalizeBoCiNumberOnly(raw: string): string {
  const m = /^(\d+)/.exec(raw.trim());
  return m?.[1] ?? raw;
}

const BO_PHONE_PREFIX = "(?:(?:\\+|00)?591[\\s-]?|\\(591\\)[\\s-]?)";

export function boliviaFormats(): ProtoFormat[] {
  const base = { country: "BO" } as const;
  return [
    fromRegex({
      ...base,
      id: "bo:ci-ext",
      entityType: "DNI",
      flags: "iu",
      source: `\\d{6,8}[\\s-]+(?:${BO_EXT})`,
      normalize: normalizeBoCi,
      normalizerName: NORM.boCi,
      control: yes,
      controlName: "lista de 9 extensiones departamentales",
      maskFormat: "XXXXXXX XX",
      note: "Informe §4.2: número + extensión de la lista de 9 departamentos, con variantes con puntos. Plan §5: el complemento no se mide (se quitó de la forma); una CI con complemento sale tapada sin él.",
    }),
    fromRegex({
      ...base,
      id: "bo:ci-ctx",
      entityType: "DNI",
      source: "\\d{6,8}",
      flags: "iu",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      contextBefore: ["C.I.", "CI", "Cédula", "Cédula de identidad"],
      maskFormat: "XXXXXXX",
      note: "Informe §4.2: número pelado con una palabra de cédula antes. «Nº» y «C.I. N°» salen de la lista (tapaban números de factura). Sin extensión ni complemento.",
    }),
    fromRegex({
      ...base,
      id: "bo:nit-ctx",
      entityType: "CUIT",
      source: "\\d{5,12}",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      contextBefore: ["NIT", "N.I.T."],
      contextGapWords: 3,
      maskFormat: "XXXXXXXXXX",
      note: "Informe §4.3 y §11.4: hasta 12 dígitos (RND 10-0032-04); mínimo 5 sin confirmar. Plan §5: acepta hasta 3 palabras entre «NIT» y el número (`NIT del emisor: 123…`). Las variantes «Nº NIT» y «N.I.T. N°» ya las cubre el relleno. «En el mismo renglón»: el texto de página del prototipo no tiene saltos de línea, así que el límite de renglón no se ejerce.",
    }),
    fromRegex({
      ...base,
      id: "bo:phone-mobile",
      entityType: "PHONE",
      source: `${BO_PHONE_PREFIX}[67][\\s-]?\\d{3}[\\s-]?\\d{4}|[67]\\d{3}[\\s-]\\d{4}`,
      normalize: normalizePhoneBo,
      normalizerName: NORM.phoneBo,
      control: yes,
      controlName: "primer dígito 6 o 7 (patrón)",
      maskFormat: "XXXX XXXX",
      note: "Informe §4.4: sin prefijo de país exige separador (choque con CI y NIT de 8 dígitos). Plan §5: la forma pegada no entra.",
    }),
    fromRegex({
      ...base,
      id: "bo:phone-landline",
      entityType: "PHONE",
      source: `${BO_PHONE_PREFIX}\\(?[234]\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}|\\(?[234]\\)?[\\s-]\\d{3}[\\s-]?\\d{4}`,
      normalize: normalizePhoneBo,
      normalizerName: NORM.phoneBo,
      control: yes,
      controlName: "código de área 2, 3 o 4 (patrón)",
      maskFormat: "X XXX XXXX",
      note: "Informe §4.4: sin prefijo de país exige separador después del código de área. Plan §5: la forma pegada no entra.",
    }),
    fromPieces({
      ...base,
      id: "bo:plate",
      entityType: "PLATE",
      variants: [[d(3, 4), spo(" -"), up(3)]],
      contextBefore: PLATE_CONTEXT,
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXXX XXX",
      note: "Informe §4.5: 3 o 4 dígitos + 3 letras. Plan §5: exige palabra de patente antes (daba 6 de 38 falsos positivos).",
    }),
  ];
}

// ─── Argentina: tipos nuevos ───

export function argentinaNewFormats(): ProtoFormat[] {
  const base = { country: "AR" } as const;
  return [
    fromRegex({
      ...base,
      id: "ar:cbu",
      entityType: "BANK_ACCOUNT",
      source: "\\d{22}|\\d{8}[\\s-]\\d{14}|\\d{4}(?:[\\s-]\\d{4}){4}[\\s-]\\d{2}",
      normalize: normalizeDigits,
      normalizerName: NORM.digits,
      control: validCbu,
      controlName: "dos dígitos verificadores del BCRA",
      maskFormat: "XXXXXXXXXXXXXXXXXXXXXX",
      note: "Informe §5.1 y §11.6: 22 dígitos, los dos dígitos verificadores del BCRA; un solo formato para CBU y CVU.",
    }),
    fromPieces({
      ...base,
      id: "ar:passport",
      entityType: "PASSPORT",
      variants: [[up(3), spo(" -"), d(6)]],
      contextBefore: ["Pasaporte"],
      normalize: normalizeUpperNoSep,
      normalizerName: NORM.upper,
      maskFormat: "XXX XXXXXX",
      note: "Informe §5.3: 3 letras + 6 dígitos (RENAPER). Plan §5: exige «pasaporte» antes (daba 4 de 19 falsos positivos: «NRO/REF/EXP + 6 dígitos»).",
    }),
  ];
}

export function allCountryFormats(): Record<string, ProtoFormat[]> {
  return {
    CL: chileFormats(),
    UY: uruguayFormats(),
    PY: paraguayFormats(),
    BO: boliviaFormats(),
    AR: argentinaNewFormats(),
  };
}
