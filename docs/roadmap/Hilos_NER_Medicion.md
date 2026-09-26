<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,core/NER_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 1, curvas macOS 2026-09-23/24 y Windows nativo 2026-09-25 cerradas; ampliación macOS de carga/panel/secuencia cerrada 2026-09-26) -->

# Hilos internos de ONNX para NER — medición macOS y Windows nativo

## Veredicto local

En esta MacBook Air M1 de 8 GB, el control automático usó **4 hilos efectivos**
en un solo worker/modelo NER. Solicitar 4 dio tiempos indistinguibles del
control; solicitar 6 u 8 **empeoró NER y `import→Ready`** en los dos documentos
reales. Las huellas de NER y Grouping fueron exactamente iguales y la
cancelación se ejercitó en todos los brazos. **No se cambia el default.** El
resultado no se extrapola a otros equipos: el humano pidió repetir la campaña
en Windows nativo ventilado antes de decidir hilos o perfiles de producto.

La diferencia entre fixtures y documentos reales confirma por qué R1/R2 son
obligatorios: en P1, 6 hilos apenas aumentó NER ~6 %, mientras en R1 lo aumentó
~43 %. Los resultados de fixtures sirven como control del banco, no como
estimación del costo real.

**La cantidad de páginas no mide el trabajo de NER.** Esta tanda compara el
tiempo de inferencia sobre documentos reales con el de fixtures de igual o mayor
longitud, pero **no volvió a contar caracteres, palabras ni tokens por página**. La medición
anterior de T-10 (`Ciclos_Y_Documentos_Reales_Medicion.md` §2.1) encontró unas
**300 palabras por página en R2 frente a 20 en P2**, aunque P2 tiene 50 páginas
y R2 solo 20. Ese factor de ~15 en densidad explica por qué P2 subestima el
trabajo por página. El próximo banco debe registrar conteos de caracteres,
palabras y jobs NER por página, sin guardar texto; esta es una limitación explícita
de la tanda presente, no un motivo para tratar P2 como representativo.

## Banco y protocolo

- Producto en revisión `da683f9`, Electron empaquetado, Web Workers reales,
  `crossOriginIsolated` y `SharedArrayBuffer` activos, mismo modelo ONNX Q8.
  El arnés opt-in está en `tests/perf/run-ner-threads.sh` y
  `tests/perf/ner-threads.spec.ts`; tres parches reversibles cambian solo
  `env.backends.onnx.wasm.numThreads` a 4/6/8. El control A no fija valor.
- Tres órdenes intercalados por corpus: A→4→6→8, 8→6→4→A y A→6→8→4.
  Una instancia nueva de Electron por corrida. Cada brazo tuvo una medición
  de memoria y otra de tiempo sin sonda; calidad antes de medir y cancelación
  al final. Se observaron los pthread targets vinculados al worker ONNX:
  A/4/6/8 ejecutaron **4/4/6/8** hilos efectivos; el máximo de jobs NER
  simultáneos fue 1.
- P1/P2 son fixtures reproducibles; R1 es el documento real nativo de unas 50
  páginas y R2 el escaneado de 20. Se pasaron por las variables de entorno
  del protocolo T-10, con nombres neutros y sin guardar contenido ni datos que
  identifiquen los PDF en el repo. La tanda P1 y la continuación P2 se
  conservan en `.measure/ner-threads/20260923T222721Z` y
  `.measure/ner-threads/20260923T222721Z-p2-continuation`; una P2 parcial
  anterior no se usó en los pares. R1/R2 y su agregado están en
  `.measure/ner-threads/20260924T-real-docs`, ignorado por Git.

## Tiempo sin sonda de memoria

Medianas de tres corridas por brazo, en segundos. La columna NER mide la etapa;
`Ready` mide importación completa. El porcentaje es contra el control del mismo
corpus, no entre máquinas.

