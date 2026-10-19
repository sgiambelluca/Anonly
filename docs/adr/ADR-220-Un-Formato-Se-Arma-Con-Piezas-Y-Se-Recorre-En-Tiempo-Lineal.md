<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,adr/ADR-181-Email-Default-Con-Escaner-Lineal.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-220 — Un formato se arma con piezas y se recorre en tiempo lineal

- **Estado**: Aceptado por el mantenedor el 2026-10-19, con los detalles
  técnicos del planificador (`Plan_1.1.md` §4).
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor (2026-10-13 y 2026-10-19), a propuesta del
  planificador en lo técnico.
- **Origen**: `Roadmap_1.x.md` §4 y [`Plan_1.1.md`](../roadmap/Plan_1.1.md).
- **Alcance**: contrato (`Contracts.md`, `03_Data_Model.md`,
  `04_Event_System.md`), `regex-engine` y el façade, que reexporta sus
  funciones puras. Sin dependencias nuevas.
- **Relacionado con**:
  - ADR-181: el primer escáner lineal, para el email;
  - ADR-075: la guarda de corrida;
  - ADR-029: la máscara que trae cada aparición;
  - ADR-190: nada falla en silencio;
  - ADR-219, ADR-221, ADR-222 y ADR-223.

## Contexto

### 1. Un patrón del usuario puede colgar la aplicación

`Regex_Engine.md` §12 da a cada patrón del usuario un presupuesto de 1000 ms
por página. El presupuesto se mide **después** de que el patrón termina:
JavaScript no puede interrumpir un `RegExp` a mitad de camino, y Regex corre
en el hilo principal. El propio código lo dice (`regex.engine.ts`, comentario
sobre `CUSTOM_PATTERN_BUDGET_MS`). Un patrón con retroceso catastrófico
congela la aplicación, y el límite no llega a actuar. El email por defecto
ya necesitó un escáner lineal por la misma razón (ADR-181).

### 2. Lo que decidió el mantenedor

El 2026-10-13:

- el usuario no necesita saber qué es una regex. La capacidad se presenta
  como un «generador de formatos».

El 2026-10-19:

- **el usuario solo arma formatos con el generador.** No hay un modo para
  escribir una regex a mano;
- un formato combina bloques de dígitos o letras, con cantidad fija o con
  rango, y separadores opcionales. También admite texto fijo dentro del
  dato, una palabra de contexto que se exige antes pero no se tapa, partes
  opcionales y varias variantes;
- el generador sirve para formatos de países y rubros. Los formatos base
  **con control** (dígito verificador, lista de nombres, lista de meses,
  escáner del email) solo se prenden y apagan. Los formatos base **de pura
  forma** se editan;
- un formato idéntico a otro no se crea. Uno que comparte algunos textos
  con otro avisa con un ejemplo y deja crear;
- si un formato falla durante el análisis, el análisis sigue y avisa qué
  páginas no cubrió.

### 3. Lo que eso permite

Si el usuario nunca escribe una regex, el lenguaje del generador lo elegimos
nosotros. Se puede elegir uno que se recorra en tiempo lineal. Así el riesgo
del punto 1 desaparece por construcción, sin depender de un límite de tiempo
que no se puede cumplir.

## Decisión

### 1. Qué es un formato

```ts
// Contracts.md §5
export type FormatCharClass = "digit" | "letter" | "upper" | "lower" | "alnum";
export type FormatSeparator = " " | "-" | "." | "/";

export type FormatPiece =
  | { readonly kind: "chars"; readonly charClass: FormatCharClass; readonly min: number; readonly max: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "separator"; readonly chars: ReadonlyArray<FormatSeparator>; readonly optional: boolean }
  | { readonly kind: "optional"; readonly pieces: ReadonlyArray<FormatPiece> };

export interface FormatDefinition {
  readonly id: string;                                   // "fmt:" + UUID v4
  readonly name: string;                                 // "CBU"
  readonly entityType: EntityTypeId;                     // §5
  readonly variants: ReadonlyArray<ReadonlyArray<FormatPiece>>;
  readonly contextBefore?: ReadonlyArray<string>;        // §2; ausente = sin contexto
  readonly basedOn?: string;                             // §4: id del formato base editado
  readonly enabled: boolean;
}
```

