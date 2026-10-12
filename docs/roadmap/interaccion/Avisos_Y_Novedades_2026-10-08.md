<!-- CONTEXT: scope=plan-ui | dependencias=ui/Components.md,ui/UX_Guidelines.md,adr/ADR-215-Los-Dialogos-De-Espacio-Justo-Y-De-Eliminar-Muestran-El-Resultado.md,adr/ADR-216-Las-Novedades-De-Cada-Version-Viajan-Con-La-Aplicacion.md,adr/ADR-207-Los-Menus-De-Entidades-Se-Mantienen-Dentro-Del-Area-Visible.md | audiencia=humanos+IA | fase=1.0.x -->

# Avisos y novedades — 2026-10-08

Tres cambios de interfaz pedidos por el humano el 2026-10-08 y aprobados sobre el lienzo de diseño
"Anonly — Popup de conflicto y changelog".

**Estado al 2026-10-08:** implementado y aprobado por el revisor. El humano autorizó ese día la
implementación, decidió que los tres cambios salen en la **1.0.2** y, con la aprobación del revisor,
el commit, el push y el PR hacia `develop`. Branch `feat/avisos-y-novedades`, creada desde `develop`.
El registro está al final.

## Qué entra

| # | Cambio | Decisión | Spec |
|---|---|---|---|
| 1 | El diálogo del aviso de espacio justo muestra el resultado de cada salida y aplica la elegida | ADR-215 §1 | `ui/Components.md` §3.3b |
| 2 | "Eliminar entidad" confirma con un diálogo propio | ADR-215 §2 | `ui/Components.md` §3.5b |
| 3 | La versión del pie de inicio abre "Novedades" | ADR-216 | `ui/Components.md` §2.9b |

Todo vive en `apps/react-client`. No toca `Contracts.md`, el Core ni los motores, y no agrega
dependencias ni conexiones.

## Tareas

Las implementa un agente `general-purpose` con `model: "sonnet"`, con las reglas de
`.claude/agents/implementador.md`. El revisor se lanza una vez, con las seis listas.

1. **Piezas compartidas** (ADR-215 §3): la prop `icon` de `Dialog` y `ContextPreview` en su propio
   archivo, con sus tres dibujos. `EditReplacementDialog` pasa a usarlo sin cambiar lo que muestra.
2. **Diálogo de espacio justo** (ADR-215 §1), con su lógica en un `.ts` testeable y el toast de
   "Dejarlo a la vista".
3. **`RemoveEntityDialog`** (ADR-215 §2). `removeConfirmMessage` y su test se retiran.
4. **`releaseNotes.ts`** con el contenido inicial de ADR-216 §4 y el test de ADR-216 §5.
5. **`ReleaseNotesMenu`** y el botón de versión del pie (ADR-216 §1 y §2).
6. **Un changeset** de tipo `patch` para `@anonly/react-client`, con una línea por cambio.

## Antes de la revisión

- Subset de gates de `CLAUDE.md`.
- Los specs E2E afectados, de a uno: `toast-interaction` usa "Eliminar entidad", y
  `scenario-9-reanalyze-preserves-edits` pasa por el pie de inicio ("Acerca de…").
- Capturas de la aplicación real en claro y oscuro de los tres cambios, a la vista del humano.

## Registro

- **Capturas al humano** (app de escritorio, claro y oscuro, con un PDF de prueba ficticio): las
  aprobó y pidió sacar la 0.9.2 de la lista. Desde entonces "Novedades" muestra solo versiones
  estables (ADR-216 §4).
- **Primera revisión: REJECTED**, con los cinco gates en verde. Cuatro bloqueantes: texto de 12 px en
  el menú de novedades, un test que fijaba la lista de versiones y rompía el release siguiente, el
  rótulo de páginas sin tope, y contraste por debajo de 4.5:1. El planificador cerró los huecos en
  ADR-215 §1 y §2 y en ADR-216 §2 y §5 antes de los arreglos.
- **Segunda revisión: APPROVED.** `pnpm lint`, `pnpm typecheck`, `pnpm test` (3974 tests),
  `pnpm test:contract` (345) y `pnpm format:check` en verde, en Windows nativo.
- **E2E** sobre el build de la branch, de a uno: `toast-interaction` (2 de 2) y
  `scenario-9-reanalyze-preserves-edits` (1 de 1).
- **Deuda anotada por el revisor**, anterior a este lote: el aro del radio no elegido de
  `ConflictDialog`, que este diálogo reutiliza, queda en 2,27:1 en claro; y `UnreadablePageStrip`
  todavía usa texto de 12 px, contra `UX_Guidelines.md` §9.

## Al preparar la 1.0.2

- La entrada de novedades de la 1.0.2 se escribe después de `pnpm run version`, como dice
  `RELEASING.md`. Hasta entonces el archivo llega a la 1.0.1, que es la versión vigente.
