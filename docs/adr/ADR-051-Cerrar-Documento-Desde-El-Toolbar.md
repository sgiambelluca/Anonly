<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/React_Client.md,ui/UX_Guidelines.md,core/Orchestrator.md,architecture/07_Performance_Strategy.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md | audiencia=humanos+IA | fase=10 -->

# ADR-051 — Cerrar un documento desde el Toolbar (el Escenario 7 no era ejercitable)

- **Estado**: Accepted (opción ratificada por el humano el 2026-07-30: control en el `Toolbar` **con** `ConfirmDialog`)
- **Fecha**: 2026-07-30
- **Decidido por**: El planificador, sobre un gap de producto que implementador y revisor confirmaron por separado al cerrar el lote de PR17.
- **Relacionado con**: ADR-048 §3 (asumía que el Escenario 7 era ejercitable con lo que ya existía — **este ADR corrige ese supuesto**), ADR-036 §7 (`ConfirmDialog` como componente común), `07_Performance_Strategy.md` §11.3 item 7 y §11.4 (el gate `test:leak` de Hito 11, que choca con la misma pared)

> Convención de citas: `ADR-051 §N` refiere a **Decisión §N**.

## Contexto

`actions.closeDocument()` existe y funciona, pero en `apps/react-client/src/` se invoca desde **exactamente dos** lugares: `PasswordDialog.tsx` (al cancelar el diálogo de contraseña) y `PipelineStatus.tsx` (el botón "Cerrar documento" del banner de error fatal, que solo se renderiza con `stage === Failed`).

Consecuencia: **un documento que carga bien y llega a `Ready` no se puede cerrar desde la UI**. La única salida es recargar la pestaña. Y como `Orchestrator#validateImportInput` exige cerrar el documento activo antes de importar otro (`Orchestrator.md` §13 caso 12), tampoco se puede abrir un segundo PDF sin recargar. No es un problema de test: es el flujo normal de cualquiera que quiera anonimizar dos documentos seguidos.

De ahí salen dos bloqueos concretos:

1. **Escenario 7 de `07` §11.3** ("abrir y cerrar 10 documentos") no es ejercitable. ADR-048 §3 lo dio por ejercitable con lo existente y repartió el escenario entre E2E (flujo) y `test:leak` (métrica); ese reparto sigue siendo correcto, pero el supuesto de que el ciclo open/close ya existía en la UI era falso.
2. **El gate `test:leak` de Hito 11** (10 ciclos open/close midiendo memoria contra baseline) choca con la misma pared: sin control de cierre no hay ciclo que medir.

El revisor descartó la salida barata de reinterpretar el escenario sobre un flujo de cierre existente: el único disponible es el banner de `Failed`, y llegar ahí con `corrupt.pdf` falla en `Extracting` — nunca se genera preview ni se retienen los recursos cuya liberación el escenario quiere observar. Un ciclo que no carga nada no prueba que cerrar libere algo.

## Decisión

### 1. `CloseDocumentButton` en el `Toolbar`

Componente nuevo en `components/toolbar/`, hermano de `CancelButton`/`ExportButton`.

- **Visible**: cuando hay documento activo y `stage ∈ {Ready, Done, Failed, Cancelled}` — es decir, cuando el pipeline no está corriendo. Durante una corrida el control correcto es `CancelButton` (§2.4), no cerrar: cerrar a mitad de pipeline es "cancelar + liberar" (`Orchestrator.md` §13 caso 11) y ofrecer dos botones para eso multiplica los caminos sin agregar capacidad.
- **Acción**: abre `ConfirmDialog` → `actions.closeDocument()`.
- **Atajo**: `Cmd/Ctrl+W` **no** se usa (lo captura el navegador). Sin atajo en MVP.
- **ARIA**: `aria-label="Cerrar documento"`.

### 2. Con `ConfirmDialog`, siempre

Cerrar descarta todo el trabajo del usuario —grupos editados, reglas creadas, merges manuales— sin ninguna vuelta atrás: no hay undo ni persistencia entre sesiones (el Core no guarda nada en disco por diseño, ADR-002). Texto: **"¿Cerrar el documento? Se perderán las ediciones y reglas de esta sesión."**, confirmar/cancelar.

Es el mismo criterio que ya rige a `CancelButton` (§2.4) y a "Eliminar grupo" (§3.x): toda acción destructiva sin undo pasa por `ConfirmDialog`. La excepción explícita sigue siendo el banner de `Failed`, donde "Cerrar documento" cierra directo — ahí no hay ediciones que perder.

### 3. El banner de `Failed` no se toca

`PipelineStatus` conserva su botón "Cerrar documento" sin confirmación. Son dos controles con el mismo destino y distinta semántica, y así queda documentado en `Components.md` §2.3/§2.8 para que nadie los unifique después.

### 4. Regla 9 de `Components.md` §13 aplica