| corpus | control A: NER / Ready | 4 hilos: NER / Ready | 6 hilos: NER / Ready | 8 hilos: NER / Ready |
|---|---:|---:|---:|---:|
| P1 sintético nativo | 2,04 / 2,18 | 2,04 / 2,18 | 2,17 / 2,31 | 2,45 / 2,59 |
| P2 sintético escaneado | 4,25 / 16,30 | 4,23 / 16,28 | 6,64 / 18,77 | 6,68 / 18,77 |
| **R1 real nativo** | **38,52 / 38,92** | 39,42 / 39,80 | **55,16 / 55,56** | **53,78 / 54,18** |
| **R2 real escaneado** | **16,21 / 48,50** | 16,44 / 50,16 | **22,43 / 54,81** | **21,48 / 53,85** |

En R1, los tres deltas pareados de NER contra A fueron **+16,90 / +17,12 /
+15,07 s** con 6 hilos y **+15,02 / +15,26 / +18,16 s** con 8. En R2 fueron
**+6,05 / +6,19 / +6,42 s** y **+4,93 / +5,30 / +5,26 s**, respectivamente.
Los deltas de 4 hilos fueron −0,04 / +2,25 / +0,64 s en R1 y −0,06 / +0,23 /
+0,19 s en R2: no sostienen una ganancia frente al automático.

El control A de R1 pasó de 38,27 a 38,79 s de NER entre rondas (+1,4 %); en R2,
de 16,55 a 16,01 s (−3,2 %). La Mac no tuvo temperatura medida y puede reducir
frecuencia al calentarse, pero esa deriva entre controles es mucho menor que la
penalidad pareada de 6/8 hilos. No se atribuye un mecanismo térmico concreto
sin sensor; solo se acota su posible confusión con estos controles.

## Memoria, calidad y cancelación

El pico de RSS del árbol Electron fue variable. Mediana de las tres lecturas de
R1 en MiB: A/4/6/8 = **1474 / 1484 / 1521 / 1509**; en R2 = **1804 / 1616 /
1679 / 1713**, con 6 hilos oscilando entre **1348 y 1893 MiB**. Esto no permite
atribuir un ahorro ni un costo de memoria consistente al número de hilos. La
sonda WASM/heap enlenteció NER aproximadamente **21–28 %** respecto de las
corridas sin ella; por eso los tiempos de la tabla anterior vienen de la pasada
sin sonda. Se registraron `vm_stat` y swap por corrida; no hubo sensor térmico.

La comparación exacta de ocurrencias NER y grupos pasó A=4=6=8 para R1 y R2,
sin pérdidas ni cambios de salida observables. El test de cancelación disparó
una solicitud durante inferencia activa en ambos corpus y todos los brazos:
latencia registrada de 0–1 ms hasta el evento `PIPELINE_CANCELLED`, sin
`NER_FINISHED` posterior. Esa cifra es latencia del evento, no una medición
independiente de cese físico de CPU. El banco terminó sin fallos y dejó el
árbol de producto limpio y el build A restaurado.

El arnés de esta tanda no separó carga del modelo para cada brazo ni midió el
momento de aparición del panel o una secuencia sostenida de importaciones en la
misma instancia. `Ready` incluye esos costos, pero no permite atribuirlos a la
carga o al panel. Esas tres mediciones no quedaron cerradas por esta tanda;
la conclusión histórica se limita a inferencia, `Ready`, pico RSS, calidad y
cancelación. La ampliación macOS del 2026-09-26 las separa con el alcance
descrito al final de este informe; el complemento equivalente en Windows
sigue pendiente.

**Ampliación macOS autorizada el 2026-09-26:**
`Rendimiento_Experimentos_Plan.md` §1.1 define carga observable, panel DOM y
tres bloques A/4/6/8 con R1→R1→R2→R2 en una misma instancia. La sonda OCR
entre plataformas ya completó su ampliación macOS
(`OCR_Entre_Plataformas_Medicion.md`, sección final). El complemento NER
completó **48 importaciones válidas en 12 secuencias**; ver la sección final.
Sus resultados no se mezclan con la tabla histórica anterior.

## Pendiente antes de adoptar (histórico, cerrado por la repetición Windows de abajo)

1. ~~Portar el arnés de builds y la lectura de presión a Windows nativo...~~
   **Hecho, ver más abajo.**
