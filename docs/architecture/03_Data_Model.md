<!-- CONTEXT: scope=modelo-de-datos | dependencias=01_Technical_Architecture_Document.md,core/Contracts.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md | audiencia=IA+humanos | fase=1 (fase 10.9: §7/§8/§12 `fragments` —la descomposición por línea de una ocurrencia que cruza un salto de renglón, ADR-074 §1—; §18 actualizado en fase 10: OcrPagePayload.imageData→ImageData y payloads de transporte LoadDocument/RasterizePage/ExportSave, ADR-036 §4; UnloadDocumentPayload, ADR-043 §4; NerPagePayload por batch + NerKernelSpan/NerKernelProgress, ADR-046; fase 10.5/10.6: §9 EntityGroup.personGender + PersonGender —ADR-060 §2—, §11 escalera de abreviaturas del placeholder —ADR-057 §1—, §18 RenderPagePayload.lineWords —ADR-058 §5—, ExportSavePayload.legendImage + MarkerLegendEntry/MarkerLegendRow + RenderLegendPayload —ADR-059 §3/§5/§6—, §19 ExportOptions.includeMarkerLegend —ADR-059 §1—; fase 10.8: §4 invariante de orden de lectura por runs rotados —ADR-067— y `ocrCompleted` relajado a `requiresOCR === false` con región —ADR-065 §7—, §4.1 `OcrRegion` nueva —ADR-065 §4—, §5 `Word.bbox.rotation` y aclaración de puntos de página para `source: "ocr"` —ADR-066 §6, ADR-064—, §6 `BoundingBox.rotation` —ADR-066 §6—, §18 `RasterizePagePayload.region` —ADR-065 §5—; fase 10.6: §9 `EntityGroup.personGender` —ADR-060 §2—, reescrita por ADR-069 §4/§6 —quién lo escribe, qué significa la ausencia, y que la elección del humano se recuerda aparte en `personGenderUserSet`, interno—; fase 11: §4 la clave de orden de lectura pasa a la línea de base, §5 `Word.bbox` es la caja de tinta también para `source: "pdf"` y §6 gana el invariante de que `y + height` es la línea de base —ADR-109 §1/§3—; §4 vuelve a cambiar: el orden de lectura deja de tener clave escalar y pasa a agrupar renglones —ADR-110 §1, supersede ADR-109 §3—) -->

# Anonly — Modelo de Datos (TAD bloque 5)

> Define **todos** los tipos de datos del sistema, sus atributos, invariantes y relaciones. Las implementaciones TypeScript exactas viven en `core/Contracts.md`; este documento es la fuente de verdad **semántica**. Si hay discrepancia entre el código y este documento, este documento gana hasta que se actualice explícitamente vía PR de documentación.

**Principio rector**: todo dato del Core es **inmutable**. Toda colección es `ReadonlyArray<T>`. Toda propiedad es `readonly`. Las mutaciones se realizan con copia estructural y producen nuevas referencias.

---

## 1. Visión general

El dato más importante del sistema es el **`EntityGroup`**: un grupo de ocurrencias del mismo valor sensible, con un valor canónico, un índice secuencial por tipo, un modo de reemplazo y un valor de reemplazo. **La UI nunca ve ocurrencias crudas**, solo grupos.

```
Document
  └─ Page[]                         (estructura del PDF)
       └─ Word[]                    (texto + posición)
            └─ BoundingBox          (coords)

Occurrence                          (detección cruda, INTERNA)
  ├─ entityType
  ├─ value
  ├─ bbox
  └─ source: regex | ner | ocr

EntityGroup                         (unidad de UI y reemplazo)
  ├─ type
  ├─ canonicalValue
  ├─ members: OccurrenceRef[]       (referencias a Occurrence)
  ├─ indexInType                    (01, 02, 03...)
  ├─ replacementMode                (mask | synthetic | placeholder | redact)
  ├─ replacementValue
  └─ enabled

Replacement                         (resolución final por ocurrencia)
Rule                                (regla por grupo / tipo / global)
Annotation                          (marcado visual sobre la página)
Conflict                            (discrepancia entre detectores)
```

---

## 2. `Document`

Representa el PDF cargado, ya parseado por el PDF Engine y (opcionalmente) completado por OCR.

```ts
export interface Document {
  readonly id: string;                       // UUID v4, generado al importar
  readonly name: string;                     // nombre original del archivo
  readonly pageCount: number;
  readonly pages: ReadonlyArray<Page>;
  readonly metadata: DocumentMetadata;       // solo metadata no sensible
  readonly sourceKind: "text" | "scanned" | "mixed";
  readonly importedAt: number;               // epoch ms
}
```

**Atributos**

| Atributo | Tipo | Significado |
|---|---|---|
| `id` | `string` | UUID v4. Estable durante toda la sesión. |
| `name` | `string` | Solo para UI. No se conserva en el export. |
| `pageCount` | `number` | ≥ 0. Coincide con `pages.length`. |
| `pages` | `ReadonlyArray<Page>` | Páginas en orden. |
| `metadata` | `DocumentMetadata` | Solo metadata **no sensible**. Ver §3. |
| `sourceKind` | `"text" \| "scanned" \| "mixed"` | `mixed` si al menos una página requirió OCR. |
| `importedAt` | `number` | Para UX y métricas. |

**Invariantes**
- `pageCount === pages.length`.
- `pages[i].index === i` para todo `i`.
- `id` es único dentro de la sesión.
- `metadata` no contiene texto del documento, ni autor original, ni XMP sensible (ver `08_Security_Model.md`).

