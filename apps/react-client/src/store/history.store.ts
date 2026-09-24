/**
 * `history.store.ts` — la pila de deshacer/rehacer (`ui/React_Client.md`
 * §3.6c, ADR-172 §2).
 *
 * **La pila vive en la UI; el estado, en el Core.** Cada entrada es el id
 * opaco de un punto de restauración que guarda el Core
 * (`orchestrator.createEditCheckpoint`). Deshacer no invierte operaciones:
 * vuelve a ese punto, y el grupo reaparece con el mismo `id`, el mismo número
 * y el mismo token (ADR-172 §1).
 *
 * - `record(label)` se llama **antes** de cada edición: guarda el estado
 *   previo y vacía `future`. Una acción del usuario = una entrada, aunque
 *   emita varios pedidos.
 * - `undo()` toma un punto del estado **actual** (pasa a `future`), restaura
 *   el último de `past` y lo saca. `redo()` es lo simétrico.
 * - `clear()` vacía las dos pilas y descarta los puntos del Core.
 *
 * **El límite del Core se refleja acá.** El Core guarda hasta
 * `MAX_EDIT_CHECKPOINTS` por documento y, al pasarse, descarta el más viejo
 * **por orden de creación** — cuente o no en la pila (deshacer y rehacer
 * también crean puntos). `live` lleva esa misma cola, así que una entrada
 * cuyo punto el Core ya descartó sale de la pila en el mismo momento, en vez
 * de fallar cuando el usuario llegue a ella.
 *
 * Sin dependencias del Core: el acceso entra por `EditCheckpointPort`
 * (`core-adapter/history.ts` arma el real). Así la lógica se prueba en Node
 * con un puerto falso (los tests de `apps/react-client` corren sin jsdom).
 */

import { MAX_EDIT_CHECKPOINTS } from "@anonly/anonymization-core";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export interface HistoryEntry {
  readonly checkpointId: string;
  /** Qué se hizo, en lenguaje del usuario ("Fusionar «Juan Pérez»"). */
  readonly label: string;
}

/** Lo que la pila necesita del Core, y nada más. */
export interface EditCheckpointPort {
  /**
   * Un punto del estado actual, o `null` si el Core no puede tomarlo (sin
   * documento, o durante una pasada de detección — ADR-172 §1).
   */
  create(): string | null;
  /** Vuelve al punto. Rechaza si el Core lo rechaza (id descartado, etapa). */
  restore(checkpointId: string): Promise<void>;
  /** Descarta todos los puntos del documento. */
  discard(): void;
}

export interface HistorySlice {
  readonly past: ReadonlyArray<HistoryEntry>;
  readonly future: ReadonlyArray<HistoryEntry>;
  /** Ids de punto vivos en el Core, del más viejo al más nuevo. */
  readonly live: ReadonlyArray<string>;
  /** Un undo/redo en vuelo: el siguiente espera a que termine. */
  readonly busy: boolean;
  /**
   * Punto del estado previo, **antes** de editar. Devuelve si quedó
   * registrado: sin punto (etapa de detección, sin documento) la edición se
   * hace igual, pero no ofrece "Deshacer".
   */
  record(label: string): boolean;
  /** Devuelve si deshizo algo. */
  undo(): Promise<boolean>;
  /** Devuelve si rehizo algo. */
  redo(): Promise<boolean>;
  clear(): void;
}

export type HistoryStore = UseBoundStore<StoreApi<HistorySlice>>;

/** Recorta la cola de puntos vivos al límite del Core y saca de la pila lo descartado. */
function withCheckpoint(
  state: Pick<HistorySlice, "past" | "future" | "live">,
  checkpointId: string,
  limit: number,
): Pick<HistorySlice, "past" | "future" | "live"> {
  const live = [...state.live, checkpointId];
  const evicted = new Set(live.slice(0, Math.max(0, live.length - limit)));
  if (evicted.size === 0) return { past: state.past, future: state.future, live };
  return {
    past: state.past.filter((entry) => !evicted.has(entry.checkpointId)),
    future: state.future.filter((entry) => !evicted.has(entry.checkpointId)),
    live: live.slice(live.length - limit),
  };
}

const EMPTY = { past: [], future: [], live: [], busy: false } as const;

export function createHistoryStore(
  port: EditCheckpointPort,
  limit: number = MAX_EDIT_CHECKPOINTS,
): HistoryStore {
  function tryCreate(): string | null {
    try {
      return port.create();
    } catch {
      return null;
    }
  }

  return create<HistorySlice>()((set, get) => {
    /**
     * Undo y redo son el mismo movimiento entre dos pilas: sacar la última
     * entrada de `from`, guardar el estado actual en `to` con la misma
     * etiqueta, y restaurar.
     */
    async function move(direction: "undo" | "redo"): Promise<boolean> {
      const state = get();
      const from = direction === "undo" ? state.past : state.future;
      const target = from.at(-1);
      if (state.busy || target === undefined) return false;

      // Con la cola del Core llena, el punto del estado actual desalojaría al
      // más viejo; si ése es justo el que hay que restaurar, se restaura sin
      // guardar el actual, y el camino de vuelta se pierde (no se puede
      // rehacer ese paso). Solo pasa en el fondo de una pila llena.
      const targetWouldBeEvicted =
        state.live.length >= limit && state.live[0] === target.checkpointId;
      const current = targetWouldBeEvicted ? null : tryCreate();
      if (!targetWouldBeEvicted && current === null) return false;

      set((previous) => ({
        ...(current !== null ? withCheckpoint(previous, current, limit) : {}),
        busy: true,
      }));
      try {
        await port.restore(target.checkpointId);
      } catch {
        // Red de seguridad, no un camino esperado: los descartes del Core
        // (límite, re-análisis, cierre) ya se reflejan en la pila, y una
        // etapa que no admite puntos corta antes, en `tryCreate`. Si igual
        // el Core no reconoce el punto, la pila dejó de describir su estado,
        // y una pila que no se puede recorrer es peor que ninguna.
        get().clear();
        return false;
      }

      set((previous) => {
        const without = (list: ReadonlyArray<HistoryEntry>) =>
          list.filter((entry) => entry.checkpointId !== target.checkpointId);
        // Sin el punto del estado actual (o si `live` ya lo descartó), la
        // otra pila queda sin camino de vuelta: se vacía, porque sus
        // entradas son estados posteriores al que se saltó.
        const to = direction === "undo" ? previous.future : previous.past;
        const nextTo =
          current !== null && previous.live.includes(current)
            ? [...to, { checkpointId: current, label: target.label }]
            : [];
        return direction === "undo"
          ? { past: without(previous.past), future: nextTo, busy: false }
          : { future: without(previous.future), past: nextTo, busy: false };
      });
      return true;
    }

    return {
      ...EMPTY,
      record(label) {
        const checkpointId = tryCreate();
        if (checkpointId === null) return false;
        set((previous) => {
          const next = withCheckpoint(previous, checkpointId, limit);
          return {
            ...next,
            past: [...next.past, { checkpointId, label }],
            future: [],
          };
        });
        return true;
      },
      undo: () => move("undo"),
      redo: () => move("redo"),
      clear() {
        try {
          port.discard();
        } catch {
          // Sin Core o sin documento no hay nada que descartar.
        }
        set({ ...EMPTY });
      },
    };
  });
}
