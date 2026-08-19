<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,architecture/08_Security_Model.md,adr/ADR-011-Grouping-First.md,adr/ADR-026-GroupingConfig-Canonical.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md | audiencia=humanos+IA | fase=10.9 -->

# ADR-073 — El pase difuso agrupa texto libre, nunca identificadores estructurados

- **Estado**: Accepted
- **Fecha**: 2026-08-15
- **Decidido por**: El humano, al tomar los puntos 1, 2, 4, 4bis y 10 de `roadmap/Post_Hito10.8_Pendientes.md` como Hito 10.9. El defecto salió de la prueba manual sobre la pericia judicial real durante el Hito 10.8 y quedó anotado como **el más grave** de esa lista.
- **Relacionado con**: **ADR-011** (grouping first: este motor es el que decide qué es "la misma entidad"), **ADR-026** (`GroupingConfig.similarityThreshold`, cuyo default 0.88 es el número que dispara el defecto), ADR-028 (la numeración canónica, que cuenta grupos y por lo tanto hereda el error), ADR-038 §3 (el dedup por identidad, que es exacto y no se toca)
- **Parte de**: Hito 10.9, PR 1

> Convención de citas: `ADR-073 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-073, Contexto §N`.

## Contexto

### 1. Dos fechas distintas salen como un solo grupo

Medido sobre la pericia real: `1/7/2026` y `7/7/2026` —dos fechas que no tienen nada que ver— terminan en el mismo `EntityGroup`, `Fecha 01`.

La causa está verificada y es aritmética. `findMatchingGroup` (`grouping-engine/src/grouping.engine.ts`) tiene dos pases: match exacto por `normalizedValue` y, si ninguno da, un pase **difuso** por Levenshtein normalizado contra `GroupingConfig.similarityThreshold` (default 0.88, ADR-026). La fórmula es la de `Grouping_Engine.md` §"Algoritmos clave":

```text
levenshteinNormalized(a, b) = 1 - levenshtein(a, b) / max(a.length, b.length)
```

Las dos fechas normalizan a `01/07/2026` y `07/07/2026` (`normalizeDate`, `patterns/default-ar.ts`): 10 caracteres, distancia 1.

```text
1 - 1/10 = 0.900  ≥  0.88  →  mismo grupo
```

### 2. No es un problema de las fechas: es de todo valor largo

El umbral no compara *tipos*, compara *largos*. Un carácter de diferencia sobre un `normalizedValue` de **9 caracteres o más** ya supera 0.88 (`1 - 1/9 = 0.889`). Por tipo, con el `normalizedValue` que produce cada `normalizer` de la tabla de patrones:

| Tipo | `normalizedValue` | Largo | Similitud con 1 carácter distinto | ¿Se fusionan? |
|---|---|---|---|---|
| IBAN | `AR9700000...` (sin espacios) | 22 | 0.955 | **sí** |
| CreditCard | solo dígitos | 13–19 | 0.923–0.947 | **sí** |
| Phone | solo dígitos | 10–12 | 0.900–0.917 | **sí** |
| CUIT | sin guiones | 11 | 0.909 | **sí** |
| Date | `DD/MM/YYYY` | 10 | 0.900 | **sí** |
| Email | minúsculas | variable | ≥ 0.889 desde 9 caracteres | **sí**, en la práctica siempre |
| License | mayúsculas sin guiones | variable | 0.857 (8) … 0.909 (11) | **depende del valor** |
| DNI | sin puntos | 8 | 0.875 | no — **por 0,005** |
| Plate | sin espacios | 6–7 | 0.833–0.857 | no |

Dos hechos de esa tabla importan más que el resto:

- **El DNI no está protegido: tiene suerte.** `0.875 < 0.88` por cinco milésimas. Nadie eligió ese margen; sale de que el DNI argentino tiene 8 dígitos y de que el default es 0.88. Un umbral de 0.87 —perfectamente defendible para texto libre— fusionaría dos DNI distintos sin que ninguna línea de código cambie de intención.
- **`License` y `Email` se comportan distinto según el valor concreto.** Es peor que fusionar siempre: dos documentos con matrículas de largo distinto se anonimizan con criterios distintos, y no hay forma de que el usuario prediga cuál le tocó.