2. El producto permanece con selección automática del runtime. Si alguna curva
   futura justificara fijar hilos, el planificador debe escribir ADR y actualizar
   el contrato/configuración de NER antes de encargar ese cambio. Esta campaña
   solo midió builds experimentales y no modificó `Contracts.md` ni el motor.
   **Sigue vigente tras la repetición Windows: tampoco ahí se cambia el default.**

---

## Repetición Windows nativo (2026-09-25)

> Commit `ee5eeba` (`hardening/plan-2026-09`), Windows 11 Pro build 26200,
> i5-12400 (12 hilos lógicos visibles), 16,9 GB RAM. Windows nativo real —
> Git Bash como shell, **no WSL** (verificado: working dir `C:\Anonly\Anonly`,
> `bash.exe` de `Program Files\Git`, Node/pnpm nativos de Windows). Mismos
> documentos R1 (nativo, 51 p.) y R2 (escaneado, 20 p.) que las campañas
> anteriores de este equipo (`Banco_Windows_Comparativa_Medicion.md`).

### Veredicto Windows — contrario al de macOS

**En esta máquina forzar más hilos SÍ mejora NER, en vez de empeorarlo.** Con
12 hilos lógicos disponibles (contra los 4 efectivos que el control automático
usó en la MacBook Air M1 de 8 GB), 6 y 8 hilos redujeron el tiempo de NER de
forma sostenida y pareada contra el control automático en las tres rondas,
para los dos documentos reales. 4 hilos quedó indistinguible del automático,
igual que en macOS — consistente con que el control automático ya elige ~4
hilos en las dos plataformas, pero acá sobra CPU real para ir más alto y en
la Mac no.

**No se cambia el default de todos modos**: es un resultado de una sola
máquina, medido para cerrar el punto pendiente de portabilidad, no para
decidir una política de perfiles — esa decisión, si se toma, necesita su
propio ADR (punto 2 de arriba).

### Protocolo — puerto del arnés

El script original (`tests/perf/run-ner-threads.sh`) se niega a correr fuera
de `Darwin` y usa `vm_stat`/`sysctl vm.swapusage` para la presión del sistema,
que no existen en Windows. Se usó un puerto ad hoc (no commiteado, fuera del
repo) que preserva **exactamente** el mismo protocolo — parches de una línea
por brazo (`ner-arm-b/c/d-*.patch`), digests SHA-256 de cada `dist`, preflight
de calidad A=4=6=8 antes de medir, tres órdenes intercalados
(`A 4 6 8` / `8 6 4 A` / `A 6 8 4`), par memoria+tiempo por corrida, y
cancelación final por brazo — con tres diferencias, todas de instrumentación,
ninguna toca lo medido:

- El gate `uname -s == Darwin` se levantó.
- `vm_stat`/`sysctl vm.swapusage` no existen en `win32`; se reemplazaron por
  un snapshot informal de memoria vía PowerShell
  (`Get-CimInstance Win32_OperatingSystem`), rotulado explícitamente como no
  equivalente. `systemMemoryPressure.ts` tampoco tiene lector para `win32`
  (mismo hueco documentado en `Banco_Windows_Comparativa_Medicion.md` §1):
  esta campaña hereda esa limitación, no la resuelve.
- La guarda `pgrep -f 'playwright test --config'` (evita medir con otra
  campaña activa) se retiró: `pgrep` no existe en Git Bash y, probado con un
  reemplazo por PowerShell (`Get-CimInstance Win32_Process` filtrando por
  `CommandLine`), dio falsos positivos contra los propios procesos de esta
  sesión. La disciplina de "una sola campaña a la vez" se sostuvo a mano
  (nada más corrió en paralelo).

`shasum -a 256` y `timeout` (GNU coreutils) sí están disponibles en Git Bash
y se usaron sin cambios. Los ocho `dist` (A + tres brazos parcheados, sin
contar reconstrucciones) se digestaron y verificaron igual que en macOS; al
cerrar, el producto quedó restaurado exacto a brazo A (digest verificado,
`git status` limpio salvo el fix de §"Bug de portabilidad" de Lotes NER, no
relacionado). Campaña completa: **64 corridas Electron, 0 fallidas.**

