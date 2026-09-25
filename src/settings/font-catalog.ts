import type { FontCategory, InstalledFont, Variant } from "../shared/types";

// Preference order is used only when selecting an installed default. Runtime
// stack composition never assumes that these are the only possible CJK fonts.
const PREFERRED: Record<FontCategory, Record<Variant, readonly string[]>> = {
  sans: {
    sc: [
      "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei",
      "Source Han Sans SC", "WenQuanYi Micro Hei", "SimHei"
    ],
    tc: [
      "Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei",
      "Source Han Sans TC", "Heiti TC"
    ],
    jp: [
      "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic",
      "YuGothic", "Meiryo", "Source Han Sans JP"
    ]
  },
  serif: {
    sc: [
      "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC",
      "Songti SC", "STSong", "SimSun"
    ],
    tc: [
      "Noto Serif CJK TC", "Noto Serif TC", "Source Han Serif TC",
      "Songti TC", "LiSong Pro", "PMingLiU", "MingLiU"
    ],
    jp: [
      "Noto Serif CJK JP", "Noto Serif JP", "Source Han Serif JP",
      "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "YuMincho", "MS Mincho"
    ]
  }
};

export function normalizeFonts(fonts: readonly chrome.fontSettings.FontName[]): InstalledFont[] {
  const unique = new Map<string, InstalledFont>();
  for (const font of fonts) {
    const fontId = String(font?.fontId || "").trim();
    if (!fontId) continue;
    const key = fontId.toLocaleLowerCase();
    if (!unique.has(key)) {
      unique.set(key, {
        fontId,
        displayName: String(font?.displayName || fontId).trim() || fontId
      });
    }
  }
  return [...unique.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
  );
}

export function findInstalled(fonts: readonly InstalledFont[], name: unknown): InstalledFont | null {
  const wanted = String(name || "").trim().toLocaleLowerCase();
  if (!wanted) return null;
  return fonts.find((font) =>
    font.fontId.toLocaleLowerCase() === wanted ||
    font.displayName.toLocaleLowerCase() === wanted
  ) ?? null;
}

export function defaultFor(
  fonts: readonly InstalledFont[],
  variant: Variant,
  category: FontCategory = "sans"
): string {
  for (const candidate of PREFERRED[category][variant]) {
    const match = findInstalled(fonts, candidate);
    if (match) return match.fontId;
  }
  return "";
}

/** Keep a saved installed family; otherwise use this platform's first match. */
export function validChoice(
  fonts: readonly InstalledFont[],
  value: unknown,
  variant: Variant,
  category: FontCategory = "sans"
): string {
  return findInstalled(fonts, value)?.fontId ?? defaultFor(fonts, variant, category);
}

export async function getInstalledFonts(): Promise<InstalledFont[]> {
  const fonts = await chrome.fontSettings.getFontList();
  return normalizeFonts(fonts);
}
