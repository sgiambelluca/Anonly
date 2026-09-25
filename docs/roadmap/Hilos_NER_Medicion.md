<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,core/NER_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 1, medición macOS 2026-09-23/24 y Windows nativo 2026-09-25; ambas cerradas) -->

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
carga o al panel. Esas tres mediciones del plan original siguen pendientes y
deben añadirse en la repetición de Windows o en una ampliación controlada del
banco; la conclusión local se limita a inferencia, `Ready`, pico RSS, calidad y
cancelación.

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
`support/cdpHeap.ts`) dio **`not observable` en los cuatro brazos, en las dos
plataformas de este equipo** (ya lo era en macOS con 4/4/6/8 confirmados por
otra vía) — el número de hilos no se pudo verificar directamente por CDP acá.
La dependencia sistemática del tiempo con el brazo (6 y 8 sostenidamente más
rápidos, en el mismo orden que los parches) es la evidencia indirecta de que
el override sí tomó efecto: son los mismos parches de una línea validados en
macOS, sobre el mismo motor.

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
