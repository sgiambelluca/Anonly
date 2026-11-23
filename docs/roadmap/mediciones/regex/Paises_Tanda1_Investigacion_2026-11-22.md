# Informe de investigación, tanda 1 (CL, UY, PY, BO y los tipos nuevos de AR)

Campaña 1.1.1, ADR-236 §2. Solo investigación: no se tocó el repo. **La segunda pasada (§11) corrige o completa varias secciones; donde hay una nota «Segunda pasada», manda la nota.**

## 0. Cómo leer este informe

- **Todos los ejemplos son sintéticos.** Los inventé yo. Donde hay dígito verificador lo calculé con un script (fuera del repo) y lo verifiqué contra el algoritmo publicado. Ningún número, nombre o patente sale de una página web.
- **«Sin confirmar»** = no encontré fuente primaria ni secundaria fiable. No inventé reglas.
- Los choques con el catálogo argentino los probé corriendo las `RegExp` de `Regex_Engine.md` («Patrones default») sobre mis ejemplos, sin la guarda de corrida (ADR-075). Son indicios para la medición, no la medición.
- **Estado de las fuentes, en una línea:** lo sólido es el algoritmo del RUT chileno, el de la CI uruguaya, el del RUC paraguayo (descripción de DNIT + código de referencia), el del CBU/CVU (BCRA + código de referencia) y los formatos de patente. Lo débil es todo lo demás (pasaportes, licencias, seguridad social, cuentas, longitud exacta de teléfonos fijos de PY, complemento de la CI de Bolivia).
- Vocabulario de piezas (ADR-220): `chars{digit|letter|upper|lower|alnum, min..max}`, `text`, `separator[" ","-",".","/"] (opt)`, `optional[...]`. Notación abreviada: `d4` = `digit 4..4`, `U3` = `upper 3..3`, `sep?` = separador opcional.
- Máscara propuesta para todos los tipos base: la de ADR-220 §5 (cada letra o dígito pasa a `X`, el resto queda). Se escribe `maskFormat` solo si difiere.

---

## 1. Chile (CL)

### 1.1 Tipos base y nombres

| Tipo | Nombre en la interfaz | Etiqueta corta (ADR-057) | Formatos |
|---|---|---|---|
| `DNI` | RUT | `RUT` | `cl:rut` |
| `CUIT` | (ver duda D-1) | — | ninguno propio |
| `Phone` | Teléfono | `TEL` (o la que use hoy AR; ver duda D-2) | `cl:phone-mobile`, `cl:phone-landline` |
| `License` | sin formato propio | — | ninguno |
| `Plate` | Patente | `PATENTE` | `cl:plate-4l2d`, `cl:plate-2l4d`, `cl:plate-moto-3l2d`, `cl:plate-moto-2l3d` |
| `SocialSecurity` | sin formato propio | — | ninguno (usa el RUT) |
| `Passport` | Pasaporte | `PASAPORTE` | **sin confirmar** |
| `DriverLicense` | sin formato propio | — | ninguno (usa el RUT) |
| `BankAccount` | Cuenta bancaria | `CUENTA` | ninguno recomendado (ver 1.4) |

**Duda D-1 (importante):** en Chile el RUT es a la vez documento de identidad (RUN) y identificación tributaria (RUT). Es **un solo identificador**. Si va a `DNI` no queda nada para `CUIT`, y el tipo `CUIT` no aparecería en los selectores de Chile (ADR-221 §3). Hay que decidir bajo qué tipo base va: `DNI` (como documento) o `CUIT` (como tributario). Mi propuesta: `DNI`, con nombre «RUT». Un RUT de empresa (serie 50.000.000 en adelante) también cae en el mismo formato, y se etiqueta igual. Precedente a revisar: ADR-221 §3 acepta que el nombre sirva para todos los formatos del tipo.

### 1.2 `cl:rut` — RUT / RUN

- **Clase: `control`.** Dígito verificador, módulo 11.
- **Algoritmo exacto** (de derecha a izquierda): multiplicar los dígitos del cuerpo por 2,3,4,5,6,7,2,3,… sumar; `r = 11 − (suma mod 11)`; `r = 11 → "0"`, `r = 10 → "K"`, otro `r → dígito`.
  - Ejemplo de la fuente: cuerpo 30.686.957 → suma 194, `194 mod 11 = 7`, DV 4 → `30.686.957-4`. Lo reproduje.
- **Formas de escribirse:**
  1. `12.345.678-5` (puntos y guion). Es la forma oficial.
  2. `12345678-5` (sin puntos, con guion). Muy común.
  3. `7.654.321-6`, cuerpo de 7 dígitos (cuerpo con 1 dígito delante del primer punto).
  4. DV `K` mayúscula o minúscula: `9.876.543-K`, `…-k`.
  5. Sin guion: `123456785` / `12.345.678 5`. **Sin confirmar** si conviene aceptarla (ver duda D-3).
  6. Con prefijo textual (`RUT 12.345.678-5`, `RUN: …`, `R.U.T.`): el prefijo no es parte del dato.
- **Patrón propuesto:** `\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b` + control. Para la forma 5, ver D-3.
- **Rangos:** personas aprox. 1.000.000 a ~30.000.000; empresas desde 50.000.000. Cuerpos de 6 dígitos o menos, **sin confirmar**; no los cubro.
- **maskFormat:** `XX.XXX.XXX-X` (cada carácter alfanumérico a `X`, puntos y guion quedan).
- **Normalizador:** quitar puntos y espacios, DV en mayúscula → `"12345678-5"`. (Propuesta: conservar el guion para que el cuerpo y el DV no se confundan; decisión de mantenedor.)
- **Generador sintético:** cuerpo aleatorio entre 5.000.000 y 29.999.999 (o 50.000.000–99.999.999 para empresa), DV por el algoritmo, formato `XX.XXX.XXX-D`.
- **Ejemplos que debe detectar** (sintéticos, DV verificado):
  - `12.345.678-5`
  - `12345678-5`
  - `7.654.321-6`
  - `9.876.543-3`
  - `76.123.456-0` (empresa)
  - `13.579.246-2`
  - `5.555.555-9`
  - `1.000.005-K`
- **Ejemplos que NO debe detectar** (casi iguales):
  - `12.345.678-4` (DV incorrecto)
  - `7.654.321-5` (DV incorrecto)
  - `12.345.67-5` (puntos mal)
  - `12.345.678` sin DV (no es RUT; es la forma de un DNI argentino)
  - `123.456.789-0` (cuerpo de 9 dígitos)
  - `12-345-678-5` (guiones en vez de puntos)
- **Fuentes:**
  - https://es.wikipedia.org/wiki/Rol_%C3%9Anico_Tributario (algoritmo, ejemplo, DFL 3 de 1969)
  - SII (emisor del RUT de empresas): https://www.sii.cl
  - Registro Civil (emisor del RUN): https://www.registrocivil.cl
  - No encontré el texto de la norma que fija el algoritmo; el algoritmo es de uso público y coincide en todas las fuentes.

### 1.3 Teléfonos
> **Segunda pasada (§11.7):** la comunicación de Subtel del 27/04/2006 a la UIT (leída entera, versión Word) confirma los **códigos de zona de 2 cifras**: `32 33 34 35 41 42 43 45 51 52 53 55 57 58 61 63 64 65 67 71 72 73 75`, y Santiago `2` (8 cifras). **Es la lista de 2006**: el Plan Técnico Fundamental (DS 747/1999, art. 11) permite a Subtel modificar los códigos por resolución, y no pude ver si cambió. Móvil: código virtual `9` + 8 cifras. Mi lista de §1.3 pasa a **confirmada con fuente primaria de 2006**.


Todos los números de Chile tienen **9 dígitos nacionales** (+56). No hay prefijo troncal. Sin código de área geográfico: desde 2016, Santiago es `2` + 8 dígitos (se renumeró en 2012–2016), y las regiones tienen código de 2 dígitos + 7 dígitos. Los celulares son `9` + 8 dígitos.

**`cl:phone-mobile` — Celular**
- Clase: `structure`, **si se acepta un grupo con separadores obligatorio en la variante sin prefijo**. Si el mantenedor quiere cubrir `987654321` pelado, pasa a `control` con contexto por la colisión (ver choques).
- Formas: `+56 9 8765 4321`, `+569 87654321`, `+56987654321`, `56 9 8765 4321`, `9 8765 4321`, `9-8765-4321`, `98765 4321`, `(+56) 9 8765 4321`, `987654321`.
- Piezas propuestas (4 variantes):
  1. `text "+56"`, `sep?[" ","-"]`, `text "9"`, `sep?[" ","-"]`, `d4`, `sep?[" ","-"]`, `d4`
  2. `text "56"`, `sep[" ","-"]` (obligatorio), `text "9"`, `sep?`, `d4`, `sep?`, `d4`
  3. `text "9"`, `sep[" ","-"]` (obligatorio), `d4`, `sep[" ","-"]` (obligatorio), `d4`
  4. `text "9"`, `sep[" ","-"]` (obligatorio), `d8`
  - Los paréntesis `(+56)` no son separadores del generador. Quedan sin cubrir salvo que se agregue `text "("`. Sin confirmar si se quiere.
- maskFormat: `+XX X XXXX XXXX` según lo escrito. Normalizador: quitar no-dígitos, anteponer `56` si falta → `56987654321`.
- Generador: `+56 9 ` + 8 dígitos (primer dígito 5–9 para evitar formas raras; no hay regla oficial, sin confirmar).
- Detectar: `+56 9 8765 4321`, `+569 87654321`, `56 9 2345 6789`, `9 8765 4321`, `9-3456-7890`.
- No detectar: `+56 7 8765 4321`, `9 8765 432`, `+56 9 8765 43210`, `98 7654 321 0`, `+56 9 8765`.
- Fuentes: https://en.wikipedia.org/wiki/Telephone_numbers_in_Chile (9 dígitos, renumeración de Santiago); plan de numeración de Subtel (https://www.subtel.gob.cl), **no pude abrir el texto oficial**.

**`cl:phone-landline` — Teléfono fijo**
- Clase: `control` (lista de códigos de área).
- Códigos de área de 2 dígitos (regiones): `32, 33, 34, 35, 41, 42, 43, 45, 51, 52, 53, 55, 57, 58, 61, 63, 64, 65, 67, 71, 72, 73, 75`. **Lista armada de memoria y de la renumeración; sin confirmar con Subtel.** Santiago: `2`.
- Formas: `22 345 6789`, `2 2345 6789`, `+56 2 2345 6789`, `(2) 2345 6789`, `(02) 2345 6789` (forma antigua), `32 234 5678`, `(32) 2345678`, `+56 32 2345678`.
- Patrón propuesto: `(?:(?:\+?56[\s-]?)?(?:\(0?2\)|2)[\s-]?\d{4}[\s-]?\d{4}|(?:\+?56[\s-]?)?\(?(?:3[2-5]|4[1-35]|5[1-3578]|6[1345 7]|7[1235])\)?[\s-]?\d{3}[\s-]?\d{4})` (esquema; el patrón exacto va al spec).
- Detectar: `22 345 6789`, `+56 2 2345 6789`, `(32) 234 5678`, `+56 41 2345678`.
- No detectar: `29 345 6789` (código inexistente, **si la lista se confirma**), `22 345 678`, `2 2345 67890`, `(2) 2345`.
- Generador: código de la lista + abonado de 7 u 8 dígitos según el código.
- Fuente: igual que arriba.

