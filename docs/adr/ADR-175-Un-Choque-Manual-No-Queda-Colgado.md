<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Grouping_Engine.md,core/Orchestrator.md,ui/UX_Guidelines.md,ui/Components.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-175 — Un choque manual no queda colgado

- **Estado**: Accepted — **modificado por ADR-176** (§3: el resultado de un agregado lo calcula Grouping con `manualOutcome`; §2: `liftRemoval` olvida toda supresión del valor)
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante la revisión 2 del Hito 12.5 (REJECTED). Eligió que lo marcado
  **se oculte solo** si desaparece la detección con la que chocó, **una decisión para todos** los choques
  de un mismo agregado, y que el aviso de choque sin resolver **vuelva** cuando se cierra el toast que lo
  tapó.
- **Modifica**: ADR-174 (§1, §2, §4). ADR-174 sigue vigente en todo lo demás.
- **Relacionado con**: ADR-171 (eliminar entidad y supresión por valor), ADR-172 (deshacer), ADR-038
  (re-análisis), ADR-061 §5 (re-aplicación de literales), ADR-115 (`normalizeEntityValue`).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

La revisión 2 encontró que ADR-174 dejaba tres cabos sueltos:

1. **El choque se "resolvía" solo.** Si la detección con la que chocó una ocurrencia manual retenida
   desaparece —el usuario la elimina (ADR-171), o un re-análisis la barre con `dropOccurrences`—, el
   barrido de conflictos de Grouping lo marca `resolved: true` pero deja `heldManual` y la ocurrencia
   retenida colgando. El dedup sigue viendo esa retenida, así que una re-aplicación del literal o un nuevo
   agregado del mismo valor se descartan: no hay grupo, no hay conflicto abierto, el export se desbloquea y
   el texto que el usuario marcó queda **a la vista**. ADR-174 no decía qué pasa en ese caso.
2. **`heldConflictIds` comparaba texto exacto.** El Orchestrator buscaba los choques por
   `candidate.value === request.value`, pero `candidate.value` es el texto de las palabras enteras del
   documento (ADR-089 §3), con su puntuación pegada: agregar `34567891` sobre «34567891.» dejaba el choque
   afuera, el diálogo no se abría y la UI decía "no se encontró". La UI tiene el mismo problema al buscar
   el grupo del agregado (`findAddedGroup` compara con su propia normalización, que no recorta bordes; y
   además es lógica del motor en la UI, U-3).
3. **Cómo se decide y cómo se avisa** con varios choques en un mismo agregado, y qué pasa con el aviso
   persistente cuando otro toast lo reemplaza. ADR-174 hablaba de un solo diálogo y de un aviso que "no se
   va solo", pero la pantalla tiene una sola ranura de toast.

## Decisión

### 1. Una retenida nunca queda colgada

**Invariante**: un conflicto con `heldManual: true` está **sin resolver** y tiene exactamente una ocurrencia
retenida. Ningún camino deja `resolved: true` con `heldManual`, ni una retenida sin su conflicto abierto.

Cuando un conflicto `heldManual` pierde una de sus dos partes:

| Qué pasa | Resultado |
|---|---|
| El grupo detectado del conflicto desaparece —`applyGroupRemove` (ADR-171) o `dropOccurrences` que lo deja sin members— y la retenida **no** cae en el filtro | **Se oculta sola**: se resuelve por el mismo camino que `winner: "manual"` (`groupOccurrence`, `resolvedType` = tipo manual, `CONFLICT_RESOLVED`). Si el valor normalizado de la retenida quedó en `removedValues` por esa misma eliminación, se quita de ahí: lo que el usuario marcó a mano gana sobre la supresión de la detección. |
| `dropOccurrences` se lleva **la retenida** (su página en `pageIndices`) | Se descarta con su página, como cualquier ocurrencia de esa página: sale de la sesión **sin** dejar identidad registrada, y el conflicto se cierra `resolved: true` **sin** `heldManual` (`CONFLICT_RESOLVED` con el tipo detectado). La re-aplicación del literal (ADR-061 §5) la vuelve a emitir: si la detección reaparece, nace un conflicto `heldManual` nuevo y el usuario vuelve a decidir; si no, se agrupa. |
| Se fusiona, divide o reclasifica el grupo detectado | Nada: la detección sigue existiendo y el choque sigue pendiente. |

Todo pasa dentro del mismo pedido que lo provocó, así que entra en su mismo punto de deshacer (ADR-172).
En la UI, el toast de "Eliminar entidad" lo dice cuando corresponde: *"Eliminaste «Y» · Lo que marcaste
(«X») ahora se oculta"*, con **"Deshacer"**. La UI lo sabe porque, en el mismo pedido, un conflicto
`heldManual` de ese grupo pasa a resuelto.

### 2. Un agregado nuevo reabre una decisión anterior

`liftRemoval` (ADR-171 §4) también olvida las identidades que quedaron suprimidas por una resolución
`winner: "detected"` cuyo valor normalizado coincide con el del pedido. Si el usuario vuelve a marcar algo
que antes dejó como estaba, el choque se vuelve a crear y el diálogo se abre de nuevo. La re-aplicación
automática de literales sigue sin llamarlo (ADR-171 §4): el caso 58 de Grouping no cambia.

### 3. El Core dice dónde cayó el agregado

```ts
export interface ManualEntityResult {
  readonly occurrenceCount: number;
  readonly heldConflictIds: ReadonlyArray<string>;
  /** ADR-175 §3: grupos en los que quedaron las ocurrencias de este agregado (incluye grupos que ya existían). [] = ninguno. */
  readonly groupIds: ReadonlyArray<string>;
}
```

