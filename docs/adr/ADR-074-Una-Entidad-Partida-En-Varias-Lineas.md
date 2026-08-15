<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Regex_Engine.md,core/NER_Engine.md,core/Grouping_Engine.md,core/Render_Engine.md,core/Export_Engine.md,core/Orchestrator.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md | audiencia=humanos+IA | fase=10.9 -->

# ADR-074 — Una entidad partida en varias líneas se tapa por línea, no con su envolvente

- **Estado**: Accepted
- **Fecha**: 2026-08-15
- **Decidido por**: El humano, al tomar los puntos 1, 2, 4, 4bis y 10 de `roadmap/Post_Hito10.8_Pendientes.md` como Hito 10.9. El defecto se midió sobre la pericia judicial real en la segunda prueba manual del Hito 10.8 (`Post_Hito10.8_Pendientes.md` §2).
- **Relacionado con**: **ADR-063** (la primera falla de esta misma clase —censura que cubre lo que no debe— por otra causa: la matriz de rotación), **ADR-066 §6** (el precedente exacto del modo de falla de este ADR: un campo que "viaja solo" por una unión de bboxes y se cae en silencio), ADR-057 §4 (la escalera elige nivel con `members[].bbox`), ADR-058 §1/§5 (shrink-to-fit y repintado de línea, que operan sobre un rectángulo por reemplazo), ADR-061 §2 (`sharesVerticalBand` en `@anonly/shared`, la primitiva que este ADR reusa), ADR-020 §1 (`Page.words` separa por whitespace)
- **Parte de**: Hito 10.9, PRs 3 a 11

> Convención de citas: `ADR-074 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-074, Contexto §N`.

## Contexto

### 1. Una barra negra que atraviesa el documento

Medido el 2026-08-13 sobre la pericia de 5 páginas, página 2: NER detecta la entidad `Pablo Román Fortes`. `Pablo` cierra una línea (`x = 524,4`) y `Román Fortes,` abre la siguiente (`x = 14,0`). El bbox que se emite mide **557,2 × 18,2 pt** — prácticamente el ancho útil de la página, dos líneas de alto. En el panel anonimizado es una barra que cruza el documento entero y destruye el texto de las dos líneas, casi todo él ajeno a la entidad.

### 2. La causa: un `BoundingBox` no puede expresar dos rectángulos

`mapSpanToWords` (`regex-engine/src/regex.engine.ts`, y su copia adaptada en `ner-engine`) calcula **un** bbox como min/max sobre las `Word` del match:

```text
minX = min(word.bbox.x)   maxX = max(word.bbox.x + width)
minY = min(word.bbox.y)   maxY = max(word.bbox.y + height)
```

Con las palabras repartidas en dos líneas, esa unión es la **envolvente**: un rectángulo que va desde la izquierda de una hasta la derecha de la otra, y cubre las dos alturas y todo lo que hay en el medio. La función no está mal: `Occurrence.bbox` es un `BoundingBox`, y la envolvente es el único rectángulo que contiene al match. El problema es que un rectángulo no alcanza para describir dónde está la entidad.

### 3. Tapa de más, nunca de menos — y por eso este ADR no es urgente pero sí grave

No hay fuga: la envolvente **contiene** a la entidad, así que el dato sensible queda tapado. Lo que se destruye es contenido no sensible: en el caso medido, dos líneas completas de una pericia judicial. Un documento anonimizado que borra párrafos enteros deja de servir para lo que se lo anonimiza.

Es la misma clase de falla que ADR-063 —censura que cubre lo que no debe— por otra causa, y conviene tenerlas juntas: acá el bbox es **correcto** (contiene la entidad) y sin embargo el resultado es malo. La corrección de un rectángulo no es una propiedad suficiente.

### 4. Por qué no tiene arreglo local

`Occurrence.bbox` es **un** `BoundingBox` y viaja por toda la cadena: `Occurrence` → `OccurrenceRef` (dentro de `EntityGroup.members`) → `Replacement` → el canvas. Expresar "un rectángulo por línea" es un cambio de contrato que toca `shared`, los dos motores que producen ocurrencias, el que las agrupa, el que arma los reemplazos y el que pinta. No hay un lugar donde arreglarlo solo.