### 3. Qué protege de verdad el pase difuso

El pase difuso existe por el OCR y por la variación de escritura sobre **texto libre**: `"Diego Ram0s"` por `"Diego Ramos"` (`O` → `0` es la confusión clásica de Tesseract), `"Estudio Gonzalez"` y `"Estudio González"`, una dirección con y sin `"Nº"`. Ahí un carácter de diferencia es **ruido del canal**, y agrupar es lo correcto: son la misma entidad escrita dos veces.

> **Corrección (2026-08-18, hallazgo de la revisión del Hito 10.9)**: el ejemplo original de esta sección era `"Diego Rarnos"` por `"Diego Ramos"` (confusión `rn`→`m`), citado con similitud 0.909. Verificado contra la implementación real: `levenshteinNormalized("diego ramos", "diego rarnos")` da **0.833**, por debajo del umbral 0.88 — ese par nunca fusionó, ni antes ni después de este ADR. El código y los tests siempre usaron `"Diego Ram0s"` (confusión `O`↔`0`, distancia 1, similitud 0.909, la que sí cruza el umbral); esta sección quedó desactualizada respecto de esa corrección hasta ahora.

En un identificador estructurado, un carácter de diferencia **es otra entidad**. No hay una lectura intermedia: `20-12345678-9` y `20-12345679-9` son dos contribuyentes, no dos formas de escribir uno. El propio motor ya sabe distinguir las formas legítimas de escribir el mismo identificador —para eso está el `normalizer` de cada patrón, y por eso `34.567.891` y `34567891` caen en el mismo grupo por el pase **exacto** (§13 caso 3), sin necesidad de ningún difuso.

### 4. El daño no es cosmético, y no se ve

Cuando dos CUIT distintos caen en el mismo grupo:

- **El documento anonimizado afirma algo falso.** Todas las `Replacement` de un grupo comparten `replacementValue` (invariante de ADR-012, re-asertado por ADR-057 §4). Los dos CUIT salen como `[CUIT 01]` en todo el documento: el lector del documento anonimizado concluye que las dos apariciones son la misma empresa. En una pericia judicial eso **distorsiona la evidencia**, y lo hace en la dirección menos recuperable — el original no viaja con el export.
- **El árbol de entidades no lo muestra.** El grupo fusionado tiene un solo `canonicalValue` (el alias más frecuente) y los dos valores viven adentro de `aliases`, que `03_Data_Model.md` §9 define como *"variantes detectadas que se unifican a `canonicalValue`"*. O sea: la UI presenta la fusión como una **variante de escritura**, que es exactamente lo que no es. El usuario tendría que abrir el grupo y comparar dígito por dígito para notarlo.
- **La cuenta de entidades queda mal.** `indexInType` numera grupos (ADR-028): dos CUIT fusionados son un `[CUIT 01]` donde debería haber `[CUIT 01]` y `[CUIT 02]`. La numeración es determinista y auditable, pero está contando mal.
- **En modo `mask` se vuelve invisible.** Los dos salen `XX-XXXXXXXX-X`. No hay ninguna señal, en ningún panel, de que se fusionaron dos identificadores distintos.

La salida existe —`GROUP_SPLIT_REQUESTED`, dividir a mano (§13 caso 6)— pero exige que el usuario **primero lo note**, y todo lo de arriba conspira para que no lo note.

### 5. Por qué es un ADR y no un fix

El pase difuso es comportamiento **documentado**: `Grouping_Engine.md` §2 (*"por `normalizedValue` exacto o fuzzy"*), §"Algoritmos clave" y §13 caso 4 lo describen para todos los tipos por igual. Cambiar a qué tipos se aplica cambia la semántica pública del motor, y R-18 pide ADR antes de implementarlo.

