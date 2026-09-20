<!-- CONTEXT: scope=roadmap-medicion | tarea=banco-windows | dependencias=roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,roadmap/Optimizacion_De_Memoria_Plan.md,architecture/07_Performance_Strategy.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-150-La-Pantalla-De-Escaneo-Dura-Lo-Que-Dura-El-Escaneo.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,tests/perf/README.md,adr/ADR-165-Una-Franja-Ya-Explicada-No-Se-Reconoce.md,roadmap/Margenes_Menos_Pixeles_Medicion_I1.md | audiencia=humanos+IA | fase=11 -->

# Banco Windows — el hardening contra la versión anterior, y esta máquina contra el M1

> Medido el 2026-09-19 sobre el commit `bbb32b8` (punta de `hardening/plan-2026-09`)
> contra `19b4d13` (release 0.9.2, 2026-09-05), que es **exactamente** el binario
> instalado en `C:\Program Files\Anonly`. Entre los dos hay 142 commits.
> Documentos reales R1 y R2, los mismos de
> [`Ciclos_Y_Documentos_Reales_Medicion.md`](Ciclos_Y_Documentos_Reales_Medicion.md),
> verificados byte a byte por sha256 entre Windows y WSL.

---

## 0. Veredicto, antes de los datos

**El hardening no se pagó en tiempo, y en el escaneado cobró de las dos formas.**
Sobre el documento nativo (R1) las dos versiones llegan a `Ready` a la vez (−0,2 s);
sobre el escaneado (R2) la nueva llega **7,7 s antes (−15 %)** y usa **la mitad de
memoria** (4215 → 2075 MB de pico). El pico del renderer en R2 cae de 3402 MB a
1437 MB, y el residuo tras cerrar el documento, de 4052 MB a 1962 MB. Las dos versiones
arrancan en los mismos ~380 MB: la diferencia entera aparece al procesar.

**Esta máquina no es uniformemente más rápida que el M1: depende del motor.**
La inferencia de NER es ~40 % más rápida (0,45 contra 0,64-0,77 s por página), pero
el OCR es **igual o levemente peor** (1,66 contra 1,54-1,64 s por página). Por eso R1,
que es casi todo NER, mejora ~32 %, y R2, que es dos tercios OCR, apenas ~10 %. Sobre
el fixture P2, que es OCR puro, **el M1 gana**: 17,1-17,9 s contra 18,9 s acá.

**Lo que sí cambió del todo es la estabilidad.** En el M1, R1 iba de 33,7 a 40,3 s
entre rondas (20 % de dispersión), atribuido sin verificar al estrangulamiento térmico
de una Air sin ventilador. Acá el rango es 24,4-24,9 s: **2 %**. Y en WSL, sobre el
mismo silicio, la dispersión vuelve (26,1-30,3 s). Es el dato que más respalda aquella
hipótesis.

**La VM de WSL cuesta entre 15 % y 22 % de tiempo.** Mismo commit, misma máquina:
R1 24,5 s en Windows nativo contra 29,8 s en WSL; R2 42,7 contra 49,3 s. Sirve para
desarrollo, no para fijar un número de producto.

Tres cosas que salen de acá y no le corresponde decidirlas al planificador, en §6.

---

## 1. El banco

| | Windows nativo | WSL (Ubuntu) | M1 (campaña previa) |
|---|---|---|---|
| CPU | i5-12400, 6 núcleos / 12 hilos, sin límite térmico | los mismos 12 hilos, virtualizados | MacBook Air M1, **sin ventilador** |
| RAM visible | 15,8 GB | 7,9 GB (la mitad, tope por defecto de WSL2) | 8 GB |
| SO | Windows 11 Pro 26200 | Ubuntu bajo WSLg | macOS |
| Electron | 44.2.0 | 44.2.0 | 44.2.0 |

El tope de 7,9 GB de WSL no se tocó a propósito: deja a la VM con el mismo orden de
memoria que tenía el M1.

**Control descartado: no es Chromium.** Los dos lockfiles —`19b4d13` y `bbb32b8`—
resuelven `electron@44.2.0` **exacto**, no un rango. Las dos versiones corren el mismo
runtime, así que nada de §3 se explica por un cambio de Electron.

**Presión del sistema: no registrada en Windows.** `systemMemoryPressure.ts` implementa
lectores para darwin y linux; en `win32` devuelve `available: false`. No es un cero
silencioso —el reporte lo dice— pero significa que las corridas de Windows **no tienen
el chequeo de "RSS confundido"** que sí tuvieron las del M1. En una máquina de 16 GB
con el banco en reposo el riesgo es bajo, no nulo.

