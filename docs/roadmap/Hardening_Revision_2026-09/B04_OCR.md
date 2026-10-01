<!-- CONTEXT: scope=revision-B04 | dependencias=roadmap/Hardening_Revision_2026-09/Mapa.md,core/OCR_Engine.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B04 — OCR y orientación

Revisor GPT-6 Sol, 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`, HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4` estable. **REJECTED**, limitado B04. Sin modificar archivos/builds/campañas/commits.

## Hallazgos confirmados

**B04-F01 — P2: host acepta imagen sin bytes o buffer detached.**

`packages/anonymization-core/ocr-engine/src/ocr.engine.ts:483` valida dimensiones pero omite image.bytes.byteLength. OCR §9 (`OCR_Engine.md:372`) dice «image.bytes.byteLength > 0. Si no, lanza InvalidInputError»; §13 caso4; R-15.

Repro en memoria ESM/tsx: crear ArrayBuffer, transferir con structuredClone(bytes,{transfer:[bytes]}), processPage con dimensiones positivas y pools fake que devuelven sobres válidos sin ejecutar run. Salida `{"byteLength":0,"result":{"words":[],"confidence":0},"event":"OCR_PAGE_FINISHED"}`. Demuestra falta de rechazo host, no Tesseract real. En transporte real el clone/decode puede fallar, pero no conserva INVALID_INPUT antes del despacho exigido.

`edge.test.ts:144` sustituye detached por dimensiones0×0; no cubre bytes nuevos ADR-158 ni fila normativa `throws on a detached image.bytes`.

**B04-F02 — P2: fallo de preparación canvas OSD se convierte en orientación0 y deja bitmap abierto.**

`worker/orientation-kernel.ts:153`, :163 y :228: try de buildImage cubre espera bitmap, no construcción canvas/getContext/drawImage. Si fallan, catch de detect retorna orientación0; si ocurre antes de close, bitmap queda vivo.

ADR-164 §3.1 (:225) exige «liberar ImageBitmap en todos los caminos», (:230) «decodificación imposible: fallo de página». Repro read-only: source actual transpillado con typescript.transpileModule y vm, imports/APIs externas sustituidos por dobles; bitmap resuelve y drawImage lanza. Salida `{"result":{"orientation":0},"closed":0,"detectCalls":0}`. OSD nunca recibió imagen: no es detección no concluyente. Puede pasar página girada sin enderezar y sin fallo observable. No usa canvas/WASM reales.

**B04-F03 — P2: pruebas de aceptación §14 y escenarios §13 incompletos.**

R-13/Code Standards §10/OCR §14. Existen tests verdes, pero faltan estas obligaciones:

| Prueba normativa | Evidencia de cobertura insuficiente |
| --- | --- |
| recreates services in a second OCR session and preserves repeated-region identity (spec:615) | t5-shared-osd.test.ts:515 solo dos processPage con idiomas iguales; falta segunda sesión cambiando idiomas/regiones repetidas (caso38). |
| cancels queued orientation without loading or recognizing (spec:619) | :253 cancela adelanto esperando presupuesto, no request en cola OSD detrás de detect activo. |
| preserves words confidence and geometry for mixed page orientations (spec:626) | snapshot.test.ts:51 y segundo caso son páginas derechas; falta sesión mixta0/90/180/270 (caso33). |
| keeps the image reservation across orientation queue and recognition (spec:628) | t5-shared-osd.test.ts:204 presupuesto durante reconocimiento/retry con orientación inmediata; falta espera en cola OSD. |

Recuperación de init y bitmap tardío sí tienen cobertura distribuida con otros nombres; no se denuncian como ausentes.

## Checks y evidencia

29 archivos B04 examinados: ADR065/143/157/160/161/162/164/165, OCR spec, package.json, index/engine/errors/types, kernel/orientation-entry/orientation-kernel/tesseract-paths, once archivos tests/fixtures/snapshot. Lectura completa casos nuevos OSD/snapshots/regresiones; focalizada en cambios/asserts de suites históricas. Contracts/reglas completos; auxiliares createCore/shared types/worker-entry/worker-pool/test-utils consultados.

Revisados: firmas/payloads readonly, eventos/canal/depósito antes de emitir, outputs por índice, reserva antes de producir/finally/cancel/adelanto, contadores/drain/dispose, kernel OSD por instancia/cola serial/generación/recovery, PNG sin transferList, geometría giros/dilatación/franjas. No nuevas dependencias ni prohibiciones encontradas; casts externos concentrados en fixtures. Diez commits OCR recorridos; no se rechaza campaña por diff acumulado ni squash. Checkboxes históricos requieren reconciliación B12 y no prueban código ausente.

`pnpm exec vitest run packages/anonymization-core/ocr-engine`: **exit0, 9 archivos, 178 PASS, 1,18 s**. Sin cobertura/E2E/SLA/assets/stress/campañas; gates globales B11. Intento inicial tsx -e falló por CJS; probe ESM confirmó F01. Interceptar Tesseract directamente no produjo evidencia válida; source transpillado confirmó F02.

## Cruces y preguntas

- B03: PDF produce máximo una región/página; no defecto de primera región en façade. OCR directo conserva outputs por índice con descriptores repetidos.
- B01: unión WorkerJobPayload excluye orientación; transporte real unknown sí funciona; dueño B01.
- B02: cache OCR persistente y wiring tests createCore ya registrados, sin duplicar.
- ADR-164 §3.1 pide discriminar CANCELLED por code; Contracts §4 declara exención frame CANCELLED y transporte instancia CancelledError local. ¿Debe ADR incorporar la exención? Sospecha runtime descartada.
- orientation-entry.ts:25 arroja Error genérico (Code Standards §7); startWorkerEntry lo convierte a INVALID_INPUT. Observación de estándar, no pérdida final de código demostrada.
- Singleton LSTM fallback y timeout entry reconocimiento no actualizado por INIT: preexistentes, no atribuidos al bloque nuevo.

Este informe no aprueba la branch ni SignPath.
