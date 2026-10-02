<!-- CONTEXT: scope=mapa-revision-hardening | dependencias=core/Contracts.md,ai/AI_Development_Guide.md,ai/Code_Standards.md,architecture/07_Performance_Strategy.md,adr/ADR-124-La-Unidad-De-Alcance-Es-El-Commit-No-El-PR.md | audiencia=planificador+revisores+humano | fase=11 (QA de campaña; no declara cierre) -->

# Mapa de revisión de hardening — 2026-09

Estado: rondas 1–4 terminadas (B01–B08 REJECTED); ronda 5 en revisión. No hay aceptación integrada.

## Alcance y referencia

Hardening, mediciones y refactor UI integrado. SignPath y documentación nueva trabajada en otra computadora quedan fuera de esta revisión. No se realizan fixes, commits, pushes ni merge. El humano acepta squash; conservar los commits después del merge no es condición de aprobación.

- Base fija: `bbb015f169b3590767565c9908f4bb879d27c91c` (referencia local de origin/main al preparar el mapa).
- HEAD fijo: `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`.
- Branch: `hardening/plan-2026-09`.
- Diff: 528 archivos; 87466 líneas agregadas y 3897 eliminadas.
- Inventario exhaustivo en [Manifest.json](./Manifest.json): cada archivo tiene exactamente un responsable primario. Archivos sin cambios pueden consultarse para evaluar integración. Los artefactos de este mapa son posteriores al HEAD revisado.

## Orden y responsabilidad

Revisores separados, modelo `gpt-6-sol`, máximo dos simultáneos. Se termina cada par antes de lanzar el siguiente.

| Ronda | Bloques |
| --- | --- |
| 1 | B01 contratos + B02 Orchestrator |
| 2 | B03 PDF/Render + B04 OCR |
| 3 | B05 Grouping + B06 NER/Regex |
| 4 | B07 estado UI + B08 componentes UI |
| 5 | B09 instrumentos + B10 bancos |
| 6 | B11 QA/CI/gates + B12 docs/evidencia |

| Bloque | Responsabilidad | Archivos | Agregadas | Eliminadas |
| --- | --- | ---: | ---: | ---: |
| B01 | Contratos compartidos y eventos | 12 | 672 | 24 |
| B02 | Façade, Orchestrator y ciclo de workers | 15 | 2956 | 386 |
| B03 | PDF y Render | 32 | 4053 | 281 |
| B04 | OCR y orientación | 29 | 6291 | 279 |
| B05 | Grouping: edición, conflictos y rendimiento | 22 | 6936 | 152 |
| B06 | NER y Regex | 14 | 1188 | 38 |
| B07 | UI: adapter, stores e historial | 43 | 4378 | 190 |
| B08 | UI: pantallas, componentes e interacción | 94 | 8651 | 2301 |
| B09 | Instrumentos de memoria y atribución | 38 | 12635 | 0 |
| B10 | Bancos y campañas de rendimiento | 100 | 17657 | 0 |
| B11 | QA integrada, gates, seguridad y CI | 67 | 7231 | 219 |
| B12 | Documentación, decisiones y evidencia de cierre | 62 | 14818 | 27 |

## Protocolo de revisión

1. Leer Contracts completo, specs asignados completos, Code Standards y AI Development Guide. Leer ADRs aplicables antes de evaluar código.
2. Revisar el diff entre los SHAs fijos y el estado final de los archivos asignados. Priorizar defectos concretos, pérdida de anonimización, carreras/cancelación, inconsistencias de contrato y tests que den falso verde.
3. Cada hallazgo lleva ID, prioridad P0/P1/P2/P3, archivo/línea real, regla/spec, escenario reproducible y efecto. Separar defectos confirmados, preguntas y observaciones. No rechazar por preferencia personal.
4. Los bloques B01-B10/B12 no ejecutan gates globales ni campañas/builds compartidos. Pueden ejecutar tests scoped sin escritura de fuente. B11 centraliza la pasada global; aprobación de un bloque no equivale a aprobación integrada.
5. Cada revisor devuelve APPROVED/REJECTED limitado a su bloque, lista de archivos examinados, evidencia de tests, límites y cruces que requieren validación. Sin gates globales confirmados, no puede declarar la branch mergeable.
6. Ante un vacío/contradicción de spec, registrar archivo + sección + cita + pregunta, sin inventar la resolución ni arreglar fuente. Continuar la revisión de áreas independientes.
7. Si HEAD o los archivos versionados cambian durante las rondas, registrar delta y revalidar lo afectado. Cambios SignPath que lleguen luego no quedan aprobados por esta pasada.

