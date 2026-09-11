<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,core/OCR_Engine.md,core/Orchestrator.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-079-Transferencia-Real-Por-Direccion-Y-Payload.md,adr/ADR-120-Una-Hoja-Torcida-Se-Lee-Enderezada.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md | audiencia=humanos+IA | fase=11 -->

# ADR-158 — El ráster de OCR viaja codificado

- **Estado**: Accepted
- **Fecha**: 2026-09-12
- **Decidido por**: El humano, sobre H-09D3-b: el lever de memoria que actúa **durante** la etapa de OCR, que es donde se midió el crecimiento.
- **Relacionado con**: ADR-143 (la producción bajo demanda, que este ADR completa), ADR-079 (por qué hoy no se transfiere el buffer), ADR-120/121 (los dos pasos que sí necesitan píxeles), ADR-154 §2 lever 4
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Dónde crece la memoria, medido

Sobre P2 (50 páginas escaneadas), tres corridas calientes, comparando la entrada
de la ventana `OCR_STARTED → OCR_FINISHED` contra su pico interno: la aplicación
crece **+335 a +563 MB** ahí adentro, **3 de 3**, con el grueso en el proceso
del renderer y **+80 a +216 MB adicionales en el proceso GPU**.

De eso, lo que sabemos nombrar son ~209 MB: dos páginas en vuelo
(`concurrency = min(ocrPoolSize, páginas)` = 2) × tres copias simultáneas de
~34,8 MB cada una a 300 dpi.

### 2. Las tres copias, y una cuarta que nadie contó

Por página, hoy:

1. El canvas del worker de Render, donde pdf.js dibuja.
2. El `ImageData` que `rasterizePage` devuelve **al host**.
3. El **clon estructurado** que cruza el `postMessage` hacia el worker de OCR
   (sin `transferList`, a propósito: el reintento reusa el buffer, ADR-079/143 §5).
4. Y adentro de ese worker, `toTesseractImage` construye **otro**
   `OffscreenCanvas` y hace `putImageData` encima.

Y después de todo eso, **tesseract.js encodea ese canvas a PNG igual**: su
`loadImage` convierte cualquier entrada —canvas, blob, URL— a bytes de imagen
codificada, porque su core decodifica desde ahí. **No acepta píxeles crudos en
ningún formato.**

O sea: movemos 35 MB por página, los copiamos cuatro veces, y el consumidor final
los comprime de todas formas.

### 3. Por qué es este lever y no otro

ADR-154 §1 descarta bajar `ocrPoolSize`, y el humano pidió evitar el DPI mientras
haya alternativas sin costo de calidad. De los levers que actúan **durante** la
etapa de OCR, éste es el único que queda — y no cuesta ni resolución ni
paralelismo.

## Decisión

### 1. `rasterizePage` devuelve una imagen codificada

Su firma pasa de devolver `ImageData` a devolver `EncodedPageImage` —el tipo que
ya existe y que el export usa desde ADR-034 §3—, producido con el
`convertToBlob` del canvas que el kernel de Render **ya tiene en la mano**. No es
trabajo nuevo: es el mismo encode que hoy hace tesseract.js, movido a donde no
hay que reconstruir un canvas para hacerlo.

**Formato: PNG, sin pérdida.** `EncodedPageImage.format` admite `"jpeg"`, y no se
usa acá: comprimiría más, pero introduciría pérdida en la entrada del
reconocimiento, y este ADR existe para ahorrar memoria **sin** tocar calidad. Un
escaneado comprime muchísimo en PNG igual, porque es casi bilevel.

### 2. El payload de `ocr-page` lleva bytes, no píxeles

`OcrPagePayload.imageData: ImageData` pasa a llevar la imagen codificada, con sus
dimensiones. Es un cambio de `Contracts.md` y por eso este ADR va **antes** que
cualquier línea de código (R-2/R-19), con los specs de Render y de OCR
actualizados en el mismo paso.

`OcrPageInput`/`OcrPageRequest` y el productor de ADR-143 §1 acompañan la misma
forma.

### 3. Qué hace el worker de OCR con eso

