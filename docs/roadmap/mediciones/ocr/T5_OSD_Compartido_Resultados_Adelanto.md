# T-5 — Resultados de implementación con una página de adelanto

Fecha de ejecución: 2026-09-15. Este es un reporte factual para revisión del
planificador. T-5 queda pendiente de aceptación; los resultados no implican
cierre ni una promesa de ahorro de memoria.

## Implementación y validación

Se implementó la ventana de tres consumidores únicamente cuando existe el
puerto LSTM inyectado y `ocrPoolSize === 2`. El pool físico sigue admitiendo
dos reconocimientos; el tercer descriptor puede producir, esperar OSD o
esperar el pool LSTM. `lowResource`, otros tamaños, el fallback sin puerto y
`processPages` conservan sus límites previos. La reserva RGBA se mantiene
durante producción, OSD, espera LSTM y retries.

La inicialización OSD invalidada ya no bloquea la generación siguiente ni
`dispose()`. Las cargas que terminan tarde terminan su worker y los rechazos de
limpieza se observan. La guarda de liberación también cubre una sesión que aún
está produciendo una imagen.

Archivos de producto y pruebas nuevos o modificados:

- `packages/anonymization-core/ocr-engine/src/ocr.engine.ts`
- `packages/anonymization-core/ocr-engine/src/worker/orientation-kernel.ts`
- `packages/anonymization-core/ocr-engine/src/worker/kernel.ts`
- `packages/anonymization-core/ocr-engine/src/__tests__/orientation-kernel.test.ts`
- `packages/anonymization-core/ocr-engine/src/__tests__/t5-shared-osd.test.ts`
- `tests/perf/support/memoryProfile.ts` y su prueba: Ready usa timestamps de pared con un origen común.
- `tests/perf/support/t5Instrumentation.ts`, `cdpHeap.ts` y pruebas: topología CDP conserva factory/chunk y separa jobs de instancias.
- `tests/e2e/t5-orientation-pixel.spec.ts` y helpers de fixture/exportación/muestreo.

Gates ejecutados:

- 159 tests OCR contract/unit/edge/snapshot: PASS.
- Typecheck y ESLint scoped de OCR: PASS.
- Tests del instrumento CDP/memory profile: 27 PASS.
- Typecheck y ESLint scoped de E2E: PASS.
- E2E Electron opt-in: PASS; cinco páginas con giros físicos `0, 90, 180, 0, 270`, palabras y rotaciones observadas, reanálisis real `spa → spa+eng`, censura que cambia píxeles dentro de las cajas ground truth y descarga PDF completada.
- Cobertura OCR: 95.81% líneas, 88.28% ramas, 98.33% funciones.

El comando de cobertura global no se usa como gate: sus fallos correspondieron
a thresholds de paquetes no incluidos en esa ejecución.

## Fixture, builds e instrumento

