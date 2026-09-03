<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Contracts.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,adr/ADR-112-El-Sello-No-Es-Un-Parrafo.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-113 — El renglón se corta donde hay una columna

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, tras usar la herramienta sobre su expediente con ADR-112 aplicado y reportar una `Person` llamada **"ARTURO RECURSO DE SUAREZ"** con el apellido real sin tapar.
- **Relacionado con**: **ADR-110 §3**, que midió la segmentación por columnas como "efecto cero" y dejó escrito el riesgo que este ADR viene a cerrar; **ADR-112**, que es lo que hizo aparecer el caso; ADR-067 (la rama rotada, que no se toca); ADR-074 (`fragments` por línea, que consume estos renglones)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Una `Person` que se llama "ARTURO RECURSO DE SUAREZ"

ADR-110 agrupa el texto horizontal en renglones: pre-orden total por centro vertical y un acumulado codicioso donde un word entra al renglón vigente si `|centro − medianaCentro| < 0,5 × medianaAlto`. Sobre el sello del encabezado de un fallo escaneado, el renglón que arma es este:

```
centros = [104,16  104,40  104,64  105,00 | 108,72  108,96  109,32]
altos   = [  8,64    8,64    8,16    8,88 |   5,76    6,24    6,00]
texto   = PROVINCIA DE BUENOS AIRES        | ARTURO RECURSO DE
huecos  =      2,9     3,6     3,1  [113,5]    13,0    2,9
```

y el resto de esa misma línea impresa —`SUAREZ, BARTOLOME S/`— queda en un renglón aparte. El texto que recibe el detector dice `PROVINCIA DE BUENOS AIRES ARTURO RECURSO DE SUAREZ, BARTOLOME S/`, y de ahí sale una `Person` cuyo valor es **"ARTURO RECURSO DE SUAREZ"**, con el apellido real sin tapar.

### 2. La banda no puede separarlas, y la decisión la termina tomando el redondeo

El renglón arranca con la columna izquierda, cuya mediana de altos es 8,64 pt: la banda mide **4,32 pt**. La columna derecha está 4,08 pt más abajo y entra. La palabra siguiente está a 4,32 exactos contra una banda de 4,32 — o sea que **quién entra lo decide el error de coma flotante**. Eso explica por qué el defecto aparece en una página de 19 y no en las otras: no es una propiedad del documento, es un empate numérico.

Y no hay margen que ganar aflojando o apretando: **un escaneo tiene desviación**. Sobre el cuerpo de la página 1, el `y` de un mismo renglón impreso deriva ~6 pt a lo largo de 400 pt de ancho. La distancia entre las dos columnas del encabezado (4,3 pt) es del mismo orden que esa deriva, así que ninguna medida vertical las distingue.

**Dos formulaciones verticales, medidas y descartadas** sobre las 19 páginas del escaneo (pares consecutivos preservados contra el recorrido `bloque → párrafo → línea` de Tesseract, la referencia de ADR-110 §3):

| variante | pares, toda la página | pares, solo el cuerpo | sello entero |
|---|---|---|---|
| hoy | 96,9 % | 99,6 % | 16/19 |
| banda contra `min(medianaAlto, alto del candidato)` | 96,4 % | **99,1 %** | 17/19 |
| la caja del candidato dentro de la banda ≥ 60 % | 96,7 % | **99,3 %** | 17/19 |

Las dos arreglan el sello y **rompen el cuerpo**, y siempre por lo mismo: parten el renglón en palabras de caja chica. Los pares que rompen son `de conformidad **con** lo establecido`, `dictada **por** el Tribunal`, `advierte **que,** si bien`, y el guion de `MOLINA Hugo Adrián **-** JUEZ` (alto 1,0 pt). Una palabra sin ascendentes ni descendentes tiene una caja de tinta mucho más baja que la de sus vecinas, y cualquier criterio vertical más fino que la banda actual la expulsa de su propio renglón.

### 3. El hueco horizontal sí es inequívoco

En ese mismo renglón, los huecos entre palabras de una misma frase van de **2,4 a 13 pt** y el que separa las dos columnas es de **113,5 pt**, con renglones de ~8 pt de alto. La decisión queda a un orden de magnitud del umbral, no a centésimas.

Es exactamente lo que ADR-110 §3 dejó anotado al descartar la segmentación por columnas:

> **Riesgo que se acepta explícitamente**: si algún documento pusiera dos columnas dentro de una misma banda, sus palabras se intercalarían por `x`. Se vio ocurrir con la banda en 0,6, no con 0,5. Si aparece un documento así, la segmentación por hueco es la respuesta y este ADR deja el prototipo medido.

Apareció el documento. Y apareció **porque ADR-112 lee mejor**: con `PSM.SPARSE_TEXT` las cajas del sello son más ajustadas (6,0 pt contra los 8,6 de la columna de al lado), y esa diferencia de cuerpo es justo la que hace que la banda de una alcance a la otra.

