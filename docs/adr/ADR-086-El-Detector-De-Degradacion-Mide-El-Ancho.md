<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md | audiencia=humanos+IA | fase=post-10.10 -->

# ADR-086 — El detector de degradación mide el ancho, no la altura

- **Estado**: Accepted
- **Fecha**: 2026-08-20
- **Decidido por**: El humano, sobre las tres opciones que dejó abiertas `roadmap/Post_Hito10.8_Pendientes.md` §16. Eligió la **A** (medir la compresión horizontal) y la **C** (que el piso de dibujo escale), descartando la B por insuficiente.
- **Relacionado con**: **ADR-058 §7** (que definió el veredicto y su umbral, y es lo que este ADR corrige), **ADR-062** (que llevó el veredicto hasta la UI y cuya §"renderFull" queda con errata acá), **ADR-057** (la escalera de abreviaturas, que es la que evita que el caso común llegue a este detector), **ADR-076** (la edición manual, que es el camino por el que el caso común sí llega).
- **Parte de**: lo que destapó verificar en un browser la marca de ADR-062.

> Convención de citas: `ADR-086 §N` refiere a **Decisión §N**.

## Contexto

### 1. El detector nunca se disparó, y se descubrió mirando

ADR-062 cerró el transporte del veredicto de degradación hasta el árbol de entidades. Al verificar la marca en un browser real —documento de 4 páginas, un grupo con el `replacementValue` editado a mano a 68 caracteres sobre una ocurrencia de 18— el panel anonimizado dibujó una **mancha ilegible** y `PREVIEW_UPDATED.degraded` llegó **vacío**.

La marca no se encendió, y hacía bien: el veredicto que le llegó decía que no había nada degradado. El problema no está en el transporte de ADR-062 ni en la UI; está en el criterio de ADR-058 §7.

### 2. El criterio mide la compresión que no ocurre

Un reemplazo que no entra se aprieta de **dos** formas independientes:

1. **Vertical** — se achica la fuente. Es el bucle de `fitReplacementFontSized`.
2. **Horizontal** — la fuente ya no puede achicarse más y `fillText(text, x, y, maxWidth)` aplasta los glifos a lo ancho hasta que entren. Es la red de seguridad de ADR-058 §1, la que garantiza que nada se derrame.

`Contracts.md` §6 define el veredicto como `finalSizePx / naturalSizePx < DEGRADED_FONT_RATIO`, o sea **solo la primera**. Y las dos son complementarias, no acumulativas: el squeeze horizontal ocurre **exactamente** cuando el bucle tocó fondo y el texto todavía no entra. En la rama no rotada, `fillText` recibe `maxWidth = bbox.width` y el fitting midió contra el mismo ancho, así que no hay un régimen donde las dos actúen a medias.

El detector es ciego **justo donde ocurre el daño**.

### 3. Y en cuerpo de texto no puede dispararse nunca

`naturalSizePx = max(REPLACEMENT_MIN_FONT_PX, round(boxHeight × 0.7))` y el bucle es `while (…) size > REPLACEMENT_MIN_FONT_PX`. Los dos términos del cociente chocan contra **el mismo piso de 8 px**. Con una caja chica, `naturalSizePx` nace clavado en el piso y el bucle no puede bajar ni un píxel: `finalSizePx === naturalSizePx`, cociente **1,00 por construcción**, largo el texto que sea.

Medido sobre `fitReplacementFontSized` con un token de 68 caracteres:

| `boxHeight` (px ya escalados) | natural | final | cociente | ¿marca? |
|---|---|---|---|---|
| 10 | 8 | 8 | 1,00 | no |
| 12 | 8 | 8 | 1,00 | no |
| 14 | 10 | 8 | 0,80 | no |
| 16 | 11 | 8 | 0,73 | no |
| 20 | 14 | 8 | 0,57 | **sí** |
| 24 | 17 | 8 | 0,47 | **sí** |

El umbral recién es alcanzable con `natural ≥ 14`, o sea **`boxHeight ≥ 19,3`**: texto de título. Una línea de cuerpo de documento —10 a 14 px— es estructuralmente incapaz de producir un veredicto de degradación.

