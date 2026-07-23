<!-- CONTEXT: scope=modelo-de-datos | dependencias=01_Technical_Architecture_Document.md,core/Contracts.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=IA+humanos | fase=1 (§18 actualizado en fase 10: OcrPagePayload.imageData→ImageData y payloads de transporte LoadDocument/RasterizePage/ExportSave, ADR-036 §4) -->

# Anonly — Modelo de Datos (TAD bloque 5)

> Define **todos** los tipos de datos del sistema, sus atributos, invariantes y relaciones. Las implementaciones TypeScript exactas viven en `core/Contracts.md`; este documento es la fuente de verdad **semántica**. Si hay discrepancia entre el código y este documento, este documento gana hasta que se actualice explícitamente vía PR de documentación.

**Principio rector**: todo dato del Core es **inmutable**. Toda colección es `ReadonlyArray<T>`. Toda propiedad es `readonly`. Las mutaciones se realizan con copia estructural y producen nuevas referencias.

---

## 1. Visión general

El dato más importante del sistema es el **`EntityGroup`**: un grupo de ocurrencias del mismo valor sensible, con un valor canónico, un índice secuencial por tipo, un modo de reemplazo y un valor de reemplazo. **La UI nunca ve ocurrencias crudas**, solo grupos.

```
Document
  └─ Page[]                         (estructura del PDF)
       └─ Word[]                    (texto + posición)
            └─ BoundingBox          (coords)

Occurrence                          (detección cruda, INTERNA)
  ├─ entityType
  ├─ value
  ├─ bbox
  └─ source: regex | ner | ocr

EntityGroup                         (unidad de UI y reemplazo)
  ├─ type
  ├─ canonicalValue
  ├─ members: OccurrenceRef[]       (referencias a Occurrence)
  ├─ indexInType                    (01, 02, 03...)
  ├─ replacementMode                (mask | synthetic | placeholder | redact)
  ├─ replacementValue
  └─ enabled

Replacement                         (resolución final por ocurrencia)
Rule                                (regla por grupo / tipo / global)
Annotation                          (marcado visual sobre la página)
Conflict                            (discrepancia entre detectores)
```

---

## 2. `Document`

Representa el PDF cargado, ya parseado por el PDF Engine y (opcionalmente) completado por OCR.

```ts
export interface Document {
  readonly id: string;                       // UUID v4, generado al importar
  readonly name: string;                     // nombre original del archivo
  readonly pageCount: number;
  readonly pages: ReadonlyArray<Page>;
  readonly metadata: DocumentMetadata;       // solo metadata no sensible
  readonly sourceKind: "text" | "scanned" | "mixed";
  readonly importedAt: number;               // epoch ms
}
```

**Atributos**

| Atributo | Tipo | Significado |
|---|---|---|
| `id` | `string` | UUID v4. Estable durante toda la sesión. |
| `name` | `string` | Solo para UI. No se conserva en el export. |
| `pageCount` | `number` | ≥ 0. Coincide con `pages.length`. |
| `pages` | `ReadonlyArray<Page>` | Páginas en orden. |
| `metadata` | `DocumentMetadata` | Solo metadata **no sensible**. Ver §3. |
| `sourceKind` | `"text" \| "scanned" \| "mixed"` | `mixed` si al menos una página requirió OCR. |
| `importedAt` | `number` | Para UX y métricas. |

**Invariantes**
- `pageCount === pages.length`.
- `pages[i].index === i` para todo `i`.
- `id` es único dentro de la sesión.
- `metadata` no contiene texto del documento, ni autor original, ni XMP sensible (ver `08_Security_Model.md`).

---

## 3. `DocumentMetadata`

```ts
export interface DocumentMetadata {
  readonly title?: string;       // sanitizado, no sensible
  readonly producer?: string;    // software que generó el PDF
  readonly creationTool?: string;
  readonly pdfVersion: string;
  readonly encrypted: boolean;
  readonly hasForms: boolean;
}
```

**Invariantes**
- `author`, `creator` con nombres reales y campos XMP sensibles **no** se exponen. Se descartan en el PDF Engine y jamás llegan al export.
- El export genera metadata propia mínima (ver `core/Export_Engine.md`).

---

## 4. `Page`

