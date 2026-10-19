<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-224 — Lo que la 1.1 cambia en el panel de entidades y el visor

- **Estado**: Aceptado por el mantenedor el 2026-10-19. Define **qué hace**
  cada cambio, no cómo se ve. El diseño lo hace el mantenedor más adelante, y cada pantalla
  tendrá su ADR de interfaz, como ADR-168 y ADR-169.
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor, a propuesta del planificador.
- **Origen**: `Roadmap_1.x.md` §4 y [`Plan_1.1.md`](../roadmap/Plan_1.1.md).
- **Alcance**: contrato (`EntityGroup.formatId`), `grouping-engine` y
  `react-client`.
- **Relacionado con**:
  - ADR-061: la lupa del visor;
  - ADR-082: reclasificar;
  - ADR-172: deshacer y rehacer;
  - ADR-219 y ADR-222.

## Contexto

`Roadmap_1.x.md` §4 lista, además de los formatos y los tipos propios, tres
cambios de interfaz:

- filtros y búsqueda con regex en el árbol de entidades;
- ayuda de atajos de teclado;
- tooltips enriquecidos en el visor.

El 2026-10-13 el mantenedor conservó su alcance y dejó su comportamiento
para después.

**Lo que decidió el mantenedor el 2026-10-19:**

- la lupa del visor y el buscador del panel de entidades **no cambian**. La
  búsqueda con regex sale de la 1.1: choca con que el usuario no escribe
  regex (ADR-220) y con que nada de lo que escriba pueda colgar la
  aplicación;
- el panel suma **cuatro filtros**: por formato, por modo de reemplazo,
  desactivadas o con conflicto, y agregadas o editadas a mano. Tienen que
  ser discretos, y el cómo lo define el diseño;
- lo que sale de un formato aparece bajo su tipo, en un subnivel por
  formato. Lo que detecta el modelo y lo agregado a mano va directo bajo su
  tipo, sin subnivel;
- numeración y modo, por tipo;
- sin objeción a la propuesta del planificador: el tooltip suma el nombre
  del formato, y la ayuda lista los atajos que ya existen, sin agregar
  nuevos.

## Decisión

### 1. La búsqueda con regex sale de la 1.1

- El buscador del panel (`Cmd/Ctrl+F`) sigue buscando texto literal.
- La lupa del visor sigue siendo la búsqueda de ADR-061 §8.
- La búsqueda con regex sale del roadmap. No queda como idea pendiente.

### 2. El subnivel por formato

```ts
// 03_Data_Model.md §9, Contracts.md
export interface EntityGroup {
  // ...campos actuales
  readonly formatId?: string;   // nuevo; ausente = el grupo va directo bajo su tipo
}
```

**Quién lo calcula.** Lo calcula `grouping-engine`, para que la interfaz no
reimplemente la regla (U-3). Es el `formatId` del primer miembro, en orden
documental (ADR-028), que salió de un formato **del tipo actual del grupo**.

**Cuándo queda ausente:**

- en un grupo que solo tiene apariciones del modelo o agregadas a mano;
- en un grupo reclasificado a otro tipo (ADR-082), cuyo formato no
  corresponde al tipo nuevo.

**En el árbol:**

- los grupos con `formatId` van bajo su tipo, agrupados por el nombre del
  formato;
- los que no lo tienen van directo bajo el tipo;
- si un tipo con resultados de un solo formato muestra igual el subnivel lo
  decide el diseño.

### 3. Los filtros

| Filtro | Qué muestra | De dónde sale |
|---|---|---|
| Formato | Los grupos de uno o varios formatos | `EntityGroup.formatId` |
| Modo de reemplazo | Etiqueta, máscara, sintético o censura total | `replacementMode` |
| Desactivadas o con conflicto | Las desactivadas, que salen a la vista en el export, y las que tuvieron un conflicto, **resuelto o no** | `enabled` y los conflictos del grupo |
| Agregadas o editadas a mano | Las que tienen un miembro agregado a mano, o un reemplazo escrito por el usuario | `source: Manual` en `members` y `replacementValueUserSet` |

- **Los conflictos resueltos entran en el filtro** porque los de detección
  nacen resueltos (ADR-222 §3). Sin ellos, el filtro no mostraría
  justamente lo que conviene revisar antes de exportar.
- **Cómo se combinan:** dentro de un mismo filtro suma cualquiera de las
  opciones; entre filtros distintos, el grupo tiene que cumplir todos.
- Se combinan con el buscador de texto de la misma forma.
- **Duran lo que dura el documento.** No se guardan.
- **Son de la interfaz.** Leen campos que el Core ya publica, salvo
  `formatId`, que es nuevo (§2).

### 4. El tooltip del visor

Sobre una entidad, en cualquiera de las dos vistas, muestra:

- el valor original;
- el tipo, con el nombre del tipo propio si lo es;
- el modo de reemplazo;
- la cantidad de apariciones (`members.length`);
- el nombre del formato, si el grupo tiene `formatId`.

Mostrar el valor original sobre la vista anonimizada no expone nada nuevo:
el árbol ya lo muestra, y todo es local. Cómo se activa (pasar el mouse,
el foco) y cómo se ve lo decide el diseño.

### 5. La ayuda de atajos

- **Lista los atajos que ya existen.** Son los de la tabla de
  `UX_Guidelines.md` §9, más deshacer y rehacer de ADR-172
  (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Y` y `Cmd/Ctrl+Shift+Z`), que hoy faltan en esa
  tabla.
- **La 1.1 no suma atajos nuevos.**
- **Una sola tabla.** La lista que muestra la ayuda sale de la misma tabla
  que declaran los atajos, para que no puedan contradecirse.
- Cómo se abre la ayuda lo decide el diseño.

### 6. «Custom» deja de ofrecerse

Los selectores de tipo, al agregar a mano, al reclasificar y en el panel de
conflicto, dejan de ofrecer «Custom». En su lugar ofrecen:

- los tipos propios guardados;
- los tipos del documento;
- «Nuevo tipo», que crea un tipo del documento (ADR-219 §5).

## Lo que no cambia

- La lupa, el buscador del panel y el orden del árbol (aparición o A–Z).
- La navegación del árbol por teclado.

## Consecuencias

- Un campo nuevo en `EntityGroup`, calculado por el Core.
- La interfaz tiene un comportamiento definido para que el diseño lo
  resuelva sin decidir reglas de producto.
- La tabla de atajos de `UX_Guidelines.md` §9 se completa con deshacer y
  rehacer.

## Cómo se verifica

- `formatId`:
  - queda presente en un grupo detectado por un formato;
  - queda ausente en uno del modelo y en uno agregado a mano;
  - se borra al reclasificar el grupo a otro tipo.
- Cada filtro, solo y combinado con otro y con el buscador, muestra
  exactamente los grupos de la tabla de §3.
- El filtro de conflicto incluye un conflicto de detección que nació
  resuelto.
- Ninguna fila de la ayuda de atajos falta en la tabla de los atajos, y
  ninguna sobra.
- Los selectores de tipo no ofrecen «Custom» y sí «Nuevo tipo».
