export const APP_ENTRY_URL = "app://local/index.html";

export type AppLoadState = "load" | "domcontentloaded";
export type AppNavigationActivity = {
  readonly event: "navigated" | "domcontentloaded" | "load";
  readonly url: string;
};

export interface AppNavigationPort {
  currentUrl(): string;
  waitForUrl(url: string, waitUntil: AppLoadState): Promise<void>;
  waitForReady(): Promise<void>;
  reload(waitUntil: AppLoadState): Promise<void>;
  subscribe(listener: (activity: AppNavigationActivity) => void): () => void;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "app:") return `${url.protocol}//${url.host}${url.pathname}`;
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[invalid-url]";
  }
}

/** Wait for the packaged app's exact entry document, then reload once for init scripts. */
export async function reloadReadyApp(
  page: AppNavigationPort,
  reloadWaitUntil: AppLoadState,
): Promise<void> {
  const activities: AppNavigationActivity[] = [];
  const unsubscribe = page.subscribe((activity) => {
    if (activities.length < 24)
      activities.push({ event: activity.event, url: safeUrl(activity.url) });
  });
  try {
    await page.waitForUrl(APP_ENTRY_URL, "load");
    if (page.currentUrl() !== APP_ENTRY_URL) throw new Error("initial app URL mismatch");
    await page.waitForReady();
    await page.reload(reloadWaitUntil);
    if (page.currentUrl() !== APP_ENTRY_URL) throw new Error("reloaded app URL mismatch");
    await page.waitForUrl(APP_ENTRY_URL, reloadWaitUntil);
    await page.waitForReady();
  } catch (cause: unknown) {
    const diagnostic = {
      expectedUrl: APP_ENTRY_URL,
      currentUrl: safeUrl(page.currentUrl()),
      activities,
    };
    throw new Error(`app navigation barrier failed: ${JSON.stringify(diagnostic)}`, { cause });
  } finally {
    unsubscribe();
  }
}
