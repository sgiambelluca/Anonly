<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-011-Grouping-First.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-083 — El panel de conflicto elige el tipo de entidad, no el modo de reemplazo

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano: *"que el panel de conflicto le deje elegir al usuario con qué tipo de entidad se identifica … El usuario no tiene por qué saber qué es Regex o qué es el NER: directamente le digo, con 'Fiscalía de Quilmes', la opción de agregarlo como Organización o como Dirección. Si no elige ninguno, que el default sea el que tenga más confidence."*
- **Relacionado con**: **ADR-082** (la capacidad de cambiar el tipo de un grupo, que este ADR consume), ADR-011 §conflictos, ADR-012 (modos de reemplazo, que dejan de ser lo que este diálogo decide), `UX_Guidelines.md` §6.
- **Parte de**: cierre de la observación §6.1 punto A del plan del Hito 10.

> Convención de citas: `ADR-083 §N` refiere a **Decisión §N**.

## Contexto

### 1. El diálogo de hoy es informativo disfrazado de accionable

Verificado línea por línea. Cuando dos detectores se pisan sobre el mismo span, `findOverlapConflict` (`grouping.engine.ts:1613`) los cruza y `conflictWinnerIsNew` decide **solo**: en `Disagree` gana Regex, en `Overlap` gana la mayor confidence. La ocurrencia perdedora **se descarta**: `if (!newWins) return;` — no se agrupa y no se registra.

El `Conflict` que se emite es un **aviso** de esa decisión ya tomada. Y `applyConflictResolve` (`:1416`), que es lo que corre al apretar "Aplicar", hace esto:

```ts
const resolved: Conflict = { ...conflict, resolved: true, resolvedMode: req.mode };
…
group.replacementMode = req.mode;          // ← lo único que cambia
group.replacementValue = computeReplacementValue(…);
```

**No toca el `entityType`.** El usuario abre un diálogo que le dice "Regex dice `Organization`, NER dice `Address`", elige un modo de reemplazo, aplica… y la discrepancia queda idéntica. Lo único que consiguió fue apagar el ⚠ y, de paso, cambiarle el modo al grupo — cosa que ya podía hacer desde el `Select` de la propia fila.

### 2. Y le pide al usuario que sepa cosas que no le importan

El diálogo lista los candidatos como `"Regex: Organization (confidence 1.00)"` / `"NER: Address (confidence 0.88)"`, con una "resolución sugerida" que también nombra la fuente. Regex y NER son detalles de implementación del pipeline. Para quien anonimiza una pericia, la pregunta útil es una sola: **¿esto es una organización o una dirección?**

### 3. El default pedido resulta ser el comportamiento actual, no un cambio

El humano pidió que, sin elección explícita, gane el candidato de mayor confidence. Verificado: **`regex-engine` emite siempre `confidence: 1.0`** (`regex.engine.ts:397` y `:583`), y NER propaga el score del modelo, que es `< 1.0`. O sea que "mayor confidence, empate a Regex" es **exactamente equivalente** a la regla vigente de `conflictWinnerIsNew` para `Disagree` ("gana Regex siempre") y ya es literalmente la regla de `Overlap`.

Eso vuelve la decisión mucho más barata de lo que parecía: **no hay que cambiar el motor de resolución automática**. El default ya es el pedido; lo que falta es dejar que el usuario lo **contradiga**.

### 4. Por qué necesita ADR

`ConflictResolveRequested` (`shared/src/events.ts:317`) transporta `{ documentId, conflictId, mode: ReplacementMode }` y `Conflict.resolvedMode` guarda esa elección. Cambiar lo que el usuario elige cambia los dos, que están publicados en `Contracts.md` y `03_Data_Model.md`.

## Decisión

### 1. El diálogo elige entre los **tipos** de los candidatos

`ConflictResolveRequested` pasa a:

```ts
export interface ConflictResolveRequested {
  readonly documentId: string;
  readonly conflictId: string;
  /**
   * Tipo elegido por el usuario entre los de `conflict.candidates`.
   * Ausente = aceptar el default (el candidato de mayor confidence, §3).
   */
  readonly entityType?: EntityType;
}
```

`mode` **se retira**. El modo de reemplazo sigue siendo editable donde siempre estuvo: el `ReplacementModeSelect` de la fila del grupo. No se pierde ninguna capacidad; se deja de pedir la decisión equivocada en el lugar equivocado.

### 2. Aplicar = reclasificar el grupo + marcar resuelto

`applyConflictResolve` deja de tocar el `replacementMode` y pasa a aplicar el **tipo** elegido por la vía de ADR-082 §2 (el mismo camino interno que `updateGroup({ type })`, con su recálculo de índice, token, modo efectivo, género y registros de sesión). Después marca el conflicto `resolved`.

Si el tipo elegido es el que el grupo ya tiene —el caso del default, y el de `"Fiscalía de Quilmes"`, donde Regex tenía razón— **la reclasificación es no-op** y lo único que ocurre es que el conflicto queda resuelto. Sin eventos espurios.

### 3. `Conflict.resolvedMode` → `resolvedType`

```ts
readonly resolvedType?: EntityType;   // antes: resolvedMode?: ReplacementMode
```

Registra qué eligió el usuario, que es lo que ahora significa "resolver". `CONFLICT_RESOLVED` acompaña: su `mode` pasa a `entityType`.

### 4. Sin elección explícita, gana el de mayor confidence — que es lo que ya pasa

`entityType` ausente ⇒ el motor aplica el candidato de mayor confidence, con empate a favor de `Regex`. Es la regla que `conflictWinnerIsNew` ya implementa y que, dado `confidence: 1.0` de Regex (Contexto §3), coincide con la resolución automática que el motor tomó al crear el conflicto.

