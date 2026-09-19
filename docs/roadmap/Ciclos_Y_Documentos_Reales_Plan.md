<!-- CONTEXT: scope=roadmap-plan | tarea=T-9,T-10,T-11 | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,roadmap/Perfilado_Base_Caliente_Medicion.md,roadmap/AB_Intercalado_Medicion.md,architecture/07_Performance_Strategy.md,tests/perf/README.md | audiencia=planificador+implementador+humano | fase=11 -->

# T-9, T-10 y T-11 — ¿hay fuga?, ¿qué cuesta un documento real?, y el heap de WASM

> **Escrito el 2026-09-18, antes de medir.** Pedido del humano: primero el ciclo de
> 10 open/close para saber si hay una fuga; después, medir sobre dos documentos
> reales que él proveyó, **sin abrirlos**; y dejar anotado el instrumento de WASM
> como uno de los siguientes pasos de la campaña. Este plan fija las preguntas, el
> protocolo y cómo se lee cada resultado **antes** de ver un solo número
> (`Optimizacion_De_Memoria_Plan.md` §2bis).
>
> **T-9 y T-10 ejecutadas el mismo día**, sin cambios de protocolo. Resultado en
> [`Ciclos_Y_Documentos_Reales_Medicion.md`](Ciclos_Y_Documentos_Reales_Medicion.md).
> T-11 sigue sin empezar; su sección (§4) se reescribió antes de delegarla.

---

## 1. De dónde sale esto

Con ADR-167 implementado, el mapa de memoria es este (M1 de 8 GB, sumas de RSS):

| momento | total | lo grande |
|---|---:|---|
| app recién abierta | ~430 MB | ~300 MB de procesos de Chromium fuera del renderer |
| en reposo, tras un documento con NER | ~790 MB | casi todo el aumento, en el renderer |
| pico, 50 páginas escaneadas | ~2,5 GB | renderer ~1,9 GB + GPU ~0,3 GB |

Los dos primeros números salen de sesiones distintas, así que su diferencia
(~370 MB) es un orden de magnitud, no una medición (§2bis punto 8). Lo que no
sabemos es **de qué está hecho ese residuo y si crece**. Si crece con cada
documento, es una fuga y pasa al primer lugar. Si queda plano, es un costo que se
paga una vez y el orden de prioridades no cambia.

La otra incógnita la arrastra la campaña desde el principio (§4 del plan): **el
fixture no es un escaneo real**. El humano proveyó dos documentos reales.

---

## 2. T-9 — El ciclo de 10 open/close

Es el perfil **P3** de ADR-146 §4 («fixture manejable, 10 open/close»), que nunca se
midió. **No es el gate `test:leak`**: no afirma umbrales. Mide y reporta, para que
el gate se escriba después con un umbral apoyado en el ruido real (ADR-146 §6:
primero se mide, después se fija el número). Tampoco puede apoyarse en
`measureUserAgentSpecificMemory`, que no está disponible en la app empaquetada
(`07_Performance_Strategy.md` §11.3 punto 7).

### 2.1 La pregunta, partida en dos

1. **Costo de una sola vez**: ¿cuánto sube el reposo entre la app recién abierta y
   después del primer documento?
2. **Crecimiento por documento**: del segundo documento en adelante, ¿el reposo
   sigue subiendo?

La segunda es la que define una fuga. La primera responde de qué está hecho el
residuo ya observado.

### 2.2 Por qué dos regímenes, y no uno

Una fuga puede vivir en dos lugares, y cada régimen ve solo uno:

- **Dentro de un worker que sobrevive entre documentos** (tensores de ONNX que no
  se sueltan, cachés de pdf.js en los workers de render, memoria de WASM que solo
  crece). Solo se acumula si el worker sigue vivo: hay que **encadenar**
  documentos, sin dar tiempo a que venzan los temporizadores.
- **En lo que se crea y se destruye con cada documento** (workers que no terminan,
  listeners, blobs, el store del cliente). Se ve mejor dejando que **todo** se
  libere entre documento y documento, así cada ciclo crea y destruye los pools de
  cero.

Medir solo en reposo esconde la primera clase **por diseño**: al terminar el worker,
el sistema recupera su memoria y la fuga desaparece con él.

### 2.3 Tres corridas

Cada una en **una sola instancia de Electron** (el ciclo es la unidad de medida), y
en serie, nunca a la vez (§2bis punto 1):

