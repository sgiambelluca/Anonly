<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/Orchestrator.md,core/OCR_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=10 -->

# ADR-041 — `fuseOcrPage` como función pura: PdfEngine sin estado por documento

- **Estado**: Accepted (la decisión pre-PR13 que §5 dejó asignada al planificador — reparto host/worker del estado de `render-engine` — quedó tomada en ADR-043, 2026-07-22. La auditoría de §5 recibió un **matiz** en ADR-046 §9, 2026-07-24: mira estado retenido por documento, no el reparto de eventos/retry a través de la frontera — ver la nota de la tabla)
- **Fecha**: 2026-07-22
- **Decidido por**: El humano, sobre el informe de ambigüedad bloqueante que el implementador levantó al arrancar PR12 (PdfWorker) — se detuvo sin tocar archivos por la regla de `ai/AI_Development_Guide.md` §5. El registro completo del informe está en `roadmap/Hito10_Observaciones_Revision.md`, entrada "PR12".
- **Relacionado con**: ADR-013 (envolver `process()` en worker), ADR-014 (fusión OCR→PDF mediada por el Orchestrator — la mediación se **preserva**, cambia la forma de la invocación), ADR-020 (§6 guard de `requiresOCR` — se preserva en la función pura; **§7 `releaseDocument` superseded** por este ADR), ADR-021 (§7 wiring `DOCUMENT_CLOSED`→`releaseDocument` — superseded en lo que respecta a Pdf), ADR-035 (pools in-process), ADR-036 (§4 `WorkerJobType` sin cambios — este ADR lo **ratifica**), ADR-038 (§8 tabla de PRs: PR12–16; contexto item 5: re-fusión idempotente — se preserva)

## Contexto

PR12 ("Workers reales — PdfWorker", primero de la secuencia PR12–16 de ADR-038 §8) migra `PdfEngine` a un Web Worker real. El motor tiene **dos** entradas públicas: `process()` (el job `pdf-parse` que el worker envuelve, ADR-013 §6) y `fuseOcrPage(documentId, pageIndex, words)`, invocada directamente por el Orchestrator cuando llega `OCR_PAGE_FINISHED` (ADR-014). `fuseOcrPage` resolvía el documento en el **estado interno de la instancia**: un `Map<string, Document>` privado poblado por `process()` (`pdf.engine.ts`).

Con workers reales eso rompe:

1. **Afinidad inexistente**: `worker-pool.ts#assignRemoteSlot()` asigna cualquier slot libre. Con `PdfPool` de tamaño > 1 (default `min(max(nCPU-1,1),4)`, `05_Worker_Architecture.md` §1.1), un `fuseOcrPage` puede caer en un worker cuyo `Map` nunca vio ese `documentId` → `InvalidInputError` "documento no encontrado" por una razón de infraestructura, no de dominio.
2. **Sin transporte previsto**: `WorkerJobType` (`03_Data_Model.md` §18) y `WorkerInbound` (`05_Worker_Architecture.md` §2.1) son unions cerrados; ADR-036 §4 decidió explícitamente no agregar claves. El precedente `load-document` (broadcast de solo lectura a todos los workers del RenderPool, ADR-036 §4) no transfiere: `fuseOcrPage` **muta** estado, y replicar cada mutación en todos los workers costaría tráfico `páginas × workers`.
3. **Carrera latente**: si la fusión viajara por worker (round-trip asíncrono), dos `OCR_PAGE_FINISHED` cercanos leerían ambos el documento pre-fusión y el último write pisaría las palabras del otro (lost update). Hoy no ocurre solo porque la ejecución in-process es síncrona de hecho.
4. **Leak inalcanzable**: aun resolviendo la afinidad, el `Map` retenido dentro del worker exigiría rutear también `releaseDocument` al worker correcto — el mismo problema de nuevo. Sin ruteo, cada worker retendría `Document`s completos para siempre.

La dependencia de estado retenido era **histórica**: con el motor in-process, retener era gratis. El Orchestrator ya retiene su propia copia canónica del `Document` (`orchestrator.ts`: `this.documents`, poblada con `pdfOutput.document` y actualizada con el resultado de cada fusión — verificado).

## Decisión

### 1. `fuseOcrPage` pasa a función pura exportada por `pdf-engine`

```ts
// pdf-engine, exportada desde el índice del paquete (ADR-041).
// Pura y síncrona: sin instancia, sin estado retenido, sin I/O.
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document;
```

- **Se preserva** de la semántica actual: guard de ADR-020 §6 (`requiresOCR !== true` → `InvalidInputError`), `pageIndex` inexistente → `InvalidInputError`, normalización NFC de las `Word[]` entrantes (ADR-020 §2), inmutabilidad (devuelve un `Document` nuevo), re-ejecutabilidad idempotente (reemplaza las `Word[]` completas de la página — ADR-038 contexto item 5, flujo `reanalyze` de `ocr.languages` intacto).
- **Desaparecen**: el lookup por `documentId` (y su `InvalidInputError` "documento no encontrado" — el caller provee el `Document`) y los asserts de `initialized`/`disposed` (no hay instancia). Deja de devolver `Promise`: no hay nada asíncrono adentro.

