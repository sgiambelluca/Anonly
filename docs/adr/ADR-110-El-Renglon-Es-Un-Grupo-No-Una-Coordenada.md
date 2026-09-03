<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/OCR_Engine.md,architecture/03_Data_Model.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,roadmap/Post_Hito10.8_Pendientes.md | audiencia=humanos+IA | fase=11 -->

# ADR-110 — El renglón es un grupo, no una coordenada

- **Estado**: Accepted
- **Fecha**: 2026-08-30
- **Decidido por**: El humano, tras probar el producto sobre un fallo **escaneado** y pedir explícitamente que se **midiera si el cambio era mejora o regresión antes de implementarlo**.
- **Relacionado con**: **ADR-067** (que resolvió esta misma clase de defecto para los runs rotados; su §3 no se toca), **ADR-109 §3 (superseded)**, ADR-064 (las palabras de OCR llegan en puntos), ADR-041/ADR-065 (`fuseOcrPage`/`fuseOcrRegion`, que consumen este orden)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. En un escaneo, la caja del nombre cae sobre el escudo

Sobre un fallo del Tribunal de Casación Penal —escaneado, sin capa de texto, procesado por OCR— el encabezado sale mal: el `[HOMBRE 14]` que reemplaza al imputado se pinta sobre el escudo y el `PROVINCIA DE…` de la **columna izquierda**, cuando el nombre está en la **derecha**. El `[DIRECCION 01]` a veces tapa `PROVINCIA DE BUENOS AIRES`, a veces la mitad, y a veces también `TRIBUNAL DE CASACIÓN PENAL`. El cuerpo del documento, a simple vista, sale bien.

### 2. No es la geometría del bbox ni la conversión px→pt

Medido contra la tinta del render, las cajas que devuelve Tesseract convertidas a puntos (ADR-064) coinciden al **sub-punto**:

| palabra | caja OCR (x) | tinta real |
|---|---|---|
| `PROVINCIA` | 158,9 | 158,83 |
| `BUENOS` | 250,3 | 250,17 |
| `APELLIDO,` | 366,5 | 366,50 |
| `NOMBRE` | 404,4 | 404,33 |
| `RECURSO` | 493,2 | 493,17 |

La posición que el OCR guarda está bien. Lo que está mal es **en qué orden se ensartan esas palabras**: `Page.text` es la concatenación de `Page.words` ya ordenadas, y `mapSpanToWords` traduce un rango de caracteres de ese texto a un rango de **índices de palabra**. Si el orden intercala palabras de zonas distintas, un span contiguo en el texto mapea a palabras que están lejos entre sí, y la envolvente cubre las dos zonas.

### 3. Y el orden está mal en una de cada tres palabras — también en el cuerpo

Tesseract devuelve sus palabras dentro de una estructura `bloque → párrafo → línea`, y **dentro de una línea vienen en orden de lectura**. Eso es lo más cercano a una verdad que hay sin anotar a mano, y sirve de referencia: qué fracción de sus pares consecutivos sobrevive como par consecutivo, en el mismo sentido, en el orden que produce el motor.

| página del escaneo | pares preservados hoy |
|---|---|
| 1 | 195/289 (**67,5 %**) |
| 2 | 171/290 (59,0 %) |
| 3 | 156/326 (**47,9 %**) |
| 5 | 151/266 (56,8 %) |

El cuerpo —que "se veía bien"— está igual de roto, y **no se ve** porque cada caja individual sí está bien puesta:

```
hoy:   integrada los por señores jueces doctores Juez Uno Juez y Dos 451 del (art. Procesal Código con la Penal), …
```

Ese es el texto que recibe NER. Explica por qué la detección sobre escaneos rinde peor en general, sin que nada se vea torcido en el PDF exportado.

### 4. Dos causas: columnas que se intercalan, y un comparador que no es transitivo

**(a)** El encabezado tiene dos columnas cuyos renglones **se solapan en vertical**:

| columna | palabras | `y` (pt) |
|---|---|---|
| izquierda | `PROVINCIA DE BUENOS AIRES` | 105,1 – 107,8 |
| derecha | `APELLIDO, NOMBRE SEGUNDO S/ RECURSO DE` | 104,9 – 118,6 |
| izquierda | `TRIBUNAL DE CASACIÓN PENAL` | 119,3 – 121,4 |

La línea de la derecha abarca a las dos de la izquierda. Ninguna clave escalar las separa, porque en `y` no están separadas.

**(b)** `compareByReadingOrder`/`compareByBaseline` comparan una coordenada **con tolerancia**, y eso no es una relación de orden: `a ≈ b` y `b ≈ c` no implica `a ≈ c`. Con un comparador no transitivo, `Array.sort` devuelve un resultado que depende de su secuencia interna de comparaciones. Es exactamente la trampa que **ADR-067 §4** documentó para los runs rotados. Medido sobre este encabezado, las tres claves candidatas rompen la misma línea de tres formas distintas:

```
bbox.y (borde superior)      PROVINCIA NOMBRE SEGUMDO DE BUENOS AIRES Y APELLIDO, RECURSO TRIBUNAL DE DE …
bbox.y + height (ADR-109 §3) PROVINCIA DE AIRES BUENOS Y RECURSO APELLIDO, DE TRIBUNAL DE NOMBRE SEGUMDO …
centro vertical              PROVINCIA DE AIRES BUENOS NOMBRE SEGUMDO Y APELLIDO, RECURSO DE TRIBUNAL DE …
```

Ninguna devuelve `PROVINCIA DE BUENOS AIRES`. **Cambiar la clave cambia qué palabras rompen; no arregla nada.** Por eso este ADR no elige otra clave: elimina la clave.

### 5. Y la geometría del OCR es ruidosa de entrada

Sobre el mismo renglón impreso, Tesseract devuelve alturas que difieren un 60 %:

| palabra | `y` | alto |
|---|---|---|
| `APELLIDO,` | 112,1 | 13,9 |
| `NOMBRE` | 104,9 | **22,1** |

Más ruido que entra como palabras (`ó`, `IRE`, `ENT`, `5`) y `SEGUNDO` leído `SEGUMDO`. Cualquier criterio que derive el ancho de la banda de **la altura del propio renglón** hereda ese ruido — es lo que hace fallar a las variantes de §2 de la Decisión.

## Decisión

### 1. El texto horizontal se agrupa en renglones; dentro de cada renglón se ordena por `x`

```
candidatos = horizontales, ordenados por CENTRO vertical y después por x   (orden total, sin tolerancia)

renglones = []
para cada w en candidatos:
    r = último(renglones)
    si r existe y |centro(w) − medianaCentro(r)| < LINE_BAND_RATIO × medianaAlto(r):
        r.push(w)
    si no:
        renglones.push([w])

emitir cada renglón ordenado por x, en orden de renglón
```

**La propiedad estructural es que desaparece el comparador con tolerancia.** El pre-orden por centro vertical es un orden **total** (sin tolerancia, por lo tanto transitivo), y el agrupado es un recorrido codicioso determinista. Ya no hay una función no transitiva entregada a `Array.sort`, que es la causa (b) de §4.

La mediana —y no el promedio ni la envolvente acumulada— es lo que impide que **una** caja de OCR ruidosa de 22 pt ensanche la banda de su renglón y se trague el renglón siguiente.

### 2. `LINE_BAND_RATIO = 0,5`, y el valor está barrido

Siete configuraciones medidas sobre la página 1 del escaneo, contra la referencia de §3:

| ancla de la banda | umbral | pares preservados | encabezado |
|---|---|---|---|
| **mediana del renglón** | **0,5** | **289/289 (100 %)** | **correcto** |
| mediana del renglón | 0,6 | 283/289 (97,9 %) | `PROVINCIA TRIBUNAL DE BUENOS AIRES` |
| mediana del renglón | 0,7 | 283/289 (97,9 %) | ídem |
| primera palabra | 0,4 | 271/289 (93,8 %) | correcto, pero el cuerpo pierde pares |
| primera palabra | 0,5 | 271/289 (93,8 %) | `PROVINCIA DE BUENOS AIRES TRIBUNAL DE APELLIDO,…` |
| mediana de la página | 0,5 | 275/289 (95,2 %) | `…APELLIDO, NOMBRE SEGUMDO Y TRIBUNAL…` |
| mediana de la página | 0,7 | 273/289 (94,5 %) | ídem |

**El parámetro no es indiferente y el óptimo no es el intuitivo**: anclar a la primera palabra arregla el encabezado y rompe el cuerpo; aflojar a 0,6 hace lo contrario. Solo `mediana del renglón / 0,5` reproduce el orden de Tesseract **exacto**.

### 3. NO se segmenta en columnas, porque no hace falta

El prototipo incluía un segundo paso —partir cada renglón en columnas por hueco horizontal— y **se descartó por medición**. Con el umbral de columna barrido de 0,8 a 4,0 cuerpos, y también **desactivado por completo**, los resultados son idénticos en las cuatro páginas medidas del escaneo y en los 10 documentos nativos:

| | escaneo p1 | p2 | p3 | p5 |
|---|---|---|---|---|
| con segmentación (cualquier umbral 0,8–4,0) | 289/289 | 287/290 | 316/326 | 266/266 |
| **sin segmentación** | **289/289** | **287/290** | **316/326** | **266/266** |

Con la banda en 0,5 las dos columnas caen en renglones **distintos**, así que el corte por hueco nunca se dispara. Agregar un mecanismo cuyo efecto medido es exactamente cero, con una constante más que justificar, es lo contrario de lo que este ADR viene haciendo.

**Riesgo que se acepta explícitamente**: si algún documento pusiera dos columnas dentro de una misma banda, sus palabras se intercalarían por `x`. Se vio ocurrir con la banda en 0,6, no con 0,5. Si aparece un documento así, la segmentación por hueco es la respuesta y este ADR deja el prototipo medido.

