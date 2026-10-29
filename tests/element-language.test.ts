import { afterEach, describe, expect, it, vi } from "vitest";
import { ElementLanguage } from "../src/page/element-language";
import { DEFAULTS } from "../src/settings/defaults";
import type { Settings } from "../src/shared/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULTS, siteOverrides: {}, ...overrides };
}

function languageOwner(language: string): Element {
  return {
    getAttribute: () => language
  } as unknown as Element;
}

function elementInside(owner: Element): Element {
  return {
    closest: () => owner
  } as unknown as Element;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-owned language contexts", () => {
  it.each(["ja", "ja-JP", "zh-CN", "zh-Hans", "zh-TW", "zh-HK", "zh-Hant"])(
    "leaves a specific CJK descendant lang=%s to the browser",
    (language) => {
      const root = languageOwner("zh-Hans-CN");
      vi.stubGlobal("document", { documentElement: root });
      const owner = languageOwner(language);
      const resolver = new ElementLanguage(settings(), () => "sc");

      expect(resolver.browserHandlesLanguageFor(elementInside(owner))).toBe(true);
    }
  );

  it("does not trust an unrelated language declared only on the page root", () => {
    const root = languageOwner("en");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage(settings(), () => "sc");

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });

  it.each(["en", "en-US", "en_GB", "fr", "cdo", "gan", "hak", "wuu", "nan", "yue", "zh", "ko"])(
    "does not trust a non-specific-CJK descendant lang=%s", (language) => {
      const root = languageOwner("en");
      vi.stubGlobal("document", { documentElement: root });
      const owner = languageOwner(language);
      const resolver = new ElementLanguage(settings(), () => "sc");

      expect(resolver.browserHandlesLanguageFor(elementInside(owner))).toBe(false);
    }
  );

  it("does not trust bare root lang=zh", () => {
    const root = languageOwner("zh");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage(settings(), () => "sc");

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });

  it("respects the setting that disables native lang handling", () => {
    const root = languageOwner("zh-Hans-CN");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage(
      settings({ trustCjkLang: false }),
      () => "sc"
    );

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });
});

describe("bare Chinese language samples", () => {
  it.each([
    { name: "empty content", chunks: [] },
    { name: "short mixed text", chunks: ["简体", "繁體", "𠀀"] },
    { name: "a surrogate pair at the limit", chunks: ["文".repeat(2999), "𠀀后续文字"] },
    { name: "one oversized node", chunks: ["文".repeat(5000)] }
  ])("preserves the original 3000-code-unit prefix for $name", ({ chunks }) => {
    const owner = languageOwner("zh");
    const nodes = chunks.map((nodeValue) => ({ nodeValue }));
    let index = 0;
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8 });
    vi.stubGlobal("document", {
      documentElement: languageOwner("en"),
      createTreeWalker: () => ({ nextNode: () => nodes[index++] || null })
    });
    const classify = vi.fn(() => "tc" as const);
    const resolver = new ElementLanguage(settings(), classify);
    expect(resolver.explicitVariantFor(elementInside(owner))).toBe("tc");
    expect(classify).toHaveBeenCalledExactlyOnceWith(chunks.join("").slice(0, 3000));
  });

  it("stops before later text and retains only the current resolver's cached sample", () => {
    const owner = languageOwner("zh");
    Object.defineProperty(owner, "textContent", { get: () => { throw new Error("Full text read"); } });
    let text = "简".repeat(3000);
    const unread = vi.fn(() => { throw new Error("Read beyond sample limit"); });
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8 });
    const createTreeWalker = vi.fn(() => {
      let first = true;
      return { nextNode: () => {
        if (!first) return unread();
        first = false;
        return { nodeValue: text };
      } };
    });
    vi.stubGlobal("document", { documentElement: languageOwner("en"), createTreeWalker });
    const classify = vi.fn((sample: string) => sample.startsWith("简") ? "sc" as const : "tc" as const);
    const first = new ElementLanguage(settings(), classify);
    expect(first.explicitVariantFor(elementInside(owner))).toBe("sc");
    text = "繁".repeat(3000);
    expect(first.explicitVariantFor(elementInside(owner))).toBe("sc");
    const next = new ElementLanguage(settings(), classify);
    expect(next.explicitVariantFor(elementInside(owner))).toBe("tc");
    expect(createTreeWalker).toHaveBeenCalledTimes(2);
    expect(classify).toHaveBeenCalledTimes(2);
    expect(unread).not.toHaveBeenCalled();
  });
});