Dos precisiones que salieron de la revisión y que conviene dejar escritas, porque un resumen de una línea las pierde: el "1,00 por construcción" es exacto solo hasta `boxHeight ≤ 12` (`round(0,7h) ≤ 8 ⟺ h < 12,14`); entre 13 y 14 el cociente da 0,80–0,89, igual inalcanzable. Y el piso empieza a morder recién por debajo de `boxHeight ≈ 11,4`; entre eso y 19,3 lo que sobra es rango, no piso.

### 4. La invariancia de escala documentada es falsa cerca del piso

ADR-062 §"renderFull" justifica no emitir el veredicto por el camino del export así:

> "por la invariancia de escala de ADR-058 §7 —el umbral es una razón, no un piso en píxeles, precisamente para que preview y export nunca discrepen sobre el mismo reemplazo— el veredicto del preview **es** el del export."

La premisa no se sostiene. `REPLACEMENT_MIN_FONT_PX` es una **constante absoluta** y `boxHeight` viene de `scaleBbox`, así que cuando el bucle termina por el piso (y no por "el texto entró") el numerador queda clavado en 8 mientras el denominador escala. Misma página, mismo texto, misma caja de 12 px:

| escala de render | natural | final | cociente | ¿marca? |
|---|---|---|---|---|
| 1 | 8 | 8 | 1,00 | no |
| 1,5 | 13 | 8 | 0,62 | no |
| 2 | 17 | 8 | 0,47 | **sí** |
| 3 | 25 | 8 | 0,32 | **sí** |

La misma ocurrencia se declara sana o degradada **según a qué zoom se la mire**. El comentario de `kernel.ts` que afirma que las magnitudes "escalan igual" vale solo mientras el bucle termine por el texto, nunca por el piso.

El test `same replacement yields the same degraded verdict across scales` pasa —y mide invariancia de verdad— porque sus cuatro casos usan cajas de 40 px: los cocientes dan 0,357 y 0,362 (degradante), 0,607 y 0,621 (mild), y **ninguno toca el piso**. Ejercita la propiedad exactamente en el único régimen donde se cumple. No es un test flojo; es un test que no sabía que había un segundo régimen.

Un cuarto matiz: la invariancia **nunca fue exacta**, ni lejos del piso. `naturalSizePx` pasa por `Math.round` y el bucle baja de a 1 px entero, así que el cociente deriva con la escala por cuantización (0,357 contra 0,362 arriba) aunque el piso no intervenga. Es ruido irrelevante frente al piso, pero significa que escalar el piso arregla el modo grosero **sin** volver exacta la propiedad — a menos que se arregle también la referencia, que es lo que §2 de la Decisión hace.

### 5. Qué tan expuesto está el usuario hoy

Menos de lo que la §1 sugiere, y conviene ser preciso para no sobredimensionar el arreglo:

- **La escalera de abreviaturas de ADR-057 es la primera defensa**, y funciona: `[PERS 01]` sobre una caja apretada da 0,772 con el criterio nuevo, muy lejos del umbral. El camino automático no produce el caso malo.
- **El aviso "de antes" de `EditReplacementDialog` (ADR-076) sí mide anchos** — `estimateReplacementFit` es, casualmente, lo único del sistema que hace lo que a este detector le falta. Sobre el mismo token de 68 caracteres avisó correctamente *"Es probable que no entre en la aparición más chica y se vea encogido"*.

O sea que el descubierto real es el usuario que **ignora ese aviso y guarda igual**, o el que llega a un reemplazo largo por un camino que no pasa por el diálogo. No es una laguna de privacidad —el dato queda tapado en todos los casos— sino de legibilidad del documento entregado.

### 6. Por qué necesita ADR

`DEGRADED_FONT_RATIO` es una constante **pública** de `@anonly/shared` y su semántica está escrita en `Contracts.md` §6. Cambiar qué mide y cuánto vale es un cambio de contrato: R-2/R-19 exigen ADR y docs antes que código. Y las tres opciones que §16 dejó abiertas no son equivalentes ni componibles a ciegas — la B, en particular, parece la más barata y es la que menos arregla.

