<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,adr/ADR-177-Una-Entidad-Eliminada-No-Ocupa-Lugar.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-178 — Lo contenido se oculta solo si su contenedor se elimina

- **Estado**: Accepted
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante la revisión 5 del Hito 12.5 (REJECTED, B5-1). Eligió la opción **C**:
  lo que el usuario agregó a mano y quedó contenido en otra entidad se guarda a nombre de esa entidad y
  **se oculta solo** si ella desaparece. Es el mismo criterio que ADR-175 §1 aplica a un choque cuya
  detección desaparece.
- **Modifica**: ADR-117 (una ocurrencia manual contenida ya no se descarta: queda guardada) y completa
  ADR-177 (el orden de las acciones no cambia el resultado).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

ADR-177 hizo que una entidad eliminada no contenga lo que se agrega **después**. El orden inverso
seguía roto, y la revisión 5 lo reprodujo con el motor real:

1. Se detecta «Juan Perez».
2. El usuario agrega «Perez». La aparición que está adentro de «Juan Perez» se descarta como
   contenida (ADR-117) y no queda registrada en ningún lado. `manualOutcome` la cuenta como oculta.
3. El usuario elimina «Juan Perez». Esa aparición **queda a la vista**.
4. Un re-análisis vuelve a aplicar el literal (ADR-061 §5), y ahora sí se oculta.

El mismo par de acciones da un PDF distinto según el orden, y un re-análisis cambia qué se oculta.
Eso contradice ADR-177 §3 y ADR-038.

## Decisión

### 1. Una ocurrencia manual contenida queda guardada a nombre de su contenedor

Cuando una ocurrencia `source: Manual` cae contenida (ADR-117) en un registro **vivo** (ADR-177 §1),
no se descarta:

- se guarda en `Session.containedManualOccurrences`, un `Map` interno de `occurrenceId` del
  contenedor → ocurrencias contenidas;
- no se registra en `recordedOccurrences`, no crea grupo ni emite eventos: la tinta ya la tapa el
  contenedor;
- `manualOutcome` no cambia, porque anota el registro contenedor (ADR-176 §3);
- si re-emitir la misma ocurrencia (misma identidad) la vuelve a contener, no se guarda dos veces.

Una ocurrencia contenida que **no** es manual se sigue descartando como hasta ahora. Lo que el
detector encuentra adentro de otra entidad es un artefacto; el caso medido era una «I» dentro de
«Juez X.Y» (ADR-117).

### 2. Si el contenedor deja de estar vivo, lo guardado se re-procesa

Cuando un registro contenedor deja de estar vivo o sale de la sesión, sus ocurrencias guardadas se
sacan del `Map` y se **re-procesan** como si llegaran en ese momento, por el camino completo de
`processOccurrence`: dedup, paso 0, contención contra lo que sigue vivo, superposición y matching.
Así terminan agrupadas, contenidas en otro contenedor vivo, retenidas en un choque (ADR-174) o
suprimidas si su propio valor fue eliminado. Nunca se pierden en silencio.

Los caminos:

| Qué le pasa al contenedor | Qué pasa con lo guardado |
|---|---|
| `applyGroupRemove` de su grupo | se re-procesa |
| `dropOccurrences` borra el registro contenedor y el filtro **también** alcanza a la ocurrencia guardada (misma página con `pageIndices`, o misma fuente con `source`) | se descarta con él; la re-aplicación de literales tras el re-análisis la trae de vuelta (ADR-061 §5) |
| `dropOccurrences` borra el registro contenedor y el filtro **no** alcanza a la ocurrencia guardada | se re-procesa |
| Fusión, división o reclasificación | nada: el registro sigue vivo y la clave es su `occurrenceId` |

El re-proceso ocurre dentro de la misma operación y emite los eventos de siempre
(`ENTITY_GROUP_CREATED` o `ENTITY_GROUP_UPDATED`, `CONFLICT_DETECTED`), en el mismo punto de deshacer
que la eliminación (ADR-172). El orden es determinista: por contenedor en el orden de
`recordedOccurrences`, y dentro de cada contenedor en orden de llegada.

### 3. Vida del `Map`

Igual que `heldManualOccurrences`:
- entra en los puntos de restauración (ADR-172), así que deshacer una eliminación devuelve lo guardado
  a su contenedor;
- sobrevive a `reopenSession`;
- muere en `closeSession`;
- no sale en el snapshot.

### 4. El resultado no depende del orden

Con §1 y §2:
- "agrego «Perez» y elimino «Juan Perez»" termina igual que "elimino «Juan Perez» y agrego «Perez»":
  todas las apariciones de «Perez» quedan ocultas en el mismo grupo;
- un re-análisis posterior no cambia qué se oculta.

## Consecuencias

- Se cierra B5-1. El invariante de `Contracts.md` §3.5 pasa a cumplirse también **después** del
  agregado, no solo en el momento.
- No hay cambio de contrato: el estado nuevo es interno de Grouping.

## Documentación que cambia

- `core/Grouping_Engine.md`:
  - §13: caso 24 (nota) y casos nuevos 67 y 68;
  - §14: filas nuevas;
  - §15: 15z, y se marca 15y (N5-1 de la revisión 5).
- `roadmap/MVP.md`: fila 25 y la nota de la revisión 5.