| corrida | documento | régimen | espera tras cerrar | duración estimada |
|---|---|---|---:|---:|
| **L1** | P1 (10 páginas de texto, NER) | encadenado | 6 s | ~3 min |
| **L2** | P2 (50 páginas escaneadas, OCR + NER) | encadenado | 6 s | ~8 min |
| **L3** | P1 | con reposo | 90 s | ~17 min |

- **6 s** deja margen contra los 15 s de NER (ADR-167) y los 60 s del resto: entre
  que NER termina y el documento siguiente lo vuelve a usar pasan unos 9-10 s, así
  que en L1 el mismo worker de NER atiende los diez documentos. **Se verifica, no se
  supone**: cada ciclo registra si apareció `NER_MODEL_READY`, que desde ADR-167 §3
  acompaña toda recarga. Si en L1 aparece del ciclo 2 en adelante, el régimen no fue
  el declarado y se reporta así. En L2 no: entre que NER termina y el
  OCR del documento siguiente lo vuelve a necesitar pasan más de 15 s, así que el
  modelo se libera y se recarga en cada ciclo. **Es el comportamiento real del
  producto con documentos escaneados**, no un defecto del diseño. El pool de OCR
  se crea y se da de baja en cada documento de todos modos (ADR-157).
- **90 s**: T-7 midió que la liberación más lenta termina a los ~75 s del cierre
  (`Perfilado_Base_Caliente_Medicion.md`). Con 90 s, cada ciclo de L3 arranca con
  todos los pools dados de baja.
- **No hay una corrida P2 con reposo**: el pool de OCR ya se crea y se destruye en
  cada ciclo de L2, y la creación y destrucción de los demás pools la cubre L3. Sería
  el ciclo más caro (~22 min) para cubrir lo que ya cubren las otras dos.

### 2.4 Qué se registra en cada ciclo

En este orden, para que la recolección forzada no toque la lectura de RSS:

1. Se abre el documento y se espera `PIPELINE_READY`; se registran el pico de RSS
   entre `DOCUMENT_IMPORTED` y `PIPELINE_READY` y el tiempo de import a `Ready`.
2. Se cierra por la UI real (`closeDocument`).
3. **Reposo por RSS**, mediana de las muestras (cada 250 ms) en una ventana fija
   después del cierre: **[2 s, 6 s]** en los encadenados, **[80 s, 90 s]** en L3.
   También por tipo de proceso (Tab, GPU, Browser, Utility). La mediana, y no el
   mínimo, porque son 16-40 muestras y el mínimo es la lectura más ruidosa de
   todas.
4. **Heap de JS de cada target con GC forzado** (ADR-159, `support/cdpHeap.ts`):
   el hilo principal (`usedSize` y `backingStorageSize`) y **cuántos workers
   siguen vivos**.
5. Una lectura de RSS después de ese GC.
6. La presión de memoria del sistema al abrir y al cerrar el ciclo (ADR-146 §7ter).

Antes del primer documento se toma lo mismo con la app recién abierta (ventana
[10 s, 20 s] desde que la app está lista, y después el heap con GC): es el
**ciclo 0**.

El colector de fases **se instala una sola vez por corrida** y cada ciclo reemplaza
el objeto donde escribe. El colector estándar (`installRunCollector`) se reinstala
en cada import y sus listeners viejos siguen vivos, reteniendo el reporte del
ciclo anterior: en diez ciclos, **el instrumento mismo sería una fuga**. Tampoco
captura las palabras del OCR.

### 2.5 Cómo se lee — fijado antes de medir

**La pendiente se calcula sobre los ciclos 2 a 10** (nueve puntos, mínimos
cuadrados, con su error estándar). El ciclo 1 queda afuera porque es el primer uso
de cada motor en el proceso y concentra los costos de una sola vez; se reporta
aparte, como la respuesta a la pregunta 1.