### 5. El precedente que dice exactamente cómo se rompe esto

ADR-066 §6 agregó `rotation` a `BoundingBox` y justificó que "viajaría solo" por la cadena `Word → Occurrence → Replacement`. **No viajaba**: la unión de `mapSpanToWords` construye un `BoundingBox` **nuevo** a partir de escalares, y el campo se caía en silencio. El pintado rotado nunca se activaba, con todos los tests unitarios en verde, y el defecto llegó a prueba manual.

Este ADR agrega otro dato geométrico a la misma cadena y por los mismos puntos. La lección se aplica literalmente: **nada "viaja solo"**, cada salto se propaga explícitamente y cada salto tiene su test.

### 6. Cuántas entidades toca esto de verdad

Solo las que cruzan un salto de línea, y ninguna otra. En la pericia medida, sobre las entidades de las cinco páginas, una. Pero es una entidad **de NER, de tipo `Person`**, que es el caso más común y el más sensible del producto, y el daño de cada ocurrencia es de dos líneas de texto ajeno. La frecuencia es baja; la severidad, por ocurrencia, es alta.

Vale anotar qué **no** entra: `findLiteral` (ADR-061) exige `sharesVerticalBand` entre palabras consecutivas, así que una entidad agregada a mano **nunca** cruza de línea por construcción (`Regex_Engine.md` §13 caso 16). Este defecto es exclusivo de la detección automática, que corre sobre `Page.text` y no sobre ventanas de una línea.

## Decisión

### 1. `fragments`: la descomposición por línea, al lado del bbox que ya existe

Los tres tipos que hoy llevan un `BoundingBox` de ocurrencia ganan un campo opcional:

```ts
readonly fragments?: ReadonlyArray<BoundingBox>;
```

en `Occurrence` (`03_Data_Model.md` §7), `OccurrenceRef` (§8) y `Replacement` (§12).

Semántica, y es toda la decisión:

- **`bbox` sigue siendo la envolvente** y conserva **todos** sus usos actuales sin excepción: orden documental de ADR-028, detección de conflictos por solapamiento, hit-test, miniatura del diálogo de división, `wordSpan`. Nada que hoy lea `bbox` cambia de significado ni de valor.
- **`fragments`, cuando está presente, es dónde está realmente la entidad**: un rectángulo por línea, en orden de lectura (`y` asc, `x` asc). **Todo lo que pinte** usa `fragments ?? [bbox]` y nunca la envolvente sola.
- **Ausente ≡ `[bbox]`**, exactamente la convención de `rotation` (ADR-066 §6, "ausente ≡ 0"). El caso de una sola línea —el 99% de las ocurrencias— no lleva el campo y produce **el mismo byte** que hoy.
- **`fragments.length ≥ 2` siempre que esté presente.** Un array de un elemento no existe: sería la envolvente escrita dos veces, y dos representaciones del mismo estado es exactamente lo que hace que una de las dos se desactualice.

Invariantes, que son test de contrato (§8):

1. `bbox` es la envolvente de `fragments`: `min`/`max` sobre los cuatro bordes coincide, sin tolerancia.
2. Cada `Word` del match está contenida en exactamente un fragmento; los fragmentos no se solapan verticalmente.
3. `union(fragments) ⊆ bbox`. Es consecuencia de (1) y se aserta igual: es la propiedad que garantiza que **este ADR no puede introducir una fuga** — la superficie tapada solo se achica, y siempre dentro de lo que hoy ya se tapa.

### 2. Quién los produce: `mapSpanToWords`, agrupando por banda vertical

Los dos motores que arman ocurrencias a partir de un span de texto —`regex-engine` y `ner-engine`, cada uno con su copia adaptada de `mapSpanToWords`— parten las `Word` del match en **corridas de la misma línea** y emiten un rectángulo por corrida.

El criterio de "misma línea" es **`sharesVerticalBand` de `@anonly/shared`** (`Contracts.md` §6). No es una definición nueva: es la que ya usan `render-engine`, el façade y `findLiteral`, promovida a `shared` por la errata de ADR-061 §2 precisamente para que no haya tres. Este ADR es el cuarto consumidor y **no** agrega una cuarta copia.

