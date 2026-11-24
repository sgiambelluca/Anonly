# Casos borde: LibreOffice 26.8.3.1 propio (`rec-C`) contra ZetaOffice 24.2

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\BORDES.md` el 2026-11-24. Los corpus,
> los PDF, las imágenes y el código quedan fuera del repo, en
> `C:\Anonly\spikes\lowa\`. Qué decide el planificador con esto:
> `Plan_1.2.md` §8.5.

Fecha: 2026-11-24. Mismo equipo, mismo harness y mismo método que `CALIDAD.md` (ese archivo y `INFORME.md` no se tocaron). **No hay documentos reales** (no hay `ANONLY_REAL_DOC_*` definidas): todos los datos de los corpus nuevos son inventados, y el resto son los archivos de prueba del código de LibreOffice. No se fijan umbrales de aprobado o rechazado.

Configuración: nuestro = `dynexec0` + `rec-C` (ver sección 0), `UseTaggedPDF=false`, en un Worker con CSP estricta. ZetaOffice = assets de allotropia en ventana con `unsafe-eval`, PDF con etiquetas (por defecto). Cada archivo con timeout de 60 s, reinicio del conversor tras timeout o crash. Datos crudos en `results\bordes\`.

## Veredictos cortos

| Sección | Veredicto |
|---|---|
| 0. `rec-C` | **Sale.** Con `DejaVuMathTeXGyre.ttf`, más `fc_local.conf` (que `rec-B` había perdido sin querer), más una tabla de alias de fontconfig, las fuentes pedidas caen donde cae ZetaOffice: Cambria Math y Symbol vuelven a DejaVu Math TeX Gyre y OpenSymbol; las 10 sans a Noto Sans; Consolas a DejaVu Sans Mono. Texto de los 9 sintéticos idéntico. **La vía `.xcd` / `VCL.xcu` que se proponía no funciona** (ver abajo): el reemplazo lo decide fontconfig. +582 251 B en `soffice.data`. |
| 1. Texto girado y vertical | **El defecto de `w060` no se reproduce con archivos armados desde cero**: de 36 casos sintéticos (Word, Excel, PowerPoint) el texto sale igual que en Zeta en 33; los 3 restantes son WordArt (no extraíble en ninguno de los dos) y `wordArtVert` de PowerPoint (el nuestro 13/35 caracteres, Zeta 35/35). **El archivo original de LibreOffice (`tdf127118.docx`) sigue perdiendo la celda girada** en la pasada completa (`w0264`). |
| 2. Dónde se esconde un dato | 162 marcadores en 32 archivos: **153 se comportan igual** en los dos conversores. Las 9 diferencias son anotaciones del PDF (el nuestro escribe comentarios y tooltips como anotaciones; Zeta no) y el texto de ecuaciones en cursiva. Hay datos que llegan al PDF por canales que no son el texto de la página (comentarios, URL de enlaces, propiedades del documento): ver tablas. |
| 3. Corpus entero de LibreOffice (2 913 archivos) | Pasada completa: 19 min (Zeta) y 13 min (nuestro), muy por debajo de las 3 h. **Convierte 2 893 el nuestro y 2 885 Zeta**; 0 timeouts del nuestro contra 6 de Zeta; el nuestro convierte 10 que Zeta no, y Zeta 2 que el nuestro no. Pérdida neta de caracteres del nuestro en 65 archivos, más `p0081` (gráfico no soportado) = 66 en las listas, con **4 de contenido real verificados con PNG**; Zeta pierde en 103, con 4 de contenido real verificados. |
| 4. Orden de lectura y símbolos | **Árabe y hebreo: el orden lógico se respeta en los dos conversores y con `rec-B` y `rec-C`** (salida idéntica), pero **se pierden los espacios entre tramos RTL y números o palabras latinas** (p. ej. `رقم48215اشترى`) y una ligadura lam-alef se extrae invertida (`دوالر` por `دولار`). **Symbol: sale el Unicode privado `U+F0xx`, no el griego**, con `rec-B`, `rec-C` y Zeta; con `rec-B` un texto escrito en la fuente Symbol sale con todos los glifos como `U+F061` (corrupto); con `rec-C` sale bien. |

## 0. El recorte `rec-C`

`rec-C` = `rec-B` más tres cambios, armado sin recompilar con `harness\rec-c.mjs` (entrada `artefactos\rec-B` y `artefactos\dynexec0`; salida `artefactos\rec-C`; la variante sin alias es `artefactos\rec-C0`).

```
node harness/rec-c.mjs artefactos/rec-B artefactos/dynexec0 artefactos/rec-C              # rec-C
node harness/rec-c.mjs artefactos/rec-B artefactos/dynexec0 artefactos/rec-C0 --sin-alias # solo las dos restauraciones
```

Qué agrega, con rutas dentro de `soffice.data`:
1. `/instdir/share/fonts/truetype/DejaVuMathTeXGyre.ttf` (577 708 B, copiado de `dynexec0`). Devuelve `Cambria Math` a DejaVu Math TeX Gyre.
2. `/instdir/share/fonts/truetype/fc_local.conf` (3 098 B, copiado de `dynexec0`). **Hallazgo: `rec-B` lo había sacado sin querer.** El filtro `keepFont` de `recorte.mjs` solo deja nombres de fuente dentro de esa carpeta, y este archivo vive ahí. Es la configuración de fontconfig que LibreOffice carga con `FcConfigParseAndLoad` (trae `Symbol` a `OpenSymbol`, `Calibri` a `Carlito`, etc.). Sin él, `Symbol` cae en Noto Serif. Esto corrige a `CALIDAD.md`, que atribuía el cambio solo a la fuente Math: eran dos archivos.
3. En ese mismo `fc_local.conf` se agregan, antes de `</fontconfig>`, alias en el mismo estilo que los existentes (`<alias binding="same"><family>X</family><accept><family>Y</family></accept></alias>`):
   - `Verdana`, `Tahoma`, `Segoe UI`, `Aptos`, `Calibri Light`, `Trebuchet MS`, `Century Gothic`, `Comic Sans MS`, `Impact`, `Lucida Console` a `Noto Sans`;
   - `Consolas` a `DejaVu Sans Mono`.
   El texto exacto queda en `artefactos\rec-C\fc_local.conf.txt`.

**Por qué no sirvió la vía `.xcd` / `VCL.xcu`.** Se probaron dos formas (un `zz-fontsubst.xcd` aparte, y editar `main.xcd` con `org.openoffice.VCL/FontSubstitutions/en/<fuente>/SubstFonts`) y **ninguna cambió la fuente elegida**, ni siquiera poniendo `carlito` como sustituto de Verdana. Leyendo el código (`vcl/source/font/PhysicalFontCollection.cxx`, `FindFontFamily`): cuando el nombre no está instalado, LibreOffice llama primero al gancho `FcPreMatchSubstitution`, que pregunta a fontconfig, y la tabla de `VCL.xcu` se consulta después; fontconfig devuelve Noto Serif. Por eso el lugar es `fc_local.conf`. (`conf.d/` y `fonts.conf` del paquete no parecen influir: Verdana ya figura como sans-serif en `45-latin.conf` y aun así cae en Noto Serif. **[NO CONFIRMADO]** por qué no se leen.)

Fuente embebida en el PDF de cada docx de `corpus-fuentes` (`harness\fonts-corpus.mjs`):

| Fuente pedida | Zeta | `rec-A` | `rec-B` | `rec-C0` (sin alias) | `rec-C` |
|---|---|---|---|---|---|
| Cambria Math | DejaVu Math TeX Gyre | igual | Noto Serif | DejaVu Math TeX Gyre | **DejaVu Math TeX Gyre** |
| Symbol | OpenSymbol | OpenSymbol | Noto Serif | OpenSymbol | **OpenSymbol** |
| Verdana, Tahoma, Segoe UI, Aptos, Calibri Light, Trebuchet MS, Century Gothic, Comic Sans MS, Impact, Lucida Console | Noto Sans | Noto Serif | Noto Serif | Noto Serif | **Noto Sans** |
| Consolas | DejaVu Sans Mono | Noto Serif | Noto Serif | Noto Serif | **DejaVu Sans Mono** |
| Arial, Arial Narrow, Calibri, Cambria, Times New Roman, Courier New, Georgia, Garamond, Palatino Linotype | igual en todas | | | | sin cambios |
| Book Antiqua, Wingdings | Noto Sans | Noto Serif | Noto Serif | Noto Serif | **Noto Serif** (no se tocaron: no estaban en la lista pedida) |

`rec-C` no coincide con Zeta en Book Antiqua y Wingdings; se arregla agregándolas a `SANS` en `rec-c.mjs` (no medido; para Wingdings, Noto Sans no tiene sentido como símbolo).

**Los 9 sintéticos, `rec-B` contra `rec-C`** (`results\bordes\cmp-sint-recB-vs-recC.json`): 0 palabras y 0 caracteres de diferencia en los 9; 0,000 % de píxeles distintos en 8; `fuentes.docx` cambia 3,2 % porque ahora usa Noto Sans y DejaVu Sans Mono en vez de Noto Serif (el texto no cambia). `soffice.data`: 36 170 604 B contra 35 588 353 B de `rec-B` (+582 251 B). **[NO CONFIRMADO]** el tiempo de arranque de `rec-C` (no se midió).

Todo lo que sigue se corrió con `rec-C` (salvo la comparación de símbolos, que usa también `rec-B`).

## 1. Texto girado y vertical

Corpus: `corpus-bordes\giro\` (36 archivos armados a mano en XML con `harness\bordes\gen-giro.cjs`; texto único `Texto girado de prueba número 4827 áéíóú ñ`, 35 caracteres sin espacios). «Chars» = caracteres esperados recuperados con `pdfjs` (multiconjunto) sobre 35. «Se ve» = hay tinta bajo la caja de cada fragmento extraído, más la mirada a los PNG.

| Caso | Zeta: chars / se ve | Nuestro: chars / se ve |
|---|---|---|
| Word, celda `btLr`, `tbRl`, `tbRlV` (sin combinar, 3 archivos) | 35/35, sí | 35/35, sí |
| Word, las mismas con combinación vertical (3 archivos) | 35/35, sí | 35/35, sí |
| Word, cuadro de texto girado 90°, 180°, 270°, 45° | 35/35, sí | 35/35, sí |
| Word, cuadro con `vert`, `vert270`, `eaVert` | 35/35, sí | 35/35, sí |
| Word, WordArt DrawingML (`prstTxWarp`) | 0/35, **no se ve** | 0/35, **no se ve** |
| Word, WordArt VML (`textpath`) | 0/35, **se ve** (curvas, gris) | 0/35, **se ve** |
| Excel, rotación 90°, -90°, 45°, -45° (sin y con celdas combinadas, 8 archivos) | 35/35, sí | 35/35, sí |
| Excel, apilada (255), sin combinar | 31/35 (corte por la altura de fila), sí | 31/35, igual |
| Excel, apilada (255), combinada | 16/35, parcial | 16/35, igual |
| PowerPoint, cuadro girado 90°, 180°, 270°, 45° | 35/35, sí | 35/35, sí |
| PowerPoint, `vert`, `vert270` | 35/35, sí | 35/35, sí |
| PowerPoint, `wordArtVert` | 35/35 (**lo dibuja horizontal**) | **13/35**: lo dibuja apilado, una letra por línea, y se corta en el borde del cuadro |
| PowerPoint, celda de tabla `vert`, `vert270`, `wordArtVert` | 35/35, sí | 35/35, sí |
| PowerPoint, WordArt (`prstTxWarp`) | 0/35, **se ve** | 0/35, **se ve** |

- **WordArt: en ninguno de los dos el texto sale extraíble** (se dibuja como curvas). El WordArt DrawingML de Word (`g-w-wordart-wps`) salió en blanco en los dos: **[NO CONFIRMADO]** si es un defecto de mi XML (armé el caso sin el `mc:Fallback` que escribe Word) o del importador. Una app que detecta datos por texto no vería nada de un WordArt ni de una marca de agua (mismo mecanismo; ver sección 2).
- **`wordArtVert` de PowerPoint** es el único caso sintético donde el nuestro pierde texto respecto de Zeta, y en rigor Zeta lo ignora (dibuja horizontal) mientras que el nuestro respeta la orientación y recorta lo que no entra. PNG: `results\bordes\png\giro-casos.png` (fila 2, mosaico izquierdo).
- **No se reprodujo el defecto de `w060`** (celda `btLr` combinada verticalmente): los 6 casos de celda sintéticos salen completos. En el archivo original (`sw/qa/extras/layout/data/tdf127118.docx`, ahora `w0264`) el nuestro sigue dejando la celda en blanco y Zeta pone el texto (PNG `results\bordes\png\w0264.png`). **[NO CONFIRMADO]** qué dispara el defecto en el original (tiene más estructura: estilos de tabla, alto de fila fijo).
- Datos: `results\bordes\giro.json`; texto extraído en `results\bordes\txt\giro\`.

## 2. Lugares donde un dato se esconde

Corpus: `corpus-bordes\lugares\` (32 archivos, 162 marcadores únicos con la forma `DATO-W-TEXTBOX-01`, generados con `gen-lugares-w.cjs` y `gen-lugares-xp.cjs`). Criterios (`harness\bordes\analizar.mjs`):
- **texto** = el marcador completo está en el texto que extrae `pdfjs`;
- **tinta** = en la caja de ese texto, a 100 ppp, hay píxeles que difieren del fondo (si no, «texto SIN tinta»: está en el PDF pero no se ve);
- **no** = no está en el texto (puede estar dibujado: ver notas); **fragmentado** = parte de las letras sueltas;
- **anotación** / **metadatos** = aparece en las anotaciones del PDF (destino de enlaces, notas) o en el diccionario de información o el XMP.

Hay 9 marcadores donde los dos conversores difieren; todos los demás dan lo mismo.

### Lo que importa, resumido

| Clase | Lugares |
|---|---|
| **Llega al PDF, como texto y visible, igual en los dos** | cuadros de texto (anclado, flotante, VML); encabezados y pies de primera página, pares e impares; notas al pie y al final; TOC (texto en caché) y su título; controles de contenido (texto, lista seleccionada, fecha, marcador relleno, bloque); formas y grupos; columnas; secciones apaisadas (la pág. 2 sale 842x595); capital (la «D» sale aparte: `D` y `ATO-W-...`); cambios controlados (eliminado e insertado, los dos se dibujan); texto de 1 pt; celda ancla de una combinación; celdas angostas; varias hojas; encabezado y pie de Excel; gráficos de Excel (título, serie, categorías, ejes, valores); tablas y grupos de PowerPoint; gráfico de PowerPoint; patrón, diseño, pie y diapositiva |
| **Se recalcula y cambia el valor** | fecha (`DATE`), `REF`, `PAGE`, `NUMPAGES` y el número de diapositiva: se muestra el valor real (fecha de hoy, 1) y no el de la caché del archivo, igual en los dos. Fórmulas de Excel: ver la tabla de fórmulas |
| **Está en el PDF pero no se ve** | texto blanco sobre blanco (`DATO-W-BLANCO-01`: texto sí, tinta no, en los dos) |
| **No llega, igual en los dos** (decisión del filtro o del formato) | texto oculto (`vanish`); hoja oculta y muy oculta; fila y columna ocultas; fuera del área de impresión; texto de una celda no ancla de una combinación; elemento no seleccionado de una lista desplegable; alias y etiqueta de un control; ayuda de un marcador de posición vacío del diseño; diapositiva oculta; forma oculta de PowerPoint; notas del orador; nombre de la hoja; nombre definido; texto alternativo de una forma; cuadro fuera de la hoja |
| **Llega por otro canal** | **propiedades del documento** (título, autor, asunto, palabras clave): están en los metadatos del PDF en los dos conversores. **URL de enlaces** (`https://.../DATO-...-URL-01`, `mailto:`): están en las anotaciones del PDF en los dos. **Comentarios y tooltips: solo el nuestro** los escribe como anotaciones (el texto del comentario de Word y su autor, el tooltip de un enlace de Word, la nota de una celda de Excel); en Zeta no están. **[NO CONFIRMADO]** si es la versión o `UseTaggedPDF=false` |
| **Visible pero no extraíble** | marca de agua (VML `textpath`: se ve en la hoja, no está en el texto); WordArt |
| **Cortado por el origen** | texto con ajuste en fila corta, o desborde contra una celda ocupada: el texto cortado no está en el PDF (ni como texto ni dibujado) |

