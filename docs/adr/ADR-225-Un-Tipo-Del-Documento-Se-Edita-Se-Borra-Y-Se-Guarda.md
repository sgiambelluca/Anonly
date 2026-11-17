<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,core/Orchestrator.md,ui/React_Client.md,ui/Components.md,architecture/08_Security_Model.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-085-Memoria-De-Reclasificacion-Por-Documento.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-225 — Un tipo del documento se edita, se borra, se guarda y entra al deshacer

- **Estado**: Aceptado por el mantenedor el 2026-11-16. Las decisiones de producto son del
  mantenedor (2026-10-20, 2026-11-15 y 2026-11-16, sobre el lienzo «Anonly 1.1
  — UI final»). Los detalles técnicos de §3 a §6 son del planificador;
  el mantenedor los aceptó ese día.
- **Fecha**: 2026-11-16.
- **Decidido por**: el mantenedor, a propuesta del planificador en lo técnico.
- **Origen**: el diseño de la interfaz de la 1.1 (`Plan_1.1.md` §6, frente F7).
- **Alcance**: contrato (`IPipelineOrchestrator`, `Contracts.md` §3.5),
  `grouping-engine`, façade y `react-client`. Sin eventos nuevos, sin tipos
  públicos nuevos y sin dependencias nuevas.
- **Modifica**: ADR-219 §5 (un tipo del documento sin grupos sí se ve; el
  deshacer sí lo alcanza; se puede pasar a guardado) y `Plan_1.1.md` §4 punto 4
  y §8.
- **Extiende**: ADR-172 §1 (el punto de restauración incluye las definiciones
  de tipo) y ADR-171 (borrar un tipo elimina sus entidades con las mismas
  reglas).
- **Relacionado con**: ADR-223 §3 (qué se guarda en el equipo), ADR-125 §2
  (cuándo se recrea el Core) y ADR-224 §6 (los selectores de tipo).

## Contexto

### 1. Lo que ADR-219 §5 dejó fijo

Un tipo del documento se crea con `defineDocumentEntityType` y nada más:

- no se puede renombrar ni borrar;
- sin grupos, «no tiene efecto visible»;
- un deshacer no lo borra;
- no se puede pasar a guardado en la 1.1.

Alcanzaba mientras el tipo nacía de paso, al reclasificar o agregar una
entidad con «Nuevo tipo».

### 2. Lo que cambió al diseñar la interfaz

El mantenedor pidió una entrada directa para crear un tipo con el PDF
abierto: la banda «Nuevo tipo» arriba de la lista de entidades. Con eso el
tipo pasa a ser algo que el usuario crea a propósito, y aparecieron cuatro
necesidades que el contrato no cubre:

- **verlo aunque esté vacío**, porque el usuario lo creó a mano;
- **corregirle el nombre y las abreviaturas**: un nombre mal escrito hoy
  queda hasta cerrar el documento;
- **borrarlo**;
- **no perderlo al cerrar**, si ya le dedicó trabajo.

### 3. Cómo se nombran

El mantenedor fijó dos nombres, para la documentación y los specs:

- **concreto**: el tipo propio guardado. Se crea y se edita solo desde
  «Formatos de detección», en la pantalla de inicio (ADR-223 §1);
- **auxiliar**: el tipo propio del documento. Se crea con el PDF abierto.

En la interfaz los dos aparecen bajo «Tus tipos». El auxiliar se distingue
por el punto del tipo, que va punteado, y por la leyenda «solo en este
documento». La interfaz no usa las palabras «concreto» ni «auxiliar».

## Decisión

### 1. Un auxiliar vacío se ve; un concreto sin detecciones no

- Un tipo auxiliar aparece en el panel de entidades desde que se crea,
  aunque no tenga ninguna entidad.
- Un tipo concreto que no detectó nada no aparece en el panel. Sigue en los
  selectores de tipo, para usarlo al agregar a mano.

No cambia el contrato: `getDocumentEntityTypes` ya devuelve los auxiliares,
con o sin grupos.

### 2. El menú ⋯ de un auxiliar

Solo la banda de un tipo auxiliar tiene menú ⋯. Ofrece tres acciones:

| Acción | Qué hace |
|---|---|
| Editar nombre y abreviaturas… | Abre el mismo formulario de la creación. Al guardar, las entidades del tipo pasan a reemplazarse con la etiqueta nueva |
| Guardar para los próximos documentos | Lo pasa a concreto (§5) |
| Borrar tipo… | Lo borra, con confirmación (§4) |

Las bandas de los tipos concretos y de los tipos del catálogo no tienen
menú ⋯.

### 3. Editar: `updateDocumentEntityType`

```ts
// IPipelineOrchestrator, Contracts.md §3.5
updateDocumentEntityType(documentId: string, definition: UserEntityTypeDefinition): Promise<void>;
```

**Corregido al escribir el contrato, el 2026-11-16:** este método y el de §4
devuelven `Promise<void>`, como `restoreEditCheckpoint`, porque emiten
eventos de Grouping. La primera versión de este ADR los declaraba `void`.

