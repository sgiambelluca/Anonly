import { describe, expect, it, vi } from "vitest";

import {
  APP_ENTRY_URL,
  reloadReadyApp,
  type AppNavigationActivity,
  type AppNavigationPort,
} from "../e2e/support/appNavigation.js";

function navigationPort(): AppNavigationPort & {
  readonly calls: string[];
  readonly activities: (activity: AppNavigationActivity) => void;
  url: string;
} {
  const calls: string[] = [];
  let listener: ((activity: AppNavigationActivity) => void) | undefined;
  const port: AppNavigationPort & {
    readonly calls: string[];
    readonly activities: (activity: AppNavigationActivity) => void;
    url: string;
  } = {
    calls,
    url: APP_ENTRY_URL,
    activities: (activity) => listener?.(activity),
    currentUrl() {
      return this.url;
    },
    async waitForUrl(url, state) {
      calls.push(`url:${url}:${state}`);
    },
    async waitForReady() {
      calls.push("ready");
    },
    async reload(state) {
      calls.push(`reload:${state}`);
    },
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return port;
}

describe("reloadReadyApp", () => {
  it("waits for the exact initial document and readiness before one reload", async () => {
    const port = navigationPort();
    await reloadReadyApp(port, "domcontentloaded");
    expect(port.calls).toEqual([
      `url:${APP_ENTRY_URL}:load`,
      "ready",
      "reload:domcontentloaded",
      `url:${APP_ENTRY_URL}:domcontentloaded`,
      "ready",
    ]);
  });

  it("does not reload from an unexpected initial URL and reports bounded navigation context", async () => {
    const port = navigationPort();
    port.url = "about:blank?private=ignored";
    const failure = await reloadReadyApp(port, "load").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("about://");
    expect((failure as Error).message).not.toContain("private");
    expect(port.calls).toEqual([`url:${APP_ENTRY_URL}:load`]);
  });

  it("surfaces reload abort with captured navigation events and never retries", async () => {
    const port = navigationPort();
    const reload = vi.spyOn(port, "reload").mockImplementation(async () => {
      port.activities({ event: "navigated", url: "app://local/index.html" });
      throw new Error("ERR_ABORTED");
    });
    const failure = await reloadReadyApp(port, "load").catch((error: unknown) => error);
    expect((failure as Error).message).toContain("navigated");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
