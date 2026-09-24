<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,core/Grouping_Engine.md,core/Orchestrator.md,ui/UX_Guidelines.md,ui/Components.md,ui/React_Client.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-083-El-Panel-De-Conflicto-Elige-Tipo-No-Modo.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-174 — Un agregado manual que choca con una detección se resuelve en el momento

- **Estado**: Accepted
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante el hallazgo B-3 del revisor del Hito 12.5: *"El mensaje de aviso tiene
  que estar sí o sí, no puede haber un error el cual el usuario se lo pase por encima [...] ¿No podríamos
  hacer que aparezca un pop up de elección para avisarle al usuario que hay un conflicto y que lo resuelva
  desde ahí?"*. Aprobó la propuesta de este ADR.
- **Relacionado con**: ADR-061 (agregado manual), ADR-083 (resolver un conflicto elige el tipo), ADR-169 §7
  (toasts de alta), ADR-172 (deshacer).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

Cuando una ocurrencia se superpone con otra de **otro tipo**, Grouping crea un conflicto (`Overlap` o
`Disagree`) y decide quién gana: mayor `confidence`, y en empate, `Regex` (`conflictWinnerIsNew`,
`Grouping_Engine.md` §13 casos 7-8). Si gana la nueva, se agrupa; si pierde, **se descarta**.

Un agregado manual emite ocurrencias con `source: Manual` y `confidence: 1.0`. Contra una detección de
Regex (también 1.0) **pierde siempre**. El revisor lo reprodujo: el usuario marca «email
juan.perez@example.com.», el detector ya tenía «juan.perez@example.com» como Email, la selección se
descarta en silencio, y aun así la UI muestra *"Agregaste «X» · 1 aparición oculta"* porque
`occurrenceCount` cuenta apariciones **antes** de agrupar. El toast miente, y la parte de la selección
que no se superpone puede quedar **a la vista** en el PDF exportado.

El diálogo de conflictos que existe (ADR-083) no alcanza: solo elige el **tipo** de un grupo ya formado,
y acá lo que el usuario agregó ya no está en ningún grupo.

## Decisión

### 1. La ocurrencia manual que pierde queda retenida, no descartada

Si una ocurrencia `source: Manual` pierde un conflicto de superposición, Grouping registra su identidad
(para el dedup, ADR-038 §3) y la **retiene** adjunta a ese conflicto, sin agruparla. El conflicto se
marca con un campo público nuevo:

```ts
export interface Conflict {
  // ...campos existentes...
  /** ADR-174 §1: hay una ocurrencia manual retenida esperando que el usuario decida. */
  readonly heldManual?: true;
}
```

Las ocurrencias manuales que **ganan** (contra una detección de menor `confidence`) se agrupan como hoy,
sin retención.

### 2. `addManualEntity` informa los choques

```ts
export interface ManualEntityResult {
  readonly occurrenceCount: number;
  /** ADR-174 §2: conflictos sin resolver con `heldManual` que dejó este agregado. [] = ninguno. */
  readonly heldConflictIds: ReadonlyArray<string>;
}
```

El Orchestrator los obtiene del snapshot de Grouping después de `finishSession`: los conflictos no resueltos
con `heldManual` cuyo candidato `Manual` tiene el valor agregado.

### 3. Resolver elige quién gana

```ts
export interface ConflictResolveRequested {
  readonly documentId: string;
  readonly conflictId: string;
  readonly entityType?: EntityType;          // ADR-083, sin cambios
  /** ADR-174 §3: solo en conflictos con `heldManual`. */
  readonly winner?: "manual" | "detected";
}
```

- `winner: "manual"` — la ocurrencia retenida se agrupa **por el mismo camino que si hubiera ganado**
  (`groupOccurrence`: se une a un grupo de su valor y tipo, o crea uno). La detección que ya estaba **no
  se toca**, igual que cuando una ocurrencia nueva gana hoy. El conflicto queda `resolved` con
  `resolvedType` = el tipo del candidato manual.
- `winner: "detected"` — la ocurrencia retenida se descarta (su identidad sigue registrada, así una
  re-aplicación del literal tras un re-análisis no vuelve a crear el conflicto). `resolved` con
  `resolvedType` = el tipo detectado.
- `winner` en un conflicto sin `heldManual` → `GroupingInvalidPatchError`, rechazado con `warn`.
- Sin `winner`, un conflicto con `heldManual` se resuelve como `"detected"` (el comportamiento de hoy),
  para que `CONFLICT_RESOLVE_REQUESTED` sin el campo siga siendo compatible.
- Un conflicto con `heldManual` sin resolver **bloquea el export** como cualquier conflicto
  (`03_Data_Model.md` §15).

### 4. La UI obliga a decidir, sin trabar

- Si `heldConflictIds` no está vacío, **no** se muestra el toast de éxito. Se abre `ManualOverlapDialog`:
  *"Lo que marcaste se superpone con un dato ya detectado. ¿Qué querés ocultar?"*, con los dos textos
  resaltados y sus tipos, y dos botones:
  1. **"Ocultar lo que marqué"** → `winner: "manual"`.
  2. **"Dejar lo que ya estaba detectado"** → `winner: "detected"`.
- Si el usuario cierra el diálogo sin elegir, queda un toast de advertencia persistente hasta que lo
  resuelve: *"Quedó un choque sin resolver en «X». El export está bloqueado hasta que elijas."* con
  **"Resolver"** (reabre el diálogo). El aviso de conflicto de la fila abre el mismo diálogo.
- **Deshacer** (ADR-172): el agregado es una entrada de la pila; la resolución, otra.
- Si el agregado no encontró nada o no cambió nada (`not-found` / `no-op`), la entrada de deshacer que
  se registró antes de agregar **se retira** (hallazgo N-3 del revisor).

## Consecuencias

- El toast de alta deja de poder afirmar algo falso: solo aparece cuando la ocurrencia quedó agrupada.
- El usuario decide en el momento, en un diálogo que dice exactamente qué pasó, y no puede exportar
  sin decidir.
- `Conflict` y `ManualEntityResult` ganan un campo cada uno, y `ConflictResolveRequested` uno opcional:
  cambio de contrato, compatible hacia atrás.

## Documentación que cambia

- `core/Contracts.md` §3.5 (`ManualEntityResult.heldConflictIds`), §8 (`ConflictResolveRequested.winner`).
- `architecture/03_Data_Model.md` §15 (`Conflict.heldManual`).
- `architecture/04_Event_System.md` §10 (`CONFLICT_RESOLVE_REQUESTED`).
- `core/Grouping_Engine.md` §8, §13 casos 56-58, §14, §15 (15v).
- `core/Orchestrator.md` §6 (`addManualEntity`), §13 caso 41, §14, §15 (31).
- `ui/UX_Guidelines.md` §5.4b y §6; `ui/Components.md` §3.4c y §6.3 (`ManualOverlapDialog`);
  `ui/React_Client.md` §2.3.