- Reemplaza la definición del tipo auxiliar que tiene ese `id`. El `id` no
  cambia.
- Valida con `validateUserEntityType`, igual que la creación, contra los
  tipos base del país activo, los concretos y los demás auxiliares. No se
  compara contra sí mismo.
- Lanza `InvalidInputError` si:
  - la definición es inválida o su etiqueta repite otra;
  - el `id` no es de un tipo auxiliar de ese documento. Un tipo concreto no
    se edita por acá;
  - el documento no tiene sesión, o hay una pasada de detección en curso (la
    misma precondición de `createEditCheckpoint`, ADR-172 §1).
- **Qué cambia en los grupos del tipo.** Se recalculan el valor de reemplazo
  y las vistas previas de `ReplacementPreviews`, porque la escalera de
  etiquetas sale del nombre (ADR-219 §2). Cada grupo que cambió emite
  `ENTITY_GROUP_UPDATED` y, si cambió su valor vigente,
  `GROUP_REPLACEMENT_CHANGED`, que es el evento que hace re-renderizar sus
  páginas (ADR-044). No cambian el `id` del grupo, su `indexInType` ni su
  modo.
- **Un reemplazo escrito por el usuario no se toca**
  (`replacementValueUserSet`, ADR-076).
- Delega en `grouping.updateSessionType`, igual que `defineDocumentEntityType`
  delega en `defineSessionType`.

### 4. Borrar: `removeDocumentEntityType`

```ts
// IPipelineOrchestrator, Contracts.md §3.5
removeDocumentEntityType(documentId: string, typeId: UserEntityTypeId): Promise<void>;
```

**Decisión del mantenedor (2026-10-20):** al borrar un auxiliar que tiene
entidades, esas entidades se eliminan y quedan a la vista. La confirmación
lo dice con estas palabras: «Sus entidades quedan libres y descubiertas».

- **Cada grupo del tipo se elimina con las reglas de ADR-171 §2**:
  - sale de la sesión y emite `ENTITY_GROUP_REMOVED`;
  - sus conflictos se descartan con `CONFLICT_RESOLVED`;
  - sus valores entran en `removedValues`, así un re-análisis no los vuelve
    a traer con otro tipo. Es lo que el aviso promete: quedan descubiertas.
- **Después se borra la definición.** También se descartan, porque apuntan
  a un tipo que ya no existe:
  - las correcciones de tipo recordadas hacia ese tipo (`typeCorrections`,
    ADR-085);
  - las reglas cuyo objetivo es ese tipo;
  - los literales manuales que el Orchestrator retiene con ese tipo (ADR-061
    §5).
- Lanza `InvalidInputError` con las mismas condiciones de §3: `id` que no es
  de un auxiliar del documento, documento sin sesión o pasada de detección
  en curso.
- Delega en `grouping.removeSessionType`. El Orchestrator descarta sus
  literales retenidos.
- **Un agregado manual nuevo de un valor eliminado lo recupera**, como en
  ADR-171 §4. No hay regla nueva.

**La confirmación:**

- lista las entidades que se van a eliminar, con sus apariciones;
- avisa que dejan de ocultarse en el documento y en la copia exportada, y
  sugiere cambiarles el tipo antes si se quieren seguir ocultando;
- un auxiliar vacío se confirma igual, sin lista ni aviso.

### 5. Guardar: un auxiliar pasa a concreto

**Decisión del mantenedor (2026-11-15).** Revierte «un tipo del documento no
se puede pasar a guardado en la 1.1» (ADR-219 §5, `Plan_1.1.md` §4 punto 4).

- «Guardar para los próximos documentos» escribe la definición del tipo en
  los tipos propios guardados (`anonly:detection`, ADR-223 §3), con el mismo
  `id`.
- **No toca el documento abierto.** El Core de este documento lo sigue
  tratando como tipo de la sesión; sus entidades no cambian. Respeta la
  regla de ADR-223 §1: ningún cambio de la configuración de detección toca
  un documento abierto.
- **Para la interfaz ya es concreto**: la banda pasa a decir «guardado» y
  pierde el menú ⋯. Desde ahí se edita y se borra solo desde «Formatos de
  detección».
- **Se guarda solo la definición**: nombre y abreviaturas. Nunca sus
  entidades ni nada del documento (ADR-223 §3).
- **No es una edición del documento.** No entra en la pila de deshacer
  (ADR-172 §2 deja afuera la configuración). El aviso tiene «Deshacer», que
  lo quita de lo guardado, y no muestra la pista `Ctrl+Z`.
- **Al cerrar el documento**, la aplicación recrea el Core si la
  configuración derivada cambió, por el camino de ADR-125 §2, antes de
  aceptar el documento siguiente. Así el tipo llega como concreto en
  `EngineConfig.detection.userTypes`.

No hace falta un método nuevo del Core: guardar es de la aplicación.

### 6. Las definiciones de tipo entran al punto de restauración

