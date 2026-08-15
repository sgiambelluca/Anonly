<!-- CONTEXT: scope=regex-engine | dependencias=core/Contracts.md,architecture/06_Pipeline.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md | audiencia=IA-implementador | fase=3 (§2/§6/§10/§13/§14/§15 y la tabla de patrones en fase 10.9: `fragments` por línea en `mapSpanToWords` —ADR-074 §2—, patrón `date-textual-ar` y guarda de corrida alfanumérica —ADR-075 §1/§2—; items §15 1-18 implementados; tests cancel/perf de §14 diferidos a Hito 11; §4/§6/§13/§14/§15 en fase 10.7: findLiteral para el agregado manual de entidades, ADR-061, con sus dos primitivas importadas de shared y no reimplementadas —errata de ADR-061 §2—, y searchText de solo lectura como primitiva de findLiteral y de la lupa —errata de ADR-061 §8—; §6/§13/§14/§15 en fase 10.7 post-aprobación: stripEdgePunctuation, segunda errata de ADR-061 §2; §10/§14/§15 en fase 10.8: propagación de bbox.rotation, ADR-066 §6) -->

# Regex Engine — Spec de Motor

> Detecta patrones determinísticos (DNI, CUIT, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente) en el texto de cada página. Emite `Occurrence[]` con `source: "regex"` y `confidence: 1.0`. Es determinista: mismo input → mismo output.

**EngineId**: `regex`
**Versión del spec**: 1.6.0
**Última actualización**: 2026-08-15
**Estado de implementación**: Hito 4, checklist §15 (items 1-18) implementado; item 19 (propagación de `bbox.rotation`) en Hito 10.8; items 20 y 21 (fragmentos por línea y los dos cambios de la tabla de patrones) en Hito 10.9. `findLiteral` (item 10b) y `searchText` (item 10c) implementados en los PRs 2 y 3c del Hito 10.7 respectivamente; `stripEdgePunctuation` (item 10d) corrige un gap de matcheo hallado post-aprobación del hito. Pendiente: `cancel.test.ts`/`perf.test.ts` de §14 en Hito 11 (ver nota al final de §15).

> **Nota (v1.6.0, ADR-074 + ADR-075, 2026-08-15 — el footprint por línea, y dos cambios en la tabla de patrones)**: tres cosas, ninguna de ellas de contrato público. **(1) `mapSpanToWords` emite `fragments`** (ADR-074 §2): un match cuyas palabras caen en líneas distintas producía **un** bbox envolvente —557,2 × 18,2 pt sobre la pericia real, casi el ancho útil de la página— y la censura destruía las dos líneas enteras. El span se parte en corridas de la misma línea con `sharesVerticalBand` de `@anonly/shared` (la misma primitiva que ya usa `findLiteral`, no una cuarta copia) y se emite un rectángulo por corrida; `bbox` sigue siendo la envolvente, sin cambios. Con una sola corrida el campo **queda ausente** y el resultado es idéntico al previo, byte a byte. El texto rotado no se fragmenta (§3 del ADR: un run a 90° avanza hacia abajo y su envolvente ya es apretada). **(2) Patrón `date-textual-ar`** (ADR-075 §1): `"Quilmes, 07 de julio de 2026"` no se detectaba —`date-ar` es solo numérico— y salía en claro en el export; el normalizador lo lleva a `DD/MM/YYYY`, o sea al mismo `normalizedValue` que la fecha numérica equivalente, así que agrupan por el pase **exacto**. **(3) Guarda de corrida** (ADR-075 §2): un match **sin letras** cuya corrida —extendida a través de `-`, `/` y `.`— **sí** tiene letras se descarta; es lo que hace que `PP-13-00-027653-24/00` deje de producir `[PHONE] "00-027653"`. Ver §2, §6, §10, §13 casos 26-28, §14 y §15 items 20-21.

> **Nota (v1.5.0, ADR-061 §2 segunda errata, 2026-08-15 — puntuación pegada a `Word` por el whitespace-split)**: en uso real, la lupa contaba menos apariciones de un nombre que el pipeline de detección completo (20 contra 28, sobre el mismo documento) — no por la limitación deliberada de "J. Pérez" (§2), sino porque `Page.words` separa por whitespace (ADR-020 §1): un nombre pegado a puntuación sin espacio (`"Gorrister,"`, `"¡Gorrister!"`) queda en un solo `Word` con la puntuación adentro, y `normalizeForComparison` no la saca — el NER, que opera sobre el texto corrido y no sobre `Word`, no tiene este problema. Se agrega `stripEdgePunctuation` (local a `regex-engine`, no promovida a `@anonly/shared`: es un recorte de tokenización propio de este matcheo, no una definición de línea/normalización que otro motor necesite — ver Validación), aplicada a los dos lados de la comparación en `slideWordWindowMatches`/`tokenizeLiteralValue`. Recorta solo el **borde**; la puntuación interna (`"O'Brien"`) queda intacta, y `"J. Pérez"` sigue sin matchear `"José Pérez"` — no es búsqueda difusa. Ver §6 (matcheo exacto), §13 caso 25, §14 y §15 ítem 10d.

> **Nota (v1.4.0, ADR-061 §8 errata, 2026-08-14 — `searchText`: la misma búsqueda, de solo lectura)**: ADR-061 §8 prometía que la lupa del visor era "la misma búsqueda literal, en vez de emitir `ENTITY_FOUND` devuelve los matches". El motor no tenía esa segunda forma: `findLiteral` **solo** expone su resultado emitiendo sobre `ctx.bus`, y exige un `entityType` que una búsqueda de texto no tiene. Cablear `findText` sobre él habría hecho que **tipear en la lupa cree y fusione grupos en la sesión en vivo** — el documento anonimizándose solo mientras el usuario busca. Se agrega `searchText(input): ReadonlyArray<TextMatch>`: **sincrónica** (para que `IPipelineOrchestrator.findText` pueda cumplir su firma sin `Promise`), **sin `EngineContext`** (no emite, no cancela, no loguea la query) y de solo lectura. Y `findLiteral` **se reconstruye encima de la misma función de matcheo por página**, sin cambiar su firma ni su comportamiento: recién con eso la frase de §8 describe el código y no dos matchers que pueden divergir. Ver §6, §7, §12, §13 casos 20-24, §14 y §15 ítem 10c.

