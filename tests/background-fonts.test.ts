import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function fontRequests(
  getFontList: () => Promise<chrome.fontSettings.FontName[]>,
  session: Record<string, unknown> = {}
) {
  let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender, reply: (result: unknown) => void) => boolean) | undefined;
  let onStartup: (() => void) | undefined;
  vi.stubGlobal("chrome", {
    runtime: {
      onStartup: { addListener: (listener: typeof onStartup) => { onStartup = listener; } },
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } }
    },
    tabs: { onUpdated: { addListener: () => undefined }, onRemoved: { addListener: () => undefined } },
    fontSettings: { getFontList },
    storage: { session: {
      get: async (key: string) => ({ [key]: session[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(session, structuredClone(values)); }
    } }
  });
  await import("../src/entries/background");
  if (!onMessage) throw new Error("The font-list listener was not registered");
  return {
    request: () => new Promise<unknown>((resolve) => {
      expect(onMessage!({ type: "getInstalledFontFamilies" }, {}, resolve)).toBe(true);
    }),
    start: () => onStartup!()
  };
}

describe("runtime installed fonts", () => {
  it("shares concurrent requests and reuses only relevant names for later documents", async () => {
    let finish!: (fonts: chrome.fontSettings.FontName[]) => void;
    const pending = new Promise<chrome.fontSettings.FontName[]>((resolve) => { finish = resolve; });
    const getFontList = vi.fn().mockReturnValueOnce(pending)
      .mockResolvedValue([{ fontId: "New CJK Font", displayName: "New CJK Font" }]);
    const session: Record<string, unknown> = {};
    const { request } = await fontRequests(getFontList, session);
    const first = request();
    const second = request();
    await vi.waitFor(() => expect(getFontList).toHaveBeenCalledTimes(1));
    finish([{ fontId: " NotoSansCJKSC ", displayName: " Noto Sans CJK SC " },
      { fontId: "notosanscjksc", displayName: "Duplicate" },
      { fontId: "Arial", displayName: "Arial" }]);
    const expected = ["notosanscjksc", "noto sans cjk sc"];
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
    expect(await request()).toEqual(expected);
    expect(getFontList).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ installedCjkFamilies: expected });
    // Worker sleep discards its module state, while session storage remains.
    vi.resetModules();
    const restarted = await fontRequests(getFontList, session);
    expect(await restarted.request()).toEqual(expected);
    expect(getFontList).toHaveBeenCalledTimes(1);
  });

  it("returns no installed-font evidence on failure and permits the next request to retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const getFontList = vi.fn().mockRejectedValueOnce(new Error("Font list unavailable"))
      .mockResolvedValue([{ fontId: "PingFang SC", displayName: "PingFang SC" }]);
    const session: Record<string, unknown> = {};
    const { request } = await fontRequests(getFontList, session);
    expect(await request()).toEqual([]);
    expect(session).toEqual({});
    expect(await request()).toEqual(["pingfang sc"]);
  });

  it("prepares the shared names at startup and rebuilds them in a new browser session", async () => {
    const getFontList = vi.fn().mockResolvedValueOnce([{ fontId: "PingFang SC", displayName: "PingFang SC" }])
      .mockResolvedValueOnce([{ fontId: "Meiryo", displayName: "Meiryo" }]);
    const session: Record<string, unknown> = {};
    const first = await fontRequests(getFontList, session);
    first.start();
    await vi.waitFor(() => expect(session.installedCjkFamilies).toEqual(["pingfang sc"]));
    expect(await first.request()).toEqual(["pingfang sc"]);
    expect(getFontList).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const next = await fontRequests(getFontList);
    next.start();
    expect(await next.request()).toEqual(["meiryo"]);
    expect(getFontList).toHaveBeenCalledTimes(2);
  });

  it("caches an empty successful result instead of enumerating again for every page", async () => {
    const getFontList = vi.fn().mockResolvedValue([{ fontId: "Arial", displayName: "Arial" }]);
    const { request } = await fontRequests(getFontList);
    expect(await request()).toEqual([]);
    expect(await request()).toEqual([]);
    expect(getFontList).toHaveBeenCalledTimes(1);
  });

  it("still provides installed-font evidence when session storage is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { request } = await fontRequests(vi.fn().mockResolvedValue([
      { fontId: "Meiryo", displayName: "Meiryo" }
    ]));
    vi.spyOn(chrome.storage.session, "get").mockRejectedValue(new Error("Session read unavailable"));
    vi.spyOn(chrome.storage.session, "set").mockRejectedValue(new Error("Session write unavailable"));
    expect(await request()).toEqual(["meiryo"]);
  });
});
