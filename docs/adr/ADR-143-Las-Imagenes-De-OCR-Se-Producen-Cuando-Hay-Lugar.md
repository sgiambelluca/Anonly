<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Orchestrator.md,core/Contracts.md,core/Render_Engine.md,07_Performance_Strategy.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-101-El-Despacho-Paralelo-De-OCR-Que-Nunca-Aterrizo.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-079-Transferencia-Real-Por-Direccion-Y-Payload.md | audiencia=humanos+IA | fase=11 -->

# ADR-143 — Las imágenes de OCR se producen cuando hay lugar

- **Estado**: Accepted (**§1 amendado por ADR-158 §2**, 2026-09-12: `OcrImageProducer` devuelve `EncodedPageImage` en vez de `ImageData`. `estimatedBytes` y `maxLiveImageBytes` **no cambian**: siguen midiendo el tamaño decodificado, que es lo que el worker materializa — ADR-158 §4)
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-07 del plan de campaña de hardening (§2, §11.2).
- **Relacionado con**: ADR-101 (el paralelismo de OCR, que ya existe y no se toca), ADR-045 (depósito y emisión host-side), ADR-065 (páginas y regiones, conjuntos disjuntos), ADR-014 (la fusión síncrona), ADR-079 (por qué OCR no transfiere su buffer)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. La etapa materializa todo el documento antes de empezar

`Orchestrator.runOcrStage` recorre `textlessPages`, llama a
`render.rasterizePage` para cada una, **acumula cada `ImageData` en el array
`ocrInputs`**, repite lo mismo con las regiones, y recién entonces llama a
`ocr.processPages(ocrInputs, ctx)`.

La aritmética, con los defaults del repo (`ocr.dpi: 300`): una A4 a 300 dpi son
2481 × 3507 px, y `ImageData` es RGBA, 4 bytes por píxel → **34,8 MB por
imagen**. Cincuenta páginas son **1,74 GB** vivos *antes* de que Tesseract lea
la primera, sin contar el modelo, los canvas intermedios ni las copias del
`postMessage`.

El valor exacto se verifica con `imageData.data.byteLength`; el comentario
antiguo de ~8 MB por página no corresponde a un buffer RGBA.

### 2. Lo que **no** hay que arreglar

`processPages` ya despacha hasta `ocrPoolSize` páginas en paralelo desde
ADR-101, con un `drainQueue` por consumidor que toma el siguiente índice
disponible. No hay que "paralelizar OCR". Lo que sobra son las imágenes que
esperan turno: el loop de consumo ya es perezoso, la producción no.

### 3. Por qué el productor no puede viajar en la configuración

`EngineConfig` se serializa hacia los workers. Una función no sobrevive un
`postMessage`. El productor tiene que entrar por parámetro de la llamada
host-side y quedarse del lado del host — que además es donde tiene que estar,
porque produce llamando a `RenderEngine`, y un motor no importa a otro (P-1).

## Decisión

**OCR recibe descriptores y pide cada imagen cuando tiene con qué procesarla.**

### 1. Entrada nueva, `processPages` intacto

```ts
interface OcrPageRequest {
  readonly documentId: string;
  readonly pageIndex: number;
  /** ADR-065: presente si es un recorte, ausente si es la página entera. */
  readonly region?: BoundingBox;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
  /** Bytes RGBA estimados por dimensiones × escala, ANTES de producir. */
  readonly estimatedBytes: number;
}

type OcrImageProducer = (
  request: OcrPageRequest,
  signal: AbortSignal,
) => Promise<ImageData>;

processSession(
  requests: ReadonlyArray<OcrPageRequest>,
  produce: OcrImageProducer,
  ctx: EngineContext,
): Promise<ReadonlyArray<OcrPageOutput>>;
```

`processPages(inputs, ctx)` se conserva con su firma y su semántica actuales —lo
usan los tests de contrato y cualquier caller que ya tenga las imágenes—, y pasa
a implementarse sobre `processSession` con un productor que devuelve la imagen
que ya recibió. Ningún consumidor existente cambia.

El façade implementa `produce` llamando a `render.rasterizePage(documentId,
pageIndex, scale, ctx, region?)`. **La función nunca cruza un `postMessage`** y
no entra en `EngineConfig`.

### 2. Una sesión lógica, no una por minilote

`OCR_STARTED` se emite **una vez** al empezar `processSession`, con
`pagesToProcess` = los `pageIndex` de todos los descriptores.
`OCR_FINISHED` se emite **una vez**, cuando el conjunto completo terminó. Por
página se conserva la secuencia exacta de ADR-045/ADR-014:

> resultado del kernel → `ctx.cache.set` → `OCR_PAGE_FINISHED` → fusión síncrona

