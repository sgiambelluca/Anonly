<!-- CONTEXT: scope=revision-B01 | dependencias=roadmap/hardening/Hardening_Revision_2026-09/Mapa.md,core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque, no veredicto integrado) -->

# B01 — Contratos compartidos y eventos

Revisor: GPT-6 Sol. Fecha: 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`; HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`.

**Veredicto: REJECTED**, limitado a B01. El revisor no modificó archivos.

## Hallazgo confirmado

**B01-F01 — P2: WorkerJob no admite el payload del nuevo trabajo ocr-orient.**

`packages/anonymization-core/shared/src/types.ts:447`: `WorkerJob.payload` usa `WorkerJobPayload`, cuya unión excluye `OcrOrientationPayload`. `WorkerJobType` incorpora `ocr-orient` y el paquete exporta su payload. Un consumidor que construya un `WorkerJob` de orientación con un payload válido recibe un error de tipos. El checker TypeScript confirmó asignabilidad `false`.

Norma: R-15; `03_Data_Model.md` §18 define `WorkerJob` con `type: WorkerJobType` y `payload: WorkerJobPayload`; `Contracts.md:966` §7.2 dice «ocr-orient recibe PNG clonado y devuelve OcrOrientationResult»; ADR-164 §2.1–2.2 declara el trabajo y payload.

Límite: no se encontró una falla runtime derivada de esto. `WorkerPool.DispatchParams.payload` y `OcrDispatchParams.payload` usan `unknown`; el transporte actual no consume esa unión. Afecta la API pública exportada.

## Contradicción para el planificador

**B01-A01 — P2: réplica documental de OcrPagePayload desactualizada.**

`docs/architecture/03_Data_Model.md:591` §18 declara `image`, `dpi` y `languages` sin `orientation`, aunque promete «forma exacta de shared/src/types.ts». `Contracts.md:936` §7.1 y el código declaran `readonly orientation: OcrOrientation`. ADR-164 §2.2 dice «OcrPagePayload gana readonly orientation: OcrOrientation requerido».

Pregunta: ¿se confirma que la réplica de §18 quedó pendiente de sincronización con ADR-164? El código sigue Contracts y ADR-164; no se decidió una semántica alternativa.

## Observaciones no bloqueantes

- `04_Event_System.md:90` §6 describe `CONFLICT_RESOLVED.mode`; Contracts y `events.ts` usan `entityType` conforme a ADR-083. La discrepancia ya existía en la base.
- `shared/src/__tests__/contract.test.ts:916`, «EventPayloadMap tiene entrada para GROUP_REMOVE_REQUESTED», invoca un handler `GroupRemoveRequested` sin indexar el map. Ese test no detectaría borrar la entrada; la entrada existe actualmente.
- Commits B01 con scopes contradicen R-17/Code Standards §11. Observación histórica; no se exige preservar ni reescribir historia ante el squash aceptado.

## Evidencia, alcance y límites

Se examinaron los doce archivos del inventario B01: Contracts, Data Model, Event System, test de contrato de event-system, test de contrato y constants/enums/events/index/interfaces/types de shared, e index de test-utils. Se compararon diffs y secciones pertinentes del estado final. Lecturas: contratos y estándares completos; ADR-124, 140, 143, 158, 163, 164, 167 y 170–176; puntos de integración de OCR, worker-pool, createCore, configuración y emisores UI.

Se verificaron enums, exports, payloads/configs, previews, eliminación, checkpoints, heldManual/winner, orientación, DPI, presupuesto OCR y temporizador NER. Nuevos datos revisados conservan readonly; no se encontraron nuevas dependencias ni P-1–P-9 en líneas añadidas examinadas. GROUP_REMOVE_REQUESTED existe en enum/payload/map/tabla; UI emite en canal UI. Réplicas de test-utils cubren ocr-orient y defaults nuevos. No se detectó comportamiento ajeno en cambios B01 de commits de contrato examinados.

`pnpm exec vitest run packages/anonymization-core/shared packages/anonymization-core/event-system`: **exit 0, 6 archivos, 197/197 tests**. Checker de TypeScript ejecutado en memoria, sin crear archivos.

Gates globales/cobertura quedan en B11. No se ejecutaron builds ni campañas. Cruces pendientes: B04 orientación/transporte real; B02/B05/B07 previews/checkpoints/resultados manuales; B11 aceptación integrada.