| señal | es una fuga si… | por qué ese umbral |
|---|---|---|
| **workers vivos** al final del ciclo (incluidos los hijos: hilos de ONNX, Tesseract) | el ciclo 10 tiene más que el máximo de los ciclos 2 a 4 | un worker de más es una fuga, del tamaño que sea; en los primeros ciclos un pool todavía puede estar llegando a su tamaño |
| **heap JS del hilo principal**, con GC | pendiente > 2 errores estándar **y** > 5 MB entre el ciclo 2 y el 10 | con GC forzado, el recolector perezoso no mete ruido; por debajo de 5 MB no le importa al producto aunque sea real |
| **RSS en reposo** (suma y Tab) | pendiente > 2 errores estándar **y** ≥ 10 MB por ciclo (≥ 80 MB entre el 2 y el 10) | el RSS arrastra ±20 MB de jitter dentro de una corrida (T-7) y la presión del sistema; no se reclama nada más fino |
| **pico** y **tiempo** por ciclo | se reportan con su pendiente | una fuga suele empujar los dos; ninguno decide solo |

**La presión del sistema es el confound**, y el heap con GC forzado es la única
señal que no mueve: el compresor de macOS cambia el RSS, no la contabilidad de V8.
Si entre el primer y el último ciclo el compresor o el swap se mueven más de 500 MB,
la pendiente de RSS de esa corrida se reporta como **confundida**, sin leerla.

**Regla de parada**: diez ciclos por corrida, una corrida de cada una. No se agregan
ciclos ni corridas después de ver los datos. Un ciclo que termina en
`PIPELINE_FAILED` queda marcado, no se repite, y la pendiente se calcula sin él,
declarándolo.

Lo que T-9 **no** puede ver: la memoria lineal de WASM (ADR-159 §8). Si el RSS de
L1 crece y el heap de JS no, la fuga está en un worker o en WASM, y eso es
exactamente lo que resuelve T-11.

---

## 3. T-10 — Los documentos reales

### 3.1 Los documentos, y la regla de confidencialidad

El humano proveyó dos documentos reales, que no son fixtures y **no se versionan**.
**Nadie los abre**: ni el planificador, ni el implementador, ni el arnés fuera de la
app. El humano pidió explícitamente que el agente solo le indique al script cuál
tomar.

| id | tipo | páginas (declaradas) | se espera |
|---|---|---:|---|
| **R1** | texto nativo | ~50 | solo Regex y NER, **sin OCR** |
| **R2** | escaneado | 20 | OCR + Regex + NER |

Reglas, todas obligatorias:

1. **Nada que los identifique entra al repo**: ni nombres de archivo, ni contenido, ni
   de qué tratan, ni tamaños exactos, ni hashes. Ni en docs, ni en código, ni en
   commits: acá son R1 y R2, y lo que se publica de ellos son medidas de memoria y
   tiempo, con los tamaños redondeados.
2. **Las rutas se pasan por variable de entorno** (`ANONLY_REAL_DOC_R1`,
   `ANONLY_REAL_DOC_R2`). Los archivos no se copian al repo ni a `.measure/`. El
   proceso de Playwright lee los bytes y se los entrega a la app como lo haría el
   usuario.
3. **El texto no sale de la app.** El colector de fases captura las palabras del OCR
   para las huellas de calidad de T-5 (`ocrWords`); para R1 y R2 esa captura se
   **apaga** (`installRunCollector(page, { captureOcrWords: false })`). El reporte
   de un documento real lleva solo números: tamaño, cantidad de páginas, `sourceKind`
   y cuántas páginas sin texto informó el parser, conteos de entidades y grupos,
   palabras y confianza por página de OCR, tiempos y memoria. Ese reporte queda en
   `.measure/`, que está gitignoreado; al informe commiteado pasan solo las medidas.
4. **Sin capturas.** `trace`, `screenshot` y `video` ya están en `off` en
   `playwright.perf.config.ts`; nadie los prende para estas corridas.
5. El `userDataDir` de Electron es temporal y el arnés lo borra al terminar cada
   test (`tests/e2e/support/electronApp.ts`).

### 3.2 Lo que ya se sabe sin abrirlos

El plan de campaña (§4) suponía que un escaneo real pesa **10-50× más** que el
fixture de P2 (35 KB por página), y de ahí que las copias del PDF en los workers de
render pasarían de 5 MB a ~200 MB. **R2 pesa ~30 KB por página**: del mismo orden
que el fixture. Para este documento, esa palanca sigue siendo chica. Es probable que
sea un escaneo de multifunción en blanco y negro, **plausible y no verificado**: no
se abre para comprobarlo.

