import type { DrawRecord } from "./pagePixels.js";
import type { PreviewArrivalRecord, RenderRequestRecord } from "./renderTap.js";

export interface GroupUpdateRecord {
  readonly at: number;
  readonly replacementValue: string;
  readonly interactionRevision: number | null;
}

export interface EditedPreviewEvidence {
  readonly groupUpdate: GroupUpdateRecord;
  readonly request: RenderRequestRecord;
  readonly arrival: PreviewArrivalRecord;
  readonly draw: DrawRecord;
}

/** Link the edited group to a later scale-one anonymized preview that was actually drawn. */
export function findEditedPreviewEvidence(
  updates: ReadonlyArray<GroupUpdateRecord>,
  requests: ReadonlyArray<RenderRequestRecord>,
  arrivals: ReadonlyArray<PreviewArrivalRecord>,
  draws: ReadonlyArray<DrawRecord>,
  replacementValue: string,
): EditedPreviewEvidence | null {
  for (const groupUpdate of updates) {
    if (groupUpdate.replacementValue !== replacementValue) continue;
    if (groupUpdate.interactionRevision === null) continue;
    for (const request of requests) {
      if (
        request.kind !== "anonymized" ||
        request.mode !== "preview" ||
        request.scale !== 1 ||
        !request.pageIndices.includes(0) ||
        request.at < groupUpdate.at
      )
        continue;
      for (const arrival of arrivals) {
        if (arrival.kind !== "anonymized" || arrival.pageIndex !== 0 || arrival.at < request.at)
          continue;
        if (
          arrival.interactionRevision !== groupUpdate.interactionRevision ||
          arrival.interactionScale !== 1
        )
          continue;
        const draw = draws.find(
          (candidate) =>
            candidate.label === "Página 1, anonimizado" &&
            candidate.width === 595 &&
            candidate.height === 842 &&
            candidate.src === arrival.blobUrl &&
            candidate.at >= arrival.at,
        );
        if (draw !== undefined) return { groupUpdate, request, arrival, draw };
      }
    }
  }
  return null;
}
