<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/Render_Engine.md,architecture/03_Data_Model.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,ai/Code_Standards.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-063 — El bbox de un `Word` sale de la matriz completa, no de su traslación

- **Estado**: Accepted (**§5 superseded por ADR-066 §6**, 2026-08-10: `BoundingBox` **sí** gana campo de rotación. El argumento de §5 —"el defecto es de cobertura, no de legibilidad"— se apoyaba en que el único texto rotado del documento era una marca de agua que el humano decidió no tapar; al aparecer una firma digital vertical con el nombre del firmante y la fecha, un reemplazo ilegible dejó de ser tolerable. **§4 superseded por ADR-067**, 2026-08-13: el orden de lectura **sí** cambia para texto rotado, y con `BoundingBox.rotation` ya en el modelo el cambio no arrastra a `ocr-engine`. §2 y §3 quedan intactos)
- **Fecha**: 2026-08-09
- **Decidido por**: El humano, tras probar la herramienta sobre una pericia judicial real y encontrar que el reemplazo de una firma vertical se pintaba desplazado, atravesando la página. Pidió medir antes de escribir el ADR.
- **Relacionado con**: ADR-020 §1 (el prorrateo de `x`/`width` por token que este ADR generaliza), ADR-013 §6 (`parsePage` puro, donde vive el cambio), ADR-058 (el repintado de línea, que consume estos bbox)
- **Parte de**: Hito 10.8, paso 1 — precede al paso 2 (OCR de páginas con texto nativo parcial), que es independiente

> Convención de citas: `ADR-063 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-063, Contexto §N`.

## Contexto

### 1. `convertTextItemsToWords` descarta cuatro de los seis coeficientes de la matriz

PDF.js entrega por cada `TextItem` una `transform` de seis números: `[a, b, c, d, e, f]`. `(e, f)` es la traslación —dónde arranca la línea de base— y `[a, b, c, d]` es la parte lineal, que es donde vive la rotación, la escala y el sesgo. El motor lee solo la traslación (`pdf.engine.ts`, ADR-020 §1):

```ts
const x = item.transform[4] ?? 0;
const baselineY = item.transform[5] ?? 0;
const y = pageHeight - baselineY - height;
```

De ahí en adelante todo asume que el texto avanza sobre el eje X: el alto se resta como si la caja creciera hacia arriba en vertical, y el prorrateo por token reparte `charWidth * offset` sobre `x`. Para texto horizontal —que es el 99% de cualquier documento— eso es correcto. Para texto rotado produce una caja con las dimensiones intercambiadas y el origen corrido.

### 2. Lo que eso hace en un documento real, medido

La pericia que disparó este ADR tiene un sello vertical de 19 caracteres, con matriz `[0, 16, -16, 0]` —90° exactos, cuerpo 16—, presente en las cinco páginas. Sobre la página 1 (596×842 pt):

| | x | y | ancho | alto |
|---|---|---|---|---|
| Geometría real | 30 | 269 | **16** | **173** |
| Lo que calcula el motor | 46 | 426 | **173** | **16** |

Una franja vertical de 16 pt en el margen izquierdo contra una franja horizontal de 173 pt. **No se solapan**: comparten un vértice y nada más. Y la caja errónea invade la imagen de la firma, que empieza en x=142 — que es exactamente la barra negra atravesada que reportó el humano.

### 3. No es un caso exótico: es cómo se firman los expedientes

El texto rotado no aparece por accidente. Los sellos de firma digital, las marcas de agua y los folios laterales de los expedientes judiciales se dibujan rotados 90° sobre el margen, y aparecen en **todas** las páginas del documento, no en una. En la pericia medida, las cinco páginas lo tienen. Cualquier entidad que se detecte dentro de uno de esos elementos hoy se censura en el lugar equivocado.

### 4. El modelo no tiene dónde guardar una rotación, y para este defecto no hace falta

`BoundingBox` (`Contracts.md`) es `{ x, y, width, height }` axis-aligned, y `render-engine` pinta `fillRect` + texto horizontal. Podría parecer que arreglar esto exige un campo de rotación en el contrato. No: **para 0°, 90°, 180° y 270° el rectángulo que ocupa el texto sigue siendo axis-aligned** — lo único que cambia es cuál de las dos dimensiones es el avance y dónde queda el origen. Tapar el área correcta no requiere tocar el contrato. Lo que sí lo requeriría es pintar el *token de reemplazo* rotado dentro de esa caja alta y angosta, que es un problema de legibilidad distinto y posterior.

