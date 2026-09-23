<!-- CONTEXT: scope=roadmap-measurement | dependencias=roadmap/PDFs_Pesados_Y_Exportacion_Plan.md,adr/ADR-174-Los-PDFs-Pesados-Se-Miden-Hasta-El-Archivo-Exportado.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md | audiencia=humanos+IA | fase=11 -->

# Punto 3 — Medición de PDFs pesados y exportación

**Corrida final v3:** 2026-09-23, implementación de `ba357a0` (`ba357a0f10feb013b07acdc9ab145926ed0b1802`), renderer dist `da9a154286252a18ed2bc042f9e1eeb9d6267ca84890e15e6eb2a49a936e803d`. **Estado:** 3/3 repeticiones por perfil terminadas; control de cancelación H1 de la tanda anterior conservado (la lógica no cambió). Es una caracterización de este build y host, no un gate ni una promesa de memoria.

## Diseño y entorno

Se midió el camino importación → `PIPELINE_READY` → render explícito `full` de todas las páginas → exportación UI → descarga real → cierre. Cada test usó Electron nuevo; los perfiles se intercalaron H1/C0/H2 en r1, r2 y r3. El render pedido y el render interno de export son ventanas distintas. OCR y NER estuvieron habilitados (`spa` + `eng`, preset `auto`).

| Perfil | Fuente | Identidad / propiedades |
| --- | ---: | --- |
| C0 | 3.391 B | fixture versionado `tests/fixtures/text-10p.pdf` (P1, 10 páginas de texto nativo); SHA-256 `0a495198686aae89091b38147860b2f48de4a37e7a013d3f41c028f9262b104a` |
| H1 | 20.372.156 B | 6 páginas A4, 1800×2544 px, color, RGB JPEG; SHA-256 `0165bf8e2f26a734b0b5a2f1733cc53aa0e7b99c68a845af4b24fd24d04c9e41` |
| H2 | 37.935.359 B | Misma geometría y semilla, visualmente gris, PNG sin pérdida; Chromium codificó RGB PNG con R=G=B (no un canal); SHA-256 `8606a067e9fb2d9afa0b28c12d54d5aea808045419ee66291b299fcd59e7cfcf` |

H1 y H2 cambian el códec (JPEG/PNG) además del modo de color; la comparación no aísla un efecto de color o códec. La UI exportó los tres perfiles con JPEG, calidad 0,92, 150 DPI y sin leyenda, según los valores fijos actuales de `exportValidation.ts`.

C0 se lee directamente del fixture P1 versionado y se valida tamaño, SHA-256, page count y geometría A4; no pasa por una caché dinámica. H1/H2 se verificaron regenerando en memoria, sin leer ni escribir la caché, con SHA/tamaño exactos; sus cachés de campaña también se validan por manifest. La generación de H1/H2 fija fechas PDF y permanece `heavy-pdf-v1`. La tanda v2 anterior se archivó en `.measure/heavy-export/attempt-v2-before-versioned-c0/`; no se mezcla con estas cifras.

Host: macOS arm64, Apple M1, 8 CPU y 8 GiB; Node 24.20.0, Electron 44.2.0 / Chromium 152.0.7977.76. SHA-256 del `apps/react-client/dist`: `da9a154286252a18ed2bc042f9e1eeb9d6267ca84890e15e6eb2a49a936e803d`. La descarga remota de los assets del mirror falló por discrepancia de hash. Para el build experimental se copiaron temporalmente las 16 entradas de `assets.lock.json` (incluidos los 2 assets de ONNX Runtime) desde el checkout principal, verificando SHA-256 y tamaño; son ignorados y no se incorporaron a Git.

## Resultados

RSS es la suma de `workingSetSize` de procesos Electron y puede contar páginas compartidas varias veces. La tabla muestra mediana y rango entre las tres corridas, en MiB (1 MiB = 1.048.576 B). `M2 import` es el máximo RSS observado dentro de las ventanas cold/hot de importación hasta `Ready`; render, export y ventanas posteriores se informan aparte, sin restarlos de M2.

