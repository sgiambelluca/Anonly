/**
 * Corpus sintético de Bolivia. Nombres, direcciones, números y placas
 * inventados. La CI no tiene dígito verificador y su número se repite entre
 * personas (informe §11.4): por eso las personas se identifican con
 * número + extensión (`key`), y hay dos personas con el mismo número.
 */

import { n, p, u } from "../lib/dsl.js";
import type { CorpusSource } from "../lib/types.js";

const tk = (digits: string): string => `tel:${digits}`;

/** CI con extensión: `key` = número + extensión de la persona. */
const ciExt = (text: string, shape: string, key: string): string =>
  p("DNI", "bo:ci-ext", shape, text, key);
const ciCtx = (text: string, shape: string, key: string): string =>
  p("DNI", "bo:ci-ctx", shape, text, key);
/** CI con complemento: el Plan §5 no lo mide, la verdad queda sin forma (se informa aparte). */
const ciComp = (text: string, shape: string, key: string): string =>
  p("DNI", "bo:ci-complemento", shape, text, key);
const nit = (text: string, shape: string, key: string): string =>
  p("CUIT", "bo:nit-ctx", shape, text, key);

export const BO_SOURCES: ReadonlyArray<CorpusSource> = [
  {
    id: "bo-01-alquiler",
    title: "Contrato de anticrético",
    renderings: ["mayus", "minus"],
    source: `CONTRATO DE ANTICRÉTICO. En la ciudad de La Paz, a ${u("DATE", "texto", "17 de mayo de 2025")}, entre el señor Marcelo Quispe Mamani,
      con cédula de identidad ${ciExt("1234567 LP", "número + extensión", "ci:1234567-LP")}, domiciliado en ${u("ADDRESS", "avenida", "Avenida Arce 2170")}, zona Sopocachi,
      y la señora Rosario Condori Flores, con C.I. ${ciExt("7654321 SC", "número + extensión", "ci:7654321-SC")}, teléfono
      ${p("PHONE", "bo:phone-mobile", "7123 4567", "7123 4567", tk("59171234567"))}, se acuerda lo siguiente.
      PRIMERO: el monto del anticrético es de ${n("monto", "Bs 120.000")} y la renta de ${n("monto", "Bs. 1.234.567")}.
      SEGUNDO: el NIT del propietario es ${nit("1023456789", "NIT + palabras + número", "nit:1023456789")}; la factura ${n("factura", "N° 123456")} lo consigna.
      TERCERO: vehículo de la inquilina, placa ${p("PLATE", "bo:plate", "4d3l", "1234 ABC")}, parqueo ${n("est", "N° 12")}.
      Piso ${n("piso", "PISO 3")}, ${n("casa", "CASA 2")}, ${n("zona", "ZONA 3")}. Valor referencial ${n("usd", "100 USD")} y ${n("ufv", "2024 UFV")}.
      Firmado el ${u("DATE", "numerica", "17/05/2025")}. Código ${n("codigo", "71234567")}, expediente ${n("exp", "N° 4567/2025")}.`,
  },
  {
    id: "bo-02-escrito",
    title: "Escrito judicial",
    renderings: ["mayus"],
    source: `SEÑOR JUEZ PÚBLICO CIVIL Y COMERCIAL. ${n("exp", "Expediente N° 4567/2025")}. Autos: ${u("PERSON", "dos-apellidos", "Choque Vargas, Pedro")} c/ Empresa Illimani S.R.L.
      Pedro Choque Vargas, C.I. ${ciExt("1234567 SC", "mismo número que otra persona", "ci:1234567-SC")}, con domicilio procesal en ${u("ADDRESS", "calle", "Calle Sucre 345")}, a V.S. digo:
      Que la demandada, con NIT ${nit("4012345678", "NIT + número", "nit:4012345678")}, es representada por Julia Apaza Limachi, C.I. ${ciComp("1234567-1A CB", "con complemento", "ci:1234567-1A-CB")}.
      Testigos: ${ciExt("123456 OR", "6 dígitos", "ci:123456-OR")}, ${ciExt("2345678 PT", "número + extensión", "ci:2345678-PT")}, ${ciExt("3456789 CH", "número + extensión", "ci:3456789-CH")}
      y ${ciExt("4567890 TJ", "número + extensión", "ci:4567890-TJ")}. La notificación de ${u("DATE", "texto-ordinal", "1º de junio de 2025")} fue entregada a ${ciExt("5678901 BN", "número + extensión", "ci:5678901-BN")}
      y a ${ciExt("6789012 PD", "número + extensión", "ci:6789012-PD")}.
      Se ofrece como prueba ${n("art", "ART 123")} y la ${n("ley", "LEY 1178")}, fojas ${n("fojas", "FOJAS 120")}, ${n("n", "7654321")}.
      Resolución del ${u("DATE", "numerica", "21/08/2025")}. Teléfono ${p("PHONE", "bo:phone-landline", "2 7", "2 2123456", tk("59122123456"))}.`,
  },
  {
    id: "bo-03-factura",
    title: "Factura",
    source: `FACTURA ${n("factura", "N° 123456")}. NIT del emisor: ${nit("1234567010", "NIT + palabras + número", "nit:1234567010")}. Razón social: Distribuidora Andina S.A.
      Cliente: Carla Mendoza Rojas, NIT ${nit("4012345678", "NIT: + número", "nit:4012345678")}; otro cliente, N.I.T. ${nit("5023456781", "N.I.T. + número", "nit:5023456781")}.
      Dirección ${u("ADDRESS", "avenida", "Av. 6 de Agosto 2170")}, zona Sopocachi. Fecha ${u("DATE", "numerica", "12/03/2025")}.
      Código de autorización ${n("cuf", "CUF 1234")}, número de control ${n("ctrl", "12-AB-34-CD")}. Total ${n("monto", "Bs 1.234,56")}, detalle ${n("detalle", "3 x Bs 410,00")}.
      NIT ${nit("12345", "NIT corto (5)", "nit:12345")}. Este NIT ${nit("1023456789", "NIT + número", "nit:1023456789")} aparece sin etiqueta en otra línea: ${n("nit-sin-etiqueta", "1023456789")}.
      Contacto ${p("PHONE", "bo:phone-mobile", "+591 71234567", "+591 71234567", tk("59171234567"))} y ${p("PHONE", "bo:phone-mobile", "+591 7 3+4", "+591 7 123 4567", tk("59171234567"))}.
      Pago ${n("pago", "REF 654321")}, ${n("usd", "100 USD")}, ${n("iva", "IVA 13")}%.`,
  },
  {
    id: "bo-04-vehiculo",
    title: "Formulario de vehículo y placa",
    renderings: ["minus"],
    source: `FORMULARIO DE TRANSFERENCIA DE VEHÍCULO. Vendedor: Wilson Colque Tarqui, CI ${ciExt("7654321 SC", "número + extensión", "ci:7654321-SC")}.
      Comprador: Sandra Gutiérrez Ríos, cédula ${ciCtx("3456789", "pelado con contexto", "ci:3456789-CH")}. Placa del auto ${p("PLATE", "bo:plate", "4d3l", "6400-DEF")}, de la camioneta
      ${p("PLATE", "bo:plate", "4d3l", "2345 XYZ")} y del minibús ${p("PLATE", "bo:plate", "4d3l sin sep", "1234ABC")}; vehículo antiguo ${p("PLATE", "bo:plate", "3d3l", "123-ABC")} y ${p("PLATE", "bo:plate", "3d3l sin sep", "987ABC")}.
      Otra placa ${p("PLATE", "bo:plate", "4d3l", "5678 GHJ")}. Teléfono del vendedor ${p("PHONE", "bo:phone-mobile", "6234 5678", "6234 5678", tk("59162345678"))},
      ${p("PHONE", "bo:phone-mobile", "(591)", "(591) 7123 4567", tk("59171234567"))} y ${p("PHONE", "bo:phone-mobile", "591-", "591-7234 5678", tk("59172345678"))}.
      Pegado: ${p("PHONE", "bo:phone-mobile-pegado", "pegado", "71234567", tk("59171234567"))} y ${p("PHONE", "bo:phone-mobile-pegado", "pegado", "62345678", tk("59162345678"))}.
      Fecha ${u("DATE", "numerica", "30/11/2025")}. ${n("km", "100 KMS")}, ${n("usd", "100 USD")}, ${n("ufv", "2024 UFV")}, ${n("lote", "LOTE 123")}.`,
  },
  {
    id: "bo-05-nota",
    title: "Nota con teléfonos y contactos",
    source: `Estimado Sr. Nelson Choque Huanca: sus datos son cédula ${ciComp("7654321-1A", "pelado con complemento", "ci:7654321-SC")}, C.I. ${ciCtx("1234567", "pelado con contexto", "ci:1234567-LP")}
      y CI: ${ciCtx("4567890", "pelado con contexto", "ci:4567890-TJ")}. Su carnet anterior, Nº ${ciCtx("2345678", "pelado con contexto", "ci:2345678-PT")}, y ${ciExt("7654321 L.P.", "extensión con puntos", "ci:7654321-LP")}.
      Teléfonos fijos: ${p("PHONE", "bo:phone-landline", "(2) 3+4", "(2) 212 3456", tk("59122123456"))}, ${p("PHONE", "bo:phone-landline", "+591 2", "+591 2 2123456", tk("59122123456"))},
      ${p("PHONE", "bo:phone-landline", "+591 3", "+591 3 3123456", tk("59133123456"))} y ${p("PHONE", "bo:phone-landline", "(4) 3+4", "(4) 412 3456", tk("59144123456"))}. Sin separador: ${p("PHONE", "bo:phone-landline-pegado", "pegado", "22123456", tk("59122123456"))}.
      Celular ${p("PHONE", "bo:phone-mobile", "7123 4567", "7123 4567", tk("59171234567"))}, ${p("PHONE", "bo:phone-mobile", "+591 71234567", "+591 71234567", tk("59171234567"))}.
      NIT de la empresa ${nit("1020304050", "NIT + palabras + número", "nit:1020304050")}, ${nit("4012345679", "segundo NIT de una lista", "nit:4012345679")}.
      Visítenos en ${u("ADDRESS", "avenida", "Av. Camacho 1485")} o ${u("ADDRESS", "calle", "Calle Comercio 1055")}. Plazo hasta el ${u("DATE", "numerica-guion", "28-02-2025")}.
      Monto ${n("monto", "Bs 5.000")}, ${n("codigo", "1234567")}, ${n("cp", "CP 0000")}, ${n("ley", "LEY 1178")}.`,
  },
  {
    id: "bo-06-acta",
    title: "Acta de asamblea",
    renderings: ["mayus"],
    source: `ACTA DE ASAMBLEA. En Cochabamba, a ${u("DATE", "texto", "2 de septiembre de 2024")}, se reúnen los socios: Mónica Rocabado Arce, CI ${ciExt("8123456 CB", "número + extensión", "ci:8123456-CB")};
      Freddy Aguilar Terrazas, CI ${ciExt("9234567 SC", "número + extensión", "ci:9234567-SC")}; y Ximena Salvatierra Paz, cédula ${ciExt("3456789 CB", "mismo número que otra persona", "ci:3456789-CB")}.
      NIT de la entidad ${nit("1023456780", "NIT + palabras + número", "nit:1023456780")}; NIT del proveedor ${nit("987654321012", "NIT 12 dígitos + palabras", "nit:987654321012")}.
      Domicilio social ${u("ADDRESS", "calle", "Calle Jordán 345")}. Capital ${n("monto", "Bs 100.000")}. ${n("art", "ART 123")}, ${n("dec", "DEC 500")}.
      Placa de la sociedad ${p("PLATE", "bo:plate", "4d3l", "4567-KLM")}. Teléfono ${p("PHONE", "bo:phone-landline", "(4) 3+4", "4 4123456", tk("59144123456"))}.
      Folio ${n("folio", "12345678")}, ${n("fojas", "FOJA 123")}.`,
  },
  {
    id: "bo-07-segunda-medicion",
    title: "Casos sumados en la segunda medición (NIT con relleno, placa, cédula sin Nº)",
    added: true,
    renderings: ["minus"],
    source: `FACTURA ${n("factura", "N° 654321")}. NIT del proveedor: ${nit("4012345680", "NIT + 2 palabras", "nit:4012345680")}. NIT de la empresa emisora: ${nit("1020304051", "NIT + 4 palabras (más de 3)", "nit:1020304051")}.
      NIT vigente, folio ${n("folio-cerca-nit", "1234567")}; NIT, ver factura ${n("factura-cerca-nit", "7654321")}.
      El NIT consta en la factura Nº ${n("factura-lejos-nit", "5432109")} del mes.
      Cliente: Gladys Mamani Cruz, cédula de identidad ${ciCtx("8123456", "pelado con cédula de identidad", "ci:8123456-LP")} y C.I. ${ciCtx("9234567", "pelado con C.I.", "ci:9234567-SC")}.
      Nº de carnet ${n("carnet-nro", "1234567")} y otro Nº ${n("nro", "7654321")} sin palabra de cédula.
      Vehículos: placa ${p("PLATE", "bo:plate", "4d3l con placa", "7890 XYZ")}, patente ${p("PLATE", "bo:plate", "3d3l con patente", "456-QWE")} y dominio ${p("PLATE", "bo:plate", "4d3l con dominio", "3210 RTY")}.
      Sin palabra: ${n("sigla-4d3l", "2024 UFV")}, ${n("sigla-3d3l", "100 USD")}.
      Fecha ${u("DATE", "numerica", "22/11/2025")}.`,
  },
];
