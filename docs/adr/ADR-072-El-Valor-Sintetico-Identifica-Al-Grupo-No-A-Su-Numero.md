<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/08_Security_Model.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-019-Hito1-Hardening.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-071-El-Genero-Se-Muestra-Solo-Donde-Se-Usa.md | audiencia=humanos+IA | fase=10.6 -->

# ADR-072 — El valor sintético identifica al grupo, no a su número

- **Estado**: Accepted
- **Fecha**: 2026-08-14
- **Decidido por**: El humano, al planificar ADR-071: *"prefiero sacárnoslo de encima ahora y dejarlo en el mejor estado posible"*. El defecto apareció al revisar por qué `renumberGroupsCanonically` no recalcula el `replacementValue` en modo `synthetic`, y resultó ser el síntoma de algo anterior: el nombre falso está sembrado sobre un número que cambia.
- **Relacionado con**: **ADR-012** §"SAN y reidentificación" (la política de seed, que este ADR refuerza), **ADR-019** §5 (que hizo el seed obligatorio y aleatorio por sesión — el hecho del que depende casi todo lo de acá), ADR-028 (la renumeración canónica que destapa el problema), ADR-061 (el agregado manual, que renumera y por lo tanto también lo dispara), ADR-071 (que lo encontró y cuya firma de `synthesize` se cruza con la de acá)
- **Parte de**: Hito 10.6, PR 14a/14b

> Convención de citas: `ADR-072 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-072, Contexto §N`.

## Contexto

### 1. El nombre falso está sembrado sobre un número que cambia

`synthesize(type, indexInType, seed)` arma su generador con `hash(seed | type | indexInType)` (`shared/src/synthesizer.ts`). O sea que **`indexInType` es parte de la semilla**: la persona 3 y la persona 4 dan nombres distintos porque el número entra al hash.

Pero `indexInType` no es una propiedad estable del grupo. Es un ordinal que se recalcula:

- en `finishSession`, con la **renumeración canónica** de ADR-028, que reemplaza los índices provisionales por el orden de primera aparición documental;
- cada vez que el conjunto de grupos cambia — **agregar una entidad a mano** (ADR-061) corre los índices de todos los grupos posteriores, cosa que `UX_Guidelines.md` §5.4b ya documenta para el `placeholder`;
- en fusiones y divisiones.

Sembrar una identidad falsa sobre un ordinal mutable es el error de fondo. Todo lo demás es consecuencia.

### 2. El síntoma: el nombre falso cambia solo, en un momento arbitrario

`renumberGroupsCanonically` recalcula `replacementValue` **solo si el modo es `placeholder`** (`grouping.engine.ts`). Un grupo `synthetic` que pasa de índice 3 a 4 conserva el nombre que se generó para el 3 — un valor que ya no corresponde a sus propias entradas.

Eso no se ve: "Diego Torres" es igual de plausible para la persona 3 que para la 4. Se ve más tarde, cuando **algo vuelve a computar el valor de ese grupo** y lo hace con el índice nuevo. Y hay un camino sin guarda: `recomputeAllGroupModes` recalcula para los cuatro modos y corre en cada cambio de reglas. Reproducción:

1. Grupo `Person` en `synthetic`, índice 3 → "Diego Torres".
2. `finishSession` lo renumera a 4 → sigue mostrando "Diego Torres".
3. El usuario toca cualquier regla en el panel de Reglas → se recalcula con el índice 4 → pasa a "Laura Vega".

**El nombre falso de una persona cambió por una operación que no tenía nada que ver con esa persona.** Con una regla global en `synthetic` —que pone todos los grupos en ese modo— la renumeración de `finishSession` mueve muchos índices a la vez y el efecto es masivo.

Es peor que el corrimiento equivalente en `placeholder`. Que `[PERSONA 03]` pase a `[PERSONA 04]` es un número que se corre, y el usuario entiende que los números siguen el orden del documento (`UX_Guidelines.md` §5.4b lo dice). Que "Diego Torres" pase a ser "Laura Vega" se lee como **otra persona**.

### 3. La reproducibilidad que este cambio pondría en riesgo no existe

ADR-012 §"SAN y reidentificación" dice que el `synthetic` determinista "permite reproducir exports concretos", y que "con seed fijo, permite reproducibilidad solo para quien conozca el seed". Suena a propiedad que hay que cuidar. En el código no está:

- `session.seed = crypto.randomUUID()` en cada `startSession` (`grouping.engine.ts`).
- **No hay ningún campo de seed** en `GroupingConfig` ni en `Contracts.md`: no existe forma, desde la app ni desde la API pública, de fijarlo.
- **ADR-019 §5 lo hizo así a propósito**: sacó el default `"anonly-default-seed"` justamente porque "el seed del modo `synthetic` debe ser aleatorio por sesión para evitar correlación entre sesiones distintas del mismo documento", y un default fijo "rompía esa garantía silenciosamente".

O sea: el mismo documento abierto dos veces **ya produce nombres falsos distintos**, y eso es una decisión de seguridad tomada y defendida, no un accidente. La reproducibilidad entre sesiones es lo contrario de lo que el producto quiere.

Consecuencia práctica: **no se puede regresionar un valor que ya es aleatorio en cada corrida.** Verificado además que ningún test ni snapshot del repo fija un valor sintético literal — los tests de `shared` prueban propiedades (determinismo para las mismas entradas, formato válido, checksum), y los dos tests de `grouping-engine` que tocan valores sintéticos los comparan contra una llamada a `synthesize`, no contra un string.

### 4. El defecto vecino que **no** se toca, y por qué importa acá

La cabecera de `grouping.engine.ts` (nota 12) documenta que la supervivencia de un `replacementValue` editado a mano frente a un `finishSession` es **incidental**: depende del `if (newIndex === group.indexInType) return;` de ADR-028. Si el índice sí cambia, la edición manual se pierde — aunque ADR-057 §7 promete en negrita lo contrario. Es preexistente, no pertenece a este hito, y queda registrado como pendiente con su diagnóstico completo en `roadmap/Post_Hito10.8_Pendientes.md` §10.

Importa acá porque condiciona la solución: **levantar la guarda de `placeholder` en `renumberGroupsCanonically` —el arreglo más obvio— ampliaría ese defecto** de "se pierden las ediciones manuales de grupos en `placeholder` renumerados" a "se pierden en los cuatro modos". Arreglar un bug ensanchando otro no es arreglarlo.

## Decisión

### 1. La semilla del sorteo pasa a ser la identidad del grupo

El generador se arma con `hash(seed | type | groupId)` en vez de `hash(seed | type | indexInType)`. `EntityGroup.id` es un `crypto.randomUUID()` asignado al crear el grupo, y es **estable durante toda la vida del grupo**: sobrevive `finishSession` y `reopenSession` (que no recrean grupos), y en una fusión el grupo que sobrevive conserva su propio `id` junto con el resto de su identidad.

Con eso, **el valor sintético deja de depender de cualquier cosa que la renumeración pueda mover**. La estabilidad no sale de saltearse el recálculo: sale de que recalcular da el mismo resultado. Es la diferencia entre un valor que está desactualizado sin que se note y uno que es correcto siempre.

Efectos que caen solos:

- Renumerar (ADR-028), agregar una entidad a mano (ADR-061) o cambiar una regla no cambian ningún nombre falso.
- Fusionar dos grupos: el sobreviviente conserva su nombre falso, porque conserva su `id`.
- Dividir un grupo: el grupo nuevo tiene `id` nuevo y por lo tanto nombre falso propio, que es lo correcto — es otra entidad.

### 2. La firma pasa a un objeto

```ts
export interface SyntheticRequest {
  readonly type: EntityType;
  /** Identidad estable del grupo (`EntityGroup.id`). Es la semilla del sorteo (§1). */
  readonly groupId: string;
  /** Seed aleatorio por sesión (ADR-012 §SAN, ADR-019 §5). Lo genera el Grouping Engine. */
  readonly seed: string;
  /** Solo lo usan los tipos cuyo valor **interpola** el número del grupo (§3). */
  readonly indexInType: number;
}

export function synthesize(req: SyntheticRequest): string;
```

Motivo: la firma posicional queda con dos `string` adyacentes (`groupId`, `seed`) intercambiables sin error de compilación, y ADR-071 §5 le suma un quinto parámetro. Cinco posicionales con dos strings ambiguos es un bug esperando. El objeto además hace que agregar `personGender` sea un campo más y no otro cambio de firma.

El radio de impacto es mínimo: **el único caller de producción es `computeReplacementValue`** en `grouping-engine`, más dos tests. `export-engine` no lo usa, pese a que `Grouping_Engine.md` §"`replacementValue` por modo" dice "delegado a `shared` **o** `export-engine`" — esa frase se corrige al pasar.

### 3. `indexInType` sigue siendo entrada, pero solo donde el valor lo interpola