---

## 3. `DocumentMetadata`

```ts
export interface DocumentMetadata {
  readonly title?: string;       // sanitizado, no sensible
  readonly producer?: string;    // software que generó el PDF
  readonly creationTool?: string;
  readonly pdfVersion: string;
  readonly encrypted: boolean;
  readonly hasForms: boolean;
}
```

**Invariantes**
- `author`, `creator` con nombres reales y campos XMP sensibles **no** se exponen. Se descartan en el PDF Engine y jamás llegan al export.
- El export genera metadata propia mínima (ver `core/Export_Engine.md`).

---

## 4. `Page`

```ts
export interface Page {
  readonly index: number;                    // base 0
  readonly width: number;                    // puntos PDF (1/72 inch)
  readonly height: number;
  readonly words: ReadonlyArray<Word>;
  readonly text: string;                     // texto concatenado, para debug y NER
  readonly requiresOCR: boolean;             // true si PDF Engine no extrajo texto
  readonly ocrCompleted: boolean;            // true si OCR ya completó esta página
  readonly dpi?: number;                     // si fue OCR-ada
}
```

**Invariantes**
- `words` está **agrupado en renglones** y, dentro de cada renglón, ordenado por `bbox.x` asc (ADR-110 §1). No hay una clave escalar con tolerancia: un word entra al renglón vigente si su centro vertical cae dentro de la banda de ese renglón (mediana de sus centros ± 0,5 × la mediana de sus altos), y si no, abre uno nuevo. Hasta ADR-110 el orden salía de un comparador con tolerancia, que **no es transitivo** — sobre un escaneo eso rompía uno de cada tres pares de palabras consecutivos. **ADR-067**: los words con `bbox.rotation` 90/180/270 se agrupan en *runs* —misma coordenada transversal (tolerancia 1) y contiguos sobre el eje de avance (hueco ≤ 2 cuerpos)—, cada run se ordena en su dirección de avance, y los runs se emiten **enteros y contiguos, en una pasada aparte después de todo el texto horizontal** (nunca intercalados: intercalarlos parte una línea horizontal al medio, porque el comparador con tolerancia no es transitivo). Para `rotation` ausente o `0` el orden es literalmente el de la primera oración, en **cualquier** página tenga o no texto rotado.
- Si `requiresOCR === false`, entonces `words.length > 0` o la página es genuinamente vacía.
- `ocrCompleted === true` implica que la página **pasó por OCR**, entera o por región (ADR-065 §7). Hasta ADR-065 implicaba `requiresOCR === true`, porque solo existía el camino de página entera; con el OCR por región una página con texto nativo (`requiresOCR === false`) también puede haber pasado por OCR. `requiresOCR` conserva su significado exacto —"`pdf-engine` no extrajo texto nativo de esta página"— y no debe leerse como "esta página no vio OCR".
- `text` es la concatenación de `words.map(w => w.text).join(" ")` con normalización NFC.

### 4.1 `OcrRegion`

```ts
export interface OcrRegion {
  readonly pageIndex: number;
  readonly bbox: BoundingBox;                // puntos de página, origen arriba-izquierda
}
```

Región de una página **con texto nativo** que aun así hay que escanear: una imagen cuyo interior ningún texto explica (ADR-065). La produce `pdf-engine` en `PdfEngineOutput.ocrRegions` y la consume el Orchestrator, que rasteriza solo ese recorte, lo manda a OCR y fusiona con `fuseOcrRegion`.

**Invariantes**
- `bbox` está contenido en el rectángulo de la imagen que la originó, y por lo tanto dentro de la página.
- Ningún `pageIndex` de `ocrRegions` aparece en `textlessPages`: una página sin texto nativo va a OCR entera y nunca por región (ADR-065 §4).
- Como máximo **una** región por `pageIndex` (ADR-065 §2).

---

## 5. `Word`

```ts
export interface Word {
  readonly text: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly confidence: number;               // 0..1; 1.0 si viene de PDF.js con texto nativo
  readonly source: "pdf" | "ocr";
}
```

**Invariantes**
- `confidence ∈ [0,1]`.
- `pageIndex` coincide con la página contenedora.
- `bbox.rotation` (ADR-066 §6) indica en qué dirección corre el texto que ocupa la caja: `0 | 90 | 180 | 270`, **ausente ≡ 0**. No cambia la geometría —el rectángulo sigue siendo axis-aligned y sigue siendo exacto para esos cuatro ángulos (ADR-063 §2)—; le dice al que dibuja adentro cómo orientar el texto. Para ángulos arbitrarios el campo queda ausente y el pintado es horizontal (ADR-066 §8).
- `bbox` está en coordenadas de página (puntos PDF, origen esquina superior-izquierda). **Vale igual para `source: "ocr"`**: Tesseract devuelve píxeles del raster, y es `ocr-engine` quien los convierte a puntos antes de emitirlos (`OCR_Engine.md` §10, ADR-064). Ningún consumidor debe compensar por el DPI.
- `bbox` es la **caja de tinta** de la palabra, con las dos fuentes diciendo lo mismo (ADR-109 §1). Para `source: "ocr"` siempre lo fue: Tesseract mide la mancha. Para `source: "pdf"` se construye con las métricas de la fuente que reporta `getTextContent()` — `base − |descent|·cuerpo` … `base + ascent·cuerpo` sobre el eje de ascenso del run—, en vez de ir de la línea de base hacia arriba por un cuerpo entero. Sin métricas utilizables (fuente que declara `ascent ≤ 0` o `descent ≥ 0`, y el camino de anotaciones de ADR-066 §1, que no tiene `styles` que consultar) se conserva la caja previa: `base` … `base + cuerpo`.
- De ahí sale la garantía que le importa a quien pinta: **tapar `bbox` tapa toda la tinta de la palabra**, descendentes incluidas. Antes de ADR-109 quedaban afuera las colas de `g`, `j`, `p`, `q`, `y`, la `Q` y las comas — una de cada tres palabras, medido.

