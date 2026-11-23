/**
 * Corpus sintético de Uruguay. Nombres, direcciones, números y matrículas
 * inventados; los verificadores salen de `checks.ts`.
 */

import { n, p, u } from "../lib/dsl.js";
import {
  uyCiDigits,
  uyCiDots,
  uyCiHyphen,
  uyCiNoDv,
  uyCiWrongDv,
  uyRutContinuous,
  uyRutNumero,
  uyRutSeparated,
  uyRutWrongDv,
} from "../lib/gen.js";
import type { CorpusSource } from "../lib/types.js";

const ck = (body: number): string => `ci:${body}`;
const tk = (digits: string): string => `tel:${digits}`;

const ciD = (body: number, shape = "puntos+guion"): string =>
  p("DNI", "uy:ci", shape, uyCiDots(body), ck(body));
const ciW = (body: number): string => p("DNI", "uy:ci", "dv-errado", uyCiWrongDv(body), ck(body));
const ciDig = (body: number, shape = "8 dígitos"): string =>
  p("DNI", "uy:ci-digitos", shape, uyCiDigits(body), ck(body));
const ciGu = (body: number): string =>
  p("DNI", "uy:ci-guion", "guion sin puntos", uyCiHyphen(body), ck(body));
const ciNoDv = (body: number, shape = "sin DV"): string =>
  p("DNI", "uy:ci-sindv-ctx", shape, uyCiNoDv(body), ck(body));

const N1 = uyRutNumero("21", 234567);
const N2 = uyRutNumero("21", 111111);
const N3 = uyRutNumero("22", 345678);
const N4 = uyRutNumero("20", 456789);
const N5 = uyRutNumero("21", 654321);
const N6 = uyRutNumero("19", 765432);
const N7 = uyRutNumero("21", 987654);

const rutC = (serie: string, numero: string): string =>
  p("CUIT", "uy:rut", "12 dígitos", uyRutContinuous(serie, numero), `rut:${serie}${numero}`);
const rutS = (serie: string, numero: string, sep: string, shape: string): string =>
  p("CUIT", "uy:rut-separado", shape, uyRutSeparated(serie, numero, sep), `rut:${serie}${numero}`);
const rutSW = (serie: string, numero: string, sep: string): string =>
  p(
    "CUIT",
    "uy:rut-separado",
    "dv-errado",
    uyRutWrongDv(serie, numero, sep),
    `rut:${serie}${numero}`,
  );