Notas puntuales:
- **Objeto OLE de Excel** en Word: el PDF muestra el contenido de la hoja incrustada **dibujado por LibreOffice con el libro real** (`DATO-W-O…` cortado por el ancho de celda, y `777`) y **no** la imagen de vista previa del archivo (`DATO-W-OLE-IMAGEN-01`, que traía texto dibujado). Los dos conversores igual. El dato de la celda llega al PDF, recortado.
- **Ecuaciones OMML**: ambos traen el texto de la ecuación en texto normal; en cursiva matemática Zeta separa las letras con espacios y el marcador no se reconoce, el nuestro sí.
- **Fórmulas** (`l-x-formulas-excel` y `l-x-formulas-sinapp`, con el valor en caché distinto del real a propósito; los dos conversores dan exactamente lo mismo):

| Celda | En caché | Valor real | Con `app.xml` = Microsoft Excel | Sin `app.xml` |
|---|---|---|---|---|
| `D1 = B1+C1` (1234 + 4321) | 98765 | 5555 | **98765** (caché) | **98765** (caché) |
| `B2 = "DATO-X-FORMULA-"&"TEXTO-01"` | `...CACHE-01` | `...TEXTO-01` | **caché** | **recalcula** |
| `B3 = _xlfn.FUNCIONINEXISTENTE(1)` | `...DESCONOCIDA-01` | (no existe) | **caché** | **`#NAME?`** |
| `C4 = B4*1000` | 77777 | 6000 | **caché** | **caché** |
| `B5 = MiValor+1` | 55555 | 11 | caché | caché |
| `B6 = Datos!A1` (texto de otra hoja) | `...OTRAHOJA-CACHE-01` | `...REAL-01` | **caché** | **recalcula** |

  Es decir: **los números en caché no se recalculan** (ni sin `app.xml`); **los resultados de texto se recalculan solo cuando el archivo no declara Excel como generador**, y una función desconocida pasa de mostrar la caché a `#NAME?`. Zeta y el nuestro se comportan igual. **[NO CONFIRMADO]** el caso de datos de origen que cambian (no se probó).
