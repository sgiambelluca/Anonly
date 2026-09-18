<!-- CONTEXT: scope=roadmap-medicion | tarea=T-7 | dependencias=roadmap/Perfilado_Base_Caliente_Plan.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,tests/perf/README.md | audiencia=planificador+humano | fase=11 -->

# T-7 — Medición: de qué está hecha la línea de base caliente

Ejecutada el 2026-09-17, commit `edd2204`, sobre `.measure/base-caliente/20260917T215457Z/`
(manifiesto, logs de build/Playwright y los 12 JSON crudos ahí, sin pisar
ninguna tanda previa). Doce corridas: P1 y P2, NER on/off alternado por
corrida, 3 repeticiones por condición, instancia fresca de Electron
empaquetado por corrida, seriales (`workers: 1`, `retries: 0`). Las 12
terminaron `ok: true`, con `standardBaselineSettled: true` y con muestra real
en los 8 checkpoints de cada corrida — sin descartes.

**Es una medición, no un cambio de producto.** No se tocó `packages/` ni
`apps/`; el arnés entero vive en `tests/perf/` (§7 más abajo). No se cambió
`HOT_BASELINE_SETTLE_CEILING_MS` ni `idleDisposeMs`. Este documento no
recomienda ni decide ningún lever — eso es del humano, con su propio ADR
(ADR-154 §1/§5).

> **Qué pasó después (2026-09-18).** Sobre este resultado el humano decidió
> **ADR-166**: liberar el modelo de NER al terminar la detección, en vez de
> esperar el minuto de `idleDisposeMs`. Está implementado. Su verificación
> confirmó el costo y **no pudo demostrar el beneficio de memoria** —
> [`Verificacion_Liberacion_NER_Medicion.md`](Verificacion_Liberacion_NER_Medicion.md) —,
> así que los números de §2 de este informe siguen siendo la mejor descripción
> disponible del comportamiento **anterior** a ADR-166, y solo de ese.

## 0. Veredicto, antes de los datos

**La hipótesis del plan (§2) se confirma, y el hallazgo es más grande que un
escalón.** No es solo que aparezca una caída cerca de los 60 s: es que la
"base caliente" que la campaña venía publicando desde ADR-146 —tomada en una
ventana ≤30 s— es ella misma un estado **transitorio**, no un piso. Promedios
de las tres corridas por condición, base estándar (≤30 s) contra el valor a
t=120 s:

| perfil/condición | base ≤30s (avg) | t=120s (avg) | recuperado |
|---|---:|---:|---:|
| P1 — NER on | 1506,0 MB | 583,9 MB | 922,1 MB (61,2 %) |
| P1 — NER off | 676,7 MB | 537,0 MB | 139,7 MB (20,7 %) |
| P2 — NER on | 1393,7 MB | 366,1 MB | 1027,6 MB (73,7 %) |
| P2 — NER off | 1177,3 MB | 545,8 MB | 631,5 MB (53,6 %) |

("recuperado" acá es base≤30s − t120s; §2 usa la definición literal del plan,
t=5s → t=120s, que da números algo distintos porque la base ≤30s a veces
captura la corrida **antes** de asentar del todo — ver §2.1.)

**El hueco de 700 MB–1,2 GB "sin atribuir" de `Optimizacion_De_Memoria_Plan.md`
§1bis se disuelve.** No era memoria retenida sin explicación: era memoria en
tránsito hacia su liberación, medida antes de que esa liberación ocurriera. La
premisa de esa sección —que hubiera un residuo estructural del mismo orden que
los componentes conocidos— no se sostiene con estos datos (§5).

**Pero esto no cierra con "no hay problema".** La liberación tarda, según la
corrida y la condición, entre ~15 s y ~75 s en completarse. Si un usuario abre
un segundo documento antes de que eso termine, arranca desde la base todavía
inflada — que es exactamente el "residuo del documento anterior" que ADR-146
§7bis encontró y que ADR-154 §2 lever 3 anticipó por inferencia el
2026-09-12. El resultado no es que no haya nada que hacer: es que el lever
correspondiente pasa de "buscar una fuga" a "la liberación llega tarde para el
patrón de uso real (varios documentos en una sesión)" (§6).

**C-3 es el corte más débil de los tres.** El modelo de NER pesa mucho
**mientras está residente** (§4.1), pero su contribución al piso final es
indistinguible del ruido entre corridas — en P2 el signo hasta se invierte
(§4.2). No se puede afirmar un "costo de NER en reposo" con estos datos.

## 1. Protocolo ejecutado

- **Arnés**: `tests/perf/support/hotBaselineCurve.ts` (instrumento nuevo),
  `tests/perf/hot-baseline-attribution.spec.ts` (12 tests), `tests/perf/support/aggregateHotBaselineReports.ts`
  (agregador) y `tests/perf/run-hot-baseline-campaign.sh` (script único de
  campaña). Detalle de diseño y por qué no toca `HOT_BASELINE_SETTLE_CEILING_MS`
  en §7.
- **Perfiles**: P1 (`p1-native-10p`, control) y P2 (`p2-scanned-50p`,
  principal). Sin P2-dense, según el plan.
- **Condición C-3**: `installSettingsOverride(page, { nerEnabled: false })`
  para "NER off" (mismo canal que "P2-attrib — NER apagado" en
  `memory-attribution.spec.ts`); nada instalado (default) para "NER on".
  Alternada por corrida: on/off/on/off/on/off, no en bloques.
