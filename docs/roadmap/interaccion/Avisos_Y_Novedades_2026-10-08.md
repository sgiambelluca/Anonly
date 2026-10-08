<!-- CONTEXT: scope=plan-ui | dependencias=ui/Components.md,ui/UX_Guidelines.md,adr/ADR-215-Los-Dialogos-De-Espacio-Justo-Y-De-Eliminar-Muestran-El-Resultado.md,adr/ADR-216-Las-Novedades-De-Cada-Version-Viajan-Con-La-Aplicacion.md,adr/ADR-207-Los-Menus-De-Entidades-Se-Mantienen-Dentro-Del-Area-Visible.md | audiencia=humanos+IA | fase=1.0.x -->

# Avisos y novedades — 2026-10-08

Tres cambios de interfaz pedidos por el humano el 2026-10-08 y aprobados sobre el lienzo de diseño
"Anonly — Popup de conflicto y changelog".

**Estado al 2026-10-08:** ADR y especificación escritos. El humano autorizó ese día la
implementación y decidió que los tres cambios salen en la **1.0.2**. Branch
`feat/avisos-y-novedades`, creada desde `develop`.

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
- Los specs E2E afectados, de a uno: `scenario-9-reanalyze-preserves-edits` y `toast-interaction`
  usan "Eliminar entidad".
- Capturas de la aplicación real en claro y oscuro de los tres cambios, a la vista del humano.

## Al preparar la 1.0.2

- La entrada de novedades de la 1.0.2 se escribe después de `pnpm run version`, como dice
  `RELEASING.md`. Hasta entonces el archivo llega a la 1.0.1, que es la versión vigente.
