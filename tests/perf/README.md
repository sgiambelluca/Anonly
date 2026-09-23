<!-- CONTEXT: scope=tests-perf | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/e2e/README.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=humanos+IA | fase=11 -->

# `tests/perf/` — tiempos y memoria sobre el producto real

Dos instrumentos, un mismo arnés (`tests/e2e/support/electronApp.ts`): `pipeline-timing.spec.ts` mide tiempos (H-07, ADR-149) y `memory.spec.ts` mide memoria M1/M2 (H-10, ADR-146). `memory-attribution.spec.ts` son corridas de atribución del exceso encontrado en P2 — no forman parte de la caracterización base.

## Por qué Electron y no un servidor de desarrollo

`test:perf` corría antes contra `vite preview`. ADR-153 midió, intercalando corridas en la misma máquina: shell de Electron empaquetado 2258-2917 ms, `vite preview` 8625-9715 ms — un sobrecosto de ~5 s **sin causa identificada** (se descartaron compresión, MIME, aislamiento, headers de caché, `Content-Length` y tamaño de chunk). El producto no se sirve por HTTP (ADR-130): un gate de tiempos o de memoria tiene que medir el artefacto que se instala, no un servidor que ningún usuario ejecuta.

### Atribución física del renderer — instrumentos opt-in

`native-memory-probe.spec.ts` valida la capacidad de `/usr/bin/footprint -f
bytes` sobre un Tab/GPU de macOS con asignaciones sintéticas separadas. Se
ejecuta solo con `ANONLY_NATIVE_MEMORY_PROBE=1`; no forma parte de la corrida
perf cotidiana y se omite en plataformas que no son macOS.

`renderer-resource-pilot.spec.ts` toma una serie de huella física por PID cada
1 s, conserva los tiempos de pared y observa 120 s después del cierre. Es un
piloto de atribución, no un gate. `renderer-resource-overhead.spec.ts` corre el
control serial AB/BA con instancias frescas, footprint encendido y apagado, sin
reposo posterior; mide overhead de observación y no retención. Ambos requieren
una guarda explícita:

```bash
ANONLY_NATIVE_MEMORY_PROBE=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/native-memory-probe.spec.ts
ANONLY_NATIVE_MEMORY_PILOT=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/renderer-resource-pilot.spec.ts
ANONLY_NATIVE_MEMORY_OVERHEAD=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/renderer-resource-overhead.spec.ts
```

La huella física de `footprint` es una magnitud del SO por proceso. No es RSS,
PSS ni una medida exacta de memoria de un motor y no se resta contra WASM o heap
JS. Las categorías macOS pueden ser anónimas; los reportes dejan explícito cuando
un target o una fase no son observables. Las sesiones escriben un manifest y
resultados sanitizados en `.measure/`.

### MemoryInfra — control sintético opt-in

`memory-infra-control.spec.ts` valida la sonda CDP de
`support/memoryInfra.ts` con un control acumulativo baseline → buffer32MiB →
canvas4096 → ImageData64MiB → WASM64MiB → release+GC. El parser conserva los campos hexadecimales por separado y el
correlador usa ventanas `clock_sync` más PID; no usa el GUID de respuesta como
identidad del dump. La prueba espera `Tracing.tracingComplete` antes de analizar
los eventos y solo fuerza GC en la etapa explícita de release. Escribe manifest,
requests, trace y summary en una sesión única bajo `.measure/memory-infra-control/`.

```bash
ANONLY_MEMORY_INFRA_CONTROL=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory-infra-control.spec.ts
```

Es una verificación de capacidad sobre fixtures sintéticos. No clasifica por
motor, no convierte `private_footprint_bytes` en RSS/PSS y no atribuye el
residuo histórico. Los artefactos crudos de una exploración quedan fuera del
repo, en una sesión única bajo `.measure/`.

### MemoryInfra — pipeline y reposo opt-in

`memory-infra-pipeline.spec.ts` ejecuta P1/P2 sobre tres condiciones (sin tracing,
tracing sin pedidos y tracing con pedidos) en orden directo e inverso, y dos
casos frío/caliente con reposo hasta 120 s. Cada test usa una instancia nueva.
No ejecuta footprint, heap sampler, `queryObjects` ni GC explícito. Conserva
fase al inicio y fin del pedido: un volcado que cruza fases no se atribuye a una.

```bash
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
ANONLY_MEMORY_INFRA_PIPELINE=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory-infra-pipeline.spec.ts
```

Duración local observada: unos 7 minutos, 14 casos, seriales. No ejecutar otros
benchmarks o gates en paralelo. Reportes, traza y categorías quedan en
`.measure/memory-infra-pipeline/<sesión>/`, con hashes de build/instrumento,
fixture, runtime, presión y estado de truncamiento. Es caracterización, no un
gate de presupuestos ni una calibración estadística del instrumento.

El timeout de un proveedor de MemoryInfra se registra como no observable y
suspende pedidos durante el pipeline, conservando la ejecución del producto.
Se vuelve a intentar después del cierre a 15/60/120 s; no se sustituye un error
por cero. «Test pasado» exige pipeline completo y artefactos no truncados, no
disponibilidad de todas las fases. El banco macOS recuperó la lectura a 60 s.
El reporte conserva los fragmentos parciales crudos para diagnóstico.

