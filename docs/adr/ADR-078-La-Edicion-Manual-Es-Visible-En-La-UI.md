<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,ui/UX_Guidelines.md,ui/Components.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-078 — La edición manual del `replacementValue` es visible en la UI

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, al revisar las observaciones no bloqueantes del Hito 10 (`roadmap/Hito10_Observaciones_Plan_De_Resolucion.md` §6.1 punto C).
- **Relacionado con**: **ADR-076** (que creó `replacementValueUserSet` como bookkeeping interno y lo consulta en todos los puntos de recálculo), **ADR-069 §5** (`personGenderUserSet`, el mismo patrón de flag interno, que este ADR deliberadamente **no** expone), `UX_Guidelines.md` §3.3 (el indicador que promete y que hoy no existe), **ADR-058 §4** y **ADR-062** (que le ofrecen al usuario editar el valor a mano como remedio del reemplazo degradado).
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-078 §N` refiere a **Decisión §N**.

## Contexto

### 1. Hay un indicador prometido que no se puede implementar — y son dos señales, no una

`UX_Guidelines.md` §3.3 lista un estado **"Grupo editado manualmente"**: punto azul junto al nombre. El PR8 del Hito 10 lo dejó sin implementar, con una razón correcta para ese momento: *"requeriría que la UI reimplemente la resolución de reglas de Grouping (fuera de su rol) para saber si el modo actual difiere del default"*.

Releyendo el spec con cuidado, el estado tiene un nombre general y un paréntesis que describe **solo una** de las formas de llegar a él:

> *"**Grupo editado manualmente**: punto azul al lado del nombre (indica que el `replacementMode` difiere del default de las reglas)."*

Son dos señales distintas, y conviene no confundirlas:

| Señal | Qué significa | ¿Computable hoy? |
|---|---|---|
| **(a) El `replacementMode` difiere del default de las reglas** | el usuario cambió el *modo* de este grupo | **No.** Exige `resolveMode(group, rules)`, que es de Grouping. La razón del PR8 sigue vigente palabra por palabra. |
| **(b) El `replacementValue` lo escribió el usuario** | el usuario escribió el *texto* del token | **Sí**, desde ADR-076 — pero el dato no sale del motor. |

Este ADR resuelve **(b)** y deja **(a)** explícitamente abierta, con su razón. No son intercambiables: (a) es visible por otros medios (el modo se muestra en el propio `Select` de la fila), mientras que (b) es **invisible por completo**, que es lo que la vuelve urgente.

### 2. Para la señal (b), esa razón caducó: el dato existe desde ADR-076

`InternalGroup.replacementValueUserSet` (`grouping-engine/src/grouping.engine.ts:266`) es hoy la fuente de verdad de "esto lo escribió el humano", y ADR-076 §3 la consulta en los seis o siete puntos de recálculo. Ya no hay nada que reimplementar: hay un booleano, calculado por el único motor que puede calcularlo bien.

Lo que falta es que salga: `toPublicGroup()` no lo proyecta, así que `EntityGroup` no lo tiene y la UI no puede verlo.

### 3. Qué le cuesta al usuario que no salga

La edición manual del `replacementValue` es el remedio que **ADR-058 §4 y ADR-062 le ofrecen explícitamente** al usuario cuando se enciende la marca de reemplazo degradado: "el token no entra en la línea, editalo a mano". En una pericia con 40 grupos, después de editar seis:

- No hay forma de saber **cuáles** de los 40 tocó. El valor editado y el calculado se ven igual — ambos son texto en la misma celda.
- No hay forma de revisar el trabajo antes de exportar, que es justo el momento en que importa.
- Y no hay forma de **deshacer** una edición puntual volviendo al token calculado: el usuario no sabe qué grupo está en qué estado.

O sea: ADR-076 hizo que la edición manual sobreviva, y eso está bien, pero la volvió **invisible y pegajosa** — sobrevive para siempre, sin que se vea que existe.

### 4. La pregunta que hay que contestar, y por eso esto es un ADR

ADR-069 §5 dice de `personGenderUserSet`, textualmente, *"nunca sale de este motor"*, y ADR-076 copió esa frase para `replacementValueUserSet`. Exponer uno de los dos flags contradice esa frase, así que hay que decidir **para los dos a la vez**, no de a uno, o el criterio queda incoherente.

Hay un dato que desempata y que estaba a la vista: **`personGender` sí está expuesto** en `EntityGroup` (`shared/src/types.ts:163`), mientras que `personGenderUserSet` no. O sea que el criterio real de ADR-069 nunca fue "la procedencia no sale": fue **"sale el valor, no la procedencia"**. Y para el género eso alcanza, porque la procedencia es *visible en el propio valor*: el usuario que eligió "femenino" ve `[MUJER 01]` y sabe que fue él.

Para el `replacementValue` no alcanza, y ahí está la asimetría: el valor editado a mano y el calculado son **el mismo tipo de dato en el mismo campo**. Sin la procedencia, no hay nada que mirar.

## Decisión

### 1. `EntityGroup` gana `replacementValueUserSet: boolean`, de solo lectura

Campo público nuevo en `shared/src/types.ts`, proyectado por `toPublicGroup()`:

```ts
readonly replacementValueUserSet: boolean;
```

**No opcional**, a diferencia de `personGender`/`fragments`: no hay estado "sin determinar" — o lo escribió el humano o no. Un `boolean` obligatorio evita que la UI tenga que tratar `undefined` como un tercer caso que no existe.

### 2. `personGenderUserSet` **no** se expone, y queda escrito por qué

La regla que este ADR fija, y que reemplaza a la frase de ADR-069 §5 / ADR-076 §1 ("nunca sale de este motor"), es:

> Un flag `*UserSet` sale del motor **solo si su valor asociado no delata por sí mismo quién lo escribió**.

- `personGender`: el valor **sí** delata (el humano que eligió "femenino" lee `[MUJER 01]`). El flag se queda adentro.
- `replacementValue`: el valor **no** delata (`[P1]` escrito a mano y `[P1]` calculado son idénticos). El flag sale.

Es una regla, no una excepción: cualquier flag `*UserSet` futuro se decide con ella.

### 3. La UI no puede escribirlo

`replacementValueUserSet` es de solo lectura en el sentido fuerte: **no entra en `GroupUpdatePatch`**. Ponerlo en `false` a mano sería pedirle al motor que olvide un hecho, y ADR-076 §3 depende de que ese hecho sea confiable.

"Restaurar el valor calculado" ya existe sin API nueva: `updateGroup({ replacementMode: <el mismo modo> })` recalcula el valor y apaga el flag (es la fila 4 de ADR-076 §4, la rama de modo de `applyGroupUpdate`). La UI usa eso.

### 4. La UI: punto + acción de restaurar

- **Indicador** (`UX_Guidelines.md` §3.3, señal **(b)** de Contexto §1): punto junto al grupo cuando `replacementValueUserSet === true`, con `title`/`aria-label` "Valor de reemplazo editado manualmente". No es solo decorativo: es lo que hace revisable el trabajo antes de exportar.
- **La señal (a) sigue sin implementarse**, y `UX_Guidelines.md` §3.3 se reescribe para decirlo: el paréntesis actual ("indica que el `replacementMode` difiere del default de las reglas") describe una señal que la UI no puede calcular sin reimplementar `resolveMode`. Queda como fila propia, marcada como no implementada, con su razón — en vez de quedar tapada por un punto azul que significa otra cosa.
- **Acción**: entrada "Restaurar valor calculado" en el `GroupContextMenu`, visible **solo** cuando el flag está encendido, que despacha el `updateGroup` de §3.

### 5. Qué NO cambia

- **Ningún evento nuevo.** `ENTITY_GROUP_UPDATED` ya transporta el grupo completo, así que el campo viaja solo; `changes` lo reporta como `"replacementValue"`, que es el campo que de verdad cambió.
- **La semántica de ADR-076 no se toca.** Este ADR expone un flag existente; no cambia cuándo se enciende ni cuándo se apaga.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Que la UI infiera la edición** comparando `replacementValue` contra el token que ella misma calcule | Es exactamente lo que el PR8 rechazó con razón: obliga a la UI a reimplementar `computeReplacementValue` + la escalera de ADR-057 + la resolución de reglas. Y se rompe en silencio en cuanto el motor cambie cualquiera de las tres. |
| **Exponer los dos flags** (`personGenderUserSet` también) | Simetría sin demanda: nadie pidió ver "el género lo elegiste vos", y el propio valor ya lo dice. Agregar un campo público que ningún consumidor necesita es superficie de contrato gratis. |
| **Un campo `replacementValueSource: "auto" \| "user"`** | Un `enum` de dos valores es un `boolean` con más ceremonia. Si algún día hay una tercera procedencia (¿una regla?), se migra ahí con su propio ADR. |
| **Que el flag entre en `GroupUpdatePatch`** | Ver §3: permite mentirle al motor sobre un hecho del que depende ADR-076. |

## Consecuencias

**Positivas**: `UX_Guidelines.md` §3.3 pasa de promesa incumplida a implementado; el usuario puede revisar y deshacer sus ediciones antes de exportar; el criterio de exposición de los flags `*UserSet` queda escrito como regla en vez de como precedente a interpretar.

**Negativas / riesgos asumidos**:

- Un campo público más en `EntityGroup`, que es el tipo más consumido del contrato. Acotado: es un `boolean` obligatorio, así que ningún consumidor existente tiene que cambiar salvo los que **construyen** un `EntityGroup` (los fixtures de test), que sí.
- El indicador puede sorprender tras un `merge`: ADR-076 §4 define que el grupo fusionado conserva su propio flag, así que un merge de un grupo editado con uno no editado puede encender o apagar el punto según cuál sobreviva. Es la semántica de ADR-076, no una decisión nueva; queda anotado para que no se lea como bug.

## Validación

- `getSnapshot` y `ENTITY_GROUP_*` devuelven `replacementValueUserSet: false` en un grupo recién creado.
- Tras `updateGroup({ replacementValue: "[P1]" })`, el mismo grupo lo devuelve en `true`.
- Tras `updateGroup({ replacementMode: <mismo modo> })` sobre ese grupo, vuelve a `false` **y** el `replacementValue` es el calculado (o sea: la acción "restaurar" de §3 funciona con la API que ya existe, sin agregar nada).
- El campo no es asignable desde `GroupUpdatePatch` (falla de tipos, no de runtime).

## Documentos afectados

- `core/Contracts.md` y `architecture/03_Data_Model.md` §8 (`EntityGroup`).
- `core/Grouping_Engine.md` (§6 proyección pública, §14 tests nuevos).
- `ui/UX_Guidelines.md` §3.3 (deja de ser "no implementable") y `ui/Components.md` §3 (el punto y la entrada de menú).
- `adr/ADR-069` §5 y `adr/ADR-076` §1: nota de enmienda con la regla de §2.
- Código: `shared` (**PR 1**) → `grouping-engine` (**PR 2**) → `apps/react-client` (**PR 3**), en ese orden.
