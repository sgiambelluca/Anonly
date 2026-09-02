<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/Render_Engine.md,architecture/03_Data_Model.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-086-El-Detector-De-Degradacion-Mide-El-Ancho.md,adr/ADR-108-El-Avance-De-Un-Espacio-Incluye-El-Word-Spacing.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,roadmap/Post_Hito10.8_Pendientes.md | audiencia=humanos+IA | fase=11 -->

# ADR-109 — La caja de una palabra es su caja de tinta

- **Estado**: Accepted — **§3 superseded por ADR-110** (el comparador que esa sección reajusta desaparece); §1, §2, §4 y §5 vigentes
- **Fecha**: 2026-08-30
- **Decidido por**: El humano, tras ver en el gate visual que —ya corregido el corrimiento horizontal de ADR-108— las colas de `g`, `j`, `p`, `q`, `y`, la `Q` y las comas quedan **fuera** de la caja.
- **Relacionado con**: ADR-063 §2 (la geometría de la que se deriva), ADR-064 (las palabras de OCR, que ya son cajas de tinta), ADR-057 §5 / ADR-086 (la constante que se recalibra), ADR-067 (el orden de lectura), **ADR-108** (que hay que aplicar primero: sin él el defecto horizontal tapa a éste)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. La caja arranca en la línea de base, así que nada de lo que baja queda tapado

`boundingBoxFromParallelogram` arma el rectángulo como `origen → +dir·width → +up·height`, donde el origen es la **línea de base** y `height` es el cuerpo (`item.height` de pdf.js). El resultado va desde la línea de base **hacia arriba**: por debajo no cubre nada.

Medido contra la tinta renderizada, palabras a las que les queda tinta por debajo del borde inferior:

| documento | palabras afectadas |
|---|---|
| pericia 17653 | 499/1569 (31,8 %) |
| SCBA | 690/2310 (29,9 %) |
| apelación | 616/2048 (30,1 %) |

**Una de cada tres.** En un anonimizador eso no es cosmético: `Domínguez`, `Puig`, `Rodríguez`, `Jorge`, `Quilmes` dejan cola visible debajo del rectángulo negro, y una cola de descendentes con el contexto de la frase alcanza para reidentificar tanto como una inicial (el mismo argumento de `Post_Hito10.8_Pendientes.md` §24).

Del otro lado la caja **sobra**: el borde superior está un cuerpo entero por encima de la línea de base, y ninguna fuente del corpus declara un ascenso tan alto.

### 2. Las métricas para arreglarlo ya llegan en la llamada que el motor hace

`getTextContent()` devuelve, además de los items, un mapa `styles` indexado por `item.fontName`:

```ts
styles[item.fontName] = { ascent, descent, vertical, fontFamily }
```

Relevado sobre 10 documentos (4266 items):

| documento | ascent / descent | `ascent + |descent|` |
|---|---|---|
| pericia 17653 (cuerpo) | 0,688 / −0,218 | 0,906 |
| pericia 29816 (cuerpo) | 0,890 / −0,218 | 1,108 |
| cuento | 0,905 / −0,212 | 1,117 |
| SCBA | 0,833 / −0,300 | 1,133 |
| apelación, fallo | 0,891 / −0,216 | 1,107 |
| oficio, fixtures del repo | 0,905 / −0,212 | 1,117 |

Son los valores del `FontDescriptor` del PDF, no una estimación. **No hay API nueva, ni dependencia nueva, ni un segundo recorrido del operator list.**

Donde el interlineado es holgado y la medición de tinta no se contamina con el renglón vecino, esas métricas **acotan la tinta exactamente**:

| documento | tinta bajo la base (p99 / máx) | descent declarado | items que superan el ascent |
|---|---|---|---|
| SCBA | 0,184 / 0,455 | 0,300 | 0/756 |
| apelación | 0,211 / 0,212 | 0,216 | 0/354 |