---

## 6. `BoundingBox`

```ts
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: 0 | 90 | 180 | 270;    // ADR-066 §6; ausente ≡ 0
}
```

**Invariantes**
- `width ≥ 0`, `height ≥ 0`.
- Coordenadas en sistema de la página (puntos PDF). Para Canvas se convierte con escala `screenDpi / 72`.
- Para un `Word` de `source: "pdf"`, el rectángulo **cubre la tinta** de la palabra y `y + height` es su línea de base (ADR-109 §1). Para uno de `source: "ocr"` es la mancha que midió Tesseract: cubre la tinta igual, pero **ninguno de sus bordes es una línea de base** (ADR-109 §3, errata). Por eso el orden de lectura de §4 no se apoya en ningún borde, sino en el centro vertical y el agrupado en renglones (ADR-110 §1).

---

## 7. `Occurrence` (INTERNA — no se expone a la UI)

Una detección cruda de un detector (Regex o NER). Solo vive dentro del pipeline hasta llegar al Grouping Engine, que la convierte en `OccurrenceRef` dentro de un `EntityGroup`.

```ts
export interface Occurrence {
  readonly id: string;                       // UUID v4
  readonly value: string;                    // texto detectado, sin normalizar de presentación
  readonly normalizedValue: string;          // para agrupar (sin espacios/puntuación redundantes)
  readonly bbox: BoundingBox;
  readonly fragments?: ReadonlyArray<BoundingBox>;  // ADR-074 §1; ausente ≡ [bbox]
  readonly pageIndex: number;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly entityType: EntityType;
  readonly maskFormat?: string;              // formato de máscara del patrón que matcheó (Regex lo copia de RegexPattern.maskFormat; ausente en NER) — ADR-029
  readonly wordSpan?: WordSpan;              // referencia a palabras del Document, opcional
}

export interface WordSpan {
  readonly startIndex: number;
  readonly endIndexExclusive: number;        // palabras[startIndex, endIndexExclusive)
}
```

**Invariantes**
- `normalizedValue` es lo que usa Grouping para comparar. Regex siempre lo provee; NER lo calcula con la misma normalización.
- `confidence ∈ [0,1]`. Regex = `1.0`. NER = score del modelo. OCR-derived = `min(ocrConf, nerConf)`.
- `entityType` debe estar dentro de los tipos que el `source` puede emitir (ver `core/Regex_Engine.md` y `core/NER_Engine.md`).

**`bbox` y `fragments`** (ADR-074 §1). Una entidad puede cruzar un salto de línea: `"Diego Ramos Vargas"` con `Diego` al final de un renglón y `Ramos Vargas` al principio del siguiente. La unión de esas palabras es la **envolvente**, un rectángulo que abarca las dos líneas enteras — correcto como región, destructivo como censura (medido: 557,2 × 18,2 pt, casi el ancho útil de la página).

- `bbox` es **la envolvente** y conserva todos sus usos: orden de primera aparición documental (ADR-028), detección de solapamiento entre ocurrencias, hit-test, miniatura de la UI.
- `fragments`, cuando está presente, es **dónde está realmente la entidad**: un rectángulo por línea, en orden de lectura (`y` asc, `x` asc). **Todo lo que pinte** usa `fragments ?? [bbox]`, nunca la envolvente sola.
- **Ausente ≡ `[bbox]`**, misma convención que `BoundingBox.rotation` (§6): el caso de una sola línea —la enorme mayoría— no lleva el campo y se comporta exactamente como antes de ADR-074.
- `fragments.length ≥ 2` siempre que esté presente. Un array de un elemento sería la envolvente escrita dos veces.
- `bbox` es la envolvente exacta de `fragments` (min/max sobre los cuatro bordes, sin tolerancia), los fragmentos no se solapan verticalmente, y `union(fragments) ⊆ bbox` — o sea que la superficie tapada solo puede achicarse respecto de la envolvente, nunca crecer: es lo que garantiza que la fragmentación **no puede introducir una fuga**.
- **El texto rotado no se fragmenta** (ADR-074 §3): con `bbox.rotation` distinta de ausente/`0`, el campo no se emite. Un run a 90° avanza hacia abajo, así que su envolvente ya es apretada y partirlo por banda vertical daría un fragmento por palabra.
- Quien lo puebla es `mapSpanToWords`, en `regex-engine` y en `ner-engine`, agrupando las `Word` del match con `sharesVerticalBand` (`core/Contracts.md` §6). `findLiteral` (ADR-061) **nunca** produce el campo: exige banda vertical compartida entre palabras consecutivas, así que sus matches son de una línea por construcción.

---

## 8. `OccurrenceRef`

Referencia liviana a una `Occurrence`, usada dentro de un `EntityGroup`. Duplica **lo que la UI necesita sin resolver**, y nada más.

