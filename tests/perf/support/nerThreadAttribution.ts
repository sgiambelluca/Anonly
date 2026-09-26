export interface NerThreadMemoryTarget {
  readonly label: string;
  readonly url: string;
  readonly memories: ReadonlyArray<{ readonly shared: boolean }> | undefined;
}

export interface NerThreadSample {
  readonly wasmTargets: ReadonlyArray<NerThreadMemoryTarget>;
}

export interface ObservedNerThreadCount {
  readonly effectiveThreads: number;
  readonly ownerUrls: ReadonlyArray<string>;
}

function hasSharedWasmMemory(target: NerThreadMemoryTarget): boolean {
  return target.memories?.some((memory) => memory.shared) ?? false;
}

/** Count children only when their root has an observed shared WASM memory. */
export function observedNerThreadCount(
  samples: ReadonlyArray<NerThreadSample>,
): ObservedNerThreadCount | null {
  let max = 0;
  const ownerUrls = new Set<string>();
  for (const sample of samples) {
    const owners = sample.wasmTargets.filter(
      (target) =>
        /^(?:thread-pool-worker|unclassified-worker)-\d+$/.test(target.label) &&
        hasSharedWasmMemory(target),
    );
    for (const owner of owners) {
      const children = sample.wasmTargets.filter((target) =>
        new RegExp(`^${owner.label}/(?:thread|child)-\\d+$`).test(target.label),
      );
      if (children.length === 0) continue;
      const effectiveThreads = children.length + 1;
      if (effectiveThreads > max) {
        max = effectiveThreads;
        ownerUrls.clear();
        ownerUrls.add(owner.url);
      } else if (effectiveThreads === max) {
        ownerUrls.add(owner.url);
      }
    }
  }
  return max === 0 ? null : { effectiveThreads: max, ownerUrls: [...ownerUrls].sort() };
}
