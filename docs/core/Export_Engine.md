<!-- CONTEXT: scope=export-engine | dependencias=core/Contracts.md,architecture/06_Pipeline.md,ADR-004-Rendering.md,ADR-009-Export-Strategy.md,ADR-012-Replacement-Modes.md,ADR-032-Export-EncodedPageImage-Requested-Warning.md,ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=IA-implementador | fase=3 (§12 corregido en fase 10: ExportWorker único, no RenderPool — ADR-036 §1) -->

# Export Engine — Spec de Motor

> Construye el PDF final reconstruido desde cero, adjuntando las imágenes renderizadas (lado anonimizado) como páginas con pdf-lib. Garantiza no-recuperabilidad y metadata mínima.

**EngineId**: `export`
**Versión del spec**: 1.1.0
**Última actualización**: 2026-07-16

> **Nota (ADR-032, 2026-07-16)**: `RenderPageProvider.renderFull` devuelve `EncodedPageImage` (bytes codificados; pdf-lib no embebe `ImageData`); `EXPORT_REQUESTED` lo escucha el **Orchestrator**, que llama `export()` directamente (Export no se suscribe a eventos; patrón ADR-014); `EXPORT_NO_ENABLED_GROUPS` es `logger.warn` + continuar, la confirmación del usuario es pre-export. `ExportOptions`/`ExportMetadata` quedan formalizados en `03_Data_Model.md` §19.
>
> **Nota (ADR-034 §3, 2026-07-16)**: `EncodedPageImage` se **promueve a `@anonly/shared`** (apareció el segundo consumidor que ADR-032 anticipó: Render lo produce vía `RenderPageOutput.encoded`). La definición canónica pasa a `Contracts.md` §7 (forma intacta); la de §6 de este spec queda como réplica documental y `export-engine` re-importa el tipo desde shared — cambio de código en el PR del Hito 9 (patrón ADR-029 §4).

> **Nota (ADR-027, 2026-07-11)**: el tipo de config canónico es `ExportConfig` (Contracts.md §6); el alias `ExportEngineConfig` de §6/§15.2 queda eliminado (mismo patrón que ADR-021 §2, ADR-023 §1 y ADR-026).

> **Nota (ADR-021, 2026-07-09)**: este motor se implementa **inline** en su hito, sin crear su pool propio; `WorkerPoolManager` y los pools llegan con el Orchestrator (Hito 9), sin cambio de interfaz pública (precedentes ADR-013/ADR-020). Leer §12 y los ítems de workers/pool del §15 como Hito 9; cancelación cooperativa con checkpoints inline, el SLA < 200 ms se valida en Hito 9/11. Los tests unit/contract/edge mockean la frontera de la librería externa (Code_Standards §10, ADR-021 §5).

---

## 1. Objetivo

Ejecutar el flujo de export al ser invocado por el Orchestrator (que escucha `EXPORT_REQUESTED` y arma el `ExportEngineInput`; ADR-032 §2): coordinar el render full de las páginas anonimizadas, ensamblar un `PDFDocument` nuevo con pdf-lib y devolver un `ArrayBuffer` (transferido) que el host expone como `blobUrl` para descarga.

---

## 2. Responsabilidades

- Ejecutar `export(input)` cuando el Orchestrator lo invoca (el Orchestrator escucha `EXPORT_REQUESTED`; ADR-032 §2).
- Validar que haya al menos un grupo `enabled`; si no, loguear warning (`ctx.logger.warn` con code `EXPORT_NO_ENABLED_GROUPS` en metadata) y continuar (ADR-032 §3).
- Coordinar con `RenderEngine` el render full (`mode = "full"`, `kind = "anonymized"`) de cada página con los `Replacement[]` resueltos.
- Construir un `PDFDocument` vacío con pdf-lib.
- Adjuntar cada imagen renderizada como página (con dimensiones correctas según DPI).
- Generar metadata mínima (`ExportMetadata`) sin copiar nada del original.
- Serializar el `PDFDocument` a `ArrayBuffer` y transferirlo al host.
- Emitir `EXPORT_STARTED`, `EXPORT_PROGRESS`, `EXPORT_FINISHED`, `EXPORT_FAILED`.
- Garantizar no-recuperabilidad (sin capas de texto, sin bookmarks, sin JS, sin forms, sin XMP del original).

---

## 3. Fuera de alcance