Resultado y revisión: `docs/roadmap/Atribucion_Recursos_Renderer_Medicion.md`.
La ejecución nativa Windows necesita su banco/toolchain y un launcher validado
para ese SO; este comando POSIX y el lector de presión actual no acreditan esa
validación. Ver también `docs/roadmap/Banco_Windows_Comparativa_Medicion.md` §7.

## `memory.spec.ts` — el instrumento de H-10 (ADR-146)

**No es un gate**: no afirma umbrales, mide y reporta a `.measure/` (gitignoreado). ADR-146 §6/ADR-149 §5: fijar un número mirando una corrida sola es exactamente lo que esto evita — primero se mide, después se decide el presupuesto (o se descubre que no hace falta tocarlo).

### Perfil opt-in `p2-scanned-200p` — H-10 T-3

**Implementado y caracterizado el 2026-09-13**: tres corridas de 50p y tres de
200p, cada una fría+caliente, terminaron válidas y sin OOM ni timeout. Resultado:
cuadruplicar páginas no cuadruplicó el delta del piso —se descarta la
extrapolación lineal—, pero el último cuarto de OCR dio signos mixtos y no permite
declarar una meseta limpia. T-3 cerró como **inconclusa**; los datos completos
están transcriptos en el plan.

T-3 agrega una extensión de P2 con 200 páginas, destinada a comprobar si el
piso de memoria continúa creciendo con el largo del documento. **No es P3**:
ADR-146 §4 reserva P3 para el ciclo de 10 open/close.

El perfil queda saltado salvo que `ANONLY_MEMORY_200P=1`; por tanto,
`pnpm test:perf` conserva su duración y alcance cotidianos. No se trata de un
gate omitido: este archivo es un instrumento de caracterización sin threshold.
Su corrida explícita, después de construir ambas mitades del producto, es:

```bash
ANONLY_MEMORY_200P=1 npx playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts --grep "P2-200" --repeat-each=3
```

Usa el fixture liviano `generateText200p()` —20 páginas con Person + DNI, una
cada diez, y 180 neutras— convertido por `getOrGenerateScannedFixture` fuera del
Electron medido. No existe una variante densa de 200 páginas. El identificador
del fixture, del perfil y del reporte es `p2-scanned-200p`.

El límite es propio del perfil: 900 000 ms por cada import y 2 100 000 ms para
el test completo; los perfiles existentes conservan 180 000 ms por import. Un
timeout u OOM se reporta como fallo/inconcluso según ADR-146 §6, nunca se oculta
aumentando el límite después de medir.

La caracterización final vuelve a correr `p2-scanned-50p` con la misma versión
del instrumento y produce tres pares fría/caliente por perfil, siempre en serie
y sobre el mismo build. Se comparan M2, M1 rotulada cota inferior, tiempo, pico
Tab/GPU de OCR y pisos Tab/GPU de OCR. Los pisos se publican por corrida, sin
promedio, y el residuo sigue rotulado “no atribuido (WASM + nativo)”. La decisión
estructural/acotada/inconclusa y el cierre documental pertenecen al planificador;
el implementador entrega el perfil y los reportes. La especificación completa
vive en `docs/roadmap/Optimizacion_De_Memoria_Plan.md` §T-3.

> **Enmienda 2026-09-17 (ADR-146 §7ter) — leer antes de interpretar cualquier reporte.**
>
> 1. **La validez se clasifica por posición del máximo**, no por «dentro o fuera de fase». Solo un máximo **anterior** a `DOCUMENT_IMPORTED` invalida la corrida: ese es el residuo del documento previo que §7bis quería atrapar. Un máximo **posterior** a la última fase es trabajo real del documento —precalentado de la página 1 (ADR-151) y seed de previews (ADR-044)— y la corrida es **válida**. Medido: de las 12 corridas que el criterio viejo descartaba, las 12 eran de este segundo tipo, y entre ellas estaba P1 entero, que es el control.
> 2. **M2 y M1 se calculan sobre la ventana de fases.** El máximo posterior a `Ready` se reporta aparte, en su propia métrica, y nunca se funde con M2 ni se omite. M2 mide *procesar el documento*; *dibujar la interfaz* se mide por separado.
> 3. **El reporte trae la presión de memoria del sistema** (`systemPressureAtStart`/`AtEnd`): páginas libres, páginas del compresor y swap. Sin eso, dos corridas no son comparables — el 2026-09-17, el mismo commit y el mismo build dieron una línea de base de 685,9 MB con la máquina cargada y de 1077,8 MB recién reiniciada, con el pico desplazado en la misma proporción. En una plataforma sin fuente disponible el campo dice por qué, nunca un cero silencioso.
> 4. **Una fase sin muestras se declara no medible.** Con `SAMPLE_INTERVAL_MS` de 150 ms y fases de P1 que duran 9-17 ms, había fases con cero muestras cuyo `peakInternalBytes` se publicaba como `0`. Ahora es `null` y el reporte lo dice; P1 además muestrea más fino.

Dos métricas (ADR-146 §1):

- **M2** — pico de la suma de `workingSetSize` (KB→bytes) de todos los procesos de Electron, leído con `app.getAppMetrics()` vía `electronApp.evaluate()`. Es una **suma RSS**: páginas compartidas entre procesos se cuentan más de una vez. Es la **métrica primaria** (ADR-146 §7, enmienda 2026-09-10): lectura directa del pico, sin resta.
- **M1** — pico de la corrida **caliente** menos la línea de base tomada con los modelos ya cargados y sin documento abierto. Esa línea de base solo existe **después** de haber cerrado un primer documento en la misma instancia de Electron (ADR-146 §4) — por eso cada perfil corre frío→cerrar→caliente, nunca frío solo. **Es una cota inferior, no una medida de demanda** (ADR-146 §7): un M1 por debajo del presupuesto no demuestra que el perfil cumple; por encima sí demuestra que no cumple. Ver por qué más abajo.

