<!-- CONTEXT: scope=revision-B07 | dependencias=roadmap/hardening/Hardening_Revision_2026-09/Mapa.md,ui/React_Client.md,core/Orchestrator.md,core/Grouping_Engine.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B07 — UI: adapter, stores e historial

GPT-6 Sol, 2026-09-26, base `bbb015f169b3590767565c9908f4bb879d27c91c` → HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`. **REJECTED**, solo B07; sin archivos modificados ni commits/push.

## Hallazgos confirmados

**B07-F01 — P1: integración nueva con código previo duplica conflicto al deshacer resolución.**

`apps/react-client/src/store/entities.store.ts:161` append sin upsert; `core-adapter/bus-bridge.ts:263` lo usa para CONFLICT_DETECTED al restaurar mismo ID. entities.store:169 spread mantiene heldManual tras resolve.

Repro con Core/Grouping/bus/stores reales en memoria: DNI detectado y Teléfono manual mismo bbox; checkpoint pendiente; resolver winner detected; restore. Core un conflicto pendiente; UI dos mismo ID, primero resolved=true luego false. `.find(id)` elige resuelto, diálogo cierra y preflight ve segundo pendiente, bloqueando Exportar sin poder resolver. Repetir acumula copias.

Norma React_Client §3.6c «Grupos y conflictos llegan solos por los eventos» tras undo/redo; ADR172 §1 eventos diferenciales; Grouping §7 CONFLICT_DETECTED idempotente; ADR175 §1 «Ningún camino deja resolved: true con heldManual». Append/spread previos, nueva restauración/heldManual expone defecto consumidor UI. Core emite evento correcto.

**B07-F02 — P1, preexistente: cancelar reanálisis deja UI Cancelled y Core Ready.**

`core-adapter/bus-bridge.ts:178` convierte todo PIPELINE_CANCELLED a Cancelled, como importación. Repro façade/bus/bridge/stores/cancel reales, PDF/render sustituidos: importar, reanalizar habilitando NER pendiente, cancelar y rechazar operación. Bus detecting→PIPELINE_CANCELLED sin READY posterior. Core ready/UI cancelled; exportButtonVisibility.ts:15 solo Ready/Done, Exportar desaparece.

Norma Orchestrator §13.22 «el stage final es Ready, no Cancelled» y suprime READY derivado GROUPING_FINISHED. Nada corrige bridge después. Handler idéntico base (:154–162); no atribuido como regresión nueva.

## Evidencia y límites

Nueve fuentes y34 archivos tests asignados. Fuentes actions/bus-bridge/history/index y stores entities/history/pipeline/rules/settings. Tests acciones/bridge/historial/conflictos/overrides/import/previews/edición/entidades/settings/preflight examinados; secundarios ManualOverlapDialog/export visibility/atajos/Core restore/cancel. Contratos/specs/reglas leídos.

Checks: campaña/squash aceptados, acciones delegan/checkpoints reales/reglas snapshot rehidratadas; canales ui, campos/eventos ADR170–176 documentados; errores tipados; pruebas presentes sin integraciones F01/F02; no prohibiciones encontradas sobre producción añadida; diff --check limpio. No otro contrato nuevo propio no documentado.

Pregunta doc: React_Client §3.6c record():void, undo/redo():Promise<void> versus store bool/live/busy/discardLast. No fallo funcional independiente.

`pnpm exec vitest run apps/react-client/src/__tests__`: **exit0,67 archivos,734 PASS,3,81 s**. Dos repros independientes node --import tsx exit0 sin archivos. Node no certifica montaje React/DOM/accesibilidad/hooks. Sin builds/apps/campañas/cobertura/gates globales; B11 centraliza.

Cruces B05 previews/evento groupId no duplicados; B08 selector/mode/toast no duplicados. Carrera éxito undo tras clear NO confirmada: guard live evita reconstruir pila. Rechazo tardío tras close/import queda sin repro, no sustenta rechazo. Este informe no aprueba branch.
