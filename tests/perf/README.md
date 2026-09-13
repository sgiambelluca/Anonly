<!-- CONTEXT: scope=tests-perf | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/e2e/README.md | audiencia=humanos+IA | fase=11 -->

# `tests/perf/` — tiempos y memoria sobre el producto real

Dos instrumentos, un mismo arnés (`tests/e2e/support/electronApp.ts`): `pipeline-timing.spec.ts` mide tiempos (H-07, ADR-149) y `memory.spec.ts` mide memoria M1/M2 (H-10, ADR-146). `memory-attribution.spec.ts` son corridas de atribución del exceso encontrado en P2 — no forman parte de la caracterización base.

## Por qué Electron y no un servidor de desarrollo

`test:perf` corría antes contra `vite preview`. ADR-153 midió, intercalando corridas en la misma máquina: shell de Electron empaquetado 2258-2917 ms, `vite preview` 8625-9715 ms — un sobrecosto de ~5 s **sin causa identificada** (se descartaron compresión, MIME, aislamiento, headers de caché, `Content-Length` y tamaño de chunk). El producto no se sirve por HTTP (ADR-130): un gate de tiempos o de memoria tiene que medir el artefacto que se instala, no un servidor que ningún usuario ejecuta.

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
