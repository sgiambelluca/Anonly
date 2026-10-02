<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Render_Engine.md,core/Contracts.md,03_Data_Model.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-102-El-Flujo-De-Glifos-Es-Continuo-Por-Pagina.md,adr/ADR-140-Una-Pagina-Rotada-Bloquea-El-Documento.md | audiencia=humanos+IA | fase=11 -->

# ADR-141 — La geometría se entrega en la página que se ve

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-02 del plan de campaña de hardening (§2, §2.1, §3.3).
- **Relacionado con**: ADR-140 (el guard que esto retira), ADR-063 §7 (la contradicción declarada: "Render afirma que las cajas están en coordenadas de página ya rotada, mientras PDF usa coordenadas crudas"), ADR-102 (el flujo de glifos, que también hay que componer), ADR-067 (orden de lectura por runs rotados)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Hay dos marcos y nadie declaró cuál manda

`/Rotate` es una propiedad de presentación: no mueve un solo byte del content
stream, le dice al visor que gire la hoja antes de mostrarla. Eso deja dos
sistemas de coordenadas para la misma página:

- **crudo**: el espacio de usuario de PDF, donde viven `item.transform`, los
  operadores de dibujo y el `MediaBox`;
- **presentado**: el que produce `getViewport()`, con `/Rotate` ya aplicado.

Hoy `PdfEngine` produce posiciones en el crudo y dimensiones (`Page.width`,
`Page.height`) en el presentado. ADR-063 §7 registró la contradicción sin
resolverla, y ADR-140 §1 la midió: 130 a 268 pt de error en una página de
200×300, cero exacto en 0°.

### 2. Render, OCR, el preview y el export ya viven en el presentado

No es una decisión abierta entre dos candidatos igual de válidos. El marco
presentado ya es el de casi todo el sistema, y hay una sola cosa afuera:

| Productor / consumidor | Marco | De dónde sale |
|---|---|---|
| `RenderEngine.renderPage` / `rasterizePage` | presentado | `pageProxy.getViewport({ scale })` (`render-engine/src/worker/kernel.ts`) |
| Cajas de reemplazo pintadas en el canvas | presentado | se pintan sobre ese ráster |
| Palabras de OCR | presentado | Tesseract lee ese mismo ráster |
| `Page.width` / `Page.height` | presentado | `viewport.width/height` en `parsePage` |
| Selección del visor, hit-test, anotaciones de UI | presentado | dibujan sobre el ráster |
| **Palabras de texto nativo** | **crudo** | `item.transform` sin componer |
| **Flujo de glifos (ADR-102)** | **crudo** | `composeMatrix(ctm, textMatrix)` sin componer |

Elegir el marco crudo como canónico significaría convertir seis consumidores
para acomodar a uno. Elegir el presentado significa componer una matriz en el
productor que quedó afuera.

Además, el marco presentado es el que la documentación **ya declara**:
`Render_Engine.md` §13 caso 15 dice, desde antes de todo esto, *"Los bbox están
en coords de página ya rotada (lo garantiza PDF Engine)"*. ADR-063 §7 registró
que el motor no lo garantizaba y pidió expresamente *"su propio ADR, precedido
de una medición sobre un PDF con `/Rotate ≠ 0`"*. Esa medición está en ADR-140
§1 y en §3 de acá. Este ADR no elige una convención nueva: hace verdadera una
garantía que ya estaba escrita.

## Decisión

### 1. El marco canónico es el de la página presentada

**Definición normativa**, que va al spec de PDF y a `03_Data_Model.md` junto a
`BoundingBox`:

- Origen arriba-izquierda de la página **tal como se ve**, `x` hacia la derecha,
  `y` hacia abajo.
