<!-- CONTEXT: scope=roadmap-handoff | dependencias=roadmap/MVP.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,ui/Components.md | audiencia=humanos+IA | fase=12.5 -->

# Hito 12.5 — Handoff: revisión 4 (REJECTED) y decisiones pendientes

Fecha: 2026-09-24, hora Argentina. Branch `redesign/ui-pruebas-de-usuario`, que se compara contra
`hardening/plan-2026-09` (**no** contra `main`). Este documento deja el estado para retomarlo en otra
computadora.

## 1. Dónde estamos

- Todas las filas del Hito 12.5 (`MVP.md`) están **hechas**, de la 1 a la 22.
- Por ronda de revisión, se escribió el ADR y los specs y después se implementó.

| Revisión | Veredicto | Cómo se cerró |
|---|---|---|
| 1 | REJECTED | ADR-173, ADR-174; filas 10-14 |
| 2 | REJECTED | ADR-175; filas 15-18 |
| 3 | REJECTED | ADR-176; filas 19-22 |
| 4 | **REJECTED** | pendiente: este documento |

- Gates en HEAD (`7d2ddbb`), Windows nativo:
  - `pnpm lint`, `pnpm typecheck` y `pnpm test:contract` (330/330): verde;
  - `pnpm test`: 2645 de 2646. La única falla es `apps/desktop-shell/src/__tests__/mac-packaging.test.ts`, que ya fallaba antes de esta branch porque `electron-builder.yml` queda con CRLF por `core.autocrlf=true`;
  - con la revisión 4, el typecheck pasa en cada commit de la ronda.
- Fallas previas a esta branch: `mac-packaging.test.ts` y los E2E `scenario-2` y `scenario-5` (N-8). Van en un commit aparte sobre `hardening/plan-2026-09`, no en esta branch.
- Tres `.snap` de ner, ocr y regex-engine aparecen modificados en el working tree de Windows. Solo difieren en los finales de línea: **no se commitean**.

## 2. Reporte de la revisión 4 (revisor, Opus)

> **Veredicto: REJECTED.** Los tres bloqueantes de la revisión 3 están cerrados en el caso que se describió.
> Pero el mismo agujero sigue abierto por otro camino: los registros de una entidad eliminada por el
> usuario (ADR-171) siguen participando en la contención y en la superposición. Eso rompe dos invariantes
> que ADR-176 da por cumplidos, y está reproducido con el motor real. Además, la ranura de `ExportButton`
> no cumple Components §2.5.

### Bloqueantes

**B4-1. Un agregado contenido en una entidad eliminada se pierde y rompe el invariante de Contracts §3.5.**

- **Dónde:** `grouping-engine/src/grouping.engine.ts`, en `findContainingRecord`, no descarta los registros cuyo grupo fue eliminado.
- **Probe:** se detecta la Persona «Juan Perez»; el usuario la elimina; después agrega `Perez` como Persona, contenido en esa posición.
  - `manualOutcome` devuelve `{"groupIds":[],"heldConflictIds":[]}` y no queda ningún grupo.
  - La ocurrencia se descarta como "contenida" en algo que ya no se oculta, así que «Perez» queda **a la vista**.
  - Si es la única aparición, la UI muestra "No se pudo agregar". Si hay otras, el toast cuenta esta como "oculta", y es falso.
- **Qué incumple:** el invariante `occurrenceCount > 0 ⇒ alguna lista no vacía` (`Contracts.md` §3.5).
- **Hueco de spec:** ADR-176 §3 dice que el invariante se cumple por construcción, porque `addManualEntity` levanta la supresión. Pero `liftRemoval` levanta solo el valor agregado (`perez`), no el que lo contiene (`juan perez`).

**B4-2. Un choque contra una entidad eliminada queda pendiente sobre un grupo que no existe, y el export se traba.**

- **Dónde:** `grouping.engine.ts`, en `findOverlapConflict`, que recorre también los registros de grupos eliminados.
- **Probe:** se detecta un Email; el usuario lo elimina; después agrega «email juan@x.com.» como Persona.
  - El agregado manual pierde contra el registro de Regex eliminado y nace un conflicto `heldManual` con `groupId` apuntando al grupo eliminado: `{"r":false,"h":true,"exists":false}`.