### 2. `PdfEngine` queda sin estado por documento; `releaseDocument` se elimina

Sin `fuseOcrPage` como lector, el `Map` interno no tiene consumidores: se elimina, y con él `releaseDocument` (ADR-020 §7 superseded — sin retención no hay nada que evictar; ADR-021 §7 deja de aplicar a Pdf). `closeDocument` del Orchestrator deja de invocarlo; `RenderEngine.unloadDocument` y el resto de la liberación no cambian. `dispose()` del motor queda igual (libera pdfjs). El motor pasa a ser **stateless entre llamadas**, lo que lo hace trivialmente seguro dentro de cualquier worker del pool.

### 3. La fusión corre host-side, síncrona, en el Orchestrator

El handler de `OCR_PAGE_FINISHED` lee las `Word[]` de `ctx.cache` (ADR-014, sin cambios), toma su `Document` retenido, invoca la función pura y persiste el resultado como copia canónica. Es una operación barata (mapear palabras y reconstruir el array de páginas): no pasa por `PdfPool` ni por ningún worker. P-1 lo permite sin tocar ESLint: el façade es el único autorizado a importar motores, y el Orchestrator vive en el façade. La ejecución síncrona lee-fusiona-guarda por turno de evento elimina de raíz la carrera del punto 3 del contexto. El bookkeeping `pendingFusions` puede simplificarse o eliminarse — detalle de implementación de PR12, no contrato. El manejo de errores no cambia: fallo de fusión → `logger.warn` + página excluida, el pipeline continúa.

### 4. El transporte no se toca

`WorkerJobType` (5 valores), `WorkerInbound`, `worker-pool.ts` y los tamaños de pool quedan intactos — este ADR ratifica ADR-036 §4. El PdfWorker de PR12 envuelve únicamente `process()` (`pdf-parse`), con el alcance original de la fila 12–16 de ADR-038 §8 (entry-point + host-bridge + subpath `"./worker"` + wiring en la app).

### 5. Auditoría de estado retenido en los demás motores (para no repetir el hallazgo PR a PR)

| Motor (PR) | Estado por documento en la instancia | Veredicto para su migración |
|---|---|---|
| `pdf-engine` (PR12) | `Map<string, Document>` — eliminado por este ADR | Resuelto acá |
| `render-engine` (PR13) | `documents` (`PDFDocumentProxy` — cubierto por el broadcast `load-document`, ADR-036 §4), **más** `cache` LRU, `groupOverrides`, `lastAnonymizedInputs`/`lastOriginalInputs`, `pageGroupIndex`, `pendingRenders` (`render.engine.ts`) | **Bloqueante**: requiere decisión propia de reparto host/worker de ese estado **antes** de arrancar PR13 (ADR nuevo del planificador). No se decide acá. |
| `ocr-engine` (PR14) | Ninguno (verificado; las `Word[]` van a `ctx.cache` en el lado host — ADR-014 §1) | Libre |
| `ner-engine` (PR15) | Ninguno por documento; el modelo lazy es estado global por proceso, correcto por-worker (ADR-038 contexto item 4) | Libre **en cuanto a estado**; el reparto de eventos/retry sí requirió decisión propia → **ADR-046** (ver nota abajo) |
| `export-engine` (PR16) | Ninguno (verificado) | Libre |

> **Alcance de esta auditoría (matiz agregado por ADR-046 §9, 2026-07-24)**: la tabla audita **estado retenido por documento**, que es lo que destapó PR12. No audita el otro eje que terminó bloqueando PR13, PR14 y PR15: **de qué lado de la frontera se emiten los eventos observables y dónde vive el loop de retry**. Un motor puede ser "Libre" acá y aun así necesitar un ADR de reparto host/worker — le pasó a `ocr-engine` (ADR-045) y a `ner-engine` (ADR-046). Para `export-engine` (PR16) ese segundo eje ya está resuelto de antemano por ADR-036 §1 (worker único propiedad del lado host; `ExportEngine.export()` dirige el loop y emite `EXPORT_*` en host).

### 6. Tests de PR12