---

## 2. El instrumento — por qué hubo que escribir uno nuevo

La versión anterior está instalada como **producto de producción**, y el colector de
fases de `tests/perf/support/memoryProfile.ts` necesita `globalThis.__anonlyCore`, que
solo existe con `VITE_E2E=1`. Medirla con el instrumento de T-10/T-13 es imposible.

`tests/perf/external-baseline.spec.ts` mide lo que cualquier app de Electron expone,
sin tocar la app:

- **tiempo**: el texto del `[role="status"]` de la toolbar. `pipelineStageLabel.ts` y
  `PipelineStatus.tsx` son **idénticos byte a byte** entre `19b4d13` y `bbb32b8`
  (`git diff` sobre `components/toolbar/` solo toca `pipelineErrorPresentation.ts`):
  la misma vara mide las dos versiones.
- **memoria**: `app.getAppMetrics()` vía `startMemorySampling`, el mismo sampler de
  H-10 (ADR-146 §3), que lee desde el arnés y no desde la app.
- **fases**: un `MutationObserver` sobre ese texto, con los dígitos normalizados
  ("página 3 de 51" → "página N de N") para que cada etapa aparezca una vez.

Confidencialidad, igual que T-10/T-13 (plan §3.1): las rutas llegan por entorno, el
documento se importa con nombre neutro y del contenido no sale nada al reporte.

**El lado `repo` corre el build con `VITE_E2E=1`**, el mismo de T-10/T-13, y el `.exe`
es de producción. No sesga la comparación: en `core-adapter/index.ts` esa variable
solo (a) publica `__anonlyCore` en `globalThis` y (b) lee un canal de overrides de
`localStorage` que en un perfil recién creado está vacío. Ninguna de las dos toca el
pipeline.

### 2.1 El "Listo" no cae en el mismo lugar en las dos versiones

Es la trampa que había que desarmar antes de comparar, y es un cambio de producto real:

- **0.9.2** salía de la pantalla de escaneo a los **6 s** (`SCAN_ADVANCE_MAX_MS`) o al
  20 % de las páginas (`SCAN_ADVANCE_PAGE_RATIO`), y mostraba el panel de trabajo —con
  el visor dibujando— **mientras el pipeline seguía corriendo**. Su "Listo" cae
  exactamente en `PIPELINE_READY`.
- **`bbb32b8`** se queda en la pantalla de escaneo hasta `Ready` y recién ahí avanza,
  esperando la vista previa de la página 1 con una gracia de hasta 1000 ms
  (`SCAN_ADVANCE_PREWARM_GRACE_MS`), sobre un piso de 1200 ms desde el import
  (`SCAN_ADVANCE_MIN_MS`, ADR-150).

Medido **dentro de la misma corrida**, sobre las marcas de etapa: en R1 la pantalla de
escaneo entra en `Ready` a los +25,4 s y el panel de trabajo aparece a los +26,5 s —
**1,1 s de gracia**. En R2 son +42,5 s y +43,2 s: **0,7 s**, porque durante el OCR
largo la página 1 ya quedó precalentada y la espera casi no se cobra.

El resto de la diferencia contra el instrumentado (24,5 s de `DOCUMENT_IMPORTED` a
`Ready` en R1) es el lead-in del import: el instrumento externo arranca el reloj en
`setInputFiles`, ~0,9 s antes de que se emita `DOCUMENT_IMPORTED`. Ese lead-in lo
pagan las dos versiones por igual, así que se cancela en la comparación.

**No es un defecto del número percibido**: `07_Performance_Strategy.md` §1 define
"Import → panel de trabajo" como el presupuesto de la clase de documento **más** el
piso de 1,2 s de ADR-150. El tiempo con la pantalla de escaneo adentro es el
contractual.

---

## 3. El hardening contra 0.9.2 — la comparación principal

Doce corridas, tres rondas, alternando versión y documento para que ninguna quede
siempre primera. Cero fallos. Una corrida = una instancia = primera importación +
reapertura a los 5 s. Mediana de tres, rango entre paréntesis.

### 3.1 Tiempo (percibido: hasta que el panel de trabajo dice "Listo")

