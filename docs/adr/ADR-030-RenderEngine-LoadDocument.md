<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/PDF_Engine.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-004-Rendering.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md | audiencia=humanos+IA | fase=7 -->

# ADR-030 — `RenderEngine.loadDocument`: el motor recibe el PDF fuente por invocación directa y mantiene sus propios `PDFDocumentProxy`

- **Estado**: Accepted
- **Fecha**: 2026-07-12
- **Decidido por**: El humano (opción propuesta por el planificador), sobre ambigüedad reportada por el implementador en el Hito 7
- **Relacionado con**: ADR-004 (rasterización fiel como garantía de no-recuperabilidad), ADR-014 (Orchestrator invoca motores directamente para datos pesados), ADR-020 §8 (PdfEngine destruye su `PDFDocumentProxy` por `process()`), ADR-021 (motores inline hasta Hito 9)

## Contexto

`Render_Engine.md` (§1–§2) exige rasterizar el contenido visual real del PDF con `pdfjs-dist`,
pero ningún documento define cómo el motor obtiene los bytes del PDF para un `documentId`:

- `RenderPageInput` (§6/§9) no trae buffer ni referencia al PDF fuente.
- La interfaz pública (§6) no tiene método de carga; los eventos consumidos (§8) solo llevan ids.
- `Document`/`Page` (03_Data_Model.md) contienen texto extraído y bboxes, no los bytes crudos —
  no alcanzan para `getDocument()`.
- No existe convención de `ctx.cache` documentada para esto (el precedente `ocr-words:*` de
  ADR-014 es de datos transitorios de handoff, no de fuente persistente).

Agravante estructural: hoy **nadie retiene los bytes tras el parseo**. El buffer de la etapa 1 se
transfiere a `PdfPool` (zero-copy, el host lo pierde) y PdfEngine destruye su `PDFDocumentProxy`
al finalizar cada `process()` (ADR-020 §8). Render necesita su propio proxy de todos modos: en
Hito 9 vive en un pool distinto.

Restricción decisiva: el **delta render** (`requestDeltaRender`) se dispara desde
`GROUP_TOGGLED`/`GROUP_REPLACEMENT_CHANGED`, eventos que no llevan (ni podrían llevar) el PDF.
El motor necesita estado por documento pre-cargado — el spec ya asume estado interno persistente
(índice `pageIndex → groupIds`, §12).

## Decisión

### 1. `RenderEngine` gana `loadDocument` y `unloadDocument`

```ts
loadDocument(documentId: string, buffer: ArrayBuffer): Promise<void>;
unloadDocument(documentId: string): Promise<void>;
```

- `loadDocument` invoca `getDocument({ data: buffer })` de pdfjs-dist y guarda el
  `PDFDocumentProxy` en un `Map<string, PDFDocumentProxy>` interno. **Toma posesión del buffer**:
  el caller no debe reutilizarlo (coherente con la semántica de transferencia del Hito 9).
- `loadDocument` sobre un `documentId` ya cargado: destruye el proxy anterior y carga el nuevo
  (re-carga determinística, sin leak).
- `unloadDocument` destruye el proxy y libera la entrada del `Map`; sobre un `documentId`
  desconocido es **no-op idempotente** (simplifica al Orchestrator).
- `dispose()` destruye todos los proxies cargados (mismo patrón que PdfEngine, ADR-020 §8).

Análogo directo a `PdfEngine.process`: el caller directo (Orchestrator en Hito 9; façade/tests en
Hito 7, per ADR-021) entrega los datos pesados por invocación, y los eventos del bus siguen
llevando solo ids y metadata (consistente con ADR-014 y con el payload de `RENDER_REQUESTED`).

### 2. Mapeo de errores (sin tocar la tabla de error codes de Contracts.md)

| Situación | Error |
|---|---|
| `renderPage`/`renderPages` sobre `documentId` no cargado | `InvalidInputError` (`INVALID_INPUT`, bug del caller) |
| `loadDocument` con buffer vacío/null | `InvalidInputError` |
| `getDocument()` falla en `loadDocument` (PDF ilegible para pdfjs) | `RenderFailedError` (`RENDER_FAILED`, no recuperable) — el PDF ya fue validado por PdfEngine en la etapa 1; llegar acá es excepcional |