- **Por corrida**: un import frío único → `closeDocument()` por la UI real →
  observación continua ≥125 s con checkpoints en t=5/15/30/45/60/75/90/120 s,
  cada uno con desglose por `type` de proceso (Tab/GPU/Browser/Utility). Sin
  import caliente: T-7 pregunta qué queda retenido después de cerrar el
  primer documento, no cómo procesa el segundo (eso ya lo mide `memory.spec.ts`).
- **Base caliente estándar**: calculada con la misma función que usa la
  campaña de H-10 (`waitForHotBaselineToSettle`, exportada sin modificar —
  mismo techo de 30 s, misma tolerancia), para que sea comparable con todo lo
  publicado antes.
- **Máquina**: Apple M1, 8 CPUs, 8,59 GB RAM, macOS/arm64. Load average al
  arrancar: 1,80 (umbral de espera del script: 4,0 — no hizo falta esperar).
  Commit `edd2204a6ba37b6accfcfd40109f7581e9772b87`, árbol de `packages/`/`apps/`
  sin cambios respecto de ese commit (los únicos archivos no trackeados son el
  propio arnés de `tests/perf/`, listados en §7).
- **Presión del sistema**: registrada en cada corrida (`systemPressureAtStart`/
  `AtEnd`, ver tablas de §8) — compresor de macOS entre 2,0 y 2,6 GB durante
  toda la sesión, swap entre 161 y 502 MB. La sesión entera (12 corridas) duró
  ~27 minutos (21:54:57–22:22:07 UTC), así que hay deriva de presión entre la
  primera y la última corrida — es la razón por la que ADR-146 §7 exige leer
  este campo antes de comparar dos corridas entre sí, y por la que §4/§6 tratan
  con cuidado cualquier comparación entre condiciones.

## 2. C-1 — La curva de liberación tras cerrar el documento

### 2.1 Cuánto se recupera, y en qué instante

Delta t=5s → t=120s (la definición literal del plan §3 C-1) por corrida:

| perfil/condición | run0 | run1 | run2 | promedio |
|---|---:|---:|---:|---:|
| P1 — NER off | −130,2 MB | −129,6 MB | −130,1 MB | **−130,0 MB** |
| P1 — NER on | −1001,4 MB | −886,1 MB | −787,9 MB | **−891,8 MB** |
| P2 — NER off | −705,4 MB | −526,7 MB | −479,8 MB | **−570,6 MB** |
| P2 — NER on | −601,0 MB | −745,9 MB | −691,3 MB | **−679,4 MB** |

Como fracción del valor en t=5s: P1-off 19,5 %, P1-on 60,4 %, P2-off 51,1 %,
P2-on 65,0 %. **La mayor parte de lo que la corrida caliente mostraba en los
primeros segundos posteriores al cierre no es piso: se libera sola dentro de
la ventana de 120 s**, y más cuanto más pesado es lo que se cargó (NER y/o
OCR).

**El instante del escalón no es uniforme.** El paso consecutivo de mayor
magnitud, por corrida (de la agregación automática,
`aggregateHotBaselineReports.ts`):

| perfil/condición | run0 | run1 | run2 |
|---|---|---|---|
| P1 — NER off | **60s→75s** (−76,3 MB) | **60s→75s** (−76,1 MB) | **60s→75s** (−76,2 MB) |
| P1 — NER on | 5s→15s (−516,5 MB) | 15s→30s (−334,4 MB) | **60s→75s** (−459,6 MB) |
| P2 — NER off | 15s→30s (−641,6 MB) | **60s→75s** (−326,5 MB) | **60s→75s** (−327,2 MB) |
| P2 — NER on | 5s→15s (−509,6 MB) | 30s→45s (−665,4 MB) | 5s→15s (−449,5 MB) |

**P1-NER-off es la firma más limpia de las doce**: el mismo escalón, en el
mismo intervalo, con la misma magnitud casi exacta (−76,1 a −76,3 MB) en las
tres corridas — 0,2 MB de dispersión entre repeticiones. Con un solo pool en
juego (sin OCR, sin NER activo — solo el pool de render y el de pdf), el
escalón cae exactamente donde predice la hipótesis: `idleDisposeMs = 60_000`
más el tiempo de propagación hasta que Electron reporta el RSS más bajo.

**Solo 6 de las 12 corridas tienen su paso más grande dentro de la ventana
[60s, 75s)** que predice la hipótesis en su forma simple. Las otras 6 —
concentradas en P1-NER-on y en las tres de P2-NER-on— liberan su tramo más
grande **antes**, entre los 5 s y los 45 s. Esto no contradice la hipótesis:
la refina. Cuando hay más de un pool pesado cargado (NER, y en P2 también
OCR), cada uno tiene su **propio** reloj de idle-dispose, que arranca en el
último job de **ese** pool — no en el cierre del documento (ADR-080 §2: "el
timer se rearma... al liquidar el último job pendiente", no al recibir
`DOCUMENT_CLOSED`). El pool de OCR termina su trabajo bastante antes de
`PIPELINE_READY` en P2 (hay grouping y render después); si su último job cae,
digamos, 40 s antes del cierre del documento, sus 60 s vencen ~20 s
**después** del cierre, no a los 60. Esto es compatible con lo observado —
P2-NER-on muestra su mayor caída siempre antes de los 45 s— pero es una
lectura de la forma de la curva agregada, **no una verificación directa**:
este arnés no persistió los timestamps de `OCR_FINISHED`/`NER_FINISHED` más
allá del cierre del documento, así que no hay forma de confirmar, corrida por
corrida, cuál pool produjo cuál escalón sin instrumentar eso por separado
(§6, límite declarado).

