import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Page } from "@playwright/test";

export type NerPreloadMode = "baseline" | "b1" | "b2";

export async function installNerPreloadProbe(page: Page, mode: NerPreloadMode): Promise<void> {
  await page.evaluate((selectedMode) => {
    const root = globalThis as typeof globalThis & {
      __anonlyNerPreloadMode?: NerPreloadMode;
      __anonlyNerPreloadProbe?: Record<string, unknown>;
    };
    root.__anonlyNerPreloadMode = selectedMode;
    root.__anonlyNerPreloadProbe = { mode: selectedMode };
  }, mode);
}

export async function captureNerPreloadProbe(page: Page, path: string): Promise<void> {
  const probe = await page.evaluate(() => {
    const root = globalThis as typeof globalThis & { __anonlyNerPreloadProbe?: unknown };
    return root.__anonlyNerPreloadProbe ?? null;
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(probe, null, 2)}\n`);
}
