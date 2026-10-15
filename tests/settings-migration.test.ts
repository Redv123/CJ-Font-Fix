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

  it("defaults Windows-font trust to on without overwriting an explicit choice", () => {
    expect(settingsFromStorage({}).trustWindowsFonts).toBe(true);
    expect(settingsFromStorage({ trustWindowsFonts: false }).trustWindowsFonts).toBe(false);
  });

  it("turns Windows-font trust off when website-font preservation is disabled", () => {
    expect(settingsFromStorage({ preserveWebsiteFonts: false }).trustWindowsFonts).toBe(false);
    expect(settingsFromStorage({ preserveWebsiteFonts: false, trustWindowsFonts: true })
      .trustWindowsFonts).toBe(false);
    expect(settingsFromStorage({ preserveWebFonts: false, preserveKnownCjk: false, trustWindowsFonts: true })
      .trustWindowsFonts).toBe(false);
  });
});