- **Qué incumple:** el invariante ampliado del caso 61 de Grouping: "todo conflicto sin resolver apunta a un grupo que existe".
- **Consecuencia en la UI:** si el usuario cierra el diálogo sin elegir:
  - `exportBlockReason` deshabilita Exportar;
  - "Resolver" no encuentra fila y no hace nada;
  - el aviso de ADR-175 §5 no aparece;
  - no hay ⚠ en ninguna fila.
  - La única salida es deshacer.
- **Tests:** el test del caso 61 no cruza una eliminación con un agregado posterior que se superponga.
- **Hueco de spec:** hay que decidir si los registros de grupos eliminados participan en la contención y en la superposición. Es el mismo problema de fondo que B4-1.

**B4-3. La ranura del motivo en `ExportButton` no reserva alto y se corta por la derecha.**

- **Qué pide el spec:** Components §2.5, "ranura fija (UX-10, alto reservado siempre)".
- **Qué hace el código:** `apps/react-client/src/components/toolbar/ExportButton.tsx` la pone `absolute left-0 top-full`. No reserva alto: cuando aparece, se superpone con el contenido debajo de la barra (`h-14`). Es un desvío del spec (R-15).
- **Además, probablemente se corta.** La ranura se ancla al borde izquierdo del botón y es `whitespace-nowrap`:
  - el texto mide unos 276 px y "Resolver" unos 48 px, en total unos 330 px;
  - desde el botón hasta el borde de la ventana quedan unos 200 px;
  - la raíz `h-screen overflow-hidden` recorta el resto, así que "Resolver" quedaría fuera de pantalla.
  - Es un cálculo con métricas de fuente. No se pudo ver renderizado.
- **Lo que sí cumple:** no desplaza nada, porque siempre está montada.
- **Salida posible:** anclarla a la derecha, y además reservar el alto o hacer una errata de §2.5 que acepte la ranura flotante.

### No bloqueante

- **N4-1.** El test `manualOutcome is cleared on reopenSession and absent from the snapshot` figura en `Grouping_Engine.md` §14 como `edge.test.ts`, pero está en `grouping-engine/src/__tests__/unit.test.ts:1836`. El nombre es exacto; lo que no coincide es el archivo.

### Verificado y bien

- **Export bloqueado (revisión 3, bloqueante 1):** `runExport` se niega con `warn` y `EXPORT_UNRESOLVED_CONFLICTS`, sin cambiar de etapa (caso 46). En la UI, el botón y `Cmd/Ctrl+E` quedan deshabilitados.
- **Fusión y división (revisión 3, bloqueante 2):** reapuntan los conflictos pendientes. El caso 61 las incluye.
- **Contención con el contenedor vivo (revisión 3, bloqueante 3):** cerrado, con el caso 45 y el caso 63.
- **El façade ya no compara valores:** delega en `grouping.manualOutcome`.
- **Typecheck por commit (ADR-176 §5):** verde en `80ab79e`, `9e1957a`, `50f7edc`, `edc223b` y `f9fb9c9`.
- **Reglas duras:**
  - un commit = un módulo;
  - sin `any`, `console` ni `export default` en `packages/`;
  - sin imports entre motores;
  - existen todos los nombres de §14.
- **Cobertura:** `grouping-engine/src` 95,92% y `orchestrator.ts` 93,4%.
- **UX-11:** bien.

### Estado de los hallazgos anteriores

| Hallazgo | Estado |
|---|---|
| R1 B-1 y B-2 | Cerrados |
| R1 B-3 | **Abierto**: B4-1 y B4-2 |
| R1 N-1 | Aceptado por ADR-176 §5; esta ronda queda en verde commit por commit |
| R1 N-2 a N-7 | Cerrados |
| R1 N-8 | Fuera de alcance: ya fallaba en la base |
| R2, bloqueantes 1 y 2 | Cerrados |
| R2, no bloqueantes 1 a 7 | Cerrados |
| R2, decisiones (a), (b) y (c) | (a) y (b) las reemplazaron ADR-175 y ADR-176; (c) quedó registrada |
| R3, bloqueantes 1 y 2 | Cerrados |
| R3, bloqueante 3 | Cerrado con el contenedor vivo; abierto con el contenedor eliminado (B4-1) |
| R3, no bloqueantes 1 a 3 | Cerrados |

