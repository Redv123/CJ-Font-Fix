import { addCandidate, CJK_TEXT_RE, closestComposed } from "../page/candidate-scan";
import { langToVariant } from "../language/tags";
import { hasStrongChineseJapaneseMix, isKanaOrJapaneseHanOnly } from "../language/local-evidence";
import type { CjkEvidence } from "../language/local-evidence";
import type { ManagedStyles } from "./managed-styles";
import { findBangumiTitleRange } from "./site-rules/bangumi";
import type { Variant } from "../shared/types";

interface DirectSegment {
  element: HTMLElement;
  node: Text | null;
  text: string;
  evidence: CjkEvidence;
}

/**
 * Owns the reversible DOM changes used by experimental mixed-language mode.
 *
 * Page detection remains authoritative. Local evidence may select a different
 * fallback for one direct text node, but it never changes the page result or
 * writes a `lang` attribute. Wrappers are tracked so disabling the experiment
 * can restore the original text without leaving extension markup behind.
 */
export class MixedLanguage {
  private readonly attribute = "data-cjk-fallback-local";
  private readonly wrappers = new Set<HTMLSpanElement>();
  private pageActive = false;
  private localVariants = new WeakMap<HTMLElement, Variant>();
  private variants = new Set<Variant>();

  constructor(
    private readonly managedStyles: ManagedStyles,
    private readonly analyze: (text: string) => CjkEvidence
  ) {}

  get detectedVariants(): ReadonlySet<Variant> {
    return this.variants;
  }

  variantFor(element: HTMLElement): Variant | null {
    const cached = this.localVariants.get(element);
    if (cached) return cached;
    const value = element.getAttribute(this.attribute);
    return value === "sc" || value === "tc" || value === "jp" ? value : null;
  }

  restoreAll(): void {
    for (const wrapper of Array.from(this.wrappers)) this.restoreWrapper(wrapper);
    this.pageActive = false;
    this.resetRunState();
  }

  prepare(
    candidates: Set<HTMLElement>,
    fullScan: boolean,
    pageVariant: Variant,
    eligible: boolean
  ): void {
    this.resetRunState();
    if (!eligible) {
      this.restoreAll();
      return;
    }

    // Candidate collection already visits the DOM. Reuse those direct text
    // nodes and cap the sample so the experiment does not add a body-wide pass.
    const segments = this.collectDirectSegments(candidates);
    if (fullScan) this.pageActive = hasStrongChineseJapaneseMix(segments, pageVariant);
    if (!this.pageActive) {
      this.restoreAll();
      return;
    }

    this.reconcileExistingWrappers(candidates, pageVariant);

    const byElement = new Map<HTMLElement, DirectSegment[]>();
    for (const segment of segments) {
      if (segment.element.hasAttribute(this.attribute)) continue;
      const current = byElement.get(segment.element) || [];
      current.push(segment);
      byElement.set(segment.element, current);
    }

    for (const [element, directSegments] of byElement) {
      if (!element.isConnected) continue;
      this.applySegments(element, directSegments, candidates, pageVariant);
    }
  }

  private resetRunState(): void {
    this.localVariants = new WeakMap();
    this.variants = new Set();
  }

  private hasExplicitCjkLang(element: Element): boolean {
    const owner = closestComposed(element, "[lang]");
    return Boolean(owner && langToVariant(owner.getAttribute("lang") || ""));
  }

