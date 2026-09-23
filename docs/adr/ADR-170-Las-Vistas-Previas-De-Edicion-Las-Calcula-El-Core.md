<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Grouping_Engine.md,core/Orchestrator.md,ui/Components.md,ui/React_Client.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-072-El-Valor-Sintetico-Identifica-Al-Grupo-No-A-Su-Numero.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-170 — Las vistas previas de edición las calcula el Core

- **Estado**: Accepted
- **Fecha**: 2026-09-23
- **Decidido por**: El humano, entre calcular las vistas previas en el Core (cambio de contrato) o
  dejarlas esquemáticas en la UI: *"Que el Core los calcule"*.
- **Reemplaza**: la nota de `Components.md` §3.4 (y de ADR-087) según la cual "el único valor exacto
  que la UI puede mostrar es el del modo vigente".
- **Relacionado con**: ADR-169 §6 y §10 (los consumidores), ADR-057 (escalera del `placeholder`),
  ADR-072 (semilla del sintetizador), ADR-076 (edición manual), ADR-082 (reclasificar), P-1/U-3.
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

### 1. La UI necesita valores que solo sabe calcular el Grouping Engine

El rediseño de la pantalla de trabajo (ADR-169) muestra resultados **antes** de aplicarlos:

| Dónde | Qué muestra | De dónde sale hoy |
|---|---|---|
| Selector de modo (ADR-169 §6) | el valor exacto de los 4 modos para esa entidad | solo el vigente (`replacementValue`); los otros tres, esquemáticos |
| Editar reemplazo (§10) | los niveles cortos de la escalera (`[HOMB 04]`, `[HOM-04]`) | ningún lado |
| Cambiar tipo (§10) | el token con el tipo nuevo (`[ORGANIZACION 03]`) | ningún lado |
| Fusionar (§10) | nombre, N.º, apariciones y token del resultado | ningún lado |
| Dividir (§10) | el N.º de la entidad nueva | ningún lado |

Todo eso sale de lógica de `grouping-engine`: la escalera y los labels de ADR-057, el género de
ADR-060, `MASK_FORMAT_BY_TYPE` y la resolución por grupo de ADR-029, el sintetizador sembrado con el
`id` (ADR-072), `nextIndex` monótono por tipo, el `canonicalValue` por frecuencia de una fusión. La
UI no puede importar el motor (P-1) y no debe reimplementar su lógica (`React_Client.md` U-3): un
ejemplo *casi* correcto es peor que ninguno, y ya pasó (`[PERSONA 01]` para todos los tipos).

### 2. Dos formas distintas de pregunta

- **Por modo, sobre el grupo tal como está**: se pide en cada fila y en cada render del selector. Es
  barato (cuatro llamadas a funciones que el motor ya tiene) y cambia cuando el grupo cambia.
- **Por operación hipotética** (fusionar con estos, dividir estas, pasar a este tipo): se pide
  mientras un diálogo está abierto, sobre una operación que todavía no ocurrió.

La primera encaja como dato del grupo; la segunda, como consulta.

## Decisión

### 1. `EntityGroup` gana `replacementPreviews`

```ts
/** ADR-170 §1: lo que valdría `replacementValue` si el grupo pasara a cada modo. */
export interface ReplacementPreviews {
  readonly placeholder: string;
  readonly mask: string;
  readonly synthetic: string;
  /**
   * Los niveles distintos de la escalera de ADR-057 para este grupo, del más
   * largo al más corto (`[HOMBRE 04]`, `[HOMB 04]`, `[HOM-04]`), sin repetidos.
   * `placeholder` es uno de ellos: el que la escalera elige hoy.
   */
  readonly placeholderLadder: ReadonlyArray<string>;
}

export interface EntityGroup {
  // ...campos existentes...
  readonly replacementPreviews: ReplacementPreviews;   // ADR-170 §1
}
```

- **`redact` no tiene vista previa**: su valor es siempre `""` y la UI dibuja el bloque.
- **Semántica exacta**: cada campo es **exactamente** lo que `computeReplacementValue` produciría con
  ese modo sobre el grupo en su estado actual (tipo, índice, género, members, escalera). **Ignora
  `replacementValueUserSet`**, y eso es correcto: por ADR-076 §3, cambiar el modo efectivo recalcula el
  valor y apaga el flag, así que "lo que valdría en ese modo" es siempre el valor calculado.
- **Invariante**: si `replacementMode ∈ {placeholder, mask, synthetic}` y
  `replacementValueUserSet === false`, entonces `replacementPreviews[replacementMode] ===
  replacementValue`. Tiene test.
- **Se recalcula** en los mismos puntos donde se recalcula `replacementValue` (los once de ADR-076
  §4), **más** los que cambian un modo que no es el vigente (índice, tipo, género, members, escalera).
  En la práctica: cada vez que el motor emite `ENTITY_GROUP_CREATED` o `ENTITY_GROUP_UPDATED`, el
  grupo sale con sus vistas previas al día. `EntityGroupUpdated.changes` incluye
  `"replacementPreviews"` cuando cambiaron.
- **Costo**: tres llamadas por grupo emitido a funciones puras que el motor ya ejecuta; el
  sintetizador es determinista y no hace I/O. No cambia la complejidad de ningún camino.
