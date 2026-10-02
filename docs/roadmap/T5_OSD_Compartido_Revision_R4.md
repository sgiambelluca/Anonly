# T-5 — Segunda revisión independiente, campaña r4

Fecha: 2026-09-13, hora Argentina. Complementa la revisión anterior; no modifica producto, specs, roadmap ni los resultados crudos.

**Veredicto: REJECTED para cierre funcional; beneficio de memoria no demostrado.** Compartir OSD funciona en el camino exitoso y acelera ligeramente este corpus, pero el pico global de RSS aumenta en promedio. Quedan fallos de recuperación y validaciones de aceptación pendientes.

## Avances verificados

- La campaña r4 respeta A1/B1, B2/A2, A3/B3. Lo contrasté con los timestamps CDP. Los doce imports tienen `ok=true`, `peakWithinPhases=true`; los seis calientes tienen `hotBaselineSettled=true`.
- Recalculé la huella desde las `ocrWords` completas de cada JSON, ordenando páginas por su índice y conservando orden de palabras, texto, source, confidence y bbox/rotation. Las doce huellas coinciden: `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`, 50 páginas y 1038 palabras. Algunos hashes originales se calcularon con otro orden de llegada de páginas; la comparación normalizada sobre los datos crudos sí es igual. Esto acredita equivalencia en P2, no en cualquier documento.
- En cada import AFTER las muestras CDP alcanzan un wrapper OSD, dos wrappers LSTM y tres hijos Tesseract simultáneos. La última muestra de cada import contiene cero de esos targets. No hay evidencia de acumulación de instancias OSD en estas corridas. Dos wrappers OSD distintos al combinar frío y caliente son creación, liberación y recreación, no dos OSD concurrentes.
- El experimento ahora tiene activación opt-in. La carga/decode entran en el deadline y el motor incluye guarda de páginas activas y limpieza ociosa. Estas correcciones son reales, aunque la recuperación tras carga bloqueada sigue incompleta.
- Ejecuté los tests OCR e instrumento/CDP/memory profile: **181 PASS** (155 OCR + 26 instrumento). Typecheck global: PASS.

## Resultados recalculados

Fuentes: `.measure/t5-osd/t5-20260913-351fc4d3-r4/pair-{1,2,3}/{before,after}/pair-*-*.json`. Mismo P2 congelado, Apple M1 con 8 GiB de RAM. MB decimales; medias de tres repeticiones de cada condición, manteniendo temperaturas separadas.

Pico OCR: máximo de la suma simultánea de RSS en las muestras del segmento OCR_STARTED→OCR_FINISHED. Tiempo OCR: diferencia de esos eventos en `phases`, con un único reloj. Tiempo total: `totalMs`, también calculado con un único reloj.

| Métrica | Frío BEFORE → AFTER | Caliente BEFORE → AFTER |
| --- | --- | --- |
| Pico RSS durante OCR | 1661.5 → 1582.2 MB; **-79.2 MB (-4.8%)** | 1731.6 → 1994.5 MB; **+262.8 MB (+15.2%)** |
| Pico RSS global | 1954.4 → 2013.4 MB; **+59.0 MB (+3.0%)** | 1773.1 → 1994.5 MB; **+221.4 MB (+12.5%)** |
| Tiempo OCR | 15.177 → 14.930 s; **-247 ms (-1.6%)** | 15.336 → 14.939 s; **-397 ms (-2.6%)** |
| Tiempo total hasta Ready | 20.293 → 19.997 s; **-296 ms (-1.5%)** | 18.745 → 18.358 s; **-387 ms (-2.1%)** |

Los tres pares mejoran tiempo OCR en ambas temperaturas. Los tres pares aumentan pico global en frío. En caliente, los deltas de pico global son **-9.8, +274.8 y +399.1 MB**; los de pico OCR son **-9.8, +399.2 y +399.1 MB**. Hay variabilidad, pero los datos no respaldan un ahorro global. Tres pares de este corpus no establecen una regresión universal ni permiten cuantificar la memoria propia de OSD.