```text
fragmentar(words[first..last]):
  corridas = [[words[first]]]
  para cada word siguiente:
    si sharesVerticalBand(word.bbox, última palabra de la corrida actual):
      agregar a la corrida actual
    si no:
      abrir corrida nueva
  si corridas.length == 1: no emitir `fragments`   // caso normal, sin cambio
  si no: fragments = corridas.map(unión de bboxes), ordenadas por (y asc, x asc)
```

La comparación es **contra la última palabra de la corrida**, no contra la primera: la banda se arrastra con el renglón, igual que en `slideWordWindowMatches` de `findLiteral`. Y el `wordSpan` no cambia: sigue siendo el rango completo `[first, last+1)`.

### 3. El texto rotado no se fragmenta

Si alguna `Word` del match declara `bbox.rotation` distinta de ausente/`0`, **no se emite `fragments`**: el match queda con su envolvente, exactamente como hoy.

Motivo, y no es una simplificación: en un run a 90° las palabras avanzan **hacia abajo**, así que cada una cae en una banda vertical distinta y el algoritmo de §2 partiría cada palabra en su propio fragmento — lo contrario de lo que hay que hacer. Y no hace falta: la envolvente de un run vertical **ya es apretada**, porque las palabras están apiladas en la misma columna. El defecto de Contexto §1 no existe para texto rotado.

**Residuo aceptado y anotado**: un run vertical que se derrame a una segunda columna tendría el problema equivalente con la envolvente. No se observó en ninguna de las cinco páginas medidas, y el criterio de banda para texto rotado sería otro (banda horizontal, no vertical). Queda en `roadmap/Future_Ideas.md`, no acá.

Con las palabras en desacuerdo de ángulo el campo tampoco se emite — es el mismo criterio con que ADR-066 §6 omite `rotation` cuando discrepan: la envolvente de dos direcciones de avance no admite una descripción mejor que ella misma.

### 4. Quién los consume: el render expande cada reemplazo en unidades de pintado

`paintReplacements` (`render-engine/src/worker/kernel.ts`) itera `Replacement[]` y trabaja con `replacement.bbox`. **No se reescribe**: se le antepone una normalización que convierte cada `Replacement` con `fragments` en N **unidades de pintado**, cada una con un rectángulo simple, y el bucle que ya existe corre sobre esas unidades sin enterarse.

- **Una unidad primaria**, que lleva el `replacementValue` y pasa por el camino completo de siempre: `fitsNaturally`, repintado de línea (ADR-058 §2-§6), shrink-to-fit (ADR-058 §1), veredicto de degradación (ADR-058 §7).
- **N-1 unidades de solo tapado**: el mismo `fillRect` de fondo que ya hace el bucle, sin `fillText`. No producen `Annotation` de degradación —no dibujan texto, no pueden degradarlo— así que sigue habiendo como mucho una `Degraded` por `occurrenceId` y el `Annotation.id` no colisiona.
- En modo `redact` no hay unidad primaria ni distinción posible: los N fragmentos son N `fillRect` negros, que es lo correcto y lo que el usuario espera.

Dos efectos que salen gratis de expandir **antes** del bucle y conviene dejar dichos: el filtro `otherReplacements` de `planLineRepaint` pasa a ver los fragmentos vecinos como reemplazos independientes, que es lo correcto para el límite "no cruzar hacia el territorio de otra entidad"; y `sharesVerticalBand` dentro del kernel vuelve a comparar contra rectángulos de una línea, que es lo que esa función asume.

### 5. El token se pinta en el fragmento más ancho

Empate → el primero en orden de lectura.

La alternativa —pintarlo siempre en el primero, donde la entidad empieza— respeta mejor el flujo de lectura, y se descarta por una razón concreta: el primer fragmento es, con frecuencia, el trozo corto que quedó al final del renglón (`Pablo`, en el caso medido: el resto de la entidad está en la línea siguiente). Meter `[PERSONA 03]` ahí lo manda al shrink-to-fit y, con él, a la marca de degradación de ADR-058 §7 — o sea, a encender un aviso de píxeles comprometidos en un caso donde había un rectángulo perfectamente holgado a dos centímetros de distancia.

