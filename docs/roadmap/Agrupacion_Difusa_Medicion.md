<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,core/Grouping_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 4b, antes/después macOS 2026-09-24 y repetición Windows 2026-09-25; cerrado) -->

# Búsqueda difusa de Grouping — antes y después en macOS, repetido en Windows

## Hallazgo

Con 250/500/1000/2000 entidades `Person` realmente distintas y de **36
caracteres cada una**, el tiempo de `processOccurrence` fue 0,22/0,90/3,62/
14,53 segundos: cerca de **4× por cada duplicación**. El lookup de grupo
consumió casi todo ese tiempo. Un control de los mismos tamaños con **24
valores distintos repetidos** terminó en 9–75 ms. R1/R2 reales fueron aún
pequeños en trabajo efectivo de Grouping. El problema medido es el peor caso de
muchos alias nuevos de texto libre; no se le atribuye la duración del pipeline
de los documentos reales.

La distancia acotada de ADR-182 redujo el caso de 2.000 distintos de **14,53
a 3,26 s**. El recorte exacto de afijos de ADR-183 lo redujo de nuevo a
**1,50 s**. Ambas fases conservaron fingerprints y orden en los 30 controles
de cada banco y en R1/R2 reales. El control repetido quedó prácticamente
igual. **Todavía hay 1,50 s de bloqueo** al entregar 2.000 entidades
distintas en un mismo bucle síncrono: el número de candidatos sigue creciendo
cuadráticamente. Es una mejora medida, no el cierre completo del peor caso.

`GROUPING_FINISHED.durationMs` mide tiempo desde `startSession`, que se abre
antes de Regex/NER. En R1/R2 fue de 33–40/15–16 s, pero **incluye los
detectores** y no es CPU de Grouping. Para este informe se sumó por separado
el tiempo de `processOccurrence`; el lookup instrumentado incluye el pase
exacto y el difuso, así que se rotula **lookup inclusivo** y no tiempo puro de
Levenshtein.

## Protocolo y exclusiones

El arnés opt-in `tests/perf/grouping-worst-case.ts` usa el `GroupingEngine` y
el bus reales en procesos aislados. Ejecutó tres rondas intercaladas por
tamaño y corpus; el adverso generó claves de distancia suficiente para
verificar `n` grupos/alias/miembros, y el control mantuvo 24 grupos/alias con
`n` miembros. Se conservaron fingerprints y orden idénticos entre rondas.
`caffeinate` evitó suspensión observada; no hubo benchmarks en paralelo.
Resultados numéricos finales ignorados por Git:
`.measure/grouping-worst-case/20260924T-corrected/`.

La repetición posterior a ADR-182 completó también 30 archivos numéricos en
`.measure/grouping-worst-case/20260924T060210Z/`. Todos los tamaños y rondas
conservaron conteos, huella de grupos y huella de orden frente al control
válido. No se observó suspensión; se ejecutó en serie. Las medianas
post-cambio se indican más abajo; son de la misma Mac, no una cota portable.

La segunda repetición, después de ADR-183, quedó en
`.measure/grouping-worst-case/20260924T-affix-post-2/` (24 controles sintéticos)
y `.measure/grouping-worst-case/20260924T-affix-real-post/` (seis corridas
reales). Las 30 huellas, formas y órdenes igualaron sus baselines. Dos
invocaciones parciales durante la calibración del runner se excluyeron y se
conservaron en `20260924T-affix-post-partial-invalidated/`; no entran a ninguna
mediana. `dist` quedó restaurado.

La primera versión del control repetido creaba valores demasiado parecidos:
Grouping los fusionó en un único grupo. Además, el primer control real
atribuía erróneamente `GROUPING_FINISHED.durationMs` a CPU del motor. **Esas
mediciones están invalidadas** y preservadas en
`.measure/grouping-worst-case/20260924T053304Z-invalidated/`; los doce casos
de valores realmente distintos sí eran válidos y fueron copiados sin alterar
al conjunto final. Se repitieron doce controles corregidos y seis corridas
reales con sonda de `processOccurrence`.

