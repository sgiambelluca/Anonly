<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Contracts.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md,adr/ADR-097-El-Avance-Real-De-Cada-Glifo-Reemplaza-Al-Promedio.md,adr/ADR-102-El-Flujo-De-Glifos-Es-Continuo-Por-Pagina.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-108 — El avance de un espacio incluye el word spacing

- **Estado**: Accepted
- **Fecha**: 2026-08-30
- **Decidido por**: El humano, tras pedir que se mirara a fondo cómo se calcula el bbox de cada palabra y observar sobre las imágenes de diagnóstico que **el error se acumula palabra por palabra dentro del renglón**.
- **Relacionado con**: **ADR-097 §4 (superseded)**, **ADR-068 (acotado a lo que midió)**, ADR-102 §2/§3 (el mecanismo de empalme, que no cambia), ADR-020 §1 (el prorrateo, que sigue siendo la reserva)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. El corrimiento no eran nueve items sueltos: era casi cada palabra

ADR-102 dejó el empalme de la pericia en 89,3 % y anotó que faltaba rehacer el gate visual. Rehecho, el defecto que aparece no es el que ese ADR describía. Medido contra la **tinta renderizada** —la página rasterizada a 8×, no otro cálculo— sobre el primer renglón del encabezado de la pericia:

| palabra | tinta real | flujo de glifos | error |
|---|---|---|---|
| Quienes | 152,50 | 153,42 | +0,9 |
| suscriben | 187,92 | 190,02 | +2,1 |
| Dr. | 228,00 | 231,77 | +3,8 |
| Ernesto | 242,83 | 247,89 | +5,1 |
| Anselmo | 279,25 | 285,65 | +6,4 |
| Cabral, | 315,25 | 322,82 | +7,6 |
| Jefe | 351,83 | 360,88 | +9,0 |

**~1,2 pt por espacio, acumulativo dentro del run y reseteado en el run siguiente.** Y no es del prorrateo: el renglón de abajo **empalma** —el camino bueno de ADR-102— y drifta idéntico (`Perito` +1,2 · `Psiquiatra` +2,4 · `Dra.` +6,4 · `Beltran,` +9,0).

Con lo cual la exposición real, contando palabras a las que les queda tinta **fuera** de su caja por más de 0,5 pt:

| documento | por izquierda | por derecha |
|---|---|---|
| pericia 17653 | **961/1560 (61,6 %)** | 261 (16,7 %) |
| pericia 29816 | **1579/2648 (59,6 %)** | 379 (14,3 %) |
| cuento (11 pp) | 688/6251 (11,0 %) | 1518 (24,3 %) |

No es un residuo del 10,7 % que ADR-102 dejó abierto. Es la mayoría del texto de los documentos afectados.

### 2. La causa: `Tw` no entra en el avance de los espacios

```ts
const step = ((width / 1000) * text.fontSize + text.charSpacing) * text.horizontalScale;
```

`appendRunGlyphs` (ADR-102 §1, aritmética heredada de ADR-097 §1) suma el ancho del glifo y el `charSpacing`, y **omite `wordSpacing`**. En estos documentos `Tw` es negativo: cada espacio avanza ~1,2 pt **menos** de lo que el flujo calcula. Como el flujo acumula posiciones glifo a glifo desde el origen del run, el error crece con cada espacio y se resetea cuando un `Tm`/`Td` fija una posición absoluta nueva.

La omisión es deliberada y está documentada: **ADR-097 §4** la fija ("`Tw` queda deliberadamente fuera de la tabla") apoyándose en **ADR-068**, que midió que la tinta cae en la posición **sin** aplicarlo.

### 3. ADR-068 midió bien; lo que no vale es la generalización

ADR-068 estudió un caso concreto: un run que **empieza** con espacios y `Tw ≠ 0`, donde `getTextContent()` reporta un origen 58,3 pt a la izquierda del glifo real. Su corrección —el par `from`/`to`— es correcta y se conserva.