El costo de elegir el más ancho es de lectura, y es chico: los fragmentos son líneas **consecutivas** de la misma entidad, así que el token aparece a lo sumo un renglón más abajo de donde el lector lo espera, con el hueco tapado inmediatamente arriba. El beneficio es que la escalera de ADR-057 y el shrink-to-fit de ADR-058 miden contra el ancho que de verdad hay.

**Esto es una decisión de render y se puede revisar sin tocar el contrato**: si sobre documentos reales el orden de lectura pesa más que la legibilidad, cambiar de "el más ancho" a "el primero" es una línea en el kernel y ningún cambio en `shared`.

### 6. El veredicto de degradación se computa contra el fragmento elegido

Hoy, para una entidad partida en dos líneas, ADR-058 §7 mide el encogido contra una envolvente de 557 pt de ancho: el token entra sobrado y **la degradación nunca se enciende**. El aviso está apagado justo en el caso peor. Con §5, se mide contra el fragmento real donde se pinta, que es lo que ADR-058 §7 siempre quiso medir.

Consecuencia esperada y correcta: algunas entidades multi-línea van a encender la marca de degradación que hoy no encienden. No es una regresión — es el aviso funcionando por primera vez sobre estas ocurrencias, con su remedio ya documentado (editar el `replacementValue` a mano, ADR-058 §4 y ADR-062, que ADR-076 vuelve confiable en el mismo hito).

### 7. La escalera de abreviaturas mide contra fragmentos, no contra la envolvente

`ADR-057 §4` elige el nivel del `placeholder` con el **peor caso** de `members[].bbox`. Con una envolvente de 557 pt, ese member no aprieta nada y el grupo se queda en nivel 0 aunque su ocurrencia real sea angosta.

`buildPlaceholderValue` pasa a evaluar, por member, **cada uno de sus fragmentos** (`fragments ?? [bbox]`), y el peor caso se toma sobre ese conjunto. Es coherente con la regla de ADR-057 §4 ("se elige por el peor caso y se aplica a todo el grupo") y no le agrega ningún disparador: se recalcula donde ya se recalculaba.

**Matiz deliberado**: el fragmento que importa para la legibilidad es el que va a llevar el token (§5, el más ancho), no el más angosto. Aun así la escalera mide **todos** los fragmentos, porque el conjunto de members de un grupo mezcla ocurrencias de una y de varias líneas y el nivel es uno solo para todo el grupo; medir de menos ahí es cómo se llega a un token que no entra. Es una estimación conservadora, que es lo que ADR-057 §5 dice que esta escalera es.

### 8. `selectLineWords` opera por fragmento

`packages/anonymization-core/src/line-words.ts` decide, host-side, qué palabras adjuntar para el repintado de línea (ADR-058 §5). Sus dos criterios —`mightOverflow` y `isLineNeighbor`— usan `replacement.bbox`, y con una envolvente los dos dan mal: el ancho de 557 pt hace que nada parezca desbordar, y `word.bbox.x >= bbox.x + bbox.width` deja fuera a todas las vecinas de las dos líneas.

Pasa a evaluar los dos criterios **por fragmento** (`fragments ?? [bbox]`), con la misma semántica de siempre para el caso de un solo rectángulo. Sigue siendo una función pura sin estado retenido, y sigue devolviendo `undefined` cuando ningún reemplazo de la página podría no entrar.

### 9. Lo que **no** cambia

- **`BoundingBox` no se toca.** Sigue siendo cuatro números y `rotation`. `fragments` va al lado del bbox, en los tipos que lo llevan, no adentro: un rectángulo no contiene rectángulos.
- **`Annotation` no cambia.** Hoy la única `Annotation` que alguien construye es la `Degraded` que emite el propio kernel (ADR-058 §7), ya por unidad de pintado. No hay productor de `Highlight`/`Conflict` fuera del render, así que no hay nada que propagar.
- **`TextMatch` no cambia** (ADR-061): `findLiteral`/`searchText` matchean dentro de una línea por construcción (Contexto §6). Agregarle el campo sería declarar un estado que esa ruta no puede producir.
- **`apps/react-client` no se toca.** Los dos lugares donde la app lee un bbox de ocurrencia son el resaltado de la lupa (que es un `TextMatch`) y la miniatura del `SplitDialog`, cuyo trabajo es **ubicar** la ocurrencia en la página: para eso la envolvente es exactamente el dato correcto. Que la app no aparezca en la tabla de PRs no es un olvido.
- **La detección de conflictos y el orden documental** siguen con la envolvente (§1). El solapamiento entre entidades y "cuál aparece primero" son preguntas sobre la región que ocupa la ocurrencia, no sobre dónde se pinta.