### Calidad — preflight

A = 4 = 6 = 8 exacto en `occurrenceCount`, `occurrenceSha256`,
`groupEventCount` y `groupEventSha256`, en R1 (298 ocurrencias / 123 grupos)
y R2 (197 ocurrencias / 76 grupos). Igual que en macOS: cambiar hilos no
cambia qué detecta el motor.

### Tiempo sin sonda (mediana de 3, NER / `Ready`, segundos)

| corpus | control A | 4 hilos | 6 hilos | 8 hilos |
|---|---:|---:|---:|---:|
| **R1 real nativo** | 24,34 / 24,83 | 24,36 / 24,84 | **21,22 / 21,71** | **18,55 / 19,03** |
| **R2 real escaneado** | 10,24 / 42,96 | 10,32 / 43,25 | **8,93 / 42,11** | **7,95 / 41,46** |

Deltas pareados de NER contra A, por ronda (segundos): R1 con 6 hilos
**−3,12 / −2,81 / −3,46**; con 8, **−5,94 / −5,60 / −5,98** — 6/6 rondas a
favor, en las dos comparaciones. R2 con 6, −1,45 / +0,28 / −1,31; con 8,
−1,51 / −0,73 / −2,30 — 5/6 a favor, la única ronda en contra (+0,28 s) queda
dentro del ruido de la deriva del propio control A entre rondas (10,31 / 8,68
/ 10,24 s en R2, ~19 % de dispersión — más ruido que en R1, esperable porque
NER es una porción menor del tiempo total en un documento dominado por OCR).
4 hilos no se distingue de A en ninguno de los dos documentos (deltas
−0,16/+0,19/+0,01 s en R1; +0,02/+1,64/−0,01 s en R2).

El observador de hilos efectivos por CDP (firma de URLs blob del pool ONNX,
`support/cdpHeap.ts`) dio **`not observable` en los cuatro brazos** en esta
corrida de Windows, mientras que en macOS había identificado 4/4/6/8. La
dependencia sistemática del tiempo con el brazo (6 y 8 sostenidamente más
rápidos, en el mismo orden que los parches) es la evidencia indirecta de que
el override sí tomó efecto: son los mismos parches de una línea validados en
macOS, sobre el mismo motor.

> **Actualización (2026-09-26):** con el clasificador de hilos corregido
> (`support/nerThreadAttribution.ts`), la fase `low` corrida en Windows
> identificó **4 hilos efectivos para Automático** y 2 para el brazo de 2
> hilos, igual que en macOS (`Perfiles_Rendimiento_Revision.md`, «Brazos de
> Bajo en Windows nativo»). Automático usa 4 de los 12 hilos de esta máquina,
> lo que explica por qué acá pedir 6 u 8 acelera y en la Mac no.

### Memoria (RSS_PEAK — M2, mediana de 3, MiB)

| corpus | A | 4 | 6 | 8 |
|---|---:|---:|---:|---:|
| R1 | 1568 | 1558 | 1586 | 1587 |
| R2 | 2030 | 2041 | 2050 | 1970 |

Sin diferencia monótona ni grande entre brazos — a diferencia del tiempo, la
cantidad de hilos ONNX no mueve el pico de memoria de forma perceptible en
esta máquina.

### Cancelación

Los ocho brazos (dos documentos × cuatro brazos) dispararon
`PIPELINE_CANCELLED` en **0–1 ms** desde la solicitud, con inferencia NER
activa (`peakNerJobs: 1` en todos). Igual orden de magnitud que macOS; es
latencia del evento, no cese físico de CPU verificado.

### Lectura conjunta con macOS

| | macOS (M1 8 GB, 4 hilos efectivos automático) | Windows (i5-12400, 12 hilos visibles) |
|---|---|---|
| 4 hilos vs. automático | indistinguible | indistinguible |
| 6 hilos vs. automático | **peor** (+16,90/+17,12/+15,07 s en R1) | **mejor** (−3,12/−2,81/−3,46 s en R1) |
| 8 hilos vs. automático | **peor** (+15,02/+15,26/+18,16 s en R1) | **mejor** (−5,94/−5,60/−5,98 s en R1) |
| memoria por brazo | sin patrón consistente | sin patrón consistente |
| calidad | A=4=6=8 exacto | A=4=6=8 exacto |

