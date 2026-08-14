<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,ui/Components.md,ui/UX_Guidelines.md,architecture/08_Security_Model.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-072-El-Valor-Sintetico-Identifica-Al-Grupo-No-A-Su-Numero.md | audiencia=humanos+IA | fase=10.6 -->

# ADR-071 — El género se muestra solo donde se usa, y el sintético empieza a usarlo

- **Estado**: Accepted
- **Fecha**: 2026-08-14
- **Decidido por**: El humano, sobre la UI entregada por el PR 12. El control quedó permanentemente visible en toda fila `Person` y con el mismo peso visual que el selector de modo: *"constantemente está mostrándose algo que capaz no quiero ni utilizar"*. Eligió atar la visibilidad a los modos que consumen el dato (`placeholder` y `synthetic`), reemplazar el campo por un botón chico de tres estados con los símbolos ♀/♂ y un neutro, fusionar la marca de "sin determinar" con ese botón, y construir el sintético por género, que no existía.
- **Relacionado con**: **ADR-060** (lo completa y **supersede sus §5 y §6**; §1-§4 y §7-§12 quedan vigentes), **ADR-069** §4 (el wire `PersonGenderChoice`, intacto), **ADR-072** (el defecto de siembra del sintetizador que §6 de acá destapó; va **antes** que este ADR y le cambia el ancla de no-regresión a §5), ADR-012 (los cuatro modos, que siguen siendo cuatro), ADR-057 §3 (la indirección `resolveLabelSet`, intacta), ADR-018 (assets first-party, criterio del que salen los tres símbolos)
- **Parte de**: Hito 10.6, PRs 14a/14b/14c

> **Enmendado por `ADR-072` (2026-08-14), el mismo día.** Al planificar §5 apareció que el valor sintético está sembrado sobre `indexInType`, un ordinal que la renumeración canónica mueve. ADR-072 lo corrige sembrando sobre `EntityGroup.id` y lo hace **primero**. Consecuencias acá, todas anotadas en su lugar: la firma de `synthesize` pasa a un objeto (§5), la no-regresión se ancla al resultado de ADR-072 en vez de al estado previo (§5, §8), el tercer punto que §6 dejaba fuera de alcance queda resuelto (§6), y la tabla de PRs se renumera (§7). Ninguna decisión de producto de este ADR cambia.

> Convención de citas: `ADR-071 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-071, Contexto §N`.

## Contexto

### 1. El hito entrega dos controles permanentes para el mismo dato

`EntityGroupItem` monta hoy, sobre **toda** fila de tipo `Person` y sin mirar el modo, un `Select` de género con el mismo tratamiento visual que el selector de modo (`personGenderVisibility.ts`, `isPersonGenderSelectVisible(type)`). Y cuando además el modo es `placeholder` sin género resuelto, le suma un **segundo** elemento: el badge `?` de "género sin determinar" (ADR-060 §5).

O sea: una fila que ya tiene checkbox, `canonicalValue`, contador de ocurrencias, selector de modo y menú de acciones, gana en el caso más común de todos —una persona cuyo género todavía no está resuelto— dos afordancias más, las dos apuntando al mismo campo.

El costo no es estético. La unidad de trabajo de Anonly es el grupo (ADR-011) y el árbol de entidades es la pantalla donde el usuario pasa el tiempo. Un documento con veinte personas muestra veinte selectores de género que la mayoría de los usuarios no va a tocar nunca, compitiendo por atención con el control que sí se usa en cada grupo, que es el modo.

**El origen es una falta de especificación, no un error de implementación.** ADR-060 §6 dice "un control de tres estados... en el panel de Entidades" y `ui/Components.md` §3.4b fija su visibilidad en una sola línea: *"solo sobre grupos con `type === EntityType.Person`"*. El PR 12 implementó exactamente eso. Lo que nunca se escribió es **cuándo** el control es relevante, que no es lo mismo que sobre qué tipo aplica el dato.