**Consecuencia deliberada**: resolver sin elegir nada es un no-op sobre los datos. Es correcto — el usuario está confirmando lo que el motor ya hizo.

### 5. Los tipos que ofrece el diálogo salen de los candidatos, no del catálogo

Solo los `entityType` **distintos** presentes en `conflict.candidates`. Para `"Fiscalía de Quilmes"` son dos: `Organización` y `Dirección` (el enum `EntityType` no tiene un `Location`: el vecino natural de `Organization` es `Address`). No se ofrece el catálogo completo: eso es "Cambiar categoría" (ADR-082 §6), disponible en el menú del grupo para cualquier grupo, con o sin conflicto.

Si todos los candidatos comparten tipo —posible en `LowConfidence` y `AmbiguousCanonical`, cuyos conflictos no son sobre la clasificación— el diálogo no ofrece elección y solo permite **descartar** el aviso. Queda escrito para que no se lea como un caso olvidado.

### 6. La UI deja de nombrar a Regex y a NER

Los candidatos se listan por **tipo y valor**, no por fuente:

> Detectamos esto como **Dirección**. También podría ser **Organización**.
> ( ) Organización  ( ) Dirección  → [Aplicar] [Descartar]

La confidence tampoco se muestra: es la que ordena las opciones (la de mayor confidence va primera y preseleccionada), no un número que el usuario tenga que interpretar. `DETECTION_SOURCE_LABEL` deja de usarse en este diálogo.

### 7. Qué NO cambia

- **`conflictWinnerIsNew` no se toca** (Contexto §3): la resolución automática ya hace lo pedido.
- **La ocurrencia perdedora sigue descartándose.** Elegir el otro tipo **reclasifica el grupo que sobrevivió**, no resucita la ocurrencia que se tiró. Es la diferencia entre "esta entidad es de tal clase" (lo que el usuario quiere decir) y "quiero el span que detectó el otro motor" (que exigiría retener datos descartados, ver Alternativas).
- Los cuatro `ConflictReason` siguen igual.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Retener las ocurrencias perdedoras y dejar elegir el span** | Es la lectura literal de "Usar NER": el grupo pasaría a tener los bboxes que detectó NER en vez de los de Regex. Cuesta memoria por documento que hoy no se gasta, una operación de reasignación que no existe, y —lo decisivo— **no es lo que el usuario pidió**: pidió elegir la clase, no la geometría. En `Disagree` los dos spans se solapan >50%, así que la diferencia de bbox es marginal frente a la de tipo. |
| **Conservar `mode` y agregar `entityType`** | Deja el diálogo pidiendo las dos cosas, que es justo lo que el humano quiso sacar. Y el modo ya tiene su control en la fila. |
| **Ofrecer el catálogo completo de tipos en el diálogo de conflicto** | Confunde dos operaciones: el conflicto es "entre estas dos lecturas, ¿cuál?"; la corrección libre es ADR-082 §6. Un diálogo con 13 opciones para un conflicto de 2 candidatos hace más difícil la decisión fácil. |
| **Cambiar `conflictWinnerIsNew` a "mayor confidence" para `Disagree`** | Innecesario: con `confidence: 1.0` en Regex ya es equivalente (Contexto §3). Tocarlo sería cambiar un comportamiento testeado (caso 8 de §13) sin ninguna diferencia observable. |

## Consecuencias

**Positivas**: el diálogo pasa a hacer algo; el usuario deja de necesitar saber qué es Regex y qué es NER; el default explícito coincide con lo que el motor ya hacía, así que no hay migración de comportamiento; se apoya en ADR-082 en vez de abrir un segundo camino para cambiar el tipo.

**Negativas / riesgos asumidos**:

- **Cambio incompatible** en `ConflictResolveRequested` y `Conflict.resolvedMode`. Verificado que los únicos consumidores son `ConflictDialog.tsx`, `conflictResolution.ts` y `actions.ts` — todo dentro de `apps/react-client`, más el motor.
- Un usuario que usaba el diálogo para cambiar el modo de reemplazo tiene que hacerlo ahora desde la fila. Es un click distinto, no una capacidad perdida.
- Resolver sin elegir no cambia datos (§4). Puede sorprender a quien espere que "Aplicar" siempre haga algo; el texto del diálogo lo dice.

## Validación

- Un conflicto `Disagree` con candidatos `Organization` (1.0) y `Address` (0.88) ofrece **dos** opciones, con `Organization` preseleccionada.
- Resolver con `entityType: Address` reclasifica el grupo: `type`, `indexInType` y `replacementValue` cambian por la vía de ADR-082, y el conflicto queda `resolved` con `resolvedType: Address`.
- Resolver **sin** `entityType` marca el conflicto resuelto y **no** emite `ENTITY_GROUP_UPDATED` (el default coincide con el tipo vigente).
- Un conflicto cuyos candidatos comparten tipo se puede descartar sin elección, sin lanzar.
- `CONFLICT_RESOLVED` transporta `entityType`, no `mode`.

## Documentos afectados

- `core/Contracts.md`, `architecture/03_Data_Model.md` (`Conflict.resolvedType`) y `architecture/04_Event_System.md` §10.
- `core/Grouping_Engine.md` (§6/§7, §13, §14).
- `ui/Components.md` §6.2 y `ui/UX_Guidelines.md` §6 (el mockup con "[Usar Regex]/[Usar NER]" se reemplaza).
- Código: `shared` → `grouping-engine` → `apps/react-client`, **después** de los PRs de ADR-082 (este ADR consume su capacidad).