Los probes del revisor quedaron en el scratchpad de la sesión (`probe4/r4.probe.ts` y `layout.html`), que no viaja con el repo. Para retomar, se reproducen desde las descripciones de B4-1 y B4-2 de arriba.

## 3. Decisiones que tiene que tomar el humano

### D1. ¿Una entidad eliminada ocupa lugar? (cierra B4-1 y B4-2)

Cuando el usuario elimina una entidad, ADR-171 §2 paso 5 conserva sus registros **solo** para que el dedup
por identidad no la traiga de vuelta en un re-análisis. Hoy esos registros además participan en la
contención (ADR-117) y en la superposición (conflictos), y de ahí salen los dos bloqueantes.

| Opción | Qué pasa |
|---|---|
| **A. No ocupan lugar** (propuesta del planificador) | Una entidad eliminada no oculta nada, así que no puede contener ni ganarle a lo que se marque después: lo marcado se agrupa normal. Los registros siguen sirviendo **solo** para el dedup por identidad, que es lo único que promete ADR-171. |
| B. Preguntar al marcar | Si lo marcado cae sobre algo eliminado, un diálogo pregunta si se quiere revertir la eliminación. Da más control, a cambio de un paso más. |

Con **A**, el trabajo es:
- una errata de ADR-171, o un ADR-177: los registros de grupos eliminados participan **solo** del dedup por identidad y quedan fuera de `findContainingRecord` y de `findOverlapConflict`. Lo mismo para detecciones nuevas, no solo para las manuales;
- casos nuevos en Grouping:
  - contenido en una entidad eliminada → se agrupa;
  - superposición con una entidad eliminada → sin conflicto;
  - el test del caso 61 cruza una eliminación con un agregado posterior.

### D2. El motivo debajo de "Exportar" (cierra B4-3)

| Opción | Qué pasa |
|---|---|
| **A. Flotante a la derecha** (propuesta del planificador) | Sigue flotando, sin agrandar la barra ni mover nada, pero anclado al borde derecho (`right-0`) y con un ancho máximo que entra en pantalla. Errata de Components §2.5, que pedía alto reservado. |
| B. Franja reservada fija | Una franja de alto fijo debajo de la barra, siempre presente. No tapa nada, pero ocupa espacio permanente. |
| C. Tooltip en el botón | El motivo aparece al pasar el mouse sobre Exportar deshabilitado, y "Resolver" queda solo en el aviso de ADR-175 §5. Es más limpio y menos visible. |

### Sin decisión, solo errata

- **N4-1:** corregir en `Grouping_Engine.md` §14 el archivo del test de `manualOutcome` (`unit.test.ts`).

## 4. Cómo retomar

1. `git fetch && git checkout redesign/ui-pruebas-de-usuario`, y después `pnpm install`. En Windows nativo hay que refrescar el PATH antes de los gates. En macOS o Linux se corre directo.
2. Con D1 y D2 decididas, el planificador escribe el ADR o las erratas y los specs y los commitea antes que el código (R-2, R-19).
3. Implementación:
   - Core: agente `implementador` (Sonnet), solo `grouping-engine`;
   - UI: agente general-purpose (Sonnet), solo `apps/react-client`, para `ExportButton`.
   Un commit por módulo, typecheck en cada commit, y los cuatro gates antes de dar la tarea por lista.
4. Revisión 5 con el `revisor` (Opus), sobre `git diff hardening/plan-2026-09...redesign/ui-pruebas-de-usuario`.
5. Con APPROVED: el PR va contra `hardening/plan-2026-09`, **no** contra `main`.
6. Aparte, sobre `hardening/plan-2026-09`: arreglar `mac-packaging.test.ts` (CRLF) y los E2E `scenario-2` y `scenario-5`.
