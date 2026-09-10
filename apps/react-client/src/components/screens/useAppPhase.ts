/**
 * `useAppPhase` — conecta `appPhase.ts` + `scanAdvance.ts` con los stores y el
 * reloj (ADR-087 §1, ADR-150, ADR-151).
 *
 * Toda la decisión vive en los dos módulos puros; acá solo están las cosas
 * que no se pueden testear en Node: leer los stores, medir el tiempo
 * transcurrido desde el import y desde `Ready`, y latchear el `documentId`
 * que ya soltó.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect, useRef, useState } from "react";

import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore } from "../../store/viewer.store.js";

import { resolveAppPhase, type AppPhase } from "./appPhase.js";
import { shouldAdvanceFromScan } from "./scanAdvance.js";

/**
 * Cadencia del chequeo mientras la pantalla de escaneo está arriba.
 *
 * Hace falta un tick propio porque el piso y la gracia del precalentado son
 * temporales y el tiempo no emite eventos: sin esto, un documento que llega a
 * `Ready` antes del piso, o cuya página 1 tarda en dibujarse, se quedaría en
 * la pantalla hasta el próximo render de algún store, que puede no llegar
 * nunca. 200 ms es imperceptible contra un piso de 1200 ms y no compite con
 * nada: el intervalo se limpia apenas la fase deja de ser `scan`.
 */
const SCAN_TICK_MS = 200;

const READY_STAGES: ReadonlySet<PipelineStage> = new Set([PipelineStage.Ready, PipelineStage.Done]);

export function useAppPhase(): AppPhase {
  const documentId = useDocumentStore((state) => state.id);
  const stage = usePipelineStore((state) => state.stage);
  // ADR-151: la página 1 precalentada queda en el store haya o no visor
  // montado — leerla acá no depende de que ②b ya exista.
  const firstPagePreviewReady = useViewerStore((state) => state.previewByPage.original.has(0));

  const [advancedForDocumentId, setAdvancedForDocumentId] = useState<string | null>(null);
  // `startedAt`/`readyAt` por documento: importar un segundo PDF tiene que
  // volver a contar desde cero, no arrastrar el reloj del anterior.
  const startedAtRef = useRef<{ documentId: string; at: number } | null>(null);
  const readyAtRef = useRef<{ documentId: string; at: number } | null>(null);

  if (documentId !== null && startedAtRef.current?.documentId !== documentId) {
    startedAtRef.current = { documentId, at: Date.now() };
    readyAtRef.current = null;
  }
  // Se fija una sola vez, la primera vez que este documento alcanza
  // Ready/Done: un reanalyze que lo devuelve a Detecting no debería
  // reiniciar la gracia (aunque en la práctica no importa — el latch de
  // `advancedForDocumentId` ya saca a este hook de la fase "scan" antes de
  // que eso pueda pasar).
  if (
    documentId !== null &&
    READY_STAGES.has(stage) &&
    readyAtRef.current?.documentId !== documentId
  ) {
    readyAtRef.current = { documentId, at: Date.now() };
  }

  const phase = resolveAppPhase({ documentId, advancedForDocumentId });

  useEffect(() => {
    if (phase !== "scan" || documentId === null) return;

    function check(): void {
      const startedAt = startedAtRef.current;
      if (startedAt === null || documentId === null) return;
      const elapsedMs = Date.now() - startedAt.at;
      const readyAt = readyAtRef.current;
      const elapsedSinceReadyMs =
        readyAt !== null && readyAt.documentId === documentId ? Date.now() - readyAt.at : null;
      if (shouldAdvanceFromScan({ stage, elapsedMs, firstPagePreviewReady, elapsedSinceReadyMs })) {
        setAdvancedForDocumentId(documentId);
      }
    }

    check();
    const timer = window.setInterval(check, SCAN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, documentId, stage, firstPagePreviewReady]);

  return phase;
}