Lo que sí es un hallazgo firme, sin necesidad de esa instrumentación
adicional: **en las 12 corridas, casi toda la caída ocurre en uno o dos pasos
discretos, no en una pendiente continua** (las tablas de §8 lo muestran: entre
checkpoints consecutivos sin escalón, el valor es plano hasta el segundo o
tercer decimal). Eso es compatible con `terminate()` de workers (ADR-080 §3:
libera todo el heap de un isolate de una vez), no con un recolector de basura
incremental liberando poco a poco.

### 2.2 Por qué la "base estándar" (≤30s) a veces sobreestima

En varias corridas de NER-on, `standardBaselineBytes` (calculada con la misma
ventana de asentamiento de ADR-146 §7bis, techo de 30 s) da un valor **más
alto** que el propio checkpoint de t=5s de la curva extendida — p. ej. P2-on
run0: base estándar 1548,6 MB contra t=5s de 886,6 MB. Esto pasa porque el
criterio de asentamiento (5 muestras consecutivas dentro de ±2 % de su
mediana) puede satisfacerse sobre una meseta **corta** (0,75 s de 5 muestras a
150 ms) que todavía no es el reposo final — el RSS sigue cayendo después,
fuera de esa ventana de 30 s en algunos casos. No es un defecto del algoritmo
respecto de su propia definición (ADR-146 §1: "la base con los modelos ya
cargados y sin documento", medida dentro de un techo declarado) — es la razón
estructural por la que este documento usa **dos** referencias distintas (base
≤30s y t=5s de la curva extendida) y no las mezcla: ninguna corrida de la
campaña histórica (`memory.spec.ts`) queda invalidada por esto, pero sí queda
más claro que "base caliente ≤30s" nunca fue una medida de piso — es lo que
ADR-146 §7 (enmienda 2026-09-10) ya advertía sobre M1, extendido acá a la
propia base.

## 3. C-2 — Atribución por proceso

**Tab y GPU explican prácticamente el 100 % de cada caída; Browser y Utility
se mantienen planos.** En las 12 corridas, sin excepción: Browser varía como
mucho ±20 MB a lo largo de toda la ventana de 120 s (y esa variación ocurre
sobre todo en los primeros 15-30 s, no en los escalones grandes), Utility
varía menos de ±3 MB. Todo el movimiento de cientos de MB vive en Tab
(mayoría) y GPU (una fracción menor pero consistente, entre el 15 % y el 35 %
de la magnitud del paso según la corrida).

Ejemplo representativo, P1-NER-off run0 (escalón limpio de −76,3 MB entre
t=60s y t=75s): Tab pasa de 260,9 a 208,9 MB (−52,0 MB, 68 % del paso), GPU de
120,7 a 96,2 MB (−24,5 MB, 32 % del paso), Browser 178,6→178,7 MB (+0,1 MB),
Utility 47,9→47,9 MB (0,0 MB). El mismo patrón —Tab y GPU cayendo juntos,
Browser/Utility sin moverse— se repite en las otras 11 corridas (tablas
completas en §8).

**Lectura para un lever futuro** (sin proponer ninguno, ADR-154 §5): un piso
que viviera mayormente en Browser o Utility apuntaría al proceso principal de
Electron o a servicios de red; acá vive en Tab+GPU, que es donde corren el
renderer, sus workers dedicados y el compositor — coherente con que lo que se
libera son los workers de los pools pesados (OCR/NER/Render) y sus recursos
GPU asociados (backing stores de canvas, buffers de compositing), no memoria
del proceso principal.

## 4. C-3 — Cuánto es el modelo de NER

### 4.1 Mientras el modelo está residente: la diferencia es grande y consistente

Comparando **la base estándar (≤30s)** — la métrica que sí mide "con el modelo
recién cargado, antes de cualquier liberación" — entre NER on y NER off:

| perfil | NER off (avg) | NER on (avg) | delta |
|---|---:|---:|---:|
| P1 | 676,7 MB | 1506,0 MB | **+829,3 MB** |
| P2 | 1177,3 MB | 1393,7 MB | **+216,4 MB** |

En P1 la separación es total: las tres corridas NER-on (1476,3 / 1522,5 /
1519,3 MB) están todas por encima de las tres NER-off (672,1 / 675,3 / 682,7
MB) — sin superposición. En P2 el promedio también es consistente en
dirección, pero con superposición entre corridas individuales (NER-on mínimo
1197,5 MB, NER-off máximo 1255,7 MB) — más ruidoso, coherente con que P2 ya
tiene su propia variabilidad por el OCR y por la generación no determinística
del fixture (`Optimizacion_De_Memoria_Plan.md` §2bis punto 5).

Esto **sí** es un número interpretable: mientras el modelo de NER está
cargado y no pasó suficiente tiempo ocioso, agrega varios cientos de MB al
árbol de procesos — del orden de lo que se espera de ONNX Runtime + un modelo
cuantizado de ~178 MB más su huella de ejecución.

### 4.2 En el piso (t=120s): el delta es ruido, y en P2 hasta cambia de signo

| perfil | NER off t=120s (avg) | NER on t=120s (avg) | delta |
|---|---:|---:|---:|
| P1 | 537,0 MB | 583,9 MB | +46,9 MB |
| P2 | 545,8 MB | 366,1 MB | **−179,7 MB** |

El delta de P1 (+46,9 MB) es menor que la dispersión **dentro** de cada
condición sola (P1-on va de 445,5 a 711,7 MB entre sus tres corridas — un
rango de 266 MB). El de P2 es negativo: NER-on termina **por debajo** de
NER-off (366,1 contra 545,8 MB), con los seis valores individuales
mostrando por qué no hay que confiar en el promedio — P2-off da 332,0 / 676,2
/ 629,1 MB y P2-on da 285,6 / 309,9 / 502,8 MB, dos nubes que se superponen
ampliamente.

**No se puede afirmar un costo de NER "en reposo" con estos datos.** Lo que
C-3 contesta con confianza es §4.1 (cuánto pesa mientras está vivo, que es
mucho y consistente) — no cuánto queda después de que todo tuvo tiempo de
liberarse, que acá es indistinguible del ruido de sesión con n=3 por
condición. Separar esa señal, si existe, pediría bastantes más corridas por
condición (ADR-146 §7 punto 3 ya hizo esta cuenta para otro lever: bajar el
error estándar de un ruido de ~300 MB a algo utilizable pide del orden de
decenas de corridas, no tres).

## 5. Qué fracción del hueco de 700 MB–1,2 GB queda sin atribuir

`Optimizacion_De_Memoria_Plan.md` §1bis calculó el hueco como
`base_caliente_publicada − componentes_conocidos(~1 GB)`:

- P1: 1723,9 − 1000 ≈ **724 MB** sin atribuir.
- P2: 2158,1 − 1000 ≈ **1158 MB** sin atribuir.

Esta campaña no repite esas corridas exactas (presión del sistema distinta,
ADR-146 §7ter — no son comparables número a número), pero sí mide, en la misma
sesión y con la presión registrada, cuánto de una base caliente equivalente es
recuperable esperando. Usando NER-on (la condición por defecto, la que
corresponde a los números históricos) y comparando contra el **piso real** en
vez de contra la base ≤30s:

| perfil | base ≤30s (avg, esta sesión) | piso a t=120s (avg) | recuperado |
|---|---:|---:|---:|
| P1 | 1506,0 MB | 583,9 MB | 922,1 MB |
| P2 | 1393,7 MB | 366,1 MB | 1027,6 MB |

**El piso real (366-584 MB) queda por debajo de los ~1000 MB que
`07_Performance_Strategy.md` §7.1 atribuye a componentes conocidos (Tesseract
+ modelo, ONNX + modelo, workers de render, wasm de pdf.js, shell).** Eso no
es una contradicción con esa tabla: significa que esos componentes —que sí
están cargados **mientras se procesa o dentro de la ventana de idle**— se
liberan junto con todo lo demás cuando los pools pesados se dan de baja
(ADR-080 aplica `idleDisposeMs` a los **cinco** pools que `create-core.ts` construye: render, ocr, **ocr-orientation** —el OSD compartido de ADR-164—, ner y export). El presupuesto de §7.1 describe el costo de tenerlos **cargados**,
no un piso permanente — y no hay ningún dato acá que diga lo contrario.

**Conclusión de T-7: el hueco de 700 MB–1,2 GB no queda sin atribuir — queda
disuelto.** No había una fracción estructural sin explicar del mismo orden que
los componentes conocidos; había una base caliente medida en un instante en el
que la liberación todavía no había tenido tiempo de ocurrir. Con la ventana
extendida a 120 s, lo que queda (un piso de cientos de MB, dominado por
Tab+GPU, §3) es menor que la propia estimación de componentes conocidos, así
que **no hay residuo nuevo que T-7 deje sin explicar** — dicho con la misma
franqueza que pide el plan: esto no demuestra que el piso sea cero ni que no
haya nada más chico por atribuir dentro de esos 366-584 MB (eso sería otra
medición, con otro instrumento), solo que no hace falta inventar una categoría
nueva ("memoria no atribuida") para explicarlo: encaja dentro de lo que ya se
sabía que existía, retenido más tiempo del que la ventana de medición anterior
alcanzaba a ver.

## 6. Lo que esto no dice: la liberación llega tarde para el uso real

Este resultado **no** es "no hay nada que optimizar". Las doce corridas
muestran liberación completa recién entre los ~15 s (el caso más rápido,
P2-NER-off run0) y los ~75 s (el más lento) después de cerrar el documento. Un
usuario que procesa varios documentos seguidos — el caso que ADR-154 §2 lever
3 señaló el 2026-09-12, antes de tener este número: *"bajar el nivel sostenido
sí baja ese pico — el del documento siguiente"*— abre el segundo documento
bastante antes de esa ventana. Ese segundo documento no arranca desde el piso
de 366-584 MB: arranca desde la base inflada de 1,2-1,5 GB, exactamente el
"residuo del documento anterior" que ADR-146 §7bis encontró y que motivó el
propio criterio de asentamiento que este instrumento reusa.

**El lever cambia de forma, no desaparece.** No es "hay una fuga que buscar":
es "la liberación existe, funciona, y su reloj (`idleDisposeMs = 60_000`,
más el propio de cada pool según cuándo terminó su último job) está calibrado
para un usuario que espera entre documentos, no para uno que encadena varios
en menos de un minuto". Elegir qué hacer con eso —bajar el umbral, liberar
antes por otro criterio, o no tocarlo— es una decisión del humano con su
propio ADR (ADR-154 §1/§5); T-7 solo entrega el número.