**Métricas degeneradas** (`ascent ≤ 0` o `descent ≥ 0`): **2 items de 4266**, los dos la fuente del código de barras de la carátula de las dos pericias.

### 3. Bajar solo el piso rompe la noción de "misma línea"

`sharesVerticalBand` (`Contracts.md` §6) es **la** definición de misma línea del producto, con tres consumidores: el repintado de `render-engine`, `selectLineWords` del façade y `findLiteral` de `regex-engine`. Cualquier solapamiento cuenta. Si las cajas de dos renglones consecutivos se tocan, el producto empieza a creer que dos líneas son una.

Medido sobre 752 pares de renglones consecutivos:

| definición de la caja | pericia | cuento | SCBA | apelación | fallo |
|---|---|---|---|---|---|
| hoy (`base` … `base + 1,0·cuerpo`) | 1/91 | 0/269 | 0/174 | 0/157 | 1/61 |
| `base − descent` … `base + 1,0·cuerpo` | 1/91 | **204/269 (75,8 %)** | 0/174 | 0/157 | 2/61 |
| **`base − descent` … `base + ascent`** | 1/91 | **0/269** | 0/174 | 0/157 | 1/61 |

La variante intuitiva —conservar el techo y bajar el piso— **fusiona tres de cada cuatro pares de renglones del cuento**, que tiene interlineado 1,15 cuerpos. La caja de tinta completa no solapa **en ningún par en el que hoy no solape ya**.

O sea que la respuesta no es "agrandar la caja hacia abajo": es **mover la caja al lugar de la tinta**, que hacia arriba sobra tanto como hacia abajo falta.

### 4. Y mueve `bbox.y`, del que depende el orden de lectura

`compareByReadingOrder` compara `bbox.y` con tolerancia de 1 pt para decidir "misma línea". Hoy `y = base − cuerpo` para toda fuente, así que dos palabras de la misma línea de base coinciden en `y` **siempre que compartan cuerpo**. Con la caja de tinta pasa a ser `y = base − ascent·cuerpo`, y en la pericia conviven fuentes con ascent 0,688 y 0,905: sobre un cuerpo de 8,09 pt eso son **1,76 pt de diferencia en la misma línea**, por encima de la tolerancia. El comparador partiría la línea al medio — exactamente la clase de regresión que ADR-067 §4 documentó.

El borde **inferior** no tiene ese problema **para el texto nativo**: hoy `y + height` es la línea de base **exacta**, para toda fuente y todo cuerpo, y con la caja de tinta es `base + descent·cuerpo`, donde `descent` varía 0,205–0,218 dentro de un documento (0,1 pt sobre 8 pt de cuerpo).

> **Errata (2026-08-30).** La primera redacción agregaba que para las palabras de **OCR** el borde inferior también era "más estable que el superior". **Eso no estaba medido y es falso.** Sobre un escaneo real, la línea `PROVINCIA DE BUENOS AIRES` sale como `PROVINCIA DE AIRES BUENOS` con el borde inferior, y las tres claves candidatas —superior, inferior y centro— rompen esa misma línea de formas distintas. La caja de OCR es la mancha de tinta que midió Tesseract: ninguno de sus bordes es una línea de base, y sus alturas varían hasta un 60 % entre palabras del mismo renglón impreso (22,1 pt contra 13,9 pt, medido).
>
> Lo que la decisión de §3 sí sostiene es lo que motivó el cambio: para el texto **nativo**, `y` pasa a depender del ascenso de cada fuente y `y + height` no. Para OCR el problema es otro y más profundo —el comparador con tolerancia no es transitivo, y encima el encabezado de ese documento tiene dos columnas cuyos renglones se intercalan—, y queda abierto en `roadmap/Post_Hito10.8_Pendientes.md` §29.

## Decisión

### 1. La caja de una palabra de texto nativo va de descenso a ascenso

```
yMin = base − |descent| · cuerpo
yMax = base + ascent · cuerpo
```

