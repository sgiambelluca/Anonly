<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-011-Grouping-First.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-082 — El usuario corrige el tipo de entidad de un grupo

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, pidiendo dos funcionalidades que resultaron ser la misma: corregir la categoría de un grupo mal clasificado (menú "…" → "Cambiar categoría") y elegir el tipo al resolver un conflicto (ADR-083).
- **Relacionado con**: **ADR-083** (el panel de conflicto, primer consumidor especializado), **ADR-011** (Grouping-first), **ADR-028** (`indexInType` y la renumeración canónica), **ADR-057** (la escalera de abreviaturas, que depende del label del tipo), **ADR-060/069** (`personGender`, que solo existe para `Person`), **ADR-076** (la edición manual del `replacementValue`).
- **Parte de**: cierre de las observaciones del Hito 10 (§6.1 puntos A y B del plan) + pedido nuevo del humano.

> Convención de citas: `ADR-082 §N` refiere a **Decisión §N**.

## Contexto

### 1. El detector se equivoca de categoría, y no hay forma de corregirlo

Verificado sobre la pericia real y sobre `text-10p.pdf`: los dos detectores confunden tipos con regularidad.

- NER etiqueta `"Fiscalía de Quilmes"` como `Address` cuando es una `Organization` (y al revés: `"Belgrano 1234"` puede salir `Organization`).
- Los patrones numéricos de `default-ar.ts` no distinguen un tramo de número de expediente de un teléfono — `PP-13-00-000000-24/00` produce una ocurrencia `Phone` (documentado en `Post_Hito10.8_Pendientes.md` §4bis).
- Un `Custom` de una regla del usuario puede solaparse con un tipo nativo.

Hoy el usuario ve el error en el árbol de entidades y **no tiene ninguna acción disponible**. `GroupUpdateRequested.patch` (`shared/src/events.ts:290`) es:

```ts
Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">>
  & { readonly personGender?: PersonGenderChoice }
```

**`type` no está.** Las únicas salidas son deshabilitar el grupo (se deja de anonimizar, que suele ser lo contrario de lo que hace falta) o editar el `replacementValue` a mano para que el token diga otra cosa — un parche cosmético que no arregla la clasificación, no afecta el agrupamiento y no sobrevive conceptualmente a nada.

### 2. Importa más de lo que parece, porque el tipo no es solo una etiqueta

`EntityGroup.type` gobierna cuatro cosas:

| Qué | Cómo depende del tipo |
|---|---|
| El **token** del documento anonimizado | `resolveLabelSet(group)` (ADR-057): `[ORGANIZACION 01]` vs. `[DIRECCION 01]`. |
| El **número** | `indexInType` es una secuencia **por tipo** (ADR-028). |
| Qué **regla** aplica | `r.scope === "type" && r.target.entityType === group.type` (`grouping.engine.ts:462`). |
| El **valor sintético** | `synthesize({ type, ... })` sortea de un pool por tipo (ADR-072). |

O sea que un tipo equivocado produce un documento anonimizado que **afirma algo falso**: una organización censurada como `[DIRECCION 03]`. En una pericia judicial eso no es cosmético — el lector del documento anonimizado saca conclusiones del tipo de dato que se ocultó.

### 3. Es el mismo mecanismo que pide el panel de conflicto

El pedido del humano para el `ConflictDialog` (ADR-083) es exactamente esta operación con la UI restringida a dos opciones: *"con 'Fiscalía de Quilmes', dale la opción de agregarlo como Organización o como Localización"* (el enum real no tiene `Location`; el par que se ofrece es `Organization`/`Address`). Si se resolviera ahí de forma puntual, habría dos caminos distintos para cambiar el tipo de un grupo, con dos semánticas que se irían separando.

Por eso este ADR decide **la capacidad**, y ADR-083 decide **la UI especializada** que la consume.

### 4. Por qué necesita ADR

Amplía `GroupUpdateRequested.patch`, que está publicado en `Contracts.md` y `04_Event_System.md` §10. Y —lo que de verdad hay que decidir— obliga a contestar qué pasa con las **cinco** cosas que el tipo arrastra: el índice, el token, el modo efectivo, el género, y los registros de ocurrencia de la sesión. Ninguna es obvia, y hacerlas mal produce corrupción silenciosa (dos grupos con el mismo `indexInType`, o un dedup que deja de reconocer una ocurrencia ya vista).

