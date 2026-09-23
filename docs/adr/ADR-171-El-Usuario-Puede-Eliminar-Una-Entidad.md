<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/04_Event_System.md,core/Grouping_Engine.md,core/Orchestrator.md,architecture/08_Security_Model.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-085-Memoria-De-Reclasificacion-Por-Documento.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-171 — El usuario puede eliminar una entidad

- **Estado**: Accepted
- **Fecha**: 2026-09-23
- **Decidido por**: El humano, sobre las pruebas de usuario ("en los tres puntitos, agregar una opción
  que sea «Eliminar entidad» y lo borre completamente de la lista") y, ante la pregunta de qué pasa si
  un re-análisis vuelve a encontrar el dato: *"Sigue eliminada"*.
- **Relacionado con**: ADR-169 §10 (el menú ⋯), ADR-172 (deshacer), ADR-038 (re-análisis que preserva
  ediciones), ADR-061 §5 (re-aplicación de literales manuales), ADR-085 (memoria de reclasificación,
  el patrón que se sigue), ADR-028 (renumeración).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

### 1. Hoy no se puede

`ENTITY_GROUP_REMOVED` existe, pero lo emite el Grouping Engine **por su cuenta** (fusión,
`dropOccurrences`), nunca a pedido de la UI: no hay ningún evento del canal `ui` que lo pida.
`UX_Guidelines.md` §3.1 listaba "Eliminar grupo" en el menú ⋯ y `Components.md` §3.5 lo describía como
*deshabilitar*, que no es lo mismo: un grupo deshabilitado sigue en la lista.

### 2. Qué quiere decir "eliminar"

El usuario elimina una entidad cuando el detector marcó algo que **no es un dato personal** ("Banco
Nación" en un documento donde no identifica a nadie) y no quiere verlo más. La diferencia con
deshabilitar es de lista, no de documento: en los dos casos el texto queda **a la vista** en el PDF
exportado.

### 3. Un re-análisis lo volvería a traer

Un re-análisis (ADR-038) re-detecta las páginas afectadas, y el detector vuelve a emitir el mismo
valor: sin memoria, la entidad eliminada reaparece sola. Además, si la entidad se había **agregado a
mano**, el Orchestrator re-aplica sus literales después de cada re-detección (ADR-061 §5), que es otro
camino por el que volvería.

## Decisión

### 1. Un pedido nuevo en el canal `ui`

```ts
// EngineEvents (canal ui)
GROUP_REMOVE_REQUESTED = "GROUP_REMOVE_REQUESTED",

export interface GroupRemoveRequested { readonly documentId: string; readonly groupId: string; }
```

`sync`, idempotente, receptor el Grouping Engine (que ya escucha el canal `ui`, `Grouping_Engine.md`
§8). Grupo inexistente → `warn` + no-op, como los demás pedidos de la UI sobre un grupo que ya no está.

### 2. Qué hace el Grouping Engine: `applyGroupRemove`

1. Quita el grupo de la sesión y emite `ENTITY_GROUP_REMOVED`. El Orchestrator re-renderiza sus
   páginas por el camino que ya existe (ADR-044, `Orchestrator.md` §13 caso 27).
2. Los conflictos de ese grupo se descartan con `CONFLICT_RESOLVED`, igual que cuando `dropOccurrences`
   deja un grupo sin members (`Grouping_Engine.md` §13 caso 25).
3. Su `indexInType` queda como **hueco** (caso 15); la renumeración canónica del próximo
   `finishSession` lo compacta (ADR-028), como cualquier hueco.
4. **Registra la supresión**: agrega a `Session.removedValues` (interno, mismo patrón que
   `Session.typeCorrections` de ADR-085) el valor normalizado (`normalizeForComparison`) de **cada
   alias** del grupo. **Sin tipo**: se suprime el valor, no el par valor+tipo, porque lo que el usuario
   dijo es "esto no es un dato", no "esto no es una persona" (para eso está "Cambiar tipo").
5. Los registros de ocurrencias del grupo se **conservan** en la sesión, así el dedup por identidad
   (ADR-038 §3) sigue reconociéndolas.

### 3. La supresión sobrevive al re-análisis

Al recibir un `ENTITY_FOUND` —de **cualquier** fuente, incluida `Manual`— cuyo valor normalizado está
en `removedValues`, el motor registra la identidad (para el dedup) y **descarta la ocurrencia sin
agruparla**. Se consulta después del dedup por identidad y antes del matching.

- `reopenSession` conserva `removedValues`, igual que el resto del estado de ediciones (ADR-038 §2).
- `closeSession` (`DOCUMENT_CLOSED`) lo descarta.
- **No sale en el snapshot** (`GroupingEngineSnapshot`), igual que `typeCorrections` (ADR-085 §8).

### 4. Solo un agregado manual **nuevo** levanta la supresión

Si el usuario agrega a mano un valor que antes eliminó, está diciendo lo contrario y hay que
respetarlo. Pero la re-aplicación automática de literales manuales tras un re-análisis (ADR-061 §5) **no
es** una decisión nueva del usuario y **no debe** levantarla. Para distinguirlas:

- `GroupingEngine` gana `liftRemoval(documentId, value): void`, que quita de `removedValues` el valor
  normalizado. Sesión inexistente → `warn` + no-op.
- `IPipelineOrchestrator.addManualEntity` —que solo se invoca a pedido del usuario— llama a
  `grouping.liftRemoval` **antes** de `reopenSession`.
- La re-aplicación de literales retenidos (ADR-061 §5) **no** la llama, así que sus ocurrencias de un
  valor eliminado se descartan por §3.

### 5. La UI

- Menú ⋯ → **"Eliminar entidad"** (en rojo, último, tras un separador — ADR-169 §10) → `ConfirmDialog`
  que nombra la entidad y dice que **su texto queda a la vista en el documento exportado** → al
  confirmar:
  1. si existe una `Rule` de scope `group` para ese grupo, `RULE_DELETED` de esa regla (las reglas son
     estado de la UI que viaja al motor; una regla huérfana contaría en la franja "Todo el documento");
  2. `GROUP_REMOVE_REQUESTED`.
  Los dos pasos entran en un **mismo** punto de deshacer (ADR-172).
- Toast: *"Eliminaste «X» · Ya no está en la lista ni se va a ocultar"* con **"Deshacer"**.
- `entities.store.removeGroup` ya existe y reacciona a `ENTITY_GROUP_REMOVED`.

## Consecuencias

**A favor**

- El usuario limpia la lista de falsos positivos y no vuelven tras un re-análisis.
- Sigue el patrón probado de `typeCorrections` (memoria interna por sesión, consultada en un solo
  punto).

**En contra**

- **Un valor eliminado queda sin anonimizar**, como uno deshabilitado, pero ya no aparece en la lista
  para recordarlo. La confirmación lo dice, el deshacer (ADR-172) lo revierte, y el pre-flight del
  export (`UX_Guidelines.md` §8.4) no cambia. `08_Security_Model.md` lo registra.
- La supresión es por valor: si el mismo texto aparece como dato real en otra parte del documento
  (dos personas con el mismo apellido), eliminar una suprime las dos. Para separar casos está
  "Dividir" antes de eliminar.

**Lo que no toca**

- Render y Export: ya reaccionan a `ENTITY_GROUP_REMOVED` y leen el snapshot.
- La fusión y `dropOccurrences`, que siguen emitiendo `ENTITY_GROUP_REMOVED` por su cuenta **sin**
  registrar supresión.

## Documentación que cambia

- `core/Contracts.md` §2 (`GROUP_REMOVE_REQUESTED`), §3.5 (`addManualEntity` levanta la supresión), §8
  (payload y `EventPayloadMap`).
- `architecture/04_Event_System.md` §6, §10, §11.
- `core/Grouping_Engine.md` §6 (`applyGroupRemove`, `liftRemoval`), §7, §8, §13 casos 48-50, §14, §15
  (15s), "Matching" (dónde se consulta la supresión).
- `core/Orchestrator.md` §6 (`addManualEntity`), §13 caso 38, §14, §15 (29).
- `architecture/08_Security_Model.md` (un valor eliminado queda a la vista).
- `ui/Components.md` §3.5 y `ui/React_Client.md` §2.3 (`actions.removeGroup`).