- Renderizar imágenes (es tarea de `render-engine`; Export las consume).
- Detectar entidades.
- Agrupar ocurrencias.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Conservar texto seleccionable (out of scope MVP; ver `roadmap/Version_2.0.md`).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `pdf-lib` (ADR-001, ADR-009)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `EntityGroup`, `Replacement`, `ExportOptions`, `ExportMetadata`, `ExportConfig`, `Rule`
- `architecture/04_Event_System.md`: `EXPORT_STARTED`, `EXPORT_PROGRESS`, `EXPORT_FINISHED`, `EXPORT_FAILED` (solo emisión; Export no consume eventos — ADR-032 §2)
- Sintetizadores: `shared/synthesizer.ts` para valores sintéticos deterministas por seed.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor (Export consume `RenderEngine` por evento/injection, no por import directo)
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`
- Node builtins (`fs`, `http`), libs de network

> Nota: Export no importa `render-engine` directamente. Recibe las imágenes renderizadas vía un contrato con el Orchestrator (que sí conoce ambos). Ver §6.

---

## 6. Interfaces públicas

```ts
// ExportConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-027).
export interface ExportConfig {
  readonly defaultDpi: number;              // default 150
  readonly defaultImageFormat: "png" | "jpeg"; // default "jpeg"
  readonly defaultJpegQuality: number;      // default 0.85
}

export interface ExportEngineInput {
  readonly documentId: string;
  readonly document: Document;              // para dimensiones de página
  readonly groups: ReadonlyArray<EntityGroup>; // grupos enabled se incluyen
  readonly rules: ReadonlyArray<Rule>;
  readonly options: ExportOptions;
  readonly renderPageProvider: RenderPageProvider; // abstraction over RenderEngine
}

export interface EncodedPageImage {
  readonly bytes: ArrayBuffer;     // imagen codificada (PNG o JPEG), lista para embedPng/embedJpg
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RenderPageProvider {
  renderFull(pageIndex: number, replacements: ReadonlyArray<Replacement>, abortSignal: AbortSignal): Promise<EncodedPageImage>;
}

export interface ExportEngineOutput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;    // PDF final, transferido
  readonly sizeBytes: number;
  readonly durationMs: number;
}

export class ExportEngine implements IEngine {
  readonly id = EngineId.Export;
  init(ctx: EngineContext): Promise<void>;
  export(input: ExportEngineInput, ctx: EngineContext): Promise<ExportEngineOutput>;
  dispose(): Promise<void>;
}
```

> El `RenderPageProvider` es inyectado por el Orchestrator (que conoce ambos engines). Esto evita la dependencia directa `export-engine → render-engine`, manteniendo el principio A-6 (sin dependencias entre motores).

> `renderFull` devuelve bytes **codificados** (ADR-032 §1): pdf-lib solo embebe PNG/JPEG (`embedPng`/`embedJpg`), y codificar `ImageData` requiere canvas — dominio de Render/host, no del ensamblador (coherente con `ExportPagePayload.pageImage: ArrayBuffer` y 05 §7.4/§7.5). El Orchestrator construye el provider **preconfigurado con las `ExportOptions`** del request (dpi/formato/calidad); Export solo pasa `pageIndex`/`replacements`/`abortSignal`. Las dimensiones de página en puntos PDF salen de `document.pages[i].width/height`.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `EXPORT_STARTED` | al iniciar el export | `ExportStarted` | async | sí |
| `EXPORT_PROGRESS` | por página ensamblada | `ExportProgress` | async | sí |
| `EXPORT_FINISHED` | al serializar y transferir el PDF final | `ExportFinished` con `blobUrl` | async | sí |
| `EXPORT_FAILED` | al fallar el export | `ExportFailed` | async | sí |

Canal: `EventChannel.Export`.

> `EXPORT_FINISHED.blobUrl` (ADR-032 §4): en Hito 8 (inline) el motor lo crea él mismo con `URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }))` — blob real, a diferencia del placeholder de Render (ADR-031 §5). En Hito 9 lo arma el host a partir del `ArrayBuffer` transferido (un worker no tiene `createObjectURL` garantizado); la revocación del URL es responsabilidad del host (mismo criterio que el pendiente de Render en MVP.md §4).

---

## 8. Eventos que consume

**Ninguno** (ADR-032 §2). `EXPORT_REQUESTED` lo escucha el **Orchestrator**, que arma `ExportEngineInput` y llama `ExportEngine.export()` directamente — mismo patrón que `DOCUMENT_IMPORTED`/ADR-014. En Hito 8 (inline) el caller directo son los tests/el façade (precedente ADR-030 §1).

Tampoco escucha `RENDER_FINISHED`: las imágenes llegan vía `renderPageProvider` (síncrono desde el punto de vista del flujo de export).

---

## 9. Entradas

```ts
ExportEngineInput {
  documentId: string;
  document: Document;
  groups: ReadonlyArray<EntityGroup>;  // solo los enabled se procesan
  rules: ReadonlyArray<Rule>;
  options: ExportOptions;
  renderPageProvider: RenderPageProvider;
}

