import { describe, expect, it, vi } from "vitest";
import { FontSupport, installedCjkFamilies, regionalVariantForFamily } from "../src/fonts/font-support";
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
    const support = new FontSupport();
    support.setInstalledFamilies(installedCjkFamilies([{ fontId: "Noto Sans CJK SC", displayName: "Noto Sans CJK SC" }]));
    const settings = { ...DEFAULTS, preserveWebsiteFonts: true };
    expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], settings, "jp"))
      .toBe(false);
    expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], settings, "sc"))
      .toBe(true);
    expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], {
      ...settings, preserveWebsiteFonts: false
    }, "sc")).toBe(false);
    expect(support.shouldPreserve(["sans-serif", "Noto Sans CJK SC"], settings, "sc"))
      .toBe(false);
  });

  it("matches font IDs and display names without case, spacing, or surrounding quotes", () => {
    const support = new FontSupport();
    support.setInstalledFamilies(installedCjkFamilies([{ fontId: " NotoSansCJKSC ", displayName: " Noto Sans CJK SC " }]));
    expect(support.shouldPreserve(["notosanscjksc", "sans-serif"], DEFAULTS, "sc")).toBe(true);
    expect(support.shouldPreserve([' "noto sans cjk sc" ', "sans-serif"], DEFAULTS, "sc")).toBe(true);
    support.setInstalledFamilies([]);
    expect(support.shouldPreserve(["Noto Sans CJK SC", "sans-serif"], DEFAULTS, "sc")).toBe(false);
  });

  it("retains only installed names eligible for the website-font preservation decision", () => {
    const support = new FontSupport();
    const families = installedCjkFamilies([
      { fontId: "Arial", displayName: "Arial" },
      { fontId: "Times New Roman", displayName: "Times New Roman" },
      { fontId: "Noto Color Emoji", displayName: "Noto Color Emoji" },
      { fontId: "NotoSansCJKSC", displayName: "Unclassified Display Alias" },
      { fontId: "Unclassified Font ID", displayName: "PingFang SC" },
      { fontId: "FandolFang", displayName: "仿宋" }
    ]);
    expect(families).toEqual(["notosanscjksc", "pingfang sc", "fandolfang", "仿宋"]);
    support.setInstalledFamilies(families);
    for (const family of ["Arial", "Times New Roman", "Noto Color Emoji",
      "Unclassified Display Alias", "Unclassified Font ID"]) {
      expect(support.shouldPreserve([family, "sans-serif"], DEFAULTS, "sc")).toBe(false);
    }
    for (const family of ["NotoSansCJKSC", "PingFang SC", "FandolFang", "仿宋"]) {
      expect(support.shouldPreserve([family, "sans-serif"], DEFAULTS, "sc")).toBe(true);
    }
  });

  it("preserves an available Fangsong for Chinese, but not Japanese", () => {
    const support = new FontSupport();
    support.setInstalledFamilies(installedCjkFamilies(["FangSong", "FangSong SC", "STFangsong", "仿宋", "FandolFang"]
      .map((name) => ({ fontId: name, displayName: name }))));
    expect(support.shouldPreserve(["FangSong", "sans-serif"], DEFAULTS, "sc")).toBe(true);
    expect(support.shouldPreserve(["FangSong SC", "sans-serif"], DEFAULTS, "tc")).toBe(true);
    expect(support.shouldPreserve(["STFangsong", "sans-serif"], DEFAULTS, "sc")).toBe(true);
    expect(support.shouldPreserve(["仿宋", "sans-serif"], DEFAULTS, "tc")).toBe(true);
    expect(support.shouldPreserve(["FandolFang", "sans-serif"], DEFAULTS, "sc")).toBe(true);
    expect(support.shouldPreserve(["FangSong", "sans-serif"], DEFAULTS, "jp")).toBe(false);
    expect(support.shouldPreserve(["STFangsong", "sans-serif"], DEFAULTS, "jp")).toBe(false);
    expect(support.shouldPreserve(
      ["FangSong SC", "sans-serif"], { ...DEFAULTS, preserveWebsiteFonts: false }, "sc"
    )).toBe(false);
  });

  it("does not preserve missing fonts even when Canvas measurements would vary", () => {
    let width = 100;
    const createElement = vi.fn(() => ({
      getContext: () => ({ font: "", measureText: () => ({ width: width += 0.01 }) })
    }));
    vi.stubGlobal("document", {
      createElement
    });
    try {
      const support = new FontSupport();
      support.setInstalledFamilies(installedCjkFamilies([{ fontId: "Arial", displayName: "Arial" }]));
      for (const family of ["Microsoft YaHei", "PingFang SC", "FangSong", "CJK Missing Font"]) {
        expect(support.shouldPreserve([family, "sans-serif"], DEFAULTS, "sc")).toBe(false);
      }
      expect(createElement).not.toHaveBeenCalled();
      expect(new FontSupport().shouldPreserve(["Microsoft YaHei", "sans-serif"], DEFAULTS, "sc"))
        .toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Linux system replacements for Windows CJK fonts", () => {
  it("trusts supported declarations without requiring an installed family", () => {
    const support = new FontSupport();
    support.setPlatform("linux");
    for (const [variant, names] of [
      ["sc", ["Microsoft YaHei", "微软雅黑", "SimSun", "NSimSun", "新宋体"]],
      ["tc", ["Microsoft JhengHei UI", "微軟正黑體", "MingLiU", "新細明體"]],
      ["jp", ["MS Gothic", "ＭＳ 明朝", "MS UI Gothic", "Meiryo", "メイリオ", "Meiryo UI", "Yu Gothic UI"]]
    ] as const) {
      for (const name of names) {
        expect(support.shouldPreserve([name, "sans-serif"], DEFAULTS, variant), name).toBe(true);
      }
    }
    expect(support.shouldPreserve([' "microsoft yahei" ', "sans-serif"], DEFAULTS, "sc")).toBe(true);
  });

  it("does not assume all Windows fonts or arbitrary names have configured substitutes", () => {
    const support = new FontSupport();
    support.setPlatform("linux");
    for (const name of ["BIZ UDGothic", "DengXian", "KaiTi", "Missing CJK Font",
      "Microsoft YaHei Missing", "Arial", "PingFang SC"]) {
      expect(support.shouldPreserve([name, "sans-serif"], DEFAULTS, "sc"), name).toBe(false);
    }
  });

  it("retains regional decisions and the first generic boundary", () => {
    const support = new FontSupport();
    support.setPlatform("linux");
    expect(support.shouldPreserve(["微软雅黑", "sans-serif"], DEFAULTS, "jp")).toBe(false);
    expect(support.shouldPreserve(["Microsoft YaHei", "sans-serif"], DEFAULTS, "tc")).toBe(false);
    expect(support.shouldPreserve(["MS UI Gothic", "sans-serif"], DEFAULTS, "sc")).toBe(false);
    expect(support.shouldPreserve(["sans-serif", "Microsoft YaHei"], DEFAULTS, "sc")).toBe(false);
    expect(support.shouldPreserve(["Arial", "SimSun", "sans-serif"], DEFAULTS, "sc")).toBe(true);
  });

  it("honors both switches and never enables alias trust outside Linux", () => {
    const support = new FontSupport();
    for (const os of [null, "win", "mac", "cros"] as const) {
      support.setPlatform(os);
      expect(support.shouldPreserve(["Microsoft YaHei", "sans-serif"], DEFAULTS, "sc")).toBe(false);
    }
    support.setPlatform("linux");
    expect(support.shouldPreserve(["Microsoft YaHei", "sans-serif"], {
      ...DEFAULTS, trustWindowsFonts: false
    }, "sc")).toBe(false);
    expect(support.shouldPreserve(["Microsoft YaHei", "sans-serif"], {
      ...DEFAULTS, preserveWebsiteFonts: false
    }, "sc")).toBe(false);
    // Disabling the exception does not stop ordinary installed-font preservation.
    support.setInstalledFamilies(installedCjkFamilies([{ fontId: "Microsoft YaHei", displayName: "Microsoft YaHei" }]));
    expect(support.shouldPreserve(["Microsoft YaHei", "sans-serif"], {
      ...DEFAULTS, trustWindowsFonts: false
    }, "sc")).toBe(true);
  });
});

describe("website-declared font faces", () => {
  it("preserves a declared CJK family with unloaded subsets, not failed faces", () => {
    vi.stubGlobal("document", {
      fonts: [
        { family: "Site CJK", unicodeRange: "U+4E00-9FFF", status: "unloaded" },
        { family: "Broken CJK", unicodeRange: "U+4E00-9FFF", status: "error" }
      ]
    });
    try {
      const support = new FontSupport();
      support.refreshCustomFonts();
      expect(support.shouldPreserve(["Site CJK", "sans-serif"], DEFAULTS, "sc")).toBe(true);
      expect(support.shouldPreserve(["Site CJK", "sans-serif"], {
        ...DEFAULTS, preserveWebsiteFonts: false
      }, "sc")).toBe(false);
      expect(support.shouldPreserve(["Broken CJK", "sans-serif"], DEFAULTS, "sc")).toBe(false);
      vi.stubGlobal("document", { fonts: [] });
      support.markMetadataDirty();
      support.refreshCustomFonts();
      expect(support.shouldPreserve(["Site CJK", "sans-serif"], DEFAULTS, "sc")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