## Decisión

### 1. La geometría del `Word` se deriva de la matriz completa

`convertTextItemsToWords` pasa a usar `[a, b, c, d]` además de `(e, f)`. De la matriz se obtienen dos versores:

- **avance** `dir = (a, b) / |(a, b)|` — la dirección en la que corren los glifos.
- **ascenso** `up = (c, d) / |(c, d)|` — la dirección en la que crece el cuerpo.

`item.width` sigue siendo el avance total del run y `item.height` el cuerpo, ambos escalares positivos, **medidos sobre esos ejes y no sobre X/Y** (verificado contra `pdfjs-dist` 4.10.38 sobre el sello de 90°: `width = 173`, `height = 16`).

### 2. El bbox es la envolvente axis-aligned del paralelogramo del run

Con origen en la línea de base `(e, f)`, el run ocupa el paralelogramo `p0 → p0 + dir·width → + up·height`. El `BoundingBox` es la envolvente axis-aligned de esos cuatro vértices, convertida a origen arriba-izquierda con `y = pageHeight - yMax`.

Dos propiedades que hacen segura esta definición:

- **Para 0° se reduce exactamente a la fórmula actual.** Con `dir = (1,0)` y `up = (0,1)`, la envolvente da `x ∈ [e, e+width]` e `y = pageHeight - f - height`, que es carácter por carácter lo que el motor calcula hoy. El texto horizontal no cambia de bbox: no hay regresión posible, y los snapshots existentes se mantienen.
- **Para 90°/180°/270° es exacta**, no una aproximación: el paralelogramo ya es un rectángulo alineado a los ejes.

Para ángulos arbitrarios (una marca de agua diagonal, p. ej.) la envolvente es **conservadora**: cubre más área que los glifos. Se acepta — para el propósito de censura, cubrir de más nunca deja un dato expuesto, y el caso está anotado como riesgo en §6.

### 3. El prorrateo por token se hace sobre el eje de avance

El split por whitespace de ADR-020 §1 se conserva íntegro, incluida la aproximación de ancho de carácter constante dentro del run. Lo único que cambia es el eje: el desplazamiento de cada token deja de ser `x + charWidth · offset` y pasa a ser `p0 + dir · (charWidth · offset)`. Para 0° las dos expresiones son idénticas.

### 4. El orden de lectura no cambia — **SUPERSEDED por ADR-067**

> **Superseded (2026-08-13, ADR-067)**: el orden de lectura **sí** cambia, para texto rotado. Los dos argumentos de esta sección cayeron: (a) *"arrastra a `ocr-engine`"* — `ocr-engine` nunca puebla `bbox.rotation`, así que un orden que se ramifica por ese campo no lo alcanza; (b) *"en ningún caso el texto vertical se concatenaba bien"* — cierto para una marca de agua de dos tokens, falso para un run de cinco palabras que contiene el nombre de quien firma, que sale disperso y sin grupo de Persona. La señal que faltaba —`BoundingBox.rotation`— la agregó ADR-066 §6, posterior a este ADR. Ver ADR-067, Contexto §3. El texto original queda abajo.

`words` sigue ordenado por `bbox.y` asc y luego `bbox.x` asc. El invariante de `03_Data_Model.md` §115 y de `OCR_Engine.md` queda **intacto**.

Es una decisión deliberada, no un olvido. Un orden consciente de columnas —que agrupe el texto vertical aparte del horizontal antes de concatenar `Page.text`— mejoraría la entrada de NER en páginas con sellos laterales, pero cambia un invariante compartido con `ocr-engine` y con el modelo de datos, o sea que arrastra a dos motores más y contradice R-1. Queda como trabajo separado. Corregir el bbox no lo empeora: hoy el sello ya cae en una posición arbitraria del orden (por su `y` errónea) y después caerá en otra igualmente arbitraria (por su `y` correcta); en ningún caso el texto vertical se concatenaba bien.

### 5. `BoundingBox` no gana campo de rotación — **SUPERSEDED por ADR-066 §6**

