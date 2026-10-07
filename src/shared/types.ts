export type Variant = "sc" | "tc" | "jp";
export type ChineseVariant = Extract<Variant, "sc" | "tc">;
export type SiteOverride = Variant | "off";
export type SiteChoice = SiteOverride | "auto";
export type SiteScope = "hostname" | "domain";
export type FontCategory = "sans" | "serif";

export interface Settings {
  fontSC: string;
  fontTC: string;
  fontJP: string;
  fontSCSerif: string;
  fontTCSerif: string;
  fontJPSerif: string;
  defaultChinese: ChineseVariant;
  trustCjkLang: boolean;
  preserveWebsiteFonts: boolean;
  simpleMode: boolean;
  dynamicDetection: boolean;
  mixedLanguageDetection: boolean;
  siteOverrides: Record<string, SiteChoice>;
  siteDomainOverrides: Record<string, SiteOverride>;
}

export interface DetectionResult {
  htmlLang: string;
  detectedLanguage: string;
  reliable: boolean;
  variant: Variant | null;
  reason: string;
}

export interface ContentStatus {
  hostname: string;
  simpleMode: boolean;
  htmlLang: string;
  pageVariant: Variant | null;
  detectedVariants?: Variant[];
  reason: string;
  fallbackChoice: string | null;
  changedElements: number;
  simpleLang: string;
  siteOverride: SiteChoice | null;
  siteDomain?: string | null;
  hostnameChoice?: SiteChoice;
  domainChoice?: SiteOverride;
}

export type ContentMessage =
  | { type: "getStatus" }
  | { type: "setSiteOverride"; value: SiteChoice | "inherit"; scope?: SiteScope };

export interface SiteRuleEdit {
  type: "editSiteRule";
  scope: SiteScope;
  hostname: string;
  value: SiteChoice | null;
  previousHostname?: string;
}

export interface SiteRuleResult {
  ok: boolean;
  error?: string;
}

export interface ActionStateMessage {
  type: "setActionState";
  inUse: boolean;
}

export interface InstalledFont {
  fontId: string;
  displayName: string;
}