sobre el eje de ascenso (`up`) del run, con la misma envolvente axis-aligned de ADR-063 §2 — para 90°/180°/270° la construcción es la misma y sigue siendo exacta. `ascent`/`descent` salen de `styles[item.fontName]`.

`BoundingBox` **no cambia de forma**: siguen siendo `x`/`y`/`width`/`height`/`rotation?`. Lo que cambia es qué significan `y` y `height` para una palabra de `source: "pdf"`, y el cambio los pone de acuerdo con lo que `source: "ocr"` ya significaba. **Deja de haber dos nociones de caja en `Page.words`.**

### 2. Sin métricas utilizables, la caja es la de hoy

Si el item no tiene `fontName`, si `styles` no lo tiene, o si las métricas son degeneradas (`ascent ≤ 0` o `descent ≥ 0`), la caja se construye como antes: `base` … `base + cuerpo`. Mismo criterio que el prorrateo de ADR-102 §4 — el peor caso es el statu quo, no algo nuevo.

Alcanza a **2 items de 4266** en el corpus relevado, y al camino de anotaciones de ADR-066 §1, que reconstruye sus runs del operator list y no tiene `styles` que consultar. Las anotaciones conservan su geometría; su oráculo de solapamiento contra el `rect` (ADR-066 §3) queda intacto por construcción.

### 3. El orden de lectura del texto horizontal compara la línea de base

> **Superseded por ADR-110 (2026-08-30).** Esta sección cambia la **clave** de un comparador con tolerancia; ADR-110 elimina el comparador. La razón: un comparador con tolerancia no es transitivo, así que el orden que devolvía dependía de la secuencia interna de `Array.sort` — sobre un escaneo eso rompe uno de cada tres pares de palabras consecutivos, y **cambiar la clave solo cambia qué palabras rompen**. El texto horizontal pasa a agruparse en renglones y `compareByBaseline` desaparece con el mecanismo. Lo que sigue vale como registro de por qué la clave se movió, no como descripción del motor.

`compareByReadingOrder` pasa a comparar `bbox.y + bbox.height` en vez de `bbox.y`, con la misma tolerancia de 1 pt y el mismo desempate por `x`.

**Sobre la geometría de hoy el cambio es un no-op demostrable**: `y + height` es idénticamente la línea de base. Por eso se implementa y se verifica **antes** que §1, en el mismo PR pero como paso separado — si un snapshot se mueve con solo este cambio, el que está mal es el cambio.

El orden **entre runs rotados** (ADR-067 §3) no se toca: sigue comparando el ancla por `y`. Ahí el borde inferior no es una línea de base sino el extremo del run, y ADR-067 dejó ese orden medido sobre una firma real.

### 4. `REPLACEMENT_FONT_HEIGHT_RATIO` baja de 0,7 a 0,64

La constante multiplica `bbox.height` para obtener el tamaño de fuente del reemplazo (ADR-057 §5) y el tamaño de referencia del detector de degradación (ADR-086 §2). Multiplicaba un cuerpo; pasa a multiplicar `(ascent + |descent|) · cuerpo`, que sobre el corpus pesado por items vale **1,101**:

```
0,70 / 1,101 = 0,636  →  0,64
```

Es una recalibración **para que nada visible cambie**, no una decisión tipográfica: el token se sigue dibujando del mismo tamaño y el detector de degradación sigue midiendo contra la misma referencia. Residuo por documento: dentro de ±3 % en todo el corpus salvo la fuente de cuerpo de la pericia 17653 (`ascent + |descent| = 0,906`), donde el token queda ~17 % más chico.

`AVG_GLYPH_ADVANCE_RATIO` y `DEGRADED_FONT_RATIO` **no cambian**: la primera se aplica sobre el tamaño de fuente ya recalibrado, y la segunda es una razón de anchos cuya referencia se preserva por la misma aritmética.

