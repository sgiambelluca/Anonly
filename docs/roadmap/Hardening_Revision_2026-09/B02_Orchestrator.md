<!-- CONTEXT: scope=revision-B02 | dependencias=roadmap/Hardening_Revision_2026-09/Mapa.md,core/Orchestrator.md,adr/ADR-145-El-Deposito-No-Expulsa-Lo-Que-Acaba-De-Guardar.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B02 — Façade, Orchestrator y ciclo de workers

Revisor: GPT-6 Sol. Fecha: 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`; HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`.

**Veredicto: REJECTED**, limitado a B02. Sin modificaciones de fuente ni builds/campañas.

## Hallazgos confirmados

**B02-F01 — P2: depósitos de palabras OCR sobreviven al cierre y a dispose.**

`packages/anonymization-core/src/orchestrator.ts:956` y `:1004`: closeDocument/dispose no borran entradas de cache; tampoco se encontró limpieza en OcrEngine. ADR-145 §5 (`docs/adr/ADR-145-El-Deposito-No-Expulsa-Lo-Que-Acaba-De-Guardar.md:115`) exige «La entrada de una página se borra en el cierre del documento, con el resto del estado retenido». R-15 y Orchestrator §15.10 exigen liberación total de caches.

Trigger: depositar ocr-words:documentId:0, cerrar documento y disponer Core manteniendo referencia al façade. Probe real en memoria: la entrada y sus 100 bytes siguen alcanzables tras ambas operaciones. La LRU acota acumulación futura, pero no limpia al cierre. No se afirma fuga de red ni se ejecutó Tesseract.

```bash
TSX_TSCONFIG_PATH=./tests/tsconfig.json node --import tsx --input-type=module -e '
import { createCore } from "./packages/anonymization-core/src/create-core.ts";
const core = await createCore({
  ner: { enabled: false },
  workerPool: { idleDisposeMs: 0, nerIdleDisposeMs: 0 }
});
const orch = core.orchestrator;
orch.state.create("cleanup-repro");
orch.cache.set("ocr-words:cleanup-repro:0", [{ text: "synthetic fixture" }], 100);
await orch.closeDocument("cleanup-repro");
console.log("afterClose", orch.cache.get("ocr-words:cleanup-repro:0"), orch.cache.bytes);
await core.dispose();
console.log("afterDispose", orch.cache.get("ocr-words:cleanup-repro:0"), orch.cache.bytes);
'
```

Exit 0: ambas lecturas devuelven `[{ text: 'synthetic fixture' }]` y `100`. Acceso diagnóstico a campos internos para aislar la limpieza; no es un test de reconocimiento real.

**B02-F02 — P2: faltan pruebas normativas de composición OSD del façade.**

`docs/core/Orchestrator.md:338` §14 y §15.28; `05_Worker_Architecture.md` §7.6; R-13. El spec exige que «tests de createCore deben afirmar que la factory ocr-orientation recibe RUN de ocr-orient», dos páginas con ángulos, dispose de ambos pools, dos Core aislados y exclusión del manager.

No aparece ocr-orient/ocr-orientation/OSD en las tres suites del façade. `t5-shared-osd.test.ts` no invoca createCore/WorkerPoolManager. Los 189 tests verdes no detectarían puerto/factory incorrecto o un pool OSD vivo tras dispose. Es ausencia de pruebas obligatorias; no se atribuye defecto runtime sin repro. La conexión actual del pool se ve correcta por lectura.

## Ambigüedades y observaciones

- **B02-F03 — P3:** Orchestrator §6 (`:189`) publica createCore con Partial<EngineConfig>; Contracts §3.5 y `create-core.ts:78` usan EngineConfigOverrides, autorizado por ADR-039. ¿Se sincroniza la firma literal?
- **B02-F04 — P3:** Orchestrator §6 (`:197`) admite Ready/Failed y promete rechazo al terminar Failed; §13.21 acepta Done (ADR-040), como `orchestrator.ts:419`; el catch `:478` registra fallo y resuelve. ¿Cuál es la promesa pública ante fallo fatal y cómo se sincroniza §6? No se rechaza la admisión de Done.
- Nombres de pruebas normativas faltantes: `renderLegend is not invoked when includeMarkerLegend is false` (§14:372), `textless pages rasterized via RenderEngine before OCR dispatch` (:400) y `cancel aborts all jobs of documentId within SLA` (:410). Las dos últimas tienen cobertura relacionada con otros nombres (productor/DPI y tests/cancel); no se consideran ausencia funcional confirmada. La fila de rasterización necesita actualización con ADR-143. B11 verifica cancelación real.
- `types.ts:61–68` conserva comentarios de normalizedValue/ADR-175, reemplazado por manualOutcome/ADR-176. Código correcto.
- Checkboxes históricos sin marcar no prueban ausencia de implementación; F02 se sustenta en inspección de suites.

## Evidencia y límites

Quince archivos B02 examinados: dos ADR, arquitectura workers/pipeline, Orchestrator, tres suites y fixtures, cache/config/create-core/orchestrator/types/worker-pool. Lecturas completas de contratos y reglas; ADR-143/145/151/157/163/164/167/170/171/172/174/175/176; auxiliares abort/state y conexiones OCR/NER.

Verificados por lectura y tests: LRU/new-entry, limpieza de listeners de abort en settle/cancel/crash/dispose, productor OCR/DPI coherente, pool OSD size 1/retries 0/factory propia/dispose, timer NER 15 s y notificaciones, preview inicial best-effort, previews/checkpoints/liftRemoval/manualOutcome, guard de export antes de stage. No se encontraron prohibiciones en líneas añadidas (expect.any y literal any-id son falsos positivos).

`pnpm exec vitest run packages/anonymization-core/src/__tests__`: **exit 0, 3 archivos, 189/189 tests** (contract 30, edge 54, unit 105), 3,63 s. Gates globales/cobertura delegados a B11. HEAD estable; único untracked era este directorio QA.

Cruces: B03/B04 verifican si PDF produce múltiples regiones misma página: `handleOcrPageFinished` (`orchestrator.ts:1708`) elige primera por pageIndex, cache también una clave por página. No confirmado sin productor/contrato. B04/B06 verifican cleanup de kernels/modelos; B05/B07/B08 historial/conflictos/UI; B11 integración, SLA y export real. WorkerJobPayload no se consume en transporte façade (payload unknown); hallazgo de API es B01.