## 7. El arnés — dónde vive y qué no toca

Todo bajo `tests/perf/`, nada en `packages/` ni `apps/`:

- **`tests/perf/support/memoryProfile.ts`** — cambio aditivo únicamente:
  `export` agregado a `installRunCollector`, `waitForRunSettled`, `readRun`,
  `closeDocument`, `waitForHotBaselineToSettle` y a la constante
  `SETTLE_GRACE_MS`, que ya existían privadas. **`HOT_BASELINE_SETTLE_CEILING_MS`
  no se tocó** — sigue en 30 000 ms, sin exportar, y la curva extendida llama a
  la función real en vez de reimplementar el asentamiento (así
  `standardBaselineBytes` de este documento es exactamente comparable con
  `RunReport.baselineBytes` de toda la campaña anterior).
- **`tests/perf/support/hotBaselineCurve.ts`** (nuevo) — `measureHotBaselineCurve`:
  un import frío, cierre por la UI real, y observación de 125 s con
  `computeReleaseCurve` extrayendo los 8 checkpoints por cercanía
  (`sampleNear`, ya usado por el instrumento estándar) sobre la serie continua
  que el sampler de fondo venía acumulando — sin sondeo activo por checkpoint.
  `aggregateByProcessType` agrupa `MemorySample.perProcess` por `type` (C-2).
  17 tests unitarios propios (`hotBaselineCurve.test.ts`).
