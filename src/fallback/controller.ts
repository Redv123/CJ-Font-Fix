import { composeFontFamily, parseFamilies, usesSerifFallback } from "../fonts/font-family";
import { collectCandidateElements, addCandidate, isInShadowTree } from "../page/candidate-scan";
import { ElementLanguage } from "../page/element-language";
import type { FontSupport } from "../fonts/font-support";
import { langToVariant } from "../language/tags";
import type { CjkEvidence } from "../language/local-evidence";
import type { AppliedStyleState, ManagedStyles, ManagedSummary, StyleAction } from "./managed-styles";
import { MixedLanguage } from "./mixed-language";
import type { ExtendedDetection } from "../page/page-language";
import type { Settings, Variant } from "../shared/types";

interface PendingEntry {
  element: HTMLElement;
  existing: AppliedStyleState | undefined;
  variant: Variant;
  baseFamily: string;
}

export interface FallbackRun {
  pageVariant: Variant | null;
  detection: ExtendedDetection;
  fullScan: boolean;
  roots?: HTMLElement[];
  elements?: HTMLElement[];
}

/**
 * Applies advanced-mode fallbacks after page language detection has finished.
 *
 * This class owns the complete style pipeline: collect direct CJK candidates,
 * resolve an element variant, remove the extension's old style, batch all
 * computed-style reads, then batch the replacement writes. Keeping those
 * phases together prevents accidental read/write interleaving during future
 * maintenance.
 */
export class FallbackController {
  private readonly mixedLanguage: MixedLanguage;

  constructor(
    private readonly managedStyles: ManagedStyles,
    private readonly fontSupport: FontSupport,
    private readonly getSettings: () => Settings,
    private readonly classifyChinese: (text: string) => "sc" | "tc",
    analyzeLocalEvidence: (text: string) => CjkEvidence
  ) {
    this.mixedLanguage = new MixedLanguage(managedStyles, analyzeLocalEvidence);
  }

  get detectedLocalVariants(): ReadonlySet<Variant> {
    return this.mixedLanguage.detectedVariants;
  }

  restoreMixedLanguage(): void {
    this.mixedLanguage.restoreAll();
  }

  apply({
    pageVariant,
    detection,
    fullScan,
    roots = [],
    elements = []
  }: FallbackRun): ManagedSummary {
    const settings = this.getSettings();
    const hostOverride = settings.siteOverrides?.[location.hostname] || "auto";
    const forceOverride = detection.reason === "Site override";
    const declaredRoot = langToVariant(document.documentElement?.lang || "");
    const mixedEligible = settings.mixedLanguageDetection && hostOverride === "auto" &&
      !declaredRoot && !forceOverride;

    // A SPA can lose its CJK page result without replacing the DOM. Its old
    // mixed-language wrappers must be removed even though style work stops.
    if (!mixedEligible || !pageVariant) this.mixedLanguage.restoreAll();
    if (detection.reason === "Disabled for this site" || !pageVariant) {
      this.managedStyles.restoreAll();
      this.managedStyles.rules.prune();
      return { count: 0, variants: [], fonts: [] };
    }

    // A specific root CJK language is the website's explicit choice. With
    // trust enabled, leave all of its content and font selection to the browser.
    if (!forceOverride && settings.trustCjkLang && isVariant(declaredRoot)) {
      this.managedStyles.restoreAll();
      this.managedStyles.rules.prune();
      return { count: 0, variants: [], fonts: [] };
    }

    const candidates = this.collectCandidates(fullScan, roots, elements);
    this.mixedLanguage.prepare(candidates, fullScan, pageVariant, mixedEligible, [...roots, ...elements]);
    const elementLanguage = new ElementLanguage(pageVariant, settings, this.classifyChinese);
    const affected = this.managedStyles.affected(fullScan, roots, elements);
    const entries = this.resolveEntries(candidates, affected, elementLanguage, pageVariant, forceOverride);

    if (entries.length) this.fontSupport.refreshCustomFonts();

    // Extension styles were removed in resolveEntries. All computed-style
    // reads can now happen together against the website's own font stacks.
    for (const entry of entries) {
      entry.baseFamily = getComputedStyle(entry.element).fontFamily;
    }

    const actions = this.createStyleActions(entries, settings);
    for (const element of affected) this.managedStyles.restore(element);
    for (const action of actions) this.managedStyles.commit(action);
    return this.managedStyles.summary();
  }

