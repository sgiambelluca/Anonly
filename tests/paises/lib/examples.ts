/**
 * Los ejemplos «Detectar» y «No detectar» del informe de investigación
 * (2026-11-22), con los cambios de la segunda medición (Plan_1.1.1.md §5): donde
 * el mantenedor decidió algo distinto del informe, el ejemplo sigue la decisión
 * y la familia lo dice en `source`. Todo desacuerdo que queda es una duda para
 * el mantenedor (puede ser un error del informe, uno del prototipo o una
 * decisión posterior del Plan §5).
 *
 * Cambios respecto del informe, familia por familia:
 * - `py:ruc`: los dos ejemplos que no cerraban con el algoritmo se corrigieron
 *   (`80012345-7` → `80012345-0`, `2345678-0` → `2345678-7`).
 * - `cl:phone-landline`: `29 345 6789` pasa de «no detectar» a «detectar»
 *   (Santiago es `2` más 8 cifras).
 * - patentes y pasaporte con falsos positivos, cédulas sin verificador y RUT sin
 *   guion: los «detectar» llevan la palabra de contexto, y se suman «no detectar»
 *   sin ella.
 * - `uy:ci`: `1.234.567-3` pasa de «no detectar» a «detectar» (se tapa siempre).
 */

export type Example = string | readonly [text: string, expected: string];

export interface ExampleFamily {
  readonly family: string;
  /** Formas que corren juntas para este grupo de ejemplos. */
  readonly forms: ReadonlyArray<string>;
  readonly yes: ReadonlyArray<Example>;
  readonly no: ReadonlyArray<string>;
  readonly source: string;
}