Lo que no se sostiene es extender ese hallazgo a **todos** los espacios. Medido con las tres variantes sobre el mismo corpus, contando palabras con tinta afuera por izquierda:

| variante | pericia 17653 | pericia 29816 | cuento |
|---|---|---|---|
| hoy (`Tw` en ningún espacio) | 961 | 1579 | 688 |
| `Tw` solo en los espacios **interiores** del run | 168 | 206 | 0 |
| **`Tw` en todos los espacios** | **17** | **31** | **0** |

La variante que sería consistente con la lectura literal de ADR-068 —respetar los espacios iniciales— da **diez veces peor** que aplicarlo en todos. El dato manda: `Tw` entra en todos.

### 4. Los fallos de empalme eran consecuencia del corrimiento, no una causa aparte

Los cinco items "sin origen" de la pericia fallaban porque el flujo ya venía corrido y el origen que reporta `getTextContent` no coincidía con ningún glifo dentro de los 0,05 pt. Corregido `Tw`, sin tocar el buscador:

| documento | items sin origen (hoy → con `Tw`) |
|---|---|
| pericia 17653 | 5 → **0** |
| pericia 29816 | 3 → **0** |
| cuento | 7 → **0** |

Esto **descarta** una alternativa que se había considerado antes de encontrar la causa: ampliar la búsqueda del origen a los glifos vecinos de la misma línea de base y dejar que la alineación filtre. Probada, hacía "empalmar" esos items **sobre un flujo equivocado** — la caja de `Dr.` quedaba peor que con el prorrateo. Aflojar un guard para compensar un dato malo esconde el defecto en vez de arreglarlo; ADR-102 §3 ya lo había dicho para la tolerancia y vale igual acá.

### 5. Queda un segundo modo de falla, chico e independiente

Los items que "no alinean" cortan siempre en el mismo punto: el flujo trae un espacio que la cadena no trae.

```
p1 NO-ALINEA  corte en char 3 «j» vs flujo « »   str=«de julio»
p1 NO-ALINEA  corte en char 3 «2» vs flujo « »   str=«de 2026»
```

`alignToGlyphs` sabe saltear un espacio **de la cadena** que el flujo no tiene (ADR-102 §2: los que pdf.js sintetiza), pero no el caso simétrico. Son 4 items en la pericia y 3 en la pericia 29816.

## Decisión

### 1. `Tw` entra en el avance del espacio que lo lleva, y quién lo lleva lo dice `glyph.isSpace`

```ts
const step =
  ((width / 1000) * text.fontSize +
    text.charSpacing +
    (glyph.isSpace === true ? text.wordSpacing : 0)) *
  text.horizontalScale;
```

PDF 32000-1 §9.3.3 restringe el word spacing al código de **un byte** 32: en una fuente compuesta el espacio de dos bytes **no** lo lleva. pdf.js ya resuelve esa distinción y la deja en `glyph.isSpace`, y **su propio renderer decide con esa misma bandera**:

```js
const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;   // pdf.mjs
```

Espejarla no es una heurística: es la misma línea que dibuja la tinta contra la que se mide. Y no es un detalle de borde — medido sobre la pericia, el run de la fecha tiene **96 espacios y solo 7 con `isSpace`**; los 89 iniciales son compuestos.

En un documento con `Tw = 0` el término vale cero y **no cambia una sola coordenada** — es la propiedad que hace que el cambio sea seguro para todo el corpus que hoy está bien.

**ADR-097 §4 queda superseded.** Su §1 (la aritmética de avance por glifo), §3 (el prorrateo como reserva) y §5 (la instrumentación del empalme) siguen vigentes.

### 2. La alineación saltea espacios del flujo, simétrico a lo que ya hace

Cuando el carácter de la cadena no casa con el glifo del cursor, se saltean **del lado del flujo** los glifos de espacio hasta encontrarlo. Si aun así no casa, el cursor vuelve a donde estaba y rige la regla de siempre (espacio sintetizado o fallo). El salteo no imputa el avance del espacio a ningún token: un espacio no es parte de una palabra.