Dos ramas del `switch` **escriben** el índice en el valor en vez de sortear: `Custom` (`custom-3`) y el `default` inalcanzable (`synthetic-3`). No son identidades sorteadas, son tokens numerados — para ellos, seguir el índice es lo correcto, igual que `[CUSTOM 03]`.

Esas dos ramas conservan `indexInType` y **conservan exactamente el comportamiento de hoy**, incluida su contracara: un grupo `Custom` en modo `synthetic` que se renumera queda con `custom-3` mientras su placeholder diría `[CUSTOM 04]`, porque la guarda de §4 sigue sin recalcularlo. Es una inconsistencia acotada a un tipo cuyo valor sintético es un token numerado sin diseño detrás, y este ADR no la mejora ni la empeora. Queda anotada en `roadmap/Future_Ideas.md`.

### 4. La guarda de `renumberGroupsCanonically` **no** se toca

Sigue recalculando solo en `placeholder`. Con §1, no hace falta para nada más: los valores sorteados ya no dependen del índice, así que recalcularlos daría el mismo string.

Y no tocarla es lo que evita ensanchar el defecto de Contexto §4: levantarla haría que una renumeración pisara también las ediciones manuales de `replacementValue` sobre grupos en `mask`, `synthetic` y `redact`, que hoy sobreviven por el mismo accidente que las de `placeholder` no sobreviven. **El arreglo correcto de este ADR es el que deja intacta la guarda, no el que la levanta.**

Distinto es el caso de ADR-071 §6, que sí libera dos guardas de `placeholder` en `applyGroupUpdate` e `inferGendersOnFinish`: esas están en el camino de una edición explícita del usuario sobre ese mismo grupo, no en el de una renumeración masiva, y ahí el recálculo es exactamente lo que el usuario pidió.

### 5. Qué propiedad se pierde y qué propiedad se gana

**Se pierde**: que el valor sintético sea función de `(type, indexInType, seed)`. Pasa a ser función de `(type, groupId, seed)`. Para reproducir un export concreto habría que reproducir además los `id` de los grupos, que son UUID de runtime.

Eso **no es una regresión de producto**, porque la reproducibilidad entre sesiones ya era imposible: el seed es un UUID nuevo en cada `startSession` y nada permite fijarlo (Contexto §3). Se pierde una propiedad de la *función*, no una capacidad del *producto*. Si alguna vez se quiere exports reproducibles, hace falta un seed configurable **y** identidades de grupo deterministas — un diseño propio, con su ADR, que hoy chocaría de frente con ADR-012 §SAN y ADR-019 §5. Queda en `Future_Ideas.md`.

**Se gana**: estabilidad dentro de la sesión, que es la propiedad que el usuario sí experimenta. Hoy un nombre falso puede cambiar en cualquier momento por una operación ajena; después de esto, un grupo tiene un nombre falso y lo conserva mientras exista.

### 6. Por qué la semilla es el `id` y no el valor real

La alternativa "sembrar con el `canonicalValue`" da todas las propiedades de §1 y además determinismo entre corridas — "María Gómez" siempre sale "Laura Vega". Se rechaza por seguridad.

Sembrar el dato falso con el dato real convierte al sintetizador en un **oráculo de confirmación**: quien tenga el seed puede computar el valor sintético de un nombre sospechado y buscarlo en el documento anonimizado, verificando así una hipótesis sobre quién aparece ahí. Hoy eso es imposible, porque el valor sintético no lleva ninguna información sobre el original — y con `groupId` (un UUID sin relación con el contenido) sigue siendo imposible. Es exactamente el tipo de correlación que ADR-012 §SAN y ADR-019 §5 buscan cortar, y es la clase de riesgo que `08_Security_Model.md` §9 trata para `indexInType`.

Es un caso donde la opción con mejores propiedades funcionales es la peor opción de seguridad, y gana la seguridad.

### 7. Orden respecto de ADR-071

Este ADR va **primero**. ADR-071 §5 promete "no-regresión byte a byte" del sintético sin género contra los valores de hoy; después de §1 de acá esa promesa deja de tener sentido, porque los valores cambian a propósito (y, por Contexto §3, sin que nadie pueda notarlo). ADR-071 §5 y §8 quedan **enmendados**: la no-regresión pasa a ser contra el resultado de este ADR, no contra el estado previo — la propiedad que importa se conserva intacta (agregar `personGender` no cambia el valor cuando el género está sin determinar), solo cambia el ancla.

