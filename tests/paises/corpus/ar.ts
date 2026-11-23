/**
 * Corpus sintético chico de Argentina para los tipos nuevos: CBU/CVU y
 * pasaporte (ADR-236 §3). Incluye algunas entidades del catálogo de hoy (DNI,
 * CUIT, teléfono, patente), con forma `ar:<id>`, para ver los choques.
 * Todo inventado; los dígitos verificadores salen de `checks.ts`.
 */

import { n, p, u } from "../lib/dsl.js";
import {
  cbu22,
  cbuGroups4,
  cbuGroups8x14,
  cbuWrongDv1,
  cbuWrongDv2,
  cuitDashed,
} from "../lib/gen.js";
import type { CorpusSource } from "../lib/types.js";

const cb = (text: string, shape: string, key: string): string =>
  p("BANK_ACCOUNT", "ar:cbu", shape, text, key);
const pp = (text: string, shape: string): string => p("PASSPORT", "ar:passport", shape, text);

const C1 = cbu22("014", "0002", "1234567890123");
const C2 = cbu22("027", "0105", "5000009876543");
const C3 = cbu22("072", "0001", "4000001234567");
const C4 = cbu22("011", "0300", "9876543210987");
const C5 = cbu22("017", "0170", "2468135790246");
const C6 = cbu22("285", "0001", "1357924680135");
const CVU1 = cbu22("000", "0031", "0000012345678");
const CVU2 = cbu22("000", "0123", "0000098765432");
const CVU3 = cbu22("000", "0451", "0000024681357");
const CVU4 = cbu22("000", "0072", "0000011223344");

const cuitA = cuitDashed("20", "26139703") ?? "20-26139703-0";
const cuitB = cuitDashed("27", "31524680") ?? "27-31524680-1";
const cuitC = cuitDashed("30", "70123456") ?? "30-70123456-1";

