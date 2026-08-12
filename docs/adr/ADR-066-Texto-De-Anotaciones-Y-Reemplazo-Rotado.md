<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/Render_Engine.md,architecture/03_Data_Model.md,architecture/05_Worker_Architecture.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-065-OCR-Por-Region.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-066 — El texto de las anotaciones se lee, y su reemplazo se pinta rotado

- **Estado**: Accepted
- **Fecha**: 2026-08-10
- **Decidido por**: El humano, tras probar el Hito 10.8 sobre la pericia real y encontrar que la firma digital —texto seleccionable, vertical, con el nombre de quien firma y la fecha— no se detectaba. Pidió expresamente resolverlo dentro de este hito: *"es parte del problema que intentamos solucionar"*.
- **Relacionado con**: ADR-065 (el OCR por región, cuya maquinaria este ADR **no** necesita), ADR-058 §1 (el shrink-to-fit, que pasa a medir contra el otro eje), ADR-004/ADR-009 (el export es reconstrucción raster — la razón por la que pintar encima alcanza)
- **Supersede**: **ADR-063 §5** (`BoundingBox` no gana campo de rotación). Ver §6.
- **Parte de**: Hito 10.8, paso 3

> Convención de citas: `ADR-066 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-066, Contexto §N`.

## Contexto

### 1. La firma se dibuja en el export, pero la app no la ve

`getTextContent()` extrae **solo el content stream de la página**. El texto de una anotación vive en su *appearance stream*, que es otro objeto. Medido sobre la pericia, página 1:

```
subtype=Widget  fieldType=Sig  rect=[10,60,60,560]  50×500pt  hasAppearance=true
```

Ese widget no aparece en `getTextContent()`, así que nunca produce `Word`, nunca hay ocurrencia y nunca se pinta un recuadro.

Pero **sí se dibuja**: `kernelRenderPage` llama `pageProxy.render({ canvasContext, viewport })` sin desactivar anotaciones, o sea que aplica el default de pdf.js, que es dibujarlas. Y el export es reconstrucción raster (ADR-009 §1): la imagen renderizada se adjunta como página del PDF nuevo.

El resultado es una fuga concreta: **el nombre de la persona que firma y la fecha de la firma salen en claro en el PDF anonimizado**. No es un falso negativo del detector — es texto que el detector jamás recibió.

### 2. Es texto real y se puede leer sin OCR

`getOperatorList({ annotationMode: ENABLE })` anexa los ops del appearance stream. Medido: la página 1 pasa de 103 a 197 ops, con **10 `showText` extra y 192 glifos más**. Reconstruidos, los cinco runs de la firma —todos a 90°, cuerpo 8— contienen el nombre del firmante, la organización, la fecha y hora, el motivo y la ubicación. O sea: una **Persona**, una **Organización** y una **Fecha**, que son exactamente tipos que el pipeline ya sabe detectar y agrupar.

Dato que cierra la discusión sobre OCR: **`getOperatorList()` por defecto ya incluye anotaciones** (197 contra 103 con `DISABLE`). El motor ya está pidiendo esos ops para la compuerta 1 de ADR-065; leerlos cuesta recorrer un array que ya está en memoria.

### 3. La composición de coordenadas tiene una trampa, y ya nos mordió

Los ops de una anotación son, textualmente:

```
[107] beginAnnotation ["15R", [10,60,60,560], [1,0,0,1,10,60], [1,0,0,1,0,0], false]
[114] save
[115] transform [0,1,-1,0,50,0]
[117] setTextMatrix [8,0,0,8,0,42.66]
[120] showText (…)
```

La transformación que **ubica la anotación en la página** viaja en el tercer argumento de `beginAnnotation`, no como un op `transform`. La cadena completa de un glifo es:

```
textMatrix × transformInterno × beginAnnotation.transform × CTM
```

Verificado a mano para el primer run: `[8,0,0,8,0,42.66] × [0,1,-1,0,50,0] × [1,0,0,1,10,60]` = `[0,8,-8,0, 17.34, 60]` — origen (17,34, 60), 90°, cuerpo 8, **dentro del rect** `[10,60,60,560]`.

Dos intentos previos fallaron: ignorar el `transform` de `beginAnnotation` puso los cinco runs en `y = 0` (el borde inferior de la página), y aplicarlo con un manejo ingenuo de la pila los puso en `x = -679` (fuera de la página). El motivo del segundo: **los `save`/`restore` de una anotación no están balanceados** respecto del par `beginAnnotation`/`endAnnotation`, así que una pila compartida entre los dos mecanismos se desincroniza.

