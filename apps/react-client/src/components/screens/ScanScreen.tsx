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
 * **El contador por página corre en `OCRing` y en `Detecting`**
 * (`scanProgress.ts`, ADR-152), cada uno con su propio rótulo y su propio
 * denominador reiniciado — son dos trabajos distintos, no el mismo contador
 * continuando. Las etapas de preparación (`Importing`/`Extracting`/
 * `Grouping`, y `Detecting` mientras el modelo carga) muestran una barra
 * indeterminada.
 *
 * **Tres cajas** (ADR-168 §5/§6): el documento con la animación, el flujo de
 * cuatro pasos fijos (`ScanSteps`, el mapa que faltaba para que "Leyendo" y
 * "Escaneando" no se lean como un reinicio) y el progreso con "Cancelar" y su
 * atajo escrito.
 *
 * Cuándo suelta: `scanAdvance.ts` (ADR-150) — el `stage` terminal es la única
 * condición de pase; sin techo, dura lo que dure el escaneo. El latch que
 * evita volver acá tras un `reanalyze` vive en `appPhase.ts`.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { FileTextIcon, LockIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { CancelButton } from "../toolbar/CancelButton.js";

import { ScanAnimation } from "./ScanAnimation.js";
import { SCAN_PHRASE_INTERVAL_MS, scanPhraseTermAt } from "./scanPhrase.js";
import { resolveScanProgress } from "./scanProgress.js";
import { ScanSteps } from "./ScanSteps.js";

/**
 * Texto de estado en lenguaje llano (`UX_Guidelines.md` §7.1/§7.3, ADR-152
 * §1). **No nombra "NER" ni "OCR"**: son etapas del pipeline, no vocabulario
 * del usuario. `Importing`/`Extracting` comparten frase — para el usuario
 * las dos son "todavía no hay nada que mostrar".
 */
function scanStatusLabel(
  stage: PipelineStage,
  modelLoading: { readonly progress: number } | null,
): string {
  if (modelLoading !== null) {
    // Sin porcentaje: el valor llega siempre en 1 (ver `scanProgress.ts`), así
    // que mostrarlo era escribir "100%" al lado de algo que todavía no
    // terminaba.
    return "Preparando el detector…";
  }
  switch (stage) {
    case PipelineStage.Importing:
    case PipelineStage.Extracting:
      return "Abriendo el documento…";
    case PipelineStage.OCRing:
      return "Leyendo el documento…";
    case PipelineStage.Detecting:
      return "Escaneando el documento…";
    case PipelineStage.Grouping:
      return "Ordenando los resultados…";
    default:
      return "Analizando…";
  }
}

export function ScanScreen() {
  const name = useDocumentStore((state) => state.name);
  const pageCount = useDocumentStore((state) => state.pageCount);
  const stage = usePipelineStore((state) => state.stage);
  const current = usePipelineStore((state) => state.current);
  const total = usePipelineStore((state) => state.total);
  const modelLoading = usePipelineStore((state) => state.modelLoading);
  const lastOcrPageIndex = usePipelineStore((state) => state.lastOcrPageIndex);
  const visitedStages = usePipelineStore((state) => state.visitedStages);

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
    total,
    pageCount,
    modelLoadingProgress: modelLoading?.progress ?? null,
    lastOcrPageIndex,
  });

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 py-8">
      {/*
        ADR-168 §6: tres cajas. La animación con el archivo, el flujo de pasos
        (§5) y el progreso con "Cancelar". `my-auto` centra el conjunto cuando
        entra y deja scrollear cuando no.
      */}
      <div className="my-auto flex w-full max-w-[35rem] flex-col gap-4">
        <section
          aria-label="Documento en revisión"
          className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-primary p-4 shadow-sm"
        >
          <div className="flex items-center gap-3 px-0.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <FileTextIcon className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p
                className="truncate text-base font-semibold text-text-primary"
                title={name ?? undefined}
              >
                {name ?? "Documento"}
              </p>
              {/* Ranura fija: el renglón existe antes de conocer el total (UX-10). */}
              <p className="h-5 text-sm text-text-secondary">
                {pageCount > 0 ? `${pageCount} páginas` : ""}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-sm font-medium text-text-primary">
              <LockIcon className="h-3.5 w-3.5" aria-hidden />
              En tu equipo
            </span>
          </div>

          <div className="anonly-dots flex h-56 items-center justify-center rounded-xl border border-border bg-bg-secondary">
            <ScanAnimation />
          </div>

          {/*
            La frase rotando los tipos de dato. `key` con el tick para que React
            remonte el span y la animación de fundido vuelva a correr.

            `aria-hidden` sobre el término y una frase fija en el nombre
            accesible: un lector de pantalla anunciando una palabra nueva cada
            2,4 s sería ruido, y lo que hay que comunicar ya lo dice el
            `role="status"` de abajo.
          */}
          <p
            className="text-center text-base text-text-secondary"
            aria-label="Buscando datos sensibles en el documento"
          >
            Buscando{" "}
            <span
              key={phraseTick}
              className="anonly-word-cycle inline-block min-w-[6rem] text-left font-semibold text-accent"
              aria-hidden
            >
              {scanPhraseTermAt(phraseTick)}
            </span>
          </p>
        </section>

        <ScanSteps stage={stage} visitedStages={visitedStages} />

        <section
          role="status"
          aria-live="polite"
          className="flex items-center gap-4 rounded-2xl border border-border bg-bg-primary py-3.5 pl-5 pr-3.5 shadow-sm"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                <span
                  className="anonly-pulse h-2 w-2 shrink-0 rounded-full bg-accent"
                  aria-hidden
                />
                <span className="truncate">{scanStatusLabel(stage, modelLoading)}</span>
              </span>
              {/* Ranura de ancho mínimo: el contador aparece sin correr el rótulo. */}
              <span className="min-w-[7.5rem] shrink-0 text-right text-sm tabular-nums text-text-secondary">
                {progress.kind === "determinate" && progress.counter !== null
                  ? `página ${progress.counter.current} de ${progress.counter.total}`
                  : ""}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
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
          <div aria-hidden className="w-px self-stretch bg-border" />
          <CancelButton showShortcut />
        </section>
      </div>
    </div>
  );
}
