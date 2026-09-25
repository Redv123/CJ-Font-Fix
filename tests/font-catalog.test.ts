import { describe, expect, it } from "vitest";
import {
  defaultFor,
  findInstalled,
  normalizeFonts,
  validChoice
} from "../src/settings/font-catalog";
import type { InstalledFont } from "../src/shared/types";

const fonts: InstalledFont[] = [
  { fontId: "Arial", displayName: "Arial" },
  { fontId: "Noto Sans CJK SC", displayName: "Noto Sans CJK SC" },
  { fontId: "Noto Serif CJK SC", displayName: "Noto Serif CJK SC" }
];

describe("regional font defaults", () => {
  it("selects separate Sans and Serif defaults", () => {
    expect(defaultFor(fonts, "sc", "sans")).toBe("Noto Sans CJK SC");
    expect(defaultFor(fonts, "sc", "serif")).toBe("Noto Serif CJK SC");
  });

  it("does not select an arbitrary installed font", () => {
    const unrelated = [{ fontId: "Arial", displayName: "Arial" }];
    expect(defaultFor(unrelated, "sc", "sans")).toBe("");
    expect(validChoice(unrelated, "Missing Font", "tc", "serif")).toBe("");
  });

  it("uses the preference order instead of the installed-font order", () => {
    const reversed: InstalledFont[] = [
      { fontId: "SimHei", displayName: "SimHei" },
      { fontId: "Noto Sans SC", displayName: "Noto Sans SC" },
      { fontId: "Noto Sans CJK SC", displayName: "Noto Sans CJK SC" }
    ];
    expect(defaultFor(reversed, "sc", "sans")).toBe("Noto Sans CJK SC");
  });

  it.each([
    ["tc", "sans", "Noto Sans CJK TC"],
    ["jp", "sans", "Noto Sans CJK JP"],
    ["tc", "serif", "Noto Serif CJK TC"],
    ["jp", "serif", "Noto Serif CJK JP"]
  ] as const)("selects the %s %s default", (variant, category, expected) => {
    const regional: InstalledFont[] = [{ fontId: expected, displayName: expected }];
    expect(defaultFor(regional, variant, category)).toBe(expected);
  });

  it("keeps a valid saved choice even when it is not a preferred default", () => {
    expect(validChoice(fonts, "Arial", "sc", "sans")).toBe("Arial");
  });

  it("matches saved choices by ID or display name without regard to case", () => {
    const aliased: InstalledFont[] = [{ fontId: "NotoSansJP", displayName: "Noto Sans JP" }];
    expect(findInstalled(aliased, " notosansjp ")?.fontId).toBe("NotoSansJP");
    expect(findInstalled(aliased, "noto sans jp")?.fontId).toBe("NotoSansJP");
    expect(findInstalled(aliased, "")).toBeNull();
  });
});

describe("installed font normalization", () => {
  it("trims values, removes case-insensitive duplicate IDs, and sorts by display name", () => {
    const normalized = normalizeFonts([
      { fontId: " z-font ", displayName: "Zulu" },
      { fontId: "Z-FONT", displayName: "Duplicate" },
      { fontId: "a-font", displayName: "Alpha" },
      { fontId: "", displayName: "Ignored" }
    ]);
    expect(normalized).toEqual([
      { fontId: "a-font", displayName: "Alpha" },
      { fontId: "z-font", displayName: "Zulu" }
    ]);
  });

  it("uses the font ID when the display name is blank", () => {
    expect(normalizeFonts([{ fontId: "Example Font", displayName: "   " }])).toEqual([
      { fontId: "Example Font", displayName: "Example Font" }
    ]);
  });
});