```ts
export interface Page {
  readonly index: number;                    // base 0
  readonly width: number;                    // puntos PDF (1/72 inch)
  readonly height: number;
  readonly words: ReadonlyArray<Word>;
  readonly text: string;                     // texto concatenado, para debug y NER
  readonly requiresOCR: boolean;             // true si PDF Engine no extrajo texto
  readonly ocrCompleted: boolean;            // true si OCR ya completó esta página
  readonly dpi?: number;                     // si fue OCR-ada
}
```

**Invariantes**
- `words` está ordenado por `bbox.y` asc, luego `bbox.x` asc (orden de lectura).
- Si `requiresOCR === false`, entonces `words.length > 0` o la página es genuinamente vacía.
- `ocrCompleted === true` implica `requiresOCR === true`.
- `text` es la concatenación de `words.map(w => w.text).join(" ")` con normalización NFC.

---

## 5. `Word`

```ts
export interface Word {
  readonly text: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly confidence: number;               // 0..1; 1.0 si viene de PDF.js con texto nativo
  readonly source: "pdf" | "ocr";
}
```

**Invariantes**
- `confidence ∈ [0,1]`.
- `pageIndex` coincide con la página contenedora.
- `bbox` está en coordenadas de página (puntos PDF, origen esquina superior-izquierda).

---

## 6. `BoundingBox`

```ts
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
```

**Invariantes**
- `width ≥ 0`, `height ≥ 0`.
- Coordenadas en sistema de la página (puntos PDF). Para Canvas se convierte con escala `screenDpi / 72`.

---

## 7. `Occurrence` (INTERNA — no se expone a la UI)

Una detección cruda de un detector (Regex o NER). Solo vive dentro del pipeline hasta llegar al Grouping Engine, que la convierte en `OccurrenceRef` dentro de un `EntityGroup`.

```ts
export interface Occurrence {
  readonly id: string;                       // UUID v4
  readonly value: string;                    // texto detectado, sin normalizar de presentación
  readonly normalizedValue: string;          // para agrupar (sin espacios/puntuación redundantes)
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly entityType: EntityType;
  readonly maskFormat?: string;              // formato de máscara del patrón que matcheó (Regex lo copia de RegexPattern.maskFormat; ausente en NER) — ADR-029
  readonly wordSpan?: WordSpan;              // referencia a palabras del Document, opcional
}

export interface WordSpan {
  readonly startIndex: number;
  readonly endIndexExclusive: number;        // palabras[startIndex, endIndexExclusive)
}
```

**Invariantes**
- `normalizedValue` es lo que usa Grouping para comparar. Regex siempre lo provee; NER lo calcula con la misma normalización.
- `confidence ∈ [0,1]`. Regex = `1.0`. NER = score del modelo. OCR-derived = `min(ocrConf, nerConf)`.
- `entityType` debe estar dentro de los tipos que el `source` puede emitir (ver `core/Regex_Engine.md` y `core/NER_Engine.md`).

---

## 8. `OccurrenceRef`

Referencia liviana a una `Occurrence`, usada dentro de un `EntityGroup`. No duplica el `value` ni la `bbox` si no es necesario.

```ts
export interface OccurrenceRef {
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;                // duplicado a propósito: la UI lo necesita sin resolver
  readonly source: DetectionSource;
}
```

---

## 9. `EntityGroup` (unidad central de UI y reemplazo)

```ts
export interface EntityGroup {
  readonly id: string;                              // UUID v4, estable por sesión
  readonly type: EntityType;
  readonly canonicalValue: string;                  // valor "representativo" para mostrar
  readonly members: ReadonlyArray<OccurrenceRef>;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;                // valor ya resuelto (placeholder/synth/mask/redact)
  readonly indexInType: number;                     // 1-based; se renderiza con padding 2: 01, 02, 03
  readonly enabled: boolean;                        // si false, no se aplica reemplazo
  readonly aliases: ReadonlyArray<string>;          // variantes detectadas que se unifican a canonicalValue
  readonly createdAt: number;
  readonly updatedAt: number;
}
```

**Atributos**