- **Gráfico de PowerPoint**: las etiquetas de dato salen con separador de miles (`7.319`); el marcador numérico `7319` figura como «no» en la tabla por eso, y el dato está.
- Comentarios de Excel impresos al final (`cellComments="atEnd"`): ninguno de los dos los dibuja en la hoja.

### Tablas por lugar (marcador por marcador)

**`l-w-cuadros`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-TEXTBOX-01` | cuadro de texto anclado | texto + tinta | texto + tinta |
| `DATO-W-TEXTBOX-02` | cuadro de texto flotante (pagina, detras del texto) | texto + tinta | texto + tinta |
| `DATO-W-TEXTBOX-03` | cuadro de texto VML (legado) | texto + tinta | texto + tinta |

**`l-w-encabezados`** - paginas Zeta/nuestro: 3/3

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-ENC-PRIMERA-01` | encabezado de primera pagina (pag. 1) | texto + tinta | texto + tinta |
| `DATO-W-ENC-PAR-01` | encabezado de paginas pares (pag. 2) | texto + tinta | texto + tinta |
| `DATO-W-ENC-IMPAR-01` | encabezado de paginas impares (pag. 3) | texto + tinta | texto + tinta |
| `DATO-W-PIE-PRIMERA-01` | pie de primera pagina | texto + tinta | texto + tinta |
| `DATO-W-PIE-PAR-01` | pie de paginas pares | texto + tinta | texto + tinta |
| `DATO-W-PIE-IMPAR-01` | pie de paginas impares | texto + tinta | texto + tinta |

**`l-w-notas`** - paginas Zeta/nuestro: 2/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-NOTA-PIE-01` | nota al pie | texto + tinta | texto + tinta |
| `DATO-W-NOTA-FINAL-01` | nota al final | texto + tinta | texto + tinta |

**`l-w-campos`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-CAMPO-FECHA-01` | campo DATE (valor en cache) | no | no |
| `DATO-W-CAMPO-REF-ORIGEN-01` | texto marcado con marcador (origen de REF) | texto + tinta + anotacion | texto + tinta |
| `DATO-W-CAMPO-REF-CACHE-01` | campo REF (valor en cache distinto del origen) | no | no |
| `DATO-W-CAMPO-TOC-CACHE-01` | TOC (texto en cache) | texto + tinta | texto + tinta |
| `DATO-W-CAMPO-TOC-TITULO-01` | titulo que alimenta el TOC | texto + tinta | texto + tinta |
| `DATO-W-CAMPO-PAGINA-77` | campo PAGE con cache 77 (se espera 1) | fragmentado | fragmentado |
| `DATO-W-CAMPO-NUMPAGINAS-88` | campo NUMPAGES con cache 88 (se espera 1) | fragmentado | fragmentado |

**`l-w-ecuaciones`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-OMML-CONTROL-01` | texto normal de control | texto + tinta | texto + tinta |
| `DATO-W-OMML-LINEA-01` | ecuacion OMML en linea (texto normal) | texto + tinta | texto + tinta |
| `DATO-W-OMML-NUM-01` | ecuacion OMML, numerador de fraccion | texto + tinta | texto + tinta |
| `DATO-W-OMML-DEN-01` | ecuacion OMML, denominador | texto + tinta | texto + tinta |
| `DATO-W-OMML-CURSIVA-01` | ecuacion OMML con texto matematico (cursiva) | no | texto + tinta |

**`l-w-sdt`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-SDT-TEXTO-01` | control de contenido de texto | texto + tinta | texto + tinta |
| `DATO-W-SDT-ITEM-SEL-01` | lista desplegable: elemento seleccionado | texto + tinta | texto + tinta |
| `DATO-W-SDT-ITEM-NOSEL-01` | lista desplegable: elemento no seleccionado (solo en sdtPr) | no | no |
| `DATO-W-SDT-FECHA-01` | selector de fecha | texto + tinta | texto + tinta |
| `DATO-W-SDT-MARCADOR-01` | marcador de posicion (placeholder) | texto + tinta | texto + tinta |
| `DATO-W-SDT-BLOQUE-01` | control a nivel de bloque | texto + tinta | texto + tinta |
| `DATO-W-SDT-ALIAS-01` | alias del control (solo metadato) | no | no |
| `DATO-W-SDT-TAG-01` | etiqueta del control (solo metadato) | no | no |

**`l-w-formas`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-FORMA-ELIPSE-01` | texto dentro de una forma (elipse DrawingML) | texto + tinta | texto + tinta |
| `DATO-W-FORMA-GRUPO-01` | forma agrupada (1) | texto + tinta | texto + tinta |
| `DATO-W-FORMA-GRUPO-02` | forma agrupada (2) | texto + tinta | texto + tinta |
| `DATO-W-FORMA-VML-01` | forma VML con texto | texto + tinta | texto + tinta |

**`l-w-ole`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-OLE-CELDA-01` | celda del Excel incrustado (solo dentro del objeto) | no | no |
| `DATO-W-OLE-IMAGEN-01` | texto de la imagen de vista previa del objeto | no | no |