El resultado depende del hardware, tal como anticipaba el veredicto local de
macOS: en una máquina con más núcleos reales libres, pedir más hilos ONNX
ayuda; en una con pocos núcleos efectivos (el M1 usa 4 "automático" de un
total de 8, mezclando rendimiento/eficiencia), pedir más los satura y
empeora. **Ninguna de las dos campañas cambia el default automático**: la
curva confirma que la política correcta, si alguna vez se fija una, tendría
que depender del hardware detectado — no de un número único — y esa decisión
sigue reservada al planificador con su propio ADR.

### Bug de portabilidad encontrado (no relacionado con hilos, afecta Lotes NER)

Al portar la campaña vecina de Lotes NER (ver
`Lotes_NER_Factibilidad.md`) sobre esta misma máquina, apareció un bug real:
`tests/perf/ner-batch-real.mjs:20` usa un regex `` /.../;\nconst build/ ``
para extraer una sección de `ner-batch-feasibility.mjs`, y ese archivo está
commiteado con **CRLF** (Windows, `core.autocrlf=true`) — el `\n` literal
nunca matchea `\r\n`, así que la extracción fallaba antes de abrir Electron.
Se corrigió a `` \r?\n `` localmente (sin commitear todavía; ver el cierre de
la sesión para pedir autorización de commit). No afecta a esta campaña de
hilos: `ner-threads.spec.ts` no usa esa extracción por regex.


---

## Ampliación macOS — carga, panel y secuencia (2026-09-26)

**Cerrada con el alcance del protocolo §1.1:** ocho preflights P1/P2,
cuatro observaciones pthread separadas y **48 importaciones reales válidas
en doce secuencias**, cero fallos o bloques invalidados por suspensión.
La selección automática conserva cuatro hilos efectivos; solicitar 4/6/8
produjo 4/6/8 observables. El agregado validó esquema, identidad, host,
revisión, modelo y hashes de fuente/build por brazo.

### Banco y procedencia

- Producto `bd6bd92`, MacBook Air M1, arm64, 8 GiB, ocho CPU visibles,
  Electron 44.2.0. Node del runner: 26.5.1; el Node integrado de Electron se
  registra aparte en cada reporte. Mismo modelo Q8 y un único worker NER.
- `tests/perf/run-ner-gaps.sh` y `tests/perf/ner-gaps.spec.ts`;
  tres bloques A→4→6→8, 8→6→4→A y A→6→8→4. Cada brazo/bloque abre
  Electron nuevo y procesa **R1→R1→R2→R2** dentro de esa instancia.
  Son cuatro documentos consecutivos por instancia, no una prueba de horas.
  Sin pausas artificiales: intervalo desde el Ready anterior hasta la
  siguiente selección, mediana **664,79 ms**, rango **385,19–837,95 ms**.
- Tiempo sin CDP/heap/GC ni campañas simultáneas. Marcas tomadas al entrar a
  `bus.emit`, antes de consumidores que pueden emitir eventos anidados;
  el wrapper conserva receptor, argumentos y resultado. Panel observado con
  `MutationObserver` y visibilidad del botón «Exportar»; es visibilidad DOM,
  **no presentación física de un frame**.
- Evidencia ignorada: `.measure/ner-gaps/20260926-macos`:
  reportes por corrida, `ner-gaps-aggregate.json`, `analysis-root.json`,
  cronología, presión, digests y copia exacta del arnés medido en
  `harness-source` con `harness-sha256.json`. El ajuste posterior de Prettier
  modifica solo formato; la copia medible y sus hashes permanecen intactos.
  Los pilotos se conservaron aparte y se excluyeron de este agregado.
  Contenido real, palabras y firmas intermedias permanecen en el renderer;
  los archivos reales se reciben por entorno, con alias R1/R2. Sin nombres,
  rutas, texto ni hashes de PDF reales en este informe.