> **Nota (v1.3.0, ADR-061 §2 errata, 2026-08-14 — las dos primitivas de `findLiteral` salen de `shared`, no se reimplementan acá)**: ADR-061 §2 pedía que el matcheo multi-palabra usara "la misma agrupación por banda vertical que ADR-058 §5", como **una** primitiva compartida. No era alcanzable: vivía en el façade (`src/line-words.ts`), que ningún motor puede importar (P-2), y **ya estaba duplicada** en `render-engine/src/worker/kernel.ts`. Lo mismo con la normalización NFC, cuya única implementación estaba en `grouping-engine`. Las dos se promueven a `@anonly/shared` —`sharesVerticalBand` y `normalizeForComparison`, `Contracts.md` §6— con el mismo razonamiento que `estimateTokenWidth`: es el único lugar desde el que los tres consumidores llegan sin importarse entre sí. Para este motor el efecto es directo: **las importa** (§4, §6) y el chequeo de banda vertical deja de ser opcional — sin él, un valor que cruza de un renglón al siguiente da un falso positivo y se anonimiza texto que no es la entidad. Ver §13 casos 14-19 y las filas nuevas de §14; el test del corte de línea es el que faltaba y el que protege el fix.

> **Nota (v1.2.0, ADR-066 §6, 2026-08-13 — `bbox.rotation` viaja en la `Occurrence`)**: `BoundingBox` ganó el campo opcional `rotation` (`Contracts.md` §5), y ADR-066 §6 lo justificó diciendo que viajaría solo por la cadena `Word → Occurrence → Replacement` porque *"`mapSpanToWords` une bboxes y el campo viaja con ellos"*. **No viajaba**: la unión construye un `BoundingBox` **nuevo** a partir de min/max escalares, así que el campo se caía en silencio — el `Word` salía con `rotation: 90` y la `Occurrence` sin el campo, y el pintado rotado de ADR-066 §7 nunca se activaba. Se propaga explícitamente, y **solo si todas las palabras del match coinciden en el ángulo**: si discrepan, la envolvente de dos direcciones de avance no tiene un ángulo que la describa y el campo queda ausente (≡ 0), que es el comportamiento previo. Ver §10, §14 y §15 item 19. El mismo defecto y el mismo criterio aplican a la copia adaptada de esta función en `NER_Engine.md`.

> **Nota (v1.1.0, ADR-061, 2026-08-06 — `findLiteral`: agregado manual de entidades)**: este motor gana un método **dedicado** para buscar un valor literal que el usuario escribió o señaló, y emitir sus ocurrencias con `source: DetectionSource.Manual`. Cubre el agujero de que una entidad no detectada no tenía ninguna vía de corrección — y el recall del NER es métrica **informativa** en MVP (`roadmap/MVP.md` §5), o sea que el roadmap ya asume que se escapan. Vive acá, y no en un motor nuevo ni host-side, porque es exactamente la responsabilidad de este motor (encontrar cadenas en un documento y emitir `Occurrence`) y porque `mapSpanToWords` —el bbox unión de un rango de texto, la parte difícil— ya está implementado y testeado acá. **No usa `addPattern`**: ese registro es para patrones que participan de todas las corridas siguientes, y un valor puntual del usuario no debe re-evaluarse contra cada documento futuro; la durabilidad la resuelve el Orchestrator (ADR-061 §5). Búsqueda **exacta**, insensible a mayúsculas y acentos: `"J. Pérez"` **no** matchea `"José Pérez"` — limitación conocida y asertada por un test, con la búsqueda difusa anotada en `roadmap/Future_Ideas.md` §5.1b. Al NER, en cambio, **no se le puede pedir que busque un valor**: es un clasificador de tokens, no un buscador (ADR-061, Contexto §5). Ver §6, §13 y §14.

> **Nota (ADR-029, 2026-07-11)**: cada `Occurrence` emitida lleva `maskFormat` copiado del `RegexPattern.maskFormat` que matcheó (ver §10). Los `maskFormat` de `plate-mercosur-ar`/`plate-vieja-ar` en `default-ar.ts` se corrigen a `XX XXX XX` / `XXX XXX` (la fila Plate de ADR-012 estaba invertida y queda superada). Pendiente de implementación en un PR chico post-Hito 6.

---

## 1. Objetivo

Recorrer el `Document` (con texto ya fusionado PDF+OCR) y emitir `Occurrence[]` para cada patrón matcheado, mapeando el match a `BoundingBox` en la página.

---

## 2. Responsabilidades

- Cargar los patrones default de tipos argentinos (DNI, CUIT/CUIL, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente).
- Aplicar cada patrón a `Page.text` y mapear matches a `Occurrence` con `bbox`, `pageIndex`, `entityType`, y —cuando el match cruza un salto de línea— la descomposición por línea en `fragments` (ADR-074 §2).
- Descartar el match que es un **tramo de un identificador alfanumérico más largo**: sin letras en el match y con letras en su corrida (ADR-075 §2, ver §6).
- Soportar patrones custom del usuario (con validación: regex válida + `entityType` válido).
- Validar con checksum cuando aplique (CUIT con dígito verificador, tarjeta con Luhn).
- Emitir `ENTITY_FOUND` por ocurrencia (evento **interno**, solo escuchado por Grouping Engine).
- Emitir `REGEX_FINISHED` al final.
- Normalizar el `normalizedValue` de cada ocurrencia (sin puntuación redundante, lowercase) para agrupación consistente.

---

## 3. Fuera de alcance

- Detectar personas, organizaciones ni direcciones (es tarea de NER).
- Agrupar ocurrencias (es tarea de Grouping Engine).
- Renderizar el PDF.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.

---

## 4. Dependencias permitidas

- `@anonly/shared` — incluidas sus dos funciones puras `sharesVerticalBand` y `normalizeForComparison` (`Contracts.md` §6), que `findLiteral` **consume, no reimplementa**: las dos son compartidas con otros motores y con el façade, y `shared` es el único lugar desde el que los tres las alcanzan (errata de ADR-061 §2).
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `Occurrence`, `EntityType`, `DetectionSource`, `BoundingBox`, `TextMatch` (salida de `searchText`, ADR-061 §8)
- `architecture/04_Event_System.md`: `ENTITY_FOUND`, `REGEX_FINISHED`

No requiere dependencias externas: usa `RegExp` nativo de JS.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins, libs de network
- Libs de regex externas (`xregexp`, etc.) sin ADR

---

## 6. Interfaces públicas

```ts
export interface RegexPattern {
  readonly id: string;                    // "dni-ar", "cuit-ar", etc.
  readonly entityType: EntityType;
  readonly pattern: RegExp;
  readonly checksum?: (value: string) => boolean;  // validación adicional (CUIT, tarjeta)
  readonly normalizer: (value: string) => string;  // produce normalizedValue
  readonly maskFormat: string;            // "XX.XXX.XXX" — referenciado por Render/Export
}

export interface RegexEngineConfig {
  readonly patterns: ReadonlyArray<RegexPattern>;
  readonly customPatterns: ReadonlyArray<RegexPattern>;  // del usuario
}

export interface RegexEngineInput {
  readonly document: Document;
}

export interface RegexEngineOutput {
  readonly documentId: string;
  readonly occurrenceCount: number;
  readonly durationMs: number;
}

export class RegexEngine implements IEngine {
  readonly id = EngineId.Regex;
  init(ctx: EngineContext): Promise<void>;
  process(input: RegexEngineInput, ctx: EngineContext): Promise<RegexEngineOutput>;
  addPattern(pattern: RegexPattern): void;       // runtime, para UI
  removePattern(patternId: string): void;
  findLiteral(input: FindLiteralInput, ctx: EngineContext): Promise<RegexEngineOutput>;  // ADR-061 §1
  searchText(input: RegexSearchInput): ReadonlyArray<TextMatch>;                         // ADR-061 §8 errata
  dispose(): Promise<void>;
}

// ADR-061 §1: búsqueda de un valor que el usuario escribió o señaló en el visor.
export interface FindLiteralInput {
  readonly document: Document;
  readonly value: string;
  readonly entityType: EntityType;
}

// ADR-061 §8 (errata): la misma búsqueda, de solo lectura. Sin entityType
// —no se está clasificando nada— y sin EngineContext (ver semántica abajo).
export interface RegexSearchInput {
  readonly document: Document;
  readonly query: string;
}
```