export const REPORT_EXAMPLES: ReadonlyArray<ExampleFamily> = [
  {
    family: "cl:rut",
    forms: ["cl:rut"],
    source: "§1.2",
    yes: [
      "12.345.678-5",
      "12345678-5",
      "7.654.321-6",
      "9.876.543-3",
      "76.123.456-0",
      "13.579.246-2",
      "5.555.555-9",
      "1.000.005-K",
    ],
    no: [
      "12.345.678-4",
      "7.654.321-5",
      "12.345.67-5",
      "12.345.678",
      "123.456.789-0",
      "12-345-678-5",
    ],
  },
  {
    family: "cl:rut-ctx",
    forms: ["cl:rut-ctx"],
    source: "Plan §5 (RUT sin guion y DV mal tipeado, con RUT o RUN antes)",
    yes: [
      ["RUT 12.345.678-5", "12.345.678-5"],
      ["RUT 123456785", "123456785"],
      ["RUN: 12.345.678 5", "12.345.678 5"],
      ["R.U.T. 7654321-6", "7654321-6"],
      ["RUT 12.345.678-4", "12.345.678-4"],
    ],
    no: ["123456785", "Folio 123456785", "RUT 12.345.67-5", "RUT 12345"],
  },
  {
    family: "cl:phone-mobile",
    forms: ["cl:phone-mobile"],
    source: "§1.3",
    yes: ["+56 9 8765 4321", "+569 87654321", "56 9 2345 6789", "9 8765 4321", "9-3456-7890"],
    no: ["+56 7 8765 4321", "9 8765 432", "+56 9 8765 43210", "98 7654 321 0", "+56 9 8765"],
  },
  {
    family: "cl:phone-mobile-ctx",
    forms: ["cl:phone-mobile-ctx"],
    source: "Plan §5 (celular sin prefijo, con palabra de teléfono antes)",
    yes: [
      ["Tel. 987654321", "987654321"],
      ["Celular 912345678", "912345678"],
      ["Fono: 976543210", "976543210"],
      ["Teléfono 934567890", "934567890"],
    ],
    no: ["987654321", "Teléfono 887654321", "Cel. 98765432", "Tel. 9876543210"],
  },
  {
    family: "cl:phone-landline",
    forms: ["cl:phone-landline"],
    source: "§1.3 y Plan §5 (`29 345 6789` se detecta)",
    yes: ["22 345 6789", "+56 2 2345 6789", "(32) 234 5678", "+56 41 2345678", "29 345 6789"],
    no: ["22 345 678", "2 2345 67890", "(2) 2345"],
  },
  {
    family: "cl:plate-4l2d (letras de la lista)",
    forms: ["cl:plate-4l2d"],
    source: "§1.4",
    yes: ["BCDF-12", "GHJK 45", "TTRZ99", "XYZW-10", "BC.DF.12"],
    no: ["LOTE 12", "BCDF-123", "BCD-12", "ABCD-12", "BCDF-1"],
  },
  {
    family: "cl:plate-4l2d + cl:plate-4l2d-ctx",
    forms: ["cl:plate-4l2d", "cl:plate-4l2d-ctx"],
    source: "Plan §5 (otras letras, solo con palabra de patente antes)",
    yes: [
      ["patente ABCD-12", "ABCD-12"],
      ["placa MNQA 34", "MNQA 34"],
      ["Patente AEIO.56", "AEIO.56"],
      ["patente BC.DF.12", "BC.DF.12"],
      "BCDF-12",
    ],
    no: ["ABCD-12", "LOTE 12", "patente ABCD-123", "patente BCD-12", "MNQA-12"],
  },
  {
    family: "cl:plate-2l4d",
    forms: ["cl:plate-2l4d"],
    source: "§1.4",
    yes: ["AB-1234", "XY 9876", "FP1234", "GK.12.34"],
    no: ["AB-123", "ABC-1234", "AB-12345", "A-1234"],
  },
  {
    family: "cl:plate-moto-3l2d",
    forms: ["cl:plate-moto-3l2d"],
    source: "§1.4 y Plan §5 (con palabra de patente antes)",
    yes: [
      ["patente FGH-12", "FGH-12"],
      ["placa PRS 45", "PRS 45"],
      ["dominio JKL90", "JKL90"],
    ],
    no: ["FGH-12", "LEY 18", "patente FGH-123", "patente FG-12", "patente FGHI-12"],
  },
  {
    family: "cl:plate-moto-2l3d",
    forms: ["cl:plate-moto-2l3d"],
    source: "§1.4",
    yes: ["AB-123", "CD 456", "EF.789"],
    no: ["AB-1234", "A-123", "ABC-123"],
  },
  {
    family: "uy:ci (tres formas)",
    forms: ["uy:ci", "uy:ci-digitos", "uy:ci-guion"],
    source: "§2.2 y Plan §5 (con puntos y guion se tapa siempre)",
    yes: [
      "1.234.567-2",
      "3.456.789-4",
      "5.123.456-1",
      "2345678-3",
      "987.654-9",
      "4.567.890-5",
      "1.234.567-3",
    ],
    no: ["1.234.56-2", "12.345.678-2", "1,234,567-2"],
  },
  {
    family: "uy:ci-sindv-ctx",
    forms: ["uy:ci-sindv-ctx"],
    source: "Plan §5 (CI sin verificador, con palabra de documento antes)",
    yes: [
      ["CI 1.234.567", "1.234.567"],
      ["C.I. 987.654", "987.654"],
      ["Cédula de identidad 3.456.789", "3.456.789"],
      ["Documento 2.345.678", "2.345.678"],
    ],
    no: ["1.234.567", "Doc. 1.234.567", "CI 12.345.678", "CI 12.345", "Documento 98.765.432"],
  },
  {
    family: "uy:rut (continuo y separado)",
    forms: ["uy:rut", "uy:rut-separado"],
    source: "§2.3",
    yes: ["212345670015", "21 000123 001 8", "213456780011", "21-111111-001-5"],
    no: ["212345670014", "212345670025", "232345670015", "21234567001"],
  },
  {
    family: "uy:phone-mobile",
    forms: ["uy:phone-mobile"],
    source: "§2.4",
    yes: ["099 123 456", "+598 99 123 456", "091234567", "+598 94 234 567"],
    no: ["099 123 45", "+598 88 123 456", "098 123 4567", "09 123 456"],
  },
  {
    family: "uy:phone-landline",
    forms: ["uy:phone-landline"],
    source: "§2.4",
    yes: ["2901 2345", "+598 2901 2345", "4332 1234", "2 901 2345"],
    no: ["3901 2345", "2901 234", "+598 2901 23456"],
  },
  {
    family: "uy:plate",
    forms: ["uy:plate"],
    source: "§2.5 y Plan §5 (con palabra de matrícula o patente antes)",
    yes: [
      ["matrícula SAB 1234", "SAB 1234"],
      ["patente ABC-1234", "ABC-1234"],
      ["Matrícula HAA1000", "HAA1000"],
      ["placa BAE 5678", "BAE 5678"],
    ],
    no: ["SAB 1234", "matrícula SAB 12345", "matrícula SA 1234", "matrícula SABC 1234"],
  },
  {
    family: "uy:account-brou",
    forms: ["uy:account-brou"],
    source: "§2.6",
    yes: ["000123456-00001", "001000321-00004", "000987654-00002"],
    no: ["000123456-0001", "00012345-00001", "000123456-000001"],
  },
  {
    family: "py:ci",
    forms: ["py:ci"],
    source: "§3.2 y Plan §5 (con palabra de cédula antes)",
    yes: [
      ["C.I. 1.234.567", "1.234.567"],
      ["CI 4.567.890", "4.567.890"],
      ["Cédula 987.654", "987.654"],
      ["CIC 2.345.678", "2.345.678"],
    ],
    no: [
      "1.234.567",
      "1234567",
      "C.I. 12.345.678",
      "C.I. 1.23.567",
      "C.I. 1.234.5678",
      "C.I. N° 1.234.567",
    ],
  },
  {
    family: "py:ci-ctx",
    forms: ["py:ci-ctx"],
    source: "§3.2 y Plan §5 («Nº» sale de la lista)",
    yes: [
      ["C.I. 1234567", "1234567"],
      ["CI: 987654", "987654"],
      ["cédula 2345678", "2345678"],
    ],
    no: ["1234567", "CI 12", "teléfono 1234567", "Nº 1234567", "Factura N° 123456"],
  },
  {
    family: "py:ruc",
    forms: ["py:ruc"],
    source: "§3.3 y Plan §5 (el algoritmo manda: dos ejemplos corregidos)",
    yes: ["80012345-0", "1234567-9", "2345678-7", "80099900-2", "4123456-1", "800999-6"],
    no: ["80012345-8", "80012345", "80012345-77", "8001234567"],
  },
  {
    family: "py:phone-mobile",
    forms: ["py:phone-mobile"],
    source: "§3.4",
    yes: ["0981 123 456", "+595 971 234 567", "0991-234-567", "(0961) 234 567"],
    no: ["0881 123 456", "0981 123 45", "+595 81 123 456"],
  },
  {
    family: "py:phone-landline (estricto)",
    forms: ["py:phone-landline"],
    source: "§3.4, §11.8 y Plan §5 (prefijo de país o 0 inicial)",
    yes: ["021 123 4567", "+595 21 123 4567", "(021) 123 4567", "0541 123 456"],
    no: ["123 4567 89", "21 123 4567", "1234567890"],
  },
  {
    family: "py:plate (cuatro formas)",
    forms: ["py:plate-3l3d", "py:plate-moto-3d3l", "py:plate-mercosur", "py:plate-moto-mercosur"],
    source: "§3.5 y Plan §5 (las tres con falsos positivos llevan palabra antes)",
    yes: [
      ["chapa ABC 123", "ABC 123"],
      ["placa HJK-456", "HJK-456"],
      ["chapa ABCD 123", "ABCD 123"],
      ["patente BCDF123", "BCDF123"],
      ["chapa 123 ABC", "123 ABC"],
      "456-ABCD",
    ],
    no: ["ABC 123", "ABC 1234", "ABCDE 123", "AB 123", "1234 ABC", "LOTE 123"],
  },
  {
    family: "bo:ci-ext",
    forms: ["bo:ci-ext"],
    source: "§4.2 (sin complemento, Plan §5)",
    yes: ["1234567 LP", "7654321 SC", "123456 OR"],
    no: ["1234567 XX", "12345 LP", "1234567 L", "123456789 LP"],
  },
  {
    family: "bo:ci-ctx",
    forms: ["bo:ci-ctx"],
    source: "§4.2 y Plan §5 («Nº» sale de la lista)",
    yes: [
      ["C.I. 1234567", "1234567"],
      ["CI: 7654321", "7654321"],
      ["Cédula de identidad 8123456", "8123456"],
    ],
    no: ["1234567", "Nº 1234567", "C.I. N° 1234567"],
  },
  {
    family: "bo:nit-ctx",
    forms: ["bo:nit-ctx"],
    source: "§4.3 y Plan §5 (hasta 3 palabras entre NIT y el número)",
    yes: [
      ["NIT 1234567010", "1234567010"],
      ["NIT: 1023456789", "1023456789"],
      ["N.I.T. 4012345678", "4012345678"],
      ["NIT del emisor: 1234567010", "1234567010"],
      ["NIT de la empresa 1020304050", "1020304050"],
    ],
    no: ["1023456789", "NIT 123", "NIT 1234567890123", "NIT de la empresa emisora 1020304050"],
  },
  {
    family: "bo:phone-mobile",
    forms: ["bo:phone-mobile"],
    source: "§4.4",
    yes: ["7123 4567", "+591 71234567", "6234 5678", "591-7234 5678"],
    no: ["8123 4567", "7123 456", "+591 7123 45678"],
  },
  {
    family: "bo:phone-landline",
    forms: ["bo:phone-landline"],
    source: "§4.4",
    yes: ["2 2123456", "(4) 412 3456", "+591 3 3123456"],
    no: ["5 2123456", "2 212345"],
  },
  {
    family: "bo:plate",
    forms: ["bo:plate"],
    source: "§4.5 y Plan §5 (con palabra de placa antes)",
    yes: [
      ["placa 1234 ABC", "1234 ABC"],
      ["Placa 6400-DEF", "6400-DEF"],
      ["patente 987ABC", "987ABC"],
      ["dominio 2345 XYZ", "2345 XYZ"],
    ],
    no: ["1234 ABC", "placa 12 ABC", "placa 12345 ABC", "placa 1234 AB", "placa 1234 ABCD"],
  },
  {
    family: "ar:cbu",
    forms: ["ar:cbu"],
    source: "§5.1 y §11.6",
    yes: [
      "0140002112345678901233",
      "0270105500000987654326",
      "0720001400000123456784",
      "0000003110000123456781",
      "01400021 12345678901233",
      "0140 0021 1234 5678 9012 33",
      "0000003100000123456784",
      "0000012300009876543219",
      "0000045100002468135799",
    ],
    no: [
      "0140002112345678901234",
      "0140002012345678901233",
      "014000211234567890123",
      "01400021123456789012334",
      "0140 0021 1234 5678 9012 3",
    ],
  },
  {
    family: "ar:passport",
    forms: ["ar:passport"],
    source: "§5.3 y Plan §5 (con «pasaporte» antes)",
    yes: [
      ["pasaporte QWE 654321", "QWE 654321"],
      ["Pasaporte: XYZ-123456", "XYZ-123456"],
      ["pasaporte ABC987654", "ABC987654"],
      ["pasaporte ZZX000123", "ZZX000123"],
    ],
    no: [
      "QWE 654321",
      "pasaporte AB123456",
      "pasaporte ABC12345",
      "pasaporte ABCD123456",
      "pasaporte 123456ABC",
    ],
  },
];