- El runner salió con código 0 y restauró fuente y build A con digest
  verificado; no hay cambios en `packages/` o `apps/`.

### Tiempo por brazo y posición

Cada celda corresponde a tres bloques; **mediana [mínimo–máximo]**, en
segundos, para NER y Ready. Las dos columnas de panel muestran medianas;
sus rangos por importación están en los artefactos. «R1 2» significa la
segunda importación de R1 (posición global 2); «R2 1/2», posiciones 3/4.
`import` empieza en `DOCUMENT_IMPORTED`, selección antes de entregarlo a
la UI. Cada métrica se agrega por separado: sumar medianas de etapas no
reconstruye necesariamente la mediana del total.

| brazo | documento/posición | NER, s | import→Ready, s | selección→panel, s | import→panel, s |
|---|---|---:|---:|---:|---:|
| A | R1 1 | 39,89 [34,30–40,74] | 40,27 [34,69–41,12] | 40,92 | 40,87 |
| A | R1 2 | 39,64 [35,46–40,10] | 39,90 [35,71–40,36] | 40,44 | 40,39 |
| A | R2 1 | 16,27 [15,49–16,44] | 49,59 [46,66–50,56] | 50,14 | 50,05 |
| A | R2 2 | 16,43 [15,52–16,52] | 49,79 [47,05–49,90] | 50,37 | 50,29 |
| 4 | R1 1 | 40,28 [38,13–41,38] | 40,66 [38,51–41,76] | 41,28 | 41,22 |
| 4 | R1 2 | 38,17 [37,40–40,85] | 38,43 [37,65–41,12] | 38,95 | 38,88 |
| 4 | R2 1 | 16,20 [15,67–16,66] | 49,21 [48,06–51,04] | 49,80 | 49,68 |
| 4 | R2 2 | 16,28 [15,88–16,72] | 49,16 [48,04–50,70] | 49,68 | 49,60 |
| 6 | R1 1 | 56,74 [55,27–57,06] | 57,20 [55,65–57,44] | 57,73 | 57,68 |
| 6 | R1 2 | 54,45 [53,57–55,81] | 54,70 [53,82–56,07] | 55,24 | 55,19 |
| 6 | R2 1 | 22,54 [22,48–22,77] | 56,51 [55,77–56,67] | 57,07 | 56,98 |
| 6 | R2 2 | 22,34 [22,07–22,94] | 55,70 [54,52–56,78] | 56,27 | 56,19 |
| 8 | R1 1 | 54,06 [53,08–54,75] | 54,44 [53,46–55,14] | 55,14 | 55,08 |
| 8 | R1 2 | 52,76 [51,92–52,86] | 53,02 [52,18–53,11] | 53,56 | 53,52 |
| 8 | R2 1 | 22,43 [22,15–22,97] | 56,47 [55,34–56,79] | 56,92 | 56,83 |
| 8 | R2 2 | 21,99 [21,76–22,70] | 54,89 [54,72–56,46] | 55,45 | 55,37 |

### Carga observable y panel

**Mediana [mínimo–máximo]**. Carga = primer `NER_MODEL_LOADING`→
`NER_MODEL_READY`; no es el antiguo `NER_STARTED`→`MODEL_READY`.
«Después de carga» = `MODEL_READY`→`NER_FINISHED`, que incluye trabajo
host posterior; **no es tiempo puro de inferencia ONNX**. «—» indica que
no hubo eventos de carga, no una carga de cero milisegundos.

