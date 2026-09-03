# @anonly/export-engine

Construye el PDF final reconstruido desde cero, adjuntando las imágenes renderizadas (lado anonimizado) como páginas con pdf-lib. Garantiza no-recuperabilidad y metadata mínima.

## Ejecución

Corre en un **Web Worker real** (`ExportWorker`) con un pool de **tamaño 1**: ensamblar el PDF es una operación por documento y no se paraleliza. No es un quinto pool en el sentido de `05_Worker_Architecture.md` §1.1 — `WorkerPoolManager` gestiona solo los cuatro "de verdad" (pdf, ocr, ner, render) y `"export"` es apenas su identificador interno (ADR-047 §2).

Lo que cruza es un **kernel de ensamblado**; la clase `ExportEngine` queda host-side. Sin factory de worker inyectada, el mismo kernel corre in-process con resultado bit-idéntico (ADR-035): así corren los tests.

Spec: [`docs/core/Export_Engine.md`](../../../docs/core/Export_Engine.md) (v1.1.0).

Ver también: [`docs/adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md`](../../../docs/adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md), [`docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md`](../../../docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md), [`docs/adr/ADR-009-Export-Strategy.md`](../../../docs/adr/ADR-009-Export-Strategy.md), [`docs/adr/ADR-004-Rendering.md`](../../../docs/adr/ADR-004-Rendering.md).
