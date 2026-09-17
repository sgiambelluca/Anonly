<!-- CONTEXT: scope=reporte-de-ejecucion | dependencias=roadmap/Margenes_Menos_Pixeles_Handoff.md,roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/ImageData_Perfilado_Resultados.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=planificador+humano | fase=11 -->

# Márgenes — resultados de M-1 + M-2 + M-1b (tinta residual y su caja)

Fecha: 2026-09-16. Ejecutado por el implementador según
[`Margenes_Menos_Pixeles_Handoff.md`](Margenes_Menos_Pixeles_Handoff.md),
incluido su §8 (M-1b, agregado el mismo día). Este es un **reporte de
ejecución**: mide y describe, no elige entre I-1/I-2/I-3 ni recomienda una
optimización — esa decisión es del planificador, con este análisis en la
mano (Handoff §5/§8.4, Plan §7).

**La correlación que decide es la de §2, bajo el criterio EXACTO de
ADR-162** — no la de brillo de ADR-164 §5.1 que usó la primera pasada de
este reporte. §8 explica por qué, con el error propio del planificador que lo
motivó.

Evidencia cruda: `.measure/margenes-tinta/20260916-351fc4d3/` (M-1, HEAD de
referencia `4896151`, histórico) y su subdirectorio `m1b/` (M-1b, HEAD de
referencia `3650ce7`, vigente). `HEAD` avanzó dos veces durante la campaña:
a `e1aac58` cuando se commiteó el T5 compartido, y a `3650ce7` cuando se
corrigió el bug de producto que §10 describe — ninguna de las dos afectó los
fixtures ni el criterio de píxeles. **No usar `4896151` ni `reference.patch`
para nada activo**: son historia. `key-files.sha256` (raíz de la campaña,
HEAD `e1aac58`) y `m1b/key-files-m1b.sha256` (HEAD `3650ce7`, ver
`m1b/REFERENCE-NOTA.md`) son las verificaciones de contenido vigentes; los
ocho archivos dan `OK` contra el archivo que corresponde a cada HEAD, y
`git status --porcelain` no muestra ningún archivo de `packages/**` ni
`apps/**` modificado al cerrar cada ronda.

## 0. Alcance

M-1 + M-2 + M-1b en corridas por fixture: cuánta tinta del margen queda sin
explicar tras proyectar las palabras de la pasada derecha, bajo **dos**
definiciones de tinta medidas en la misma pasada de píxeles, y dónde está.
**No se implementó I-1, I-2 ni I-3**, no se tocó la compuerta de ADR-162, el
número de pasadas, el DPI ni el recorte de franja. No se midió la variante de
I-1 que enmascara píxeles antes de reconocer. Sin commit, sin push.

## 1. Validación del instrumento — antes de confiar en cualquier número

### 1.1 Camino de escala (px↔pt) — qa-stamp, orientación 0

Se corrompió `dpi + 5` en el factor de escala de `projectWordBboxToStrip`,
dejando intacta la verificación de ida y vuelta.

| Corrida | `projectionMismatches` |
| --- | --- |
| Con la rotura | **116** |
| Revertida y reconstruida | **0** (hash del chunk `kernel-*.js` bit a bit igual al previo a la rotura) |

### 1.2 Camino de rotación (`unrotateBbox` con ángulo complementario) — T5 rotado

Acá el instrumento **falló de verdad primero**, no como experimento
controlado: la corrida oficial de T5 rotado dio `projectionMismatches: 660`
(330 en cada página de 90°/270°, cero en 0°/180°) — la firma de un bug real,
no ruido. **Causa:** la verificación de ida y vuelta reaplicaba
`unrotateBbox(backToUpright, orientation, uprightWidth, uprightHeight)`, y
esa llamada exige las dimensiones del raster **original**, no las del
enderezado (iguales en 0°/180°, intercambiadas en 90°/270°). La proyección
`box` que realmente enmascara tinta no tenía este bug: solo la verificación.
Corregido en `projectWordBboxToStrip`. Las corridas con el bug quedaron
archivadas como inválidas (`case-t5rotated-invalid-v1/`,
`t5rotated-angle-break-validation-invalid-v1/`, con su `INVALID.md`).