```ts
export interface OccurrenceRef {
  readonly occurrenceId: string;
  readonly value: string;                    // ADR-104: cómo aparece en el documento, sin normalizar
  readonly context?: OccurrenceContext;      // ADR-105: la frase alrededor; ausente = sin contexto
  readonly pageIndex: number;
  readonly bbox: BoundingBox;                // duplicado a propósito: la UI lo necesita sin resolver
  readonly fragments?: ReadonlyArray<BoundingBox>;  // ADR-074 §1; ausente ≡ [bbox]
  readonly source: DetectionSource;
}
```

**Invariantes**
- `context` se copia tal cual de la `Occurrence` (ADR-105). **Ausente ≠ vacío**: una ocurrencia puede nacer sin texto alrededor (agregado manual, página de una sola palabra), y el opcional permite distinguirlo. La UI arma `…{before}` **{value}** `{after}…`; el valor **no** se repite adentro del contexto.
- `value` se copia **tal cual** de la `Occurrence`, sin normalizar (ADR-104 §1): lo que el separador y el fusionador tienen que mostrar es cómo aparece en el documento, que es justamente lo que distingue dos miembros de un grupo fusionado. Requerido y no opcional: toda `Occurrence` tiene `value`.
- `fragments` se copia tal cual de la `Occurrence` (`toOccurrenceRef`, `grouping-engine`), con la semántica de §7: envolvente en `bbox`, descomposición por línea en `fragments`, ausente ≡ `[bbox]`. Es un salto de la cadena `Word → Occurrence → Replacement` y **se propaga explícitamente**: nada viaja solo por una copia de campos (ADR-066 §6, el precedente donde `rotation` se caía en silencio).

---

## 9. `EntityGroup` (unidad central de UI y reemplazo)

```ts
export interface EntityGroup {
  readonly id: string;                              // UUID v4, estable por sesión
  readonly type: EntityType;
  readonly canonicalValue: string;                  // valor "representativo" para mostrar
  readonly members: ReadonlyArray<OccurrenceRef>;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;                // valor ya resuelto (placeholder/synth/mask/redact)
  readonly indexInType: number;                     // 1-based; se renderiza con padding 2: 01, 02, 03
  readonly enabled: boolean;                        // si false, no se aplica reemplazo
  readonly aliases: ReadonlyArray<string>;          // variantes detectadas que se unifican a canonicalValue
  // ADR-060 §2: solo para type === Person. Ausente = sin determinar (no es una
  // tercera categoría: es la falta de información). Se ignora en los demás tipos.
  readonly personGender?: PersonGender;
  // ADR-078 §1: `true` si el `replacementValue` de arriba lo escribió el
  // usuario (y por lo tanto ADR-076 §3 lo protege de todo recálculo
  // automático). NO opcional: no hay estado "sin determinar". De solo
  // lectura — no entra en `GroupUpdatePatch`; para volver al valor calculado
  // se re-aplica el mismo `replacementMode` (ADR-078 §3).
  readonly replacementValueUserSet: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type PersonGender = "f" | "m";
```

**Atributos**

| Atributo | Significado |
|---|---|
| `id` | Estable por sesión. Permite que la UI mantenga estado por grupo tras re-procesamientos. |
| `type` | Uno de `EntityType`. Determina el formato del placeholder y la síntesis. |
| `canonicalValue` | El valor a mostrar en el árbol de entidades. Típicamente el más frecuente de `aliases` o el más completo. |
| `members` | Referencias a las ocurrencias agrupadas. La UI muestra `members.length` como contador. |
| `replacementMode` | `mask \| synthetic \| placeholder \| redact`. |
| `replacementValue` | Valor ya resuelto. Para `placeholder` = `[DNI 01]` — desde ADR-057, el label puede venir abreviado según el ancho disponible del grupo (`[PERS 01]`, `[PRS-01]`); ver §11. Para `synthetic` = valor generado con seed. Para `mask` = `XX.XXX.XXX`. Para `redact` = cadena vacía (la censura es visual, en el render). |
| `indexInType` | Entero 1-based, secuencial y estable por tipo dentro de la sesión. Se renderiza con padding a 2 dígitos. **No se abrevia nunca** (ADR-057 §1) y **no se segmenta por género** (ADR-060 §7): los grupos `Person` comparten una sola secuencia. |
| `enabled` | Si `false`, las ocurrencias del grupo se dejan intactas en el render. |
| `aliases` | Variantes de valor unificadas (ej. `"J. Pérez"` y `"Juan Pérez"` en el mismo grupo). |
| `replacementValueUserSet` | `true` si el `replacementValue` lo escribió el usuario. Es lo que hace visible en la UI (`ui/UX_Guidelines.md` §3.3) una edición manual que, de otro modo, es indistinguible de un valor calculado — el caso que **no** aplica a `personGender`, cuyo valor sí delata su procedencia, y por eso `personGenderUserSet` sigue siendo interno (ADR-078 §2). |
| `personGender` | Solo `type === Person` (ADR-060 §2). `"f"`/`"m"` cambian el label resuelto del `placeholder` (`MUJER`/`HOMBRE` en vez de `PERSONA`); ausente = sin determinar → label neutro y marca en el árbol de entidades. Inferido de un léxico first-party (ADR-069 §6: al asignar/cambiar `canonicalValue` y en `finishSession`) o puesto por el usuario, que gana siempre. **La ausencia tiene dos orígenes que el dato público no distingue** —nunca se infirió, o el usuario eligió `"neutral"` (ADR-069 §4)— y el motor los separa con bookkeeping interno (`personGenderUserSet`, `Grouping_Engine.md` §13 caso 34) para que una re-inferencia no pise la elección. Ese flag **no** es parte de `EntityGroup` ni de ningún evento. |
| `createdAt`, `updatedAt` | Epoch ms. Para UX y merge de ediciones. |