### 4. El walker de la compuerta 1 arrastra el mismo defecto

`ADR-065 §1` recorre el operator list siguiendo `save`/`restore`/`transform` y **no maneja `beginAnnotation`**. Como el default de `getOperatorList()` incluye anotaciones (Contexto §2), el motor ya está recorriendo esos ops hoy: **una imagen dentro de una anotación se ubicaría en coordenadas equivocadas**. No es un bug activo en el documento medido —la anotación de firma es texto, no imagen— pero un sello escaneado como anotación de imagen es plausible en un expediente.

### 5. El argumento de ADR-063 §5 dejó de valer

ADR-063 §5 decidió que `BoundingBox` **no** ganara campo de rotación, con este razonamiento: el defecto reportado era de **cobertura** y no de **legibilidad**, y ADR-058 §1 ya garantiza que ningún token se derrame fuera del rectángulo.

Ese razonamiento se apoyaba en la evidencia disponible entonces: el único texto rotado del documento era una marca de agua de 19 caracteres que el humano decidió explícitamente **no** tapar. Con la firma, el texto rotado pasa a contener un dato que **sí** hay que tapar, y el reemplazo cae en una franja de 16 pt de ancho por 173 de alto: el shrink-to-fit lo encoge hasta el piso de 8 px y lo recorta igual. Un reemplazo ilegible sobre un sello que se iba a deseleccionar es tolerable; sobre el nombre del firmante, no.

## Decisión

### 1. `parsePage` lee el texto de las anotaciones del operator list que ya pide

De los ops entre `beginAnnotation` y `endAnnotation` se extraen los runs de texto (`showText`/`showSpacedText`), reconstruyendo el string desde el campo `unicode` de cada glifo. Se hace sobre el **mismo** `getOperatorList()` que ya invoca la compuerta 1 de ADR-065: no hay una segunda pasada ni un costo nuevo medible.

Los `Word` resultantes llevan `source: "pdf"` —es texto nativo, no OCR— y se suman a los de `getTextContent()`. No hay riesgo de duplicado: las dos fuentes son disjuntas por construcción (`getTextContent()` no lee appearance streams, Contexto §1).

### 2. La composición de coordenadas es explícita, y la pila de anotación es propia

`textMatrix × transformInterno × beginAnnotation.transform × CTM` (Contexto §3). El `transform` de `beginAnnotation` **debe** aplicarse; ignorarlo manda todo el texto al origen de la página.

`beginAnnotation` guarda el CTM vigente en una pila **separada** de la de `save`/`restore`, y `endAnnotation` la restaura. Compartir una sola pila desincroniza las dos anidaciones (Contexto §3) — es el error que ya se cometió midiendo, y por eso queda escrito acá y no descubierto de nuevo en implementación.

### 3. El `rect` de la anotación es el oráculo de validación

Todo `Word` extraído de una anotación **debe** caer dentro del `rect` que `beginAnnotation` declara en su segundo argumento. Es un invariante verificable y barato, y es la red que convierte un error de composición en un fallo detectable en vez de en cajas negras en el lugar equivocado.

Un word fuera del rect se **descarta con un `warn`**, no se corrige ni se recorta: si la composición está mal, la posición no es confiable y taparla en el lugar equivocado es peor que no taparla — el usuario ve el dato y puede agregarlo a mano (Hito 10.7), mientras que una caja negra mal puesta destruye contenido y esconde el problema.

### 4. Qué anotaciones se leen

Todas las que tengan appearance stream con texto, **salvo** las marcadas como ocultas por sus flags (`Hidden`, `NoView`): lo que no se dibuja no puede filtrarse por el export, y taparlo pintaría una caja negra sobre nada visible.

No se filtra por `subtype`. La tentación es leer solo `Widget`/`Sig`, pero un `FreeText` con un nombre anotado al margen es igual de sensible, y la lista de subtipos de PDF es larga y no la controlamos.

### 5. El walker de la compuerta 1 aplica el mismo `transform`

Se corrige el defecto de Contexto §4: el recorrido de imágenes de ADR-065 §1 pasa a manejar `beginAnnotation`/`endAnnotation` con la misma pila separada de §2. Con eso una imagen dentro de una anotación queda ubicada bien, y la compuerta 2 la evalúa como a cualquier otra.