| Atributo | Significado |
|---|---|
| `id` | Estable por sesión. Permite que la UI mantenga estado por grupo tras re-procesamientos. |
| `type` | Uno de `EntityType`. Determina el formato del placeholder y la síntesis. |
| `canonicalValue` | El valor a mostrar en el árbol de entidades. Típicamente el más frecuente de `aliases` o el más completo. |
| `members` | Referencias a las ocurrencias agrupadas. La UI muestra `members.length` como contador. |
| `replacementMode` | `mask \| synthetic \| placeholder \| redact`. |
| `replacementValue` | Valor ya resuelto. Para `placeholder` = `[DNI 01]`. Para `synthetic` = valor generado con seed. Para `mask` = `XX.XXX.XXX`. Para `redact` = cadena vacía (la censura es visual, en el render). |
| `indexInType` | Entero 1-based, secuencial y estable por tipo dentro de la sesión. Se renderiza con padding a 2 dígitos. |
| `enabled` | Si `false`, las ocurrencias del grupo se dejan intactas en el render. |
| `aliases` | Variantes de valor unificadas (ej. `"J. Pérez"` y `"Juan Pérez"` en el mismo grupo). |
| `createdAt`, `updatedAt` | Epoch ms. Para UX y merge de ediciones. |

**Invariantes**
- `members.length ≥ 1`.
- `indexInType` es **único** por `(documentId, type)` durante la sesión.
- `canonicalValue ∈ aliases` (el canónico es siempre una de las variantes observadas, salvo edición manual explícita).
- `replacementValue` es consistente con `replacementMode` (ver §11).
- Si `enabled === false`, `replacementValue` no se aplica pero se conserva el último valor para re-activación.

---

## 10. `EntityType`

```ts
export enum EntityType {
  Person = "PERSON",
  Organization = "ORGANIZATION",
  Address = "ADDRESS",
  DNI = "DNI",
  CUIT = "CUIT",
  Phone = "PHONE",
  Email = "EMAIL",
  IBAN = "IBAN",
  CreditCard = "CREDIT_CARD",
  Date = "DATE",
  License = "LICENSE",        // matrícula profesional
  Plate = "PLATE",            // patente
  Custom = "CUSTOM",
}
```

Cada tipo tiene:
- Un label internacionalizable (default español en `ui/Components.md`).
- Un formato de `mask` (ej. DNI → `XX.XXX.XXX`).
- Un formato de `placeholder` (`[<TYPE> <NN>]`).
- Una función de síntesis determinista por seed (en `core/Export_Engine.md` o `shared`).

---

## 11. `ReplacementMode`

```ts
export enum ReplacementMode {
  Mask = "mask",              // censura conservando formato: "XX.XXX.XXX"
  Synthetic = "synthetic",    // valor aleatorio válido, determinista por seed
  Placeholder = "placeholder",// "[DNI 01]"
  Redact = "redact",          // bloque negro sólido sobre bbox (render)
}
```

**Resolución de `replacementValue` por modo**

| Modo | `replacementValue` | Render visual |
|---|---|---|
| `mask` | cadena con formato tipo-dependiente (`XX.XXX.XXX`) | texto censurado sobre bbox |
| `synthetic` | valor sintético válido que preserva formato (`39.123.456`) | texto sintético sobre bbox |
| `placeholder` | `[<TYPE> <NN>]` (`[DNI 01]`) | texto placeholder sobre bbox |
| `redact` | `""` (cadena vacía) | bloque negro sólido sobre bbox |

Default: `placeholder`. Justificación en `adr/ADR-012-Replacement-Modes.md`.

---

## 12. `Replacement`

```ts
export interface Replacement {
  readonly groupId: string;
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly originalValue: string;
  readonly replacementValue: string;
  readonly mode: ReplacementMode;
}
```

**Invariantes**
- `groupId` referencia un `EntityGroup` existente y `enabled === true`.
- `occurrenceId` referencia una `Occurrence` que pertenece a ese grupo.
- `replacementValue` es idéntico para todas las `Replacement` del mismo `groupId` (porque el reemplazo es a nivel grupo).
- Para `mode === "redact"`, `replacementValue === ""` y el render pinta el bbox de negro.

---

## 13. `Rule`

```ts
export interface Rule {
  readonly id: string;
  readonly scope: RuleScope;
  readonly target: RuleTarget;
  readonly mode: ReplacementMode;
  readonly priority: number;                  // mayor = mayor prioridad
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type RuleScope = "group" | "type" | "global";

export interface RuleTarget {
  readonly kind: RuleScope;
  readonly groupId?: string;                  // si scope === "group"
  readonly entityType?: EntityType;           // si scope === "type"
}
```