- Los tests de `fuseOcrPage` (contract/unit de `pdf-engine`) se reescriben contra la función pura: fusión correcta, guard `requiresOCR` (caso 14 del spec), `pageIndex` inexistente (caso 15, nuevo), NFC, inmutabilidad. El test `releaseDocument evicts a single document` se elimina junto con el método.
- `tests/integration/ocr-pdf-fusion.test.ts` se adapta a la invocación pura.
- **Sin fixture E2E nuevo en PR12**: con la fusión fuera de la frontera del worker, un E2E multi-slot no puede ejercitar el modo de falla que motivó este ADR. El fixture de PDF escaneado real queda para PR14 (OcrWorker), donde el OCR sí cruza al worker.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| Nuevo `WorkerJobType` (`"pdf-fuse-ocr"`) + payload dedicado | Contradice ADR-036 §4 (union cerrado; churn mecánico de fixtures en `WorkerPoolConfig.timeouts`/`maxRetries`, que son `Record<WorkerJobType, …>` totales); asimetría sin valor semántico; no elimina la carrera del contexto punto 3. |
| Afinidad `documentId` → slot (sticky routing) en `WorkerPool` | Reabre infraestructura genérica ya cerrada (PR11) por la necesidad de un solo motor; tampoco resuelve el leak de `releaseDocument` ni la carrera. |
| Forzar `pdfPoolSize = 1` con `workerFactory` real | Parche no documentado que degrada el paralelismo del parseo; no elimina la dependencia de estado, solo la esconde. |
| Broadcast de la fusión a todos los workers (patrón `load-document`) | `load-document` es carga de solo lectura idéntica; replicar una **mutación** cuesta tráfico `páginas × workers` y multiplica el estado retenido (y el leak). |

## Consecuencias

**Positivas**: el problema de afinidad desaparece en vez de administrarse; el motor queda worker-safe sin mecanismo adicional; se eliminan la carrera lost-update, el leak por `Document`s retenidos en workers y la **duplicación** de la copia canónica (vivía en el engine y en el Orchestrator a la vez — ahora hay una sola, la del Orchestrator); PR12 recupera su alcance original sin tocar transporte; la auditoría de §5 convierte el hallazgo en un checklist por motor en vez de una sorpresa por PR.

**Negativas**: cambio de firma pública de `PDF_Engine.md` §6 (la función deja de ser método y `releaseDocument` desaparece) — callers y tests se adaptan en PR12; los docs que citaban `PdfEngine.fuseOcrPage`/`releaseDocument` requieren la pasada de actualización listada abajo.

**Neutras**: la mediación de ADR-014 (el PDF Engine no se suscribe al bus; el Orchestrator escucha `OCR_PAGE_FINISHED` y lee `ctx.cache`) queda intacta — solo cambia la forma de la invocación final.

## Docs actualizados por este ADR

- `core/PDF_Engine.md` v1.3.0: §6 (función pura, clase sin `fuseOcrPage`/`releaseDocument`), §8, §11, §13 (caso 14 ajustado, caso 15 nuevo), §14 (filas de fusión; fila de `releaseDocument` reemplazada), §15 (item 20 nuevo), referencias.
- `core/Orchestrator.md` v1.4.0: nota de cabecera, §2 (mediación y liberación), §8 (filas `OCR_*` y `DOCUMENT_CLOSED`), §14 (fila de mediación, pares de integración), §15 (item 10).
- `core/OCR_Engine.md` v1.1.1: §2 y §10 (menciones de la invocación).
- `architecture/04_Event_System.md`: filas `OCR_PAGE_FINISHED` y `DOCUMENT_CLOSED`.
- `adr/ADR-020` y `adr/ADR-021`: nota de supersede parcial en su línea de Estado.
- `roadmap/MVP.md` (Hito 10) y `roadmap/Hito10_Observaciones_Revision.md` (entrada "PR12", registro del informe).

## Validación

- Contract/unit de `pdf-engine`: los de §6 de este ADR (la suite existente de fusión, reescrita contra la función pura).
- Contract del Orchestrator: `OCR_PAGE_FINISHED triggers fuseOcrPage with cached words` (ahora función pura host-side) sigue verde; matriz emisor→receptor de `04_Event_System.md` §11 sin cambios.
- Integración: `tests/integration/ocr-pdf-fusion.test.ts` adaptado.
- Gates completos (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`) verdes al cierre de PR12.

## Referencias

- `core/PDF_Engine.md` §6, §8 — `core/Orchestrator.md` §2, §8 — `architecture/03_Data_Model.md` §18 — `architecture/05_Worker_Architecture.md` §1.1, §2.1
- `adr/ADR-014` — `adr/ADR-020` §2, §6, §7 — `adr/ADR-036` §4, §8 — `adr/ADR-038` contexto item 5, §5.3, §8
- `packages/anonymization-core/pdf-engine/src/pdf.engine.ts` (estado previo) — `packages/anonymization-core/src/orchestrator.ts` (`documents`, handler de `OCR_PAGE_FINISHED`) — `packages/anonymization-core/src/worker-pool.ts` (`assignRemoteSlot`) — `packages/anonymization-core/render-engine/src/render.engine.ts` (auditoría §5)