### 10. Alcance y tests

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 3 | Este ADR + propagación a specs | `docs/` | — |
| 4 | `fragments` en `Occurrence`, `OccurrenceRef` y `Replacement` (§1) | `shared` | 3 |
| 5 | `mapSpanToWords` fragmenta por banda vertical (§2, §3) | `regex-engine` | 4 |
| 6 | `mapSpanToWords` fragmenta por banda vertical (§2, §3) | `ner-engine` | 4 |
| 7 | `toOccurrenceRef` propaga `fragments`; la escalera mide por fragmento (§7) | `grouping-engine` | 4 |
| 8 | `buildPageReplacements` propaga `fragments` | `export-engine` | 4 |
| 9 | Unidades de pintado, token en el más ancho, degradación por fragmento (§4-§6) | `render-engine` | 4 |
| 10 | `selectLineWords` por fragmento (§8) | `packages/anonymization-core/src` | 4 |
| 11 | Test de integración de punta a punta (ver Validación) | `tests/integration` | 5-10 |

Los PRs 5 a 10 dependen todos del 4 y de nadie más entre sí: se pueden hacer en cualquier orden o en paralelo. El 11 va último por definición.

**Los seis PRs de propagación no son opcionales ni diferibles de a uno.** Con el 4 y el 5 mergeados y el 9 sin mergear, el campo existe, se puebla y **nadie lo pinta**: el comportamiento sigue siendo el de hoy, con todos los gates en verde. Es el modo de falla de ADR-066 §6, y es la razón de que el PR 11 exista.

Tests, por PR:

- **`shared` (4)** — Contract: los tres tipos aceptan el campo ausente y presente; `exactOptionalPropertyTypes` impide `fragments: undefined` explícito (mismo patrón que `rotation`/`maskFormat`).
- **`regex-engine` (5) y `ner-engine` (6)**, los mismos cuatro en cada uno:
  - Unit — **el test que define este ADR**: un match cuyas palabras caen en dos líneas produce `fragments.length === 2`, con un rectángulo por línea, y `bbox` sigue siendo la envolvente de los dos.
  - Unit — **no-regresión**: un match de una sola línea (una y varias palabras) **no** lleva `fragments`, y su `bbox` es idéntico al de antes de este ADR.
  - Unit: tres líneas producen tres fragmentos, en orden de lectura.
  - Unit: un match con `rotation: 90` **no** lleva `fragments` (§3), y conserva el `rotation` que ADR-066 §6 propaga.
- **`grouping-engine` (7)** — Unit: `fragments` sobrevive de `Occurrence` a `OccurrenceRef` y llega al `EntityGroup` expuesto por `getSnapshot`. Unit: la escalera de ADR-057 baja de nivel por un fragmento angosto que la envolvente escondía (§7).
- **`export-engine` (8)** — Unit: `buildPageReplacements` propaga `fragments` a cada `Replacement`; una ocurrencia sin el campo produce un `Replacement` sin el campo.
- **`render-engine` (9)**:
  - Unit: un reemplazo con dos fragmentos produce **dos** tapados y **un** `fillText`, en el fragmento más ancho (§5).
  - Unit — **no-regresión bit a bit**: un reemplazo sin `fragments` produce exactamente las mismas llamadas de canvas que antes de este ADR.
  - Unit: en `redact`, los N fragmentos se pintan negros y no hay `fillText` (§4).
  - Unit: el veredicto de degradación se computa contra el fragmento elegido, no contra la envolvente (§6) — un caso que hoy no degrada y que con este ADR sí.
  - Edge: como mucho una `Annotation` de `Degraded` por `occurrenceId`, aunque haya N fragmentos.
