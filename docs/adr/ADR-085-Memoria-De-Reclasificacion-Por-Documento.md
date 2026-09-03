<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,architecture/08_Security_Model.md,adr/ADR-011-Grouping-First.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md,adr/ADR-083-El-Panel-De-Conflicto-Elige-Tipo-No-Modo.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-085 — La corrección de tipo se recuerda por documento

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, tras el diagnóstico de ADR-082 (Consecuencias) que midió los tres escenarios de una reclasificación. Las ocho cuestiones de diseño se cerraron una por una antes de escribir código.
- **Relacionado con**: **ADR-082** (la capacidad de corregir el tipo, cuya limitación cierra este ADR), **ADR-083** (el panel de conflicto, segundo disparador), **ADR-073** (el pase difuso restringido a los tipos de texto libre, que este ADR reusa tal cual), **ADR-038 §3** (dedup por identidad), **ADR-061** (el agregado manual, que deliberadamente **no** registra), `08_Security_Model.md` §10.2 (por qué nada de esto se persiste).
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-085 §N` refiere a **Decisión §N**.

## Contexto

### 1. La corrección no se propaga hacia adelante, y está medido

ADR-082 le dio al usuario la capacidad de corregir el tipo de un grupo. Su sección de Consecuencias midió los tres escenarios contra el motor real:

| Escenario | Hoy |
|---|---|
| **A.** La misma ocurrencia se re-emite idéntica en un `reanalyze` | ✅ la corrección aguanta (el dedup por identidad la descarta) |
| **B.** Aparece una ocurrencia **nueva** del mismo valor | ❌ **se parte en dos grupos**, y el mismo texto sale del export con dos tokens distintos (`[ORGA 01]` y `[DIRECCION 01]`) |
| **C.** Un `reanalyze` borra el grupo entero | ❌ **la corrección se pierde**; la re-detección lo recrea con el tipo del detector |

La causa es una sola línea, `findMatchingGroup` (`grouping.engine.ts:1757`):

```ts
if (group.type === occurrence.entityType) candidates.push(group);
```

El grupo corregido dejó de tener el tipo que el detector emite, así que deja de ser candidato para las ocurrencias futuras de ese detector. Y el detector no aprende: en cada `reanalyze` vuelve a decir `Address`.

### 2. El escenario C es más alcanzable de lo que parecía

El diagnóstico de ADR-082 lo describía como "un `reanalyze` por OCR". Verificado: `runReanalyzeNerOffFlow` hace `dropOccurrences({ source: DetectionSource.NER })`, así que **corregir un grupo detectado por NER y después apagar NER borra ese grupo**. Volver a prenderlo lo recrea con el tipo del detector.

Corregir → apagar NER para comparar → volver a prender es una secuencia de uso normal, no un caso de laboratorio. Eso es lo que movió la decisión de "anotarlo por si aparece" a "cerrarlo".

### 3. Por qué no se persiste nada

`08_Security_Model.md` §10.2 es explícito: `localStorage` es **solo** para settings del usuario, *"nunca documentos ni datos sensibles"*. Una lista de correcciones es, precisamente, un índice destilado de las entidades del documento — nombres de personas, organizaciones, direcciones. Es lo más sensible que se podría persistir, y en una máquina compartida dejaría atrás quiénes aparecían en la pericia.

Todo lo de este ADR vive **en RAM y por documento**, y muere con la sesión.

### 4. Por qué necesita ADR

No cambia ningún contrato público —lo que se agrega es bookkeeping interno de `grouping-engine`— pero **cambia la semántica documentada del matching** (`Grouping_Engine.md` §Matching), y las ocho decisiones de abajo tienen alternativas reales con consecuencias distintas. Hacer mal la §6 reintroduce, en particular, el conflicto espurio que ADR-082 §3 existe para evitar.

## Decisión

### 1. Dos mecanismos, con roles separados

**(a) `InternalGroup.absorbedTypes: Set<EntityType>`** — los tipos de detector que este grupo acepta. El filtro de candidatos pasa a:

```ts
if (group.type === occurrence.entityType || group.absorbedTypes.has(occurrence.entityType))
```

Cubre el escenario **B**. Es una operación más adentro de un loop que ya recorre todos los grupos, con cortocircuito: **medido en 0,19 ms sobre 5000 ocurrencias × 50 grupos**, contra un pase difuso que el mismo método ya corre y es órdenes de magnitud más caro.

**(b) `Session.typeCorrections: Map<string, EntityType>`** — `normalizedValue` → tipo corregido. Se consulta **solo en `createGroup`**, que tiene un único call site y solo se alcanza cuando `findMatchingGroup` no encontró nada. Cubre el escenario **C**.

**No son dos consultas por ocurrencia.** Una es barata y por ocurrencia; la otra es rara y por grupo creado (~50 veces contra ~5000 ocurrencias en una pericia). Ni siquiera compiten: el mapa solo se toca cuando `absorbedTypes` ya no encontró nada.

### 2. Cómo se componen

```
Ocurrencia 1 de un valor corregido, sin grupo → mapa      → nace con el tipo corregido,
                                                             absorbedTypes = {tipoDetector, tipoCorregido}
