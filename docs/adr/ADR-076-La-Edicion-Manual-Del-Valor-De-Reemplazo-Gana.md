<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,ui/UX_Guidelines.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-072-El-Valor-Sintetico-Identifica-Al-Grupo-No-A-Su-Numero.md | audiencia=humanos+IA | fase=10.9 -->

# ADR-076 — La edición manual del `replacementValue` gana, y el motor recuerda que fue del humano

- **Estado**: Accepted
- **Fecha**: 2026-08-15
- **Decidido por**: El humano, al tomar los puntos 1, 2, 4, 4bis y 10 de `roadmap/Post_Hito10.8_Pendientes.md` como Hito 10.9. El defecto se encontró al planificar ADR-072 (2026-08-14) y se difirió por no pertenecer al Hito 10.6.
- **Relacionado con**: **ADR-057 §7** (que promete en negrita lo que el motor no cumple), **ADR-028** (la renumeración canónica, cuya guarda de "el índice no cambió" es hoy lo único que hace sobrevivir una edición manual, por accidente), **ADR-069 §5** (`personGenderUserSet`: el mismo patrón, por el mismo motivo, ya implementado y mergeado), **ADR-072 §4** (que decidió **no** levantar la guarda de la renumeración justamente para no ensanchar este defecto), ADR-058 §4 y ADR-062 (que le ofrecen al usuario editar el valor a mano como remedio del reemplazo degradado), ADR-061 (el agregado manual, que renumera y por lo tanto dispara el defecto de rutina), ADR-074 §6 (que en este mismo hito hace que la marca de degradación se encienda en más casos)
- **Parte de**: Hito 10.9, PRs 14 y 15

> Convención de citas: `ADR-076 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-076, Contexto §N`.

## Contexto

### 1. Hay una promesa escrita, en negrita, que el código no cumple

ADR-057 §7:

> **La edición manual gana siempre.** Si el usuario escribió su propio `replacementValue` … la escalera no lo toca — ni en ese momento ni en un `finishSession` posterior.

Y `Grouping_Engine.md` §13 caso 30 lo repite como caso límite del spec. El motor no lo hace: si el grupo cambia de `indexInType` en la renumeración canónica de un `finishSession` posterior, su `replacementValue` se recalcula y **se pisa la edición**, sin aviso y sin forma de recuperarla.

Esto no es una limitación conocida: es un incumplimiento de contrato documentado. **Hay que cerrar la brecha en una dirección o en la otra** — implementar la promesa, o corregir los dos docs para que digan lo que el motor hace. Este ADR elige implementarla, por lo de Contexto §4.

### 2. La supervivencia de hoy es un accidente, y está documentada como tal

`renumberGroupsCanonically` (`grouping-engine/src/grouping.engine.ts`) tiene dos guardas anidadas y **ninguna pregunta quién escribió el valor**:

```ts
if (newIndex === group.indexInType) return;              // ADR-028
…
if (group.replacementMode === ReplacementMode.Placeholder) {
  group.replacementValue = computeReplacementValue(…);   // pisa la edición manual
}
```

La cabecera del propio motor (nota 12) ya lo dice: *"No hay tracking de 'este valor fue editado a mano' más allá de ese guard heredado"*. O sea que la edición sobrevive **solo cuando el índice no se mueve**, y por una guarda que existe para otra cosa.

### 3. Hay un segundo camino, y se encontró después de escribir el diagnóstico

El pendiente §10 se escribió sobre `renumberGroupsCanonically`. Al revisar la branch del Hito 10.6 (2026-08-14) apareció que **`inferGendersOnFinish` hace lo mismo**. Repro:

1. Grupo `Person` con `canonicalValue` `"Andrea Ruiz"` — sin género determinado (el registro la declara `A`, ADR-069 §1).
2. El usuario edita el `replacementValue` a mano a `[P1]`.
3. Llegan dos ocurrencias `"Julia Ruiz"` con el mismo `normalizedValue`: el `canonicalValue` evoluciona **por frecuencia de alias**, que no es ninguno de los tres disparadores de inferencia inmediata de ADR-069 §6(a).
4. `finishSession` corre `inferGendersOnFinish`, infiere `f` y pisa `[P1]` con `[MUJER 01]`.

Importa para el diseño: cualquier arreglo que se ate a **un** punto de recálculo tapa la mitad del defecto. Y desde ADR-071 §6 ese segundo camino recalcula también en modo `synthetic`, así que el agujero es más ancho que cuando se escribió el pendiente.

### 4. Por qué importa más de lo que parece

