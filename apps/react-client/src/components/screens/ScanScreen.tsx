/**
 * `ScanScreen` — momento ②a (`ui/Components.md` §2.10, `UX_Guidelines.md`
 * §7.3, ADR-087 §6).
 *
 * Muestra el progreso real de la etapa vigente y **las entidades apareciendo
 * en vivo**. Lo segundo no es adorno: es lo que distingue "está trabajando" de
 * "se colgó", y una barra sola no lo logra. Por eso la lista ocupa el lugar
 * central y no un spinner.
 *
 * **Sin skeleton del documento**: esta pantalla no promete un layout que
 * todavía no existe.
 *
 * **Se monta sin `Toolbar`** (`App.tsx`): trae estado, progreso y "Cancelar"
 * propios, así que la toolbar arriba dejaba dos barras de progreso del mismo
 * pipeline y dos botones "Cancelar" al mismo tiempo. El logo de continuidad
 * entre ① y ② lo pone esta pantalla.
 *
 * Cuándo suelta: `scanAdvance.ts` (piso, techo y umbral sobre `Detecting`).
 * El latch que evita volver acá tras un `reanalyze` vive en `appPhase.ts`.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { FileTextIcon, ShieldCheckIcon } from "lucide-react";

import { useDocumentStore } from "../../store/document.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { visibleTypeEntries } from "../entities/entityTree.js";
import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";
import { CancelButton } from "../toolbar/CancelButton.js";

/** Cuántas entidades recientes se listan. Suficiente para ver movimiento. */
const RECENT_LIMIT = 6;

/**
 * Texto de estado en lenguaje llano (`UX_Guidelines.md` §7.1). **No nombra
 * "NER" ni "OCR"**: son etapas del pipeline, no vocabulario del usuario. El
 * `pipelineStageLabel.ts` de la toolbar sigue existiendo para su propio uso;
 * acá el registro es distinto porque esta pantalla la mira alguien que recién
 * abrió un documento.
 */
function scanStatusLabel(
  stage: PipelineStage,
  modelLoading: { readonly progress: number } | null,
): string {
  if (modelLoading !== null) {
    return `Preparando el detector de nombres… ${Math.round(modelLoading.progress * 100)}%`;
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
  const total = usePipelineStore((state) => state.total);
  const modelLoading = usePipelineStore((state) => state.modelLoading);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);

  const entries = visibleTypeEntries(groupsByType);
  const groupCount = entries.reduce((sum, [, groups]) => sum + groups.length, 0);
  // Las últimas que llegaron, que es donde está el movimiento. `visibleTypeEntries`
  // ya viene en el orden fijo de tipos, así que invertir el aplanado alcanza.
  const recent = entries
    .flatMap(([type, groups]) => groups.map((group) => ({ type, group })))
    .slice(-RECENT_LIMIT)
    .reverse();

  // Durante la descarga del modelo, `current`/`total` del pipeline **no
  // describen páginas**: se los midió en 1/1 con el stage ya en `Detecting`
  // (el mismo dato que engañaba al umbral, ver `scanAdvance.ts`). Mostrarlos
  // ahí daba un "1 de 1" y una barra al 100 % mientras en realidad no se había
  // procesado ninguna página. Con el modelo cargando, lo que de verdad avanza
  // es la descarga, así que la barra muestra eso y el contador por página se
  // oculta — no hay páginas que contar todavía.
  const percent =
    modelLoading !== null
      ? Math.round(modelLoading.progress * 100)
      : total > 0
        ? Math.round((current / total) * 100)
        : 0;
  const showPageCounter = modelLoading === null && total > 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-8">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <ShieldCheckIcon className="h-8 w-8 text-accent" aria-hidden />
        </div>

        <div className="flex flex-col gap-1 text-center">
          <p className="truncate text-base font-medium text-text-primary" title={name ?? undefined}>
            {name ?? "Documento"}
          </p>
          {pageCount > 0 ? (
            <p className="text-sm text-text-secondary">{pageCount} páginas</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-text-primary">
              {scanStatusLabel(stage, modelLoading)}
            </span>
            {showPageCounter ? (
              <span className="shrink-0 text-sm tabular-nums text-text-secondary">
                {current} de {total}
              </span>
            ) : null}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="flex min-h-[11rem] flex-col gap-2 rounded-lg border border-border bg-bg-primary p-4">
          <p className="text-sm font-medium text-text-primary">
            {groupCount === 0
              ? "Todavía no encontré datos sensibles"
              : `${groupCount} ${groupCount === 1 ? "dato encontrado" : "datos encontrados"}`}
          </p>
          <ul className="flex flex-col gap-1">
            {recent.map(({ type, group }) => (
              <li key={group.id} className="flex items-center gap-2 text-sm">
                <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden />
                <span className="truncate text-text-primary">{group.canonicalValue}</span>
                <span className="shrink-0 text-text-secondary">{ENTITY_TYPE_LABEL[type]}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center">
          <CancelButton />
        </div>
      </div>
    </div>
  );
}