## Decisión

### 1. El pase difuso corre **solo** para `Person`, `Organization` y `Address`

La lista es **cerrada y explícita**, no derivada de una propiedad ("los que no tienen `checksum`", "los que no son numéricos"). Se escribe como una constante del motor:

```ts
/** ADR-073 §1: los tres tipos cuyo valor es texto libre. */
const FUZZY_MATCHING_TYPES: ReadonlySet<EntityType> = new Set([
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
]);
```

Motivo de que sea una lista y no una regla: una regla derivada vuelve a atar el comportamiento a una propiedad que puede cambiar por otra razón (agregar un `checksum` a un patrón, cambiar un `normalizer`) y el efecto sería mover en silencio un tipo de un lado al otro. Los tres tipos de texto libre son los que **NER** emite (`NER_Engine.md` §2), y son los únicos donde una diferencia de un carácter puede ser ruido del canal en vez de dato.

`EntityType.Custom` queda **afuera**: su valor lo define un patrón que escribió el usuario y el motor no tiene ninguna base para decidir si un carácter de diferencia es un typo o un identificador distinto. Ante la duda, no agrupar — la fusión manual es un click y la división de un grupo mal fusionado exige darse cuenta primero (Contexto §4).

### 2. Para los otros diez tipos, el matcheo es exacto por `normalizedValue`

Nada más. Es lo que ya hace el primer pase, y es suficiente por diseño: las variantes legítimas de escritura de un identificador estructurado las colapsa el `normalizer` de su patrón (`stripDots`, `stripDashes`, `stripNonDigits`, `normalizeDate`, …), no la distancia de edición. El caso 3 del spec —`34.567.891` y `34567891` en el mismo grupo— sigue funcionando exactamente igual, y por el pase exacto, no por el difuso.

### 3. `similarityThreshold` no cambia de nombre, de default ni de significado

Sigue siendo `0.88`, sigue viviendo en `GroupingConfig` (ADR-026) y sigue significando lo mismo: el umbral del pase difuso. Lo único que cambia es **a qué tipos se le aplica ese pase**. No se agrega config nueva, no se agrega un umbral por tipo (ver Alternativas) y el `GroupingConfig` que hoy inyecta el host sigue siendo válido sin tocar nada.

### 4. Lo que le pasa a un documento que hoy fusiona

Dos CUIT que difieren en un dígito pasan a ser **dos grupos**, con `indexInType` propio y `replacementValue` propio. Si de verdad eran el mismo (un OCR que se comió un dígito de la misma empresa en dos páginas), el usuario los fusiona con `GROUP_MERGE_REQUESTED` (§13 caso 5), que es una operación de un paso y **reversible**.

La asimetría es deliberada y es la razón de fondo de este ADR: **de más grupos no sale ninguna fuga.** Un grupo de más se tapa igual; lo único que se pierde es que dos apariciones lleven números distintos. Un grupo de menos afirma una identidad falsa en un documento que va a manos de un tercero.

### 5. Lo que **no** se toca

- El pase **exacto** por `normalizedValue`, para los trece tipos.
- El dedup por identidad de ADR-038 §3, que ya es exacto por `(entityType, pageIndex, bbox, normalizedValue)`.
- El cálculo de `canonicalValue` (alias más frecuente, empate por largo) y el alta de `aliases`.
- La detección de conflictos, que compara bboxes y tipos, no valores.
- `levenshtein.ts`: la implementación no cambia. Lo que cambia es **cuándo se la llama**.
- El umbral, el default y el tipo de `GroupingConfig` (§3).

### 6. Efecto colateral bienvenido: el pase difuso se vuelve más barato

