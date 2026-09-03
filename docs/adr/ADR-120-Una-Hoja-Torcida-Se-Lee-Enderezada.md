<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Contracts.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,adr/ADR-113-El-Renglon-Se-Corta-Donde-Hay-Una-Columna.md,adr/ADR-119-La-Orientacion-Se-Detecta-Con-El-Motor-Que-La-Sabe-Leer.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-120 — Una hoja torcida se lee enderezada

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: Sale de ADR-119: con la orientación arreglada, el texto de una hoja escaneada de costado **se reconoce** pero llega al detector revuelto.
- **Relacionado con**: **ADR-119** (que hizo que la orientación se detecte de verdad y destapó esto), **ADR-067** (la rama de runs rotados, que sigue intacta para su caso), ADR-090 §4 (que estampa `bbox.rotation`), ADR-110/ADR-113 (el agrupado por renglón que esta decisión reusa)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. Reconocido bien, entregado revuelto

Con ADR-119, una hoja escaneada girada pasa de leerse **1 de 268 palabras** a **266 de 268**. Pero el orden en que esas 266 llegan al detector es otro problema:

| giro de la hoja | pares consecutivos preservados |
|---|---|
| 90° | **138 / 267** |
| 180° | **152 / 267** |
| 270° | **132 / 267** |

El texto que ve el NER queda como `104 ello acento en obrantes en el testimonio debió ser valorado con el…`. Es exactamente el modo de falla que ADR-110 cerró para el texto derecho, reaparecido por otra puerta.

### 2. Por qué: la rama equivocada

ADR-090 §4 le estampa la misma `bbox.rotation` a **cada** palabra de una hoja enderezada. `sortWordsByReadingOrder` ramifica por ese campo, así que **todas** caen en la rama de runs rotados de ADR-067 — que se diseñó para un sello o un folio en un margen: agrupa por eje transversal, ordena por avance y parte por hueco. No tiene nada equivalente al agrupado por renglón de ADR-110 ni a la adyacencia horizontal de ADR-113, porque nunca lo necesitó: unas pocas palabras en una columna no son un cuerpo de texto.

## Decisión

### 1. Una hoja escaneada torcida se detecta por dos condiciones, no por una

`scannedSheetRotationOf` devuelve la rotación solo si **todas** las palabras la comparten **y todas vienen de OCR**.

La segunda condición es la que separa dos cosas que en la geometría se ven iguales: una hoja escaneada de costado, y una página **nativa** cuyo único contenido son runs rotados —marca de agua y firma compartiendo columna, el caso 36 de ADR-067—. No es un atajo: el único camino que produce una página entera con una sola rotación es el enderezado de ADR-090, y ése solo existe para OCR. Un PDF nativo rota *runs*; la hoja la rota su `/Rotate`, que pdf.js aplica al viewport antes de que estas cajas existan.

### 2. El orden de una hoja torcida es el orden horizontal de su versión enderezada

Se ordenan **copias** con la caja llevada al marco enderezado —la inversa de `unrotateBbox` de `ocr-engine`— con el algoritmo que ya funciona (ADR-110 + ADR-113), y se emiten los `Word` **originales**. La geometría que viaja al resto del sistema no se toca: el marco enderezado existe solo para decidir el orden.

**Las constantes de traslación se descartan.** `toUprightFrame` no conoce el ancho ni el alto del raster, y no los necesita: `groupIntoLines` compara diferencias de centro, medianas de alto y huecos horizontales, y ordena por `x`. Todo eso es invariante ante una traslación, así que un origen desplazado —o negativo— produce el mismo orden.

## Consecuencias

| giro | antes | con este ADR |
|---|---|---|
| 90° | 138/267 | **265/267** |
| 180° | 152/267 | **265/267** |
| 270° | 132/267 | **265/267** |

Los 2 pares que faltan son errores de lectura del OCR, no de orden: el control derecho sobre la misma página da lo mismo.

**En contra**

- **La condición sobre `source` mete una propiedad no geométrica en una decisión de orden.** Es deliberado y está argumentado arriba, pero es una asimetría: si algún día otro camino produjera una página entera con una rotación uniforme, esta rama no lo tomaría.
- **Es "todo o nada".** Una hoja torcida a la que el OCR le lee **una** palabra con otra rotación cae entera a la rama de ADR-067. El caso no apareció —el enderezado es por página, así que la rotación es uniforme por construcción— pero la regla no degrada: salta.
- **Alcance honesto de los tests.** Revertido el mecanismo, los casos de 180 y 270 fallan; el de **90 sigue pasando**. Sobre una grilla idealizada la rama de runs acierta el caso de 90, porque cada renglón enderezado cae en una columna limpia y el orden por avance coincide. Lo que la rompe en un documento real es el ruido de las cajas de OCR, que no se puede fabricar en un fixture sin tunearlo hasta que falle. **La evidencia del caso de 90 es la medición sobre la página real (132/267), no el test**; ahí vale como no-regresión, y así queda escrito en el propio test.

**Lo que no toca**: la rama de runs rotados de ADR-067 (§2/§3/§4 intactos, con su caso 36 como guard del discriminador), `bbox.rotation` y su propagación, la geometría de las cajas, `fuseOcrPage`/`fuseOcrRegion` —que llaman a este sorter y no saben cómo ordena— y ningún contrato.

## Qué hay que cubrir con tests

- Una hoja escaneada a 90°, 180° y 270° se lee en el orden de su versión enderezada, entrando por `fuseOcrPage`, que es el camino real.
- Los `Word` que salen conservan su caja y su `rotation` **sin transformar**: lo único que cambia es el orden.
- Una página **nativa** cuyo único contenido son runs rotados sigue yendo por ADR-067 — lo fija el caso 36, que falla si se le saca el discriminador; un test nuevo sería una segunda copia del mismo guard.
