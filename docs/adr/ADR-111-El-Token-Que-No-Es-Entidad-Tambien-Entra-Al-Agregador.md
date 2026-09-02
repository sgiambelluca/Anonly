<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Contracts.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-088-El-Texto-Que-Recibe-El-NER.md,adr/ADR-098-El-Lote-Se-Corta-En-Tokens-No-En-Palabras.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-111 — El token que no es entidad también entra al agregador

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, tras ver en la herramienta **tres párrafos de un fallo escaneado agrupados como una sola persona**, y pedir que se midiera antes de tocar nada.
- **Relacionado con**: **ADR-046 §1** (la "equivalencia simplificada de `aggregation_strategy`" que este ADR termina de cumplir), **NER_Engine.md v1.3.1** (un subword no puede *empezar* una entidad — este ADR cierra el caso hermano), ADR-088 §2 (Title Case solo para inferir), ADR-098 §3 (offsets del sub-lote), ADR-074 §2 (`fragments` por línea, que es quien consume estos offsets)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Una entidad de 785 caracteres, y no es un nombre

Sobre la página 15 de un fallo escaneado, el motor emite una `Person` que arranca en el sello del encabezado y termina catorce líneas después, en una cita doctrinaria:

```
[PERSON] len=785  «DE SALAI CASACIÓN Las conductas reiteradas, apreciadas objetivamente,
                   tienen una desproporción con el tipo básico del art. 119 del Código
                   Penal, … (conf. D'Amoroso»
```

En la UI son tres párrafos en una sola fila del árbol de entidades. No es un caso aislado: sobre 8 documentos (115 páginas) hay **19 spans de más de 40 caracteres**, y 16 de ellos son de esta clase.

### 2. El pipeline entrega 21 tokens para 1887 caracteres

`TokenClassificationPipeline._call` de `@huggingface/transformers` 4.2.0 arranca así:

```js
async _call(texts, { ignore_labels = ['O'], aggregation_strategy = 'none' } = {}) {
    …
    if (ignore_labels.includes(entity)) continue;
```

**Por default descarta todos los tokens `O`.** Medido sobre esa misma página: el pipeline devuelve **21** tokens para 1887 caracteres de texto; pidiéndole `ignore_labels: []` devuelve **466**.

Este motor nunca le pasó opciones (`activeClassifier(text)`), así que siempre trabajó con el 4,5 % de los tokens.

### 3. El agregador está escrito para verlos, y el posicionador depende de ellos

Los dos consumidores de esos tokens asumen la secuencia completa:

- **`aggregateTokensToSpans`** cierra el span abierto exactamente en esa rama:

  ```ts
  if (label === null || !(label in LABEL_TO_ENTITY_TYPE)) {
    flush();
    continue;
  }
  ```

  Con los `O` filtrados **esa rama no se ejecuta nunca**. Un span solo se cierra si aparece otro `B-` o un `I-` de otro tipo; si no, sigue abierto hasta el final del lote.

- **`positionTokens`** ubica cada token con `chunkText.indexOf(cleaned, cursor)` y un cursor que solo avanza. Su comentario dice que eso "evita coincidencias espurias hacia atrás" — y es cierto, pero **no evita las de adelante**, y sin los `O` no queda ninguna ancla entre entidad y entidad.

Las dos cosas se componen, y así se fabrica el span de §1. La secuencia de tokens dentro de él es:

```
B-PER "D" | I-PER "'" | I-PER "Amo" | I-PER "roso"
```

O sea: `D'Amoroso`, que ocupa `[868, 877)` — el span medido es `[92, 877)`, 785 caracteres, y termina justo ahí. El `B-PER "D"` se ubicó en el offset **92**, sobre la `D` de `DE SALAI`, porque era la primera `D` después del cursor. Y como después no hubo ningún `O`, nada cerró el span entre las dos posiciones.

**Ni un solo token se descarta por no poder ubicarse** (0 de 21 con el default, 0 de 466 con todos): el problema no es que se pierdan tokens en el camino, es que **el 95 % nunca llega**.

Por qué no se vio antes: en texto nativo limpio dos entidades consecutivas suelen estar cerca y la búsqueda hacia adelante acierta de casualidad. Que "acierte de casualidad" no es una propiedad; los 19 spans gigantes medidos son la parte en que dejó de acertar.

### 4. Una continuación de wordpiece con otra etiqueta sigue abriendo entidad