| documento | 0.9.2 instalado | hardening `bbb32b8` | delta |
|---|---|---|---|
| **R1** nativo ~51 p, 1ª importación | 26,0 s (25,4-26,0) | 26,5 s (26,1-26,5) | +0,5 s |
| **R1**, reapertura | 24,5 s (24,5-25,0) | 25,6 s (25,5-26,5) | +1,1 s |
| **R2** escaneado 20 p, 1ª importación | 50,3 s (48,9-50,5) | **43,4 s** (43,0-44,5) | **−6,9 s (−14 %)** |
| **R2**, reapertura | 47,2 s (45,7-47,3) | **43,5 s** (43,0-44,5) | **−3,7 s (−8 %)** |

El `Ready` de las dos versiones se puede leer **de las mismas marcas de etapa**, sin
estimar el desfase: en 0.9.2 la toolbar entra en "Listo" al llegar a `Ready`, y en la
versión nueva la pantalla de escaneo entra en "Analizando…" en ese mismo momento (es
el `default` de su etiqueta, y `Grouping` dura 0 ms acá, así que no hay etapa
intermedia que la tape). Mismo reloj, mismas corridas intercaladas:

| documento | `Ready` en 0.9.2 | `Ready` en hardening | delta |
|---|---|---|---|
| **R1** | +25,6 s | +25,4 s | −0,2 s (empate) |
| **R2** | +50,2 s | **+42,5 s** | **−7,7 s (−15 %)** |

O sea: en el nativo las dos versiones llegan a `Ready` a la vez y lo que se ve como
+0,5 s es la gracia de la pantalla de escaneo; en el escaneado la ventaja del
hardening es incluso mayor medida en `Ready` (−7,7 s) que percibida (−6,9 s).

### 3.2 Memoria (pico de la suma de `workingSetSize` sobre todos los procesos)

| documento | 0.9.2 instalado | hardening `bbb32b8` | delta |
|---|---|---|---|
| **R1** | 1915 MB (1913-1936) | 1773 MB (1750-1780) | **−142 MB (−7 %)** |
| **R2** | 4215 MB (4208-4243) | **2075 MB** (2055-2101) | **−2140 MB (−51 %)** |

Por proceso, en el pico de R2:

| proceso | 0.9.2 | hardening |
|---|---:|---:|
| Tab (renderer) | 3402 MB | **1437 MB** |
| GPU | 555 MB | 420 MB |
| Browser | 193 MB | 163 MB |
| Utility | 57 MB | 54 MB |

Casi todo el ahorro está en el renderer del documento escaneado: **−1965 MB**. Hay al
menos dos causas candidatas y **esta medición no las separa**:

1. el cambio de §2.1 — 0.9.2 monta el visor a los 6 s y dibuja previews **mientras el
   OCR corre**, y la versión nueva se queda en la pantalla de escaneo;
2. el trabajo de ImageData de la campaña (`ImageData_Perfilado_Resultados.md`).

**Corrección documental (2026-09-20): I-1 sí forma parte del hardening medido.**
ADR-165 registra su implementación en `b76d18c` y su aceptación tras el A/B del
2026-09-17: omite las pasadas de una franja cuya tinta ya está explicada por las
palabras reconocidas. No recorta la franja. `Margenes_Menos_Pixeles_Resultados.md`
§0 describe una etapa anterior a esa implementación; I-2 se evaluó después sin
implementarse e I-3 tampoco se implementó. El A/B de I-1 demostró ahorro de tiempo
en P2, **no ahorro RSS**, así que no permite atribuirle parte de los −1965 MB de R2.
Separar (1) de (2) pediría una corrida con el visor forzado a montarse temprano.
**Decidido por el humano (2026-09-19): no hace falta.** Lo que importaba era que
el pico bajara, no a cuál de
las dos causas atribuirlo.

### 3.2bis El residuo después de cerrar el documento

Línea de base tomada con la app abierta y sin documento: al arrancar, y otra vez tras
`closeDocument()` más 2 s de asentamiento.

| | reposo al abrir | tras cerrar R1 | tras cerrar R2 |
|---|---:|---:|---:|
| 0.9.2 instalado | 383 MB | 1824 MB | **4052 MB** |
| hardening `bbb32b8` | 379 MB | 1512 MB | **1962 MB** |