### 2. La opción "Género" en la lista de modos ya estaba descartada, y por dos razones distintas

La primera reacción natural es agregar "Género" como una quinta opción del selector de modo, junto a Placeholder / Máscara / Sintético / Redactar, y mostrar el control de género recién cuando esa opción se elige.

ADR-060 §1 ya la había rechazado por razones estructurales: obliga a tocar `ReplacementMode`, las `Rule` y su resolución por prioridad, la tabla de formatos por modo y los tests de los cuatro modos, para expresar algo que no es un modo distinto sino el mismo con otro label; y crea combinaciones sin sentido que hay que prohibir a mano.

Hay una segunda razón, independiente y de producto: **"Género" con opción neutra y "Placeholder" serían la misma opción**. Un grupo en modo "Género" con el neutro puesto imprime `[PERSONA 03]`, que es exactamente lo que imprime Placeholder. Dos entradas de un menú de cinco que hacen lo mismo en uno de sus estados es un menú mal diseñado, y ninguna de las dos se puede sacar después.

### 3. El sintético ya inventa un género, y puede ser el equivocado

`synthesizePerson` elige de un pool único y mezclado de quince nombres de pila —Carlos, María, Juan, Ana, José, Laura…— con un `rng` seedado por `(seed, type, indexInType)` (`shared/src/synthesizer.ts`). Hoy, un grupo cuyo `canonicalValue` es "María Gómez" puede salir del sintetizador como "Carlos Sánchez".

Esto cambia por completo el análisis de privacidad de ADR-060 Contexto §3 **para este modo**. Ahí el argumento era que `[MUJER 01]` revela más que `[PERSONA 01]`, y que por eso la función tenía que ser opt-in y por grupo. En `synthetic` no hay nada que revelar de más: el modo **ya** imprime un género, y hoy lo imprime al azar. Hacerlo respetar el género del grupo no agrega divulgación — corrige un dato falso que el producto ya venía escribiendo en el documento.

Y es información que el usuario nota: el modo `synthetic` existe para que el documento se lea como un documento real (ADR-012), y un texto donde "Carlos Sánchez" queda embarazado o "Ana Torres" es "el imputado" no se lee como un documento real. Es el mismo problema de coherencia referencial que motivó todo el Hito 10.6, con otro modo.

### 4. `mask` y `redact` no tienen ninguna relación con el género

`mask` imprime `XXXXX XXXXX` y `redact` imprime `""`. Ninguno de los dos consume `personGender` ni puede consumirlo. Un control de género sobre un grupo en esos modos es una palanca sin nada del otro lado — que es la definición de ruido.

## Decisión

### 1. El género se muestra solo donde el token lo usa

La visibilidad del control pasa a depender del **tipo y del modo efectivo del grupo**:

```ts
export function isPersonGenderToggleVisible(group: EntityGroup): boolean {
  return (
    group.type === EntityType.Person &&
    (group.replacementMode === ReplacementMode.Placeholder ||
      group.replacementMode === ReplacementMode.Synthetic)
  );
}
```

Reemplaza a las dos funciones actuales de `personGenderVisibility.ts` (`isPersonGenderSelectVisible` y `isPersonGenderUndeterminedMarkVisible`), que dejan de existir.

**Leer `group.replacementMode` es correcto y suficiente**: el motor le escribe encima el resultado de `resolveMode()` en cada mutación y en `recomputeAllGroupModes` (`grouping.engine.ts`), así que ese campo **siempre lleva el modo efectivo**, ya resuelto contra las reglas de grupo/tipo/globales. La UI no replica la escalera de prioridades de `Grouping_Engine.md` §"Resolución de modo" — no puede desincronizarse porque no la calcula.