**Resolución de modo efectivo por grupo**

Prioridad descendente:
1. Regla con `scope === "group"` y `target.groupId === group.id` (si existe y está habilitada).
2. Regla con `scope === "type"` y `target.entityType === group.type` (si existe y está habilitada, mayor `priority` gana).
3. Regla con `scope === "global"` (mayor `priority` gana).
4. Modo editado manualmente en el grupo (`group.replacementMode`).
5. Default: `placeholder`.

**Invariantes**
- `priority ∈ [0, 1000]`.
- Si `scope === "group"`, `target.groupId` es obligatorio y `target.entityType` debe ser `undefined`.
- Si `scope === "type"`, `target.entityType` es obligatorio y `target.groupId` debe ser `undefined`.
- Si `scope === "global"`, ambos deben ser `undefined`.

---

## 14. `Annotation`

```ts
export interface Annotation {
  readonly id: string;
  readonly groupId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly kind: AnnotationKind;
}

export enum AnnotationKind {
  Highlight = "highlight",       // borde color sobre el bbox del grupo
  Replacement = "replacement",   // muestra el replacementValue
  Redact = "redact",             // bloque negro sólido
  Conflict = "conflict",         // marca de conflicto sobre bbox
}
```

**Invariantes**
- `bbox` coincide con el bbox de alguna `OccurrenceRef` de `members` del `groupId`.
- Una ocurrencia con conflicto tiene `AnnotationKind.Conflict` además de su highlight.

---

## 15. `Conflict`

```ts
export interface Conflict {
  readonly id: string;
  readonly groupId: string;
  readonly reason: ConflictReason;
  readonly candidates: ReadonlyArray<ConflictCandidate>;
  readonly resolved: boolean;
  readonly resolvedMode?: ReplacementMode;
}

export enum ConflictReason {
  Overlap = "overlap",                       // dos entidades comparten bbox
  Disagree = "disagree",                     // Regex y NER asignan tipos distintos al mismo span
  LowConfidence = "low_confidence",          // NER por debajo del umbral
  AmbiguousCanonical = "ambiguous_canonical",// varios aliases con misma frecuencia
}

export interface ConflictCandidate {
  readonly source: DetectionSource;
  readonly entityType: EntityType;
  readonly confidence: number;
  readonly value: string;
}
```

**Invariantes**
- `candidates.length ≥ 2`.
- Si `resolved === true`, `resolvedMode` es obligatorio.
- Un conflicto bloquea el export hasta ser resuelto o ignorado explícitamente.

---

## 16. `DetectionSource`

```ts
export enum DetectionSource {
  Regex = "regex",
  NER = "ner",
  OCR = "ocr",                  // OCR no detecta entidades, pero marca la procedencia
  Manual = "manual",            // edición manual del usuario
}
```

---

## 17. `PipelineState` (estado del orquestador)

```ts
export interface PipelineState {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly progress: number;                  // 0..1
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly errors: ReadonlyArray<PipelineError>;
  readonly cancelRequested: boolean;
}

export interface PipelineError {
  readonly stage: PipelineStage;               // etapa en la que ocurrió el error
  readonly code: string;                       // EngineErrorCode del error subyacente
  readonly message: string;
  readonly documentId: string;
}

export enum PipelineStage {
  Idle = "idle",
  Importing = "importing",
  Extracting = "extracting",
  OCRing = "ocring",
  Detecting = "detecting",
  Grouping = "grouping",
  Ready = "ready",
  Rendering = "rendering",
  Exporting = "exporting",
  Done = "done",
  Failed = "failed",
  Cancelled = "cancelled",
}
```

---

## 18. `WorkerJob` (unidad de trabajo del pool)

```ts
export interface WorkerJob {
  readonly id: string;                        // UUID v4
  readonly type: WorkerJobType;
  readonly payload: WorkerJobPayload;         // serializable, Transferable donde aplique
  readonly priority: number;                  // mayor = más prioritario
  readonly signalId: string;                  // referencia al AbortController del host
  readonly createdAt: number;
  readonly retries: number;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export type WorkerJobType =
  | "pdf-parse"
  | "ocr-page"
  | "ner-page"
  | "render-page"
  | "export-page";
```