## Decisión

### 1. `GroupUpdateRequested.patch` gana `type?: EntityType`

```ts
readonly patch: Partial<
  Pick<EntityGroup, "type" | "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">
> & { readonly personGender?: PersonGenderChoice };
```

Un patch con `type` igual al actual es **no-op** (no emite eventos), mismo criterio que el resto de los campos.

### 2. Qué recalcula un cambio de tipo, en este orden

1. **`indexInType`**: el grupo toma el próximo índice libre del tipo nuevo (`nextIndexByType`). No se "devuelve" el índice viejo: dejar huecos es exactamente lo que `renumberGroupsCanonically` (ADR-028) resuelve en el `finishSession` siguiente, y compactar acá duplicaría esa lógica con otro criterio.
2. **`replacementMode` efectivo**: se re-resuelve con `resolveMode(group, session.rules)` — el tipo nuevo puede tener otra regla de scope `type`.
3. **`personGender`**: si el grupo **sale** de `Person`, se borra el campo y su flag interno; si **entra** a `Person`, se dispara la inferencia por léxico igual que una asignación de `canonicalValue` (ADR-069 §6(a)).
4. **`replacementValue`**: se recalcula con el label set del tipo nuevo (ADR-057), **salvo** que `replacementValueUserSet` esté encendido (ADR-076 §3). Ver §4.

   > **Corrección de orden (2026-08-19)**: los pasos 3 y 4 estaban invertidos en la primera redacción. El género se resuelve **antes** que el valor: al entrar a `Person` el label del placeholder depende del género inferido (`[MUJER 01]` vs `[PERSONA 01]`, ADR-060 §3), así que calcular el valor primero lo dejaría con el género viejo. El código siempre hizo lo correcto; el ADR describía mal su propio orden.
5. **`recordedOccurrences` del grupo**: sus `entityType` **NO se tocan**. Ver §3, que es la parte no obvia — y la que se decidió al revés en el primer borrador de este ADR.

### 3. Los registros de ocurrencia conservan el tipo del **detector**

> **Este punto se decidió al revés en el primer borrador y lo corrigió el test de regresión** (`"re-emitir la misma ocurrencia tras un cambio de tipo no duplica ni crea conflicto"`), que falló contra la implementación que seguía al grupo. Se deja escrito el razonamiento completo porque la intuición equivocada es fácil de repetir.

`SessionOccurrenceRecord.entityType` alimenta dos mecanismos, **en este orden**:

1. `isDuplicateIdentity` (`processOccurrence`, primer guard): dedupe por `(entityType, pageIndex, normalizedValue, bbox)` contra lo que **el detector acaba de emitir**.
2. `findOverlapConflict`: **saltea** los registros del mismo `entityType` (`if (rec.entityType === occurrence.entityType) continue;`).

La clave es contra qué se compara el registro: contra `Occurrence.entityType`, que es **lo que produce el detector** — y el detector no sabe nada de la corrección del usuario. En un `reanalyze` vuelve a emitir la misma ocurrencia con el tipo original.

Entonces, si los registros **siguieran al grupo**: la ocurrencia re-emitida llega con el tipo viejo, el registro tiene el nuevo, el dedup **no matchea**, la ocurrencia entra como nueva, y cae en `findOverlapConflict` — que tampoco la saltea (los tipos difieren) — contra **su propio grupo**. Resultado: un conflicto espurio del grupo consigo mismo en cada `reanalyze`.

Conservando el tipo del detector, el dedup matchea y la descarta en silencio, que es exactamente lo que ADR-038 §3 quiere. Y como el dedup corre **antes**, la ocurrencia nunca llega a la detección de conflictos.

El registro es la **huella de lo que el detector vio**; el `type` del grupo es la **clasificación que vale**. Son dos cosas distintas y tienen que poder diferir.

### 4. Una edición manual del `replacementValue` sobrevive al cambio de tipo

Es la consecuencia directa de ADR-076 §3 —"solo un cambio del `replacementMode` **efectivo** reemplaza un valor escrito por el usuario"— y se ratifica acá en vez de tratarse como caso nuevo: si el usuario escribió `[FQ]`, eso es lo que quiso ver, y la categoría no cambia esa intención.