Editar el `replacementValue` a mano no es una preferencia estética: es **el remedio documentado** que ADR-058 §4 y ADR-062 le ofrecen al usuario cuando se enciende la marca de reemplazo degradado. El producto le dice "este token no entra, acortalo", el usuario escribe `[P1]`, y el remedio se deshace solo en el próximo cierre de sesión.

Y la condición pasa de rara a rutinaria por dos caminos, uno ya mergeado y otro de este mismo hito:

- **ADR-061** (Hito 10.7, mergeado): cada entidad agregada a mano dispara `finishSession`, y la renumeración corre los índices de todos los grupos posteriores de ese tipo. Agregar una entidad manual es una operación **frecuente** — es la red de contención del recall del NER.
- **ADR-074 §6** (este hito): el veredicto de degradación pasa a computarse contra el fragmento donde se pinta y no contra una envolvente que lo apagaba, así que la marca se va a encender en casos donde hoy no se enciende. Más usuarios usando el remedio que se deshace solo.

### 5. Esto no es levantar la guarda que ADR-072 §4 decidió no levantar

ADR-072 §4 decidió **no tocar** el `if (group.replacementMode === ReplacementMode.Placeholder)` de `renumberGroupsCanonically`, porque levantarlo habría ensanchado este mismo defecto de "se pierden las ediciones manuales de grupos en `placeholder`" a "se pierden en los cuatro modos".

Este ADR va en la dirección contraria y es compatible: no libera guardas, **agrega la que falta**. Después de esto, la de ADR-072 §4 sigue sin tocarse y deja de ser load-bearing para nada que no sea lo suyo.

### 6. El test que cubre el caso no puede verlo

`ADR-057 §Tests` pide *"un `replacementValue` editado a mano sobrevive a `finishSession`"*, y ese test existe y pasa. Pasa porque en su escenario **el índice no cambia**: la guarda de afuera corta antes de llegar a la de adentro, y el test nunca ejercita la condición que dispara el defecto.

Es exactamente la forma de agujero que ADR-069 Contexto §3 documentó para el léxico de género: verde sin ejercitar la condición. La corrección del test es parte del entregable de este ADR, no un extra.

## Decisión

### 1. `replacementValueUserSet`, bookkeeping interno, nunca expuesto

`InternalGroup` gana un campo, con el patrón **exacto** de `personGenderUserSet` (ADR-069 §5) y por el mismo motivo — sin él, un valor escrito por el humano es indistinguible de uno calculado:

```ts
/**
 * ADR-076 §1: el `replacementValue` lo escribió el usuario. Ningún recálculo
 * automático lo pisa (§3). Nunca sale de este motor — mismo criterio que
 * `personGenderUserSet`, `normalizedValues` y `aliasFrequency`.
 */
replacementValueUserSet: boolean;
```

No viaja en `EntityGroup`, no viaja en ningún evento, no entra a `Contracts.md` ni a `03_Data_Model.md` §9. Se limpia con la sesión en `closeSession`, que borra la sesión entera, y sobrevive a `reopenSession`, que no toca `session.groups` — las dos cosas sin código adicional, igual que el flag de género.

### 2. Se enciende con `patch.replacementValue`, y con nada más

En `applyGroupUpdate`, cuando `req.patch.replacementValue !== undefined`. Ese es el **único** canal por el que un usuario escribe un valor de reemplazo (`04_Event_System.md` §10, `GROUP_UPDATE_REQUESTED`), así que es el único lugar donde el flag se prende.

Dos precisiones:

- **`""` cuenta.** Un valor vacío escrito a mano es una elección (es lo que corresponde para `redact`), no una ausencia. Mismo criterio con el que ADR-069 §4 trata al `"neutral"`.
- **Un patch con `replacementMode` *y* `replacementValue` deja el flag en `true`.** El código ya resuelve el valor en ese orden (la rama de modo computa, y la asignación explícita de `replacementValue` la sobrescribe); el flag sigue esa misma precedencia. El usuario mandó las dos cosas: la que gana es la que escribió.

### 3. La regla, en una línea

> **Un `replacementValue` escrito por el usuario sobrevive a todo recálculo automático. Lo reemplaza únicamente un cambio del `replacementMode` efectivo del grupo, que además apaga el flag.**

El corte no es "automático vs. manual": es **si el modo cambió**. El motivo es que `replacementValue` es el valor *de un modo*: un grupo en `mask` mostrando `[P1]` es una inconsistencia que el usuario no pidió, porque el valor que escribió lo escribió para otro modo. Y es coherente con la precedencia que el motor ya tiene: en `resolveMode` (`Grouping_Engine.md` §"Resolución de modo") **las reglas ya ganan sobre el modo puesto a mano**; que ganen también sobre el valor atado a ese modo no agrega una excepción, la mantiene.