- **`tests/perf/hot-baseline-attribution.spec.ts`** (nuevo) — las 12 corridas,
  P1/P2 × NER on/off × 3, declaradas alternadas para que la deriva de sesión
  afecte a las dos condiciones por igual (mismo criterio que
  `RENDER_POOL_CONDITIONS` en `memory-attribution.spec.ts`).
- **`tests/perf/support/aggregateHotBaselineReports.ts`** (nuevo) — agrega sin
  interpretar: `computeCurveDelta` (delta t=5s→t=120s) y `computeLargestStep`
  (el paso consecutivo de mayor magnitud), las dos funciones puras detrás de
  §2, con sus propios tests (`aggregateHotBaselineReports.test.ts`, 9 casos).
- **`tests/perf/run-hot-baseline-campaign.sh`** (nuevo) — script único:
  espera a que el load average de 1 minuto no supere 4,0 (2× el piso conocido
  de la máquina, ~2,0 — nunca baja de ahí, así que "esperar silencio" no
  termina nunca; tope de 15 min, después sigue igual y deja la condición real
  registrada), construye el producto (`VITE_E2E=1 react-client build` +
  `desktop-shell build`), corre las 12 pruebas seriales y agrega al final.
  Deliberadamente sin `set -e` en el tramo de Playwright: si alguna corrida
  falla, el agregador igual corre sobre lo que sí se escribió.

**Verificado antes de correr la campaña completa**: 17 tests nuevos en verde
(`hotBaselineCurve.test.ts` + `aggregateHotBaselineReports.test.ts`), ESLint y
`tsc -p tests/tsconfig.json --noEmit` limpios sobre los archivos tocados,
Prettier aplicado, `git diff --check` limpio, y un smoke test real de una
corrida completa (P1, NER on) antes de lanzar las 12 en background.

## 8. Filas crudas

Las 12 corridas completas, checkpoint por checkpoint, con desglose por
proceso y presión del sistema — evidencia cruda en
`.measure/base-caliente/20260917T215457Z/` (`hot-baseline-<perfil>-<condición>-run<N>.json`,
`summary.json`, `summary.txt`, `manifest.json`, `playwright.log`, `build.log`,
`campaign.log`).

### P1 — 10 páginas de texto nativo (control)

**P1 — NER off — corrida 1/3** (`hot-baseline-p1-native-10p-ner-off-run0.json`)
- base caliente estándar (≤30s): 672,1 MB (asentada: sí)
- frío: ok=true grupos=6 entidades=6 total=144ms
- presión sistema apertura: libres=36,1MB compresor=2186,9MB swap=169,5MB
- presión sistema cierre: libres=99,8MB compresor=2042,7MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 662,3 | 299,9 | 120,7 | 193,9 | 47,7 |
| 15 | 645,0 | 299,9 | 120,7 | 176,6 | 47,8 |
| 30 | 610,4 | 266,3 | 120,7 | 175,6 | 47,9 |
| 45 | 611,3 | 266,2 | 120,7 | 176,5 | 47,9 |
| 60 | 608,0 | 260,9 | 120,7 | 178,6 | 47,9 |
| 75 | 531,7 | 208,9 | 96,2 | 178,7 | 47,9 |
| 90 | 532,0 | 208,9 | 96,2 | 179,0 | 47,9 |
| 120 | 532,1 | 208,9 | 96,3 | 179,0 | 47,9 |