Las dos versiones **arrancan iguales** (~380 MB), y ahí se separan: cerrar un escaneado
deja 4 GB residentes en 0.9.2 contra 2 GB en la versión nueva. Es RSS crudo, **sin GC
forzado**: T-9 ya había documentado (§1.2 de aquel informe) que seis segundos después
de cerrar un escaneado quedan ~350 MB de basura sin recolectar que a los 90 s ya no
están. La diferencia de 2,1 GB entre versiones es demasiado grande para explicarse solo
con eso, pero **el número absoluto de cada columna no es retención**: para eso hay que
leer el heap, no el RSS (ADR-159).

### 3.3 Reparto por etapa, R2 (mediana de tres rondas)

| etapa | 0.9.2 | hardening |
|---|---:|---:|
| apertura / lectura del PDF | 0,4 s | 0,4 s |
| OCR | 38,9 s | **31,8 s** |
| carga del modelo de NER | 1,1 s | 1,0 s |
| NER | 9,5 s | 9,1 s |

Los ~7 s que gana R2 salen del **OCR** (−18 %), no de NER. **No se atribuyen a un
cambio en particular.** El candidato obvio es ADR-164 (un OSD compartido por Core),
pero su cierre (`T5_OSD_Compartido_Cierre_Final.md`) midió −24 % sobre P2 **antes** de
restituir las pasadas rotadas —que devolvieron +5,9 s— y advierte que ese beneficio
"no se extrapola" al régimen final: su número no sirve para confirmar este.
I-1 también está implementada (ADR-165, `b76d18c`): su A/B posterior midió
**6,234 s de ahorro medio de OCR sobre P2**, al evitar 200 pasadas de margen
con la misma huella de calidad (`Margenes_Menos_Pixeles_Medicion_I1.md`). Es una
causa candidata del ahorro temporal, pero ese resultado **no se extrapola a R2**
ni separa su contribución de los otros cambios. Igual que en §3.2, el humano
decidió que la atribución del ahorro global no hace falta.

---

## 4. Esta máquina contra el M1 — mismo commit, mismo instrumento

T-13 y T-10 corridas tal cual (`real-docs-timing.spec.ts` y `real-docs.spec.ts`,
tres rondas, orden alternado), así que estos números son directamente comparables
contra las tablas de `Ciclos_Y_Documentos_Reales_Medicion.md` §2 y §7.

### 4.1 T-13 — import → `Ready`, sin instrumento de memoria

| documento | Windows nativo | M1 8 GB | delta |
|---|---|---|---|
| **R1** 1ª importación | **24,5 s** (24,4-24,9) | 33,7 / 40,3 / 40,3 s | ~32 % más rápido |
| **R1** reapertura | 24,4 s (23,1-24,7) | 35,1 / 37,9 / 38,0 s | ~35 % más rápido |
| **R2** 1ª importación | **42,7 s** (42,1-43,2) | 46,8 / 47,8 / 49,2 s | ~10 % más rápido |
| **R2** reapertura | 42,0 s (41,8-42,1) | 46,5 / 46,9 / 47,9 s | ~11 % más rápido |

**La dispersión entre rondas casi desaparece.** En el M1, R1 iba de 33,7 a 40,3 s
(20 %), y §7.3 de aquel informe lo atribuyó, plausible y no verificado, al
estrangulamiento térmico de una Air sin ventilador. Acá el rango es 24,4-24,9 s
(2 %). **Es consistente con esa hipótesis**, y es el dato que más la respalda: el
mismo binario, sobre un banco con disipación, deja de dispersarse.

### 4.2 Por motor — de dónde sale (y de dónde no sale) la mejora

| | Windows | M1 |
|---|---|---|
| OCR por página (R2) | **1,66 s** | 1,54-1,64 s |
| NER por página (R1) | **0,45 s** | 0,64-0,77 s |
| carga del modelo de NER | 1,10-1,22 s | 0,8-1,0 s |

El OCR de Tesseract sobre WASM **no mejora** en este banco; la inferencia de NER sobre
ONNX mejora ~40 %. La carga del modelo es un poco más lenta. Se ve entero en el fixture
escaneado, que es OCR puro:

| perfil | Windows frío | M1 frío |
|---|---|---|
| P1 fixture nativo 10 p | 1,8 s | 2,2-2,4 s |
| **P2 fixture escaneado 50 p** | **18,9 s** | 17,1-17,9 s |
| R1 real nativo ~51 p | 25,0 s | 34,8-40,9 s |
| R2 real escaneado 20 p | 43,9 s | 46,8-49,8 s |

**P2 es el único perfil que empeora.**