- **façade (10)** — Unit: `selectLineWords` adjunta las vecinas de la línea del fragmento, no las de la envolvente (§8); y con un solo rectángulo devuelve exactamente lo de antes.
- **Contract, transversal (en el PR que corresponda a cada motor)**: los tres invariantes de §1 — `bbox` es la envolvente de `fragments`, los fragmentos no se solapan, y `union(fragments) ⊆ bbox`. El tercero es el que aserta que este ADR no puede filtrar nada.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **`Occurrence.bbox: ReadonlyArray<BoundingBox>`** (el bbox pasa a ser una lista) | Es el cambio "limpio" y es el peor de todos: rompe **todos** los consumidores de `bbox` a la vez —orden documental de ADR-028, solapamiento de conflictos, hit-test, miniatura, `Annotation`— para un caso que afecta a una de cada varias decenas de ocurrencias, y obliga a que cada uno de esos consumidores decida por su cuenta qué hacer con la lista. La envolvente sigue siendo la respuesta correcta a casi todas esas preguntas; convertirla en `bboxes[0]` la hace desaparecer. |
| **Emitir una `Occurrence` por línea** (dos ocurrencias en vez de una fragmentada) | Cambia la unidad de detección para arreglar un problema de pintado. Rompe el `value`/`normalizedValue` (cada mitad normaliza sola: `"pablo"` y `"roman fortes"` no agrupan con nada), duplica los `members` del grupo, altera el `indexInType` de ADR-028 y hace que el dedup por identidad de ADR-038 §3 vea dos entidades donde hay una. La entidad **es** una; lo que son varios es su footprint. |
| **Recortar la envolvente al ancho de la primera línea** | Deja de contener la entidad: la parte que quedó en la segunda línea **no se tapa**. Convierte un problema de destrucción de texto en una fuga. Descartado sin más. |
| **Que el render deduzca las líneas desde `lineWords`** | El render tendría que re-derivar dónde cortó la entidad a partir de las palabras de la página, sin saber cuáles eran las del match — información que el motor que la detectó **sí** tiene y está tirando. Y `lineWords` es opcional (`ADR-058 §5`: se adjunta solo ante riesgo de derrame), así que el arreglo dependería de un campo que la mayoría de las veces no viaja. |
| **Un tipo nuevo `OccurrenceGeometry { bbox, fragments }`** en vez de un campo suelto | Un tipo más en `Contracts.md`, tres tipos que cambian de forma, y todos los `x.bbox` del repo pasan a `x.geometry.bbox`. Todo eso para agrupar dos campos que ya viajan juntos. El campo opcional al lado del bbox tiene el precedente exacto de `maskFormat` y `rotation`. |
| **Marcar la ocurrencia como "multi-línea" con un booleano** y que el render se arregle | Un booleano no dice **dónde** están las líneas. El render tendría que reconstruirlo, con menos información que quien lo emitió (ver arriba). |
| **No hacer nada; que el usuario deshabilite el grupo** | Deshabilitar el grupo deja la entidad **sin tapar**: la salida disponible para "tapa demasiado" es exactamente la que produce una fuga. No es una salida. |

## Consecuencias

**Positivas**: una entidad partida en dos líneas deja de destruir las dos líneas enteras, que era el defecto; el caso de una línea —el 99%— no cambia ni un byte, porque el campo queda ausente; la superficie tapada solo puede achicarse y siempre dentro de lo que hoy se tapa, así que el cambio **no puede introducir una fuga** y eso es un invariante asertado, no una promesa; el aviso de degradación de ADR-058 §7 y la escalera de ADR-057 §4 empiezan a medir contra el ancho real y no contra una envolvente que los apagaba; y `sharesVerticalBand` gana su cuarto consumidor sin que aparezca una cuarta copia.

**Negativas**: seis PRs de propagación para un campo, con el modo de falla de ADR-066 §6 esperando si alguno queda a mitad de camino (mitigado con el test de integración del PR 11, que es la razón de que exista); el token de un reemplazo multi-línea aparece en el fragmento más ancho y no necesariamente donde el lector lo espera (§5, revisable sin tocar el contrato); algunas entidades multi-línea van a encender la marca de degradación que hoy no encienden (§6 — es el aviso funcionando, pero es un cambio visible); y el texto rotado que se derrame a una segunda columna queda con el problema abierto (§3, anotado).

