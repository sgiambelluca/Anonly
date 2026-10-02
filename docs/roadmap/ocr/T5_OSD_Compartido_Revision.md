# T-5 — Revisión independiente del planificador

Fecha: 2026-09-13, hora Argentina. Revisión del árbol de trabajo y de los JSON entregados por Luna; no se modificó código de producto ni se hicieron commits.

**Veredicto: REJECTED para cerrar T-5.** La separación de OSD es viable y está conectada en producción, pero faltan garantías de ciclo de vida y de calidad. Las mediciones disponibles son exploratorias: no confirman un ahorro sostenido de memoria ni justifican aumentar el pool LSTM.

## Hallazgos de implementación

1. **P1 — El deadline y la cancelación no abarcan carga y decodificación.** En `ocr-engine/src/worker/orientation-kernel.ts:149`, `ensureWorker()` y `buildImage()` se esperan antes de instalar el timer y el listener de abort. Si cualquiera queda pendiente, el único servicio OSD bloquea las páginas siguientes. `dispose()` también espera la inicialización sin límite. Contradice ADR-164 §3.1. Reproduje tres fallos: timeout durante carga, abort durante carga y timeout durante decode. La cola local de `ocr.engine.ts:183` tampoco asienta un abort en espera hasta que termine su predecesor.
2. **P2 — La liberación ociosa omite el OSD local y la guarda del motor.** `ocr.engine.ts:850` solo delega a los dos puertos; el puerto local tiene `releaseIdleWorkers()` vacío. Después de una página completada, la instancia OSD sigue viva hasta `dispose()`. Reproduje que `terminate()` recibe cero llamadas al liberar recursos ociosos. Tampoco existe el contador de `processPage` activos requerido por ADR-164 §3.2: la guarda individual de cada pool no sustituye la guarda conjunta durante orientación, reconocimiento y retry. El primer problema corresponde al fallback; no lo uso para explicar el RSS de las corridas Electron, que emplean el pool remoto.
3. **P2 — La aceptación de calidad no está implementada.** `tests/perf/osd-sharing.spec.ts:48` usa `qualitySummaryFingerprint`, que solo compara `pageIndex`, cantidad de palabras y confianza agregada. `qualityFingerprint`, que sí contempla texto y cajas, existe pero no se usa en la medición. El mismo hash no prueba igualdad de palabras, orden o geometría. Faltan el corpus de giros en píxeles 0/90/180/270, la comparación de entidades normalizadas y la verificación real de censura/exportación de ADR-164 §5 y handoff §3.4.
4. **P2 — El experimento quedó incluido en el gate general sin activación opcional.** `tests/perf/osd-sharing.spec.ts:18` exige cuatro variables `ANONLY_T5_*` sin `test.skip` ni configuración separada. `playwright.perf.config.ts` lo descubre dentro de `pnpm test:perf`; confirmé su inclusión con `--list`. Sin esas variables, el cuerpo lanza un error. El intento de ejecución directa de revisión se detuvo antes, en el guard de build fresco; este hallazgo surge de la selección y del código, no de una ejecución completa del gate.

Los tests entregados pasan en los scopes de OCR, pero algunos nombres afirman más que sus aserciones. Por ejemplo, el test de liberación y reanálisis solo invoca liberación sobre un motor que nunca procesó páginas; el test de compartir OSD usa pools simulados y no cuenta instancias Tesseract ni detecciones simultáneas. El reporte de ejecución declara comprobadas carga colgada, generación tardía y censura funcional, pero esas garantías no están demostradas por las pruebas revisadas.

## Qué sí respalda la evidencia

El façade crea un pool de orientación de tamaño uno y conserva dos reconocedores. El kernel LSTM deja de crear OSD; recibe un ángulo validado y mantiene su geometría. Los eventos de las corridas muestran 50 jobs de reconocimiento y 50 de orientación, con concurrencias máximas de dos y uno, respectivamente.

La topología CDP cruda del primer par respalda la reducción de cuatro a tres hijos Tesseract: BEFORE tiene dos wrappers de reconocimiento con dos hijos cada uno; AFTER tiene dos wrappers de reconocimiento y un `orientation-entry`, cada uno con un hijo. Sin embargo, el clasificador antiguo etiqueta erróneamente al hijo del wrapper de orientación como `tesseract-lstm`. Hay que corregir el instrumento y guardar el mapa de chunks exigido, no tomar sus etiquetas actuales como identidad. Tampoco es correcto el texto del informe que dice «dos hijos OSD bajo cada» OcrWorker: BEFORE posee un LSTM y un OSD por wrapper.

## Métricas recalculadas

