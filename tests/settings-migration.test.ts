import { describe, expect, it } from "vitest";
import { preserveWebsiteFontsFromStorage, settingsFromStorage } from "../src/settings/defaults";

describe("website-font preference migration", () => {
  it("keeps the combined preference on if either old preference was on", () => {
    expect(preserveWebsiteFontsFromStorage({ preserveWebFonts: true, preserveKnownCjk: false })).toBe(true);
    expect(preserveWebsiteFontsFromStorage({ preserveWebFonts: false, preserveKnownCjk: true })).toBe(true);
    expect(preserveWebsiteFontsFromStorage({ preserveWebFonts: false, preserveKnownCjk: false })).toBe(false);
  });

  it("uses the new value in preference to legacy values and defaults to on", () => {
    expect(settingsFromStorage({}).preserveWebsiteFonts).toBe(true);
    expect(settingsFromStorage({ preserveWebsiteFonts: false, preserveWebFonts: true })
      .preserveWebsiteFonts).toBe(false);
  });
});
