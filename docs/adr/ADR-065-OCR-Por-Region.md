<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/OCR_Engine.md,core/Render_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/07_Performance_Strategy.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-065 — OCR de la región, no de la página: rescatar imágenes con texto que ningún texto nativo explica

- **Estado**: Accepted
- **Fecha**: 2026-08-09
- **Decidido por**: El humano, tras probar la herramienta sobre una pericia judicial real donde el 55% de una página —una imagen con el fiscal responsable adentro— nunca se escaneó y el dato se exportó sin anonimizar. Rechazó explícitamente delegarle la decisión al usuario (*"la aplicación tiene que ser lo suficientemente inteligente para poder saber manejar dichas páginas por sí misma"*) y pidió medir antes de escribir.
- **Relacionado con**: ADR-064 (**precondición**: sin la conversión px→pt no se puede traducir un recorte a coordenadas de página), ADR-020 §6 (el guard de `fuseOcrPage` que este ADR refleja invertido), ADR-041 (el precedente de función pura host-side), ADR-034 §1 (`rasterizePage`), ADR-063 (el otro defecto del hito, independiente)
- **Parte de**: Hito 10.8, paso 2

> Convención de citas: `ADR-065 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-065, Contexto §N`.

## Contexto

### 1. Una palabra nativa alcanza para que la página nunca vaya a OCR

`parsePage` decide con una sola línea (`pdf.engine.ts`, ADR-020):

```ts
const requiresOCR = sortedWords.length === 0;
```

Basta **una** palabra de texto nativo para que la página quede fuera de `textlessPages`, y el Orchestrator solo manda a OCR lo que está en esa lista. En la pericia medida, un sello de firma digital de 19 caracteres aportaba esa palabra. Consecuencia: una imagen de 449×599 pt —el **55% de la página**, con el nombre del fiscal adentro— no se escaneó nunca y salió en el export sin anonimizar.

`fuseOcrPage` refuerza el mismo supuesto: rechaza con `InvalidInputError` cualquier página con `requiresOCR === false` (ADR-020 §6) y además **reemplaza** las palabras en vez de sumarlas. El camino "página mixta" no existe en el modelo. Lo que hoy se llama `sourceKind: "mixed"` es mixto **por documento** (unas páginas con texto, otras sin), no por página.

### 2. La heurística obvia es la equivocada, y se comprobó

La primera propuesta fue "OCR-ear la página si la cobertura de texto nativo es baja". Medida contra un escaneo con capa OCR previa —el caso que hay que rechazar— da **31,6% de área de imagen sin texto encima**, o sea que dispara. Eso habría metido un OCR de página completa en **cada página de todo expediente escaneado**: a ~6 s por página contra los 0,8 s/página de presupuesto (`07_Performance_Strategy.md` §1), un expediente de 200 páginas pasaría de segundos a ~20 minutos.

La segunda propuesta —mayor región contigua vacía— también falla: da 30,3% sobre el mismo caso, porque los huecos entre renglones se conectan con los márgenes y forman un único blob que rodea el bloque de texto.

Las dos se descartaron **midiendo**, contra un fixture sintético de seis arquetipos de página construido para eso.

### 3. Lo que sí separa los casos es la forma, normalizada por imagen

La diferencia real entre "escaneo ya buscable" y "imagen con texto oculto" no es cuánta área vacía hay, sino **de qué forma es y respecto de qué**: en un escaneo el hueco más grande es una franja de margen, fina; en una imagen con texto escondido es un bloque sólido que ocupa casi toda la imagen. Midiendo el **mayor rectángulo vacío inscrito dentro de cada imagen, como fracción del área de esa imagen**, los seis arquetipos se separan:

| Página | vacío / imagen | Forma | Veredicto |
|---|---|---|---|
| Escaneada, capa OCR completa | **11%** | 65×842 (franja) | no |
| Escaneada, capa OCR, márgenes anchos | **20%** | 121×842 (franja) | no |
| Logo de 37×37 | filtrado por tamaño | — | no |
| Sin imágenes | muere en la compuerta 1 | — | no |
| Escaneada, capa OCR **parcial** | **67%** | 596×566 (bloque) | sí |
| Caso pericia (sintético) | **103%** | 456×605 (bloque) | sí |
| **Pericia real, página 1** | **102%** | **456×605** | **sí** |

