/**
 * `useAppPhase` — conecta `appPhase.ts` + `scanAdvance.ts` con los stores y el
 * reloj (ADR-087 §1/§6).
 *
 * Toda la decisión vive en los dos módulos puros; acá solo están las tres
 * cosas que no se pueden testear en Node: leer los stores, medir el tiempo
 * transcurrido desde el import, y latchear el `documentId` que ya soltó.
 */

import { useEffect, useRef, useState } from "react";

import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";

import { resolveAppPhase, type AppPhase } from "./appPhase.js";
import { shouldAdvanceFromScan } from "./scanAdvance.js";

/**
 * Cadencia del chequeo mientras la pantalla de escaneo está arriba.
 *
 * Hace falta un tick propio porque **dos de las tres condiciones de salida son
 * temporales** (piso y techo) y el tiempo no emite eventos: sin esto, un
 * documento cuyo `Detecting` no llega al 20 % se quedaría en la pantalla hasta
 * el próximo `PIPELINE_PROGRESS`, que en un OCR lento puede tardar mucho más
 * que el techo. 200 ms es imperceptible contra un piso de 1200 ms y no compite
 * con nada: el intervalo se limpia apenas la fase deja de ser `scan`.
 */
const SCAN_TICK_MS = 200;

export function useAppPhase(): AppPhase {
  const documentId = useDocumentStore((state) => state.id);
  const stage = usePipelineStore((state) => state.stage);
  const current = usePipelineStore((state) => state.current);
  const total = usePipelineStore((state) => state.total);

  const [advancedForDocumentId, setAdvancedForDocumentId] = useState<string | null>(null);
  // `startedAt` por documento: importar un segundo PDF tiene que volver a
  // contar desde cero, no arrastrar el reloj del anterior.
  const startedAtRef = useRef<{ documentId: string; at: number } | null>(null);

  if (documentId !== null && startedAtRef.current?.documentId !== documentId) {
    startedAtRef.current = { documentId, at: Date.now() };
  }

  const phase = resolveAppPhase({ documentId, advancedForDocumentId });

  useEffect(() => {
    if (phase !== "scan" || documentId === null) return;

    function check(): void {
      const startedAt = startedAtRef.current;
      if (startedAt === null || documentId === null) return;
      const elapsedMs = Date.now() - startedAt.at;
      if (shouldAdvanceFromScan({ stage, current, total, elapsedMs })) {
        setAdvancedForDocumentId(documentId);
      }
    }

    check();
    const timer = window.setInterval(check, SCAN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, documentId, stage, current, total]);

  return phase;
}
