<!-- CONTEXT: scope=diagramas | dependencias=01_Technical_Architecture_Document.md,03_Data_Model.md,04_Event_System.md | audiencia=humanos+IA | fase=1 -->

# Anonly — Diagramas del Sistema

> Apéndice visual del TAD (bloque 3 ampliado). Todos los diagramas están en Mermaid o ASCII para que sean consumibles por IA y versionables como texto. Sin imágenes binarias.

---

## 1. Diagrama de capas

```mermaid
flowchart TB
  subgraph Host["Main thread (apps/react-client)"]
    UI["React UI\n(Tailwind + Radix + Zustand)"]
    Store["Zustand store\n(slices por dominio)"]
    Orchestrator["Pipeline Orchestrator"]
    EventBusHost["Event Bus (host)"]
  end

  subgraph Core["packages/anonymization-core"]
    Shared["shared\n(tipos, contratos, errors)"]
    PDF["pdf-engine"]
    OCR["ocr-engine"]
    Regex["regex-engine"]
    NER["ner-engine"]
    Grouping["grouping-engine"]
    Render["render-engine"]
    Export["export-engine"]
    EventBusCore["event-system"]
  end

  subgraph Workers["Web Workers (pools por tipo)"]
    WPDF["pdf worker pool"]
    WOCR["ocr worker pool"]
    WNER["ner worker pool"]
    WRender["render worker pool"]
  end

  UI <--> Store
  Store <--> EventBusHost
  Orchestrator --> EventBusHost
  EventBusHost <--> EventBusCore
  Core --> Workers
```

ASCII equivalente:

```
┌──────────────────────────────────────────────────────────┐
│ apps/react-client (main thread)                          │
│   UI ─► Zustand store ─► Event Bus ─► Orchestrator       │
└──────────────────────────┬───────────────────────────────┘
                           │ eventos tipados
┌──────────────────────────┴───────────────────────────────┐
│ packages/anonymization-core                              │
│   shared · event-system · pdf · ocr · regex · ner ·      │
│   grouping · render · export                             │
└──────────────────────────┬───────────────────────────────┘
                           │ postMessage + Transferable
┌──────────────────────────┴───────────────────────────────┐
│ Web Workers (pool por tipo de engine)                    │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Diagrama de pipeline

```mermaid
flowchart LR
  A[PDF ArrayBuffer] --> B[PDF Engine]
  B --> C[OCR Engine\n(solo páginas sin texto)]
  C --> D[Normalización\n(dentro de shared)]
  D --> E[Regex Engine]
  E --> F[NER Engine]
  F --> G[Grouping Engine]
  G --> H[Conflictos\n(dentro de grouping)]
  H --> I[Vista previa\n(Render Engine parcial)]
  I --> J[Edición de grupos/reglas\n(UI)]
  J --> K[Render Engine\n(completo)]
  K --> L[Export Engine]
  L --> M[PDF nuevo]
```

Cada etapa: entra, sale, eventos emitidos y errores en `06_Pipeline.md`.

---

## 3. Diagrama de paquetes y dependencias permitidas

```mermaid
flowchart TB
  subgraph Apps
    RC["apps/react-client"]
  end

  subgraph Core["packages/anonymization-core"]
    Shared["shared"]
    ES["event-system"]
    PDF["pdf-engine"]
    OCR["ocr-engine"]
    Regex["regex-engine"]
    NER["ner-engine"]
    Group["grouping-engine"]
    Render["render-engine"]
    Export["export-engine"]
  end

  RC --> Shared
  RC --> ES

  PDF --> Shared
  OCR --> Shared
  Regex --> Shared
  NER --> Shared
  Group --> Shared
  Render --> Shared
  Export --> Shared

  ES --> Shared
