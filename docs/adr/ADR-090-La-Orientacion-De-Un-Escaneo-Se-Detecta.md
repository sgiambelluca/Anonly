<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/OCR_Engine.md,core/PDF_Engine.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-090 — La orientación de un escaneo se detecta, no se adivina

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, sobre un reporte de campo (una tabla escaneada dada vuelta que el OCR leía en horizontal y de la que salían "números detectados") y sobre las mediciones de Contexto §2, que descartaron la primera propuesta.
- **Relacionado con**: ADR-018 (assets first-party mirroreados — este ADR cambia el pin de dos y agrega uno), ADR-045 §2/§3 (kernel de OCR sin estado por documento), ADR-064 §2 (el orden se calcula en píxeles y la conversión a puntos va después), ADR-066 §6/§7 (`BoundingBox.rotation` y el pintado rotado), ADR-067 §5 (que anticipó exactamente esto: *"si algún día `ocr-engine` aprendiera a reconocer texto rotado, poblar `rotation` bastaría"*)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md` §2.1

> Convención de citas: `ADR-090 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-090, Contexto §N`.

## Contexto

### 1. El reporte de campo, reproducido

Una página escaneada de una tabla, rotada. El OCR la procesa como si fuera horizontal y de esa lectura salen números detectados: falsos positivos alimentados por texto basura.

Reproducido con `sharp` + `tesseract.js` en Node, sobre una tabla rasterizada y rotada 90°:

```
página derecha:  "Apellido y nombre DNI Telefono Perez, Juan 34.567.891 11 4567 8900 …"
página rotada:   "DD == y > $ 2% 3 2 e e 9 NN A N 'S o oc = $ $ V 1 5 23 = 3 [e] » 3 = D …"
```

La causa es la que anotó el informe: el kernel nunca llama a `setParameters`, así que corre con **PSM 3** ("fully automatic page segmentation, **but no OSD**"), y nunca pide detección de orientación. Tesseract lee renglón por renglón en la dirección equivocada.

**Es un caso que ninguna otra pieza cubre.** La rotación declarada en el PDF (`/Rotate`) la aplica pdf.js sola. La rotación del contenido de un **texto nativo** la resolvió ADR-063 derivando la geometría de la matriz. La rotación del contenido de un **escaneo** no tiene matriz (es una imagen) ni `/Rotate` (el escáner no lo escribió): solo OSD la puede ver.

### 2. La primera propuesta era probar las cuatro orientaciones, y la medición la descartó

Sin OSD, la alternativa obvia es reconocer en 0/90/180/270 y quedarse con la de mayor confianza. Acierta —medido, 4 de 4, con un margen enorme (95 contra 45–56)— pero el costo la mata. Sobre una A4 a 300 DPI (2480 × 3508) con texto denso:

| | tiempo | resultado |
|---|---|---|
| 1 `recognize`, página derecha — **el costo de hoy** | 5,3 s | confianza 95 |
| 1 `recognize`, página rotada — **el costo de hoy** | **16,7 s** | confianza 40 (la basura de arriba) |
| 4 `recognize`, fuerza bruta | **45,4 s** | gana 270°, confianza 95 |
| `detect()` OSD, core legacy | **0,5–0,7 s** | orientación correcta en derecha y en rotada |

La fuerza bruta cuesta **~65 veces más** que OSD por página; sobre un expediente de 200 páginas escaneadas son 2,5 horas contra 18 minutos.

**Y hay un hallazgo que da vuelta el argumento de costo**: una página rotada hoy tarda **16,7 s** en vez de 5,3 s, porque Tesseract se pelea con renglones que no existen. Con OSD la misma página pasa a 5,3 + 0,7 = **6 s**. En el caso que motivó este ADR, detectar la orientación no cuesta tiempo: lo **ahorra**, casi 3×.

### 3. Por qué OSD obliga a cambiar el core, y cuánto pesa

`worker.detect()` está guardado por `if (lstmOnlyCore) throw Error('worker.detect requires Legacy model, which was not loaded.')` (`tesseract.js@6.0.1/src/createWorker.js:179`): OSD es un modelo **legacy**, y el repo mirrorea `tesseract-core-lstm` / `tesseract-core-simd-lstm`, que son LSTM-only. No alcanza con agregar `osd.traineddata`.

| | hoy | con OSD | delta |
|---|---|---|---|
| core wasm (en runtime se carga **uno** de los dos) | 3,95 MB | 4,75 MB | **+797 KB** |
| `osd.traineddata.gz` | — | 4,32 MB | **+4,32 MB** |
| **lo que baja el usuario, una vez, cacheado** | | | **~5,1 MB** |

Para dimensionarlo: `spa` + `eng` ya son 5 MB y el modelo de NER son 178 MB. OSD duplica la huella de Tesseract y es el 2,8 % de lo que la herramienta ya descarga. El **reconocimiento sigue siendo LSTM**; el core completo solo trae además el código legacy que OSD necesita.

**El cambio de core no cuesta velocidad de reconocimiento, y hay que decirlo con la medición al lado** — la intuición razonable es que un core más grande reconoce más lento, y no pasa:

| | carga del worker | `recognize` de una A4 | confianza |
|---|---|---|---|
| core LSTM-only (como estaba) | 129 / 114 ms | 5347 / 5336 ms | 95,0 |
| core completo (`legacyCore: true`) | 168 / 161 ms | 5347 / 5381 ms | 95,0 |

El reconocimiento es **el mismo** (la diferencia está dentro del ruido de dos corridas); lo que crece son **~45 ms por creación de worker**, una vez por worker y no por página. Y `osd` en la lista de idiomas **no contamina el reconocimiento**: sobre la misma página, el texto que sale con `["spa","eng"]` y con `["spa","eng","osd"]` es **idéntico byte a byte**, con los mismos 48 DNIs exactos. La memoria no se pudo separar del ruido de GC en la medición y queda sin número.

## Decisión

### 1. El kernel de OCR carga el core completo y el modelo `osd`

`createWorker` pasa a recibir `legacyCore: true` y a cargar `osd` junto a los idiomas de la config. `assets.lock.json` **reemplaza** los dos pines de core LSTM-only por los completos (no los suma: con el core completo no hay razón para conservarlos) y **agrega** `tesseract-lang-osd`. ADR-018 sigue rigiendo: nada se sirve desde un CDN de terceros en runtime.

`loadedLanguages` sigue siendo el set **pedido** por la config; `osd` es un detalle de carga del kernel y no participa de la comparación que decide si hay que recrear el worker.

### 2. `user_defined_dpi` se le dice a Tesseract, en vez de dejarlo estimar

El raster se arma a `ctx.config.ocr.dpi` (el Orchestrator usa `scale = dpi/72`), así que el motor **sabe** la resolución y hasta hoy no se la pasaba: Tesseract la estimaba de la imagen. Se aplica con `setParameters({ user_defined_dpi })` cuando cambia respecto del último valor aplicado — el worker vive entre páginas y el dpi es por payload.

**Medido, y no mejora nada sobre un raster sintético limpio** — conviene decirlo antes que alguien lo cite como el arreglo de §2.2:

| cuerpo, A4 a 300 DPI | sin `user_defined_dpi` | con `user_defined_dpi` |
|---|---|---|
| 10 pt | 5089 ms, conf 95,0, 46/46 DNIs exactos | 5073 ms, conf 95,0, 46/46 |
| 6,5 pt | 6789 ms, conf 95,0, 72/72 DNIs exactos | 6894 ms, conf 95,0, 72/72 |

O sea: sobre una imagen limpia la estimación de Tesseract ya era correcta y el parámetro es indistinguible. Entra igual porque **es determinismo, no una optimización**: dejar que el motor adivine un dato que el pipeline conoce es una fuente de variación gratuita, y sobre un escaneo real —con ruido, bordes y márgenes— la estimación sí puede errarle. Lo que **no** hay que hacer es contarlo como que cierra el informe §2.2.

**Y de paso, la medición dice otra cosa sobre §2.2**: a 300 DPI un cuerpo de **6,5 pt se lee perfecto** (72 de 72 DNIs exactos, confianza 95). Si en una pericia real el texto chico "cuesta mucho", el problema no es el tamaño en puntos ni el DPI nominal: es la **resolución real de la imagen embebida** y su ruido. Eso refuerza la dirección que el informe ya proponía —medir la resolución real antes de tocar el número— y descarta subir el DPI global a ciegas.

### 3. Se detecta la orientación, se rota el raster, y las cajas vuelven

Por página, antes de reconocer:

1. `worker.detect(image)` → `orientation_degrees ∈ {0, 90, 180, 270}`, que es **la rotación horaria que hay que aplicarle al raster para enderezarlo**.
2. Si es 0 —o si `orientation_confidence` no llega al piso, o si `detect` falla— no se rota nada y **el camino es exactamente el de hoy**, byte a byte.
3. Si no, se rota el `ImageData` en horario por ese ángulo (aritmética de píxeles pura, sin canvas) y se reconoce el raster enderezado.
4. Las cajas que devuelve Tesseract están en el espacio **enderezado**; se mapean de vuelta al espacio del raster original con la rotación inversa, y recién ahí se convierten a puntos de página (ADR-064 §2: el orden se calcula en píxeles y la conversión va última).

El **orden de lectura se calcula sobre el espacio enderezado**, antes de mapear: es el único espacio donde "arriba-abajo, izquierda-derecha" significa lo que el texto dice. Con orientación 0 el orden es idéntico al de hoy.

### 4. Las palabras de un escaneo rotado ganan `rotation`

`Word.bbox.rotation` pasa a poblarse con el mismo valor de `orientation_degrees` (ausente cuando es 0). La correspondencia es la identidad, y está verificada contra los runs rotados de `qa-stamp.pdf` que produce `pdf-engine`:

- `orientation_degrees: 270` ⇒ el contenido está girado 90° en horario ⇒ el texto avanza **hacia abajo** en espacio de página ⇒ `rotation: 270` (el folio de `qa-stamp.pdf`, con `rotation: 270`, tiene sus palabras en `y` creciente).
- `orientation_degrees: 90` ⇒ el texto avanza **hacia arriba** ⇒ `rotation: 90` (el sello, con `rotation: 90`, tiene sus palabras en `y` decreciente).

Esto es exactamente lo que ADR-067 §5 dejó anticipado: con `rotation` poblado, la rama de orden de lectura por runs rotados y el pintado rotado de ADR-066 §7 **empiezan a cubrir el texto de OCR sin un cambio más**. Una palabra de escaneo derecho sigue sin llevar el campo, así que nada de lo existente cambia.

### 5. Lo que este ADR NO cambia

- **Ningún contrato público**: no hay tipos, eventos ni error codes nuevos. `OcrPagePayload` y `KernelOcrResult` conservan su forma; `BoundingBox.rotation` ya existía (ADR-066 §6).
- **Ningún otro motor.** `pdf-engine` recibe las `Word` con `rotation` por el mismo canal de siempre (`fuseOcrPage`/`fuseOcrRegion`).
- **El DPI adaptativo del informe §2.2 queda afuera**: pide medir la resolución real de la imagen embebida antes de tocar el número, y eso es otro trabajo. Lo único de §2.2 que entra acá es §2, que es gratis y estaba faltando.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| OSD con core legacy (§1/§3) | Reconocer en las 4 orientaciones y quedarse con la de mayor confianza | Acierta 4 de 4 pero cuesta 45,4 s por página contra 0,7 s de OSD (Contexto §2). Sobre un expediente escaneado largo es la diferencia entre 18 minutos y 2,5 horas. |
| OSD con core legacy | `PSM.AUTO_OSD` en vez de `detect()` | Misma dependencia: el modelo `osd` es legacy igual, así que el core completo hace falta de todos modos. Y `detect()` deja el ángulo en la mano del motor, que es lo que hace falta para rotar el raster y mapear las cajas. |
| OSD siempre (§3) | Gatillarlo solo cuando la primera pasada da confianza baja | Las páginas derechas se ahorrarían 0,7 s sobre 5,3 s (13 %), pero las rotadas pagarían la pasada mala **entera** (16,7 s) antes de decidir — justo el caso que se quiere arreglar. Correrlo siempre es más simple, más predecible y más rápido donde importa. |
| Rotar el `ImageData` (§3) | Pasarle `rotateRadians` a `recognize` | Las cajas vuelven igual en el espacio rotado, así que el mapeo inverso hace falta de todas formas; y rotar por aritmética de píxeles es una función pura, testeable en Node, sin depender de `OffscreenCanvas`. |
| Calcular el orden en el espacio enderezado (§3) | Ordenar en el espacio original | En el espacio original "arriba-abajo" no es el sentido de lectura, así que la página saldría con las palabras desordenadas — el mismo defecto que ADR-067 arregló para texto nativo. |
| Reemplazar los pines LSTM-only (§1) | Conservar los cuatro cores y elegir en runtime | Duplica lo mirroreado sin ningún caso que lo pida: el core completo hace todo lo que hace el LSTM-only. |

## Consecuencias

**Positivas**:

- El reporte de campo se cierra: una tabla escaneada rotada pasa de basura ilegible a texto correcto, y con eso desaparecen los falsos positivos numéricos que salían de esa basura.
- **En páginas rotadas el OCR se vuelve ~3× más rápido** (16,7 s → 6,0 s), porque Tesseract deja de pelear con renglones inexistentes.
- Las palabras de un escaneo rotado llevan `rotation`, así que el orden de lectura de ADR-067 y el reemplazo rotado de ADR-066 §7 las cubren sin un cambio más — el hueco que ADR-067 §5 dejó anotado.
- `user_defined_dpi` deja de estimarse. No mejora nada medible sobre un raster limpio (§2) — entra porque el pipeline conoce el dato y dejarlo adivinar es variación gratuita.

**Negativas**:

- **+5,1 MB de assets** que el usuario descarga una vez (Contexto §3). Es la contra real de este ADR.
- **+0,5–0,7 s por página escaneada derecha** (13 % sobre 5,3 s). Se acepta por §Alternativas: gatillarlo sale más caro donde importa.
- Un `detect()` que devuelve una orientación **equivocada** con confianza suficiente rotaría una página que estaba bien, y el resultado sería peor que hoy. Mitigado por el piso de confianza y porque la salida de OSD sobre las dos páginas medidas dio 17,1 y 17,6 —un orden de magnitud sobre el piso—, pero es un modo de falla nuevo que antes no existía.
- El core completo carga también el código legacy que el reconocimiento no usa: algo más de memoria por worker, **no medido** (no se pudo separar del ruido de GC). Lo que sí se midió es que el `recognize` tarda lo mismo y que **+45 ms** se pagan una vez por creación de worker (Contexto §3).
- Cargar `osd` como idioma hace que tesseract.js emita en consola `LSTM requested, but not present!! Loading tesseract.` — es esperado (el modelo `osd` no tiene componente LSTM) y no afecta el reconocimiento, pero es ruido nuevo en la consola del browser.
- **`user_defined_dpi` no mejoró nada en la medición** (§2). Entra por determinismo, no por rendimiento, y no hay que contarlo como que cierra el informe §2.2.
- OSD necesita texto suficiente para decidir. Sobre una página casi vacía devuelve confianza baja y se cae al camino de hoy, que es lo correcto pero significa que una página rotada con muy poco texto sigue saliendo mal.

## Validación

- Test unit (kernel): `createWorker` recibe `legacyCore: true` y la lista de idiomas incluye `osd`; `loadedLanguages` sigue siendo el set pedido por la config.
- Test unit (kernel): `setParameters` recibe `user_defined_dpi` con el dpi del payload, y **no** se vuelve a llamar si el dpi no cambió entre páginas.
- Medición fuera de la suite (no automatizable sin un rasterizador en Node): el texto reconocido con `osd` en la lista de idiomas es idéntico byte a byte al de sin `osd`, y el `recognize` tarda lo mismo con los dos cores.
- Test unit (kernel): con `orientation_degrees: 0` no se rota nada y el resultado es **idéntico** al previo al ADR — la no regresión de §3.
- Test unit (kernel): con `orientation_degrees: 90/180/270` se reconoce sobre el raster rotado y las cajas vuelven al espacio del raster original; las palabras llevan `rotation` con ese mismo valor.
- Test unit: la rotación de `ImageData` devuelve el original al cabo de cuatro cuartos de vuelta, **píxel a píxel**; 180 y 270 coinciden con dos y tres aplicaciones de 90; las dimensiones se intercambian en 90/270 y el píxel de arriba-izquierda cae en la esquina de arriba-derecha (o sea: la rotación es **horaria**, no antihoraria — el error que daría un texto al revés).
- Test unit: `unrotateBbox` devuelve la caja **dentro** del raster original en las tres orientaciones y conserva su área. (Es más débil que afirmar el inverso exacto y se elige a propósito: lo que rompe un mapeo mal hecho es que la caja se salga de la página o se deforme, y eso es lo que se afirma. El inverso exacto de punta a punta lo cubre el test de `processPage` con orientación 90, que compara contra las coordenadas calculadas a mano.)
- Test edge: `detect()` que lanza, que devuelve `orientation_degrees: null`, o que devuelve confianza por debajo del piso → se reconoce sin rotar, sin error.
- Cobertura ≥ 85% líneas en `ocr-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `roadmap/Calidad_De_Deteccion_Informe.md` §2.1 (el reporte de campo), §2.2 (el DPI adaptativo, que queda afuera)
- `core/OCR_Engine.md` §9, §10, §12, §13, §14, §15
- `core/Contracts.md` §5 (`BoundingBox.rotation`, ausente ≡ 0)
- `adr/ADR-018-First-Party-Assets.md` (los pines que este ADR cambia)
- `adr/ADR-064-Palabras-De-OCR-En-Puntos.md` §2 (el orden en píxeles, la conversión última)
- `adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md` §6, §7
- `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` §5 (el hueco que este ADR cierra)
- `ai/AI_Development_Guide.md` R-1, R-2, R-12, R-13, R-18, R-21