### M1 puede dar levemente negativo — no es un bug

Medido: **-16.4 MB** en el perfil de control (10 páginas de texto nativo, M1 esperado ~30 MB) — que además define el piso de ruido del método: ±40 MB aprox. ADR-146 §6 anticipa exactamente esto ("un OOM no se promedia... un resultado no disponible se reporta como inconcluso, no como cero") y es la razón por la que cada perfil corre varias veces (frías **y** calientes) en vez de una sola. Es consistente con la razón estructural documentada más abajo (ADR-146 §7): la resta puede subestimar el costo real del documento, así que un valor bajo o negativo no implica que el documento no haya costado nada.

### La línea de base caliente se mide en una ventana, no en un instante

Una sola lectura inmediatamente después de `closeDocument()` resultó demasiado ruidosa para servir de base a nada más fino que "¿supera el presupuesto?": con el defecto de contaminación del fixture ya corregido (línea de base fría estable, <10 MB de dispersión en 3 corridas), la caliente seguía moviéndose **647 MB** entre corridas (763.9-1477.1 MB) — más grande que cualquier delta de atribución por pool que `memory-attribution.spec.ts` pueda encontrar.

`measureProfile` (`support/memoryProfile.ts`) ahora deja pasar `HOT_BASELINE_SETTLE_WINDOW_MS` (4 s) después de `closeDocument()` — el sampler de fondo sigue muestreando cada `SAMPLE_INTERVAL_MS` durante esa espera, igual que durante el resto de la medición — y toma el **mínimo** de las muestras que caen en esa ventana (`minSumBytes`, `support/memorySampler.ts`) en vez de una sola lectura. No fuerza el GC (ADR-146 §6 ya anticipa que no hay forma de hacerlo desde el arnés): solo le da tiempo a asentarse y descarta las lecturas que todavía cargan basura por recolectar. No cambia la definición de ADR-146 §1 ("la base con los modelos ya cargados y sin documento") — la mide mejor, no la redefine.

**Validado con una recaracterización de P2, 3 calientes**: la dispersión de M1 bajó de 647 MB a **367 MB** (500.8-867.5 MB) — mejora real, pero no por lo que parecía. La corrida más baja (M1 500.8 MB) tiene la línea de base **y** el pico más altos de las tres (1632.3 / 2133.1 MB) — si fuera retraso del recolector, la base subiría sola y el pico no la seguiría; acá las dos se movieron juntas. La causa es estructural, no de temporización: con memoria residente libre por dentro del proceso, el trabajo del documento se acomoda ahí sin pedirle nada nuevo al sistema, y la resta sale más chica sin que el documento haya costado menos. **Ninguna ventana más larga lo arregla** — ver ADR-146 §7 (enmienda 2026-09-10), que por esto mismo redefine M1 como cota inferior asimétrica y pasa la atribución a comparar M2 en vez de restar contra una base. La ventana queda en 4 s.

### Cuántos workers vivos llegó a crear cada pool

Cada `RunReport` trae `workerPeakByType` — el máximo de jobs concurrentes por `WorkerJobType` (`pdf-parse`/`ocr-page`/`ner-page`/`render-page`/`export-page`) durante esa corrida, impreso en `printReport` como `workers: ocr-page=2 ner-page=1 ...`. Sale enteramente de los eventos públicos del bus (`WORKER_JOB_DISPATCHED`/`_COMPLETED`/`_FAILED`/`_CANCELLED`/`_TIMEOUT`, `docs/core/Contracts.md`), sin tocar `packages/anonymization-core/`: `WORKER_JOB_DISPATCHED` se emite cuando un job **empieza a correr** (`entry.execute()`, no al encolarse), y como cada `WorkerPool` crea sus workers remotos perezosamente por slot de concurrencia, un slot solo se ocupa mientras un job corre — el máximo de jobs concurrentes por tipo a lo largo de la corrida es exactamente el número de workers que ese pool llegó a crear. `workerId` del payload no sirve para esto: es `${poolKey}-pool`, una constante por pool, no un identificador por instancia.

Dos huecos conocidos, ninguno de los dos disparado por los perfiles de H-10 hoy:

- **`broadcast()`** (los controles `load-document`/`unload-document` de `RenderPool`) crea el slot 0 sin pasar por `dispatch()` — sin `WORKER_JOB_DISPATCHED`. El conteo no ve ese piso de 1 worker por pool con documento cargado.
- **`WORKER_JOB_TIMEOUT` no siempre es terminal**: un job puede reintentar tras un timeout, en el mismo slot, sin un nuevo `DISPATCHED`. El conteo decrementa igual (por simplicidad), lo que subestima el "en vuelo" durante el reintento sin inflar el pico real (el tamaño del pool sigue topando `pump()`, así que un slot "liberado de más" no habilita un `DISPATCHED` que no hubiera cabido de todos modos). Tampoco dispara en un camino feliz — todos los perfiles corrieron con `ok: true`.

Si algún día hace falta distinguir estos casos, la vía es un getter público en el Core (`WorkerPool.activeCount`/`remoteWorkers.size` ya existen, privados) — no se agregó acá porque ninguna medición de H-10 lo necesitó.