```

**Invariante**: ningún motor apunta a otro motor. Sin flechas `PDF --> Group`, `NER --> Group`, etc. La comunicación es por eventos, no por imports. Validado por regla de ESLint `no-restricted-imports` en `ai/Code_Standards.md`.

---

## 4. Diagrama de eventos (maestro)

Mapa alto nivel. Tabla exhaustiva en `04_Event_System.md`.

```mermaid
flowchart LR
  PDF["PDF Engine"] -->|DOCUMENT_IMPORTED, PAGE_PARSED, DOCUMENT_PARSED| Bus((Event Bus))
  OCR -->|OCR_STARTED, OCR_PAGE_FINISHED, OCR_FINISHED| Bus
  Regex -->|ENTITY_FOUND| Bus
  NER -->|ENTITY_FOUND| Bus
  Bus -->|ENTITY_FOUND| Group["Grouping Engine"]
  Group -->|ENTITY_GROUP_CREATED, ENTITY_GROUP_UPDATED, ENTITY_GROUP_REMOVED, GROUP_REPLACEMENT_CHANGED, GROUP_TOGGLED| Bus
  Bus -->|ENTITY_GROUP_*| UI
  UI -->|GROUP_UPDATE_REQUESTED, RULE_UPDATED, EXPORT_REQUESTED, CANCEL_REQUESTED| Bus
  Bus -->|RENDER_REQUESTED| Render
  Render -->|PREVIEW_UPDATED, RENDER_FINISHED| Bus
  Bus -->|EXPORT_REQUESTED| Export
  Export -->|EXPORT_STARTED, EXPORT_PROGRESS, EXPORT_FINISHED, EXPORT_FAILED| Bus
```

Convención: `ENTITY_FOUND` es **interno** entre detectores y grouping. La UI se suscribe a `ENTITY_GROUP_*`, nunca a `ENTITY_FOUND`.

---

## 5. Diagrama de Workers y pools

```mermaid
flowchart TB
  Host["Host (Orchestrator)"]
  PoolMgr["WorkerPoolManager"]

  Host --> PoolMgr

  PoolMgr --> PP["PdfPool\n(size = min(max(nCPU-1,1),4))"]
  PoolMgr --> OP["OcrPool\n(size = 1-2)"]
  PoolMgr --> NP["NerPool\n(size = 1-2)"]
  PoolMgr --> RP["RenderPool\n(size = min(max(nCPU-1,1),4))"]

  PP --> W1["pdf worker #1..N"]
  OP --> W2["ocr worker #1..M"]
  NP --> W3["ner worker #1..M"]
  RP --> W4["render worker #1..N"]
```

Mensajes, timeouts, cancelación, reintentos, colas y prioridades en `05_Worker_Architecture.md`.

---

## 6. Diagrama de modelo de datos

```mermaid
classDiagram
  class Document {
    +id: string
    +name: string
    +pages: ReadonlyArray~Page~
    +metadata: DocumentMetadata
  }
  class Page {
    +index: number
    +width: number
    +height: number
    +words: ReadonlyArray~Word~
    +text: string
    +requiresOCR: boolean
  }
  class Word {
    +text: string
    +bbox: BoundingBox
    +pageIndex: number
    +confidence: number
  }
  class BoundingBox {
    +x: number
    +y: number
    +width: number
    +height: number
  }
  class Occurrence {
    +id: string
    +value: string
    +bbox: BoundingBox
    +pageIndex: number
    +source: DetectionSource
    +confidence: number
    +entityType: EntityType
  }
  class EntityGroup {
    +id: string
    +type: EntityType
    +canonicalValue: string
    +members: ReadonlyArray~OccurrenceRef~
    +replacementMode: ReplacementMode
    +replacementValue: string
    +indexInType: number
    +enabled: boolean
  }
  class Replacement {
    +groupId: string
    +occurrenceId: string
    +originalValue: string
    +replacementValue: string
    +mode: ReplacementMode
  }
  class Rule {
    +id: string
    +scope: RuleScope
    +target: RuleTarget
    +mode: ReplacementMode
    +priority: number
  }
  class Annotation {
    +id: string
    +groupId: string
    +pageIndex: number
    +bbox: BoundingBox
    +kind: AnnotationKind
  }
  class Conflict {
    +id: string
    +groupId: string
    +reason: ConflictReason
    +candidates: ReadonlyArray~ConflictCandidate~
  }

  Document "1" --> "*" Page
  Page "1" --> "*" Word
  Word --> BoundingBox
  Occurrence --> BoundingBox
  EntityGroup "1" --> "*" OccurrenceRef
  OccurrenceRef ..> Occurrence
  Replacement --> Occurrence
  Replacement --> EntityGroup
  Rule --> RuleTarget
  Annotation --> EntityGroup
  Conflict --> EntityGroup
