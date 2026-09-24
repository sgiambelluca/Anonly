<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,core/NER_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 1, medición macOS 2026-09-23/24; Windows nativo pendiente) -->

# Hilos internos de ONNX para NER — medición macOS

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

## Pendiente antes de adoptar

1. Portar el arnés de builds y la lectura de presión a Windows nativo, sin usar
   WSL como sustituto. Repetir A/4/6/8 con R1/R2 y controles intercalados en la
   máquina ventilada indicada por el humano; conservar la misma exigencia de
   calidad, memoria, tiempo sin sonda y cancelación. La política de perfiles
   espera además la curva de reconocedores OCR.
2. El producto permanece con selección automática del runtime. Si alguna curva
   futura justificara fijar hilos, el planificador debe escribir ADR y actualizar
   el contrato/configuración de NER antes de encargar ese cambio. Esta campaña
   solo midió builds experimentales y no modificó `Contracts.md` ni el motor.
