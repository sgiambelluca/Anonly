# T-5 — Resultados de implementación y medición

Fecha de ejecución: 2026-09-13. Este documento es un reporte factual de la campaña y no cierra T-5 ni modifica el roadmap.

## Implementación

Se implementaron los scopes T5-I, T5-S, T5-O, T5-F, T5-A y T5-V. El cambio añade el contrato `ocr-orient`, el kernel OSD por instancia, la cola de orientación, el wiring de façade/Electron y las réplicas de configuración. Las correcciones posteriores de revisión hacen que el deadline de orientación empiece al tomar turno y cubra carga, decode y detect; las esperas se pueden abortar, las generaciones obsoletas no detectan ni publican, los bitmaps/workers tardíos se liberan y los rechazos de `terminate` se absorben.

`OcrEngine` cuenta cada `processPage` activo, protege la liberación durante espera/retry, registra cleanup asíncrono, libera ambos pools y el fallback OSD cuando está ocioso, y espera el cleanup antes de recrear perezosamente el kernel o disponer el motor. Los tests permanentes cubren cola abortable, carga/decode colgadas, abort durante detect, generaciones y bitmaps tardíos, liberación activa/ociosa, reanálisis, aislamiento, regiones del mismo documento con `pageIndex` repetido y solapamiento de dos reconocedores con un OSD serializado.

El instrumento captura la serie RSS y heap por target, eventos crudos, Word[] completas desde el cache host fuera de la ventana medida, tiempos `OCR_STARTED→OCR_FINISHED` y `DOCUMENT_IMPORTED→PIPELINE_READY`, picos OCR/globales y máximos por PID. La huella de calidad ordena por `pageIndex` y compara texto, source, confidence, bbox, rotation y orden de las palabras.

## Fuentes y protocolo

- Control detached: `/Users/maratorres/Anonly/Anonly-t5-before`, HEAD `48961510e004c62f39669de7760a41d8361ef49f`.
- Fixture congelado: [`p2-scanned-50p.pdf`](../../.measure/t5-osd/t5-20260913-351fc4d3-r4/fixture/p2-scanned-50p.pdf), 1,714,563 bytes, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
- Campaña válida: `.measure/t5-osd/t5-20260913-351fc4d3-r4/`; pares en orden A1/B1, B2/A2 y A3/B3. Cada condición tuvo build fresco, un Electron, sesión fría, cierre y sesión caliente, `ocrPoolSize: 2`, sin retries operativos y sin procesos de test/build concurrentes.
- La primera A1 de r3 se conserva como inválida porque el build no tenía `VITE_E2E=1`; la primera r3 también conserva una clasificación CDP antigua. No se mezclan con r4.

## Resultados r4

Memoria es el pico global RSS agregado y `OCR RSS` es el pico dentro de `OCR_STARTED→OCR_FINISHED`, en MB decimales. Tiempo es `DOCUMENT_IMPORTED→PIPELINE_READY`; entre paréntesis va el tiempo exclusivo OCR. Todas las filas r4 terminaron con `ok=true` y `peakWithinPhases=true`.

| Par / temperatura | BEFORE RSS / OCR RSS / ms (OCR ms) | AFTER RSS / OCR RSS / ms (OCR ms) | Δ RSS / Δ OCR RSS / Δ ms (Δ OCR ms) |
|---|---:|---:|---:|
| 1 frío | 1996.9 / 1669.2 / 20232 (15073) | 2076.5 / 1645.6 / 20056 (15017) | +79.8 / -23.6 / -175 (-56) |
| 1 caliente | 2065.7 / 2065.7 / 18582 (15215) | 2055.9 / 2055.9 / 18233 (14888) | -9.8 / -9.8 / -349 (-327) |
| 2 frío | 2013.8 / 1728.4 / 20457 (15316) | 2073.1 / 1543.1 / 19973 (14813) | +59.3 / -185.3 / -484 (-503) |
| 2 caliente | 1532.0 / 1407.6 / 18932 (15504) | 1806.8 / 1806.8 / 18512 (14995) | +274.8 / +399.2 / -420 (-509) |
| 3 frío | 1852.4 / 1586.8 / 20303 (15149) | 1890.6 / 1558.0 / 20079 (14960) | +38.2 / -28.8 / -224 (-189) |
| 3 caliente | 1721.6 / 1721.6 / 18817 (15298) | 2120.6 / 2120.6 / 18447 (14934) | +399.0 / +399.0 / -370 (-364) |

El promedio de AFTER menos BEFORE es `+59.1 MB` RSS global y `-79.2 MB` en el pico RSS exclusivo de OCR en frío; en caliente es `+221.3 MB` global y `+263.5 MB` exclusivo de OCR. El promedio temporal es `-295 ms` frío (`-249 ms` OCR) y `-380 ms` caliente (`-400 ms` OCR). La variabilidad RSS, especialmente caliente, impide declarar una mejora de memoria.

Los tres pares tuvieron 50 páginas OCR, 1,038 palabras, 11 grupos y 13 entidades por condición. La comparación normalizada de Word[] completas produjo la misma huella `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49` en cada par frío y caliente: no se observaron diferencias de texto, confianza, bbox, rotation ni orden después de ordenar páginas por `pageIndex`.

BEFORE registró 50 jobs `ocr-page`, pico LSTM 2 y ningún job OSD. AFTER registró 50 jobs `ocr-page`, 50 `ocr-orient`, pico LSTM 2 y pico OSD 1. Por sesión, el mapa CDP/source de AFTER identificó dos instancias parent `orientation-entry` y un hijo Tesseract OSD por instancia; el parent del reconocedor LSTM se identifica como `entry-DOPWzfRr.js`, con dos instancias por sesión. Al combinar las muestras fría y caliente aparecen cuatro sesiones parent LSTM y dos parent OSD, por lo que el reporte conserva esa distinción. El mapa conserva URLs y targets crudos en `manifests/*-topology-corrected.json`. No se dedujeron instancias desde conteos de jobs ni desde RSS.

## Validación y límites

Gates scoped verdes: ESLint de `packages/anonymization-core/ocr-engine` con `--max-warnings=0`, typecheck del paquete, 155 tests OCR y cobertura scoped de 93.9% líneas, 93.9% statements, 88.31% branches y 97.19% funciones; además 25 tests del instrumento/CDP/memory profile. Prettier y `git diff --check` quedaron verdes para los archivos trabajados.

El E2E r4 confirma OCR real P2, geometría OCR almacenada y equivalencia completa de Word[] entre condiciones. Sigue pendiente un E2E dedicado con píxeles intercalados 0/90/180/270, la página girada al final y comprobación real de geometría, censura y exportación; por ello esas afirmaciones no se declaran cerradas. La clasificación CDP solo afirma roles cuando el chunk/factory aporta evidencia; targets genéricos quedan desconocidos. El residuo RSS menos heap es una cota mezclada de WASM y memoria nativa, nunca una medición de WASM.

No se ejecutaron lint ni test globales. La revisión previa reportó ocho errores globales fuera de T-5 y un timeout aislado de RenderEngine que pasó al repetirlo; quedan separados de esta campaña. No hubo commit ni push. T-5 queda pendiente de revisión del planificador y de la validación E2E indicada.
