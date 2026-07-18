/**
 * `snapshots.ts` — hidratación puntual del Grouping Engine (U-6).
 *
 * Fuente de verdad: docs/ui/React_Client.md §4: "snapshots.ts usa
 * core.engines.grouping.getSnapshot(documentId) (U-6) como hidratación
 * puntual (p. ej. montar un panel tarde); la fuente reactiva son los eventos
 * del bus [manejados por bus-bridge.ts]." No reemplaza al bridge: es una
 * lectura bajo demanda, no una suscripción.
 */

import { getCore } from "./index.js";

/**
 * Snapshot consultable de una sesión de Grouping para `documentId`
 * (`GroupingEngineSnapshot`, Grouping_Engine.md §10: `{ documentId, groups,
 * conflicts, rules }`). Lanza si no hay Core inicializado o si la sesión no
 * existe (mismo comportamiento que `GroupingEngine.getSnapshot`).
 */
export function getGroupingSnapshot(documentId: string) {
  return getCore().engines.grouping.getSnapshot(documentId);
}