**`l-w-columnas`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-COLUMNA-1-01` | columna 1 | texto + tinta | texto + tinta |
| `DATO-W-COLUMNA-2-01` | columna 2 | texto + tinta | texto + tinta |

**`l-w-apaisada`** (la pagina 2 debe ser apaisada (842x595)) - paginas Zeta/nuestro: 2/2

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-SECCION-VERTICAL-01` | seccion vertical (pag. 1) | texto + tinta | texto + tinta |
| `DATO-W-SECCION-APAISADA-01` | seccion apaisada (pag. 2) | texto + tinta | texto + tinta |

**`l-w-marca-agua`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-MARCA-01` | marca de agua (texto VML en el encabezado) | no | no |

**`l-w-capital`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-CAPITAL-01` | letra capital ("D" suelta + resto de la palabra) | fragmentado | fragmentado |

**`l-w-enlaces`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-ENLACE-TEXTO-01` | texto visible del hipervinculo | texto + tinta + anotacion | texto + tinta |
| `DATO-W-ENLACE-URL-01` | destino (URL) del hipervinculo | no + anotacion | no + anotacion |
| `DATO-W-ENLACE-MAIL-01` | destino mailto del hipervinculo | no + anotacion | no + anotacion |
| `DATO-W-ENLACE-TIP-01` | descripcion emergente (tooltip) del hipervinculo | no | no + anotacion |
| `DATO-W-ENLACE-DESTINO-01` | texto de destino de un enlace interno | texto + tinta | texto + tinta |

**`l-w-otros`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-W-COMENTARIO-01` | comentario de revision | no | no + anotacion |
| `DATO-W-COMENTARIO-AUTOR-01` | autor del comentario | no | no + anotacion |
| `DATO-W-CAMBIO-ELIMINADO-01` | cambio controlado: texto eliminado | texto + tinta | texto + tinta |
| `DATO-W-CAMBIO-INSERTADO-01` | cambio controlado: texto insertado | texto + tinta | texto + tinta |
| `DATO-W-OCULTO-01` | texto con atributo oculto (vanish) | no | no |
| `DATO-W-BLANCO-01` | texto en blanco sobre fondo blanco | texto SIN tinta | texto SIN tinta |
| `DATO-W-MINUSCULO-01` | texto de 1 pt | texto + tinta | texto + tinta |
| `DATO-W-FUERA-PAGINA-01` | cuadro de texto fuera del area de la hoja | no | no |
| `DATO-W-ALTTEXTO-01` | texto alternativo de una forma (solo metadato) | no | no |
| `DATO-W-PROP-TITULO-01` | propiedad del documento: titulo | no + metadatos | no + metadatos |
| `DATO-W-PROP-AUTOR-01` | propiedad del documento: autor | no + metadatos | no + metadatos |
| `DATO-W-PROP-ASUNTO-01` | propiedad del documento: asunto | no + metadatos | no + metadatos |
| `DATO-W-PROP-CLAVES-01` | propiedad del documento: palabras clave | no + metadatos | no + metadatos |

**`l-x-formulas-excel`** (app.xml dice Microsoft Excel) - paginas Zeta/nuestro: 3/3

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `98765` | F1 valor en cache (1234+4321 real=5555) | texto + tinta | texto + tinta |
| `5555` | F1 valor recalculado | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-CACHE-01` | F2 texto en cache | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-TEXTO-01` | F2 texto recalculado | no | no |
| `DATO-X-FORMULA-DESCONOCIDA-01` | F3 cache de funcion desconocida | texto + tinta | texto + tinta |
| `77777` | F4 cache (6*1000 real=6000) | texto + tinta | texto + tinta |
| `6000` | F4 recalculado | no | no |
| `55555` | F5 cache (MiValor=10, real=11) | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-OTRAHOJA-CACHE-01` | F6 cache referencia a otra hoja | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-OTRAHOJA-REAL-01` | F6 valor real de la otra hoja | texto + tinta | texto + tinta |

**`l-x-formulas-sinapp`** (sin app.xml) - paginas Zeta/nuestro: 3/3

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `98765` | F1 valor en cache (1234+4321 real=5555) | texto + tinta | texto + tinta |
| `5555` | F1 valor recalculado | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-CACHE-01` | F2 texto en cache | no | no |
| `DATO-X-FORMULA-TEXTO-01` | F2 texto recalculado | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-DESCONOCIDA-01` | F3 cache de funcion desconocida | no | no |
| `77777` | F4 cache (6*1000 real=6000) | texto + tinta | texto + tinta |
| `6000` | F4 recalculado | no | no |
| `55555` | F5 cache (MiValor=10, real=11) | texto + tinta | texto + tinta |
| `DATO-X-FORMULA-OTRAHOJA-CACHE-01` | F6 cache referencia a otra hoja | no | no |
| `DATO-X-FORMULA-OTRAHOJA-REAL-01` | F6 valor real de la otra hoja | texto + tinta | texto + tinta |

**`l-x-combinadas`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-COMBINADA-01` | celda combinada horizontal (ancla) | texto + tinta | texto + tinta |
| `DATO-X-COMBINADA-OCULTA-01` | texto en una celda no ancla de una combinacion | no | no |
| `DATO-X-COMBINADA-V-01` | celda combinada vertical (ancla) | texto + tinta | texto + tinta |
| `DATO-X-COMBINADA-V-OCULTA-01` | texto en celda no ancla de combinacion vertical | no | no |

**`l-x-ajuste`** - paginas Zeta/nuestro: 2/2

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-AJUSTE-VISIBLE-01` | texto con ajuste, fila alta | texto + tinta | texto + tinta |
| `DATO-X-AJUSTE-RECORTADO-01` | texto con ajuste al final, fila de altura fija corta (recortado) | no | no |
| `DATO-X-DESBORDE-LIBRE-01` | texto largo que desborda a una celda vecina vacia | texto + tinta | texto + tinta |
| `DATO-X-DESBORDE-CORTADO-01` | texto largo al final, vecina ocupada (cortado por la celda) | no | no |
| `DATO-X-ANGOSTA-01` | numero/texto en columna muy angosta | texto + tinta | texto + tinta |

**`l-x-ocultos`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-VISIBLE-01` | celda visible de control | texto + tinta | texto + tinta |
| `DATO-X-FILA-OCULTA-01` | fila oculta | no | no |
| `DATO-X-COLUMNA-OCULTA-01` | columna oculta | no | no |
| `DATO-X-HOJA-OCULTA-01` | hoja oculta (hidden) | no | no |
| `DATO-X-HOJA-MUYOCULTA-01` | hoja muy oculta (veryHidden) | no | no |

**`l-x-impresion`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-AREA-DENTRO-01` | celda dentro del area de impresion | texto + tinta | texto + tinta |
| `DATO-X-AREA-FUERA-01` | celda fuera del area de impresion | no | no |

**`l-x-escalado`** (una sola pagina esperada) - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-ESCALADO-01` | celda lejana, hoja escalada a una pagina (esquina inferior izquierda) | texto + tinta | texto + tinta |
| `DATO-X-ESCALADO-02` | celda lejana (esquina inferior derecha) | texto + tinta | texto + tinta |

**`l-x-hojas`** - paginas Zeta/nuestro: 3/3

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-HOJA1-01` | hoja 1 | texto + tinta | texto + tinta |
| `DATO-X-HOJA2-01` | hoja 2 | texto + tinta | texto + tinta |
| `DATO-X-HOJA3-01` | hoja 3 | texto + tinta | texto + tinta |
| `DATO-X-NOMBRE-HOJA-01` | nombre de la hoja 3 (pestana, no se imprime) | no | no |