En el instante del pico OCR caliente de cada run, el promedio de RSS de Tab pasa de 1223.7 a 1475.8 MB, y GPU de 278.2 a 315.6 MB. Son componentes de muestras simultáneas de cada run, no sumas de máximos independientes. El aumento se ve principalmente en Tab; los datos no permiten decidir si procede de rasterización, copias, memoria nativa retenida o política del allocator/GC. Tampoco la desaparición de workers garantiza que el proceso devuelva enseguida todo el RSS al sistema.

## Pendientes encontrados

### P1 — La inicialización obsoleta sigue bloqueando recuperación y disposición

En `ocr-engine/src/worker/orientation-kernel.ts:71`, `invalidate()` incrementa la generación pero no desvincula `initialization`. `ensureWorker()` devuelve esa promesa si existe, aun cuando pertenece a una generación anterior. Si la primera carga no termina, el job siguiente vuelve a esperar la misma carga hasta su timeout, sin crear un worker nuevo. `dispose()` sigue esperando esa inicialización indefinidamente.

Lo reproduje con dos tests independientes: después del primer timeout, un segundo job deja `createWorker` en una llamada en vez de dos; `dispose()` tampoco se asienta hasta que libero manualmente la carga. Fuente y resultados están en `.measure/t5-review-r4/t5-review2-repro.test.ts` y `anonly-t5-review2-repro.log`. Los tests temporales fueron retirados de la suite para no mezclar la revisión con una implementación. El worker tardío debe conservar su limpieza, pero no bloquear la nueva generación ni la disposición. ADR-164 §3.1 exige esa recuperación.

### P2 — El tiempo hasta Ready nuevo mezcla orígenes de reloj

En `tests/perf/support/memoryProfile.ts:809`, `readyDurationMs` resta `importedAtMs`, relativo al inicio del sampler, de `readyAtMs`, relativo al reloj `performance` de la página. No son el mismo origen. Para esta revisión usé el campo existente `totalMs`, que resta ambos eventos en el mismo reloj. La corrección cambia ligeramente los números del informe, no la dirección de las conclusiones. También corregí pequeñas diferencias aritméticas en las medias RSS.

### Aceptación funcional todavía incompleta

Sigue sin ejecutarse el E2E dedicado a giros 0/90/180/270 en píxeles, con página girada al final, censura y exportación reales, ya pedido en ambas delegaciones. Hay igualdad de palabras en P2 y conteos de 11 grupos/13 entidades; no una comparación de entidades normalizadas ni validación de censura de ese corpus girado.

El informe afirma mayor cobertura funcional que la suite demuestra: el test llamado liberación/reanálisis usa puertos simulados y no efectúa reanálisis, y el de aislamiento usa pools distintos que devuelven ángulos prefijados. La nueva prueba serial sí ejercita un OSD local y reconocimiento simulado concurrente; no sustituye todas las pruebas de aislamiento, recuperación y ciclo de vida requeridas. Los 181 tests verdes no acreditan esos casos faltantes.

Los manifests mejoran la trazabilidad, pero todavía no constituyen un manifest completo de fuentes/build/configuración por ejecución: por ejemplo `after-config.txt` solo registra `VITE_E2E` y condición. Las topologías corregidas se guardan aparte; hay que conservar la distinción entre datos medidos y posprocesamiento.

## Decisión recomendada

No adoptar todavía este cambio como optimización de memoria ni aumentar el pool a tres/cuatro LSTM. La hipótesis de compartir un único OSD es técnicamente válida; su ventaja global de memoria con dos reconocedores no aparece en los datos. La mejora de tiempo de aproximadamente 0.25–0.40 s en OCR resulta pequeña frente a aumentos observados de cientos de MB al repetir documentos.

Corregir recuperación/disposición y completar el E2E es necesario para dejar una implementación evaluable, pero no debe confundirse con una promesa de bajar el RSS de los caminos exitosos ya medidos. Si se continúa investigando rendimiento, el siguiente experimento debería aislar el origen de la memoria adicional de Tab y su retención entre imports, con hipótesis y criterio de salida definidos. No justifica repetir campañas generales ni ampliar concurrencia sin ese diagnóstico.

No se hicieron commits, push ni cambios al código de producto durante esta revisión. No se repitieron benchmarks, lint global ni la suite global: la validación nueva fue typecheck, los 181 tests de los scopes afectados y los dos repros; los problemas globales conocidos permanecen separados del veredicto de T5.