El fixture P2 de la campaña es
`.measure/t5-osd/t5-20260915-adelanto-7c3a9d11/fixture/p2-scanned-50p.pdf`,
1 714 563 bytes, SHA-256
`26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.

El control se ejecutó en checkout detached con SHA
`48961510e004c62f39669de7760a41d8361ef49f`. El instrumento se copió al
control antes de A1. Cada JSON conserva hashes de fuentes, build, lock,
instrumento, assets, configuración efectiva y `ANONLY_T5_FACTORY_CHUNKS`.
El AFTER clasificó `entry-CP_kfxim.js` como factory LSTM y
`orientation-entry-vb46UOIf.js` como factory OSD. El control clasificó
`entry-D6iGD7iM.js` como factory histórica con LSTM+OSD por consumidor.

La campaña preserva los JSON y stdout en:
`.measure/t5-osd/t5-20260915-adelanto-7c3a9d11/`.
Las dos tentativas inválidas y sus salidas también se conservaron en el
checkout control bajo su mismo identificador de campaña. El E2E de giros y el
PDF exportado están bajo `.measure/t5-e2e/`.

## Matriz requisito → prueba → resultado

| Requisito | Prueba/artefacto | Resultado |
| --- | --- | --- |
| Carga OSD obsoleta permite nueva generación | `orientation-kernel.test.ts`, caso de timeout seguido por segunda carga | PASS; worker tardío terminado |
| `dispose()` no espera carga nunca resuelta | `orientation-kernel.test.ts` | PASS |
| Hasta tres consumidores con dos LSTM físicos | `t5-shared-osd.test.ts`, lookahead determinista | PASS; tres orientaciones admitidas, máximo dos reconocimientos |
| Presupuesto y cancelación | tests existentes de `LiveImageBudget` más guarda de sesión activa | PASS en unit/edge; producción mantiene reserva |
| Liberación durante producción y reanálisis | `t5-shared-osd.test.ts` y ciclo de cleanup | PASS en mocks de ciclo; reanálisis Electron no formó parte de esta campaña |
| Aislamiento por instancia | tests de kernel/Core existentes | PASS estructural; el E2E real ejercita una instancia |
| Giros físicos y geometría | `t5-orientation-pixel.spec.ts` | PASS en Electron; cinco páginas, `bbox.rotation` y cajas observadas |
| Censura/exportación real | mismo E2E, PDF capturado y muestreo de píxeles | PASS; se modificó un píxel dentro de cajas conocidas |
| Igualdad OCR completa | `qualityFingerprint` sobre `Word[]` completas | PASS en todas las corridas válidas: 50 páginas/1038 palabras, hash `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49` |
| Instrumento reproducible | `memoryProfile.test.ts`, manifests por ejecución | PASS; `readyDurationMs` usa reloj común |

El reanálisis Electron conservó texto, orden y geometría completa. Se observó
una variación real de confianza en palabras repetidas de una página (`0.93 →
0.96`); el E2E conserva y valida ese campo en rango, sin ocultarlo. Los tests
unitarios de aislamiento no se presentan como prueba de dos OSD reales
concurrentes.

## Medición A/B

Las rutas elegidas para cada par son:

- A1: `pair-1/before/pair-1-before.json`.
- B1 válida: `pair-1/after-3/pair-1-after.json`; `after-2` se conserva como inválida.
- B2: `pair-2/after/pair-2-after.json`.
- A2: `pair-2/before-retry/pair-2-before.json`; la primera A2 también se conserva.
- A3: `pair-3/before/pair-3-before.json`.
- B3: `pair-3/after/pair-3-after.json`.

MB son decimales. Cada celda es `AFTER - BEFORE`; los tiempos son milisegundos.
El pico OCR es la suma simultánea de RSS dentro de
`OCR_STARTED → OCR_FINISHED`; el pico global es el máximo de toda la corrida.

| Par | Temperatura | Δ pico RSS OCR | Δ pico RSS global | Δ tiempo OCR | Δ Ready |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | frío | +213.8 MB | +400.2 MB | +1719 | +1153 |
| 1 | caliente | +556.9 MB | +556.9 MB | +2198 | +1877 |
| 2 | frío* | +50.0 MB | +188.4 MB | +2114 | +1970 |
| 2 | caliente | -24.6 MB | -24.6 MB | +2517 | +2497 |
| 3 | frío | +31.9 MB | +119.8 MB | +2250 | +2342 |
| 3 | caliente | +165.7 MB | +165.7 MB | +2190 | +2305 |

`*` A2 frío quedó `peakWithinPhases=false` tanto en el primer intento como en
el único reintento permitido; se reporta pero no se promedia como un resultado
válido de RSS. B1 inicial tuvo la misma marca y se conserva junto a B1 válida.

En las corridas AFTER válidas se observaron `ocr-page` pico 2, 50 jobs,
`ocr-orient` pico 1, 50 jobs y dos padres LSTM más un padre OSD por sesión
cold/hot. Los conteos de hijos Tesseract se guardaron aparte de los padres;
el control mostró dos hijos LSTM y dos OSD por consumidor, mientras AFTER
mostró dos LSTM y un OSD compartido. Los padres se recrean entre cold/hot, por
eso el conteo acumulado de targets puede ser cuatro LSTM en una misma sesión
de Electron aunque el pico concurrente sea dos.

Los resultados indican una regresión de tiempo consistente del AFTER y no
demuestran ahorro global de RSS. La reducción de una instancia OSD por Core
queda estructuralmente confirmada, pero el efecto RSS medido es variable y en
general mayor. La mejora diagnóstica anterior de aproximadamente 24% no se
usa como comparación de esta campaña.

## Pendientes y limitaciones

- Falta la revisión del planificador y los gates globales posteriores.
- Las corridas frías inválidas impiden una media fría completa estrictamente
  válida para los tres pares; no se ocultan ni se sustituyen por valores
  favorables.
- El E2E de giros verifica cajas OCR y cambios de píxel exportado; la
  comparación de entidades normalizadas entre ambos builds queda cubierta en
  P2 por grupos/conteos y debe ser revisada contra los JSON completos antes de
  aceptar una conclusión general.
- Los errores globales de lint ya conocidos fuera de T5 permanecen fuera de
  este alcance.