| Ocurrencias sintéticas | Caracteres de valores | Distintas: proceso / lookup inclusivo | Repetidas: proceso / lookup inclusivo | Grupos distintas / repetidas |
|---:|---:|---:|---:|---:|
| 250 | 9.000 | 220,45 / 211,45 ms | 9,43 / 2,90 ms | 250 / 24 |
| 500 | 18.000 | 902,96 / 885,11 ms | 13,76 / 3,08 ms | 500 / 24 |
| 1.000 | 36.000 | 3.616,19 / 3.569,10 ms | 27,35 / 3,60 ms | 1.000 / 24 |
| 2.000 | 72.000 | 14.533,56 / 14.365,06 ms | 74,81 / 4,42 ms | 2.000 / 24 |

| Ocurrencias | Distintas post: proceso / lookup inclusivo | Repetidas post: proceso / lookup inclusivo | Factor del proceso distinto |
|---:|---:|---:|---:|
| 250 | 61,06 / 53,33 ms | 9,20 / 2,29 ms | 3,61× |
| 500 | 216,23 / 201,15 ms | 13,43 / 2,28 ms | 4,18× |
| 1.000 | 824,68 / 787,63 ms | 26,85 / 2,88 ms | 4,38× |
| 2.000 | 3.257,50 / 3.141,29 ms | 74,81 / 3,83 ms | 4,46× |

| Ocurrencias | Distintas ADR-183: proceso / lookup inclusivo | Repetidas ADR-183: proceso / lookup inclusivo | Factor frente a ADR-182 |
|---:|---:|---:|---:|
| 250 | 34,74 / 27,54 ms | 8,73 / 1,78 ms | 1,76× |
| 500 | 109,87 / 95,30 ms | 13,17 / 2,18 ms | 1,97× |
| 1.000 | 390,36 / 357,38 ms | 26,65 / 2,50 ms | 2,11× |
| 2.000 | 1.499,05 / 1.394,30 ms | 75,31 / 3,66 ms | 2,17× |

Medianas de tres rondas. La cantidad de **caracteres por entidad** importa:
este generador usa 36, más que muchas entidades de R1/R2; por ello no se
compara directamente con los 2,1 s del relevamiento anterior de 2.000
entidades de otra forma. Un timer de cancelación programado a 1 ms se despachó
solo al terminar el bucle síncrono, con retrasos adversos de
220/903/3.616/14.534 ms; es un control del bloqueo del hilo, **no** una
llamada real al botón `cancel()`.

## Controles reales

El arnés `grouping-real-docs.spec.ts` importó R1/R2 mediante el pipeline
Electron empaquetado. Texto y PDF permanecieron en la app; a los JSON solo
salieron contadores, tiempos, tamaños y huellas con IDs neutros. Tres rondas
por documento, seis válidas, sin suspensión, con grupos y orden idénticos.

| Documento | Ocurrencias | Suma caracteres de valores / máximo | Grupos / alias / miembros | `processOccurrence` por ronda | Lookup elegible por ronda |
|---|---:|---:|---:|---:|---:|
| R1 nativo | 308 | 3.383 / 77 | 123 / 126 / 304 | 14,43 / 15,93 / 15,35 ms | 5,50 / 6,46 / 5,71 ms |
| R2 escaneado | 223 | 2.870 / 34 | 72 / 82 / 179 | 8,03 / 8,01 / 8,77 ms | 2,41 / 2,53 / 2,74 ms |

Post-cambio, la mediana de `processOccurrence` fue **13,97 ms en R1** y
**7,29 ms en R2**; la mediana del lookup elegible fue **4,14/1,64 ms**.
Grupos/alias/miembros y las dos huellas permanecieron idénticos en las tres
rondas de cada documento. Los máximos huecos del event loop post fueron
11,82/25,75/13,12 ms en R1 y 12,85/11,84/13,10 ms en R2: la variación de
R1 impide atribuir una mejora del event loop real a este cambio.