Semántica de `findLiteral` (ADR-061 §1/§2):

- Busca el `value` en el documento y emite una `Occurrence` por coincidencia, con `source: DetectionSource.Manual`, `confidence: 1.0` y el bbox resuelto por `mapSpanToWords` — el mismo camino que usa `process`.
- **No emite `REGEX_FINISHED`** y **no toca el registro de patrones**: no es una corrida de detección, es una consulta puntual. `addPattern` sigue siendo para patrones que participan de todas las corridas.
- **Matcheo exacto, normalizado**: NFC + minúsculas + sin diacríticos, mismo criterio que el `normalizedValue` de `Occurrence`. `"JOSE PEREZ"` encuentra `"José Pérez"`. La normalización es **`normalizeForComparison` de `@anonly/shared`** (`Contracts.md` §6), no una función local: los `normalizer` de `RegexPattern` (`stripDots`, `stripDashes`) asumen un dato estructurado y acá el valor es texto libre. Se normaliza **antes** de tokenizar por espacios, así que el colapso de espacios repetidos sale gratis (§13 caso 17).
- **Puntuación de borde recortada, la interna no** (errata de §2, 2026-08-15): `Page.words` separa por whitespace (ADR-020 §1), así que un nombre pegado a puntuación sin espacio (`"Gorrister,"`, `"¡Gorrister!"`) vive en un solo `Word` con la puntuación adentro, y `normalizeForComparison` no la saca. `stripEdgePunctuation` (local a `regex-engine`, no en `@anonly/shared`) recorta **solo el borde** de cada `Word` y de cada token del `value` antes de comparar — `"O'Brien"` no se toca, porque el apóstrofo no está en el borde. Se aplica a los dos lados de la comparación: si solo se recortara la palabra, un resultado con puntuación pegada (`match.text === "Gorrister,"`) dejaría de encontrarse a sí mismo al re-buscarlo vía "Agregar como…" (§8, caso 25).
- **Valores multi-palabra** matchean sobre `Word` contiguas de la misma línea. "Misma línea" es **`sharesVerticalBand` de `@anonly/shared`** (`Contracts.md` §6): cada par consecutivo de la ventana candidata tiene que compartir banda vertical, no alcanza con ser contiguas en `Page.words`. Es la misma definición que usan `render-engine` y el façade — una sola, no tres (errata de ADR-061 §2). Sin ese chequeo, un valor que cruza de un renglón al siguiente da un falso positivo (§13 caso 16).
- **`"J. Pérez"` no matchea `"José Pérez"`.** Limitación deliberada, con test explícito (§14) para que no se implemente por accidente ni se rompa en silencio. La búsqueda difusa de variantes está anotada en `roadmap/Future_Ideas.md` §5.1b.
- Valor ausente del documento → `occurrenceCount: 0`, **sin eventos y sin error**: no es un fallo del Core que el usuario haya escrito algo que no está.
- Funciona igual sobre páginas cuyas palabras vienen de OCR (`Word.source === "ocr"`): opera sobre `Page.words`, que no distingue el origen.

Semántica de `searchText` (ADR-061 §8 y su errata):

- **Es la primitiva, y `findLiteral` se construye encima.** El matcheo —normalización, tokenización, ventana deslizante, banda vertical— vive en **una** función interna **por página**, que las dos entradas recorren. `searchText` devuelve sus `TextMatch`; `findLiteral` los mapea a `Occurrence` (agregando `entityType`, `source: Manual` y `confidence: 1.0`) y los emite. Que encuentren lo mismo no es una coincidencia a mantener a mano: es el mismo código, y hay un test que lo aserta (§14).
- **De solo lectura, y esto es lo importante**: **no emite ningún evento**, no toca el registro de patrones y no muta ningún estado del motor. Emitir `ENTITY_FOUND` desde una búsqueda haría que tipear en la lupa cree y fusione grupos en la sesión en vivo — el modo de falla que la errata de ADR-061 §8 documenta.
- **Sincrónica**, porque el matcheo es cómputo sincrónico sobre el `Document` en memoria (§12) y porque `IPipelineOrchestrator.findText` está declarado sin `Promise` (`Contracts.md` §3.5). `findLiteral` conserva su `Promise<RegexEngineOutput>`: es contrato público ya mergeado.
- **Sin `EngineContext`**: `bus` es justamente lo que no debe tocar; `abortSignal` no significa nada en una llamada sincrónica; y **no loguea** — la query es texto que el usuario busca en un documento sensible, mismo criterio que el `value` de `findLiteral` (`Contracts.md` §3.3). Las guardas de ciclo de vida sí se conservan, y lanzan **sincrónicamente** (§13 caso 24).
- **Orden documental**: página ascendente y, dentro de cada página, orden de lectura de `Page.words`. La lupa navega "siguiente/anterior" sobre ese orden sin re-ordenar nada.
- Query vacía o de solo espacios → **array vacío**, sin error (mismo criterio que §13 caso 14).

Semántica de la **guarda de corrida** (ADR-075 §2), que se aplica a todo match de `process`, venga de un patrón default o de uno custom:

> **Corrida** de un match: su extensión máxima hacia los dos lados a través de caracteres alfanuméricos y de los tres separadores **internos de número** `-`, `/` y `.`. Formalmente, el substring maximal alrededor del match que matchea `[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)*`.
>
> **Guarda**: si el texto del match **no contiene ninguna letra** y su corrida **sí contiene alguna**, el match se descarta — no se emite `ENTITY_FOUND`.

