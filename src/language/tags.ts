import type { ChineseVariant, Variant } from "../shared/types";

/** Maps browser language tags to the regional variants supported by the extension. */

export type DeclaredVariant = Variant | "zh" | null;

export function langToVariant(lang: string): DeclaredVariant {
  const value = (lang || "").trim().toLowerCase().replace(/_/g, "-");
  if (!value) return null;
  const parts = value.split("-");
  if (parts[0] === "ja") return "jp";
  if (parts[0] === "zh") {
    if (parts.includes("hant") || parts.some((part) => ["tw", "hk", "mo"].includes(part))) return "tc";
    if (parts.includes("hans") || parts.some((part) => ["cn", "sg", "my"].includes(part))) return "sc";
    return "zh";
  }
  return null;
}

export function variantToLang(variant: Variant | null): string {
  if (variant === "jp") return "ja";
  if (variant === "tc") return "zh-TW";
  if (variant === "sc") return "zh-CN";
  return "";
}

/**
 * Choose a page-level Chinese default from script clues. This always returns
 * SC or TC, including when clues are absent or tied; local high-confidence
 * decisions must use analyzeCjkEvidence instead of treating this as proof.
 */
export function classifyChinese(
  text: string,
  simplifiedClues: ReadonlySet<string>,
  traditionalClues: ReadonlySet<string>,
  defaultVariant: ChineseVariant
): ChineseVariant {
  let sc = 0;
  let tc = 0;
  for (const char of text) {
    if (simplifiedClues.has(char)) sc++;
    if (traditionalClues.has(char)) tc++;
  }
  if (sc === 0 && tc === 0) return defaultVariant;
  if (sc >= tc * 1.35) return "sc";
  if (tc >= sc * 1.35) return "tc";
  return defaultVariant;
}