**P1 — NER off — corrida 2/3** (`hot-baseline-p1-native-10p-ner-off-run1.json`)
- base caliente estándar (≤30s): 675,3 MB (asentada: sí)
- frío: ok=true grupos=6 entidades=6 total=129ms
- presión sistema apertura: libres=231,1MB compresor=2280,5MB swap=169,5MB
- presión sistema cierre: libres=41,8MB compresor=2032,7MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 665,5 | 303,8 | 120,5 | 193,4 | 47,8 |
| 15 | 648,2 | 303,8 | 120,4 | 176,0 | 48,0 |
| 30 | 614,3 | 270,3 | 120,5 | 175,6 | 48,0 |
| 45 | 615,2 | 270,3 | 120,5 | 176,5 | 48,0 |
| 60 | 611,7 | 264,8 | 120,5 | 178,4 | 48,0 |
| 75 | 535,6 | 213,1 | 96,0 | 178,5 | 48,0 |
| 90 | 535,6 | 213,1 | 96,0 | 178,5 | 48,0 |
| 120 | 535,9 | 213,1 | 96,0 | 178,7 | 48,0 |

**P1 — NER off — corrida 3/3** (`hot-baseline-p1-native-10p-ner-off-run2.json`)
- base caliente estándar (≤30s): 682,7 MB (asentada: sí)
- frío: ok=true grupos=6 entidades=6 total=133ms
- presión sistema apertura: libres=714,6MB compresor=2531,4MB swap=169,5MB
- presión sistema cierre: libres=94,5MB compresor=2299,6MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 673,2 | 309,2 | 122,7 | 193,6 | 47,7 |
| 15 | 655,8 | 309,2 | 122,6 | 176,2 | 47,9 |
| 30 | 621,6 | 275,6 | 122,6 | 175,5 | 47,9 |
| 45 | 622,5 | 275,5 | 122,6 | 176,5 | 47,9 |
| 60 | 619,2 | 270,0 | 122,6 | 178,6 | 47,9 |
| 75 | 543,0 | 218,5 | 98,1 | 178,5 | 47,9 |
| 90 | 543,0 | 218,5 | 98,1 | 178,5 | 47,9 |
| 120 | 543,1 | 218,5 | 98,2 | 178,5 | 47,9 |

**P1 — NER on — corrida 1/3** (`hot-baseline-p1-native-10p-ner-on-run0.json`)
- base caliente estándar (≤30s): 1476,3 MB (asentada: sí)
- frío: ok=true grupos=14 entidades=14 total=2308ms
- presión sistema apertura: libres=146,5MB compresor=2600,6MB swap=169,5MB
- presión sistema cierre: libres=66,3MB compresor=2241,3MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1446,8 | 1104,6 | 110,0 | 189,8 | 42,5 |
| 15 | 930,4 | 672,9 | 77,0 | 140,3 | 40,2 |
| 30 | 972,7 | 712,2 | 77,8 | 141,7 | 41,0 |
| 45 | 971,3 | 710,6 | 77,9 | 141,7 | 41,1 |
| 60 | 491,5 | 224,9 | 77,7 | 146,9 | 41,9 |
| 75 | 441,9 | 180,9 | 69,9 | 149,1 | 42,1 |
| 90 | 442,1 | 180,9 | 70,0 | 149,2 | 42,1 |
| 120 | 445,5 | 182,3 | 70,3 | 150,8 | 42,1 |

**P1 — NER on — corrida 2/3** (`hot-baseline-p1-native-10p-ner-on-run1.json`)
- base caliente estándar (≤30s): 1522,5 MB (asentada: sí)
- frío: ok=true grupos=14 entidades=14 total=2310ms
- presión sistema apertura: libres=218,7MB compresor=2040,3MB swap=169,5MB
- presión sistema cierre: libres=99,7MB compresor=2331,5MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1480,5 | 1149,1 | 107,9 | 181,6 | 42,0 |
| 15 | 1460,5 | 1149,1 | 107,9 | 161,4 | 42,2 |
| 30 | 1126,1 | 828,5 | 105,8 | 150,4 | 41,4 |
| 45 | 1122,5 | 824,9 | 105,8 | 150,4 | 41,4 |
| 60 | 813,1 | 536,5 | 83,9 | 151,0 | 41,7 |
| 75 | 591,9 | 321,5 | 76,0 | 152,2 | 42,2 |
| 90 | 592,0 | 321,5 | 76,1 | 152,2 | 42,2 |
| 120 | 594,4 | 322,9 | 76,3 | 153,0 | 42,2 |

**P1 — NER on — corrida 3/3** (`hot-baseline-p1-native-10p-ner-on-run2.json`)
- base caliente estándar (≤30s): 1519,3 MB (asentada: sí)
- frío: ok=true grupos=14 entidades=14 total=2332ms
- presión sistema apertura: libres=115,9MB compresor=2028,5MB swap=169,5MB
- presión sistema cierre: libres=433,8MB compresor=2589,7MB swap=169,5MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1499,6 | 1166,6 | 110,2 | 180,9 | 42,0 |
| 15 | 1476,7 | 1164,9 | 110,2 | 159,4 | 42,2 |
| 30 | 1160,4 | 886,3 | 86,6 | 146,3 | 41,2 |
| 45 | 1159,5 | 885,3 | 86,6 | 146,3 | 41,2 |
| 60 | 1168,7 | 888,4 | 87,0 | 151,2 | 42,0 |
| 75 | 709,1 | 436,4 | 78,4 | 152,2 | 42,1 |
| 90 | 709,2 | 436,4 | 78,4 | 152,2 | 42,1 |
| 120 | 711,7 | 437,4 | 78,7 | 153,4 | 42,1 |