### 8. Alcance y tests

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 13 | Este ADR + ADR-071 + propagación a specs | `docs/` | — |
| 14a | `SyntheticRequest`: `groupId` como semilla (§1-§3) **y** `personGender` (ADR-071 §5) | `shared` | 13 |
| 14b | El motor pasa `group.id` y `group.personGender`; libera las guardas de ADR-071 §6 | `grouping-engine` | 14a |
| 14c | `PersonGenderToggle` y visibilidad por modo (ADR-071 §1-§4) | `apps/react-client` | 14b |

Los dos cambios de contrato van en **un solo PR de `shared`** a propósito: son el mismo cambio de firma, y partirlos obliga a reescribir dos veces los mismos tests para dejar la función en un estado intermedio que nadie va a usar. R-1 pide un módulo por PR, y `shared` es un módulo. Si en revisión se prefiere partirlo, el corte limpio es por campo (`groupId` primero, `personGender` después).

Tests de este ADR (PR 14a/14b):

- Contract (`shared`): mismo `(type, groupId, seed)` ⇒ mismo valor; **distinto `groupId` ⇒ distinto valor**; **distinto `indexInType` con el mismo `groupId` ⇒ el mismo valor** en todos los tipos sorteados. Ese último es el test que define este ADR.
- Contract (`shared`): `Custom` **sí** sigue el `indexInType` (§3).
- Contract (`shared`): siguen valiendo las propiedades de ADR-019 — checksum AFIP válido sobre 200 `groupId` distintos, Luhn, formatos por tipo.
- Edge (`grouping-engine`): un grupo `synthetic` cuyo `indexInType` cambia en la renumeración canónica de `finishSession` **conserva su `replacementValue`**. Es el test del síntoma de Contexto §2.
- Edge (`grouping-engine`): agregar una entidad manual que corre los índices (ADR-061) no cambia ningún valor sintético.
- Edge (`grouping-engine`): tras una fusión, el grupo sobreviviente conserva su valor sintético; tras una división, el grupo nuevo tiene uno propio.
- Edge (`grouping-engine`): un cambio de reglas que dispara `recomputeAllGroupModes` no cambia los valores sintéticos de los grupos cuyo modo no cambió.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Levantar la guarda de `placeholder` en `renumberGroupsCanonically`** | Es el arreglo obvio y es el peor. Hace que los nombres falsos cambien en cada renumeración —o sea en cada `finishSession` y cada vez que se agrega una entidad a mano (ADR-061)—, que es justamente el síntoma que se quiere eliminar. Y ensancha el defecto de Contexto §4: pasaría a pisar ediciones manuales de `replacementValue` en los cuatro modos. |
| **Sembrar con el `canonicalValue` del grupo** | Mejores propiedades funcionales que `groupId` (determinismo entre corridas) y la peor de seguridad: convierte al sintetizador en un oráculo de confirmación real→falso para quien tenga el seed (§6). Además el `canonicalValue` es editable por el usuario, así que ni siquiera es del todo estable. |
| **Sembrar con la primera posición documental del grupo** | Estable ante renumeraciones y determinista entre corridas, sin derivar del valor real. Pero se mueve con el bbox: un re-render, un OCR con otra escala o un `reopenSession` que suma una ocurrencia anterior cambian la posición y con ella el nombre. Cambia un ordinal mutable por coordenadas mutables. |
| **Congelar el valor sintético en un campo aparte del grupo** | Funciona: se computa una vez y se guarda, como el `personGenderUserSet` de ADR-069 §5. Pero agrega bookkeeping interno y una segunda fuente de verdad sobre `replacementValue`, para conseguir lo mismo que se consigue eligiendo bien la semilla. La función pura sigue siendo pura. |
| **No cambiar nada; documentar la inestabilidad** | Es lo que hay hoy, y el defecto se activa con una regla global en `synthetic`, que es una de las configuraciones más plausibles del panel de Reglas. Documentar "los nombres falsos pueden cambiar solos" no es una salida. |
| **Sacar `indexInType` de la firma por completo** | Rompe `Custom` (`custom-3`) y el fallback, que interpolan el índice y para los que seguirlo es correcto (§3). |
| **Mantener la firma posicional y agregar `groupId` al final** | Deja `(type, indexInType, groupId, seed, personGender?)`: dos `string` adyacentes intercambiables sin error de compilación, en una función cuyo resultado se imprime en un documento. Con dos campos nuevos entrando en el mismo hito, el objeto se paga solo (§2). |

## Consecuencias