Es además la línea que ADR-072 §4 ya había trazado para el otro caso: *"esas están en el camino de una edición explícita del usuario sobre ese mismo grupo, no en el de una renumeración masiva"*.

### 4. Los once puntos de recálculo, uno por uno

El alcance de este ADR no es una guarda: es la **precedencia completa del campo**. `computeReplacementValue` tiene once call sites y cada uno queda decidido:

| # | Call site | Qué pasa | Por qué |
|---|---|---|---|
| 1 | `createGroup` | nace con el flag en `false` | no hay edición que preservar |
| 2 | `renumberGroupsCanonically` (ADR-028) | **respeta el flag** | es el defecto reportado: renumerar no es una decisión sobre el valor |
| 3 | `inferGendersOnFinish` (ADR-069 §6b) | **respeta el flag** | es el segundo camino de Contexto §3 |
| 4 | `applyGroupUpdate`, rama de `replacementMode` | recalcula y **apaga el flag** | el usuario tocó el selector de modo (§3) |
| 5 | `applyGroupUpdate`, rama de `personGender` | **respeta el flag** | cambia el label, no el modo |
| 6 | `applyGroupMerge` | **respeta el flag** del sobreviviente | el grupo que sobrevive conserva su identidad, igual que su `id` (ADR-072 §1), su modo y su `personGenderUserSet` (ADR-069 §5) |
| 7 | `doApplyGroupSplit`, grupo `created` | nace con el flag en `false` | es otra entidad, con `id` propio y valor propio (§13 caso 6) |
| 8 | `doApplyGroupSplit`, grupo remanente | **respeta el flag** | es el mismo grupo de antes, con menos members |
| 9 | `dropOccurrences` (ADR-038) | **respeta el flag** | perder ocurrencias no es una decisión sobre el valor |
| 10 | `applyConflictResolve` | recalcula y **apaga el flag** | fija `group.replacementMode = req.mode`: es una elección de modo del usuario, misma familia que el #4 |
| 11 | `recomputeAllGroupModes` (reglas) | recalcula y **apaga el flag** | ya tiene `if (effectiveMode === before) continue;`: **solo corre cuando el modo efectivo cambió**, que es exactamente la condición de §3. No necesita mirar el flag — la guarda que hace falta ya está escrita ahí, y conviene dejar dicho por qué no se agrega una segunda |

El #11 es el que vuelve implementable a §3: la condición "el modo efectivo cambió" ya existe en el único punto donde una regla puede mover el modo, así que no hay que inventar detección de cambios en ningún lado.

### 5. Cómo vuelve el usuario al valor automático

