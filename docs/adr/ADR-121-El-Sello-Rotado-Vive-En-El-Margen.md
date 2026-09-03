<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Contracts.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-119-La-Orientacion-Se-Detecta-Con-El-Motor-Que-La-Sabe-Leer.md,adr/ADR-112-El-Sello-No-Es-Un-Parrafo.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-088-El-Texto-Que-Recibe-El-NER.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-121 — El sello rotado vive en el margen

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, sobre el hueco que ADR-112 dejó anotado: el texto rotado dentro de una página derecha no lo lee ninguno de los dos modos de segmentación.
- **Relacionado con**: **ADR-119/ADR-120** (la hoja ENTERA torcida, que es el problema hermano y ya está cerrado), ADR-112 (que midió el hueco sin resolverlo), ADR-067 §4 y ADR-088 §1 (que ya saben qué hacer con una palabra rotada), ADR-090 §3/§4 (`rotateImageData`/`unrotateBbox`)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** Precedente: ADR-084.

## Contexto

### 1. Un folio o un sello girado en el margen no lo lee nadie

El buscador de líneas de Tesseract busca líneas de base **horizontales**: una corrida vertical no es una línea, así que no la encuentra. Medido sobre `qa-stamp.pdf` rasterizado, que tiene un sello a 90° y un folio a 270°: de sus **15 palabras rotadas, la pasada derecha recupera 2** — con `AUTO` y con `SPARSE_TEXT` por igual.

Y OSD no ayuda, aunque suene a que debería: contesta **bien**, porque la orientación dominante de esa página *es* 0°. Enderezar la hoja para leer el sello pondría el cuerpo de costado. Es un problema distinto del de ADR-119, y por eso necesita otra solución.

Lo que se pierde ahí no es decorativo: en los expedientes del corpus, el margen es donde viven el folio, el cargo y la firma del perito — con su nombre y su matrícula.

### 2. Reconocer también el raster girado funciona, y la pregunta es dónde

Tres pasadas —derecha, 90°, 270°— recuperan las 15. El problema es lo que traen de más: las pasadas rotadas leen el **cuerpo de costado** y devuelven 23 y 24 palabras, de las cuales solo 11 y 7 son del sello.

| regla de unión | palabras | rotadas | total | sobrantes |
|---|---|---|---|---|
| solo la pasada derecha — **antes** | 56 | 2/15 | 55/73 | **1** |
| unión cruda de las tres | 103 | 15/15 | 70/73 | **33** |
| \+ descartar la que solapa una palabra derecha | 88 | 15/15 | 70/73 | 18 |
| \+ piso de confianza 60 | 76 | **15/15** | **70/73** | **6** |

## Decisión

### 1. Las pasadas rotadas corren sobre FRANJAS DE MARGEN, no sobre la página

`MARGIN_STRIP_RATIO = 0,2`: se recorta una franja de cada lado del raster enderezado y se reconoce cada una a 90° y a 270°.

| | recupera | sobrantes | tiempo/página | sobrecosto |
|---|---|---|---|---|
| tres pasadas de página completa | 15/15 | 6 | 3715 ms | +133 % |
| **franjas de margen** | **15/15** | 7 | **2716 ms** | **+70 %** |

Recupera exactamente lo mismo por la mitad del sobrecosto, y por una razón que no es solo de tamaño: **el cuerpo no entra en el recorte**, así que no hay nada que Tesseract pueda leer de costado. Las 33 palabras inventadas de la unión cruda salen de ahí.

**Lo que esta variante no ve**: un sello rotado en el **medio** de la página. Es una apuesta sobre dónde vive el dato —folios, cargos y firmas van al margen— y no una garantía.

### 2. La regla de fusión, sus dos partes

**(a) Se descarta la candidata rotada que solape una palabra ya leída derecha.** El umbral no hay que elegirlo: barrido a 0,01 / 0,3 / 0,5 da exactamente **18 sobrantes en los tres**. Una candidata o pisa mucho una palabra derecha o no la pisa nada; no hay zona gris, así que no entra una constante nueva a justificar.