**Qué significa cada pieza:**

- **`chars`**: entre `min` y `max` caracteres de la clase.
  - `letter` es cualquier letra, con o sin tilde;
  - `upper` y `lower` son letras en mayúscula o en minúscula;
  - `alnum` es letra o dígito.
- **`text`**: texto fijo que forma parte del dato y se tapa con él, por
  ejemplo `AR-`. Se compara sin distinguir mayúsculas ni tildes.
- **`separator`**: un carácter de los elegidos, obligatorio u opcional.
- **`optional`**: un tramo que puede estar o no. No admite otro `optional`
  adentro.
- **Variantes**: el formato reconoce un texto si lo reconoce cualquiera de
  ellas.

**Límites.** Son constantes de `Contracts.md` §6:

| Constante | Valor |
|---|---|
| `FORMAT_MAX_VARIANTS` | 8 variantes |
| `FORMAT_MAX_PIECES` | 16 piezas por variante, contando las de adentro de un `optional` |
| `FORMAT_MAX_REPEAT` | `max` de una pieza `chars`, hasta 64 |
| `FORMAT_MAX_TEXT` | 40 caracteres por texto fijo y por palabra de contexto |
| `FORMAT_MAX_CONTEXT` | 5 palabras de contexto |
| `FORMAT_MAX_STATES` | 1024 estados del autómata compilado (§2) |

Además, en cada pieza `chars`, `1 ≤ min ≤ max`.

**Cada variante tiene al menos una pieza `chars`.** Un formato hecho solo
de texto fijo sería una lista de palabras, no una estructura. Además
guardaría texto literal en el equipo, y el mantenedor fijó que solo se
guardan formatos, sin datos personales (ADR-223 §3).

### 2. Cómo se recorre

**Un formato del generador no se ejecuta con `RegExp`.** `regex-engine` lo
compila a un autómata finito no determinista y lo recorre con una
simulación de estados en paralelo, la construcción clásica de Thompson. El
costo es proporcional a caracteres × estados, y no hay retroceso que pueda
dispararse. `FORMAT_MAX_STATES` acota los estados, y la validación (§3)
rechaza al crear lo que lo supere.

**Qué devuelve el recorrido:**

- **La coincidencia más a la izquierda y, de las que empiezan ahí, la más
  larga.** Después se sigue desde donde terminó. Es distinto de `RegExp`,
  que se queda con la primera alternativa que matchea, y es a propósito:
  para anonimizar conviene la lectura que cubre más.
- **Bordes implícitos.** El carácter anterior al match y el siguiente no
  pueden ser letra ni dígito. Equivale a un `\b` en los bordes
  alfanuméricos.
- **Contexto (`contextBefore`).** Una de esas palabras tiene que aparecer
  justo antes del match. Entre ella y el dato puede haber espacios y, como
  mucho, un `:`. Se compara sin mayúsculas ni tildes, y la palabra no se
  tapa.

**Después del recorrido, todo sigue como hoy:**

- la guarda de corrida de ADR-075 §2, sin excepción;
- `mapSpanToWords`, con sus `fragments` y su `rotation`;
- la `Occurrence` con `source: Regex`, `confidence: 1.0` y, nuevo,
  `formatId` (ADR-222 §2).

### 3. Validar, probar y comparar: funciones puras

`regex-engine` las exporta y el façade las reexporta. La interfaz las usa en
la pantalla de inicio, sin documento abierto (ADR-223 §1).

```ts
// Contracts.md §3.5
validateFormat(definition: FormatDefinition, context: FormatValidationContext): FormatValidation;
testFormat(definition: FormatDefinition, sampleText: string): ReadonlyArray<FormatTestMatch>;
compareFormat(definition: FormatDefinition, others: FormatComparisonInput): FormatComparison;
```

Los cinco tipos de entrada y salida son nuevos. Su forma exacta se escribe
en `Contracts.md` cuando se acepte este ADR, antes de implementar (R-19).