No debilita el guard. Todo carácter **visible** de la cadena sigue exigiendo su glifo exacto en orden; lo único que se vuelve tolerante es la cantidad de espacios, que es justamente donde las dos segmentaciones no coinciden.

### 3. Cómo se encontró la regla, y las tres formas equivocadas que se probaron antes

La primera versión de este ADR aplicaba `Tw` a todo glifo cuyo `unicode` fuera un espacio. Con eso, la línea `La Plata, 1 de julio de 2026` —centrada con 89 espacios— salía con su topónimo y su fecha **tapados 58,3 pt a la izquierda, sobre papel en blanco**, con el dato entero a la vista. Es peor que el defecto que §1 arregla: no es una fuga de un carácter, es una caja que no toca el dato. **Lo encontró el humano mirando el PDF exportado**; la métrica no lo veía (§5).

Dumpeado, el flujo de esa línea:

```
45:_@100.16+1.96  ... 90:_@188.24+1.96  91:L@190.20+6.38  92:a@196.58+4.64  93:_@201.22 ...
```

Los espacios avanzaban 1,96 (2,61 sin `Tw`), y `getTextContent` reportaba el origen del item en **190,20** — exactamente donde el flujo ponía la `L`. La tinta arranca en **248,50**. Ese número es el que **ADR-068 ya había medido** sobre este mismo documento.

Lo que faltaba era la pregunta correcta: no *dónde* está el espacio en el run, sino **qué espacio lleva `Tw`**. Contando la bandera de pdf.js:

| run | espacios | con `isSpace: true` |
|---|---|---|
| `La Plata, 1 de julio de 2026` | 96 | **7** |
| `Quienes suscriben Dr. Ernesto…` | 9 | 7 |

Las tres alternativas que se midieron antes de llegar a `isSpace`, todas sobre la pericia:

| variante | cajas **fuera de toda tinta** | fuga izq. > 0,5 pt | fuga der. |
|---|---|---|---|
| `Tw` en todo `unicode === " "` | **6** | 17 | 28 |
| `Tw` solo en los espacios **interiores** del run | 2 | 161 | 37 |
| lo anterior + búsqueda por el origen corregido | 2 | 146 | 9 |
| `Tw` en todos + desplazar el empalme por `to − from` | 2 | 54 | 9 |
| **`Tw` por `glyph.isSpace` (esta decisión)** | **2** | **7** | **7** |

Las dos del medio tratan "inicial" como propiedad de la **operación de dibujo**, y no lo es: un run que continúa un renglón empieza con un espacio que sí lleva `Tw`. La cuarta compensa el error en vez de corregirlo, y por eso deja slivers de ~1,2 pt en toda línea con sangría — visibles como el borde de la primera letra asomando del recuadro. Ninguna de las cuatro es la regla; `isSpace` sí.

Las 2 cajas que quedan fuera son los tokens `/` y `D` de una línea de guiones bajos (`S ____/____ D`), no un dato.

### 4. El origen del item se busca primero por el reportado y después por el corregido

`getTextContent` aplica `Tw` a **todo** espacio, así que en un run con espacios iniciales compuestos su origen no coincide con ningún glifo del flujo. Ese desacuerdo es exactamente el par que ADR-068 mide: `from` es lo que reporta el text layer y `to` lo que dibuja el renderer.

```
start = findGlyphAt(reportado)  ??  findGlyphAt(corregido)
```

Para que `to` caiga **sobre** el glifo, `leadingAdvance` calcula su rama "sin word spacing" con la misma regla de §1 (`isSpace`), no restándolo a todo espacio. Sin espacios iniciales las dos búsquedas coinciden y la segunda nunca corre.

### 5. El oráculo de esta decisión es la tinta, y tiene que contar los fallos totales