Con el fix, la prueba de rotura real sobre la **proyección** (no la
verificación):

| Corrida | mismatches 0° | 90° | 180° | 270° | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Instrumento corregido | 0 | 0 | 0 | 0 | **0** |
| Rotura deliberada (ángulo sin complementar) | 0 | 330 | 0 | 330 | **660** |

Después, el planificador encontró **el mismo patrón de bug, ya en
producto**, a partir de este hallazgo — ver §10.

### 1.3 Invariante nuevo de M-1b (Handoff §8.3)

`residualExact[d] >= residualInkPixels[d]` para los `d` compartidos, e
`inkPixelsExact >= inkPixels` en total — un píxel oscuro (`v < 128`) nunca es
blanco puro, así que el criterio exacto cuenta un superconjunto. Roto a
propósito en `marginInk.test.ts` (dos casos: total y por-`d`) antes de
confiar en él. Sobre datos reales: **0 violaciones en las 112 tiras
medidas por M-1b** (100 P2 + 2 qa-stamp + 2 márgenes blancos + 8 T5 rotado),
verificado además a mano sobre P2 (`inkPixelsExact` mediana 4.176 contra
`inkPixels` mediana 3.129; `residualExact[1] = 0` en las 100 tiras contra
`residualInkPixels[1] = 0` en las mismas 100 — el superconjunto se cumple con
margen, no por casualidad de empate).

## 2. La correlación que decide — bajo el criterio EXACTO de ADR-162 (Handoff §8.4)

Por cada tira, `residualExact[0] === 0` contra `wordsAddedByThisStrip`, sobre
las mismas 112 tiras:

| Fixture | Sí / 0 | Sí / >0 | No / 0 | No / >0 | Filas descalificantes |
| --- | ---: | ---: | ---: | ---: | --- |
| P2 (100 tiras) | 0 | 0 | **100** | 0 | ninguna |
| qa-stamp (2 tiras) | 0 | 0 | 0 | **2** | ninguna |
| márgenes blancos (2 tiras) | **2** | 0 | 0 | 0 | ninguna |
| T5 rotado (8 tiras) | 0 | 0 | **8** | 0 | ninguna |
| **Total (112 tiras)** | **2** | **0** | **108** | **2** | **ninguna** |

**Bajo el criterio exacto, en `d = 0`, el residuo nunca es cero salvo en
márgenes blancos (donde no hay tinta bajo ningún criterio).** Las 100 tiras
de P2 y las 8 de T5 rotado caen en "No / 0": queda tinta sin explicar, pero
esa tinta no aporta ninguna palabra. Siguen sin aparecer filas
descalificantes — ninguna tira con residuo cero aportó una palabra, en
ninguno de los cuatro fixtures — pero el resultado ya no es "residuo cero en
110/112 tiras" de la medición anterior: es **residuo cero en solo 2/112**,
las de márgenes blancos.

## 3. Dónde se apaga el residuo — `smallestZeroDilation` (Handoff §8.4)

Distribución sobre las 112 tiras (valor = `d` de `MARGIN_INK_EXACT_DILATIONS
= [0,1,2,3,4,6,8]`, o `null` si no se apaga en ningún escalón):

| Fixture | `d=0` | `d=1` | `d=2..8` | `null` |
| --- | ---: | ---: | ---: | ---: |
| P2 (100) | 0 | **100** | 0 | 0 |
| T5 rotado (8) | 0 | **8** | 0 | 0 |
| márgenes blancos (2) | **2** | 0 | 0 | 0 |
| qa-stamp (2) | 0 | 0 | 0 | **2** |

**Las 108 tiras de P2 + T5 rotado apagan el residuo exacto en exactamente
`d = 1`, todas, sin una sola excepción.** `residualExact[0]` en P2 tiene una
mediana de 38 píxeles (mínimo 5, máximo 94, sobre una tira de ~903.582 px) —
chico pero no cero — y `residualExact[1]` es exactamente 0 en las 100. Un
solo píxel de dilatación cierra el residuo por completo, siempre. Las 2 de
qa-stamp no llegan a cero en ningún escalón hasta `d = 8`: en la izquierda
`residualExact` va de 5.126 (d=0) a 4.923 (d=8) y apenas se mueve; en la
derecha, de 13.220 a 13.193. Ahí el residuo no es un borde de antialiasing —
es contenido real que la dilatación no toca.