> **Superseded (2026-08-10, ADR-066 §6)**: la decisión de abajo se revierte. Su premisa era que el reemplazo ilegible sobre texto rotado era tolerable porque el único texto rotado del corpus medido era una marca de agua que no había que tapar. La prueba sobre el documento real encontró una **firma digital vertical con el nombre de quien firma y la fecha** —datos que sí hay que tapar— y sobre una franja de 16×173 pt el token se encoge hasta el piso de 8 px y se recorta igual. `BoundingBox` gana `rotation?: 0|90|180|270`, ausente ≡ 0. El resto de este ADR (§1-§4, §6, §7) **no cambia**.

El contrato de `Contracts.md` no se toca (§4 del Contexto). El pintado rotado del token de reemplazo dentro de una caja alta y angosta queda **fuera de alcance**: es un problema de legibilidad —el reemplazo entra pero se lee mal—, no de cobertura, y ADR-058 §1 ya garantiza por shrink-to-fit que nada se derrame fuera del rectángulo. Cuando se aborde, necesita su propio ADR y toca `shared` + `render-engine` + `export-engine`.

### 6. Riesgo latente que este cambio activa, documentado y no mitigado

Un bbox correcto cae donde el texto realmente está. Si ese texto está **encima de otro texto** —un sello o una marca de agua sobre el cuerpo del documento— tapar la entidad tapa también lo que hay debajo. Medido sobre la misma pericia, contando cuántos items ajenos intersecta la caja del sello vertical:

| página | con bbox correcto | con el bbox actual |
|---|---|---|
| 1 | 0 / 7 items | 0 / 7 |
| 2 | **10** / 217 items | 2 / 217 |
| 3 | **14** / 126 items | 1 / 126 |

O sea: hoy la caja pisa poco **por accidente**, porque está mal puesta. Al corregirla, si algo dentro de ese sello se detectara como entidad, se taparían 10-14 fragmentos de texto real por página.

**No se construye ninguna mitigación en este ADR**, por decisión explícita del humano. Razones: en el documento medido nada dentro del sello se detecta (ningún patrón de `default-ar.ts` matchea su forma `LLL_LDDDDDDDDDDDDDD`, y el mapa de labels de `ner-engine` solo cubre `PER`/`ORG`/`LOC`), así que el riesgo es latente y no activo; la app ya tiene la válvula de escape —el grupo se puede deshabilitar y el preview muestra el resultado antes de exportar—; y la heurística obvia para automatizarlo ("si un string se repite en todas las páginas es boilerplate, ignoralo") es insegura, porque un pie de página con el nombre del fiscal también se repite en todas las páginas. Queda registrado acá para que, el día que un documento real lo dispare, el diagnóstico ya esté hecho.

### 7. Discrepancia detectada y **no** resuelta: rotación a nivel de página

`Render_Engine.md` §13 caso 15 afirma: *"Los bbox están en coords de página ya rotada (lo garantiza PDF Engine)"*. El motor no lo garantiza: usa `transform[4]`/`[5]` crudos, en espacio de usuario, y nunca aplica `viewport.transform`. Para un PDF con `/Rotate 90` a nivel de página las coordenadas también saldrían mal.

Es una contradicción doc↔código **preexistente** e independiente del texto rotado de este ADR. No se resuelve acá y no se cambia ninguno de los dos documentos: las cinco páginas de la pericia medida tienen `rotate = 0`, o sea que no hay ni un dato para calibrar, y decidir a ciegas contradice `AI_Development_Guide.md` §5. Requiere su propio ADR, precedido de una medición sobre un PDF con `/Rotate ≠ 0`.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Envolvente axis-aligned del paralelogramo | Agregar `rotation` a `BoundingBox` y pintar rotado | Cambia el contrato público y arrastra `shared` + `render-engine` + `export-engine` (R-1, R-2) para resolver un problema de **legibilidad**, cuando el defecto reportado es de **cobertura**. Para 90°/270° la envolvente ya es exacta: el rectángulo negro queda donde va sin tocar una línea de contrato. |
| Envolvente axis-aligned del paralelogramo | Detectar solo 90°/270° y dejar el resto como está | La detección por ángulo exacto necesita un umbral arbitrario y falla en silencio fuera de él. La envolvente cubre todos los ángulos con una sola expresión y es conservadora donde no es exacta — para censura, cubrir de más es el lado seguro del error. |
| Conservar el orden `y` asc → `x` asc | Orden por columnas cuando la página tiene texto vertical | Cambia un invariante que `03_Data_Model.md` §115 y `OCR_Engine.md` comparten, o sea dos motores más en el mismo PR (R-1, R-5). Y no es una regresión: el texto vertical nunca se concatenó bien, ni antes ni después. |
| Conservar el split por whitespace de ADR-020 §1 | Aprovechar el cambio para ir a granularidad de glifo | ADR-020 ya evaluó y descartó la API por glifo de pdf.js (no estable en la versión fijada por ADR-001); nada de lo medido acá cambia ese análisis. |
| Documentar el riesgo de solapamiento sin mitigarlo | Excluir de la detección el texto que se repite en todas las páginas | "Se repite" no implica "no es sensible": un pie de página con el nombre del fiscal cumple la misma condición y **sí** hay que taparlo. La heurística cambiaría un falso positivo visible por un falso negativo silencioso, que es el peor de los dos. |
| Dejar la rotación de página como discrepancia abierta | Arreglarla en este mismo ADR aplicando `viewport.transform` | Cero datos: las páginas medidas tienen `rotate = 0`. Decidir sin medición es exactamente lo que `AI_Development_Guide.md` §5 prohíbe, y el resto de este ADR se apoya en números reales. |