- **"El match no contiene letras" es la condición de aplicabilidad**, y hace que la guarda alcance sola a los seis tipos puramente numéricos (DNI, CUIT, los dos Phone, CreditCard, Date) sin ninguna tabla por tipo. `License`, `Plate`, `IBAN` y `Email` llevan letras **en el match**, así que la guarda no los mira nunca: para ellos la mezcla de letras y dígitos es el formato.
- **Los separadores son exactamente `-`, `/` y `.`**. Los que quedan afuera importan más que los que quedan adentro: con `:` afuera, `"Tel:4567-8900"` corta la corrida en el `:` y el teléfono se emite; con `,` afuera, `"4567-8900,4567-8901"` emite los dos.
- **Se compara la corrida entera, no el carácter vecino**: lo que delata a `"00-027653"` como tramo de otra cosa está tres saltos a la izquierda (`PP`).
- **No reemplaza la prioridad de match más largo** del caso 10 (DNI dentro de un CUIT): ese span no tiene letras en su corrida, así que pasa la guarda y lo sigue descartando el mecanismo de siempre. Son dos filtros para dos problemas distintos.
- **Residuo aceptado y asertado por un test** (ADR-075 §5): un número pegado a una palabra por un punto y sin espacio (`"Tel.4567-8900"`) queda dentro de una corrida con letras y **no se emite**. De las cuatro formas de escribirlo, es la única que falla; la red de contención es el agregado manual de ADR-061.

Patrones default exportados desde `index.ts`:

```ts
export const DEFAULT_PATTERNS_AR: ReadonlyArray<RegexPattern>;
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `ENTITY_FOUND` | por cada ocurrencia detectada | `EntityFound` con `occurrence.source = "regex"`, `confidence = 1.0` | async | sí |
| `REGEX_FINISHED` | al finalizar todas las páginas | `RegexFinished` | async | sí |

Canal: `EventChannel.Regex`.

`findLiteral` emite **solo** `ENTITY_FOUND` (con `source: "manual"`), nunca `REGEX_FINISHED`: no es una corrida de detección (§6). `searchText` **no emite nada** — es la propiedad que hace que la lupa no mute la sesión, y tiene test de contrato propio (§14).

---

## 8. Eventos que consume

No consume eventos.

---

## 9. Entradas

```ts
RegexEngineInput {
  document: Document;   // inmutable, con Page.text y Page.words ya fusionados
}
```

**Restricciones**:
- `document.pages` no vacío (si está vacío, retorna con `occurrenceCount = 0`).
- `Page.text` debe estar normalizado (NFC) por la etapa 3 del pipeline.

---

## 10. Salidas

```ts
RegexEngineOutput {
  documentId: string;
  occurrenceCount: number;
  durationMs: number;
}
```

Las `Occurrence` individuales no se retornan; se emiten vía `ENTITY_FOUND`. Cada `Occurrence`:

```ts
{
  id: string;                  // UUID v4
  value: string;               // texto matcheado, sin normalizar de presentación
  normalizedValue: string;     // para agrupar (sin puntuación redundante, lowercase)
  bbox: BoundingBox;           // mapeado desde el span en Page.words (ver invariantes abajo)
  fragments?: BoundingBox[];   // un rectángulo por línea, si el match cruza un renglón (ADR-074)
  pageIndex: number;
  source: DetectionSource.Regex;
  confidence: 1.0;
  entityType: EntityType;      // según el patrón que matcheó
  maskFormat?: string;         // RegexPattern.maskFormat del patrón que matcheó (ADR-029)
  wordSpan?: WordSpan;         // referencia a Page.words[startIndex, endIndexExclusive)
}
```

**Invariante de `fragments` (ADR-074 §1-§3)**: `mapSpanToWords` parte las `Word` del match en corridas de la misma línea —`sharesVerticalBand` de `@anonly/shared`, comparando contra la **última** palabra de la corrida en curso, igual que `slideWordWindowMatches`— y emite un rectángulo por corrida, en orden de lectura. Con **una sola** corrida el campo queda **ausente** (≡ `[bbox]`) y la ocurrencia es idéntica a la de antes del ADR: ése es el caso normal. `bbox` no cambia: sigue siendo la envolvente de todo el match, y sigue siendo lo que usan el orden documental de ADR-028 y la detección de solapamiento. `wordSpan` tampoco cambia — sigue cubriendo el rango completo.

**El texto rotado no se fragmenta**: si alguna `Word` del match declara `bbox.rotation` distinta de ausente/`0`, no se emite `fragments`. Un run a 90° avanza hacia abajo, así que cada palabra cae en una banda vertical distinta y fragmentarlo daría un rectángulo por palabra; además su envolvente ya es apretada y el defecto que ADR-074 corrige no existe ahí.

Sin esta propagación el campo se cae en silencio y la censura sigue tapando las dos líneas enteras — es el mismo modo de falla que ADR-066 §6 documentó para `rotation`, en la misma función.

**Invariante de `bbox.rotation` (ADR-066 §6)**: el bbox de la ocurrencia es la **unión** de los bboxes de las `Word` del match, y esa unión construye un `BoundingBox` nuevo. `rotation` se propaga explícitamente y **solo si todas las palabras del match coinciden en el ángulo** — en la práctica lo comparten, porque son tokens del mismo run. Si discrepan, el campo queda **ausente** (≡ 0, `Contracts.md` §5): la envolvente de dos direcciones de avance no tiene un ángulo que la describa, y el reemplazo se pinta horizontal. Para texto horizontal el campo sigue ausente, exactamente como antes del ADR.

Sin esta propagación el campo se cae en silencio y el pintado rotado de ADR-066 §7 nunca se activa — es el defecto que el Hito 10.8 encontró en prueba manual, con todos los tests unitarios en verde.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `REGEX_INVALID_PATTERN` | `RegexInvalidPatternError` | patrón custom del usuario con regex inválida | no | descartar el patrón con warning, continuar con los demás |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `process` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `process` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined | no | bug del caller |

Regex es determinista: si la regex compila, no hay errores de runtime. Errores de un patrón custom no bloquean los demás.

`retryable`: todos `false` (no tiene sentido reintentar un cálculo determinista).

---

## 12. Consideraciones de rendimiento

- **Corre en main thread** (no en Worker). Es ligero: < 5% del total del pipeline.
- Costo: 5–50 ms por página dependiendo del número de patrones y densidad de texto.
- Memoria: < 10 MB (solo estructuras de output).
- Sin transferencia de buffers (trabaja sobre `Document` en memoria).
- Procesa página por página; entre páginas chequea `abortSignal` para cancelación.
- Para patrones custom complejos (catastrophic backtracking), se envuelve en `try/catch` con timeout de 1000 ms por página por patrón. Si timeout, se descarta el patrón custom con warning.
- **`searchText` es la única entrada que se invoca de forma interactiva** (ADR-061 §8: la lupa, mientras el usuario tipea). Su costo es O(páginas × palabras) por llamada y es sincrónica, así que **bloquea el main thread** mientras corre — sobre un documento largo, una llamada por tecla se nota. El motor **no** hace debounce ni cachea: es una función de consulta y no retiene nada entre llamadas. Amortiguar la frecuencia es responsabilidad de quien la llama, y para la lupa eso es la UI (`ui/Components.md`, `DocumentSearchBox`). Si la medición sobre documentos reales mostrara que no alcanza, la respuesta es un índice, y eso pide su propio ADR.

---

## 13. Casos límite

1. **Documento vacío (0 páginas)**: retorna `occurrenceCount = 0` sin emitir nada.
2. **Página sin texto**: 0 ocurrencias en esa página.
3. **DNI con y sin puntos (`34.567.891` y `34567891`)**: ambos matchean; `normalizedValue = "34567891"` para ambos → Grouping los unifica.
4. **CUIT inválido (dígito verificador incorrecto)**: el patrón matchea pero `checksum` falla → se descarta el match (no se emite `ENTITY_FOUND`).
5. **Tarjeta con Luhn inválido**: idem.
6. **Email edge case (`a@b.c`)**: el patrón default es RFC 5322 simplificado; requiere al menos `x@y.zz`. `a@b.c` no matchea.
7. **Patente AR vieja (`ABC 123`) vs Mercosur (`AB 123 CD`)**: dos patrones distintos; ambos emitirán `EntityType.Plate`.
8. **Patrón custom con regex inválida**: lanza `RegexInvalidPatternError` (capturado por el caller), se descarta el patrón, los demás siguen.
9. **Patrón custom con catastrophic backtracking**: timeout 1000 ms por página, se descarta el patrón con warning.
10. **Overlap entre dos patrones (DNI dentro de un CUIT)**: el CUIT es más específico; el motor prioriza el match más largo en el mismo span. Solo se emite el CUIT.
11. **Cancelación entre páginas**: aborta en < 50 ms (no requiere Worker, basta no iterar más).
12. **`process` tras `dispose`**: lanza `EngineDisposedError`.
13. **100 patrones custom activos**: el costo escala lineal con #patrones; 100 patrones × 50 páginas = 5000 ejecuciones de regex. Mitigado: compilar todas las regex al `init`, reutilizar instancias `RegExp` compiladas.

Casos de `findLiteral` (ADR-061 §1/§2 y su errata):

14. **Valor vacío o de solo espacios**: `normalizeForComparison` lo deja en `""`, no hay tokens que buscar → `occurrenceCount = 0` sin recorrer el documento, sin eventos y **sin error**. Que el usuario mande un valor vacío es un caso de UI, no un fallo del Core.
15. **Valor ausente del documento** (o escrito con un typo): `occurrenceCount = 0`, sin eventos, sin error (ADR-061 §6).
16. **El valor cruza de una línea a la siguiente**: la última palabra de una línea y la primera de la siguiente son contiguas en `Page.words` pero **no comparten banda vertical**, así que **no matchean** — la secuencia tiene que ser contigua *y* de la misma línea. Es el caso que la errata de ADR-061 §2 destapó: sin el chequeo de banda, "José Pérez" matchearía un "…José" al final de un renglón seguido de un "Pérez…" al principio del siguiente, y se anonimizaría texto que no es la entidad. **Residuo aceptado**: dos *columnas* de la misma línea visual sí comparten banda, así que ese falso positivo queda abierto (errata de ADR-061 §2, punto 7).
17. **Espacios repetidos o de más en el valor** (`"José   Pérez "`): la normalización colapsa y recorta antes de tokenizar, así que matchea igual. La tokenización es por espacios sobre el valor ya normalizado, no sobre el crudo.
18. **Coincidencias solapadas**: buscar `"ana ana"` sobre `"ana ana ana"` emite **una** ocurrencia, no dos. Tras un match el barrido avanza el largo completo de la secuencia; los solapamientos no se reportan. Buscar `"ana"` sobre lo mismo sí emite tres — son matches disjuntos.
19. **`findLiteral` tras `dispose`**: lanza `EngineDisposedError`, igual que `process` (caso 12). Sin `init` previo, `EngineNotInitializedError`.
25. **Puntuación pegada a una palabra por whitespace-split** (errata de §2, 2026-08-15): `"Gorrister,"`, `"¡Gorrister!"` matchean una búsqueda de `"Gorrister"` — el recorte es de borde, no interno (`"O'Brien"` buscado como `"OBrien"` **no** matchea, caso guarda). Y el recorte es simétrico: buscar el propio `"Gorrister,"` (el texto que devolvería un match anterior) también encuentra la palabra — si no, "Agregar como…" sobre un resultado con puntuación pegada no encontraría nada.

Casos de `searchText` (ADR-061 §8 y su errata):

20. **La búsqueda no muta nada**: `searchText` no emite ningún evento, ni siquiera cuando encuentra coincidencias. Es el caso que protege contra la regresión de la errata de ADR-061 §8 — si emitiera `ENTITY_FOUND`, tipear en la lupa crearía y fusionaría grupos en la sesión en vivo y el documento se anonimizaría solo. Tiene test de contrato con bus espía (§14).
21. **`searchText` y `findLiteral` no pueden divergir**: sobre el mismo documento y el mismo texto encuentran las mismas coincidencias, con los mismos `pageIndex`, `bbox` y `wordSpan`. No es una invariante a sostener a mano — comparten la función de matcheo por página; el test de §14 es lo que impide que alguien las separe después.
22. **Query vacía o de solo espacios**: array vacío, sin recorrer el documento y sin error (mismo criterio que el caso 14).
23. **Orden de los resultados**: página ascendente, y dentro de la página el orden de lectura de `Page.words`. Es el orden sobre el que la lupa navega "siguiente/anterior"; si no fuera estable, la navegación saltaría.
24. **`searchText` tras `dispose`**: lanza `EngineDisposedError` **sincrónicamente**, no como promesa rechazada — es una función sincrónica (§6). Sin `init` previo, `EngineNotInitializedError`, igual.

Casos de fragmentos y de la tabla de patrones (ADR-074, ADR-075):

26. **Un match que cruza un salto de línea** (ADR-074 §2): un teléfono partido entre dos renglones emite **una** `Occurrence` con `fragments.length === 2` —un rectángulo por línea, en orden de lectura— y `bbox` como envolvente de los dos. Un match de una sola línea, de una o de varias palabras, **no lleva el campo** y su `bbox` es idéntico al de antes del ADR: es la no-regresión del caso normal. Un match rotado tampoco lo lleva (§10). **`findLiteral` nunca produce fragmentos**: exige banda vertical compartida entre palabras consecutivas (caso 16), así que sus matches son de una línea por construcción — y por eso `TextMatch` no gana el campo.
27. **Fecha escrita en texto** (ADR-075 §1): `"Quilmes, 07 de julio de 2026"` emite una `Occurrence` de `Date` con `normalizedValue === "07/07/2026"` — el **mismo** que produce `"7/7/2026"`, así que Grouping las unifica por el pase exacto, sin depender del difuso (que ADR-073 §2 le retira a `Date`). Matchean también `"1º de julio de 2026"`, `"1° …"`, `"… del 2026"`, `"setiembre"` y la línea entera en mayúsculas. **No** matchean, deliberadamente, `"julio de 2026"` (sin día: identifica poco y aparece en frases que no son fechas) ni `"7 de julio de 26"` (año de dos dígitos). `"45 de julio de 2026"` matchea el patrón y lo descarta `validateDateRange`, igual que en el patrón numérico.
28. **Un tramo de un número de expediente no es un teléfono** (ADR-075 §2): sobre `"PP-13-00-027653-24/00"` no se emite ninguna ocurrencia — el match `"00-027653"` no tiene letras y su corrida sí (`PP`). Los casos que **sí** siguen emitiendo, y que son la mitad que protege contra la fuga: `"Tel: 0221-4567890."` (puntuación de oración alrededor), `"Tel:4567-8900"` (la corrida corta en el `:`), `"4567-8900,4567-8901"` (dos ocurrencias, la coma no extiende) y `"34.567.891/2024"` (corrida sin letras ⇒ la guarda no aplica). El único que se pierde es `"Tel.4567-8900"` (§6, residuo aceptado).

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits ENTITY_FOUND per match` | `contract.test.ts` | contract | invariante |
| `emits REGEX_FINISHED after all pages` | `contract.test.ts` | contract | invariante |
| `occurrence.source === "regex"` | `contract.test.ts` | contract | invariante |
| `occurrence.confidence === 1.0` | `contract.test.ts` | contract | invariante |
| `DNI with and without dots normalizes to same` | `unit.test.ts` | unit | caso 3 |
| `CUIT with invalid checksum is discarded` | `edge.test.ts` | edge | caso 4 |
| `Credit card with invalid Luhn is discarded` | `edge.test.ts` | edge | caso 5 |
| `invalid email does not match` | `edge.test.ts` | edge | caso 6 |
| `AR plate vieja and Mercosur both match as Plate` | `edge.test.ts` | edge | caso 7 |
| `custom invalid regex throws and is discarded` | `edge.test.ts` | edge | caso 8 |
| `custom catastrophic regex times out and is discarded` | `edge.test.ts` | edge | caso 9 |
| `DNI inside CUIT only emits CUIT` | `edge.test.ts` | edge | caso 10 |
| `cancel between pages within 50ms` | `cancel.test.ts` | cancel | caso 11; SLA — pendiente, diferido a Hito 11 (mismo tratamiento que PDF Engine, `MVP.md` §4 Hito 2). Comportamiento funcional (chequeo de `abortSignal` entre páginas) sí cubierto en `edge.test.ts` desde Hito 4 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 12 |
| `100 custom patterns complete within perf budget` | `perf.test.ts` (en `tests/perf/`) | perf | caso 13; pendiente, diferido a Hito 11 (mismo tratamiento que PDF Engine, `MVP.md` §4 Hito 2) |
| `empty document returns 0 occurrences` | `edge.test.ts` | edge | caso 1 |
| `textless page returns 0 occurrences` | `edge.test.ts` | edge | caso 2 |
| `findLiteral emits ENTITY_FOUND with source "manual" and correct bbox` | `contract.test.ts` | contract | ADR-061 §1 |
| `findLiteral emits no REGEX_FINISHED and does not touch the pattern registry` | `contract.test.ts` | contract | ADR-061 §1 — no es una corrida de detección |
| `findLiteral matches case- and accent-insensitively` | `unit.test.ts` | unit | ADR-061 §2 |
| `findLiteral matches a multi-word value over contiguous words of the same line` | `unit.test.ts` | unit | ADR-061 §2 |
| **`findLiteral does NOT match a value whose words fall on different lines`** | `unit.test.ts` | unit | ADR-061 §2 errata, caso 16 — el chequeo de `sharesVerticalBand`. Las palabras tienen que ser contiguas **y** compartir banda vertical; sin este test la banda se pierde en silencio y vuelve el falso positivo del corte de renglón |
| **`findLiteral does NOT match "J. Pérez" for "José Pérez"`** | `unit.test.ts` | unit | ADR-061 §2 — asertar la **limitación** deliberada: protege contra implementarla por accidente y contra romperla en silencio (`Future_Ideas.md` §5.1b) |
| `findLiteral with a value absent from the document returns 0 and emits nothing` | `edge.test.ts` | edge | ADR-061 §6 — caso 15 |
| `findLiteral with an empty or whitespace-only value returns 0 without error` | `edge.test.ts` | edge | ADR-061 §6 — caso 14 |
| `findLiteral does not report overlapping matches` | `unit.test.ts` | unit | caso 18: `"ana ana"` sobre `"ana ana ana"` emite una, no dos |
| `findLiteral throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 19 — mismo tratamiento que `process` (caso 12) |
| `findLiteral matches a word with trailing punctuation glued on (no space)` | `unit.test.ts` | unit | ADR-061 §2 errata (2026-08-15), caso 25 |
| `findLiteral matches a word with leading punctuation glued on (inverted exclamation)` | `unit.test.ts` | unit | ADR-061 §2 errata (2026-08-15), caso 25 |
| `findLiteral finds a word by its own punctuated text (round-trip via searchText)` | `unit.test.ts` | unit | ADR-061 §2 errata (2026-08-15), caso 25 — el recorte también del lado del token, no solo de la palabra |
| **`findLiteral does NOT treat internal punctuation as optional`** | `unit.test.ts` | unit | ADR-061 §2 errata (2026-08-15) — guarda contra sobre-recortar: el recorte es de borde, no interno |
| `findLiteral works over OCR-sourced words` | `edge.test.ts` | edge | ADR-061 §1 |
| **`searchText emits no events at all`** | `contract.test.ts` | contract | ADR-061 §8 errata, caso 20 — bus espía, cero emisiones sobre una query **con** coincidencias. Si este test se cae, buscar texto anonimiza el documento |
| `searchText does not touch the pattern registry or any engine state` | `contract.test.ts` | contract | caso 20 — dos llamadas con el mismo input dan el mismo resultado |
| **`searchText and findLiteral find the same matches`** | `unit.test.ts` | unit | ADR-061 §8 errata, caso 21 — mismos `pageIndex`/`bbox`/`wordSpan`. Es el test de que hay **un solo matcher**; sin él las dos entradas pueden divergir en silencio |
| `searchText returns matches in document order` | `unit.test.ts` | unit | caso 23 |
| `searchText with an empty or whitespace-only query returns an empty array` | `edge.test.ts` | edge | caso 22 |
| `searchText throws EngineDisposedError synchronously after dispose` | `edge.test.ts` | edge | caso 24 — sincrónico, no promesa rechazada |
| `propagates rotation from the matched words to the occurrence bbox` | `unit.test.ts` | unit | ADR-066 §6: `mapSpanToWords` arma un bbox nuevo y el campo se caía en silencio |
| `propagates rotation when every word of a multi-word match agrees` | `unit.test.ts` | unit | ADR-066 §6: unión de varias palabras del mismo run |
| `omits rotation when the words of a match disagree on the angle` | `unit.test.ts` | unit | ADR-066 §6: la envolvente de dos avances no tiene ángulo que la describa |
| `leaves rotation absent for horizontal text` | `unit.test.ts` | unit | ADR-066 §6: no regresión (ausente ≡ 0) |
| **`a match whose words fall on two lines emits one occurrence with two fragments`** | `unit.test.ts` | unit | caso 26 (ADR-074 §2) — **el test que define el ADR** de este lado: `fragments.length === 2`, un rectángulo por línea, y `bbox` sigue siendo la envolvente de los dos |
| `a single-line match carries no fragments and its bbox is unchanged` | `unit.test.ts` | unit | caso 26 — **no-regresión**: el caso normal no cambia ni un byte |
| `three lines produce three fragments in reading order` | `unit.test.ts` | unit | caso 26 (ADR-074 §2) |
| `a rotated match carries no fragments and keeps its rotation` | `unit.test.ts` | unit | caso 26 (ADR-074 §3) — la interacción con ADR-066 §6 |
| `bbox is the exact envelope of fragments, which never overlap` | `contract.test.ts` | contract | ADR-074 §1 — junto con `union(fragments) ⊆ bbox`, es lo que aserta que fragmentar **no puede** filtrar nada |
| **`"Quilmes, 07 de julio de 2026" is detected as a Date`** | `unit.test.ts` | unit | caso 27 (ADR-075 §1) — la línea literal de la pericia |
| `textual and numeric dates produce the same normalizedValue` | `unit.test.ts` | unit | caso 27 — la propiedad que las agrupa |
| `ordinal day, "del", "setiembre" and uppercase all match` | `unit.test.ts` | unit | caso 27 (ADR-075 §1) |
| **`"julio de 2026" and "7 de julio de 26" do NOT match`** | `edge.test.ts` | edge | caso 27 — asertar las **limitaciones** deliberadas, mismo criterio que el `"J. Pérez"` de ADR-061 §2 |
| `"45 de julio de 2026" is discarded by validateDateRange` | `edge.test.ts` | edge | caso 27 |
| **`"PP-13-00-027653-24/00" emits no Phone occurrence`** | `unit.test.ts` | unit | caso 28 (ADR-075 §2) — la cadena literal de la pericia |
| **`phone, DNI, CUIT, card and date with sentence punctuation still emit`** | `unit.test.ts` | unit | caso 28 — **no-regresión**, y es la mitad que protege contra convertir la guarda en una fuga |
| `"Tel:4567-8900" and "4567-8900,4567-8901" still emit` | `unit.test.ts` | unit | caso 28 — los separadores que **no** extienden la corrida |
| `"34.567.891/2024" still emits the DNI` | `unit.test.ts` | unit | caso 28 — corrida sin letras ⇒ la guarda no aplica |
| `License and Plate are never touched by the run guard` | `unit.test.ts` | unit | caso 28 — el match tiene letras |
| `a custom pattern is subject to the run guard too` | `edge.test.ts` | edge | ADR-075 §4 |
| `"Tel.4567-8900" does not emit (accepted residue)` | `edge.test.ts` | edge | caso 28 (ADR-075 §5) — la limitación documentada en un test, para que sea conocida y no una sorpresa |
| `snapshot of occurrences for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |

Fixtures: `tests/fixtures/text-10p.pdf` (con DNIs, CUITs, emails, teléfonos conocidos).

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/regex-engine/`.
- [ ] 2. Definir `types.ts` con `RegexPattern`, `RegexEngineConfig`, `RegexEngineInput`, `RegexEngineOutput`.
- [ ] 3. Definir `errors.ts` con `RegexInvalidPatternError`.
- [ ] 4. Implementar `DEFAULT_PATTERNS_AR` en `patterns/default-ar.ts` con todos los patrones y sus `checksum`/`normalizer`/`maskFormat`.
- [ ] 5. Implementar `regex.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 6. Implementar `init` (compilar todas las regex al cargar, incluyendo custom).
- [ ] 7. Implementar `process` recorriendo páginas, aplicando patrones, mapeando matches a `bbox` vía `Word` positions, emitiendo `ENTITY_FOUND` por match, `REGEX_FINISHED` al final.
- [ ] 8. Implementar priorización de match más largo en overlap (caso 10).
- [ ] 9. Implementar timeout por patrón custom (1000 ms).
- [ ] 10. Implementar `addPattern`/`removePattern` (recompila la lista activa).
- [x] 10b. (Hito 10.7, PR 2 — ADR-061 §1/§2 y su errata) Implementar `findLiteral`: matcheo sobre secuencias de `Word` contiguas **y de la misma línea**, `Occurrence` con `source: Manual` y bbox por `mapSpanToWords`. **Sin emitir `REGEX_FINISHED` y sin tocar el registro de patrones.** Valor ausente o vacío → `occurrenceCount: 0` sin eventos ni error. Las dos primitivas —`sharesVerticalBand` y `normalizeForComparison`— se **importan de `@anonly/shared`** (§4, `Contracts.md` §6); reimplementarlas acá es exactamente lo que la errata de ADR-061 §2 vino a impedir, y el PR de `shared` que las declara (Hito 10.7 PR 1c) es precondición de éste. Dos tests son parte del entregable, no un extra: que `"J. Pérez"` **no** matchea `"José Pérez"`, y que un valor cuyas palabras caen en **líneas distintas** tampoco (§13 caso 16). Los casos 14-19 de §13 y sus filas de §14 entran completos en este PR.
- [x] 10c. (Hito 10.7, PR 3c — ADR-061 §8 errata) Extraer el matcheo de `findLiteral` a una función interna **por página** (`collectPageTextMatches(page, queryTokens): TextMatch[]`) y construir las **dos** entradas encima: `searchText(input)` la recorre y devuelve; `findLiteral(input, ctx)` la recorre, mapea cada `TextMatch` a `Occurrence` y emite. **Por página y no por documento a propósito**: `findLiteral` conserva así su chequeo de `abortSignal` entre páginas, que un núcleo por documento habría borrado en silencio. `searchText` es **sincrónica, sin `EngineContext`, sin emitir y sin loguear la query** (§6, §12). `findLiteral` **no cambia de firma** —`Promise<RegexEngineOutput>`, contrato ya mergeado (R-2)— ni de comportamiento observable: los tests de §14 que ya existen son la no regresión. Exportar `RegexSearchInput` desde `index.ts`. Casos 20-24 de §13 y seis filas de §14.
- [x] 10d. (Hito 10.7, errata de §2 post-aprobación, 2026-08-15) `stripEdgePunctuation`: recorta puntuación de **borde** (`^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$`) de cada `Word.text` normalizado y de cada token del `value`/`query` en `slideWordWindowMatches`/`tokenizeLiteralValue`, sin tocarla en `normalizeForComparison` de `@anonly/shared` (queda local a `regex-engine`, no es una primitiva de línea/normalización compartida — ver Validación). Corrige el gap por el que `searchText`/`findLiteral` no encontraban ocurrencias cuyo `Word` viene pegado a puntuación por el whitespace-split de `pdf-engine`/`ocr-engine` (ADR-020 §1). Caso 25 de §13, cuatro filas de §14.
- [ ] 11. Implementar `dispose` (limpia lista de patrones, sin recursos externos que liberar).
- [ ] 12. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 13. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 14. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 15. Escribir `snapshot.test.ts` con occurrences de `text-10p.pdf`.
- [ ] 16. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 17. Verificar `index.ts` exporta solo `RegexEngine`, tipos, `DEFAULT_PATTERNS_AR`, errores.
- [ ] 18. Verificar imports sin dependencias prohibidas.
- [x] 19. (Hito 10.8 — ADR-066 §6) `mapSpanToWords`: propagar `bbox.rotation` a la `Occurrence`, solo si **todas** las palabras del match coinciden en el ángulo; si discrepan, el campo queda ausente (§10). **No** tocar la geometría de la unión (`x`/`y`/`width`/`height`) ni el `wordSpan`. Cuatro filas nuevas en §14.
- [x] 20. (Hito 10.9, PR 5 — ADR-074 §2/§3) `mapSpanToWords`: partir las `Word` del match en corridas de la misma línea con `sharesVerticalBand` de `@anonly/shared` (§4, `Contracts.md` §6 — **importada, no reimplementada**, mismo criterio que la errata de ADR-061 §2) y emitir un rectángulo por corrida en `Occurrence.fragments`. Con una sola corrida, **no emitir el campo**. Con `rotation` presente en alguna palabra, tampoco. **No** tocar `bbox` (sigue siendo la envolvente), ni `wordSpan`, ni la propagación de `rotation` del item 19. El PR de `shared` que declara el campo (Hito 10.9 PR 4) es precondición. Caso 26 de §13, cinco filas de §14.
- [ ] 21. (Hito 10.9, PR 13 — ADR-075 §1/§2) Dos cambios en la tabla de patrones, en el mismo PR porque son el mismo archivo: **(a)** `date-textual-ar` con su `normalizeTextualDate` (→ `DD/MM/YYYY`, el mismo `normalizedValue` que la fecha numérica) y `checksum: validateDateRange`; **(b)** la guarda de corrida de §6, aplicada a todo match de `process` incluidos los custom, calculada sobre `Page.text` alrededor del span. **No** tocar los `\b` de ADR-022, los checksums, ni la prioridad de match más largo del caso 10. Casos 27-28 de §13, once filas de §14.