## Cruces obligatorios

- B01 ↔ todos: tipos/eventos/errores y payloads reales; réplicas de WorkerJobType.
- B02 ↔ B03/B04/B06: presupuesto OCR, ráster codificado, cancelación, OSD y baja/recarga de pools.
- B02/B05 ↔ B07/B08: previewEdit, checkpoints, eliminación, agregado manual retenido y export bloqueado.
- B03/B05 ↔ B11: preview y PDF exportado conservan la misma decisión de anonimización.
- Cruce B02→B03/B04 resuelto por lectura: PDF emite como máximo una región OCR por página; selección de primera región por pageIndex no demuestra falla en el pipeline actual.
- B09 ↔ B10/B12: valores medidos, ventanas, muestras ausentes y conclusiones/descartes.
- B11 ↔ todos: las pruebas seleccionadas ejercitan código real y los gates no se aprueban por no ejecutar casos.

## Gates y aceptación

La tabla canónica es `docs/architecture/07_Performance_Strategy.md` §11.4; este mapa no cambia comandos ni presupuestos. B11 registra comando, resultado/exit, fecha y HEAD para lint, formato, typecheck, tests/cobertura, contrato, snapshot, integración, E2E, performance, leak, stress, cancel, security y audit según activación. Registrar aparte CI remoto no verificado y pruebas no ejecutadas; no convertir antecedentes locales en verificación actual. No correr simultáneamente bancos de rendimiento ni procesos que modifiquen dist/fixtures.

La aceptación final requiere hallazgos bloqueantes resueltos o decisiones humanas explícitas, cruces integrados verificados y gates aplicables con evidencia actual. Esta revisión no declara cerrados Hito 11, release ni SignPath. Un APPROVED de lectura no reemplaza pruebas pendientes.

## Bloques detallados

### B01 — Contratos compartidos y eventos

Tipos públicos, enums, eventos, inmutabilidad, correspondencia docs/shared y consumidores; réplicas de tipos en test-utils.

Lecturas específicas: `docs/core/Contracts.md`, `docs/architecture/03_Data_Model.md`, `docs/architecture/04_Event_System.md`.

Informe: [B01_Contratos.md](./B01_Contratos.md). REJECTED.

### B02 — Façade, Orchestrator y ciclo de workers

Abort listeners, cache LRU, OCR bajo demanda y DPI, preview inicial, OSD, baja y recarga de NER, checkpoints, agregado manual y guard de export.

Lecturas específicas: `docs/core/Orchestrator.md`, `docs/architecture/05_Worker_Architecture.md`, `docs/architecture/06_Pipeline.md`.

Informe: [B02_Orchestrator.md](./B02_Orchestrator.md). REJECTED.

### B03 — PDF y Render

Geometría/viewport, palabras partidas, páginas rotadas, ráster codificado, scheduler/coalescencia/generaciones, cache y errores de workers.

Lecturas específicas: `docs/core/PDF_Engine.md`, `docs/core/Render_Engine.md`.

Informe: [B03_PDF_Render.md](./B03_PDF_Render.md). REJECTED.

### B04 — OCR y orientación

Presupuesto de imágenes vivas, limpieza/cancelación, decodificación, OSD compartido/adelanto, franjas blancas/explicadas, cajas y fronteras de workers.