| Perfil | M2 import (mediana; rango) | M1 en ciclo de export (mediana; rango) | Cold import | Hot import |
| --- | ---: | ---: | ---: | ---: |
| C0 | 2.007,3; 1.826,9–2.013,5 | 6,3; 6,0–7,0 | 2,1 s (2,1–2,3) | 0,4 s (0,4–0,4) |
| H1 | 3.121,5; 2.705,4–3.496,1 | 1.915,6; 1.447,1–2.262,3 | 32,9 s (32,4–32,9) | 32,8 s (32,3–33,1) |
| H2 | 3.205,8; 2.966,0–3.281,3 | 2.823,4; 2.619,3–2.889,3 | 53,2 s (53,1–54,1) | 54,7 s (54,2–55,8) |

`M1 en ciclo de export` es la cota inferior `hot-import peak − cold post-close baseline` de esta secuencia; la base fría incluye import, render, export y cierre. No es comparable numéricamente con M1 histórico de importación sola. En particular, la base post-cierre C0 varió entre 1,63 y 1,96 GiB, frente a 0,43–1,02 GiB en H1 y 0,34–0,38 GiB en H2. Esa deriva/residencia, más la variación por repetición, impide atribuir la diferencia de M1 al perfil o al códec.

Picos RSS por fase (mediana; rango, MiB):

| Perfil | Render full frío | Render full caliente | Export frío | Export caliente | Post-export con documento abierto (frío / caliente) | Post-cierre (frío / caliente) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 | 2.077,8 (2.056,6–2.096,6) | 2.085,5 (1.835,5–2.123,4) | 2.029,6 (2.022,8–2.065,7) | 2.110,8 (1.854,0–2.117,6) | 2.009,7 (2.002,1–2.065,2) / 2.027,9 (1.787,5–2.038,5) | 2.005,7 (1.725,3–2.011,8) / 2.028,9 (1.787,5–2.039,2) |
| H1 | 2.492,1 (1.397,6–2.640,5) | 2.271,4 (2.216,8–2.325,3) | 2.489,0 (1.408,3–2.539,0) | 2.326,4 (2.232,7–2.371,0) | 2.409,7 (1.409,7–2.539,8) / 2.266,3 (2.077,5–2.288,5) | 1.013,9 (447,5–1.049,2) / 997,9 (665,5–1.277,0) |
| H2 | 1.528,0 (1.417,6–1.643,8) | 2.255,6 (1.808,5–2.642,7) | 1.537,2 (1.415,9–1.608,2) | 2.128,5 (1.782,2–2.480,5) | 1.537,9 (1.347,8–1.591,0) / 2.124,0 (1.773,3–2.392,3) | 386,8 (353,6–396,5) / 339,6 (336,6–379,9) |

El tiempo de exportación informado es `EXPORT_FINISHED.durationMs` del Core: 18–83 ms en C0, 27–48 ms en H1 y 35–54 ms en H2. No es el tiempo completo de interacción UI/descarga. Los PDFs descargados fueron de 247.842 B (C0), 6.658.431 B (H1) y 6.611.127 B (H2); cada descarga tiene SHA-256 en su JSON. El menor pico RSS de render/export frente a import en algunas ventanas no demuestra una optimización: los workers/modelos pueden liberarse y las corridas muestran dispersión considerable. La dispersión de M2 import entre tres corridas fue ~187 MiB en C0, ~791 MiB en H1 y ~315 MiB en H2. Los picos fríos bajos de algunas corridas H1/H2 coinciden con estado del host muy variable; no deben interpretarse como mejoras atribuibles al perfil. La presión del sistema cambió durante las corridas (memoria libre de inicio/fin, compresor y swap quedan en JSON), así que la tanda es descriptiva y no permite atribución causal fina.

## Fidelidad, cancelación y observabilidad