```

Definición de cada tipo, atributo e invariante en `03_Data_Model.md`.

---

## 7. Diagrama de estado del pipeline

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Importing: DOCUMENT_IMPORTED
  Importing --> Extracting: PDF Engine start
  Extracting --> OCRing: si hay páginas sin texto
  Extracting --> Detecting: si no hay páginas sin texto
  OCRing --> Detecting
  Detecting --> Grouping
  Grouping --> Ready
  Ready --> Rendering: usuario pide preview/export
  Rendering --> Exporting
  Exporting --> Done
  Done --> [*]
  Importing --> Failed: error fatal
  Extracting --> Failed
  OCRing --> Failed
  Detecting --> Failed
  Grouping --> Failed
  Rendering --> Failed
  Exporting --> Failed
  Failed --> [*]
  Ready --> Ready: edición de grupos/reglas
  * --> Cancelled: CANCEL_REQUESTED
  Cancelled --> Idle
```

---

## 8. Diagrama de cancelación

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI
  participant Orch as Orchestrator
  participant Pool as WorkerPool
  participant W as Worker

  U->>UI: click "Cancelar"
  UI->>Orch: CANCEL_REQUESTED(jobId)
  Orch->>Orch: abortController.abort(jobId)
  Orch->>Pool: postMessage({type:"CANCEL", signalId})
  Pool->>W: postMessage({type:"CANCEL", signalId})
  W->>W: checkpoint seguro + limpieza
  W-->>Pool: {type:"CANCELLED", signalId}
  Pool-->>Orch: WORKER_CANCELLED
  Orch-->>UI: PIPELINE_CANCELLED
  UI->>U: estado = Cancelled
```

Requisito: el cese de CPU del worker debe ocurrir en < 200 ms desde el input del usuario (ver `07_Performance_Strategy.md`).

---

## 9. Diagrama de despliegue

```mermaid
flowchart TB
  subgraph Browser["Navegador del usuario"]
    App["apps/react-client\n(Vite build estático)"]
    Core["anonymization-core\n(bundle dinámico)"]
    Workers["Web Workers"]
    Models["Modelos ONNX\n(lazy, cache HTTP)"]
    Wasm["pdf.js + tesseract wasm\n(lazy)"]
  end

  CDN["CDN estático\n(solo HTML/JS/WASM/modelos)"]

  CDN -.->|load| App
  CDN -.->|lazy| Core
  CDN -.->|lazy| Wasm
  CDN -.->|lazy| Models
  App --> Core
  Core --> Workers
  Workers --> Wasm
  Workers --> Models
```

**Sin backend de procesamiento.** El CDN solo sirve assets estáticos. No hay endpoint que reciba documentos. (Ver `adr/ADR-002-No-Backend.md` y `08_Security_Model.md`.)

---

## 10. Convenciones de los diagramas

- Mermaid para grafos y secuencias; ASCII para layouts muy tabulares.
- Nombres de nodos en español o inglés según el concepto (capas en inglés, eventos en UPPER_SNAKE).
- Cada diagrama declara su fuente de verdad en la primera línea.
- No duplicar lógica: si un diagrama contradice un apéndice, el apéndice gana y el diagrama se corrige.