### 6. `BoundingBox` gana `rotation` — supersede ADR-063 §5

```ts
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** ADR-066 §6: orientación del texto que ocupa esta caja. Ausente ≡ 0. */
  readonly rotation?: 0 | 90 | 180 | 270;
}
```

Va en `BoundingBox` y no en `Word` porque es lo que viaja por toda la cadena `Word → Occurrence → Replacement` sin tocar tres tipos: `mapSpanToWords` une bboxes y el campo viaja con ellos.

El rectángulo **sigue siendo axis-aligned y sigue siendo exacto** para 0/90/180/270 (ADR-063 §2): `rotation` no cambia la geometría de la caja, solo le dice al que dibuja adentro en qué dirección corre el texto. `pdf-engine` ya deriva el ángulo (los versores de avance y ascenso de ADR-063 §1) y hoy lo descarta: poblarlo es exponer un dato que ya se calcula.

Ausente ≡ 0 mantiene la compatibilidad: todo `BoundingBox` existente sigue siendo válido y se pinta como hoy.

### 7. `paintReplacements` dibuja rotado, y el shrink-to-fit mide contra el eje largo

Cuando `bbox.rotation` es 90 o 270, `paintReplacements` rota el contexto —`translate` al centro de la caja, `rotate`, dibujar centrado, `restore`— y el shrink-to-fit de ADR-058 §1 mide contra el **lado largo** de la caja (`height` en una franja vertical) en vez de contra `width`.

La garantía dura de ADR-058 §1 se conserva sin cambios: nada se derrama fuera del rectángulo. Lo único que cambia es contra qué eje se mide para lograrlo.

Efecto práctico en la firma medida: el reemplazo pasa de tener 16 pt de largo disponible a tener 173, con el cuerpo mandado por el lado corto (16 pt) — el mismo del texto original. Deja de ser ilegible y queda más holgado que muchos reemplazos horizontales del cuerpo del documento.

`redact` es inmune (rellena el rectángulo) y no cambia. Para 180° no se rota: el texto quedaría cabeza abajo, que es peor que horizontal, y la caja es la misma.

### 8. Ángulos arbitrarios caen al comportamiento actual

`rotation` solo admite los cuatro ángulos rectos. Para cualquier otro, `pdf-engine` no puebla el campo y el pintado es el horizontal de siempre: ahí el rectángulo es la envolvente conservadora de ADR-063 §2, no la caja real del texto, así que dibujar rotado adentro sería aproximar sobre una aproximación.

### 9. El orden de lectura sigue sin tocarse

El texto de las anotaciones entra al mismo `sortWordsByReadingOrder` que el resto, con el hueco que ADR-063 §4 dejó abierto: un run vertical se concatena en una posición arbitraria de `Page.text`. Es probablemente la causa de que la marca de agua se detecte en 2 de 5 páginas.

**No se resuelve acá**, por la misma razón de ADR-063 §4 —cambia un invariante compartido con `ocr-engine` y con el modelo de datos, o sea dos motores más (R-1, R-5)— y porque el defecto que este ADR cierra no depende de eso: los cinco runs de la firma son contiguos entre sí, así que Regex y NER los reciben enteros. Queda anotado como el trabajo que sigue.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Leer el texto nativo de la anotación | Rasterizar el rect de la anotación y OCR-earlo con la maquinaria de ADR-065 | Era el plan hasta medir. El texto es **nativo y exacto**; OCR-earlo sería fotografiar un texto que ya tenemos, con pérdida de precisión, costo de Tesseract y el problema no resuelto de reconocer texto a 90°. |
| Leer el texto nativo | Dejarlo como está y confiar en el agregado manual (Hito 10.7) | El usuario tendría que saber que ahí hay un dato y que la app no lo ve. La firma es texto que el propio documento declara: no detectarlo es un falso negativo, no una limitación del modelo. |
| `rotation` en `BoundingBox` | `rotation` en `Word` | Habría que propagarlo a mano por `Occurrence` y `Replacement`; en `BoundingBox` viaja solo, porque es el objeto que la cadena ya transporta. |
| Descartar words fuera del `rect` con `warn` | Recortarlos al rect | Si la composición falló, la posición no es confiable: recortar produce una caja negra en un lugar arbitrario, que destruye contenido y esconde el error. No taparlo deja el dato visible y recuperable a mano. |
| Leer todas las anotaciones con texto | Leer solo `Widget`/`Sig` | Un `FreeText` con un nombre al margen es igual de sensible, y la lista de subtipos no la controlamos nosotros. |
| No rotar en 180° | Rotar también 180° | El texto quedaría cabeza abajo. La caja es la misma que en 0°, así que el horizontal entra igual y se lee. |