ExportOptions {
  imageFormat: "png" | "jpeg";
  jpegQuality: number;        // 0..1
  dpi: number;                // 150 default, 300 alta calidad
  includeOriginalMetadata: false;  // SIEMPRE false por tipo
  title?: string;
  filename: string;
}
```

**Restricciones**:
- `document.pageCount > 0`. Si `pageCount = 0`, lanza `InvalidInputError`.
- `options.dpi > 0` y `≤ 600` (limit superior razonable).
- `options.jpegQuality ∈ [0.5, 1]` si `imageFormat = "jpeg"`.
- `options.includeOriginalMetadata` debe ser literalmente `false` (garantía de tipo).
- `renderPageProvider` debe estar poblado.

---

## 10. Salidas

```ts
ExportEngineOutput {
  documentId: string;
  buffer: ArrayBuffer;        // PDF final, transferido
  sizeBytes: number;
  durationMs: number;
}
```

Garantías del PDF final:
- Sin capas de texto del original.
- Sin bookmarks, links, JavaScript, forms del original.
- Sin XMP ni metadata sensible del original.
- Metadata propia: `producer = "Anonly"`, `creator = "Anonly"`, `creationDate = now`, `title` opcional.
- Cada página es una imagen a `options.dpi` con `options.imageFormat`.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `EXPORT_FAILED` | `ExportFailedError` | error fatal durante ensamblado o serialización | sí | reintentar 1 vez; si persiste, `EXPORT_FAILED` |
| `EXPORT_NO_ENABLED_GROUPS` | `ExportNoEnabledGroupsError` | ningún grupo `enabled`. `export()` **no la lanza**: loguea warn con el code en metadata y continúa (ADR-032 §3). La clase es el tipo de la validación **pre-export** del Orchestrator (Hito 9), donde el usuario confirma | no | warning al usuario en el flujo pre-export; si confirma, export = original reconstruido |
| `EXPORT_TIMEOUT` | `ExportTimeoutError` | timeout (default 30 s por página) | sí | reintentar 1 vez |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `export` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `export` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined o `options` inválidas | no | bug del caller |

`retryable`: `EXPORT_FAILED = true`, `EXPORT_TIMEOUT = true`. Resto `false`.

---

## 12. Consideraciones de rendimiento

- El ensamblado corre en el **ExportWorker único** de este motor (jobs `export-page`; sin pool propio — la redacción previa "corre en `RenderPool`" era errata, ADR-036 §1). `export()` sigue en host: dirige el loop, emite `EXPORT_*` (ADR-013 §6); solo la frontera pdf-lib cruza al worker. El render full por página sí corre en `RenderPool` (vía `RenderPageProvider`, prioridad 1000).
- Costo: 200–800 ms por página (render full + ensamblado pdf-lib). Serialización final: 500–2000 ms.
- Memoria: 60–200 MB por worker (pdf-lib `PDFDocument` crece con cada página adjuntada).
- `ArrayBuffer` final se transfiere zero-copy al host.
- Streaming: las imágenes se ensamblan página por página; `EXPORT_PROGRESS` se emite por página.
- Cancelación: entre páginas. SLA < 200 ms. El `PDFDocument` parcial se descarta.
- Tamaño del PDF: escala con `dpi²` y `jpegQuality`. Para A4 150 DPI JPEG q 0.85: ~100–300 KB por página.
- Reintentos: si una página falla al renderizar, el `renderPageProvider` reintenta (es su contrato); Export reintenta el ensamblado solo si pdf-lib falla (raro).
- Paralelismo: el render full de las páginas se despacha en paralelo al `RenderPool`; el ensamblado en pdf-lib se hace en un solo worker (pdf-lib no es thread-safe para el mismo `PDFDocument`).

---

## 13. Casos límite

1. **Documento con 0 páginas**: lanza `InvalidInputError`.
2. **Todos los grupos `enabled = false`**: `export()` loguea warn (code `EXPORT_NO_ENABLED_GROUPS`) y continúa; el export es idéntico al original (reconstruido, sin reemplazos). La confirmación del usuario es pre-export, en el Orchestrator/UI (Hito 9/10; ADR-032 §3).
3. **Solo grupos Regex habilitados**: export normal, solo patrones determinísticos reemplazados.
4. **Solo grupos NER habilitados**: export normal, solo personas/organizaciones/direcciones reemplazadas.
5. **DPI 300 (alta calidad)**: páginas más grandes, archivo final ~4x más grande. Más lento.
6. **Formato PNG**: sin pérdida, archivo más grande. Útil para documentos con texto fino.
7. **Formato JPEG q 1.0**: máxima calidad JPEG, aún con pérdida sutil en bordes de texto.
8. **PDF original con bookmarks**: el export no los replica. Sin error.
9. **PDF original con JavaScript**: el export no lo replica. Sin error.
10. **PDF original con forms (AcroForm)**: el export no los replica. Sin error.
11. **PDF original con XMP sensible**: el export no lo replica. Test `metadata-strip` valida.
12. **PDF original con texto seleccionable**: el export no tiene texto seleccionable (es "scanned-like"). Trade-off aceptado por ADR-004.
13. **Cancelación a mitad de ensamblado**: aborta en < 200 ms, `PDFDocument` parcial descartado, no se emite `EXPORT_FINISHED`.
14. **Doble export simultáneo**: el segundo `EXPORT_REQUESTED` se encola (no se superpone). El Orchestrator serializa.
15. **`export` tras `dispose`**: lanza `EngineDisposedError`.
16. **Título muy largo o caracteres especiales**: pdf-lib los maneja; se sanitiza para evitar PDF injection.
17. **1000 páginas**: memoria del `PDFDocument` puede llegar a 500 MB. Mitigado: ensamblar en chunks y usar `pdf-lib` con `save({ useObjectStreams: true })` para compresión.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits EXPORT_STARTED at beginning` | `contract.test.ts` | contract | invariante |
| `emits EXPORT_PROGRESS per page` | `contract.test.ts` | contract | invariante |
| `emits EXPORT_FINISHED with non-empty buffer` | `contract.test.ts` | contract | invariante |
| `output buffer is a valid PDF (%PDF- header)` | `contract.test.ts` | contract | invariante |
| `no original text recoverable in export` | `security.test.ts` (en `tests/security/`, donde corre `pnpm test:security`; ADR-032 §4) | security | no-recuperabilidad |
| `export metadata has producer = Anonly` | `contract.test.ts` | contract | invariante |
| `export metadata has no author/creator/title from original` | `security.test.ts` | security | metadata strip |
| `export has no bookmarks` | `unit.test.ts` | unit | caso 8 |
| `export has no JavaScript` | `unit.test.ts` | unit | caso 9 |
| `export has no AcroForm` | `unit.test.ts` | unit | caso 10 |
| `export has no XMP from original` | `security.test.ts` | security | caso 11 |
| `export has no text layer` | `security.test.ts` | security | caso 12 |
| `0 enabled groups logs EXPORT_NO_ENABLED_GROUPS warning and continues` | `edge.test.ts` | edge | caso 2 (ADR-032 §3) |
| `DPI 300 produces larger file than DPI 150` | `unit.test.ts` | unit | caso 5 |
| `PNG produces larger file than JPEG q 0.85` | `unit.test.ts` | unit | caso 6 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 13 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 15 |
| `throws InvalidInputError on 0 pages` | `edge.test.ts` | edge | caso 1 |
| `1000 pages completes within memory budget` | `stress.test.ts` (en `src/__tests__/` hasta que exista `tests/stress/`; mismo criterio que ADR-031 §5) | stress | caso 17 |
| `filename sanitized for PDF injection` | `edge.test.ts` | edge | caso 16 |

