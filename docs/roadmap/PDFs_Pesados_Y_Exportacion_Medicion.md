<!-- CONTEXT: scope=roadmap-measurement | dependencias=roadmap/PDFs_Pesados_Y_Exportacion_Plan.md,adr/ADR-174-Los-PDFs-Pesados-Se-Miden-Hasta-El-Archivo-Exportado.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md | audiencia=humanos+IA | fase=11 -->

# Punto 3 — Medición de PDFs pesados y exportación

**Corrida:** 2026-09-23, implementación de `ba357a0` (`ba357a0f10feb013b07acdc9ab145926ed0b1802`). **Estado:** 3/3 repeticiones por perfil terminadas; control de cancelación H1 terminado. Es una caracterización de este build y host, no un gate ni una promesa de memoria.

## Diseño y entorno

Se midió el camino importación → `PIPELINE_READY` → render explícito `full` de todas las páginas → exportación UI → descarga real → cierre. Cada test usó Electron nuevo; los perfiles se intercalaron H1/C0/H2 en r1, r2 y r3. El render pedido y el render interno de export son ventanas distintas. OCR y NER estuvieron habilitados (`spa` + `eng`, preset `auto`).

| Perfil | Fuente | Identidad / propiedades |
| --- | ---: | --- |
| C0 | 3.391 B | P1 de 10 páginas de texto nativo existente; SHA-256 `2ec44f689615322208bf43a5cf282aa913d48e10ac485fc129e17d5c2239c8d9` |
| H1 | 20.372.156 B | 6 páginas A4, 1800×2544 px, color, RGB JPEG; SHA-256 `0165bf8e2f26a734b0b5a2f1733cc53aa0e7b99c68a845af4b24fd24d04c9e41` |
| H2 | 37.935.359 B | Misma geometría y semilla, visualmente gris, PNG sin pérdida; Chromium codificó RGB PNG con R=G=B (no un canal); SHA-256 `8606a067e9fb2d9afa0b28c12d54d5aea808045419ee66291b299fcd59e7cfcf` |

H1 y H2 cambian el códec (JPEG/PNG) además del modo de color; la comparación no aísla un efecto de color o códec. La UI exportó los tres perfiles con JPEG, calidad 0,92, 150 DPI y sin leyenda, según los valores fijos actuales de `exportValidation.ts`.

La reproducibilidad H1/H2 se verificó regenerando en memoria, sin leer ni escribir la caché: ambos reprodujeron el SHA/tamaño publicados. El primer intento expuso fechas PDF de creación/modificación dependientes del reloj; se fijaron a los valores de los fixtures medidos, sin alterar sus bytes, y luego pasó la comparación exacta. La versión permanece `heavy-pdf-v1`.

Host: macOS arm64, Apple M1, 8 CPU y 8 GiB; Node 24.20.0, Electron 44.2.0 / Chromium 152.0.7977.76. SHA-256 del `apps/react-client/dist`: `da9a154286252a18ed2bc042f9e1eeb9d6267ca84890e15e6eb2a49a936e803d`. La descarga remota de los assets del mirror falló por discrepancia de hash. Para el build experimental se copiaron temporalmente las 16 entradas de `assets.lock.json` (incluidos los 2 assets de ONNX Runtime) desde el checkout principal, verificando SHA-256 y tamaño; son ignorados y no se incorporaron a Git.

## Resultados

RSS es la suma de `workingSetSize` de procesos Electron y puede contar páginas compartidas varias veces. La tabla muestra mediana y rango entre las tres corridas, en MiB (1 MiB = 1.048.576 B). `M2 import` es el máximo RSS observado dentro de las ventanas cold/hot de importación hasta `Ready`; render, export y ventanas posteriores se informan aparte, sin restarlos de M2.

| Perfil | M2 import (mediana; rango) | M1 en ciclo de export (mediana; rango) | Cold import | Hot import |
| --- | ---: | ---: | ---: | ---: |
| C0 | 2.038,8; 1.998,1–2.050,8 | 6,22; 5,59–6,36 | 2,13 s (2,13–2,17) | 0,43 s (0,42–0,43) |
| H1 | 2.786,2; 2.561,7–3.586,1 | 2.031,5; 1.654,3–2.144,9 | 32,62 s (31,91–32,89) | 32,39 s (31,92–32,85) |
| H2 | 3.176,8; 3.135,7–3.353,8 | 2.779,9; 2.755,3–2.965,7 | 55,24 s (54,54–55,85) | 54,13 s (54,08–56,49) |

`M1 en ciclo de export` es la cota inferior `hot-import peak − cold post-close baseline` de esta secuencia; la base fría incluye import, render, export y cierre. No es comparable numéricamente con M1 histórico de importación sola. En particular, la base post-cierre C0 quedó alrededor de 1,9 GiB, frente a unos 0,37–0,93 GiB de los perfiles pesados. Esa deriva/residencia, más la variación por repetición, impide atribuir la diferencia de M1 al perfil o al códec.

Picos RSS por fase (mediana; rango, MiB):

| Perfil | Render full frío | Render full caliente | Export frío | Export caliente | Post-export con documento abierto (frío / caliente) | Post-cierre (frío / caliente) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 | 2.078,9 (2.050,6–2.139,5) | 2.150,3 (2.128,0–2.184,3) | 2.055,3 (2.015,8–2.142,3) | 2.162,3 (2.150,6–2.197,9) | 2.034,5 (1.993,2–2.046,9) / 2.075,3 (2.072,0–2.119,4) | 2.037,5 (1.996,3–2.048,8) / 2.076,2 (2.073,3–2.120,4) |
| H1 | 2.308,5 (2.201,2–2.455,6) | 2.292,6 (2.124,8–2.861,8) | 2.325,7 (2.256,9–2.448,4) | 2.215,2 (1.925,7–2.886,1) | 2.329,2 (2.231,1–2.450,4) / 2.099,1 (1.919,3–2.577,0) | 766,8 (759,1–928,8) / 845,5 (476,1–1.183,8) |
| H2 | 1.673,6 (1.443,6–2.088,0) | 2.173,9 (2.077,6–2.419,9) | 1.629,6 (1.492,7–1.958,9) | 2.099,7 (2.016,7–2.442,9) | 1.553,5 (1.496,3–1.960,6) / 2.098,1 (1.916,0–2.443,5) | 392,4 (384,9–404,8) / 419,5 (394,8–771,2) |