## 4. Los tres mundos del Plan §8.4 — sin elegir ninguno

| Mundo | Qué se observa | Qué pasó acá |
| --- | --- | --- |
| A — cero en `d=0` | — | No: `residualExact[0]` nunca es cero salvo en márgenes blancos. |
| **B — cero recién con `d>0`** | — | **Sí, y de la forma más uniforme posible**: 108/108 tiras de P2 y T5 rotado (documentos sin sello) se apagan en `d=1` exacto, ninguna necesita más, ninguna se apaga en `d=0`. |
| C — nunca llega a cero | — | Solo en qa-stamp (2/112 tiras) — y ahí el residuo es contenido real, no ruido de borde (§3). |

El resultado cae en el **Mundo B**, y de manera inusualmente limpia: no hay
una mezcla de tiras que se apagan en distintos `d` — es un único valor
(`d=1`) para el 100 % de las tiras sin sello medidas. Esto es consistente con
la hipótesis que el propio Handoff §2.2 planteó antes de medir: "una caja de
palabra de Tesseract puede ser ajustada y dejar afuera el antialiasing del
glifo". Bajo el criterio de brillo (§6), ese medio píxel de gris ya contaba
como "blanco" y el residuo daba cero directo en `d=0` — es decir, **el
resultado "regla exacta sin parámetro" de la medición anterior era en
realidad el Mundo B, disfrazado por un criterio de tinta que absorbía el
mismo borde que ahora se ve.**

Mundo B, por definición del Plan, significa que la regla necesita una
**tolerancia geométrica** — un parámetro, pero de una clase distinta a un
umbral de brillo aproximado: es una dilatación en píxeles ligada al ajuste de
caja de Tesseract, no una intuición sobre cuán oscuro es "tinta". Cuál `d`
usar, y si esa distinción alcanza para evitar los prerrequisitos de T-4b, es
decisión del humano con esta distribución en la mesa — no se elige acá.

## 5. qa-stamp bajo el criterio exacto: el sello sobrevive, con más margen que antes

| Tira | `inkPixelsExact` | `residualExact[0]` | `residualExact[8]` | `smallestZeroDilation` | palabras aportadas |
| --- | ---: | ---: | ---: | ---: | ---: |
| izquierda | 17.262 | 5.126 | 4.923 | `null` | 7 |
| derecha | 13.852 | 13.220 | 13.193 | `null` | 14 |

El criterio exacto cuenta **más** tinta que el de brillo en las dos tiras
(17.262 > 11.025 y 13.852 > 10.123, consistente con el invariante de §1.3), y
el residuo se achica apenas un 4 % entre `d=0` y `d=8` — la dilatación más
generosa de la escalera larga no alcanza a explicar el sello. Bajo cualquier
`d` de la escalera, ninguna de las dos tiras se hubiera saltado: **el sello
sobrevive en el Mundo B igual que sobrevivía bajo el criterio de brillo**, y
con más margen, porque el criterio exacto nunca reduce el residuo, solo
puede agrandarlo (§1.3).

## 6. Resultado bajo el criterio de brillo (ADR-164 §5.1) — la medición original de M-1, superada por §8.1

Se conserva porque sigue siendo un dato real y porque el contraste con §2-§5
es en sí mismo el hallazgo de M-1b. **No es la medición que decide** (§8.1):
es un umbral de brillo, no el criterio exacto de la compuerta de ADR-162.

### 6.1 La correlación bajo brillo (antigua "esto decide")

| Fixture | Sí / 0 | Sí / >0 | No / 0 | No / >0 | Filas descalificantes |
| --- | ---: | ---: | ---: | ---: | --- |
| P2 (100 tiras) | **100** | **0** | 0 | 0 | ninguna |
| qa-stamp (2 tiras) | 0 | 0 | 0 | **2** | ninguna |
| márgenes blancos (2 tiras) | 2 | 0 | 0 | 0 | ninguna |
| T5 rotado (8 tiras) | 8 | 0 | 0 | 0 | ninguna |
| **Total (112 tiras)** | **110** | **0** | **0** | **2** | **ninguna** |

