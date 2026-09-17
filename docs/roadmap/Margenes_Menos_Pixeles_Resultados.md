<!-- CONTEXT: scope=reporte-de-ejecucion | dependencias=roadmap/Margenes_Menos_Pixeles_Handoff.md,roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/ImageData_Perfilado_Resultados.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=planificador+humano | fase=11 -->

# Márgenes — resultados de M-1 + M-2 (tinta residual y su caja)

Fecha: 2026-09-16. Ejecutado por el implementador según
[`Margenes_Menos_Pixeles_Handoff.md`](Margenes_Menos_Pixeles_Handoff.md). Este
es un **reporte de ejecución**: mide y describe, no elige entre I-1/I-2/I-3 ni
recomienda una optimización — esa decisión es del planificador, con este
análisis en la mano (Handoff §5, Plan §7).

Campaña: `20260916-351fc4d3`. Evidencia cruda completa en
`.measure/margenes-tinta/20260916-351fc4d3/`. Congelada sobre
`git rev-parse HEAD` = `4896151` (control de §1); el T5 compartido se
commiteó *durante* esta fase (`HEAD` pasó a `e1aac58`, 13 commits por módulo)
— no afecta la referencia de píxeles ni los fixtures, ver §8.1. El árbol
quedó verificado byte a byte contra `key-files.sha256` al cerrar cada corrida
(los ocho archivos dan `OK`) y `git status --porcelain` da vacío.

## 0. Alcance

M-1 + M-2 en una sola corrida por fixture: cuánta tinta del margen queda sin
explicar tras proyectar las palabras de la pasada derecha, y dónde está. **No
se implementó I-1, I-2 ni I-3**, no se tocó la compuerta de ADR-162, el
número de pasadas, el DPI ni el recorte de franja. No se midió la variante de
I-1 que enmascara píxeles antes de reconocer. Sin commit, sin push.

## 1. Validación del instrumento — antes de confiar en cualquier número

El Handoff (§2.3) exige probar la transformación inversa con su propio
contador, no con un test sintético: "una conversión mal hecha no da error, da
un residuo equivocado". Se rompió el contador **dos veces**, por los dos
caminos que la proyección atraviesa.

### 1.1 Camino de escala (px↔pt) — qa-stamp, orientación 0

Se corrompió `dpi + 5` en el factor de escala de `projectWordBboxToStrip`,
dejando intacta la verificación de ida y vuelta. Sobre qa-stamp:

| Corrida | `projectionMismatches` |
| --- | --- |
| Con la rotura | **116** |
| Revertida y reconstruida | **0** (hash del chunk `kernel-*.js` bit a bit igual al previo a la rotura) |

### 1.2 Camino de rotación (`unrotateBbox` con ángulo complementario) — T5 rotado

Acá el instrumento **falló de verdad primero**, no como experimento
controlado. La corrida oficial de T5 rotado con el código que yo creía
correcto dio `projectionMismatches: 660` — 330 en cada página de orientación
90° y 330 en cada página de 270°, cero en 0°/180°. El patrón (0 en 0°/180°,
todo el resto en 90°/270°) es la firma de un bug en el manejo del ángulo, no
ruido: qa-stamp (orientación 0) nunca pudo ejercitar esta rama, así que el
`0` de la §1.1 no decía nada sobre ella — exactamente la advertencia del
planificador.

**Causa.** La verificación de ida y vuelta reaplicaba
`unrotateBbox(backToUpright, orientation, uprightWidth, uprightHeight)` para
volver al espacio "original" y comparar. `unrotateBbox` exige ahí las
dimensiones del raster **original** (su propio comentario lo dice), y
`uprightWidth/uprightHeight` son las del raster **enderezado** — iguales a
las originales en 0°/180°, intercambiadas en 90°/270°. La proyección
`box` (la que realmente enmascara tinta) no tenía este bug: solo la
verificación. Corregido en `projectWordBboxToStrip`
(`packages/anonymization-core/ocr-engine/src/worker/kernel.ts`) calculando
las dimensiones originales a partir de `uprightWidth/uprightHeight` con el
intercambio correspondiente antes de llamar a `unrotateBbox`. Gates scoped de
`ocr-engine` verdes tras el fix (166 tests, typecheck, lint). Las corridas
`case-t5rotated` y `t5rotated-angle-break-validation` generadas con el
instrumento con el bug se archivaron como inválidas
(`case-t5rotated-invalid-v1/`, `t5rotated-angle-break-validation-invalid-v1/`,
con su `INVALID.md`); el patch viejo quedó como
`instrument-v1-verification-bug.patch` (evidencia histórica, no aplicar).