export const AR_SOURCES: ReadonlyArray<CorpusSource> = [
  {
    id: "ar-01-transferencia",
    title: "Orden de transferencia",
    renderings: ["mayus"],
    source: `ORDEN DE TRANSFERENCIA. Buenos Aires, ${u("DATE", "numerica", "12/03/2025")}. Ordenante: Julián Ferreyra Sosa, DNI ${p("DNI", "ar:dni-ar", "con puntos", "34.567.891")},
      CUIT ${p("CUIT", "ar:cuit-ar", "con guiones", cuitA)}. CBU de origen ${cb(C1, "22 seguidos", "cbu:1")}. Beneficiaria: Mariana Olmos Paz, CUIL ${p("CUIT", "ar:cuit-ar", "con guiones", cuitB)}.
      CBU destino ${cb(C2, "22 seguidos", "cbu:2")}; alias ${n("alias", "juan.perez.mp")}. También ${cb(C3, "22 seguidos", "cbu:3")}, ${cb(C4, "22 seguidos", "cbu:4")}
      y ${cb(C5, "22 seguidos", "cbu:5")}. CVU de Mercado Pago: ${cb(CVU1, "CVU 22 seguidos", "cvu:1")} y ${cb(CVU2, "CVU 22 seguidos", "cvu:2")}.
      Formato partido: CBU ${cb(cbuGroups8x14(C1), "8+14 con espacio", "cbu:1")}; ${cb(cbuGroups8x14(C6).replace(" ", "-"), "8+14 con guion", "cbu:6")}; ${cb(cbuGroups8x14(C2), "8+14 con espacio", "cbu:2")}.
      En grupos de cuatro: ${cb(cbuGroups4(C3), "4+4+4+4+4+2", "cbu:3")}, ${cb(cbuGroups4(C4), "4+4+4+4+4+2", "cbu:4")} y ${cb(cbuGroups4(C6), "4+4+4+4+4+2", "cbu:6")}.
      CVU en otras grafías: ${cb(cbuGroups8x14(CVU3), "CVU 8+14", "cvu:3")} y ${cb(cbuGroups4(CVU4), "CVU 4+4+4+4+4+2", "cvu:4")}.
      Dígito verificador equivocado (no es un CBU válido): ${n("cbu-dv2", cbuWrongDv2(C1))}, ${n("cbu-dv1", cbuWrongDv1(C2))}.
      Cuentas con otra longitud: ${n("cbu-21", C3.slice(0, 21))}, ${n("cbu-23", `${C4}4`)}. Tarjeta ${u("CREDIT_CARD", "tarjeta", "4111 1111 1111 1111")}.
      CUIT de la empresa ${p("CUIT", "ar:cuit-ar", "sin guiones", cuitC.replace(/-/g, ""))} y orden ${n("orden", "N° 20250123")}. Teléfono ${p("PHONE", "ar:phone-mobile-ar", "+54 9", "+54 9 11 4567 8901")}.`,
  },
  {
    id: "ar-02-viaje",
    title: "Formulario de viaje y pasaportes",
    renderings: ["minus"],
    source: `FORMULARIO DE VIAJE. Pasajero: Lucas Benítez Arce, pasaporte ${pp("QWE 654321", "3l6d con espacio")}; acompañante Paula Ríos Vega, pasaporte ${pp("XYZ-123456", "3l6d con guion")}.
      Otros pasajeros: ${pp("ABC987654", "3l6d pegado")}, ${pp("ZZX000123", "ZZX (refugiados, sin confirmar)")}, ${pp("MNP 112233", "3l6d con espacio")}, ${pp("RST-445566", "3l6d con guion")},
      ${pp("HJK778899", "3l6d pegado")}, ${pp("DEF 123456", "3l6d con espacio")}, ${pp("GHI-654321", "3l6d con guion")} y ${pp("PQR246810", "3l6d pegado")}.
      DNI ${p("DNI", "ar:dni-ar", "con puntos", "28.901.234")}, patente del auto ${p("PLATE", "ar:plate-vieja-ar", "vieja", "ABC 123")} y ${p("PLATE", "ar:plate-mercosur-ar", "mercosur", "AB 123 CD")}.
      Referencias que no son pasaportes: ${n("nro", "NRO 123456")}, ${n("ref", "REF 654321")}, ${n("exp", "EXP 123456")}, ${n("corto", "ABC 12345")}, ${n("dos-letras", "AB123456")},
      ${n("cuatro-letras", "ABCD123456")}, ${n("inversa", "123456ABC")}, ${n("lote", "LOTE 12")}.
      Teléfono ${p("PHONE", "ar:phone-landline-ar", "011 4567-8902", "011 4567-8902")}. Fecha ${u("DATE", "texto", "9 de julio de 2025")}.`,
  },
  {
    id: "ar-03-contrato",
    title: "Contrato con cuenta y datos",
    source: `CONTRATO DE LOCACIÓN. En la Ciudad de Córdoba, a ${u("DATE", "texto", "17 de mayo de 2025")}, entre Hernán Bustos Ledesma, DNI ${p("DNI", "ar:dni-ar", "con puntos", "30.456.789")}, domiciliado en
      ${u("ADDRESS", "avenida", "Avenida Colón 1234")}, y Silvia Navarro Peña, CUIT ${p("CUIT", "ar:cuit-ar", "con guiones", cuitC)}. El alquiler se depositará en la cuenta CBU ${cb(C5, "22 seguidos", "cbu:5")}
      del Banco de la Nación; para pagos digitales, el CVU ${cb(CVU3, "CVU 22 seguidos", "cvu:3")}. Pasaporte de la locataria ${pp("STU 335577", "3l6d con espacio")}.
      Monto ${n("monto", "$ 450.000")}, expediente ${n("exp", "Expte. 123456")}, número de contrato ${n("contrato", "NRO 654321")}, factura ${n("factura", "A 0001-00001234")}.
      Cuenta ${cb(C1, "22 seguidos", "cbu:1")}. Número de 22 dígitos que no es un CBU: ${n("cbu-dv2", cbuWrongDv2(C4))}.`,
  },
  {
    id: "ar-04-segunda-medicion",
    title: "Casos sumados en la segunda medición (pasaporte con y sin palabra)",
    added: true,
    renderings: ["mayus"],
    source: `REGISTRO DE VIAJEROS. Titular: Pasaporte ${pp("QRS 112233", "3l6d con Pasaporte")}; acompañante, pasaporte: ${pp("TUV-445566", "3l6d con Pasaporte:")}.
      Menor: pasaporte ${pp("WXY778899", "3l6d pegado con pasaporte")}.
      Referencias: pasaporte ${n("nro-tras-pasaporte", "NRO 123456")} y ${n("ref", "REF 654321")} del trámite.
      Teléfono ${p("PHONE", "ar:phone-landline-ar", "011 4567-8903", "011 4567-8903")}.`,
  },
];