| brazo | documento/posición | carga, ms | después de carga, s | Ready→panel DOM, ms |
|---|---|---:|---:|---:|
| A | R1 1 | 992,20 [965,81–997,65] | 38,87 [33,30–39,71] | 594,36 [576,17–600,06] |
| A | R1 2 | — | — | 460,48 [170,70–497,77] |
| A | R2 1 | 811,16 [806,27–822,82] | 15,42 [14,64–15,58] | 459,23 [448,04–472,67] |
| A | R2 2 | 821,34 [810,21–824,88] | 15,57 [14,66–15,68] | 428,41 [420,70–500,86] |
| 4 | R1 1 | 949,90 [903,77–1028,07] | 39,34 [37,15–40,32] | 586,72 [559,60–596,62] |
| 4 | R1 2 | — | — | 461,07 [452,14–486,15] |
| 4 | R2 1 | 812,41 [808,19–818,89] | 15,35 [14,83–15,81] | 462,03 [461,14–470,50] |
| 4 | R2 2 | 817,67 [814,25–822,78] | 15,43 [15,02–15,87] | 425,96 [418,62–436,49] |
| 6 | R1 1 | 958,79 [956,15–970,40] | 55,73 [54,28–56,07] | 561,92 [473,11–564,95] |
| 6 | R1 2 | — | — | 488,83 [455,67–507,13] |
| 6 | R2 1 | 833,93 [828,63–849,80] | 21,65 [21,62–21,90] | 470,52 [467,77–477,16] |
| 6 | R2 2 | 856,71 [815,29–866,22] | 21,44 [21,21–22,04] | 456,14 [319,19–498,38] |
| 8 | R1 1 | 1002,81 [998,27–1010,96] | 53,02 [52,03–53,72] | 595,83 [594,45–641,05] |
| 8 | R1 2 | — | — | 492,20 [487,38–517,54] |
| 8 | R2 1 | 838,71 [802,46–850,92] | 21,56 [21,26–22,13] | 469,12 [362,07–497,94] |
| 8 | R2 2 | 829,53 [797,99–833,87] | 21,15 [20,89–21,83] | 456,97 [456,02–480,52] |

Hubo **36 cargas observadas**, entre **797,99 y 1.028,07 ms**. La primera
R1 de cada secuencia cargó; las doce segundas R1 reutilizaron el modelo.
Las **24 importaciones de R2 recargaron**, incluida su repetición inmediata.
Esto es compatible con el temporizador NER de 15 s (ADR-167,
`NER_Engine.md` §6/§13): el OCR previo dura más que ese plazo. Los eventos
prueban la recarga; esta sonda no instrumenta la causa del descarte para
atribuirla de forma independiente. Compartir Electron no garantiza modelo
caliente cuando la etapa anterior deja NER inactivo.

En conjunto, Ready→panel DOM tuvo mediana **472,89 ms**, rango
**170,70–641,05 ms**. R1 automática, segunda menos primera en Ready por
bloque: **+1,02 / −1,22 / +0,09 s**. Reutilizar el modelo elimina la carga,
pero no garantiza una reducción equivalente del tiempo total entre dos
importaciones con deriva y otras etapas. Esta campaña no mide el costo de
memoria de conservarlo ni justifica cambiar su temporizador.

### Pares dentro del bloque y deriva

Deltas en segundos contra **A del mismo bloque y posición**, bloques 1/2/3.
Positivo = más lento. Los 24 pares de cada métrica para 6/8 fueron positivos;
4 cambió de signo según el bloque y no sostuvo una ganancia frente a A.

| brazo | documento/posición | Δ NER por bloque, s | Δ import→Ready por bloque, s |
|---|---|---:|---:|
| 4 | R1 1 | 3,83 / -0,46 / 1,49 | 3,82 / -0,46 / 1,49 |
| 4 | R1 2 | 1,94 / -1,47 / 0,75 | 1,94 / -1,47 / 0,77 |
| 4 | R2 1 | 0,18 / -0,07 / 0,23 | 1,39 / -0,38 / 0,48 |
| 4 | R2 2 | 0,36 / -0,24 / 0,29 | 0,99 / -0,62 / 0,80 |
| 6 | R1 1 | 20,97 / 15,99 / 17,17 | 20,96 / 16,09 / 17,17 |
| 6 | R1 2 | 18,11 / 14,81 / 15,71 | 18,11 / 14,81 / 15,71 |
| 6 | R2 1 | 7,28 / 6,21 / 6,10 | 9,10 / 6,92 / 6,11 |
| 6 | R2 2 | 6,55 / 5,81 / 6,51 | 7,47 / 5,91 / 6,88 |
| 8 | R1 1 | 18,78 / 14,01 / 14,17 | 18,77 / 14,02 / 14,17 |
| 8 | R1 2 | 17,30 / 12,28 / 12,76 | 17,31 / 12,28 / 12,76 |
| 8 | R2 1 | 7,49 / 5,88 / 6,00 | 9,81 / 5,75 / 6,23 |
| 8 | R2 2 | 6,25 / 5,46 / 6,27 | 7,83 / 4,94 / 6,56 |

