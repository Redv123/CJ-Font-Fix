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
  it.each(["cdo", "gan", "hak", "wuu", "nan", "yue", "ja", "zh-Hant"])(
    "leaves an explicit descendant lang=%s to the browser",
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
