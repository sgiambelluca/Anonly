/**
 * `zoomRenderScale.ts` — cómputo del `scale` efectivo que `PdfViewer`/
 * `ZoomControls` pasan a `actions.requestRender` (`ui/Components.md` §5.2/§5.5,
 * `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5: "scale = previewScale × zoom").
 *
 * `PREVIEW_SCALE_DEFAULT` replica el default **documentado** de
 * `RenderConfig.previewScale` (`docs/core/Render_Engine.md`: "readonly
 * previewScale: number; // default 1.0 (relativo a 72 DPI)"; mismo valor en
 * `packages/anonymization-core/src/config.ts`). `IAnonymizationCore`
 * (`core/Contracts.md` §3.5: `bus`/`engines`/`orchestrator`/`dispose`) no
 * expone `EngineConfig` a la UI de forma reactiva ni por getter, así que no
 * hay una fuente en runtime de la que leer el `previewScale` vigente — ver
 * la nota de ambigüedad en el reporte de este PR (Hito 10 PR7).
 */
export const PREVIEW_SCALE_DEFAULT = 1;

/** `scale` a pasar a `actions.requestRender(pageIndices, "preview", scale)` para un `zoom` dado. */
export function computeZoomRenderScale(
  zoom: number,
  previewScale: number = PREVIEW_SCALE_DEFAULT,
): number {
  return previewScale * zoom;
}
