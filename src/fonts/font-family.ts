/**
 * Pure font-stack policy for advanced mode.
 *
 * This module parses CSS family lists and decides where a configured regional
 * fallback belongs. It does not inspect installed fonts, rendered glyphs, or
 * the DOM; FontSupport and FallbackController make those separate decisions.
 * The site-provided stack remains the input rather than a platform template.
 */

// Generic families hand selection to the browser; entries after the first one
// are not treated as reachable explicit families by this insertion policy.
// Bare "FangSong" is a named family, not the draft generic(fangsong).
// The former emoji generic was dropped from CSS Fonts 4; preserve it as an
// explicit family name if a site still includes it in a font stack.
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math"
]);
const SERIF_FAMILIES = new Set(["serif", "ui-serif"]);

export function normalizeFamily(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "").trim();
}

/** Split a computed CSS family list without splitting commas inside quotes. */
export function parseFamilies(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const char of value || "") {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
    } else if (char === "," && !quote) {
      if (current.trim()) parts.push(normalizeFamily(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(normalizeFamily(current));
  return parts;
}

/** Quote an explicit family for a newly composed CSS declaration. */
export function quoteFamily(name: string): string {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Recognize named Chinese Fangsong faces across Windows, macOS, and Linux. */
export function isFangsongFamily(family: string): boolean {
  return /fang[\s-]?song|仿宋|fandol[\s-]?fang/i.test(normalizeFamily(family));
}

/**
 * Recognize a region from a known family name, not from its glyph coverage.
 * Null also covers Latin and region-neutral CJK families, which must not be
 * guessed into SC, TC, or JP merely because they occur in a website stack.
 */
export function regionalVariantForFamily(family: string): Variant | null {
  const value = normalizeFamily(family).toLowerCase();
  const regionalFamily = /cjk|source\s*han|noto/.test(value);
  if (/hiragino.*\bgb\b|sf\s*pro\s*sc/.test(value)) return "sc";
  if ((regionalFamily && /\b(?:jp|japanese)\b/.test(value)) ||
      /hiragino|yu\s*(?:gothic|mincho)|meiryo|ms\s*(?:gothic|mincho)|ipa(?:gothic|mincho)|takao/.test(value)) {
    return "jp";
  }
  if ((regionalFamily && /\b(?:tc|hk|traditional)\b/.test(value)) ||
      /pingfang\s*(?:tc|hk)|(?:heiti|songti|kaiti|fangsong)\s*tc|jhenghei|mingliu|pmingliu/.test(value)) {
    return "tc";
  }
  if ((regionalFamily && /\b(?:sc|simplified)\b/.test(value)) ||
      /pingfang\s*sc|(?:heiti|songti|kaiti|fangsong)\s*sc|yahei|dengxian|sim(?:sun|hei|kai)/.test(value)) {
    return "sc";
  }
  return null;
}

/**
 * Insert one configured fallback while retaining the website's explicit fonts.
 *
 * If a wrong-region CJK family is reachable before the first generic, move
 * the selected family ahead of all recognized regional families in that prefix.
 * A named Fangsong face is Chinese-style and counts as a conflict for Japanese,
 * even without a regional suffix. Keep unrecognized families (including Latin
 * and region-neutral web fonts) ahead of it. Without a conflict, insert
 * just before the first generic, or append when there is none. Families after
 * the first generic are not reordered.
 *
 * excludedFamilies removes a fallback inherited from an ancestor that the
 * extension previously styled for another variant. An already-present
 * selected family returns the original stack unchanged; this is idempotence,
 * not a check that the browser will render every glyph from that family.
 */
export function composeFontFamily(
  baseFamily: string,
  fallback: string,
  desiredVariant?: Variant,
  excludedFamilies: readonly string[] = []
): string {
  const excluded = new Set(excludedFamilies.map((family) => family.toLowerCase()));
  const families = parseFamilies(baseFamily)
    .filter((family) => !excluded.has(family.toLowerCase()));
  if (families.some((family) => family.toLowerCase() === fallback.toLowerCase())) return baseFamily;
  const isRegionalForOrdering = (family: string): boolean =>
    regionalVariantForFamily(family) !== null ||
    (desiredVariant === "jp" && isFangsongFamily(family));
  const regionalInsertion = desiredVariant
    ? families.findIndex((family) => {
      const variant = regionalVariantForFamily(family);
      return (variant !== null && variant !== desiredVariant) ||
        (desiredVariant === "jp" && isFangsongFamily(family));
    })
    : -1;
  const genericInsertion = families.findIndex((family) => GENERIC_FAMILIES.has(family.toLowerCase()));
  let output: string[];
  if (regionalInsertion >= 0) {
    // Only the prefix before the first generic participates in regional
    // ordering. Preserve the remaining tail exactly where the site put it.
    const reachableEnd = genericInsertion < 0 ? families.length : genericInsertion;
    const reachable = families.slice(0, reachableEnd);
    const latin = reachable.filter((family) => !isRegionalForOrdering(family));
    const regional = reachable.filter(isRegionalForOrdering);
    output = [...latin, fallback, ...regional, ...families.slice(reachableEnd)];
  } else {
    output = [...families];
    output.splice(genericInsertion < 0 ? output.length : genericInsertion, 0, fallback);
  }
  return output
    .map((family) => GENERIC_FAMILIES.has(family.toLowerCase()) ? family : quoteFamily(family))
    .join(", ");
}

export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase());
}

/** The first generic chooses Serif or Sans; a later serif does not override it. */
export function usesSerifFallback(families: readonly string[]): boolean {
  const generic = families.find(isGenericFamily);
  return generic ? SERIF_FAMILIES.has(generic.toLowerCase()) : false;
}
import type { Variant } from "../shared/types";