Fixtures: `tests/fixtures/text-10p.pdf`, `text-50p.pdf`, `huge-1000p.pdf`.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/export-engine/`.
- [ ] 2. Definir `types.ts` con `ExportEngineInput`, `ExportEngineOutput`, `RenderPageProvider`, `EncodedPageImage` (ADR-032 §1; `ExportConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-027).
- [ ] 3. Definir `errors.ts` con `ExportFailedError`, `ExportNoEnabledGroupsError`, `ExportTimeoutError`.
- [ ] 4. Implementar `export.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (sin suscripciones a eventos — ADR-032 §2; el worker de ensamblado es Hito 9/ADR-021).
- [ ] 6. Implementar `export` con `AbortSignal`, `EXPORT_STARTED`, render full por página vía `renderPageProvider` (`EncodedPageImage`; ADR-032 §1), `EXPORT_PROGRESS` por página, ensamblado pdf-lib (`embedJpg`/`embedPng` de `bytes`), `EXPORT_FINISHED` con `ArrayBuffer` transferido.
- [ ] 7. Implementar generación de metadata mínima (`ExportMetadata`).
- [ ] 8. Implementar sanitización de `title`/`filename` para PDF injection.
- [ ] 9. Implementar `dispose` (libera `PDFDocument` y worker de ensamblado).
- [ ] 10. Validar que ningún campo del original se copia al `PDFDocument` nuevo (sin `copyPages` de pdf-lib desde el original; solo `embedJpg`/`embedPng` de las imágenes renderizadas).
- [ ] 11. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 12. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 13. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 14. Escribir `security.test.ts` con `no-recuperability` y `metadata-strip`.
- [ ] 15. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 16. Verificar `index.ts` exporta solo `ExportEngine`, tipos, errores.
- [ ] 17. Verificar imports sin dependencias prohibidas (`grep -r 'react\|pdfjs\|tesseract\|onnx\|transformers' src/`).
- [ ] 18. Verificar `no-network-from-core`.
- [ ] 19. Verificar test de cancelación < 200 ms.
- [ ] 20. Validar gate `no-recuperability` en CI.

---

## Flujo de export (diagrama)

```text
EXPORT_REQUESTED (UI) → lo escucha el Orchestrator, que arma el input (ADR-032 §2)
        │
        ▼