export const UY_SOURCES: ReadonlyArray<CorpusSource> = [
  {
    id: "uy-01-alquiler",
    title: "Contrato de arrendamiento",
    renderings: ["mayus", "minus"],
    source: `CONTRATO DE ARRENDAMIENTO. En Montevideo, el ${u("DATE", "texto", "12 de octubre de 2025")}, entre don Gonzalo Techera Píriz,
      cédula de identidad ${ciD(1234567)}, domiciliado en ${u("ADDRESS", "avenida", "Avenida 18 de Julio 1234")}, apartamento ${n("apto", "APTO 501")},
      y doña Lucía Ferreira Núñez, CI ${ciD(3456789)}, celular ${p("PHONE", "uy:phone-mobile", "099 3+3", "099 123 456", tk("59899123456"))},
      se acuerda lo siguiente. PRIMERO: el precio mensual es de ${n("monto", "$ 1.234.567")} más ${n("monto", "$ 25.000")} de gastos comunes.
      SEGUNDO: la arrendataria declara que su CI es ${ciDig(3456789)} y el padrón del inmueble es ${n("padron", "Padrón 12345")}.
      TERCERO: se deja constancia del RUT del propietario ${rutC("21", N1)} y del código postal ${n("cp", "CP 11300")}.
      Vehículo de la arrendataria, matrícula ${p("PLATE", "uy:plate", "3l4d", "SAB 1234")}, estacionamiento ${n("est", "N° 7")}.
      Piso ${n("piso", "PISO 3")}, ${n("casa", "CASA 2")}, contrato ${n("contrato", "N° 98765432")}. Firmado el ${u("DATE", "numerica", "12/10/2025")}.`,
  },
  {
    id: "uy-02-escrito",
    title: "Escrito judicial",
    renderings: ["mayus"],
    source: `SEÑOR JUEZ LETRADO DE PRIMERA INSTANCIA EN LO CIVIL. IUE ${n("iue", "2-12345/2024")}.
      Autos: ${u("PERSON", "dos-apellidos", "Rodríguez Techera, Martín")} c/ Banco Comercial S.A. sobre daños y perjuicios.
      Martín Rodríguez Techera, cédula ${ciD(5123456)}, constituyendo domicilio en ${u("ADDRESS", "calle", "Calle Sarandí 345")}, a V.S. digo:
      Que la demandada, RUT ${rutC("21", N2)} (también escrito ${rutS("21", N2, "-", "guiones")}), fue notificada el ${u("DATE", "numerica", "04/03/2025")}.
      El testigo Pablo Acosta Silva, CI ${ciD(2345678, "puntos+guion")}, domicilio en ${u("ADDRESS", "ruta", "Ruta 8 km 17")}, y la testigo con CI ${ciW(4567890)} (error de tipeo).
      La perito designada, Firmado: ${u("PERSON", "apellido-simple", "Gómez, Marta")}. Se acompañan la ${n("ley", "LEY 14762")} y ${n("art", "ART 123")}, fojas ${n("fojas", "FOJAS 120")}.
      Monto reclamado ${n("monto", "U$S 8.500")}, expediente administrativo ${n("exp", "Exp. 2024-12345")}, folio ${n("folio", "1234567")}.
      Teléfono de contacto del estudio ${p("PHONE", "uy:phone-landline", "2901 2345", "2901 2345", tk("59829012345"))}.
      Otrosí digo: ${u("DATE", "texto-ordinal", "1º de noviembre de 2025")}.`,
  },
  {
    id: "uy-03-factura",
    title: "e-Factura",
    source: `e-FACTURA ${n("serie", "A 12345678")}. Emisor: Distribuidora Del Plata S.A., RUT ${rutC("22", N3)}.
      Cliente: Sofía Pereira Barrios, CI ${ciD(2345678)}. Domicilio: ${u("ADDRESS", "bv", "Bv. Artigas 1560")}. Fecha ${u("DATE", "numerica", "03/04/2025")}.
      Detalle: 5 unidades a ${n("monto", "$ 1.234")}, total ${n("monto", "$ 6.170")}. IVA ${n("iva", "IVA 22")}%. Orden ${n("oc", "OC 7654321")}.
      Pago a la cuenta del BROU ${p("BANK_ACCOUNT", "uy:account-brou", "9+5", "000123456-00001", "acct:123456")}.
      Contacto ${p("PHONE", "uy:phone-mobile", "+598 99 3+3", "+598 99 123 456", tk("59899123456"))}.
      Cédula del contador: ${ciGu(1234567)}; titular alterno: ${ciGu(5123456)}.
      Referencia ${n("ref", "REF 654321")}, ${n("dec", "DEC 500")}.`,
  },
  {
    id: "uy-04-vehiculo",
    title: "Formulario de vehículo y matrícula",
    renderings: ["minus"],
    source: `FORMULARIO DE TRANSFERENCIA. Titular saliente: Andrés Cabrera Olivera, CI ${ciDig(2345678)}. Titular entrante: Valeria Sosa Marín,
      CI ${ciD(987654, "6 dígitos")}. Matrícula del auto ${p("PLATE", "uy:plate", "3l4d", "HAA1000")} y de la camioneta ${p("PLATE", "uy:plate", "3l4d", "ABC-1234")};
      moto ${p("PLATE", "uy:plate-moto", "3l3d", "BAE 567")}. Padrón ${n("padron", "Padrón 54321")}, departamento de Canelones.
      Otros vehículos: ${p("PLATE", "uy:plate", "3l4d", "SDE 4321")}, ${p("PLATE", "uy:plate", "3l4d", "KLM9087")}, ${p("PLATE", "uy:plate-moto", "3l3d", "ABC 123")}, ${p("PLATE", "uy:plate-moto", "3l3d", "XYZ-456")}.
      Celular ${p("PHONE", "uy:phone-mobile", "09X sin sep", "091234567", tk("59891234567"))}, línea fija ${p("PHONE", "uy:phone-landline", "+598 2901 2345", "+598 2901 2345", tk("59829012345"))}.
      Fecha ${u("DATE", "numerica", "30/11/2025")}. Casilla ${n("casilla", "CASA 2")}, lote ${n("lote", "LOTE 45")}.`,
  },
  {
    id: "uy-05-nota",
    title: "Nota con teléfonos",
    source: `Estimada Sra. Carolina Báez Iglesias: le informamos que sus teléfonos de contacto son
      ${p("PHONE", "uy:phone-mobile", "+598 94 3+3", "+598 94 234 567", tk("59894234567"))}, ${p("PHONE", "uy:phone-mobile", "+598 099 3+3", "+598 099 123 456", tk("59899123456"))},
      ${p("PHONE", "uy:phone-mobile", "(+598)", "(+598) 99 123 456", tk("59899123456"))} y ${p("PHONE", "uy:phone-mobile", "09X 3+3", "098 765 432", tk("59898765432"))}.
      El fijo de la oficina es ${p("PHONE", "uy:phone-landline", "4332 1234", "4332 1234", tk("59843321234"))}, también ${p("PHONE", "uy:phone-landline", "2 901 2345", "2 901 2345", tk("59829012345"))},
      ${p("PHONE", "uy:phone-landline", "2901 23 45", "2901 23 45", tk("59829012345"))} y ${p("PHONE", "uy:phone-landline", "(02) 901 2345", "(02) 901 2345", tk("59829012345"))}.
      Sin separadores figuran ${p("PHONE", "uy:phone-landline-pegado", "pegado", "29012345", tk("59829012345"))} y ${p("PHONE", "uy:phone-landline-pegado", "pegado", "43321234", tk("59843321234"))}.
      Su CI ${ciD(4567890)} y su RUT ${rutC("20", N4)} fueron validados el ${u("DATE", "numerica", "15/12/2025")}.
      Dirección: ${u("ADDRESS", "avenida", "Avda. Italia 2870")}. Resolución ${n("res", "RES 1234")}, página ${n("pag", "PAG 12")}.`,
  },
  {
    id: "uy-06-cuentas",
    title: "Transferencias y cuentas",
    renderings: ["mayus"],
    source: `ORDEN DE TRANSFERENCIA ${n("orden", "N° 20250123")}. Ordenante: Ricardo Leites Sánchez, RUT ${rutC("22", N5)}. Beneficiario: Inés Dutra Vera.
      Cuenta de origen BROU ${p("BANK_ACCOUNT", "uy:account-brou", "9+5", "001000321-00004", "acct:321")}; cuenta destino ${p("BANK_ACCOUNT", "uy:account-brou", "9+5", "000987654-00002", "acct:987654")}.
      Monto ${n("monto", "$ 125.000")}, comisión ${n("monto", "$ 450")}. Fecha de valor ${u("DATE", "texto", "5 de agosto de 2025")}.
      Beneficiario, C.I. ${ciNoDv(3456789, "sin DV con contexto")}: la fuente lo trae sin dígito verificador (Cédula ${ciNoDv(4567890, "sin DV con contexto")}).
      RUT de la empresa en otra grafía ${rutS("19", N6, "-", "guiones")} y ${rutSW("21", N7, "-")}.
      Contacto ${p("PHONE", "uy:phone-mobile", "09X 3+3", "094 123 456", tk("59894123456"))}. Matrícula del apoderado ${p("PLATE", "uy:plate", "3l4d", "SBC 4567")}.
      Importe ${n("monto", "$ 2.345.678")}, nº de operación ${n("op", "87654321")}, ${n("cp", "CP 15000")}.`,
  },
  {
    id: "uy-07-ficha",
    title: "Ficha de socios y titulares",
    source: `FICHA DE SOCIOS. Titular: Diego Maidana Rocha, documento ${ciNoDv(2345678, "sin DV con contexto")}, y apoderado: Natalia Pintos Cruz, Cédula ${ciNoDv(5123456, "sin DV con contexto")}.
      Otros datos: Titular ${ciNoDv(5678901, "sin DV sin contexto")} y suplente ${ciNoDv(6789012, "sin DV sin contexto")}.
      Con el verificador completo: ${ciD(6789012)}; ${ciDig(1234567)}; ${ciDig(5123456)}; ${ciDig(4567890, "8 dígitos")}; ${ciDig(987654, "7 dígitos (6+DV)")}.
      Con guion y sin puntos: ${ciGu(3456789)}; ${ciGu(2345678)}.
      Domicilio ${u("ADDRESS", "calle", "Calle Rivera 2020")}. Nacido el ${u("DATE", "numerica-guion", "28-02-1985")}.
      Monto aportado ${n("monto", "$ 1.050.000")}, código de socio ${n("codigo", "1234567")} y ${n("codigo", "12345678")}, ${n("caja", "CAJA 15")}.`,
  },
  {
    id: "uy-08-correo",
    title: "Correo de coordinación",
    renderings: ["minus"],
    source: `hola, les paso mi cédula ${ciD(1234567, "puntos+guion")} y mi rut ${rutS("21", N1, "-", "guiones")}. mi celular es ${p("PHONE", "uy:phone-mobile", "099 sin sep", "099123456", tk("59899123456"))}
      y el fijo ${p("PHONE", "uy:phone-landline", "2901 2345", "2901 2345", tk("59829012345"))}. la reunión es el ${u("DATE", "texto", "9 de julio de 2025")} en ${u("ADDRESS", "bv", "Bv. España 2345")}.
      Adjunto ${n("n", "7654321")}, ${n("n", "123456789")}, ${n("expediente", "IUE 2-54321/2025")}, ${n("monto", "$ 2.500.000")}.
      Mi cuenta ${p("BANK_ACCOUNT", "uy:account-brou", "9+5", "000123456-00001", "acct:123456")}.`,
  },
  {
    id: "uy-09-segunda-medicion",
    title: "Casos sumados en la segunda medición (CI con palabra, tramos de 6 dígitos, matrícula)",
    added: true,
    renderings: ["minus"],
    source: `ACTA DE VERIFICACIÓN. Titular: Mauricio Techera Lemos, cédula de identidad ${ciNoDv(2345678, "sin DV con cédula de identidad")}; suplente: Elena Píriz Cuña, Documento ${ciNoDv(987654, "6 dígitos sin DV con Documento")}.
      Otros datos: CI ${ciNoDv(1234567, "sin DV con CI")} y C.I. ${ciNoDv(3456789, "sin DV con C.I.")}.
      Extranjeros: una persona de Chile con RUT ${n("rut-chileno", "12.345.678-5")} y otra de Argentina con DNI ${n("dni-ar", "12.345.678")}; ${n("dni-ar", "98.765.432")} y ${n("rut-chileno", "76.123.456-0")}.
      Vehículos: matrícula ${p("PLATE", "uy:plate", "3l4d con matrícula", "SDF 8765")}, patente ${p("PLATE", "uy:plate", "3l4d con patente", "KLM 2468")}, moto placa ${p("PLATE", "uy:plate-moto", "3l3d con placa", "ABD 135")}.
      Sin palabra de matrícula figura ${n("codigo-3l4d", "REF 1234")} y ${n("codigo-3l3d", "OCT 123")}. Fecha ${u("DATE", "numerica", "22/11/2025")}.`,
  },
];