  private collectDirectSegments(
    candidates: ReadonlySet<HTMLElement>,
    limit = 10000
  ): DirectSegment[] {
    const segments: DirectSegment[] = [];
    let collected = 0;
    for (const element of candidates) {
      if (collected >= limit || element.isContentEditable || this.hasExplicitCjkLang(element)) continue;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const text = (element.value || element.placeholder || "").trim().slice(0, 500);
        if (!text || !CJK_TEXT_RE.test(text)) continue;
        const evidence = this.analyze(text);
        segments.push({ element, node: null, text, evidence });
        collected += evidence.cjkCount;
        continue;
      }
      for (const child of element.childNodes) {
        if (collected >= limit) break;
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const node = child as Text;
        const text = (node.nodeValue || "").replace(/\s+/g, " ").trim().slice(0, 500);
        if (!text || !CJK_TEXT_RE.test(text)) continue;
        const evidence = this.analyze(text);
        segments.push({ element, node, text, evidence });
        collected += evidence.cjkCount;
      }
    }
    return segments;
  }

  private reconcileExistingWrappers(candidates: Set<HTMLElement>, pageVariant: Variant): void {
    for (const wrapper of Array.from(this.wrappers)) {
      if (!wrapper.isConnected) {
        this.wrappers.delete(wrapper);
        continue;
      }
      const text = wrapper.textContent || "";
      const variant = this.segmentVariant(text, this.analyze(text));
      if (!variant || variant === pageVariant) {
        candidates.delete(wrapper);
        this.restoreWrapper(wrapper, candidates);
      } else {
        this.recordVariant(wrapper, variant, candidates);
      }
    }
  }

  private applySegments(
    element: HTMLElement,
    directSegments: DirectSegment[],
    candidates: Set<HTMLElement>,
    pageVariant: Variant
  ): void {
    const wholeSegments: DirectSegment[] = [];
    for (const segment of directSegments) {
      const node = segment.node;
      if (!node || this.segmentVariant(segment.text, segment.evidence) !== "jp") {
        wholeSegments.push(segment);
        continue;
      }

      // Bangumi places a Japanese work title between fixed Chinese labels in
      // one text node. This narrow structural rule avoids treating whitespace
      // as a general-purpose language boundary on unrelated sites.
      const isBangumiHeading = location.hostname === "bangumi.tv" && element.matches("h2.subtitle");
      const ranges = isBangumiHeading ? findBangumiTitleRange(node.nodeValue || "") : [];
      if (!ranges.length) {
        wholeSegments.push(segment);
        continue;
      }
      for (const range of ranges.reverse()) {
        const selected = node.splitText(range.start);
        selected.splitText(range.end - range.start);
        const wrapper = document.createElement("span");
        selected.before(wrapper);
        wrapper.append(selected);
        this.wrappers.add(wrapper);
        this.recordVariant(wrapper, "jp", candidates);
      }
    }

    if (wholeSegments.length === 1 && directSegments.length === 1) {
      const segment = wholeSegments[0];
      const variant = segment && this.segmentVariant(segment.text, segment.evidence);
      if (variant && variant !== pageVariant) this.recordVariant(element, variant);
      return;
    }

    // Multiple direct text nodes (commonly separated by <br>) can be styled
    // independently without changing the surrounding element or descendants.
    for (const segment of wholeSegments) {
      const variant = this.segmentVariant(segment.text, segment.evidence);
      const node = segment.node;
      if (!variant || variant === pageVariant || !node?.parentNode || node.parentElement !== element) continue;
      const wrapper = document.createElement("span");
      node.before(wrapper);
      wrapper.append(node);
      this.wrappers.add(wrapper);
      this.recordVariant(wrapper, variant, candidates);
    }
  }

  private segmentVariant(text: string, evidence: CjkEvidence): Variant | null {
    if (evidence.strongVariant) return evidence.strongVariant;
    // This runs only after the mixed-page gate. A short segment consisting of
    // kana and known Japanese-form Han may then override the page variant.
    return isKanaOrJapaneseHanOnly(text, evidence) ? "jp" : null;
  }

  private recordVariant(
    element: HTMLElement,
    variant: Variant,
    candidates?: Set<HTMLElement>
  ): void {
    if (this.wrappers.has(element as HTMLSpanElement)) {
      element.setAttribute(this.attribute, variant);
    }
    this.localVariants.set(element, variant);
    this.variants.add(variant);
    candidates?.add(element);
  }

  private restoreWrapper(wrapper: HTMLSpanElement, candidates?: Set<HTMLElement>): void {
    const parent = wrapper.parentElement;
    this.managedStyles.restore(wrapper);
    while (wrapper.firstChild) wrapper.before(wrapper.firstChild);
    wrapper.remove();
    parent?.normalize();
    this.wrappers.delete(wrapper);
    if (candidates && parent) addCandidate(candidates, parent);
  }
}