Con el fix, la prueba de rotura real — esta vez sobre la **proyección**
(`complementary = orientation`, sin complementar, no la verificación):

| Corrida | mismatches 0° | 90° | 180° | 270° | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Instrumento corregido | 0 | 0 | 0 | 0 | **0** |
| Rotura deliberada (ángulo sin complementar) | 0 | 330 | 0 | 330 | **660** |

0° y 180° dan 0 en los dos casos por construcción (180° es su propio
complemento; 0° no tiene nada que complementar) — la rotura solo se nota
donde tiene que notarse. El patch final (`instrument.patch`,
SHA-256 `04b7c646a8e9f7eb9397207e03446f039d15c7437a95b41300b810724de61283`)
es el que produjo todos los números de este reporte salvo los explícitamente
marcados como de la corrida v1 inválida.

## 2. La correlación de §3 — esto decide

Por cada tira, `residualInkPixels[0] === 0` contra `wordsAddedByThisStrip`,
sobre las 112 tiras medidas (100 de P2 + 2 de qa-stamp + 2 de márgenes
blancos + 8 de T5 rotado):

| Fixture | Sí / 0 | Sí / >0 | No / 0 | No / >0 | Filas descalificantes |
| --- | ---: | ---: | ---: | ---: | --- |
| P2 (100 tiras) | **100** | **0** | 0 | 0 | ninguna |
| qa-stamp (2 tiras) | 0 | 0 | 0 | **2** | ninguna |
| márgenes blancos (2 tiras) | 2 | 0 | 0 | 0 | ninguna |
| T5 rotado (8 tiras) | 8 | 0 | 0 | 0 | ninguna |
| **Total (112 tiras)** | **110** | **0** | **0** | **2** | **ninguna** |

**Ninguna tira, en ninguno de los cuatro fixtures, cae en "residuo cero pero
aportó palabras".** Es el resultado que hubiera descalificado a I-1 en su
forma exacta, y no aparece ni una vez en 112 tiras. Las dos únicas tiras con
residuo distinto de cero son las de qa-stamp, y las dos aportaron palabras
reales (columna "No / >0": "se pagó y sirvió") — el sello. Conteo crudo, sin
promediar: 110/112 tiras (98,2 %) tienen residuo exactamente cero, y de esas
110, cero aportaron una palabra que se hubiera perdido si la lectura se
hubiera saltado.

## 3. Distribución del residuo en P2 (100 tiras, `d = 0`)

**El residuo es exactamente cero en las 100 tiras de P2**, sin excepción:
`min = p10 = mediana = p90 = max = 0`. No hay distribución que graficar
porque no hay varianza — el histograma es una única barra en cero.

**Curva `d = 0..3`.** También plana en cero para las cuatro dilataciones, en
las 100 tiras: `residualInkPixels[d]` da `[0, 0, 0, 0]` en todos los
registros. A diferencia de qa-stamp (§5), acá no hay borde de antialiasing
que discutir — no hay residuo del que discutir el borde.

