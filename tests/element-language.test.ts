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
      const resolver = new ElementLanguage("sc", settings(), () => "sc");

      expect(resolver.browserHandlesLanguageFor(elementInside(owner))).toBe(true);
    }
  );

  it("does not trust an unrelated language declared only on the page root", () => {
    const root = languageOwner("en");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage("sc", settings(), () => "sc");

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });

  it.each(["en", "en-US", "en_GB", "fr", "cdo", "gan", "hak", "wuu", "nan", "yue", "zh", "ko"])(
    "does not trust a non-specific-CJK descendant lang=%s", (language) => {
      const root = languageOwner("en");
      vi.stubGlobal("document", { documentElement: root });
      const owner = languageOwner(language);
      const resolver = new ElementLanguage("sc", settings(), () => "sc");

      expect(resolver.browserHandlesLanguageFor(elementInside(owner))).toBe(false);
    }
  );

  it("does not trust bare root lang=zh", () => {
    const root = languageOwner("zh");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage("sc", settings(), () => "sc");

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });

  it("respects the setting that disables native lang handling", () => {
    const root = languageOwner("zh-Hans-CN");
    vi.stubGlobal("document", { documentElement: root });
    const resolver = new ElementLanguage(
      "sc",
      settings({ trustCjkLang: false }),
      () => "sc"
    );

    expect(resolver.browserHandlesLanguageFor(elementInside(root))).toBe(false);
  });
});