`Grouping_Engine.md` §12 estima 0.5–2 ms por `Occurrence`, dominados por el fuzzy contra todos los aliases de los grupos del mismo tipo. Los tipos estructurados son los que más grupos generan en un documento denso (fechas, teléfonos, expedientes) y son justamente los que dejan de correr el pase O(G × len). No es la razón de este ADR y no hay que medirlo como gate; queda anotado porque el ADR no puede empeorar la performance y conviene que quede dicho por qué.

### 7. Alcance y tests

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | Este ADR + propagación a specs | `docs/` | — |
| 2 | `FUZZY_MATCHING_TYPES` y la guarda en `findMatchingGroup` | `grouping-engine` | 1 |

Tests del PR 2 (`grouping-engine`):

- **Unit — el test que define este ADR**: dos `Occurrence` de `EntityType.Date` con `normalizedValue` `01/07/2026` y `07/07/2026` producen **dos** grupos. Es la reproducción literal del caso medido sobre la pericia.
- **Unit**: lo mismo para `CUIT` (`20123456789` / `20123456799`), `Phone`, `CreditCard`, `IBAN` y `Email` — un carácter de diferencia, dos grupos, en los seis.
- **Unit — no-regresión del texto libre**: `"Diego Ramos"` y `"Diego Ram0s"` (`Person`) siguen cayendo en el mismo grupo, con `aliases` de dos entradas. Mismo test para `Organization` y `Address`.
- **Unit — no-regresión del pase exacto**: `34.567.891` y `34567891` (`DNI`) siguen en un solo grupo (§13 caso 3). Es el test que separa "el `normalizer` los unificó" de "el difuso los unificó".
- **Edge**: `Custom` no agrupa por difuso (§1).
- **Edge**: el DNI, que hoy no se fusiona por 0,005, tampoco se fusiona si el host baja `similarityThreshold` a 0.80 — la protección deja de depender del número.
- **Edge**: dos grupos que este ADR ya no fusiona se pueden fusionar a mano y el resultado es el de siempre (§13 caso 5). Es la salida documentada de §4 y tiene que estar cubierta.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Subir el umbral global** (0.95, 0.97) | No resuelve nada y rompe lo que funciona. Con 0.95 el IBAN (0.955) se sigue fusionando y el texto libre deja de agruparse: `"Diego Ramos"` vs `"Diego Ram0s"` da 0.909 y quedarían separados, que es el caso para el que el pase difuso existe. Además cambia un número por otro número sin fundamento: la propiedad que hace falta no es "más estricto", es "no aplicable". |
| **Umbral por tipo** | Obliga a inventar trece números sin ningún dato que los respalde, y para los diez tipos estructurados **el número correcto es 1.0**, que es decir "match exacto" con más ceremonia. Suma superficie de configuración (`GroupingConfig` pasaría de dos campos a un mapa por tipo) para expresar peor la misma decisión. |
| **Distancia absoluta en vez de normalizada** ("≥ 1 edición ⇒ distinto") para los estructurados | Es este ADR escrito de otra forma, pero deja el pase difuso **conectado** a esos tipos con un umbral que alguien puede volver a mover. La guarda por tipo es una condición binaria que no se puede desajustar por accidente. |
| **Validar la fusión con el `checksum` del patrón** | Solo cuatro tipos tienen `checksum` (CUIT, CreditCard, IBAN, Date por rango). DNI, Phone, License y Plate no tienen ninguno, y son cuatro de los cinco casos del reporte. Además obligaría a `grouping-engine` a conocer los patrones de `regex-engine`, que es exactamente lo que P-1 prohíbe. |
| **Ponderar la distancia por clase de carácter** (un dígito distinto pesa más que una letra) | Un modelo de similitud nuevo, con sus propias constantes que calibrar, para llegar a la misma conclusión que una lista de tres tipos. Y sigue dando "parecido" donde la respuesta correcta es "distinto". |
| **Dejarlo y avisar en la UI** ("estos dos valores difieren en un carácter") | Traslada al usuario una decisión que el motor puede tomar bien, en el panel más cargado del producto, y contra el modo de falla de Contexto §4: el aviso aparece justo donde el usuario no está mirando. |
| **No hacer nada** | Es el estado que produjo el reporte. Y el DNI —el identificador más común en un documento argentino— está a cinco milésimas de caer también. |