### 4. Cortar por hueco no alcanza — hay que reunir lo que el acumulado partió

El prototipo de ADR-110 §3 solo cortaba. Medido, eso deja `PROVINCIA DE BUENOS AIRES` · `ARTURO RECURSO DE` · `SUAREZ, BARTOLOME` · `S/`: las columnas quedan separadas, pero la línea de la derecha sigue partida en tres, porque el acumulado ya la había repartido entre dos renglones antes de que hubiera nada que cortar.

Una primera versión de la reunión fusionaba los trozos que **se solapan en x**, y no arreglaba nada (16/19, idéntico a hoy): los dos trozos de la carátula **no se solapan, se tocan** — `SUAREZ, BARTOLOME` termina en 339,2 y `ARTURO` empieza en 343,2.

## Decisión

Después del acumulado por banda de ADR-110, que **no se toca**, dos pasadas más:

### 1. Cada renglón se corta donde hay un hueco de más de `COLUMN_GAP_RATIO = 3` cuerpos

El renglón se ordena por `x` y se parte donde la separación con la palabra anterior supera 3 × la mediana de altos del renglón.

**El umbral no es un filo de cuchillo**: barrido sobre las 19 páginas, de **2 a 10 cuerpos** el sello sale entero. 2 y 3 son la meseta con el mejor orden del cuerpo; se elige 3, el medio de esa meseta y el mismo orden de magnitud que el barrido 0,8–4,0 de ADR-110 §3.

### 2. Dos trozos PEGADOS que comparten banda vuelven a ser un renglón

Un trozo se fusiona con el primero ya emitido cuyo hueco horizontal sea menor a `COLUMN_GAP_RATIO` cuerpos **y** cuyo centro esté dentro de la banda de ADR-110, las dos cosas medidas contra el **menor** de los dos altos medianos. La fusión es contra el trozo más temprano en el orden vertical, así que el renglón unido se emite en esa posición.

**La adyacencia es lo que hace la diferencia**, no el solapamiento (§4 del Contexto).

### 3. La rama rotada de ADR-067 no se toca

Los runs con `rotation` 90/180/270 se siguen agrupando y emitiendo en su pasada aparte, después de todo el texto horizontal (ADR-067 §2/§3/§4).

## Consecuencias

**Mejora, y sin contrapartida** — escaneo de 19 páginas con texto, con ADR-112 aplicado:

| | hoy | con este ADR |
|---|---|---|
| pares consecutivos preservados vs. Tesseract | 5451/5625 (96,9 %) | **5473/5625 (97,3 %)** |
| ídem, **solo el cuerpo** | 5045/5066 (99,6 %) | **5054/5066 (99,8 %)** |
| páginas con `SUAREZ, BARTOLOME ARTURO S/ RECURSO DE` entero | 16/19 | **17/19** |

Las tres métricas suben a la vez, a diferencia de las dos variantes verticales de §2 del Contexto. Las 2 páginas que siguen fallando la última fila **no son de orden**: son misreads del OCR (`$/` en vez de `S/`).

**Regresión sobre texto nativo: ninguna.** 110 páginas / 30.959 palabras —7 expedientes reales más los cuatro fixtures del repo— con el texto horizontal **idéntico palabra por palabra**.

**En contra**

- **Una constante más que justificar.** Se mitiga con el barrido: el resultado es el mismo de 2 a 10 cuerpos, así que el valor exacto no es una perilla fina.
- **La fusión hace que un renglón se emita en la posición de su trozo más temprano**, no en la del que tiene la primera palabra en orden de lectura. Sobre el corpus medido no cambia nada, pero es una regla de posición que antes no existía.
- **Un documento con columnas de verdad** (un texto a dos columnas, no un sello) sigue sin estar en el corpus. Este ADR lo trata igual que a un sello: cada columna, su renglón. Es lo correcto para leerlo, pero no está medido sobre un caso así.
- El corte se aplica **a todo documento**, no solo a los escaneados. La no regresión sobre las 110 páginas nativas es lo que lo respalda.

**Lo que no toca**: ningún contrato público, `mapSpanToWords`, `fuseOcrPage`/`fuseOcrRegion` (que llaman a `sortWordsByReadingOrder` sin saber cómo ordena) ni la rama rotada.

## Qué hay que cubrir con tests

- Con la geometría real del sello, las dos columnas salen separadas y el nombre del imputado contiguo.
- El renglón que el acumulado partió en dos se vuelve a unir — y falla si la reunión se hace por solapamiento en vez de por adyacencia.
- Un renglón con un hueco grande entre dos palabras se sigue emitiendo de izquierda a derecha (la no regresión del corte).
- Los cuatro casos de ADR-110 (columnas intercaladas, la caja 60 % más alta, el texto nativo de una columna, el determinismo) siguen pasando sin cambios.