## Decisión

### 1. El veredicto pasa a ser la razón de anchos

```
degradado ⟺ anchoDisponible / anchoNatural < DEGRADED_FONT_RATIO
```

donde `anchoNatural = measureText(texto, fuente a tamaño natural)` y `anchoDisponible` es el mismo ancho contra el que ya mide el fitting (`bbox.width`, o `availableLengthPx` en la rama rotada de ADR-066 §7).

**Es la compresión total, no una tercera medición.** El producto de las dos compresiones —vertical × horizontal— se simplifica exactamente a esta razón:

```
(final/natural) × (anchoDisp / (final × k))  =  anchoDisp / (natural × k)
```

El tamaño final **se cancela**. Verificado numéricamente en cinco configuraciones con pisos distintos: producto y `anchoDisponible / anchoNatural` coinciden hasta el último decimal. Con `measureText` real la cancelación es aproximada en vez de exacta (las métricas de fuente no son perfectamente lineales en el tamaño por hinting), pero la formulación por anchos es la primaria y la del producto solo explica de dónde sale.

Esto conserva el principio de ADR-058 §7 —**una razón, no un piso en píxeles**— y le da un enunciado que se puede leer en voz alta: *cuánto más angosto que su ancho natural quedó este texto*.

### 2. `naturalSizePx` deja de tener piso, y el piso de dibujo escala

Dos cambios en `fitReplacementFontSized`, y son la misma idea vista de los dos lados:

**(a) La referencia no se dibuja, así que no lleva piso ni redondeo.** `naturalSizePx` pasa a ser `boxHeight × REPLACEMENT_FONT_HEIGHT_RATIO`, exacto. El piso existía para no dibujar texto de 3 px; `naturalSizePx` **nunca se dibuja** — es el tamaño de referencia contra el que se mide. Tenerlo ahí era lo que hacía que la referencia mintiera ("lo natural acá son 8 px" cuando la caja pedía 8,4).

**(b) `REPLACEMENT_MIN_FONT_PX` se multiplica por la escala de render** al acotar el bucle. Es un límite de legibilidad en píxeles de pantalla, y por lo tanto una cantidad que escala igual que todo lo demás que el kernel dibuja. Sin esto, un preview a escala 2 dibuja hasta 8 px donde el mismo render a escala 1 dibuja hasta 8 px "grandes" — dos umbrales distintos para la misma decisión visual.

**Qué sitios alcanza cada mitad, porque no era obvio y las dos primeras implementaciones lo erraron en direcciones opuestas.** Hay **tres** categorías de tamaño en el kernel, no dos, y cada confusión rompe algo distinto:

1. **La referencia del veredicto** — `naturalSizePx`, adentro de `fitReplacementFontSized`. Nunca se dibuja; existe para medir. Le aplica (a): sin piso, sin redondeo.
2. **El tamaño de dibujo** — dónde arranca el bucle. Le aplica (b): piso escalado. Y le aplica **también al `naturalFont` con el que `paintReplacements` decide `fitsNaturally`**, aunque esa fuente tampoco se dibuje. La razón es que `fitsNaturally` no es un veredicto sino la **condición de activación del repintado** de ADR-058 §2, y la pregunta que hace es "¿el token se dibuja sin problema, o hay que repintar la línea?". Hasta ADR-086 esa condición y el arranque del bucle eran **la misma expresión**, y por eso `fitsNaturally === true` implicaba "se dibuja sin aplastar". Medirla contra la referencia pura las separa: con una caja de 8 pt a `fullScale` la referencia da 11,65 px y el dibujo arranca en 16,64 —el piso escalado—, así que un token puede declararse "entra a su tamaño natural", saltear el repintado, dibujarse a 16,64 y ser aplastado por `maxWidth` igual, reportando `widthRatio === 1`. **Se implementó así, quedó verde, y se revirtió**: los dos tests de `fitsNaturally … a fullScale` existen para que no vuelva a pasar.
3. **La estimación del tamaño real de la línea original** — el `sizePx` con el que `calibrateLineFont` mide sus 12 candidatos (ADR-058 §6(e)). No es ninguna de las dos anteriores, y **este ADR no la decide**: conserva el piso **sin escalar**. Escalarlo lo infla —16,64 px contra 11,65 reales en una caja de 8 pt a `fullScale`, 42,9% de error contra 3,0%— hasta empujar el `errorRatio` mínimo alcanzable por encima de `LINE_CALIBRATION_ERROR_THRESHOLD` (0,15) **por construcción**: el repintado de línea se apagaría solo en el PDF exportado, sin error y sin log, justo sobre el caso que ADR-058 existe para arreglar. **También se implementó así y se revirtió.** Mejorar esa estimación es posible y probablemente valga la pena, pero es otro cambio: tiene su propia justificación y su propio gate visual.