**`l-x-encabezado`** (dos paginas) - paginas Zeta/nuestro: 2/2

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-ENC-PRIMERA-01` | encabezado de la primera pagina | texto + tinta | texto + tinta |
| `DATO-X-PIE-PRIMERA-01` | pie de la primera pagina | texto + tinta | texto + tinta |
| `DATO-X-ENC-IZQ-01` | encabezado, zona izquierda (pag. 2) | texto + tinta | texto + tinta |
| `DATO-X-ENC-CENTRO-01` | encabezado, zona central (pag. 2) | texto + tinta | texto + tinta |
| `DATO-X-PIE-01` | pie (pag. 2) | texto + tinta | texto + tinta |

**`l-x-grafico`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-GRAFICO-TITULO-01` | titulo del grafico | texto + tinta | texto + tinta |
| `DATO-X-GRAFICO-SERIE-01` | nombre de la serie (leyenda) | texto + tinta | texto + tinta |
| `DATO-X-GRAFICO-CAT-01` | etiqueta de categoria 1 | texto + tinta | texto + tinta |
| `DATO-X-GRAFICO-CAT-03` | etiqueta de categoria 3 | texto + tinta | texto + tinta |
| `DATO-X-GRAFICO-EJEX-01` | titulo del eje X | texto + tinta | texto + tinta |
| `DATO-X-GRAFICO-EJEY-01` | titulo del eje Y | texto + tinta | texto + tinta |
| `7319` | etiqueta de dato (valor 1) | texto + tinta | texto + tinta |
| `6406` | etiqueta de dato (valor 3) | texto + tinta | texto + tinta |

**`l-x-comentarios`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-COMENTARIO-01` | nota (comentario) de una celda | no | no + anotacion |
| `DATO-X-COMENTARIO-AUTOR-01` | autor de la nota | no | no |

**`l-x-comentarios-impresos`** (pageSetup cellComments=atEnd) - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-COMENTARIO-01` | nota (comentario) de una celda | no | no + anotacion |
| `DATO-X-COMENTARIO-AUTOR-01` | autor de la nota | no | no |

**`l-x-otros`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-X-ENLACE-TEXTO-01` | texto de una celda con hipervinculo | texto + tinta + anotacion | texto + tinta |
| `DATO-X-ENLACE-URL-01` | destino del hipervinculo | no + anotacion | no + anotacion |
| `DATO-X-ENLACE-TIP-01` | tooltip del hipervinculo | no | no |
| `DATO-X-NUMFMT-01 4821` | texto literal dentro de un formato numerico | texto + tinta | texto + tinta |
| `DATO-X-PROP-TITULO-01` | propiedad: titulo | no + metadatos | no + metadatos |
| `DATO-X-PROP-AUTOR-01` | propiedad: autor | no + metadatos | no + metadatos |
| `DATO-X-NOMBRE-DEFINIDO-01` | nombre definido (solo metadato) | no | no |

**`l-p-patron`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-P-PATRON-01` | texto del patron (slide master) | texto + tinta | texto + tinta |
| `DATO-P-DISENO-01` | texto del diseno (layout) | texto + tinta | texto + tinta |
| `DATO-P-MARCADOR-LAYOUT-01` | texto de ayuda de un marcador de posicion vacio (solo en el diseno) | no | no |
| `DATO-P-DIAPOSITIVA-01` | cuadro de texto de la diapositiva | texto + tinta | texto + tinta |
| `DATO-P-MARCADOR-RELLENO-01` | marcador de posicion relleno | texto + tinta | texto + tinta |
| `DATO-P-PIE-01` | pie de pagina de la diapositiva | texto + tinta | texto + tinta |
| `DATO-P-NUMERO-77` | campo de numero de diapositiva con cache 77 (se espera 1) | no | no |

**`l-p-agrupadas`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-P-GRUPO-01` | forma dentro de un grupo | texto + tinta | texto + tinta |
| `DATO-P-GRUPO-ANIDADO-01` | forma dentro de un grupo anidado | texto + tinta | texto + tinta |

**`l-p-tabla`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-P-TABLA-A1` | celda de tabla A1 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-COMB-01` | celda de tabla COMB-01 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-A2` | celda de tabla A2 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-B2` | celda de tabla B2 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-C2` | celda de tabla C2 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-VERT-01` | celda de tabla VERT-01 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-B3` | celda de tabla B3 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-C3` | celda de tabla C3 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-B4` | celda de tabla B4 | texto + tinta | texto + tinta |
| `DATO-P-TABLA-C4` | celda de tabla C4 | texto + tinta | texto + tinta |

