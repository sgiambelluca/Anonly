<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Grouping_Engine.md,core/Orchestrator.md,core/Export_Engine.md,ui/UX_Guidelines.md,ui/Components.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-085-Memoria-De-Reclasificacion-Por-Documento.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-176 — Un choque pendiente bloquea el export

- **Estado**: Accepted — **modificado por ADR-177** (§4: `liftRemoval` olvida todo registro no vivo del valor; §1: el motivo del export es un globo flotante anclado a la derecha, no una ranura con alto reservado)
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante la revisión 3 del Hito 12.5 (REJECTED). Sobre quién bloquea el export
  con un choque sin resolver, eligió **"UI y Core"**. Lo demás de este ADR son consecuencias técnicas de
  ADR-175 que el revisor encontró sin especificar.
- **Modifica**: ADR-175 §3 (cómo se calcula el resultado de un agregado) y §2 (alcance de `liftRemoval`).
- **Relacionado con**: ADR-174, ADR-175, ADR-117 (contención), ADR-085 (memoria de reclasificación),
  ADR-032 §3 (el patrón de `EXPORT_NO_ENABLED_GROUPS`).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

La revisión 3 encontró tres huecos:

1. **Nada bloquea el export.** `03_Data_Model.md` §15, ADR-174 §3 y `Components.md` §6.3 dicen que un
   conflicto sin resolver bloquea el export, y el aviso de la UI lo afirma. Pero ni `runExport` ni
   `ExportDialog` miran los conflictos. Hasta esta branch los conflictos nacían resueltos, así que la
   promesa nunca se había puesto a prueba. Ningún doc decía quién bloquea.
2. **Fusionar o dividir la detección deja el choque inalcanzable.** `applyGroupMerge` no reapunta
   `conflict.groupId`: el choque queda pendiente sobre un grupo que ya no existe, sin fila que muestre ⚠,
   sin aviso, y si después se elimina el grupo destino, el "se oculta sola" de ADR-175 §1 no se dispara.
   Dividir tiene el mismo problema cuando la detección que choca pasa al grupo nuevo.
3. **Un agregado contenido rompe el invariante de ADR-175 §3.** Una ocurrencia contenida en otra del mismo
   tipo no se registra (ADR-117): no hay dedup ni retención ni grupo nuevo, así que el Orchestrator no la
   encuentra por ninguno de sus dos criterios y la UI muestra "No se pudo agregar", aunque el texto ya está
   oculto. Es el caso que motivó ADR-117: un apellido dentro de nombres completos ya detectados. El fondo
   del problema es que el Orchestrator **reconstruye** desde afuera lo que Grouping decidió, y cada regla
   de Grouping que no copia —contención, reclasificación, dedup— es un agujero nuevo.

## Decisión

### 1. Un conflicto sin resolver bloquea el export, en la UI y en el Core

**UI** (lo que ve el usuario):

- `ExportButton` queda **deshabilitado** mientras haya un conflicto sin resolver.
- El motivo se muestra en una **ranura fija** debajo del botón (UX-10): *"Hay un choque sin resolver.
  Resolvelo para exportar."* con **"Resolver"**, que hace lo mismo que el "Resolver" del aviso
  (ADR-175 §5).
- Si el conflicto pendiente no es `heldManual` (hoy no existe ese caso), el texto es *"Hay un conflicto sin
  resolver."* y "Resolver" abre el `ConflictDialog` de la primera fila que tenga uno.
- `Cmd/Ctrl+E` tampoco abre el diálogo mientras esté bloqueado.
- La regla es una función pura con test (ADR-056): `exportBlockReason(conflicts)` → `null` | motivo.

**Core** (la red de seguridad):

- `runExport` mira `snapshot.conflicts` **antes** de cambiar de etapa. Si hay alguno sin resolver:
  - no llama a `export()` y no cambia de etapa;
  - el pipeline sigue en `Ready`;
  - loguea `warn` con `code: EXPORT_UNRESOLVED_CONFLICTS` en la metadata y la cantidad, sin valores
    (R-8, `08_Security_Model.md`).
- Es el mismo patrón de `EXPORT_NO_ENABLED_GROUPS` (ADR-032 §3): un código que viaja en la metadata del
  log, sin clase de error y sin evento. No emite `EXPORT_FAILED`, que es un evento del Export Engine y
  llevaría a `PIPELINE_FAILED`.
- Desde la UI no se llega a este camino, porque el botón está deshabilitado. El guard existe para
  cualquier otro llamador.

`03_Data_Model.md` §15 decía "hasta ser resuelto o **ignorado explícitamente**". No hay ningún mecanismo
para ignorar un conflicto, así que esa parte se retira.

### 2. El choque sigue a la detección cuando se fusiona o se divide