## Consecuencias

**Positivas**: dos identificadores distintos dejan de poder presentarse como el mismo en el documento exportado, que era el defecto; la protección deja de depender del largo del valor y del valor concreto de un umbral; el comportamiento pasa a ser el mismo para todos los documentos, en vez de variar con el largo de una matrícula o un email; el pase difuso queda acotado a los tres tipos donde tiene sentido, que son además los que lo motivaron; el error, cuando ocurra, ocurre del lado que no filtra datos; y el fuzzy deja de correr sobre los tipos que más grupos generan (§6).

**Negativas**: dos ocurrencias del mismo identificador estructurado que el OCR leyó distinto pasan a ser dos grupos y hay que fusionarlas a mano — el caso real es un escaneo malo sobre un CUIT, y la operación es de un paso y reversible (§4); un documento ya procesado con la versión anterior puede agrupar distinto con la nueva, lo que es el objetivo, pero conviene tenerlo dicho antes de que alguien lo reporte como cambio inesperado; y `Custom` pierde una agrupación difusa que nadie pidió pero que existía (§1).

**Neutras**: `GroupingConfig`, su default y su semántica no cambian (§3); ningún tipo, evento ni error code cambia de forma, así que `Contracts.md` no se toca; `levenshtein.ts` queda igual; el pase exacto, el dedup de ADR-038 §3 y la resolución de `canonicalValue` no se enteran; y la fusión y la división manual siguen siendo la misma operación de siempre.

## Docs actualizados por este ADR

- `core/Grouping_Engine.md` → v1.6.0: §2 (la responsabilidad de matchear "exacto o fuzzy" pasa a decir para qué tipos), §13 caso 4 (que hoy usa `"J. Pérez"`/`"Juan Pérez"` para ilustrar el difuso y sigue valiendo, ahora explícitamente sobre `Person`), §13 caso nuevo (dos identificadores estructurados que difieren en un carácter no se fusionan), §14 (los tests de §7), §15 (ítem de checklist), y §"Algoritmos clave" > "Matching", que es donde vive el pseudocódigo de los dos pases.
- `roadmap/MVP.md` §4 — bloque nuevo del Hito 10.9 y la frase del Hito 10.8 que dejaba esto anotado como pendiente sin ADR.
- `roadmap/Post_Hito10.8_Pendientes.md` §1 — pasa de pendiente a adoptado, con el ADR que lo cierra.

`core/Contracts.md` **no** se toca: no hay tipo, evento ni error code nuevo, y `GroupingConfig` queda idéntico.

## Validación

- Los tests de §7, en particular el que define el ADR: `01/07/2026` y `07/07/2026` producen dos grupos.
- El escenario medido reproducido sobre la pericia real (verificación manual): las fechas del encabezado dejan de colapsar en `Fecha 01` y la lista de entidades muestra la cantidad de fechas que el documento tiene.
- La no-regresión del texto libre es condición de mergeo, no un extra: si `"Diego Ram0s"` deja de agrupar con `"Diego Ramos"`, este ADR rompió lo que vino a proteger.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Grouping_Engine.md` §2, §12, §13 casos 3-5, §"Algoritmos clave" — `core/Contracts.md` §6 (`GroupingConfig`) — `architecture/03_Data_Model.md` §9 (`aliases`, `canonicalValue`)
- `adr/ADR-011` — `adr/ADR-012` (invariante de un `replacementValue` por grupo) — `adr/ADR-026` — `adr/ADR-028` — `adr/ADR-038` §3 — `adr/ADR-057` §4
- `roadmap/Post_Hito10.8_Pendientes.md` §1 (el reporte original, con la medición)
- Código: `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`findMatchingGroup`), `packages/anonymization-core/grouping-engine/src/levenshtein.ts`