**`l-p-grafico`** - paginas Zeta/nuestro: 1/1

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-P-GRAFICO-TITULO-01` | titulo del grafico | texto + tinta | texto + tinta |
| `DATO-P-GRAFICO-SERIE-01` | nombre de la serie (leyenda) | texto + tinta | texto + tinta |
| `DATO-P-GRAFICO-CAT-01` | etiqueta de categoria 1 | texto + tinta | texto + tinta |
| `DATO-P-GRAFICO-CAT-03` | etiqueta de categoria 3 | texto + tinta | texto + tinta |
| `DATO-P-GRAFICO-EJEX-01` | titulo del eje X | texto + tinta | texto + tinta |
| `DATO-P-GRAFICO-EJEY-01` | titulo del eje Y | texto + tinta | texto + tinta |
| `7319` | etiqueta de dato (valor 1) | no | no |
| `6406` | etiqueta de dato (valor 3) | no | no |

**`l-p-oculta`** - paginas Zeta/nuestro: 2/2

| Marcador | Lugar | ZetaOffice | Nuestro (rec-C) |
|---|---|---|---|
| `DATO-P-VISIBLE-01` | diapositiva 1 visible | texto + tinta | texto + tinta |
| `DATO-P-OCULTA-01` | diapositiva oculta (show=0) | no | no |
| `DATO-P-VISIBLE-02` | diapositiva 3 visible | texto + tinta | texto + tinta |
| `DATO-P-NOTAS-01` | notas del orador de la diapositiva 1 | no | no |
| `DATO-P-FORMA-OCULTA-01` | forma marcada como oculta | no | no |
| `DATO-P-ALTTEXTO-01` | texto alternativo de una forma (solo metadato) | no | no |
| `DATO-P-PROP-TITULO-01` | propiedad: titulo | no + metadatos | no + metadatos |
| `DATO-P-PROP-AUTOR-01` | propiedad: autor | no + metadatos | no + metadatos |

## 3. El corpus de prueba de LibreOffice entero

**Corpus:** todos los `.docx` de `sw/qa/**/data/`, los `.xlsx` de `sc/qa/**/data/` y los `.pptx` de `sd/qa/**/data/` del árbol `libreoffice-26.8.3.1`: **2 104 docx, 382 xlsx y 427 pptx = 2 913 archivos** (el informe anterior decía 383 xlsx; el recuento real es 382), 2 866 contenidos distintos, 81 MB en total. Identificadores neutros `w0001`, `x0001`, `p0001`… con su ruta en `corpus-lo-full\MAP.tsv`. **Ningún archivo pasa de 5 MB: el mayor mide 2,0 MB** (`chart2/qa/extras/data/docx/testchartoleobjectembeddings.docx`, fuera de las rutas pedidas) y el mayor de los pedidos 1,1 MB, así que el tope de 5 MB de la muestra anterior no dejó fuera nada de este corpus. **No se achicó nada: la pasada completa tardó 19 min (Zeta) y 13 min (nuestro).** Método: `batch-run.mjs` y `compare.mjs`, igual que en `CALIDAD.md`. Datos: `results\bordes\raw-full\`, `cmp-full-zeta-vs-recC.json`.

### Estados

| | docx (2 104) | xlsx (382) | pptx (427) | Total (2 913) |
|---|---|---|---|---|
| Convierten los dos | 2 083 | 376 | 424 | 2 883 |
| Solo Zeta | 1 | 1 | 0 | 2 |
| Solo el nuestro | 7 | 2 | 1 | 10 |
| Ninguno | 13 | 3 | 2 | 18 |

Totales por conversor: ZetaOffice 2 885 ok, 22 fallas y 6 timeouts; nuestro 2 893 ok, 20 fallas y 0 timeouts. Reinicios del conversor: Zeta 12, nuestro 4. Intentos de red y violaciones de CSP: 0 en las dos pasadas.

- **Solo Zeta convierte (2):** `sw/qa/core/data/ooxml/fail/EDB-36788-1.docx` (`w0002`) y `sc/qa/unit/data/xlsx/pass/CVE-2017-0199-1.xlsx` (`x0115`); en el nuestro, `loadComponentFromURL devolvió null`.
- **Solo el nuestro convierte (10):**
  - 6 timeouts de Zeta (60 s): `sw/qa/extras/layout/data/tdf170381-split-float-table-in-float-table.docx`, `tdf170620.docx`, `tdf170630.docx`, `sw/qa/writerfilter/ooxml/data/floattable-multi-nested.docx`, `sc/qa/unit/data/xlsx/forum-mso-en4-134670.xlsx` y `sc/qa/unit/data/xlsx/tdf170298.xlsx`; el nuestro los convierte (el mayor tiempo del nuestro en todo el corpus es `forum-mso-en4-134670`, 3 471 ms);
  - 2 crashes de Zeta (`memory access out of bounds`): `sw/qa/extras/ooxmlexport/data/tdf166436.docx` y `sd/qa/unit/data/pptx/pass/tdf173266.pptx` (este último ya figuraba en `CALIDAD.md`);
  - 1 `RangeError: Maximum call stack size exceeded` de Zeta: `sw/qa/extras/ooxmlexport/data/tdf38575_fullWidthLine.docx`;
  - 1 falla de carga de Zeta: `sw/qa/writerfilter/dmapper/data/if-field.docx`.
- **Fallan en los dos (18):** 4 docx cifrados (`Encrypted_*_abc.docx`, `Unsupported URL`: sin NSS), 11 archivos corruptos a propósito (`ooxml/fail/`, `ofz*`, `broken_package`, `math-malformed_xml`…) y `sc/qa/unit/data/xlsx/tdf76115.xlsx`, `tdf131575.xlsx`, `forcepoint107.xlsx`. Lista en el crudo (`status` distinto de `ok`).
- **Picos de tiempo.** Zeta: `w0002` 9 690 ms, `w0302` 5 488 ms (`tdf152298.docx`), `x0115` 3 739 ms, y 6 timeouts de 60 000 ms. Nuestro: `x0092` 3 471 ms, `w1886` 2 191 ms (`embeddedPPTX.docx`), `p0009` 2 012 ms. Mediana por archivo 61 ms (Zeta) y 68 ms (nuestro); p90 227 y 274 ms; máximo (sin timeouts) 9 690 y 3 471 ms. Tamaño total de los PDF: 63,6 MB (Zeta) y 67,2 MB (nuestro, sin etiquetas); mediana de PDF nuestro/Zeta 1,34.

### Distribuciones de diferencia (2 883 archivos que convierten los dos)

| | docx (2 083) | xlsx (376) | pptx (424) | Todos |
|---|---|---|---|---|
| Páginas distintas | 42 | 4 | 0 | 46 (29 con más páginas en Zeta, 17 en el nuestro) |
| Con alguna página de otro tamaño | 3 (`w1288`, `w1820`, `w2012`) | 0 | 0 | 3 |
| Texto idéntico por palabras | 1 927 | 320 | 406 | 2 653 |
| Texto idéntico por caracteres | 1 955 | 322 | 413 | 2 690 |
| Archivos donde el nuestro pierde palabras que Zeta tiene | 123 | 38 | 15 | 176 |
| Archivos donde Zeta pierde palabras que el nuestro tiene | 143 | 45 | 15 | 203 |
| Diferencia de texto, % de palabras (mediana / p90 / p99 / máx.) | 0 / 0 / 100 / 100 | 0 / 2,29 / 100 / 100 | 0 / 0 / 100 / 100 | 0 / 0 / 100 / 100 |
| Palabras solo en Zeta (mediana / p90 / p99 / máx.) | 0 / 0 / 14 / 7 157 | 0 / 1 / 48 / 4 061 | 0 / 0 / 3 / 14 | 0 / 0 / 14 / 7 157 |
| Palabras solo en el nuestro (mediana / p90 / p99 / máx.) | 0 / 0 / 16 / 1 422 | 0 / 1 / 144 / 876 | 0 / 0 / 10 / 35 | 0 / 0 / 18 / 1 422 |
| Píxeles distintos, % media de páginas (mediana / p90 / p99 / máx.) | 0,01 / 1,42 / 11,67 / 100 | 0 / 0,53 / 3,67 / 9,96 | 0,01 / 0,99 / 15,07 / 53,66 | 0,01 / 1,13 / 11,65 / 100 |
| Píxeles distintos, % de la peor página (mediana / p90 / p99 / máx.) | 0,01 / 1,79 / 14,96 / 100 | 0 / 0,6 / 5,64 / 18,22 | 0,01 / 1,07 / 15,89 / 53,66 | 0,01 / 1,37 / 14,74 / 100 |

Los 10 peores por píxeles (media de páginas): `w2012` 100 % (`sw/qa/writerfilter/dmapper/data/alt-chunk-header.docx`, página de otro tamaño), `w0709` 96,8 % (`sw/qa/extras/ooxmlexport/data/fill.docx`), `p0414` 53,7 % (`sd/qa/unit/data/pptx/tdfpictureplaceholder.pptx`), `w1288` 50,6 % (`tdf141231_arabicHebrewNumbering.docx`), `w1142` 39,3 % (`tdf126533_pageBitmap.docx`), `w1820` 31,5 % (`tdf136952_pgBreak3.docx`), `w1445` 31,1 % (`tdf163894_hidden.docx`), `p0261` 30,2 % (`tdf128596.pptx`), `w1443` 29,8 % (`tdf163894.docx`), `p0191` 27,8 % (`tdf104015.pptx`). **[NO CONFIRMADO]** la causa de los que no son de texto (`w0709`, `p0414`, `w1142`, `p0261`, `p0191`): no se miró su PNG.

### Texto perdido: método de clasificación

`harness\bordes\perdidas.mjs`, `chars-perdidos.mjs` y `clasificar.mjs`. Para cada archivo con diferencia se calcula, además de las palabras (que dependen de cómo se corta el renglón y la puntuación), la diferencia **neta de caracteres** (caracteres que Zeta tiene y el nuestro no, menos al revés). «Pierde» significa neta > 0. Clases: **FORMATO** (solo puntuación, cifras, numeración, fechas o símbolos); **NO ESTÁ EN EL ORIGEN** (las palabras no están en el texto de los XML del archivo: etiquetas que el conversor genera, como `#NAME?`/`Err:508` o encabezados de tabla dinámica); **PÁGINAS DISTINTAS** (cambia el reparto de páginas); **CONTENIDO REAL**, **DISTINTO**, **ZETA SE APARTA** (mirados en PNG); **REVISAR** (palabras latinas que están en el origen y tiene un solo lado; **no se miraron una por una**). La columna «verificación» de las listas dice `png` si se miró el PNG, `png-parcial` si solo la página 1, `inferido` si se dedujo de un caso gemelo y `auto` si es solo la regla. Listas completas con ruta, caracteres netos y ejemplos de palabras: `results\bordes\perdidas-nuestro.tsv` (66 filas) y `results\bordes\perdidas-zeta.tsv` (103 filas). PNG lado a lado (Zeta a la izquierda, nuestro a la derecha, pág. 1) de los casos de contenido: `results\bordes\png\<id>.png`.

### El nuestro pierde (66 archivos con pérdida neta)