Lo que el tamaño no dice es cuánto trabaja Tesseract sobre el contenido real (ruido,
sellos, columnas), y eso es lo que se mide. La imagen que recibe el OCR tampoco
depende de cómo esté comprimido el PDF, sino de la resolución de la imagen embebida:
la app rasteriza a 300 DPI, o a la resolución de la fuente si es menor (ADR-163). Si
el escaneo es de 200 DPI, el ráster de R2 es más chico que el del fixture y su pico
no es comparable página a página. **No se averigua abriendo el PDF**: se deja
registrado para leer el resultado.

### 3.3 Las preguntas

1. **R2 contra P2**: ¿cuánto cuesta por página el OCR de un escaneo real? Tiempo de
   OCR por página, pico de RSS durante el OCR, pico de Tab y de GPU.
2. **R1 contra P1**: ¿qué cuesta un documento nativo real y largo? Tiempo de NER y
   pico. P1 (10 páginas sintéticas) es el ancla, no un par: difieren en largo **y**
   en realismo, y la comparación no separa las dos cosas.
3. **El reposo después de cerrar cada uno**: la línea de base caliente de
   `measureProfile`.
4. **¿Terminan bien?** `PIPELINE_READY`, conteos plausibles, y si R1 disparó OCR en
   alguna página (el parser decide por página según la capa de texto; si alguna no
   tiene, el OCR corre ahí, y eso se reporta, no se fuerza). **No hay afirmación de
   calidad**: no se mira la salida.

### 3.4 Protocolo

- Los cuatro perfiles (P1, P2, R1, R2), **intercalados en una sola sesión**,
  tres rondas, con el orden alternado para que ninguno quede siempre primero:
  `P1 P2 R1 R2` · `R2 R1 P2 P1` · `P1 P2 R1 R2`. Documentos distintos son
  condiciones distintas, y la regla 8 de §2bis vale igual que para dos versiones
  del código.
- Cada corrida es una instancia nueva de Electron con `measureProfile`: frío,
  cerrar, asentar, caliente, cerrar. Es el mismo instrumento que produjo todos los
  números de P2 de la campaña.
- 600 s de tope por import para R1 y R2. Si uno falla por tiempo, es un resultado
  (ADR-146 §6), no se sube el tope después.
- Reportes en `.measure/documentos-reales/<sesión>/`, un archivo por perfil y
  ronda, sin pisar nada.

**Advertencia de lectura**: `measureProfile` fuerza un GC en cada target una vez por
segundo (ADR-159). Los tiempos salen **bajo instrumento**: sirven para comparar
perfiles de la misma sesión, no como tiempo del producto.

### 3.5 Cómo se lee — fijado antes de medir

Con tres rondas, la resolución para el pico es **~350 MB** (los ~250 MB de T-8 con
seis pares, escalados por √2). Una diferencia de pico por debajo de eso se reporta
como **sin resolución**. Para tiempos por página no se reclaman diferencias menores
al 15 %. Los números por página se publican por ronda, sin promediar una corrida
fallida.

---

## 4. T-11 — El instrumento de WASM por worker

> **Reescrito el 2026-09-18, antes de delegar.** La primera versión de esta sección
> proponía un parche de medición en `shared/src/worker-entry.ts`. Al revisarla para
> entregarla se encontró que **esa vía no ve a Tesseract**, que es el principal
> sospechoso: tesseract.js crea sus workers desde su propio script (`workerPath` en
> `ocr-engine/src/worker/kernel.ts` y `orientation-kernel.ts`), y esos workers nunca
> pasan por `worker-entry.ts`. La vía de abajo no toca el producto y llega a todos los
> workers, incluidos los anidados.

### 4.1 El problema

El reporte de memoria dice «no atribuido (WASM + nativo): ~1,5 GB», que es una cota y
no una medición. Hay dos vías cerradas para leer la memoria lineal de WASM:
`Runtime.getHeapUsage` no la ve (ADR-159 §8) y `measureUserAgentSpecificMemory` no
está disponible en la app empaquetada (T-8, Paso 0).

T-10 le dio un blanco preciso: **el pico de un documento escaneado cae cuando se
carga el modelo de NER, justo después del OCR** (`Ciclos_Y_Documentos_Reales_Medicion.md`
§2.3; en frío pasa siempre, y en caliente cuando el OCR dura más de 15 s). Hay que
saber qué memoria está viva en ese instante.

### 4.2 La vía: preguntarle a cada target por CDP