## Consecuencias

**Positivas**:

- Se cierra una fuga real y medida: el nombre y la fecha de quien firma dejaban el documento en claro.
- La app deja de ser ciega a **todo** texto de anotaciones, no solo firmas: campos de formulario y anotaciones de texto libre entran por el mismo camino.
- Se corrige el defecto latente de la compuerta 1 con imágenes dentro de anotaciones (Contexto §4).
- El reemplazo sobre texto vertical pasa a ser legible, y con más espacio del que tenía horizontal.
- Costo nulo de extracción: es el mismo operator list que ADR-065 §1 ya pide.
- No requiere OCR, ni rasterizar, ni resolver el reconocimiento de texto rotado en Tesseract.

**Negativas**:

- `BoundingBox` —el tipo más transversal del modelo— gana un campo. Mitigado por ser opcional con ausencia ≡ 0: nada existente cambia de comportamiento.
- Se revierte una decisión de ADR-063, del mismo hito, a tres semanas de haberla tomado. Es el costo de haber diferido sobre evidencia incompleta; queda documentado en Contexto §5 para que la reversión no parezca arbitraria.
- El orden de lectura sigue roto para texto vertical (§9): el hueco de ADR-063 §4 sobrevive a este ADR.
- Un documento con muchas anotaciones de texto suma `Word`s que antes no existían, lo que puede aumentar el ruido de detección. No se midió: los documentos disponibles tienen una sola anotación con texto.

## Validación

- Test unit (`pdf-engine`): una anotación con `beginAnnotation.transform = [1,0,0,1,10,60]` y `setTextMatrix`/`transform` como los medidos produce un `Word` con origen (17,34, 60) y `rotation: 90`.
- Test unit: **ignorar** el `transform` de `beginAnnotation` produce words fuera del `rect` — el test que fija el error de Contexto §3.
- Test unit: la pila de `beginAnnotation` es independiente de la de `save`/`restore`; una anotación con `save`/`restore` desbalanceados no corrompe el CTM del resto de la página.
- Test unit: un word que cae fuera del `rect` se descarta con `warn` y no entra en `Page.words` (§3).
- Test unit: una anotación con flag `Hidden` no produce words (§4).
- Test unit: una imagen dentro de una anotación queda ubicada con el `transform` aplicado (§5, defecto de Contexto §4).
- Test unit (`shared`/`pdf-engine`): `rotation` ausente en texto horizontal; `90` en texto a 90°; ausente en un ángulo arbitrario (§8).
- Test unit (`render-engine`): con `rotation: 90`, el reemplazo se dibuja rotado y el shrink-to-fit mide contra `height`; sin `rotation`, el pintado es **idéntico** al previo — la garantía de no regresión.
- Test unit (`render-engine`): la garantía de ADR-058 §1 se conserva con `rotation: 90` — nada se dibuja fuera del rectángulo.
- Test de integración: un documento con una anotación de firma produce grupo de Persona y de Fecha, con bbox dentro del rect de la anotación.
- Cobertura ≥ 85% líneas en los paquetes tocados.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Contracts.md` §5 (`BoundingBox.rotation`), §10 regla 1
- `core/PDF_Engine.md` §6, §12, §13, §14, §15 (lectura de anotaciones)
- `core/Render_Engine.md` §6, §13, §14 (pintado rotado)
- `architecture/03_Data_Model.md` §5 (`BoundingBox`)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` §2 (la envolvente, intacta), **§5 (superseded por §6 de este ADR)**, §4 (el orden de lectura, sigue abierto)
- `adr/ADR-065-OCR-Por-Region.md` §1 (el operator list compartido y su walker)
- `adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md` §1 (shrink-to-fit: la garantía se conserva, cambia el eje)
- `adr/ADR-009-Export-Strategy.md` §1 (el export es raster: por eso pintar encima alcanza)
- `ai/AI_Development_Guide.md` R-1, R-2, R-5, R-19, R-21