**El Core no cambia por esta sección.** La inferencia sigue corriendo sobre todo grupo `Person` en los dos puntos de ADR-069 §6, y `personGender` se sigue guardando siempre, en cualquier modo. Esto es una regla de **presentación**: qué se muestra, no qué se computa. Un grupo al que el usuario le fijó el género en `placeholder` y después pasó a `mask` conserva su elección, y la recupera intacta al volver.

### 2. Un botón de tres estados, no un campo

`PersonGenderSelect` (Radix `Select`) se reemplaza por `PersonGenderToggle`: un `<button>` chico, del ancho de un icono, que muestra el estado actual y cicla al siguiente con un click.

- **Ciclo**: `neutral → f → m → neutral`. El neutro es el estado de reposo de un grupo sin resolver, y el orden ♀ antes que ♂ es el de los símbolos tal como se conocen.
- **Emisión**: `actions.updateGroup(groupId, { personGender: next })` con `next: PersonGenderChoice`. **El wire de ADR-069 §4 no cambia en nada**: los tres valores siguen siendo `"f" | "m" | "neutral"`, `"neutral"` sigue viajando como valor explícito y el motor sigue traduciéndolo a borrar el campo. Este ADR cambia el control, no el contrato.
- **El estado mostrado es el estado real del grupo**, venga de donde venga: un grupo con género inferido muestra su símbolo desde el principio, sin que el usuario haga nada, y uno sin resolver muestra el neutro. El control no tiene estado propio; lee `group.personGender` (mapeado con `toPersonGenderChoice`, que ya existe).
- **Función pura para el ciclo**: `nextPersonGenderChoice(current)` en `personGenderOptions.ts`, testeable sin renderizar — mismo criterio que `personGenderVisibility.ts` y `entityTree.ts`, porque `apps/react-client` corre sus tests en Node sin jsdom.
- **Accesibilidad** (`UX_Guidelines.md` §9): `aria-label` que nombra el estado actual y el siguiente (`"Género: femenino. Cambiar a masculino."`), `Tooltip` con el estado actual al hover, foco visible y contraste AA 3:1 para componentes de UI. Es un `<button>` nativo: Enter y Espacio funcionan sin código.

Un ciclo de tres estados en un solo target es una vuelta de más en el peor caso (llegar a `neutral` desde `f`) contra los dos clicks fijos que cuesta cualquier desplegable, en un control cuyo valor por defecto ya es el correcto la mayoría de las veces.

### 3. Los tres símbolos son SVG first-party, y el neutro **no** es un símbolo de género

Los tres se dibujan a mano sobre la misma grilla de 16×16, como componentes del cliente:

| Estado | Símbolo | Forma |
|---|---|---|
| `f` | ♀ | círculo con cruz abajo |
| `m` | ♂ | círculo con flecha arriba-derecha |
| `neutral` | ⚲ | **el mismo círculo, sin apéndice** |

Tres motivos para dibujarlos en vez de tomarlos de una librería o del texto: `lucide-react@0.451.0` —la versión del repo— **no tiene** `Venus` ni `Mars` (llegaron después), así que la opción de librería es un bump de dependencia (R-12) para tres formas triviales; el glifo Unicode del neutro (`U+26B2`) tiene cobertura de fuente irregular y puede caer en tofu, que es el peor resultado posible para el estado por defecto del control; y dibujarlos garantiza que los tres compartan métrica y grosor de trazo, que es lo que hace que el botón no salte al ciclar. Es el mismo criterio de ADR-018: lo que se ve en el producto es first-party.

**El neutro es el círculo pelado a propósito.** ♀ y ♂ son el mismo círculo con un apéndice distinto; quitarle el apéndice dice "acá no hay marca" con la gramática visual que los otros dos ya establecieron. Y es lo que evita el error grave: **no se usa ⚧ ni ningún símbolo asociado a una identidad de género**. Este estado significa *sin determinar* —falta un dato, o el nombre no lo determina—, no una tercera categoría de persona. ADR-060 §9 ya lo había fijado para el valor `A` del registro ("es una propiedad del **nombre**, no un atributo de quien lo lleva") y ADR-060 §"Alternativas" rechazó por escrito agregar categorías. Un símbolo de identidad en ese estado le diría al usuario algo falso sobre la persona y contradiría las dos decisiones.

