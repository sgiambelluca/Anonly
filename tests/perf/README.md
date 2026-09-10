<!-- CONTEXT: scope=tests-perf | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,tests/e2e/README.md | audiencia=humanos+IA | fase=11 -->

# `tests/perf/` — tiempos y memoria sobre el producto real

Dos instrumentos, un mismo arnés (`tests/e2e/support/electronApp.ts`): `pipeline-timing.spec.ts` mide tiempos (H-07, ADR-149) y `memory.spec.ts` mide memoria M1/M2 (H-10, ADR-146). `memory-attribution.spec.ts` son corridas de atribución del exceso encontrado en P2 — no forman parte de la caracterización base.

## Por qué Electron y no un servidor de desarrollo

`test:perf` corría antes contra `vite preview`. ADR-153 midió, intercalando corridas en la misma máquina: shell de Electron empaquetado 2258-2917 ms, `vite preview` 8625-9715 ms — un sobrecosto de ~5 s **sin causa identificada** (se descartaron compresión, MIME, aislamiento, headers de caché, `Content-Length` y tamaño de chunk). El producto no se sirve por HTTP (ADR-130): un gate de tiempos o de memoria tiene que medir el artefacto que se instala, no un servidor que ningún usuario ejecuta.

## `memory.spec.ts` — el instrumento de H-10 (ADR-146)

**No es un gate**: no afirma umbrales, mide y reporta a `.measure/` (gitignoreado). ADR-146 §6/ADR-149 §5: fijar un número mirando una corrida sola es exactamente lo que esto evita — primero se mide, después se decide el presupuesto (o se descubre que no hace falta tocarlo).

Dos métricas (ADR-146 §1):

- **M2** — pico de la suma de `workingSetSize` (KB→bytes) de todos los procesos de Electron, leído con `app.getAppMetrics()` vía `electronApp.evaluate()`. Es una **suma RSS**: páginas compartidas entre procesos se cuentan más de una vez.
- **M1** — memoria atribuible al documento: pico de la corrida **caliente** menos la línea de base tomada con los modelos ya cargados y sin documento abierto. Esa línea de base solo existe **después** de haber cerrado un primer documento en la misma instancia de Electron (ADR-146 §4) — por eso cada perfil corre frío→cerrar→caliente, nunca frío solo.

### M1 puede dar levemente negativo — no es un bug

La línea de base caliente se muestrea inmediatamente después de `closeDocument()`, antes de que el GC libere la basura del documento recién cerrado. Si esa lectura queda inflada por un instante, la corrida caliente que sigue puede no superarla. Medido: **-16.4 MB** en el perfil de control (10 páginas de texto nativo, M1 esperado ~30 MB) — que además define el piso de ruido del método: ±40 MB aprox. ADR-146 §6 anticipa exactamente esto ("un OOM no se promedia... un resultado no disponible se reporta como inconcluso, no como cero") y es la razón por la que cada perfil corre varias veces (frías **y** calientes) en vez de una sola.

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

## `memory-attribution.spec.ts` — de dónde sale el exceso de P2

P2 (50 páginas escaneadas) mide consistentemente por encima de los 512 MB de `00_Project_Vision.md` §7 (3/3 corridas, piso 640 MB — un orden de magnitud por encima del ±40 MB de ruido del método, medido contra P1 como control). Antes de decidir qué hacer con ese exceso hace falta saber de qué componente sale. Tres corridas, cada una aislando una variable:

1. **NER apagado** (`installSettingsOverride({nerEnabled: false})`) — cuánto es del detector de nombres.
2. **`performancePreset: "low"`** — el único lever de tamaño de pool alcanzable sin tocar producción; confunde `ocrPoolSize` con `pdfPoolSize`/`nerPoolSize`/`renderPoolSize`, los cuatro bajan a 1 juntos.
3. **`generateText50pSmallPage()`** (`tests/fixtures/generate.ts`) — página a 4/9 de área, el mismo ratio que (200/300)² dpi. Proxy de `ocr.dpi: 200`: ese campo no es una `SettingsOverride` alcanzable (no es un setting de usuario), así que se prueba la misma hipótesis —¿el costo escala con el área rasterizada?— reduciendo el tamaño físico de la página en vez del DPI.

Una corrida por condición, no una caracterización de 3+3: es atribución exploratoria. Si el delta contra P2 base es grande y consistente con la hipótesis, alcanza para orientar la siguiente decisión; si es chico o ambiguo, se reporta así en vez de gastar más corridas.