### Atribución por fase, dentro de una sola corrida (ADR-146 §7 punto 3)

Reemplaza el método anterior ("comparar M2 entre corridas alternadas") — ver por qué en `memory-attribution.spec.ts` y más abajo: se probó y no tuvo resolución. Este mide **dentro** de una corrida, así que es inmune a la deriva entre corridas.

`RunReport.phaseSegments` (`PhaseSegment[]`, `support/memoryProfile.ts`) parte la corrida en tramos entre eventos de fase consecutivos (`DOCUMENT_IMPORTED`, `DOCUMENT_PARSED`, `OCR_STARTED`, `OCR_FINISHED`, `NER_MODEL_READY`, `NER_FINISHED`, `GROUPING_FINISHED`, `PIPELINE_READY`/`PIPELINE_FAILED` — los que hayan ocurrido en esa corrida particular; un perfil sin OCR nunca emite `OCR_STARTED`) y reporta, por tramo: RSS al entrar, RSS al salir, el pico interno, y el delta (salida − entrada). `printReport` lo imprime como una línea por tramo debajo de cada fila de frío/caliente.

**Reconciliación de reloj**: los límites de fase se capturan en el renderer (`installRunCollector`) y las muestras de memoria en el proceso de Node/Playwright (`electronApp.evaluate`) — dos procesos de la misma instancia de Electron. En vez de reconciliar dos orígenes de `performance.now()` distintos (uno por proceso), cada evento de fase también guarda `Date.now()` (`phasesEpochMs`, reloj de pared, compartido entre procesos en la misma máquina) y se le resta `MemorySampler.startedAtMs` para obtener un `atMs` directamente comparable contra `samples`. `sampleNear`/`samplesBetween` (`support/memorySampler.ts`) hacen la búsqueda; con un muestreo cada `SAMPLE_INTERVAL_MS` (150 ms) un límite de fase casi nunca cae exacto sobre una muestra, así que `sampleNear` toma la más cercana.

**Se persiste la serie cruda** (`RunReport.samples`), no solo los segmentos ya calculados — para poder re-segmentar o graficar sin volver a correr el import (ADR-146 §7 punto 3 lo pide explícitamente: "hay que persistir la serie, no solo el máximo").

**Primer resultado real** (P2, una corrida frío→cerrar→caliente, sin repetir todavía — ver `.measure/memory-p2-scanned-50p-run0.json`): la pregunta que motivó esto — "¿baja el RSS al terminar el OCR, o se queda arriba?" (ADR-154 §2 lever 3, solapamiento OCR/NER) — dio una respuesta matizada, no un sí/no limpio:

- **Frío**: `OCR_FINISHED → NER_MODEL_READY` da +6.2 MB (flat, no baja). El drop grande (−355.7 MB) aparece recién en `NER_MODEL_READY → PIPELINE_READY` — es decir, en algún punto **durante** la inferencia de NER, no apenas termina OCR.
- **Caliente**: `OCR_FINISHED → PIPELINE_READY` da −0.5 MB — prácticamente flat de punta a punta (acá `NER_MODEL_READY` no se repite: ADR-046 lo deduplica por instancia del motor, el modelo ya estaba tibio de la corrida fría).

En ninguna de las dos hay una caída **inmediatamente** al terminar OCR, lo que es compatible con que el pool de OCR sigue vivo durante NER (lever 3) — pero la caída fría tampoco es concluyente por sí sola: podría ser GC ordinario reaccionando a la presión de NER, no necesariamente el pool de OCR liberándose (no se libera solo: el idle-dispose son 60 s y la corrida entera dura ~30 s). Falta repetir (esto es una sola corrida) y cruzar contra el conteo de workers por fase antes de afirmar nada.

### Correr

```bash
pnpm test:perf                                    # tiempos + memoria + atribución
npx playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts
npx playwright test --config=playwright.perf.config.ts --repeat-each=3   # caracterización estadística
```

Requiere el build de producción con el hook de medición expuesto:

```bash
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
```

(`pnpm test:perf` ya hace las dos cosas antes de correr Playwright.)

### Agregar resultados de varias corridas

```bash
pnpm tsx tests/perf/support/aggregateMemoryReports.ts
```

Lee todo `.measure/memory-*-run*.json`, agrupa por perfil/temperatura y reporta min/avg/max — sin promediar una corrida `ok: false` (ADR-146 §6).

### Canal de overrides del arnés (ADR-155): `localStorage["anonly:engine-overrides"]`

`performancePreset` (`installSettingsOverride`, `tests/e2e/support/settingsOverride.ts`) es el único lever de tamaño de pool alcanzable desde los settings del usuario, y es un balde: `low`/`high` mueven `pdfPoolSize`/`ocrPoolSize`/`nerPoolSize`/`renderPoolSize` los cuatro juntos. La atribución de H-10 (más abajo) necesita mover uno por vez — `ocrPoolSize` sin tocar `nerPoolSize` — y eso no tiene forma de expresarse por ahí.

`initCore` (`apps/react-client/src/core-adapter/index.ts`) lee `localStorage["anonly:engine-overrides"]` una sola vez en el boot y lo mergea por encima del override derivado de los settings, sección por sección — mismo `EngineConfigOverrides` (ADR-039) que `createCore` ya acepta, ningún tipo nuevo. Documentado en detalle en `docs/ui/React_Client.md` §3.7; acá solo lo que hace falta para escribir un test:

- Bajo la misma guarda que `__anonlyCore`: no existe fuera de `DEV`/`VITE_E2E=1`.
- Se escribe **antes** de `openApp` (`page.addInitScript` o `page.evaluate` previo a la navegación) — se lee una sola vez en el boot, escribirlo después no tiene efecto.
- JSON inválido, una clave fuera de `EngineConfig`, o cualquier sección que no sea un objeto descartan el valor **entero** — el boot sigue con los settings normales, nunca a medias.
- No pasa por `SettingsSlice`: no hay helper de test-support específico todavía, se escribe con `page.evaluate(() => localStorage.setItem("anonly:engine-overrides", JSON.stringify({...})))` o un init script equivalente.

## `memory-attribution.spec.ts` — de dónde sale el exceso de P2

P2 (50 páginas escaneadas), ya sin el defecto de contaminación del fixture, da dos hallazgos en dos tandas de 3 calientes cada una (antes y después del muestreo de ventana — ver arriba):

- **M2 — el hallazgo firme.** Pico de la suma RSS del árbol de procesos, sin resta: **1788.5-2133.1 MB** en las 6 corridas de las dos tandas, siempre por encima de los **~1.6 GB** de `07_Performance_Strategy.md` §7.1 ("Total pico (con OCR + NER)"). Lectura directa, no depende de ninguna línea de base — es el número que se cita para "P2 excede el presupuesto".
- **M1 — cota inferior, se lee con cuidado.** 756.5 / 867.5 / 500.8 MB en la tanda post-ventana. No es ruido de muestreo insuficiente: la corrida de 500.8 MB tiene la línea de base **y** el pico más altos de las tres (ver ADR-146 §7) — la resta subestima el costo real del documento cuando el proceso tiene memoria residente libre por dentro para absorber su trabajo sin pedirle nada nuevo al sistema. Un M1 por debajo del presupuesto no demuestra que el perfil cumple; uno por encima sí demuestra que no.

(P1 no sirve de control de ruido para P2: genera su PDF en Node, sin nada que rastrear en el renderer medido; P2 rasterizaba 50 páginas *dentro* de ese mismo tipo de proceso hasta que `getOrGenerateScannedFixture` (`support/scannedFixtureCache.ts`) lo movió a un `chromium.launch()` aparte, cerrado antes de medir. Los dos perfiles nunca compartieron la fuente de ruido, así que la baja dispersión de uno no decía nada sobre el otro.)

### El método de comparar M2 entre corridas separadas quedó retirado

Se intentó aislar `renderPoolSize` (4 contra 1, alternando 3 pares dentro de la misma sesión, con el canal de overrides de ADR-155) y no tuvo resolución: −83 MB de promedio en caliente, +264 MB en frío, cada uno consistente 3/3 en su propia dirección y contradictorios entre sí, los dos por debajo del ruido de M2 ya medido entre tandas (~345 MB — la dispersión pasó de 3.4% a 17.6% entre dos tandas separadas en el tiempo, con medias casi idénticas: variación de entorno, no del producto). Con n=3, tres de tres en una dirección ocurre una de cada cuatro veces por azar puro — no hay resultado, y ni triplicando las repeticiones alcanzaría (bajar el error estándar de 345 a 50 MB pediría del orden de cincuenta corridas por condición). ADR-146 §7 punto 3 reemplazó la regla al día siguiente de escribirla: la atribución se hace **dentro** de una corrida, por fase (ver más arriba), no restando corridas.

`renderPoolSize` queda como sospechoso de baja prioridad y sin confirmar (ADR-154 §2 lever 2) — su premisa original ("cuatro copias del documento, cientos de MB") también estaba mal por dos órdenes de magnitud: el fixture de P2 pesa 1.71 MB, tres clones de más son 5.1 MB, no cientos. Lo que sobrevive del lever es el estado por instancia de cada worker (canvas, lo que su pdf.js decodificó), compatible en magnitud con el delta caliente pero no resuelto.

`memory-attribution.spec.ts` conserva las 6 corridas alternadas de `renderPoolSize` — no como resultado de atribución, sino porque validan el canal de overrides de punta a punta contra un build real (`render-page` respondió 4 vs. 1 según la condición). La primera vez que se corrieron dieron un falso negativo por un `apps/react-client/dist` de 5.7 h de antigüedad — de ahí el `globalSetup` de `playwright.perf.config.ts` (`support/checkFreshBuild.ts`), que ahora revienta si el build está más viejo que el fuente.

Dos hipótesis más en el mismo archivo, cada una con una corrida exploratoria (no comparan pool sizes, así que no las alcanza el problema de arriba):

1. **NER apagado** (`installSettingsOverride({nerEnabled: false})`) — cuánto es del detector de nombres en sí.
2. **`generateText50pSmallPage()`** (`tests/fixtures/generate.ts`) — página a 4/9 de área, el mismo ratio que (200/300)² dpi. Proxy de `ocr.dpi: 200` (no alcanzable como setting de usuario): prueba si el costo escala con el área rasterizada, reduciendo el tamaño físico de la página en vez del DPI.


## T-8 — A/B intercalado: comparar dos versiones del código

La sección de arriba retira **restar corridas separadas** como método. Esto es lo que se usa cuando la pregunta es inevitablemente de ese tipo: **¿la versión B consume distinto que la A?** —algo que por definición no se contesta dentro de una sola corrida—. Protocolo en `docs/roadmap/AB_Intercalado_Plan.md`, resultado de su primer uso (ADR-166 contra un temporizador de 15 s) en `docs/roadmap/AB_Intercalado_Medicion.md`.

