/**
 * `Toolbar` (`ui/Components.md` §2.1).
 *
 * Sin props (lee `pipeline.store`). Sin acciones directas: delega en sus
 * hijos. Estados:
 * - `Idle`: solo `ImportButton`.
 * - resto: `PipelineStatus` (que internamente cubre el banner de `Failed`,
 *   ver `PipelineStatus.tsx`) + `CancelButton` (oculta su propio botón cuando
 *   no corresponde, ver `CancelButton.tsx`).
 * - `SettingsButton` siempre visible (`ui/UX_Guidelines.md` §2).
 *
 * `PasswordDialog` se monta siempre acá (no depende de `stage`): se abre sola
 * al recibir `PDF_PASSWORD_REQUIRED` vía su propia suscripción directa al bus.
 *
 * `ExportButton` (Hito 10 PR9) se monta igual que `CancelButton`: sin
 * condicional acá, decide su propia visibilidad (`stage === Ready`).
 *
 * `CloseDocumentButton` (ADR-051) se monta con el mismo criterio: sin
 * condicional acá, decide su propia visibilidad (documento activo + pipeline
 * detenido, `closeDocumentButtonVisibility.ts`).
 *
 * **Orden y agrupación** (ADR-087 §7): estado + "Cancelar" a la izquierda,
 * después el CTA ("Exportar"), y del otro lado de un separador el chrome del
 * documento ("Cerrar documento", settings). Antes los cuatro iban en una sola
 * fila con dos destructivos flanqueando el primario.
 */

import { PipelineStage } from "@anonly/anonymization-core";

import { usePipelineStore } from "../../store/pipeline.store.js";
import { Logo } from "../common/Logo.js";

import { CancelButton } from "./CancelButton.js";
import { CloseDocumentButton } from "./CloseDocumentButton.js";
import { ExportButton } from "./ExportButton.js";
import { ImportButton } from "./ImportButton.js";
import { PasswordDialog } from "./PasswordDialog.js";
import { PipelineStatus } from "./PipelineStatus.js";
import { SettingsButton } from "./SettingsButton.js";

export function Toolbar() {
  const stage = usePipelineStore((state) => state.stage);
  const isIdle = stage === PipelineStage.Idle;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-primary px-4">
      {/*
        `min-w-0` + `truncate`: sin esto el bloque del logo no encogía y los
        botones se le montaban encima en ventanas angostas. La bajada se oculta
        antes que el nombre — es contexto, no identidad.
      */}
      <div className="flex min-w-0 shrink items-center gap-3">
        <Logo size={26} className="shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">Anonly</span>
          <span className="hidden truncate text-sm text-text-secondary sm:block">
            Anonimización documental local
          </span>
        </div>
      </div>
      {/*
        Estado a la izquierda del bloque de acciones y con `min-w-0`, para que
        pueda encogerse en vez de empujar los botones fuera de la ventana
        (ADR-087 §7.1: el `min-w-[220px]` anterior dejaba la barra tapada por
        "Exportar" a 900 px).
      */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          {isIdle ? <ImportButton /> : <PipelineStatus />}
          <CancelButton />
        </div>
        <ExportButton />
        {/*
          Separador entre el CTA y el "chrome" del documento. Es lo que ADR-087
          §1 pedía al mandar "Cerrar documento" al menú de settings — separarlo
          del primario— pero sin el costo de esconderlo: **es el único camino
          para abrir otro PDF** (`ImportButton` solo se monta en `Idle`), así
          que enterrarlo en un menú haría más difícil el único acceso que hay.
        */}
        <div className="h-6 w-px shrink-0 bg-border" />
        <div className="flex shrink-0 items-center gap-1">
          <CloseDocumentButton />
          <SettingsButton />
        </div>
      </div>
      <PasswordDialog />
    </header>
  );
}
