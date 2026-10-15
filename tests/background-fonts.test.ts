import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function fontRequests(getFontList: () => Promise<chrome.fontSettings.FontName[]>) {
  let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender, reply: (result: unknown) => void) => boolean) | undefined;
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } }
    },
    tabs: { onUpdated: { addListener: () => undefined }, onRemoved: { addListener: () => undefined } },
    fontSettings: { getFontList }
  });
  await import("../src/entries/background");
  if (!onMessage) throw new Error("The font-list listener was not registered");
  return () => new Promise<unknown>((resolve) => {
    expect(onMessage!({ type: "getInstalledFonts" }, {}, resolve)).toBe(true);
  });
}

describe("runtime installed fonts", () => {
  it("shares concurrent requests and refreshes the catalog for later documents", async () => {
    let finish!: (fonts: chrome.fontSettings.FontName[]) => void;
    const pending = new Promise<chrome.fontSettings.FontName[]>((resolve) => { finish = resolve; });
    const getFontList = vi.fn().mockReturnValueOnce(pending)
      .mockResolvedValue([{ fontId: "New CJK Font", displayName: "New CJK Font" }]);
    const request = await fontRequests(getFontList);
    const first = request();
    const second = request();
    expect(getFontList).toHaveBeenCalledTimes(1);
    finish([{ fontId: " NotoSansCJKSC ", displayName: " Noto Sans CJK SC " },
      { fontId: "notosanscjksc", displayName: "Duplicate" }]);
    const expected = [{ fontId: "NotoSansCJKSC", displayName: "Noto Sans CJK SC" }];
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
    expect(await request()).toEqual([{ fontId: "New CJK Font", displayName: "New CJK Font" }]);
    expect(getFontList).toHaveBeenCalledTimes(2);
  });

  it("returns no installed-font evidence on failure and permits the next request to retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const getFontList = vi.fn().mockRejectedValueOnce(new Error("Font list unavailable"))
      .mockResolvedValue([{ fontId: "PingFang SC", displayName: "PingFang SC" }]);
    const request = await fontRequests(getFontList);
    expect(await request()).toEqual([]);
    expect(await request()).toEqual([{ fontId: "PingFang SC", displayName: "PingFang SC" }]);
  });
});
