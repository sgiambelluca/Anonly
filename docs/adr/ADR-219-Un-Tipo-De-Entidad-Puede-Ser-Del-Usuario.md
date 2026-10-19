<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Grouping_Engine.md,core/Regex_Engine.md,core/Orchestrator.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md,adr/ADR-083-El-Panel-De-Conflicto-Elige-Tipo-No-Modo.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-219 — Un tipo de entidad puede ser del usuario

- **Estado**: Aceptado por el mantenedor el 2026-10-19, con los detalles
  técnicos del planificador (`Plan_1.1.md` §4).
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor (2026-10-13 y 2026-10-19), a propuesta del
  planificador en lo técnico.
- **Origen**: `Roadmap_1.x.md` §4 y [`Plan_1.1.md`](../roadmap/Plan_1.1.md).
- **Alcance**: contrato (`Contracts.md`, `03_Data_Model.md`),
  `grouping-engine`, `regex-engine` (solo el tipo que estampa), Orchestrator
  y `react-client`. Sin dependencias nuevas.
- **Relacionado con**:
  - ADR-012, ADR-057 y ADR-028: modos, etiqueta y numeración;
  - ADR-073: qué tipos agrupan por parecido;
  - ADR-082 y ADR-083: reclasificar y el panel de conflicto;
  - ADR-220: los formatos que detectan un tipo propio;
  - ADR-223: dónde se guardan los tipos propios.

## Contexto

### 1. Hoy hay una sola categoría para lo que no es un tipo base

`EntityType` es un enum cerrado (`Contracts.md` §5) y su único lugar para
lo que no es un tipo base es `Custom`. Toda tabla que depende del tipo está
indexada por ese enum: la escalera de etiquetas (ADR-057), la máscara de
respaldo, el sintetizador, los nombres y colores de la interfaz. Dos tipos
del usuario, «CBU» e «Historia clínica», compartirían hoy la etiqueta
`[CUSTOM 01]`, la numeración y las reglas.

### 2. Nadie crea hoy entidades `Custom` desde un patrón

`addPattern` y `removePattern` existen (`Regex_Engine.md` §6), pero ningún
código de producto los llama: solo los tests. `Custom` solo aparece cuando
el usuario agrega o reclasifica a mano. Cambiar cómo se identifica un tipo
no rompe ningún flujo que un usuario tenga hoy.

### 3. Lo que decidió el mantenedor

El 2026-10-13:

- el usuario crea tipos con identidad y nombre propios; no quedan reunidos
  bajo «Custom»;
- un tipo propio tiene tres modos: etiqueta, máscara por cantidad de
  caracteres y censura total. **No tiene sintético**;
- los tipos creados antes de cargar un documento se guardan; los creados
  con un documento abierto son de ese documento.

El 2026-10-19:

- la etiqueta va en mayúsculas y sin tildes: `[HISTORIA CLINICA 01]`;
- las versiones cortas de la etiqueta son automáticas, y el usuario puede
  escribirlas si quiere;
- la máscara conserva espacios y separadores;
- la numeración y el modo son por tipo;
- al borrar un tipo propio se borran sus formatos. Los tipos base no se
  borran (ADR-223);
- sin objeción a tres propuestas del planificador: un sintético pedido para
  un tipo propio se resuelve como etiqueta; dos apariciones son la misma
  entidad si coinciden sin contar espacios, separadores ni mayúsculas; un
  tipo del documento no se puede pasar a guardado en la 1.1.

## Decisión

### 1. La identidad de un tipo deja de ser un enum cerrado

```ts
// Contracts.md §5
export type UserEntityTypeId = `user:${string}`;   // "user:" + UUID v4
export type EntityTypeId = EntityType | UserEntityTypeId;
export function isUserEntityType(type: EntityTypeId): type is UserEntityTypeId;
```

Pasan de `EntityType` a `EntityTypeId`:

- `Occurrence.entityType` y `EntityGroup.type`;
- `ConflictCandidate.entityType`, `Conflict.resolvedType`,
  `ConflictResolved.entityType` y `ConflictResolveRequested.entityType`;
- `EditPreviewRequest` (variante `type`) y `EditPreviewGroup.type`;
- `RuleTarget.entityType`;
- `ManualEntityRequest.entityType` y `FindLiteralInput.entityType`.

Siguen siendo `EntityType`:

- `RegexPattern.entityType`: los formatos base solo detectan tipos base;
- `SyntheticRequest.type`: un tipo propio nunca sintetiza (§3).

Las tablas indexadas por `EntityType` siguen igual para los tipos base. Para
un tipo propio, el valor sale de su definición (§2).