La lección, porque costó dos iteraciones: (a) no es "todo lo que no se dibuja", es "el término del veredicto". La pregunta correcta ante cada sitio no es "¿se dibuja?" sino "¿qué decide?".

Juntos dan **invariancia exacta**, no aproximada. Medido sobre la formulación propuesta, mismo texto y misma caja a seis escalas:

| escala | veredicto | tamaño dibujado |
|---|---|---|
| 0,5 | 0,184570 | 4 px |
| 1 | 0,184570 | 8 px |
| 1,5 | 0,184570 | 12 px |
| 2 | 0,184570 | 16 px |
| 3 | 0,184570 | 24 px |
| 4 | 0,184570 | 32 px |

El veredicto es idéntico a seis decimales y el dibujo escala como corresponde. Eso es lo que ADR-062 §"renderFull" siempre asumió y nunca fue cierto.

### 3. `DEGRADED_FONT_RATIO` baja de 0,6 a 0,5

**No es una constante que se pueda reusar tal cual**: bajo el criterio viejo 0,6 quería decir "la fuente se achicó un 40%"; bajo el nuevo quiere decir "el texto quedó al 60% de su ancho natural". Son severidades distintas, y mantener el número sería asumir que se corresponden.

Medido a escala 1 sobre tokens reales del producto:

| caso | razón de anchos | umbral 0,6 | umbral 0,5 |
|---|---|---|---|
| `[P1]` en caja holgada | 1,000 | — | — |
| `[PERSONA 01]` justo | 0,744 | — | — |
| `[PERSONA 01]` apretado | 0,579 | **marca** | — |
| `[ORGANIZACION 01]` apretado | 0,584 | **marca** | — |
| `[PERS 01]` abreviado (ADR-057) | 0,772 | — | — |
| token largo escrito a mano | 0,185 | **marca** | **marca** |

Con 0,6 se marcan **placeholders normales en cajas apretadas** — tokens que hoy se renderizan bien y que el usuario no tiene por qué tocar. ADR-058 §7 eligió un umbral, y no marcar cada fallback, precisamente para que la señal signifique algo; y ADR-062 lo repite al descartar la estimación cliente-side: *"una señal que aparece de más deja de ser señal"*. Con 0,5 esos dos casos quedan afuera con margen y el caso real sigue marcando por goleada.

**La marca queda de un solo lado**: sub-marcar es un documento feo que el usuario no descubrió; sobre-marcar es mandarlo a arreglar grupos que están bien, y erosiona la única señal que tiene. Ante la duda, no se marca.

### 4. El umbral se calibra mirando, no calculando

Las tablas de §3 usan el modelo lineal de ancho (`estimateTokenWidth`), no `measureText`. Sirven para elegir el orden de magnitud; no para afirmar que 0,5 es el número correcto con métricas reales de fuente.

**Gate de este ADR**, mismo criterio que ADR-058 §11: verificación manual en browser sobre los cuatro documentos de siempre, comprobando las dos direcciones —que ningún placeholder que se lee bien quede marcado, y que todo reemplazo que no se lee quede marcado—. Si con métricas reales algún placeholder normal cae por debajo de 0,5, se baja el umbral antes de mergear, no después.