Peor negativo 20%, peor positivo 67%: un umbral en 40% queda con 2× de margen para los dos lados.

### 4. Detectar que hay imágenes es prácticamente gratis

`page.getOperatorList()` sobre páginas sin imágenes cuesta **3,7 ms de media** (medido sobre el documento real, `pdfjs-dist` 4.10.38). Proyectado a 200 páginas son **0,7 s contra los 160 s** que da el presupuesto de `07_Performance_Strategy.md` §1 — un 0,4%. En páginas con imagen sube a ~20 ms, pero esas van a OCR de todos modos.

## Decisión

### 1. Dos compuertas en `pdf-engine`, dentro de `parsePage`

**Compuerta 1 — ¿hay imágenes?** De `page.getOperatorList()` se toman los ops `paintImageXObject`, `paintImageMaskXObject` y `paintInlineImageXObject`, y de la CTM vigente en cada uno (simulando `save`/`restore`/`transform`) sale el rectángulo donde esa imagen quedó colocada, en puntos de página.

> **Errata (2026-08-10, hallazgo del implementador del PR7)**: la primera redacción de este párrafo listaba también `paintJpegXObject`, que **no existe** en `pdfjs-dist` 4.10.38 — cero ocurrencias en `pdf.mjs` y `pdf.worker.mjs`. Las imágenes JPEG salen por `paintImageXObject` como cualquier otra, así que la compuerta no pierde nada; con TS estricto el identificador ni compilaba. La medición de costo que respalda este ADR no queda invalidada: el script del spike filtraba los ops `undefined` antes de usarlos.
>
> La misma revisión mostró que la lista **omitía** cinco ops que sí existen: `paintImageXObjectRepeat`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintInlineImageXObjectGroup` y `paintSolidColorImageMask`. Son variantes que produce el optimizador de pdf.js al colapsar pintados consecutivos del mismo recurso, y **quedan deliberadamente fuera de alcance**: sus argumentos tienen otra forma (arrays de posiciones o de ítems agrupados), así que soportarlas no es agregar nombres a un `Set` sino escribir un cálculo de rectángulo distinto por variante. El modo de falla de ignorarlas es un **falso negativo** —la página no produce región— que es exactamente el comportamiento previo a este ADR, o sea cobertura incompleta y no regresión. La exposición real es angosta: una página escaneada pura va a OCR entera por `textlessPages` y nunca por región, así que estas variantes solo importarían en una página con texto nativo **y** una imagen agrupada o repetida con texto adentro. Si algún documento real lo dispara, se cierra con su propia medición. Una página sin ninguno de esos ops **termina acá**, sin rasterizar nada ni cargar Tesseract: es el caso de toda página born-digital, y es lo que hace que el costo del §4 del Contexto sea el único que paga un documento de puro texto.

**Filtro por rectángulo**: se descarta toda imagen cuyo rect ocupe **< 1% del área de página**, antes de agregar nada. El logo medido da 0,27% y la imagen grande 53%: 200× de margen. El filtro es **por rectángulo y no sobre el agregado**, para que un documento con varios logos chicos no los sume hasta cruzar el umbral.

**Compuerta 2 — ¿esa imagen tiene texto encima?** Sobre una grilla de 64×64 celdas de la página se marcan (a) las celdas cubiertas por la imagen y (b) las cubiertas por los `bbox` de las palabras nativas, **dilatados** un 0,5× del cuerpo del glifo en horizontal y 0,8× en vertical. La dilatación existe para que el interlineado no cuente como hueco. Dentro de cada imagen se busca el **mayor rectángulo vacío axis-aligned** (histograma + pila, O(GRID²)). Es región candidata si:

- su área es **≥ 40% del área de esa imagen**, y
- sus **dos lados miden ≥ 100 pt** (un texto que valga la pena leer no entra en una franja más angosta).

El rectángulo resultante se **clampea al rect de la imagen** antes de emitirse: la cuantización de la grilla lo hace desbordar un poco (en la medición dio 102-103% de la imagen), y sin el clampeo el recorte pediría área fuera de la imagen.

### 2. Una región por página: la mayor

Si una página tiene más de una imagen candidata, se emite **solo la de mayor rectángulo vacío**.

No es la solución completa y se elige igual, por costo de contrato: soportar N regiones por página obliga a distinguirlas en `OcrPageInput`, en `OcrPageOutput`, en el payload de `OCR_PAGE_FINISHED` y en la clave de cache `ocr-words:<documentId>:<pageIndex>` —cuatro contratos, dos de ellos de eventos— para un caso que **no aparece en ningún documento medido**. Con una sola región la clave sigue siendo única, porque una página con región nunca está en `textlessPages` (§4) y por lo tanto no compite con un job de página entera.

Y no es una regresión: hoy se OCR-ean **cero** regiones. Rescatar la mayor es estrictamente mejor que el estado actual, no un retroceso frente a nada.

### 3. Se OCR-ea la región, no la página

El rectángulo que devuelve la compuerta 2 es, literalmente, lo que se manda a Tesseract. Dos consecuencias, y la segunda es la que más simplifica:

- **Costo**: una A4 a 300 DPI son ~8,7 Mpx; una región del 15-20% es ~1,5 Mpx. El tiempo de Tesseract escala aproximadamente con superficie y cantidad de texto, así que la página candidata cuesta una fracción de los ~6 s de una página entera.
- **No hay nada que deduplicar**: la región es, por construcción de la compuerta 2, área **sin una sola palabra nativa encima**. Las palabras de OCR y las nativas son disjuntas, así que la fusión es una concatenación (§6) y no necesita dedupe por solapamiento de bbox.

### 4. `PdfEngineOutput` gana `ocrRegions`, disjunto de `textlessPages`

```ts
export interface OcrRegion {
  readonly pageIndex: number;
  readonly bbox: BoundingBox;   // puntos de página, origen arriba-izquierda
}
```

`PdfEngineOutput` gana `readonly ocrRegions: ReadonlyArray<OcrRegion>`. Invariante: **ningún `pageIndex` de `ocrRegions` está en `textlessPages`**. Son los dos caminos de OCR y no se pisan — una página sin texto nativo va entera (camino de siempre, intacto), una página con texto nativo va por región.

### 5. `rasterizePage` gana una región opcional

```ts
rasterizePage(documentId, pageIndex, scale, ctx, region?: BoundingBox): Promise<ImageData>
```

`region` va en **puntos de página**, el mismo espacio que cualquier `bbox` (`03_Data_Model.md` §137); el motor la multiplica por `scale` internamente y la clampea a los límites de la página. **Ausente es el comportamiento actual, bit a bit**: página entera, sin cache, sin eventos, sin supersede (ADR-034 §1).

Va acá y no en el caller —que podría rasterizar la página entera y recortar host-side— porque así el `ImageData` que cruza el boundary del worker es solo el recorte: a 300 DPI una A4 completa son ~35 MB de `ImageData`, y transportarlos para quedarse con el 15% es desperdicio de memoria y de transferencia en el punto más caro del pipeline (`07_Performance_Strategy.md` §8).

### 6. `fuseOcrRegion`: función pura, espejo invertido de `fuseOcrPage`

```ts
export function fuseOcrRegion(
  document: Document,
  pageIndex: number,
  region: BoundingBox,
  words: ReadonlyArray<Word>,
): Document;
```

Mismo perfil que `fuseOcrPage` (ADR-041): pura, síncrona, host-side, el caller provee el `Document` retenido y persiste el resultado. Diferencias, todas deliberadas:

- **Guard invertido**: exige `requiresOCR === false`. Una página textless va por `fuseOcrPage`; invocar la función equivocada es un bug de wiring y lanza `InvalidInputError`, con el mismo criterio que ADR-020 §6 aplicó al revés.
- **Traslada**: las `words` llegan en puntos **relativos al recorte** (ADR-064 convierte px→pt, pero el origen sigue siendo el del recorte). Se les suma `region.x`/`region.y` para llevarlas a coordenadas de página. Es el único lugar del sistema que conoce esa traslación, y por eso recibe `region` en vez de que el caller la aplique.
- **Concatena en vez de reemplazar**: las palabras nativas se conservan y las de OCR se suman, reordenando todo por orden de lectura y recalculando `Page.text`. Es seguro sin dedupe por lo dicho en §3.

### 7. `ocrCompleted` deja de implicar `requiresOCR`

`03_Data_Model.md` afirma hoy:

> `ocrCompleted === true` implica `requiresOCR === true`.

Una página con región OCR-eada tiene `requiresOCR === false` y sí pasó por OCR, así que el invariante se **relaja**: `ocrCompleted === true` significa "esta página pasó por OCR", entera o por región. `requiresOCR` conserva su significado exacto —"`pdf-engine` no extrajo texto nativo de esta página"— y **no** se toca: son dos preguntas distintas y hasta ahora estaban fusionadas por casualidad, porque solo existía un camino de OCR.

Es un cambio de invariante documentado, no un efecto colateral: ningún consumidor lee `ocrCompleted` para decidir nada hoy (solo `06_Pipeline.md` lo menciona para el caso de fallo).

### 8. Lo que **no** cambia

- **`requiresOCR`** (§7) y **`textlessPages`**: misma semántica, mismo cálculo.
- **`sourceKind`**: sigue siendo `text`/`scanned`/`mixed` derivado de `textlessPages`. Una página con texto nativo y una imagen con texto oculto **tiene** texto nativo; llamar `mixed` al documento por eso cambiaría el significado del campo y rippling a la UI, sin que nadie lo necesite.
- **`DocumentParsed`** y el resto de los payloads de eventos: el Orchestrator consume `PdfEngineOutput` directo (`orchestrator.ts`), no el evento, así que agregar `ocrRegions` al payload sería un cambio de contrato de eventos (R-19, `04_Event_System.md`) sin un solo consumidor.
- **La clave de cache** `ocr-words:<documentId>:<pageIndex>`: sigue única, por §2.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Mayor rectángulo vacío normalizado por imagen | Área de imagen sin texto encima, sobre umbral | **Medido**: da 31,6% sobre un escaneo con capa OCR previa, o sea que dispara. Habría convertido cada expediente escaneado en un OCR completo de 200 páginas (Contexto §2). |
| Mayor rectángulo vacío normalizado por imagen | Mayor **región contigua** vacía | **Medido**: 30,3% sobre el mismo caso. Los huecos entre renglones se conectan con los márgenes y forman un solo blob que rodea el bloque de texto (Contexto §2). |
| Normalizar por el área de la imagen | Normalizar por el área de la página | Un escaneo con márgenes anchos da 20% de página vacía y una imagen chica con texto oculto puede dar menos: los dos se acercan. Normalizando por imagen quedan en 20% contra 102%. |
| Decidir automáticamente con las dos compuertas | Ofrecerle al usuario la lista de páginas candidatas con su costo | Rechazado explícitamente por el humano: el usuario no tiene por qué saber cómo funciona el pipeline para decidir. Y si ignora el aviso, el dato se exporta sin anonimizar — que es justo el defecto que este ADR cierra. |
| Una región por página, la mayor | N regiones por página | Obliga a distinguirlas en `OcrPageInput`, `OcrPageOutput`, el payload de `OCR_PAGE_FINISHED` y la clave de cache — cuatro contratos, dos de eventos — para un caso que no aparece en ningún documento medido (§2). |
| `region` en `rasterizePage` | Rasterizar la página entera y recortar host-side | Evita tocar `Render_Engine.md`, pero hace cruzar el boundary del worker ~35 MB de `ImageData` para quedarse con el 15%, en el punto más caro del pipeline. |
| `fuseOcrRegion` como función nueva | Relajar el guard de `fuseOcrPage` y darle un modo | Fusionaría dos operaciones con precondiciones opuestas y semánticas distintas (reemplazar contra concatenar) detrás de un flag. El guard de ADR-020 §6 existe justamente para que "página con texto nativo" no entre por ese camino. |
| `fuseOcrRegion` traslada | Que traslade el Orchestrator antes de fusionar | La traslación es geometría de `Word`, que es lo que `pdf-engine` posee. Dejarla en el caller la vuelve un paso fácil de olvidar, y no hay nada que testear en aislamiento. |

## Consecuencias

**Positivas**:

- Se cierra la vía por la que un documento real exportó un dato sensible sin anonimizar: el 55% de una página que nunca se escaneó.
- Una página de puro texto nativo paga **3,7 ms** y nada más: muere en la compuerta 1, sin rasterizar ni cargar Tesseract (Contexto §4).
- Un expediente escaneado con capa OCR previa —el falso positivo caro— se rechaza con 2× de margen sobre el umbral, en la compuerta 2 (Contexto §3).
- La fusión no necesita dedupe: la región es área sin texto nativo por construcción (§3).
- `rasterizePage` sin `region` queda bit-idéntico, así que el flujo OCR actual de páginas textless no se toca.

**Negativas**:

- Una página con **dos** imágenes candidatas rescata solo la mayor (§2). No es regresión —hoy se rescatan cero— pero es una fuga conocida.
- Los umbrales (1%, 40%, 100 pt, grilla 64×64, dilatación 0,5×/0,8×) están calibrados contra seis arquetipos y un documento real. Un escaneo con columnas, tablas o sellos que no anticipé puede caer del lado equivocado; el margen de 2× es el colchón, no una garantía.
- La envolvente rectangular es una aproximación: una imagen con texto en forma de L manda a OCR el rectángulo mayor y deja el resto afuera.
- `ocrCompleted` cambia de significado (§7). Ningún consumidor lo lee hoy, pero es un invariante publicado que deja de valer.

## Validación

- Test unit (`pdf-engine`): página sin image XObjects → `ocrRegions` vacío, sin invocar la compuerta 2.
- Test unit: imagen < 1% del área de página (logo 37×37 en A4) → descartada por el filtro de tamaño.
- Test unit: imagen a página completa con texto nativo distribuido → **no** produce región (el caso escaneo-con-capa-OCR, 11% y 20% en la calibración).
- Test unit: imagen grande sin ninguna palabra nativa encima → produce región, clampeada al rect de la imagen.
- Test unit: dos imágenes candidatas en una página → una sola región, la de mayor rectángulo vacío (§2).
- Test contract: ningún `pageIndex` de `ocrRegions` aparece en `textlessPages` (§4).
- Test unit (`render-engine`): `rasterizePage` con `region` devuelve `ImageData` del tamaño del recorte por `scale`; sin `region`, idéntico al actual.
- Test edge (`render-engine`): `region` que excede los límites de la página se clampea; `region` de área cero → `InvalidInputError`.
- Test unit (`pdf-engine`): `fuseOcrRegion` traslada por `region.x`/`region.y`, concatena con las nativas y reordena; sobre página con `requiresOCR === true` lanza `InvalidInputError`.
- Test de integración: documento con una página de texto nativo + imagen con texto oculto → la entidad de la imagen llega a Grouping con bbox en coordenadas de página.
- Cobertura ≥ 85% líneas en los paquetes tocados.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Contracts.md` §5 (`OcrRegion`), §10 regla 1
- `core/PDF_Engine.md` §6, §10, §12, §13, §14, §15 (versión 1.6.0)
- `core/Render_Engine.md` §6, §13, §14 (`rasterizePage` con región)
- `core/OCR_Engine.md` §9 (el `imageData` puede ser un recorte)
- `core/Orchestrator.md` §2, §13 (etapa de OCR con regiones)
- `architecture/03_Data_Model.md` §4 (invariante de `ocrCompleted` relajado), §137 (espacio de coordenadas)
- `architecture/07_Performance_Strategy.md` §1 (presupuestos), §8 (memoria)
- `adr/ADR-064-Palabras-De-OCR-En-Puntos.md` (precondición de coordenadas)
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` §6 (el guard que §6 refleja invertido)
- `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (perfil de función pura host-side)
- `ai/AI_Development_Guide.md` R-1, R-2, R-5, R-19, R-21
