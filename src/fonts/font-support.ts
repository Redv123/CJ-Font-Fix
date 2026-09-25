import {
  isGenericFamily,
  isFangsongFamily,
  normalizeFamily,
  quoteFamily,
  regionalVariantForFamily
} from "./font-family";
import { classifyUnicodeRange } from "./unicode-range";
import type { Settings, Variant } from "../shared/types";

const CJK_NAME_RE = /(?:cjk|source\s*han|思源|noto\s*(?:sans|serif)?\s*(?:sc|tc|jp|hk)|wenquanyi|文泉驿|hiragino|yu\s*(?:gothic|mincho)|meiryo|ms\s*(?:gothic|mincho)|pingfang|heiti|songti|kaiti|microsoft\s*(?:yahei|jhenghei)|dengxian|sim(?:sun|hei|kai)|mingliu|pmingliu|ipa(?:gothic|mincho)|takao|sarasa|更紗|霞鶩|lxgw)/i;

export { regionalVariantForFamily } from "./font-family";

/**
 * Decides whether an existing reachable family makes injection unnecessary.
 * Browser font APIs cannot reveal the exact fallback used for one glyph, so
 * this combines declared @font-face coverage, known CJK names, and availability.
 */
export class FontSupport {
  private readonly availableCache = new Map<string, boolean>();
  private readonly customCjkFamilies = new Set<string>();
  private metadataDirty = true;

  clearAvailability(): void {
    this.availableCache.clear();
  }

  markMetadataDirty(): void {
    this.metadataDirty = true;
  }

  noteLoadedFaces(faces: readonly FontFace[]): void {
    for (const face of faces) {
      const key = normalizeFamily(face.family || "").toLowerCase();
      if (key) this.availableCache.delete(key);
    }
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
   * Settings independently control web fonts and known installed families.
   */
  shouldPreserve(families: string[], settings: Settings, desiredVariant?: Variant): boolean {
    const genericIndex = families.findIndex(isGenericFamily);
    const reachable = genericIndex < 0 ? families : families.slice(0, genericIndex);
    const explicit = reachable.filter((family) => !isGenericFamily(family));
    if (!explicit.length) return false;

    if (settings.preserveWebFonts) {
      const custom = explicit.find((family) => this.customCjkFamilies.has(family.toLowerCase()));
      if (custom) {
        const variant = regionalVariantForFamily(custom);
        if (isFangsongFamily(custom)) return desiredVariant !== "jp";
        return !desiredVariant || !variant || variant === desiredVariant;
      }
    }
    if (!settings.preserveKnownCjk) return false;
    const known = explicit.find((family) =>
      (CJK_NAME_RE.test(family) || isFangsongFamily(family)) && this.appearsAvailable(family)
    );
    if (!known) return false;
    const variant = regionalVariantForFamily(known);
    if (isFangsongFamily(known)) return desiredVariant !== "jp";
    return !desiredVariant || !variant || variant === desiredVariant;
  }

  // Canvas width comparison is an availability hint, not a rendered-font API:
  // Chromium does not expose which physical face supplied an individual glyph.
  private appearsAvailable(family: string): boolean {
    const key = family.toLowerCase();
    if (this.availableCache.has(key)) return this.availableCache.get(key) ?? false;
    if (isGenericFamily(key)) return true;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return true;
    const probe = "mmmmmmmmmmlli漢字かなWW";
    const size = "72px";
    const available = ["monospace", "serif", "sans-serif"].some((baseline) => {
      context.font = `${size} ${baseline}`;
      const baseWidth = context.measureText(probe).width;
      context.font = `${size} ${quoteFamily(family)}, ${baseline}`;
      return context.measureText(probe).width !== baseWidth;
    });
    this.availableCache.set(key, available);
    return available;
  }
}