Decodifica **una vez**, con `createImageBitmap`, y dibuja en un canvas. Desde ahí:

- el reconocimiento principal recibe ese canvas (o los bytes tal cual, que
  tesseract.js acepta como `Uint8Array`);
- el enderezado de ADR-120 opera sobre sus píxeles **solo si la orientación no es
  0**;
- las franjas de margen de ADR-121, que corren **siempre**, se recortan del
  canvas con `getImageData` sobre la franja —el 20 % del ancho— en vez de sobre
  la página entera.

**La salvedad honesta**: el worker sigue materializando una página de píxeles
(el canvas del `createImageBitmap`). Lo que desaparece es la copia que cruza el
`postMessage`, la que el host retenía, y el segundo canvas de
`toTesseractImage`. El ahorro es del lado del host y de la frontera, no del
worker.

### 4. El presupuesto de ADR-143 pasa a estimar lo **decodificado**

`maxLiveImageBytes` (ADR-143 §3) reserva presupuesto **antes** de producir cada
imagen, y hoy estima el `ImageData`. Si pasara a estimar los bytes del PNG, el
presupuesto se aflojaría entre diez y treinta veces sin que nadie lo decidiera.

Sigue estimando **el tamaño decodificado** —`ancho × alto × 4`, calculable desde
las dimensiones antes de rasterizar—, porque eso es lo que el worker va a
materializar de verdad. El presupuesto mide el costo real, no el del transporte.

### 5. El reintento se abarata, y se sigue clonando

ADR-079/143 §5 no transfieren el buffer porque el reintento lo reusa. Eso se
conserva, y ahora cuesta unos pocos MB en vez de 35: retener el PNG entre
intentos es barato. **No se agrega `transferList`**: el ahorro sería marginal y
reintroduciría el riesgo de buffer *detached* que ADR-079 documentó.

### 6. Cómo se verifica

- **Calidad**: el corpus de detección de ADR-147 tiene que dar **idéntico**. PNG
  es sin pérdida, así que cualquier diferencia es un defecto de la conversión, no
  una degradación aceptable.
- **Memoria**: con el instrumento ya corregido (ADR-146 §7bis), se compara el
  crecimiento **de entrada a pico dentro de la ventana de OCR** —la medida que dio
  3/3 consistente— antes y después. **No** se usa M2 del run completo: ya se
  demostró que su máximo puede caer fuera de toda fase.
- Se reporta también el proceso **GPU** por separado (§1): si los canvas de menos
  se notan, se notan ahí.

## Consecuencias

**A favor**

- Saca dos de las cuatro materializaciones por página en vuelo, en la fase donde
  se midió el crecimiento, sin tocar resolución, paralelismo ni calidad.
- El encode deja de hacerse dos veces: hoy tesseract.js comprime lo que nosotros
  le mandamos crudo.
- El reintento pasa a retener megabytes en vez de decenas.
- Abre una puerta que hoy está cerrada: con cada página en vuelo mucho más
  barata, "¿conviene subir `ocrPoolSize`?" vuelve a ser una pregunta medible, y
  ésa era la observación de la revisión externa que quedó sin tratar ("la
  rasterización es secuencial, así que no aprovechás el pool").

**En contra**

- **El ahorro es del host y de la frontera, no del worker** (§3): el worker sigue
  materializando una página. Si la medición muestra que el grueso del crecimiento
  estaba adentro del worker, este lever rinde menos de lo estimado.
- Se paga un **decode** por página en el worker que antes no existía —aunque se
  ahorra el `putImageData` del segundo canvas—. Es CPU, no memoria, y hay que
  mirar que no mueva el tiempo de la etapa de OCR.
- Es un cambio de contrato que toca **dos motores** y el façade: contrato primero,
  después un commit por módulo (R-1/R-5). Es el cambio más invasivo de la lista de
  levers.

**Lo que no toca**: el DPI, `ocrPoolSize`, la producción bajo demanda de ADR-143
—que este ADR completa, no reemplaza—, el enderezado de ADR-120 ni las franjas de
ADR-121, que siguen operando sobre píxeles.