### 4.3 T-10 — memoria (M2, pico dentro de la ventana de fases)

| perfil | Windows frío | M1 frío | Windows caliente | M1 caliente |
|---|---|---|---|---|
| P1 | 1574 MB | 1535 / 1730 / 1653 | 1284 MB | 1376 / 1336 / 1200 |
| P2 | 2204 MB | 1721 / 1779 / 2025 | 2763 MB | 1551 / 1900 / 1972 |
| R1 | 1629 MB | 1395 / 1346 / 1672 | 1368 MB | 1398 / 882 / 1302 |
| R2 | 2115 MB | 1651 / 1579 / 1589 | 2432 MB | 2052 / 1997 / 2016 |

**Estos dos no se restan.** `workingSetSize` de Windows y el RSS de macOS no cuentan lo
mismo, y —más determinante— el banco del M1 corrió **bajo presión** (compresor en
1,9-3,7 GB, swap subiendo de 272 MB a ~1,1 GB), que empuja el RSS hacia abajo por
evicción. Que Windows dé más alto es lo esperable de una máquina de 16 GB en reposo,
no necesariamente más memoria pedida. La comparación de memoria que **sí** se sostiene
es la de §3.2: dos versiones, mismo SO, misma máquina, misma sesión.

**Corrección documental (2026-09-20): esta tabla muestra M2, no M1.** ADR-146
§1/§7/§7ter define **M1** como el pico durante el procesamiento menos la base
caliente, con presupuesto **< 512 MB para 50 páginas**, y **M2** como el pico total
del árbol dentro de la ventana de fases, con presupuesto técnico **~1,6 GB con
OCR/NER** (~870 MB sin ellos). El pico posterior a `Ready` se reporta aparte.
Por lo tanto, no corresponde dividir los M2 de esta tabla por 512 MB ni afirmar
que todos los perfiles incumplen ese límite por un factor de 3 a 5.

P2 en Windows supera la referencia M2 de ~1,6 GB en frío y caliente (2204 y
2763 MB); eso conserva el problema de presupuesto total, con su métrica correcta.
Para M1 hace falta su propia medición: un valor menor que 512 MB **no demuestra
cumplimiento**, porque es una cota inferior; uno mayor sí demuestra exceso bajo
esa definición. T-10 dejó pendiente cómo tratar la recarga de NER durante la
corrida caliente de R2 (`Ciclos_Y_Documentos_Reales_Medicion.md` §2.3).

---

## 5. WSL contra Windows nativo — cuánto distorsiona la VM

Mismo commit, misma máquina, mismo instrumento, corridas separadas en el tiempo (nunca
dos mediciones a la vez).

### 5.1 T-13

| documento | Windows nativo | WSL | costo de la VM |
|---|---|---|---|
| **R1** 1ª importación | 24,5 s (24,4-24,9) | 29,8 s (26,1-30,3) | **+22 %** |
| **R1** reapertura | 24,4 s | 27,6 s (24,4-28,0) | +13 % |
| **R2** 1ª importación | 42,7 s (42,1-43,2) | 49,3 s (46,6-49,5) | **+15 %** |
| **R2** reapertura | 42,0 s | 46,1 s (45,8-48,8) | +10 % |

Por etapa: el OCR pasa de 31,5-33,2 s a 34,2-34,7 s, y NER de 22,8-23,3 s a
24,0-28,1 s. **La VM se paga en los dos motores**, algo más en NER.

Y la dispersión vuelve a aparecer: en WSL R1 va de 26,1 a 30,3 s, con la primera ronda
como la más rápida —el mismo patrón que el M1—, mientras que en Windows nativo el rango
es de 0,5 s. Sobre el mismo silicio: no es el procesador, es el entorno.

### 5.2 T-10 — tiempo y memoria, los cuatro perfiles

| perfil | Windows frío | WSL frío | Windows M2 | WSL M2 |
|---|---|---|---|---|
| P1 | 1,8 s | 2,4 s (+33 %) | 1574 MB | 1644 MB |
| P2 | 18,9 s | 23,5 s (+24 %) | 2204 MB | 1857 MB |
| R1 | 25,0 s | 27,6 s (+10 %) | 1629 MB | 1758 MB |
| R2 | 43,9 s | 50,8 s (+16 %) | 2115 MB | 1742 MB |

El M2 de los escaneados sale **más bajo** en WSL que en Windows (P2 −347 MB, R2
−373 MB). Es lo esperable de una VM con 7,9 GB contra un host con 15,8 GB: menos
memoria disponible, más presión, menos páginas residentes. No significa que la app pida
menos.