**Invariantes**
- `members.length ≥ 1`.
- `indexInType` es **único** por `(documentId, type)` durante la sesión.
- `canonicalValue ∈ aliases` (el canónico es siempre una de las variantes observadas, salvo edición manual explícita).
- `replacementValue` es consistente con `replacementMode` (ver §11).
- Si `enabled === false`, `replacementValue` no se aplica pero se conserva el último valor para re-activación.
- **Todas** las `Replacement` derivadas de un mismo grupo comparten `replacementValue` (ADR-012, re-asertado por ADR-057 §4: el nivel de abreviatura se elige por grupo con la ocurrencia más apretada y se aplica a todas — nunca por ocurrencia).
- `personGender` solo puede estar presente si `type === EntityType.Person` (ADR-060 §2).

---

## 10. `EntityType`

```ts
export enum EntityType {
  Person = "PERSON",
  Organization = "ORGANIZATION",
  Address = "ADDRESS",
  DNI = "DNI",
  CUIT = "CUIT",
  Phone = "PHONE",
  Email = "EMAIL",
  IBAN = "IBAN",
  CreditCard = "CREDIT_CARD",
  Date = "DATE",
  License = "LICENSE",        // matrícula profesional
  Plate = "PLATE",            // patente
  Custom = "CUSTOM",
}
```

Cada tipo tiene:
- Un label internacionalizable (default español en `ui/Components.md`).
- Un formato de `mask` (ej. DNI → `XX.XXX.XXX`).
- Un formato de `placeholder` (`[<TYPE> <NN>]`).
- Una función de síntesis determinista por seed (en `core/Export_Engine.md` o `shared`).

---

## 11. `ReplacementMode`

```ts
export enum ReplacementMode {
  Mask = "mask",              // censura conservando formato: "XX.XXX.XXX"
  Synthetic = "synthetic",    // valor aleatorio válido, determinista por seed
  Placeholder = "placeholder",// "[DNI 01]"
  Redact = "redact",          // bloque negro sólido sobre bbox (render)
}
```

**Resolución de `replacementValue` por modo**

| Modo | `replacementValue` | Render visual |
|---|---|---|
| `mask` | cadena con formato tipo-dependiente (`XX.XXX.XXX`) | texto censurado sobre bbox |
| `synthetic` | valor sintético válido que preserva formato (`39.123.456`) | texto sintético sobre bbox |
| `placeholder` | `[<LABEL> <NN>]` en uno de **tres niveles** de abreviatura (ADR-057 §1): `[PERSONA 01]` / `[PERS 01]` / `[PRS-01]` | texto placeholder sobre bbox |
| `redact` | `""` (cadena vacía) | bloque negro sólido sobre bbox |

Default: `placeholder`. Justificación en `adr/ADR-012-Replacement-Modes.md`.

**Nivel de abreviatura del `placeholder` (ADR-057)**. El nivel se elige **por grupo**, no por ocurrencia: se toma el primer nivel cuyo token entra —estimado— en **todos** los `members` del grupo, y se aplica a todos. La estimación usa `estimateTokenWidth` (`core/Contracts.md` §6) sobre `bbox.width`/`bbox.height`, magnitudes cuya razón es invariante a la escala, así que el nivel no depende del zoom al que se renderice después. Es una **optimización**: la garantía de que el texto no se derrama vive en el render (ADR-058 §1), no acá. `<NN>` nunca se abrevia. Un `replacementValue` editado a mano por el usuario gana siempre y la escalera no lo toca (ADR-057 §7).

Para `type === Person`, el `<LABEL>` depende además de `personGender` (§9): `PERSONA`/`PERS`/`PRS` sin género, `MUJER`/`MUJER`/`MUJ` femenino, `HOMBRE`/`HOMB`/`HOM` masculino (ADR-060 §3). Los otros tres modos no abrevian: el formato de `mask` **es** la información que transmite, un `synthetic` abreviado deja de ser plausible, y `redact` no tiene texto (ADR-057 §6).

---

## 12. `Replacement`

```ts
export interface Replacement {
  readonly groupId: string;
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly fragments?: ReadonlyArray<BoundingBox>;  // ADR-074 §1; ausente ≡ [bbox]
  readonly originalValue: string;
  readonly replacementValue: string;
  readonly mode: ReplacementMode;
}
```

**Invariantes**
- `groupId` referencia un `EntityGroup` existente y `enabled === true`.
- `occurrenceId` referencia una `Occurrence` que pertenece a ese grupo.
- `replacementValue` es idéntico para todas las `Replacement` del mismo `groupId` (porque el reemplazo es a nivel grupo).
- Para `mode === "redact"`, `replacementValue === ""` y el render pinta de negro **cada fragmento**, no la envolvente.
- `fragments` se copia del `OccurrenceRef` (`buildPageReplacements`, `export-engine`). **Es el último salto de la cadena y el que importa**: quien pinta usa `fragments ?? [bbox]`. Un reemplazo con N fragmentos tapa los N y dibuja el `replacementValue` **una sola vez**, en el fragmento más ancho (ADR-074 §4/§5); los demás se tapan sin texto. La envolvente nunca se pinta.