Tras ADR-183, `processOccurrence` fue 12,26/13,42/14,25 ms en R1 y
6,88/6,70/6,93 ms en R2; el lookup elegible fue 3,86/4,40/4,41 ms y
1,57/1,58/1,61 ms, respectivamente. Los máximos huecos del event loop fueron
11,76/11,94/11,94 ms y 12,30/12,98/11,91 ms. R1 conservó 308 ocurrencias,
3.383 caracteres de valor, 123 grupos/126 alias/304 miembros; R2 conservó
223, 2.870 caracteres, 72/82/179. Las huellas y el orden fueron exactos
frente a las rondas previas. Con valores medios de 10,98 y 12,87 caracteres
por ocurrencia, respectivamente, estos documentos no ejercen el adverso de
2.000 entidades distintas de 36 caracteres. El tiempo de sesión completa no
se atribuye a Grouping.

El lookup elegible contó 298 llamadas en R1 y 173 en R2 para los tipos que
admiten difuso. No se registró qué proporción terminó por exacto frente a
distancia; esta sonda no autoriza atribuir todos sus milisegundos a
Levenshtein. El mayor hueco observado del event loop por corrida fue
11,78–21,82 ms en R1 y 11,93–14,99 ms en R2. La carga textual de toda la
página y el número de páginas no sustituyen los **valores/alias candidatos**
que recibe Grouping.

## Decisión de planificación

ADR-182 especificó la distancia Levenshtein con banda y corte temprano;
ADR-183, el recorte exacto de afijos antes de esa banda. Ambos conservan la
comparación normalizada final y la **primera coincidencia elegible**. Las
30 huellas y la mejora total de 9,70× a 2.000 distintos respaldan estas dos
fases. El algoritmo aún revisa todos los grupos candidatos: la curva de
250/500/1000/2000 continúa cerca de 4× por duplicación, y a 2.000 bloquea
unos 1,50 s. **La robustez temporal del peor caso no está cerrada.** Un índice
de candidatos de recall completo, con mantenimiento de alias, merges, splits
y cambios de tipo, requerirá un ADR separado y su propio banco. Windows nativo
ventilado se repetirá cuando el equipo esté disponible.

### Filtro por trigramas evaluado y descartado

Se probó fuera del motor una condición necesaria basada en trigramas UTF-16,
con caché de firmas por alias. El arnés
`tests/perf/grouping-trigram-feasibility.ts` comparó 12.000 pares con el
comparador completo, más 500 búsquedas de primera coincidencia; no observó
falsos negativos ni cambios de orden. En el corpus adverso de 2.000 valores,
sin embargo, **no descartó ninguno de los 1.999.000 pares**: el prefijo común
de los valores basta para superar la cota. En esa corrida de factibilidad, el
tiempo directo fue 3.974 ms y con el filtro 5.136 ms. Es una sola corrida de
un modelo reducido del lookup, no una nueva mediana del motor ni un resultado
R1/R2. Los datos están en
`.measure/grouping-trigram-feasibility/grouping-trigram-feasibility.json`.
No se incorpora el filtro al producto.

### Recorte de afijos comunes: factibilidad y segunda fase

Una segunda sonda, `tests/perf/grouping-common-affix-feasibility.ts`, recortó
prefijo y sufijo comunes antes de la DP, manteniendo el radio y el denominador
originales. Pasó 16.000 pares diferenciales y 600 búsquedas con múltiples
alias sin diferencia booleana, de huella ni de primera coincidencia. En tres
rondas del modelo de lookup, las medianas para 250/500/1000/2000 valores
distintos fueron **51/211/861/3471 ms** con el predicado actual y
**20/81/324/1313 ms** con el recorte: 60,5–62,3 % menos tiempo según tamaño.
El control repetido cambió menos de 1 ms en valor absoluto. Esta sonda no
ejecutó el `GroupingEngine` ni R1/R2; sus datos quedan en
`.measure/grouping-common-affix-feasibility/`. ADR-183 y el spec v1.12.0
definieron la segunda implementación interna. El banco completo confirmó una
reducción adicional de 54 % a 2.000 valores, hasta 1,50 s, sin cambiar R1/R2.
El costo sigue cuadrático y todavía supera un segundo.

