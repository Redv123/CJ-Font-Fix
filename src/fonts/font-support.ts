import {
  isGenericFamily,
  isFangsongFamily,
  normalizeFamily,
  regionalVariantForFamily,
  windowsCjkVariantForFamily
} from "./font-family";
import { cjkRanges, uncoveredCjkPattern } from "./unicode-range";
import type { InstalledFont, Settings, Variant } from "../shared/types";

/** true/false is a stack-wide decision; a pattern needs the owner's direct text. */
export type FontPreservation = boolean | RegExp;

// A work bound for the text-sensitive path, not a test of a font's purpose.
const SMALL_CJK_LIMIT = 16;

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
  private readonly customCjkFamilies = new Map<string, Set<number> | null>();
  private readonly preservationPatterns = new Map<string, RegExp>();
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
    this.preservationPatterns.clear();
    try {
      for (const face of document.fonts) {
        const family = normalizeFamily(face.family || "");
        if (!family) continue;
        // Unicode-range subsets load on demand. Unloaded is not failure, but
        // an errored face cannot supply the website's intended CJK glyphs.
        if (face.status === "error") continue;
        const key = family.toLowerCase();
        let covered = this.customCjkFamilies.get(key);
        if (covered === null) continue;
        const ranges = cjkRanges(face.unicodeRange);
        if (!ranges?.length) continue;
        covered ??= new Set<number>();
        for (const [start, end] of ranges) {
          if (end - start + 1 > SMALL_CJK_LIMIT) { covered = null; break; }
          for (let code = start; code <= end; code++) covered.add(code);
          if (covered.size > SMALL_CJK_LIMIT) { covered = null; break; }
        }
        this.customCjkFamilies.set(key, covered);
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
  preservationFor(families: string[], settings: Settings, desiredVariant?: Variant): FontPreservation {
    if (!settings.preserveWebsiteFonts) return false;
    const genericIndex = families.findIndex(isGenericFamily);
    const reachable = genericIndex < 0 ? families : families.slice(0, genericIndex);
    if (!reachable.length) return false;
    const custom = reachable.find((family) => this.customCjkFamilies.has(family.toLowerCase()));
    let decision: FontPreservation = false;
    if (custom) {
      const variant = regionalVariantForFamily(custom);
      const suitable = isFangsongFamily(custom) ? desiredVariant !== "jp" :
        !desiredVariant || !variant || variant === desiredVariant;
      if (suitable) {
        const firstCoverage = this.customCjkFamilies.get(custom.toLowerCase());
        if (firstCoverage === null) return true;
        const key = JSON.stringify([reachable, desiredVariant]);
        const cached = this.preservationPatterns.get(key);
        if (cached) return cached;
        const covered = new Set<number>();
        for (const family of reachable) {
          const range = this.customCjkFamilies.get(family.toLowerCase());
          const region = regionalVariantForFamily(family);
          if (isFangsongFamily(family) ? desiredVariant === "jp" :
            desiredVariant && region && region !== desiredVariant) continue;
          if (range === null) { decision = true; break; }
          if (range) for (const code of range) covered.add(code);
        }
        if (decision !== true) {
          decision = uncoveredCjkPattern(covered);
          // Site stacks can change indefinitely; do not retain their text or an unbounded history.
          if (this.preservationPatterns.size >= 128) this.preservationPatterns.clear();
          this.preservationPatterns.set(key, decision);
        }
      }
    } else {
      const known = reachable.find((family) =>
        this.installedFamilies.has(normalizeFamily(family).toLowerCase()) ||
        (this.platformOs === "linux" && settings.trustWindowsFonts && windowsCjkVariantForFamily(family) !== null)
      );
      if (known) {
        const variant = windowsCjkVariantForFamily(known) ?? regionalVariantForFamily(known);
        decision = isFangsongFamily(known) ? desiredVariant !== "jp" :
          !desiredVariant || !variant || variant === desiredVariant;
      }
    }
    return decision;
  }
}