### P2 — 50 páginas escaneadas (principal)

**P2 — NER off — corrida 1/3** (`hot-baseline-p2-scanned-50p-ner-off-run0.json`)
- base caliente estándar (≤30s): 1092,9 MB (asentada: sí)
- frío: ok=true grupos=5 entidades=5 total=12172ms
- presión sistema apertura: libres=64,3MB compresor=2428,7MB swap=161,1MB
- presión sistema cierre: libres=34,6MB compresor=2446,5MB swap=161,1MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1037,4 | 623,2 | 230,9 | 145,9 | 37,5 |
| 15 | 1032,1 | 621,1 | 230,1 | 143,4 | 37,7 |
| 30 | 390,6 | 180,7 | 88,8 | 97,7 | 23,3 |
| 45 | 391,1 | 180,8 | 88,9 | 98,5 | 22,9 |
| 60 | 410,9 | 187,2 | 91,8 | 106,2 | 25,6 |
| 75 | 328,1 | 144,4 | 51,5 | 106,6 | 25,7 |
| 90 | 328,3 | 144,4 | 51,5 | 106,7 | 25,7 |
| 120 | 332,0 | 146,6 | 52,5 | 107,2 | 25,7 |

**P2 — NER off — corrida 2/3** (`hot-baseline-p2-scanned-50p-ner-off-run1.json`)
- base caliente estándar (≤30s): 1255,7 MB (asentada: sí)
- frío: ok=true grupos=5 entidades=5 total=12307ms
- presión sistema apertura: libres=41,7MB compresor=2028,1MB swap=502,3MB
- presión sistema cierre: libres=280,1MB compresor=2299,3MB swap=502,3MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1202,9 | 765,7 | 236,1 | 160,0 | 41,0 |
| 15 | 1199,8 | 765,7 | 236,2 | 156,8 | 41,0 |
| 30 | 1000,0 | 566,9 | 236,3 | 155,8 | 41,0 |
| 45 | 1000,2 | 566,9 | 236,3 | 156,0 | 41,0 |
| 60 | 1001,9 | 563,2 | 236,8 | 160,2 | 41,8 |
| 75 | 675,4 | 389,3 | 84,1 | 160,3 | 41,8 |
| 90 | 675,5 | 389,3 | 84,1 | 160,3 | 41,8 |
| 120 | 676,2 | 389,6 | 84,3 | 160,5 | 41,8 |

**P2 — NER off — corrida 3/3** (`hot-baseline-p2-scanned-50p-ner-off-run2.json`)
- base caliente estándar (≤30s): 1183,4 MB (asentada: sí)
- frío: ok=true grupos=5 entidades=5 total=12226ms
- presión sistema apertura: libres=116,3MB compresor=2067,6MB swap=502,3MB
- presión sistema cierre: libres=253,6MB compresor=2304,7MB swap=502,3MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1108,8 | 661,2 | 251,8 | 154,7 | 41,1 |
| 15 | 1106,2 | 661,2 | 251,8 | 152,0 | 41,1 |
| 30 | 984,5 | 536,4 | 251,9 | 155,2 | 41,1 |
| 45 | 984,7 | 536,4 | 251,9 | 155,3 | 41,1 |
| 60 | 955,4 | 517,4 | 236,5 | 159,7 | 41,9 |
| 75 | 628,2 | 342,8 | 83,8 | 159,7 | 41,9 |
| 90 | 628,3 | 342,8 | 83,8 | 159,8 | 41,9 |
| 120 | 629,1 | 343,3 | 84,0 | 159,9 | 41,9 |

**P2 — NER on — corrida 1/3** (`hot-baseline-p2-scanned-50p-ner-on-run0.json`)
- base caliente estándar (≤30s): 1548,6 MB (asentada: sí)
- frío: ok=true grupos=11 entidades=13 total=16267ms
- presión sistema apertura: libres=214,0MB compresor=2296,4MB swap=169,5MB
- presión sistema cierre: libres=70,8MB compresor=2485,1MB swap=161,1MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 886,6 | 540,4 | 179,7 | 130,8 | 35,8 |
| 15 | 377,0 | 165,7 | 60,1 | 117,3 | 33,9 |
| 30 | 337,6 | 135,1 | 59,2 | 110,1 | 33,2 |
| 45 | 243,7 | 93,0 | 42,9 | 82,7 | 25,1 |
| 60 | 271,3 | 117,5 | 43,1 | 85,6 | 25,1 |
| 75 | 281,2 | 122,6 | 43,1 | 90,2 | 25,3 |
| 90 | 281,3 | 122,6 | 43,1 | 90,3 | 25,3 |
| 120 | 285,6 | 124,6 | 45,0 | 90,7 | 25,3 |

