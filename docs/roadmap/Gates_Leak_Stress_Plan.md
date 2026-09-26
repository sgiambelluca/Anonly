<!-- CONTEXT: scope=roadmap-plan | dependencias=adr/ADR-185-Gates-De-Leak-Y-Stress-En-Electron.md,architecture/07_Performance_Strategy.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/perf/README.md | audiencia=planificador+implementador | fase=11 -->

# Gates `test:leak` y `test:stress` — plan de implementación

## Estado y frontera

ADR-185 decide activar ambos gates en el shell Electron empaquetado. Este
plan cerró su alcance antes de escribir los tests. No se tocan motores,
façade, UI de producto, contratos, specs de motor ni presupuestos. Las
mediciones de R1/R2 no entran a CI. Solo se versionan tests, config de
Playwright, scripts de `package.json` y el workflow. Los reportes locales se
guardan bajo `.measure/`, sin PDF ni contenido; CI puede conservar solo el
resumen numérico en el log.

**Estado (2026-09-25):** infraestructura implementada. `test:stress` pasó en
macOS arm64 con los cuatro imports completos y todos los centinelas agrupados:
razón M2 200/50 de 1,05 en frío y 0,96 en caliente; razón de tiempo 3,43 y
4,00, respectivamente. `test:leak`
pasó L1/L2/L3 con diez ciclos completos por régimen: workers 9/9/0, pendiente
del heap principal ≈ 0,1 MB/ciclo en los tres y sin veredicto de fuga. Los
reportes locales están en `.measure/stress/scale-sentinel.json` y
`.measure/leak/leak-cycles-L{1,2,3}.json`. La validación del workflow de
GitHub Actions sigue pendiente de una corrida real en CI; estas mediciones
locales no la sustituyen. También pasaron `pnpm lint`, `pnpm typecheck`,
`pnpm test` (2716 aprobados, 1 omitido), `pnpm test:contract` (331),
`pnpm format:check`, `git diff --check` y `actionlint` sobre `ci.yml`.

## `test:leak`

- Tres casos seriales L1/L2/L3, con el mismo fixture, régimen y timeouts de
  `tests/perf/leak-cycles.spec.ts`. Reusar `runLeakCycles` y `judgeLeak`, no
  reinstalar listeners en cada import. Cada test inicia Electron nuevo; no
  compartir una sesión entre regímenes. P2 se rasteriza mediante
  `getOrGenerateScannedFixture` antes de iniciar el Electron medido.
- Exigir 11 registros (`0` más 10 ciclos), índices consecutivos y
  `ok === true` para los diez. Para cada ciclo 2–10, exigir `heap.pageUsedBytes`
  finito, `rest !== null` y conteo de workers finito. El ciclo 0 también debe
  tener heap principal legible. Exigir que todas las tendencias bloqueantes
  usen los nueve puntos; ningún `null` equivale a cero. Persistir
  `heap.unreadableCount` como diagnóstico: T-9 observó tres pthreads ONNX
  ilegibles en L1/L2 sanos, por lo que exigir cero haría fallar un gate válido.
- Rechazar `verdict.workersGrow` o `verdict.heapGrows`. En L3 exigir cero
  workers tras cada reposo. En L1 exigir `nerModelLoaded === false` desde el
  ciclo 2. Conservar `rssGrows` y `rssConfounded` en el reporte, sin aserción.
- La suite usa `playwright.leak.config.ts` o una configuración equivalente
  restringida a `tests/leak/*.spec.ts`, con `workers: 1`, `retries: 0`, sin
  capturas/trace/video y build fresco. Timeout por caso: L1 15 min, L2 30 min,
  L3 35 min; el job CI admite 90 min para las tres. Un `test.skip` o un error
  del instrumento no puede producir verde.

## `test:stress`

- Dos perfiles P2 50p y 200p; usar los generadores, caché de escaneado y
  `measureProfile` existentes. Crear el fixture antes de abrir Electron.
  Cada perfil corre frío y caliente dentro de **su propia** instancia; los
  perfiles se ejecutan en serie en el mismo job. No se compara M1, porque es
  cota inferior y la base caliente puede variar.
- Comprobar `ok`, `totalMs` y `peakSumBytes` finitos/positivos en los cuatro
  imports, y `groupCount >= 5` en 50p / `>= 20` en 200p en frío y caliente.
  El colector debe registrar las páginas de los miembros de cada
  `ENTITY_GROUP_CREATED`; exigir presencia de **cada** índice de
  `TEXT_50P_ENTITY_PAGE_INDICES` / `TEXT_200P_ENTITY_PAGE_INDICES`, incluidas
  las páginas 40 y 190. El total solo no demuestra cobertura de las últimas.
  Comprobar `phaseSegments.length > 0` y al menos un segmento medible, para
  que `peakSumBytes` sea M2 de la ventana de fases; una muestra ausente o
  fallback a pico global no entra en la razón. `peakPosition` puede ser
  `after-last-phase`: ese pico global se informa aparte y no invalida M2.
- Comparar por separado frío con frío y caliente con caliente:
  `M2_200 <= 3 × M2_50` y `totalMs_200 <= 8 × totalMs_50`.
  Persistir un resumen con ambos numeradores, denominadores, razones,
  identidad de host/build y criterio. Si un perfil falla, el segundo no se
  interpreta como comparación válida; el job sigue rojo.
- Usar `playwright.stress.config.ts` o equivalente restringido a
  `tests/stress/*.spec.ts`, `workers: 1`, `retries: 0`, sin trazas ni video.
  Import 200p: 900 s; caso 200p: 35 min (T-3). Job CI: 60 min. El mismo
  `VITE_E2E=1` y los mismos defaults para ambos; no bajar DPI, pools ni NER
  para pasar el gate.

## Scripts y CI

1. `pnpm test:leak` y `pnpm test:stress` construyen React y desktop-shell,
   después invocan su configuración de Playwright. Ambos deben poder correr
   localmente en macOS sin variables privadas. `pnpm test` sigue siendo la
   suite Vitest; la convención `.spec.ts` evita que intente cargar Electron.
2. Los jobs `test-leak` y `test-stress` de `.github/workflows/ci.yml` pasan a
   `macos-latest`, detectan `*.spec.ts`, instalan Node/pnpm, cachean y
   mirrorean los assets de `assets.lock.json`, instalan Chromium de
   Playwright y ejecutan sus scripts. Falta de assets o de display no se
   traduce a skip. No agregar dependencia nueva.
3. Documentar cómo correrlos y cómo leer sus límites en `tests/perf/README.md`
   o en un README corto de los gates. Actualizar §11.4 de la estrategia y el
   estado del Hito 11 en `MVP.md`. No declarar CI verde hasta una ejecución
   real del workflow; una corrida local solo verifica el host local.
4. Incluir `tests/leak/**` en `tests/tsconfig.json` (antes estaba excluido) y
   registrar los dos configs Playwright nuevos en el `projectService` de
   `eslint.config.js`, para que lint y typecheck cubran el código del gate.

## Validación

- Tests puros de la decisión de gate: fuga real simulada, ruido de RSS sin
  fuga, dato faltante, trabajo incompleto y razón de estrés encima/abajo del
  umbral. Evitar tests que solo repitan la implementación.
- Ejecutar ambos comandos localmente sobre los fixtures sintéticos, verificar
  que el gate falle ante un reporte adverso fabricado, y luego correr
  `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` más
  `pnpm format:check`. Si CI no está disponible antes de commit/push, dejar
  su validación marcada pendiente sin llamar verde al workflow.
