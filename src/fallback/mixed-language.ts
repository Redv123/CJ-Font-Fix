import { addCandidate, CJK_TEXT_RE, closestComposed } from "../page/candidate-scan";
import { langToVariant } from "../language/tags";
import {
  hasStrongChineseJapaneseMix,
  isShortJapaneseScriptSegment,
  variantFromPrecedingEvidence
} from "../language/local-evidence";
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

const ADJACENT_BLOCKS = "p, li, blockquote";

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
    eligible: boolean,
    changedSources: readonly HTMLElement[] = []
  ): void {
    this.resetRunState();
    if (!eligible) {
      this.restoreAll();
      return;
    }

    if (!fullScan) this.includeNeighborDependents(candidates, changedSources);

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

  /** Revisit only the next sibling whose decision may depend on changed text. */
  private includeNeighborDependents(
    candidates: Set<HTMLElement>,
    changedSources: readonly HTMLElement[]
  ): void {
    for (const source of changedSources) {
      if (source.hasAttribute(this.attribute)) addCandidate(candidates, source.parentElement);
      if (!source.matches(ADJACENT_BLOCKS)) continue;
      const next = source.nextElementSibling;
      if (next?.tagName === source.tagName) addCandidate(candidates, next);
    }
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
      const variant = this.segmentVariant(text, this.analyze(text), wrapper);
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
    const isBangumiHeading = location.hostname === "bangumi.tv" && element.matches("h2.subtitle");
    for (const segment of directSegments) {
      const node = segment.node;
      if (!node || !isBangumiHeading ||
          this.segmentVariant(segment.text, segment.evidence, node) !== "jp") {
        wholeSegments.push(segment);
        continue;
      }

      // Bangumi places a Japanese work title between fixed Chinese labels in
      // one text node. This narrow structural rule avoids treating whitespace
      // as a general-purpose language boundary on unrelated sites.
      const ranges = findBangumiTitleRange(node.nodeValue || "");
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
      const variant = segment && this.segmentVariant(
        segment.text, segment.evidence, segment.node || element
      );
      if (variant && variant !== pageVariant) this.recordVariant(element, variant);
      return;
    }

    // Multiple direct text nodes (commonly separated by <br>) can be styled
    // independently without changing the surrounding element or descendants.
    for (const segment of wholeSegments) {
      const variant = this.segmentVariant(segment.text, segment.evidence, segment.node || element);
      const node = segment.node;
      if (!variant || variant === pageVariant || !node?.parentNode || node.parentElement !== element) continue;
      const wrapper = document.createElement("span");
      node.before(wrapper);
      wrapper.append(node);
      this.wrappers.add(wrapper);
      this.recordVariant(wrapper, variant, candidates);
    }
  }

  private segmentVariant(text: string, evidence: CjkEvidence, anchor: Node): Variant | null {
    if (evidence.strongVariant) return evidence.strongVariant;
    // This runs only after the mixed-page gate. Strong local script evidence
    // may override the page variant for a short, independent segment.
    if (isShortJapaneseScriptSegment(text, evidence)) return "jp";
    const previous = this.precedingText(anchor);
    if (!previous) return null;
    const priorEvidence = this.analyze(previous);
    const priorVariant = priorEvidence.strongVariant ||
      (isShortJapaneseScriptSegment(previous, priorEvidence) ? "jp" : null);
    return variantFromPrecedingEvidence(evidence, priorVariant);
  }

  /**
   * Look back once within the same direct-text owner or to an immediately
   * preceding peer paragraph. Other elements, explicit CJK lang, and large
   * line gaps are boundaries. Never use a prior context-derived wrapper as
   * evidence: that would let a mistaken choice propagate down the page.
   */
  private precedingText(anchor: Node): string | null {
    let current = anchor;
    for (let level = 0; level < 2; level++) {
      let sibling = current.previousSibling;
      let breaks = 0;
      let checked = 0;
      while (sibling && checked++ < 8) {
        if (sibling.nodeType === Node.TEXT_NODE) {
          const text = (sibling.nodeValue || "").replace(/\s+/g, " ").trim().slice(0, 500);
          if (!text) {
            sibling = sibling.previousSibling;
            continue;
          }
          return CJK_TEXT_RE.test(text) ? text : null;
        }
        if (sibling instanceof HTMLBRElement) {
          if (++breaks > 2) return null;
          sibling = sibling.previousSibling;
          continue;
        }
        if (!(sibling instanceof HTMLElement) || this.hasExplicitCjkLang(sibling) ||
            sibling.hidden || sibling.getAttribute("aria-hidden") === "true") return null;
        if (sibling.hasAttribute(this.attribute)) {
          // A local wrapper is usable only if its text independently confirms
          // a language; segmentVariant does not read the wrapper's label.
          return (sibling.textContent || "").trim().slice(0, 500) || null;
        }
        if (current instanceof HTMLElement && current.matches(ADJACENT_BLOCKS) &&
            sibling.tagName === current.tagName) return this.lastDirectText(sibling);
        return null;
      }
      if (sibling || !(current instanceof Text) ||
          !current.parentElement?.matches(ADJACENT_BLOCKS)) return null;
      current = current.parentElement;
    }
    return null;
  }

  private lastDirectText(element: HTMLElement): string | null {
    let child = element.lastChild;
    let checked = 0;
    while (child && checked++ < 8) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue || "").replace(/\s+/g, " ").trim().slice(0, 500);
        if (text) return CJK_TEXT_RE.test(text) ? text : null;
      } else if (child instanceof HTMLElement && child.hasAttribute(this.attribute)) {
        return (child.textContent || "").trim().slice(0, 500) || null;
      } else if (!(child instanceof HTMLBRElement)) {
        return null;
      }
      child = child.previousSibling;
    }
    return null;
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