El progreso de la etapa mantiene su total fijo (`textlessPages.length +
ocrRegions.length`, ADR-065 §2): el total no depende del orden de producción.

### 3. Cuántas imágenes pueden estar vivas

- **Por consumidor**: uno. Cada uno de los `C = min(ocrPoolSize, requests.length)`
  consumidores toma un descriptor, **reserva presupuesto**, produce su imagen,
  la procesa y **suelta la referencia antes** de pedir el siguiente. El máximo
  vivo es `C`, no `requests.length`.
- **Sin prefetch** en esta versión. Si alguna vez se agrega, su capacidad se
  suma explícitamente al máximo y se documenta acá; no se cuela como "una de
  más".
- **Por bytes**: `ocr.maxLiveImageBytes`, campo nuevo de `OcrConfig`, default
  **128 MiB**. La reserva es atómica entre consumidores y se hace **antes** de
  rasterizar, nunca después. El default admite cuatro A4 a 300 dpi (33,2 MiB
  cada una), el doble de la concurrencia máxima del perfil normal
  (`ocrPoolSize: 2`): en el perfil nominal el presupuesto no ata, y solo frena a
  una página patológica. **Es un valor de partida y H-10 lo confirma o lo
  corrige con medición.**

### 4. Una página que no entra falla, no se encoge

Si `estimatedBytes` de un descriptor supera por sí solo `maxLiveImageBytes`, esa
página falla con `OcrPageFailedError` (`OCR_PAGE_FAILED`, evento observable) y
la sesión continúa con las demás. **No** se baja el DPI ni se parte la página en
silencio: un OCR peor sin que nadie se entere es una fuga con cara de éxito, y
`OCR_PAGE_FAILED` es una señal que el usuario puede ver.

Un fallo del **productor** (Render) recibe el mismo tratamiento que un fallo de
página, con el `code` del error original en `details`. OCR no reintenta la
producción por su cuenta: el retry del pool de Render ya corrió.

### 5. La imagen se retiene hasta que la página se asienta

El retry de OCR reusa el mismo buffer, y por eso este motor **no** transfiere su
`ImageData` (ADR-079). La referencia se suelta cuando la página termina —éxito,
fallo definitivo o cancelación—, no cuando se despacha el primer intento. Un
`transferList` acá dejaría el buffer *detached* en el segundo intento.

### 6. Cancelación y caminos terminales

Al abortar: se deja de pedir descriptores, la espera por presupuesto **se
despierta con la señal** (no hay espera no cancelable), el productor en vuelo
recibe la señal, y toda reserva se libera en el camino terminal —éxito, error,
timeout o cancelación—. Un consumidor bloqueado esperando presupuesto que nunca
se libera es el modo de falla que este diseño tiene que descartar por test, no
por lectura.

### 7. El reanálisis usa el mismo flujo

`runReanalyzeOcrFlow` pasa por `processSession` igual que el flujo principal,
conservando idiomas efectivos, literales manuales y `dropOccurrences` sobre las
páginas correctas.

## Consecuencias

**A favor**

- El pico de imágenes deja de depender del largo del documento y pasa a depender
  de la ventana de trabajo: `C` imágenes, no `N`. Para 50 páginas a 300 dpi con
  `ocrPoolSize: 2`, son ~70 MB en vez de ~1,74 GB.
- El primer `OCR_PAGE_FINISHED` llega antes: hoy la primera página no se procesa
  hasta que la última se rasterizó.
- La forma de los eventos no cambia para nadie: una sesión, un `OCR_STARTED`, un
  `OCR_FINISHED`.

**En contra**

- **El consumo total sigue creciendo con el documento** por el texto, las
  palabras y los modelos. Esto acota las imágenes, no la RAM. Prometer memoria
  constante sería falso.
- La rasterización deja de correr por adelantado, así que un consumidor de OCR
  puede quedar esperando a Render. Con `ocrPoolSize ≤ 2` y `renderPoolSize ≥ 2`
  no debería atar; **H-10 lo mide**, y si ata, la respuesta es prefetch
  declarado (§3), no volver a materializar todo.
- `OcrConfig` gana un campo: toca `Contracts.md` §6, el spec de OCR y los
  defaults. Es un commit de contrato, con este ADR y nada más adentro.
- `processPages` y `processSession` conviven. Es deuda deliberada y acotada: el
  día que ningún caller pase imágenes materializadas, `processPages` se retira
  con su propio commit.

**Lo que no toca**: el paralelismo de ADR-101, la fusión síncrona de ADR-014, la
disjunción páginas/regiones de ADR-065, el kernel de Tesseract ni `RenderEngine`
—que sigue exponiendo el mismo `rasterizePage` de siempre—.