**Por qué ensanchar el tipo y no agregar un subcampo a `Custom`.** Con
`Custom` más un `customTypeId`, cada comparación por tipo que olvide el
subcampo mezclaría dos tipos propios en silencio: numeración, reglas,
conflictos y agrupación. Es el modo de falla de un dato que no viaja
(ADR-066 §6). Con el tipo ensanchado, el compilador señala cada lugar que
hay que revisar.

`EntityType.Custom` queda en el enum por compatibilidad. La aplicación deja
de ofrecerlo: lo reemplazan los tipos propios y «Nuevo tipo» (§5, ADR-224
§6).

### 2. Qué define un tipo propio

```ts
// Contracts.md §5
export interface UserEntityTypeDefinition {
  readonly id: UserEntityTypeId;
  readonly name: string;                 // como lo escribió el usuario: "Historia clínica"
  readonly shortLabels?: {
    readonly level1?: string;            // nivel 1 de ADR-057; ausente = automático
    readonly level2?: string;            // nivel 2 de ADR-057; ausente = automático
  };
}
```

**La etiqueta no se guarda: se deriva del nombre.** `userTypeLabel(name)`
quita las tildes, pasa a mayúsculas y colapsa los espacios: «Historia
clínica» → `HISTORIA CLINICA`. Es el nivel 0 de la escalera de ADR-057.

`userTypeLabel` y `validateUserEntityType` son funciones puras de
**`grouping-engine`**, y el façade las reexporta. Viven ahí porque
`grouping-engine` es el dueño de las etiquetas: la tabla de ADR-057 es
privada de ese motor, y la validación tiene que compararse contra ella.
Corregido al escribir el contrato el 2026-10-19; la primera versión de este
ADR las ponía en `@anonly/shared`, que no puede leer esa tabla.

**Las versiones cortas son automáticas salvo que el usuario las escriba.**
El nivel 1 automático son las primeras cuatro letras o dígitos de la
etiqueta, sin espacios (`HIST`). El nivel 2 automático son las primeras
tres (`HIS`). Los tokens siguen ADR-057: `[HISTORIA CLINICA 01]`,
`[HIST 01]`, `[HIS-01]`.

**Validación.** `validateUserEntityType` la usan la interfaz al crear y el
Core al recibir:

- el nombre tiene entre 1 y 40 caracteres, con al menos una letra. Admite
  letras, dígitos, espacios y guiones;
- cada versión corta escrita a mano tiene entre 1 y 8 letras o dígitos;
- **la etiqueta no puede repetir otra**: ni la de un tipo base en el país
  activo (ADR-221 §3) ni la de otro tipo propio. Dos nombres que solo
  difieren en tildes o mayúsculas dan la misma etiqueta y son el mismo
  tipo.

### 3. Los modos de un tipo propio

| Modo | Valor |
|---|---|
| Etiqueta (`placeholder`) | Escalera de §2 con `indexInType` por tipo (ADR-028, sin cambios) |
| Máscara (`mask`) | `canonicalValue` con cada letra o dígito cambiado por `X`; espacios y separadores quedan. `0170-0994 11` → `XXXX-XXXX XX` |
| Censura total (`redact`) | `""`, como hoy |
| Sintético (`synthetic`) | **No existe** |

- **La máscara sale del valor canónico, no de cada aparición.** Todas las
  apariciones de un grupo comparten `replacementValue` (`03_Data_Model.md`
  §9). Para un tipo propio no se usa `Occurrence.maskFormat`.
- **Un sintético pedido para un tipo propio se resuelve como etiqueta.**
  Vale para cualquier camino:
  - el modo por defecto de la configuración;
  - una regla global (`resolveMode`, `Grouping_Engine.md`);
  - reclasificar a un tipo propio un grupo que estaba en sintético (ADR-082).
- **Lo que el usuario pide directo, el Core lo rechaza.** Un
  `GroupUpdateRequested` con `replacementMode: synthetic`, o una regla de
  scope `type` con sintético sobre un tipo propio, se rechazan con
  `GROUPING_INVALID_PATCH` y un `warn`, como cualquier patch inválido. La
  interfaz no ofrece ese modo.
- `ReplacementPreviews.synthetic` de un grupo de tipo propio es `""`. El
  campo sigue siendo requerido; el invariante nuevo va en
  `03_Data_Model.md` §9.

### 4. Cómo se agrupa un tipo propio

- **Sin agrupación por parecido.** La lista de ADR-073 es cerrada y no
  incluye tipos propios.
