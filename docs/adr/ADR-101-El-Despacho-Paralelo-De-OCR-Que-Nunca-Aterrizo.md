<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,adr/ADR-045-Ocr-Kernel-Puerto-Interno.md,roadmap/Optimizacion_De_Rendimiento.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-101 — El despacho paralelo de OCR que nunca aterrizó

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, punto B del plan de `roadmap/Optimizacion_De_Rendimiento.md` ("activemos la concurrencia si la computadora permite y tiene los núcleos").
- **Relacionado con**: ADR-045 (el kernel de OCR y el reparto host/worker), `OCR_Engine.md` §15 item 7, `Orchestrator.md`
- **Parte de**: Hito 11, optimización

## Contexto

### 1. Dos lugares en el pool, uno usado

`OcrEngine.processPages` recorría las páginas con un `for … await` estricto. **No era un descuido**: el comentario que estaba ahí lo decía con todas las letras — el checklist §15.7 lo fijó así para el Hito 3 y dejó *"la priorización por visibilidad y el despacho paralelo al pool"* a cargo del **Orchestrator** en el Hito 9.

El Hito 9 cerró. El Orchestrator hace **una sola llamada** (`orchestrator.ts:1077`, `await this.engines.ocr.processPages(ocrInputs, ctx)`) y no reparte nada. El traspaso quedó documentado en los dos lados y **nunca aterrizó**, así que `ocrPoolSize: 2` (el default fuera de `lowResource`, `config.ts`) nunca tuvo más de un trabajo en vuelo.

### 2. La maquinaria de concurrencia ya existe y ya está probada

No hay que construir un scheduler. `WorkerPool` tiene cola con prioridad y antigüedad (`enqueue`), compuerta por contador de activos (`pump`: `while (this.active < this.options.size …)`), contrapresión (`maxQueue`) y asignación de slot que **lanza** si el invariante se rompe:

```
WorkerPool(...): no hay slot de worker remoto libre (invariante de concurrencia violado)
```

Lo único que faltaba era darle de comer más de un trabajo a la vez.

### 3. El orden que el spec garantiza **no** es el orden entre páginas

ADR-045 garantiza que *"la secuencia `resultado del kernel → ctx.cache.set → OCR_PAGE_FINISHED` es una sola ruta host-side, así que el orden evento/datos está garantizado"* y que se preserva *"el flujo incremental por página"*. Las dos cosas son **por página**, y sobreviven intactas si dos páginas corren a la vez.

Verificado aguas abajo: `handleOcrPageFinished` corre **síncrono** en cada evento (`IEventBus.emit` despacha en línea, `04_Event_System.md` §13) y fusiona por `pageIndex`. El orden entre páginas no lo usa nadie.

## Decisión

### 1. Hasta `ocrPoolSize` páginas en vuelo

`processPages` reparte las páginas entre `min(ocrPoolSize, inputs.length)` consumidores que toman de una cola compartida por índice.

**El límite sale de `ocrPoolSize` a propósito**, y no de un número nuevo: ese valor ya se adapta al equipo (`config.ts`: `lowResource ? 1 : 2`). En una máquina chica el resultado es **exactamente el loop de antes**, sin una rama especial que mantener.

### 2. El orden de `outputs` se preserva por índice, no por llegada

Con varias páginas en vuelo terminan desordenadas. Los resultados se depositan en su índice y recién al final se compactan, así que `processPages` sigue devolviendo lo que promete: el orden recibido.

### 3. Los dos errores que cortan siguen cortando

`CancelledError` y `OcrModelMissingError` se propagan; `OcrPageFailedError` sigue tolerándose por página, con su `warn` y su continuación (`OCR_Engine.md` §13 caso 6). El checkpoint de cancelación pasa a estar en cada consumidor, antes de tomar la siguiente página.

## Consecuencias

**Medido** — `pnpm test:measure` con `MEASURE_SCAN=1` (los 26 documentos del dataset rasterizados y pasados por OCR real), antes y después:

| páginas del documento | etapa de OCR |
|---|---|
| 2 páginas (7 documentos) | **−22 % a −27 %**, consistente |
| 1 página (19 documentos) | ±0 %, dentro del ruido |
| total del dataset | −7,3 % |

El total está dominado por los documentos de una página, donde por definición no hay nada que paralelizar.

**No llega al 2× teórico**, y se sabe por qué: el segundo worker paga su creación (~300 ms, ADR-090 Contexto §3) y estas páginas duran ~1,1 s, así que el costo fijo se come buena parte. **En un escaneo real, a 5,3 s por página, ese costo se amortiza mucho mejor — pero eso es una extrapolación, no una medición.** No hay ningún documento escaneado real en el repo.

**La calidad no se movió**: recall de Regex 56/61, recall de NER 12/17, precisión 80/95, 1 sugerencia — idénticos a la corrida previa. Era lo esperado (cada página es un trabajo independiente de Tesseract) y se corrió igual.

**En contra**

- Dos instancias de Tesseract vivas a la vez consumen más memoria. No está medido: `07_Performance_Strategy.md` §7 presupuesta 512 MB para 50 páginas y el gate `test:leak` no existe todavía.
- Con más páginas en vuelo que núcleos libres, el paralelismo deja de rendir y solo agrega presión. Acotado por `ocrPoolSize`, que ya no pasa de 2.

**Lo que queda igual**

- `render-engine` tiene el **mismo patrón secuencial** (`render.engine.ts:1177`, con un comentario que cita a OCR como precedente). No se toca acá: es otro motor y otra decisión (R-1), y no está medido.
