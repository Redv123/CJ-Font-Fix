import type { ChineseVariant, Settings, Variant } from "../shared/types";

/** Use the browser UI locale only when no Chinese default has been saved. */
export function defaultChineseForLanguage(language: string): ChineseVariant {
  return language === "zh-TW" ? "tc" : "sc";
}

const browserLanguage = typeof chrome === "undefined" ? "" : chrome.i18n?.getUILanguage?.() || "";

// Site overrides are stored with the settings but intentionally have a
// separate reset lifecycle in the options UI.
export const DEFAULTS: Settings = {
  fontSC: "",
  fontTC: "",
  fontJP: "",
  fontSCSerif: "",
  fontTCSerif: "",
  fontJPSerif: "",
  defaultChinese: defaultChineseForLanguage(browserLanguage),
  trustCjkLang: true,
  preserveWebFonts: true,
  preserveKnownCjk: true,
  simpleMode: false,
  dynamicDetection: true,
  mixedLanguageDetection: false,
  siteOverrides: {}
};

export const FONT_SETTINGS = {
  fontSC: { variant: "sc", category: "sans" },
  fontTC: { variant: "tc", category: "sans" },
  fontJP: { variant: "jp", category: "sans" },
  fontSCSerif: { variant: "sc", category: "serif" },
  fontTCSerif: { variant: "tc", category: "serif" },
  fontJPSerif: { variant: "jp", category: "serif" }
} as const satisfies Record<string, { variant: Variant; category: "sans" | "serif" }>;

export type FontSettingKey = keyof typeof FONT_SETTINGS;