- **Grouping compara por la clave alfanumérica**, venga la aparición de un
  formato o de un agregado a mano. La clave es el valor en NFC, sin tildes,
  en minúsculas y sin nada que no sea letra o dígito. «0170-0994» y
  «01700994» son la misma entidad; «0170-0994» y «0170-0995» no.
- Cómo normaliza un formato propio asociado a un **tipo base** lo define
  ADR-220 §5.

### 5. Tipos guardados y tipos del documento

- **Guardados.** Se crean desde la pantalla de inicio y llegan al Core en
  `EngineConfig.detection.userTypes` (ADR-223 §2). No cambian mientras dura
  el Core.
- **Del documento.** Se crean con un documento abierto, al agregar o
  reclasificar una entidad con «Nuevo tipo»:

  ```ts
  // IPipelineOrchestrator, Contracts.md §3.5
  defineDocumentEntityType(documentId: string, definition: UserEntityTypeDefinition): void;
  getDocumentEntityTypes(documentId: string): ReadonlyArray<UserEntityTypeDefinition>;
  ```

  La segunda devuelve los tipos del documento en orden de creación. La
  interfaz la usa para volver a armar sus listas sin llevar un registro
  propio que pueda divergir del Core.

  - Es sincrónica. Valida con `validateUserEntityType` contra los tipos
    base, los guardados y los del documento; una etiqueta repetida lanza
    `InvalidInputError`.
  - La definición vive en la sesión de Grouping de ese documento, sobrevive
    a un `reanalyze` y se descarta con `DOCUMENT_CLOSED`.
  - No se guarda, no se exporta y no se puede pasar a guardada en la 1.1.
  - Un deshacer (ADR-172) no la borra: queda definida sin grupos, y eso no
    tiene efecto visible.

### 6. Fuera del Core

- La interfaz muestra el `name` de la definición en el árbol, en los
  selectores de tipo, en el panel de conflicto y en el tooltip.
- La hoja de referencia de marcadores (ADR-059) lista el marcador con el
  nombre del tipo propio.
- **La hoja de referencia puede ocupar más de una página.** ADR-059 contaba
  con una sola, porque los tipos eran 13 como máximo. Con tipos propios las
  filas no tienen tope. Render la pagina, porque es el único que sabe cuánto
  mide cada fila, y Export agrega las páginas que hagan falta
  (`Render_Engine.md` y `Export_Engine.md`). Es una consecuencia técnica
  que apareció al escribir los specs, el 2026-10-19.
- Los selectores de tipo ofrecen los tipos del catálogo del país activo
  (ADR-221 §3), los que detecta el modelo y los tipos propios.

## Lo que no cambia

- Los tipos base, sus modos y su numeración. Sus etiquetas cambian solo con
  el país (ADR-221 §3).
- La renumeración canónica de ADR-028.
- La lista de agrupación por parecido de ADR-073.
- El panel de conflicto de ADR-083: sus candidatos ahora pueden ser tipos
  propios.

## Consecuencias

**A favor**

- Cada tipo propio numera, etiqueta y aplica reglas por separado, sin una
  rama especial en cada motor.
- El compilador encuentra cada comparación por tipo que hay que revisar.

**En contra**

- **Es un cambio de contrato que toca a todos los consumidores.** Va en un
  commit propio, con este ADR (R-1, la excepción del contrato).
- **`ReplacementPreviews.synthetic` vacío es una convención, no una
  garantía del tipo.** Lo sostiene un test.
- **Cada tabla indexada por tipo necesita su resolución para tipos
  propios.** Hoy son cinco: etiquetas, máscara de respaldo, sintetizador,
  nombres y colores de la interfaz.

## Cómo se verifica

- Dos tipos propios numeran por separado: `[CBU 01]` y `[HISTORIA CLINICA 01]`.
- Un sintético pedido por el modo por defecto, por una regla global o por
  reclasificar se resuelve como etiqueta. Pedido por patch o por regla de
  tipo, se rechaza con `GROUPING_INVALID_PATCH`.
- La máscara conserva espacios y separadores, y sale del valor canónico.
- La escalera usa las versiones cortas escritas a mano, o las automáticas
  si faltan.
- Una etiqueta repetida se rechaza, contra un tipo base y contra otro tipo
  propio, incluso cuando solo difiere en tildes o mayúsculas.
- «0170-0994» y «01700994» forman un grupo; «0170-0994» y «0170-0995»,
  dos.
- Un tipo del documento desaparece con `DOCUMENT_CLOSED` y sobrevive a un
  `reanalyze`.
- Reclasificar a un tipo propio y resolver un conflicto a un tipo propio
  funcionan como con un tipo base.
- La hoja de referencia lista el nombre del tipo propio.
