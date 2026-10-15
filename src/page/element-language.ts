import { closestComposed } from "./candidate-scan";
import { isVariant, langToVariant } from "../language/tags";
import type { Settings, Variant } from "../shared/types";

/** Match textContent.slice(0, 3000) without reading the remaining descendants. */
function classificationSample(owner: Element): string {
  const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  let sample = "";
  while (sample.length < 3000) {
    const node = walker.nextNode();
    if (!node) break;
    sample += (node.nodeValue || "").slice(0, 3000 - sample.length);
  }
  return sample;
}

/**
 * Resolves inherited element-level `lang` without changing the DOM.
 * Bare `zh` is classified separately because it carries no script information.
 */
export class ElementLanguage {
  private readonly classificationCache = new WeakMap<Element, "sc" | "tc">();

  constructor(
    private readonly pageVariant: Variant | null,
    private readonly settings: Settings,
    private readonly classifyChinese: (text: string) => "sc" | "tc"
  ) {}

  explicitVariantFor(element: Element): Variant | null {
    const owner = closestComposed(element, "[lang]");
    if (!owner || owner === document.documentElement) return null;
    const variant = langToVariant(owner.getAttribute("lang") || "");
    return variant === "zh" ? this.classifiedVariantFor(owner) : variant;
  }

  browserHandlesLanguageFor(element: Element): boolean {
    if (!this.settings.trustCjkLang) return false;
    const owner = closestComposed(element, "[lang]");
    if (!owner) return false;
    // Only declarations that identify a supported region are sufficient to
    // leave font selection to the browser. Bare zh and unrelated languages
    // still need the usual CJK detection and font pipeline.
    const variant = langToVariant(owner.getAttribute("lang") || "");
    return isVariant(variant);
  }

  private classifiedVariantFor(owner: Element): Variant | null {
    if (owner === document.documentElement) return this.pageVariant;
    const cached = this.classificationCache.get(owner);
    if (cached) return cached;
    const variant = this.classifyChinese(classificationSample(owner));
    this.classificationCache.set(owner, variant);
    return variant;
  }
}
