<!-- CONTEXT: scope=adr | dependencias=05_Worker_Architecture.md,07_Performance_Strategy.md | audiencia=humanos+IA | fase=2 -->

# ADR-003 — Procesamiento Pesado en Workers (pools por tipo)

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

PDF parsing, OCR (Tesseract) y NER (ONNX) son CPU-intensivos y de alta memoria. Correrlos en el main thread del navegador:
- Congela la UI (jank visible).
- Bloquea el input del usuario, incluyendo el botón de cancelar.
- Hace imposible el SLA de cancelación < 200 ms.

La Web Workers API permite mover trabajo a threads separados, con transferencia zero-copy de `ArrayBuffer` vía `Transferable`.

## Decisión

**Todo procesamiento pesado ocurre en Web Workers**, organizados en **pools separados por tipo de trabajo**:

- `PdfPool` (pdf-parse)
- `OcrPool` (ocr-page)
- `NerPool` (ner-page)
- `RenderPool` (render-page, export-page)

Cada pool tiene su propia cola prioritaria, su tamaño (derivado de `navigator.hardwareConcurrency` y `deviceMemory`), sus timeouts y reintentos.

El main thread solo: orquesta, renderiza UI, mantiene el store y el bus de eventos. Regex y Grouping corren en main thread por ser ligeros (< 5% del total).

Comunicación host↔worker por `postMessage` con `Transferable` para `ArrayBuffer`/`ImageData`. Cancelación vía `signalId` referenciando un `AbortController` del host, propagada a los workers.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Pool único compartido** | Mezcla trabajos de perfí muy distinto (OCR de 60s vs render de 0.5s). Un job lento bloquea los rápidos. Difícil backpressure por tipo. |
| **Sin pools, un worker por job** | Crear/destruir workers es caro (especialmente con modelos cargados). Recargar Tesseract/ONNX por job = OOM. |
| **Service Workers** | Diseñados para offline/push, no para CPU intensiva. Ciclo de vida menos controlable. |
| **WASI / WASM threads compartidos** | Más complejo. PDF.js/Tesseract/ONNX ya exponen worker-based APIs; reinventar sería costoso. |
| **Todo en main thread con `requestIdleCallback`** | Sigue bloqueando la UI entre chunks. No alcanza el SLA de cancelación. |
| **WebAssembly multi-thread (SharedArrayBuffer)** | Requiere COOP/COEP headers, complejidad extra. No todas las libs lo soportan bien. Se puede explorar en v2.0 para NER. |

## Consecuencias

**Positivas**:
- UI nunca se congela.
- SLA de cancelación < 200 ms alcanzable.
- Memoria de modelos cargados se reutiliza entre jobs del mismo worker.
- Backpressure por tipo independiente.

**Negativas**:
- Más complejidad: pool manager, cola prioritaria, abort registry, transferencia zero-copy con tipo `Transferable<T>`.
- Coordinación de eventos host↔worker (traducción al bus).
- Workers con estado (modelo cargado) requieren `INIT`/`DISPOSE` cuidadosos.
- Datos deben serializarse al cruzar boundary (mitigado con `Transferable` para buffers grandes).

**Neutras**:
- Regex y Grouping en main thread hoy; si se vuelven pesados, migran a su propio pool vía ADR nuevo.

## Validación

- Test de cancelación (SLA < 200 ms) en CI para cada motor.
- Test de leak de workers (tras `DOCUMENT_CLOSED` + idle, workers se `DISPOSE`).
- Test de backpressure: `WORKER_POOL_SATURATED` se emite y se pausa ingest.

## Referencias

- `05_Worker_Architecture.md` (documento completo)
- `07_Performance_Strategy.md` §5, §9
- `01_Technical_Architecture_Document.md` §2 A-9
- `04_Event_System.md` §9 (eventos `WORKER_*`)