### 4. La marca de "sin determinar" se fusiona con el control (supersede ADR-060 §5)

`PersonGenderUndeterminedBadge` se elimina. **El estado neutro del toggle es la marca**, con tratamiento visual atenuado (trazo secundario, no relleno) frente a los estados `f`/`m`.

ADR-060 §5 pedía dos cosas: que el grupo sin género resuelto **se señale en el árbol**, y que la marca dé **acceso directo al selector**. Las dos se siguen cumpliendo, con un elemento en vez de dos: la marca ahora *es* el selector, así que el acceso directo es el propio click. Lo que se pierde es la duplicación.

Sigue vigente, sin cambios, todo lo demás de §5: la marca **no** usa `AnnotationKind.Degraded`, no se pinta nunca en el canvas, y no comparte tratamiento visual con la marca de degradación (ADR-058 §7, ADR-062) — aquélla dice "esto se ve mal", ésta dice "falta un dato".

**Consecuencia directa**: las props `open`/`onOpenChange` que el `Select` común ganó en el PR 12 existían **solo** para que el badge pudiera abrir el desplegable de un componente hermano (`common/Select.tsx`, comentario in situ). Sin badge y sin desplegable, se revierten: el componente compartido vuelve a la forma que tenía antes del hito.

### 5. El sintético respeta el género del grupo

`SyntheticRequest` —el objeto de entrada que introduce ADR-072 §2— gana un campo opcional:

```ts
export interface SyntheticRequest {
  readonly type: EntityType;
  readonly groupId: string;   // ADR-072 §1: la semilla del sorteo
  readonly seed: string;
  readonly indexInType: number;
  /** Solo se consulta sobre `type === Person`. Ausente = sin determinar. */
  readonly personGender?: PersonGender;
}
```

La tabla de nombres de pila pasa a llevar el género por entrada, **conservando exactamente el orden actual**:

- `personGender` ausente → se usa la tabla completa, en ese orden.
- `"f"` / `"m"` → se filtra la tabla por ese género.

**El género no entra a la semilla**, que sigue siendo `hash(seed | type | groupId)` (ADR-072 §1). Lo único que cambia es de qué array sortea `pick`. La propiedad que eso compra: **con `personGender` ausente el valor es idéntico al que da ADR-072 sin este campo** — mismo largo de array, mismo orden, mismo `rng`. Ningún tipo distinto de `Person` se entera.

> **El ancla de la no-regresión es ADR-072, no el estado previo al hito.** ADR-072 §1 cambia a propósito todos los valores sintéticos, así que "byte a byte contra lo de hoy" dejó de ser una propiedad deseable — y, por ADR-072 Contexto §3, tampoco es observable: el seed es un UUID nuevo en cada sesión, o sea que los nombres falsos ya son distintos en cada corrida del mismo documento. Lo que este ADR promete y testea es lo que importa: agregar `personGender` no cambia nada cuando el género está sin determinar.

El pool actual ya está balanceado (8 masculinos / 7 femeninos), así que filtrar deja siete u ocho nombres por género, del mismo orden de variedad que tienen hoy los quince para el conjunto. Los apellidos no se tocan: en español no flexionan.

**Con género sin determinar, el sintético sigue eligiendo del pool mezclado**, o sea un nombre de pila que inevitablemente tiene género. No es una violación de "ante la duda no se decide" (ADR-060 §4): esa regla protege al `placeholder`, donde existe un token neutro real y donde imprimir un género dudoso sería afirmar algo falso. En `synthetic` no hay nombre de pila neutro en español al cual caer, y el modo entero está definido por fabricar datos plausibles y falsos (ADR-012). El piso de seguridad no baja: es literalmente el comportamiento de hoy.