> **Estado Hito 4**: items 1–18 implementados, incluyendo el comportamiento funcional de cancelación
> cooperativa (chequeo de `abortSignal` entre páginas) y de timeout por patrón custom (1000 ms).
> **Pendiente**: los archivos de test dedicados `cancel.test.ts` (SLA < 50 ms) y `perf.test.ts` (100
> patrones custom) de la tabla §14 quedan diferidos a Hito 11 — mismo tratamiento que
> `stress.test.ts`/`cancel.test.ts` del PDF Engine (`core/PDF_Engine.md` §14, `roadmap/MVP.md` §4
> Hito 2).

---

## Patrones default (especificación exacta)

Los patrones exactos viven en `patterns/default-ar.ts` y son parte del contrato público. Resumen:

| Tipo | Pattern (resumen) | Checksum | Normalizer |
|---|---|---|---|
| DNI (AR) | `\b\d{1,2}\.?\d{3}\.?\d{3}\b` | – | strip dots → "34567891" |
| CUIT/CUIL (AR) | `\b\d{2}-?\d{8}-?\d\b` | algoritmo módulo 11 | strip dashes → "20123456789" |
| Phone (AR mobile) | `(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b` | – | strip no-digit → "541112345678" |
| Phone (AR landline) | `\b0\d{1,4}[\s-]?\d{6,8}\b` | – | strip no-digit |
| Email | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` | – | lowercase |
| IBAN | `\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b` | ISO 13616 check | uppercase, strip spaces |
| CreditCard | `\b(?:\d[ -]*?){13,19}\b` | Luhn | strip non-digit |
| Date (AR) | `\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b` | validación rango (día 1-31, mes 1-12) | normaliza a "DD/MM/YYYY" |
| Date (AR, en texto) | `\b(\d{1,2})\s*[°º]?\s+de\s+(enero\|febrero\|marzo\|abril\|mayo\|junio\|julio\|agosto\|septiembre\|setiembre\|octubre\|noviembre\|diciembre)\s+del?\s+(\d{4})\b` con flags `gi` | misma validación de rango | normaliza a "DD/MM/YYYY" — **el mismo `normalizedValue` que la fila anterior**, que es lo que las agrupa |
| License (AR) | `\b[A-Z]{1,3}-?\d{4,8}-?\d?\b` (matrícula profesional) | – | uppercase, strip dashes |
| Plate (AR vieja) | `\b[A-Z]{3}\s?\d{3}\b` | – | uppercase, strip spaces |
| Plate (AR Mercosur) | `\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b` | – | uppercase, strip spaces |

La implementación debe respetar estos patrones y checksums. Cualquier cambio requiere ADR nuevo.

**Los doce patrones pasan además por la guarda de corrida de §6** (ADR-075 §2): un match sin letras
cuya corrida alfanumérica sí las tiene no se emite. La guarda no está en ningún `pattern` de la
tabla porque no es una propiedad de los patrones sino del **contexto** del match, y por eso alcanza
también a los patrones custom del usuario.

> El patrón "Phone (AR mobile)" fue corregido en la versión 1.0.1 del spec agregando límites de
> palabra (`\b`) en ambos extremos, consistente con los otros 10 patrones de la tabla. Ver
> `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md` para el detalle del problema (rompía el caso
> límite 3, §13) y la decisión.

> El patrón "Date (AR, en texto)" entró en la versión 1.6.0 del spec: la forma escrita es cómo se
> fecha un escrito judicial argentino —encabezado y pie de firma— y no la cubría ningún patrón, así
> que la fecha del documento se exportaba en claro. Ver
> `adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md` §1 para las decisiones finas (día
> obligatorio, año de cuatro dígitos, `setiembre`, ordinal, `del`) y por qué el normalizador es la
> mitad importante del patrón.

---

## Referencias

- `architecture/06_Pipeline.md` §6 (etapa 4, Regex)
- `03_Data_Model.md` §7 (Occurrence), §16 (DetectionSource)
- `04_Event_System.md` §5 (eventos `ENTITY_FOUND`, `REGEX_FINISHED`)
- `adr/ADR-011-Grouping-First.md` (por qué Regex emite a Grouping, no a UI)
- `adr/ADR-012-Replacement-Modes.md` (maskFormat por tipo)
- `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md` (corrección del patrón Phone AR mobile, v1.0.1)
