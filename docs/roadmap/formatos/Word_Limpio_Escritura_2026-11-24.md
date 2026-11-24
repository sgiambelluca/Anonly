# Word limpio: limpieza al entrar, escritura en su lugar y gate

> Informe del implementador del spike, en dos rondas, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\WORD_LIMPIO_ESCRITURA.md` el 2026-11-24.
> El corpus, el prototipo y los datos quedan fuera del repo, en
> `C:\Anonly\spikes\lowa\`. Qué decide el planificador con esto:
> `Plan_1.2.md` §8.9 y ADR-243.

**La ronda 2 está al final (sección 10); acá arriba solo cambia la tabla de veredictos y la sección 7.** Fecha: 2026-11-24. Entorno: Windows 11, Node 22.23.2, Electron 44.11.5 del repo (Worker de módulos con CSP estricta, sin `unsafe-eval`), LibreOffice 26.8.3.1 propio (`rec-C`, `UseTaggedPDF=false`, 1 Worker largo), `pdfjs-dist` 4.10.38 y `pdf-lib` 1.17.1 del repo (solo lectura). No se tocó `C:\Anonly\Anonly` ni se commiteó nada. No se descargó nada. No se pidió ni escribió ninguna contraseña. Ninguna dependencia nueva (ZIP, XML, limpiador, escritor y gate son código propio).

**No hay documentos reales** (no hay `ANONLY_REAL_DOC_*` definidas). Los datos de los sintéticos son inventados; el resto son los 2.104 archivos de prueba de LibreOffice, que no son documentos de personas. **Ningún número es de documentos reales.** No hay Word en esta máquina: lo que Word haría queda [NO CONFIRMADO]. Hay un validador OOXML en disco (ver P1.6).

## Veredictos

| # | Punto | Veredicto |
|---|---|---|
| P1 | Limpieza al entrar + escritura + gate | **Ronda 2: con la regla nueva del gate pasan 2.086 de 2.089 y hay 0 fugas (10.3).** Ronda 1: **se sostiene, con tres matices.** El limpiador corre en un Worker con CSP estricta: **mediana 3,4 ms, p99 43 ms, máximo 153 ms** (2.089 paquetes que abren; 14 fallan cerrado: 4 cifrados, 4 ODF con extensión `.docx`, 6 corruptos). LibreOffice abre **2.089 de 2.090** paquetes limpios (el que no abre, `w2007`, tampoco abría original). Los 8 sintéticos pasan: **los 224 datos desaparecen del Word limpio**, incluidos los 42 que ninguna página muestra (el limpiador los tira). En el corpus: **1.303 de 2.089 pasan el gate estricto; 1.949 (93,3 %) pasan descontando falsos positivos del propio gate; 0 fugas confirmadas** (3 hallazgos del gate resultaron falsos positivos; 1 fuga real —texto de ecuaciones partido en runs— apareció y se corrigió en el lector). **La hipótesis «las causas sin par bajan mucho» se cumple solo en lo estructural**: caracteres del XML sin par 4,14 % → 3,40 %; documentos con alguna unidad con palabra sin par 11,3 % → 8,6 %; el escenario D (el que importa) 8,6 % → 8,4 %. Lo que queda es texto que LibreOffice no dibuja de verdad (cuadros, «sin causa asignada»). |
| P2 | Páginas extra | **Viable y barato.** Con pedazos 1 por párrafo: **332 de 2.089 documentos (15,9 %)** tienen páginas extra (otros 136 pedazos son resultados en caché de `PAGE`/`NUMPAGES`, que no se suman). Mediana 2 pedazos, p95 21, máximo 554; mediana 7 caracteres, p95 445, máximo 13.580; páginas sumadas: mediana 1, p95 1, p99 3, máximo 16. Convertir el documento chico con el mismo Worker: **mediana 35 ms, p99 85 ms**; con un Worker nuevo: **mediana 2.703 ms, p99 2.918 ms** (2,63 s es el arranque). Memoria: **sin aumento medible** en (a) (pico del proceso de la página 656 MB mediana, 723 MB p99; delta 0 mediana, 19 MB máximo) y +7 MB mediana en (b). Sumar las páginas con `pdf-lib`: mediana 8,9 ms, p99 146 ms. **El texto de las páginas extra se alinea con sus pedazos al 81,6 % de los caracteres (311 de 332 documentos al 100 %)**; el 18 % que falta es CJK, árabe/persa y algunos casos más (ver P2.4): **no es 100 %**. De los caracteres que alinean, 28.560 vuelven a su lugar y 1 vuelve mal. |
| P3 | Imágenes | **Ronda 2: recorte real, ubicación con parecido de píxeles (75,9 % sin ambigüedad) y rasterizado de vectoriales y TIFF: ver 10.1, 10.5 y 10.6.** Ronda 1: **Sintéticos: 10 de 10 casos tapados bien** (en línea, flotante, recortada, girada 90° y 30°, espejada H y V, repetida, en encabezado, combinada): 98,4 a 100 % de los píxeles visibles dentro de la tapa quedan tapados, 0 % de cambio fuera. **Hallazgos que obligan a decidir**: LibreOffice **hornea el giro y el espejo en los píxeles** del PDF y exporta el mapa de bits **entero** con un clip cuando hay recorte; lo recortado sigue dentro del `.docx`. Corpus: de las imágenes ≥ 20 pt que el PDF dibuja, **36 % se ubican sin ambigüedad (179 de 496), 10 % más caen en la misma parte de `word/media`, 4 % ambiguas, 49 % no tienen dibujo en el XML** (rellenos de 64×64 px y similares que genera LibreOffice). Vectoriales (EMF/WMF): **no viable de manera directa**: el paquete limpio las tira (155 partes en 58 documentos, 2,8 %). |
| P4 | Memoria por tramos | **Ronda 2: por orden de páginas el tiempo baja 2,8 veces y la memoria un 20 % en sintéticos de hasta 4 M, pero es frágil en documentos reales (10.7).** Ronda 1: **No se confirma.** Mi versión simple (ventanas de 20 páginas, anclas por n-gramas) da el mismo resultado que alinear todo junto en 5 de 6 documentos reales/sintéticos chicos, pero **no baja la memoria ni el tiempo**: en el sintético de 6,5 millones de caracteres (el de «8 millones» se midió con 6,5 M de cuerpo) pasa de 1.967 MB y 6 s a 2.151 MB y 247 s. Hace falta otra idea para ubicar cada tramo. |
| P5 | Conteos | Ver tabla de P5. Lo más pesado para el diseño: 1.734 documentos con `webSettings`, 709 con `w15:docId`, 473 con `customXml`, 1.157 con marcadores (98 con nombre propio), 285 con imágenes ráster, 64 con imágenes vectoriales. |
| R1 (ronda 2) | Recorte real de píxeles | Anda: 17 imágenes en 16 documentos, recorte idéntico al original en los sintéticos; páginas casi iguales, con 1 documento (`wrapTight`) que cambia el reparto del texto (10.1). |
| R2 (ronda 2) | Marcadores referenciados | Anda: 278 `_bmN`, 282 de 282 anclas resuelven, 47 de 51 documentos sin cambio de páginas; 39 de 51 con los mismos enlaces en el PDF (10.2). |
| R3 (ronda 2) | Regla del gate | 2.086 de 2.089 pasan, 0 fugas, 3 hallazgos explicados (documentos de `x`); control negativo en 1.441 de 1.449 (10.3). |
| R4 (ronda 2) | Tapar con `█` | LibreOffice lo dibuja con Liberation y DejaVu; cambian páginas 44 de 1.449 documentos (3,0 %; con fichas 71) (10.4). |
| R5 (ronda 2) | Imágenes y parecido de píxeles | 75,9 % de las reales sin ambigüedad; 93 rellenos sin `blip`; sintéticos 14 de 15 (JPEG, GIF, wpg, VML y blipFill, bien); el 49 % «sin dibujo» de la ronda 1 era un relleno de patrón en 4 documentos (10.5). |
| R6 (ronda 2) | Vectoriales y TIFF | 156 de 156 rasterizadas y 8 de 8 TIFF (también con `utif2`); la ruta fiel sale a 96 dpi; se pierden 5.732 de 9.806 palabras (10.6). |
| R7 (ronda 2) | Memoria y tiempos en el Worker | 4 M de caracteres: 2,9 s y ~975 MB; escritor y gate idénticos a Node; el gate era cuadrático y con índice queda en 240 ms a 4 M (10.7). |
| R8 (ronda 2) | Las 15 detecciones | Ninguna es fuga (10.8). |

---

## 0. Qué se construyó (líneas del código que corre en el Worker)

| Módulo | Líneas | Qué hace |
|---|---|---|
| `limpiador.mjs` | 387 | Paquete original → paquete limpio (lista cerrada). Recodificación de imágenes inyectada (en el Worker: `createImageBitmap` + `OffscreenCanvas`; `clean-worker.mjs`, 19 líneas). |
| `escritor.mjs` | 146 | Detecciones → alineación → reemplazo en su lugar + reemplazo por valor → ZIP. |
| `gate.mjs` | 87 | Relee el Word limpio y busca los valores; chequeos estructurales. |
| `extra.mjs` | 89 | Pedazos sin par, armado del `.docx` chico, vuelta de cada carácter a su lugar. |
| `zipw.mjs` | 32 | Escritura de ZIP: `CompressionStream('deflate-raw')` o almacenado, y CRC32. |
| `xmlfull.mjs` | 115 | XML completo (parser y serializador propios, sin DOM). |
| `lector.mjs` | 270 | El lector del spike anterior (267) con referencias a los nodos y los caracteres de tab/salto/símbolo, más `m:t` suelto. |
| `zip.mjs`, `align.mjs`, `analyze.mjs` | 53, 262, 104 | Sin cambios respecto del spike anterior. |

**Total que corre en el Worker: 1.545 líneas (≈ 100 KB sin minificar)**, contra 787 del spike anterior (solo lector y alineador): el limpiador, el escritor, el gate, el armado del documento chico y el ZIP de escritura suman 756 líneas más. Fuera del Worker (solo harness): `detect.mjs` 44, `pdftext.mjs` 40 (la app ya tiene su motor de PDF), y los scripts de medición.

## 1. P1: limpiar al entrar, escribir, gate

### 1.1 El limpiador

Corpus de LibreOffice: 2.104 archivos. **Entran 2.090** (14 fallan cerrado: 5 «no hay fin de directorio central» —4 son los cifrados con contraseña, que son contenedores OLE—, 4 «no hay parte principal word» —ODF con extensión `.docx`—, 5 ZIP corruptos). De los 2.090, **LibreOffice abre 2.089**; el que no, `w2007`, tampoco convertía en el spike anterior (su `.rels` apunta a `footnotes.xml` y la parte se llama `footnotes1.xml`; se probó mezclar partes del original en el limpio, una por una: sigue sin abrir, así que no es culpa del limpiador).

| Medida | p50 | p90 | p99 | máximo |
|---|---|---|---|---|
| Limpiar (ms, en el Worker con CSP estricta) | 3,4 | 10,4 | 43,3 | 152,9 |
| Convertir el paquete limpio con LibreOffice (ms) | 40 | 80 | 349 | 1.683 |

Tamaño: 51,3 MB de entrada → 29,9 MB de paquetes limpios (el 58 %).

**Qué se tira, en cuántos documentos** (de 2.089 que entran; entre paréntesis, elementos o partes):

| Regla | Docs | Elementos |
|---|---|---|
| `docProps/*` (incluida la miniatura) | 2.045 | 4.475 partes (core, app, custom, thumbnail) |
| `webSettings.xml` | 1.727 | 1.727 |
| `customXml/*` | 472 | 2.271 partes |
| Atributos `w:rsid*` | 1.704 | 140.661 |
| Ajustes de `settings.xml` fuera de la lista blanca | 1.771 | 8.418 elementos |
| `w14:paraId` / `w14:textId` | 417 | 22.942 |
| Marcadores `bookmarkStart/End` | 1.154 | 7.198 |
| `mc:Fallback` (queda el `mc:Choice`) | 357 | 712 |
| Encabezados y pies que no se usan: referencias / partes | 245 / 269 | 763 referencias / 864 partes |
| Notas sin referencia | 6 | 12 |
| Campos congelados (resultado guardado) / campos vivos (`PAGE`, `NUMPAGES`, `SECTIONPAGES`, `SECTION`) | 233 / 169 | 1.189 / 264 |
| Cambios aceptados: inserciones desplegadas / borrados / `*PrChange` / filas borradas / celdas borradas / párrafos unidos | 71 / 75 / 37 / 8 / 4 / 36 | 260 / 241 / 614 / 39 / 9 / 165 |
| Comentarios (rangos y referencias) / partes de comentarios | 34 / 106 | 298 / 144 |
| Glosario / macros | 68 / 0 | 437 partes |
| Objetos OLE (elemento `o:OLEObject`) / partes `embeddings` | 43 / 84 | 58 / 113 |
| ActiveX (elemento) / partes | 7 / 8 | 37 / 1.470 |
| Fuentes incrustadas | 3 | 4 |
| Texto oculto (runs `w:vanish`) | 10 | 62 |
| Hipervínculos externos (se despliega, el texto queda) / internos | 53 / 51 | 321 / 411 |
| Destinos externos (relaciones `TargetMode=External`) | 148 | 717 |
| Texto alternativo no vacío (`descr`) | 105 | 233 |
| `w:dataBinding` | 60 | 129 |
| Libro incrustado de un gráfico | 50 | 68 |
| Dibujos quitados (su imagen no se puede conservar) | 93 | 378 |
| Imágenes ráster recodificadas desde los píxeles | 323 documentos con imagen | 394 partes |

**Formatos de imagen que aparecen** (partes de `word/media` de los documentos que entran): PNG 249, JPEG 119, GIF 26, TIFF 8, y vectoriales WMF 109 y EMF 46. Recodificadas: 394 (PNG → PNG, JPEG → JPEG calidad 0,92, GIF → PNG con **solo el primer cuadro**, BMP/WebP no aparecieron). **8 no se pueden recodificar: todas TIFF** (Chromium no decodifica TIFF); se tratan como las vectoriales (el dibujo se quita). **Vectoriales: 155 partes en 58 documentos (2,8 %)**, mismo tratamiento.

Ideas que hay que cambiar o decidir (las reglas de la lista cerrada que se rompen o que sorprenden):

1. **JPEG**: el codificador de Chromium **agrega un perfil ICC sRGB** al JPEG que recodifica. Hay que sacar los segmentos APP1..APP15 y COM después de codificar (`stripJpegMeta`, 15 líneas; ya está). PNG de canvas no lleva EXIF, XMP ni ICC.
2. **Los hipervínculos internos pierden destino** si se quitan todos los marcadores (el texto queda). Se despliegan todos (51 documentos). Si no se quiere perder la navegación de los índices, la regla de marcadores tendría que conservar los referenciados por un `w:hyperlink w:anchor`. **Decisión del mantenedor.**
3. **Nombre de los objetos** (`wp:docPr`/`pic:cNvPr` `name`): puede traer un nombre de archivo. Se reemplaza por `Objeto N`. La lista cerrada no lo decía.
4. **`documentProtection` con hash** se va con la lista blanca de `settings.xml` (8 documentos del corpus): el Word limpio pierde la restricción de edición. **Decisión.**
5. **Imágenes vectoriales y TIFF**: la lista dice «recodificar desde los píxeles», pero no se pueden. Opciones: (a) quitar el dibujo (lo que hace el prototipo; vista previa = salida); (b) sustituir por un PNG del recorte de la página (ver P3.3); (c) no exportar el Word.
6. Se descartan partes de relaciones desconocidas (`stylesWithEffects` en 630 documentos, `hdphoto`/`wdp` 4, `keyMapCustomizations` 3, `recipientData`, `intelligence`, `aFChunk`): no se conservan, y nada de lo medido se rompió.
7. **Un efecto bueno**: como el limpiador acepta los cambios, **LibreOffice ya no ve cambios**; los 10 documentos de §4 del informe anterior en que LibreOffice dejaba a la vista texto borrado dejaron de aparecer (0 documentos con texto borrado visible, 0 con inserción faltante), y las notas ya no tienen huecos de identificadores (el hallazgo de «LibreOffice empareja las notas por orden» deja de importar). Sigue siendo [NO CONFIRMADO] que «aceptar» de nuestro código dé lo mismo que Word en cambios superpuestos.

### 1.2 ¿Bajan las causas sin par? Comparación con el spike anterior

Mismas herramientas de medición del spike anterior (`medir-lo.mjs`), sobre los paquetes limpios y sus PDF (2.089 documentos).

| Medida | Antes (original + preproceso) | Ahora (paquete limpio) |
|---|---|---|
| Caracteres del XML | 1.189.669 | 1.185.738 |
| **Caracteres del XML sin par** | 49.254 (4,14 %) | **40.306 (3,40 %)** |
| Documentos con algún carácter sin par | 468 (22,4 %) | **407 (19,5 %)** |
| Documentos con alguna unidad con palabra sin par | 235 (11,3 %) | **180 (8,6 %)** |
| Escenario C (sin contar las 4 causas estructurales) | 304 (14,6 %) | 331 (15,8 %) |
| **Escenario D** (el de palabra, sin esas 4) | 179 (8,6 %) | **176 (8,4 %)** |
| Escenario E (sin CJK, árabe/hebreo) | 167 (8,0 %) | 164 (7,9 %) |
| Documentos con `Fallback` | 185 (27.425 caracteres) | **0** |
| Palabras de la página: únicas / ambiguas / parciales / sin ubicar | 91,30 / 1,71 / 0,66 / 6,33 % | **93,89 / 1,74 / 0,53 / 3,84 %** |
| Detecciones por patrón (correo, número 7-11, CUIT) únicas | 230 de 254 | 232 de 256 (22 ambiguas por copias, 2 parciales de un documento hecho de `xxx`) |

Causas que quedan (documentos con ≥ 1 carácter / con palabra / caracteres): **sin causa asignada 229 / 79 / 14.882** (era 201 / 84 / 16.126); texto de cuadro o forma que no se dibujó 78 / 46 / 7.846 (78 / 46 / 8.052); campo con resultado en caché 115 / 4 / 255 (171 / 25 / 1.207; son los `PAGE` vivos); el alineador 59 / 59 / 3.373 (58 / 58 / 3.904); copia repetida no dibujada 9 / 9 / 4.280 (11 / 11 / 6.859); árabe/hebreo/persa 6 / 5 / 7.187 (6 / 5 / 6.299); CJK 11 / 8 / 2.092 (10 / 8 / 2.083); marcador de posición de un control 11 / 11 / 362 (14 / 14 / 509). **Desaparecieron**: encabezado/pie no usado (58 documentos → 0), nota sin referencia (4 → 0), `Fallback` (185 → 0), campos de tipo no `PAGE` y vanish/ins/del.

**Conclusión**: el paquete limpio **elimina por construcción** las causas estructurales y hace que la vista previa sea exactamente lo que sale, pero **no resuelve** el texto que LibreOffice no dibuja de verdad (cuadros, marcos con recorte, «sin causa asignada»): eso se cubre con P2. Con la regla de bloquear el Word por cualquier palabra sin par, la regla bloquearía **180 de 2.089 (8,6 %)**; con la decisión del mantenedor (las páginas extra) esas palabras dejan de bloquear.

### 1.3 Sintéticos (8 documentos, 56 lugares, 224 datos)

Alineación del paquete limpio: **237 de 238 apariciones únicas**, 1 parcial (el CUIT de un encabezado repetido con el mismo valor en el cuerpo, igual que antes). Desaparecen los tres casos problemáticos de antes: el pie con texto idéntico en un tipo que no se usa (el pie no usado ya no existe), la segunda aparición del `REF` (el campo está congelado: la página muestra el resultado guardado) y la nota al pie fuera de orden.

Del Word limpio: **los 224 valores buscados en todo el XML: 0 quedan**, también los 42 que ninguna página muestra (borrados, ocultos, `descr`, encabezados que no se usan, nota sin referencia, dato viejo). El gate (de las 182 detecciones por página): 8/8 pasan; **control negativo**: el mismo gate aplicado al paquete limpio sin reemplazar encuentra los valores en 8/8 documentos.

### 1.4 El escritor

Reemplazo **en su lugar**: una detección que cruza varios runs se reemplaza conservando el formato del primero; los caracteres intermedios (tabulaciones, saltos, guiones no separables, símbolos) se quitan. Después, **reemplazo por valor** con límites de palabra en el texto de todas las partes que lee el lector (cruzando runs), y en cada nodo de texto y atributo con texto del resto (`v:textpath string`, `w:alias`, `w:tag`, `w:lvlText`, `w:listItem`; gráficos, diagramas). Ficha `[TIPO-NN]` (NOMBRE, DNI, CORREO, CUIT, PALABRA), la misma para un mismo valor.

Detecciones del corpus (5.259 en 1.449 documentos; los otros 640 no tienen texto en página): **únicas 4.831 (91,9 %), ambiguas 120, parciales 40, sin ubicar 268**; las de patrón (DNI, CUIT, correo, 200 en total): 176 únicas, 22 ambiguas, 2 parciales, **0 sin ubicar**. Los documentos con al menos una detección sin ubicar (en la aplicación: el Word no se exporta): **136 (6,5 % de los documentos)** con 5 palabras al azar por documento, **1 (0,05 %)** si solo cuentan las de patrón. Las ambiguas se reemplazan en todos los candidatos (son copias idénticas).

El reemplazo por valor reemplazó **103.876 posiciones más** en 773 documentos (el mismo valor en otros lugares), 512 nodos de hoja en 65 documentos y **93 atributos con texto en 21 documentos**.

| Tiempo (Node, ms) | p50 | p90 | p99 | máximo |
|---|---|---|---|---|
| Leer el paquete limpio | 1,0 | 2,2 | 9,3 | 49,8 |
| Alinear | 0 | 0,3 | 7,9 | 126,1 |
| Reemplazar y serializar | 1,2 | 3,4 | 13,2 | 50,2 |
| ZIP (deflate) | 1,2 | 2,5 | 7,2 | 46,2 |
| **Escribir, total** | **3,6** | 8,8 | **37,4** | **232,2** |
| Gate | 2,2 | 6,4 | 23,7 | 459,4 |

[NO CONFIRMADO]: estos tiempos son de Node; el limpiador sí se midió dentro del Worker (tabla de 1.1). La sección 5 del informe anterior mostró que Node y el Worker dan tiempos del mismo orden para el lector y el alineador.

### 1.5 El gate

Releído **todo el paquete final**: partes (cada una debe ser destino de una relación de un tipo de la lista), sin `docProps`, sin `w:rsid*`, sin `w:ins`/`w:del`/`moveFrom`/`moveTo`, sin `mc:Fallback`, sin comentarios ni marcadores ni hipervínculos, sin relaciones externas ni de tipos prohibidos, imágenes con hash distinto del original y sin EXIF/XMP/ICC, y la búsqueda de cada valor detectado (NFKC, minúsculas, espacios colapsados; solo dígitos si el valor tiene 6 o más) en **cada nodo de texto, cada valor de atributo, cada párrafo (cruzando runs) y cada nombre de parte**.

De 2.089 documentos:

| Resultado | Documentos |
|---|---|
| Pasan el gate estricto (sin ningún hallazgo) | **1.303 (62,4 %)** |
| Falla estructural | 1 (un JPEG que el gate marca por una coincidencia de bytes en la tabla de Huffman: **falso positivo del gate**; sin segmentos APPn) |
| Hallazgo por valor | 785 |
| — de ellos: **solo falsos positivos** (el valor al azar es una palabra de una enumeración, p. ej. `left` en `w:jc`, un nombre de estilo, una URL de espacio de nombres, `page` en `instrText`, un nombre de parte) | 646 |
| — solo subcadena (el valor es parte de una palabra más larga, no se reemplaza por límite de palabra) | 136 |
| — «fuga» a mirar | 3, **las 3 explicadas**: 2 por el método de solo dígitos (dígitos de números distintos que se juntan; una `w:lvlText`), 1 documento de prueba hecho de `xxxxxx` donde el límite de palabra no se puede definir |
| **Pasan sin falsos positivos** | **1.949 (93,3 %)** |

Una **fuga real** apareció en la primera vuelta y el gate la atrapó: el texto de las ecuaciones (`m:t`) partido en varios runs (w1437) no estaba en el lector. Se corrigió en el lector (reemplazo en su lugar y por valor); quedó 0. Esto confirma que **el gate es lo único que atrapa los lugares que el lector no conoce** y que tiene que ser independiente del lector.

Control negativo: en 1.445 de 1.449 documentos con detecciones, el mismo gate aplicado al paquete limpio sin reemplazar encontró fugas (los 4 restantes tienen solo detecciones que no están como texto en el XML).

Falsos positivos del gate (propuesta): contar un hallazgo como fuga solo si es **un nodo de texto** (no `w:instrText`) o un atributo de la lista de atributos con texto, y para las detecciones de palabra al azar usar límite de palabra. Los atributos-enumeración y los nombres de parte no cuentan.

### 1.6 Validación con LibreOffice y con un validador OOXML

**LibreOffice** (las 2.089 palabras del Word limpio convertidas con el mismo Worker): **abren 2.089 de 2.089**. Misma cantidad de páginas que el paquete limpio: **2.018 (96,6 %)**; 71 documentos cambian de cantidad de páginas porque la ficha `[PALABRA-01]` ocupa distinto que la palabra (control: con fichas del mismo largo que el valor, **62 de los 71 conservan la cantidad de páginas**; los 9 restantes siguen cambiando por el ancho de los caracteres). Texto de las páginas igual salvo los reemplazos: **1.926 documentos iguales, 35 más iguales salvo el orden de extracción de pdfjs** (el orden cambia al reflujar), 128 distintos (p50 de 45 caracteres de diferencia; p99 60.445 en documentos de varias páginas que reflujan). Aparece algún valor original como palabra completa en las páginas del Word limpio en **44 documentos (2,1 %)**: 76 de las detecciones, **61 son detecciones sin ubicar** (texto que está en la página y no en el XML: viñetas, números de lista, campos recalculados, texto de imágenes vectoriales): son las que en la aplicación bloquearían el Word; en 35 de los 44 coinciden con un hallazgo del gate (falso positivo estructural). Sintéticos: 8 de 8 abren, misma cantidad de páginas, 7 iguales y 1 solo con orden distinto (`s01`), 0 valores en las páginas.

**Validador OOXML en disco** (sin descargar): en `C:\Program Files\Microsoft Office\root\vfs\ProgramFilesCommonX64\Microsoft Shared\Filters\` hay un `Documentformat.OpenXml.dll` (Open XML SDK 2.8.1, firmado por .NET Foundation, firma válida) que se carga desde PowerShell 5.1 y expone `OpenXmlValidator`. **No hay `WINWORD.EXE`** (la carpeta es un resto de componentes de Office). Se validó con perfil Office2013 una muestra de 306 documentos (cada séptimo del corpus + los 8 sintéticos), original / limpio / final:

| | Abre en el SDK | Con errores | Errores totales |
|---|---|---|---|
| Original | 300 | 139 | 2.185 |
| Paquete limpio | 302 | 109 | 1.250 |
| Word limpio (final) | 302 | 109 | 1.250 |

Comparando documento por documento: **254 igual, 46 con menos errores, 2 con más** (de 302 que abren en ambos). El Word limpio tiene **exactamente los mismos errores que el paquete limpio** (el escritor no agrega). Los 2 que empeoran son: un atributo `name` inválido (0 → 1) y un elemento hijo inesperado en un dibujo (1 → 2); causa sin aislar [NO CONFIRMADO]. El error más frecuente en el limpio (81 documentos) ya está en el original (`w:name` con valor inválido). **Lo que Word haría** con cualquiera de estos paquetes queda [NO CONFIRMADO].

## 2. P2: páginas extra

### 2.1 Qué es un pedazo y qué etiqueta lleva

Un pedazo es un tramo consecutivo de caracteres del XML limpio sin par en las páginas (misma regla que «sin par» del spike anterior), sin contar los que no tienen letras o dígitos ni los resultados en caché de `PAGE`/`NUMPAGES`/`SECTIONPAGES`/`SECTION` (136 en el corpus: son números de página que no pueden contener un dato). Cada pedazo es **un párrafo** del `.docx` chico: etiqueta en negrita + «: » + texto, Liberation Sans 11 pt, A4. Etiquetas medidas: **Texto que no se dibujó** (141 documentos, 1.206 pedazos, 11.172 caracteres), **Celda** (61 / 553 / 15.630), **Cuadro de texto** (71 / 494 / 9.415; incluye formas), **Pie** (52 / 97 / 1.160), **Encabezado** (59 / 92 / 696), **Nota al pie** (14 / 76 / 1.199), **Nota al final** (5 / 5 / 62). «Marcador de un control» y «Campo» no aparecieron como etiqueta: el texto de un marcador de posición sí se dibuja. Cada pedazo conserva el rango de posiciones del XML limpio donde vive (`q0..q1`), que es lo que lo devuelve a su lugar.

### 2.2 Corpus (2.089 documentos)

| | Valor |
|---|---|
| Documentos con páginas extra | **332 (15,9 %)** |
| Pedazos | 2.523 en total; por documento: mediana 2, p90 10, **p95 21**, p99 106, **máximo 554** |
| Caracteres | 39.334 en total; por documento: mediana 7, p90 79, **p95 445**, p99 1.716, **máximo 13.580** |
| Páginas sumadas | mediana 1, p90 1, **p95 1**, p99 3, **máximo 16** |
| Armar el `.docx` chico (ms) | mediana 0,4, p99 4,4, máx. 11,3 (tamaño: mediana 1,1 KB, máx. 11 KB) |
| Calcular los pedazos (ms) | mediana 0, máx. 3 |

### 2.3 Variantes en el Worker con CSP estricta (332 documentos, una por vez)

| | Mediana | p90 | p99 | máximo |
|---|---|---|---|---|
| Conversión principal del documento (referencia) | 58 ms | 151 | 590 | 1.699 |
| **(a) mismo Worker vivo: convertir el chico** | **35 ms** | 41 | **85** | 150 |
| **(b) Worker nuevo: arranque + conversión** | **2.703 ms** | 2.798 | **2.918** | 2.976 |
|  (b) de eso, arranque | 2.629 | 2.720 | 2.841 | 2.893 |
|  (b) de eso, conversión | 72 | 80 | 120 | 178 |

Memoria del proceso de la página (`Tab`, que contiene los dos Workers; set de trabajo y privada): **(a)** pico mediana 656 MB / 1.560 MB privada, p99 723 / 1.613, máx. 865 / 1.821; **delta durante la conversión del chico: 0 MB mediana, 2 MB p99, 19 MB máximo**. **(b)** pico mediana 656 / 1.563, p99 702 / 1.609; delta desde el arranque del Worker nuevo: 7 MB mediana, 12 MB máximo. Es decir: **(a) no suma memoria medible y cuesta 35 ms; (b) cuesta 2,7 s y deja el mismo pico** (el Worker viejo se libera antes de cargar el nuevo; la base se mantiene en ~650 MB). Para el diseño: **(a) con el mismo Worker vivo** es la variante barata; (b) solo vale si el Worker de la conversión principal no puede quedar vivo.

[NO CONFIRMADO]: no se midió `pdfjs-dist` **dentro** del Worker/renderer de Electron (requiere servir `pdf.mjs` y su worker bajo la CSP); en Node, abrir el PDF chico y sacar las palabras cuesta **mediana 1,3 ms, p99 9,8 ms, máx. 65,7 ms**, y alinear contra los pedazos **mediana 0,4 ms, p99 24,5 ms, máx. 439 ms**.

### 2.4 Alineación y vuelta al XML

Sobre las 332 páginas extra: de **34.890 caracteres de pedazos, 28.452 tienen par en las páginas (81,6 %); 311 de 332 documentos alinean al 100 %**. **No es 100 %.** Los documentos que no llegan: escrituras sin glifo en Liberation Sans (CJK: `w0347` 30/715, `w0477`, `w0993` 1/19), árabe/persa (ligaduras: `w0352`, `w1051`, `w1394`), y unos pedazos cortos o repetidos (`w0213` 1/3, `w1297` 1/632 —el texto chico es un solo bloque repetido—). Los caracteres de la página extra que alinean vuelven a su lugar del XML: **28.560 correctos, 1 incorrecto** (en `w0164`, un texto repetido). Es decir, **cada pedazo sabe a qué lugar vuelve** (el rango `q0..q1` del XML limpio), pero **el 18 % de los caracteres de los pedazos no se podrían detectar** porque LibreOffice no los dibuja tampoco en la página extra (CJK sin fuente, árabe). Regla 3 del mantenedor (si la detección no se puede ubicar, el Word no se exporta) cubre lo que sí se dibuja; **lo que no se dibuja ni en la página extra queda sin detectar**: el reemplazo por valor y el gate lo cubren solo si otro lugar del documento muestra el mismo valor. Propuesta: para pedazos cuyo texto no se pueda alinear en la página extra (escritura sin fuente), **no exportar el Word** (o usar una fuente de respaldo para esa escritura).

### 2.5 Sumar las páginas al PDF principal y limpieza de metadatos

Con `pdf-lib` `copyPages` + guardar (332 documentos): **mediana 8,9 ms, p90 36 ms, p99 146 ms, máx. 279 ms** (carga de los dos PDF mediana 0,8 ms). Limpieza del PDF intermedio sobre el PDF ya sumado: mediana 16 ms, p99 112 ms. **La limpieza de metadatos cubre también esas páginas**: en los 332, el PDF final tiene la cantidad de páginas esperada (principal + extra), **sin `Info`, sin XMP, sin anotaciones, sin outlines, sin árbol de estructura**; `copyPages` no trae el `Info` del PDF chico y las páginas copiadas no llevan anotaciones. Las páginas extra **no van al PDF exportado**: el PDF que se exporta es el principal limpio (las páginas extra solo existen para detectar).

## 3. P3: imágenes

### 3.1 Sintéticos (10 documentos, imagen PNG de 200×120 con un bloque «dato» asimétrico)

Se ubicó cada imagen que el PDF dibuja (`getOperatorList`: `paintImageXObject` con la matriz → caja en la página) con su dibujo del XML por tamaño; se tapó con un rectángulo de **coordenadas de página** (zona derecha-alta de la caja) los píxeles de `word/media` aplicando la inversa (recorte, giro, espejo), se recodificó (PNG propio), se armó el Word limpio, se convirtió con LibreOffice y se verificó **por píxeles en la imagen que dibuja el PDF** (índice de pantalla de cada píxel por la matriz del PDF final, solo píxeles opacos y visibles).

| Caso | Ubicación | Píxeles visibles dentro de la tapa que quedaron tapados | Píxeles fuera de la tapa que cambian |
|---|---|---|---|
| en línea | única | 100 % | 0 % |
| flotante | única | 100 % | 0 % |
| recortada (`srcRect`) | única | **100 %** de los visibles (491 píxeles de la tapa caen en lo recortado y no se tapan) | 0 % |
| girada 90° | única | 100 % | 0 % |
| girada 30° (flotante) | única | 98,8 % | 0 % |
| espejada H | única | 100 % | 0 % |
| espejada V | única | 100 % | 0 % |
| la misma imagen dos veces (dos tamaños) | única (misma parte) | 100 % y 100 % | 0 % |
| imagen en un encabezado | única | 100 % | 0 % |
| combinada (recorte + espejo H + giro 90°) | única | 98,4 % de los visibles (47.843 píxeles de la tapa caen en lo recortado) | 0 % |

Lo que el PDF de LibreOffice hace (esto es lo que obliga a la lógica del mapeo):

- **Giro y espejo se hornean en los píxeles** del PDF (la CTM sale con ángulo 0 y determinante positivo; la imagen exportada está girada y remuestreada). La inversa tiene que hacerse con el giro/espejo del XML, no con la matriz. **Con giros que no son múltiplos de 90° la imagen exportada es la caja del giro con esquinas transparentes** (98,8 % en 30°: el resto son píxeles de borde).
- **Recorte**: LibreOffice exporta el mapa de bits **entero** (a mayor tamaño que `wp:extent`: 270 × 157,5 pt para un `extent` de 189 × 118) y lo recorta con un clip. Por eso hay que comparar contra el tamaño mostrado y contra el tamaño mostrado dividido por `1 − recorte`.
- **Si se tapa solo lo visible, lo recortado sigue dentro del `.docx`** (el usuario lo ve en Word con «restablecer imagen»). **Propuesta/decisión**: aplicar la tapa también a la zona recortada, o recortar los píxeles de verdad y quitar `a:srcRect`. No está implementado.
- **La misma imagen en dos dibujos con tamaños distintos**: la tapa se aplica en la parte de `word/media`, así que **queda tapada la unión** de las dos zonas en los dos dibujos.

Alcances: solo PNG (no se generaron JPEG; la ruta de recodificación es la misma, lo medido para JPEG es solo la recodificación del limpiador); un solo tamaño de imagen; los casos de arriba no cubren agrupaciones (`wpg`), VML ni imágenes dentro de formas con relleno de imagen. [NO CONFIRMADO] en esos tres.

### 3.2 Corpus: ubicar la imagen que el PDF dibuja

Documentos con imagen en el PDF: 264 de 2.089; **25.373 imágenes** en total, de las cuales **24.877 miden menos de 20 pt** (viñetas, rellenos y degradados de 8×8 a 64×64 px que genera LibreOffice, sin dibujo en el XML). De las **496 de 20 pt o más (237 documentos)**:

| Estado | Imágenes | % |
|---|---|---|
| Única (un dibujo, o una parte con el tamaño y la proporción) | 179 | 36,1 % |
| Misma parte de `word/media` (varios dibujos, la misma imagen) | 51 | 10,3 % |
| Ambigua (varias partes con el mismo tamaño) | 22 | 4,4 % |
| **Sin dibujo en el XML que coincida** | **244** | **49,2 %** |

Mirado desde el XML: de 354 dibujos ráster de los paquetes limpios (más 49 VML sin extensión medible), **284 (80,2 %) tienen una imagen del PDF de tamaño compatible** y 70 (19,8 %) no. Entre los «sin dibujo» hay degradados de 64×64 que LibreOffice dibuja a tamaño de forma, imágenes dentro de formas con relleno `blipFill`, miniaturas, y las que el limpiador quitó (vectoriales). **Medido solo por orden y tamaño; no se usó el parecido de píxeles** (requiere decodificar JPEG/PNG de `word/media`, que en el Worker se hace con `createImageBitmap` y no en Node). [NO CONFIRMADO] cuántas de las 244 «sin dibujo» son relleno de LibreOffice y cuántas imágenes reales sin ubicar. La regla de la aplicación (si una imagen con detecciones por OCR no se ubica, el Word no se exporta) deja a estos documentos fuera del Word: **137 de 264 documentos con imagen en el PDF tienen alguna imagen ambigua o sin ubicar** si se cuentan también las chicas.

### 3.3 Imágenes vectoriales (EMF, WMF)

Aparecen en 58 documentos del corpus (2,8 %), 155 partes (WMF 109, EMF 46). **El paquete limpio las tira** (dibujo quitado), así que ya no hay texto de imágenes vectoriales en las páginas (en el corpus «original + preproceso» eran 24 documentos con 5.508 palabras). Para «ubicar su caja en la página y reemplazar la imagen por un PNG del recorte de la página tapada»: LibreOffice las dibuja como **operadores de dibujo y texto** en el contenido de la página (no como `paintImageXObject`), así que **`getOperatorList` no da su caja**; solo se podría aproximar con el rectángulo que cubre el texto que no está en el XML, y hace falta **rasterizar la página** (`pdfjs` con canvas, que la aplicación tiene en su motor de PDF) para recortar. **No se probó** [NO CONFIRMADO]; no lo considero viable sin más trabajo. **Vale la regla de que el Word no se exporta** (o se quita el dibujo, que es lo que hace el prototipo: la salida pierde esa imagen).

## 4. P4: alinear por tramos

Alinear por ventanas de 20 páginas con 1 de solapamiento: ubicar cada ventana en el XML con n-gramas de 16 caracteres (indexados cada 8 posiciones) y una cadena creciente más larga, luego pasada 1 en esa franja con 4.000 de margen. Solo el cuerpo (la pasada 2, que busca encabezados, notas y cuadros, no se parte). Cada proceso de Node midió su propio `maxRSS`.

| Documento | Páginas | Caracteres XML | Todo junto: ms / maxRSS | Tramos: ms / maxRSS | ¿Mismo resultado? |
|---|---|---|---|---|---|
| `grande-500` (sintético) | 38 | 106.628 | 68 / 82 MB | 93 / 81 MB | sí |
| `w0013` | 21 | 42.006 | 28 / 63 MB | 41 / 68 MB | sí |
| `w1486` | 21 | 83.169 | 49 / 79 MB | 132 / 96 MB | sí |
| `w0395` | 47 | 114.351 | 74 / 89 MB | 169 / 104 MB | sí |
| `w1901` | 60 | 63.939 | 49 / 95 MB | 71 / 99 MB | sí |
| `grande-5000` (sintético) | 380 | 1.084.856 | 696 / 391 MB | 6.020 / 520 MB | **no** (97,1 % de los caracteres con par; ventana de 1,08 M) |
| `grande-30000` (sintético) | 2.277 | 6.509.462 | 5.989 / **1.967 MB** | 247.013 / **2.151 MB** | **no** (6.509.451 de 6.509.462) |

**Veredicto: no se confirma.** Donde el resultado es el mismo, la ventana ocupa casi todo el XML (el tramo máximo del XML es todo el documento o casi), así que no hay ahorro; en los sintéticos grandes (texto sintético muy repetitivo) las anclas por n-gramas no aíslan una franja, el tramo sigue siendo casi todo el documento, el tiempo se multiplica por 40 y la memoria no baja. Una solución real necesita ubicar cada franja por **orden de páginas** (p. ej., avanzar desde el final de la franja anterior en vez de buscar con anclas globales) y partir también la pasada 2. [NO CONFIRMADO] que eso baje la memoria; el análisis del informe anterior atribuyó el consumo a las tablas de anclas y al texto normalizado (4 arreglos de 4 bytes por carácter), y esos arreglos de 6,5 M de caracteres solo pesan unos 100 MB; el resto es la LCS y las tablas de la pasada 1.

## 5. P5: conteos baratos (2.104 archivos; 5 no son OOXML)

Contado sobre el original (sin limpiar). «Docs» = documentos que tienen al menos uno.

| Qué | Docs |
|---|---|
| Hipervínculos externos (relaciones `External` de tipo hyperlink) | 71 (`mailto:` 14, `http(s)` 53, archivo local 6) |
| Hipervínculos internos (`w:anchor`) | 52 |
| Marcadores (cualquiera) / con nombre propio (no `_Toc`, `_Ref`, `_Hlk`, `_GoBack`) | 1.157 / 98 |
| `w:docVars` | 32 |
| `w:mailMerge` | 12 |
| `w:attachedTemplate` | 71 |
| Texto alternativo no vacío (`descr`) / `title` | 87 / 14 |
| Fuentes incrustadas | 6 |
| Objetos OLE (embeddings o `o:OLEObject`) | 86 |
| ActiveX | 8 |
| Gráficos / con libro incrustado | 52 / 44 |
| SmartArt (diagramas) | 15 |
| `w:dataBinding` | 62 |
| `w15:docId` | 709 |
| Miniatura | 61 |
| `people.xml` | 68 |
| Comentarios | 46 |
| `customXml` / `docProps/custom.xml` | 473 / 307 |
| Glosario | 68 |
| `webSettings.xml` | 1.734 |
| `w:rsid*` / `w14:paraId` | 1.704 / 417 |
| `mc:Fallback` | 316 |
| Texto oculto `w:vanish` | 22 |
| Cambios (`ins`/`del`/`move*`) | 113 |
| Encabezados o pies / notas al pie / notas al final | 515 / 680 / 670 |
| Protección de documento con hash | 8 |
| Controles de contenido (`w:sdt`) | 225 |
| `v:textpath string` (texto de WordArt) | 23 |
| Imágenes ráster / vectoriales | 285 / 64 |
| JPEG con EXIF | 16 |

(Campos: este conteo solo mira `document.xml`; las cifras de campos del limpiador, 233 documentos con campos congelados y 169 con campos vivos, miran todas las partes.) Formatos de imagen (partes de `word/media`): WMF 455, PNG 261, JPEG 145, EMF 50, GIF 41, TIFF 8, SVG 3, otros 53 (de 2.104 archivos, incluidos los que no se pueden abrir y los que el limpiador no deja entrar).

## 6. Lo que contradice o completa informes anteriores

1. **«Las causas bajan mucho»**: no. Bajan las estructurales (a cero); el texto no dibujado se queda (§1.2).
2. **Los 10 documentos en que LibreOffice acepta distinto que el XML** (informe anterior §4): con el limpiador aceptando los cambios, los 10 dejan de dar texto borrado visible. La diferencia entre «aceptar» de LibreOffice y de nuestro código queda como decisión de fidelidad; ADR-240 §5 puede dejar de depender del `AcceptAllTrackedChanges` de LibreOffice.
3. **El hallazgo de las notas por orden** (informe anterior §2.1) deja de ocurrir: el limpiador quita las notas sin referencia y no quedan huecos.
4. **El lector no leía el texto de ecuaciones suelto** (`m:t` fuera de un `w:r`): se corrigió; el número de «ecuación» como causa desaparece.
5. **Cada JPEG que recodifica Chromium lleva ICC**: hay que limpiarlo (§1.1).
6. **El Word limpio puede cambiar la cantidad de páginas** por el ancho de la ficha (3,4 % de los documentos con 5 palabras al azar cada uno; 0 de 8 en los sintéticos): no es un defecto de estructura.

## 7. Sin medir ([NO CONFIRMADO])

- **Documentos reales** hechos por Word. **Qué hace Word** con los paquetes limpios y con los Word limpios (no hay Word); el validador OOXML da 2 documentos de 302 con más errores que el original, con causa sin aislar.
- `pdfjs` dentro del Worker/renderer de Electron (P2 lo dejó en Node).
- ~~Escritor y gate **dentro del Worker**~~ (medido en la ronda 2: 10.7).
- ~~JPEG, GIF, `wpg`, VML y relleno de forma~~ (medidos en la ronda 2: 10.5). Siguen sin medir los tamaños de imagen variados y los efectos (sombra, tinte, mosaico) dentro de formas.
- ~~La tapa de las zonas recortadas y el recorte real de píxeles~~ (recorte real medido en la ronda 2: 10.1).
- ~~Reemplazo de imágenes vectoriales por un PNG~~ (se rasterizó la parte con LibreOffice, no un recorte de la página: 10.6).
- Alinear por tramos: la versión de anclas por n-gramas no sirve; la de orden de páginas anda en sintéticos y es frágil en reales (10.7).
- ~~El parecido de píxeles y la separación de las 244 imágenes «sin dibujo»~~ (medido en la ronda 2: 10.5).
- Hipervínculos y marcadores internos: la navegación **en Word** (en el XML y en el PDF de LibreOffice se midió en la ronda 2: 10.2).
- Excel y PowerPoint (el spike es solo `.docx`).
- Escrituras no latinas: limitación conocida, no medida aparte (aparecen en P2.4 solo porque se vieron).
- Qué pasa con `documentProtection` y firmas digitales: se descartan.
- **Ronda 2, sin medir [NO CONFIRMADO]:**
  - Documentos reales; Word y cualquier otro editor con los `.docx` de la ronda 2 (marcadores `_bmN`, hipervínculos sin estilo de enlace, imágenes recortadas, `█`); el orden del EXIF de los JPEG que recodifica `createImageBitmap`.
  - Rasterizar vectoriales **con el tamaño pedido y fiel**: la ruta fiel (96 dpi) no lo da y la que lo da no es fiel; la ruta de Writer (`writer_png_Export`) no anduvo. Qué pasa con SVG (3 en el corpus, ninguno referenciado) y con metafiles sin cabecera de tamaño (WMF no «placeable»).
  - Alinear por tramos en documentos reales largos (solo 2 con más de 20 páginas) y con la pasada 2 partida; la memoria **con el Worker de LibreOffice vivo** en el mismo proceso; `pdfjs-dist` dentro del Worker (las páginas de los sintéticos y del corpus se leyeron en Node).
  - Las 35 imágenes reales que no se parecen a ninguna parte (efectos, mosaico, transparencia) y la girada 30° (se resolvería con el giro del XML); el tapado de imágenes dentro de formas con efectos.
  - La causa de que LibreOffice no exporte enlaces en `w0942` ni dibuje una línea de índice en `w2061`.
  - Un escritor lineal: a 4 M de caracteres con 3.522 detecciones tarda 10 s (el gate ya no es el cuello).

## 8. Qué tiene que decidir el planificador o el mantenedor

1. Imágenes vectoriales y TIFF (155 partes, 58 documentos, 2,8 %): ¿quitar el dibujo (salida distinta de la original, vista previa igual a la salida), no exportar el Word, o rasterizar el recorte?
2. Recorte de imágenes: ¿tapar también lo recortado o hornear el recorte? (hoy lo recortado sigue dentro del archivo.)
3. Hipervínculos internos y marcadores: ¿se pierde la navegación de índices (51 documentos) o se conservan los marcadores que un `w:anchor` referencia?
4. `documentProtection` (8 documentos) y nombres de objetos (`name` de `docPr`): ¿se pierde la restricción de edición? ¿se acepta `Objeto N`?
5. Texto que no se alinea ni en la página extra (CJK sin fuente, árabe): ¿Word no exportable o fuente de respaldo? (18 % de los caracteres de pedazos del corpus.)
6. Definición del gate: qué cuenta como hallazgo (nodo de texto y atributos con texto sí; enumeraciones y nombres de parte no) y qué hacer con las coincidencias solo por subcadena (136 documentos).
7. Variante (a) de P2 (mismo Worker vivo, 35 ms, sin memoria extra medible) frente a (b) (2,7 s).
8. Texto final del reemplazo: la ficha más larga que el valor cambia la cantidad de páginas del Word en el 3,4 % de los documentos de prueba.

## 9. Dónde está todo

- Código (copia y extensión del spike anterior; el original no se editó): `C:\Anonly\spikes\lowa\harness\word-limpio-escritura\`
  - Worker: `limpiador.mjs`, `escritor.mjs`, `gate.mjs`, `extra.mjs`, `zipw.mjs`, `xmlfull.mjs`, `lector.mjs`, `zip.mjs`, `align.mjs`, `analyze.mjs`, `electron\clean-worker.mjs`.
  - Banco: `electron\` (main, page, ops `conv`, Worker de LibreOffice), `run-lote.mjs` (Electron en lote, reanuda), `p1.mjs`, `p1val.mjs`, `resumen-p1.mjs`, `cadena.sh`, `p2corpus.mjs`, `p2post.mjs`, `p2resumen.mjs`, `p3sint.mjs`, `p3corpus.mjs`, `drawings.mjs`, `pdfimg.mjs`, `gen-img.mjs`, `tramos.mjs`, `p5.mjs`, `detect.mjs`, `ctrl-largo.mjs`, `cmp-same.mjs`, `sint-todos.mjs`, `bisect.mjs`, `validar-ooxml.ps1`.
- Datos: `C:\Anonly\spikes\lowa\results\word-limpio-escritura\`
  - `lo\<id>\` (paquete limpio `.clean.docx`, PDF `.c.pdf`, Word limpio `.final.docx`, PDF del Word limpio `.v.pdf`), `lo\lo.jsonl` (limpiador y conversión), `lo-p1.jsonl` (escritor y gate), `lo-val.jsonl` (validación), `resumen-lo-p1.txt` / `.json`, `lo-comp.jsonl` y `resumen-lo-comp-1.txt`, `resumen-lo-comp-2.txt` (comparación con el spike anterior).
  - `sint\`, `sint-p1.jsonl`, `sint-val.jsonl`, `sint-todos.json` (los 224 datos).
  - `extra\` (pedazos y `.docx` chicos), `extra-run\extra.jsonl`, `p2-corpus.jsonl`, `p2-post.jsonl`, `resumen-p2.json`.
  - `img\` (P3 sintético: `p3-prep.jsonl`, `p3-verify.jsonl`), `p3-corpus.json`, `tramos\`, `p5.json`, `val-ooxml-{o,c,f}.jsonl`, `lo-same\`.
- Corpus nuevo: `C:\Anonly\spikes\lowa\corpus-word-limpio-img\` (10 `.docx` con imágenes).
- Cómo repetirlo (desde `harness\word-limpio-escritura`):
  ```
  node run-lote.mjs --op cleanconv --out ..\..\results\word-limpio-escritura\lo --name lo --list ..\..\results\word-limpio-escritura\lista-lo.txt --params {"tag":"c"}
  node p1.mjs lo ..\..\results\word-limpio-escritura\lo ..\..\results\word-limpio-escritura\lo-p1.jsonl
  node run-lote.mjs --op conv ... --params {"tag":"v"}   # sobre los .final.docx
  node p1val.mjs ... ; node resumen-p1.mjs lo
  node p2corpus.mjs ... ; node run-lote.mjs --op extra ... --extradir ...extra ; node p2post.mjs ... ; node p2resumen.mjs
  node gen-img.mjs ; node p3sint.mjs prep|verify ... ; node p3corpus.mjs ...
  node --expose-gc tramos.mjs full|tramos <docx> <pagetext.json>
  powershell -File validar-ooxml.ps1 -Lista ... -Salida ...
  ```

---

## 10. Ronda 2

Fecha: 2026-11-24. Mismo entorno que la ronda 1 (Windows 11, Node 22.23.2, Electron 44.11.5 con Worker de módulos y CSP estricta sin `unsafe-eval`, LibreOffice 26.8.3.1 `rec-C`, `pdfjs-dist` 4.10.38 y `@napi-rs/canvas` del repo solo para renderizar páginas al medir). No se tocó `C:\Anonly\Anonly`, no se commiteó, no se descargó nada, no se pidió ni escribió ninguna contraseña. Ninguna dependencia nueva: `utif2` 4.1.0 (R6b) ya estaba en el disco, en `C:\Anonly\spikes\imagenes\vendor\pkgs\node_modules\utif2` (se usó una copia del bundle que armó el spike de imágenes). **Sigue sin haber documentos reales** (no hay `ANONLY_REAL_DOC_*`): todos los números son de los 2.104 archivos de prueba de LibreOffice y de sintéticos inventados. No hay Word en esta máquina: lo que Word haría queda [NO CONFIRMADO].

`gate.mjs` había quedado a medio editar: la rama `opts.v2` estaba completa y sintácticamente bien, pero (a) no cubría marcadores ni hipervínculos conservados ni recortes, (b) acumulaba en el texto del párrafo **cualquier** hoja con texto (incluidos los números de posición de los dibujos), y (c) marcaba como metadatos cualquier JPEG con bytes `FF E1`/`FF E2`/`FF ED` en los primeros 4.000 bytes (falso positivo). Las tres cosas están arregladas (ver 10.3).

### 10.0 Resumen para decidir

| # | Punto | Resultado |
|---|---|---|
| R1 | Recorte real | **Anda.** 17 imágenes de 16 documentos recortadas de verdad y sin `srcRect`; en los sintéticos el recorte es idéntico al original (0 valores distintos de 104.400). Páginas: 15 de 16 documentos del corpus con cambios de píxeles menores al 0,7 % de la página, todos dentro de la caja de la imagen; **1 documento (`wrapTight` con polígono) cambia el reparto del texto**. |
| R2 | Marcadores | **Anda.** Quedan 278 marcadores `_bmN` de 7.198 elementos; en los 51 documentos con anclas 282 de 282 anclas con destino resuelven, y 47 de 51 conservan las páginas píxel a píxel (en todo el corpus 2.088 de 2.089 conservan páginas y texto). LibreOffice conserva 39 de 51 listas de enlaces idénticas; los otros 12 se explican por campos congelados, anclas sin destino en el original y 3 casos aparte. |
| R3 | Regla del gate | **2.086 de 2.089 pasan** (antes 1.303 estrictos / 1.949 sin falsos positivos). Fallan 3, los 3 explicados (valor hecho de `x` dentro de texto hecho de `x`). **0 fugas.** Control negativo: el gate encuentra fugas en 1.441 de 1.449 documentos con detecciones sin reemplazar; los 8 restantes tienen solo subcadenas o texto que no está en el XML. |
| R4 | «Tapar con negro» | LibreOffice **dibuja el `█`** con las fuentes de `rec-C` (Liberation y DejaVu) como un bloque negro. Cambian de cantidad de páginas **44 de 1.449 documentos (3,0 %)**; con fichas eran 71 (4,9 %). |
| R5 | Imágenes con parecido de píxeles | De las imágenes reales que dibuja el PDF, **75,9 % se ubican sin ambigüedad** (sin contar repeticiones; 79,0 % de las de 20 pt o más). Sintéticos: **14 de 15 casos ubicados y tapados al 100 %**, incluidos JPEG, GIF, agrupación `wpg`, VML y relleno con imagen; falla la girada 30°. |
| R6 | Vectoriales y TIFF | Se rasterizan **156 de 156 partes** (155 WMF/EMF + TIFF) y **8 de 8 TIFF** con LibreOffice, y los 8 TIFF también con `utif2` en el Worker. **Con LibreOffice no hay hoy una ruta que dé a la vez el tamaño pedido y fidelidad**: la ruta fiel sale a 96 dpi (mediana 15 ms), la que respeta el tamaño pierde fidelidad (mediana 125 ms). Se pierden **5.732 de 9.806 palabras** de esos documentos (58 %). |
| R7 | Memoria y tiempos en el Worker | Alinear todo de una vez: **0,5 M caracteres 0,27 s y ~205 MB; 1 M 0,6 s y ~350 MB; 2 M 1,4 s y ~540 MB; 4 M 2,9 s y ~975 MB** (pico de memoria de trabajo del proceso de la página). Escritor y gate dentro del Worker: salida idéntica byte a byte a la de Node en 2.089 de 2.089 y mismos tiempos. **El gate es cuadrático** (13,6 s a 1 M, 54 s a 2 M) con la regla tal cual; con índice por primer token queda lineal (ver 10.7). |
| R8 | Las 15 detecciones | **Ninguna es fuga.** Son valores al azar de documentos de prueba hechos de cadenas repetidas (`aaaa…`, `eeee…`, `xxxx…`, `qwerty…`) o una ecuación: el valor se reemplazó donde es una palabra y lo que queda son fragmentos de palabras más largas que la página parte en líneas. |

### 10.1 R1: recorte de verdad

**Qué hace el limpiador.** Al recodificar una imagen con `a:srcRect`, la recodifica solo con los píxeles visibles (`createImageBitmap` + `drawImage` con rectángulo de origen) y saca el `srcRect`. Los lados negativos (relleno) se conservan, reescalados sobre la imagen ya recortada. Lo mismo para el recorte de VML (`cropleft/top/right/bottom`). Una misma parte de `word/media` usada con recortes distintos genera una parte por recorte. El gate falla (`imagen-con-recorte`) si queda un `srcRect` positivo o un recorte VML.

**Corpus:** 17 imágenes en 16 documentos (15 `a:srcRect` y 2 VML). Los paquetes limpios suman 28,6 MB (antes 29,9). Limpiar en el Worker: p50 3,6 ms, p99 47,6, máximo 176,3 (antes 3,4 / 43,3 / 152,9).

**Píxeles, sintéticos** (200×120; recortes de `i03` y `i08`): la imagen del paquete limpio mide 140×90 y 150×90, y es **idéntica, valor por valor, al recorte del original** (0 valores distintos de 50.400 y 54.000). En la página, contra el original convertido sin limpiar y a escala 2: 8 de 10 sintéticos idénticos píxel a píxel; `i03` difiere en 0,059 % de los píxeles y `i08` en 0,055 % (diferencia mayor a 32 niveles; remuestreo del recorte).

**Píxeles, corpus** (los 16 documentos, paquete limpio de la ronda 1 contra el de la ronda 2): misma cantidad de páginas y mismo texto en 16 de 16. La página con más diferencia de cada documento: mediana 0,08 % de los píxeles; 15 de 16 por debajo de 0,7 %; en los tres que se miraron caja por caja (`w0986`, `w0987`, `w1666`) todos los píxeles distintos caen dentro de la caja de la imagen (es remuestreo: LibreOffice dibujaba el mapa de bits entero con un clip y ahora dibuja solo el recorte).
- **Excepción: `w2095` (1,8 %).** La imagen es flotante con `wrapTight` y polígono de ajuste. LibreOffice calcula el contorno de ajuste del texto desde los píxeles; con la imagen recortada el contorno cambia y el texto se reparte distinto entre líneas (misma cantidad de páginas, mismo texto, otro salto de línea). Es inherente a recortar de verdad.

[NO CONFIRMADO]: `createImageBitmap` aplica por defecto la orientación del EXIF de los JPEG, y LibreOffice también; Word no se pudo mirar.

### 10.2 R2: marcadores y navegación

**Qué hace el limpiador.** Conserva solo los `w:bookmarkStart/End` cuyo nombre referencia algún `w:hyperlink w:anchor` (en el cuerpo, los encabezados, los pies y las notas), los renombra `_bm1`, `_bm2`… con ids nuevos desde 0 y reescribe los `w:anchor`. El `w:hyperlink` queda solo con `w:anchor` (se van `tooltip`, `history` y `tgtFrame`). Un hipervínculo interno cuyo marcador ya no existe en el original se despliega (queda el texto). El original puede traer ids repetidos (80 inicios y 54 fines en `w0942`): cada fin cierra el último inicio abierto con el mismo id y, si un inicio conservado queda sin fin, se le agrega uno vacío (4 casos, 1 documento). Los hipervínculos externos siguen desplegándose.

**Cantidades:** de 7.198 elementos de marcador de los 1.154 documentos que tenían, **quedan 278 (inicio y fin)**; 6.650 se quitan. 51 documentos con hipervínculos internos: 411 hipervínculos, de los cuales **282 tienen destino y se conservan y 129 apuntaban a un marcador que el original ya no tiene** (se despliegan).

**Navegación en el XML** (los 51 documentos, gate): 282 de 282 anclas resuelven a un marcador existente; todos los nombres son `_bmN`; ids únicos y cada inicio con su fin en 51 de 51.

**Navegación en LibreOffice** (se convirtió el original sin limpiar y el limpio, y se compararon los enlaces internos del PDF): original 337 enlaces, limpio 266 (la ronda 1, sin marcadores, 2). **39 de 51 documentos tienen exactamente la misma lista de enlaces** (página de origen, línea y página de destino). Los 12 que no:
- 8 por **enlaces que genera un campo** (`TOC \h`, `REF \h`, `PAGEREF \h`) que el limpiador congela: se pierde el enlace del número de página, queda el del texto del índice (`w0336` 3→2, `w0790` 4→2, `w1476` 6→3, `w1499` 74→57, `w1508` 18→6, `w1950` 16→10, `w1387` y `w1388` 6→3).
- 2 por **anclas sin destino en el original** (`w0664`, `w2061`).
- `w0942`: las 22 anclas resuelven en el XML pero LibreOffice no exporta ningún enlace (el original sí exportaba 22); causa sin aislar [NO CONFIRMADO].
- `w2061`: además LibreOffice **no dibuja una línea del índice** cuyo hipervínculo se conserva (el XML la tiene). Es un defecto de la vista previa, no del XML; [NO CONFIRMADO] en Word.
- `w1695`: 19 páginas contra 17; es lo mismo que en la ronda 1 (otras reglas de limpieza), no de los marcadores.

**Las páginas no cambian por conservar marcadores** (paquete limpio de la ronda 1 contra el de la ronda 2): en los 51 documentos la misma cantidad de páginas; **47 de 51 idénticos en texto y píxeles** (menos de 0,1 % de píxeles distintos). Los 4 restantes: `w0312` 0,11 %, `w0408` 0,68 % y `w1499` 0,15 % (LibreOffice pinta los hipervínculos internos en azul subrayado aunque la corrida no tenga estilo de hipervínculo; el original convertido también los pinta así), y `w2061` (la línea del índice de arriba).

**Validador OOXML** (el Open XML SDK 2.8.1 que ya está en el disco, perfil Office2013; sin descargar nada): la misma muestra de 306 documentos de la ronda 1 da exactamente lo mismo con el Word limpio de la ronda 2 (302 abren, 109 con errores, 1.250 errores; 302 de 302 con la misma cantidad de errores por documento que en la ronda 1). Esa muestra tiene solo 2 documentos con anclas y 5 con recortes, así que se validaron aparte los 67 con anclas o recortes: **original 736 errores (65 abren) → Word limpio ronda 1: 373 → ronda 2: 369** (67 abren, 24 con errores; 66 igual que antes y 1 con menos). Conservar marcadores, hipervínculos internos y recortar píxeles no agrega errores de validación. **Lo que Word haría sigue [NO CONFIRMADO].**

**Efecto lateral medido en todo el corpus** (paquete limpio de la ronda 1 contra el de la ronda 2, 2.089 documentos): 2.088 con la misma cantidad de páginas y el mismo texto. Las 2 excepciones: `w2061` (la línea de índice de arriba) y `w0032`, que pasa de 4 a 2 páginas porque ahora se quitan 2 referencias a vectoriales que quedaban colgando (74 → 76 dibujos quitados): mejora, no regresión.

### 10.3 R3: la regla del gate

**Regla implementada** (`gate.mjs`, opción `v2`):
- **Coincidencia con límites.** Un valor con letras cuenta si a los dos lados no hay letra ni número; un valor numérico (solo dígitos y separadores, 5 o más dígitos) cuenta si a los dos lados no hay dígito. Una subcadena no cuenta.
- **Dónde se busca:** cada hoja de texto del XML **salvo** las de una lista negra de hojas que no son texto (`w:instrText`, `w:delInstrText`, `wp:posOffset`, `wp:align`, `wp14:pct*`, `cdr:x`, `cdr:y`, `c:f`, `c:formatCode`, `c:separator`: instrucciones de campo, posiciones, fórmulas); el texto de cada párrafo, armado solo con `w:t`, `w:delText`, `a:t`, `m:t` y `c:v` (cruza runs); y los atributos con texto (`v:textpath@string`, `w:alias`, `w:tag`, `w:lvlText`, `w:listItem`). No cuentan las enumeraciones ni los nombres de parte.
- **Lista negra y no lista blanca** a propósito: una hoja de texto que el lector no conoce cuenta por defecto, y eso es lo que le da al gate su independencia del lector (en la ronda 1 atrapó el texto de ecuaciones partido en runs). En el corpus las únicas hojas con texto son `w:t`, `c:v`, `m:t`, `a:t` y las de la lista negra (más 1 `w:delText` suelto en un documento, y `w:p`/`w:r` con texto directo en 3 y 2 documentos).
- **Estructura** (nuevo): marcadores solo con nombre `_bmN`, ids únicos y emparejados; hipervínculos solo con `w:anchor` y con destino; sin recortes de imagen; metadatos de imagen leyendo los segmentos JPEG (APP1 a APP15 y COM antes del scan) y los trozos PNG (`iCCP`, `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`) en lugar de buscar bytes sueltos.

**Dos arreglos al gate que cambian números:**
1. El texto del párrafo se armaba con **todas** las hojas con texto, incluidos los números de posición (`wp:posOffset`): en `w0744` el párrafo valía `aaa2840990720090bbb` y la palabra `aaabbb` no se encontraba. Con el arreglo el control negativo de ese documento pasó de «no encuentra» a «encuentra» (1.441 en vez de 1.439 de 1.449) y apareció 1 documento más con hallazgo (`w0975`, ver abajo).
2. El falso positivo del JPEG de la ronda 1 (`w0637` esta vez) desapareció: los bytes `FF E1` aparecían dentro de la tabla de Huffman, no en un segmento.

**Resultado sobre el corpus** (2.089 documentos que entran; paquete limpio de la ronda 2, escritor con fichas):

| | Documentos |
|---|---|
| **Pasan el gate** | **2.086 (99,86 %)** |
| Falla estructural | **0** |
| Hallazgo por valor | 3 (`w0975`, `w1388`, `w2003`) |
| La regla de la ronda 1 (subcadena, todas las hojas) sobre los mismos documentos | 785 con hallazgo |

Los 3 hallazgos son documentos de prueba hechos de la letra `x` (`xxx`, `Xxxxx`): el valor al azar es una cadena de `x` y el párrafo quedó `xxx[PALABRA-01]xxxxxx[PALABRA-01]xxxxxx…`, donde el tramo entre dos fichas es otra cadena de `x` igual al valor y los corchetes de la ficha le dan «límite de palabra». No hay dato real. El escritor reemplazó cada aparición donde hay límite y esos tramos son fragmentos de una palabra más larga. **Fugas confirmadas: 0.** Salvo esos 3 casos de `x`, ninguna detección ubicada deja su valor como palabra suelta en otro lugar del XML.

**Control negativo** (el gate sobre el paquete limpio sin reemplazar): encuentra fugas en **1.441 de 1.449** documentos con detecciones. Los 8 que no: 6 donde el valor aparece en el XML solo como parte de una cadena más larga (`w0284`, `w0457`, `w0778`, `w1205`, `w1669`, `w1899`) y 2 de CJK donde la detección no ubica texto del XML (`w0347`, `w1517`). Sintéticos: el gate sobre el paquete limpio sin reemplazar encuentra los valores en 8 de 8.

**Sintéticos con el gate nuevo:** 8 de 8 pasan; los 224 datos de `truth.json` buscados en todo el XML del Word limpio: **0 quedan** (con la regla nueva y con la vieja); `s07` conserva 1 detección parcial como antes.

**Detecciones por estado** (5.259 en 1.449 documentos, sin cambios respecto de la ronda 1 salvo 7 menos sin ubicar): únicas 4.838, ambiguas 120, parciales 40, sin ubicar 261. Documentos con alguna sin ubicar o parcial (en la aplicación: el Word no se exporta): **133 (6,4 %)**; con las de patrón (DNI, CUIT, correo) solo **1**.

**Lo que el gate no ve (y lo decidió el mantenedor):** una subcadena dentro de una palabra más larga y un valor que no está como texto del XML. [NO CONFIRMADO] cuánto importa en documentos reales: en los de prueba son cadenas de teclado.

### 10.4 R4: «Tapar con negro» (`█` U+2588 del largo del valor)

El escritor con `opts.block`: el reemplazo es `█` repetido tantas veces como caracteres tiene el valor (espacios incluidos). 1.449 documentos con detecciones, convertidos con el mismo Worker.

| | Con fichas `[TIPO-NN]` | Con `█` |
|---|---|---|
| Documentos que cambian la cantidad de páginas | 71 (4,9 %) | **44 (3,0 %)** |
| Los que cambian con ambos | 41 | 41 |
| Cambian solo con ese reemplazo | 30 | 3 |
| Diferencia de páginas (con `█`) | | +1 en 36, +2 en 3, +3 en 1, +5 en 1, −1 en 3 |

- **LibreOffice dibuja el `█`.** Bloques en el XML del Word: 146.154; bloques en el texto de las páginas: 148.464 (el corpus ya traía algunos `█` propios). 1.359 de los 1.449 documentos muestran todos sus bloques; 52 no (texto que LibreOffice no dibuja, la misma causa que con las fichas; por ejemplo `w0143`, 24 bloques en el XML y 0 en la página).
- **Fuentes** con que se dibuja el `█` (80 documentos mirados, ítems de texto con `█`): DejaVu Serif 182, DejaVu Sans 101, Liberation Sans 52, Liberation Serif 56. Es decir, con la fuente del documento si es Liberation (tiene el glifo) y con DejaVu si no. En la captura (`r2\vis\w0013-block-p.png`) se ve un bloque negro continuo, sin huecos entre caracteres.
- **Por qué cambian páginas:** el `█` ocupa más ancho que una letra (entre 0,6 y 0,75 em contra unos 0,5 em) y el bloque del largo del valor ensancha la línea; con las fichas, `[PALABRA-01]` es más larga que una palabra corta.
- Un bloque del largo del valor **revela la longitud del valor**. Se anota como hecho.

### 10.5 R5: imágenes, con parecido de píxeles

**Método.** Para cada parte de `word/media` del paquete limpio, una miniatura de 16×16 RGB sobre blanco, decodificada **en el Worker** con `createImageBitmap` y `OffscreenCanvas` (394 partes, 0 sin decodificar). Para cada imagen que el PDF dibuja (`getOperatorList` y `page.objs`/`commonObjs` con los píxeles), la misma miniatura con el mismo código. La distancia es la diferencia media por canal, tomando el mejor de los 8 giros y espejos (LibreOffice hornea giro y espejo). Se considera igual si es menor a 0,08. La distribución es bimodal: de 25.373 imágenes, 25.220 quedan a menos de 0,01 de alguna parte.

**Corpus** (25.373 imágenes del PDF en 264 documentos, ninguna sin píxeles):

| Qué es | Imágenes | Nota |
|---|---|---|
| Se parece a una sola parte de `word/media` | 25.167 | |
| Se parece a más de una parte | 78 | casi todas son **la misma imagen guardada como 2 o 3 partes de contenido idéntico** (distancias 0,0003; `w0056`, `w0204`, `w0228`): tapar todas las candidatas resuelve sin tapar de más |
| No se parece a ninguna, pero es real | 35 | en 20 documentos |
| Relleno que LibreOffice dibuja como imagen y **no tiene `blip` en el XML** | **93** | 68 en documentos sin ninguna parte de `word/media` y 25 chicos o lisos; no cuentan como imágenes |

**Hallazgo que corrige la ronda 1:** el «49 % sin dibujo en el XML» no eran rellenos de LibreOffice. De las 25.373 imágenes, **24.7 mil son 4 documentos** (`w0639` con 13.766 y `w1877`, `w1878`, `w1879` con 3.647 cada uno) donde una imagen de 8×8 píxeles es un **relleno de patrón (`v:fill`) con imagen** y LibreOffice la dibuja una vez por baldosa. Esas sí tienen `blip` y se ubican (una sola parte). Los rellenos sin `blip` son solo 93 (0,4 %).

**Porcentaje de las imágenes reales que se ubica sin ambigüedad:**

| | Únicas | Ambiguas | Reales sin ubicar | Total reales | % sin ambigüedad |
|---|---|---|---|---|---|
| Sin repetir (misma parte y mismo tamaño cuenta una vez) | 261 | 55 | 28 | 344 | **75,9 %** |
| De 20 pt o más (496 imágenes; 82 son rellenos sin `blip`) | 327 | 52 | 35 | 414 | **79,0 %** |
| Todas, contadas una por baldosa | 25.167 | 78 | 35 | 25.280 | 99,6 % (lo domina el patrón de 4 documentos) |

Para comparar: con solo tamaño y orden (ronda 1, mismos 496): 191 únicas (38,5 %), 51 en la misma parte, 22 ambiguas y 232 «ninguna». El parecido de píxeles separa esas 232 en 82 rellenos sin `blip`, 115 reales que ahora se ubican (formas, VML, repeticiones de tamaño) y 35 que siguen sin ubicarse. Documentos con alguna imagen real ambigua o sin ubicar: 34 de 230 con imágenes reales (14,8 %); con alguna **sin ubicar** (la que bloquearía el Word aunque se tapen todas las candidatas): **20 de 230 (8,7 %)**.

Las 35 sin ubicar: el XML de esos documentos tiene efectos de dibujo (`a:effectLst`, sombra o reflejo) en 6, mosaico (`a:tile`) en 2 y transparencia (`a:alphaModFix`) en 1; en el resto no hay un elemento que lo explique. No se aisló la causa de cada una [NO CONFIRMADO].

**Sintéticos: 15 documentos** (los 10 de la ronda 1 más JPEG, GIF, agrupación `wpg` con dos imágenes y Fallback VML, imagen VML y rectángulo con `blipFill`, todos con una imagen de 200×120 con un bloque «dato» asimétrico). Ubicación por parecido de píxeles; se tapa una zona (35 % derecho y 40 % superior de la imagen **tal como se ve**) en el mapa de bits de `word/media` aplicando la inversa del giro o espejo que dio el parecido, en el Worker (decodificar, `fillRect`, recodificar y reescribir el ZIP), y se verifica en la imagen que dibuja el PDF del documento tapado:

| Caso | Ubicación | Dentro de la tapa que queda tapado | Fuera que cambia |
|---|---|---|---|
| en línea, flotante, recortada, girada 90°, espejos H y V, repetida (2 dibujos, 1 parte), en encabezado (2 imágenes), combinada | única | 100 % | 0 % |
| **JPEG** | única | 100 % | 0 % |
| **GIF** (queda como PNG del primer cuadro) | única | 100 % | 0 % |
| **imagen dentro de una agrupación `wpg`** (2 imágenes, con Fallback VML que el limpiador quita) | única, las 2 | 100 % y 100 % | 0 % |
| **imagen VML** (`v:imagedata`) | única | 100 % | 0 % |
| **forma con relleno de imagen** (`blipFill` en `wps:spPr`) | única | 100 % | 0 % |
| girada 30° | **no se ubica** (distancia 0,33: LibreOffice la hornea en una caja con esquinas transparentes) | | |

La girada 30° se ubicaría con el giro del XML, como en la ronda 1 (98,8 %); el parecido de píxeles solo cubre múltiplos de 90°. [NO CONFIRMADO]: imágenes con efectos (sombra, tinte) y rellenos con mosaico dentro de formas, que en el corpus son justo las que no se ubican.

### 10.6 R6: vectoriales y TIFF

Los 64 documentos del corpus con partes vectoriales o TIFF (155 partes WMF/EMF en 58 documentos, 8 TIFF en 6; 3 SVG aparecen en el corpus pero ninguno queda referenciado). Se compararon tres versiones de cada uno: **keep** (las partes vectoriales tal cual, como el original), **drop** (lo que hace el prototipo: se quita el dibujo) y **raster** (la parte reemplazada por un PNG). Las 156 llamadas (155 partes vectoriales; una se pide a dos tamaños) y los 8 TIFF salen **sin ninguna falla**.

El tamaño con que se dibuja sale del XML (`wp:extent`, `pic:spPr/a:xfrm/a:ext`, o el `style` de `v:shape`) y se pide el doble, a 96 dpi, con tope de 4.096 px de lado. Se probaron tres rutas de LibreOffice, todas dentro del mismo Worker, sin interfaz:

| Ruta | Cómo | Tamaño de salida | Mediana / p90 / máx por parte | Páginas = a keep | Documentos con alguna página con más de 0,5 % / 2 % / 10 % de píxeles distintos | PNG (mediana / total) |
|---|---|---|---|---|---|---|
| **A. `GraphicProvider.queryGraphic` + `storeGraphic` (nativa)** | la propia API, sin interfaz | **el natural del metafile a 96 dpi** (mediana 0,5 del tamaño pedido, es decir 1× lo dibujado) | **15 / 32 / 125 ms** (3,2 s las 156) | 64 de 64 | **15 / 4 / 1** | 14 KB / 1,6 MB |
| B. A con la cabecera del metafile escalada (EMF: marco; WMF: pulgada) | pide más píxeles con el mismo dibujo | mediana 0,70 del pedido (alcanza 0,9 o más en 65 de 154) | 46 / 55 / 159 ms | 64 de 64 | 23 / 10 / 4 | 74 KB / 7,6 MB |
| C. `GraphicObjectShape` en un Draw vacío + `GraphicExportFilter` con `PixelWidth` y `PixelHeight` | respeta el tamaño pedido | **el pedido (2×)** | 125 / 137 / 403 ms (14,7 s) | 64 de 64 | 27 / 9 / 4 | 9 KB / 0,9 MB |

- **`PixelWidth` y `PixelHeight` en `storeGraphic` no se aplican a metafiles** (sí a TIFF): la imagen sale del tamaño natural, con o sin `Mode`, con valores como entero tipado o no.
- **La ruta C no es fiel**: dibuja distinto al PDF de LibreOffice (p. ej. `w0242`: la página tiene un rectángulo azul y la ruta C lo da blanco con puntos rojos). Es el camino de dibujo de Draw (primitivas) contra el de la conversión (reproducción del metafile). Los 4 documentos con más de 10 % de diferencia (`w0220`, `w0242`, `w1620`, `w1886`) son de esa ruta.
- **Una cuarta ruta no anduvo:** Writer vacío con una página del tamaño de la imagen y el filtro `writer_png_Export` da una página con un marcador de posición, igual para todos los archivos. No se siguió.
- La ruta A es la fiel y la más barata; entrega **96 dpi** (≈ el tamaño que tiene en la página), la mitad de lo que se pidió. La B sube la resolución y pierde algo de fidelidad. **Hoy no hay ruta con tamaño pedido y fidelidad a la vez** (decisión: ver 10.9).
- Fidelidad de la ruta A: mediana por documento de la página con más diferencia 0,11 %, p90 1,2 %. Los pocos documentos con más de 2 % son `w0032` (6,4 %: 76 páginas hechas de metafiles), `w1695` (3,1 %), `w1970` (4,3 %, un TIFF) y `w0635` (30 %: un TIFF que LibreOffice **no dibuja** al convertir el original con el TIFF sin tocar; la ruta raster sí lo muestra).
- **Palabras que se pierden porque el texto pasa a ser píxeles:** en esos 64 documentos las páginas de *keep* tienen **9.806 palabras** y las de *raster* **4.074**: **se pierden 5.732 (58 %)**, en 43 documentos (el prototipo que quita el dibujo pierde 5.777). 5.328 de ellas son un solo documento (`w0032`). Rasterizar no recupera el texto; lo deja visible como imagen y entonces solo lo ve el OCR de la aplicación.

**R6b: TIFF.** `utif2` está en el disco (`C:\Anonly\spikes\imagenes\vendor\pkgs\node_modules\utif2`, versión 4.1.0, dependencia `pako`) y hay un bundle ya armado en `C:\Anonly\spikes\imagenes\harness\dist\utif.js`. Se usó una copia del bundle como módulo ESM servido por `app://` y se decodificó **en el Worker con CSP estricta** (sin `eval`; `UTIF.decode`, `decodeImage`, `toRGBA8` y recodificación con `OffscreenCanvas`): **8 de 8 TIFF** a PNG. Contra la ruta de LibreOffice, el resultado de la página es casi idéntico (6 documentos: máxima diferencia 0,9 %, el resto menos de 0,06 %).

### 10.7 R7: memoria y tiempos en el Worker

Todo en el Worker de módulos con CSP estricta (`script-src 'self' blob: 'wasm-unsafe-eval'`, sin `unsafe-eval`), una medición por vez, **un lanzamiento de Electron por tamaño** y 3 repeticiones; la memoria es el pico (muestreo cada 20 ms) del proceso de la página (`Tab`) que contiene el Worker, y se da junto con la base de ese proceso **sin el Worker de LibreOffice** (70 MB de trabajo, 25 de privada).

**Alinear el documento completo de una vez** (lector + `analyzeModel`: pasada 1 del cuerpo y pasada 2) sobre sintéticos del mismo generador que la ronda 1, de texto repartido en líneas y páginas (no sale de LibreOffice; sirve para escalar, no para calidad):

| Caracteres del XML | Páginas | Leer (ms) | Alinear (ms) | **Total (ms)** | **Pico memoria de trabajo (MB)** | Pico privada (MB) | Caracteres de la página con par |
|---|---|---|---|---|---|---|---|
| 499.971 (0,5 M) | 143 | 39–40 | 227–253 | **267–293** | **202–215** | 161–175 | 408.019 de 411.915 |
| 1.001.946 (1 M) | 286 | 76–90 | 491–526 | **568–602** | **344–355** | 306–315 | 817.350 de 825.250 |
| 2.004.618 (2 M) | 572 | 159–174 | 1.174–1.214 | **1.340–1.373** | **482–543** | 449–501 | 1.635.594 de 1.651.502 |
| 3.982.507 (4 M) | 1.137 | 268–323 | 2.550–2.660 | **2.874–2.940** | **965–980** | 929–945 | 3.249.413 de 3.281.279 |

- El tiempo escala casi lineal (≈ 0,72 s por millón de caracteres) y la memoria también: **≈ 220 a 240 MB por millón de caracteres** sobre la base de 70 MB. [NO CONFIRMADO] con el Worker de LibreOffice vivo en el mismo proceso: en la ronda 1 la base con LibreOffice cargado salió de unos 570 a 650 MB de trabajo, así que habría que sumar eso (4 M llegaría cerca de 1,5 GB).
- Ronda 1 (Node): 8 M de caracteres, 6,2 s y unos 2 GB de más; 1,3 M, 0,8 s y 260 MB de más. Coincide en el orden.

**Por tramos según el orden de las páginas** (pasada 1 sola; ventanas de 20 páginas; cada ventana busca en el XML a partir de donde terminó la anterior, con 2.000 caracteres de margen que se cuadruplica si menos del 60 % tiene par; sin anclas globales; sintéticos):

| Caracteres | Todo junto: alinear / total (ms) · pico MB | Por tramos: alinear / total (ms) · pico MB | Caracteres de la página con el mismo par | Ventanas / tramo máximo del XML |
|---|---|---|---|---|
| 0,5 M | 202 / 279 · 209 | 179 / 248 · 199 | 100 % | 8 / 60.660 |
| 1 M | 439 / 561 · 362 | 230 / 362 · 319 | 99,9999 % (1 distinto) | 15 / 60.752 |
| 2 M | 1.056 / 1.302 · 540 | 435 / 685 · 444 | 99,9998 % (4) | 29 / 61.121 |
| 4 M | 2.348 / 2.813 · 973 | 844 / 1.314 · 781 | 99,9993 % (24) | 57 / 61.008 |

- **Ahora sí baja el tiempo (2,8 veces a 4 M) y la memoria un 20 %**, con 0 reintentos. La memoria no baja más porque quedan enteros el texto del XML y el de las páginas normalizados (cuatro arreglos por carácter), que son lo grande; lo que se acota es el trabajo del alineador. La pasada 2 (encabezados, notas, cuadros) **no se partió** [NO CONFIRMADO] cuánto cambia el total.
- **Es frágil en documentos reales.** Con ventanas de 4 páginas sobre los 22 documentos del corpus de 10 o más páginas: solo 4 dan el mismo resultado, en conjunto 97,0 % de los caracteres con el mismo par, y varios caen a 60 o 80 % (`w1499` 61,8 %, `w0586` y `w0904` 80,6 %, `w1646` 0 %): el orden de las páginas no sigue al del XML (columnas, tablas, cuadros, texto que no se dibuja). Con ventanas de 20 solo hay 2 documentos con más páginas (`w1901` 60 páginas: 100 %; `w0395` 47: 99,98 %). Para un techo con documentos reales de cientos de páginas falta material [NO CONFIRMADO]; con los sintéticos anda.

**Escritor y gate dentro del Worker** (2.089 documentos del corpus, un Worker de módulos que queda vivo y ya está caliente; detecciones, escritor, gate y gate de control, una operación por documento):

| | Worker p50 | p90 | p99 | máx | Node (ronda 1) p50 / p99 / máx |
|---|---|---|---|---|---|
| Escribir (leer, alinear, reemplazar, ZIP), ms | 2,6 | 6,2 | 28,7 | 111 | 3,6 / 37,4 / 232 |
| Gate, ms | 2,0 | 5,2 | 14,2 | 61 | 2,2 / 23,7 / 459 |
| Todo (detectar + escribir + gate) | 4,6 | 11,3 | 45,6 | 169,5 | |

- **El `.docx` que sale del Worker es idéntico byte a byte al de Node en 2.089 de 2.089** (mismo SHA-256) y el gate da lo mismo (los mismos 3 documentos de `x`).
- Pico del proceso de la página durante todo el lote: mediana 275 MB, p99 331, máx 338 (el Worker queda vivo).
- Con un Worker nuevo por documento el arranque suma lo de cualquier Worker de módulos (ms), no se midió aparte.

**Escritor y gate sobre los sintéticos grandes** (el texto de cada párrafo con un dato de patrón cada 7 u 11 párrafos: 1 detección cada ~1.100 caracteres, todas únicas), mismo Worker:

| Caracteres | Detecciones | Detectar (ms) | Escribir (ms) | **Gate tal cual (ms)** | **Gate con índice (ms)** | Pico memoria (MB), con el gate tal cual / con índice |
|---|---|---|---|---|---|---|
| 0,5 M | 445 | 48 | 445 | **3.459** | **33** | 290 / 289 |
| 1 M | 885 | 88 | 1.152 | **13.624** | **64** | 339 / 347 |
| 2 M | 1.764 | 171 | 3.226 | **53.794** | **129** | 510 / 684 |
| 4 M | 3.522 | 322 | 10.166 | **215.590** | **240** | 949 / 980 |

- **El gate es cuadrático** (×4 cada vez que se duplica el documento y las detecciones): busca cada valor con una expresión regular en cada hoja de texto y cada párrafo (valores × textos). El escritor también crece más que lineal (×2,6, ×2,8 y ×3,2 por duplicación: busca cada valor en el texto de cada párrafo).
- **Arreglo medido:** el mismo gate con un índice por primer token (cada valor se compara solo donde empieza un token igual a su primer token; mismas reglas de límites) baja a **33, 64, 129 y 240 ms** (de 3.459, 13.624, 53.794 y 215.590): 100 a 900 veces menos y lineal (el gate de control, igual). **Mismos hallazgos que el lento:** en los 2.898 gates del corpus (paquete final y limpio sin reemplazar de los 1.449 documentos con detecciones) salen los mismos 29.483 hallazgos y los mismos pares (valor, nodo); en 2.089 documentos el tiempo total del gate baja de 10,1 a 7,2 s (el resto es leer y parsear el XML). El escritor sigue en 10,1 s a 4 M: **queda como el próximo cuello** (más que lineal por el reemplazo por valor).
- Los sintéticos grandes no son paquetes limpios (el gate marca 3 fallas estructurales de partes huérfanas): sirven para tiempos, no para el resultado.

### 10.8 R8: las 15 detecciones que no son «sin ubicar»

En la ronda 2 son **77** las detecciones cuyo valor aparece como palabra completa en las páginas del Word limpio, en 44 documentos: **61 sin ubicar** (las mismas de la ronda 1), **1 parcial** y **15 únicas**. La parcial no cambia nada (cuenta como sin ubicar: el Word no se exporta). **Ninguna de las 15 es una fuga**: en todas la detección está ubicada y reemplazada, y el valor suelto que se ve en la página es un fragmento de una palabra más larga que LibreOffice parte en líneas, no una palabra del XML. Se contó para cada una cuántas veces aparece el valor en el XML limpio como palabra con límites y cuántas en el XML final.

| Documento | Valor al azar (sintético de prueba) | Como palabra en el XML limpio → final | Qué es |
|---|---|---|---|
| `w0284` | 24 `a` | 0 → 0 (52 → 28 como subcadena) | documento de prueba hecho de una cadena de `a` sin espacios |
| `w0363` | `cmap` | 0 → 0 | ecuación: el XML trae `cmapωp>cth` pegado dentro de la fórmula (la subíndice `map` va después de `c`); la página lo dibuja con espacios y pdfjs lo lee como palabra suelta |
| `w1086` (3) | cadenas de 9, 29 y 71 `e` | 2 → 0 para la de 29; las otras 0 → 0 | cadena de `e` sin espacios que la página parte en líneas |
| `w1229` | 12 `x` | 6 → 0 | texto de prueba hecho de `x` |
| `w1388` | 10 `x` | 11 → 0 | idem |
| `w1409` (2) | 11 y 77 `x` | 2 → 0 para la de 11; la otra 0 → 0 | idem |
| `w1669` | 76 caracteres `dada…` | 0 → 0 | cadena de teclado repetida |
| `w1899` | 32 `a` | 0 → 0 | idem |
| `w2005` | 67 `x` | 0 → 0 | cadena de `x` |
| `w2024` (3) | tramos de 29 caracteres de `qwertyuiopasdfghjklzxcvbnm…` | 0 → 0 | cadena de teclado repetida: la página la parte cada 29 caracteres y cada tramo queda como «palabra» |
| `w0236` | `abcdefghi` (parcial) | no está en el XML | documento de prueba de «delete-merge»: el texto que se ve en la página no está como texto del XML; ya cuenta como sin ubicar |

En estos documentos el valor es un tramo de una cadena mucho más larga (de decenas a miles de caracteres sin espacios). En un documento real equivaldría a un dato dentro de un token largo sin espacios (una URL, un identificador): el gate no lo cuenta por la regla de límites, y el escritor lo reemplazaría solo donde la página lo mostró como palabra. [NO CONFIRMADO] en documentos reales.

### 10.9 Hallazgos y decisiones abiertas

**Hallazgos que cambian el diseño o corrigen la ronda 1**
1. **Los «rellenos que LibreOffice dibuja como imagen» no eran el 49 %.** Son 93 imágenes de 25.373 (0,4 %). El grueso eran baldosas de un relleno de patrón con imagen (`v:fill`) en 4 documentos: la ubicación tiene que contar una imagen por (parte, tamaño) y no una por llamada de dibujo.
2. **El parecido de píxeles resuelve casi todo lo que el tamaño no resolvía:** 75,9 % de las imágenes reales sin ambigüedad (contra 38,5 % por tamaño en las de 20 pt o más). Lo que queda sin ubicar son imágenes con efectos o mosaico (20 documentos).
3. **Con `pdfjs` los píxeles de una imagen que se repite en varias páginas están en `commonObjs` (nombres `g_…`), no en `objs`**; leerlos de `objs` no vuelve nunca.
4. **El gate y el escritor son más que lineales** (10.7). Sin un índice por token, un documento de 2 M de caracteres con detecciones cada ~1.100 caracteres cuesta casi un minuto de gate.
5. **LibreOffice pinta en azul subrayado los hipervínculos internos que se conservan** y no dibuja una línea de índice en 1 documento; el XML está bien (ver 10.2).
6. **Rasterizar vectoriales no recupera el texto.** Los 5.732 palabras que se pierden quedan como píxeles: quedan para el OCR de la aplicación.
7. **El gate de la ronda 1 acumulaba números de posición en el texto del párrafo** (10.3) y a veces ocultaba una coincidencia real; está arreglado.

**Decisiones para el planificador o el mantenedor** (se reportan, no se decidieron)
1. **Vectoriales y TIFF**: (a) rasterizar con la ruta A (fiel, 96 dpi, 15 ms por parte), la B (más resolución, menos fiel) o ninguna; (b) quitar el dibujo como hoy; (c) no exportar. Para los TIFF, `utif2` en el Worker anda y hace falta decidir si entra como dependencia (ADR); LibreOffice también los rasteriza sin ella.
2. **Qué tamaño de imagen se puede pedir**: si se necesita OCR de texto dentro de un vectorial a 2× (≈ 192 dpi), hoy no hay una ruta de LibreOffice fiel que lo dé.
3. **Hipervínculos y marcadores**: la regla de conservar solo los referenciados anda en 282 de 282; pierde los enlaces que generaba un campo congelado (número de página en índices). ¿Se acepta?
4. **Gate**: confirmar la lista negra de hojas que no son texto (`w:instrText`, posiciones, fórmulas) y que la subcadena no cuente; y hacerlo con índice por token (ver 10.7).
5. **Techo de tamaño** a partir de la tabla de 10.7 (≈ 240 MB por millón de caracteres, más lo que ocupe LibreOffice) y de que el gate y el escritor tienen que ser lineales.
6. **Imágenes sin ubicar** (20 de 230 documentos con imágenes reales, 8,7 %): el Word no se exporta, o se tapan todas las candidatas con una ubicación aproximada.
7. **`█`**: cambia páginas en el 3,0 % de los documentos con detecciones y revela la longitud del valor.
8. **Giro que no es múltiplo de 90°** (30°): usar el giro del XML.

### 10.10 Dónde está todo (ronda 2)

- Código nuevo o modificado en `C:\Anonly\spikes\lowa\harness\word-limpio-escritura\` (copias de la ronda 1 en `r1\`):
  - `limpiador.mjs`: recorte real (`collectUses`, `splitCrop`), marcadores `_bmN`, hipervínculos internos, vectoriales (`keep`/`drop`/`raster`) y TIFF; `gate.mjs`: regla v2 con índice por token, estructura nueva, metadatos de imagen por segmentos; `escritor.mjs`: `opts.block`.
  - `electron\`: `clean-worker.mjs` (recorte, puente al Worker de LibreOffice para rasterizar, `utif`, escalado de cabecera), `thumbs-worker.mjs`, `write-worker.mjs`, `align-worker.mjs`, `cover-worker.mjs`, `ops\rast.js` (ruta A), `ops\rast2.js` (ruta C), `ops\rast3.js` (Writer, no anduvo), `vendor-utif\utif.mjs` (copia del bundle de `utif2`), `page.js` y `main.js` con las operaciones nuevas.
  - Medición: `verify-nav.mjs`, `cmp-pages.mjs`, `render.mjs`, `resumen-r3.mjs`, `r4.mjs`, `r8.mjs`, `r8b.mjs`, `p5img.mjs`, `p5resumen.mjs`, `p5cover.mjs`, `gen-img2.mjs`, `r6.mjs`, `ext-vec.mjs`, `gen-grandes2.cjs`, `mk-pagetext.mjs`, `thumbs-core.mjs`, `t-*.mjs` (comprobaciones sueltas).
- Datos en `C:\Anonly\spikes\lowa\results\word-limpio-escritura\r2\`: `lo\` (paquetes limpios, PDF, Word limpio con fichas `.final.docx`, con bloques `.block.docx`), `lo-p1.jsonl` y `lo-p1-resumen-r3.json`, `lo-val.jsonl`, `r4.json`, `r8.json`, `nav.json`, `p5img.jsonl`, `img15*\` (sintéticos de imágenes), `vec-keep\`, `vec-raster-{draw,native,scale,utif}\`, `r6-*.json`, `align\`, `wk\`, `grandes\`, `vis\` (capturas).
- Cómo repetir lo principal (desde `harness\word-limpio-escritura`):
  ```
  node run-lote.mjs --op cleanconv --out ..\..\results\word-limpio-escritura\r2\lo --name lo --list ..\..\results\word-limpio-escritura\lista-lo.txt --params {"tag":"c"}
  node p1.mjs lo ..\..\results\word-limpio-escritura\r2\lo ..\..\results\word-limpio-escritura\r2\lo-p1.jsonl [--block 1 --tag block]
  node resumen-r3.mjs ..\..\results\word-limpio-escritura\r2\lo-p1.jsonl
  node run-lote.mjs --op thumbs ... ; node p5img.mjs <dirLo> <thumbs.jsonl> <salida> ; node p5resumen.mjs <salida> 0.08
  node run-lote.mjs --op cleanconv ... --params {"tag":"r","vector":"raster","rastRoute":"native","tiff":"utif"}
  node run-lote.mjs --op align ... --params {"mode":"full","pageText":"<txt>"} ; node run-lote.mjs --op escribir ... --perid {...}
  ```
