/**
 * Corpus sintético de Paraguay. Nombres, direcciones, números y chapas
 * inventados; los dígitos verificadores del RUC salen de `checks.ts`.
 */

import { n, p, u } from "../lib/dsl.js";
import { pyCiDots, pyRuc, pyRucDots } from "../lib/gen.js";
import type { CorpusSource } from "../lib/types.js";

const ck = (body: number): string => `ci:${body}`;
const tk = (digits: string): string => `tel:${digits}`;

const ci = (body: number, shape = "con puntos"): string =>
  p("DNI", "py:ci", shape, pyCiDots(body), ck(body));
const ciCtx = (body: number, shape = "pelado con contexto"): string =>
  p("DNI", "py:ci-ctx", shape, String(body), ck(body));
const ruc = (body: number, shape = "cuerpo-DV"): string =>
  p("CUIT", "py:ruc", shape, pyRuc(body), `ruc:${body}`);
const rucD = (body: number): string =>
  p("CUIT", "py:ruc", "cédula con puntos + DV", pyRucDots(body), `ruc:${body}`);

export const PY_SOURCES: ReadonlyArray<CorpusSource> = [
  {
    id: "py-01-alquiler",
    title: "Contrato de locación",
    renderings: ["mayus", "minus"],
    source: `CONTRATO DE LOCACIÓN. En la ciudad de Asunción, a ${u("DATE", "texto", "17 de mayo de 2025")}, entre el señor Aníbal Benítez Duarte,
      con C.I. N° ${ci(1234567)}, domiciliado en ${u("ADDRESS", "avda", "Avda. Mcal. López 1234")}, y la señora Liz Marlene Ayala Giménez,
      cédula de identidad ${ci(4567890)}, teléfono ${p("PHONE", "py:phone-mobile", "0981 3+3", "0981 123 456", tk("595981123456"))}, se conviene lo siguiente.
      PRIMERO: el alquiler mensual es de ${n("monto", "Gs. 2.500.000")} y la garantía de ${n("monto", "Gs. 1.234.567")}.
      SEGUNDO: el RUC del locador es ${ruc(80012345)} y el de la locataria ${ruc(1234567, "persona física")}.
      TERCERO: vehículo de la locataria, chapa ${p("PLATE", "py:plate-mercosur", "4l3d", "BCDF 123")}, estacionamiento ${n("est", "N° 12")}.
      Piso ${n("piso", "PISO 3")}, ${n("casa", "CASA 2")}, ${n("lote", "LOTE 123")}. Finca ${n("finca", "N° 12345")}, código postal ${n("cp", "CP 1234")}.
      Firmado en la fecha ${u("DATE", "numerica", "17/05/2025")}, en dos ejemplares. ${n("usd", "USD 100")} de comisión.`,
  },
  {
    id: "py-02-escrito",
    title: "Escrito judicial",
    renderings: ["mayus"],
    source: `SEÑOR JUEZ EN LO CIVIL Y COMERCIAL. Expediente ${n("exp", "N° 123/2024")}. Autos: ${u("PERSON", "dos-apellidos", "Villalba Ortiz, Carlos")} c/ Empresa Los Cedros S.A. s/ cobro de guaraníes.
      Carlos Villalba Ortiz, con C.I. ${ciCtx(2345678, "C.I. + número")}, constituyendo domicilio en ${u("ADDRESS", "calle", "Calle Palma 456")}, a V.E. digo:
      Que la demandada, RUC ${ruc(80099900)}, adeuda ${n("monto", "Gs. 12.345.678")}, factura ${n("factura", "001-001-0001234")}, y su representante, con cédula ${ciCtx(3456789, "cédula + número")},
      fue citado el ${u("DATE", "texto-ordinal", "1º de junio de 2025")}. Testigo con CI: ${ciCtx(987654, "CI: + número")}, y otro con C.I.: ${ciCtx(1234567, "C.I.: + número")}.
      Otro testigo, ${ci(2345678)}, y ${ci(987654, "6 dígitos")}.
      Se ofrece ${n("art", "ART 123")} del código y ${n("ley", "LEY 1183")}. Tel. ${p("PHONE", "py:phone-landline", "021 3+4", "021 123 4567", tk("595211234567"))}.
      Resolución del ${u("DATE", "numerica", "21/08/2025")}. Fojas ${n("fojas", "FOJA 123")}.`,
  },
  {
    id: "py-03-factura",
    title: "Factura",
    source: `FACTURA ${n("factura", "N° 001-002-0004567")}. Timbrado ${n("timbrado", "12345678")}. Emisor: Distribuidora Guaraní S.R.L., RUC ${ruc(80000519, "empresa")}.
      Cliente: Mirta Cáceres Ramírez, RUC ${rucD(1234567)}, dirección ${u("ADDRESS", "avda", "Avda. España 2870")}. Fecha ${u("DATE", "numerica", "12/03/2025")}.
      Detalle: 3 unidades a ${n("monto", "Gs. 150.000")}, total ${n("monto", "Gs. 450.000")} (${n("usd", "USD 100")}). IVA ${n("iva", "IVA 10")}%.
      Cliente ocasional ${ruc(2345678, "persona física")} y ${ruc(4123456, "persona física")}; la factura la emitió ${rucD(4123456)}.
      Contacto ${p("PHONE", "py:phone-mobile", "0981123456", "0981123456", tk("595981123456"))} y ${p("PHONE", "py:phone-mobile", "0981-123-456", "0981-123-456", tk("595981123456"))}.
      Cuenta ${n("cuenta", "N° 12345678")}. Orden ${n("oc", "OC 7654321")}. Número corto ${ruc(800999, "6 dígitos")}.`,
  },
  {
    id: "py-04-vehiculo",
    title: "Formulario de vehículo y chapa",
    renderings: ["minus"],
    source: `FORMULARIO DE TRANSFERENCIA DE VEHÍCULO. Vendedor: Rubén Insfrán Cabrera, CIC ${ciCtx(1234567, "CIC + número")}. Comprador: Patricia Rojas Servín, CI ${ci(3456789)}.
      Chapa del auto ${p("PLATE", "py:plate-3l3d", "3l3d", "ABC 123")} y de la camioneta ${p("PLATE", "py:plate-3l3d", "3l3d", "HJK-456")}; chapa Mercosur
      ${p("PLATE", "py:plate-mercosur", "4l3d", "ABCD 123")}, ${p("PLATE", "py:plate-mercosur", "4l3d sin sep", "BCDF123")} y ${p("PLATE", "py:plate-mercosur", "4l3d", "HJKL 456")}.
      Motocicletas: ${p("PLATE", "py:plate-moto-3d3l", "3d3l", "123 ABC")}, ${p("PLATE", "py:plate-moto-3d3l", "3d3l con guion", "456-DEF")},
      ${p("PLATE", "py:plate-moto-mercosur", "3d4l", "123 ABCD")} y ${p("PLATE", "py:plate-moto-mercosur", "3d4l con guion", "456-BCDF")}.
      Teléfono ${p("PHONE", "py:phone-mobile", "(0981)", "(0961) 234 567", tk("595961234567"))}, ${p("PHONE", "py:phone-mobile", "+595 3+3", "+595 971 234 567", tk("595971234567"))}.
      Celular alternativo sin cero ${p("PHONE", "py:phone-mobile", "sin 0", "981 123 456", tk("595981123456"))}. Valor ${n("usd", "USD 100")}, ${n("km", "100 KMS")}, ${n("zona", "ZONA 123")}.
      Fecha ${u("DATE", "numerica", "30/11/2025")}, ${n("n", "7654321")}.`,
  },
  {
    id: "py-05-nota",
    title: "Nota con teléfonos y direcciones",
    source: `Estimada Sra. Viviana Franco Báez: sus teléfonos son ${p("PHONE", "py:phone-mobile", "+595 981", "+595 981 123 456", tk("595981123456"))},
      ${p("PHONE", "py:phone-mobile", "+595 sin sep", "+595981123456", tk("595981123456"))} y ${p("PHONE", "py:phone-mobile", "0991-3+3", "0991-234-567", tk("595991234567"))}.
      Fijos: ${p("PHONE", "py:phone-landline", "021 3+4", "021 123 4567", tk("595211234567"))}, ${p("PHONE", "py:phone-landline", "+595 21", "+595 21 123 4567", tk("595211234567"))},
      ${p("PHONE", "py:phone-landline", "(021)", "(021) 123 4567", tk("595211234567"))}, ${p("PHONE", "py:phone-landline", "+595 61", "+595 61 123 4567", tk("595611234567"))},
      ${p("PHONE", "py:phone-landline", "061 3+4", "061 123 4567", tk("595611234567"))} y en Villarrica ${p("PHONE", "py:phone-landline", "0541 3+3", "0541 123 456", tk("595541123456"))}.
      Su cédula es ${ci(5123456)} y su RUC ${ruc(5123456, "persona física")}. Referencia ${n("ref", "REF 654321")}.
      Visítenos en ${u("ADDRESS", "esquina", "Mcal. López c/ Brasil 1234")} o en ${u("ADDRESS", "ruta", "Ruta 2 km 14")}, Ciudad del Este.
      Fecha ${u("DATE", "numerica-guion", "28-02-2025")}. Monto ${n("monto", "Gs. 5.000.000")}, ${n("codigo", "1234567")}, ${n("cp", "CP 7000")}.`,
  },
  {
    id: "py-06-acta",
    title: "Acta de asamblea",
    renderings: ["mayus"],
    source: `ACTA DE ASAMBLEA. En Encarnación, a ${u("DATE", "texto", "2 de septiembre de 2024")}, se reúnen los socios: Gabriela Núñez Meza, C.I. N° ${ci(6123450)};
      Marcelo Samaniego Paiva, cédula ${ci(7123456)}; y Hugo Bareiro Acosta, cédula ${ciCtx(5678901, "cédula + número")}. RUC de la entidad ${ruc(80123456)}.
      Domicilio social ${u("ADDRESS", "calle", "Calle Independencia 789")}. Capital ${n("monto", "Gs. 100.000.000")}. ${n("art", "ART 123")}, ${n("dec", "DEC 500")}.
      Se registró el RUC de un proveedor ${rucD(4123456)} y el de otro ${ruc(7654321, "persona física")}.
      Folio ${n("folio", "12345678")}, finca ${n("finca", "N° 54321")}. Convocatoria del ${u("DATE", "numerica-punto", "01.03.2020")}.`,
  },
  {
    id: "py-07-segunda-medicion",
    title: "Casos sumados en la segunda medición (cédula con palabra, tramos de 6 dígitos, chapa)",
    added: true,
    renderings: ["mayus"],
    source: `ACTA DE CONSTATACIÓN. Comparecen: Tomás Ferreira Acuña, C.I. ${ci(4567890)}; Sonia Villasanti Rojas, Cédula ${ci(987654, "6 dígitos con Cédula")}; Pedro Báez Meza, CIC ${ci(1234567, "con CIC")}
      y Rosa Duarte Cano, cédula de identidad ${ciCtx(6543210, "cédula de identidad + número")}.
      Documentos extranjeros: con C.I. ${n("dni-8-digitos", "12.345.678")} un ciudadano argentino y ${n("dni-8-digitos", "98.765.432")} otro; una factura Nº ${n("factura", "1.234.567")} y el monto Gs. ${n("monto", "2.500.000")}.
      Rodados: chapa ${p("PLATE", "py:plate-3l3d", "3l3d con chapa", "XYZ 987")}, placa ${p("PLATE", "py:plate-mercosur", "4l3d con placa", "HJKL 654")}, patente ${p("PLATE", "py:plate-moto-3d3l", "3d3l con patente", "321 ABC")}.
      Sin palabra: ${n("sigla-3l3d", "USD 250")}, ${n("sigla-4l3d", "LOTE 456")}, ${n("sigla-3d3l", "100 KMS")}.
      Tel. ${p("PHONE", "py:phone-landline", "021 3+4", "021 765 4321", tk("595217654321"))} y celular ${p("PHONE", "py:phone-mobile", "0981 3+3", "0981 765 432", tk("595981765432"))}. Fecha ${u("DATE", "numerica", "22/11/2025")}.`,
  },
];