Ocurrencias 2..N del mismo valor              → absorbed  → caen en el grupo, sin tocar el mapa
```

`createGroup` siembra `absorbedTypes` con **los dos** tipos. Por eso el mapa no se vuelve a consultar para ese valor en todo el documento.

### 3. Matcheo: exacto, más difuso solo para texto libre

El lookup del mapa es por `normalizedValue` exacto. Si falla **y** el tipo de la ocurrencia está en `FUZZY_MATCHING_TYPES` (`{Person, Organization, Address}`, ADR-073), corre un pase difuso con `levenshteinNormalized` y el mismo umbral que usa `findMatchingGroup`.

**El guard va sobre el tipo que emite el detector**, no sobre el tipo destino de la corrección. El riesgo que ADR-073 identificó —dos CUIT que difieren en un dígito dan 0.909 ≥ 0.88— vive en el **valor** que se compara, y ese valor es el que el detector clasificó. Es exactamente el criterio de la línea 1762, reusado.

Ejemplo: corregir el falso positivo `Phone "00-000000"` a `Custom` deja una entrada que solo matchea **exacto**, porque la ocurrencia entrante es `Phone`. Corregir `"Fiscalía de Quilmes"` de `Address` a `Organization` deja una entrada que además tolera `"Fiscalia de Quiimes"` de un OCR imperfecto.

### 4. Qué acciones registran una corrección

| Acción | ¿Registra? | Por qué |
|---|---|---|
| **"Cambiar categoría"** (ADR-082 §6) | **sí** | Es el acto explícito de decir "esto es X". |
| **Resolver un conflicto eligiendo tipo** (ADR-083) | **sí**, cuando el tipo elegido difiere del vigente | Misma intención del usuario, otro punto de entrada. Sale solo: `applyConflictResolve` delega en `changeGroupType`. |
| **`addManualEntity`** (ADR-061) | **no** | Agregar una entidad no es *corregir* una clasificación: el usuario ya eligió el tipo al crearla, y `manualLiteralsByDocument` (Orchestrator) ya recuerda ese literal. Registrar acá superpondría dos memorias sobre el mismo valor. |

**Corolario, sin caso especial**: si el usuario después **corrige** una entidad que había agregado a mano, eso pasa por "Cambiar categoría" y **sí** registra. Nada que programar aparte.

Confirmar un conflicto **sin cambiar el tipo** no registra: no hubo corrección, y la entrada sería `X → X`.

### 5. Gana la última elección, sin historial

Corregir el mismo valor otra vez sobrescribe la entrada. No hay pila, ni "volver al anterior", ni resolución de contradicciones entre dos grupos con el mismo valor corregidos distinto: **la última gana**. Al motor no le importa qué era antes; le importa qué decidió el usuario.

### 6. Dónde NO se consulta — la parte que se puede hacer mal

> La memoria se consulta **solo donde el tipo decide clasificación** (`findMatchingGroup`, `createGroup`), y **nunca donde el tipo es la huella del detector** (`isDuplicateIdentity`, `findOverlapConflict`, `recordOccurrence`).

Es la aplicación directa del principio que ADR-082 §3 dejó escrito: *"el registro es la huella de lo que el detector vio; el `type` del grupo es la clasificación que vale"*.

El diseño ingenuo —sobrescribir `occurrence.entityType` al entrar, antes del dedup— **rompe** ese invariante:

1. Los registros conservan `Address` (ADR-082 §3).
2. `reanalyze`: el detector emite `Address`, el override lo pasa a `Organization` **antes del dedup**.
3. El dedup compara `(Organization, …)` contra el registro `(Address, …)` → **no matchea**.
4. Entra como nueva → `findOverlapConflict` contra su propio grupo, bbox idéntico (ratio 1.0) y tipos distintos → **conflicto espurio del grupo consigo mismo en cada `reanalyze`**.

O sea, exactamente el modo de falla que ADR-082 §3 se escribió para evitar. Consultando solo en la clasificación, el dedup y la detección de conflictos siguen viendo el tipo crudo y **ADR-082 §3 no se toca**.

### 7. Ciclo de vida

- `typeCorrections` vive en `Session`, junto a `groups`/`rules`/`conflicts`. Muere con `closeSession` (que borra la sesión entera) y **sobrevive a `reopenSession`**, que es lo que hace falta para el escenario C — mismo tratamiento que los grupos y las ediciones del usuario (ADR-038 §2).
- `absorbedTypes` vive en el grupo: muere con él, y ahí toma el relevo el mapa.
- **En merge**: el grupo sobreviviente absorbe la unión de los dos `absorbedTypes` — pasaron a ser un solo grupo.
- **En split**: el grupo nuevo hereda una copia del `absorbedTypes` del original. Es la misma clasificación, partida en dos.

### 8. Qué NO cambia

- **Ningún contrato público.** `absorbedTypes` y `typeCorrections` son internos de `grouping-engine`, como `normalizedValues`/`aliasFrequency`. No salen en `EntityGroup`, ni en eventos, ni en el snapshot.
- **Ningún evento nuevo**, ningún cambio de payload.
- **`conflictWinnerIsNew` y el dedup no se tocan.**
- **Un solo módulo**: `grouping-engine`. R-1 se cumple con un PR.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Whitelist en `localStorage`, consultada por los detectores** (la propuesta original) | Tres problemas, cualquiera decisivo: (1) persiste contenido del documento en disco, contra `08` §10.2; (2) `localStorage` **no existe dentro de un Web Worker**, y NER corre en uno; (3) capas — el detector reporta lo que vio, la clasificación es de Grouping (ADR-011). En Grouping se resuelve una sola vez para los dos detectores. |
| **Solo `absorbedTypes`** | Más barato y no retiene ningún valor del documento, pero deja abierto el escenario C, que se dispara con "corregir → apagar NER → prender NER" (Contexto §2). |
| **Solo el mapa** | Obliga a escribir el matcheo por valor (exacto + difuso) desde cero, cuando `findMatchingGroup` ya lo tiene resuelto con las restricciones de ADR-073 puestas. Y se consultaría por ocurrencia en vez de por grupo creado. |
| **Difuso también para los tipos estructurados** | Es el defecto que ADR-073 corrigió: dos CUIT que difieren en un dígito dan 0.909 sobre un umbral de 0.88. Re-tipar en silencio por un falso positivo del difuso es peor que no re-tipar. |
| **Que la corrección cree una regla** | Las reglas deciden el **modo de reemplazo**, no la clasificación (ADR-012). Y `RuleScope` es `group｜type｜global`: no hay scope por valor. |

## Consecuencias

**Positivas**: los escenarios B y C se cierran; la corrección del usuario deja de ser un parche sobre lo ya agrupado y pasa a condicionar lo que venga; el costo medido es 0,19 ms por documento; no se persiste ni un byte del documento y no cambia ningún contrato.

**Negativas / riesgos asumidos**:

- **La memoria muere al cerrar el documento.** Reabrirlo obliga a re-corregir. Es el precio de §3 y está tomado a propósito: persistirla es lo que `08` §10.2 prohíbe.
- **El difuso puede re-tipar un valor parecido que el usuario no tocó**, dentro de los tres tipos de texto libre. Acotado por el mismo umbral que ya gobierna el agrupamiento: si dos valores fuzzy-matchean, el motor **ya los estaba poniendo en el mismo grupo** — o sea que la corrección se propaga exactamente al conjunto que ya se trataba como una sola entidad.
- **Registrar corrige todos los `normalizedValues` del grupo**, no solo el canónico. Es lo correcto (el grupo es sus alias), pero significa que corregir un grupo con muchos alias deja varias entradas.
- **Una corrección puede quedar "pegada"** dentro del documento: si el usuario corrige y después quiere el tipo original, tiene que corregir de vuelta (§5). No hay "olvidar la corrección" como acción propia.

## Validación

- **Escenario B**: reclasificar un grupo y después emitir una ocurrencia **nueva** del mismo valor con el tipo original ⇒ **un solo grupo**, el corregido, con dos members. Sin grupo paralelo y sin segundo token.
- **Escenario C**: reclasificar, `dropOccurrences` que borra el grupo, y re-emitir ⇒ el grupo nuevo nace con el **tipo corregido**.
- **Escenario A no regresiona**: re-emitir la ocurrencia idéntica sigue sin duplicar y sin crear conflicto (el test de ADR-082 §3 pasa sin cambios).
- **El difuso respeta ADR-073**: una variante de `Organization` con distancia 1 hereda la corrección; un `Phone`/`CUIT` con distancia 1 **no**.
- `addManualEntity` **no** deja entrada; una corrección posterior sobre ese grupo **sí**.
- Confirmar un conflicto sin cambiar el tipo no deja entrada.
- Ni `absorbedTypes` ni `typeCorrections` aparecen en `getSnapshot` ni en ningún payload de evento.

## Documentos afectados

- `core/Grouping_Engine.md` (§Matching, §13 caso nuevo, §14, §15).
- `architecture/08_Security_Model.md` §10.2: nota de que la memoria de reclasificación es RAM-only por documento, y por qué.
- Código, un solo módulo: `packages/anonymization-core/grouping-engine`.