Tocando el selector de modo (#4 de la tabla). Elegir otro modo y volver al anterior recalcula el valor y apaga el flag: dos clicks, con la lista de modos que ya está en la fila del grupo.

**No se agrega un canal nuevo al patch** (un `replacementValue: null`, un `resetReplacementValue: true`). Sería un cambio de contrato —`GroupUpdateRequested.patch` está en `Contracts.md` §8 y en `04_Event_System.md` §10— más un control nuevo en la fila más cargada del árbol, para una operación que la UI ya permite con los controles que tiene. `ui/UX_Guidelines.md` lo documenta como la vía; si el uso real muestra que hace falta un "restaurar automático" explícito, es una afordancia de UI que no toca el Core, y queda anotada en `Future_Ideas.md`.

### 6. Lo que no toca el valor manual, y conviene tenerlo listado

`enabled`, `canonicalValue`, `personGender`, la llegada de una `Occurrence` nueva al grupo (§13 caso 17), la escalera de abreviaturas de ADR-057, la renumeración de ADR-028, un `reopenSession` y un `finishSession` re-ejecutado. Ninguno cambia el `replacementMode` efectivo, así que ninguno pisa el valor.

Y una que **sí** lo toca aunque no lo parezca: una regla de tipo o global creada después, que cambie el modo efectivo del grupo (#11). Es lo correcto por §3 y hay que decirlo, porque es el único caso donde el valor manual se pierde sin que el usuario haya tocado ese grupo.

### 7. La guarda de ADR-072 §4 sigue sin tocarse

`renumberGroupsCanonically` sigue recalculando **solo** en modo `placeholder`. Este ADR le agrega la consulta al flag (#2), no le saca la condición de modo. Las dos razones de ADR-072 §4 siguen valiendo: los valores sintéticos ya no dependen del índice, así que recalcularlos no haría nada, y levantar esa condición seguiría siendo el arreglo equivocado.

### 8. Alcance y tests

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 14 | Este ADR + propagación a specs | `docs/` | — |
| 15 | `replacementValueUserSet` y los once puntos de §4 | `grouping-engine` | 14 |

Va **después** de ADR-073 en el mismo módulo (Hito 10.9, PR 2), para que los dos PRs de `grouping-engine` no se pisen: tocan funciones distintas, pero el segundo rebasea sobre el primero y no al revés.

Tests del PR 15:

- **Edge — el test que define este ADR**: un `replacementValue` editado a mano sobrevive a un `finishSession` **en el que el `indexInType` del grupo sí cambia**. Es el test de ADR-057 §Tests corregido: hoy pasa sin ejercitar la condición (Contexto §6), y el arreglo del escenario es parte del entregable.
- **Edge — el segundo camino**: la repro literal de Contexto §3 — `"Andrea Ruiz"` con valor manual `[P1]`, dos `"Julia Ruiz"` que mueven el `canonicalValue` por frecuencia, `finishSession` infiere `f` y el valor **sigue siendo** `[P1]`. Sin este test, el arreglo tapa la mitad del defecto.
- **Edge**: lo mismo en modo `synthetic` (ADR-071 §6 abrió ese camino), para que el arreglo no quede atado a `placeholder`.
- **Edge**: el valor manual sobrevive a una fusión (el sobreviviente lo conserva) y a una división (el remanente lo conserva; el grupo nuevo nace con valor calculado).
- **Edge**: el valor manual sobrevive a `dropOccurrences` y a `reopenSession` + `finishSession`.
- **Edge**: un cambio explícito de `replacementMode` **sí** lo reemplaza y apaga el flag — y volver al modo original vuelve a dar el valor calculado, no el manual (§5, la vía de vuelta).
- **Edge**: una regla de tipo que cambia el modo efectivo del grupo **sí** lo reemplaza (#11); una regla que no cambia el modo efectivo **no** lo toca.
- **Edge**: `applyConflictResolve` lo reemplaza (#10).
- **Edge**: un patch con `replacementMode` y `replacementValue` juntos deja el valor del usuario y el flag en `true` (§2).
- **Edge**: `patch.replacementValue = ""` cuenta como edición manual (§2).
- **Contract**: el flag no aparece en `getSnapshot`, ni en `EntityGroup`, ni en ningún payload de evento — mismo test que ADR-069 §5 tiene para `personGenderUserSet`.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Corregir los docs en vez del código** (ADR-057 §7 y §13 caso 30 pasan a decir "la edición manual sobrevive salvo que el índice cambie") | Es la otra dirección honesta de cerrar la brecha, y describe un comportamiento indefendible: el usuario no tiene forma de saber si su índice se va a mover, la condición depende de qué otras entidades encuentre el detector, y el remedio de ADR-058 §4 pasaría a ser "escribí un valor que quizás se borre". Además el defecto se agrava solo con ADR-061 y ADR-074 §6 (Contexto §4). |
| **Guardar el valor manual en un campo aparte** (`manualReplacementValue?: string`) y resolver el efectivo al leer | Dos fuentes de verdad para `replacementValue`, con todo lo que eso implica: qué emite `GROUP_REPLACEMENT_CHANGED`, qué ve `buildPageReplacements`, qué se exporta. El flag deja **una** fuente de verdad y solo agrega quién la escribió. Es, además, el patrón que ADR-069 §5 ya validó en este mismo motor. |
| **Detectar la edición comparando contra el valor calculado** (si `replacementValue !== computeReplacementValue(...)`, es manual) | Recalcula en cada consulta el valor que se quiere evitar recalcular, y falla en el caso que importa: si el usuario escribe a mano **exactamente** el valor que el motor habría calculado, el grupo queda marcado como no editado; y si el índice se mueve, el valor calculado cambia y de golpe un valor no editado parece editado. Inferir intención de un string es lo que el flag existe para no hacer. |
| **Que la renumeración no recalcule nunca ningún `replacementValue`** | Rompe ADR-028: el `placeholder` **es** `[<LABEL> <NN>]` con el índice adentro, así que un grupo renumerado que no recalcula muestra un número que ya no es el suyo. El defecto que se arreglaría es más chico que el que se crearía. |
| **Levantar la guarda de modo de `renumberGroupsCanonically`** para uniformar | Es lo que ADR-072 §4 rechazó con su propio análisis, y este ADR no lo necesita (§7). |
| **Un campo nuevo en `GroupUpdateRequested.patch` para restaurar el valor automático** | Cambio de contrato (`Contracts.md` §8 y `04_Event_System.md` §10) más un control nuevo en la fila del árbol, para una operación que se hace con el selector de modo que ya está ahí (§5). Si el uso real lo pide, es una afordancia de UI y no toca el Core. |

## Consecuencias

**Positivas**: se cumple una promesa que estaba escrita en negrita en un ADR aceptado y en un caso límite del spec, que es lo que un usuario razonablemente espera; el remedio de ADR-058 §4 / ADR-062 pasa a ser confiable justo en el hito donde ADR-074 §6 lo va a hacer más frecuente; el defecto queda cerrado por sus **dos** caminos y no por el que estaba reportado; la precedencia de `replacementValue` queda decidida y escrita para los once puntos de recálculo, así que el próximo que agregue uno tiene dónde mirar; y el patrón es el que este mismo motor ya usa para el género, sin inventar mecanismo nuevo.

**Negativas**: un flag interno más en `InternalGroup`, con su ciclo de vida en fusión y división que hay que sostener (mitigado: es el segundo, con el primero ya probado, y los dos se limpian solos con la sesión); la vía para volver al valor automático es indirecta —cambiar de modo y volver— y hay que documentarla en la UI porque no es evidente (§5); y una regla que cambia el modo efectivo de un grupo pisa su valor manual sin que el usuario haya tocado ese grupo (§6), que es correcto por §3 pero puede sorprender.

**Neutras**: `EntityGroup`, `Contracts.md`, `03_Data_Model.md` §9 y los payloads de eventos no cambian — el flag nunca sale del motor; `GroupUpdateRequested.patch` queda igual (§5); `apps/react-client` no se toca; la guarda de ADR-072 §4 sigue intacta (§7); ADR-028 sigue renumerando y recalculando exactamente los mismos grupos, menos los que el usuario editó; y `closeSession`/`reopenSession` no necesitan código nuevo.

## Docs actualizados por este ADR

- `core/Grouping_Engine.md` → v1.6.0 (junto con ADR-073, mismo hito y mismo motor): §13 caso 30 pasa de describir solo la escalera a describir la precedencia completa de §3-§4; casos nuevos para el cambio de modo y para la regla que cambia el modo efectivo; §14 (los tests de §8, incluida la **corrección** del test de ADR-057 §Tests, que hoy pasa sin ejercitar la condición); §15 (ítem de checklist); y la sección de la escalera de abreviaturas, cuya línea *"la edición manual gana siempre"* pasa a apuntar acá.
- `adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md` §7 — nota de que la promesa se implementa acá y que el test que la cubría no la ejercitaba.
- `ui/UX_Guidelines.md` — qué pasa con un valor escrito a mano y cómo se vuelve al automático (§5).
- `roadmap/MVP.md` §4 — bloque del Hito 10.9.
- `roadmap/Post_Hito10.8_Pendientes.md` §10 — pasa de pendiente a adoptado.
- `roadmap/Future_Ideas.md` — la afordancia explícita de "restaurar valor automático" (§5).

`core/Contracts.md` **no** se toca: el flag es interno y no hay tipo, evento ni error code nuevo.

## Validación

- Los tests de §8, con dos que son condición de mergeo: el que define el ADR (`finishSession` **con** cambio de índice) y la repro literal de Contexto §3 por el camino del género. Uno solo de los dos deja la mitad del defecto abierta.
- El test que ADR-057 §Tests pedía queda **corregido**, no agregado: su escenario pasa a mover el índice. Que hoy pase sin ejercitar la condición es parte del hallazgo, no un detalle de implementación.
- Verificación manual: editar el `replacementValue` de un grupo, agregar después una entidad a mano que corra los índices de ese tipo (ADR-061), y confirmar que el valor sigue siendo el escrito. Es el escenario que vuelve rutinario el defecto.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Grouping_Engine.md` §13 casos 17, 21, 30, §"Resolución de modo", §"Escalera de abreviaturas" — `core/Contracts.md` §8 — `architecture/04_Event_System.md` §10
- `adr/ADR-012` — `adr/ADR-028` — `adr/ADR-038` §2 — `adr/ADR-057` §7 — `adr/ADR-058` §4, §7 — `adr/ADR-061` — `adr/ADR-062` — `adr/ADR-069` §4, §5, §6 — `adr/ADR-071` §6 — `adr/ADR-072` §1, §4 — `adr/ADR-074` §6
- `roadmap/Post_Hito10.8_Pendientes.md` §10 (el reporte original y su segundo camino)
- Código: `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`computeReplacementValue` y sus once call sites; `renumberGroupsCanonically`, `inferGendersOnFinish`, `applyGroupUpdate`, `recomputeAllGroupModes`)
