import {
  isGenericFamily,
  isFangsongFamily,
  normalizeFamily,
  regionalVariantForFamily,
  windowsCjkVariantForFamily
} from "./font-family";
import { classifyUnicodeRange } from "./unicode-range";
import type { InstalledFont, Settings, Variant } from "../shared/types";

const CJK_NAME_RE = /(?:cjk|source\s*han|思源|noto\s*(?:sans|serif)?\s*(?:sc|tc|jp|hk)|wenquanyi|文泉驿|hiragino|yu\s*(?:gothic|mincho)|meiryo|ms\s*(?:gothic|mincho)|pingfang|heiti|songti|kaiti|microsoft\s*(?:yahei|jhenghei)|dengxian|sim(?:sun|hei|kai)|mingliu|pmingliu|ipa(?:gothic|mincho)|takao|sarasa|更紗|霞鶩|lxgw)/i;

export { regionalVariantForFamily } from "./font-family";

/** Prepare only names that can participate in website-font preservation. */
export function installedCjkFamilies(fonts: readonly InstalledFont[]): string[] {
  const families = new Set<string>();
  for (const font of fonts) {
    for (const name of [font.fontId, font.displayName]) {
      const key = normalizeFamily(name).toLowerCase();
      if (CJK_NAME_RE.test(key) || isFangsongFamily(key)) families.add(key);
    }
  }
  return [...families];
}

/**
 * Decides whether an existing reachable family makes injection unnecessary.
 * Browser font APIs cannot reveal the exact fallback used for one glyph, so
 * this combines declared @font-face coverage, known CJK names, and availability.
 */
export class FontSupport {
  private installedFamilies: ReadonlySet<string> = new Set();
  private readonly customCjkFamilies = new Set<string>();
  private metadataDirty = true;
  private platformOs: string | null = null;

  setPlatform(os: string | null): void {
    this.platformOs = os;
  }

  setInstalledFamilies(families: readonly string[]): void {
    this.installedFamilies = new Set(families);
  }

  markMetadataDirty(): void {
    this.metadataDirty = true;
  }

  refreshCustomFonts(): void {
    if (!this.metadataDirty) return;
    this.metadataDirty = false;
    this.customCjkFamilies.clear();
    try {
      for (const face of document.fonts) {
        const family = normalizeFamily(face.family || "");
        if (!family) continue;
        // Unicode-range subsets load on demand. Unloaded is not failure, but
        // an errored face cannot supply the website's intended CJK glyphs.
        if (face.status === "error") continue;
        if (classifyUnicodeRange(face.unicodeRange) === "cjk") {
          this.customCjkFamilies.add(family.toLowerCase());
        }
      }
    } catch (_) {
      // Some older Chromium builds do not expose FontFaceSet iteration.
    }
  }

  /**
   * Preserve an existing reachable CJK path when it is region-neutral, matches
   * the requested variant, or is an available Fangsong family on Chinese text.
   * Fangsong cannot block a Japanese fallback; other wrong-region families
   * also do not block insertion.
   * One preference covers both declared font faces and named installed fonts.
   */
  shouldPreserve(families: string[], settings: Settings, desiredVariant?: Variant): boolean {
    const genericIndex = families.findIndex(isGenericFamily);
    const reachable = genericIndex < 0 ? families : families.slice(0, genericIndex);
    const explicit = reachable.filter((family) => !isGenericFamily(family));
    if (!explicit.length) return false;

    if (!settings.preserveWebsiteFonts) return false;
    const custom = explicit.find((family) => this.customCjkFamilies.has(family.toLowerCase()));
    if (custom) {
      const variant = regionalVariantForFamily(custom);
      if (isFangsongFamily(custom)) return desiredVariant !== "jp";
      return !desiredVariant || !variant || variant === desiredVariant;
    }
    const known = explicit.find((family) =>
      this.installedFamilies.has(normalizeFamily(family).toLowerCase()) ||
      (this.platformOs === "linux" && settings.trustWindowsFonts && windowsCjkVariantForFamily(family) !== null)
    );
    if (!known) return false;
    const variant = windowsCjkVariantForFamily(known) ?? regionalVariantForFamily(known);
    if (isFangsongFamily(known)) return desiredVariant !== "jp";
    return !desiredVariant || !variant || variant === desiredVariant;
  }
}
