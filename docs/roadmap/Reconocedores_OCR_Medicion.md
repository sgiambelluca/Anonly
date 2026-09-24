<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,core/OCR_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 2, medición macOS 2026-09-24; Windows nativo pendiente) -->

# Reconocedores OCR LSTM — medición macOS

## Veredicto local

En la MacBook Air M1 de 8 GB, R2 real llegó a `Ready` en una mediana de **48,0 s
con 2 reconocedores**, **41,4 s con 3** (−13,7 %) y **37,9 s con 4** (−21,0 %).
La etapa OCR bajó de **31,7 a 25,1 y 21,8 s**. Los tres tamaños se ocuparon
efectivamente, el OSD compartido permaneció en uno y las huellas de OCR,
ocurrencias y grupos fueron iguales. Es una ganancia de tiempo en esta Mac,
**sin cambio de default ni presupuesto**. La memoria observada no permite
establecer un costo incremental confiable por reconocedor; falta medición
WASM/native atribuida a cada worker y la repetición en Windows nativo ventilado.

El documento sintético P2 de **50 páginas** exigió **~5.500 caracteres de
palabras OCR**; R2 real, con **20 páginas**, exigió **~28.100**. Son ~110 frente a
~1.405 caracteres por página, casi **13 veces más carga por página** en R2. La
curva de P2 no predice la de R2: con 3 reconocedores P2 quedó prácticamente
igual que el control, mientras R2 mejoró en los tres pares. El número de páginas
no se usa como sustituto de la densidad de texto.

## Protocolo y exclusión por suspensión

- Un mismo build de Electron empaquetado, `crossOriginIsolated` y Web Workers
  reales; override de arnés de ADR-155 exclusivamente en
  `workerPool.ocrPoolSize = 2/3/4`. OSD único, OCR a DPI efectivo de producto,
  idiomas/heurísticas y `maxLiveImageBytes = 128 MiB` sin cambios. Una instancia
  nueva de Electron por corrida, órdenes 2→3→4, 4→3→2 y 2→4→3.
- P1/P2 son fixtures, R1 es nativo real de unas 50 páginas y R2 escaneado real
  de 20. Se usaron solo como entradas locales de la app mediante las variables
  del protocolo T-10; los informes versionados no guardan sus nombres, rutas,
  contenido, tamaños exactos de archivo ni hashes de entrada. Las corridas
  crudas están ignoradas por Git en `.measure/ocr-pool/`.
- La primera tanda de tiempo R2 sufrió una **suspensión del equipo confirmada
  por el humano**. Sus nueve identificadores quedaron en
  `.measure/ocr-pool/20260924T020227Z/validity.json` y se excluyeron enteros,
  incluidos el cierre de una ventana y un timeout de esa tanda. No se atribuyen
  a un tamaño de pool. Se repitió el bloque completo en
  `.measure/ocr-pool/20260924T024257Z`, con reposo automático inhibido y equipo
  conectado a corriente: 9/9 corridas de tiempo válidas, 18/18 perfiles de
  memoria P2/R2 y 6/6 cancelaciones P2/R2. El `summary.json` de la segunda
  carpeta combina los controles P1/P2/R1 de la primera con R2 y memoria de la
  segunda; `missingRuns` está vacío y `qualityExactAcrossArms` es verdadero.

## Tiempo sin sonda de memoria

Mediana de tres corridas por brazo, segundos. `Ready` es importación completa;
OCR es solo su etapa. P1/R1 no ejecutaron OCR y sirven como control negativo.

| corpus | 2: OCR / Ready | 3: OCR / Ready | 4: OCR / Ready |
|---|---:|---:|---:|
| P1 nativo sintético | — / 2,24 | — / 2,28 | — / 2,25 |
| P2 escaneado sintético | 11,15 / 16,85 | 11,14 / 16,66 | 9,64 / 15,30 |
| R1 nativo real | — / 39,67 | — / 39,91 | — / 39,69 |
| **R2 escaneado real** | **31,66 / 47,99** | **25,08 / 41,40** | **21,80 / 37,93** |