### 4. La rama rotada de ADR-067 no se toca

Los words con `rotation` 90/180/270 siguen agrupándose en runs, ordenándose en su dirección de avance y emitiéndose **en una pasada aparte después de todo el texto horizontal** (ADR-067 §2/§3/§4). Su comparador por ancla (`compareByReadingOrder`) se conserva tal cual.

Esto no es un detalle: el prototipo que **no** respetó esa rama movió 14 palabras en `qa-stamp.pdf` —las del sello rotado, con el cuerpo horizontal idéntico— y ese es exactamente el modo de falla que ADR-067 §4 documentó.

### 5. ADR-109 §3 queda superseded

ADR-109 §3 cambió la clave de orden de `bbox.y` a `bbox.y + bbox.height` porque, con la caja de tinta, el techo pasó a depender del ascenso de cada fuente (1,76 pt de diferencia en una misma línea, por encima de la tolerancia de 1 pt). Esa decisión **parchaba la clave de un mecanismo que este ADR reemplaza**: al agrupar por banda, una diferencia de 1,76 pt queda holgadamente dentro del renglón y la elección de clave deja de importar. `compareByBaseline` desaparece con el mecanismo.

Su errata sobre OCR (que el borde inferior era "más estable") ya estaba corregida; este ADR cierra el punto.

## Consecuencias

**Mejora, sobre el escaneo** — pares consecutivos preservados contra la referencia de §3:

| página | hoy | con el cambio | saltos hacia atrás |
|---|---|---|---|
| 1 | 195/289 (67,5 %) | **289/289 (100 %)** | 34 → 1 |
| 2 | 171/290 (59,0 %) | **287/290 (99,0 %)** | 34 → 1 |
| 3 | 156/326 (47,9 %) | **316/326 (96,9 %)** | 60 → 1 |
| 5 | 151/266 (56,8 %) | **266/266 (100 %)** | 43 → 0 |

El encabezado sale entero, que es el defecto reportado:

```
hoy:    PROVINCIA DE AIRES BUENOS Y RECURSO APELLIDO, DE TRIBUNAL DE NOMBRE SEGUMDO CASACIÓN PENAL …
nuevo:  PROVINCIA DE BUENOS AIRES · APELLIDO, NOMBRE SEGUMDO Y RECURSO DE · TRIBUNAL DE CASACIÓN PENAL · CASACIÓN · SALA I
```

**Regresión, sobre texto nativo: ninguna, y está medida antes de implementar.**

| corpus | páginas | palabras | texto idéntico |
|---|---|---|---|
| pericia 17653, pericia 29816, cuento, apelación, oficio, fallo, SCBA | 95 | 30.672 | **95/95** |
| fixtures del repo (`text-10p`, `qa-tables-justified`, `image-alpha-3p`) | 14 | 214 | **14/14** |

Byte a byte, tabla justificada incluida. Ningún snapshot se mueve.

**En contra**

- El agrupado es **codicioso y depende del orden de entrada**: dos renglones muy juntos podrían fusionarse según cuál se procese primero. El pre-orden por centro vertical lo hace determinista, pero no lo hace robusto — un documento con interlineado menor a 0,5 cuerpos fusionaría renglones. No apareció en 109 páginas.
- La referencia de §3 es **el recorrido de Tesseract**, o sea el análisis de layout del propio OCR. "100 %" significa *reproduce lo que Tesseract entendió*, no *es el orden de lectura absoluto*. Para el texto nativo no hay referencia equivalente, y ahí lo que se mide es la **no-regresión** (identidad byte a byte), que es la pregunta correcta para ese caso.
- La geometría de OCR ruidosa de §5 **no se arregla acá**. Este ADR ordena bien lo que el OCR entrega; si el OCR entrega `SEGUMDO` y cajas 60 % más altas, eso sigue igual.

**Lo que este ADR no toca**: `ocr-engine` (su orden interno en píxeles queda como está, ADR-064 §2), el camino de anotaciones y la detección propiamente dicha. `fuseOcrPage`/`fuseOcrRegion` **no cambian de código** —llaman a `sortWordsByReadingOrder` y no saben cómo ordena—, pero el orden que producen sí cambia: son el camino por el que la mejora llega a una página escaneada.

## Qué hay que cubrir con tests

- Dos columnas cuyos renglones se intercalan en vertical: cada frase sale contigua (§13 caso nuevo).
- Una caja 60 % más alta que sus vecinas de renglón **no** se traga el renglón siguiente — la mediana, no la envolvente.
- Texto nativo de una columna: el orden es **idéntico** al previo a este ADR, incluido el caso de dos cuerpos distintos en la misma línea.
- Los runs rotados de ADR-067 conservan su orden y su pasada aparte (`qa-stamp.pdf` no se mueve).
- Determinismo: la misma entrada da la misma salida, y el pre-orden no depende del orden en que lleguen las palabras.