**Positivas**: el nombre falso de un grupo deja de cambiar por operaciones ajenas a ese grupo, que era el defecto; la estabilidad sale de la semilla y no de saltearse recálculos, así que recalcular es idempotente y las guardas dejan de ser load-bearing; el defecto de las ediciones manuales de Contexto §4 no se ensancha; fusionar conserva el nombre falso del sobreviviente y dividir le da uno propio al grupo nuevo, las dos cosas correctas y ninguna escrita a mano; y el cambio de firma se hace una sola vez para los dos ADR del hito.

**Negativas**: el valor sintético deja de ser función de `(type, indexInType, seed)`, así que reproducir un export exige reproducir los `id` de grupo — sin efecto práctico, porque el seed ya es un UUID por sesión y nada permite fijarlo (Contexto §3), pero es una propiedad de la función que se pierde y hay que anotarla; `Custom` conserva su inconsistencia de índice (§3); y el Hito 10.6 suma dos PRs de código a una branch que ya estaba aprobada.

**Neutras**: ningún valor sintético observable "cambia" en un sentido que alguien pueda notar, porque ya cambiaban en cada sesión; ningún test ni snapshot fija literales sintéticos (Contexto §3); `ReplacementMode`, `EntityGroup` y los eventos no cambian de forma; `placeholder`, `mask` y `redact` no se enteran; y la política de seed de ADR-012 §SAN y ADR-019 §5 sale reforzada, no tocada.

## Docs actualizados por este ADR

- `adr/ADR-012-Replacement-Modes.md` — §"SAN y reidentificación": la frase sobre reproducibilidad con seed fijo se precisa contra lo que el producto implementa (Contexto §3), y se anota que la semilla del sorteo es la identidad del grupo.
- `adr/ADR-071-El-Genero-Se-Muestra-Solo-Donde-Se-Usa.md` — enmienda a §5, §7 y §8: el ancla de la no-regresión y la tabla de PRs (§7 de acá).
- `core/Contracts.md` — `SyntheticRequest` y `synthesize` se declaran acá (§5 y §6): hoy la función se exporta desde `shared` sin estar en el contrato, y §10 regla 1 lo pide.
- `core/Grouping_Engine.md` → v1.5.0: §"`replacementValue` por modo" (la fila `synthetic` y la corrección de "delegado a `shared` o `export-engine`"), §13 (caso nuevo: el valor sintético sobrevive a la renumeración), §14 (los tests de §8), §15 (checklist).
- `roadmap/MVP.md` §4 — bloque del Hito 10.6: los PRs 14a/14b/14c y el estado de la branch.
- `roadmap/Post_Hito10.8_Pendientes.md` §10 — las ediciones manuales de `replacementValue` que una renumeración pisa (Contexto §4). Va ahí y **no** a `Future_Ideas.md` porque no es una idea a evaluar: es un defecto contra una promesa escrita de ADR-057 §7, diferido por no pertenecer a este hito.
- `roadmap/Future_Ideas.md` — dos anotaciones, ésas sí son ideas: el `Custom` sintético que no sigue su índice (§3) y los exports reproducibles con seed configurable (§5).

## Validación

- Los tests de §8, en particular el que define el ADR: **cambiar `indexInType` con el mismo `groupId` no cambia el valor** para todos los tipos sorteados.
- El escenario de Contexto §2 reproducido de punta a punta: grupo `synthetic`, renumeración en `finishSession`, cambio de reglas, y el nombre falso intacto en los tres momentos.
- Las propiedades de ADR-019 §6 siguen verdes: checksum AFIP sobre 200 identidades distintas, Luhn, y los formatos por tipo de ADR-012.
- Ningún test ni snapshot del repo fija un valor sintético literal — verificado antes de decidir, y condición para que §1 sea implementable sin churn.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `adr/ADR-012` §"Formato por tipo para `synthetic`", §"SAN y reidentificación" — `adr/ADR-019` §5, §6 — `adr/ADR-028` — `adr/ADR-057` §7 — `adr/ADR-061` — `adr/ADR-071` §5, §6
- `core/Contracts.md` §5, §6 — `core/Grouping_Engine.md` §"`replacementValue` por modo", §13, §14 — `architecture/08_Security_Model.md` §9 — `ui/UX_Guidelines.md` §5.4b
- Código: `packages/anonymization-core/shared/src/synthesizer.ts` — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`computeReplacementValue`, `renumberGroupsCanonically`, `recomputeAllGroupModes`, `startSession`)
