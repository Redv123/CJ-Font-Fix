import { describe, expect, it, vi } from "vitest";
import { FontSupport, regionalVariantForFamily } from "../src/fonts/font-support";
import { DEFAULTS } from "../src/settings/defaults";

describe("regional CJK font names", () => {
  it("distinguishes regional Noto and Source Han families", () => {
    expect(regionalVariantForFamily("Noto Sans CJK SC")).toBe("sc");
    expect(regionalVariantForFamily("Noto Sans CJK TC")).toBe("tc");
    expect(regionalVariantForFamily("Noto Sans CJK JP")).toBe("jp");
    expect(regionalVariantForFamily("Source Han Serif JP")).toBe("jp");
  });

  it("recognizes common platform-specific regional families", () => {
    expect(regionalVariantForFamily("Microsoft YaHei")).toBe("sc");
    expect(regionalVariantForFamily("Microsoft JhengHei")).toBe("tc");
    expect(regionalVariantForFamily("Yu Gothic")).toBe("jp");
  });

  it("leaves region-neutral CJK families unresolved", () => {
    expect(regionalVariantForFamily("WenQuanYi Micro Hei")).toBeNull();
    expect(regionalVariantForFamily("Arial")).toBeNull();
  });

  it("does not preserve an available SC family when JP is required", () => {
    let font = "";
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          get font() { return font; },
          set font(value: string) { font = value; },
          measureText: () => ({ width: font.includes("Noto Sans CJK SC") ? 2 : 1 })
        })
      })
    });
    try {
      const support = new FontSupport();
      const settings = { ...DEFAULTS, preserveWebFonts: false, preserveKnownCjk: true };
      expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], settings, "jp"))
        .toBe(false);
      expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], settings, "sc"))
        .toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves an available Fangsong for Chinese, but not Japanese", () => {
    let font = "";
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          get font() { return font; },
          set font(value: string) { font = value; },
          measureText: () => ({ width: /fangsong|仿宋|fandolfang/i.test(font) ? 2 : 1 })
        })
      })
    });
    try {
      const support = new FontSupport();
      expect(support.shouldPreserve(["FangSong", "sans-serif"], DEFAULTS, "sc")).toBe(true);
      expect(support.shouldPreserve(["FangSong SC", "sans-serif"], DEFAULTS, "tc")).toBe(true);
      expect(support.shouldPreserve(["STFangsong", "sans-serif"], DEFAULTS, "sc")).toBe(true);
      expect(support.shouldPreserve(["仿宋", "sans-serif"], DEFAULTS, "tc")).toBe(true);
      expect(support.shouldPreserve(["FandolFang", "sans-serif"], DEFAULTS, "sc")).toBe(true);
      expect(support.shouldPreserve(["FangSong", "sans-serif"], DEFAULTS, "jp")).toBe(false);
      expect(support.shouldPreserve(["STFangsong", "sans-serif"], DEFAULTS, "jp")).toBe(false);
      expect(support.shouldPreserve(
        ["FangSong SC", "sans-serif"], { ...DEFAULTS, preserveKnownCjk: false }, "sc"
      )).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows fallback when the declared Fangsong family is unavailable", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 1 })
        })
      })
    });
    try {
      expect(new FontSupport().shouldPreserve(["FangSong", "sans-serif"], DEFAULTS, "sc"))
        .toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
