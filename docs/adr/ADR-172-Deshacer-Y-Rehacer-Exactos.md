<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,core/Orchestrator.md,ui/React_Client.md,ui/UX_Guidelines.md,ui/Components.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-172 — Deshacer y rehacer exactos

- **Estado**: Accepted
- **Fecha**: 2026-09-23
- **Decidido por**: El humano: *"al confirmar debe de aparecer el toast de confirmación con la
  posibilidad de deshacer. Lo mismo aplica con el hecho de poder hacer CTRL + Z o CTRL + Y"*. Ante el
  alcance: *"Toda edición de entidades"*.
- **Reemplaza**: `UX_Guidelines.md` §3.3b en lo que dice que fusionar, dividir, reclasificar y agregar
  a mano "siguen sin deshacer"; ADR-087 "Fuera del alcance de este ADR" ítem 6 ("Sin deshacer general"); el mecanismo de
  deshacer por snapshot de reglas de `Components.md` §3.11 y el de `undoableEdits.ts`, que pasan a ser
  casos del mecanismo general.
- **Relacionado con**: ADR-169 (toasts con "Deshacer"), ADR-171 (eliminar se deshace), ADR-038
  (re-análisis), ADR-061 §5 (literales manuales retenidos), ADR-044 (re-render por eventos de Grouping).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

### 1. Por qué hoy no se puede deshacer todo

`UX_Guidelines.md` §3.3b lo explica con precisión: el Core **no tiene una inversa exacta** de fusionar,
dividir, reclasificar ni agregar. Dividir lo que se fusionó devuelve un grupo con **otro `id` y otro
`indexInType`**; volver al tipo anterior renumera con `nextIndex` monótono, cambia el token, deja
`absorbedTypes` y `typeCorrections` tocados y apaga `personGenderUserSet`. Un "Deshacer" que devuelve
algo parecido y no lo mismo miente. Por eso se limitó el deshacer a lo que sí tenía inversa (reglas,
habilitado, valor escrito a mano), con snapshots armados a mano en la UI.

### 2. Lo que se pide ahora

Toda edición de entidades se deshace, con toast y con `Ctrl+Z` / `Ctrl+Y`. Para que sea **exacto**, la
inversa no puede construirse con operaciones: hay que **volver al estado anterior**. Ese estado vive
en el Core —sesión de Grouping con sus campos internos, más los literales manuales que retiene el
Orchestrator— y la UI no lo ve ni debe verlo.

## Decisión

### 1. Puntos de restauración que guarda el Core

```ts
// IPipelineOrchestrator (Contracts.md §3.5)
createEditCheckpoint(documentId: string): string;                       // sincrónico
restoreEditCheckpoint(documentId: string, checkpointId: string): Promise<void>;
discardEditCheckpoints(documentId: string): void;
```

- **`createEditCheckpoint`** guarda una copia del **estado de edición** del documento y devuelve un id
  opaco. El estado de edición es:
  - la sesión de Grouping completa: grupos **con sus campos internos** (`absorbedTypes`,
    `personGenderUserSet`, flags de `needsReview`…), registros de ocurrencias, reglas, conflictos,
    `typeCorrections` (ADR-085), `removedValues` (ADR-171) y los contadores de `nextIndex`;
  - los literales manuales retenidos por el Orchestrator (ADR-061 §5). Sin ellos, deshacer un
    agregado manual dejaría el literal retenido y el próximo re-análisis lo volvería a crear.
- **`restoreEditCheckpoint`** reemplaza ese estado por la copia y **emite la diferencia** con los
  eventos de siempre: `ENTITY_GROUP_REMOVED` por cada grupo que sobra, `ENTITY_GROUP_CREATED` por cada
  uno que falta, `ENTITY_GROUP_UPDATED` (con `changes` = las claves que difieren) por cada uno que
  cambió, y `CONFLICT_DETECTED`/`CONFLICT_RESOLVED` para los conflictos. Así la UI y el re-render del
  Orchestrator (ADR-044) reaccionan sin ningún camino nuevo. Los grupos vuelven con **el mismo `id`, el
  mismo `indexInType` y el mismo `replacementValue`**: eso es lo que hace exacto al deshacer.
- **`discardEditCheckpoints`** borra todos los del documento.
- **Copia estructural**: lo inmutable (`OccurrenceRef`, `BoundingBox`, `EntityGroup` públicos) se
  comparte entre copias; lo mutable se copia. Es la misma función de copia que usa `previewEdit`
  (ADR-170 §2).
- **Límite**: `MAX_EDIT_CHECKPOINTS = 50` por documento (`Contracts.md` §6). Al pasarse, se descarta el
  más viejo. Restaurar un id descartado o desconocido → `InvalidInputError`.
- **Se invalidan todos** (el Core los descarta solo) en `reanalyze` —restaurar a un estado anterior a
  una re-detección tiraría lo re-detectado— y en `closeDocument`/`dispose`.
- **Precondición**: documento con sesión de Grouping y **sin una pasada de detección en curso**
  (`stage ∉ {Importing, Extracting, OCRing, Detecting, Grouping}`); si no, `InvalidInputError`.
- **Delegación**: el Orchestrator coordina; el Grouping Engine implementa su parte con
  `createCheckpoint(documentId): string`, `restoreCheckpoint(documentId, id): Promise<void>` y
  `discardCheckpoints(documentId): void`, y el Orchestrator guarda los literales retenidos bajo el
  mismo id.

### 2. La pila de deshacer vive en la UI

`history.store` (nuevo, `React_Client.md` §3.6c):