| Clase | Archivos |
|---|---|
| FORMATO | 22 (numeración `[2.] 2.`, guiones `−`, fechas de campo, puntos de guía, cifras con separadores, viñetas) |
| NO ESTÁ EN EL ORIGEN | 18 (casi todos xlsx: `#NAME?` en Zeta contra `Err:5xx` en el nuestro, y la etiqueta `Data` de tablas dinámicas que solo dibuja Zeta) |
| PÁGINAS DISTINTAS | 4: `w1445` y `w1443` (`tdf163894*`, Zeta repite contenido: 17 y 11 páginas contra 4; ya estaba en `CALIDAD.md`), `w1383` (7/5), `w0185` (3/2) |
| ZETA SE APARTA | 5: `w0853`, `w0884`, `w0923` (Zeta antepone o duplica la inicial de un control de contenido: «TAndroid», «CCOMPANY»), `w0889` (Zeta imprime el base64 de una imagen enlazada a datos), `w1255` (2 páginas contra 1) |
| REVISAR | 9: `w1444`, `x0317`, `w1508`, `x0297`, `x0058`, `x0380`, `x0144`, `x0255`, `w0169` |
| DISTINTO | 3: `w0083` (pie par/impar, y la página 1 se numera 2), `w1598` (campos de pie), `p0382` (en la pág. 1 el nuestro dibuja un gráfico que Zeta no) |
| NO CONFIRMADO | 1: `p0147` (SmartArt, Zeta extrae `a b c`) |
| **CONTENIDO REAL** | **4** |

**Contenido real que el nuestro pierde y Zeta tiene (lista completa):**

| Id | Ruta relativa en el árbol de LibreOffice | Qué falta |
|---|---|---|
| `w0264` | `sw/qa/extras/layout/data/tdf127118.docx` | celda con texto girado (`btLr`) combinada verticalmente (es el `w060` del informe anterior): 43 caracteres |
| `w1126` | `sw/qa/extras/ooxmlexport/data/tdf125038_conditionalText_DOCPROPERTY.docx` | texto condicional con campo `DOCPROPERTY`: falta «The contents of File Info Properties TestProperty» (43 caracteres) |
| `w1838` | `sw/qa/extras/ooxmlimport/data/tdf169173.docx` | control de contenido (lista desplegable): falta «Choose an item.» y la casilla (13 caracteres) |
| `p0081` | `sd/qa/unit/data/pptx/forum-mso-de-138303.pptx` | gráfico de cascada: Zeta lo dibuja; el nuestro escribe «One or more chart types are unsupported in this version of LibreOffice» y deja etiquetas de eje ilegibles. Es el **único** PDF de los 2 893 con ese aviso (en Zeta, ninguno) |

Los 9 «REVISAR» del nuestro, con su ruta, para quien quiera mirarlos: `sw/qa/extras/ooxmlexport/data/tdf163894_from_top.docx` (`w1444`), `sc/qa/unit/data/xlsx/tdf171828_fail_to_import_file.xlsx` (`x0317`), `sw/qa/extras/ooxmlexport/data/tdf32363.docx` (`w1508`, mismo texto en la pág. 1 de ambos, falta en otra), `sc/qa/unit/data/xlsx/tdf163554.xlsx` (`x0297`), `sc/qa/unit/data/xlsx/column-style-autofilter.xlsx` (`x0058`, puntuación pegada), `sc/qa/unit/uicalc/data/tdf152037.xlsx` (`x0380`), `sc/qa/unit/data/xlsx/pivot-table/shared-group-field.xlsx` (`x0144`), `sc/qa/unit/data/xlsx/tdf137091.xlsx` (`x0255`), `sw/qa/core/text/data/floattable-anchor-height.docx` (`w0169`, un solo carácter). **[NO CONFIRMADO]** que sean pérdidas de contenido o diferencias de formato.

**Sobre escrituras no latinas.** Con el recorte sin fuentes no latinas se esperaba más pérdida de texto en árabe, hebreo, etíope o CJK. **No aparece como pérdida neta**: en `w1341`, `w1870`, `w0347`, `w0477`, `w1286`, `w1901` los dos conversores extraen cantidades parecidas de caracteres de esas escrituras, con otra segmentación. La única de ese tipo con pérdida neta es `w1852` (`tdf87533_bidi.docx`, 30 caracteres de diacríticos árabes y signos, árabe con puntuación) y `w1051` (`tdf119143.docx`, diacríticos árabes). **[NO CONFIRMADO]** que el recorte de fuentes sea la causa de esos dos. (Chino, japonés y tailandés ya salían vacíos en los tres builds por `CALIDAD.md`.)

### Zeta pierde (103 archivos con pérdida neta del lado de Zeta)

| Clase | Archivos |
|---|---|
| FORMATO | 36 |
| REVISAR | 37 (palabras que están en el origen y solo el nuestro tiene; no se miraron una por una) |
| PÁGINAS DISTINTAS | 16 |
| NO ESTÁ EN EL ORIGEN | 7 |
| ESCRITURA NO LATINA | 3 |
| **CONTENIDO REAL (verificado en PNG)** | **4** |

**Contenido real que Zeta pierde y el nuestro tiene (verificados):**

| Id | Ruta relativa | Qué falta en Zeta |
|---|---|---|
| `w1519` | `sw/qa/extras/ooxmlexport/data/tdf57589_hashColor.docx` | la tabla de contenido y el encabezado (la página queda casi vacía) |
| `w1516` | `sw/qa/extras/ooxmlexport/data/tdf46940_dontEquallyDistributeColumns.docx` | el texto de las columnas |
| `w1518` | `sw/qa/extras/ooxmlexport/data/tdf53856_conflictingStyle.docx` | el párrafo de texto |
| `w1520` | `sw/qa/extras/ooxmlexport/data/tdf58944-repeating-table-header.docx` | el texto de la tabla (encabezado `Name`/`Address` y celdas `Test1`) |

Los otros 37 «REVISAR» de Zeta están en `perdidas-zeta.tsv`; por el patrón de los cuatro verificados (todos son archivos de prueba de exportación OOXML de LibreOffice con estructura inusual) probablemente haya más pérdidas reales de Zeta, **[NO CONFIRMADO]**.

### Archivos grandes (más de 5 MB)

