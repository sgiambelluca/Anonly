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
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { ShieldIcon } from "lucide-react";

import { usePipelineStore } from "../../store/pipeline.store.js";

import { CancelButton } from "./CancelButton.js";
import { ImportButton } from "./ImportButton.js";
import { PasswordDialog } from "./PasswordDialog.js";
import { PipelineStatus } from "./PipelineStatus.js";
import { SettingsButton } from "./SettingsButton.js";

export function Toolbar() {
  const stage = usePipelineStore((state) => state.stage);
  const isIdle = stage === PipelineStage.Idle;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-primary px-4">
      <div className="flex items-center gap-3">
        <ShieldIcon className="h-6 w-6 text-accent" aria-hidden />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Anonly</span>
          <span className="text-xs text-text-secondary">Anonimización documental local</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isIdle ? <ImportButton /> : <PipelineStatus />}
        <CancelButton />
        <SettingsButton />
      </div>
      <PasswordDialog />
    </header>
  );
}