---

## 13. `Rule`

```ts
export interface Rule {
  readonly id: string;
  readonly scope: RuleScope;
  readonly target: RuleTarget;
  readonly mode: ReplacementMode;
  readonly priority: number;                  // mayor = mayor prioridad
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type RuleScope = "group" | "type" | "global";

export interface RuleTarget {
  readonly kind: RuleScope;
  readonly groupId?: string;                  // si scope === "group"
  readonly entityType?: EntityType;           // si scope === "type"
}
```

**Resolución de modo efectivo por grupo**

Prioridad descendente:
1. Regla con `scope === "group"` y `target.groupId === group.id` (si existe y está habilitada).
2. Regla con `scope === "type"` y `target.entityType === group.type` (si existe y está habilitada, mayor `priority` gana).
3. Regla con `scope === "global"` (mayor `priority` gana).
4. Modo editado manualmente en el grupo (`group.replacementMode`).
5. Default: `placeholder`.

**Invariantes**
- `priority ∈ [0, 1000]`.
- Si `scope === "group"`, `target.groupId` es obligatorio y `target.entityType` debe ser `undefined`.
- Si `scope === "type"`, `target.entityType` es obligatorio y `target.groupId` debe ser `undefined`.
- Si `scope === "global"`, ambos deben ser `undefined`.

---

## 14. `Annotation`

```ts
export interface Annotation {
  readonly id: string;
  readonly groupId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly kind: AnnotationKind;
}

export enum AnnotationKind {
  Highlight = "highlight",       // borde color sobre el bbox del grupo
  Replacement = "replacement",   // muestra el replacementValue
  Redact = "redact",             // bloque negro sólido
  Conflict = "conflict",         // marca de conflicto sobre bbox
}
```

**Invariantes**
- `bbox` coincide con el bbox de alguna `OccurrenceRef` de `members` del `groupId`.
- Una ocurrencia con conflicto tiene `AnnotationKind.Conflict` además de su highlight.

---

## 15. `Conflict`

```ts
export interface Conflict {
  readonly id: string;
  readonly groupId: string;
  readonly reason: ConflictReason;
  readonly candidates: ReadonlyArray<ConflictCandidate>;
  readonly resolved: boolean;
  readonly resolvedType?: EntityType;   // ADR-083 §3: el tipo con el que quedó clasificado el grupo (antes: resolvedMode)
}

export enum ConflictReason {
  Overlap = "overlap",                       // dos entidades comparten bbox
  Disagree = "disagree",                     // Regex y NER asignan tipos distintos al mismo span
  LowConfidence = "low_confidence",          // NER por debajo del umbral
  AmbiguousCanonical = "ambiguous_canonical",// varios aliases con misma frecuencia
}

export interface ConflictCandidate {
  readonly source: DetectionSource;
  readonly entityType: EntityType;
  readonly confidence: number;
  readonly value: string;
}
```

**Invariantes**
- `candidates.length ≥ 2`.
- Si `resolved === true`, `resolvedType` es obligatorio (ADR-083 §3).
- Un conflicto bloquea el export hasta ser resuelto o ignorado explícitamente.

---

## 16. `DetectionSource`

```ts
export enum DetectionSource {
  Regex = "regex",
  NER = "ner",
  OCR = "ocr",                  // OCR no detecta entidades, pero marca la procedencia
  Manual = "manual",            // edición manual del usuario
}
```

---

## 17. `PipelineState` (estado del orquestador)

```ts
export interface PipelineState {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly progress: number;                  // 0..1
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly errors: ReadonlyArray<PipelineError>;
  readonly cancelRequested: boolean;
}

export interface PipelineError {
  readonly stage: PipelineStage;               // etapa en la que ocurrió el error
  readonly code: string;                       // EngineErrorCode del error subyacente
  readonly message: string;
  readonly documentId: string;
}

export enum PipelineStage {
  Idle = "idle",
  Importing = "importing",
  Extracting = "extracting",
  OCRing = "ocring",
  Detecting = "detecting",
  Grouping = "grouping",
  Ready = "ready",
  Rendering = "rendering",
  Exporting = "exporting",
  Done = "done",
  Failed = "failed",
  Cancelled = "cancelled",
}
```

---

## 18. `WorkerJob` (unidad de trabajo del pool)

```ts
export interface WorkerJob {
  readonly id: string;                        // UUID v4
  readonly type: WorkerJobType;
  readonly payload: WorkerJobPayload;         // serializable, Transferable donde aplique
  readonly priority: number;                  // mayor = más prioritario
  readonly signalId: string;                  // referencia al AbortController del host
  readonly createdAt: number;
  readonly retries: number;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export type WorkerJobType =
  | "pdf-parse"
  | "ocr-page"
  | "ner-page"
  | "render-page"
  | "export-page";
```

Payloads concretos por job (forma exacta de `shared/src/types.ts`; `05_Worker_Architecture.md` §2.1 los tipa `unknown` a nivel de transporte y cada worker los afina a estos — ADR-019; documentados acá por P-10, ADR-034 §7):

