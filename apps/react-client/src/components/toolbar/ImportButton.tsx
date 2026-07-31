/**
 * `ImportButton` (`ui/Components.md` §2.2).
 *
 * `<input type="file" accept="application/pdf">` oculto + botón estilizado.
 * Atajo `Cmd/Ctrl+O` (`ui/UX_Guidelines.md` §9).
 *
 * Fuera de alcance de este PR (decisión de scope documentada en el reporte):
 * "Drag&drop en todo el App" — requeriría tocar el layout de `App.tsx` más
 * allá del reemplazo de la Toolbar (`RightPanel`/Hero siguen siendo el
 * placeholder de PR1 según el alcance de esta tarea).
 *
 * La validación de que el archivo sea un PDF válido no se duplica acá: el
 * `accept` del input ya filtra en el picker, y el PDF Engine ya valida y
 * emite `PDF_INVALID` → `PIPELINE_FAILED` (manejado por `PipelineStatus`).
 */

import { UploadIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        inputRef.current?.click();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void actions.importDocument(file);
        }}
      />
      <Button variant="primary" onClick={() => inputRef.current?.click()}>
        <UploadIcon className="h-4 w-4" aria-hidden />
        Importar PDF
      </Button>
    </>
  );
}