**Cobertura real del gate (2026-08-20): 1 de los 4 documentos.** Se corrió el **documento 1** (texto con nombres cortos en párrafos), en las tres direcciones: con los placeholders automáticos no se enciende ninguna marca; con un reemplazo de 56 caracteres escrito a mano se enciende, con el recuadro sobre el canvas y el diálogo; y al acortar el texto la marca se apaga sola. Faltan el **2** (escaneado, ruta OCR), el **3** (tablas y justificado) y el **4** (sello). Los tres exigen documentos que el repo no tiene: `tests/fixtures/` solo commitea `protected.pdf` y su generador produce texto plano, vacío y corrupto — un escaneado real no se fabrica con `pdf-lib`.

Qué compensa y qué no. El riesgo que el documento 3 cubriría —que el piso escalado se filtre a la calibración y apague el repintado de línea— **apareció y está cerrado con un test automatizado a `fullScale`** (`line repaint still activates at fullScale on a body-text box`), que además es más fuerte que el gate visual para ese defecto — no porque el preview corra siempre a escala 1 (**no lo hace**: ADR-037 §1 hace que el zoom del browser cambie `RenderRequested.scale`, así que alejando o acercando el gate visual sí puede ejercitar el piso escalado), sino porque el test es determinista y no depende de que a alguien se le ocurra tocar el zoom mientras mira. Lo que **no** está cubierto son dos cosas. La primera es la calibración del umbral contra familias tipográficas distintas de las del documento 1, que es exactamente para lo que §4 existe. La segunda la introduce §2(b) y no la descubrió nadie mirando: a `fullScale` el piso de dibujo pasa a valer 8 × 2,08 px ≈ **8 pt de página**, así que todo reemplazo en una caja de menos de ~11,4 pt se dibuja **más grande que su tamaño natural** y aplastado horizontalmente por `maxWidth` —contra ~5,8 pt sin aplastar antes de este ADR—. Ningún test dice nada sobre cómo queda eso en el PDF entregado, y es justo lo que el documento 3 (tablas y justificado: texto chico y denso) habría mostrado. Precedente de no dejarlo implícito: el gate del Hito 10.5 quedó registrado como 3/4 documentos sin probar (`roadmap/MVP.md`).

### 5. El veredicto sigue saliendo solo por el preview

ADR-062 §"renderFull" decidió no emitir el veredicto por el camino del export, y esa decisión **se mantiene** — pero por otra razón, porque la que había era falsa. Ahora la invariancia es exacta (§2) y por lo tanto la premisa recién se vuelve verdadera con este ADR aplicado. Hasta entonces, la conclusión era correcta por accidente.

Queda como **errata** en ADR-062 y en el comentario de `kernel.ts`, no como cambio de decisión: duplicar el cómputo por el camino del export seguiría dando lo mismo y seguiría abriendo la posibilidad de que difirieran por un bug.

## Consecuencias

**Positivas**: el aviso empieza a existir para el caso que motivó a ADR-058 §7 y a ADR-062, que es texto de cuerpo de documento — hasta hoy solo era alcanzable en titulares. La invariancia de escala pasa de afirmada a verificada, y con eso la marca del preview vale de verdad para el PDF exportado, que es el archivo que el usuario entrega. El criterio se vuelve enunciable sin jerga, lo que importa porque su consecuencia visible es un texto que lee alguien que no sabe qué es un token.

**Negativas**: cambia una constante pública y su semántica, así que todo consumidor de `DEGRADED_FONT_RATIO` hay que revisarlo. Los tests de ADR-058 §7 que fijan cocientes concretos (`10/28`, `17/28`) miden la magnitud vieja y hay que reescribirlos contra la nueva — no es adaptarlos, es volver a derivar los casos. Y la marca va a aparecer en documentos donde antes no aparecía: es el punto, pero significa que la primera prueba manual sobre un expediente real va a mostrar más avisos que ayer, y hay que resistir la tentación de leer eso como una regresión.