```ts
export type WorkerJobPayload =
  | PdfParsePayload
  | OcrPagePayload
  | NerPagePayload
  | RenderPagePayload
  | ExportPagePayload;

export interface PdfParsePayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
  readonly pageRange?: ReadonlyArray<number>;
}

export interface OcrPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  // Errata corregida (ADR-036 §4): era ArrayBuffer, que no transporta
  // width/height y el OcrWorker no puede reconstruir la imagen. Coincide con
  // OcrPageInput del motor. Transferencia: postMessage(msg, [imageData.data.buffer]).
  readonly imageData: ImageData;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

// ADR-046 §3/§5: `text` es el texto de UN BATCH de NerConfig.batchSize palabras
// (la partición la hace NerEngine host-side, que es quien tiene las Word[] para
// el bbox; ADR-024 §2). `quantization` y `wasmPaths` viajan en el job porque el
// kernel es quien carga el modelo y configura Transformers.js contra el origen
// propio (ADR-039), y WorkerPool todavía no transporta INIT con la config real.
export interface NerPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly modelId: string;
  readonly quantization: "q8" | "q4" | "f32";
  readonly wasmPaths?: string | NerWasmPaths;
}

export interface RenderPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;
  readonly annotations?: ReadonlyArray<Annotation>;
  readonly scale?: number;
  readonly imageFormat?: "png" | "jpeg";
  // ADR-058 §5: palabras que comparten línea con algún reemplazo de esta página,
  // seleccionadas host-side por una función pura del Orchestrator desde Page.words
  // (precedente de reparto: fuseOcrPage, ADR-041). El kernel las usa para calibrar
  // la tipografía y reposicionar la línea al repintarla.
  // Se adjuntan SOLO cuando algún token podría no entrar (estimado con
  // estimateTokenWidth, ADR-057 §5, con margen conservador). Ausente es el caso
  // normal y nunca es un error: sin ellas el kernel cae al shrink-to-fit de
  // ADR-058 §1. Incluye palabras de OCR (source: "ocr") igual que las de PDF.
  readonly lineWords?: ReadonlyArray<Word>;
}

// ADR-047 §3: la forma previa ({ documentId, pageIndex, pageImage, metadata })
// era inejecutable — sin `imageFormat` el worker no sabe si llamar embedJpg o
// embedPng, y sin las dimensiones en puntos PDF no puede crear la página. La
// `metadata` se mueve a ExportSavePayload, que es donde pdf-lib la aplica (una
// vez, al final) en vez de viajar repetida en cada página.
export interface ExportPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly pageImage: ArrayBuffer;          // EncodedPageImage.bytes, transferido
  readonly imageFormat: "png" | "jpeg";
  readonly pageWidthPt: number;             // document.pages[i].width
  readonly pageHeightPt: number;            // document.pages[i].height
}
```

Payloads del transporte real (Hito 10, ADR-036 §4) que **no** agregan `WorkerJobType` nuevos (los `Readonly<Record<WorkerJobType, …>>` de `WorkerPoolConfig` son totales; agregar claves produciría churn mecánico sin valor — lección ADR-035 §4):

