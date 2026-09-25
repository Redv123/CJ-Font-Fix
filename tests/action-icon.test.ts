import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("toolbar icon across navigations", () => {
  it("follows the new page's intervention report without a navigation timer", async () => {
    vi.useFakeTimers();
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
    let onUpdated: ((tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => void) | undefined;
    const icons: string[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
        onInstalled: { addListener: () => undefined }
      },
      tabs: {
        onUpdated: { addListener: (listener: typeof onUpdated) => { onUpdated = listener; } },
        onRemoved: { addListener: () => undefined }
      },
      action: {
        setIcon: async ({ path }: { path: Record<number, string> }) => {
          icons.push(path[16]?.includes("icon-active-") ? "open" : "closed");
        }
      }
    });
    await import("../src/entries/background");
    if (!onMessage || !onUpdated) throw new Error("The background listeners were not registered");

    const sender = { tab: { id: 7 }, frameId: 0 } as chrome.runtime.MessageSender;
    onMessage({ type: "setActionState", inUse: true }, sender);
    await Promise.resolve();
    expect(icons).toEqual(["open"]);

    // A cross-document navigation clears the browser's tab-specific icon.
    onUpdated(7, { status: "loading" });
    onMessage({ type: "setActionState", inUse: true }, sender);
    await Promise.resolve();
    expect(icons).toEqual(["open", "open"]);

    onUpdated(7, { status: "loading" });
    expect(icons).toEqual(["open", "open"]);
    expect(vi.getTimerCount()).toBe(0);

    // No intervention is an immediate report; a protected page sends none
    // and keeps the manifest's closed default after navigation.
    onMessage({ type: "setActionState", inUse: false }, sender);
    await Promise.resolve();
    expect(icons).toEqual(["open", "open", "closed"]);
  });
});
