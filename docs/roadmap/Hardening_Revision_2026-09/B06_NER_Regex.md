<!-- CONTEXT: scope=revision-B06 | dependencias=roadmap/Hardening_Revision_2026-09/Mapa.md,core/NER_Engine.md,core/Regex_Engine.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B06 — NER y Regex

Revisor GPT-6 Sol, 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`; HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4` estable. **REJECTED**, limitado B06. Sin modificaciones de fuente.

## Hallazgos confirmados

**B06-F01 — P2: fallback in-process pierde estado de modelo listo tras notificación del pool.**

`ner-engine/src/ner.engine.ts:566`; cruces `src/create-core.ts:154`, `src/worker-pool.ts:612`, `ner-engine/src/worker/kernel.ts:636` (rutas bajo packages/anonymization-core).

Trigger: createCore sin runtime.workers.ner, inferencia, vencer nerIdleDisposeMs y segunda página con misma config. createCore inyecta WorkerPool real sin factory; notifica baja aun sin workers remotos. Listener pone modelWarm=false pero no dispone kernel local; classifier sigue cargado y ensureModelLoaded retorna sin model-ready. isModelReady permanece false y NER_STARTED anuncia carga aunque reutiliza modelo. No se demostró pérdida de entidades.

Norma: R-2/R-15; NER §6 «Ambos válidos en modo pool y en fallback», casos28–30 y ADR-167 §3–§4. Flag debe reflejar modelo real.

Control en memoria ESM node/tsx, NerEngine/WorkerPool reales con doble de inferencia que reproduce cache/early-return: primera ready=true loads1; release=true cached=true ready=false; segunda ready=false loads1 READY total1. Exit0. Retención del classifier real verificada por inspección; no cargó ONNX. Afecta fallback en cualquier plataforma; no se extrapola a transporte remoto normal.

**B06-F02 — P2: prueba contractual nueva del escáner email incompleta.**

`regex-engine/src/__tests__/unit.test.ts:433`; Regex §14 (`Regex_Engine.md:358`), ADR-181 prueba obligatoria, R-13/Code Standards §10. Falta `default email scanner keeps events, normalization and bbox` en contract.test.ts con orden y overlaps. `scanner output reaches the same occurrence and event mapping` solo un email aislado; tests previos no cubren combinación específica de especialización nueva. Nombres de diferencial/custom también difieren del spec, aunque comportamientos principales sí cubiertos. Rechazo por cobertura contractual, no mera preferencia de naming.

## Evidencia y límites

14 archivos B06: ADR023/135/166/167/181, specs NER/Regex, NER fixture helper/unit/engine, Regex edge/unit/scanner/engine. Contracts/reglas completos y costuras createCore/pool/kernel/contrato consultados. Revisados commits funcionales/campaña; no rechazo por squash/diff acumulado.

Por lectura: firmas/canales host correctos, baja remota DISPOSE/terminate/remoción, listener reabre dedup; timer15s pertenece B02. Sin regresión nueva identificada cancel/errores/dispose. Scanner especializa por identidad default, custom email mantiene ruta, comparte normalización/checksum/guards/overlaps/mapeo posterior. Sin prohibiciones/dependencias/tipos públicos nuevos; EmailMatchSpan interno.

- `pnpm exec vitest run packages/anonymization-core/ner-engine packages/anonymization-core/regex-engine`: **exit0, 11 archivos, 307 PASS**.
- Diferencial independiente ESM Node/tsx sin archivos: **50.000 textos, 50.381 matches, cero diferencias** de spans/valores contra regex original.
- Exploración @ tardía,20 repeticiones,2/10/20/40/80/160KiB:0,013/0,066/0,128/0,264/0,364/0,676ms. Compatible lineal; no benchmark integrado/SLA.
- Intento inicial tsx -e falló CJS; control ESM posterior válido.

Preexistente: Regex §13 mantiene divergencia diacríticos NER que ADR-118/spec NER ya cerraron; B12 consolida.

Sin gates globales/cobertura/builds/campañas/R1-R2/ONNX/Electron real. B11 centraliza gates, B10/B12 empaquetado/evidencia. Informe no declara branch mergeable.