### 6. El recálculo de `replacementValue` deja de estar atado a `placeholder`

Tres puntos del motor recalculan `replacementValue` **solo si el modo es `placeholder`**, porque hasta hoy `placeholder` era el único modo que consumía `personGender`:

| Punto | Qué pasa si no se toca |
|---|---|
| `applyGroupUpdate`, rama de `changed.has("personGender")` | El usuario cambia el género de un grupo en modo `synthetic`: el campo se guarda, **el nombre sintético no cambia** |
| `inferGendersOnFinish` | Un género **inferido** sobre un grupo en modo `synthetic` no repinta el token al cerrar la sesión |

Los dos pasan a aceptar `placeholder` **o** `synthetic`. Sin esto, §5 se implementa entera, con sus tests de `shared` en verde, y **la función no tiene ningún efecto observable en el producto**: es la falla exacta que ADR-069 Contexto §3 documentó para la inferencia del PR 11, repetida un hito después. Por eso va como sección propia del ADR y como caso propio del spec, no como detalle de implementación.

Hay un tercer punto —`renumberGroupsCanonically`, que también recalcula solo en `placeholder`— que **no se toca acá y no hace falta que se toque**: es el síntoma de un defecto anterior e independiente del género (`synthesize` sembrado sobre `indexInType`, un ordinal que la renumeración mueve), que **`ADR-072` resuelve en la raíz** cambiando la semilla por `EntityGroup.id`. Con eso, recalcular ahí daría el mismo string, y dejar la guarda quieta evita ensanchar un defecto vecino — ver ADR-072 §4, que explica por qué levantarla sería el arreglo equivocado.

La distinción entre las dos guardas que este ADR **sí** libera y la que deja quieta: las de `applyGroupUpdate` e `inferGendersOnFinish` están en el camino de una edición del usuario sobre ese mismo grupo, donde recalcular es lo que el usuario pidió; la de la renumeración está en el camino de una pasada masiva sobre todos los grupos, donde recalcular pisa cosas que nadie tocó.

### 7. Alcance: tres PRs, más el de docs

R-1 (un PR = un módulo) obliga a partirlo, y el orden importa: la UI va **última**, para que ningún estado que el control muestre sea mentira en el momento en que se muestra.

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 13 | Este ADR + ADR-072 + los docs de §"Docs actualizados" de los dos | `docs/` | — |
| 14a | `SyntheticRequest` con `groupId` (ADR-072 §1-§3) **y** `personGender`; tabla de nombres con género (§5) | `shared` | 13 |
| 14b | El motor pasa `group.id` y `group.personGender`, y libera las dos guardas de recálculo (§6) | `grouping-engine` | 14a |
| 14c | `PersonGenderToggle`, visibilidad por modo, baja del badge y reversión de `Select` (§1-§4) | `apps/react-client` | 14b |

Los dos cambios de contrato de `shared` van juntos en 14a a propósito: es el mismo cambio de firma y partirlo obliga a reescribir dos veces los mismos tests (ADR-072 §8).

Van sobre la misma branch del Hito 10.6, **antes de mergear**: la branch está aprobada pero sin mergear, y mergear una UX que ya se decidió reemplazar deja dos ADR contradictorios vigentes en `main` y un ida y vuelta en el historial que no le sirve a nadie. La contrapartida asumida es que la branch vuelve a revisión completa.

### 8. Tests

`shared` (14a — los de ADR-072 §8 van en el mismo PR):

