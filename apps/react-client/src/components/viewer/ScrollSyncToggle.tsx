/**
 * `ScrollSyncToggle` (`ui/Components.md` §5.6, ADR-054 §2).
 *
 * Control **del visor**, hermano de `ZoomControls` — vive en la barra del
 * visor (`App.tsx`), no en el `Toolbar` (acciones sobre el documento) ni en
 * `SettingsDialog` (configuración de procesamiento). Prende/apaga
 * `settings.scrollSyncEnabled` (persistido en `localStorage`, default
 * `false`) directo, sin diálogo de confirmación: a diferencia de
 * `nerEnabled`/`ocrLanguages`, esto no dispara un `reanalyze` ni afecta el
 * resultado de detección — es una preferencia de visualización pura.
 *
 * Visible solo en anchos `≥ lg` (`hidden lg:flex`, misma media query con la
 * que `SideBySideViewer` alterna a tabs): con un solo panel visible a la vez,
 * sincronizar dos paneles no significa nada. Ocultarse **no** apaga la
 * preferencia (ADR-054 §2, §4 caso 2): el valor persiste y, al volver a
 * ancho `≥ lg`, `SideBySideViewer`/`PageVirtualizer` ya la aplican solos
 * (el `ResizeObserver` de `PageVirtualizer` realinea el panel que se vuelve
 * visible si la sincronización sigue prendida) — este componente no necesita
 * lógica extra para ese caso.
 */

import { Link2Icon, Link2OffIcon } from "lucide-react";

import { useSettingsStore } from "../../store/settings.store.js";
import { Button } from "../common/Button.js";
import { Tooltip } from "../common/Tooltip.js";

function toggleScrollSync(): void {
  const enabled = useSettingsStore.getState().scrollSyncEnabled;
  useSettingsStore.setState({ scrollSyncEnabled: !enabled });
  useSettingsStore.getState().persist();
}

export function ScrollSyncToggle() {
  const scrollSyncEnabled = useSettingsStore((state) => state.scrollSyncEnabled);
  const label = scrollSyncEnabled
    ? "Desincronizar scroll de los paneles"
    : "Sincronizar scroll de los paneles";

  return (
    <div className="hidden lg:flex">
      <Tooltip content={label}>
        <Button
          variant={scrollSyncEnabled ? "secondary" : "ghost"}
          size="sm"
          aria-label={label}
          aria-pressed={scrollSyncEnabled}
          onClick={toggleScrollSync}
        >
          {scrollSyncEnabled ? (
            <Link2Icon className="h-4 w-4" aria-hidden />
          ) : (
            <Link2OffIcon className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </Tooltip>
    </div>
  );
}