El tiempo de exportación informado es `EXPORT_FINISHED.durationMs` del Core: 19–32 ms en C0, 29–42 ms en H1 y 35–42 ms en H2. No es el tiempo completo de interacción UI/descarga. Los PDFs descargados fueron de 247.842–247.846 B (C0), 6.658.431 B (H1) y 6.611.127 B (H2); cada descarga tiene SHA-256 en su JSON. El menor pico RSS de render/export frente a import en algunas ventanas no demuestra una optimización: los workers/modelos pueden liberarse y las corridas muestran dispersión considerable. C0 también deriva entre repeticiones: su M2 import varía ~53 MiB; H1 ~1.024 MiB y H2 ~218 MiB. La presión del sistema cambió durante las corridas (memoria libre de inicio/fin, compresor y swap quedan en JSON), así que la tanda es descriptiva y no permite atribución causal fina.

## Fidelidad, cancelación y observabilidad

- 9/9 corridas produjeron frío y caliente; las 18 descargas abrieron y renderizaron todas sus páginas con PDF.js, cantidad/dimensiones correctas y validación positiva de las regiones de marcador/vecino. El control artificial de PDF blanco falló como se esperaba. La comparación de regiones usa la misma escala y un umbral de tinta RGB <220 para tolerar antialiasing/compresión; los conteos no sustituyen OCR ni una prueba semántica del texto exportado. Se inspeccionó visualmente una página H1 de fuente y salida y ambas conservaron la franja.
- Cancelación adicional H1: se inyectó `CANCEL_REQUESTED` de forma síncrona al primer `EXPORT_PROGRESS.current >= 1`; observó `PIPELINE_CANCELLED`, sin `EXPORT_FINISHED`, sin enlace y sin archivo parcial. La latencia registrada fue 1 ms a resolución de `Date.now()` (no afirma un SLA <200 ms). Hubo confirmación UI de exportar sin grupos.
- La sonda RSS muestreó cada 150 ms (cadencia media observada ~152 ms); la sonda nativa muestreó cada 1 s: 27 muestras C0, 95–97 H1 y 139–142 H2 por corrida, sin errores. El costo de la sonda no se aisló; `getAppMetrics()` consulta todos los working sets.
- Heap JS/WASM por target: **no observado** en estas ventanas; las sondas CDP reutilizables fuerzan GC y habrían cambiado la carga de import/render/export. Tamaño exacto de imagen codificada de páginas, copias simultáneas del PDF y buffer interno de ensamblado siguen no observables por eventos/API públicos. El JSON conserva tiempos, `RENDER_FINISHED`, progreso de export, jobs con `jobId`, RSS por proceso, presión y hashes; no conserva buffers binarios de páginas.

## Ejecución y artefactos

Comando de medición:

```sh
ANONLY_HEAVY_EXPORT=1 pnpm exec playwright test \
  --config=playwright.perf.config.ts tests/perf/heavy-export-memory.spec.ts --workers=1
```

El runner `tests/perf/run-heavy-export.sh` hace antes el build `VITE_E2E=1` de React y el build del shell y ejecuta solo ese spec. La tanda final intercalada pasó 9/9 pruebas en 13,2 min; la cancelación focal pasó en 37,2 s. Gates focales: ESLint, Prettier, `tsc -p tests/e2e/tsconfig.json --noEmit` y `vitest run tests/perf/support/heavyPdfFixtures.test.ts` pasaron (3 tests; el cuarto caso de regeneración completa es opt-in). La ejecución E2E del shell informó que el módulo opcional de actualización `sparkle_bridge.node` no está construido; no impidió las pruebas.

Reproducibilidad binaria opcional de H1/H2, regenerando fixtures en memoria y sin tocar caché:

```sh
ANONLY_VERIFY_HEAVY_FIXTURES=1 pnpm exec vitest run \
  tests/perf/support/heavyPdfFixtures.test.ts --testNamePattern "reproduce los hashes publicados"
```

La verificación pasó con hashes y tamaños exactos. Gates globales pasaron en el worktree aislado: `pnpm lint`, `pnpm typecheck`, `pnpm test` (149 archivos / 2.388 tests aprobados, 1 opt-in omitido) y `pnpm test:contract` (10 archivos / 313 tests). Tras trasladar el banco al checkout principal, con otros cambios locales del punto 1 todavía sin commit, los mismos cuatro gates pasaron otra vez: 150 archivos / 2.394 tests aprobados, 1 opt-in omitido, y 313 contract tests. Esta segunda cifra incluye tests locales ajenos al banco; no cambia los resultados de la tanda medida en el worktree aislado.

JSON v2 y PDFs descargados: `.measure/heavy-export/r{1,2,3}-{H1,C0,H2}.json` y `.measure/heavy-export/r{1,2,3}-{H1,C0,H2}-{cold,hot}.pdf`; cancelación: `.measure/heavy-export/h1-cancellation.json`. La primera tanda smoke v1 se conservó bajo `.measure/heavy-export/attempt-before-native/` y no se usa para las cifras publicadas.