**No hay archivos de más de 5 MB en el corpus de LibreOffice** (ver arriba). Se generaron tres sintéticos con datos aleatorios (`corpus-bordes\grandes\`, `harness\bordes\gen-grandes.cjs`) y se convirtieron una vez cada uno por conversor, con el tiempo de la conversión (sin contar el arranque) y el pico de RAM de todos los procesos Electron muestreado cada 250 ms (`peak-mem.ps1`; **incluye el arranque y la ventana, es el pico total de la prueba**, no el incremento por archivo). Una sola corrida por celda: **no hay repetición**.

| Archivo | Tamaño | Zeta: tiempo / pico WS / pico privado | Nuestro: tiempo / pico WS / pico privado | PDF Zeta / nuestro |
|---|---|---|---|---|
| `grande-xlsx-60k.xlsx` (60 000 filas x 20 columnas) | 10,8 MB | 21 839 ms / 1 143 / 1 862 MB | 22 844 ms / 1 094 / 1 824 MB | 13,8 MB / 13,9 MB |
| `grande-docx-600p-imagen.docx` (imagen de ruido de 5,9 MB y 600 párrafos largos) | 6,0 MB | 2 065 ms / 1 226 / 2 006 MB | 2 165 ms / 1 165 / 1 981 MB | 1,9 MB / 1,7 MB |
| `grande-pptx-120.pptx` (6 imágenes de ruido, 120 diapositivas) | 7,8 MB | 1 522 ms / 1 167 / 1 911 MB | 1 673 ms / 1 132 / 1 912 MB | 2,1 MB / 2,1 MB |

Los dos conversores convierten los tres sin error; tiempos parecidos, y el nuestro con un pico de RAM de 3 a 5 % menor (dentro del ruido de una sola corrida). El docx tiene 600 párrafos con salto de página en la mitad de ellos: no se contó su cantidad de páginas. **[NO CONFIRMADO]** el comportamiento con archivos reales grandes (los de ruido no se parecen a un escaneo de verdad).

## 4. Orden de lectura y símbolos

Corpus: `corpus-bordes\orden\` (`orden-bidi.docx`, `orden-symbol.docx`, generados con `gen-orden.cjs`; texto inventado). Resultado en `results\bordes\orden-informe.txt` (script `orden-informe.mjs`) y `orden.json`.

### Árabe y hebreo

10 frases (4 árabes, 4 hebreas, 2 en párrafo de izquierda a derecha con un tramo incrustado), mezcladas con números, fechas, un correo y palabras latinas. `pdfjs` entrega los tramos RTL ya en orden lógico. Se compara la línea extraída con la cadena original, por caracteres (LCS) y por palabras:

| Frase | Idéntica a la original | Caracteres en orden (LCS) | Qué cambia |
|---|---|---|---|
| ar4, he4 (solo RTL) | **sí** | 12/12 y 8/8 | nada |
| ar1, ar2, he1, he2, he3, mx1, mx2 | no | todos los caracteres, en el mismo orden relativo | **faltan los espacios** entre un tramo RTL y un número o una palabra latina: `رقم48215اشترى3منتجات`, `ACMEفي`, `maria@ejemplo.testقبل`; en `mx1` pasa en los dos sentidos |
| ar3 | no | 44/45 | además de los espacios, **la ligadura lam-alef se extrae al revés**: `دوالر` por `دولار` |

- **El orden lógico se respeta**: ningún tramo sale invertido ni mezclado (un tramo RTL completo sale en orden de lectura, y las cifras y palabras latinas en su lugar). Lo que se pierde son los espacios entre tramos de distinto sentido (PDF: LibreOffice no escribe un espacio entre las ejecuciones), por lo que **una detección de datos por palabras vería `48215اشترى3منتجات` como una sola palabra**. Con `pdfjs` la comparación por palabras da 2 a 5 de 9 a 12.
- **Zeta, `rec-B` y `rec-C` dan exactamente la misma salida** (las 10 frases iguales entre sí). Es decir, quitar las fuentes árabes y hebreas no cambia el texto (las escrituras caen en DejaVu Sans, que se conservó).
- Una línea (`mx2`) se ve recortada en la comparación de renglones porque el texto sigue en el renglón siguiente (no es pérdida).

### Fuente `Symbol`

`orden-symbol.docx`: 18 símbolos de Symbol (letras griegas, viñeta, relaciones, flecha, raíz) en cuatro formas (A: `w:sym` con código `F0xx`; B: letras latinas `a b g d D S W p m` con la fuente Symbol; C: caracteres `U+F0xx` en `w:t`; D: Unicode correcto, de control) más 5 de Wingdings y una lista con viñetas `Symbol`/`Courier New`/`Wingdings`. Unicode que sale en el texto extraído:

| Forma | Esperado | `rec-B` | `rec-C` | Zeta |
|---|---|---|---|---|
| A: `w:sym` (`F061`…`F0E5`) | `α β γ δ Δ Σ Ω π μ • ≤ ≥ ± ∞ ≠ → √ ∑` | `U+F061 U+F062 …` (el código privado de Symbol, **no** el griego) | igual | igual |
| B: letras `a b g d…` con fuente Symbol | (el texto del archivo es latino) | `a b g d D S W p m` | igual | igual |
| C: `U+F0xx` en `w:t` | `α β γ…` | **`U+F061` 18 veces (corrupto)** | `U+F061 U+F062 …` (el código privado) | igual a `rec-C` |
| D: Unicode correcto (control) | | correcto | correcto | correcto |
| Wingdings (`w:sym`) | `✓ → ● ▪ ➢` | `U+F0FC U+F0E0 U+F06C U+F0A7 U+F0D8` | igual | igual |
| Viñeta de lista `Symbol` (nivel 1) | `•` | `U+F0B7` | `U+F0B7` | `U+F0B7` |
| Viñeta nivel 2 (`o`, Courier New) | `o` | `o` | `o` | `o` |
| Viñeta nivel 3 (Wingdings) | `▪` | `U+F0A7` | igual | igual |

- **Con `rec-C` el texto de Symbol sale igual que con ZetaOffice**: Unicode de la zona privada (`U+F0xx`), no el carácter griego o matemático correspondiente. Una app que lo normalice tiene que mapear `U+F0xx` de Symbol y Wingdings a su Unicode real; no lo hace el conversor.
- **Con `rec-B` hay una regresión extra** en el caso C: los 18 caracteres salen todos como `U+F061` (Symbol caía en Noto Serif). Con `rec-C` (que vuelve a `OpenSymbol` por `fc_local.conf`) queda como en Zeta.
- Las letras latinas en fuente Symbol (caso B) no se convierten a griego: el PDF dibuja la letra griega pero el texto dice `a b g`. Mismo comportamiento que Zeta.

## Qué quedó sin medir

- **Documentos reales**: no hay. Todo es sintético o de los archivos de prueba de LibreOffice.
- **[NO CONFIRMADO]** el tiempo de arranque y la memoria de `rec-C` (no se midió: solo conversiones).
- **[NO CONFIRMADO]** por qué `conf.d/` y `fonts.conf` del paquete no influyen en la elección de fuente.
- **[NO CONFIRMADO]** Book Antiqua y Wingdings contra Zeta (no estaban en la lista).
- **[NO CONFIRMADO]** el WordArt DrawingML de Word (`g-w-wordart-wps`, en blanco en los dos): puede ser un defecto de mi XML.
- **[NO CONFIRMADO]** qué dispara en `tdf127118.docx` la pérdida de la celda girada que no se reproduce con el caso sintético.
- **[NO CONFIRMADO]** por qué solo el nuestro escribe comentarios y tooltips como anotaciones (versión o `UseTaggedPDF=false`); no se corrió el nuestro con etiquetas en este informe.
- **[NO CONFIRMADO]** la causa de los píxeles de `w0709`, `p0414`, `w1142`, `p0261`, `p0191`.
- **[NO CONFIRMADO]** 9 archivos «REVISAR» del nuestro y 37 de Zeta; y que `w0923` y `p0147` sean lo que dice la clase (inferidos de un caso gemelo).
- **[NO CONFIRMADO]** archivos reales de más de 5 MB (no hay en el corpus; los sintéticos grandes son una corrida por celda).
- **[NO CONFIRMADO]** el recálculo de fórmulas cuando los datos de origen cambian; el recálculo con otras funciones (`NOW()`, volátiles).
- Las pasadas de este informe corrieron mientras se generaba el corpus de las secciones 1, 2 y 4 (trabajo liviano de escritura de archivos); los tiempos por archivo de la pasada completa podrían tener algo de ruido.

## Archivos

- Informe: `C:\Anonly\spikes\lowa\results\BORDES.md`.
- Corpus nuevos: `corpus-bordes\giro\`, `lugares\`, `orden\`, `grandes\` (con los `manifest*.json`); `corpus-lo-full\` (2 913 archivos copiados y `MAP.tsv`).
- Artefactos: `artefactos\rec-C\` y `rec-C0\`.
- Datos: `results\bordes\` (`giro.json`, `lugares.json`, `orden.json`, `orden-informe.txt`, `cmp-full-zeta-vs-recC.json`, `perdidas.json`, `chars-perdidos.json`, `clasificacion.json`, `perdidas-nuestro.tsv`, `perdidas-zeta.tsv`, `raw-full\`, `raw-b\`, `raw-g\`, `raw\` (fuentes), `mem-*.txt`, `txt\`).
- PNG: `results\bordes\png\` (lado a lado de los casos de contenido, mosaicos `m1`-`m4`, `giro-casos`, `lugares-w1`, `lugares-w2`).
- Código nuevo: `harness\rec-c.mjs`, `fonts-corpus.mjs`, `dataextract.mjs`, `run-bordes-full.sh`, y `harness\bordes\` (`lib.cjs`, `gen-giro.cjs`, `gen-lugares-w.cjs`, `gen-lugares-xp.cjs`, `gen-orden.cjs`, `gen-grandes.cjs`, `png-texto.js`, `analizar.mjs`, `perdidas.mjs`, `chars-perdidos.mjs`, `clasificar.mjs`, `orden-informe.mjs`, `md-lugares.mjs`, `montaje.mjs`, `peak-mem.ps1`).
