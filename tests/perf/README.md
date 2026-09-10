<!-- CONTEXT: scope=tests-perf | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,tests/e2e/README.md | audiencia=humanos+IA | fase=11 -->

# `tests/perf/` — tiempos y memoria sobre el producto real

Dos instrumentos, un mismo arnés (`tests/e2e/support/electronApp.ts`): `pipeline-timing.spec.ts` mide tiempos (H-07, ADR-149) y `memory.spec.ts` mide memoria M1/M2 (H-10, ADR-146). `memory-attribution.spec.ts` son corridas de atribución del exceso encontrado en P2 — no forman parte de la caracterización base.

## Por qué Electron y no un servidor de desarrollo

`test:perf` corría antes contra `vite preview`. ADR-153 midió, intercalando corridas en la misma máquina: shell de Electron empaquetado 2258-2917 ms, `vite preview` 8625-9715 ms — un sobrecosto de ~5 s **sin causa identificada** (se descartaron compresión, MIME, aislamiento, headers de caché, `Content-Length` y tamaño de chunk). El producto no se sirve por HTTP (ADR-130): un gate de tiempos o de memoria tiene que medir el artefacto que se instala, no un servidor que ningún usuario ejecuta.

## `memory.spec.ts` — el instrumento de H-10 (ADR-146)

**No es un gate**: no afirma umbrales, mide y reporta a `.measure/` (gitignoreado). ADR-146 §6/ADR-149 §5: fijar un número mirando una corrida sola es exactamente lo que esto evita — primero se mide, después se decide el presupuesto (o se descubre que no hace falta tocarlo).

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

La dispersión de M2 también cambió entre las dos tandas (3.4% en la primera, 17.6% en la segunda — ~345 MB de ruido sobre ~2 GB) con medias casi idénticas (1968 vs. 1955 MB): variación del entorno entre sesiones separadas en el tiempo, no del producto ni del instrumento (ADR-146 §7 punto 4). Por eso la atribución compara configuraciones **dentro de la misma sesión**, alternando condición por condición, con el equipo por lo demás inactivo — 345 MB de ruido entre sesiones es del orden de varios de los deltas por pool que se buscan.

(P1 no sirve de control de ruido para P2: genera su PDF en Node, sin nada que rastrear en el renderer medido; P2 rasterizaba 50 páginas *dentro* de ese mismo tipo de proceso hasta que `getOrGenerateScannedFixture` (`support/scannedFixtureCache.ts`) lo movió a un `chromium.launch()` aparte, cerrado antes de medir. Los dos perfiles nunca compartieron la fuente de ruido, así que la baja dispersión de uno no decía nada sobre el otro.)

Antes de decidir qué hacer con ese exceso hace falta saber de qué componente sale. Tres corridas, cada una aislando una variable:

1. **NER apagado** (`installSettingsOverride({nerEnabled: false})`) — cuánto es del detector de nombres.
2. **`performancePreset: "low"`** — el único lever de tamaño de pool alcanzable sin tocar producción; confunde `ocrPoolSize` con `pdfPoolSize`/`nerPoolSize`/`renderPoolSize`, los cuatro bajan a 1 juntos.
3. **`generateText50pSmallPage()`** (`tests/fixtures/generate.ts`) — página a 4/9 de área, el mismo ratio que (200/300)² dpi. Proxy de `ocr.dpi: 200`: ese campo no es una `SettingsOverride` alcanzable (no es un setting de usuario), así que se prueba la misma hipótesis —¿el costo escala con el área rasterizada?— reduciendo el tamaño físico de la página en vez del DPI.

Una corrida por condición, no una caracterización de 3+3: es atribución exploratoria. Si el delta contra P2 base es grande y consistente con la hipótesis, alcanza para orientar la siguiente decisión; si es chico o ambiguo, se reporta así en vez de gastar más corridas.
