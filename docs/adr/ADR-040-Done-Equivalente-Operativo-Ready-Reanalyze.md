<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Contracts.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,ui/Components.md | audiencia=humanos+IA | fase=10 -->

# ADR-040 — `Done` como equivalente operativo de `Ready`: `reanalyze` acepta el estado post-export

- **Estado**: Accepted (amenda la precondición de stage de ADR-038)
- **Fecha**: 2026-07-22
- **Decidido por**: El humano, sobre el gap latente destapado por el bug #7 del Escenario 1 E2E (Hito 10 PR10, `roadmap/Hito10_Observaciones_Revision.md`)
- **Relacionado con**: ADR-038 (precondición `stage ∈ {Ready, Failed}` de `reanalyze`), `Orchestrator.md` §8/§13.21

## Contexto

Tras un export exitoso, el Orchestrator transiciona `stage` a `PipelineStage.Done`
(`EXPORT_FINISHED` → `Done`, `Orchestrator.md` §8) y **no existe ninguna transición de salida**
de `Done` salvo un nuevo export (`Exporting` → `Done` otra vez). El documento sigue abierto y
plenamente funcional en `Done`: la edición de grupos (eventos `ui` → Grouping) y el re-export
(`enqueueExport` no valida stage) funcionan. Pero `reanalyze` — la vía por la que `SettingsDialog`
aplica cambios de NER/idiomas OCR con documento abierto (ADR-038 §7) — exige
`stage ∈ {Ready, Failed}` (ADR-038 "Precondiciones"; `Orchestrator.md` §13.21;
`orchestrator.ts#reanalyze`). Consecuencia: **cambiar el toggle de NER o los idiomas de OCR
después de haber exportado rechaza con `InvalidInputError`** — para el usuario, el diálogo de
settings simplemente no surte efecto. El gap quedó registrado al resolver el bug #7 (la UI ahora
muestra `ExportButton` también en `Done` — `Components.md` §2.1/§2.5 — lo que hace el estado
post-export más habitado, no menos).

## Decisión

`Done` se define como **"`Ready` con un export ya completado"**: un estado informativo para la UI
(`PipelineStatus` puede mostrar "Completado"), **no** un estado que restrinja operaciones. En
concreto:

1. La precondición de `reanalyze` pasa de `stage ∈ {Ready, Failed}` a
   **`stage ∈ {Ready, Done, Failed}`** (`Orchestrator.md` §13.21; guard en
   `orchestrator.ts#reanalyze` + mensaje de error actualizado). La propiedad de auto-rechazo de
   un `reanalyze`/`importDocument` concurrente se preserva intacta: durante una corrida el stage
   está en `Detecting`/`OCRing`/`Exporting`/etc., ninguno de los tres aceptados.
2. Ninguna otra transición ni comportamiento cambia: no se agrega `Done → Ready`; de `Done` se
   sale por `reanalyze` (→ `Detecting`/`OCRing`/`Grouping`, y al terminar → `Ready`, como
   siempre), por un nuevo export (→ `Exporting` → `Done`) o por `closeDocument`. `EXPORT_FAILED`
   sigue llevando a `Failed` vía `failPipeline` — y `reanalyze` ya aceptaba `Failed`.
3. `PipelineStage` (Contracts.md §6) no cambia: mismos valores, misma semántica de emisión. El
   cambio es solo la relajación (compatible hacia atrás) de una precondición de
   `IPipelineOrchestrator.reanalyze`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| (a) Volver a `Ready` tras `EXPORT_FINISHED` (eliminar `Done` del flujo) | Misma cantidad de código (una línea), pero superficie de docs mucho mayor (`06_Pipeline.md` §13, `UX_Guidelines.md` §7.1, `Components.md` §2.1/§2.4/§2.5 recién reconciliados) y deja `PipelineStage.Done` como valor muerto del enum — un wart de contrato. Además pierde el estado informativo "Completado" del toolbar sin ganancia funcional. |
| (c) Aceptar la limitación para MVP | La falla es silenciosa para el usuario (Settings post-export "no hace nada"); mitigarla en UI (deshabilitar el form en `Done`) agrega estado especial para preservar una restricción que no protege nada. |

## Consecuencias

**Positivas**: `SettingsDialog` post-export vuelve a funcionar sin tocar la UI; cambio de una
línea + tests en `orchestrator.ts`; sin cambio de tipos ni eventos; la reconciliación de UI del
bug #7 (`{Ready, Done}` en §2.1/§2.5) queda semánticamente consistente — `Done` es un `Ready`
decorado.

**Negativas**: `PipelineStatus` puede mostrar "Completado" mientras el usuario ya editó grupos
después del export (el rótulo refiere a un export que quizá quedó desactualizado) — cosmético,
aceptado; un `reanalyze` desde `Done` lo resuelve solo (al terminar queda `Ready`).

## Implementación

Un solo módulo (`packages/anonymization-core/src/orchestrator.ts` — el guard de `reanalyze`) +
tests (`Orchestrator.md` §14: `reanalyze accepted from Done stage`). Commit propio, separado de
los fixes de los bugs #6/#7 (R-1). Spec: `Orchestrator.md` v1.3.0 (§13.21, §14).

## Referencias

- `core/Orchestrator.md` §8, §13.21, §14 — `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` "Precondiciones"
- `ui/Components.md` §2.1/§2.5 (reconciliación del bug #7) — `roadmap/Hito10_Observaciones_Revision.md` (gap y bug #7)