- **`validateFormat`** devuelve la lista de errores, cada uno con su código.
  Revisa:
  - variantes vacías, una variante sin `chars` y `min > max`;
  - los límites de §1, incluido el de estados;
  - el nombre repetido;
  - un tipo que no admite formatos (§5).
- **`testFormat`** es la prueba en vivo: qué tramos del texto de muestra se
  detectarían. Usa el mismo recorrido de §2, con bordes, contexto y guarda.
  **El texto de muestra no se guarda ni se loguea.**
- **`compareFormat`** responde las dos preguntas del aviso:
  - **¿Es idéntico a otro formato?** Dos formatos son idénticos si tienen la
    misma estructura, comparada en forma canónica: separadores ordenados,
    variantes ordenadas y textos sin mayúsculas ni tildes. Uno idéntico **no
    se crea** (decisión del mantenedor).
  - **¿Comparte textos con otro formato?** Contra otro formato del
    generador, la respuesta es exacta. Se recorre el producto de los dos
    autómatas, y el ejemplo que se muestra es el texto más corto que ambos
    reconocen. Contra un formato base con control, que no es un autómata
    del generador, se prueban ejemplos generados del formato nuevo: el más
    corto y el más largo de cada variante, con y sin cada parte opcional.
    Esa respuesta puede pasar por alto un caso raro; lo que se escape lo
    atrapa el panel al analizar (ADR-222). Un formato que comparte textos
    **avisa y deja crear**.

### 4. Los formatos base de pura forma se editan como copia

El catálogo (ADR-221) marca cada formato base con uno de dos tipos:

| Tipo | Qué es | Formatos de Argentina |
|---|---|---|
| `structure` | Tiene una `FormatDefinition` equivalente y se edita | DNI, fijo y las tres patentes |
| `control` | `RegExp` con un control, o con una forma, que el generador no expresa. Solo se prende y apaga | CUIT, celular, tarjeta, IBAN, las dos fechas, email (con su segunda búsqueda de ADR-211), matrícula, carátula y dirección con palabra clave |

**Corrección del 2026-10-19, al escribir el spec.** La primera versión de
esta tabla ponía también el celular y la matrícula entre los de pura forma.
Al escribir sus definiciones resultaron inexpresables, y pasaron a
`control` por la regla de este mismo apartado:

- el celular necesita nueve variantes, contra un máximo de ocho, y un borde
  de palabra en el medio;
- la matrícula mezcla una variante con palabra de contexto y otras sin ella,
  y el contexto es del formato entero.

Quien necesite otra forma de celular o de matrícula la crea como formato
propio bajo ese tipo. El detalle está en `Regex_Engine.md`, «Catálogo».

- **Mientras nadie lo edita, un formato base sigue corriendo con su `RegExp`
  medido.** Quien no toca nada detecta exactamente lo mismo que hoy.
- **Editar un formato `structure` crea una copia propia** con `basedOn` y
  apaga el original. «Restaurar original» borra la copia y vuelve a prender
  el original.
- **La equivalencia se prueba antes de ofrecer la edición.** La
  `FormatDefinition` de cada formato `structure` tiene que detectar los
  mismos tramos que su `RegExp` sobre los casos de `Regex_Engine.md` §14 y
  sobre la línea de base de calidad. Si un formato muestra una diferencia
  que no se puede eliminar, pasa a `control` y se informa.

### 5. Qué tipos admiten formatos, y cómo normaliza cada uno

**Admiten formatos propios:**

- los tipos propios (ADR-219);
- los tipos base que dependen del país: DNI, CUIT, Phone, License y Plate.

**No admiten:** Person, Organization, Address, Email, Date, CreditCard e
IBAN. Funcionan igual en todos lados, o tienen un control (decisión del
mantenedor del 2026-10-19).

**`normalizedValue`:**

- bajo un tipo base, se usa el normalizador de ese tipo en el catálogo. Así
  la aparición se agrupa con lo que detectan los formatos base del mismo
  tipo;
- bajo un tipo propio, se usa la clave alfanumérica de ADR-219 §4.

**`Occurrence.maskFormat`:**

- bajo un tipo base, es el valor detectado con cada letra o dígito cambiado
  por `X`. La resolución por grupo de ADR-029 no cambia;