El control A de R1 primera importación tuvo NER **34,30 / 40,74 / 39,89 s**
(Ready **34,69 / 41,12 / 40,27 s**); la segunda tuvo NER **35,46 / 39,64 /
40,10 s**. Hay deriva visible de hasta 6,44 s entre los controles de la
primera posición: no se declara indistinguible del ruido ni se mezcla esta
tanda con las medianas históricas. Aun así, la penalidad pareada de 6/8 se
mantiene en los tres bloques y ambas posiciones: **12,28–20,97 s de NER**
en R1 y **5,46–7,49 s** en R2. Las cargas duran alrededor de un segundo y
la penalidad también aparece en la segunda R1 sin carga.

En R2, A primera importación tuvo NER **15,49 / 16,27 / 16,44 s** y Ready
**46,66 / 49,59 / 50,56 s**. Ready contiene OCR y otras etapas, por lo que
sus deltas no se atribuyen enteros a NER. No hubo sensor térmico: el banco
no identifica calentamiento, frecuencia o una causa física de la deriva.

### Densidad, calidad y presión

Conteos estables en todas las importaciones del mismo corpus. Caracteres =
suma de `word.text.length` (unidades UTF-16 de palabras, sin separadores);
**no son tokens**. Jobs = despachos `ner-page`, que pueden ser más que las
páginas. P1/P2 son controles de calidad, no equivalentes en densidad a R1/R2.

| corpus | páginas | palabras | caracteres | palabras/página: mediana [rango] | caracteres/página: mediana [rango] | jobs NER |
|---|---:|---:|---:|---:|---:|---:|
| P1 | 10 | 129 | 720 | 12 [12–16] | 66 [66–111] | 10 |
| P2 | 50 | 1.038 | 5.501 | 20,5 [19–26] | 106,5 [102–137] | 50 |
| R1 | 51 | 14.287 | 69.486 | 272 [124–380] | 1.372 [728–1.475] | 87 |
| R2 | 20 | 5.581 | 28.109 | 297,5 [0–383] | 1.562,5 [0–1.809] | 36 |

NER/OCR/Grouping exactos en los cuatro brazos y las dos posiciones:
R1 **298 ocurrencias, 123 grupos**; R2 **193 ocurrencias, 72 grupos,
5.581 palabras OCR**. Máximo de un job NER simultáneo en cada importación.
La diferencia con conteos Windows no es una regresión de estos brazos: la
salida OCR no es comparable entre plataformas sin fijar los píxeles
(`OCR_Entre_Plataformas_Medicion.md`, ampliación macOS).

Las 24 instantáneas de presión antes/después de secuencias registraron
swap usado **1.600,31–1.664,31 MiB**, porcentaje libre informado por
`memory_pressure -Q` **59–65 %**, **4.620 swapins** y **cero swapouts nuevos**
entre la primera y la última. Son diagnósticos del sistema completo, sin
atribución al proceso, hilos o carga. No se mide RSS/WASM por importación en
esta pasada; la curva de memoria anterior conserva sus límites.

### Cierre y pendientes

Quedan cerrados en macOS **carga observable por brazo A/4/6/8, aparición del
panel DOM y secuencia de cuatro importaciones por instancia**, con calidad
exacta. Se confirma la dirección de la curva local: pedir 6/8 empeora y 4
no sostiene ventaja sobre automático. **No cambia ningún default, contrato,
modelo, temporizador ni perfil de producto.**

Siguen separados: complemento equivalente en Windows, carga/panel/secuencia
de A/1/2 si se requiere para perfilar Bajo, atribución de memoria a la carga,
estrés de horas y decisión humana de perfiles. La medición del objetivo
sobre un **PDF real nativo de diez páginas** sigue pendiente de disponer del
corpus; P1 sintético y extrapolar desde R1 no la sustituyen.