Qué lo separa del método retirado:

- **Los brazos corren alternados en la misma sesión** (`A B C A B C …`), así que la deriva del banco los atraviesa por igual. La comparación es **pareada por ronda**, no entre promedios sueltos.
- **Cada brazo es un parche de una línea sobre el árbol limpio** (`support/ab-*.patch`). Si el brazo revirtiera un commit entero, una diferencia no se podría atribuir al cambio que interesa.
- **La resolución se declara antes de medir**: con 6 rondas distingue ~250 MB o más en el punto de reposo. Por debajo se reporta sin resolución, y **no se agregan corridas** hasta que el promedio se acomode.

Correr:

```
ANONLY_AB_ARMS="A B C" ./tests/perf/run-ab-intercalado.sh      # etapa 1: punto de reposo, ~45 min
ANONLY_AB_ARMS="A B C" ./tests/perf/run-ab-etapa2.sh <dir>     # etapa 2: 2° documento, ~4 min
```

La etapa 2 reusa los `dist` que construyó la etapa 1 en `<dir>`: reconstruirlos daría otro bundle.

**Esto anula `checkFreshBuild`** —el `dist` se intercambia con `cp -R` y siempre queda recién copiado—, así que el script lo reemplaza por dos verificaciones más fuertes: el **digest del contenido** del `dist` activo contra el del brazo anunciado, antes de cada corrida, y un **pre-vuelo de comportamiento** por brazo (`ab-preflight.spec.ts`) que aborta la campaña si los brazos no se distinguen. Para agregar un brazo: su parche en `support/`, y una línea en `patch_for_arm` y en `expect_reload_for_arm` del script.

`ab-preflight.spec.ts` acepta `ANONLY_AB_GAP_MS`: una espera con el primer documento abierto antes de cerrarlo, para simular a alguien revisando. Con 20 s fue lo que mostró que **la recarga tras una liberación por temporizador no emitía `NER_MODEL_READY`** (ADR-167 §3). Ojo al leer sus resultados: **el arnés no registra `NER_MODEL_LOADING` como fase**, así que su ausencia no prueba nada; y en un brazo que no reinicia el flag, la ausencia de `NER_MODEL_READY` tampoco prueba que no hubo recarga — eso lo dice el tiempo.

`wasm-heap-probe.spec.ts` registra el Paso 0 de T-8, que salió negativo: `performance.measureUserAgentSpecificMemory()` existe en este runtime pero lanza *«not available»*, pese a `crossOriginIsolated: true`. Junto con ADR-159 §8 —`Runtime.getHeapUsage` tampoco ve WASM—, son dos vías cerradas para leer el heap del modelo sin pasar por el RSS. La tercera, sin construir, está descripta en el informe.

## T-9 — el ciclo de 10 open/close (¿hay una fuga?)

Plan y criterio de lectura, escritos antes de medir: `docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §2. Es el perfil P3 de ADR-146 §4, **no el gate `test:leak`**: mide para que el umbral del gate se fije después.

`leak-cycles.spec.ts` abre y cierra el mismo documento diez veces en una sola instancia y, en cada ciclo, registra tres señales que ven fugas distintas: **workers vivos** (CDP, con los hijos), **heap de JS del hilo principal con GC forzado** (la única que la presión del sistema no mueve) y **RSS en reposo**, como mediana de una ventana fija tras el cierre. El veredicto de plan §2.5 se calcula adentro del reporte (`judgeLeak`, con tests en `support/leakCycles.test.ts`), para que nadie lo reinterprete después de ver los números.

```
./tests/perf/run-ciclos.sh                       # L1, L2 y L3 en serie, ~30 min
ANONLY_LEAK_RUNS="L1" ./tests/perf/run-ciclos.sh # una sola
```

Dos cosas que no son obvias:

- **El colector se instala una vez.** `installRunCollector` se reinstala en cada import y sus listeners viejos retienen el reporte anterior: en diez ciclos, el instrumento mismo sería una fuga. `support/leakCycles.ts` tiene su propio colector, que escribe en el objeto vigente.
- **El encadenado se verifica.** Cada ciclo registra si apareció `NER_MODEL_READY`. En L1 tiene que faltar del ciclo 2 en adelante: si aparece, el mismo worker no atendió los diez documentos.

## T-10 — documentos reales

Plan: `docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §3. `real-docs.spec.ts` corre P1, P2 y dos documentos reales (R1 nativo, R2 escaneado) intercalados, tres rondas, con `measureProfile`.

**Los documentos reales no entran al repo, ni sus nombres, ni nada que los identifique.** Las rutas se pasan por entorno y la app los recibe con un nombre neutro:

```
ANONLY_REAL_DOC_R1=/ruta/al/nativo.pdf ANONLY_REAL_DOC_R2=/ruta/al/escaneado.pdf ./tests/perf/run-documentos-reales.sh
```

El colector corre con `captureOcrWords: false` en los cuatro perfiles: las palabras del OCR son el texto del documento, y no salen de la app. La spec verifica que no haya ninguna **antes** de escribir el reporte. `trace`, `screenshot` y `video` quedan en `off`.

## T-11 — el heap de WASM por worker (ADR-159 §8)