- **Fusión**: todo conflicto **sin resolver** con `groupId === source` pasa a `groupId === target`.
- **División**: un conflicto `heldManual` sin resolver del grupo dividido pasa al grupo, original o
  nuevo, que se queda con el member que se superpone a la ocurrencia retenida. La superposición se mide
  con el mismo criterio con el que nació el conflicto (sobre los fragmentos, ADR-107).
- Reclasificar no cambia el `groupId` y no necesita nada.
- El caso 61 de Grouping (el invariante) **incluye** fusión y división. El invariante suma una cláusula:
  todo conflicto sin resolver apunta a un grupo que existe.

### 3. Grouping dice en qué terminó cada ocurrencia manual

Reemplaza el cálculo de ADR-175 §3, incluida su errata. `GroupingEngine` gana un método de clase, que
llama solo el façade, igual que `liftRemoval`:

```ts
/** ADR-176 §3: qué pasó con cada ocurrencia manual procesada desde el último reopenSession. */
manualOutcome(documentId: string, occurrenceIds: ReadonlyArray<string>): {
  readonly groupIds: ReadonlyArray<string>;
  readonly heldConflictIds: ReadonlyArray<string>;
};
```

**Qué registra.** Desde cada `reopenSession`, Grouping anota por cada ocurrencia `source: Manual` que
procesa **el registro que la absorbió**, y lo resuelve al leerlo:

| Qué le pasó a la ocurrencia | Qué se anota |
|---|---|
| Se agrupó | su propio registro |
| El dedup la descartó | el registro que ya estaba |
| El dedup la descartó contra una retenida pendiente (re-agregar mientras el choque sigue abierto) | el id de ese conflicto |
| Quedó contenida (ADR-117) | el registro que la contiene |
| Quedó retenida (ADR-174) | el id del conflicto |
| Suprimida (ADR-171) | nada |

`manualOutcome` devuelve:
- los grupos **actuales** de esos registros, sin repetir;
- los conflictos que siguen sin resolver con `heldManual`.

Sesión inexistente → listas vacías y `warn`. La anotación vive en la sesión, se vacía en cada
`reopenSession` y en `closeSession`, no sale en el snapshot y no entra en los puntos de restauración:
dura lo que dura un agregado.

**Cómo lo usa el Orchestrator.** `addManualEntity` junta el `id` de cada ocurrencia `Manual` que
`findLiteral` emite (ADR-175 §3) y, después de `finishSession`, llama a `grouping.manualOutcome`. El
resultado va tal cual a `ManualEntityResult.heldConflictIds` y `ManualEntityResult.groupIds`. **No se
compara ningún valor en el façade.**

El invariante de `Contracts.md` §3.5 (`occurrenceCount > 0` ⇒ alguna lista no vacía) pasa a cumplirse por
construcción: toda ocurrencia emitida termina agrupada, deduplicada, contenida o retenida. La supresión
por eliminación no la alcanza, porque `addManualEntity` la levanta antes.

### 4. `liftRemoval` olvida toda supresión de ese valor

Hace lo que ya hacía el código. `liftRemoval(documentId, value)` quita el valor de `removedValues` **y**
olvida toda identidad suprimida con ese valor normalizado:
- las que dejó una eliminación (ADR-171 §2, paso 5);
- las que dejó un `winner: "detected"` (ADR-175 §2).

Sin la primera, una ocurrencia manual en la misma posición que la eliminada se descartaría por dedup, y
ADR-171 §4 ("la ocurrencia manual que sigue se agrupa normal") no se cumpliría.

### 5. Historia en rojo

Los commits de contrato de esta branch dejaron el typecheck en rojo hasta el commit del façade (N-1, que
se repitió dos veces). Se acepta, y no se reescribe la historia. Desde este ADR, el commit de contrato
incluye en el mismo commit el **relleno mínimo** del façade que lo hace compilar, si hace falta. Es la
excepción de contrato de CLAUDE.md, que ya permite tocar dos módulos en ese commit.

## Consecuencias

- La promesa "no podés exportar sin decidir" pasa a ser cierta, y con dos cerrojos.
- El resultado de un agregado lo decide quien agrupa, no quien lo mira desde afuera: se acaban los
  criterios paralelos de valor y tipo.
- `GroupingEngine` gana un método y `EngineErrorCode` un valor: cambio de contrato, compatible.

## Documentación que cambia

- `core/Contracts.md`: `EngineErrorCode.EXPORT_UNRESOLVED_CONFLICTS`; el comentario de
  `ManualEntityResult`.
- `architecture/03_Data_Model.md` §15: el bloqueo del export y el invariante de `groupId`.
- `core/Grouping_Engine.md`:
  - §6: `manualOutcome`, la fusión, la división y `liftRemoval`;
  - §13: casos 61 (ampliado), 63 y 64;
  - §14;
  - §15: 15x.
- `core/Orchestrator.md`:
  - §6: `addManualEntity` y `runExport`;
  - §13: casos 45 y 46;
  - §14;
  - §15: 33.
- `ui/UX_Guidelines.md` §8.1 y §8.4; `ui/Components.md` §2.5.