- bajo un tipo propio, no se emite, porque la máscara sale del valor
  canónico (ADR-219 §3).

### 6. Un formato que falla no frena el análisis, y se avisa

Por construcción, un formato no puede colgar el análisis. Si igual falla en
una página, por un defecto del código:

- `regex-engine` saltea ese formato en esa página y sigue con los demás y
  con las páginas siguientes;
- loguea un `warn` con el id del formato y la página, **sin texto del
  documento**;
- lo informa en el evento que ya existe:

  ```ts
  // Contracts.md §8
  export interface RegexFinished {
    readonly documentId: string;
    readonly occurrenceCount: number;
    readonly durationMs: number;
    readonly skippedFormats?: ReadonlyArray<{ readonly formatId: string; readonly pageIndices: ReadonlyArray<number> }>;
  }
  ```

  Ausente equivale a ninguno, la misma convención que `unreadableInk` de
  ADR-190 §4. La interfaz lo escucha y avisa nombrando el formato y las
  páginas.

**Una definición inválida que llega al `init`** se descarta con
`REGEX_INVALID_PATTERN` y `warn`, y figura en `skippedFormats` con todas
las páginas. No debería pasar, porque se valida al crear y al importar; es
una defensa más.

### 7. Se retira la API de patrones con `RegExp` del usuario

Salen del contrato público de `Regex_Engine.md` §6:

- `RegexEngineConfig.customPatterns: ReadonlyArray<RegexPattern>`;
- `addPattern` y `removePattern`;
- el presupuesto de 1000 ms de §12.

Ningún código de producto los usa hoy (ADR-219, Contexto §2). Los formatos
del usuario llegan solo como `FormatDefinition`, en
`EngineConfig.detection` (ADR-223 §2). Es un cambio de contrato (R-2), y lo
cubre este ADR.

## Lo que no cambia

- Los formatos base sin editar, con su `RegExp`, su control, su orden y su
  medición.
- La guarda de corrida y la prioridad del match más largo entre formatos
  del mismo tipo.
- `findLiteral` y `searchText` (ADR-061): siguen siendo búsquedas literales.

## Consecuencias

**A favor**

- Ningún formato del usuario, propio o importado, puede congelar la
  aplicación. Un archivo de afuera solo puede traer piezas del generador
  (ADR-223 §6).
- El aviso de formato compartido es exacto entre formatos del generador, y
  muestra un ejemplo real.

**En contra**

- **Es un recorrido nuevo que hay que escribir y probar.** No es una
  librería: R-12 no la permite sin ADR, y no hace falta. El precedente de
  ADR-181 muestra que alcanza con un escáner propio bien testeado.
- **La lectura más larga puede diferir de lo que haría `RegExp`** en un
  formato con variantes que se pisan. Es deliberado, y lo fija un test.
- **Contra los formatos base con control, el aviso es por ejemplos.** Lo que
  se escape aparece como conflicto al analizar.

## Cómo se verifica

- **Tiempo lineal.** Un formato con piezas variables pegadas, el caso que
  con `RegExp` dispara retroceso catastrófico, recorre una página de
  100 000 caracteres sin pasar un presupuesto proporcional a su largo.
- **Las piezas.** Rangos, separadores opcionales, texto fijo, contexto que
  no se tapa, partes opcionales y variantes, cada una con su caso.
- **Lectura y bordes.** Gana la lectura más a la izquierda y más larga, y
  los bordes impiden matchear dentro de una palabra.
- **La guarda de corrida** descarta un tramo numérico de un identificador
  alfanumérico, igual que con un formato base.
- **Validación.** Se rechazan una variante sin `chars`, los límites
  superados, más de 1024 estados y un tipo que no admite formatos.
- **Comparación.**
  - Dos formatos con la misma estructura en otro orden son idénticos.
  - Dos formatos que comparten un texto dan como ejemplo el más corto.
  - Contra CUIT, el aviso aparece por ejemplos.
- **Equivalencia.** Cada formato `structure` de Argentina da los mismos
  tramos que su `RegExp`.
- **Fallo.** Un formato que lanza en una página aparece en
  `skippedFormats` con esa página, y los demás formatos siguen.
- **El texto de prueba** no aparece en ningún log.