Plan: `docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4. Convierte el "no atribuido (WASM + nativo)" que `memoryProfile.ts` reporta como una cota (ADR-159 §8) en una medición por worker: por CDP, en cada target, `Runtime.evaluate("WebAssembly.Memory.prototype")` → `Runtime.queryObjects` → `Runtime.callFunctionOn` (`returnByValue: true`, devuelve `{byteLength, shared}` por memoria) → `Runtime.releaseObjectGroup` **siempre**, en un `finally` — sin eso el inspector retiene las memorias que leyó y el instrumento se vuelve una fuga. `support/cdpHeap.ts` expone estos cuatro métodos nuevos en su `CdpMethodMap` y un `snapshotWasmByTarget()` sobre la MISMA conexión que ya usa el heap de JS (`connectCdpTargetSnapshotter`); `support/wasmMemory.ts` es todo lo demás: el sampler combinado (`startWasmHeapSampling`, WASM + heap de JS por target en la misma pasada, cada 1 s), el deduplicado de memoria compartida, la atribución por dueño y el Paso 0.

**La memoria compartida se cuenta una vez.** ONNX con hilos comparte un `SharedArrayBuffer` entre el worker de NER y cada uno de sus pthreads — la firma estructural es la misma que ya distingue `cdpHeap.ts` (`thread-pool-worker-*`/`unclassified-worker-*`: hijos que REPITEN la misma url de blob). Dentro de ese grupo, una memoria `shared: true` del mismo tamaño se deduplica; fuera de él (p. ej. entre el Tesseract LSTM y OSD de un mismo `ocr-worker-*`, que nunca comparten) cada target cuenta por separado aunque coincidiera el tamaño. Ver el docstring de `wasmMemory.ts` y `computeWasmMemoryTotal`.

**Paso 0 corre antes que cualquier corrida y es la condición de parada del plan** (`runWasmStep0`): crea una `WebAssembly.Memory({initial:480})` (31.457.280 bytes exactos) en el hilo principal y en un worker anidado de verdad (un worker cuyo único hijo es otro worker, armado con dos `Blob`/`Worker` sintéticos — no hay forma de tener un worker anidado propio de la app sin abrir un documento), una compartida `initial:16, maximum:16, shared:true` (1.048.576 bytes), verifica que las tres desaparezcan tras soltar la referencia + GC forzado, mide si `Runtime.queryObjects` por sí solo (sin llamar a `collectGarbage`) libera una sonda de ~20 MB ya dereferenciada, y por último abre un P2 real y confirma que algún target `tesseract-*` reporte memoria > 0. Si algo de esto falla, `run-wasm.sh` aborta antes de gastar tiempo en las cuatro corridas de la campaña.

### Correr

```
./tests/perf/run-wasm.sh                          # Paso 0 + p2-run0 + p2-run1 + p2-run2 + p2-200p, en serie
ANONLY_WASM_RUNS="p2-run0" ./tests/perf/run-wasm.sh  # Paso 0 + una sola corrida medida
```

Salida en `.measure/wasm/<sesión>/`: `wasm-step0.json`, `wasm-p2-run0.json`… `wasm-p2-200p.json`, más los logs de cada invocación de Playwright. Nunca pisa una sesión anterior (mismo criterio que `run-ciclos.sh`).

## T-12 — opciones de sesión de NER sobre un documento real

Plan: `docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4bis. `run-ner-opciones.sh` usa el mecanismo de T-8: cada brazo es un parche de una línea sobre `ner-engine/src/worker/kernel.ts` (`support/ner-arm-*.patch`), se construye una vez, y el `dist` se intercambia verificando su digest. Mide con `wasm-attribution.spec.ts` (`ANONLY_WASM_RUN=r1|r2`, `ANONLY_WASM_LABEL` para el nombre del reporte), que además deja una **huella de lo que NER detectó**: un SHA-256 calculado dentro de la app sobre página, tipo y caja de cada ocurrencia. El texto no sale de la app.

```
ANONLY_REAL_DOC_R1=/ruta/nativo.pdf ANONLY_REAL_DOC_R2=/ruta/escaneado.pdf ./tests/perf/run-ner-opciones.sh
```

Ojo al leer la memoria de WASM: **crece por escalones del 20 %**, así que un ahorro más chico que el escalón no cambia el tamaño visible.

## T-13 — tiempo real sobre documentos reales

`real-docs-timing.spec.ts` mide importación → `Ready` por fase **sin ningún instrumento de memoria** (ni sampler de RSS ni CDP), dos veces por instancia: la primera importación y una reapertura a los 5 s. `run-tiempos-reales.sh` corre R1 y R2, tres rondas, orden alternado. Plan: `docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4ter.

```
ANONLY_REAL_DOC_R1=/ruta/nativo.pdf ANONLY_REAL_DOC_R2=/ruta/escaneado.pdf ./tests/perf/run-tiempos-reales.sh
```

El banco es una MacBook Air M1 sin ventilador: la primera corrida de una sesión puede salir hasta un 20 % más rápida que las siguientes.

## Comparativa externa — el repo contra un binario ya instalado

`external-baseline.spec.ts` mide tiempo y memoria **sin `__anonlyCore`**: el tiempo, del texto del `[role="status"]` (con un `MutationObserver` que registra cada etapa); la memoria, con el mismo `startMemorySampling` de H-10. Por eso sirve para un build de producción —un release instalado—, que el colector de T-10/T-13 no puede medir. `run-comparativa-externa.sh` alterna el build del repo (`repo`) y el binario de `ANONLY_EXT_EXE` (`installed`) sobre R1 y R2, tres rondas. Resultados y lectura: `docs/roadmap/Banco_Windows_Comparativa_Medicion.md`.

```
ANONLY_REAL_DOC_R1=/ruta/nativo.pdf ANONLY_REAL_DOC_R2=/ruta/escaneado.pdf \
  ANONLY_EXT_EXE=/ruta/al/Anonly.exe ./tests/perf/run-comparativa-externa.sh