**Lectura:** en P2, el cuerpo del documento que invade el 20 % lateral
(Plan §1: "en P2 las 100 franjas están activas porque el cuerpo horizontal
invade el 20 % lateral") es exactamente la tinta que la pasada derecha ya
reconoció. No hay tinta huérfana. Esto es sobre **un** documento
administrativo de 50 páginas sin sellos ni texto rotado de diseño — no se
midió sobre un corpus con más de un documento (§8.2, límite).

## 4. Cajas: fracción del alto de la tira

`inkBox` (tinta total, sin enmascarar) sobre las 100 tiras de P2:

| n | min | p10 | mediana | p90 | max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1,07 % | 1,27 % | 2,32 % | 3,48 % | 3,48 % |

La tinta ocupa entre el 1 % y el 3,5 % del alto de la tira — el cuerpo del
documento que invade el margen lo hace en una franja angosta, no a lo largo
de toda la hoja. `residualBox[0]`: **no aplica** en P2 — con residuo cero en
las 100 tiras (§3), no hay caja de residuo que medir (0/100 con
`residualBox[0] != null`).

Sobre qa-stamp, donde sí hay residuo, la caja del residuo sí tiene algo que
decir (ver §5): izquierda 12,6 % del alto, derecha 70,7 %.

`inkPixels` en P2: mediana 3.129 px, entre 1.036 y 3.855 — sobre una tira de
357×2.526 px (903.582 px totales), la tinta es entre el 0,11 % y el 0,43 %
del área de la tira. `maskedWordBoxes` (cajas de palabra proyectadas que
intersecan la tira): mediana 4,5, entre 1 y 7 por tira — el cuerpo del
documento efectivamente proyecta varias palabras sobre cada margen.

## 5. qa-stamp: el sello sobrevive

Las dos tiras dan residuo **distinto de cero** y **aportan palabras reales**:

| Tira | tinta (px) | residuo\[0\] (px) | caja residuo (fracción alto) | cajas proyectadas | palabras aportadas |
| --- | ---: | ---: | ---: | ---: | --- |
| izquierda | 11.025 | 1.636 (14,8 %) | 12,6 % | 12 | 7: `—`, `olO4`, `Folio`, `214`, `—`, `Juan`, `Pérez` |
| derecha | 10.123 | 9.651 (95,3 %) | 70,7 % | 2 | 14: `JUZGADO`, `CIVIL`, `12`, `—`, `PERITO`, `CARLOS`, `LOPEZ`, `—`, `DNI`, `42.998.103`, `—`, `—`, `TIAID`, `OAY9ZAF` |

Total: **21 palabras aportadas**, el mismo número exacto que documentó la
campaña anterior sobre el mismo fixture (`ImageData_Perfilado_Resultados.md`
§11.4: "21 palabras añadidas, que reproducen exactamente las 15 rotadas + 6
sobrantes de ADR-121") — coincidencia exacta entre dos instrumentos
independientes sobre el mismo reconocimiento, evidencia cruzada de que este
instrumento mide lo mismo que el anterior. **El sello sobrevive**: bajo la
regla exacta de I-1 (saltear solo si el residuo es cero), ninguna de las dos
tiras de qa-stamp se hubiera saltado, porque ninguna tiene residuo cero.

**Curva `d = 0..3` en qa-stamp: plana.** `[1636, 1636, 1636, 1636]`
(izquierda) y `[9651, 9651, 9651, 9651]` (derecha) — dilatar las cajas
proyectadas hasta 3 px no cambia el residuo ni un píxel en ninguna de las dos
tiras. El "residuo cero" de P2 no es un artefacto de cajas ajustadas que la
dilatación disolvería (Handoff §2.2): en P2 el residuo ya es cero en `d=0`, y
acá donde el residuo SÍ es distinto de cero, ni la dilatación más generosa lo
toca — son dos regímenes claramente separados, no un continuo con borde
ambiguo.

## 6. T5 rotado y márgenes blancos: controles estructurales

**T5 rotado** (4 páginas, orientación 0/90/180/270, 8 tiras): residuo cero en
las 8, 0 palabras aportadas en las 8, `projectionMismatches: 0` en las 8
(§1.2, ya con el fix). Consistente con
`ImageData_Perfilado_Resultados.md` §11.4: "108 candidatas crudas, las 108
descartadas por confianza, `wordsAdded = 0`" — este fixture no tiene
contenido de margen diseñado para leerse rotado, así que cero palabras
aportadas es lo esperado, no una falla del instrumento. `maskedWordBoxes`
entre 38 y 54 por tira: el cuerpo del documento (páginas densas) proyecta
bastante sobre el margen incluso acá.

**Márgenes blancos** (1 página, 2 tiras): `inkPixels = 0` y
`wouldSkipByWhiteGate = true` en las **dos** tiras — exactamente lo que pidió
la validación positiva del planificador. El criterio de tinta propio
(ADR-164 §5.1: `v = a*(r+g+b)/3+(1-a)*255 < 128`) y la compuerta exacta de
ADR-162 coinciden en este control: donde uno dice "sin tinta", el otro dice
"blanca" — ninguno de los dos está mal aplicado acá.

**Validación de la transformación inversa en orientación ≠ 0**: cubierta en
§1.2. Frío y caliente idénticos (`coldVsHotIdentical: true`, comparado sin
`documentId`) en los cuatro fixtures, incluido T5.

## 7. Ahorro proyectado de I-1 y de I-2

Aplicando los costos por etapa de `ImageData_Perfilado_Resultados.md` §11.3
(301 ms/página de trabajo de margen, 74,4 % `recognizeCall`) a lo que este
análisis mide. **Proyección, no medición** — el ahorro real solo se sabe
implementando y midiendo (Handoff §5.6, Plan §5).

**I-1** (saltear la lectura si el residuo es cero, antes de leer). En P2,
100/100 tiras activas tienen residuo cero (§2, §3) — la regla saltearía la
lectura completa de esas 100 tiras, sin excepción, en este documento.
Proyectado: elimina prácticamente el 100 % del trabajo de margen medido para
un documento con el perfil de P2 (~301 ms/página × 50 páginas ≈ 15,0 s de
trabajo, ≈ 7,5 s de pared con dos reconocedores) — muy por encima del piso
del 20 % (~1,2 s) que fija el Plan §5. En qa-stamp la regla exacta **no**
salta ninguna de las dos tiras (residuo ≠ 0 en ambas): el sello se sigue
leyendo. En T5 rotado, la regla saltearía las 8 tiras, sin costo — no
aportaban palabras de todos modos.

**I-2** (recortar a la caja de tinta residual). Acá el análisis deja un
resultado más incómodo que uno limpio: **P2 no tiene nada que recortar**. Con
residuo cero en las 100 tiras, no existe una `residualBox` sobre la que I-2
actúe — su beneficio marginal sobre P2, específicamente, es cero, porque I-1
ya elimina la lectura entera. El único dato de este análisis con residuo
distinto de cero es qa-stamp (2 tiras): ahí, recortar al alto de
`residualBox[0]` reduciría la tira izquierda a 12,6 % de su alto (~87 % menos
píxeles en esa pasada) y la derecha a 70,7 % (~29 % menos). Pero dos tiras de
un fixture sintético de una sola página no alcanzan para proyectar una
fracción del costo total de margen con la misma confianza que P2: **no hay
suficientes tiras con residuo distinto de cero, en este análisis, para
decidir si I-2 cruza el piso del 20 % en un documento normal.** Lo que sí
queda claro es que I-1 e I-2 tienden a aplicar a poblaciones de tiras
distintas y casi disjuntas en estos datos (P2: 100 % residuo cero; qa-stamp:
0 % residuo cero) — cuánto pesa cada población en un corpus real es lo que
este análisis no midió.

## 8. Corridas inválidas y límites del análisis

- **`case-t5rotated-invalid-v1/` y `t5rotated-angle-break-validation-invalid-v1/`**:
  generadas con el instrumento antes del fix de §1.2. `projectionMismatches`
  de esos archivos es un falso positivo conocido; los demás campos
  (`inkPixels`, `residualInkPixels`, `maskedWordBoxes`,
  `wouldSkipByWhiteGate`, `wordsAddedByThisStrip`) no estaban afectados por
  ese bug, pero se descartó el archivo completo en vez de rescatar campos
  sueltos — un `analysis.json` con un campo conocido-malo mezclado es
  exactamente el tipo de artefacto que esta campaña existe para evitar.
- **Corpus de un solo documento por fixture.** P2 es un documento
  administrativo de 50 páginas sin sellos; qa-stamp es un sintético de una
  página diseñado para tener contenido rotado. No hay un tercer punto que
  muestre, por ejemplo, un documento con residuo "chico pero no cero" — el
  Plan §3 contempla ese régimen intermedio explícitamente y esta campaña no
  lo encontró en ninguno de los cuatro fixtures (§2: 0 tiras en las columnas
  "No/0" y solo 2 en "No/>0", ambas con residuo grande, no chico).
- **`edge.test.ts` — límite de diseño del instrumento, no un bug pendiente.**
  Insertar el análisis de tinta antes de la lectura de `isVisuallyWhiteStrip`
  rompía `"ink-gate uncertainty fails open"`: ese test simula que la PRIMERA
  lectura de `.data` de una tira falla una vez, para probar que la compuerta
  de ADR-162 falla abierta (Handoff/ADR-162 §13 caso 23, "una excepción abre
  la compuerta"). El análisis, sin `try/catch` y antes de esa lectura,
  consumía la falla-única antes de que la compuerta la viera — habría hecho
  pasar un test verde midiendo el camino equivocado. El test estaba midiendo
  algo real y seguía teniendo razón: se resolvió reordenando (la compuerta
  conserva su lectura y su posición exactas; el análisis corre después,
  envuelto en su propio `try/catch`) en vez de tocar el test. Consecuencia
  para los datos: **si el análisis de tinta llegara a fallar sobre una tira
  real** (lectura de píxeles que lanza), esa tira simplemente no aparece en
  `marginInkStrips` — no hay ningún caso así en las 112 tiras de esta
  campaña, pero es un modo de "dato faltante silencioso" que un consumidor
  futuro de este instrumento debería saber que existe.
- **Definición de tinta.** El umbral de ADR-164 §5.1 discrimina texto negro
  sintético (qa-stamp) y texto real de un escaneo limpio (P2); no se probó
  contra tinta tenue de un escaneo de mala calidad — el propio ADR ya lo
  declara así.
- Ninguna corrida quedó fuera por timeout, cancelación, o falla de pipeline:
  las cinco invocaciones válidas (P2, qa-stamp, márgenes blancos, T5 rotado,
  T5 rotado con la rotura #2) dieron `cold.ok = hot.ok = true`.

## 9. Hallazgo colateral: el mismo patrón de bug vive en el kernel de producto

Esto es un subproducto de la campaña, no parte de M-1/M-2 — **no se tocó
ningún archivo de `packages/**` fuera del instrumento descartable, y esta
sección no recomienda ni implementa una corrección.**

El bug de §1.2 (pasar `uprightWidth/uprightHeight` donde `unrotateBbox`
espera las dimensiones del raster original) es un error de este instrumento,
en código descartable. El planificador revisó `recognizeRotatedMargins` a
partir de este hallazgo y encontró **el mismo patrón, ya en producto**: la
línea `unrotateBbox(inUpright, orientation, uprightWidth, uprightHeight)`
(kernel.ts, camino de composición del bbox final de una palabra candidata
rotada) recibe las mismas dimensiones enderezadas donde la función pide las
originales — verificado por el planificador con un script, no de memoria.
`toWords` (la otra llamada a `unrotateBbox` con `degrees = orientation` en
el mismo archivo) sí pasa `image.widthPx/heightPx`, las originales: las dos
llamadas a la misma función, en el mismo archivo, no coinciden en qué
dimensiones le corresponden.

**Por qué ningún test lo encontró — hipótesis a confirmar con datos propios
de esta campaña, según pidió el planificador.** La línea corre solo para
candidatas que ya pasaron el filtro de confianza
(`raw.confidence < ROTATED_MIN_CONFIDENCE`) y tienen texto no vacío — antes
de eso, un `continue` nunca llega a construir el bbox. Esta campaña midió
`wordsAddedByThisStrip = 0` en las 8 tiras de T5 rotado (§6): ningún
candidato de este fixture sobrevivió hasta convertirse en palabra. Esto es
consistente con la hipótesis del planificador de que los 108 candidatos
crudos de T5 rotado se descartan **todos por confianza** — ese dato puntual
(cuántos de los 108 pasan el filtro de confianza antes de llegar a la línea)
no lo mide este instrumento, que solo cuenta sobrevivientes finales, no
descartes por etapa; viene de
`ImageData_Perfilado_Resultados.md` §11.4 ("108 candidatas crudas, las 108
descartadas por confianza"), medido por el instrumento de la campaña
anterior sobre el mismo fixture. Las dos mediciones, juntas, son consistentes
con que la línea buggy nunca ejecutó con una candidata real en ningún test ni
campaña hasta ahora — ninguna caja rotada de margen, en los fixtures
medidos, llegó viva a esa línea. **Esta campaña no midió si esa hipótesis
vale fuera de T5 rotado y qa-stamp** (qa-stamp sí tiene candidatas que
sobreviven — 21 palabras — pero es orientación 0, donde el bug es un no-op;
no hay en este análisis un fixture con candidatas sobrevivientes reales en
orientación ≠ 0 que hubiera podido delatar el bug por una palabra mal
ubicada).

Sin cambios de código de producto, sin test nuevo, sin tocar
`OCR_Engine.md` — queda a criterio del planificador si amerita su propio
commit, módulo y test de regresión.