- 9/9 corridas v3 produjeron frío y caliente; las 18 descargas abrieron y renderizaron todas sus páginas con PDF.js, cantidad/dimensiones correctas y validación positiva de las regiones de marcador/vecino. El control artificial de PDF blanco falló como se esperaba. La comparación de regiones usa la misma escala y un umbral de tinta RGB <220 para tolerar antialiasing/compresión; los conteos no sustituyen OCR ni una prueba semántica del texto exportado. Se inspeccionó visualmente una página H1 de fuente y salida y ambas conservaron la franja.
- Cancelación adicional H1: se inyectó `CANCEL_REQUESTED` de forma síncrona al primer `EXPORT_PROGRESS.current >= 1`; observó `PIPELINE_CANCELLED`, sin `EXPORT_FINISHED`, sin enlace y sin archivo parcial. La latencia registrada fue 1 ms a resolución de `Date.now()` (no afirma un SLA <200 ms). Hubo confirmación UI de exportar sin grupos.
- La sonda RSS muestreó cada 150 ms (cadencia media observada ~152 ms); la sonda nativa muestreó cada 1 s: 27 muestras C0, 95–97 H1 y 138–140 H2 por corrida, sin errores. El costo de la sonda no se aisló; `getAppMetrics()` consulta todos los working sets.
- Heap JS/WASM por target: **no observado** en estas ventanas; las sondas CDP reutilizables fuerzan GC y habrían cambiado la carga de import/render/export. Tamaño exacto de imagen codificada de páginas, copias simultáneas del PDF y buffer interno de ensamblado siguen no observables por eventos/API públicos. El JSON conserva tiempos, `RENDER_FINISHED`, progreso de export, jobs con `jobId`, RSS por proceso, presión y hashes; no conserva buffers binarios de páginas.

## Ejecución y artefactos

Comando de medición:

```sh
ANONLY_HEAVY_EXPORT=1 pnpm exec playwright test \
  --config=playwright.perf.config.ts tests/perf/heavy-export-memory.spec.ts --workers=1
```

El runner `tests/perf/run-heavy-export.sh` hace antes el build `VITE_E2E=1` de React y el build del shell y ejecuta solo ese spec. La tanda final v3 con C0 versionado e intercalado pasó 9/9 pruebas en 13,2 min; la cancelación focal pasó en 37,2 s. Gates focales: ESLint, Prettier, `tsc -p tests/e2e/tsconfig.json --noEmit` y `vitest run tests/perf/support/heavyPdfFixtures.test.ts` pasaron (3 tests; el cuarto caso de regeneración completa es opt-in). La ejecución E2E del shell informó que el módulo opcional de actualización `sparkle_bridge.node` no está construido; no impidió las pruebas.

Reproducibilidad binaria opcional de H1/H2, regenerando fixtures en memoria y sin tocar caché:

```sh
ANONLY_VERIFY_HEAVY_FIXTURES=1 pnpm exec vitest run \
  tests/perf/support/heavyPdfFixtures.test.ts --testNamePattern "reproduce los hashes publicados"
```

La verificación pasó con hashes y tamaños exactos. Gates globales pasaron en el worktree aislado: `pnpm lint`, `pnpm typecheck`, `pnpm test` (149 archivos / 2.388 tests aprobados, 1 opt-in omitido) y `pnpm test:contract` (10 archivos / 313 tests). Tras trasladar el banco al checkout principal, con otros cambios locales del punto 1 todavía sin commit, los mismos cuatro gates pasaron otra vez: 150 archivos / 2.394 tests aprobados, 1 opt-in omitido, y 313 contract tests. Esta segunda cifra incluye tests locales ajenos al banco; no cambia los resultados de la tanda medida en el worktree aislado.

JSON v3 y PDFs descargados: `.measure/heavy-export/r{1,2,3}-{H1,C0,H2}.json` y `.measure/heavy-export/r{1,2,3}-{H1,C0,H2}-{cold,hot}.pdf`; cancelación: `.measure/heavy-export/h1-cancellation.json`. La tanda previa v2 se conservó bajo `.measure/heavy-export/attempt-v2-before-versioned-c0/` y no se usa para las cifras publicadas; también se conserva el smoke v1 bajo `.measure/heavy-export/attempt-before-native/`.