Bajo brillo, 110/112 tiras (98,2 %) tenían residuo cero en `d=0` — el
resultado que, sin §8.1, hubiera dicho "Mundo A". Comparado con §2 (2/112
bajo el criterio exacto), la diferencia completa (108 tiras) es exactamente
el conjunto que el Mundo B explica: apagan en `d=1` bajo el criterio exacto,
y ya estaban en cero bajo brillo porque el umbral de brillo absorbe ese mismo
borde de un solo píxel.

### 6.2 Distribución del residuo de brillo en P2 y cajas

**El residuo de brillo es exactamente cero en las 100 tiras de P2**, en las
cuatro dilataciones de esa escalera (`d=0..3`). `inkBox` (tinta total, sin
enmascarar, bajo brillo) ocupa entre 1,07 % y 3,48 % del alto de la tira
(mediana 2,32 %, n=100). `residualBox[0]`: no aplica en P2 (residuo cero).
`inkPixels` mediana 3.129 px sobre 903.582 px de tira (0,11–0,43 %).
`maskedWordBoxes` mediana 4,5, entre 1 y 7 por tira.

En qa-stamp, bajo brillo: residuo 1.636 px (14,8 % del `inkBox`) en la
izquierda, 9.651 px (95,3 %) en la derecha; caja de residuo 12,6 % y 70,7 %
del alto de la tira respectivamente; curva `d=0..3` plana en las dos (ver
versión anterior de este reporte, sin cambios).

## 7. T5 rotado y márgenes blancos: controles estructurales

**T5 rotado** (8 tiras): 0 palabras aportadas bajo los dos criterios,
`projectionMismatches: 0`, consistente con
`ImageData_Perfilado_Resultados.md` §11.4 ("108 candidatas crudas, las 108
descartadas por confianza") — este fixture no tiene contenido de margen
diseñado para leerse rotado.

**Márgenes blancos** (2 tiras): `inkPixels = 0`, `inkPixelsExact = 0` y
`wouldSkipByWhiteGate = true` en las **dos**, bajo los dos criterios —
ADR-164 §5.1 y el criterio exacto de ADR-162 coinciden en el control
positivo, ahora confirmado también con el predicado exacto reutilizado
literal.

**Frío = caliente** (`coldVsHotIdentical: true`, comparado sin
`documentId`) en las cuatro corridas de M-1b, incluida la segunda pasada de
P2 (100 tiras idénticas entre frío y caliente).

## 8. Ahorro proyectado de I-1 y de I-2 — reconsiderado bajo el Mundo B

Aplicando los costos por etapa de `ImageData_Perfilado_Resultados.md` §11.3
(301 ms/página de trabajo de margen). **Proyección, no medición.**

**I-1 bajo el criterio exacto (Mundo B, `d=1`).** La magnitud no cambia
respecto de la proyección anterior: en P2 y T5 rotado, 108/108 tiras activas
alcanzan residuo cero — con `d=1` en vez de `d=0`, pero el 100 % de la
cobertura es igual. Proyectado: sigue eliminando prácticamente el 100 % del
trabajo de margen medido para un documento con el perfil de P2 (~15,0 s de
trabajo, ≈7,5 s de pared), muy por encima del piso del 20 % (~1,2 s). **Lo
que cambia es la naturaleza de la regla**: ya no es "sin un solo parámetro
nuevo" (Mundo A) — necesita la tolerancia geométrica de `d=1` píxel (Mundo
B), que el Plan §8.4 distingue explícitamente de un umbral de brillo
aproximado, pero que sigue siendo un parámetro a fijar y justificar, no una
regla exacta pura.

**I-1 bajo brillo, para contraste:** proyectaba el mismo ~100 %, pero
parecía no necesitar parámetro — §8.1 explica por qué esa lectura estaba
incompleta.

**I-2** sin cambios respecto de la medición anterior: P2 no tiene
`residualBox` que recortar bajo brillo (residuo cero); qa-stamp (2 tiras) es
la única fuente de datos con residuo positivo, insuficiente para proyectar
con confianza. M-1b no agregó una caja de residuo exacto (Handoff §8.2 no la
pide), así que este punto no tiene una versión "bajo el criterio exacto" que
reportar.

## 9. Corridas inválidas y límites del análisis

