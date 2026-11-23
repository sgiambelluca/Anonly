/**
 * Corpus sintético de Chile. Nombres, direcciones, números y patentes
 * inventados; los verificadores del RUT salen de `checks.ts`.
 */

import { n, p, u } from "../lib/dsl.js";
import { rutDots, rutNoHyphen, rutPlain, rutSpaceDv, rutWithDv, rutWrongDv } from "../lib/gen.js";
import type { CorpusSource } from "../lib/types.js";

/** Cuerpos cuyo dígito verificador es K (calculados, no elegidos a mano). */
const K_BODY_1 = rutWithDv("K", 9_000_000);
const K_BODY_2 = rutWithDv("K", 11_000_000);

const rk = (body: number): string => `rut:${body}`;
const tk = (digits: string): string => `tel:${digits}`;

/** RUT con puntos y guion (forma oficial). */
const rutD = (body: number, shape = "puntos+guion"): string =>
  p("DNI", "cl:rut", shape, rutDots(body), rk(body));
const rutP = (body: number, shape = "sin puntos"): string =>
  p("DNI", "cl:rut", shape, rutPlain(body), rk(body));

export const CL_SOURCES: ReadonlyArray<CorpusSource> = [
  {
    id: "cl-01-arriendo",
    title: "Contrato de arrendamiento",
    renderings: ["mayus", "minus"],
    source: `CONTRATO DE ARRENDAMIENTO DE INMUEBLE.
      En Santiago de Chile, a ${u("DATE", "texto", "17 de mayo de 2025")}, comparecen: por una parte,
      doña Valentina Ortúzar Reyes, cédula de identidad N° ${rutD(14253687)}, domiciliada en
      ${u("ADDRESS", "avenida", "Avenida Providencia 1234")}, comuna de Providencia, en adelante la arrendadora;
      y por la otra don Matías Sepúlveda Cárdenas, RUT ${rutP(18437210)}, teléfono
      ${p("PHONE", "cl:phone-mobile", "+56 9 4+4", "+56 9 8765 4321", tk("56987654321"))}, en adelante el arrendatario.
      PRIMERO: la arrendadora da en arriendo el departamento ${n("depto", "DEPTO 504")} del ${n("piso", "PISO 5")},
      Rol de avalúo ${n("rol-avaluo", "123-45")}, código postal ${n("cp", "7500000")}.
      SEGUNDO: la renta mensual es de ${n("monto", "$450.000")} más ${n("monto", "$1.250.000")} de garantía,
      pagaderos antes del ${u("DATE", "numerica", "05/06/2025")}. El arrendatario declara que su RUT es ${rutD(18437210, "puntos+guion")}.
      TERCERO: el vehículo del arrendatario, patente ${p("PLATE", "cl:plate-4l2d", "4l2d", "BCDF-12")}, usará el estacionamiento ${n("est", "N° 12")}.
      Contrato inscrito bajo el folio ${n("folio", "987654321")} y la ${n("ley", "LEY 18.101")}.
      Firman en señal de aceptación, a ${u("DATE", "numerica", "17/05/2025")}.`,
  },
  {
    id: "cl-02-escrito",
    title: "Escrito judicial",
    renderings: ["mayus"],
    source: `EN LO PRINCIPAL: demanda de cobro de pesos. PRIMER OTROSÍ: acompaña documentos.
      SEGUNDO OTROSÍ: patrocinio y poder. S.J.L. CIVIL DE SANTIAGO.
      Autos: ${u("PERSON", "dos-apellidos", "Barría Núñez, Camila")} c/ Inmobiliaria Los Aromos SpA. Rol ${n("rol", "C-1234-2024")}.
      Camila Barría Núñez, ${rutD(7654321, "cuerpo 7 dígitos")}, domiciliada en ${u("ADDRESS", "pasaje", "Pasaje Los Alerces 456")}, comuna de Ñuñoa,
      a US. respetuosamente digo: la demandada, RUT ${rutD(76123456, "empresa")}, representada por don Felipe Araya Vidal,
      y por su aval, RUT ${p("DNI", "cl:rut", "dv-K", rutDots(K_BODY_1), rk(K_BODY_1))}, adeuda la suma de ${n("monto", "$12.345.678")}
      conforme a la factura ${n("factura", "N° 00012345")} de fecha ${u("DATE", "numerica-punto", "17.05.2025")}.
      Se notificó el ${u("DATE", "texto-ordinal", "1º de junio de 2025")} al correo y al teléfono
      ${p("PHONE", "cl:phone-mobile", "+569 8", "+569 87654321", tk("56987654321"))}.
      POR TANTO, ruego a US. tener por interpuesta la demanda, ${n("causa", "RIT O-123-2025")}, y ${n("ruc", "RUC 2400123456-7")}.
      Sentencia notificada el ${u("DATE", "texto", "21 de Agosto del 2025")}. Fojas ${n("fojas", "FOJAS 120")}, ${n("art", "ART 15")} del Código.`,
  },
  {
    id: "cl-03-factura",
    title: "Factura y boleta",
    source: `FACTURA ELECTRÓNICA ${n("factura", "N° 4521879")}. Emisor: Comercial Andes Limitada, RUT ${rutD(76123456, "empresa")}.
      Giro: venta al por menor. Dirección: ${u("ADDRESS", "avda", "Avda. Apoquindo 4500")}, Las Condes.
      Cliente: Ana María Pizarro Tapia, RUT ${rutD(13579246)}. Fecha de emisión: ${u("DATE", "numerica", "12/03/2025")}.
      Detalle: 3 unidades a ${n("monto", "$12.990")} c/u, subtotal ${n("monto", "$38.970")}, IVA 19% ${n("monto", "$7.404")}.
      Total ${n("monto", "$46.374")}. Código de cliente ${n("codigo", "12345678")} y orden de compra ${n("oc", "OC 7654321")}.
      Contacto de despacho: ${p("PHONE", "cl:phone-mobile", "56 9 4+4", "56 9 2345 6789", tk("56923456789"))}.
      Boleta ${n("boleta", "N° 0001234567")} del ${u("DATE", "abreviada", "17-may-2025")}. Nota: ${n("iva", "IVA 19")} incluido, ${n("utm", "UTM 60")}.
      Pagado con tarjeta, referencia ${n("ref", "REF 654321")}.`,
  },
  {
    id: "cl-04-vehiculo",
    title: "Formulario de revisión técnica y vehículo",
    renderings: ["minus"],
    source: `FORMULARIO DE TRANSFERENCIA DE VEHÍCULO. Vendedor: Rodrigo Henríquez Lagos, RUN ${rutP(12038764, "sin puntos")}.
      Comprador: Daniela Contreras Soto, RUT ${rutD(15362484)}. Vehículo marca Fiat, año 2009, patente
      ${p("PLATE", "cl:plate-4l2d", "4l2d", "GHJK 45")}; el otro vehículo, patente ${p("PLATE", "cl:plate-4l2d", "4l2d", "TTRZ99")},
      queda a nombre del vendedor. Un auto antiguo conserva la patente ${p("PLATE", "cl:plate-2l4d", "2l4d", "AB-1234")}
      y otro ${p("PLATE", "cl:plate-2l4d", "2l4d", "XY 9876")}; su moto, patente ${p("PLATE", "cl:plate-moto-3l2d", "moto 3l2d", "FGH-12")}.
      Revisión técnica vigente hasta el ${u("DATE", "numerica", "30/11/2025")}, planta ${n("planta", "N° 45")}.
      Se acompaña ${n("lote", "LOTE 12")}, ${n("zona", "ZONA 12")} y ${n("bloque", "BLOCK B")}, certificado ${n("cert", "N° 789012")}.
      Fono ${p("PHONE", "cl:phone-mobile-ctx", "pelado", "987654321", tk("56987654321"))}.`,
  },
  {
    id: "cl-05-carta",
    title: "Carta con contactos",
    source: `Estimado Sr. Cristóbal Muñoz Fuentes: junto con saludar, le recordamos que su número de contacto
      ${p("PHONE", "cl:phone-mobile", "+56987654321", "+56987654321", tk("56987654321"))} y el de su oficina
      ${p("PHONE", "cl:phone-landline", "2+8 con prefijo", "+56 2 2345 6789", tk("56223456789"))} figuran en nuestros registros.
      Para consultas llame al ${p("PHONE", "cl:phone-landline", "22 3+4", "22 345 6789", tk("56223456789"))} o al
      ${p("PHONE", "cl:phone-landline", "(02)", "(02) 2345 6789", tk("56223456789"))}. En Valparaíso atiende el
      ${p("PHONE", "cl:phone-landline", "(32) 7", "(32) 2345678", tk("56322345678"))} y en Concepción el
      ${p("PHONE", "cl:phone-landline", "+56 41 7", "+56 41 2345678", tk("56412345678"))}.
      Su RUT ${rutD(21098765, "puntos+guion")} y el de su cónyuge ${rutP(9876543, "sin puntos")} ya fueron verificados.
      Celular alternativo: ${p("PHONE", "cl:phone-mobile", "9 4+4", "9 8765 4321", tk("56987654321"))} o ${p("PHONE", "cl:phone-mobile", "9-4-4", "9-3456-7890", tk("56934567890"))}.
      También, ${p("PHONE", "cl:phone-mobile-parentesis", "(+56)", "(+56) 9 1234 5678", tk("56912345678"))}.
      Atentamente, la Secretaría. Oficio ${n("oficio", "N° 4521")}, ${n("dec", "DEC 30")}, página ${n("pag", "PAG 12")}.
      Resolución del ${u("DATE", "numerica", "03/04/2025")}.`,
  },
  {
    id: "cl-06-acta",
    title: "Acta notarial y poder",
    renderings: ["mayus"],
    source: `ACTA DE CONSTITUCIÓN. En Viña del Mar, a ${u("DATE", "texto", "2 de septiembre de 2024")}, ante el notario público,
      comparecen los socios: Ignacio Valdés Bravo, RUT ${rutD(16890123)}; Francisca Leiva Mora, RUT ${rutP(17250364)};
      y Tomás Escobar Riquelme, RUT ${p("DNI", "cl:rut", "dv-k-minuscula", rutDots(K_BODY_2).replace(/K$/, "k"), rk(K_BODY_2))}.
      Sociedad ${n("sociedad", "SRL 12")}, domicilio en ${u("ADDRESS", "calle", "Calle Huérfanos 1117")} y sucursal en
      ${u("ADDRESS", "camino", "Camino a Melipilla Km 12")}. Capital de ${n("monto", "$5.000.000")} dividido en ${n("cuotas", "100 cuotas")}.
      Inscripción a fojas ${n("fojas", "1234")} número ${n("numero", "5678")}, Conservador de Bienes Raíces, ${n("cp", "2520000")}.
      Poder: don Ignacio confiere poder a Camila Ríos Pérez, ${rutD(24581396)}, quien podrá firmar en su nombre.
      Teléfono de la sociedad: ${p("PHONE", "cl:phone-landline", "(32) 7", "32 234 5678", tk("56322345678"))}.
      Vehículo de reparto, patente ${p("PLATE", "cl:plate-moto-2l3d", "moto 2l3d", "AB-123")}, y la patente ${p("PLATE", "cl:plate-moto-2l3d", "moto 2l3d", "CD 456")};
      motos ${p("PLATE", "cl:plate-moto-3l2d", "moto 3l2d", "PRS 45")} y ${p("PLATE", "cl:plate-moto-3l2d", "moto 3l2d", "JKL90")}.`,
  },
  {
    id: "cl-07-ficha",
    title: "Ficha de personal y verificación",
    source: `FICHA DE PERSONAL. Nombre: Sofía Aguilera Bustos. RUT: ${rutD(19876540)}.
      Si hubo error de tipeo en el formulario se registró RUT ${p("DNI", "cl:rut-ctx", "dv-errado", rutWrongDv(14253687), rk(14253687))}.
      Padre: RUN ${p("DNI", "cl:rut-ctx", "dv-errado", rutWrongDv(8123456), rk(8123456))}. Tutor: R.U.T. ${p("DNI", "cl:rut-ctx", "dv-errado", rutWrongDv(20456789), rk(20456789))}.
      Número sin guion informado por el sistema antiguo: ${p("DNI", "cl:rut-ctx", "pegado", rutNoHyphen(13579246), rk(13579246))};
      otra ficha trae ${p("DNI", "cl:rut-ctx", "pegado", rutNoHyphen(7654321), rk(7654321))} y ${p("DNI", "cl:rut-ctx", "espacio-DV", rutSpaceDv(18437210), rk(18437210))}
      y ${p("DNI", "cl:rut-ctx", "espacio-DV", rutSpaceDv(24581396), rk(24581396))}.
      Celular ${p("PHONE", "cl:phone-mobile-ctx", "pelado", "912345678", tk("56912345678"))}, domicilio en ${u("ADDRESS", "psje", "Psje. Las Rosas 88")}, Puente Alto.
      Antigüedad desde el ${u("DATE", "numerica-punto", "01.03.2020")} hasta el ${u("DATE", "numerica-guion", "28-02-2025")}.
      Sueldo ${n("monto", "$1.050.000")}, código de empleado ${n("codigo", "1234567")}, caja ${n("caja", "CAJA 15")}, tomo ${n("tomo", "TOMO 45")}.
      Folio de la licencia ${n("folio", "A12345678")} y ${n("serie", "ABC123")}.`,
  },
  {
    id: "cl-08-correo",
    title: "Correo de coordinación",
    renderings: ["minus"],
    source: `Hola equipo, les confirmo la reunión del ${u("DATE", "texto", "9 de julio de 2025")}. Mi RUT para el acceso es ${rutP(16890123, "sin puntos")}
      y mi celular ${p("PHONE", "cl:phone-mobile", "9 4+4", "9 6543 2109", tk("56965432109"))}. Mi patente es ${p("PLATE", "cl:plate-4l2d", "4l2d con punto", "WXYZ.34")}, la anterior ${p("PLATE", "cl:plate-4l2d", "BC.DF.12", "BC.DF.12")}
      y la de mi pareja ${p("PLATE", "cl:plate-2l4d", "2l4d", "FP1234")}, además de ${p("PLATE", "cl:plate-2l4d", "2l4d con puntos", "GK.12.34")}.
      Otra forma: ${p("PLATE", "cl:plate-moto-2l3d", "moto 2l3d", "EF.789")}. Llámenme al ${p("PHONE", "cl:phone-landline", "(32) 7", "+56 33 2123456", tk("56332123456"))}.
      Cifras de la reunión: ${n("monto", "$2.500.000")}, ${n("n", "7654321")}, ${n("n", "123456789")}, ${n("expediente", "Expediente 2024-12345")}.
      Adjunto la ${n("ley", "LEY 19628")} y el ${n("dfl", "DFL 25")}, páginas ${n("pag", "PAG 45")}.
      Dirección: ${u("ADDRESS", "avenida", "Avenida Libertador Bernardo O'Higgins 1058")}. Vence el ${u("DATE", "numerica", "15/12/2025")}.`,
  },
  {
    id: "cl-09-segunda-medicion",
    title: "Casos sumados en la segunda medición (RUT con contexto, patentes, fijo de Santiago)",
    added: true,
    renderings: ["mayus"],
    source: `FICHA DE ACTUALIZACIÓN DE DATOS. Titular: Elisa Montenegro Parra, RUT ${p("DNI", "cl:rut-ctx", "sin guion con RUT", rutNoHyphen(17250364), rk(17250364))};
      su cónyuge, RUN ${p("DNI", "cl:rut-ctx", "espacio-DV con RUN", rutSpaceDv(12038764), rk(12038764))}, y el apoderado, RUT: ${p("DNI", "cl:rut-ctx", "sin guion con RUT:", rutNoHyphen(9876543), rk(9876543))}.
      El código interno del expediente es ${n("codigo", "135792462")} y el folio de la causa ${n("folio", "987654321")}; la fecha de actualización es ${u("DATE", "numerica", "14/10/2025")}.
      Vehículos: patente ${p("PLATE", "cl:plate-4l2d-ctx", "otras letras (M, N, Q, A)", "MNQA-12", "plate:MNQA12")}, placa ${p("PLATE", "cl:plate-4l2d-ctx", "otras letras (A, E, I, O)", "AEIO 34", "plate:AEIO34")}
      y patente ${p("PLATE", "cl:plate-4l2d-ctx", "otras letras con punto", "ABCD.56", "plate:ABCD56")}; una más con las letras de la lista, patente ${p("PLATE", "cl:plate-4l2d", "BC.DF.12 con patente", "BC.DF.12")}.
      La moto, dominio ${p("PLATE", "cl:plate-moto-3l2d", "moto 3l2d con dominio", "KLM-45")}, y la otra, placa ${p("PLATE", "cl:plate-moto-3l2d", "moto 3l2d con placa", "RST 67")}.
      Número de Santiago: ${p("PHONE", "cl:phone-landline", "29 345 6789 (2+9, 1+3+4)", "29 345 6789", tk("56293456789"))}; celular, Tel. ${p("PHONE", "cl:phone-mobile-ctx", "pelado con Tel.", "987654321", tk("56987654321"))} y Cel. ${p("PHONE", "cl:phone-mobile-ctx", "pelado con Cel.", "976543210", tk("56976543210"))}.
      Resolución ${n("ley", "LEY 19628")}, ${n("art", "ART 15")}, ${n("monto", "$ 150.000")}.`,
  },
];