Payloads concretos por job (forma exacta de `shared/src/types.ts`; `05_Worker_Architecture.md` §2.1 los tipa `unknown` a nivel de transporte y cada worker los afina a estos — ADR-019; documentados acá por P-10, ADR-034 §7):

```ts
export type WorkerJobPayload =
  | PdfParsePayload
  | OcrPagePayload
  | NerPagePayload
  | RenderPagePayload
  | ExportPagePayload;

export interface PdfParsePayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
  readonly pageRange?: ReadonlyArray<number>;
}

export interface OcrPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  // Errata corregida (ADR-036 §4): era ArrayBuffer, que no transporta
  // width/height y el OcrWorker no puede reconstruir la imagen. Coincide con
  // OcrPageInput del motor. Transferencia: postMessage(msg, [imageData.data.buffer]).
  readonly imageData: ImageData;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

export interface NerPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly modelId: string;
}

export interface RenderPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;
  readonly annotations?: ReadonlyArray<Annotation>;
  readonly scale?: number;
  readonly imageFormat?: "png" | "jpeg";
}

export interface ExportPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly pageImage: ArrayBuffer;
  readonly metadata: ExportMetadata;
}
```

Payloads del transporte real (Hito 10, ADR-036 §4) que **no** agregan `WorkerJobType` nuevos (los `Readonly<Record<WorkerJobType, …>>` de `WorkerPoolConfig` son totales; agregar claves produciría churn mecánico sin valor — lección ADR-035 §4):

```ts
// Mensaje de control broadcast a cada RenderWorker (no es un job encolable;
// buffer CLONADO por worker — 05_Worker_Architecture.md §2.3/§7.4, ADR-030).
export interface LoadDocumentPayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
}

// Control broadcast simétrico a load-document (ADR-043 §4): libera el
// PDFDocumentProxy de ese documento en cada RenderWorker a mitad de sesión
// (DOCUMENT_CLOSED). Idempotente, sin transfer. Los controles viajan como RUN
// con jobType "render-page" directo a cada worker, sin cola; el entry-point
// discrimina por forma en el orden de ADR-043 §4.
export interface UnloadDocumentPayload {
  readonly documentId: string;
}

// Rasterización para OCR (ADR-034 §1). Viaja bajo jobType "render-page",
// prioridad 90/40 (espejo de ocr-page), timeouts/retries de render-page.
export interface RasterizePagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly scale: number;
}

// Job final del ExportWorker bajo jobType "export-page": su COMPLETED devuelve
// el ArrayBuffer del PDF transferido; DISPOSE solo libera (05 §7.5, ADR-036 §4).
export interface ExportSavePayload {
  readonly documentId: string;
}
```

Ver `05_Worker_Architecture.md` para el detalle de cada job.

---

## 19. `ExportOptions` y `ExportMetadata`

Definidos originalmente en `adr/ADR-009-Export-Strategy.md`; se documentan acá formalmente
(ADR-032 §4; P-10 exige que todo tipo publicado esté documentado en Contracts.md o en un doc
canónico). Forma exacta del código (`shared/src/types.ts`):

```ts
export interface ExportOptions {
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;             // 0..1, default 0.85
  readonly dpi: number;                     // default 150; 300 para "alta calidad"
  readonly includeOriginalMetadata: false;  // SIEMPRE false; el tipo lo fuerza (garantía por tipos, ADR-009)
  readonly title?: string;                  // opcional, metadata nueva
  readonly filename: string;                // default "anonimizado.pdf"
}

export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;
}
```

Sin `author`, `subject`, `keywords` ni XMP del original (`08_Security_Model.md` §5).

---

## 20. Referencias

- `core/Contracts.md` — definiciones TypeScript exactas.
- `04_Event_System.md` — eventos que transportan estos tipos.
- `05_Worker_Architecture.md` — `WorkerJob` detallado.
- `06_Pipeline.md` — ciclo de vida de los datos en el pipeline.
- `adr/ADR-008-Immutability.md` — por qué todo es inmutable.
- `adr/ADR-011-Grouping-First.md` — por qué la UI opera sobre grupos.
- `adr/ADR-012-Replacement-Modes.md` — por qué 4 modos.
