<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Grouping_Engine.md,ui/Components.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-084-Ver-Ocurrencias-Escribe-En-El-Buscador.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-104 — La referencia lleva el valor que la UI muestra

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras usar el separador sobre una pericia real (`Post_Hito10.8_Pendientes.md` §27 punto 3).
- **Relacionado con**: ADR-074 §1 (`fragments`, el precedente exacto de "propagar explícitamente lo que la UI necesita"), ADR-084 §2 ("Ver ocurrencias")
- **Parte de**: Hito 11, UX de detección

## Contexto

### 1. El separador existe para deshacer una fusión, y no muestra qué se fusionó

`SplitDialog` lista los miembros del grupo así:

```
☐  Página 3 — NER
☐  Página 5 — NER
```

Nada más. Si el usuario fusionó dos entidades y después se arrepiente, **no tiene con qué distinguirlas** salvo recordar en qué página estaba cada una — y si cayeron en la misma página, ni eso.

Es circular: la herramienta para deshacer una fusión no muestra lo que se fusionó.

(`MergeDialog` **no** tiene este problema: lista **grupos** por su `canonicalValue`, no ocurrencias. Se verificó antes de escribir esto.)

### 2. No es un pedido nuevo: el repo ya lo tenía anotado

El docblock de `GroupContextMenu` dice, textual, por qué se recortó el catálogo de `ui/Components.md` §3.5:

> *"'Ver ocurrencias' depende de un campo `value` que `OccurrenceRef` no tiene, `03_Data_Model.md` §8"*

O sea que hay una función **ya diseñada y ya especificada** que quedó fuera exactamente por esto.

### 3. La razón por la que no estaba ya no aplica

`03_Data_Model.md` §8 dice: *"Referencia liviana a una `Occurrence`. **No duplica el `value` ni la `bbox` si no es necesario**"* — y a renglón seguido duplica `bbox` con la nota *"duplicado a propósito: la UI lo necesita sin resolver"*.

El criterio nunca fue "no duplicar": fue **duplicar lo que la UI necesita sin resolver**. `value` entró en esa categoría el día que hubo un diálogo que lo necesita.

No hay objeción de privacidad: el `EntityGroup` ya carga `canonicalValue` y `aliases`, que son contenido del documento. `value` por ocurrencia no abre una categoría nueva de exposición — son las mismas cadenas, atribuidas a su aparición.

## Decisión

### 1. `OccurrenceRef` gana `value`

```ts
export interface OccurrenceRef {
  readonly occurrenceId: string;
  readonly value: string;        // ADR-104
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly fragments?: ReadonlyArray<BoundingBox>;
  readonly source: DetectionSource;
}
```

**Requerido, no opcional.** Toda `Occurrence` tiene `value` —es su razón de ser— así que un opcional solo obligaría a cada consumidor a manejar un caso que no puede ocurrir.

Se copia tal cual en `toOccurrenceRef`, sin normalizar: lo que la UI tiene que mostrar es **cómo aparece en el documento**, que es justamente lo que distingue a dos miembros de un grupo fusionado.

### 2. Lo consume el separador, y desbloquea "Ver ocurrencias"

`SplitDialog` muestra el valor junto a la página. Con eso, "Ver ocurrencias" de `ui/Components.md` §3.5 deja de estar bloqueado — no se implementa acá, pero deja de faltarle la pieza que su propio docblock declara ausente.

### 3. Solo el valor; el contexto alrededor queda para después

Se evaluó mostrar además un fragmento de la frase (`…se cita a **Facundo** y a su…`), que desambigua mejor cuando el mismo valor aparece muchas veces.

**No entra ahora**, por dos razones: obliga a decidir cuánto contexto y quién lo arma (motor o UI), y el problema reportado —distinguir los miembros de un grupo fusionado— se resuelve con el valor solo. Si al usarlo queda corto, el contexto es un campo más sobre el mismo tipo.

## Consecuencias

**A favor**

- El separador deja de ser a ciegas.
- Se destraba una función ya especificada que estaba cortada por esta falta exacta.
- Sigue el precedente de ADR-074 §1: lo que la UI necesita se **propaga explícitamente**, no se deduce ni se re-resuelve.

**En contra**

- `EntityGroup` crece: una cadena por ocurrencia. Para un documento con muchas apariciones del mismo valor es texto repetido que ya vivía en el `Occurrence` original.
- Es un cambio de contrato público: toca `03_Data_Model.md` §8, `Contracts.md` y el `EntityGroupCreated`/`Updated` que cruza el bus.

**Lo que no cambia**

- La regla de `08_Security_Model.md` §10.2 sobre persistencia: **nada de esto se persiste**. Es un campo en memoria del mismo objeto que ya lleva `canonicalValue`.
