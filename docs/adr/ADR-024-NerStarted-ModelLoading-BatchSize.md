<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/NER_Engine.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md | audiencia=humanos+IA | fase=5 -->

# ADR-024 — NER: `NerStarted.modelLoading?` + semántica de `batchSize` inline

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: Revisión del Hito 5 (contradicción spec/contrato reportada por el revisor, resuelta por el planificador)
- **Relacionado con**: ADR-021 §3 (mismo patrón en OCR), ADR-023 (modelo NER multilingüe)

## Contexto

La revisión del Hito 5 (`ner-engine`) detectó una contradicción real entre spec y contrato:

1. **Campo `modelLoading` sin contrato.** `core/NER_Engine.md` §13 caso 7 dice que en la primera
   descarga del modelo "`NER_STARTED` indica `modelLoading: true`", pero `core/Contracts.md` §8
   define `NerStarted` como `{ documentId, pageCount, modelId }`, sin ese campo. Es exactamente la
   situación que ADR-021 §3 resolvió para OCR (`OcrStarted.modelLoading?`). La implementación hizo
   lo correcto (R-19): emitió la forma real del contrato y no inventó el campo.

2. **`batchSize` en tokens vs. palabras.** `NER_Engine.md` §6 documenta `batchSize` como
   "256 tokens" y §12 define los checkpoints de cancelación "cada `batchSize` tokens". Pero la
   tokenización real vive del otro lado de la frontera de `@xenova/transformers` (que los tests
   mockean, ADR-021 §5): el motor inline no tiene un conteo de tokens utilizable para segmentar
   antes de inferir. La implementación segmenta por **palabras** y lo documenta en código.

## Decisión

### 1. `NerStarted` gana `readonly modelLoading?: boolean`

Se agrega el campo opcional a `Contracts.md` §8 y `shared/src/events.ts`, espejo exacto de
ADR-021 §3: presente y `true` solo cuando el modelo no está cacheado y la primera inferencia va a
esperar la descarga; omitido si el modelo ya está listo. Habilita el caso límite 7 del spec
("Descargando modelo NER…") sin inventar eventos nuevos y sin romper consumidores existentes
(campo opcional).

**Asimetría deliberada con OCR**: `NerFinished` **no** gana `modelDownloaded?`. OCR necesitó ese
segundo flag porque no tiene eventos dedicados de modelo; NER ya tiene `NER_MODEL_LOADING`
(progreso) y `NER_MODEL_READY` (fin de descarga/carga), que cubren esa señal con más detalle.

### 2. `batchSize` se interpreta en **palabras** en la implementación inline

La unidad de `batchSize` pasa a documentarse como palabras (proxy razonable de tokens, ~1–2
tokens por palabra en los idiomas del modelo). El propósito del campo no cambia: segmentar la
inferencia para dar checkpoints de cancelación cooperativa. Cuando la inferencia pase a workers
con acceso al tokenizer real (Hito 9), puede reevaluarse volver a tokens exactos sin cambio de
interfaz (el campo sigue siendo `number`). Se corrigen los comentarios de `NER_Engine.md` §6 y §12.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Evento nuevo (p. ej. `NER_MODEL_DOWNLOAD_REQUIRED`) | ADR-021 §3 ya rechazó esta forma para OCR: infla la taxonomía de eventos para una señal de UX que cabe en un campo opcional. |
| Quitar el caso límite 7 del spec | Pierde la señal "Descargando modelo NER…" en la UI, que el spec y `MVP.md` §2.3 (estado de pipeline en toolbar) asumen. |
| `NerFinished.modelDownloaded?` (simetría total con OCR) | Redundante: `NER_MODEL_READY` ya emite esa información con `modelId`. |
| Tokenizar aparte para respetar "tokens" literal | Duplicaría la tokenización (costo por página) o exigiría exponer el tokenizer a través de la frontera mockeada; sin beneficio funcional para checkpoints de cancelación. |

## Consecuencias

**Positivas**: spec, contrato y código quedan alineados con el mismo patrón que OCR; el campo
opcional no rompe nada existente; la semántica de `batchSize` documentada coincide con lo que el
código hace realmente.

**Negativas**: los checkpoints de cancelación quedan medidos en palabras, una unidad ~1–2× más
gruesa que tokens — irrelevante para el SLA < 200 ms que igual se valida en Hito 9/11 (ADR-021);
la asimetría OCR/NER en flags de modelo requiere leer este ADR para entenderse (mitigado: queda
citado en `NER_Engine.md`).

## Referencias

- `core/Contracts.md` §8 (`NerStarted`) — `core/NER_Engine.md` §6, §12, §13 caso 7
- `adr/ADR-021-Engines-Inline-Hasta-Hito9.md` §3 (precedente `OcrStarted.modelLoading?`) y §5 (mocks de frontera)
- `adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md` (modelo y mapeo de labels)
- `packages/anonymization-core/shared/src/events.ts` (`NerStarted`)