```ts
// Mensaje de control broadcast a cada RenderWorker (no es un job encolable;
// buffer CLONADO por worker — 05_Worker_Architecture.md §2.3/§7.4, ADR-030).
export interface LoadDocumentPayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  // ADR-050: password de un PDF protegido. El kernel lo usa en getDocument y
  // NO lo retiene; el host sí, para re-primear workers (ADR-043 §5).
  // Nunca en logs ni eventos (08_Security_Model.md §6).
  readonly password?: string;
}

// Control broadcast simétrico a load-document (ADR-043 §4): libera el
// PDFDocumentProxy de ese documento en cada RenderWorker a mitad de sesión
// (DOCUMENT_CLOSED). Idempotente, sin transfer. Los controles viajan como RUN
// con jobType "render-page" directo a cada worker, sin cola; el entry-point
// discrimina por forma en el orden de ADR-043 §4.
export interface UnloadDocumentPayload {
  readonly documentId: string;
}

// Rasterización para OCR (ADR-034 §1). Viaja bajo jobType "render-page",
// prioridad 90/40 (espejo de ocr-page), timeouts/retries de render-page.
export interface RasterizePagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly scale: number;
  readonly region?: BoundingBox;              // ADR-065 §5; ausente = página entera
}

// Página de leyenda del export (ADR-059 §5). Viaja bajo jobType "render-page",
// sin WorkerJobType nuevo, y es el QUINTO caso de la discriminación por forma del
// entry-point (ADR-043 §4) — se reconoce por `"rows" in payload`.
// Es el único payload de render-page SIN documentId: no corresponde a ninguna
// página de ningún PDF, es un dibujo puro sobre un OffscreenCanvas en blanco.
// Sin pageProxy, sin pdfjs, sin cache LRU, sin supersede, sin eventos — mismo
// perfil que RasterizePagePayload (ADR-034 §1).
export interface RenderLegendPayload {
  readonly rows: ReadonlyArray<MarkerLegendRow>;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  readonly imageFormat?: "png" | "jpeg";
}

// Job final del ExportWorker bajo jobType "export-page": aplica la metadata (ya
// sanitizada en host, ADR-047 §1) y su COMPLETED devuelve el ArrayBuffer del PDF
// transferido; DISPOSE solo libera (05 §7.5, ADR-036 §4). El entry-point
// discrimina append vs save por forma: `"pageImage" in payload` (ADR-047 §3).
export interface ExportSavePayload {
  readonly documentId: string;
  readonly metadata: ExportMetadata;
  // ADR-059 §6: página de leyenda YA RASTERIZADA (la produce render-engine vía
  // RenderPageProvider.renderLegend, mediado por el Orchestrator). El assembler la
  // embebe con embedPng/embedJpg + addPage + drawImage, igual que una página del
  // documento — el export sigue siendo 100% imagen, sin excepciones.
  // Ausente cuando ExportOptions.includeMarkerLegend === false, o cuando no quedó
  // ninguna fila tras el filtro de §2 (en ese caso no se agrega página).
  // Viaja en `save` y no en `append-page` porque se aplica una sola vez al final,
  // igual que la metadata (ADR-047 §3), y no tiene pageIndex del que ser idempotente.
  readonly legendImage?: EncodedPageImage;
  readonly legendPageWidthPt?: number;
  readonly legendPageHeightPt?: number;
}

// ADR-059 §3: la entrada de la leyenda NO tiene ningún campo capaz de transportar
// contenido del documento — no hay canonicalValue, no hay originalValue, no hay
// Document. Filtrar un valor original a la leyenda no requiere disciplina del
// implementador: requiere cambiar este tipo. Mismo mecanismo que
// `includeOriginalMetadata: false` de ADR-009 (garantía por tipos, no por convención).
export interface MarkerLegendEntry {
  readonly type: EntityType;
  readonly prefixes: ReadonlyArray<string>;   // p. ej. ["PERSONA", "PERS", "PRS"]
  readonly markerCount: number;
}

// ADR-059 §5: lo que efectivamente cruza a render-engine. Strings YA COMPUESTOS:
// el kernel dibuja texto y no ve EntityType ni EntityGroup, así que no gana ninguna
// dependencia semántica sobre el dominio de entidades. La proyección
// MarkerLegendEntry -> MarkerLegendRow vive host-side (buildMarkerLegend).
// ADR-061 §3/§6: pedido de agregado manual. Las tres vías de entrada —diálogo,
// selección sobre el canvas del original, resultado del buscador— construyen el
// mismo objeto; solo cambia de dónde sale el `value`.
export interface ManualEntityRequest {
  readonly value: string;
  readonly entityType: EntityType;
}

// ADR-061 §8: resultado del buscador del visor. Es la MISMA búsqueda literal que
// alimenta el agregado manual, con otra salida — no una implementación paralela.
export interface TextMatch {
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly text: string;
  readonly wordSpan: WordSpan;
}

export interface MarkerLegendRow {
  readonly prefixes: string;    // "PERSONA, PERS, PRS"
  readonly typeName: string;    // "Persona" (label de nivel 0 de ADR-057 §2, en título)
  readonly countLabel: string;  // "7 marcadores"
}

// Salida del kernel del NerWorker (COMPLETED { spans }, ADR-046 §1): spans de
// entidad ya agregados desde los tokens BIO, con offsets relativos al texto del
// batch. Sin bbox, sin wordSpan y sin id: el mapeo a Occurrence lo hace
// NerEngine en el host, que es quien tiene las Word[] de la página.
export interface NerKernelSpan {
  readonly entityType: EntityType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly confidence: number;              // ∈ [0,1], promedio de los tokens del span
  readonly startIndex: number;              // relativo al texto del batch
  readonly endIndexExclusive: number;
}

// Ciclo de vida del modelo NER reportado por el kernel en PROGRESS.partial
// (ADR-046 §4): telemetría de transporte, NO eventos de dominio. El motor la
// traduce en host a NER_MODEL_LOADING / NER_MODEL_READY (uno por instancia) /
// logger.warn. El fraction de descarga viaja en PROGRESS.progress ∈ [0,1].
export type NerKernelProgress =
  | { readonly phase: "model-loading"; readonly modelId: string }
  | { readonly phase: "model-ready"; readonly modelId: string }
  | { readonly phase: "model-load-retry"; readonly modelId: string; readonly reason: string };
```

Ver `05_Worker_Architecture.md` para el detalle de cada job.

---

## 19. `ExportOptions` y `ExportMetadata`

Definidos originalmente en `adr/ADR-009-Export-Strategy.md`; se documentan acá formalmente
(ADR-032 §4; P-10 exige que todo tipo publicado esté documentado en Contracts.md o en un doc
canónico). Forma exacta del código (`shared/src/types.ts`):

```ts
export interface ExportOptions {
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;             // 0..1, default 0.85
  readonly dpi: number;                     // default 150; 300 para "alta calidad"
  readonly includeOriginalMetadata: false;  // SIEMPRE false; el tipo lo fuerza (garantía por tipos, ADR-009)
  readonly title?: string;                  // opcional, metadata nueva
  readonly filename: string;                // default "anonimizado.pdf"
  // ADR-059 §1: página final con la referencia `prefijo → tipo` de los marcadores
  // que ADR-057 pudo abreviar. Default false: sin el flag, el export no cambia en
  // nada. Con el flag, el PDF tiene document.pageCount + 1 páginas.
  readonly includeMarkerLegend: boolean;    // default false
}

export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;
}
```

Sin `author`, `subject`, `keywords` ni XMP del original (`08_Security_Model.md` §5).

---

## 20. Referencias

- `core/Contracts.md` — definiciones TypeScript exactas.
- `04_Event_System.md` — eventos que transportan estos tipos.
- `05_Worker_Architecture.md` — `WorkerJob` detallado.
- `06_Pipeline.md` — ciclo de vida de los datos en el pipeline.
- `adr/ADR-008-Immutability.md` — por qué todo es inmutable.
- `adr/ADR-011-Grouping-First.md` — por qué la UI opera sobre grupos.
- `adr/ADR-012-Replacement-Modes.md` — por qué 4 modos.
