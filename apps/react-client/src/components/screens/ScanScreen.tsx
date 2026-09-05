/**
 * `ScanScreen` — momento ②a (`ui/Components.md` §2.10, `UX_Guidelines.md`
 * §7.3, ADR-087 §6).
 *
 * Muestra el archivo que se está revisando, la animación de `ScanAnimation` y
 * el progreso real de la etapa vigente.
 *
 * **Sin la lista de entidades encontradas.** La primera versión las mostraba
 * apareciendo en vivo acá; se retira porque **se ven mejor donde importan**,
 * que es el árbol del panel de trabajo: ahí llegan con su tipo, su contador y
 * sus controles, y el usuario ya puede actuar sobre ellas. Repetirlas antes,
 * en una lista de la que no se puede hacer nada y que dura tres segundos,
 * gastaba la primera impresión del dato en un lugar donde no sirve.
 *
 * Lo que sostiene la paciencia pasa a ser el movimiento: la lupa recorriendo
 * el documento y la frase rotando los tipos de dato dicen "está buscando, y
 * busca esto" sin prometer una lista que no se puede tocar.
 *
 * **Se monta sin `Toolbar`** (`App.tsx`): trae estado, progreso y "Cancelar"
 * propios, así que la toolbar arriba dejaba dos barras de progreso del mismo
 * pipeline y dos botones "Cancelar" al mismo tiempo.
 *
 * **El contador por página solo corre en `Detecting`** (`scanProgress.ts`):
 * cuenta el escaneo del documento y nada más. Las etapas de preparación
 * muestran una barra indeterminada.
 *
 * Cuándo suelta: `scanAdvance.ts` (piso, techo y umbral sobre `Detecting`).
 * El latch que evita volver acá tras un `reanalyze` vive en `appPhase.ts`.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { CancelButton } from "../toolbar/CancelButton.js";

import { ScanAnimation } from "./ScanAnimation.js";
import { SCAN_PHRASE_INTERVAL_MS, scanPhraseTermAt } from "./scanPhrase.js";
import { resolveScanProgress } from "./scanProgress.js";

/**
 * Texto de estado en lenguaje llano (`UX_Guidelines.md` §7.1). **No nombra
 * "NER" ni "OCR"**: son etapas del pipeline, no vocabulario del usuario.
 */
function scanStatusLabel(
  stage: PipelineStage,
  modelLoading: { readonly progress: number } | null,
): string {
  if (modelLoading !== null) {
    // Sin porcentaje: el valor llega siempre en 1 (ver `scanProgress.ts`), así
    // que mostrarlo era escribir "100%" al lado de algo que todavía no
    // terminaba.
    return "Preparando el detector de nombres…";
  }
  switch (stage) {
    case PipelineStage.Importing:
      return "Abriendo el documento…";
    case PipelineStage.Extracting:
      return "Leyendo el texto…";
    case PipelineStage.OCRing:
      return "Reconociendo texto de las imágenes…";
    case PipelineStage.Detecting:
      return "Buscando datos sensibles…";
    case PipelineStage.Grouping:
      return "Agrupando lo encontrado…";
    default:
      return "Analizando…";
  }
}

export function ScanScreen() {
  const name = useDocumentStore((state) => state.name);
  const pageCount = useDocumentStore((state) => state.pageCount);
  const stage = usePipelineStore((state) => state.stage);
  const current = usePipelineStore((state) => state.current);
  const modelLoading = usePipelineStore((state) => state.modelLoading);

  const [phraseTick, setPhraseTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseTick((tick) => tick + 1);
    }, SCAN_PHRASE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const progress = resolveScanProgress({
    stage,
    current,
    pageCount,
    modelLoadingProgress: modelLoading?.progress ?? null,
  });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-7">
        <ScanAnimation />

        <div className="flex w-full flex-col items-center gap-1 text-center">
          <p
            className="max-w-full truncate text-base font-medium text-text-primary"
            title={name ?? undefined}
          >
            {name ?? "Documento"}
          </p>
          {pageCount > 0 ? (
            <p className="text-sm text-text-secondary">{pageCount} páginas</p>
          ) : null}
        </div>

        {/*
          La frase rotando los tipos de dato. `key` con el tick para que React
          remonte el span y la animación de fundido vuelva a correr: sin eso el
          navegador considera que ya terminó y el término siguiente aparecería
          de golpe.

          `aria-hidden` sobre el término y una frase fija en el nombre
          accesible: un lector de pantalla anunciando una palabra nueva cada
          2,4 s sería ruido, y lo que hay que comunicar —"está buscando datos
          sensibles"— ya lo dice el `role="status"` de abajo.
        */}
        <p
          className="text-center text-base text-text-secondary"
          aria-label="Buscando datos sensibles en el documento"
        >
          Buscando{" "}
          <span key={phraseTick} className="anonly-word-cycle font-medium text-accent" aria-hidden>
            {scanPhraseTermAt(phraseTick)}
          </span>
        </p>

        <div className="flex w-full flex-col gap-2" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-text-primary">
              {scanStatusLabel(stage, modelLoading)}
            </span>
            {progress.kind === "determinate" && progress.counter !== null ? (
              <span className="shrink-0 text-sm tabular-nums text-text-secondary">
                {progress.counter.current} de {progress.counter.total}
              </span>
            ) : null}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
            {progress.kind === "determinate" ? (
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${progress.percent}%` }}
              />
            ) : (
              // Indeterminado: una franja que recorre la barra. Dice "está
              // trabajando" sin afirmar cuánto falta, que es lo único honesto
              // en las etapas de preparación.
              <div className="anonly-scan-indeterminate h-full w-1/3 rounded-full bg-accent" />
            )}
          </div>
        </div>

        <CancelButton />
      </div>
    </div>
  );
}