**Cambia ADR-219 §5 y la nota de `Grouping_Engine.md`** que deja a
`defineSessionType` fuera de los puntos de restauración.

- El estado de edición de ADR-172 §1 suma las definiciones de los tipos de
  la sesión. `restoreEditCheckpoint` las deja exactamente como estaban.
- **Crear, editar y borrar un auxiliar son ediciones del documento**: cada
  una toma su punto antes de aplicarse y se deshace con `Ctrl/Cmd+Z`. El
  aviso de las tres trae «Deshacer».
- **«Crear y agregar» es una sola entrada.** Cuando el tipo se crea desde un
  selector, junto con el agregado o el cambio de tipo (ADR-229 §2), un
  deshacer se lleva las dos cosas.
- **No hay evento nuevo.** Después de restaurar, la interfaz vuelve a leer
  `getDocumentEntityTypes`, igual que ya rehidrata las reglas (ADR-172 §2).
- **Un tipo guardado durante este documento no se pierde por deshacer.** Si
  una restauración se lleva de la sesión un tipo que el usuario ya guardó
  (§5), la interfaz lo vuelve a definir con `defineDocumentEntityType`
  apenas termina de restaurar. Vuelve vacío: sus entidades son del estado
  que se deshizo.

## Lo que no cambia

- `defineDocumentEntityType` y `getDocumentEntityTypes`, su validación y su
  ciclo de vida: la definición sobrevive a `reanalyze` y se descarta con
  `DOCUMENT_CLOSED`.
- Los tipos concretos: con un documento abierto no se crean, no se editan y
  no se borran (ADR-223 §1).
- Los modos de un tipo propio, su agrupación y su etiqueta (ADR-219 §2 a
  §4).
- `GROUP_REMOVE_REQUESTED` y «Eliminar entidad» (ADR-171).
- El límite y la invalidación de los puntos de restauración (ADR-172 §1).

## Consecuencias

**A favor**

- Un nombre mal escrito se corrige sin cerrar el documento.
- El trabajo de definir un tipo no se pierde: se guarda con una acción.
- Borrar un tipo no agrega una regla nueva: es «Eliminar entidad» sobre
  todas las suyas.
- Deshacer vuelve a ser exacto también para los tipos.

**En contra**

- **Dos métodos más en el contrato**, con sus casos en los specs de
  Grouping y del Orchestrator.
- **Borrar un tipo destapa datos.** Es el costo que el mantenedor aceptó. Lo
  acotan la confirmación, que lista lo que queda a la vista, y el deshacer.
- **El punto de restauración crece** con las definiciones. Son pocas y
  chicas.
- **Guardar deja al Core y a la interfaz viendo el mismo tipo de dos
  formas** hasta cerrar el documento: para el Core es de la sesión, para la
  interfaz es concreto. La regla de §6 mantiene el invariante que importa:
  un tipo guardado durante el documento siempre existe en la sesión.

## Cómo se verifica

- **Editar:**
  - cambia la etiqueta de los grupos del tipo y emite `ENTITY_GROUP_UPDATED`
    por cada uno;
  - no cambia `id`, `indexInType` ni modo;
  - no pisa un reemplazo escrito por el usuario;
  - una etiqueta repetida, o el `id` de un tipo concreto, lanzan
    `InvalidInputError`.
- **Borrar:**
  - elimina todos los grupos del tipo y emite `ENTITY_GROUP_REMOVED` por
    cada uno;
  - un re-análisis no trae de vuelta sus valores;
  - un agregado manual de uno de esos valores sí lo recupera;
  - `getDocumentEntityTypes` ya no lo devuelve.
- **Deshacer:**
  - después de crear un auxiliar, lo borra;
  - después de editarlo, vuelve el nombre anterior y las etiquetas
    anteriores;
  - después de borrarlo, vuelven el tipo y sus grupos con el mismo `id`, el
    mismo `indexInType` y el mismo valor de reemplazo.
- **Guardar:**
  - el tipo aparece en `anonly:detection` y nada del documento se escribe;
  - el documento abierto no cambia;
  - el documento siguiente lo recibe como tipo concreto;
  - un deshacer que cruza la creación del tipo lo deja definido y vacío.

## Documentación que cambia

Con este ADR aceptado, y antes de tocar código (R-19):

- `Contracts.md` §3.5: los dos métodos, y la nota de los puntos de
  restauración.
- `Grouping_Engine.md`: `updateSessionType` y `removeSessionType`, las
  definiciones dentro del punto de restauración, y sus casos en §13 y §14.
- `Orchestrator.md`: la delegación, el descarte de literales retenidos y el
  caso 48, que hoy dice que `restoreEditCheckpoint` no borra los tipos.
- `React_Client.md`: guardar un auxiliar, la recreación del Core al cerrar
  el documento y la lectura de los tipos después de restaurar.
- `08_Security_Model.md` §10.2: un tipo se puede guardar con un documento
  abierto; se guarda solo la definición.
- `Plan_1.1.md` §4 punto 4 y §8.