**(b) Piso de confianza, `ROTATED_MIN_CONFIDENCE = 60`**, que lleva esos 18 a 6. Las 15 palabras rotadas reales vuelven con **85-96**; lo que sobrevive está en 62 y 76. El barrido deja el piso acorralado —80 daría 4 sobrantes, 90 perdería 2 palabras reales— y se elige **60 y no 80 a propósito**: el fixture es sintético y más limpio que un escaneo real, así que el margen va del lado de no perder dato.

### 3. Va siempre encendido, no detrás de una opción

El número que lo permite: sobre `text-10p.pdf`, **que no tiene texto rotado**, las cuatro pasadas producen 4 candidatas y la regla las filtra **todas** — 16/16 palabras, **0 agregadas**. En un documento sin sellos rotados lo único que cambia es el reloj.

Y no puede ser una preferencia: si el usuario tuviera que saber qué es "una segunda pasada de OCR rotada" para que se le tape el nombre de un perito, el default ya estaría mal elegido.

### 4. Un fallo de una franja no voltea la página

El texto derecho ya está reconocido; perderlo por un extra sería peor que no tener el extra. La cancelación sí se respeta, chequeada entre pasadas.

**El recorte entra al guard, y esto no es hipotético.** La primera versión dejaba `cropImageData` afuera, y el test de integración de fusión OCR/PDF cayó al toque: `RangeError: offset is out of bounds`, y con él la página entera. La causa es que `cropImageData` indexaba filas por `source.width` sin truncar. Un `ImageData` de navegador trae siempre dimensiones enteras — pero **`viewport.width` de pdf.js es un float**, y nada en el tipo `ImageData` obliga a lo contrario: con 4,5 de ancho el `set()` de la última fila se pasa del buffer por medio píxel. El recorte ahora hace aritmética entera *y* corre adentro del `try`; las dos cosas están medidas por separado (§tests).

## Consecuencias

**Lo que la basura cuesta de verdad es menos de lo que el número sugiere**, y por maquinaria que ya existe: las palabras de las pasadas rotadas llevan `bbox.rotation`, así que **ADR-067 §4 las emite en una pasada aparte al final de `Page.text`** —nunca intercaladas con el texto horizontal, así que no pueden partir una entidad del cuerpo— y **ADR-088 §1 les corta un batch de NER propio**. ADR-113, además, impide que una palabra de margen se meta en un renglón del cuerpo por adyacencia horizontal.

**En contra**

- **+70 % de tiempo de OCR en todo documento escaneado**, tenga o no texto rotado. Es el precio de que no sea una opción.
- **`MARGIN_STRIP_RATIO` y `ROTATED_MIN_CONFIDENCE` son constantes nuevas**, y las dos salen de **un** fixture sintético. `qa-stamp.pdf` sale de `pdf-lib`: sirve para probar que el mecanismo recupera el texto, no para estimar cuánto aparece esto en un expediente de verdad. **No hay un escaneo real con sello rotado en el corpus.**
- **No está medido si esas 6-7 palabras producen entidades espurias.** Por lo de arriba deberían quedar en un batch propio sin señal léxica, pero es una inferencia, no un número.
- **El caso del medio de la página queda afuera**, con la puerta abierta: si aparece un documento así, la variante de página completa está medida y es un cambio de una constante.

**Lo que no toca**: la orientación de página de ADR-119/ADR-090, el modo de segmentación de ADR-112, `unrotateBbox`, el orden de lectura, y ningún contrato — `OcrConfig` no cambia.

## Qué hay que cubrir con tests

- Una palabra rotada que la pasada derecha no ve **entra**, y sale etiquetada con `bbox.rotation`.
- Una página **sin** texto rotado no gana ninguna palabra — el número que permite dejarlo encendido.
- Una candidata que **solapa** una palabra ya leída derecha se descarta; las que no, entran. (Cuidado con la geometría: la franja derecha mapea lejos de la izquierda, así que un test que devuelva la misma candidata en las cuatro pasadas debe esperar que sobrevivan **dos**, no cero.)
- Una candidata **bajo el piso de confianza** se descarta.
- Una franja que **falla** no voltea la página; una cancelación sí se propaga.
- `cropImageData` recorta las columnas correctas, y **no tira con un raster de ancho fraccionario** — el caso que costaba la página. La segunda mitad —que el recorte corra adentro del guard— la mide el test de integración de fusión OCR/PDF: revertir *las dos cosas* lo hace fallar.