Todo número de este ADR sale de rasterizar la página y medir dónde hay tinta: para cada palabra, el cluster de columnas con tinta que se solapa con su caja, y cuántos puntos de ese cluster quedan a cada lado. Es el mismo criterio que el gate visual de ADR-058 §11, hecho medible.

Importa fijarlo porque los oráculos anteriores de esta familia (métricas AFM en ADR-097, tasa de empalme en ADR-102) son **internos**: miden si el motor es consistente consigo mismo, y los dos dieron verde mientras el defecto estaba vivo. La tasa de empalme sigue sirviendo como diagnóstico —dice *por qué* falla— pero **deja de ser el criterio de éxito**.

**Y el oráculo mismo tuvo el defecto que estaba buscando.** La primera versión descartaba en silencio toda palabra cuya caja no se solapara con **ningún** cluster de tinta — o sea, exactamente el peor fallo posible: la caja completamente fuera de lugar. Por eso la regresión de §3 no apareció en ninguna medición y la encontró el humano mirando el PDF exportado. Contar esos casos es obligatorio, y en la línea base son **13** en una pericia y **38** en la otra — no cero.

## Consecuencias

**Medido** con el oráculo de §5, contando por separado las cajas que no tocan tinta alguna:

| documento | cajas fuera de toda tinta | fuga izq. > 0,5 pt | fuga der. > 0,5 pt |
|---|---|---|---|
| pericia 17653 | **13 → 2** | 965/1560 → **7** | 264 → **7** |
| pericia 29816 | **38 → 0** | 1591/2647 → **23** | 384 → **25** |
| cuento (11 pp) | 1 → **0** | 749/6251 → **0** | 1712 → **0** |
| fallo judicial | 0 → 0 | 11/817 → 11 | 12 → 10 |
| apelación | 0 → 0 | 17/4261 → 17 | 15 → 15 |
| oficio | 0 → 0 | 2/752 → 2 | 1 → 1 |
| `qa-tables-justified.pdf` | 0 → 0 | 0/76 → 0 | 0 → 0 |

**Ni un documento empeora.** Los que no usan `Tw` no cambian en ninguna coordenada, fixtures del repo incluidos, así que ningún snapshot se mueve por este ADR.

Empalme de items multi-palabra:

| documento | hoy | después |
|---|---|---|
| pericia 17653 | 89,3 % | **100 %** |
| pericia 29816 | 96,7 % | **100 %** |
| cuento | 98,5 % | **100 %** |
| fallo judicial | 90,6 % | 90,6 % |
| apelación, oficio, SCBA, fixtures | 100 % | 100 % |

**En contra**

- El flujo pasa a depender de `Tw`, que es estado gráfico: si un `showText` quedara fuera del rastreo de `setWordSpacing` el avance sería peor que hoy. El rastreo ya existe (ADR-068 lo agregó para la corrección de origen) y `save`/`restore` ya lo preservan.
- **El motor pasa a depender de `glyph.isSpace`, que no es API pública documentada de pdfjs-dist** sino una propiedad de los glifos del operator list. Si desapareciera, el término valdría cero para todos y volveríamos al defecto de la línea base, no a algo peor. Los tests de §14 lo fijan en las dos direcciones (con y sin la bandera), así que un cambio de pdfjs lo rompe ruidosamente en vez de en silencio.
- `Tw` nunca se aplica al espacio que pdf.js **sintetiza** (ese no es un glifo del flujo). Es correcto por definición, pero significa que dos documentos con el mismo texto y distinta técnica de separación de palabras no comparten camino.

**Lo que este ADR no toca**

- Los 8 items del sello de notificación electrónica del fallo judicial (90,6 %), donde el flujo falla por otra causa. Uno de ellos contiene un nombre. Queda anotado en `Post_Hito10.8_Pendientes.md` §24.
- El desajuste **vertical** de la caja —las descendentes quedan fuera— que es ADR-109.
