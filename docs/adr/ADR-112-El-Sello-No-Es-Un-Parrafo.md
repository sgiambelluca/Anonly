<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Contracts.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-112 — El sello no es un párrafo

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, tras ver el nombre del imputado sin tapar en el encabezado de un fallo escaneado, y pedir que se midiera el ruido que el cambio agrega antes de adoptarlo.
- **Relacionado con**: ADR-090 (orientación de la página por OSD — **no** es lo mismo que esto, ver §4), ADR-064 (las palabras de OCR llegan en puntos), ADR-110 (el orden de lectura por renglones, que ordena bien lo que el OCR entrega pero no arregla lo que entrega mal), ADR-065 (OCR por región)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. El apellido del imputado se lee mal en 10 de 19 páginas

Sobre un fallo del Tribunal de Casación Penal —escaneado, sin capa de texto—, el sello del encabezado sale así del OCR:

```
p2   casera, BARTOLOME ARTURO / RECURSO DE     <- apellido perdido
p3   suarna, bArtoLomE ARTURO / RECURSO DE     <- nombre y apellido perdidos
p12  sez, BARTOLOME Uses / RECURSO DE
p15  suarez, BARtoLome ARTURO §1 RECURSO DE
```

Un valor mal leído no matchea ni el patrón ni el léxico, así que **no se detecta y no se tapa**, y no deja ningún rastro en el PDF exportado: el dato simplemente queda a la vista. Medido punta a punta con el pipeline entero, el apellido se detecta en **9 de 19** páginas y los nombres en **8 de 19**.

### 2. La causa: Tesseract fusiona dos renglones del sello en una sola línea

El sello tiene `IPP NNNN-NNNN-NN` impreso justo encima de `SUAREZ, BARTOLOME ARTURO S/ RECURSO DE`, con muy poco interlineado. Con `tessedit_pageseg_mode` en su default (`AUTO`), el análisis de layout de Tesseract mete los dos renglones en **una sola caja de línea** y el reconocedor devuelve basura para su mitad izquierda. El `IPP` desaparece por completo en **17 de 19** páginas.

Es la explicación de un dato que ADR-110 §5 reportó sin poder explicar: cajas con 60 % de diferencia de alto dentro de un mismo renglón impreso (`APELLIDO,` 13,9 pt contra `NOMBRE` 22,1 pt). **Son cajas de dos renglones.**

### 3. Ni el DPI ni el binarizado son la palanca — medido

Las dos hipótesis que el handoff de la campaña listaba primero se midieron y son falsas.

| palanca | ítems del sello recuperados (19 páginas × 6 ítems) |
|---|---|
| DPI 200 (el nativo del escaneo) | 59/114 |
| **DPI 300 (hoy)** | **57/114** |
| DPI 400 | 58/114 |
| binarizado Otsu global a 300 DPI | 57/114 — **idéntico** |

El raster embebido mide 1656 × 2339 px sobre una página de 595 × 842 pt: son **200 DPI reales**. De 300 para arriba no hay información nueva, solo interpolación. Y Tesseract ya binariza internamente, así que un Otsu propio no le agrega nada.

## Decisión

### 1. `tessedit_pageseg_mode = PSM.SPARSE_TEXT` (11), fijo

Se aplica una vez por instancia de worker, junto al `user_defined_dpi` de ADR-090 §2. **No** es una opción de `OcrConfig`: no es una preferencia del usuario sino el modo correcto para la familia de documento a la que apunta el producto —expedientes con sellos, membretes y carátulas alrededor de un cuerpo de prosa—, y agregar un campo de configuración sería pedirle al usuario que decida algo que se decide con una medición.

Medido sobre las 19 páginas con texto, contra la transcripción a mano del sello:

| ítem | default (AUTO) | PSM 4 (columna única) | **PSM 11 (texto disperso)** |
|---|---|---|---|
| nº de causa `NNNNNN` | 19/19 | 19/19 | 19/19 |
| `IPP NNNN-NNNN-NN` | 2/19 | 18/19 | **18/19** |
| apellido `SUAREZ,` | 9/19 | 19/19 | **19/19** |
| nombres `BARTOLOME ARTURO` | 8/19 | 18/19 | **18/19** |
| `S/` | 3/19 | 14/19 | **17/19** |
| `PROVINCIA DE BUENOS AIRES` | 16/19 | 5/19 | **18/19** |
| **total** | **57/114** | 93/114 | **109/114** |

**PSM 4 se descarta**: arregla la columna derecha del sello y rompe la izquierda (parte `PROVINCIA` en `PRO VIN CIA`), y encima su precisión sobre documentos comunes es peor que la de PSM 11 (§2 de Consecuencias).

### 2. El ruido que agrega está medido, y no llega a la superficie

Es la objeción obvia a un modo "disperso": encuentra texto donde no lo hay. Medido en el encabezado del escaneo, donde está el código de barras:

| encabezado, 19 páginas | default | PSM 11 |
|---|---|---|
| palabras leídas | 406 | 559 (+38 %) |
| ruido (fuera del vocabulario del sello) | 115 (28,3 %) | 166 (**29,7 %**) |
| **área de página cubierta por ruido** | 70.024 pt² (36,6 %) | **52.117 pt² (33,5 %)** |
| cuerpo: palabras con `confidence` < 0,50 | 14 | **11** |
| **entidades hechas SOLO de ruido** | **4** | **4** |

Tres lecturas, en orden de importancia:

- **Las entidades espurias no aumentan: 4 y 4.** Es lo único que llega al usuario. Una `Word` de ruido que ninguna `Occurrence` cubre no dibuja caja, no aparece en el árbol de entidades y no se exporta.
- La **proporción** de ruido casi no se mueve (28,3 % → 29,7 %) mientras el motor lee 38 % más palabras: lo que entra de más es sobre todo texto real que `AUTO` no estaba leyendo.
- El **área** que ocupa el ruido baja, porque PSM 11 parte el código de barras en muchas cajas chicas en vez de pocas grandes.

### 3. No se toca el resto del camino de OCR

`toWords`, la conversión px→pt de ADR-064, la orientación de ADR-090 y el orden de lectura de ADR-110 quedan exactamente como están. `OcrConfig` no cambia, así que `Contracts.md` tampoco.

## Consecuencias

**Sobre el fallo escaneado, punta a punta** (OCR real → orden del motor → regex + NER con el modelo real):

| 19 páginas con texto | hoy | con PSM 11 |
|---|---|---|
| apellido del imputado detectado en el sello | 9/19 | **19/19** |
| nombres detectados en el sello | 8/19 | **19/19** |
| `SUAREZ, BARTOLOME ARTURO` contiguo en el orden de lectura | 5/9 | **18/19** |

La última fila es el mecanismo: con los dos renglones separados, las tres palabras del nombre quedan en el mismo renglón y `mapSpanToWords` mapea el span a palabras vecinas en vez de a palabras de zonas distintas.

**Sobre documentos comunes — verdad sintética.** Siete PDFs nativos rasterizados a 300 DPI y pasados por OCR, comparados contra su propio texto nativo (35 páginas, 11.403 palabras). Un raster sintético es más limpio que un escaneo real, así que estos números sirven para **comparar configuraciones**, no para predecir precisión absoluta:

| PSM | recall | precisión | palabras sobrantes con `conf` < 60 |
|---|---|---|---|
| default | 96,29 % | 96,02 % | 104 |
| **11** | 96,26 % | **96,50 %** | **67** |
| 4 | 96,13 % | 96,20 % | 77 |

Sobre páginas normales PSM 11 **inventa 35 % menos** palabras espurias, con el mismo recall. La primera medición de esta campaña, que solo tenía recall sobre 3 páginas por documento, sugería un costo de −0,34 pp; con precisión y 5 páginas el costo real es **−0,03 pp**, dentro del ruido.

**Sobre texto rotado** (`tests/fixtures/qa-stamp.pdf` rasterizado, con sellos a 90° y 270°): recall 79,5 % → 75,3 %, precisión **56,9 % → 98,2 %** (44 palabras inventadas → 1). Las tres palabras que se pierden de más son `455.` y dos rayas.

**En contra**

- **+8 % de tiempo de OCR por página** (3.150 ms → 3.388 ms medidos sobre 19 páginas a 300 DPI). Aceptado explícitamente por el humano frente a la ganancia de detección.
- **Hay un solo escaneo real en el corpus.** Las 109/114 son de ese documento, y su sello es el caso que motivó el cambio — o sea, el número está sesgado a favor por construcción. Lo que **no** está sesgado es la medición sobre los 7 documentos nativos rasterizados, que es donde se comprueba que no hay regresión general.
- **Más palabras de ruido en un encabezado con código de barras.** Se acepta con el número de §2: no se traducen en más entidades.
- El modo es **fijo**. Si aparece un documento donde `AUTO` gana, no hay palanca para volver atrás sin tocar código. Se prefiere eso a un campo de config que nadie sabría cómo poner.

**Lo que este ADR NO resuelve, y conviene que quede escrito**: el **texto rotado dentro de una página derecha** (un sello a 90° en el margen) **no lo lee ninguno de los dos modos**. Medido sobre `qa-stamp.pdf`: las 12 palabras de los sellos a 90°/270° faltan igual con `AUTO` y con PSM 11. ADR-090 resuelve la orientación de la **página** —rota el raster entero antes de reconocer—, no la de un run adentro de ella, y rotar la página para enderezar el sello pondría de costado el cuerpo. Es un hueco de detección propio, sin ADR todavía.

## Qué hay que cubrir con tests

- El modo se aplica **una vez por instancia** de worker, junto al DPI, y se re-aplica cuando el worker se recrea por cambio de idiomas (ADR-045 §3).
- Un `setParameters` que rechaza **no voltea la página**: mismo criterio best-effort que `ensureDpiApplied` (ADR-090 §2).
- El valor que se pasa es `PSM.SPARSE_TEXT`, no un string suelto: si tesseract.js renumera el enum, el test no tiene que seguir pasando con el número viejo.