Equipo: Apple M1, 8 CPU lógicas, 8 GiB RAM. Fixture sintético P2: 50 páginas, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`. Todos los runs registran 1038 palabras, 11 grupos, 13 entidades y `hotBaselineSettled=true`. Eso confirma finalización y conteos, con el límite de calidad indicado arriba.

Fuentes: BEFORE en `.measure/t5-osd/t5-20260913-351fc4d3-r2/pair-{1,2,3}/before/`; AFTER en `.measure/t5-osd/t5-20260913-351fc4d3/pair-{1,2,3}/after/`. Se conservaron los controles anteriores y no se seleccionaron nuevas corridas para esta revisión.

Para cada run calculé duración OCR = `phases.OCR_FINISHED - phases.OCR_STARTED`; pico OCR = máximo de `sumWorkingSetSizeBytes` entre `fromAtMs` y `toAtMs` del segmento OCR_STARTED→OCR_FINISHED. Cada muestra suma procesos en el mismo instante; no se suman picos independientes. MB son decimales. «Caliente» significa segunda importación tras cerrar documento en el mismo Electron, no que Tesseract necesariamente continúe cargado.

| Sesión / par | Pico OCR BEFORE MB | Pico OCR AFTER MB | Δ MB | OCR BEFORE ms | OCR AFTER ms | Δ ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frío / 1 | 1534.2 | 1443.8 | -90.4 | 15390.7 | 15788.7 | +398.0 |
| Frío / 2 | 1634.5 | 1563.4 | -71.0 | 15293.8 | 14992.9 | -301.0 |
| Frío / 3 | 1591.6 | 1459.2 | -132.3 | 15343.6 | 15126.8 | -216.8 |
| Caliente / 1 | 1436.7 | 1526.8 | +90.1 | 15262.8 | 14851.8 | -411.0 |
| Caliente / 2 | 1465.9 | 1611.0 | +145.1 | 15582.2 | 15298.7 | -283.5 |
| Caliente / 3 | 1475.2 | 1550.0 | +74.8 | 16034.6 | 15053.4 | -981.1 |

Promedios descriptivos, sin inferencia estadística:

| Métrica | Frío BEFORE → AFTER | Caliente BEFORE → AFTER |
| --- | --- | --- |
| Pico RSS en etapa OCR | 1586.8 → 1488.8 MB: **-97.9 MB (-6.2%)** | 1459.3 → 1562.6 MB: **+103.3 MB (+7.1%)** |
| Duración OCR | 15.343 → 15.303 s: **-0.040 s (-0.3%)** | 15.627 → 15.068 s: **-0.559 s (-3.6%)** |
| Pico RSS global | 1608.1 → 1557.8 MB: -50.2 MB | 1515.6 → 1584.8 MB: +69.2 MB |
| Tiempo total hasta Ready | 20.567 → 20.595 s: +0.027 s | 19.048 → 18.450 s: -0.598 s |

El reporte original mezcla el tiempo hasta Ready con el de OCR. Tampoco `peakWithinPhases=true` identifica por sí solo la ventana OCR. El pico global cae fuera de las fases registradas en BEFORE frío 2 y AFTER frío 3; las filas globales se conservan como descriptivas, no como ejecuciones plenamente aceptadas por el protocolo.

## Límites del experimento

- Los controles finales se ejecutaron todos después de los AFTER. Los primeros targets CDP sitúan AFTER 1/2/3 a las 00:37:52, 00:40:01 y 00:42:05 UTC, y BEFORE 1/2/3 a las 00:44:48, 00:45:45 y 00:46:36 UTC del 14 de septiembre. No se conserva el orden alternado A1/B1, B2/A2, A3/B3 de la comparación final. La deriva temporal puede influir; los números de «par» no recuperan ese control experimental.
- Verifiqué igualdad actual de hashes de los cuatro archivos del instrumento entre ambos checkouts, y HEAD del control correcto. Faltan manifests por ejecución de fuentes/build/configuración/instrumento; los JSON de identidad contienen hardware, no esa trazabilidad completa.
- El build AFTER hoy dispara el guard de antigüedad. Contrasté sus sourcemaps con los fuentes: las diferencias encontradas son formato y orden de dos imports, sin cambio funcional identificado. No atribuyo por esto los resultados a otra implementación, pero una repetición requiere rebuild fresco y manifests.
- Tres repeticiones de un único corpus sintético no establecen comportamiento general. Parte de las diferencias aparece en GPU y otros procesos, no exclusivamente en Tab. Ni RSS ni RSS menos heaps identifica el tamaño del OSD.

## Validación de revisión

- `pnpm typecheck`: PASS.
- `pnpm test:contract`: PASS, 312 tests.
- `pnpm test`: 2173 PASS y un timeout de 30 s en un test de anchura de texto de RenderEngine. Su repetición aislada pasó en 6.4 s. No hay evidencia para atribuirlo a T5; tampoco se declara verde la ejecución global que falló.
- `pnpm lint`: FAIL, ocho errores en scripts de skills `.agents/` y configuración de project service de ESLint, fuera de los cambios T5. El lint global no está verde.
- Cuatro pruebas temporales discriminantes de revisión: cuatro FAIL, correspondientes a los defectos de deadline/cancelación/liberación. Se retiraron de la suite y se conservaron fuente y logs en `.measure/t5-review/` para reproducir y convertir en regresiones durante la corrección. No forman parte del conteo global anterior.
- El intento Playwright directo se detuvo por build no fresco. No se volvieron a medir tiempos ni se ejecutó el E2E pendiente durante esta revisión.

## Decisión propuesta

Conservar el trabajo como implementación pendiente de corrección. La hipótesis **arquitectónica** está respaldada: un OSD puede atender a dos LSTM y elimina una instancia duplicada. La hipótesis **de recursos** sigue abierta: menor cantidad de instancias no se tradujo en menor pico RSS durante las repeticiones calientes. La mejora temporal caliente es pequeña y favorable, con el límite del orden experimental.

Antes de cerrar T5: corregir deadline/cancelación/cola y liberación; convertir los repros en tests permanentes, completar aislamiento/reanálisis/topología real; medir igualdad completa de OCR y entidades, incluyendo giros y censura; separar el experimento del gate común; repetir una campaña alternada con manifests y el instrumento corregido. Solo después corresponde evaluar tres o cuatro reconocedores como otro experimento. No se modifica `ocrPoolSize` ni se marca T5 como terminado.