`CloseDocumentButton` es exactamente el patrón del bug #7: gate de visibilidad por `stage` + diálogo hijo controlado por estado local. El gate condiciona el **botón**, nunca la vida del diálogo abierto — `if (!visible && !open) return null`. Sin esto, un `PIPELINE_STAGE_CHANGED` por debajo desmontaría el `ConfirmDialog` a mitad de la confirmación.

### 5. Escenario 7 y `test:leak`

Con el control disponible, el Escenario 7 se implementa como lo definió ADR-048 §3 (flujo y limpieza observable, sin medir bytes) y el gate `test:leak` de Hito 11 hereda un ciclo open/close real. `07` §11.3 item 7 se anota con la dependencia de este ADR.

### 6. Alcance

Un solo PR de `apps/react-client` (**PR 17.7**): componente nuevo + su render en `Toolbar` + tests. Cero cambios en `packages/` — `closeDocument` ya existe en el façade, en `actions.ts` y en el Orchestrator, y hace exactamente lo que hace falta (`Orchestrator.md` §13 caso 11: cancela, libera y limpia). El des-`fixme` del Escenario 7 viaja en el mismo PR: es su evidencia.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Cerrar sin `ConfirmDialog`** | Un click accidental descarta ediciones irrecuperables. Rompe la convención ya establecida para acciones destructivas (`CancelButton`, "Eliminar grupo", `deleteRule`), y el ahorro es un componente que ya existe y ya está wireado. |
| **Reinterpretar el Escenario 7 sobre el flujo de cierre existente** (banner de `Failed`) | Solo se llega con un PDF que falla en `Extracting`: nunca hay preview, blob URLs ni proxies cargados, o sea que el ciclo no ejercita nada de lo que el escenario quiere ver liberado. Verificado por el revisor. |
| **Diferir a v1.0 como deuda** | Deja el Escenario 7 en `fixme`, traslada el bloqueo al gate `test:leak` de Hito 11, y sobre todo deja en producción un flujo donde abrir un segundo documento exige recargar la pestaña. |
| **Cerrar implícitamente al importar otro documento** | Contradice `Orchestrator.md` §13 caso 12 (`InvalidInputError` explícito si hay documento activo) y descarta el trabajo del usuario sin preguntar, que es justo lo que §2 quiere evitar. |

## Consecuencias

**Positivas**: se puede anonimizar más de un documento por sesión sin recargar; el Escenario 7 y el gate `test:leak` de Hito 11 quedan desbloqueados; el ciclo open/close pasa a ser un camino ejercitado en CI, que es donde se detectan los leaks de blob URLs y de proxies por worker.

**Negativas**: un control más en un `Toolbar` que ya tiene cuatro; hay que cuidar que "Cerrar" y "Cancelar" no se confundan visualmente (`UX_Guidelines.md`: jerarquía y color — `Cancelar` es la acción del pipeline en curso, `Cerrar` la del documento).

**Neutras**: ningún cambio en `packages/`, ni en el Core, ni en contratos de eventos. `ADR-048` §3 conserva su reparto del Escenario 7; lo que se corrige es su supuesto de partida.

## Docs actualizados por este ADR

- `ui/Components.md`: §1 (árbol), §2.1 (estados del `Toolbar`), §2.8 nuevo (`CloseDocumentButton`), §12 (fila del mapeo componente→Core).
- `ui/React_Client.md`: §2 (árbol de `components/toolbar/`) y la tabla de señales→acción UI.
- `architecture/07_Performance_Strategy.md` §11.3 item 7: dependencia de este ADR.
- `roadmap/MVP.md` y `adr/ADR-038` §8: PR 17.7.
- `roadmap/Hito10_Observaciones_Revision.md`: cierre de la decisión abierta.

## Validación

- Escenario 7 E2E sin `fixme`: 10 ciclos importar→`Ready`→cerrar, verificando por ciclo que el estado queda limpio (sin documento activo, sin preview, sin blob URLs vivos) y que el ciclo 10 se comporta como el 1.
- Tras cerrar, `ImportButton` permite importar otro PDF sin recargar la pestaña (hoy: `InvalidInputError`).
- El `ConfirmDialog` sobrevive a un cambio de `stage` por debajo (regla 9 de §13).
- Gates: `pnpm lint && pnpm typecheck && pnpm test`, y `pnpm test:e2e` (con `pnpm assets:mirror` previo).

## Referencias

- `ui/Components.md` §2.1/§2.3/§2.4/§2.8/§12/§13 regla 9 — `ui/React_Client.md` §2/§4 — `ui/UX_Guidelines.md` §2/§7.1
- `core/Orchestrator.md` §13 casos 11 y 12 — `architecture/07_Performance_Strategy.md` §11.3 item 7, §11.4 (`test:leak`)
- `adr/ADR-036` §7 (`ConfirmDialog`) — `adr/ADR-048` §3
- Código: `apps/react-client/src/components/toolbar/` (`Toolbar.tsx`, `PipelineStatus.tsx`, `PasswordDialog.tsx`) — `apps/react-client/src/core-adapter/actions.ts` (`closeDocument`)