- Contract: `SyntheticRequest.personGender` es opcional; los dos géneros tienen al menos un nombre en la tabla (un edit futuro que vacíe un pool haría explotar `pick` en runtime).
- Unit: `personGender: "f"` → nombre de pila femenino; `"m"` → masculino, contra la tabla real.
- Unit de **no-regresión**: **sin género se sortea del pool completo**, no de uno filtrado — o sea que el caso neutro no quedó recortado por accidente y se comporta como antes de este ADR. Es el que protege §5, anclado a ADR-072 y no al estado previo al hito.

  > **Corregido al implementar el PR 14a (2026-08-14)**. El enunciado original era "pasar `personGender` ausente da el mismo valor que sin el campo", y con el `exactOptionalPropertyTypes: true` del repo **no se puede ni escribir**: pasar `personGender: undefined` explícito no compila, porque ausente y presente-con-`undefined` son estados distintos por diseño. Los dos lados de esa igualdad son literalmente la misma llamada, así que el test era una tautología. La propiedad que hay que proteger es la de arriba.
- Unit: determinismo — mismo `(type, groupId, seed, personGender)` ⇒ mismo valor.
- Unit: el género **no** entra a la semilla — cambiar `personGender` sobre un tipo distinto de `Person` no cambia nada.

`grouping-engine` (14b):