### 1.4 Patente — `Plate`
> **Segunda y tercera pasada (§11.7): formato nuevo, con fuente oficial.** Decreto supremo 114 de 2025 del MTT (firmado 25/09/2025, Diario Oficial n.º 44.350 del 16/01/2026, CVE 2754777; **leído entero**; modifica el DS 53/1984). (a) Los autos y otros de 4 o más ruedas pasan de **4 letras + 2 dígitos** a **5 letras + 1 dígito**; los de 2 o 3 ruedas, de **3 letras + 2 dígitos** a **4 letras + 1 dígito**, «dispuestos de izquierda a derecha, en el mismo orden» (letras y después el dígito). (b) **Es una sustitución diferida:** rige «una vez que el Registro Civil determine, mediante el acto administrativo respectivo, que las combinaciones [actuales] se encuentran agotadas». **El decreto no fija fecha de inicio**, y no vi ese acto administrativo. Hoy **no hay evidencia de que se emitan**. (c) **Convivencia:** el decreto no dice que las placas existentes se reemplacen; solo cambia la combinación que se asigna cuando se agoten las actuales. Que las de 4 letras + 2 dígitos sigan circulando es lo coherente, pero **no lo dice el texto**: sin confirmar. (d) **Letras excluidas: el decreto no las menciona**, ni dice «consonantes»; la lista de 18 consonantes sigue sin fuente primaria. (e) **Corrección:** el «17/07/2026» de La Tercera NO es la fecha de las placas nuevas. Es el día en que se hace exigible la **patente verde** (fondo verde para eléctricos e híbridos enchufables), 180 días corridos después de la publicación. Mi nota anterior, que lo tomaba como fecha de emisión, estaba equivocada. Propongo, sujeto a D-4: `cl:plate-5l1d` (`U5, sep?, d1`) y `cl:plate-moto-4l1d` (`U4, sep?, d1`), **como formatos de reserva, sin ejemplos reales circulando**. Ojo, además: la moto vigente es **3 letras + 2 dígitos** (el DS 114 lo confirma como combinación actual de 2 o 3 ruedas), que ya está en la tabla. La separación en el texto (guion, espacio, ninguna) **no la fija el decreto**.


Fuente principal: https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Chile. **No encontré la norma de Registro Civil** que fija las letras permitidas.

| Id | Qué es | Forma | Clase |
|---|---|---|---|
| `cl:plate-4l2d` | Autos desde sept. 2007 | 4 letras + 2 dígitos | `control` (letras restringidas) |
| `cl:plate-2l4d` | Autos 1985–2007, siguen circulando | 2 letras + 4 dígitos | `structure` |
| `cl:plate-moto-3l2d` | Motos desde 2014 | 3 letras + 2 dígitos | `structure` |
| `cl:plate-moto-2l3d` | Motos hasta 2014 | 2 letras + 3 dígitos | `structure` |

- **`cl:plate-4l2d`:** letras usadas: `B C D F G H J K L P R S T V W X Y Z` (18, sin vocales ni M, N, Q). Formas: `BCDF-12`, `BCDF 12`, `BCDF12`, `BC·DF·12` (con punto medio, así se imprime; en un documento aparece como `BC.DF.12` o `BCDF-12`). Patrón: `\b[BCDFGHJKLPRSTVWXYZ]{4}[\s.-]?\d{2}\b`. **Elegí `control` por la restricción de letras:** sin ella chocaría con encabezados en mayúscula como `LOTE 12` o `ZONA 12` (no se pueden dar vocales). Alternativa `structure` (`U4, sep?, d2`): más editable, más falsos positivos. A medir.
  - Detectar: `BCDF-12`, `GHJK 45`, `TTRZ99`, `XYZW-10`.
  - No detectar: `LOTE 12`, `BCDF-123`, `BCD-12`, `ABCD-12` (vocales), `BCDF-1`.
- **`cl:plate-2l4d`:** `AB-1234`, `AB 1234`, `AB1234`, `AB·12·34` → `AB.12.34`, `AB-12-34`. Piezas: variante 1: `U2, sep?[" ","-","."], d4`; variante 2: `U2, sep?[" ","-","."], d2, sep[" ","-","."], d2`. Detectar: `AB-1234`, `XY 9876`, `FP1234`, `GK.12.34`. No detectar: `AB-123`, `ABC-1234`, `AB-12345`, `A-1234`. Restricción de letras del formato viejo: **sin confirmar**.
- **`cl:plate-moto-3l2d`:** `BBB-12`, `BBB 12`, `BBB12`. `U3, sep?, d2`. Letras restringidas: sin confirmar. Detectar: `FGH-12`, `PRS 45`, `JKL90`. No detectar: `FGH-123`, `FG-12`, `FGHI-12`.
- **`cl:plate-moto-2l3d`:** `AB·123`. `U2, sep?[" ","-","."], d3`. Detectar: `AB-123`, `CD 456`, `EF.789`. No detectar: `AB-1234` (es `plate-2l4d`), `A-123`, `ABC-123`.
- **Remolques livianos y placas municipales previas:** 3 letras + 3 dígitos (`ABC-123`), rojo sobre blanco. **Es exactamente `plate-vieja-ar`.** No lo agrego como formato de CL: queda sin cubrir o se cubre con «agregar desde otro país». Decisión (D-4).
- Placas especiales (`PR` provisoria, `CD` diplomática, `RP` Carabineros, `CB`): no entran.
- Nombre en interfaz: «Patente». Etiqueta `PATENTE`. Un solo nombre sirve para los cuatro formatos.
- Generador: elegir formato al azar ponderado (4l2d 70 %, 2l4d 20 %, moto 10 %), letras del conjunto respectivo; el valor sintético del grupo conserva su formato (ADR-072).
- maskFormat: `XXXX-XX`, `XX-XXXX`, etc. según lo escrito.
- Normalizador: mayúsculas, quitar separadores (como `plate-*-ar`).

### 1.5 Matrícula profesional, seguridad social, licencia de conducir, cuenta bancaria, pasaporte

- **License:** no encontré un número de matrícula profesional nacional con forma propia. Los colegios profesionales (Colegio Médico, etc.) tienen registros propios; **sin confirmar**. Sin formato.
- **SocialSecurity:** AFP, Fonasa e Isapre identifican por RUT. **Sin fuente primaria leída**; sin formato propio.
- **DriverLicense:** según una modificación del decreto 170 (resumen del buscador, **no lo leí**), la ficha dice «RUN / Nº DE LICENCIA». Lo que sí leí (Diario Oficial 24/02/2017, decreto 23 de 2000 modificado): el documento tiene un campo **«Nº DE LICENCIA»** y un **folio alfanumérico** asignado por el municipio, cuya forma fija una resolución del MTT que no encontré. La forma «hasta 3 letras + 10 dígitos» del buscador **no está** en el decreto de enero de 2025 que abrí: **sin confirmar**. Sin formato propuesto.
- **BankAccount:** BancoEstado CuentaRUT = RUT sin DV (7 u 8 dígitos): https://www.chileatiende.gob.cl/fichas/70638-cuenta-rut-bancoestado (resumen). Los demás bancos: sin norma. **No recomiendo un formato.**
- **Passport: confirmado en parte.** Resolución exenta 467 del Registro Civil (26/11/2024, Diario Oficial 07/12/2024; leída entera con `pdftotext`): el número de pasaporte tiene **9 caracteres alfanuméricos**, igual que en la línea inferior de la MRZ, y es distinto del RUN, que va en otro campo. **La norma no dice qué posiciones son letras.** Estructura: sin confirmar.

### 1.6 Identificadores fuera de los nueve tipos (no van al catálogo)

- Rol de causa judicial (`C-1234-2024`, `RIT`, `RUC` penal): **sin confirmar** la forma exacta.
- Rol de avalúo / rol de propiedad (SII) `123-45`.
- Número de serie / de documento de la cédula (9 dígitos): **sin confirmar**.
- Folio de licencia / de certificado.
- Patente comercial (municipal).
- RUT de empresa ya está en `cl:rut`.

---

## 2. Uruguay (UY)

### 2.1 Tipos base y nombres

| Tipo | Nombre en la interfaz | Etiqueta corta | Formatos |
|---|---|---|---|
| `DNI` | CI (Cédula de identidad) | `CI` | `uy:ci` |
| `CUIT` | RUT (DGI) | `RUT` | `uy:rut` |
| `Phone` | Teléfono | `TEL` | `uy:phone-mobile`, `uy:phone-landline` |
| `License` | sin formato propio | — | — |
| `Plate` | Matrícula | `MATRICULA` | `uy:plate`, `uy:plate-moto` |
| `SocialSecurity` | sin formato propio | — | — (BPS usa la CI; **sin confirmar con ficha**) |
| `Passport` | Pasaporte | `PASAPORTE` | **sin confirmar** |
| `DriverLicense` | sin formato propio | — | — (el permiso se identifica por la CI o el pasaporte; fuente: decreto 2017/06 PUNC, ver 2.5) |
| `BankAccount` | Cuenta | `CUENTA` | `uy:account-brou` (solo BROU) |

Nota de nomenclatura: en Uruguay la patente se llama «matrícula». La etiqueta de AR para `License` es `MATRICULA` (profesional). Choque de nombres en la escalera (ADR-057): si UY no tiene `License`, el nombre `MATRICULA` queda libre para `Plate`; si hubiera `License` en UY habría que desambiguar. **Duda D-5.**

### 2.2 `uy:ci` — Cédula de identidad
> **Segunda pasada (§11.5):** el decreto 501/1978 (leído en impo.com.uy) dice que el número es **correlativo desde el uno** más un **dígito verificador por módulo 10**. **No da los pesos**; los pesos `2,9,8,7,6,3,4` siguen saliendo de calculadoras y librerías de terceros.


- **Clase: `control`.**
- **Algoritmo exacto:** tomar los 7 dígitos del cuerpo (si el cuerpo tiene 6, anteponer un `0`). Pesos `2,9,8,7,6,3,4`, de izquierda a derecha. `DV = (10 − (suma mod 10)) mod 10`.
  - Verificación: cuerpo 1.234.567 → suma 2·1+9·2+8·3+7·4+6·5+3·6+4·7 = 148 → DV 2. Cuerpo `987654` (6 dígitos → `0987654`) → DV 9.