**Lo que este ADR NO decide** es si el token debería dibujarse del tamaño del texto que lo rodea. Eso es `Post_Hito10.8_Pendientes.md` §25 (§23g), sigue abierto, y mezclarlo acá haría imposible saber cuál de los dos cambios movió qué.

### 5. Lo que se acepta que cambie de magnitud

- `dilatedWordBBox` (compuerta 2 de OCR por región, ADR-065 §1) dilata 0,8× el alto de la caja en vertical: la dilatación crece ~10 %. Los umbrales de esa compuerta (40 % del área, lados ≥ 100 pt) tienen margen de sobra.
- `ROTATED_RUN_GAP_IN_EMS = 2` (ADR-067 §2) mide el hueco en cuerpos, y el cuerpo pasa a ser el alto de tinta: los huecos medidos van de 0,44–0,58 (un espacio) a 30 (la marca de agua). Dos órdenes de margen a los dos lados.
- **Las palabras de OCR sí ven un cambio de escalera, y es el único lugar donde la recalibración de §4 no se cancela.** Su caja ya era de tinta, así que su `height` **no** crece: el `ratio` baja 8,6 % y `estimateTokenWidth` da 8,6 % menos sobre ellas. En la práctica la escalera se vuelve un escalón más permisiva en documentos escaneados. Se acepta: la estimación es una optimización, y la garantía de que el texto no se derrama vive en el shrink-to-fit del render (ADR-058 §1), no acá.
- `tryRepaintLine` centra el token con `textBaseline: "middle"` en el medio de la caja. Con la caja de tinta ese medio baja ~0,9 pt sobre un cuerpo de 8 pt, **hacia** el centro óptico real. Es una mejora esperada sobre el "token levantado" de §23g, no un cierre de ese punto.

## Consecuencias

- **Todo `bbox` de texto nativo cambia de `y` y de `height`**; `x` y `width` no se tocan. Es el primer cambio de esta campaña que mueve la geometría de documentos que hoy están bien.
- **Y sin embargo el snapshot de `pdf-engine` NO se mueve, y eso es un hueco, no una garantía.** Su fixture es un documento en memoria que no declara `styles`, así que cae en la reserva de §2 y produce la caja de siempre. Verificado corriendo la suite: 1772 tests en verde sin regenerar una sola snapshot. **El camino nuevo no está cubierto por ningún snapshot**; lo cubren los tests de unidad de §14 (casos 49-50) y el gate visual. Cerrar el hueco pide que el fixture declare métricas, y eso sí regeneraría la snapshot — queda como ítem aparte para no mezclar la verificación del cambio con el rediseño de su fixture.
- El invariante `words` ordenado por `bbox.y` asc de `03_Data_Model.md` §4 pasa a leerse **por línea de base**. Hay que actualizarlo ahí y en `PDF_Engine.md` §9.
- Es cambio de **contrato** (`Contracts.md` §5/§6 y `03_Data_Model.md` §5/§6 describen qué es la caja), así que docs primero y código después (R-2, R-19).
- El código toca `pdf-engine` y la constante de `shared`. Ningún otro motor cambia: `render-engine` y `grouping-engine` consumen la constante recalibrada sin tocar una línea.

**En contra**

- La caja pasa a depender de un dato que el productor del PDF puede declarar mal. El guard de §2 cubre el caso degenerado, pero no un `/Ascent` simplemente optimista o pesimista; ahí la caja quedaría corta sin que nada avise. Hoy el cuerpo entero era una cota que no dependía del productor.
- Dos fuentes con métricas distintas en la misma línea producen cajas de alturas distintas. Es correcto —cada palabra tapa su propia tinta— pero el rectángulo de una entidad que las mezcle (unión de sus palabras) va a ser el más alto de las dos.

**Lo que este ADR no toca**

- Las palabras de OCR: ya son cajas de tinta y no cambian (ADR-064).
- `fragments`, `rotation`, el orden entre runs rotados y el camino de anotaciones.