- **M-1 (`case-t5rotated-invalid-v1/`, `t5rotated-angle-break-validation-invalid-v1/`)**:
  generadas con el bug de verificación de §1.2, antes del fix. Archivadas con
  su causa; no usadas en ningún número de este reporte.
- **M-1b: cero corridas inválidas.** Las cuatro corridas (T5 rotado, qa-stamp,
  márgenes blancos, P2) dieron `cold.ok = hot.ok = true` y 0 violaciones de
  invariantes al primer intento.
- **Corpus de un solo documento por fixture** (sin cambios respecto de M-1):
  P2 es un documento administrativo de 50 páginas sin sellos; qa-stamp es un
  sintético de una página. No hay un tercer punto con residuo "chico pero
  positivo bajo ambos criterios" que muestre un régimen intermedio distinto
  del Mundo B uniforme que se encontró.
- **`edge.test.ts`** — límite de diseño del instrumento, sin cambios respecto
  de M-1 (ver reporte anterior de esta sección): el análisis de tinta corre
  después de la lectura de `isVisuallyWhiteStrip`, envuelto en su propio
  `try/catch`, para no interferir con el fail-open de ADR-162 que ese test
  verifica. Sigue vigente para M-1b sin modificación.
- **Definición de tinta exacta.** El predicado de `isVisuallyWhiteStrip` es,
  por diseño, sensible a cualquier desviación de blanco puro — no distingue
  ruido de escaneo real de antialiasing de glifo. La escalera larga
  (`d=0,1,2,3,4,6,8`) existe justamente para separar esos dos casos por
  ubicación (§3), no para elegir un `d` — esa elección la reportó §4 sin
  tomarla.

## 10. Hallazgo colateral: el mismo patrón de bug vivía en el kernel de producto — ya corregido

Esto es un subproducto de la campaña, no parte de M-1/M-2/M-1b — **no se
tocó ningún archivo de `packages/**` fuera del instrumento descartable en
ningún momento de esta fase.**

El bug de §1.2 (pasar `uprightWidth/uprightHeight` donde `unrotateBbox`
espera las dimensiones del raster original) era un error de este
instrumento, en código descartable. El planificador revisó
`recognizeRotatedMargins` a partir de este hallazgo y encontró **el mismo
patrón, en producto**: la línea que compone el bbox final de una palabra
candidata rotada recibía las mismas dimensiones enderezadas donde la función
pedía las originales — verificado con un script, no de memoria. `toWords`
(la otra llamada a `unrotateBbox` con `degrees = orientation` en el mismo
archivo) sí pasaba las originales: las dos llamadas a la misma función, en el
mismo archivo, no coincidían en qué dimensiones les correspondía. **Ya está
corregido** (`recognizeRotatedMargins` recibe ahora `originalWidth`/
`originalHeight` como parámetros propios, `HEAD 3650ce7`) — el instrumento de
M-1b corre sobre el árbol ya corregido.

**Por qué ningún test lo había encontrado — hipótesis confirmada con datos
propios de esta campaña.** La línea corre solo para candidatas que ya
pasaron el filtro de confianza y tienen texto no vacío. Esta campaña midió
`wordsAddedByThisStrip = 0` en las 8 tiras de T5 rotado, en M-1 y en M-1b por
igual: ningún candidato de este fixture sobrevivió hasta convertirse en
palabra, bajo ninguno de los dos criterios de tinta. Es consistente con
`ImageData_Perfilado_Resultados.md` §11.4 ("108 candidatas crudas, las 108
descartadas por confianza") — medido por el instrumento de la campaña
anterior, con el detalle por etapa que este instrumento no mide. Las dos
mediciones, juntas, sostienen que la línea buggy nunca ejecutó con una
candidata real en ningún test ni campaña anterior a esta — ninguna caja
rotada de margen, en los fixtures medidos, llegó viva a esa línea. Esta
campaña no midió si esa hipótesis vale fuera de T5 rotado y qa-stamp (qa-stamp
sí tiene candidatas sobrevivientes, pero es orientación 0, donde el bug era
un no-op).

Sin cambios de código de producto realizados por el implementador, sin test
de producto nuevo agregado por el implementador, sin tocar `OCR_Engine.md`.