- **Formas:** `1.234.567-2`, `1234567-2`, `12345672`, `123.456-1` (6 dígitos, 1 DV), `CI 3.456.789-4`, y la forma sin DV `1.234.567` (aparece en escritos). Prefijo `C.I.`, `CI`, `Cédula` no es parte del dato.
- **Patrón:** `\b(?:\d\.?\d{3}\.?\d{3}|\d{3}\.?\d{3})-?\d\b` + control. La forma `12345672` sin puntos ni guion es 8 dígitos pegados: **solo se acepta con control válido** (10 % de falsos pasa el DV). Y la forma sin DV (`1.234.567`) es exactamente la de un DNI argentino; no se puede validar. **Duda D-6.**
- **maskFormat:** `X.XXX.XXX-X`. **Normalizador:** quitar puntos, guion y espacios → `"12345672"` (7 + DV).
- **Generador:** cuerpo de 6 o 7 dígitos (6 dígitos 10 %), primer dígito 1–9, DV por el algoritmo.
- Detectar (sintéticos): `1.234.567-2`, `3.456.789-4`, `5.123.456-1`, `2345678-3`, `987.654-9`, `4.567.890-5`.
- NO detectar: `1.234.567-3` (DV incorrecto), `1.234.56-2`, `12.345.678-2` (cuerpo 8 dígitos), `1,234,567-2`.
- Fuentes: ley 14.762 y decreto 501/1978 (módulo 10): https://impo.com.uy/bases/decretos/501-1978 (**el texto consultado no detalla los pesos**); los pesos salen de https://hacecuentas.com/uy/validar-cedula, https://pypi.org/project/cedula-uruguaya/ y https://github.com/picandocodigo/ci_uy.cr, no de la norma. Fuente primaria de los pesos: **sin confirmar**.
- **Advertencia:** el DV se puede calcular para cualquier número; solo detecta errores de tipeo.

### 2.3 `uy:rut` — RUT (DGI)
> **Segunda pasada (§11.5):** la DGI **reservó por 15 años** el algoritmo del dígito verificador y la composición del RUT (Resolución UAIP 145/2024, leída entera). El algoritmo de este apartado y la regla «serie 01–22, tipo 001» **no tienen fuente oficial**; salen de python-stdnum.