El Orchestrator junta el `id` y el `normalizedValue` de cada ocurrencia `Manual` que `findLiteral` emite en
este agregado —escuchando `ENTITY_FOUND` del documento mientras dura la búsqueda— y con eso calcula, del
snapshot tras `finishSession`:

- `heldConflictIds`: los conflictos sin resolver con `heldManual` cuyo candidato `Manual` es **del tipo
  pedido** y tiene un valor que, pasado por `normalizeEntityValue`, está en el conjunto. Reemplaza la
  comparación exacta de ADR-174 §2.
- `groupIds`: los grupos que cumplen **alguna** de dos condiciones:
  (a) tienen un member cuyo `occurrenceId` es de una ocurrencia emitida, lo que cubre un grupo nuevo aunque
  la memoria de reclasificación (ADR-085) le haya cambiado el tipo;
  (b) son **del tipo pedido** y tienen un member cuyo valor, pasado por `normalizeEntityValue`, está en el
  conjunto, lo que cubre el valor que ya estaba en un grupo y el dedup descartó.

  **Errata 2026-09-24** (el implementador lo detuvo con un test real): la primera redacción no exigía el tipo.
  Un grupo **de otro tipo** detectado sobre el mismo texto —DNI sobre «34567891.» cuando se agrega
  `34567891` como Teléfono— entraba en `groupIds` y hacía pasar por éxito un agregado que quedó retenido.
  Contradecía el caso 43 de `Orchestrator.md`.

Como `normalizedValue = normalizeEntityValue(match.text)` y `candidate.value = match.text` (ADR-115), la
correspondencia es exacta aunque el documento tenga puntuación pegada o el valor ya estuviera retenido de
antes.

**Invariante**: `occurrenceCount > 0` ⇒ `heldConflictIds` o `groupIds` no está vacío.

La UI deja de buscar el grupo por su cuenta (`findAddedGroup` y `foldForLookup` se retiran, U-3):

- `heldConflictIds` no vacío → diálogo de choque;
- si no, `groupIds` no vacío → toast de alta, nombrando el primer grupo del tipo pedido, o el primero;
- si no, `occurrenceCount === 0` → "no se encontró";
- el caso restante rompe el invariante: toast de error *"No se pudo agregar «X»."*, se retira la entrada
  de deshacer y se loguea. Nunca se dice "no se encontró" sobre algo que el Core encontró.

### 4. Una decisión para todos los choques de un agregado

- `ManualOverlapDialog` recibe **todos** los `heldConflictIds` del agregado. Con uno, el texto es el de
  ADR-174 §4. Con más, dice *"Lo que marcaste se superpone con datos ya detectados en N lugares. ¿Qué
  querés ocultar?"*, muestra el primer par y *"y N−1 lugares más"*.
- La elección se aplica a todos: un `CONFLICT_RESOLVE_REQUESTED` por conflicto, con el mismo `winner`,
  dentro de **una sola** entrada de deshacer. El toast dice *"Ocultaste «X» en N lugares"* o *"Dejaste lo
  que ya estaba detectado en N lugares"* (sin "en N lugares" si es uno).
- Desde el aviso ⚠ de una fila, el diálogo abarca los conflictos `heldManual` sin resolver de **esa**
  fila.
- El diálogo no ofrece elegir sobre algo ya resuelto: si todos sus conflictos están resueltos al abrirse o
  mientras está abierto, se cierra sin registrar deshacer ni mostrar toast.

### 5. El aviso de choque sin resolver vuelve

El aviso *"Quedó un choque sin resolver…"* con **"Resolver"** deja de ser un toast que se dispara una vez.
Pasa a ser un **estado**: se muestra mientras exista al menos un conflicto `heldManual` sin resolver y el
diálogo de choque esté cerrado. Sigue usando la única ranura de toast, sin reservar otro espacio (UX-10).
Si otro toast lo reemplaza, **vuelve cuando ese toast se va**. "Resolver" abre el diálogo sobre la primera
fila, en el orden de la lista, que tenga un choque pendiente. Ese orden hace que el aviso también aparezca
para un choque que nació en un re-análisis (§1), no solo para uno recién agregado.

## Consecuencias

- Deja de haber un camino por el que lo que el usuario marcó quede a la vista sin que haya elegido.
- El resultado de `addManualEntity` alcanza para decidir qué decir, así que la UI deja de reimplementar la
  normalización.
- `ManualEntityResult` gana un campo requerido: cambio de contrato. Lo consume solo la UI.
- **En contra**: eliminar una detección ahora puede ocultar texto (lo marcado), además de destaparlo. El
  toast lo dice y se deshace con un solo `Ctrl+Z`.

## Documentación que cambia

- `core/Contracts.md` §3.5 (`ManualEntityResult.groupIds`, criterio de `heldConflictIds`).
- `architecture/03_Data_Model.md` §15 (invariante de `heldManual`).
- `core/Grouping_Engine.md` §6 (`liftRemoval`, `dropOccurrences`, `applyGroupRemove`), §13 casos 59-62,
  §14, §15 (15w).
- `core/Orchestrator.md` §6 (`addManualEntity`), §13 casos 43-44, §14, §15 (32).
- `ui/UX_Guidelines.md` §5.4b; `ui/Components.md` §3.4c y §6.3.
- `adr/ADR-174-…`: nota de "Modificado por ADR-175".