`support/cdpHeap.ts` ya mantiene una conexión CDP que se engancha a **todos** los
targets, en forma recursiva: el hilo principal, cada worker propio, los dos workers de
Tesseract dentro de cada worker de OCR y los hilos de ONNX dentro del de NER. Sobre esa
misma conexión, en cada target:

1. `Runtime.evaluate("WebAssembly.Memory.prototype")` → su `objectId`.
2. `Runtime.queryObjects({ prototypeObjectId, objectGroup })` → un array con todas las
   instancias de `WebAssembly.Memory` vivas en ese target.
3. `Runtime.callFunctionOn` sobre ese array, con `returnByValue: true`, devolviendo por
   cada memoria su `buffer.byteLength` y si su `buffer` es un `SharedArrayBuffer`.
4. **`Runtime.releaseObjectGroup(objectGroup)` siempre, también si algo falló.** Sin
   esto, el inspector retiene las memorias que leyó y **el instrumento se convierte en
   una fuga**: una memoria de un worker de Tesseract ya descartado seguiría viva porque
   el arnés la tiene agarrada.

Qué es y qué no es el número:

- **Es el tamaño de la memoria lineal**, exacto. La memoria de WASM solo crece, así
  que una lectura en el instante *t* es también el máximo que esa memoria alcanzó
  hasta *t*.
- **No es memoria residente.** Una página nunca tocada, o comprimida por el sistema,
  cuenta en `byteLength` y no en el RSS. Es la demanda, no lo que ocupa. Y por eso
  mismo **la presión del sistema no la mueve**: es la primera medida de esta campaña
  inmune al confound de T-8 y T-9.
- **La memoria compartida se cuenta una vez.** ONNX con hilos usa una memoria
  compartida: el mismo `SharedArrayBuffer` aparece en el worker de NER y en cada uno de
  sus hilos. El reporte guarda la lectura cruda de cada target y, además, un total que
  cuenta una sola vez las memorias compartidas de un mismo pool de hilos. La regla se
  declara en el código y el Paso 0 la verifica.
- **Un target ocupado no contesta** (ADR-159 §6): un worker de Tesseract dentro de
  `recognize()` no procesa CDP hasta que vuelve. Se hace igual que en `cdpHeap.ts`:
  tope de tiempo por target y lectura marcada como faltante, nunca un cero. Como la
  memoria solo crece, la última lectura buena antes de que el worker termine es una
  cota inferior de su máximo.
- **Hay que averiguar si `queryObjects` fuerza una recolección.** Si lo hace,
  perturba como el GC forzado de `measureProfile`, y se declara igual que ahí.

### 4.3 Paso 0 — verificar el instrumento, ejecutándolo

Antes de medir nada, con la app empaquetada abierta y sin documento:

1. En el hilo principal y en **un worker anidado** (un hijo de otro worker), crear por
   `Runtime.evaluate` una memoria de tamaño conocido:
   `new WebAssembly.Memory({ initial: 480 })` son exactamente **31.457.280 bytes**. El
   instrumento tiene que reportar ese número exacto en ese target.
2. Lo mismo con una compartida: `new WebAssembly.Memory({ initial: 16, maximum: 16,
   shared: true })`, **1.048.576 bytes**, marcada como compartida.
3. Soltar la referencia, forzar GC y volver a leer: **la memoria de prueba tiene que
   desaparecer**. Si sigue apareciendo, el `releaseObjectGroup` no está funcionando y
   el instrumento retiene lo que mide.
4. Durante una corrida de P2, cada target `tesseract-*` tiene que reportar al menos
   una memoria mayor a cero en algún momento. Si no, la vía no ve a Tesseract.

**Condición de parada**: si `queryObjects` no encuentra la memoria de prueba, no
responde en targets de worker, o no ve a Tesseract, **se detiene la tarea y se
reporta**. No se cambia de vía por cuenta propia: un parche al producto es una
decisión del planificador.

### 4.4 La medición

Una spec nueva (`wasm-attribution.spec.ts`) con su soporte (`support/wasmMemory.ts`,
con tests), sobre el mismo arnés:

- **Una importación en frío por instancia de Electron.** El frío ya contiene el
  instante que interesa, la carga del modelo justo después del OCR (T-10 §2.3).
- **Muestreo**: RSS cada 150 ms (`memorySampler.ts`); memoria de WASM y heap de JS por
  target cada 1 s, en la misma pasada, con tope por target. Colector de fases con
  `captureOcrWords: false`.