  private collectCandidates(
    fullScan: boolean,
    roots: HTMLElement[],
    elements: HTMLElement[]
  ): Set<HTMLElement> {
    const candidates = new Set<HTMLElement>();
    if (fullScan) {
      collectCandidateElements(document.body, candidates);
      return candidates;
    }
    for (const root of roots) collectCandidateElements(root, candidates);
    for (const element of elements) addCandidate(candidates, element);
    return candidates;
  }

  private resolveEntries(
    candidates: ReadonlySet<HTMLElement>,
    affected: Set<HTMLElement>,
    elementLanguage: ElementLanguage,
    pageVariant: Variant,
    forceOverride: boolean
  ): PendingEntry[] {
    const entries: PendingEntry[] = [];
    for (const element of candidates) {
      // A trusted, specific CJK lang already gives the browser enough regional
      // context. A manual site override is the only rule allowed to supersede it.
      if (!forceOverride && elementLanguage.browserHandlesLanguageFor(element)) {
        if (this.managedStyles.has(element)) this.managedStyles.restore(element);
        affected.delete(element);
        continue;
      }

      const variant = forceOverride ? pageVariant : (
        elementLanguage.explicitVariantFor(element) ||
        this.mixedLanguage.variantFor(element) ||
        pageVariant
      );
      const existing = this.managedStyles.get(element);
      this.managedStyles.prepareForRead(element, existing);
      entries.push({ element, existing, variant, baseFamily: "" });
      affected.delete(element);
    }
    return entries;
  }

  private createStyleActions(entries: PendingEntry[], settings: Settings): StyleAction[] {
    const actions: StyleAction[] = [];
    // A run can touch hundreds of elements with the same computed stack. Keep
    // these decisions local to the run so later website CSS or font changes
    // are always read and evaluated again.
    const plans = new Map<string, { fallback: string; skip: boolean }>();
    const composedValues = new Map<string, string>();
    for (const entry of entries) {
      const { element, existing, variant, baseFamily } = entry;
      const planKey = JSON.stringify([baseFamily, variant]);
      let plan = plans.get(planKey);
      if (!plan) {
        const families = parseFamilies(baseFamily);
        const fallback = this.fontForVariant(variant, usesSerifFallback(families), settings);
        const skip = !fallback ||
          families.some((family) => family.toLowerCase() === fallback.toLowerCase()) ||
          this.fontSupport.shouldPreserve(families, settings, variant);
        plan = { fallback, skip };
        plans.set(planKey, plan);
      }
      if (plan.skip) {
        if (existing) this.managedStyles.restore(element);
        continue;
      }

      const inheritedFallbacks = this.managedStyles.inheritedFallbacksFor(element, variant);
      const valueKey = JSON.stringify([planKey, inheritedFallbacks]);
      let appliedValue = composedValues.get(valueKey);
      if (appliedValue === undefined) {
        appliedValue = composeFontFamily(baseFamily, plan.fallback, variant, inheritedFallbacks);
        composedValues.set(valueKey, appliedValue);
      }
      const inlineFallback = isInShadowTree(element) ||
        element.style.getPropertyPriority("font-family") === "important";
      const originalInlineValue = inlineFallback ? element.style.getPropertyValue("font-family") : "";
      const originalInlinePriority = inlineFallback ? element.style.getPropertyPriority("font-family") : "";
      if (existing) this.managedStyles.restore(element);
      actions.push({
        element,
        variant,
        appliedValue,
        inlineFallback,
        originalInlineValue,
        originalInlinePriority,
        fallback: plan.fallback
      });
    }
    return actions;
  }

  private fontForVariant(variant: Variant, serif: boolean, settings: Settings): string {
    if (variant === "jp") {
      return String((serif && settings.fontJPSerif) || settings.fontJP || "").trim();
    }
    if (variant === "tc") {
      return String((serif && settings.fontTCSerif) || settings.fontTC || "").trim();
    }
    return String((serif && settings.fontSCSerif) || settings.fontSC || "").trim();
  }
}

function isVariant(value: unknown): value is Variant {
  return value === "sc" || value === "tc" || value === "jp";
}