## Consecuencias

**Positivas**:

- El rectángulo de censura cae sobre el texto rotado que le corresponde. Es el defecto reportado, y se cierra sin tocar ningún contrato público.
- El texto horizontal conserva bbox idéntico al actual (§2), así que el cambio no puede regresionar el 99% del corpus. Los snapshots existentes siguen válidos sin regenerarse.
- La expresión nueva es única para todos los ángulos: no hay una rama por caso ni un umbral de detección de rotación que pueda fallar en silencio.
- El motor deja de producir bbox que invaden áreas donde el texto no está — que era una vía de tapar contenido ajeno *por error de cálculo*, distinta e independiente del solapamiento legítimo de §6.

**Negativas**:

- Para ángulos arbitrarios la envolvente cubre más área que los glifos. Aceptado: sobre-cubrir no expone datos, y el caso no aparece en ningún documento medido.
- El cambio **activa** el riesgo de §6: donde la entidad esté físicamente encima de otro texto, la caja correcta tapa más contenido ajeno que la caja errónea de hoy. Es la consecuencia inevitable de pintar donde corresponde, queda documentada y sin mitigación por decisión del humano.
- `Page.text` sigue concatenando el texto vertical en una posición arbitraria del orden de lectura (§4). No es una regresión, pero el hueco queda abierto.
- La discrepancia de §7 sigue abierta: `Render_Engine.md` §13 caso 15 promete una garantía que el motor no da.

## Validación

- Test unit nuevo: un `TextItem` con matriz `[0, s, -s, 0, e, f]` (90°) produce un bbox de `width = item.height` y `height = item.width`, con el origen en la envolvente correcta.
- Test unit nuevo: 180° y 270° producen la envolvente correcta.
- Test unit nuevo: **no regresión** — un `TextItem` con matriz `[s, 0, 0, s, e, f]` produce exactamente el mismo bbox que la fórmula anterior.
- Test unit nuevo: el prorrateo por token de un run rotado 90° desplaza los tokens sobre el eje de avance (`y` decreciente en coords arriba-izquierda), con `x` constante.
- Test unit nuevo: una matriz de ángulo arbitrario (45°) produce una envolvente que contiene los cuatro vértices del paralelogramo.
- Test edge nuevo: matriz degenerada (`a = b = 0`) no divide por cero y cae al comportamiento horizontal.
- Snapshot existente de `snapshot.test.ts`: **sin regenerar**. Si cambia, el cambio rompió texto horizontal y es un bug.
- Cobertura ≥ 85% líneas en `packages/anonymization-core/pdf-engine/src/**`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/PDF_Engine.md` §12, §13, §14 (versión 1.5.0)
- `core/Contracts.md` (`BoundingBox`, `Word` — **no se modifican**)
- `architecture/03_Data_Model.md` §115 (invariante de orden de lectura, conservado)
- `core/Render_Engine.md` §13 caso 15 (discrepancia abierta, §7)
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md` §6 (`parsePage` puro)
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` §1 (split por whitespace y prorrateo, generalizados acá), §2 (NFC, intacto)
- `adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md` §1 (shrink-to-fit: por qué la legibilidad del token rotado no es urgente)
- `ai/AI_Development_Guide.md` R-1, R-2, R-5, R-19, R-21, §5 (ambigüedad)
