<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,core/OCR_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 2, curvas macOS/Windows cerradas; atribución WASM OCR 2/3/4 macOS cerrada el 2026-09-26; Windows y decisión de perfiles pendientes) -->

# Reconocedores OCR LSTM — medición macOS y Windows nativo

## Veredicto local

En la MacBook Air M1 de 8 GB, R2 real llegó a `Ready` en una mediana de **48,0 s
con 2 reconocedores**, **41,4 s con 3** (−13,7 %) y **37,9 s con 4** (−21,0 %).
La etapa OCR bajó de **31,7 a 25,1 y 21,8 s**. Los tres tamaños se ocuparon
efectivamente, el OSD compartido permaneció en uno y las huellas de OCR,
ocurrencias y grupos fueron iguales. Es una ganancia de tiempo en esta Mac,
**sin cambio de default ni presupuesto**. La atribución adicional del **2026-09-26**, al final de este informe,
completó la curva WASM por reconocedor en macOS. Sus medianas crecen en pasos
de 141,125 MiB en P2 y 85,8125 MiB en R2; el RSS total no crece de forma
lineal. La curva Windows de tiempo está cerrada más abajo; su atribución
de memoria mantiene un seguimiento separado.

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

## Pendiente antes de adoptar (histórico, punto 1 cerrado por la repetición Windows de abajo)

1. ~~Repetir el banco con R1/R2 en Windows nativo ventilado...~~ **Hecho, ver
   más abajo.**
2. Si se busca asignar un costo por reconocedor o afirmar que el presupuesto
   limita la concurrencia, añadir una sonda validada de memoria WASM/native y
   una señal de espera del `LiveImageBudget` en un banco separado. No deducir
   ambas cosas de RSS total ni de una estimación sin datos. **WASM macOS completado el 2026-09-26**,
   ver cierre al final. Memoria nativa por worker y espera del presupuesto
   permanecen sin atribución; no se infieren de RSS. La atribución Windows
   sigue separada.
3. El producto conserva el tamaño automático actual. Cualquier nuevo default,
   presupuesto o política de perfiles requiere decisión humana y ADR/specs
   antes del código de producto. **Sigue vigente tras Windows.**

---

## Repetición Windows nativo (2026-09-25)

> Commit `ee5eeba` (`hardening/plan-2026-09`), Windows 11 Pro build 26200,
> i5-12400 (12 hilos lógicos), 16,9 GB RAM, nativo (Git Bash, no WSL). Mismos
> R1/R2 que el resto de la campaña Windows de este equipo.

### Veredicto Windows

**Misma dirección que macOS, magnitud distinta.** R2 real llegó a `Ready` en
mediana de **43,17 s con 2 reconocedores**, **37,22 s con 3** (−13,8 %) y
**31,95 s con 4** (−26,0 %) — más ganancia que en la Mac (−13,7 % y −21,0 %).
La etapa OCR bajó de **32,31 a 25,99 y 20,96 s** (−19,6 % / −35,1 %). Los tres
tamaños se ocuparon efectivamente (`busyPeak` 2/3/4), huellas de OCR,
ocurrencias y grupos exactas entre brazos, cancelación en 0–1 ms. **Sin
cambio de default.**

