import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NativeMemoryCategory {
  readonly dirtyBytes: number | undefined;
  readonly cleanBytes: number | undefined;
  readonly reclaimableBytes: number | undefined;
  readonly regions: number | undefined;
  readonly name: string;
}

export interface NativeMemorySnapshot {
  readonly available: boolean;
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  readonly physicalFootprintBytes: number | undefined;
  readonly physicalFootprintPeakBytes: number | undefined;
  readonly categories: ReadonlyArray<NativeMemoryCategory>;
  readonly commandDurationMs: number;
  readonly reason: string | undefined;
}

function parseSize(value: string, unit: string): number | undefined {
  const numeric = Number(value.replace(",", "."));
  if (!Number.isFinite(numeric) || unit.toUpperCase() !== "B") return undefined;
  return Math.round(numeric);
}

function parsePhysicalFootprint(output: string, label: string): number | undefined {
  const match = output.match(new RegExp(`^\\s*${label}:\\s*([0-9.,]+)\\s*B\\s*$`, "m"));
  return match === null ? undefined : parseSize(match[1] ?? "", "B");
}

export function parseFootprintOutput(
  output: string,
): Pick<
  NativeMemorySnapshot,
  "physicalFootprintBytes" | "physicalFootprintPeakBytes" | "categories"
> {
  return {
    physicalFootprintBytes: parsePhysicalFootprint(output, "phys_footprint"),
    physicalFootprintPeakBytes: parsePhysicalFootprint(output, "phys_footprint_peak"),
    categories: parseCategories(output),
  };
}

function parseCategories(output: string): ReadonlyArray<NativeMemoryCategory> {
  const categories: NativeMemoryCategory[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(
      /^\s*([0-9.,]+)\s+(B|KB|MB|GB)\s+([0-9.,]+)\s+(B|KB|MB|GB)\s+([0-9.,]+)\s+(B|KB|MB|GB)\s+([0-9]+)\s+(.+?)\s*$/,
    );
    if (match === null) continue;
    const dirtyBytes = parseSize(match[1] ?? "", match[2] ?? "");
    const cleanBytes = parseSize(match[3] ?? "", match[4] ?? "");
    const reclaimableBytes = parseSize(match[5] ?? "", match[6] ?? "");
    const regions = Number(match[7]);
    const name = match[8]?.trim();
    if (
      dirtyBytes === undefined ||
      cleanBytes === undefined ||
      reclaimableBytes === undefined ||
      !Number.isInteger(regions) ||
      name === undefined ||
      name.length === 0
    ) {
      continue;
    }
    if (name === "TOTAL") continue;
    categories.push({ dirtyBytes, cleanBytes, reclaimableBytes, regions, name });
  }
  return categories;
}

export async function readNativeMemory(pid: number): Promise<NativeMemorySnapshot> {
  const startedAt = performance.now();
  const base: NativeMemorySnapshot = {
    available: false,
    platform: process.platform,
    pid,
    physicalFootprintBytes: undefined,
    physicalFootprintPeakBytes: undefined,
    categories: [],
    commandDurationMs: 0,
    reason: undefined,
  };
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ...base, commandDurationMs: performance.now() - startedAt, reason: "invalid-pid" };
  }
  if (process.platform !== "darwin") {
    return {
      ...base,
      commandDurationMs: performance.now() - startedAt,
      reason: "footprint-unavailable-on-platform",
    };
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/footprint", ["-f", "bytes", String(pid)], {
      maxBuffer: 2_000_000,
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    const output = String(stdout);
    const parsed = parseFootprintOutput(output);
    const { physicalFootprintBytes, physicalFootprintPeakBytes, categories } = parsed;
    if (physicalFootprintBytes === undefined) {
      return {
        ...base,
        commandDurationMs: performance.now() - startedAt,
        reason: "footprint-output-without-physical-footprint",
      };
    }
    return {
      available: true,
      platform: process.platform,
      pid,
      physicalFootprintBytes,
      physicalFootprintPeakBytes,
      categories,
      commandDurationMs: performance.now() - startedAt,
      reason: undefined,
    };
  } catch (error) {
    return {
      ...base,
      commandDurationMs: performance.now() - startedAt,
      reason: error instanceof Error ? error.message : "footprint-command-failed",
    };
  }
}