- **Clase: `control`.**
- **Estructura:** 12 dígitos = 2 de serie (01–22), 6 de número, 3 de «tipo» (`001`), 1 DV. DGI y otras fuentes confirman los 12 dígitos y el DV al final. Las reglas de serie `01–22` y `001` salen del código de referencia python-stdnum (https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/uy/rut.py), **no de DGI**; sin confirmar con DGI.
- **Algoritmo (python-stdnum):** pesos `4,3,2,9,8,7,6,5,4,3,2` sobre los 11 primeros dígitos; `DV = (−suma) mod 11`. Si da `10`, el número es inválido (no se emite). **Sin fuente oficial**: la DGI no publicó el algoritmo en lo que pude abrir (https://www.gub.uy/ministerio-economia-finanzas/sites/ministerio-economia-finanzas/files/2024-04/Expediente-2024-5-1-0002222%20Francisco%20Xavier.pdf es un pedido de acceso a esa información).
- **Formas:** `212345670015` (continuo, la más usada), `21 234567 001 5`, `21-234567-001-5`; **cómo lo escribe un documento real: sin confirmar** (pueden aparecer agrupaciones distintas).
- Patrón: `\b\d{2}[\s.-]?\d{6}[\s.-]?001[\s.-]?\d\b` + control.
- maskFormat: `XXXXXXXXXXXX`. Normalizador: quitar no-dígitos.
- Generador: serie `21` (o la que se elija 01–22), 6 dígitos, `001`, DV.
- Detectar: `212345670015`, `21 000123 001 8`, `213456780011`, `21-111111-001-5`.
- NO detectar: `212345670014` (DV), `212345670025` (tipo ≠ 001), `232345670015` (serie 23), `21234567001` (11 dígitos).
- Nota: un RUT de 12 dígitos también es el «número de documento de empresa».

### 2.4 Teléfonos

Fuente: https://en.wikipedia.org/wiki/Telephone_numbers_in_Uruguay. Plan de numeración de URSEC: sin abrir. Sin confirmar con URSEC.

- **`uy:phone-mobile`** — `control`. Celular: `09X XXX XXX` (nueve dígitos con el `0`), prefijos `091`–`099`. Desde el exterior: `+598 9X XXX XXX` (sin el 0). Formas: `099 123 456`, `099123456`, `+598 99 123 456`, `+598 099 123 456` (error común, tolerar), `(+598) 99 123 456`, `99 123 456` (sin sentido sin 0; sin confirmar).
  - Patrón: `(?:(?:\+|00)?598[\s-]?)?(?:0?9[1-9])[\s-]?\d{3}[\s-]?\d{3}\b`; sin prefijo se exige el `0` (para no capturar `99 123 456`).
  - Detectar: `099 123 456`, `+598 99 123 456`, `091234567`, `+598 94 234 567`.
  - No detectar: `099 123 45`, `+598 88 123 456`, `098 123 4567`, `09 123 456`.
- **`uy:phone-landline`** — `control`. Montevideo `2XXX XXXX` (8 dígitos, empieza en 2). Interior `4XXX XXXX` (la ciudad queda dentro). Formas: `2901 2345`, `29012345`, `+598 2901 2345`, `2901 23 45`, `(02) 901 2345` (antigua, hasta 2010), `4332 1234`.
  - **Colisión fuerte:** 8 dígitos pegados que empiezan en 2 o 4 son lo mismo que una CI con DV pegado (`2345678-3` → `23456783`). Propuesta: sin prefijo, exigir al menos un separador; con prefijo, aceptar todo.
  - Detectar: `2901 2345`, `+598 2901 2345`, `4332 1234`, `2 901 2345`.
  - No detectar: `3901 2345`, `2901 234`, `+598 2901 23456`.
- **Generador:** celular `09` + `[1-9]` + 6 dígitos; fijo `2` + 7 dígitos (Montevideo, 70 %) o `4` + 7 dígitos.

### 2.5 Matrícula (patente) — `Plate`

Fuente: https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Uruguay. No hallé la norma (decreto/ley).

- **`uy:plate`** (`structure`): 3 letras + 4 dígitos. Vigente desde 2001 (acuerdo de intendentes, con Montevideo desde 2001–2002) y en formato Mercosur desde 2015 (obligatorio 2016). La primera letra identifica al departamento (A Canelones, B Maldonado, C Rocha, D Treinta y Tres, E Cerro Largo, F Rivera, G Artigas, H Salto, I Paysandú, J Río Negro, K Soriano, L Colonia, M San José, N Flores, O Florida, P Lavalleja, Q Durazno, R Tacuarembó, S Montevideo).
  - Piezas: `U3, sep?[" ","-"], d4`. Formas: `SAB 1234`, `SAB1234`, `SAB-1234`.
  - Restringir a primera letra A–S: no es expresable en `structure`. No lo propongo.
  - Detectar: `SAB 1234`, `ABC-1234`, `HAA1000`, `BAE 5678`.
  - No detectar: `SAB 12345`, `SA 1234`, `SAB 123` (eso es moto), `SABC 1234`.
- **`uy:plate-moto`** (`structure`): 3 letras + 3 dígitos (`ABC 123`). **Es idéntico a `plate-vieja-ar` y a la patente vieja de PY.** `U3, sep?[" ","-"], d3`.
- **Maldonado 1992–2019** (`B 123·456`): una letra + 6 dígitos con punto medio. **Sin confirmar** cómo se escribe en documentos; no lo propongo.
- Nombre en interfaz: «Matrícula». Etiqueta `MATRICULA` (ver D-5).
- Generador: primera letra A–S; 3 letras + 4 dígitos.

### 2.6 Cuenta bancaria, pasaporte, licencia, seguridad social

- **`uy:account-brou`** (`structure`, solo BROU): 9 dígitos + guion + 5 dígitos (`001554581-00050`); los de menos dígitos se completan con ceros a la izquierda. Fuentes: https://www.brou.com.uy/clientes-empresa/agro/comercio-exterior/transferencias-al-exterior (9 de cuenta + 5 de subcuenta) y https://www.gub.uy/ministerio-economia-finanzas/comunicacion/noticias/nuevo-numero-cuenta-brou. Las fuentes del BROU **no son coherentes entre sí** (también hay un formato de 12 dígitos para el SPI). Piezas: `d9, sep["-"], d5`. Otros bancos uruguayos: **sin confirmar**. Detectar: `000123456-00001`, `001000321-00004`, `000987654-00002`. No detectar: `000123456-0001`, `00012345-00001`, `000123456-000001`.
- **Passport:** formato sin fuente primaria legible. El número cambia al renovar. **Sin confirmar**; ver §11.1.
- **DriverLicense: corrijo.** El formato unificado del MTOP lista un **«Número de licencia de conducir»** (campo a2) y un **«Número de carnet»** (b11), **distintos** del número de cédula (a5): https://www.gub.uy/ministerio-transporte-obras-publicas/sites/ministerio-transporte-obras-publicas/files/2021-04/ANEXO%2020%20-%20LICENCIA%20DE%20CONDUCIR.pdf (leído entero con `pdftotext`). **Su forma no figura.** Sin formato; D-12. (El decreto 2017/06 sobre el PUNC, citado antes, no lo leí.)
- **SocialSecurity (BPS):** según páginas del BPS la cédula es el documento principal y el acceso es por «usuario personal»; ningún número de afiliado aparte. Son páginas informativas, no norma. **Sin confirmar** como regla.
- **License:** sin formato propio hallado. **Sin confirmar.**

### 2.7 Fuera de los nueve tipos

Padrón (inmueble y vehículo, número simple), número de libreta de propiedad / título del vehículo, número de afiliado de mutualista, número de historia clínica, número de expediente del Poder Judicial (`IUE 2-12345/2024`), número de caja profesional. Todos **sin confirmar** la forma.

---

## 3. Paraguay (PY)

### 3.1 Tipos base y nombres

| Tipo | Nombre | Etiqueta | Formatos |
|---|---|---|---|
| `DNI` | Cédula | `CI` | `py:ci`, `py:ci-ctx` |
| `CUIT` | RUC | `RUC` | `py:ruc` |
| `Phone` | Teléfono | `TEL` | `py:phone-mobile`, `py:phone-landline` |
| `License` | sin formato propio | — | — |
| `Plate` | Chapa | `CHAPA` | cuatro formatos (3.5) |
| `SocialSecurity` | sin formato propio | — | — (IPS usa la CI; **sin confirmar**) |
| `Passport` | Pasaporte | `PASAPORTE` | **sin confirmar** |
| `DriverLicense` | sin formato propio | — | — **sin confirmar** |
| `BankAccount` | sin formato propio | — | **sin confirmar** |

En Paraguay la patente se llama «chapa» (uso local, sin fuente). Etiqueta `CHAPA` o `PATENTE`: decisión de interfaz.

### 3.2 `py:ci` y `py:ci-ctx` — Cédula de identidad

- **Sin dígito verificador.** El número es correlativo (no secuencia con control). **Longitud exacta: sin confirmar** (hasta 7 dígitos en lo que vi; las más antiguas tienen menos). Fuente: https://es.wikipedia.org/wiki/C%C3%A9dula_de_identidad_(Paraguay) no da el formato; **no encontré fuente oficial del formato**.
- Escritura típica: `1.234.567` (puntos de miles), `1234567`, `C.I. N° 1.234.567`, `CI 1234567`, `CIC 1.234.567`. Extranjeros con cédula paraguaya siguen la misma regla (DNIT).
- **`py:ci` (`structure`):** variante 1: `d1, sep["."], d3, sep["."], d3` (7 dígitos con puntos obligatorios); variante 2: `d3, sep["."], d3` (6 dígitos con punto obligatorio). Detectar: `1.234.567`, `4.567.890`, `987.654`, `2.345.678`. No detectar: `1234567` (pelado), `12.345.678`, `1.23.567`, `1.234.5678`.
- **`py:ci-ctx` (`structure` con `contextBefore`):** `d5..8`, contexto `["C.I.", "CI", "CIC", "cédula", "Nº"]` (5 palabras máximo). Detectar: `C.I. 1234567`, `CI: 987654`, `cédula 2345678`. No detectar: `1234567` solo, `CI 12`, `teléfono 1234567`.
- **Choque directo:** `py:ci` con puntos es la misma forma que `dni-ar` de 7 dígitos.
- maskFormat `X.XXX.XXX`; normalizador: quitar puntos → `"1234567"`.
- Generador: entre 500.000 y 7.999.999, escrito con puntos.

### 3.3 `py:ruc` — RUC (identificación tributaria)

- **Clase: `control`.** Estructura `<cuerpo>-<DV>`. Persona física: cédula + DV. Empresas: serie 80.000.000+. Refugiados: serie 50.000.000+. Según DNIT, RG 133/23 (https://www.dnit.gov.py/web/portal-institucional/w/rg-133/23): «el identificador será el número de la cédula» + DV.
- **Algoritmo (de derecha a izquierda):** pesos `2,3,4,5,6,7,8,9,…` (la fuente DNIT dice «hasta 11 y vuelve a 2»; con cuerpos de 8 dígitos como máximo los pesos no pasan de 9); `r = (11 − (suma mod 11))`; si `suma mod 11` es 0 o 1 → DV `0`; si no → `11 − (suma mod 11)`.
  - Verificación: ejemplo de la fuente `80000519-8`: DV 8 (reproducido). Mis sintéticos: cuerpo `80012345` → 7; `1234567` → 9; `2345678` → 0.
  - **Dos detalles sin confirmar con fuente oficial:** cómo mapea el resto 0/1 (lo tomo del código de referencia python-stdnum, https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/py/ruc.py) y la existencia de RUC antiguos que terminan en letra (una sola fuente, no oficial).
- **Formas:** `80012345-7`, `1234567-9`, `1.234.567-9` (cédula con puntos más DV, **sin confirmar**), `RUC 80012345-7`. Sin guion: **no la propongo**.
- Patrón: `\b\d{1,2}\.?\d{3}\.?\d{3}-\d\b` o `\b\d{5,8}-\d\b` + control (DV).
- maskFormat: `XXXXXXXX-X`. Normalizador: quitar puntos, conservar guion → `"80012345-7"`.
- Generador: 8 dígitos serie 80.000.000+ (empresa) o 5 a 7 dígitos (persona) + DV.
- Detectar: `80012345-7`, `1234567-9`, `2345678-0`, `80099900-2`, `4123456-1`, `800999-6`.
- No detectar: `80012345-8` (DV), `80012345` (sin DV), `80012345-77`, `8001234567`.
- **Choque interno:** `1.234.567-9` contiene `py:ci` (`1.234.567`) y ambos tipos distintos (`DNI` y `CUIT`) → conflicto de ADR-222, no resolución «mismo tipo, más largo».

### 3.4 Teléfonos
> **Segunda pasada (§11.8):** el plan de CONATEL (31/05/2002, leído en su versión de la UIT, parcial) fija **9 cifras nacionales** para fijos y móviles. Código de área de 2 o 3 cifras (`21` Asunción, `61` Ciudad del Este, `541` Villarrica), por lo que **Asunción es 21 + 7 cifras** (`021 XXX XXXX`) y los códigos de 3 cifras llevan 6. Móviles: `9` + 8 cifras, series `96x`, `97x`, `98x`, `99x`. Corrijo `021 123 456`: es un fijo de Asunción de 6 cifras, que **no** cumple el plan de 2002. El plan puede haberse actualizado después (la UIT anunció una actualización en 2021, que no vi).


Fuente: https://en.wikipedia.org/wiki/Telephone_numbers_in_Paraguay. Plan de numeración de CONATEL: sin abrir. **Longitud de fijos sin confirmar** (la fuente dice «9 dígitos, código de área de 2 o 3 dígitos, abonado de 6 o 7»).

- **`py:phone-mobile`** — `control`. `09XX XXX XXX` (diez dígitos con el 0), internacional `+595 9XX XXX XXX`. Prefijos de operadora (sin valor para formato): 961/963 VOX, 971–976 Personal, 981–985 Tigo, 991–995 Claro. Formas: `0981 123 456`, `0981123456`, `0981-123-456`, `(0981) 123 456`, `+595 981 123 456`, `+595981123456`, `981 123 456`. Patrón: `(?:(?:\+|00)?595[\s-]?)?\(?0?9\d{2}\)?[\s-]?\d{3}[\s-]?\d{3}\b`; sin prefijo se exige el `0`.
  - Detectar: `0981 123 456`, `+595 971 234 567`, `0991-234-567`, `(0961) 234 567`.
  - No detectar: `0881 123 456`, `0981 123 45`, `+595 81 123 456`.
- **`py:phone-landline`** — `control`. Asunción `(021) XXX XXX` y variantes de 6–7 dígitos; interior con código de 2–3 dígitos (`061` Ciudad del Este, `071` Encarnación, `031` Concepción, `036` Pedro Juan Caballero). Formas: `(021) 123 456`, `021 123 456`, `021-123-4567`, `+595 21 123 456`. **Longitud del abonado en Asunción: sin confirmar.**
  - Patrón esquemático: `(?:(?:\+|00)?595[\s-]?)?\(?0?[2-8]\d{1,2}\)?[\s-]?\d{3}[\s-]?\d{3,4}`. Lista de códigos: no armada; sin confirmar.
- Generador: celular `09` + prefijo de la lista + 6 dígitos; fijo `021` + 6 o 7 dígitos.

### 3.5 Chapa — `Plate`

Fuente: https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Paraguay (su propia nota advierte inconsistencias; verificar con la autoridad).

| Id | Forma | Vigencia | Clase |
|---|---|---|---|
| `py:plate-3l3d` | `ABC 123` | 2000–2019 | `structure`: `U3, sep?[" ","-"], d3` |
| `py:plate-moto-3d3l` | `123 ABC` | motos 2000–2019 | `structure`: `d3, sep?[" ","-"], U3` |
| `py:plate-mercosur` | `ABCD 123` | desde 1/7/2019 | `structure`: `U4, sep?[" ","-"], d3` |
| `py:plate-moto-mercosur` | `123 ABCD` | desde 2019 | `structure`: `d3, sep?[" ","-"], U4` |

- Anterior (1982–2000): letra + 6 dígitos (`A 123456`). Se cubre con `U1, sep?, d6`, que es muy laxo. **No lo propongo** (D-4).
- Series diplomáticas `CD`, `CC`, `MOE` + 6 dígitos: fuera.
- Detectar: `ABC 123`, `HJK-456`, `ABCD 123`, `BCDF123`, `123 ABC`, `456-ABCD`. No detectar: `ABC 1234`, `ABCDE 123`, `AB 123`, `1234 ABC`.
- Nota: `py:plate-3l3d` es idéntico a `plate-vieja-ar` y a la moto de UY. `py:plate-moto-3d3l` es idéntico a la patente boliviana vieja (`123-ABC`) y colisiona con la placa moderna de Bolivia por solapamiento parcial (ver BO).
- Generador: formato Mercosur 70 %, vieja 30 %; letras A–Z.

### 3.6 Resto

- **License:** sin formato propio hallado. **Sin confirmar.**
- **SocialSecurity (IPS):** las notas del IPS dicen que el asegurado se consulta por la cédula (§11.2, páginas y prensa, no una norma). Sin número propio confirmado.
- **Passport:** formato sin fuente primaria. El pasaporte electrónico lo emite el Departamento de Identificaciones de la Policía Nacional desde 2023 (resumen de una presentación de la OACI). **Sin confirmar**; ver §11.1.
- **DriverLicense:** un acuerdo Paraguay–España lista el «número del permiso de conducción» y el de la cédula como datos distintos (resumen del buscador). Forma: **sin confirmar**.
- **BankAccount:** sin fuente. **Sin confirmar.**
- **Fuera de los nueve tipos:** número de finca / cuenta corriente catastral, matrícula del vehículo (título), número de cuenta del IPS, número de expediente judicial. Sin confirmar.

---

## 4. Bolivia (BO)

### 4.1 Tipos base y nombres

| Tipo | Nombre | Etiqueta | Formatos |
|---|---|---|---|
| `DNI` | Cédula de identidad | `CI` | `bo:ci-ext`, `bo:ci-ctx` |
| `CUIT` | NIT | `NIT` | `bo:nit-ctx` |
| `Phone` | Teléfono | `TEL` | `bo:phone-mobile`, `bo:phone-landline` |
| `License` | sin formato propio | — | — |
| `Plate` | Placa | `PLACA` | `bo:plate` |
| `SocialSecurity` | NUA/CUA | `NUA` | **sin confirmar** |
| `Passport` | Pasaporte | `PASAPORTE` | **sin confirmar** |
| `DriverLicense` | sin formato propio | — | **sin confirmar** |
| `BankAccount` | sin formato propio | — | **sin confirmar** |

### 4.2 `bo:ci-ext` y `bo:ci-ctx` — Cédula de identidad
> **Segunda pasada (§11.4):** el número de CI **se repite** entre personas y departamentos (SEGIP, 2011); el complemento nace para distinguirlos y **se agrega en los casos que corresponda**. Las normas que leí no mencionan la extensión departamental. Forma exacta de complemento y extensión: **sin confirmar**.


- Sin dígito verificador. **Estructura de la CI (cuerpo, complemento, extensión): sin confirmar con SEGIP.**
  - Lo seguro: el decreto supremo 4861/2023 incluye el «código complemento, en los casos que corresponda» (https://www.lexivox.org/norms/BO-DS-N4861.html). SEGIP lo creó porque hasta 27 personas compartían el mismo número, y el complemento distingue las repeticiones (nota de prensa: https://eju.tv/?p=172177; no confirmado como letra o dígito). Un manual del TSJ pide ingresar número y complemento **separados por guion** (https://tsj.bo/wp-content/uploads/2021/08/Actualizado-Manual-de-Usuario-Ciudadania-Digital-OGP-OJ.pdf).
  - Lo que sé de uso común, **sin fuente**: la CI lleva la extensión departamental (`LP` La Paz, `SC` Santa Cruz, `CB` Cochabamba, `OR` Oruro, `PT` Potosí, `CH` Chuquisaca, `TJ` Tarija, `BN` Beni, `PD` Pando), p. ej. `1234567 LP`, y el complemento tiene forma `1A` (dígito y letra) o `01`.
- **`bo:ci-ext` (`control`: lista de 9 extensiones):** `\b\d{6,8}(?:[\s-]?\d[A-Z])?[\s-]+(?:LP|SC|CB|OR|PT|CH|TJ|BN|PD)\b` y variantes con puntos (`L.P.`, `Lp.`). Detectar: `1234567 LP`, `7654321 SC`, `1234567-1A CB`, `123456 OR`. No detectar: `1234567 XX`, `12345 LP`, `1234567 L`, `123456789 LP`.
- **`bo:ci-ctx` (`structure` con contexto):** `d6..8, [sep["-"], d1..2 + U1 opcional?]` con `contextBefore ["C.I.", "CI", "cédula", "Nº"]`. Detectar: `C.I. 1234567`, `CI: 7654321-1A`. No detectar: `1234567` solo.
- Nombre en interfaz «Cédula de identidad». Etiqueta `CI`.
- maskFormat: `XXXXXXX XX`. Normalizador: **conservar extensión y complemento** (`"1234567LP"`). Por D-7: el número de CI no es único (§11.4), así que agrupar sin extensión puede juntar personas distintas.
- Generador: 6–8 dígitos + extensión al azar.

### 4.3 `bo:nit-ctx` — NIT

- **Confirmado (primaria):** el NIT tiene **hasta 12 dígitos numéricos**. Fuente: RND 10-0032-04 (19/11/2004), Quinta disposición transitoria, glosa «NIT: XXXXXXXXXXXX; (Hasta 12 dígitos numéricos)» (https://www.impuestos.gob.bo/wp-content/uploads/2025/09/rnd10-0032-04.pdf, leído con `pdftotext`). La norma tampoco define un dígito verificador: usa el último dígito del NIT para los vencimientos. **Corrijo la guía comercial: no hay evidencia de código de tipo ni de DV.**
- Propuesta: `structure` con contexto: `d5..12` y `contextBefore ["NIT", "N.I.T.", "Nº NIT"]`. (Antes decía 7–13.) Detectar: `NIT 1234567010`, `NIT: 1023456789`, `N.I.T. 4012345678`. No detectar: `1023456789` solo, `NIT 123`, `NIT 1234567890123` (13 dígitos).
- Etiqueta `NIT`. Generador: 10 dígitos. **El mínimo (5) sale de la CI más lo que asigne el SIN: sin confirmar.** El largo habitual de 10 dígitos sigue sin fuente.

### 4.4 Teléfonos

Fuente: https://en.wikipedia.org/wiki/Telephone_numbers_in_Bolivia (ATT regula; plan cerrado de 8 dígitos; código de área 2/3/4; celulares empiezan con 6 o 7; +591). Sin confirmar con la ATT.

- **`bo:phone-mobile`** — `control`. `[67]XXXXXXX` (8 dígitos). Formas: `7123 4567`, `71234567`, `+591 71234567`, `+591 7 123 4567`, `(591) 7123 4567`, `591-71234567`. Patrón: `(?:(?:\+|00)?591[\s-]?)?[67]\d{3}[\s-]?\d{4}\b`.
  - **Colisión:** 8 dígitos pegados que empiezan en 6 o 7 son lo mismo que cualquier CI de 8 dígitos o RUC. Propuesta: sin prefijo exigir separador o contexto.
  - Detectar: `7123 4567`, `+591 71234567`, `6234 5678`, `591-7234 5678`. No detectar: `8123 4567`, `7123 456`, `+591 7123 45678`.
- **`bo:phone-landline`** — `control`. `[234]XXXXXXX`: `2 2123456`, `(2) 212 3456`, `22123456`, `+591 2 2123456`, `3 3123456`, `4 4123456`. Patrón: `(?:(?:\+|00)?591[\s-]?)?\(?[234]\)?[\s-]?\d{3}[\s-]?\d{4}\b`. Detectar: `2 2123456`, `(4) 412 3456`, `+591 3 3123456`. No detectar: `5 2123456`, `2 212345`.
- Generador: celular `6` o `7` + 7 dígitos; fijo `2`, `3` o `4` + 7 dígitos.

### 4.5 Placa — `Plate`

Fuente: https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Bolivia. Sin norma.

- **`bo:plate`** (`structure`): 3 o 4 dígitos + 3 letras. Vigente desde 1999 (`1234 ABC`); la última letra no tiene regla clara. Piezas: `d3..4, sep?[" ","-"], U3`. Formas: `1234ABC`, `1234 ABC`, `1234-ABC`, `123-ABC`. Detectar: `1234 ABC`, `6400-DEF`, `987ABC`, `2345 XYZ`. No detectar: `12 ABC`, `12345 ABC`, `1234 AB`, `1234 ABCD`.
- Formato anterior (hasta 1987): 3 dígitos + 3 letras, primera letra = departamento. Está cubierto por `d3, U3`. Mercosur (`AB 12345`): **anunciado, sin confirmar que circule**; no lo propongo.
- Etiqueta `PLACA`. Generador: 4 dígitos + 3 letras.

### 4.6 Resto

- **SocialSecurity:** el **CUA** (Código Único de Asegurado) existe y está en la norma (DS 0822, reglamento de la Ley 065, lo leí con `pdftotext`: lo cita como dato del asegurado, junto al documento de identidad). **La norma no da su estructura.** El `NUA` no aparece. Forma: **sin confirmar**. Ver §11.2.
- **License, Passport, DriverLicense, BankAccount:** sin fuente. **Sin confirmar.** Ver §11.
- **Fuera de los nueve tipos:** código de la Matrícula de Comercio (Fundempresa), folio real, número de factura (CUF), código de control de facturación.

---

## 5. Argentina: tipos nuevos

### 5.1 `BankAccount`: `ar:cbu` — CBU / CVU
> **Segunda pasada (§11.6): CVU confirmado con el texto del BCRA.** El texto ordenado «Sistema Nacional de Pagos – Servicios de pago» (al 18/08/2025, Com. A 8303, sección 2 «Clave Virtual Uniforme», leído con `pdftotext`) dice: «La CVU tendrá el mismo formato que la CBU». Bloque 1: «000» (3, código de clave virtual) + código de PSP (4, único, asignado por la CEC-BV) + DV1. Bloque 2: **un «0» reservado (1)** + identificador de cliente (12) + DV2. **Un CBU y un CVU se distinguen por los 3 primeros dígitos `000` y por el dígito 9 igual a `0`.** Los DV «se calculan según CBU» («clave 10 con el ponderador 9713»). El texto no da los pesos uno por uno: siguen siendo los de python-stdnum, y coinciden con el boletín de 1997. Corrijo mis ejemplos de CVU: los de §5.1 tenían el dígito 9 distinto de 0. Ejemplos sintéticos válidos: `0000003100000123456784`, `0000012300009876543219`, `0000045100002468135799`. Las formas de escribirlo no están en la norma (solo se recomienda difundir la CBU).


- **Clase: `control`.** Un solo formato para los dos.
- **Nombre en la interfaz:** «CBU/CVU» (mismo estilo que «CUIT/CUIL»). **Etiqueta corta:** `CBU`.
- **Estructura:** 22 dígitos = bloque 1 (8) + bloque 2 (14).
  - Bloque 1: entidad (3) + sucursal (4) + DV1 (1).
  - Bloque 2: cuenta (13) + DV2 (1).
- **Algoritmo exacto** (BCRA: «clave 10, ponderador 9713»; en la práctica es módulo 10 con los pesos de abajo):
  - **DV1** sobre los primeros 7 dígitos, pesos `7,1,3,9,7,1,3`: `DV1 = (10 − (suma mod 10)) mod 10`. Debe ser el dígito 8.
  - **DV2** sobre los siguientes 13 dígitos (posiciones 9–21), pesos `3,9,7,1,3,9,7,1,3,9,7,1,3`: `DV2 = (10 − (suma mod 10)) mod 10`. Debe ser el dígito 22.
  - El código de referencia (python-stdnum, `ar/cbu.py`) usa pesos `3,1,7,9` cíclicos de derecha a izquierda, lo que da exactamente esos pesos.
  - Verificación: reproduje el ejemplo del boletín CIMPRA 002/1997 (DV2 = 4 para su cuenta de 13 dígitos).
- **CBU vs CVU:** misma forma. En el CVU, los 3 primeros dígitos son `000` y los 4 siguientes identifican al proveedor de servicios de pago (código único asignado por Coelsa). `0000003…` sería un PSP con código `0003`: **inferencia mía, ninguna fuente lo dice textual**. El DV1 se calcula igual.
- **Formas de escribirse:**
  1. 22 dígitos seguidos (la habitual).
  2. `8 + 14`: `01100123 45600000000011` (separados por espacio o guion).
  3. Grupos de 4 más 2: `0110 0123 4560 0000 0000 11`.
  4. Con prefijo `CBU:` / `CVU:` / `CBU N°` (no es parte del dato).
  5. El **alias** (`juan.perez.mp`) no es un CBU: es otro identificador, ver 5.5.
- **Patrón propuesto:** `\b\d{22}\b | \b\d{8}[\s-]\d{14}\b | \b\d{4}(?:[\s-]\d{4}){4}[\s-]\d{2}\b`, + control de DV1 y DV2.
- **maskFormat:** `XXXXXXXXXXXXXXXXXXXXXX` (22 X; con los separadores que traiga el texto). **Normalizador:** quitar no-dígitos → 22 dígitos.
- **Generador:** entidad de 3 dígitos tomada de una lista de códigos BCRA (p. ej. `011`, `014`, `017`, `027`, `072`; **lista sin confirmar con el padrón BCRA**; cuidado: son bancos reales, un sintético con códigos reales no apunta a nadie porque cuenta y sucursal son aleatorias), sucursal 4 dígitos, DV1, cuenta de 13 dígitos, DV2. Un 15 % puede ser CVU (`000` + PSP 4 dígitos).
- **Ejemplos sintéticos válidos** (DV verificados; los armé yo):
  - `0140002112345678901233`
  - `0270105500000987654326`
  - `0720001400000123456784`
  - `0000003110000123456781` (forma CVU)
  - `01400021 12345678901233` (forma 8+14)
  - `0140 0021 1234 5678 9012 33` (forma 4+2)
- **Ejemplos que NO debe detectar:**
  - `0140002112345678901234` (DV2 cambiado)
  - `0140002012345678901233` (DV1 cambiado)
  - `014000211234567890123` (21 dígitos)
  - `01400021123456789012334` (23 dígitos)
  - `0140 0021 1234 5678 9012 3` (grupo final de 1 dígito)
- **Fuentes:**
  - BCRA, boletín CIMPRA 002/1997: https://www.bcra.gob.ar/archivos/Pdfs/SistemasFinancierosYdePagos/Boletin-CIMPRA-002-1997.pdf (estructura y ejemplo)
  - BCRA texto ordenado SNP: https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-snp-spd.pdf (**no lo abrí completo**)
  - python-stdnum `ar/cbu.py`: https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/ar/cbu.py
  - CVU, prefijo `000`: resultado de búsqueda sobre las normas BCRA; **sin texto literal verificado**.
  - Comunicación «A» 8103 (sept. 2024): solo cambió el algoritmo del **alias** (no los 22 dígitos), según https://www.marval.com/publicacion/novedades-en-el-algoritmo-del-cbucvu-y-en-las-camaras-de-compensacion-16937. **No leí el texto de la comunicación**; el resumen es de un estudio jurídico.

### 5.2 `SocialSecurity` en Argentina

- El **CUIL** ya está en `cuit-ar` bajo `CUIT` (mismos 11 dígitos, mismo módulo 11). **No agrego formato** y no lo muevo: ADR-236 prohíbe cambiar lo de hoy.
- Otros números: número de afiliado de obra social, número de beneficio ANSES, número de afiliado a una ART. **Sin confirmar** que haya un formato nacional único. No hay formatos propuestos.
- Consecuencia: con `AR` activo el tipo `SocialSecurity` no tiene formatos y por ADR-221 §3 no aparece en los selectores. **Decisión D-8:** ¿se acepta que Argentina no muestre el tipo, aunque el CUIL se perciba como «seguridad social»?

### 5.3 `Passport` en Argentina
> **Segunda pasada (§11.1):** leído entero el Anexo I de la disposición de RENAPER (DI-2021-111688667): «numeración por impacto de control … alfanumérica conformada por TRES (3) letras y SEIS (6) números», y el «Número de Documento de Viaje» de la MRZ ocupa 9 caracteres. **Que la numeración impresa sea el mismo número de la MRZ no lo dice el texto que leí**; lo supongo. El prefijo `ZZX` de refugiados salió de un resumen: **sin confirmar**.


- **`ar:passport`** (`structure`): 3 letras + 6 dígitos (`AAA123456`). RENAPER. Los pasaportes de refugiados usan el prefijo `ZZX` (otra disposición de RENAPER). El número aparece en el pie de la hoja de datos y en la zona de lectura mecánica (9 caracteres).
- Piezas: `U3, sep?[" ","-"], d6`. maskFormat `XXX XXXXXX` / `XXXXXXXXX`. Normalizador: mayúsculas, quitar separadores.
- Detectar (sintéticos): `QWE 654321`, `XYZ-123456`, `ABC987654`, `ZZX000123`). No detectar: `AB123456`, `ABC12345`, `ABCD123456`, `123456ABC`.
- Generador: 3 letras + 6 dígitos (no usar `ZZX`).
- Fuentes: https://argentina.gob.ar/normativa/357260_disp904-1_pdf/archivo (disposición RENAPER; **resumen del buscador**, no leí el texto) y https://www.argentina.gob.ar/pasaporte. Pasaportes anteriores a la serie de 3 letras: **sin confirmar**.
- Choque: sin choques con `plate-vieja-ar` (`ABC 123456` no pasa la frontera `\b` tras 3 dígitos).

### 5.4 `DriverLicense` en Argentina

- La licencia nacional de conducir (ANSV) usa el número de DNI. No encontré un número propio. Formatos provinciales antiguos: **sin confirmar**. Sin formato propuesto.

### 5.5 Identificadores fuera de los nueve tipos (AR)

- **Alias de CBU/CVU** (`juan.perez.mp`, hasta 4 palabras; `A 8103` agrega un número de hasta 4 dígitos al alias automático): no entra al catálogo. Se puede crear como formato propio.
- Número de expediente judicial (`CUIJ`, 11 dígitos con DV; **sin confirmar**), CUIT de empresa ya está, CVU ya está, partida inmobiliaria, número de CAE.

---

## 6. Universales (ADR-236 §4): observaciones por país

Solo observaciones. No cambio nada.

### 6.1 Fechas

- **Orden día/mes/año en los cuatro** (como Argentina), con `/`, `-` o `.`. Chile también usa punto (`17.05.2025`) y a veces guion largo; **el patrón de hoy (`/` o `-`) no cubre el punto**. Sin fuente oficial; es un uso común, **hay que medirlo con corpus**.
- En texto: `17 de mayo de 2025`; con ordinal (`1º de mayo`); `del 2025`. Meses en minúscula en español (en documentos oficiales a veces con mayúscula inicial: la regex lleva `i`). `setiembre` es de uso rioplatense; Chile, Paraguay y Bolivia usan `septiembre` (cubierto).
- Abreviaturas de mes (`17-may-2025`, `17/may/25`): **no cubiertas** por los patrones de hoy; sin fuente, observación para la medición.
- Año de 2 dígitos: cubierto por `\d{2,4}`.

### 6.2 Direcciones y palabras de vía (para `address-keyword-ar`)

Lo que cubre hoy: `calle, avenida, pasaje, boulevard, diagonal, av., avda., pje., bv.`. Observaciones (uso común, **sin fuente oficial**):
- **Chile:** `Av.`, `Avda.`, `Pasaje` / `Psje.`, `Calle`, `Camino`, `Población`, `Villa`, `Pje.`, `Depto.`, `Of.`, `Block`; comuna después de la calle; «Las Condes, Santiago».
- **Uruguay:** `Av.`, `Avda.`, `Bv.`, `Ruta` + km, `Camino`; el barrio en lugar de la comuna; números de puerta `Nº 1234`, `Apto. 501`.
- **Paraguay:** `Av.`, `Avda.`, `Calle`, `Ruta` + km, `Esq.` (esquina), `c/` (cruce, «Mcal. López c/ Brasil»). Muy frecuente la forma «X esq. Y» y «X c/ Y», **no cubierta**.
- **Bolivia:** `Av.`, `Calle`, `Zona` (sección propia de la dirección, «Zona Sopocachi»), `Edif.`, `Nº`, `Pje.`, `Barrio`.
- `Camino` y `Ruta` no están hoy entre las palabras de vía. Con `Km` en la dirección, la altura no tiene la forma del caso 34 de `NER_Engine.md`.

### 6.3 Carátula y dos apellidos

- **Chile:** `Apellido Paterno Apellido Materno, Nombre(s)`; en documentos legales: `PÉREZ GONZÁLEZ, JUAN` en mayúsculas completas. La carátula de hoy exige `\p{Lu}\p{Ll}+, \p{Lu}\p{Ll}+`: **una sola palabra de apellido en capitalización normal**; no cubre el apellido compuesto ni las mayúsculas totales.
- **Uruguay, Paraguay, Bolivia:** dos apellidos (paterno y materno) es lo normal; `Apellido1 Apellido2, Nombre`. Misma observación.
- Chile y Paraguay usan «De» y «Del» en apellidos de mujer casada («Pérez de González»): **sin fuente**.
- Observación: las listas de la carátula (`GENDER_LEXICON`, ADR-091) están hechas con nombres argentinos; no se midió con nombres guaraníes (`Ñandú`, apellidos como `Benítez`, `Duarte`) ni aymaras/quechuas (`Mamani`, `Quispe`, `Condori`). Hay riesgo de que el primer nombre no esté en el léxico. **Hay que medirlo.**

---

## 7. Choques posibles (clave para la medición)

Probé las `RegExp` argentinas sobre los sintéticos (sin guarda de corrida):

| # | Choque | Detalle |
|---|---|---|
| C-1 | **`dni-ar` dentro de todo `cl:rut`** | `12.345.678-5`, `12345678-5`, `7.654.321-6`: `dni-ar` captura el cuerpo y deja el DV afuera. En un catálogo chileno no corre `dni-ar`, pero con «agregar desde otro país» sí. Pasa lo mismo con `uy:ci`, `py:ruc` y la CI sin DV. |
| C-2 | **`py:ci` y `dni-ar` son lo mismo** | `1.234.567` y `2.345.678` son detectados por `dni-ar`. Cualquier país con CI sin DV (PY, BO) hereda la forma de `dni-ar`. |
| C-3 | **CI sin DV (UY) = forma de `dni-ar`** | `1.234.567` es una CI uruguaya sin DV y un DNI argentino a la vez. No hay manera de distinguirlos por forma. |
| C-4 | **`cuit-ar` dentro de un RUT** | `20-12345678-9` contiene `12345678-9`; si el DV fuera válido, `cl:rut` lo detectaría dentro de un CUIT. Probabilidad: 1 en 11 por CUIT. |
| C-5 | **Teléfonos de 9 dígitos** | `0981123456` (PY) lo detectan `phone-mobile-ar` y `phone-landline-ar`. `099123456` (UY) lo detecta `phone-landline-ar`. `021 1234567` lo detectan `dni-ar` (7 dígitos), `phone-mobile-ar` y `phone-landline-ar`. |
| C-6 | **Teléfono UY/BO de 8 dígitos = CI** | `29012345` (fijo de Montevideo) y `2345678-3` (CI sin separadores = `23456783`). Igual en BO: `71234567` lo detecta `dni-ar`. |
| C-7 | **Patentes idénticas entre países** | `ABC 123` = `plate-vieja-ar` = patente municipal CL = moto UY = patente PY 2000–2019. Mismo tipo, mismo largo: sin conflicto. `123 ABC` (PY moto) = BO vieja. |
| C-8 | **`py:plate-mercosur` (`ABCD 123`) vs `plate-vieja-ar`** | `ABCD 123` no matchea `plate-vieja-ar` (necesita 3 letras con borde), pero `BCD 123` dentro de un texto sí (`\b` después de la primera letra suelta). Hay que medirlo. |
| C-9 | **CBU de 22 dígitos** | Los 22 pegados no los detecta ningún patrón argentino. Con bloques `8+14` (`01400021 12345678901233`), `dni-ar` captura el bloque de 8. Con grupos de 4 (`0140 0021 1234 …`), el patrón de tarjeta captura 16 dígitos si pasan Luhn (~10 %) y `phone-landline-ar` captura un tramo. |
| C-10 | **`cl:plate-2l4d` vs fechas y rangos** | `AB-1234` no choca con `date-ar` (que necesita dígitos), pero `AB 12 34` sí podría con lo que haya en el texto. No se encontró choque directo. |
| C-11 | **RUC de PY con puntos** | `1.234.567-9` contiene `py:ci` y `dni-ar` (tipos distintos: conflicto de ADR-222). |
| C-12 | **Teléfono sin prefijo con 9 dígitos que empieza en 9 (CL)** | `987654321` choca con todo número de 9 dígitos, incluido un RUT sin guion. Por eso propongo exigir separadores. |
| C-13 | **`bo:ci-ext` vs `dni-ar`** | `1234567 LP`: `dni-ar` captura `1234567` y deja `LP` sin tapar (visible en la prueba). |
| C-14 | **Fecha con punto (CL)** | `17.05.2025` no está cubierta por `date-ar`; sí es matcheada parcialmente por `dni-ar` si fuera `17.05.202`. Observación para la medición de universales. |

Probados y **sin** choque: los teléfonos con `+56`/`+598`/`+595`/`+591` y separadores, las patentes de 4 letras o con 4 dígitos, y `AAA123456` (pasaporte AR).

---

## 8. Dudas para el mantenedor (actualizada en la segunda pasada, §11)

- **D-1.** CL: el RUT es documento y tributario a la vez. ¿Bajo `DNI` («RUT») o bajo `CUIT`? (sin cambios)
- **D-2.** Etiqueta de `Phone`: ¿la de AR o cada país la suya? (sin cambios)
- **D-3.** CL: ¿se acepta el RUT sin guion (`123456785`)? (sin cambios)
- **D-4.** Patentes antiguas (PY de una letra + 6 dígitos, municipales 3+3): ¿se cubren? **Se suma:** el DS 114/2025 prevé que Chile pase a 5 letras + 1 dígito (autos) y 4 + 1 (motos) **cuando se agoten las combinaciones actuales**, sin fecha. ¿Entran al catálogo ya (por anticipación) o recién cuando exista el acto del Registro Civil?
- **D-5.** `MATRICULA`: AR lo usa para la matrícula profesional; en UY es la patente. (sin cambios)
- **D-6.** UY: ¿se acepta la CI sin DV (`1.234.567`)? (sin cambios; ahora se sabe que el decreto 501/1978 no da los pesos.)
- **D-7. CAMBIA, y se vuelve más urgente.** Para BO, el número de CI **no es único en el país**. El SEGIP detectó en 2011 que hasta 27 personas compartían un mismo número, en distintos departamentos (§11.4). Agrupar sin extensión ni complemento **puede juntar a dos personas distintas**. Recomendación: el normalizador conserva extensión y complemento. Decide el mantenedor.
- **D-8.** AR: `SocialSecurity` sin formatos propios. (sin cambios)
- **D-9.** ¿Formatos con contexto obligatorio (`py:ci-ctx`, `bo:ci-ctx`, `bo:nit-ctx`)? (sin cambios; el NIT de BO ahora tiene fuente primaria: hasta 12 dígitos.)
- **D-10 (pasaportes). Se acota, no se resuelve.** Hay fuente primaria solo para CL (9 caracteres alfanuméricos) y AR (3 letras + 6 dígitos). Para UY, PY y BO no hay fuente primaria legible. Sigue la pregunta: ¿se busca con el pasaporte del mantenedor, o se usa un formato genérico de la OACI (hasta 9 alfanuméricos, §11.1) solo con contexto?
- **D-11.** Cuenta bancaria: CL, PY y BO sin formato. (sin cambios)
- **D-12 (nueva).** UY: la licencia de conducir **sí tiene número propio** («número de licencia» y «número de carnet», distintos de la cédula), pero no encontré su forma. Y CL: el «N.º de licencia» es un campo aparte del folio. ¿Se busca, o `DriverLicense` queda sin formato en UY y CL?
- **D-13 (nueva).** CL: el folio de la licencia es alfanumérico (norma), pero su forma exacta no está en el decreto (la fija una resolución del MTT que no encontré). No se propone formato.

---

## 9. Lo que sigue sin confirmar (después de la segunda pasada)

- **Pasaportes de UY, PY y BO**: forma del número sin fuente primaria. De CL: solo la longitud (9 alfanuméricos), no la estructura.
- **Seguridad social**: BO usa el CUA (confirmado que existe; **sin forma**). UY (BPS), PY (IPS) y CL (AFP/Fonasa): ningún número propio confirmado con fuente primaria; BPS e IPS identifican por cédula según páginas y notas, no según una norma.
- **Licencia de conducir** de PY y BO: sin forma. Los números propios de UY y CL: sin forma.
- **BO**: forma exacta del complemento (la norma dice «código complemento, en los casos que corresponda», sin más) y de la extensión (ninguna norma que leí la menciona). Control del NIT: sin evidencia de que exista.
- **UY**: pesos de la CI (el decreto 501/1978 fija módulo 10, no los pesos) y algoritmo del RUT (la DGI lo reservó 15 años, §11.5). Ambos salen de código y calculadoras de terceros.
- **CL**: letras permitidas de las patentes (ni el decreto que leí ni los otros las fijan). Códigos de área: confirmados solo según la comunicación de Subtel de 2006 (§11.7).
- **PY**: largo de fijos fuera de Asunción: solo la regla general de 2002.
- Los ejemplos de este informe son todos sintéticos.

---

## 10. Lo que leí

Del repo, lista cerrada:
1. `docs/adr/ADR-236-La-1.1.1-Trae-Veinte-Paises-Y-La-Interfaz-En-Ingles.md`, completo.
2. `docs/adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md`, completo.
3. `docs/adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md`, completo.
4. `docs/roadmap/Plan_1.1.1.md`, §2 y §3 (líneas 30 a 95).
5. `docs/core/Regex_Engine.md`, desde «## Patrones default (especificación exacta)» (línea 830) hasta el final.

No leí otra cosa del repo. Los scripts de cálculo (DV, colisiones) quedaron en una carpeta temporal, fuera del repo.


---

## 11. Segunda pasada (fuentes primarias)

Reglas: sin tocar el repo, sin releer los docs, ejemplos sintéticos. **«Leída entera»** = bajé el PDF o la página y extraje el texto completo (con `pdftotext`) o la herramienta devolvió el texto completo. **«Resumen»** = solo vi el resumen de la herramienta de lectura o del buscador, porque el PDF era ilegible o la página bloqueaba la descarga (varias páginas de `consilium.europa.eu`, `gestora.bo` y `sac.impuestos.gob.bo` dieron 403 o no resolvieron).

### 11.1 Pasaportes (D-10)

| País | Qué se confirmó | Fuente (estado) |
|---|---|---|
| **CL** | Número de **9 caracteres alfanuméricos**, también en la MRZ; el RUN va aparte. Estructura interna: sin confirmar. Emisor: Servicio de Registro Civil e Identificación. | Res. exenta 467, DO 07/12/2024 (**leída entera**) |
| **AR** | Numeración de control **3 letras + 6 dígitos**; el «número de documento de viaje» de la MRZ ocupa 9 caracteres. Emisor: RENAPER. | Anexo I de la disposición de RENAPER, DI-2021-111688667 (**leída entera**) |
| **UY** | Sin forma. Emisor: Dirección Nacional de Identificación Civil (Ministerio del Interior). El número cambia al renovar. | Decreto 281/2022 en impo.com.uy (**leído**: no trae el formato); notas de gub.uy (**resumen**) |
| **PY** | Sin forma. Emisor: Departamento de Identificaciones de la Policía Nacional; pasaporte electrónico desde 2023. | PRADO bloqueado (403); presentación de la OACI (**resumen**) |
| **BO** | Sin forma. Emisor: Dirección General de Migración. DS 3762/2018 autoriza el pasaporte electrónico con estándares de la OACI. | **Resumen** |

- **OACI 9303, Parte 4, 8.ª ed. 2021 (leída parcialmente con `pdftotext`, solo las tablas de la MRZ de TD3):** el «número de pasaporte» es **obligatorio, de 9 posiciones** (posiciones 1 a 9 de la línea 2), «asignado por el Estado expedidor». Un carácter especial o un espacio se reemplaza por `<`, que sigue al número hasta la posición 9. Para números más largos el estándar remite a la Parte 3 (no la leí).
- **Consecuencia:** un formato genérico para pasaportes de cualquier país sería «hasta 9 caracteres alfanuméricos», lo que choca con todo número corto. **No lo recomiendo sin contexto** (`contextBefore ["Pasaporte", "Passport", "Pasaporte N°"]`).
- **Sigue sin confirmar:** estructura del pasaporte de CL, UY, PY y BO.

### 11.2 Seguridad social

- **BO.** El **CUA** (Código Único de Asegurado) existe en la norma: DS 0822 de 2011, reglamento de la Ley 065 (**leído entero** con `pdftotext`; aparece como «Documento de Identidad, CUA, Nombres, Apellidos y Fecha…» y «número de Código Único del Asegurado»). **No define su estructura ni su longitud.** Según la Gestora (**resumen**, el PDF dio 403): lo asigna el SIP al registrarse, no cambia entre empleos, y el trámite en línea pide CUA, tipo de documento y fecha de nacimiento. **No aparece «NUA»** en el reglamento: es término del uso o de otra norma. Forma: **sin confirmar**.
- **UY.** Páginas del BPS (**resumen**): la cédula es el documento principal; acceso en línea por «usuario personal». Ningún número de afiliado aparte. Sin norma leída.
- **PY.** Notas del IPS (**resumen**): se consulta por número de cédula. Sin número propio confirmado.
- **CL.** Sin fuente primaria leída (AFP/Fonasa por RUT).

### 11.3 Licencias de conducir

- **CL.** Diario Oficial 24/02/2017 (**leído entero**): el documento tiene un campo **«Nº DE LICENCIA»** y un **folio alfanumérico** que asigna el municipio; la forma de asignación la fija una resolución del MTT (no encontrada). Una modificación posterior del diseño (decreto 69/2021) habría puesto «RUN / Nº DE LICENCIA» (**resumen**, no leí el decreto): o sea, el número de licencia sería el RUN. **No lo confirmo.** La forma «hasta 3 letras + 10 dígitos» que dio el buscador **no está** en el decreto de enero de 2025 que abrí (**leído entero**): **sin confirmar**.
- **UY.** Anexo 20 del MTOP, «licencias de conducir en formato unificado» (**leído entero**): campos «número de licencia de conducir» (a2), «número de cédula de identidad» (a5) y «número de carnet» (b11), **tres cosas distintas**. Forma: no figura. **Corrige mi primer informe**, que decía que se identifica por la cédula.
- **PY.** Acuerdo Paraguay–España (**resumen**): lista el número del permiso y el de la cédula como datos distintos. Forma: no encontrada.
- **BO.** DS 4861/2023 y 5364/2025 (**resumen**): la licencia es un documento de SEGIP, y sus especificaciones las fija SEGIP. Forma: no encontrada.

### 11.4 BO: CI, complemento, extensión y unicidad (D-7)

**Respuesta a la pregunta nueva: el número de CI boliviano NO es único en todo el país.** Se puede repetir, también entre departamentos.

- **Evidencia (SEGIP, 2011).** Nota de eju.tv del 30/07/2011 (autora Luz Mendoza, datos del director del SEGIP, Antonio Costas; **leída**): el SEGIP encontró números de cédula duplicados, **«en diferentes departamentos»**, detectados al renovar cédulas; atribuyó el origen a la falta de control en la base de la Policía. Criterio: no se cambia el número, salvo mucho conflicto; entonces se queda con el número quien lo tiene desde antes y a la otra persona se le asigna uno nuevo. https://eju.tv/?p=158009
- Nota del 18/10/2011 (eju.tv, misma fuente, **leída**): hasta **27 personas con el mismo número**; unos 400 mil casos al 31/07/2011. La solución anunciada: **dos dígitos de complemento** que «irá desde uno hasta el 27». No menciona letras. https://eju.tv/?p=172177
- **Norma.** Ley 145 (27/06/2011), arts. 17 y 18 (**leída**, Lexivox): la cédula es «pública, individual, única e intransferible» (se refiere al documento, no garantiza la unicidad del número), y el art. 18 dice que «se mantendrá el número de la Cédula de Identidad asignado con anterioridad». **No menciona extensión ni complemento.** DS 4861/2023, arts. 2 y 3 (**leído entero**, Lexivox): el «código complemento» va «en los casos que corresponda»; **no explica cuándo ni cómo se forma**, y **no menciona la extensión**. https://www.lexivox.org/norms/BO-DS-N4861.html, https://www.lexivox.org/norms/BO-L-N145.html
- **Consecuencia para D-7.** Los dos hechos juntos (números repetidos sin cambiar, y complemento para distinguirlos) significan que **agrupar solo por el número de CI puede juntar a dos personas distintas**. La extensión departamental no figura en la norma que leí, así que **no puedo afirmar que sea el desambiguador oficial**: el dato oficial de desambiguación es el **complemento**. Recomendación: el normalizador conserva todo lo que se detecte (número, complemento y extensión). Una CI escrita sin complemento ni extensión se agrupa solo con otra idéntica, nunca con una que sí los traiga.
- **Sigue sin confirmar:** si el complemento es de dos dígitos, de dígito + letra o de otra forma; si las siglas de departamento (`LP`, `SC`…) se imprimen en la cédula vigente.
- Un manual del TSJ pide número y complemento separados por guion (**resumen**).

**NIT (SIN).** RND 10-0032-04, 19/11/2004 (**leída entera**): «hasta 12 dígitos numéricos»; sin dígito verificador definido (el último dígito sirve para los vencimientos mensuales). Estructura interna (CI + 3 dígitos, etc.): sin fuente primaria.

### 11.5 UY: pesos de la CI y algoritmo del RUT

- **Decreto 501/1978** (reglamento de la Ley 14.762; **leído entero**, impo.com.uy): persona física = número **correlativo desde el uno** + **dígito verificador por módulo 10**. Empresarios (art. 25): 6 dígitos + DV, «en la forma que el Registro disponga». Empresas (art. 26): 2 cifras de departamento + 2 de actividad (CIIU) + 5 correlativas + DV (**es la estructura de 1978, anterior al RUT de 12 dígitos de la DGI**; no sirve para el RUT actual). **No da los pesos.** https://impo.com.uy/bases/decretos/501-1978
- **RUT (DGI).** Resolución 145/2024 del Consejo Ejecutivo de la UAIP (21/08/2024; **leída entera**): la DGI declaró **reservado por 15 años** el detalle de la arquitectura del RUT («significado de cada una de sus partes») y el algoritmo del dígito verificador. **Por lo tanto no hay fuente oficial pública.** Lo que uso (pesos `4,3,2,9,8,7,6,5,4,3,2`, `DV = −suma mod 11`, serie 01–22, tipo `001`) sale de python-stdnum y **no se puede verificar contra la DGI**. https://www.gub.uy/unidad-acceso-informacion-publica/sites/unidad-acceso-informacion-publica/files/2024-09/RESUAIP24145.pdf
- **Impacto:** si el mantenedor exige fuente oficial, `uy:rut` queda como «sin confirmar» y solo se puede ofrecer con la forma (12 dígitos, `001` en las posiciones 9–11) sin control de DV, o con control declarado no verificado.

### 11.6 CBU y CVU (BCRA)

- **Texto ordenado «Sistema Nacional de Pagos – Servicios de pago»** (al 18/08/2025, Com. «A» 8303; **leído** secciones 1 y 2 con `pdftotext`, 73 KB): https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-snp-spd.pdf
  - **CBU (sección 1.1):** bloque 1: entidad (3) + sucursal (4) + DV (1, de las 7 primeras posiciones). Bloque 2: cuenta (13) + DV (1, de las 13 anteriores). «Clave 10 con el ponderador 9713».
  - **CVU (sección 2.3):** «tendrá el mismo formato que la CBU». Bloque 1: `000` + código de PSP (4, único, asignado por la CEC-BV) + DV. Bloque 2: `0` reservado (1) + identificador de cliente (12) + DV 2. Los DV «se calculan de acuerdo con lo indicado para CBU».
  - **Diferencia CBU/CVU:** los tres primeros dígitos `000` y el dígito 9 igual a `0`. Con esto **desaparece mi «inferencia»** de §9: el prefijo `000` y el código de PSP de 4 dígitos están confirmados. El valor `0003` como PSP de un proveedor concreto sigue sin fuente.
  - Los pesos `7,1,3,9,7,1,3` y `3,9,7,1,3,9,7,1,3,9,7,1,3` son la lectura estándar del «ponderador 9713» y coinciden con el boletín CIMPRA 002/1997 y con python-stdnum; **el texto del BCRA no los enumera**.
- **La comunicación que creó el CVU** es la «A» 6510 (la cita el texto ordenado), reformada por la «A» 7533 (30/06/2022, vigencia). **No leí la 6510.** La «A» 6885 (30/01/2020), que sí tengo (**leída**, 17 KB), trata de los proveedores de servicios de pago y solo cita el CVU de pasada, sin estructura.
- **Cambio de ejemplos:** §5.1 tenía CVU con el dígito 9 distinto de 0. Los correctos están en la nota de §5.1.

### 11.7 CL: códigos de área y letras de las patentes

- **Códigos de área.** Comunicación de Subtel a la UIT del 27/04/2006 (**leída entera**, archivo Word de itu.int): zona primaria Santiago `2` (8 cifras); Valparaíso `32`, Quillota `33`, Los Andes `34`, San Antonio `35`, Concepción `41`, Chillán `42`, Los Ángeles `43`, Temuco `45`, La Serena `51`, Copiapó `52`, Ovalle `53`, Antofagasta `55`, Iquique `57`, Arica `58`, Punta Arenas `61`, Valdivia `63`, Osorno `64`, Puerto Montt `65`, Coyhaique `67`, Talca `71`, Rancagua `72`, Linares `73`, Curicó `75`. **Es exactamente la lista de §1.3: confirmada para 2006.** Móvil: `9` + 8 cifras. Estado actual: el DS 747/1999, art. 11, permite modificarla; sin evidencia de cambio, **no verificado**.
- **Letras de las patentes.** **No hay documento leído que las fije.** Lo leído: DS 13/2024 (grabado de patente en vidrios, **leído entero**) y el decreto de duplicado de placas (DO 14/05/2025, **leído entero**): ninguno define el alfabeto. Sin confirmar.
- **Formato 2026: ver la nota de §1.4 (fuente primaria, leída entera).** DS 114/2025 del MTT, DO 44.350 del 16/01/2026, CVE 2754777: https://www.diariooficial.interior.gob.cl/publicaciones/2026/01/16/44350/01/2754777.pdf (descargado y extraído con `pdftotext`, 3 páginas). Las tres preguntas: **forma exacta**: autos 5 letras + 1 dígito, de 2 o 3 ruedas 4 letras + 1 dígito, letras primero; **letras excluidas**: el decreto no las dice; **desde cuándo**: sin fecha, depende de un acto administrativo del Registro Civil que declare agotadas las combinaciones actuales (no lo encontré); **convivencia**: el decreto no lo trata expresamente, solo prevé la sustitución por agotamiento. El decreto tampoco confirma el «17/07/2026» de La Tercera: esa fecha es de la patente verde. Notas de prensa de Meganoticias y 13.cl hablan de 2027 (motos) y 2029 (autos) como **estimación periodística del agotamiento**, no del decreto. No consulté registrocivil.cl ni bcn.cl (la BCN no cargó).

### 11.8 PY: fijos por ciudad (CONATEL)

- Plan Técnico Fundamental de Numeración Nacional, comunicación del 31/05/2002 y modificación del 07/02/2005 (**leídas parcialmente**, itu.int; las tablas llegan algo desordenadas): número nacional de **9 cifras** para el servicio básico y el móvil; área de **2 o 3 cifras**; código de bloque de 3 o 2 cifras y número interno de 4. Asunción: `21` (todas sus centrales y también Fernando de la Mora, Lambaré, Limpio, Luque, Mariano Roque Alonso, Ñemby, San Antonio, Villa Elisa), o sea **abonado de 7 cifras**. Ciudad del Este `61`, Encarnación `71`, Concepción `31`, Pedro Juan Caballero `36`, Villarrica `541`. Códigos de 3 cifras: abonado de 6.
- Móvil: `9` + 8 cifras; series `961`, `971`–`975`, `981`–`985`, `991`–`995` en la lista de 2002.
- **No leí** la versión vigente del plan (CONATEL publicó planes 2016–2020 y 2021–2025). Sin confirmar si algo cambió.
- **Corrección al §3.4:** el abonado de Asunción es de 7 cifras, no «6 o 7» ni «6».

### 11.9 Qué cambió respecto del informe anterior

| Tema | Antes | Ahora |
|---|---|---|
| CL pasaporte | 9 alfanuméricos (resumen) | 9 alfanuméricos, leída la resolución; estructura sigue sin confirmar |
| AR pasaporte | 3 letras + 6 dígitos (resumen) | **Leído el anexo de RENAPER**; el prefijo `ZZX` sigue en resumen |
| UY licencia | usa la cédula | **Tiene número propio** (MTOP); forma sin confirmar |
| BO NIT | 7–13 dígitos (guía comercial) | **Hasta 12 dígitos** (RND 10-0032-04); sin DV |
| BO CI | extensión como dato seguro | Extensión **no figura** en la norma; complemento sí; número **no único** |
| UY CI | módulo 10, pesos de terceros | Igual: la norma da módulo 10, **no los pesos** |
| UY RUT | algoritmo de terceros | DGI lo **reservó 15 años**; sigue sin fuente oficial |
| CVU | prefijo `000` inferido | **Confirmado** (BCRA): `000` + PSP(4) + DV; bloque 2 empieza con `0` |
| CL códigos de área | lista armada de memoria | **Confirmada** (Subtel, 2006) |
| CL patente | 4 letras + 2 dígitos | Suma **5 letras + 1 dígito** (autos) y **4 + 1** (de 2 o 3 ruedas), pero **solo cuando el Registro Civil declare agotadas** las combinaciones actuales (DS 114/2025, DO 16/01/2026). Sin fecha. Corrige la «fecha 17/07/2026» de La Tercera |
| PY fijos | 6 o 7 cifras | Asunción **7 cifras** (CONATEL 2002) |

### 11.10 Lo que leí en esta pasada (fuentes)

Leídas enteras o casi: Res. exenta 467 (CL, pasaporte); Anexo I de RENAPER (AR, pasaporte); DS 0822/2011 (BO, reglamento Ley 065); RND 10-0032-04 (BO, NIT); Ley 145 arts. 17–18 y DS 4861 (BO, Lexivox); Decreto 501/1978 (UY); Res. UAIP 145/2024 (UY); Anexo 20 del MTOP (UY, licencia); texto ordenado del BCRA sobre CBU/CVU y Com. A 6885; Subtel/UIT 2006; CONATEL/UIT 2002; DO 24/02/2017, 24/01/2025, 14/05/2025 y 14/05/2024 (CL); OACI 9303 Parte 4 (solo las tablas de la MRZ); notas de eju.tv del 30/07/2011 y del 18/10/2011 y de La Tercera del 16/01/2026.
Solo resumen: páginas de la Gestora (403), PRADO (403), BPS e IPS, los acuerdos y decretos de licencias de BO y PY, Wikipedia (EN/ES).
