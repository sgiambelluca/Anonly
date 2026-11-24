# Word limpio: alineación entre las páginas de LibreOffice y el XML del `.docx`

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\WORD_LIMPIO_ALINEACION.md` el 2026-11-24.
> El corpus, el prototipo y los datos quedan fuera del repo, en
> `C:\Anonly\spikes\lowa\`. Qué decide el planificador con esto:
> `Plan_1.2.md` §8.8.

Fecha: 2026-11-24. Conversor medido: LibreOffice 26.8.3.1 propio (`dynexec0` con el recorte `rec-C`), en un Worker con CSP estricta, con el preproceso de ADR-240 §5 (cambios aceptados, comentarios borrados) y `UseTaggedPDF=false`. Palabras de las páginas con `pdfjs-dist` 4.10.38 del repo, `getTextContent()`. Node 22.23.2, Electron 44.11.5 del repo. No se tocó `C:\Anonly\Anonly` ni se commiteó nada. No se descargó nada. No se usó ninguna contraseña.

**No hay documentos reales** (no hay `ANONLY_REAL_DOC_*` definidas). Los datos de los sintéticos (nombre, DNI, correo, CUIT) son inventados. El resto del corpus son los archivos de prueba del código de LibreOffice, que no son documentos de personas. Todo lo que sigue sale de esos dos corpus; **ningún número es de documentos reales**.

## Veredictos

| # | Punto | Veredicto |
|---|---|---|
| 1 | **Página → XML** | En los **sintéticos**, de 56 lugares con 4 datos cada uno (224 datos), **todo lo que el XML conserva y la página dibuja se ubica en el lugar correcto**, salvo 3 casos (ver §2.1): un pie con texto idéntico en un tipo que se usa y en otro que no (2 candidatos, ambigua), la segunda aparición de un REF que LibreOffice recalcula (parcial) y 1 dato de un encabezado repetido en cada página con el mismo texto en el cuerpo (1 aparición parcial de 5). En el **corpus de LibreOffice** (2.086 `.docx`, 234.918 palabras de página tomadas como detecciones): **91,30 % únicas**, 1,71 % ambiguas, 0,66 % parciales, 6,33 % sin ubicar. Las sin ubicar son en su gran mayoría texto que el XML no tiene (números generados, viñetas, imágenes vectoriales dibujadas como texto). **Las detecciones por patrón** (7 a 11 dígitos, correo, CUIT; 254 en total): 230 únicas (90,6 %), 22 ambiguas (copias idénticas), 2 parciales, 0 sin ubicar. |
| 2 | **XML → página** | **La regla bloquearía el Word en 468 de 2.086 documentos (22,4 %)** si se cuenta cualquier carácter sin par, **235 (11,3 %)** si se cuenta solo una unidad con palabra (3 letras o dígitos seguidos), y **179 (8,6 %)** si además no se cuentan cuatro causas estructurales (campos en caché, encabezados y pies no usados, marcadores de control y notas sin referencia). De los 1.705 documentos con texto en el XML, **1.237 (72,6 %) no tienen ningún carácter sin par**. Las causas están en §3. Qué es seguro de ignorar y qué no **no lo decido yo**: §3.4 lo deja clasificado. |
| 3 | **Control de cambios** | **En 94 de 106 documentos con control de cambios, aceptar los cambios en el XML da el mismo texto que la página de LibreOffice. En 10 no**: LibreOffice deja a la vista texto que el XML borró (`n830205.docx` no es el único: hay 9 más, casi todos "borrado + cambio de formato" y "aceptar todo con cambios superpuestos"). En 2 documentos más falta en la página un texto insertado. Ver §4. |
| 4 | **Tiempos y memoria** | Leer el XML: **mediana 1,1 ms, p99 9 ms, máximo 47 ms** por documento (Node). Alinear: mediana 0 ms, p99 7 ms, máximo 84 ms. El documento de mayor texto del corpus (124.000 caracteres de página, 47 páginas): leer 22 ms y alinear 50 ms en un Worker de Electron. **No escala bien en memoria**: un documento sintético de 8 millones de caracteres tarda 6,2 s y sube el Worker unos 2 GB. Ver §5. |

## 0. Qué se hizo, en una frase

Un lector del `.docx` propio (ZIP + XML, sin DOM, sin dependencias) arma el texto del XML con un mapa de cada carácter a su origen; un alineador propio lo empareja con el texto de las páginas, carácter a carácter; se midió contra 8 sintéticos armados a mano (56 lugares) y contra los 2.104 `.docx` de LibreOffice (2.086 medibles), en Node y en un Worker de Electron.

Conteos del corpus de LibreOffice: 2.104 `.docx`; 14 no convierten (los 4 cifrados con contraseña y 10 corruptos o malformados a propósito: `ofz*`, `EDB-*`, `math-malformed_xml`, `tdf165348_broken_package`, etc.); 4 convierten pero **no son OOXML**: son archivos ODF con extensión `.docx` (tienen `content.xml` y `mimetype`, no `word/document.xml`; el lector falla cerrado y avisa); **2.086 medidos**. De esos, 301 no tienen texto en las páginas (imágenes, vacíos) y 1.705 tienen texto en el XML.

## 1. Diseño

### 1.1 Qué se usó para el ZIP y el XML, y cuánto costó

**No se agregó ninguna dependencia.** Se escribió código propio. No hay `fflate` en el `node_modules` del repo (hay `pako` 1.0.11, que llega por `pdf-lib`, y `sax` 1.6.1, `@xmldom/xmldom` 0.8.15, `adm-zip`, `unzipper`; no se usaron).

| Módulo | Líneas | Qué hace |
|---|---|---|
| `zip.mjs` | 53 | Lee el directorio central; entradas almacenadas o con deflate. Descomprime con `DecompressionStream('deflate-raw')`, que existe en Node 22 y en un Worker de Electron. Acepta otro `inflate` enchufado (se probó `zlib.inflateRawSync`). No soporta ZIP64 ni entradas cifradas (falla cerrado). |
| `xml.mjs` | 101 | Tokenizador y armador de árbol, sin `DOMParser` (en un Worker no hay). Entidades, CDATA, comentarios, DOCTYPE, espacios de nombres canonizados por URI (así importa poco el prefijo), UTF-8 y UTF-16. Guarda solo los textos de `w:t`, `w:instrText`, `w:delText` y `m:t`. |
| `docx.mjs` | 267 | Lector del `.docx`: partes, estilos, secciones, y el recorrido que aplica lo de `Plan_1.2.md` §6.3. |
| `align.mjs` | 262 | Alineador. |
| `analyze.mjs` | 104 | Une lector y alineador; devuelve por carácter de la página a qué carácter del XML corresponde. |
| `pdftext.mjs` | 40 | Palabras de las páginas con `pdfjs` (solo Node; en la app ya existe en `PDF_Engine`). |

Total del código que correría en el Worker (`zip`, `xml`, `docx`, `align`, `analyze`): **787 líneas, unos 46 KB sin minificar**. Con la CSP estricta (sin `unsafe-eval`) corre sin problemas: el banco de §5 usa la misma CSP.

El lector corre un Worker de módulos con `DecompressionStream` y un tokenizador propio. **[NO CONFIRMADO]** cuánto más rápido o lento es contra `sax` o `@xmldom/xmldom` en el mismo Worker: no se midió.

### 1.2 El lector

Lee `document.xml` (la parte que dice `_rels/.rels`), encabezados, pies, notas al pie y notas al final, siguiendo las relaciones. No lee los comentarios (el preproceso ya los borró), ni `docProps`, ni `customXml`.

Aplica lo que el plan dice que se resuelve antes de exportar:

| Cosa | Qué hace el lector |
|---|---|
| Cambios | `w:ins` y `w:moveTo`: el texto entra. `w:del` y `w:moveFrom`: el texto se descarta y se anota. Fila con `w:trPr/w:del`: se descarta entera. `rPrChange` y `pPrChange`: no cambian el texto. **No** se unen los párrafos cuando la marca de párrafo está borrada (solo se anota; no cambia nada en el alineador, que trabaja sin espacios). |
| Texto oculto | `w:vanish` directo, por estilo de carácter (`rStyle`) o por estilo de párrafo (`pStyle`), con la cadena `basedOn` y los valores por defecto del documento. `w:vanish w:val="0"` es visible. No resuelve estilos de tabla ni de numeración. |
| Campos | Complejos (`fldChar` begin, separate, end) y simples (`fldSimple`): entra el **resultado**; el código no. Anidados y que cruzan párrafos andan. |
| `mc:AlternateContent` | Una sola versión: la primera `mc:Choice`. El texto del `mc:Fallback` **no entra** al texto que se alinea; se anota aparte (185 de 2.086 documentos lo tienen: 27.425 caracteres). |
| Cuadros de texto, formas, controles | `w:txbxContent` (DrawingML y VML) y `w:sdt` (de bloque, en línea, con marcador de posición) entran. |
| Otros | `w:tab` y `w:br` dan espacio (no hacen falta para alinear); `w:noBreakHyphen` da `-`; `w:softHyphen` no da nada; `w:sym` da el carácter privado; las referencias a notas se anotan para saber qué notas se usan. |

De cada carácter guarda: nodo `w:t` de origen (parte, párrafo, run, posición del hijo, desplazamiento) y banderas (campo, insertado, símbolo, marcador de posición, ecuación). De cada encabezado y pie guarda si **se usa**: por las secciones (`headerReference` con su `type`, `w:titlePg` y `w:evenAndOddHeaders` de `settings.xml`). Con eso se puede decir qué texto el XML tiene y ninguna página puede mostrar.

Un párrafo con un cuadro de texto adentro queda partido en dos tramos del texto, por eso `p.segs` (el lector lo resuelve; fue un defecto del primer intento).

### 1.3 El alineador

Los dos lados se reducen a una secuencia de caracteres normalizados **sin espacios** (NFKC, minúsculas, guiones unificados, sin guion blando ni marcas invisibles). Eso resuelve de una vez los saltos de línea, las tabulaciones, los espacios, los guiones blandos y los cortes de línea en un guion que ya estaba en el texto. Cada carácter conserva su origen y si empieza una palabra.

**Pasada 1: el cuerpo.** El texto del cuerpo del XML (en orden de documento, sin cuadros de texto) contra **todo** el texto de las páginas (en el orden de `pdfjs`):
1. Anclas = secuencias de 16 caracteres que aparecen **una sola vez** en los dos lados (después 8 y 4). Se queda con la cadena creciente más larga (LIS) y se repite el proceso entre ancla y ancla. Es el patience diff.
2. Los tramos chicos entre anclas (hasta 4 millones de celdas) se resuelven de dos maneras y se queda con la más **contigua**: (a) por "bloque común más largo" recursivo; (b) por LCS exacta. La LCS sola empareja por pedazos dos textos que comparten una plantilla ("Nombre: … DNI … Correo …") y deja en cualquier parte los caracteres de una palabra; el bloque común solo falla cuando el texto es un solo bloque repetido ("Lorem Lorem Lorem…"). Quedarse con la más contigua anduvo mejor que cada una por separado (XML sin par: 49.254 caracteres contra 49.414 con LCS sola y 52.690 con bloques solos).
3. **Compuerta de calidad:** un tramo entre anclas solo vale si lo emparejado cubre el 60 % del lado más chico. Evita que dos textos de la misma plantilla se emparejen por pedazos.
4. Un tramo corto de coincidencia (menos de 4 caracteres seguidos) solo vale si es una palabra entera de los dos lados.

**Pasada 2: lo que no es cuerpo.** Cada párrafo del XML que no entró a la pasada 1 es una "unidad": encabezados, pies, notas, cuadros de texto, y los trozos del cuerpo que quedaron sin par. Se busca cada unidad en los tramos de página que quedaron sin par: índice de 4-gramas, "semillas" agrupadas por diagonal, y se alinea una ventana alrededor de cada grupo con la misma rutina. **Una unidad puede aparecer muchas veces** (un encabezado en cada página): todas esas apariciones apuntan a la misma ubicación del XML, y eso no es ambigüedad. Una unidad de menos de 4 caracteres no se busca.

**Consistencia:** una palabra de la página no puede venir de dos párrafos del XML. Si los caracteres de una palabra caen en dos párrafos, se queda con el que cubre más y se suelta el resto.

**Cómo desempata**, en este orden:
1. **El orden de documento manda**: un carácter repetido se ubica donde cae la cadena monótona de anclas, no donde aparezca primero.
2. En un tramo entre anclas, los empates entre pedazos iguales se resuelven **dos veces** (el primero o el último). Si las dos alineaciones no coinciden en un carácter, ese carácter es **ambiguo** ("por orden": 64 palabras en todo el corpus).
3. En la pasada 2, si dos unidades reclaman los mismos caracteres de la página gana la que cubre mayor proporción de sí misma (y después, la que alinea más caracteres). Si empatan —texto idéntico en dos encabezados, o la misma dirección repetida 10 veces en una hoja de etiquetas— el carácter queda con **varios candidatos**: ambiguo ("por unidades idénticas": 3.945 palabras, casi todas en pocos documentos).
4. Lo que no se pudo decidir **no se elige**: queda ambiguo. No se usa la posición en la página ni la sección para desempatar.

**Estados de una detección** (rango de caracteres de la página): `unica` = todos con un solo candidato, consecutivos en el XML; `ambigua` = todos con par pero alguno con más de un candidato; `parcial` = algunos con par; `ninguna` = ninguno; `desordenada` = con par pero fuera de orden. Se ignoran en el borde de una palabra los guiones, viñetas y símbolos privados que el XML no tiene, si el resto tiene par (39 palabras).

**Lo que falta o falla del diseño** (honesto):
- Las ligaduras árabes y persas (lam-alef) salen invertidas de `pdfjs` y no alinean (6 documentos).
- Un texto hecho de un solo bloque repetido muchas veces (`Lorem Lorem…`, `xxxxxxxx`) alinea peor (w1441, w1930, w0256).
- La pasada 2 no busca unidades de menos de 4 caracteres.
- `giveUp`: 3 documentos con un tramo que superó el límite de la LCS sin anclas.
- **No** se unen los párrafos con la marca borrada; **no** se modela `w:vanish` de la marca de párrafo; **no** se resuelven estilos de tabla.

## 2. Resultado 1: página → XML

### 2.1 Sintéticos, lugar por lugar

Corpus: `corpus-word-limpio\` (8 `.docx`, generados por `harness\word-limpio\gen-sint.cjs`, 56 lugares, 4 datos en cada uno: nombre, DNI, correo, CUIT; **224 datos**). Cada párrafo con datos lleva la etiqueta `LUG:<lugar>`, para saber sin duda a qué lugar pertenece. Cada columna con cuatro valores va en el orden **nombre, DNI, correo, CUIT**.

- **"XML / página"**: cuántas veces está el dato en el XML que queda (sin el texto del `Fallback`) y cuántas en las páginas.
- **"Estado"**: lo que dice el alineador para cada aparición en la página.
- **"¿Lugar correcto?"**: si el párrafo del XML al que apunta es el que lleva la etiqueta del lugar.
- **"XML sin par"**: apariciones del dato en el XML que ninguna aparición de la página alcanza (regla XML → página).

| Doc | Lugar | XML / página | Estado | ¿Lugar correcto? | XML sin par | Dónde |
|---|---|---|---|---|---|---|
| s01 | cuerpo | 1/1 ×4 | única ×4 | sí ×4 | 0 | document.xml |
| s01 | tabla | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | tabla anidada | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | lista numerada | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | hipervínculo | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | cuadro de texto (DrawingML) | 1/1 ×4 | única ×4 | sí | 0 | document.xml [cuadro] |
| s01 | cuadro VML (legado) | 1/1 ×4 | única ×4 | sí | 0 | document.xml [cuadro] |
| s01 | forma con texto | 1/1 ×4 | única ×4 | sí | 0 | document.xml [cuadro] |
| s01 | control de contenido, bloque | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | control de contenido, en línea | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | control con marcador de posición | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | campo MERGEFIELD (resultado en caché) | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s01 | **campo REF: texto de origen** | 1/**2** ×4 | única + parcial ×4 | la 1.ª sí; la 2.ª es el REF | 0 | document.xml |
| s01 | **campo REF: resultado en caché** | 1/**0** ×4 | – | n/a | **1** ×4 | (LibreOffice recalcula el REF y dibuja el texto de origen) |
| s01 | **campo DATE: resultado en caché** | 1/**0** ×4 | – | n/a | **1** ×4 | (LibreOffice dibuja la fecha de hoy) |
| s02 | encabezado, sección 1, primera página | 1/1 ×4 | única ×4 | sí | 0 | header_s1_first |
| s02 | encabezado, sección 1, pares | 1/1 ×4 | única ×4 | sí | 0 | header_s1_even |
| s02 | encabezado, sección 1, impares | 1/1 ×4 | única ×4 | sí | 0 | header_s1_default |
| s02 | pie, sección 1, primera | 1/1 ×4 | única ×4 | sí | 0 | footer_s1_first |
| s02 | pie, sección 1, pares | 1/**3** ×4 | 3× única ×4 | sí | 0 | footer_s1_even |
| s02 | pie, sección 1, impares | 1/**4** ×4 | 4× única ×4 | sí | 0 | footer_s1_default |
| s02 | encabezado, sección 2, impares | 1/1 ×4 | única ×4 | sí | 0 | header_s2_default |
| s02 | encabezado, sección 2, pares | 1/1 ×4 | única ×4 | sí | 0 | header_s2_even |
| s02 | encabezado, sección 3, primera | 1/1 ×4 | única ×4 | sí | 0 | header_s3_first |
| s02 | encabezado, sección 3, impares | 1/1 ×4 | única ×4 | sí | 0 | header_s3_default |
| s02 | encabezado, sección 3, pares | 1/1 ×4 | única ×4 | sí | 0 | header_s3_even |
| s02b | encabezado `default` (se usa) | 1/2 ×4 | 2× única ×4 | sí | 0 | header_a_default |
| s02b | **encabezado `first` sin `titlePg`** | 1/**0** ×4 | – | n/a | **1** ×4 | (no se usa) |
| s02b | **encabezado `even` sin `evenAndOddHeaders`** | 1/**0** ×4 | – | n/a | **1** ×4 | (no se usa) |
| s02b | **encabezado sin referencia en ninguna sección** | 1/**0** ×4 | – | n/a | **1** ×4 | (huérfano) |
| s02b | **pie con texto idéntico en `default` y `first` (este no se usa)** | **2**/2 ×4 | 2× **ambigua** ×4 | sí | **1** ×4 | footer_a_default ~ footer_b_first |
| s03 | nota al pie | 1/1 ×4 | única ×4 | sí | 0 | footnotes |
| s03 | nota al final | 1/1 ×4 | única ×4 | sí | 0 | endnotes |
| s03 | **nota al pie sin referencia** | 1/1 ×4 | única ×4 | sí | 0 | footnotes (ver abajo) |
| s03 | **nota al pie partida en 3 runs** | 1/**0** ×4 | – | n/a | **1** ×4 | (ver abajo) |
| s04 | dato partido en 3 runs con formato distinto | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s04 | guion blando (U+00AD) en el apellido y `w:noBreakHyphen` en el CUIT | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s04 | tabulación dentro del nombre y del DNI | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s04 | salto de línea dentro del nombre y entre DNI y correo | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s04 | celda angosta (el CUIT y el correo se cortan en la línea) | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s04 | mayúsculas por formato (`w:caps`); solo nombre y DNI | 1/1 ×2 | única ×2 | sí | 0 | document.xml |
| s05 | cambio insertado | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s05 | cambio borrado (`w:del`) | 0/0 ×4 | – | n/a | 0 | no está en el XML ni en la página: bien |
| s05 | fila borrada | 0/0 ×4 | – | n/a | 0 | bien |
| s05 | dato viejo en un reemplazo | 0/0 ×4 | – | n/a | 0 | bien |
| s05 | cambio de formato (`rPrChange`) | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s05 | párrafo tras una marca de párrafo borrada | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s05 | movido (`moveFrom` + `moveTo`): una sola vez | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s05 | reemplazo (`w:del` + `w:ins`) | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s06 | texto oculto, `w:vanish` directo | 0/0 ×4 | – | n/a | 0 | bien |
| s06 | texto oculto por estilo de carácter | 0/0 ×4 | – | n/a | 0 | bien |
| s06 | texto oculto por estilo de párrafo | 0/0 ×4 | – | n/a | 0 | bien |
| s06 | `w:vanish w:val="0"` (visible) | 1/1 ×4 | única ×4 | sí | 0 | document.xml |
| s06 | `mc:AlternateContent`: texto en Choice y en Fallback | 1/1 ×4 (+1 copia en Fallback) | única ×4 | sí | 0 (la copia del Fallback va aparte) | document.xml [cuadro] |
| s07 | mismo párrafo 3 veces en el cuerpo y 1 en una celda | 4/4 ×4 | 4× única ×4 | sí | 0 | document.xml |
| s07 | encabezado en cada página y el mismo dato en el cuerpo | 2/5 ×4 | 5× única (×3); en el CUIT: 4× única + 1 parcial | sí | 0 | header_default + document.xml |

Resumen de los 224 datos: **todo lo que el XML conserva y la página dibuja se ubica en el lugar correcto**, salvo estos casos, ordenados por causa:

1. **Texto idéntico en un pie que se usa y en otro que no se usa** (s02b): la página muestra una sola copia y el XML tiene dos. El alineador devuelve las dos como candidatas (`ambigua`), que es lo correcto: no hay forma de saber cuál es solo con el texto. La regla XML → página marca el pie que no se usa como sin par.
2. **REF recalculado** (s01): la página muestra, donde el XML tiene el resultado en caché del REF, el texto de origen. Esa segunda aparición del dato en la página queda `parcial` (no coincide con el XML de ese lugar) y el resultado en caché queda sin par.
3. **El mismo CUIT en el encabezado y en el cuerpo** (s07, 1 de 20 datos): una aparición `parcial` de 12 de 13 caracteres, porque el último carácter coincidía con el cuerpo y la regla de consistencia lo soltó. Es la "copia idéntica en dos lugares" y el alineador no puede decir cuál es; el planificador tiene que saber que ocurre.
4. **Nota al pie fuera de orden** (s03): **LibreOffice empareja las notas con sus referencias por orden y no por identificador.** El documento tiene las notas con identificadores 1, 2 y 4, y referencias a la 1 y a la 4. LibreOffice dibuja como 2.ª nota el texto de la nota **2** (la que nadie referencia), y no dibuja la nota 4. Efecto: la página muestra el texto de una nota que "no se usa" y no muestra la que sí. Es un hallazgo del conversor, no del alineador. La regla XML → página lo detecta (la nota 4 queda sin par). No se midió con un `.docx` que Word escriba con huecos en los identificadores. **[NO CONFIRMADO]** con qué frecuencia pasa en documentos reales.

### 2.2 Corpus de LibreOffice, todas las palabras como detecciones

Cada palabra de las páginas (separadas por la geometría de `pdfjs` y los espacios) es una detección. 234.918 palabras en 1.785 documentos con texto en las páginas.

| Estado | Palabras | % |
|---|---|---|
| **Única** (un solo candidato, en el lugar) | 214.477 | **91,30 %** |
| Ambigua | 4.009 | 1,71 % |
| Parcial | 1.557 | 0,66 % |
| Ninguna (sin ubicar) | 14.872 | 6,33 % |
| Desordenada | 3 | 0,001 % |

Por documento: de los 1.785 con texto, **1.008 (56,5 %) tienen todas las palabras únicas**; 758 (42,5 %) tienen al menos una palabra sin ubicar (ninguna o parcial); 85 tienen al menos una ambigua. Esto cuenta *todas* las palabras, también números de lista y de página, que no son datos personales.

**Las ambiguas, por origen:** 64 por empate de orden en un tramo, **3.945 por unidades idénticas** (la misma dirección repetida en una hoja de etiquetas: w1572 tiene las 170 palabras ambiguas; los encabezados y pies con el mismo texto de w0412; copias de w0968 y w0969). En todos los casos los candidatos tienen el mismo texto.

**Las sin ubicar (ninguna o parcial), por causa** (documentos | palabras):

| Causa | Docs | Palabras | Qué es |
|---|---|---|---|
| Documento con imágenes vectoriales (WMF/EMF/SVG) y palabra sin par | 24 | 5.508 | LibreOffice dibuja como **texto** el texto de las imágenes vectoriales (w0032: 76 páginas, todo imágenes WMF). El XML no lo tiene. **[NO CONFIRMADO]** que sea esa la causa en cada uno de los 24: se asigna por la presencia de media vectorial en el paquete, no por cada palabra. |
| Sin causa asignada | 286 | 3.478 | Letras y símbolos sueltos (por ejemplo las letras de una ecuación), palabras cortadas. No se pudo asignar. |
| La palabra existe en el XML pero no se alineó | 339 | 2.184 | Texto repetido, partes de una palabra cortada, o falla del alineador. |
| Número corto generado (lista, nota, página, campo) | 312 | 1.967 | "1", "2", "12"… |
| Viñeta o símbolo de lista | 91 | 989 | Guiones, puntos, símbolos privados. |
| Etiqueta de lista generada (`a.`, `1.`, `i.`) | 133 | 953 | La numeración de LibreOffice. |
| Número o fecha de un campo recalculado | 105 | 832 | "1.1.1", "Capítulo…………" (tabla de contenido recalculada). |
| Texto en otra parte del paquete (gráfico, diagrama, dibujo) | 55 | 466 | Texto de `word/charts`, `word/diagrams`, `word/drawings`. **El lector no lee esas partes**: un dato en un gráfico no se ubica en el XML. |
| Relleno (puntos guía, líneas) | 12 | 52 | |

### 2.3 Corpus de LibreOffice, detecciones por patrón

| Patrón | Detecciones | Única | Ambigua | Parcial | Ninguna | Docs |
|---|---|---|---|---|---|---|
| Número de 7 a 11 dígitos, con o sin puntos | 174 | 174 | 0 | 0 | 0 | 16 |
| CUIT (`dd-dddddddd-d`, con o sin guiones) | 4 | 4 | 0 | 0 | 0 | 1 |
| Correo | 76 | 52 | 22 | 2 | 0 | 17 |

Las 22 ambiguas son copias idénticas del mismo correo en hojas de etiquetas (w1572, w0303). Los 2 parciales son de w1930, un documento de prueba con el texto reemplazado por `xxxx` (mucho texto repetido). **Son pocos datos** (254 en total, 34 documentos): no alcanza para una proporción confiable de datos personales reales; sirve para ver que los números largos, los correos y los CUIT, que son lo que más importa, se ubican.

## 3. Resultado 2: XML → página

Texto del XML que quedaría en el Word limpio y no tiene par en las páginas. Solo se cuenta el texto del XML que **no** es del `Fallback` de `mc:AlternateContent` (ese se cuenta aparte).

- Caracteres normalizados del XML que quedan: **1.189.669**.
- **Sin par: 49.254 (4,14 %)**, en 2.745 unidades (párrafos o trozos), de las cuales 1.311 contienen una palabra (3 letras o dígitos seguidos).
- Aparte: **27.425 caracteres** viven solo en el `Fallback` de `AlternateContent`, en **185 documentos**.
- **Documentos con al menos un carácter sin par: 468 de 2.086 (22,4 %). Con al menos una unidad con palabra: 235 (11,3 %).**
- De 1.705 documentos con texto en el XML, **1.237 no tienen nada sin par**.

### 3.1 Causas

Por documento y por carácter. "Docs con palabra" = documentos con al menos una unidad de 3 o más letras o dígitos seguidos.

| Causa | Docs con ≥1 carácter | Docs con palabra | Caracteres | Ejemplos |
|---|---|---|---|---|
| **Sin causa asignada** (el conversor no lo dibuja o no se encontró) | 201 | 84 | 16.126 | w0164: texto recortado por un marco (10.790 caracteres; la página no tiene esas frases, ver abajo). w1812: la bibliografía no se dibuja (3.085). Resto: fragmentos de 1 a 5 caracteres en 116 documentos. |
| **Texto de cuadro o forma que no se dibujó** | 78 | 46 | 8.052 | w2024 (2.430), w0240, w0143, w0296, w1591: texto de cuadros que LibreOffice no dibuja o cuyo texto no se encuentra en la página. |
| **Árabe, hebreo, persa** (las ligaduras y el orden de extracción son otros) | 6 | 5 | 6.299 | w1901, w1051, w1394, w0352. **Falla del alineador y de `pdfjs`**, no texto no dibujado: el texto está en la página. |
| **Copia repetida que la página dibuja menos veces** | 11 | 11 | 6.859 | w0033, w0164, w0240: el mismo texto aparece N veces en el XML y menos en la página. |
| **Encabezado o pie de un tipo que no se usa** (`first` sin `titlePg`, `even` sin `evenAndOddHeaders`) o **sin referencia en ninguna sección** | 58 | 39 | 3.640 | w0017, w0018, w0103, w0551. |
| **El texto está en la página y no se alineó** | 58 | 58 | 3.904 | Falla del alineador (o del texto repetido). Se separó "el texto está en la página y aparece al menos tantas veces como en el XML". |
| **Escritura sin fuente** (chino, japonés, coreano, tailandés) | 10 | 8 | 2.083 | w0347, w0477, w0993. LibreOffice no dibuja esos caracteres (ya medido en `CALIDAD.md`). |
| **Campo con resultado en caché que LibreOffice no dibuja o recalcula** | 171 | 25 | 1.207 | Ver abajo. |
| **Nota al pie o al final que ninguna referencia usa** | 4 | 4 | 546 | w0203, w0357, w0568. |
| **Marcador de posición de un control de contenido** | 14 | 14 | 509 | w0326 (`[Type text]`), w0496. |
| Símbolo (`w:sym`) | 3 | 2 | 29 | w1071. |

**Campos**, por tipo (documentos): `PAGE` 113, `PAGEREF` 21, `SEQ` 7, `TOC` 7, `DATE` 3, `NUMPAGES` 3, `REF` 4, `PRINTDATE` 2, `SAVEDATE` 3, `FILENAME` 1, `DOCPROPERTY` 1, `STYLEREF` 3, `BIBLIOGRAPHY` 1 (172 caracteres), `CITATION` 2, `ASK` 1, y fórmulas de tabla (`=SUM(LEFT)` y similares). **Casi todo `PAGE` es 1 a 3 dígitos** (233 caracteres en 113 documentos) en encabezados y pies, y en esos casos el resultado en caché existe en el XML y LibreOffice dibuja otro número. Dos tipos pueden llevar un dato: `FILENAME` (210 caracteres), `DOCPROPERTY` (9), `BIBLIOGRAPHY` y `CITATION` (229), `SET` (67), `ASK` (20), `DOCVARIABLE` (10).

**Recorte por marco (w0164):** el documento tiene párrafos con texto largo cuya página dibuja cada línea cortada ("…ИА REGNUM сообщил" y se corta; el resto de la frase no está en la página). Es el comportamiento de LibreOffice con un marco de alto fijo. Es **texto real del Word que no está en el PDF**: si ahí hubiera un dato, no se detectaría.

**Línea de la celda girada (w0264):** el caso ya conocido de `tdf127118.docx` (celda `btLr` que LibreOffice deja en blanco) aparece con 56 caracteres sin par. **La regla XML → página lo detecta**, que es lo que se buscaba.

### 3.2 Cuántos documentos bloquearía la regla

De 2.086 documentos medidos:

| Escenario (qué se cuenta como "sin par") | Docs | % |
|---|---|---|
| A. Cualquier carácter del XML sin par | 468 | 22,4 % |
| B. Al menos una unidad con palabra (3 o más letras o dígitos seguidos) | 235 | 11,3 % |
| C. Como A, sin contar campos, encabezados/pies no usados, marcadores de control y notas sin referencia | 304 | 14,6 % |
| D. Como B, sin contar esas cuatro causas | 179 | 8,6 % |
| E. Como D, sin contar tampoco CJK/tailandés ni árabe/hebreo/persa | 167 | 8,0 % |
| F. Solo texto de cuadro o forma sin dibujar + sin causa asignada + copia repetida | 133 | 6,4 % |
| G. F más "el texto está en la página y no se alineó" | 167 | 8,0 % |

Por causa, cuántos documentos tienen ≥1 carácter y cuántos ≥1 unidad con palabra: campo 171/25; encabezado o pie no usado 58/39; marcador de control 14/14; nota sin referencia 4/4; cuadro o forma sin dibujar 78/46; CJK/tailandés 10/8; árabe/hebreo/persa 6/5; sin causa asignada 201/84; copia repetida no dibujada 11/11; alineador 58/58.

**Para dimensionar:** el corpus de LibreOffice está lleno de documentos hechos para romper el importador (encabezados huérfanos, campos exóticos, notas fuera de orden). Los documentos reales de oficina tienen menos de eso, pero no se midió con ninguno **[NO CONFIRMADO]**. Un solo caso medido sobre la regla: si la regla cuenta cualquier carácter, un `PAGE` en caché en un encabezado ya bloquea el Word (113 documentos, 5,4 % del corpus).

### 3.3 Más cosas que se vieron

- **El Fallback de `AlternateContent` no tiene par**: es texto que el XML duplica y la página no. Si el Word limpio conserva las dos versiones (una de las opciones de `Plan_1.2.md` §6.3), esos 27.425 caracteres en 185 documentos quedan sin par por construcción. Si se deja una sola, no cuentan.
- **Cuadros y formas que sí se dibujan se ubican bien** (sintéticos, 3 tipos: DrawingML, VML y forma con texto).
- **Documentos con imágenes vectoriales**: el caso contrario. El texto está en la página y no en el XML (es la causa más grande de la dirección página → XML: 5.508 palabras en 24 documentos).

### 3.4 Qué causas son seguras de ignorar y cuáles son texto real que no se dibujó

**Lo reporto, no lo decido.** Clasificación según lo que midió el spike:

| Grupo | Causas | Qué es |
|---|---|---|
| **Texto del XML que ninguna página puede mostrar por diseño** (las páginas son lo que Word imprime) | encabezado o pie de un tipo que no se usa o huérfano; nota que ninguna referencia usa; resultado en caché de un campo que LibreOffice recalcula (`PAGE`, `NUMPAGES`, `DATE`, `REF`…); marcador de posición de un control; copia del `Fallback` | Ese texto **sigue estando dentro del archivo `.docx`**. Si contiene un dato, el Word limpio lo llevaría en claro aunque el visor no lo muestre. Ignorarlo solo es seguro si el reemplazo se hace **por valor en todo el XML** y no solo en las ubicaciones que salieron de las páginas. Ver el punto de abajo. |
| **Texto real del Word que LibreOffice no dibuja** | texto de cuadro o forma sin dibujar; recorte por marco o por celda; escrituras sin fuente (CJK, tailandés); celda girada; gráficos y bibliografías; "sin causa asignada" | Texto que el usuario ve en Word y la app no ve. **No es seguro ignorarlo**: no se detecta. |
| **Falla del alineador o de `pdfjs`** | el texto está en la página y no se alineó; árabe, hebreo y persa; copias repetidas | El texto sí está en la página. Con un alineador mejor, bajan. |

**Un punto que el planificador debe saber:** la regla 1 (página → XML) y la regla 2 (XML → página) se complementan solo si el reemplazo se hace *por ubicación*. Los datos que viven en las "causas estructurales" (un encabezado huérfano, una nota sin referencia, un resultado en caché) no se detectan en ninguna página, así que **ninguna** de las dos reglas los cubre excepto la regla 2, que es justo la que los bloquea. Si la regla 2 se relaja, hay que reemplazar por valor en todo el XML, y el gate de §6.3 (abrir el Word exportado y buscar los valores originales) es lo único que lo atrapa.

## 4. Resultado 3: control de cambios

**Pregunta:** ¿aceptar los cambios en el XML da el mismo texto que la página de LibreOffice después del preproceso?

Documentos con control de cambios (inserciones, borrados, movimientos, filas borradas o marca de párrafo borrada): **106**. De ellos, 80 tienen texto borrado (`w:del` o `moveFrom`), 42 tienen marca de párrafo borrada y 8 tienen filas borradas.

- **En 94 documentos el texto es el mismo.** El texto insertado está y el borrado no, tanto en el XML como en la página.
- **En 10 documentos, LibreOffice deja a la vista texto que el XML borró** (para detectarlo: caracteres de la página sin par que se descomponen enteros en fragmentos de texto borrado del XML):

| Doc | Archivo de prueba de LibreOffice | Caracteres borrados que la página dibuja |
|---|---|---|
| w0825 | `n830205.docx` (el caso conocido) | 453 |
| w0189 | `redline-image-anchored.docx` | 297 |
| w2003 | `tdf150443.docx` | 114 |
| w0037 | `del-then-format-own.docx` | 20 |
| w1990 | `reject-all-overlap.docx` | 20 |
| w1501 | `tdf170952_delText.docx` | 16 |
| w1984 | `accept-all-overlap.docx` | 15 |
| w0236 | `merge_hidden_redline.docx` | 12 |
| w0038 | `del-then-format.docx` | 3 |
| w0506 | `del-then-format.docx` | 3 |

  Los de 3 caracteres (`bbb`) pueden ser texto que coincide por azar; los demás son texto borrado que se ve. El patrón: **un borrado que además tiene un cambio de formato encima** (`w:del` con `rPrChange`), o cambios superpuestos. Es la misma limitación de LibreOffice que ADR-240 §5 ya describe para `n830205.docx`, pero **no está acotada a ese archivo**.
- **En 2 documentos falta en la página un texto insertado:** `w0052` (`tdf150086.docx`, 1 carácter) y `w1086` (`tdf123054.docx`, 4 caracteres).
- **Efecto sobre el Word limpio:** el texto borrado que LibreOffice dibuja **no está en el XML aceptado**, así que no viaja al Word. La página tiene texto que el XML no tiene: la detección que cae ahí no se ubica (regla 1) y bloquearía el Word, sin que haya fuga. Es un bloqueo de más, no un riesgo de seguridad, y afecta a 10 de 106 documentos con cambios (0,5 % del corpus). **El caso contrario (texto que el XML conserva y la página no) tampoco se vio con cambios:** `moveFrom` visible en la página, 0 documentos.
- **Texto oculto:** 6 documentos con `w:vanish`; en 1 la página dibuja texto que el XML esconde (w1831, `tdf154370.docx`: un estilo de párrafo y un estilo de carácter ocultos con "CharStyle Hidden" visible). **[NO CONFIRMADO]** qué haría Word con ese archivo.
- **Sintéticos (s05, 8 lugares):** insertado, movido (una sola vez), reemplazo, cambio de formato, párrafo tras marca borrada: todo igual en el XML y en la página. Borrado, fila borrada y dato viejo del reemplazo: no están en ninguno de los dos.

## 5. Resultado 4: tiempos y memoria

### 5.1 Todo el corpus, en Node (un solo proceso, JIT caliente)

2.086 documentos medidos. Leer el XML = abrir el ZIP, parsear las partes y armar el texto. Alinear = normalizar, pasada 1 y pasada 2.

| | p50 | p90 | p99 | máximo |
|---|---|---|---|---|
| Leer (ms) | 1,1 | 2,8 | 9 | 46,6 |
| Alinear (ms) | 0 | 0,3 | 6,9 | 84,4 |
| Tamaño del `.docx` (bytes) | 15.402 | 36.317 | 206.920 | 935.746 |
| Páginas | 1 | 2 | 11 | 76 |
| Caracteres de página | 29 | 717 | 10.814 | 123.717 |

Ningún documento llegó al presupuesto de 60 s de la pasada 2; 3 documentos tuvieron un tramo sin anclas que pasó el límite de la LCS (`giveUp`); 80 tuvieron algún tramo rechazado por la compuerta de calidad.

### 5.2 Muestra de 21 documentos, Node y Worker de Electron

Mediana de 7 corridas en Node (5 en los sintéticos grandes) y de 5 en el Worker, en el mismo equipo, una corrida a la vez. "Primera" = la primera corrida del Worker (en frío). Memoria del Worker: el proceso de la página (`Tab`) que lo contiene, sumando todas las corridas del documento; el proceso conserva lo que tomó, así que el valor de "base" crece de a poco entre documentos.

| Doc | `.docx` KB | Caracteres XML | Node: leer / alinear (ms) | Worker: leer mediana (primera) | Worker: alinear mediana (primera) | Memoria del Worker, base → pico (MB) |
|---|---|---|---|---|---|---|
| w0395 (47 págs.) | 117 | 133.982 | 39,3 / 65,9 | 21,8 (40,5) | 50,0 (72,2) | 61 → 191 |
| w1486 | 94 | 98.757 | 25,2 / 44,4 | 12,9 (17,2) | 27,7 (31,4) | 163 → 218 |
| w1901 (60 págs.) | 74 | 84.375 | 51,5 / 46,4 | 22,2 (22,2) | 41,7 (53,4) | 218 → 256 |
| w0164 | 383 | 67.040 | 15,8 / 32,0 | 7,6 (9,1) | 26,9 (33,1) | 252 → 274 |
| w0013 | 73 | 49.294 | 16,3 / 17,4 | 8,4 (10,5) | 11,2 (14,4) | 265 → 272 |
| w0008 | 47 | 41.257 | 15,8 / 16,6 | 9,1 (7,8) | 13,6 (10,8) | 270 → 284 |
| w0648 | 444 | 43.233 | 20,9 / 18,3 | 8,4 (8,9) | 10,8 (10,8) | 283 → 294 |
| w1927 | 23 | 33.179 | 9,0 / 6,7 | 5,6 (5,6) | 4,6 (4,6) | 291 → 299 |
| w0228 | 60 | 29.512 | 9,6 / 8,3 | 4,6 (4,9) | 5,4 (5,6) | 296 → 303 |
| w0032 (76 págs., imágenes) | 98 | 0 | 2,7 / 1,7 | 2,8 (3,1) | 2,0 (2,0) | 299 → 301 |
| w0635 (914 KB, imágenes) | 914 | 0 | 0,9 / 0 | 0,7 (0,8) | 0 (0,1) | 307 → 312 |
| w1340 (1 línea) | 6 | 31 | 0,9 / 0,1 | 0,2 (0,3) | 0 (0,1) | 303 → 303 |
| s01-lugares (sintético) | 6 | 2.543 | 1,1 / 2,0 | 0,6 (1,0) | 1,1 (1,6) | 312 → 314 |
| s02-encabezados (sintético) | 10 | 1.381 | 3,3 / 9,1 | 0,7 (0,9) | 8,2 (8,8) | 314 → 314 |
| s07-repetidos (sintético) | 4 | 1.496 | 1,1 / 0,5 | 0,4 (0,3) | 0,5 (0,5) | 314 → 315 |
| **grande-500** (sintético, 38 págs.) | 39 | 130.722 | 21,8 / 50,4 | 6,8 (7,9) | 33,1 (34,6) | 316 → 341 |
| **grande-5000** (sintético, 380 págs.) | 357 | 1.329.675 | 183,5 / 858,2 | 109,6 (110,8) | 657,9 (635,4) | 343 → 607 |
| **grande-30000** (sintético, 2.277 págs.) | 2.120 | 7.977.955 | 1.003 / 6.659 | 611 (611) | 6.172 (6.172) | 346 → **2.407** |

(Los tres "grande" tienen un texto de páginas armado a partir del propio XML, repartido en líneas y páginas con encabezado: **no sale de LibreOffice**. Sirve para ver cómo escala, no para medir calidad.)

- **El Worker corre con la CSP estricta** (`script-src 'self'`, sin `unsafe-eval`) y el mismo código. En esta máquina las medianas del Worker salieron más bajas que las de Node (la lectura, la mitad; alinear, entre 10 y 30 % menos en los documentos grandes). No se investigó por qué (Node mide en un proceso que ya corrió el resto del banco; el Worker corre después de varias repeticiones del mismo documento): **no hay que tomar la diferencia como una ventaja del Worker**. La primera corrida del Worker es la de "frío" y es del orden de 1,0 a 1,9 veces la mediana.
- **`inflate`:** `DecompressionStream` (la opción que sirve en un Worker, sin dependencia) contra `zlib.inflateRawSync` (solo Node): para el documento de 117 KB, 39 ms contra 23 ms de lectura. La diferencia es una constante de unos 10 a 15 ms en los documentos grandes, y de menos de 1 ms en los chicos.
- **Memoria en Node:** pasada completa de un documento de 124.000 caracteres: 48 MB de montículo. El `rss` del proceso ronda 140 a 170 MB (casi todo es Node mismo).
- **Memoria en el Worker:** el documento de mayor texto del corpus de LibreOffice sube el proceso de la página unos 130 MB la primera vez (incluye el calentamiento del motor), los de 30.000 a 100.000 caracteres entre 10 y 55 MB, los de menos de 30.000 menos de 15 MB.
- **A 1,3 millones de caracteres** (≈ 380 páginas de texto): 0,8 s para alinear y 260 MB de más. **A 8 millones** (≈ 2.300 páginas): 6,2 s y unos **2 GB** de más. El costo está en las tablas de anclas y en el texto normalizado (cuatro arreglos de 4 bytes por carácter). Un documento real así de grande queda fuera de lo que se midió **[NO CONFIRMADO]**; si importa, hay que acotar la memoria (alinear por tramos de página).
- **Lo más lento del corpus real** (Node, alinear): w0395 85 ms (47 págs., 124.000 caracteres), w0008 51 ms, w1901 42 ms, w0013 42 ms, w1486 37 ms.
- El tiempo de extraer las palabras con `pdfjs` (`getTextContent`) **no** se incluyó en "leer" ni en "alinear" porque en la app ya existe. En Node, sobre el corpus: mediana 1 ms por documento, p90 4 ms, p99 28 ms, máximo 204 ms (abrir el PDF y leer el texto de todas las páginas). **[NO CONFIRMADO]** el tiempo en el Worker del motor de PDF de la app.

## 6. Cosas que contradicen o completan informes anteriores

1. **LibreOffice empareja las notas por orden, no por identificador** (§2.1). `PREPROCESO_Y_CIFRADO.md` y `BORDES.md` no lo tenían.
2. **`n830205.docx` no es el único caso en que LibreOffice acepta distinto que Word** (§4): son 10 archivos de prueba, casi todos de "borrado + cambio de formato" y "cambios superpuestos". ADR-240 §5 lo trata como un caso aislado ("es una diferencia de fidelidad, no una fuga"). Sigue siendo cierto que no hay fuga (el texto no entra al XML aceptado), pero la proporción es del 9 % de los documentos con cambios, no uno solo.
3. **Los encabezados y pies que el `.docx` trae y la página no usa** (un `first` sin `titlePg`, un `even` sin `evenAndOddHeaders`, un archivo huérfano) están en 58 de 2.086 documentos y **viajan en el Word limpio**. `Plan_1.2.md` §6.3 dice que "entran" los encabezados y pies; la regla XML → página los marca sin par.
4. **Las imágenes vectoriales (WMF, EMF) dibujan texto en las páginas** (24 documentos, 5.508 palabras). Ese texto no es del XML y la detección que cae ahí no tiene dónde reemplazarse en el XML: tendría que ir por el camino de las imágenes.

## 7. Sin medir ([NO CONFIRMADO])

- **Documentos reales** hechos por Word: no hay. El corpus de LibreOffice tiene muchos archivos hechos con Word, pero están elegidos para romper el importador.
- **Excel y PowerPoint**: este spike es solo de `.docx`.
- **Corte de palabra automático de LibreOffice** (guion que LibreOffice agrega): en el corpus aparece como un `-` sin par al final de la línea (39 palabras con una marca en el borde, y el caso `Glie-derung` no se pudo aislar). No se midió cuántos documentos lo activan. Los cortes en un guion que ya estaba en el texto, y los guiones blandos, andan (sintéticos).
- **Word real con huecos en los identificadores de las notas** (para ver si el hallazgo de las notas por orden pasa en archivos reales).
- **La proporción de datos personales reales** que caerían en cada causa (el corpus no tiene datos).
- **Estilos de tabla y de numeración con `w:vanish`**, **marca de párrafo oculta** y **`w:specVanish`**: el lector no los resuelve.
- **Texto girado, columnas, texto en vertical** en el orden de lectura de `pdfjs`: no se trató aparte.
- **`getTextContent()` suficiente**: en el corpus alcanzó. No hizo falta `getOperatorList()` ni anotaciones. En las páginas con árabe, hebreo y persa no alcanza para alinear (ligaduras invertidas, ya conocido de `BORDES.md`).
- **Velocidad contra `sax` o `@xmldom/xmldom`**, y contra `DOMParser` del renderizador.
- **Alinear por tramos para acotar la memoria** de documentos de millones de caracteres.
- **El 10 al 50 % de las palabras "sin causa asignada" y de "el texto está en la página y no se alineó"**: se separaron por heurística (la presencia del texto en la página, cuántas veces); no se revisó caso por caso.
- **Qué hace Word con los 10 archivos de §4** (no hay Word aquí).

## 8. Dónde está todo

- Código: `C:\Anonly\spikes\lowa\harness\word-limpio\`
  - Lector y alineador (lo que correría en el Worker): `zip.mjs`, `xml.mjs`, `docx.mjs`, `align.mjs`, `analyze.mjs`.
  - Palabras de las páginas: `pdftext.mjs`.
  - Medición: `gen-sint.cjs` (sintéticos), `gen-grandes.cjs`, `medir-sint.mjs`, `medir-lo.mjs`, `resumir-lo.mjs`, `resumir2.mjs`, `mk-sample.mjs`, `bench-node.mjs`, `run-list.mjs` (conversión con una lista de archivos), `run-sint.sh`.
  - Worker de Electron: `electron\` (`main.js`, `page.js`, `worker.js`, `run.mjs`).
  - Depuración: `dbg.mjs`, `dbg2.mjs`, `dbg3.mjs`.
- Corpus sintético: `C:\Anonly\spikes\lowa\corpus-word-limpio\` (los 8 `.docx`, `truth.json` con los 224 datos y su lugar, y `grandes\`).
- Datos: `C:\Anonly\spikes\lowa\results\word-limpio\`
  - `lo\lo.jsonl`: una línea por documento del corpus de LibreOffice (estados de cada palabra, causas, tiempos).
  - `resumen-lo.txt`, `resumen-lo-2.txt`: las tablas de §2 a §5.
  - `sint.json`, `sint.md`: sintéticos, dato por dato.
  - `bench-node.json`, `bench-electron.json`: tiempos y memoria.
  - `pdf-lo\`, `pdf-sint\`: los PDF que salieron del conversor con el preproceso (50 MB).
  - `pagetext\`, `muestra.json`: texto de las páginas de la muestra de tiempos.
- Cómo repetirlo:
  ```
  node harness\word-limpio\run-list.mjs --op pre --name lo-docx --out results\word-limpio\pdf-lo --params {...del preproceso...} --list results\word-limpio\lista-lo-docx.txt
  node harness\word-limpio\medir-lo.mjs results\word-limpio\lista-lo-docx.txt results\word-limpio\pdf-lo results\word-limpio\lo\lo.jsonl
  node harness\word-limpio\resumir-lo.mjs ; node harness\word-limpio\resumir2.mjs
  bash harness\word-limpio\run-sint.sh
  node --expose-gc harness\word-limpio\bench-node.mjs ; node harness\word-limpio\electron\run.mjs
  ```