- **Corridas**, en serie, desde un script único como las de T-9 y T-10:
  - **P2 × 3**, para ver si los números se repiten.
  - **P2-200p × 1** (`generateText200p`, perfil opt-in de T-3), para ver si la memoria
    de Tesseract llega a un techo o sigue creciendo con las páginas.
- **Sin documentos reales.** T-11 corre solo sobre fixtures. Si después hace falta R2,
  la corre el planificador con las reglas de §3.1.

Lo que el reporte tiene que contestar, por corrida:

1. **En el pico de RSS**: qué memorias de WASM están vivas y de quién (Tesseract LSTM,
   Tesseract OSD, OSD de orientación, NER, workers sin hijos), con la lectura más
   cercana de cada target y su distancia en tiempo. En particular: **cuando NER carga
   el modelo, ¿las memorias de Tesseract ya no están?** Es lo que ADR-157 promete al
   dar de baja el pool de OCR al terminar su etapa.
2. **La trayectoria de Tesseract por página**: el tamaño de cada memoria de cada
   worker de Tesseract a lo largo del OCR. ¿Se estabiliza después de las primeras
   páginas, o sigue creciendo? En P2-200p la respuesta es más clara.
3. **Cuánto del proceso del renderer queda atribuido**: en cada límite de fase, la
   suma de WASM (compartida contada una vez) más el heap de JS de todos los targets,
   al lado del RSS del Tab. La diferencia es lo que sigue sin atribuir.
4. **Secundario — la basura de después de cerrar** (T-9 §1.5): seis segundos después
   de cerrar el documento, el heap de JS de cada target **antes y después** de un GC
   forzado. La diferencia por target dice dónde están los ~350 MB. Hoy `cdpHeap.ts`
   fuerza el GC antes de leer (`readHeapUsage`); esto pide una lectura sin GC seguida
   de una con GC.

**Cómo se lee**: el tamaño de una memoria de WASM no tiene ruido de presión, así que
no hace falta un umbral estadístico. Se reportan las tres corridas de P2 por separado,
y una diferencia de más del 10 % entre corridas en la misma memoria se señala.

### 4.5 Qué decide

- Si la memoria de Tesseract se estabiliza, reciclar sus workers a mitad del documento
  (alternativa B de la bitácora) no ahorraría nada: se descarta con datos. Si sigue
  creciendo, pasa a ser la palanca principal del pico.
- Si en la carga de NER todavía hay memoria de Tesseract viva, el pico se puede bajar
  **ordenando** la baja del pool de OCR antes de la carga del modelo, sin tocar el
  DPI ni el paralelismo.
- Cuánto del «no atribuido» es WASM y cuánto es memoria nativa del renderer, que
  ningún instrumento de esta campaña ve.

### 4.6 Entrega al implementador

- **Alcance**: solo `tests/perf/` (spec, soporte con tests, script de campaña y una
  sección en `tests/perf/README.md`). **Nada en `packages/` ni en `apps/`**, ninguna
  dependencia nueva (R-12). Extender `cdpHeap.ts` para reusar su conexión y su
  clasificación de targets es lo esperable; no duplicarla.
- **Mediciones**: una por vez (§2bis punto 1), en un script único lanzado en segundo
  plano, sin correr vitest mientras mide (§2bis punto 3). Salida en
  `.measure/wasm/<sesión>/`, sin pisar nada.
- **Gates** verdes antes de entregar: `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm test:contract`.
- **No commitea** (I-9). Entrega: archivos tocados, el resultado exacto del Paso 0,
  el directorio de la sesión y, por corrida, las respuestas a las cuatro preguntas de
  §4.4. El informe en `docs/roadmap/` lo escribe el planificador.

**Cierra cuando** el Paso 0 pasa con los números exactos y P2 queda atribuido por
worker en tres corridas, con P2-200p para la trayectoria de Tesseract.

---

## 5. Lo que este plan no hace

- No toca el producto. Todo vive en `tests/perf/` y en este documento.
- No fija el umbral de `test:leak`: T-9 da los números para fijarlo, y fijarlo es
  una decisión aparte.
- No evalúa la calidad de la anonimización sobre los documentos reales.
- No compara contra tandas anteriores (§2bis punto 8).
- No construye T-11.