```

En Windows corre desde Git Bash, con un toolchain **nativo** aparte del de WSL (un binario `.exe` instalado no se puede lanzar desde WSL):

- Node 22 (`winget install OpenJS.NodeJS.22`) y pnpm por `corepack enable`, con su propio `node_modules`. Si la copia Windows del repo trae el `node_modules` de Linux, `pnpm install` falla con `EACCES` al purgarlo: borrarlo desde WSL con `rm -rf`, que no sigue symlinks.
- El postinstall de Electron no corre: ejecutar a mano `node install.js` dentro de `node_modules/.pnpm/electron@<versión>/node_modules/electron`.
- El perfil P2 de T-10 necesita `pnpm exec playwright install chromium` para generar su fixture.
- `systemMemoryPressure.ts` no tiene lector para `win32`: las corridas de Windows salen sin el chequeo de "RSS confundido".

Antes de comparar dos versiones, verificar con `git diff <viejo> <nuevo> -- apps/react-client/src/components/toolbar/` que la etiqueta de estado no cambió, y ojo con **dónde cae "Listo"**: hasta `19b4d13` la toolbar lo mostraba justo en `Ready`; desde el hardening la pantalla de escaneo retiene hasta 1 s más (`SCAN_ADVANCE_PREWARM_GRACE_MS`). Para comparar `Ready` contra `Ready`, leer la marca de etapa de cada versión (informe §3.1).

## T-5 — Comparación OSD compartido (ADR-164)

Protocolo normativo: `docs/roadmap/T5_OSD_Compartido_Handoff.md` §3.
Nuevo arnés opt-in `osd-sharing.spec.ts` (implementación pendiente), fixture P2
congelado por SHA-256, checkouts BEFORE/AFTER separados y seis sesiones en orden
A1/B1, B2/A2, A3/B3, cada una frío/cerrar/caliente. Instrumento idéntico en ambos
builds, tamaño LSTM 2 fijo. Guardar directorios únicos por corrida y series
crudas; no pisar JSON previos. La ventana de memoria primaria es OCR, con pico
de suma simultánea, no suma de máximos por proceso. T-1 no ve memoria WASM.

El clasificador CDP histórico de dos hijos por OcrWorker no identifica la
nueva topología: no etiquetar al OSD único como LSTM por ser primer hijo.
Conservar topología y mapa de chunks del build, documentar cobertura. Los jobs
ocr-orient usan telemetría WORKER_JOB_* existente. La huella de palabras/cajas
se compara excluyendo ids/duraciones. M1 es solo contexto: ADR-157 libera OCR
entre frío y caliente. Las cifras históricas aquí conservadas no son el control
actual ni un ahorro prometido.

## ADR-173 — empaquetado experimental de NER

Opt-in. `ner-packaging.spec.ts` se omite en `pnpm test:perf` normal. El runner
`run-ner-packaging.sh` valida y convierte el ONNX original en un entorno Python
aislado, construye A y B y corre primero el gate de compatibilidad/calidad
Chromium/WASM sobre el corpus de referencia. B usa el parche temporal
`support/ner-external-data.patch`; el runner lo revierte y restaura `dist-A`
incluso al fallar. No modifica `assets.lock.json` ni incorpora derivados al
producto. Requiere Python 3.12; `PYTHON312` permite indicar su ejecutable si
no está en `PATH`.

```sh
./tests/perf/run-ner-packaging.sh
ANONLY_NER_PACKAGING_GATE_ONLY=1 ./tests/perf/run-ner-packaging.sh
```

El reporte de calidad de B se coteja con A por documento y entidad, con
ocurrencias exactas; no le asigna la identidad de asset original que ADR-147
reserva a A. El gate de calidad requiere que exista la baseline
`tests/quality/baselines/reference-v1.json`. Solo una vez verdes los gates A y
B se habilita una medición intercalada; no se atribuye memoria con un gate rojo.

Cada `memory-<runId>.json` registra identidad real del dist y hashes servidos,
`runWasmAttribution` con intervalos RSS/heap/WASM, pressure del sistema, costo
observado de las sondas y una segunda medición `measureProfile` cold/hot. El
M1 publicado es `officialMemoryProfile.hot.m1Bytes`, contra la línea base
caliente asentada; el delta de la pasada fría se guarda por separado. La pasada
WASM conserva cinco segundos de carga tras `Ready`, luego observa 20 s tras
cerrar (15 s de `nerIdleDisposeMs` más margen). El perfil usa el fixture P2 de
50 páginas. Las tres lecturas A son controles repetidos entre corridas
intercaladas y sirven para estimar deriva; no son controles A/A pareados dentro
de una misma sesión. R1 no estaba disponible en el host de la corrida.

El M1/M2 oficial sale de `measureProfile`; la atribución WASM llega de la
pasada complementaria en el mismo proceso de cada brazo. No sumar ni restar
RSS, heap JS y WASM. Las sondas CDP WASM/heap pueden ocupar varios cientos de
milisegundos por lectura; sus duraciones, targets no observables y `partial`
quedan en el JSON para interpretar la resolución real.