Con una salvedad que sale gratis: si el cambio de tipo **sí** cambia el modo efectivo (paso 2 de §2, porque el tipo nuevo tiene otra regla), entonces el valor se recalcula y el flag se apaga — que es la regla de ADR-076 §4 fila 4, sin excepción nueva.

### 5. Eventos: los que ya hay

- `ENTITY_GROUP_UPDATED` con `"type"` en `changes` (más `"indexInType"`, `"replacementValue"`, `"replacementMode"` y `"personGender"` según lo que de verdad cambió).
- `GROUP_REPLACEMENT_CHANGED` si el valor o el modo cambiaron, por el mismo camino que ya usa `applyGroupUpdate`.

**Ningún evento nuevo.** El preview anonimizado se actualiza solo: el Orchestrator media los `ENTITY_GROUP_*` y re-renderiza las páginas afectadas (ADR-044).

### 6. La UI: "Cambiar categoría" en el menú del grupo

Entrada nueva en `GroupContextMenu` → `ChangeTypeDialog`: un `Select` con **todos** los `EntityType` (el mismo `ENTITY_TYPE_OPTIONS` que ya usa `DocumentSearchBox` para el agregado manual de ADR-061), preseleccionado en el tipo actual, y un botón "Cambiar". Sin `ConfirmDialog`: la operación es reversible volviendo a elegir el tipo anterior, a diferencia de "Eliminar grupo" o "Cerrar documento".

### 7. Qué NO cambia

- **`Occurrence.entityType` (el dato del detector) no se toca.** Lo que cambia es la clasificación del **grupo** y los registros de sesión que lo indexan; el evento `ENTITY_FOUND` original es historia, no estado.
- **No hay re-agrupamiento.** Cambiar el tipo de un grupo **no** lo fusiona con un grupo existente del tipo destino, aunque compartan `normalizedValue`. Fusionar es una operación propia (`GROUP_MERGE_REQUESTED`) y mezclarla acá haría que un cambio de categoría borre un grupo sin que el usuario lo pida.
- **`canonicalValue`, `aliases` y `members` quedan intactos.**

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Eliminar el grupo y re-agregarlo con el tipo correcto** (vía `addManualEntity`, ADR-061) | Pierde todo lo que el usuario hizo sobre ese grupo (modo, valor editado, habilitado/deshabilitado) y le cambia el `EntityGroup.id`, que es la semilla del sintetizador desde ADR-072 — o sea que el valor sintético cambiaría por una corrección de categoría. |
| **Una regla de scope `type` que reasigne** | Las reglas deciden el **modo de reemplazo**, no la clasificación (ADR-012). Meter reclasificación ahí le cambia el significado a todo el sistema de reglas. |
| **Solo permitir el cambio entre los candidatos del conflicto** | Cubre ADR-083 y deja afuera el caso más común, que es el falso positivo **sin** conflicto (el `Phone` que era un número de expediente: ningún otro detector lo disputó). |
| **Compactar `indexInType` al liberar el índice viejo** | Duplica `renumberGroupsCanonically` con otro criterio y rompe su determinismo (ADR-028). Los huecos transitorios ya son parte del diseño. |

## Consecuencias

**Positivas**: el usuario puede corregir la clase de error más visible del pipeline; el documento anonimizado deja de poder afirmar una categoría falsa; ADR-083 se apoya en una capacidad general en vez de abrir un segundo camino.

**Negativas / riesgos asumidos**:

- **Los índices se corren.** Cambiar un grupo de tipo mueve su número y, tras el próximo `finishSession`, puede correr los de sus vecinos (ADR-028). Es el mismo costo del determinismo que ADR-038 Q2 ya aceptó para el `reanalyze`, ahora disparable a mano.
- **Un cambio de tipo puede dejar dos grupos con el mismo `normalizedValue` en el tipo destino**, sin fusionar (§7). Es deliberado, pero significa que el usuario puede tener que hacer un merge después. La alternativa —fusionar solo— destruye datos sin pedirlo.
- **Consecuencia de §3 — "la corrección no se propaga hacia adelante". Medida, no inferida** (los tres escenarios se corrieron contra el motor real):

  `findMatchingGroup` empareja candidatos por `group.type === occurrence.entityType`. Como el grupo reclasificado ya no tiene el tipo que el detector emite, deja de ser candidato para las ocurrencias futuras de ese mismo detector. Los tres casos:

  | Escenario | Resultado medido |
  |---|---|
  | **A.** La misma ocurrencia se re-emite idéntica (el caso normal de un `reanalyze`) | **La corrección aguanta.** El dedup por identidad (§3) la descarta en silencio: 1 grupo, `ORGANIZATION`. |
  | **B.** Aparece una ocurrencia **nueva** del mismo valor (otra página, u OCR que recién ahora la lee) | **Se parte en dos grupos**: `ORGANIZATION "Fiscalía de Quilmes"` (el corregido) y `ADDRESS "Fiscalía de Quilmes"` (nuevo). El mismo texto sale del export con **dos tokens distintos** — `[ORGA 01]` y `[DIRECCION 01]`. Sin conflicto emitido: los bboxes no se solapan, así que el motor no tiene motivo para avisar. |
  | **C.** Un `reanalyze` por OCR hace `dropOccurrences` de las páginas del grupo | **La corrección se pierde entera.** El grupo se queda sin members → se elimina; la re-detección lo recrea con el tipo del detector (`ADDRESS`). |

  Dos matices que la medición agregó: el grupo nuevo de **B** nace con `indexInType = 2` (la reclasificación no devuelve el índice viejo) pero el `finishSession` siguiente lo renumera a `1`, así que el hueco no llega al documento — el defecto visible es el **doble token**, no la numeración. Y la salida manual de **B** tiene una fricción: `MergeDialog` filtra los candidatos por **mismo `type`** (`mergeValidation.ts`), así que los dos grupos no se pueden fusionar directo — hay que reclasificar el nuevo primero y recién después fusionar.

  **Se acepta**, y es el mismo límite que tiene hoy cualquier edición manual frente a un detector que no aprende (el `canonicalValue` editado a mano tiene la misma forma). Cerrarlo exige **persistir la corrección** —una regla de reclasificación por valor, consultada en `findMatchingGroup`—, que es una decisión propia con su propio ADR: hay que definir su alcance (¿por valor normalizado? ¿por documento o por sesión?), su precedencia contra las reglas de `scope: "type"` existentes, y qué pasa cuando dos correcciones del mismo valor se contradicen. **Candidato natural si el caso B aparece en uso real**; hoy no hay reporte que lo pida.
- Superficie nueva en un patch muy usado. Acotada: es un campo opcional, y el motor lo trata como los otros cuatro.

## Validación

- `updateGroup({ type })` sobre un grupo `Address` → `Organization`: cambia `type`, toma un `indexInType` del tipo nuevo, y el `replacementValue` pasa a usar el label de `Organization`.
- El mismo patch con el tipo **actual** es no-op: no emite `ENTITY_GROUP_UPDATED`.
- Un grupo con `replacementValueUserSet` conserva su valor tras el cambio de tipo (§4) — **salvo** que el tipo nuevo active una regla que cambie el modo efectivo, y ahí se recalcula y el flag se apaga.
- Un grupo `Person` con `personGender` que pasa a `Organization` pierde el género; al volver a `Person`, la inferencia corre de nuevo.
- Tras el cambio, `finishSession` renumera sin colisiones: no quedan dos grupos con el mismo `(type, indexInType)`.
- **El caso que prueba §3**: cambiar el tipo de un grupo y después re-emitir la misma `ENTITY_FOUND` (con el tipo del detector, que es lo que hace un `reanalyze`) no crea una ocurrencia duplicada **ni un conflicto del grupo contra sí mismo**. Es el test que corrigió la decisión de §3.

## Documentos afectados

- `core/Contracts.md` y `architecture/04_Event_System.md` §10 (`GroupUpdateRequested.patch`).
- `core/Grouping_Engine.md` (§6, §13 caso nuevo, §14, §15).
- `ui/Components.md` §3.5 (entrada de menú + `ChangeTypeDialog`) y `ui/UX_Guidelines.md`.
- Código: `shared` (**PR 1**) → `grouping-engine` (**PR 2**) → `apps/react-client` (**PR 3**), en ese orden.