**P2 — NER on — corrida 2/3** (`hot-baseline-p2-scanned-50p-ner-on-run1.json`)
- base caliente estándar (≤30s): 1197,5 MB (asentada: sí)
- frío: ok=true grupos=11 entidades=13 total=16631ms
- presión sistema apertura: libres=42,9MB compresor=2440,9MB swap=161,1MB
- presión sistema cierre: libres=78,2MB compresor=2193,5MB swap=502,3MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1055,8 | 747,3 | 188,7 | 95,6 | 24,2 |
| 15 | 985,3 | 676,2 | 188,9 | 95,9 | 24,3 |
| 30 | 968,0 | 658,6 | 188,9 | 96,2 | 24,3 |
| 45 | 302,6 | 137,4 | 50,2 | 89,8 | 25,2 |
| 60 | 289,4 | 128,3 | 47,5 | 88,1 | 25,5 |
| 75 | 300,4 | 136,3 | 47,2 | 91,2 | 25,7 |
| 90 | 300,5 | 136,3 | 47,2 | 91,3 | 25,7 |
| 120 | 309,9 | 138,6 | 48,7 | 96,9 | 25,7 |

**P2 — NER on — corrida 3/3** (`hot-baseline-p2-scanned-50p-ner-on-run2.json`)
- base caliente estándar (≤30s): 1435,1 MB (asentada: sí)
- frío: ok=true grupos=11 entidades=13 total=16359ms
- presión sistema apertura: libres=490,1MB compresor=2238,2MB swap=502,3MB
- presión sistema cierre: libres=130,3MB compresor=2148,3MB swap=502,3MB

| t (s) | suma (MB) | Tab | GPU | Browser | Utility |
|---:|---:|---:|---:|---:|---:|
| 5 | 1194,0 | 838,1 | 175,0 | 141,1 | 39,9 |
| 15 | 744,5 | 389,0 | 172,9 | 143,1 | 39,5 |
| 30 | 749,9 | 393,5 | 172,9 | 143,9 | 39,5 |
| 45 | 758,7 | 394,8 | 173,5 | 149,1 | 41,2 |
| 60 | 547,6 | 267,5 | 88,6 | 149,8 | 41,7 |
| 75 | 500,8 | 234,8 | 73,0 | 151,0 | 42,0 |
| 90 | 500,8 | 234,8 | 73,0 | 151,0 | 42,0 |
| 120 | 502,8 | 236,1 | 73,5 | 151,1 | 42,0 |

## 9. Límites (declarados de entrada, del plan §6, más los que aparecieron midiendo)

- **El fixture no es un escaneo real y P4 sigue sin existir** — acota a qué se
  parece P2, no la validez de la atribución del piso (mismo límite que el plan
  declara en su §6).
- **M2/la base se mueven con la presión de memoria del sistema.** Esta sesión
  duró ~27 minutos con el compresor de macOS entre 2,0 y 2,6 GB — las
  comparaciones de este documento son válidas dentro de esta sesión, con la
  presión registrada al lado de cada número (§8); no se comparan contra
  tandas anteriores al 2026-09-17.
- **n=3 por condición no alcanza para separar la señal de NER del ruido en el
  piso** (§4.2) — el rango dentro de una sola condición (hasta 344 MB en P2)
  es mayor que el delta que se buscaba medir.
- **La atribución de qué pool produce cuál escalón es una lectura de la forma
  de la curva, no una verificación directa** (§2.1): este arnés no persiste
  `OCR_FINISHED`/`NER_FINISHED` más allá del cierre del documento. Confirmarlo
  pediría correlacionar esos timestamps de fase contra el instante de cada
  paso, corrida por corrida — no se hizo acá.
- **La máquina de medición tiene un piso de carga propio** (~2,0 de load
  average, según CLAUDE.md) que no se puede silenciar; el script esperó a que
  no estuviera en un pico (umbral 4,0) pero no pretende aislamiento perfecto.
- **No se corrió una corrida de control "sin documento, solo esperar 120 s
  desde el arranque"** (piso verdaderamente en frío, sin haber procesado
  nunca nada) — esta campaña mide el piso *después de procesar un documento*,
  que es la pregunta que hace el plan, pero una comparación directa contra un
  piso nunca-procesado no está en este documento.

## 10. Qué contradice o refina el plan original

- **La predicción de un escalón único cerca de los 60 s no se sostiene tal
  cual en las 12 corridas** (§2.1): se sostiene con fuerza en el caso de un
  solo pool (P1-NER-off, 3/3 casi idéntico) y aparece, con menor limpieza, en
  la mitad de las corridas restantes; en la otra mitad la liberación dominante
  ocurre antes de los 60 s. La hipótesis en su forma cualitativa (hay
  liberación por idle-dispose, es sustancial) se confirma con holgura; su
  forma cuantitativa (un escalón, cerca de los 60 s) es una simplificación
  razonable pero no describe las 12 corridas por igual.
- **El diagnóstico de `Optimizacion_De_Memoria_Plan.md` §1bis** — que
  planteaba un residuo estructural de 700 MB–1,2 GB del mismo orden que los
  componentes conocidos — **no se sostiene**: el residuo era mayormente
  transitorio (§5). Es una corrección a ese documento, no una ambigüedad de
  T-7.

No hubo ningún tipo, evento o error code referenciado que no existiera; no
hizo falta detener la tarea por ambigüedad del plan (`AI_Development_Guide.md`
§5).
