import { closestComposed } from "./candidate-scan";
import { langToVariant } from "../language/tags";
import type { Settings, Variant } from "../shared/types";

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
    const language = (owner.getAttribute("lang") || "").trim();

    // A descendant language declaration is deliberate, even when its BCP 47
    // tag is outside the three regional variants supported by this extension.
    // The browser must retain control of that explicitly annotated content.
    if (owner !== document.documentElement) return Boolean(language);

    const variant = langToVariant(language);
    if (variant === "sc" || variant === "tc" || variant === "jp") return true;
    if (variant === "zh") {
      const detected = this.classifiedVariantFor(owner);
      return detected === this.settings.defaultChinese;
    }
    return false;
  }

  private classifiedVariantFor(owner: Element): Variant | null {
    if (owner === document.documentElement) return this.pageVariant;
    const cached = this.classificationCache.get(owner);
    if (cached) return cached;
    const variant = this.classifyChinese(owner.textContent?.slice(0, 3000) || "");
    this.classificationCache.set(owner, variant);
    return variant;
  }
}