---

## Repetición Windows nativo (2026-09-25)

> Commit `ee5eeba` (`hardening/plan-2026-09`) — el código YA incluye ADR-182
> y ADR-183, así que esta corrida mide el estado final, no un antes/después.
> Windows 11 Pro build 26200, i5-12400, 16,9 GB RAM, nativo (Git Bash, no
> WSL). Puerto del arnés: mismas tres diferencias de instrumentación que el
> resto de la campaña Windows de este equipo (gate `Darwin` retirado,
> `caffeinate` omitido —sin equivalente en Windows; no se observó suspensión
> en esta corrida de ~15 min sobre un equipo de escritorio conectado a
> corriente, pero a diferencia de macOS **no está activamente prevenida**—,
> guarda `pgrep` retirada). 30 casos sintéticos + 6 corridas reales, **0
> fallidas**, huellas y orden idénticos entre las tres rondas de cada caso.

### Hallazgo 1 — el peor caso sintético es más lento en Windows, no más rápido

Con ADR-182+183 aplicados en las dos plataformas, el caso adverso de 2.000
entidades distintas de 36 caracteres tardó **2.595 ms** en esta máquina
contra **1.499 ms** en la Mac — **~1,73× más lento**, pese a que esta CPU es
más rápida que el M1 para inferencia ONNX (`Hilos_NER_Medicion.md`).
**No era el mismo código** (ver la corrección antes del Hallazgo 2): sobre
`defa7a2`, el commit de la Mac, Windows da 2.396 ms, **~1,6×**.
El patrón se repite en los cuatro tamaños y en el corpus repetido:

| Ocurrencias sintéticas | Windows distintas (proceso / lookup) | macOS distintas (proceso / lookup, ADR-183) | Windows repetidas (proceso / lookup) | macOS repetidas (proceso / lookup) |
|---:|---:|---:|---:|---:|
| 250 | 70,66 / 51,93 ms | 34,74 / 27,54 ms | 20,43 / 4,67 ms | 8,73 / 1,78 ms |
| 500 | 191,10 / 156,29 ms | 109,87 / 95,30 ms | 32,10 / 5,38 ms | 13,17 / 2,18 ms |
| 1.000 | 691,28 / 598,25 ms | 390,36 / 357,38 ms | 59,26 / 5,39 ms | 26,65 / 2,50 ms |
| 2.000 | 2.595,05 / 2.287,55 ms | 1.499,05 / 1.394,30 ms | 162,45 / 6,63 ms | 75,31 / 3,66 ms |

**No se investigó la causa** — puede ser el motor JS de esta build de
Electron/V8 sobre Windows, diferencias de normalización de cadena, o algo
específico de esta máquina; esta campaña no lo aísla. Lo que sí queda
establecido: el costo cuadrático de ADR-182/183 **no es una cota portable**,
y "1,50 s de bloqueo a 2.000 distintos" (la cifra que cerraba la Mac) **no es
el número de Windows** — acá son 2,60 s. La curva sigue siendo
aproximadamente 4× por duplicación en las dos plataformas (factor Windows
2000→1000: 2595/691=3,75×; 1000→500: 691/191=3,62×; 500→250: 191/71=2,70×),
así que el problema estructural (revisar todos los grupos candidatos) es el
mismo; solo la constante cambia, y en la dirección contraria a lo que
sugeriría "esta máquina es más rápida".