- Unit: grupo `Person` con `personGender: "f"` en modo `synthetic` → `replacementValue` con nombre femenino.
- Edge: **cambiar el género de un grupo en modo `synthetic` recalcula `replacementValue`** y emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`. El test que atrapa §6.
- Edge: un género **inferido** en `finishSession` sobre un grupo `synthetic` repinta el token.
- Edge de no-regresión: grupo `Person` sin género en modo `synthetic` → el mismo valor que antes de este ADR.

`apps/react-client` (14c):

- Unit: matriz de `isPersonGenderToggleVisible` — los 13 tipos × los 4 modos, con `true` solo en `Person` × (`placeholder` | `synthetic`).
- Unit: `nextPersonGenderChoice` cicla `neutral → f → m → neutral`.
- Unit: el toggle emite `GROUP_UPDATE_REQUESTED` con `patch.personGender` en los tres valores, incluido `"neutral"` explícito (no-regresión del wire de ADR-069 §4).
- Unit: el estado mostrado sale de `group.personGender` — un grupo con género inferido muestra su símbolo sin interacción previa.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **"Género" como quinta opción del selector de modo** | Rechazada dos veces y por razones independientes: estructuralmente obliga a tocar `ReplacementMode`, las `Rule`, su resolución por prioridad y la tabla de formatos (ADR-060 §1); y de producto, "Género + neutro" y "Placeholder" imprimen el mismo token, o sea dos entradas del menú que hacen lo mismo en uno de sus estados (Contexto §2). |
| **Dejar el `Select` siempre visible** | Es el estado actual y es el problema: veinte selectores permanentes en un documento con veinte personas, la mayoría de los cuales nadie va a tocar, compitiendo con el control que sí se usa en cada grupo. |
| **Mantener el badge `?` además del toggle** | Dos elementos para el mismo campo en la fila más común del árbol. Todo lo que ADR-060 §5 pedía —señalar en el árbol, dar acceso directo a corregirlo— lo cumple el estado neutro del propio control (§4). |
| **Tres mini-botones tipo `ToggleGroup` en vez de un botón cíclico** | Semántica de `radiogroup` impecable y un click para cualquier estado, pero triplica el ancho del control y vuelve a poner tres targets permanentes por fila, que es la mitad del problema que este ADR resuelve. El ciclo cuesta una vuelta de más solo en el peor caso. |
| **Icono como trigger de un desplegable de tres opciones** | Conserva el `Select` y su accesibilidad de listbox con un trigger chico, pero son dos clicks fijos para un control de tres estados cuyo valor por defecto ya suele ser el correcto, y mantiene viva la maquinaria de apertura controlada que §4 puede borrar. |
| **Glifos Unicode ♀ ♂ ⚲** | Cero SVG, pero `U+26B2` tiene cobertura de fuente irregular y su tofu caería justo en el estado por defecto del control. Además, tres glifos de tres fuentes distintas no comparten métrica y el botón salta al ciclar. |
| **Subir `lucide-react` para usar `Venus`/`Mars`** | La versión del repo (0.451.0) no los tiene; llegaron después. Un bump de dependencia (R-12) para tres formas que son un círculo, una cruz y una flecha. |
| **⚧ u otro símbolo de identidad para el tercer estado** | Diría algo falso: el estado significa "sin determinar" —dato ausente, o nombre que el registro declara que no determina género—, no una identidad. ADR-060 §9 ya lo fijó para el valor `A` ("propiedad del nombre, no atributo de quien lo lleva") y ADR-060 §"Alternativas" rechazó agregar categorías. |
| **Meter `personGender` en la semilla del sintetizador** | Haría que fijar el género cambiara el nombre falso por dos caminos a la vez (semilla y pool) y que un grupo sin género resuelto no fuera equivalente a "el mismo grupo sin el campo", que es la propiedad que §8 testea. Filtrar el pool ya produce nombres distintos por género, sin tocar la semilla que ADR-072 §1 acaba de dejar estable. |
| **Un pool sintético neutro para el género sin determinar** | No existe nombre de pila neutro en español al cual caer. Y el modo `synthetic` fabrica datos falsos por definición (ADR-012): el piso de seguridad de mantener el pool mezclado es exactamente el comportamiento de hoy. |
| **Diferir el sintético por género a un hito posterior** | Deja el control visible en modo `synthetic` sin efecto, o el control invisible en el único otro modo que podría usarlo. Las dos mitades se necesitan: el control tiene que ser verdadero en todos los estados en que se muestra. |
| **Mergear el Hito 10.6 y rediseñar después** | Deja en `main` una UX que ya se descartó, con dos ADR contradictorios vigentes y un revert en el historial. La branch está aprobada pero sin mergear: el momento de corregir es ahora. |

## Consecuencias

**Positivas**: el árbol de entidades recupera densidad —desaparecen dos controles permanentes por fila `Person` y queda uno, condicionado—; el control aparece exactamente cuando puede cambiar algo, que es la definición de una afordancia honesta; el modo `synthetic` deja de imprimir un género al azar, que era un dato falso que el producto ya escribía en el documento; el wire de ADR-069 §4 no se toca, así que el motor no se entera del rediseño de la UI; y el `Select` común vuelve a su forma previa al hito.

**Negativas**: el ciclo de tres estados cuesta dos clicks para volver a neutral desde `f`, y un control que cicla es menos autoexplicativo que un desplegable con las tres opciones a la vista —mitigado con tooltip y `aria-label`, no eliminado—; cambiar el modo de un grupo `Person` entre `{placeholder, synthetic}` y `{mask, redact}` hace aparecer o desaparecer el toggle, con un corrimiento del cluster derecho de esa fila; el Hito 10.6 vuelve a revisión completa; y `synthetic` pasa a divulgar el género **correcto** de la persona en vez de uno al azar, que es una mejora de coherencia y a la vez, formalmente, un dato verdadero más en el documento (`08_Security_Model.md` §9.1) — el mismo trade-off opt-in por grupo que ADR-060 Contexto §3 ya aceptó para `placeholder`.

**Neutras**: `ReplacementMode` sigue teniendo cuatro valores; `PersonGender`, `PersonGenderChoice` y `GroupUpdateRequested.patch` no cambian de forma; la inferencia de ADR-069 §6 corre igual y sobre los mismos grupos; `resolveLabelSet` y la escalera de ADR-057 quedan intactas; `mask` y `redact` no se enteran; y la leyenda de ADR-059 sigue absorbiendo los prefijos sin cambios.

## Docs actualizados por este ADR

- `adr/ADR-060-Reemplazo-Por-Genero.md` — notas de **superseded** en §5 (la marca se fusiona con el control) y §6 (el control deja de ser un campo permanente); en §"Consecuencias > Neutras", la frase "`mask`, `synthetic` y `redact` no participan" deja de valer para `synthetic`; §13 (tests de `apps/react-client`) reescrito contra §8 de acá.
- `adr/ADR-012-Replacement-Modes.md` — §"Formato por tipo para `synthetic`": nota de que `Person` respeta `personGender` cuando está resuelto.
- `core/Contracts.md` — el campo `personGender` de `SyntheticRequest` (§5 y §6). La declaración de `SyntheticRequest`/`synthesize` en sí la trae ADR-072, que la introduce: hoy la función se exporta desde `shared` sin estar en el contrato, contra §10 regla 1.
- `core/Grouping_Engine.md` → v1.5.0: nota de cabecera, §"`replacementValue` por modo" (fila `synthetic`), §13 (caso nuevo: género en modo sintético y el recálculo de §6), §14 (tests de §8), §15 (checklist).
- `ui/Components.md` — §3.3 (baja de la marca del listado de estados), §3.4b reescrito entero (`PersonGenderToggle`: visibilidad por tipo **y** modo, ciclo, símbolos, ARIA), §8.3 (`Select` sin `open`/`onOpenChange`), §12 (tabla de mapeo).
- `ui/UX_Guidelines.md` — §3.3 (la marca de género sin determinar pasa a ser el estado neutro del control), §5.4 (qué se ve por modo).
- `ui/React_Client.md` — cabecera CONTEXT: nombraba `PersonGenderSelect` como destinatario de `updateGroup.patch.personGender`. El contrato de §2.3 **no cambia**; solo el nombre del consumidor.
- `architecture/08_Security_Model.md` §9.1 — **no estaba previsto y hay que tocarlo**: todo el análisis de divulgación de género está escrito sobre `placeholder`, y §5 de acá suma un segundo modo. La conclusión es más benigna (el sintético ya imprimía un género al azar), pero con una salvedad que hay que decir: en `synthetic` el neutro no evita divulgar género, porque no hay nombre de pila neutro al cual caer.
- `roadmap/MVP.md` §4 — bloque del Hito 10.6: los PRs 13/14a/14b/14c y el estado de la branch (compartido con ADR-072).

## Validación

- Los tests de §8, en particular los tres que atrapan las fallas silenciosas: la equivalencia del sintético sin género contra ADR-072 (§5), el recálculo al cambiar el género en modo `synthetic` (§6) y el repintado tras la inferencia en `finishSession` (§6).
- Verificación manual sobre un documento con personas de los dos géneros y alguna sin determinar: el toggle aparece solo en `placeholder` y `synthetic`, muestra el género inferido sin interacción previa, y el token del visor cambia en el acto en los dos modos.
- No-regresión: un documento donde ningún grupo tiene `personGender` produce exactamente los mismos `replacementValue` que antes de este ADR, en los cuatro modos.
- Contraste AA (3:1) de los tres símbolos en sus dos tratamientos —resuelto y neutro atenuado—, `UX_Guidelines.md` §9.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `adr/ADR-060` §1-§4, §7-§12 (vigentes) — §5, §6 (superseded por §4 y §2 de acá)
- `adr/ADR-012` — `adr/ADR-018` — `adr/ADR-057` §3 — `adr/ADR-058` §7 — `adr/ADR-062` — `adr/ADR-069` §4, §6
- `core/Contracts.md` §5, §6, §8 — `core/Grouping_Engine.md` §"`replacementValue` por modo", §13, §14 — `ui/Components.md` §3.3, §3.4b, §8.3 — `ui/UX_Guidelines.md` §3.3, §9 — `architecture/08_Security_Model.md` §9.1
- Código: `packages/anonymization-core/shared/src/synthesizer.ts` — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`computeReplacementValue`, `applyGroupUpdate`, `inferGendersOnFinish`) — `apps/react-client/src/components/entities/` (`PersonGenderSelect.tsx`, `PersonGenderUndeterminedBadge.tsx`, `personGenderVisibility.ts`, `personGenderOptions.ts`, `EntityGroupItem.tsx`) — `apps/react-client/src/components/common/Select.tsx`