`NER_Engine.md` v1.3.1 cerró un caso de esta familia: un `B-` sobre una continuación (`##presa`) no abre span. Falta el hermano — la condición completa es:

```ts
if (isBegin || open === null || open.label !== label) {
```

y `open.label !== label` **sí** dispara sobre una continuación cuando el modelo le cambia la etiqueta a mitad de palabra. Medido:

| impreso | lo que emite el motor hoy |
|---|---|
| `Florencio Varela` | `Address "Floren"` + `Organization "cio Varela"` |
| `Quilmes` | `Address "Qui"` + `Organization "lmes"` |
| `CARRAL` | `Person "CA"` + `Address "R"` + `Person "RA"` + `Address "L"` |
| `Echeverría` | `Person "Echeve"` + `Address "rría"` |
| `MAIDANA Ricardo Ramón` | `Organization "MAID"` + `Person "ANA Ricardo Ramon"` |

Son **48 spans mal cortados** sobre los mismos 8 documentos. Cada uno es un dato que se tapa a medias: `Echeve` tapado y `rría` a la vista.

### 5. Y aun con esa regla, un span puede empezar a mitad de palabra

Cuando el primer subtoken de la palabra sale `O` y el segundo abre entidad, no hay span abierto que extender y el nuevo nace a mitad de palabra (`Ju` `##gado` → `Organization "gado"`). Con la regla de §4 quedan **26** de los 48.

## Decisión

### 1. La inferencia pide todos los tokens: `ignore_labels: []`

`classifyWithTimeout` invoca `activeClassifier(text, { ignore_labels: [] })`. No se toca `aggregation_strategy`: la agregación BIO sigue siendo la de este kernel, porque la nativa de la librería devuelve solo `word` decodificado **sin offsets de carácter** (`// TODO: Add support for start and end` en `token-classification.js`), y sin offsets no hay `bbox`.

Esto no agrega un mecanismo: **restaura la precondición** que `aggregateTokensToSpans` y `positionTokens` ya suponían.

### 2. Una continuación de wordpiece nunca abre un span

```ts
if (isBegin || open === null || (open.label !== label && !token.isContinuation)) {
```

Un `##token` con etiqueta distinta **extiende** el span abierto en vez de abrir uno nuevo. Es la misma regla de v1.3.1 llevada a su forma completa: un subword no empieza una entidad, ni con `B-` ni cambiando de tipo. Con `open === null` sigue abriendo, porque ahí no hay nada que extender — ese resto lo cubre §3.

### 3. El borde de un span se lleva al borde de palabra

Dos pasos, en este orden.

**(a) Dos spans del mismo tipo dentro de una misma palabra son la misma entidad.** Se fusionan si entre los dos no hay **ningún** carácter que no sea de palabra; un espacio, una coma o un guion significan dos palabras, y dos palabras pueden ser dos entidades. La confianza del resultado es la del trozo **más largo**, no el promedio: la letra suelta que el modelo dudó no tiene por qué arrastrar hacia abajo la confianza de la palabra entera.

Este paso existe porque el `O` que §1 pone de vuelta en circulación abre un caso nuevo: `Ju` `##z` `##gado` con la `z` sin etiquetar cierra el span y abre otro, y quedan `Organization "Ju"` y `Organization "gado"` — el modo de falla de v1.3.1 por otra puerta. Medido sobre un oficio real; es lo último que quedaba en la métrica de fragmentos.

**(b) Cada span extiende su inicio hacia atrás y su fin hacia adelante** mientras el carácter contiguo sea `\p{L}` o `\p{N}`, **sin pisar al span vecino** (el inicio se topa contra el fin del anterior y el fin contra el inicio del siguiente; los spans salen del agregador ordenados y sin solaparse, así que el clamp mantiene esa invariante). Dos spans de **tipos distintos** dentro de una misma palabra no se fusionan y el clamp los frena uno contra el otro — que es lo correcto mientras el modelo diga que son entidades distintas.

La regla que codifica es la del producto, no la del modelo: **una entidad tapa palabras enteras**. Media palabra tapada no protege nada y además se ve peor que no tapar.

## Consecuencias

**Medido antes de implementar**, sobre 8 documentos / 115 páginas: el fallo escaneado (20 p, por OCR), dos pericias, una apelación, un oficio, dos fallos nativos y un cuento. Métricas **externas al motor** —no le preguntan al motor si está conforme consigo mismo—:

- *fragmento*: el span empieza o termina con una letra o dígito pegado del lado de afuera. Una entidad correcta nunca corta una palabra.
- *gigante*: más de 40 caracteres. Un nombre propio de más de 40 caracteres existe, pero es raro; un párrafo no es una entidad.

| variante | spans | fragmentos | gigantes | caracteres tapados |
|---|---|---|---|---|
| **hoy** | 721 | **48** | **19** | 12.901 |
| solo §1 (`ignore_labels`) | 736 | 53 | **3** | 7.778 |
| solo §2 (continuación) | 707 | **20** | 19 | 12.905 |
| §1 + §2 | 723 | 26 | 3 | 7.775 |
| **§1 + §2 + §3** (medido sobre el motor ya implementado) | 722 | **0** | **3** | 7.849 |

Los **3 gigantes que quedan son correctos** y por eso no se persiguen: `Cámara de Apelación Civil y Comercial de Trenque Lauquen`, `Oficina del Alto Comisionado de las Naciones Unidas`, `SUPREMA CORTE DE JUSTICIA SECRETARIA PENAL`.

Punta a punta sobre el fallo escaneado (19 páginas con texto):

| | hoy | con este ADR |
|---|---|---|
| spans gigantes | 2 | **0** |
| spans cortados a mitad de palabra | 13 | **0** |

**Costo de tiempo: ninguno medible.** 51 páginas de un fallo nativo: 8,4 s con el default, 6,3 s con `ignore_labels: []` — la diferencia está dentro del ruido de dos corridas. El lote se sigue partiendo por presupuesto de tokens (ADR-098), así que el pico de tokens por inferencia no cambia; lo único que crece es el array que vuelve del pipeline, que se recorre una vez.

**En contra**

- **§1 parte spans que hoy salen unidos**, y no todos por error: un nombre con partícula (`Juan de la Cruz`) queda a merced de cómo el modelo etiquete `de` y `la`. Es el comportamiento que el agregador siempre quiso tener —cerrar en `O`— y el neto medido es 721 → 736 spans con 5.123 caracteres menos tapados; pero la partícula suelta es un modo de falla nuevo que antes no existía. Grouping vuelve a unir por alias las apariciones del mismo nombre, no los fragmentos de una.
- **§3 cambia el `value` del span** cuando extiende: `Gual` dentro de `Gualeguaychú` pasaría a `Gualeguaychú`, y ese valor es el que viaja al `canonicalValue` del grupo. Es la dirección correcta para tapar y la incorrecta para agrupar si el modelo se equivocó de palabra.
- El umbral de 40 caracteres de la métrica *gigante* **no** es un umbral del motor: es de la medición. No se codifica en ningún lado.

**Lo que este ADR no toca**: `NerKernelSpan` ni ningún contrato público, `computeWordChunks` (ADR-088 §1 / ADR-098), `mapSpanToWords` y sus `fragments` (ADR-074), el Title Case de ADR-088 §2, y el reparto host/kernel de ADR-046. Todo el cambio vive dentro de `ner-engine/src/worker/kernel.ts`.

## Qué hay que cubrir con tests

- Dos entidades del mismo tipo separadas por texto sin etiquetar: salen **dos** spans, no uno que abarque el medio. Es §1, y falla si se le sacan los `O` al doble del pipeline.
- Un token cuyo texto aparece **antes** en el chunk que su posición real: se ubica en la posición correcta gracias a los `O` intermedios (el caso `D'Amoroso` de §3 del contexto, reducido).
- Una continuación con etiqueta distinta a la del span abierto **extiende** el span (`Floren` + `##cio` con otra etiqueta → un solo span `Florencio`).
- Un `B-` que no es continuación sigue abriendo span: dos entidades pegadas siguen siendo dos (no regresión de v1.3.1).
- Un span que arranca a mitad de palabra se extiende hasta el borde, y **no** invade al span vecino cuando el vecino termina justo ahí.
- Dos spans del mismo tipo dentro de una misma palabra se fusionan (`Ju` + `gado` → `Juzgado`), y la confianza resultante es la del trozo más largo.
- Dos spans del mismo tipo separados por un espacio **no** se fusionan: dos palabras pueden ser dos entidades.
- Un span que ya cae en bordes de palabra no se mueve (§3 es no-op en el caso común).
