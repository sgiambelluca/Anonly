<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-177 — Una entidad eliminada no ocupa lugar

- **Estado**: Accepted
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante la revisión 4 del Hito 12.5 (REJECTED). Para D1 eligió que una
  entidad eliminada **no ocupe lugar**, y que un agregado manual del mismo valor la **vuelva a traer**
  sin pasar por deshacer. Para D2 eligió que el motivo del export bloqueado sea **flotante y anclado a
  la derecha**.
- **Modifica**: ADR-171 §2, paso 5 (para qué se conservan los registros), ADR-176 §4 (qué olvida
  `liftRemoval`) y ADR-176 §1 (la ranura del motivo).
- **Relacionado con**: ADR-117 (contención), ADR-175 (retenidas), ADR-038 §3 (dedup por identidad).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

ADR-171 §2, paso 5, conserva los registros de una entidad eliminada para que el dedup por identidad
la reconozca. Pero esos registros viven en la misma lista, `recordedOccurrences`, que consultan otras
dos reglas que suponen que el registro **tapa tinta**:

- **Contención** (ADR-117, `findContainingRecord`): "esto cae adentro de algo que ya se oculta, así que
  no aporta nada".
- **Superposición** (`findOverlapConflict`): "esto choca con algo que ya se oculta, y hay que decidir
  quién gana".

Con una entidad eliminada, las dos suposiciones son falsas. La revisión 4 lo reprodujo con el motor
real:

- **B4-1.** Se detecta «Juan Perez», el usuario la elimina y después agrega «Perez» como Persona. El
  motor lo descarta como contenido: queda **a la vista** y se rompe el invariante de `Contracts.md` §3.5.
- **B4-2.** Se detecta un Email, el usuario lo elimina y después agrega «email juan@x.com.» como
  Persona. Nace un conflicto `heldManual` contra un grupo que no existe. El export queda bloqueado y
  "Resolver" no encuentra nada.

El planificador reprodujo además un tercer camino del mismo problema. ADR-176 §4 ya lo prohibía, pero
el código no lo cumple, y el test del caso 64 lo esquiva usando otra posición:

- **B4-0.** Se detecta «Juan Perez», el usuario la elimina y después vuelve a agregar «Juan Perez» en el
  mismo lugar. `liftRemoval` olvida solo los registros con `SUPPRESSED_GROUP_ID`. Los del grupo
  eliminado conservan su `groupId` original, así que el dedup los encuentra y descarta el agregado. El
  resultado es `groupIds: []` y el texto queda a la vista.

La supresión por valor (`removedValues`, ADR-171 §3) **ya** impide que un re-análisis traiga de vuelta
la entidad: el paso 0 de Matching descarta todo valor eliminado de cualquier fuente. Los registros
conservados no agregan protección; solo hacen que el descarte llegue por el dedup en vez de por el
paso 0.

## Decisión

### 1. Solo un registro vivo ocupa lugar

Un registro de `recordedOccurrences` está **vivo** si su `groupId` es un grupo que existe en la sesión
(`session.groups.has(rec.groupId)`). Eso excluye:

- los registros de un grupo eliminado (ADR-171);
- los registros suprimidos (`SUPPRESSED_GROUP_ID`, paso 0 de Matching y `winner: "detected"`).

`findContainingRecord` y `findOverlapConflict` consideran **solo registros vivos**. Rige para toda
ocurrencia, no solo para las manuales: una detección nueva que cae adentro de una entidad eliminada o
se superpone con ella tampoco se descarta ni genera conflicto.

El dedup por identidad (`findDuplicateAnnotation`) **sigue** mirando todos los registros, vivos o no.
Es lo que ADR-171 promete: una repetición exacta de algo eliminado o suprimido no vuelve.

La fusión y la división reasignan `rec.groupId` (ADR-176 §2), así que un registro de un grupo que
sigue existiendo nunca queda como no vivo por error.

### 2. Un agregado manual nuevo olvida los registros no vivos de su valor

Reemplaza a ADR-176 §4. `liftRemoval(documentId, value)` quita el valor normalizado de
`removedValues` **y** borra de `recordedOccurrences` todo registro **no vivo** con ese valor
normalizado, sea del grupo eliminado o suprimido. Los registros vivos no se tocan.

Así, volver a agregar a mano lo que se eliminó crea una **entidad nueva**. Se agrupa y se oculta en
todas sus apariciones, sin deshacer. Lo que tenía la entidad original, como el reemplazo escrito a
mano, la reclasificación o el género, no se recupera: para eso está deshacer (ADR-172). La
re-aplicación de literales tras un re-análisis (ADR-061 §5) sigue sin llamar a `liftRemoval`, así que
no la trae.

### 3. El flujo que resulta

| Qué hace el usuario | Qué pasa |
|---|---|
| Elimina «Juan Perez» y agrega «Perez» | «Perez» se agrupa como entidad nueva, también la aparición dentro de «Juan Perez». En el PDF queda «Juan [Persona N]». |
| Elimina un Email y agrega un texto superpuesto como Persona | Se agrupa como Persona, sin conflicto. |
| Elimina «Juan Perez» y lo vuelve a agregar | Entidad nueva; todas las apariciones se ocultan. |
| Elimina «Juan Perez» y re-analiza | No vuelve, por el paso 0 de Matching (sin cambios). |

### 4. El motivo del export bloqueado flota, anclado a la derecha

Reemplaza la "ranura fija con alto reservado" de ADR-176 §1 en `Components.md` §2.5:

- es un **globo flotante** debajo de "Exportar" (UX-10: un globo es flotante), siempre montado e
  invisible sin motivo, así que aparecer no mueve nada;
- se ancla al **borde derecho** del botón (`right-0`), para crecer hacia la izquierda, que es donde
  hay lugar;
- tiene un **ancho máximo** que entra en la ventana más angosta soportada, y el texto puede ocupar dos
  renglones;
- lleva **fondo, borde y sombra** de superficie, porque se superpone al contenido de abajo y tiene que
  leerse en los dos temas;
- el texto y "Resolver" no cambian.

## Consecuencias

- Una entidad eliminada deja de existir para el agrupamiento. Solo queda el recuerdo de su valor, para
  que un re-análisis no la traiga.
- Se cierran B4-0, B4-1 y B4-2. El invariante de `Contracts.md` §3.5 y la cláusula del caso 61 ("todo
  conflicto sin resolver apunta a un grupo que existe") vuelven a cumplirse por construcción.
- Sin cambio de contrato: ni tipos, ni eventos, ni firmas. Todo el cambio de comportamiento vive en
  `grouping-engine`, y la UI solo cambia la ranura.

## Documentación que cambia

- `adr/ADR-171` §2, paso 5, y `adr/ADR-176` §1 y §4: nota que remite acá.
- `core/Grouping_Engine.md`:
  - §6: comentarios de `applyGroupRemove` y `liftRemoval`;
  - §13: casos 24, 48, 61 (ampliado) y 64 (misma posición), y los casos nuevos 65 y 66;
  - §14: filas nuevas y la errata N4-1;
  - §15: 15y.
- `ui/Components.md` §2.5 y `ui/UX_Guidelines.md` §8.1: el globo flotante.
- `roadmap/MVP.md`: filas 23 y 24.
