> Informe del implementador del spike, ronda 4, copiado sin cambios. El resumen y lo que decide están en `Plan_1.2.md` §8.10.

# PDF con texto preservado (`pdf-text`): ronda 4

Fecha: 2026-11-25. Repo sin tocar (solo lectura de `packages/anonymization-core/pdf-engine`). Código en `C:\Anonly\spikes\texto-preservado\harness\r4\`, datos en `...\results\r4\`. Reusa el arnés de las rondas 1 a 3 (`lib-excl.mjs` y `lib-det.mjs` de `r3\`, `ocr.json`, `detect.json`, `layers.json`, `truth.json` de `results\r3\`).

**Sin documentos reales**: no hay ninguna variable `ANONLY_REAL_DOC_*`. Todo es sintético o de las páginas de prueba del corpus.

## Resumen (los números que deciden)

1. **La palabra invisible fundida con una visible es una fuga total hoy.** 72 páginas trampa (a: invisible pegada antes o después de una visible; b: letras invisibles al principio, medio y final de una visible, en el mismo ítem y en ítems separados; c: DNI escondido pegado a `DNI`; 3 formas de invisibilidad, fondo claro y oscuro). El PdfEngine las funde en **una sola palabra** en 72/72 (`OCULTO-ZZ-77Texto`, `adminisXQZtrativo`, `DNI30123456`). **V deja pasar 72/72 y el área exclusiva > 0 también 72/72** (la palabra fundida no tiene vecinas: su área exclusiva es toda). La guarda de solape ≥ 1 % deja pasar 60/72.
2. **La prueba por tramo de caracteres cierra el hueco.** Con tramos de 1 o 2 caracteres (ancho proporcional al número de caracteres, a lo largo del lado mayor de la caja): **0/72 fugas**. Con tramos de 3 caracteres, 12/72 (letras escondidas en el medio); con 4, 18/72.
3. **Costo en palabras legítimas** (13.864 palabras de 239 páginas; V conserva 13.748): tramo de 1 carácter pierde **30** contra V (0,22 %, 14 páginas); tramo de 2, 14 (0,10 %); de 3, 9; de 4, 7. Área exclusiva > 0 + tramo de 1: 46 (0,33 %); + tramo de 2: 31 (0,22 %). Las 15 palabras escondidas conocidas del corpus no pasan con ninguna.
4. **Costo por página**: 30,3 ms con todas las reglas calculadas a la vez (dos renders de 22,8 ms; el resto es la máscara y los tramos). En la ronda 3 la medición sin tramos fue 25,6 ms (+ ≈ 4,7 ms).
5. **Área exclusiva > 0 con más casos**: 0 fugas en solape horizontal (24 páginas), 2-3 invisibles apiladas (24), texto girado 90/180/270 (36), invisible sobre imagen o vectores sin otra palabra (8 en op0/tr3). **Falla en 48/144** páginas con otras fuentes y tamaños (Courier y Times, a 12 y 24 pt): la tinta de la palabra visible se sale de su caja (descendentes, redondeo) y cae en el área exclusiva de la invisible. Con las cajas de las otras ensanchadas 2 px (150 dpi): **0/144**. Esa variante pierde 23 palabras legítimas (0,17 %) contra 17 (0,12 %) la original; ensanchada 25 % del alto, 66 (0,48 %).
6. **Los casos que ninguna regla de visibilidad por píxeles puede cerrar**: la invisible «de color» (texto del color del fondo) sobre una imagen o un dibujo **sí dibuja** (se ve el contorno de las letras): 4/4 páginas con fuga en todas las reglas. Es tinta visible, no texto escondido.
7. **Las 17 palabras que pierde el área exclusiva > 0**: 7 son renglones con interlineado más chico que la caja (`l-x-ajuste.pdf`, cajas vecinas cubren 35-99 % de la caja), 4 son un texto con sombra (`Text shape with shadow`, el texto duplicado 7,77 pt más arriba, solape 43-49 % con el mismo texto) y 6 son etiquetas de eje de un gráfico (`2001-02`, …; cajas cuadradas de 30 × 30 pt, cubiertas 49 % por cada vecina; probablemente texto girado en diagonal: no verificado). Ninguna es un superíndice ni una celda de tabla.
8. **Los 36 DNI «de más» son los importes**: 36/36 son `1.250.000` (el importe del distractor), en capa buena y en OCR.
9. **Detección combinada** (unión de las detecciones de la capa y del OCR): recall con capa buena 100 % (sin cambio); capa mala 5 %: 98,1 % (capa sola 77,7 %; OCR solo 93,1 %); mala 15 %: 94,1 % (capa sola 44,9 %); falsa: 92,6 % (capa sola 3,8 %). Con valor exacto: 99,7 / 65,3 / 58,9 / 88,2 %. **Costo en detecciones de más**: con la capa falsa, 669 falsas de tipos plantados (OCR solo: 44; capa falsa sola: 627) y 4,55 % de la página tapada donde no hay dato (OCR solo 1,83 %).
10. **Concordancia capa-OCR por página (CER)**: buena 0,000-0,006; mala 5 %: 0,039-0,058; mala 15 %: 0,118-0,156; falsa: 0,649-0,787. **Un umbral separa los cuatro grupos sin errores en estas 160 páginas**: cualquier CER entre 0,006 y 0,039 separa la buena de las demás (con 0,01: 40/40 buenas aceptadas, 0 de las otras 120). Un umbral de 0,05 acepta 27/40 capas malas 5 % (recall 82,0 % en esas páginas con la política «capa si concuerda, OCR si no»).

## 1. Palabra invisible fundida con una visible

### Cómo arma las palabras el PdfEngine (lectura del código)

`pdf-engine/src/pdf.engine.ts`, `convertTextItemsToWords` (líneas 414-640):

- Parte de `getTextContent()` de pdfjs. **pdfjs ya fundió** los ítems de dibujo contiguos en un solo ítem (`item.str`, `item.transform`, `item.width`); el PdfEngine no ve los operadores `Tj` por separado. En R1 se anotó que `disableCombineTextItems` no existe en la versión instalada (4.10.38).
- **Una palabra por cada token `\S+` del ítem.** Una palabra no puede tener una parte invisible y otra visible si están en el mismo ítem: es una sola cadena y una sola caja.
- Geometría: caja de tinta (`inkBoxFromParallelogram`) con origen, ancho (`item.width`) y alto del ítem. Para un ítem con varios tokens, el ancho del token sale de los avances por glifo de una tabla propia armada con la lista de operaciones (`appendRunGlyphs`, `sumGlyphAdvances`) o, si no alinea, de `ancho / cantidad de caracteres`. Esa tabla de glifos es interna: no sale en `Page.words`.
- **Empalme de ítems separados (ADR-142)**: si el primer glifo del ítem B es el siguiente del último de A en el flujo, no hay espacio, la misma línea (desvío transversal ≤ 1 pt) y el hueco es menor que un factor del alto, `mergeSplitWord` los junta en una palabra (texto concatenado, caja = envolvente). Este camino es el que hace que un tramo invisible en otro ítem termine fundido con la palabra visible.
- El estado visible de cada tramo no se conserva: `Page.words` entrega solo texto y una caja por palabra.

### Trampas (72 páginas, `fused-traps.mjs`)

- Página de 460 × 90 pt, texto visible de referencia y la trampa en la misma línea base. Palabra invisible `OCULTO-ZZ-77` (Helvetica 12), letras `XQZ`, o `30123456` (DNI). Formas: opacidad 0, `Tr 3`, color igual al fondo. Fondos claro (blanco) y oscuro (gris 0,27).
  - **a** (24): pegada **después** y **antes** de `Texto`, sin espacio; con la invisible primero o última en el flujo.
  - **b** (36): letras `XQZ` al principio, en el medio y al final de `administrativo`. «Mismo ítem»: un solo `BT`, mismo tipo de letra, cambia el modo de dibujo, el color o la opacidad entre `Tj`. «Ítems separados»: un `BT` por tramo y el escondido en Courier.
  - **c** (12): `30123456` pegado a `DNI`, con la invisible primero o última.
- En las 72 el texto escondido llega a `Page.words`, **fundido en una sola palabra con la visible** (por ejemplo `pruebaOCULTO-ZZ-77Texto`, `TextoOCULTO-ZZ-77`, `adminisXQZtrativo`, `30123456DNI`). Ni «mismo ítem» ni «ítems separados» cambian el resultado.

### Fugas por regla (páginas con el texto escondido en una palabra conservada)

| Regla | a (24) | b (36) | c (12) | Total (72) |
|---|---|---|---|---|
| V | 24 | 36 | 12 | **72** |
| Guarda solape ≥ 1 % | 12 | 36 | 12 | 60 |
| Área exclusiva > 0 (también con otras + 2 px o + 25 % del alto) | 24 | 36 | 12 | **72** |
| Tramo de 1 carácter | 0 | 0 | 0 | **0** |
| Tramo de 2 caracteres | 0 | 0 | 0 | **0** |
| Tramo de 3 caracteres | 0 | 12 (letras en el medio) | 0 | 12 |
| Tramo de 4 caracteres | 0 | 18 | 0 | 18 |
| Área exclusiva > 0 (o + 2 px) + tramo de 1 o 2 | 0 | 0 | 0 | **0** |

- La palabra fundida no tiene vecinas que le quiten área: el área exclusiva no ayuda. Hace falta mirar adentro de la palabra.
- Tramos grandes fallan porque un tramo de 3-4 caracteres que mezcla letras visibles e invisibles tiene tinta y pasa.
- Cuando una palabra no entra por un tramo, **se pierde entera**, incluida la parte visible (`Texto`). Es la regla pedida.

### La prueba por tramo (`lib-fine.mjs`)

- Por palabra: se parte la caja (lado mayor) en tramos de `k` caracteres con **ancho proporcional al número de caracteres** (igual para todos los caracteres: aproximación, no hay ancho por carácter en la API). Cada tramo es visible si ≥ 2 px y ≥ 1 % de su área cambia al sacar el texto (los mismos umbrales de V). La palabra entra si V la juzga visible y todos sus tramos lo son. Se reusan los dos renders de V.
- No se probó la variante «por ítem de texto de origen» ni con el ancho real por glifo: requeriría la lista de glifos del motor (hoy interna) o repetirla desde la lista de operaciones. El ancho proporcional alcanzó para cerrar las 72 trampas con tramos de 1 o 2 caracteres.

### Palabras legítimas perdidas en las 239 páginas del corpus (13.864 palabras, sin las 15 escondidas conocidas)

| Regla | Pierde contra V | % | Páginas | Pierde contra área exclusiva > 0 |
|---|---|---|---|---|
| Área exclusiva > 0 | 17 | 0,12 | 3 | 0 |
| Área exclusiva > 0, otras + 2 px | 23 | 0,17 | 4 | 6 |
| Área exclusiva > 0, otras + 25 % alto | 66 | 0,48 | 16 | 49 |
| Tramo de 1 | 30 | 0,22 | 14 | 29 |
| Tramo de 2 | 14 | 0,10 | 9 | 14 |
| Tramo de 3 | 9 | 0,065 | 6 | 9 |
| Tramo de 4 | 7 | 0,05 | 5 | 7 |
| Excl > 0 + tramo de 1 | 46 | 0,33 | 15 | 29 |
| Excl > 0 + tramo de 2 | 31 | 0,22 | 11 | 14 |
| Excl > 0 (+ 2 px) + tramo de 1 | 52 | 0,38 | 16 | 35 |
| Excl > 0 (+ 2 px) + tramo de 2 | 37 | 0,27 | 12 | 20 |

- Fuga de las 15 escondidas conocidas del corpus: 0 con todas las reglas.
- Costo por página (dos renders + máscara de área exclusiva + tramos de 1 a 4 + las dos variantes ensanchadas): **30,3 ms** medio (22,8 ms son los dos renders). Código: `corpus-fine.mjs`.
- No se diagnosticaron una por una las 30 palabras del tramo de 1.

## 2. Área exclusiva > 0: más casos (`cases2.mjs`)

Palabra invisible `OCULTO-ZZ-77` sobre una palabra visible larga de 197 pt (o 252 pt en 12 pt Courier). Fondo claro y oscuro, tres formas de invisibilidad. «Fugas»: páginas con la invisible en alguna palabra conservada, sobre las páginas con la invisible leída como palabra aparte (todas, 100 %).

| Caso | Páginas | V | Guarda ≥ 1 % | Excl > 0 | Excl > 0, otras + 2 px | Excl > 0, otras + 25 % |
|---|---|---|---|---|---|---|
| Solape horizontal 25, 50, 75, 100 % de su ancho (la invisible 4 pt más abajo) | 24 | 24 | 0 | 0 | 0 | 0 |
| 2 apiladas dentro, 3 apiladas dentro, 2 y 3 parciales | 24 | 24 | 0 | 0 | 0 | 0 |
| Texto girado 90 / 180 / 270, solape real 51,6 % y 100 % | 36 | 36 | 0 | 0 | 0 | 0 |
| Otras fuentes y tamaños (Helvetica, Courier, Times; 8, 12, 18, 24 pt; solape real 50 % y 91 %) | 144 | 144 | 0 | **48** | **0** | 0 |
| Invisible sobre imagen ruidosa (op0, tr3) | 4 | 0 | 0 | 0 | 0 | 0 |
| Invisible sobre vectores (op0, tr3) | 4 | 0 | 0 | 0 | 0 | 0 |
| «De color» sobre imagen o vectores | 4 | 4 | 4 | 4 | 4 | 4 |
| Sobre imagen, pegada a una palabra visible (fundida) | 6 | 6 | 0 | 6 | 6 | 6 |

- **Las 48 fugas de «otras fuentes y tamaños»** son Courier y Times a 12 y 24 pt, en todas las formas y fondos (Helvetica y los tamaños 8 y 18 no fugan). Diagnóstico de un caso (Courier 12 pt, invisible a 0,45×, op0): quedan **15 píxeles con cambio** a 1 px por debajo de la caja de la palabra visible, dentro de la caja de la invisible. Es tinta de la palabra visible (descendentes o redondeo de la caja) que cae en el área exclusiva de la invisible. Se verificó en un caso. Con las cajas de las otras ensanchadas 2 px las 48 se cierran (y ensanchar 25 % del alto también).
- **Solape de la palabra visible**: la guarda de solape ≥ 1 % pierde la palabra visible en todos los casos de solape (la palabra larga). Excl > 0 la conserva en todos los casos de esta tabla.
- **«De color» sobre imagen o vectores**: el texto del color del fondo (blanco) sobre una imagen gris o un dibujo negro **se ve**: V lo juzga visible con razón. No es una trampa de texto escondido que una prueba de píxeles deba cerrar.
- **Sobre imagen, pegada a una palabra visible**: es el caso fundido de la parte 1 (excl > 0 no lo cierra; el tramo de 1 sí en op0/tr3 y no en «color», que se ve).

## 3. Las 17 palabras que pierde el área exclusiva > 0 (`diag-lost17.mjs`, `lost17.json`)

| Documento | Palabras | Qué son |
|---|---|---|
| `l-x-ajuste.pdf` (página `lowa-borde-056`) | 7: `linea`, `que`, `ocupa`, `texto`, `varias`, `lineas`, `y` | Texto de LibreOffice con ajuste a la forma: interlineado menor que el alto de la caja (12,3 pt); la caja de un renglón se solapa con la del siguiente y la del anterior (cubierta 35-99 % de su caja). `texto` queda con 10 px exclusivos de 1.300. |
| `p0208.pdf` (`lowa-full-009`) | 4: `Text`, `shape`, `with`, `shadow` | Texto con sombra: el mismo texto dibujado dos veces con 7,77 pt de desvío vertical. Cada copia cubre 43-49 % de la otra (mismo texto, mismo ancho). |
| `w0293.pdf` (`lowa-full-025`) | 6: `2001-02`, `2004-05`, `2005-06`, `2006-07`, `2009-10`, `2010-11` | Etiquetas de un eje de gráfico: cajas cuadradas de 30,2 × 30,2 pt sin área exclusiva (0 px), cubiertas 49 % por cada vecina (misma línea, ±un lugar). Probablemente texto girado en diagonal; la rotación no se verificó. |

- No hay superíndices ni celdas de tabla entre las 17. Hay dos casos de «tinta propia que existe» (texto duplicado con sombra y renglones apretados) y uno donde la caja axial de un texto girado cubre a la vecina.
- Los **36 DNI «de más»** de la ronda 3: 36/36 son el valor `1.250.000` (el importe de los distractores), en la capa buena y en el OCR. Los 8 nombres «de más» del NER no se diagnosticaron.

## 4. Detección combinada y concordancia (con `results\r3\`, sin repetir el OCR)

Código: `combined.mjs`, datos: `combined.json`. Combinada = ocurrencias de la capa y del OCR, fundiendo la del OCR en una de la capa si son del mismo tipo y se pisan ≥ 50 % del área menor. Las falsas cuentan todas las ocurrencias que no tocan un dato plantado (incluidas fechas, organizaciones y direcciones; el área es la de esas cajas, como % de la hoja).

| Capa | Fuente | Recall | Exacto | Falsas (tipos plantados / otros) | Área falsa |
|---|---|---|---|---|---|
| buena | capa sola | 100 % | 99,7 % | 463 (44 / 419) | 2,26 % |
| buena | **combinada** | 100 % | 99,7 % | 464 (44 / 420) | 2,26 % |
| mala 5 % | capa sola | 77,7 % | 45,1 % | 414 (31 / 383) | 1,85 % |
| mala 5 % | **combinada** | **98,1 %** | **65,3 %** | 502 (46 / 456) | 2,19 % |
| mala 15 % | capa sola | 44,9 % | 9,9 % | 264 (19 / 245) | 1,03 % |
| mala 15 % | **combinada** | **94,1 %** | **58,9 %** | 513 (54 / 459) | 1,99 % |
| falsa | capa sola | 3,8 % | 0 % | 961 (627 / 334) | 2,84 % |
| falsa | **combinada** | **92,6 %** | **88,2 %** | **1.403 (669 / 734)** | **4,55 %** |
| (cualquiera) | OCR solo | 93,1 % | 92,3 % | 463 (44 / 419) | 1,83 % |

- Por tipo en la combinada: mala 5 % nombre 270/274, DNI 112/112, CUIT 80/81, correo 99/107, teléfono 103/103; mala 15 % nombre 252/274, DNI 112, CUIT 80, correo 91, teléfono 102; falsa nombre 272, DNI 112, CUIT 80, correo 62, teléfono 101. El correo mejora con la capa mala (99 y 91 contra 62 del OCR) y no con la falsa.
- **Exacto** sube menos que el recall: en la combinada con capa mala, una misma zona tiene la detección del OCR (valor exacto) y la de la capa (valor con errores), pero la medida pide que el tipo correcto cubra el dato y que **alguna** ocurrencia tenga el valor exacto. 65,3 % y 58,9 % son las zonas donde alguna fuente lo leyó entero.
- **Cuánto se tapa de más**: con la capa falsa, la combinada da 1.403 falsas contra 463 del OCR solo (+940) y casi triplica el área tapada sin dato (4,55 % de la hoja contra 1,83 % del OCR solo). Con la capa mala 5 % agrega 88 falsas contra la capa sola (502 contra 414) y 0,34 pt de área.

### Concordancia por página entre el texto de la capa y el del OCR (40 páginas por grupo)

| Capa | CER capa-OCR: mín / p05 / mediana / p95 / máx | F1 de bolsa de palabras (mediana) | Palabras capa / OCR (mediana) |
|---|---|---|---|
| buena | 0,000 / 0,000 / 0,0018 / 0,0057 / 0,0060 | 0,993 | 0,997 |
| mala 5 % | 0,039 / 0,042 / 0,049 / 0,055 / 0,058 | 0,729 | 0,958 |
| mala 15 % | 0,118 / 0,132 / 0,142 / 0,155 / 0,156 | 0,407 | 0,890 |
| falsa | 0,649 / 0,690 / 0,733 / 0,787 / 0,787 | 0,775 | 0,997 |

- Texto normalizado (espacios colapsados); CER = Levenshtein / largo del texto más largo. **Un umbral entre 0,006 y 0,039 separa la capa buena de las demás sin errores** (40/40 y 0/120). Otro entre 0,058 y 0,118 separa la mala 5 % de la mala 15 %, y entre 0,156 y 0,649 la mala 15 % de la falsa.
- La cantidad de palabras sola **no** separa la capa falsa (razón 0,997 como la buena); la F1 de bolsa de palabras sola tampoco (la falsa 0,775 supera a la mala 15 %).
- Política «capa si CER ≤ umbral, OCR si no» (recall / exacto / falsas de tipos plantados), con la capa falsa y las dos malas rechazadas (umbral 0,01 a 0,03): buena 100 % / 99,7 % / 44; mala 5 %, mala 15 % y falsa 93,1 % / 92,3 % / 44 (es el OCR). Con umbral 0,05 la mala 5 % acepta 27/40 páginas y baja a 82,0 % / 59,8 % / 35; con 0,08 acepta 40/40 y 77,7 % / 45,1 % / 31; con 0,2 acepta la mala 15 % y 44,9 % / 9,9 % / 19.
- Costo de la política: el OCR corre en todas las páginas para poder compararlas (≈ 4,05 s por página en la ronda 3).

## Qué quedó sin medir

- **Documentos reales**: ninguno.
- **Prueba «por ítem de origen» o con el ancho real por glifo**: no se midió; solo tramos de ancho proporcional. La lista de glifos del motor es interna.
- **Los 30 casos del tramo de 1 carácter**, y los 8 nombres «de más» del NER: sin diagnosticar uno por uno.
- **Etiquetas de eje** (`2001-02`, …): no se confirmó la rotación.
- **Letras invisibles dentro del mismo operador de texto** (un solo `Tj` con glifos que no se ven por la fuente: glifos vacíos, fuentes de sustitución): no se armaron.
- **Texto escondido por recorte (clip), máscaras suaves, patrones o capas opcionales** combinado con fusión: no se probó.
- **Solape horizontal con el mismo renglón** (misma línea base): fue el caso fundido; el solape horizontal «puro» se probó con la invisible 4 pt más abajo.
- **El mínimo de ensanche de las cajas** (2 px y 25 % del alto son los dos únicos valores medidos); solo se verificó en un caso con píxeles que el exceso viene de la tinta de la visible.
- **NER en la app** (WASM) y **OCR de la app** (OSD, worker): como en la ronda 3.
- **Escaneos reales y capas reales con errores de OCR**: las capas malas son sintéticas y uniformes.
- **Concordancia con otros motores de OCR**: solo tesseract.js `spa+eng`, mismo motor que generó el OCR de comparación.

## Qué sale solo de sintéticos

- Todo. Las 72 trampas fundidas, los casos de la parte 2 (≈ 3.700 candidatos de los que se eligieron 144), las capas buena, mala y falsa y su OCR son armados por mí. Las 239 páginas del corpus de las partes 1-3 son las de las rondas 1 y 2.
- La fuga por fusión depende de que las piezas queden contiguas en una misma línea base: así se armaron las trampas.
- La separación por CER capa-OCR vale para páginas limpias de texto corrido (CER del OCR contra la imagen 0,002): con escaneos reales el OCR tiene ruido propio y el CER de una capa buena sería más alto.

## Archivos

- Informe: `C:\Anonly\spikes\texto-preservado\results\TEXTO_PRESERVADO_R4.md`.
- Código (`harness\r4\`): `lib-fine.mjs` (medición por palabra, tramos y reglas), `lib-trap.mjs` (constructor de trampas y corredor), `fused-traps.mjs`, `corpus-fine.mjs`, `cases2.mjs`, `diag-lost17.mjs`, `combined.mjs`; `dbg-*.mjs` son de diagnóstico.
- Datos (`results\r4\`): `fused-traps.json`, `corpus-fine.json`, `cases2.json`, `cases2-S2.json`, `cases2-S4.json`, `lost17.json`, `combined.json`.
- Orden: `fused-traps`, `corpus-fine`, `cases2`, `diag-lost17`, `combined`.