- **No viaja al PDF**: Render y Export siguen leyendo solo `replacementMode` y `replacementValue`.

### 2. Consulta de operaciones hipotéticas: `previewEdit`

```ts
export type EditPreviewRequest =
  | { readonly kind: "type"; readonly groupId: string; readonly type: EntityType }
  | { readonly kind: "merge"; readonly sourceGroupId: string; readonly targetGroupIds: ReadonlyArray<string> }
  | { readonly kind: "split"; readonly groupId: string; readonly occurrenceIds: ReadonlyArray<string> };

export interface EditPreviewGroup {
  /** `null` = el grupo que la operación crearía (la parte nueva de un split). */
  readonly groupId: string | null;
  readonly type: EntityType;
  readonly indexInType: number;
  readonly canonicalValue: string;
  readonly memberCount: number;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;
}

export interface EditPreview {
  /** Cómo quedarían los grupos que la operación toca (el sobreviviente, el nuevo…). */
  readonly groups: ReadonlyArray<EditPreviewGroup>;
}

// IPipelineOrchestrator (Contracts.md §3.5)
previewEdit(documentId: string, request: EditPreviewRequest): EditPreview;
// GroupingEngine (Grouping_Engine.md §6)
previewEdit(documentId: string, request: EditPreviewRequest): EditPreview;
```

- **Es un simulacro, no una fórmula aparte**: el Grouping Engine aplica la **misma** operación que
  aplicaría el pedido real (`applyGroupUpdate` con `patch.type`, `applyGroupMerge`, `applyGroupSplit`)
  sobre una **copia descartable** de la sesión, sin emitir eventos, y devuelve los grupos resultantes.
  Así la vista previa no puede discrepar del resultado: es el mismo código.
- **Orden de una fusión múltiple**: igual al que la UI emite hoy (`mergePlan`, `Components.md` §3.6):
  primero `source → targetGroupIds[0]`, después cada `targetGroupIds[i] → targetGroupIds[0]`. El
  sobreviviente conserva el `id` de `targetGroupIds[0]` y el **menor** `indexInType` de todos. La UI
  pone primero al elegido de menor `indexInType`, para que el `id` que sobrevive sea el del número que
  queda.
- **Qué devuelve cada tipo**:
  - `type`: un grupo, el reclasificado (con su `indexInType` nuevo = `nextIndex` del tipo destino, su
    token con el label nuevo y su modo re-resuelto contra las reglas, ADR-082 §2).
  - `merge`: un grupo, el que sobrevive (`indexInType` menor, `canonicalValue` por frecuencia,
    `memberCount` sumado, su modo y su valor).
  - `split`: dos grupos, el original con lo que le queda y el nuevo (`groupId: null`, `indexInType =
    nextIndex(type)`, modo heredado — `Grouping_Engine.md` §13 caso 6).
- **Solo lectura**: no muta la sesión, no emite, no reabre nada. Test: el snapshot es idéntico antes y
  después (mismo patrón que `findText`, ADR-061 §8 errata).
- **Sincrónico**, como `findText`: la UI lo llama al cambiar la selección de un diálogo.
- **Errores**: los mismos que el pedido real rechazaría — grupo inexistente, fusionar tipos distintos,
  dividir todas las ocurrencias, `occurrenceId` ajeno — lanzan `InvalidInputError`. Documento sin
  sesión → `InvalidInputError`. La UI valida antes de pedir (`validateMultiMerge`, `validateSplit`), así
  que en uso normal no ocurre.
- **Lo que no promete**: los números pueden cambiar después si una re-detección o un agregado manual
  dispara la renumeración canónica de `finishSession` (ADR-028). Es la misma salvedad que ya tiene
  `indexInType` (`UX_Guidelines.md` §5.4b); la vista previa describe el resultado **inmediato**.

## Consecuencias

**A favor**

- El selector de modo y los cuatro diálogos muestran valores exactos, y no pueden discrepar del
  resultado porque salen del mismo código.
- La UI sigue sin importar motores ni reimplementar reglas.

**En contra**

- `EntityGroup` crece un campo **requerido**: todo fixture de test que construye un `EntityGroup` a
  mano (UI y Core) tiene que agregarlo. Es mecánico.
- Copiar la sesión para cada `previewEdit` cuesta memoria proporcional a la sesión. Con los tamaños
  medidos (cientos de grupos) es despreciable, y se llama por interacción, no por frame. Si algún día
  pesa, la copia puede limitarse a los grupos tocados; el contrato no cambia.

**Lo que no toca**

- Render, Export y los PDFs: siguen leyendo `replacementValue`.
- Los eventos: no hay eventos nuevos. `previewEdit` es una consulta.

## Documentación que cambia

- `core/Contracts.md` §3.5 (`previewEdit` y sus tipos), §5 (`ReplacementPreviews`).
- `architecture/03_Data_Model.md` §9 (`EntityGroup.replacementPreviews`, atributo e invariante).
- `core/Grouping_Engine.md` §6 (API), "`replacementValue` por modo" (vistas previas), §13 casos 46-47,
  §14, §15 (15r).
- `core/Orchestrator.md` §6 (delegación), §14, §15 (28).
- `ui/React_Client.md` §4 (la consulta en el adapter).