```ts
interface HistoryEntry { readonly checkpointId: string; readonly label: string; }
interface HistorySlice {
  readonly past: ReadonlyArray<HistoryEntry>;     // lo que se puede deshacer
  readonly future: ReadonlyArray<HistoryEntry>;   // lo que se puede rehacer
  record(label: string): void;   // createEditCheckpoint ANTES de una edición; vacía future
  undo(): Promise<void>;
  redo(): Promise<void>;
  clear(): void;                 // + discardEditCheckpoints
}
```

- **Antes de cada edición**, la acción llama a `record(label)`: toma un punto del estado **previo**.
- **Deshacer**: toma un punto del estado **actual** (va a `future`), restaura el último de `past` y lo
  saca. **Rehacer**: lo simétrico. Una edición nueva después de deshacer vacía `future`.
- **Una acción del usuario = una entrada**, aunque emita varios pedidos: fusionar con tres (N pedidos
  de `mergePlan`), eliminar (borrar la regla de grupo + `GROUP_REMOVE_REQUESTED`, ADR-171 §5), un
  barrido de modo de tipo o documento (borrar reglas + crear la nueva).
- **Qué entra**: habilitar/deshabilitar (fila y cascada de tipo), el modo en sus tres niveles, el
  género, editar el valor de reemplazo, "Restaurar valor calculado", cambiar tipo, fusionar, dividir,
  eliminar, agregar una entidad (por cualquiera de las tres vías) y resolver un conflicto.
- **Qué no entra**: orden y filtro de la lista, zoom, vista, Configuración, exportar. No son ediciones
  del documento.
- **Se vacía** al cerrar el documento, al importar otro y al re-analizar (el Core ya los descartó).
- **Después de restaurar**, la UI rehidrata `rules.store` desde `grouping.getSnapshot(documentId).rules`
  (U-6): las reglas son el único estado que la UI origina y que los eventos de Grouping no le devuelven.

### 3. Atajos y toasts

- **`Ctrl/Cmd+Z`** deshace; **`Ctrl/Cmd+Y`** y **`Ctrl/Cmd+Shift+Z`** rehacen. Un solo listener en
  `WorkLayout`, activo solo en ②b. **No actúa** si el foco está en un `input`, `textarea` o
  `contenteditable` (ahí manda el deshacer nativo del campo), si hay un diálogo abierto, ni durante una
  pasada de detección o un export.
- **Toasts**: toda acción del menú ⋯ y todo agregado muestran un toast con **"Deshacer"** y la pista
  `Ctrl+Z` (ADR-169). El botón llama a `history.undo()` —el mismo camino que el atajo— y deshace **la
  última** edición. Para que esa sea siempre la que el toast nombra, **hay un solo toast de edición a
  la vez**: una edición nueva lo reemplaza, y deshacer o rehacer por atajo lo cierra.
- **La política de toasts de §3.4d no cambia**: el cambio de modo de una fila sigue sin toast (es la
  acción más frecuente y es autoevidente), pero **sí entra a la pila** y se deshace con `Ctrl+Z`. Los
  toasts existentes de los barridos, del habilitado y del valor editado pasan a usar la pila.

### 4. Lo que se retira

- El snapshot de reglas que cargaba el toast de §3.11 y la restitución grupo por grupo de
  `undoableEdits.ts`: los dos eran inversas armadas a mano para los casos que las tenían. La pila las
  reemplaza, y además es exacta en los casos que no la tenían.

## Consecuencias

**A favor**

- Todo se deshace **exacto**: mismo `id`, mismo número, mismo token, mismos campos internos. Es lo
  que §3.3b pedía para aceptar un "Deshacer" y no se podía dar.
- Un solo mecanismo para todo, en vez de un snapshot distinto por caso.

**En contra**

- **Memoria**: hasta 50 copias del estado de edición por documento. La copia estructural comparte lo
  inmutable, así que cada punto cuesta lo mutable de la sesión. Se mide en el Hito con el documento
  más grande del banco; si pesa, se baja el límite, que es una constante.
- **Deshacer no cruza un re-análisis**: cambiar los idiomas de OCR con un documento abierto vacía la
  pila. El diálogo de re-análisis ya advierte que el documento se vuelve a analizar; suma que "no se
  podrá deshacer lo anterior".
- Restaurar emite un evento por grupo que difiere. En una restauración grande (deshacer un barrido de
  documento sobre cientos de grupos) llegan cientos de `ENTITY_GROUP_UPDATED`; el flush coalescido del
  Orchestrator (ADR-044, caso 27) los junta en un render por página, como con los barridos de hoy.

**Lo que no toca**

- Los pedidos de edición existentes (`GROUP_*`, `RULE_*`): la pila los envuelve, no los reemplaza.
- Render y Export.

## Documentación que cambia

- `core/Contracts.md` §3.5 (tres métodos), §6 (`MAX_EDIT_CHECKPOINTS`).
- `core/Grouping_Engine.md` §6 (API), §13 casos 51-53, §14, §15 (15t).
- `core/Orchestrator.md` §6, §13 casos 39-40, §14, §15 (30).
- `ui/React_Client.md` §2.3 (acciones envueltas en `record`), §3.6c (`history.store`), §4.
- `ui/UX_Guidelines.md` §3.3b (reescrito: todo lleva deshacer).
- `ui/Components.md` §3.11 (reescrito sobre la pila).
- `adr/ADR-087` (nota: el ítem 6 de "Fuera del alcance de este ADR" queda cerrado por este ADR).