### 3. Vías por eventos: warning + no-op

`RENDER_REQUESTED` y el delta render (`GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`) no tienen
caller al que lanzarle: si el `documentId` no está cargado, el motor loguea `warn` y no hace nada.
Mismo tratamiento que el Orchestrator da a `groupId` inexistente (06_Pipeline.md §11).

### 4. El host retiene el origen de los bytes (Hito 9)

Como el buffer de la etapa 1 se transfiere a `PdfPool`, el Orchestrator debe retener el origen
(el `File` importado o una copia) para alimentar `RenderEngine.loadDocument` cuando arranque la
etapa de preview. Se anota en `06_Pipeline.md` §4 (etapa 1) y §10/§12 (etapas 8 y 10). En Hito 7
(inline) el buffer se trata como `ArrayBuffer` plano, mismo patrón que PdfEngine en Hito 2
(ADR-013/ADR-021).

### 5. Fe de erratas en `05_Worker_Architecture.md` §7.4

- Decía que RenderWorker usa "OffscreenCanvas + **pdf-lib**": pdf-lib es del ExportWorker y está
  **prohibido** en Render (`Render_Engine.md` §5). Se corrige a `pdfjs-dist`.
- Se agrega al ciclo de vida el mensaje `RUN(load-document)` (`{ documentId, buffer }`, buffer
  transferido una vez por worker) — detalle de Hito 9, sin cambio de interfaz pública
  (precedente ADR-021).

### 6. Versionado

`Render_Engine.md` pasa a **1.1.0** (agrega métodos, no rompe los existentes). `RenderPageInput`,
`RenderPageOutput` y los eventos no cambian.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Campo `buffer` en `RenderPageInput` | Se transferiría (y perdería) en el primer render, o clonaría MBs por cada request de scroll/preview. Obliga a la UI a retener y reenviar los bytes (rompe capas). No resuelve el delta render, que no tiene input. |
| Convención `ctx.cache` (`pdf-buffer:<documentId>`) | `ICache` es un LRU con límite por items y bytes (Contracts.md §3.4): si desaloja el buffer a mitad de sesión, el render falla de forma no determinista. El precedente `ocr-words:*` es handoff transitorio, no storage de fuente única. Contrato implícito por string en lugar de firma explícita. |
| Reconstruir la página desde `Word[]` + bbox (sin PDF real) | Degradación semántica grave: ADR-004 basa la no-recuperabilidad del export en una rasterización fiel de la página real (imágenes, layout, gráficos). Reconstruir texto plano no es render fiel — problema de seguridad, no de implementación. |
| Reutilizar el `PDFDocumentProxy` de PdfEngine | No existe: se destruye al finalizar cada `process()` (ADR-020 §8) y compartirlo acoplaría motores (P-1). En Hito 9 viven en pools distintos. |

## Consecuencias

**Positivas**: el motor puede rasterizar el PDF real cumpliendo ADR-004; el mecanismo calca el
patrón ya probado de PdfEngine (invocación directa con datos pesados, eventos livianos); el
delta render funciona sin tocar ningún payload de evento; queda explícito quién es dueño de los
bytes en cada etapa del pipeline.

**Negativas**: dos métodos más de superficie pública que testear; el Orchestrator (Hito 9) carga
la responsabilidad de retener el origen del PDF y de secuenciar `loadDocument` antes del primer
`RENDER_REQUESTED`; memoria: un `PDFDocumentProxy` vivo por documento cargado (mitigado por
`unloadDocument` y el LRU interno de pdfjs).

## Referencias

- `core/Render_Engine.md` §2, §6, §9, §11, §13–§15 — `core/PDF_Engine.md` §12
- `architecture/05_Worker_Architecture.md` §7.4 — `architecture/06_Pipeline.md` §4, §10, §12
- `adr/ADR-004-Rendering.md` — `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` —
  `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` — `adr/ADR-021-Engines-Inline-Hasta-Hito9.md`
