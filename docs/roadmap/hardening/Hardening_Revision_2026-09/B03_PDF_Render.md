<!-- CONTEXT: scope=revision-B03 | dependencias=roadmap/hardening/Hardening_Revision_2026-09/Mapa.md,core/PDF_Engine.md,core/Render_Engine.md,adr/ADR-144-El-Input-Se-Registra-Ya-El-Trabajo-Se-Planifica.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B03 — PDF y Render

Revisor GPT-6 Sol, 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`, HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`.

**REJECTED**, limitado a B03. Sin modificaciones de fuente.

## Hallazgos confirmados

**B03-F01 — P2: descriptor cancelado puede despacharse después de cerrar documento.**

`packages/anonymization-core/render-engine/src/preview-scheduler.ts:174` ejecuta runJob; identidad se comprueba recién en :202; clearDocument :245; reserve :267. clearDocument elimina entrada y rechaza promesa, pero el loop esperando cupo conserva entry/runJob y reserve solo comprueba abortSignal. Al liberarse cupo ejecuta trabajo antes de descubrir invalidación.

Repro directo scheduler real, Node/tsx sin escribir: concurrencia 1, trabajo bloqueado y otro pendiente del mismo documento; clearDocument("d"), liberar primero. Salida `['in-flight','cancelled-pending-ran']`. Hace trabajo pesado tras baja; si trabajo activo no libera cupo y señal sigue vigente, waiter permanece vivo. Resultado tardío se descarta; no se demostró publicación de preview cancelado.

Norma: ADR-144 §8 (:114–116), «se vacían los descriptores pendientes» en closeDocument/dispose; Render §13 caso 35. Descriptor que sobrevive al cierre incumple limpieza.

**B03-F02 — P2: fallo al publicar deja promesa de render pendiente.**

`preview-scheduler.ts:221` elimina entrada y await onSettle queda fuera del manejo de errores; resuelve entry.promise después. Si onSettle falla, runDispatchLoop rechaza sin consumidor (void :158) y promesa queda pendiente, fuera del mapa que clear/clearDocument podrían asentar.

Repro scheduler real: runJob exitoso, onSettle arroja Error("publish-failed"), carrera 30 ms: `{"status":"still-pending","rejection":"Error: publish-failed"}`. Ruta productiva settleRenderJob (`render.engine.ts:1274`) y emitPreviewUpdated (:1745) crea URL/publica evento. No se reprodujo mediante API pública del motor. Efecto: rechazo no manejado y promesa potencialmente pendiente indefinida.

Norma: ADR-144 §6 (:95–96), «No queda colgada»; resultado async renderPage en Render §6.

**B03-F03 — P2: prioridad visible no interviene en admisión al scheduler.**

`preview-scheduler.ts:267`: waiters compiten por cupo sin prioridad; se pasa al kernel recién :194. Pool no puede adelantar trabajos que aún esperan admisión del scheduler.

Repro concurrencia1, inicial bloqueado, seed prioridad20, visible70; liberar inicial: `['blocking','seed:20','visible:70']`. La página visible puede esperar detrás de seeds anteriores. No se midió latencia ni reprodujo visor.

Norma ADR-144 §7 (:104–110), visible70/no-visible20 y «El usuario que abre la página 150 durante el seed no espera a las 149 anteriores»; Render §15.10 visible-first.

**B03-F04 — P3: nombres de dos tests conservan ImageData anterior.**

Render tests `contract.test.ts:225` y `unit.test.ts:527` conservan `rasterizePage returns ImageData without emitting events nor touching cache` y `rasterizePage with a region returns only the cropped ImageData`. Render §14 (:432/:434) exige `rasterizePage returns an EncodedPageImage (png) without emitting events nor touching cache` y `rasterizePage with a region returns only the cropped image, encoded`. Las aserciones sí prueban salida codificada; es correspondencia de inventario, no defecto runtime.

## Evidencia y límites

32 archivos asignados: ADR-063/140/141/142/144/156/158/163; PDF/Render specs; PDF producción pdf.engine/pdf.errors/worker-entry y suites contract/edge/snapshot/unit/worker-entry/page-rotation-guard/split-word-merge y fixtures; Render producción scheduler/engine/types/kernel y suites contract/edge/unit/worker-entry/preview-scheduler y fixtures. Contratos/reglas/mapa leídos, auxiliares consultados para cruces.

Verificados por diff y lectura: viewport, palabras partidas, páginas rotadas, DPI fuente, PNG/crop, generaciones/coalescencia/cache, no retención RGBA, bypass export y guards worker. No prohibiciones nuevas encontradas en líneas añadidas. Suite verde no cubre los tres fallos del scheduler.

`pnpm exec vitest run packages/anonymization-core/pdf-engine packages/anonymization-core/render-engine`: **exit0, 16 archivos, 386 tests PASS** (confirmación reporter dot, 8,86 s). Tres probes sobre scheduler real Node/tsx en memoria. Advertencias de pdf.js sobre fuentes estándar en Node.

Cruce B02/B04 resuelto: productor PDF entrega como máximo una región/página (bbox escalar opcional, selección de mayor región); primera región por pageIndex no falla por multiplicidad en pipeline actual. Unión pública orientación sigue en B01.

Sin navegador/campañas/cobertura/validación visual preview-export. No se afirma exhaustividad de todos los casos históricos §13/§14 ni presupuesto real o SLA por mocks. Drift histórico de nombres/ImageData/geometría se remite B12. Gates globales en B11; este veredicto no aprueba la branch.