A favor de WSL para diagnóstico: **ahí el lector de presión del sistema sí existe**
(`/proc/meminfo`), así que una corrida de WSL queda con el contexto que a una de
Windows le falta (§1).

### 5.3 Los tres bancos sobre el mismo fixture de OCR

P2 es OCR puro, sin texto real ni documento confidencial de por medio, y ordena los
tres bancos sin ambigüedad:

| banco | P2 frío |
|---|---|
| M1 8 GB, sin ventilador | **17,1-17,9 s** |
| Windows nativo, i5-12400 | 18,9 s |
| WSL sobre el mismo i5 | 23,5 s |

**El M1 gana.** Tesseract sobre WASM corre más rápido en un portátil de 2020 sin
ventilador que en un i5 de escritorio de 2022, y la VM agrega otro 24 %.

---

## 6. Lo que sale de acá y no decide el planificador

1. **El objetivo contractual de 8 s para 10 páginas nativas.** A ritmo de R1 en
   Windows nativo (0,45 s por página de NER más ~0,4 s de lectura del PDF), diez
   páginas reales dan **~5 s** hasta `Ready`, y **~6,2 s** hasta el panel de trabajo
   sumando el piso de 1,2 s de ADR-150 que el propio §1 del doc manda contar: se
   cumple. En el M1 daba 7,4-9,0 s, al límite o por encima. **El objetivo pasa a
   depender del banco y el doc no dice sobre qué hardware se mide** — ese es el hueco
   a cerrar, no el número.
2. **Los presupuestos M1 y M2 (ADR-146).** Los 512 MB corresponden a M1 para
   50 páginas; no al pico total. M2 tiene una referencia de ~1,6 GB con OCR/NER,
   superada por P2 en Windows (§4.3). Quedan por resolver la aceptación de esos
   excesos y la definición de M1 caliente cuando NER se recarga. El pico global
   de §3.2 y el pico de fases M2 tienen ventanas distintas: no se intercambian.
   Este informe no modifica ninguno de los dos presupuestos.
3. **El OCR es el cuello y no se compra con hardware.** Tesseract sobre WASM corre
   **más rápido en el M1 de 2020 sin ventilador** que en el i5 de escritorio de 2022
   (P2: 17,1-17,9 contra 18,9 s). Los 7 s que ganó R2 los puso el software (§3.3), no
   la máquina. Cualquier mejora futura del documento escaneado sale de ahí — y el
   ranking entre bancos vale también para decidir en cuál se fija el gate de tiempos.

---

## 7. Reproducir

Las rutas de R1, R2 y del binario instalado van **siempre por entorno**, nunca
escritas en un script ni en un log (plan §3.1).

```bash
# Comparativa externa (las dos versiones). En Windows, desde Git Bash.
ANONLY_REAL_DOC_R1=/ruta/nativo.pdf ANONLY_REAL_DOC_R2=/ruta/escaneado.pdf \
  ANONLY_EXT_EXE=/ruta/al/Anonly.exe ./tests/perf/run-comparativa-externa.sh

# T-13 y T-10 instrumentadas (solo la versión del repo), con sus runners de siempre
ANONLY_REAL_DOC_R1=... ANONLY_REAL_DOC_R2=... ./tests/perf/run-tiempos-reales.sh
ANONLY_REAL_DOC_R1=... ANONLY_REAL_DOC_R2=... ./tests/perf/run-documentos-reales.sh

# En WSL, además: DISPLAY=:0 para que Electron abra ventana bajo WSLg
```

Lo que **efectivamente se corrió** en Windows para T-13 y T-10 fueron puertos a
PowerShell de esos dos `.sh` —mismo spec, mismas rondas, mismo orden, mismas variables—,
porque Git Bash todavía no estaba probado. `run-comparativa-externa.sh` sí se validó
después desde Git Bash, con una corrida real y sin rutas del documento en los logs.
Cómo se arma el toolchain nativo de Windows (Node 22 por winget, `node_modules`
propio, el `install.js` de Electron a mano, el Chromium de Playwright para P2):
`tests/perf/README.md`, sección "Comparativa externa".

Salidas crudas en `.measure/ext-win/`, `.measure/tiempos-reales-win/`,
`.measure/documentos-reales-win/` (Windows) y `~/Anonly/.measure/` (WSL).
