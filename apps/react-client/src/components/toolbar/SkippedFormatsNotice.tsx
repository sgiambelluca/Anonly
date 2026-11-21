/**
 * `SkippedFormatsNotice` (`ui/Components.md` §13b.8, ADR-229 §7): el aviso de un
 * formato del usuario que no se aplicó en alguna página, en la **ranura de la
 * barra que usa el aviso de análisis incompleto** (`PipelineStatus` decide cuál
 * de los dos ocupa el lugar). Nombra el formato y las páginas, y ofrece «Ir a la
 * página N». No bloquea la exportación.
 *
 * Los textos y la decisión de qué mostrar viven en `skippedFormatsText.ts`;
 * acá solo se lee el estado y se dibuja.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useMemo } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";
import { referenceFormat } from "../entities/formatNames.js";

import {
  buildSkippedEntries,
  buildSkippedFormatsNotice,
  goToPageLabel,
  type SkippedFormatEntry,
  type SkippedFormatsNotice as SkippedNotice,
} from "./skippedFormatsText.js";

/** Las entradas del documento vigente, con el nombre de cada formato. `[]` es el caso sano. */
export function useSkippedFormatEntries(): ReadonlyArray<SkippedFormatEntry> {
  const skipped = usePipelineStore((state) => state.skippedFormats);
  const pageCount = useDocumentStore((state) => state.pageCount);
  const detection = useDetectionStore((state) => state.saved);
  return useMemo(
    () =>
      buildSkippedEntries(
        skipped,
        pageCount,
        (formatId) => referenceFormat(detection, formatId).name,
      ),
    [skipped, pageCount, detection],
  );
}

/**
 * El aviso de la barra, o `null`. Solo con el análisis terminado: mientras el
 * pipeline corre, la barra cuenta el avance y `REGEX_FINISHED` puede repetirse
 * (un `reanalyze` lo reemplaza).
 */
export function useSkippedFormatsNotice(): SkippedNotice | null {
  const stage = usePipelineStore((state) => state.stage);
  const entries = useSkippedFormatEntries();
  if (stage !== PipelineStage.Ready && stage !== PipelineStage.Done) return null;
  return buildSkippedFormatsNotice(entries);
}

export interface SkippedFormatsNoticeProps {
  readonly notice: SkippedNotice;
}

export function SkippedFormatsNotice({ notice }: SkippedFormatsNoticeProps) {
  const goToPage = notice.goToPage;
  return (
    <Banner
      variant="warning"
      actions={
        goToPage !== null ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => useViewerStore.getState().requestPageJump(goToPage)}
          >
            {goToPageLabel(goToPage)}
          </Button>
        ) : undefined
      }
    >
      {notice.message}
    </Banner>
  );
}