**Neutras**: el transporte de ADR-062 no se toca —ni el evento, ni el cache, ni el store, ni la marca de la UI, que ya funcionan y tienen tests—; el dibujo del reemplazo no cambia salvo por el piso escalado; la escalera de ADR-057 sigue siendo la primera defensa y no se altera; el aviso "de antes" de ADR-076 sigue como está, midiendo anchos con su propia estimación.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Solo quitarle el piso a `naturalSizePx`** (la opción B de §16) | Es una línea y arregla la tabla de §3, pero **sigue midiendo la compresión equivocada**: el aplastado horizontal continúa invisible. Un token que entra a 8 px y se aplasta al 20% seguiría dando "sano". Arregla el síntoma más fácil de medir y deja el defecto. |
| **Solo escalar `REPLACEMENT_MIN_FONT_PX`** (la opción C sola) | Arregla la invariancia y nada más. Sin la §1, el criterio invariante sigue siendo el criterio ciego: mismo veredicto a toda escala, y el veredicto equivocado. |
| **Marcar siempre que `fillText` reciba `maxWidth` y el texto no entre** | Sin umbral. Vuelve a "una señal que aparece siempre no es una señal" — el mismo error que ADR-058 §7 evitó al elegir una razón en vez de marcar cada fallback. La tabla de §3 muestra que `[PERSONA 01]` apretado entraría, y es un token que se lee perfecto. |
| **Estimar la degradación en el cliente** | Ya cerrada por ADR-062 ("Alternativas"): tercera fuente de verdad, capaz de discrepar del preview y del export. Este ADR no la reabre; al contrario, la hace menos tentadora, porque el veredicto del motor pasa a valer para el caso común. |
| **Dejarlo como está y documentar la limitación** | Es lo que hubo entre ADR-058 y hoy, sin que nadie lo notara, y lo que produjo una marca completa y correcta que no se enciende nunca. El costo de mantenerlo es un aviso que el usuario no recibe sobre un documento que ya entregó. |

## Validación

- Tests de `render-engine`: los de ADR-058 §7 re-derivados contra el criterio nuevo, más uno que **falsifique el modo de falla real** — un reemplazo largo sobre una caja de cuerpo de texto (`boxHeight` 12, escala 1) que hoy da veredicto vacío y debe pasar a marcar.
- Test de invariancia: el actual se reescribe para ejercitar **el fondo del bucle**, que es el régimen que nunca tocó. Debe pasar a escalas 0,5 / 1 / 2 / 4 con el veredicto idéntico.
- Test de no-regresión de falsos positivos: `[PERSONA 01]` y `[ORGANIZACION 01]` en cajas apretadas **no** se marcan.
- Dos tests sobre `fitsNaturally` a `fullScale`, en sus dos direcciones (`fitsNaturally mide contra el tamaño de dibujo: …`), que fijan la tercera categoría de §2. El negativo es además el único test del repo que falsifica la bicondicional de ADR-058 §2 —"si el token entra, no se repinta nada"— a cualquier escala, y para eso su `originalValue` tiene que medir exactamente lo que su caja declara: sin esa consistencia la calibración rechaza el plan por la condición (e) y el test queda inerte.
- Contract test de `shared`: `DEGRADED_FONT_RATIO` vale 0,5 y su docstring dice qué razón mide.
- **El gate manual de §4**, que es el único que puede juzgar el umbral.

## Docs actualizados

- `core/Contracts.md` §6 — `DEGRADED_FONT_RATIO`: valor nuevo y semántica nueva.
- `core/Render_Engine.md` §2, §13 casos 25 y 28, §14 y §15 — el criterio, el piso escalado y sus once tests.
- `adr/ADR-058` — errata en §7: el veredicto pasa a medir el ancho. El resto del ADR (shrink-to-fit, repintado de línea, leyenda) queda intacto.
- `adr/ADR-062` — errata en §"renderFull": la invariancia que se invoca no se cumplía; se cumple recién con este ADR.
- `roadmap/Post_Hito10.8_Pendientes.md` §16 — pasa de "necesita ADR" a "decidido acá".

## Referencias

- `core/Contracts.md` §6 — `core/Render_Engine.md` §13 caso 28, §14
- `adr/ADR-057` (la escalera que evita el caso común) — `adr/ADR-058` §1, §7, §11 — `adr/ADR-062` (el transporte, que no se toca) — `adr/ADR-076` (el aviso "de antes", que sí mide anchos)
- `roadmap/Post_Hito10.8_Pendientes.md` §16 (las dos tablas de medición originales)