Los deltas pareados de `Ready` contra 2 en R2 fueron **−5,83 / −6,58 /
−5,82 s** para 3 y **−7,83 / −10,06 / −9,40 s** para 4. El control 2 pasó de
44,62 a 48,27 s (+8,2 %) entre la primera y tercera ronda, compatible con
deriva térmica u otra carga no observada; las ventajas pareadas de 3 y 4
persistieron pese a esa deriva. En P2, 3 dio −0,03 / −0,44 / +0,12 s, sin
ganancia estable, y 4 dio −1,76 / −1,54 / −1,67 s. El comportamiento diferente
de P2 y R2 justifica conservar ambos, con prioridad de R2 para una decisión de
producto.

Los eventos `WORKER_JOB_DISPATCHED`/terminales registraron máximo de **2/3/4
trabajos `ocr-page` simultáneos** respectivamente, y máximo de **1 `ocr-orient`**
en todos los brazos. Eso demuestra ocupación efectiva de reconocedores; la
ventana contractual de requests no se confunde con trabajos iniciados. La
salida OCR tuvo en R2 una mediana de **298 palabras / 1.591 caracteres de
palabras por página** (P95: 361 / 1.774), frente a **21 / 107** en P2. En R1
el parser dio una mediana de 272 palabras/página; el evento público no permitió
sumar sus caracteres sin instrumentación adicional.

## Memoria, calidad y límites de observación

El pico de RSS del árbol Electron **durante OCR** en R2, mediana de tres perfiles
en MiB, fue:

| reconocedores | import frío: mediana (rango) | import caliente: mediana (rango) |
|---:|---:|---:|
| 2 | 1405 (1405–1409) | 1842 (1842–1846) |
| 3 | 1549 (1533–1557) | 1846 (1737–1917) |
| 4 | 1506 (1431–1595) | 1574 (1529–1891) |

Estas cifras son **RSS del árbol entero**, no memoria de Tesseract por worker.
El caliente y el brazo 4 varían mucho; la presión del sistema, el compresor y
el caché alteran el RSS. No se infiere un ahorro de memoria de 4 frente a 2.
La sonda de este banco captura RSS y heap JS por target, pero **no** memoria
WASM/native atribuida a cada reconocedor. M1 frío se reportó `null` por ventana
sin observación suficiente, nunca como cero. Los tiempos de la tabla anterior
provienen de corridas sin la sonda.

El evento público no expone las dimensiones RGBA efectivas de cada página en
esta ruta: las estimaciones del arnés quedaron sin dato. Tampoco hay señal
directa de espera en `LiveImageBudget`. Por tanto, este banco **no** puede
afirmar cuántos milisegundos limitó el presupuesto de 128 MiB ni asignar un
valor cero a la reserva. La ocupación observada 2/3/4 sí muestra que los tres
tamaños llegaron a ejecutar trabajos OCR simultáneos. Una campaña que varíe
el presupuesto sería otra comparación, con decisión y protocolo separados.

Las huellas exactas de palabras OCR, ocurrencias Regex/NER y grupos coincidieron
entre brazos en P2 y R2; no hubo página OCR fallida. La cancelación se solicitó
con un trabajo OCR activo en P2/R2 para cada tamaño y llegó al evento de
cancelación en 0–1 ms. Esta es latencia del evento, no prueba independiente de
que el cálculo WASM se detuviera físicamente en ese instante.

## Pendiente antes de adoptar

1. Repetir el banco con R1/R2 en **Windows nativo ventilado**, con controles
   propios de esa plataforma. WSL no sustituye ese resultado. La matriz de
   perfiles sigue provisional hasta tener esa curva y el costo de memoria.
2. Si se busca asignar un costo por reconocedor o afirmar que el presupuesto
   limita la concurrencia, añadir una sonda validada de memoria WASM/native y
   una señal de espera del `LiveImageBudget` en un banco separado. No deducir
   ambas cosas de RSS total ni de una estimación sin datos.
3. El producto conserva el tamaño automático actual. Cualquier nuevo default,
   presupuesto o política de perfiles requiere decisión humana y ADR/specs
   antes del código de producto.
