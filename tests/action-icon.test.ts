import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("site-rule update cleanup", () => {
  it("removes old Auto defaults without overwriting a concurrent popup edit", async () => {
    let onInstalled: (() => Promise<void>) | undefined;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender, reply: (result: unknown) => void) => boolean) | undefined;
    const stored: Record<string, unknown> = { siteOverrides: { "old.example.com": "auto" }, siteDomainOverrides: {} };
    let resumeRead!: () => void;
    let readStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { resumeRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    let firstRead = true;
    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: { addListener: (listener: typeof onInstalled) => { onInstalled = listener; } },
        onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } }
      },
      tabs: { onUpdated: { addListener: () => undefined }, onRemoved: { addListener: () => undefined } },
      publicSuffix: { getDomain: () => "example.com" },
      fontSettings: { getFontList: async () => [] },
      storage: { sync: {
        get: async (keys: string[]) => {
          const snapshot = structuredClone(Object.fromEntries(keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]])));
          if (firstRead) {
            firstRead = false;
            readStarted();
            await blocked;
          }
          return snapshot;
        },
        set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
      } }
    });
    await import("../src/entries/background");
    if (!onInstalled || !onMessage) throw new Error("The background listeners were not registered");
    const cleanup = onInstalled();
    await started;
    const edit = new Promise((resolve) => onMessage!({ type: "editSiteRule", scope: "hostname",
      hostname: "chosen.example.com", value: "sc" }, {}, resolve));
    resumeRead();
    await cleanup;
    expect(await edit).toEqual({ ok: true, deletedRules: undefined });
    expect(stored).toEqual({ siteOverrides: { "chosen.example.com": "sc" }, siteDomainOverrides: {} });
  });
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