- Unidad: puntos PDF (1/72") a `scale: 1`; un ráster a escala *s* se obtiene
  multiplicando por *s*, y esa sigue siendo la única conversión de escala.
- Extensión: `0 ≤ x ≤ Page.width`, `0 ≤ y ≤ Page.height`, con `Page.width`/
  `Page.height` = `viewport.width`/`viewport.height` — o sea, ya intercambiados
  cuando la rotación es 90 o 270.
- `CropBox`/`MediaBox`: el desplazamiento de origen y el recorte los resuelve
  `getViewport()`, que parte del `view` de la página. **No se compensan a mano**
  en ningún lado: aplicar la traslación dos veces es el modo más común de
  arreglar 90° y romper 0°.
- Toda transformación se aplica **exactamente una vez**, en el productor.

### 2. PDF compone `viewport.transform`; nadie más cambia

`parsePage` ya tiene el `viewport` (lo pide para las dimensiones). Se compone su
`transform` sobre:

1. el origen de cada `TextItem` (`item.transform[4]`/`[5]`);
2. la parte lineal `[a, b, c, d]`, de donde salen los versores `dir` y `up` de
   ADR-063 §1 — no alcanza con corregir `x`/`y`: a 90° y 270° la palabra cambia
   de orientación, y ancho y alto se intercambian;
3. las posiciones del **flujo de glifos** de ADR-102 y los orígenes corregidos
   de ADR-068, que se comparan contra los de los items con una tolerancia de
   0,05 pt: si un lado se compone y el otro no, el empalme deja de alinear en
   toda página rotada;
4. los rectángulos de imagen que alimentan la detección de región OCR
   (ADR-065) y las palabras de anotación (ADR-066 §1).

El volteo `y = pageHeight − yMax` de ADR-063 §2 **desaparece**: `viewport.transform`
ya incluye la inversión del eje `y`. Conservar los dos es voltear dos veces.

**Verificación de que la regla es una generalización y no un parche**: con
`rotate === 0` la matriz compuesta es exactamente el volteo actual, y la
medición de ADR-140 §1 lo confirma con error 0,0 pt en las dos palabras del
fixture. Ningún documento sin rotación puede moverse, y el `snapshot.test.ts`
del motor es el test que lo prueba.

### 3. `bbox.rotation` pasa a describir lo que se ve — con el ángulo **visual**

`bbox.rotation` **ya tiene una definición fijada y medida**, y no es la de este
ADR: la puso ADR-090 §4 cuando OCR empezó a poblar el campo, y dice, sobre el
espacio de página con origen arriba-izquierda:

> `rotation: 90` ⇒ el texto avanza **hacia arriba** (palabras en `y`
> decreciente). `rotation: 270` ⇒ el texto avanza **hacia abajo** (palabras en
> `y` creciente).

Es la misma convención que consumen el orden de lectura de ADR-067
(`advanceStartOf`/`compareAlongAdvance`) y el pintado rotado de ADR-066 §7. Este
ADR **no la cambia**: cambia respecto de qué página se mide, no qué significa el
número.

De ahí sale la regla exacta, que es más precisa que "sobre el `dir` compuesto":

**`deriveRotation` recibe el `dir` compuesto y mide su ángulo _visual_:
`atan2(−dir.y, dir.x)`.**

La negación no es un ajuste cosmético y omitirla invierte el resultado. La parte
lineal del viewport contiene el volteo del eje `y` —en `rotate: 0` es
`[1, 0, 0, −1]`—, así que el `dir` compuesto vive en un marco con **`y` hacia
abajo**, mientras que la fórmula de `deriveRotation` (`atan2(dir.y, dir.x)`)
mide ángulos suponiendo **`y` hacia arriba**. Alimentarla con el vector
compuesto crudo intercambia las etiquetas **90 ↔ 270** para el mismo texto
físico: un run que avanza hacia arriba en pantalla —la definición literal de
`90` según ADR-090 §4— saldría rotulado `270`, y el orden de lectura de ADR-067
saldría invertido. Con la negación, el ángulo que se reporta es el que un humano
ve al mirar la hoja, que es lo que las tres convenciones ya decían.

Las cuatro páginas, con las dos direcciones de texto crudas que importan:

| `/Rotate` | texto crudo horizontal `dir=(1,0)` | texto crudo vertical `dir=(0,1)` |
|---|---|---|
| 0 | ausente (0°) | **90** |
| 90 | **270** | ausente (0°) |
| 180 | **180** | **270** |
| 270 | **90** | **180** |

La tabla está **medida**, no derivada en papel: un PDF de una página con un run
horizontal (`Tm` identidad) y uno vertical (`Tm = [0 1 -1 0]`), en los cuatro
ángulos, leído con el `pdfjs-dist@4.10.38` del repo, componiendo el `dir` con
`viewport.transform` y comparando las tres fórmulas (la de hoy, la compuesta sin
negar y la compuesta negada). Sin negar, el run vertical de una página
`/Rotate 0` sale `270` donde hoy sale `90`.

Dos filas que conviene leer despacio:

- **`/Rotate 0` queda idéntico a hoy**, etiqueta por etiqueta. Es la misma
  invariante que promete §2, y con la fórmula sin negar **no se cumpliría**.
- La hoja apaisada guardada con `MediaBox` vertical y `/Rotate 90` —cómo la
  escribe un scanner— tiene su texto dibujado de costado en crudo (`dir=(0,1)`).
  Hoy el motor le pone `rotation: 90` y lo manda por la rama de runs rotados de
  ADR-067; compuesto, ese texto **es horizontal en pantalla** y `rotation` queda
  **ausente**, que es como efectivamente se lee. Ese cambio de comportamiento es
  deseado y es el de §Consecuencias.

La tolerancia de `RIGHT_ANGLE_TOLERANCE_DEG` (1e-6) sobrevive sin aflojarse: a
`scale: 1` la parte lineal del viewport tiene entradas exactamente `0`/`±1`
(pdf.js las escribe literales por ángulo, no las deriva de senos y cosenos), así
que componer no introduce error de punto flotante.

`deriveRotation` es la **única** función que decide la etiqueta, y todo lo que
puebla `rotation` pasa por ella (`boundingBoxFromParallelogram`): texto de
content stream, texto de anotaciones y camino de reserva incluidos. El arreglo
es de una línea y no se replica en ningún otro lado.

### 4. La tolerancia sale de la medición, no de un literal cómodo

El criterio de aceptación por ángulo es que la caja de cada palabra contenga su
tinta con el mismo margen que hoy se acepta en 0°, medido sobre el mismo
fixture. No se elige un número que haga pasar el test: se reporta el error
residual por ángulo, y si no es del orden del de 0° la conversión está
incompleta.

### 5. Qué **no** se toca, para que no haya dudas

- `advanceStartOf`, `advanceEndOf`, `compareAlongAdvance` y `crossAxisOf`
  (ADR-067) **quedan como están**. Su convención y la de §3 son la misma; si
  alguna de las dos hubiera que recalibrar, sería señal de que `deriveRotation`
  quedó mal, no de que ADR-067 esté mal.
- `toUprightFrame`, el pintado rotado de ADR-066 §7 y el `bbox.rotation` que
  puebla OCR (ADR-090 §4) tampoco cambian.
- El helper de test `rotatedTextItem` **sigue siendo correcto y no hay que
  "des-voltearlo"**: recibe la caja de pantalla deseada y devuelve coordenadas
  crudas: su `pageHeight − y` es la **inversa** del volteo que ahora hace la
  composición, no una segunda copia de él. Para una página con `/Rotate 0` —que
  es la de todos los tests que hoy lo usan— el resultado es idéntico. Lo que sí
  hace falta es su límite escrito: para un test de página **rotada**, las
  coordenadas crudas se construyen con la inversa de `viewportTransformFor(rot)`,
  no con `pageHeight − y`.
- Los mocks de `pageProxy.getViewport()` sí tienen que declarar `transform`. Que
  hoy no lo declaren no es una convención: es que nadie lo necesitaba.

### 6. Orden de implementación

Un commit por módulo (R-1). Primero el productor —`pdf-engine`, con la
composición y el corpus de los cuatro ángulos—, después, y solo si la medición
lo exige, cada consumidor por separado. Ningún commit de PDF toca los kernels de
Render u OCR.

El guard de ADR-140 se retira **después** de verificar original, preview
anonimizado y **PDF exportado** —con al menos dos escalas de preview— y solo
para los ángulos verificados.

## Consecuencias

**A favor**

- Un solo marco para todo el sistema, declarado, con unidades y extensión.
  La pregunta "¿en qué coordenadas viene esta caja?" pasa a tener una respuesta
  y no cinco convenciones implícitas.
- El cambio queda contenido en un productor. Ningún consumidor se adapta, porque
  todos ya estaban en el marco elegido.
- Los documentos sin rotación —la enorme mayoría del corpus— son idénticos por
  construcción, y hay un snapshot que lo prueba.

**En contra**

- **Los documentos rotados con texto nativo cambian de orden de lectura**
  (§3). Es el resultado correcto, pero es un cambio de comportamiento observable
  en agrupación y en el orden de las ocurrencias, no solo en las cajas.
- La regla de §3 es **fácil de implementar mal de una forma que los tests de 0°
  no detectan**: sin la negación del eje `y`, las páginas sin rotar siguen
  saliendo bien en posición y tamaño y el snapshot pasa, mientras las etiquetas
  90/270 quedan intercambiadas. El control discriminante es un run vertical en
  una página `/Rotate 0`: su etiqueta tiene que seguir siendo la de hoy.
- Hay que componer en cuatro lugares del mismo motor (items, flujo de glifos,
  correcciones de origen, rects de imagen). Componer en tres de los cuatro
  produce un motor que empalma peor que antes en páginas rotadas — el corpus de
  los cuatro ángulos es lo único que separa esas dos situaciones.
- El caso "doble rotación" (texto rotado *dentro* de una página rotada) queda
  cubierto por composición, pero es el que menos evidencia real tiene. Su
  fixture es obligatorio y su resultado, si falla, mantiene el guard para esa
  variante.

**Lo que no toca**: `Contracts.md` no gana ni pierde campos —`BoundingBox` es el
mismo tipo—, el pipeline no cambia de etapas, y OCR, Render y Export no cambian
una línea. Lo que cambia es qué números trae PDF adentro de los campos que ya
existían, y eso es exactamente lo que hace falta declarar en el spec.