ExportEngine.export(input)
        │
        ├─ validar input (pageCount > 0, options válidas)
        ├─ emit EXPORT_STARTED
        ├─ si no hay grupos enabled: logger.warn (EXPORT_NO_ENABLED_GROUPS), continuar (ADR-032 §3)
        │
        for each pageIndex:
        │   ├─ replacements = resolver replacements de grupos enabled para esta página
        │   ├─ pageImage = await renderPageProvider.renderFull(pageIndex, replacements, abortSignal)  // EncodedPageImage
        │   ├─ pdfPage = pdfDoc.addPage([width, height])  // puntos PDF, de document.pages[pageIndex]
        │   ├─ pdfPage.drawImage(embedJpg/embedPng(pageImage.bytes))
        │   ├─ emit EXPORT_PROGRESS(current, total)
        │   └─ si abortSignal.aborted: discard pdfDoc, return CANCELLED
        │
        ├─ pdfDoc.setProducer("Anonly")
        ├─ pdfDoc.setCreator("Anonly")
        ├─ pdfDoc.setCreationDate(now)
        ├─ si options.title: pdfDoc.setTitle(sanitized)
        │
        ├─ buffer = await pdfDoc.save({ useObjectStreams: true })
        ├─ emit EXPORT_FINISHED(documentId, buffer, sizeBytes, durationMs)
        └─ return { buffer (transferido), sizeBytes, durationMs }
```

---

## Sintetizadores (referencia)

Los sintetizadores para `mode = "synthetic"` viven en `shared/synthesizer.ts` y son consumidos por Grouping (para `replacementValue`) y por Export/Render (consistencia visual). Ver `adr/ADR-012-Replacement-Modes.md` para la tabla de formatos por tipo.

El sintetizador es determinista por `(seed, type, indexInType)`:

```ts
export function synthesize(
  type: EntityType,
  indexInType: number,
  seed: string
): string;
```

Mismo `(seed, type, index)` → mismo valor sintético. Seed default: aleatorio por sesión, configurable por documento.

---

## Referencias

- `architecture/06_Pipeline.md` §13 (etapa 11)
- `architecture/05_Worker_Architecture.md` §7.5 (ExportWorker)
- `architecture/08_Security_Model.md` §4, §5
- `adr/ADR-004-Rendering.md` (reconstrucción)
- `adr/ADR-009-Export-Strategy.md` (estrategia completa)
- `adr/ADR-012-Replacement-Modes.md` (modos y formatos)
- `adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md` (provider codificado, invocación directa, warning)
- `core/Contracts.md` §6 (ExportConfig)
- `architecture/03_Data_Model.md` §19 (ExportOptions, ExportMetadata)
