<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,architecture/03_Data_Model.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-097 — El avance real de cada glifo reemplaza al ancho promedio

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, eligiendo la opción A de `roadmap/Post_Hito10.8_Pendientes.md` §24 tras revisar el costo/beneficio de las dos alternativas.
- **Relacionado con**: **ADR-020 §1 (superseded en su premisa)**, ADR-063 §3 (el prorrateo sobre el eje de avance), ADR-066 §1 (el `TextState` y el recorrido que este ADR reutiliza), ADR-068 (la corrección de origen, que se compone con esta)
- **Parte de**: Hito 11, calidad de detección

> Convención de citas: `ADR-097 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-097, Contexto §N`.

## Contexto

### 1. Una caja de censura corrida 12 pt no tapa el dato

El gate manual de ADR-058 §11 encontró que el PDF exportado de `qa-stamp.pdf` deja fragmentos legibles **antes** del token de reemplazo: `Ju[HOMBRE 01]`, `B[DIRE 01]`, `DNI 3 [DNI 01]`. El diagnóstico completo está en `roadmap/Post_Hito10.8_Pendientes.md` §24 y no se repite acá. La causa, en una línea:

```ts
const charWidth = str.length > 0 ? width / str.length : 0;
const advance = charWidth * offset;
```

Un **ancho de glifo promedio uniforme** repartido sobre una fuente proporcional. La `J` de `Juan` mide 6,0 pt y el prorrateo ubica la caja 8,25 pt a la derecha del primer glifo: quedan la `J` y parte de la `u` a la vista.

### 2. La premisa de ADR-020 §1 está falsificada por medición

ADR-020 §1 eligió el prorrateo a sabiendas: *"El prorrateo es una aproximación lineal (no tiene en cuenta kerning ni fuentes proporcionales reales); es aceptable para el propósito de bbox de censura, que no requiere precisión tipográfica exacta."*

La premisa es la cláusula final. Una caja corrida 8 pt **no tapa el dato**, así que el propósito de censura sí requiere la precisión que la premisa daba por innecesaria. Lo que se supersede es esa premisa, no el mecanismo: el prorrateo sobre el eje de avance de ADR-063 §3 se conserva **intacto como camino de reserva** (§3).

### 3. El motor ya tiene los avances reales; no los estaba usando

`walkOperatorListForAnnotationsAndImages` (ADR-066 §1) ya recorre el operator list —una sola vez, sin una segunda llamada a `getOperatorList()`— y ya lee `.unicode`/`.width` de cada glifo para el texto de anotaciones (ADR-066) y para la corrección de origen (ADR-068). El dato que arregla este defecto **ya se está calculando y se descartaba**.

### 4. Medición: el empalme funciona, y el modelo es exacto

Sobre los 28 fixtures del repo (`qa-stamp`, `qa-tables-justified`, `text-10p` y los 25 del dataset de referencia), empalmando por **cadena + origen**:

```
empalme 100 % (0 items sin run, 0 items con cadena pero sin origen coincidente)
ancho modelado vs item.width de pdf.js: diferencia < 0,01 pt en todos
```

Ese segundo número es un **control cruzado independiente**: pdf.js calcula `item.width` por su cuenta, y el total que sale de sumar los avances glifo a glifo coincide con él.

**Los índices no están alineados y por eso el empalme no puede ser posicional**: `getTextContent()` intercala items sintéticos que no salen de ningún `showText` (marcadores de fin de línea `""`, y espacios `" "` entre palabras que el productor separó moviendo el cursor). En `qa-tables-justified.pdf` son 65 runs contra 129 items.

### 5. Corrección al diagnóstico de §24: el modelo no se acerca a la verdad, **es** la verdad

La tabla de §24 comparaba contra una columna "x real" calculada con `font.widthOfTextAtSize` de **pdf-lib** en `tests/fixtures/generate.ts`. Contra esa columna, el modelo de avances deja un residuo constante de ~1,44 pt. El residuo es de la columna, no del modelo:

| palabra | métricas AFM de Helvetica | avances (este ADR) | pdf-lib |
|---|---|---|---|
| `El` | 667 + 222 = 889 → **10,67** | 10,67 | 10,67 |
| `actor,` | 556+500+278+556+333+278 = 2501 → **30,01** | 30,01 | 29,41 |
| `Juan` | 500+556+556+556 = 2168 → **26,02** | 26,02 | 25,78 |

Y el argumento que lo cierra: `generate.ts` dibuja la línea entera con **un solo `drawText` en x = 50**. `widthOfTextAtSize` nunca toca el archivo — solo *predice* dónde va a caer cada palabra. Las posiciones reales de la tinta las determina el renderer aplicando las métricas de la fuente, que son las que pdf.js reporta glifo a glifo.

O sea que el error real que se corrige es el de la primera columna contra el prorrateo, y **la corrección es exacta**, no aproximada.

### 6. Por qué A y no B

Las dos opciones comparten la mitad fácil (calcular los avances, con los mismos números) y se diferencian en de dónde sale la **cadena de texto**. B la construye desde el operator list, lo que obliga a reimplementar la extracción de texto de pdf.js: espacios sintetizados (`trackingSpaceMin`), `/ActualText` y normalización Unicode.

La asimetría que decidió, y que no depende de ninguna medición:

| | si falla |
|---|---|
| **A** | ese item queda **exactamente como hoy**. Visible en el diff de snapshots. |
| **B** | cambia el **texto** del documento, y con él lo que detectan Regex, NER y la lupa. Silencioso. |

El rendimiento no aporta a la decisión: `getTextContent()` es el 63-78 % del costo del par de pasadas (~0,89-1,87 ms/página), o sea que B *ahorraría* ~1 ms/página — ruido contra los 5,3 s de OCR y los 5-15 s de NER por página.

**A no cierra la puerta a B**: la instrumentación de §5 produce la tasa de empalme que sería la evidencia para pagarla.

### 7. Lo que esta medición **no** dice

Los 28 fixtures salen de `pdf-lib`, que escribe espacios como glifos reales, sin ligaduras y sin `ActualText`. Un 100 % de empalme sobre ellos dice que el mecanismo es sólido y que el camino de reserva no se dispara solo; **no** dice cuál va a ser la tasa sobre un expediente real. Los documentos que separan palabras moviendo el cursor —justificados, kerneados, salidos de un procesador de texto— son justamente los que el repo no tiene.

## Decisión

### 1. El recorrido del operator list emite una tabla de avances por run de página

`walkOperatorListForAnnotationsAndImages` gana una tercera salida, junto a los rects de imagen y las correcciones de origen: una `TextRunAdvances` por cada `showText`/`showSpacedText` **fuera de anotación**.

```ts
interface TextRunAdvances {
  readonly origin: Vector2;                  // origen del run en espacio de página
  readonly str: string;                      // cadena derivada de los glifos
  readonly advances: ReadonlyArray<number>;  // acumulado en unidades de página
  //                                            length === str.length + 1
}
```

`advances[i]` es el avance desde `origin` hasta el **comienzo** del carácter `i`; `advances[str.length]` es el ancho total del run. De ahí salen las dos cosas que el prorrateo calculaba mal: el **desplazamiento** de un token (`advances[inicio]`) y su **ancho** (`advances[fin] − advances[inicio]`).

El avance por glifo replica la aritmética que `leadingAdvance` (ADR-068) ya usa, en espacio de texto, y se escala a unidades de página por `hypot(composed[0], composed[1])`:

```
glifo:            ((width / 1000) · fontSize + charSpacing) · horizontalScale
número suelto:    (−k / 1000) · fontSize · horizontalScale        (kerning de un TJ)
```

Un glifo cuyo `.unicode` tiene más de un carácter (ligadura) aporta su avance completo en el **primer** carácter; los siguientes repiten el acumulado. Así `advances` mantiene `length === str.length + 1` y un token nunca arranca dentro de una ligadura.

### 2. El empalme item ↔ run es por **cadena exacta + origen**, nunca posicional

`convertTextItemsToWords` casa un `TextItem` con su run si y solo si:

- `run.str === item.str`, comparación exacta sin normalizar, **y**
- el origen del run está a menos de `ORIGIN_CORRECTION_EPSILON` (0,05 pt) del origen **reportado** por `getTextContent` — el mismo `from` de ADR-068, antes de aplicar su corrección.

La igualdad de cadenas hace innecesaria la guarda `advances.length === str.length` que §24 proponía: la implica. Y es la guarda correcta contra el error silencioso, porque **es exactamente ahí donde divergen las dos fuentes**: si pdf.js sintetizó un espacio, resolvió un `/ActualText` o normalizó, la cadena no coincide y no se empalma.

El índice de búsqueda es un `Map` por cadena (exacta, sin problemas de frontera) y dentro del bucket se compara el origen con epsilon. Evita el O(items × runs) que tendría un `find` lineal en una página densa.

### 3. Sin empalme, el comportamiento es el de hoy, sin excepción

Si no hay run que case, el item usa el prorrateo de ADR-020 §1 / ADR-063 §3 tal cual está hoy. Esa es la propiedad que hace a esta decisión soltable sin poder verificarla contra un expediente real: **su peor caso es el statu quo**, y cualquier regresión aparece como un bbox que no se movió, visible en el diff de snapshots.

El camino de anotaciones (ADR-066 §1) **no cambia**: sigue construyendo su `TextItem` sintético y cayendo al prorrateo. Ahí no hay dos fuentes que empalmar —la cadena y la geometría salen del mismo lugar— y meterle la tabla sería reescribir un camino que ya es coherente consigo mismo.

### 4. El word spacing (`Tw`) queda fuera de la tabla, por consistencia con ADR-068

ADR-068 midió que la tinta cae en la posición **sin** aplicar `Tw` (248,93 modelado contra 248,5 real) y por eso su corrección lleva el origen ahí. La tabla de avances continúa esa misma convención: incluir `Tw` pondría al resto del run en un sistema distinto del que ADR-068 fija para su origen.

En el caso abrumadoramente mayoritario `Tw = 0` y la distinción no existe. Cuando no es cero **y** hay espacios iniciales descartados, la cadena del run no coincide con `item.str` y el empalme no ocurre (§2) — o sea que el caso de la pericia sigue gobernado solo por ADR-068.

### 5. La tasa de empalme se instrumenta

`parsePage` registra, por página, cuántos items se empalmaron sobre cuántos elegibles, y lo reporta por el `ILogger` inyectado. Sin esa cuenta, la pregunta que decide si alguna vez conviene B —"¿cada cuánto falla el empalme en un documento real?"— no tiene cómo contestarse salvo volviendo a instrumentar.

Es `debug`, no `warn`: un empalme que no ocurre no es un error, es el camino de reserva funcionando.

## Consecuencias

**A favor**

- La caja de censura tapa el dato. Sobre la línea medida de `qa-stamp.pdf`, el error de posición pasa de hasta 12,32 pt a **cero** (§Contexto 5).
- El ancho deja de estar mal en la otra dirección: `promueve` salía 8,43 pt más angosto que la realidad.
- Lo consume todo lo que mira geometría, sin tocar nada de eso: el hit-test de ADR-061 §4, el modo `mask`, `sharesVerticalBand`, el solapamiento de Grouping y el export.
- No hay dependencia nueva, ni una segunda pasada, ni un contrato público modificado.

**En contra**

- Dos fuentes que hay que mantener empalmadas. La guarda de §2 hace que el desempalme sea inocuo, pero **silencioso** salvo por el log de §5.
- La tabla de avances es memoria por página proporcional al texto (un `number` por carácter). Se descarta al terminar la página.
- La tasa de empalme sobre un expediente real sigue sin medirse (§Contexto 7). Es lo primero que hay que mirar cuando aparezca uno.

**Lo que este ADR no arregla**

- `§23g`/`§23h` de `Post_Hito10.8_Pendientes.md`: son de la costura del token de reemplazo y piden el gate visual. Verificado en §24 que las tres entidades de `qa-tables-justified.pdf` son items propios, o sea que su envolvente ya era exacta por aritmética y no dependía de este defecto.