Lecturas específicas: `docs/core/OCR_Engine.md`.

Informe: [B04_OCR.md](./B04_OCR.md). REJECTED.

### B05 — Grouping: edición, conflictos y rendimiento

Previews exactas, eliminación/supresión, undo/checkpoints, merge/split inválidos, choques manuales, bloqueo de export, distancia acotada e índice exacto.

Lecturas específicas: `docs/core/Grouping_Engine.md`.

Informe: [B05_Grouping.md](./B05_Grouping.md). REJECTED.

### B06 — NER y Regex

Ciclo modelWarm/baja/recarga, liberación del pool, frontera de modelos, escáner lineal de email y no regresión de detección.

Lecturas específicas: `docs/core/NER_Engine.md`, `docs/core/Regex_Engine.md`.

Informe: [B06_NER_Regex.md](./B06_NER_Regex.md). REJECTED.

### B07 — UI: adapter, stores e historial

Eventos y stages, errores, previews de edición, historial async, choques manuales, export preflight, cierre/reanálisis y sincronización de stores. Todos los tests unitarios de UI tienen este responsable; B08 los consulta como evidencia secundaria.

Lecturas específicas: `docs/ui/React_Client.md`, `docs/core/Orchestrator.md`, `docs/core/Grouping_Engine.md`.

Informe: [B07_UI_Estado.md](./B07_UI_Estado.md). REJECTED.

### B08 — UI: pantallas, componentes e interacción

Carga/escaneo/trabajo, diálogos de edición y conflictos, visor/búsqueda/gestos, mensajes, teclado/foco/accesibilidad y estilos. Aplicar skill ui-ux-pro-max al contexto desktop; no inventar requisitos mobile.

Lecturas específicas: `docs/ui/React_Client.md`, `docs/ui/Components.md`, `docs/ui/UX_Guidelines.md`.

Informe: [B08_UI_Componentes.md](./B08_UI_Componentes.md). REJECTED.

### B09 — Instrumentos de memoria y atribución

Ventanas/picos M1/M2, baseline caliente, fases, RSS/heap/GC/WASM/workers, muestras ausentes, sesgo de sonda, cleanup y agregaciones. Distinguir medición de inferencia.

Lecturas específicas: `docs/architecture/07_Performance_Strategy.md`, `docs/roadmap/memoria/Instrumento_De_Memoria_Arreglo_Plan.md`.

Informe: pendiente.

### B10 — Bancos y campañas de rendimiento

Diseños A/B, fingerprints/calidad, warm/cold, fixtures, runners/patches, overrides, NER/OCR, márgenes, documentos pesados/reales y portabilidad. No ejecutar campañas opt-in ni modificar/patchar producción en esta revisión.

Lecturas específicas: `tests/perf/README.md`, `docs/roadmap/rendimiento/Rendimiento_Experimentos_Plan.md`.

Informe: pendiente.

### B11 — QA integrada, gates, seguridad y CI

Gates no vacíos, leak/stress/cancel/security/quality/E2E, fixtures deterministas, configs y CI, dependencias/ADR. Único responsable de ejecutar gates globales una vez y registrar resultados reales.

Lecturas específicas: `docs/architecture/07_Performance_Strategy.md`, `docs/architecture/08_Security_Model.md`, `docs/core/Export_Engine.md`.

Informe: pendiente.

### B12 — Documentación, decisiones y evidencia de cierre

Coherencia entre ADR/spec/roadmap y reportes, descartes vs implementaciones, límites de medición, diferencias de plataformas, pendientes y declaraciones de cierre; auditoría histórica de alcance, sin exigir preservar commits tras squash.

Lecturas específicas: `docs/roadmap/MVP.md`, `docs/roadmap/memoria/Optimizacion_De_Memoria_Plan.md`, `docs/roadmap/rendimiento/Optimizacion_De_Rendimiento.md`.

Informe: pendiente.