> **Corrección (2026-09-25, `OCR_Entre_Plataformas_Medicion.md`):** esta
> sección comparaba Windows sobre `ee5eeba` contra macOS sobre `defa7a2`, y
> entre esos commits entraron 21 commits de producto (Grouping ADR-170 a 178,
> `core`, `shared`). No era "el mismo código" como dice el encabezado. Se
> repitió en Windows sobre `defa7a2` para separar plataforma de código; los
> números corregidos van abajo, junto a los originales.

Hallazgo 1 con el mismo código: el peor caso sintético de 2.000 distintas, en
Windows sobre `defa7a2`, tardó **2.485 / 2.370 / 2.396 ms** (mediana 2.396),
intercalado con `ee5eeba` en la misma sesión (**2.563 / 2.668 / 2.601 ms**,
mediana 2.601; misma huella de grupos). La plataforma explica **~1,6×**
contra los 1.499 ms de la Mac; los commits posteriores suman **~8,5 %**. La
conclusión del Hallazgo 1 se sostiene, con ese ajuste de magnitud.

### Hallazgo 2 — R2 detectó 4 ocurrencias más que en macOS

| Documento | Ocurrencias | Grupos / alias / miembros | `processOccurrence` | Lookup elegible |
|---|---:|---:|---:|---:|
| R1 nativo, Windows `ee5eeba` | 308 | 123 / 126 / 304 | 21,34 ms (mediana) | 5,34 ms |
| R1 nativo, Windows `defa7a2` | 308 | 123 / 126 / 304 | 15,93 ms (una ronda) | 5,39 ms |
| R1 nativo, macOS `defa7a2` | 308 | 123 / 126 / 304 | 13,42 ms | 4,40 ms |
| **R2 escaneado, Windows `ee5eeba`** | **227** | **76 / 83 / 182** | 15,83 ms (mediana) | 2,49 ms |
| **R2 escaneado, Windows `defa7a2`** | **227** | **76 / 83 / 182** | 10,83 ms (mediana de 3) | 2,46 ms |
| R2 escaneado, macOS `defa7a2` | 223 | 72 / 82 / 179 | 6,70 ms | 1,58 ms |

**Las 4 ocurrencias de más no son del código**: Windows da 227/76 en los dos
commits, con el mismo `groupingFingerprint`. **Son del OCR según la
plataforma**, y la causa quedó aislada en `OCR_Entre_Plataformas_Medicion.md`:
el ráster de la página que llega a Tesseract difiere cuando el canvas 2D está
acelerado por GPU y la imagen se reescala al rasterizar. Con píxeles
idénticos, Tesseract da salida idéntica. Linux (WSL, raster por software) da
un tercer valor, 225/73. Los conteos de documentos escaneados **no se
comparan entre plataformas**.

`processOccurrence` en documentos reales **sí mezclaba código y plataforma**.
Con el mismo código, Windows queda ~19 % por encima de la Mac en R1 (15,93
contra 13,42 ms; una sola ronda en `defa7a2`), y los commits posteriores
suman otro ~34 % (21,34 ms). En R2 la comparación además arrastra 4 grupos
más en Windows, así que no se separa limpio.

### Conclusión

La robustez temporal del peor caso de Grouping **no está cerrada en ninguna
plataforma**, y en esta máquina el número absoluto es peor que en la Mac, no
mejor: 2,40 s contra 1,50 s a 2.000 entidades distintas con el mismo código
(2,60 s con el código de `ee5eeba`). La calidad (huellas, orden, conteos) es
estable dentro de cada plataforma entre rondas. La diferencia de conteo de R2
entre plataformas viene del OCR, no de Grouping
(`OCR_Entre_Plataformas_Medicion.md`). Ninguna de las dos observaciones cambia
la decisión ya tomada en ADR-182/183; ambas son datos nuevos para quien
decida si hace falta un índice de candidatos de recall completo (la mejora
pendiente que ya señalaba la sección de macOS).