A diferencia de la Mac (memoria "no permite establecer un costo incremental
confiable"), acá la memoria **sí sube de forma monótona** con el tamaño del
pool — ver tabla de memoria más abajo. Sigue sin sonda WASM/native por
reconocedor, así que no se afirma cuánto de ese aumento es Tesseract y cuánto
es RSS general de más trabajo concurrente.

### Protocolo — puerto del arnés

Igual limitación que en la campaña de hilos NER de este mismo equipo
(`Hilos_NER_Medicion.md`): el script original (`tests/perf/run-ocr-pool.sh`)
se niega fuera de `Darwin` y usa `pmset`/`vm_stat`/`sysctl vm.swapusage`. Se
usó un puerto ad hoc (no commiteado) que preserva el protocolo exacto — build
único, arms 2/3/4 vía el canal de overrides de ADR-155 (sin swap de `dist`,
sin parches de fuente), tres órdenes intercalados de tiempo y memoria,
cancelación por brazo, sumarizador — con las mismas tres diferencias de
instrumentación: gate de plataforma retirado, presión de sistema sustituida
por un snapshot informal de PowerShell (mismo hueco de `systemMemoryPressure.ts`
en `win32`), y la guarda `pgrep` retirada (disciplina de una sola campaña a
la vez sostenida a mano). **60 corridas Electron, 0 fallidas**,
`qualityExactAcrossArms: true`, `missingRuns: 0`.

### Tiempo (mediana de 3, segundos). P1/R1 sin OCR, control negativo

| corpus | 2: OCR / Ready | 3: OCR / Ready | 4: OCR / Ready |
|---|---:|---:|---:|
| P1 nativo sintético | — / 1,87 | — / 1,87 | — / 1,87 |
| P2 escaneado sintético | 13,58 / 18,74 | 13,28 / 18,46 | 11,32 / 16,51 |
| R1 nativo real | — / 25,16 | — / 25,30 | — / 25,03 |
| **R2 escaneado real** | **32,31 / 43,17** | **25,99 / 37,22** | **20,96 / 31,95** |

`ocrWordCountByPage`/`ocrCharacterCountByPage` medianos: **P2 21 palabras /
107 caracteres por página**, **R2 298 / 1.585** — prácticamente idéntico a la
densidad medida en macOS (21/107 y 298/1.591), confirmando que es la misma
carga efectiva sobre el mismo fixture y documentos.

### Memoria (RSS pico durante OCR, mediana de 3, MiB)

| reconocedores | P2 frío | P2 caliente | R2 frío | R2 caliente |
|---:|---:|---:|---:|---:|
| 2 | 1864 | 2669 | 1398 | 2211 |
| 3 | 2011 | 2844 | 1589 | 2449 |
| 4 | 2250 | 3055 | 1778 | 2452 |

A diferencia de la Mac, acá el frío sube monótono con el tamaño del pool en
los dos documentos (P2: +386 MiB de 2 a 4; R2: +380 MiB), y el caliente
también salvo el último paso de R2 (2449→2452, prácticamente plano). Sigue
siendo RSS del árbol entero, no memoria de Tesseract aislada por worker — no
se afirma que el incremento sea enteramente atribuible a los reconocedores
nuevos frente a, por ejemplo, más trabajo de render/decodificación concurrente.

### Cancelación

P2 y R2, los tres tamaños: latencia de evento **0–1 ms**,
`activeJobs: 1` siempre. Mismo orden de magnitud que macOS.

### Lectura conjunta con macOS

| | macOS (M1 8 GB) | Windows (i5-12400) |
|---|---:|---:|
| R2 Ready, 2→4 | 48,0 → 37,9 s (−21,0 %) | 43,2 → 32,0 s (−26,0 %) |
| R2 OCR, 2→4 | 31,7 → 21,8 s (−31,2 %) | 32,3 → 21,0 s (−35,1 %) |
| P2 Ready, 2→4 | 16,9 → 15,3 s (−9,2 %) | 18,7 → 16,5 s (−11,9 %) |
| memoria vs. tamaño de pool | sin patrón confiable | monótona creciente |
| calidad / cancelación | exacta / 0–1 ms | exacta / 0–1 ms |

Las dos plataformas coinciden en la dirección (más reconocedores ayuda,
sobre todo en R2) y en que la ganancia de P2 es menor y menos estable que la
de R2 — la densidad de texto real, no el número de páginas, sigue siendo lo
que separa ambos perfiles. La política de perfiles Bajo/Intermedio/Alto/
Automático mencionada en `MVP.md` §4 queda con datos de las dos plataformas
para discutirse, pero **la decisión de fijar cualquier default sigue
reservada al planificador con su propio ADR** — este informe no la toma.


## Atribución adicional macOS: memoria OCR 2/3/4 (2026-09-26)

**Caracterización cerrada:** 36/36 importaciones frías válidas y 54/54
snapshots completos. P2 sintético de 50 páginas y R2 real de 20; tres rondas
intercaladas por corpus (`2/3/4`, `4/3/2`, `2/4/3`), cada brazo con una
corrida de RSS natural y otra de atribución. Una instancia Electron nueva
por corrida, un mismo build, M1 arm64 de 8 GiB, Node 22. Sin cambios de
producto, defaults, DPI, modelo, presupuesto de imágenes ni contratos.

Protocolo cerrado antes de medir:
[`Perfiles_Rendimiento_Revision.md`](Perfiles_Rendimiento_Revision.md#protocolo-adicional-macos--memoria-ocr-234-2026-09-26).
Arnés: `tests/perf/run-ocr-memory.sh`, fases `pool-rss` y `pool-endstage`
de `ocr-pool.spec.ts`, `support/ocrPoolEndStage.ts` y agregador
`support/summarize-ocr-memory.mjs`. Artefactos ignorados:
`.measure/ocr-memory/20260926-macos/`, con `summary.json`, series y presión;
piloto separado en `.measure/ocr-memory/pilot-20260926/`. Build medido:
`63ed05613c01e8f18d677fd915d5232cf0cc8f24b763577a30d23fb0b5dee3b0`
(digest de nombres y contenidos). El runner terminó con código 0 y restauró
los dist previos por hash; el diff de fuentes de producto permanece vacío.

### Método y cobertura

La sonda anterior perdió lecturas mientras Tesseract ejecutaba WASM síncrono
y desconocía el rol de los chunks `entry-<hash>`. Esta tanda vincula cada
factory con los sourcemaps del build medido. En atribución, el arnés espera
que `processSession` termine normalmente y retiene su retorno **antes de la
baja del pool y de NER**. Los jobs OCR ya terminaron; se toman tres lecturas
consecutivas y se libera la barrera en `finally`. Duró **351–515 ms**, frente
al minuto de disposición por inactividad. La importación debe alcanzar Ready.

Cada snapshot observó exactamente 2/3/4 hijos LSTM y un hijo OSD, una memoria
privada positiva por hijo, heap legible y cero errores. La verificación
independiente confirmó que los únicos targets con memoria WASM positiva
fueron esos LSTM y OSD; no hubo memoria ONNX que descontar o deduplicar.
El paso 0 WASM y el piloto P2 con 2/4 plazas pasaron antes de la campaña.

Los valores WASM son **reserva lineal viva al final de OCR**, que conserva el
crecimiento alcanzado por cada reconocedor. No son RSS residente ni prueba
del pico simultáneo de todas las asignaciones durante cálculo activo. El
heap JS se lee después de GC e incluye los objetos retenidos por la barrera;
no incluye todo el backing store/nativo. El RSS viene de **otras corridas,
sin CDP ni barrera**, muestreado cada 150 ms durante OCR. No se suman estos
instrumentos ni se obtiene memoria nativa por resta. Los tres snapshots de
una corrida son lecturas repetidas, no tres importaciones independientes.

### WASM y heap del pool retenido

Medianas en MiB (2^20 bytes), nueve snapshots de tres importaciones por brazo.
La suma LSTM cuenta cada memoria privada aunque sus tamaños sean idénticos.

| corpus | LSTM | suma WASM LSTM | OSD único | WASM total observado | heap JS de todos los targets |
|---|---:|---:|---:|---:|---:|
| P2 | 2 | 282,250 | 64,500 | 346,750 | 22,744 |
| P2 | 3 | 423,375 | 64,500 | 487,875 | 24,548 |
| P2 | 4 | 564,500 | 64,500 | 629,000 | 28,933 |
| R2 | 2 | 171,625 | 53,750 | 225,375 | 23,128 |
| R2 | 3 | 257,438 | 53,750 | 311,188 | 24,946 |
| R2 | 4 | 343,250 | 53,750 | 397,000 | 29,286 |

**R2 fue exacto en las tres rondas:** cada LSTM reservó 89.980.928 bytes
(85,8125 MiB, ~90 MB decimales), y el incremento 2→3 y 3→4 fue el mismo.
**P2 fue lineal en las medianas**, con incrementos de 147.980.288 bytes
(141,125 MiB, ~148 MB decimales). Hubo una excepción que se conserva:
un worker de OCR4 quedó en 117,5625 MiB en la primera ronda, por lo que la
suma de ese pool fue 540,9375 MiB; las otras dos dieron 564,5 MiB. El OSD
también osciló entre 53,75 y 64,5 MiB en P2. Los tamaños avanzan por escalones;
no se promete un costo constante para cualquier reparto o documento.

### RSS natural durante OCR

Tres importaciones independientes por brazo; mediana y rango en MiB.

| corpus | LSTM | RSS mediana | rango |
|---|---:|---:|---:|
| P2 | 2 | 1.620,8 | 1.596,0–1.731,4 |
| P2 | 3 | 1.619,5 | 1.590,3–1.676,3 |
| P2 | 4 | 1.742,0 | 1.699,4–1.777,9 |
| R2 | 2 | 1.535,5 | 1.455,9–1.625,0 |
| R2 | 3 | 1.496,4 | 1.462,7–1.592,2 |
| R2 | 4 | 1.524,9 | 1.485,0–1.553,0 |

El RSS no muestra crecimiento lineal ni monótono en R2. Tampoco demuestra
que OCR3/4 ahorre memoria: los rangos se solapan y el total incluye otros
recursos. El sistema empezó y terminó con **1.352,31 MiB de swap utilizado**,
sin variación en las observaciones antes/después; esto no prueba ausencia de
compresión o de otras variaciones del SO. No hubo suspensión detectada.

### Conclusión y alcance del cierre

Las 36 salidas tuvieron huellas exactas de OCR, ocurrencias y grupos contra
OCR2 de su ronda; cero páginas fallidas o ausentes, ocupación efectiva 2/3/4,
un OSD y presupuesto de imágenes de 128 MiB. El agregador volvió a sumar las
lecturas crudas por target y verificó identidad, cobertura, calidad y picos
RSS. No se almacenaron documentos reales, texto ni rutas personales en los
informes versionados.

Se cierra **la medición macOS de reserva WASM por reconocedor y curva 2/3/4**:
las medianas son lineales para estos dos corpus, con la variación P2 descrita.
**No se cierra una hipótesis de crecimiento lineal de RAM total** ni se
atribuyó memoria nativa a cada worker. Es una limitación declarada del banco,
no una cifra faltante que deba rellenarse con RSS−WASM. La decisión de perfiles
sigue pendiente de la evidencia Windows y de aprobación humana; no se
publican nuevos valores. El documento nativo real de 10 páginas sigue siendo
una medición aparte pendiente de entrada.

Validación del arnés: lint y typecheck globales verdes; 172 archivos de test,
2.733 tests pasados y uno omitido, cobertura de líneas 96,24 %; 331 contratos
pasados. Formato de los archivos de código modificados, sintaxis Bash y
`git diff --check` verdes. El único cambio posterior a medir en la sonda
traslada la apertura CDP dentro del `try` para restaurar la barrera también
si falla la conexión; el camino medido de snapshots permanece igual.