**Neutras**: `BoundingBox`, `Annotation` y `TextMatch` no cambian de forma; `apps/react-client` no se toca (§9); el orden documental de ADR-028 y la detección de conflictos siguen leyendo la envolvente y dan exactamente lo mismo que hoy; `findLiteral` y la lupa no se enteran, porque no pueden producir un match multi-línea; y ningún evento ni error code cambia.

## Docs actualizados por este ADR

- `architecture/03_Data_Model.md` — §7 (`Occurrence`), §8 (`OccurrenceRef`), §12 (`Replacement`): el campo, su semántica de "ausente ≡ `[bbox]`" y los tres invariantes de §1. Es la definición semántica, y por eso va acá primero.
- `core/Contracts.md` §5 — nota junto a `BoundingBox`: por qué `fragments` **no** vive adentro del rectángulo y qué tipos lo llevan. No hay tipo nuevo que declarar (§10 regla 1 no aplica), pero un implementador que lea solo `Contracts.md` tiene que encontrar el puntero.
- `core/Regex_Engine.md` → §10 (el invariante de `fragments` junto al de `rotation`), §13 (caso nuevo), §14, §15 (ítem de checklist).
- `core/NER_Engine.md` — los mismos cuatro puntos, sobre su copia adaptada de `mapSpanToWords`.
- `core/Grouping_Engine.md` — §13 (la escalera mide por fragmento), §14, §15, y la sección de la escalera de abreviaturas, donde vive la fórmula de selección de nivel.
- `core/Render_Engine.md` — §2 (responsabilidades: pintar por fragmento), §9, §13 (casos nuevos: dos fragmentos, `redact` multi-fragmento, degradación por fragmento), §14, §15.
- `core/Export_Engine.md` — `buildPageReplacements` propaga el campo.
- `core/Orchestrator.md` — `selectLineWords` por fragmento (§8).
- `roadmap/MVP.md` §4 — bloque del Hito 10.9.
- `roadmap/Post_Hito10.8_Pendientes.md` §2 — pasa de pendiente a adoptado.
- `roadmap/Future_Ideas.md` — el run vertical que se derrama a una segunda columna (§3).

## Validación

- Los tests de §10, con dos que son condición de mergeo y no un extra: el que define el ADR (dos líneas → dos fragmentos, envolvente intacta) y la **no-regresión bit a bit** del caso de una línea en `render-engine`.
- **Test de integración de punta a punta (PR 11)**, y existe por ADR-066 §6: un `Document` fixture con una entidad `Person` partida en dos líneas, de la detección al canvas, asertando que se pintan dos rectángulos y que **ninguno** cubre el ancho de la página. Es lo único que detecta que la cadena se cortó en alguno de los seis saltos.
- Verificación manual sobre la pericia real, página 2, entidad `Pablo Román Fortes`: las dos líneas dejan de estar tapadas y el token aparece una sola vez.
- El invariante `union(fragments) ⊆ bbox` corriendo sobre el fixture completo: es la garantía formal de que la superficie tapada solo se achicó.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `architecture/03_Data_Model.md` §5-§8, §12, §14 — `core/Contracts.md` §5, §6 (`sharesVerticalBand`)
- `core/Regex_Engine.md` §10, §13 caso 16 — `core/NER_Engine.md` §10 — `core/Render_Engine.md` §13 — `core/Export_Engine.md` — `core/Orchestrator.md`
- `adr/ADR-020` §1 — `adr/ADR-057` §4, §5 — `adr/ADR-058` §1, §2, §5, §7 — `adr/ADR-061` §2 y su errata — `adr/ADR-062` — `adr/ADR-063` — `adr/ADR-066` §6, §7
- `roadmap/Post_Hito10.8_Pendientes.md` §2 (el reporte original, con la medición de 557,2 × 18,2 pt)
- Código: `packages/anonymization-core/regex-engine/src/regex.engine.ts` (`mapSpanToWords`), `packages/anonymization-core/ner-engine/src/ner.engine.ts` (su copia), `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`paintReplacements`, `planLineRepaint`), `packages/anonymization-core/export-engine/src/export.engine.ts` (`buildPageReplacements`), `packages/anonymization-core/src/line-words.ts` (`selectLineWords`)
