import { FontStackRules } from "./font-stack-rules";
import { composedParentElement } from "../page/candidate-scan";
import type { Variant } from "../shared/types";

export interface AppliedStyleState {
  variant: Variant;
  appliedValue: string;
  inlineFallback: boolean;
  originalInlineValue: string;
  originalInlinePriority: string;
  groupValue: string;
  fallback: string;
}

export interface StyleAction {
  element: HTMLElement;
  variant: Variant;
  appliedValue: string;
  inlineFallback: boolean;
  originalInlineValue: string;
  originalInlinePriority: string;
  fallback: string;
}

export interface ManagedSummary {
  count: number;
  variants: Variant[];
  fonts: string[];
}

/** Tracks every reversible style mutation made by advanced fallback mode. */
export class ManagedStyles {
  readonly rules = new FontStackRules();
  private readonly states = new WeakMap<HTMLElement, AppliedStyleState>();
  private readonly elements = new Set<HTMLElement>();
  private readonly variantCounts = new Map<Variant, number>();
  private readonly fontCounts = new Map<string, number>();
  private readonly selfMutatedElements = new WeakSet<Node>();

  constructor(private readonly releaseShadowRoot: (root: ShadowRoot) => void) {}

  get(element: HTMLElement): AppliedStyleState | undefined {
    return this.states.get(element);
  }

  has(element: HTMLElement): boolean {
    return this.states.has(element);
  }

  inheritedFallbacksFor(element: HTMLElement, variant: Variant): string[] {
    const fallbacks = new Set<string>();
    let current: Element | null = element.parentElement;
    while (current) {
      if (current instanceof HTMLElement) {
        const state = this.states.get(current);
        if (state && state.variant !== variant) fallbacks.add(state.fallback);
      }
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
    }
    return Array.from(fallbacks);
  }

  isSelfMutation(node: Node): boolean {
    return this.selfMutatedElements.has(node);
  }

  /** Remove our prior attachment so computed style reflects the website. */
  prepareForRead(element: HTMLElement, state: AppliedStyleState | undefined): void {
    if (!state) return;
    this.markSelfMutation(element);
    if (state.inlineFallback) this.restoreInlineFamily(element, state);
    else element.removeAttribute(this.rules.stackAttribute);
  }

  affected(fullScan: boolean, roots: HTMLElement[], elements: HTMLElement[]): Set<HTMLElement> {
    if (fullScan) return new Set(this.elements);
    const direct = new Set(elements);
    const rootSet = new Set(roots);
    const affected = new Set<HTMLElement>();
    for (const element of this.elements) {
      if (direct.has(element)) {
        affected.add(element);
        continue;
      }
      let current: Element | null = element;
      while (current) {
        if (rootSet.has(current as HTMLElement)) {
          affected.add(element);
          break;
        }
        current = composedParentElement(current);
      }
    }
    return affected;
  }

  commit(action: StyleAction): void {
    const state: AppliedStyleState = {
      variant: action.variant,
      appliedValue: action.appliedValue,
      inlineFallback: action.inlineFallback,
      originalInlineValue: action.originalInlineValue,
      originalInlinePriority: action.originalInlinePriority,
      groupValue: "",
      fallback: action.fallback
    };
    if (action.inlineFallback) {
      this.markSelfMutation(action.element);
      action.element.style.setProperty("font-family", action.appliedValue, "important");
      action.element.removeAttribute(this.rules.stackAttribute);
    } else {
      const ruleId = this.rules.acquire(action.appliedValue);
      state.groupValue = action.appliedValue;
      this.markSelfMutation(action.element);
      action.element.setAttribute(this.rules.stackAttribute, ruleId);
    }
    action.element.setAttribute(this.rules.managedAttribute, action.variant);
    this.states.set(action.element, state);
    this.elements.add(action.element);
    this.changeVariantCount(null, action.variant);
    this.changeFontCount(null, action.fallback);
  }

  captureInlineMutation(element: HTMLElement): void {
    const state = this.states.get(element);
    if (!state?.inlineFallback) return;
    const value = element.style.getPropertyValue("font-family");
    const priority = element.style.getPropertyPriority("font-family");
    if (value !== state.appliedValue || priority !== "important") {
      state.originalInlineValue = value;
      state.originalInlinePriority = priority;
    }
  }

  restore(element: HTMLElement): void {
    const state = this.states.get(element);
    if (!state) return;
    if (state.groupValue) this.rules.release(state.groupValue);
    this.changeVariantCount(state.variant, null);
    this.changeFontCount(state.fallback, null);
    if (state.inlineFallback) {
      // Do not overwrite a site's inline edit made after our last application.
      const value = element.style.getPropertyValue("font-family");
      const priority = element.style.getPropertyPriority("font-family");
      if (value === state.appliedValue && priority === "important") {
        this.restoreInlineFamily(element, state);
      }
    }
    this.states.delete(element);
    this.markSelfMutation(element);
    element.removeAttribute(this.rules.stackAttribute);
    element.removeAttribute(this.rules.managedAttribute);
    this.elements.delete(element);
  }

  restoreAll(): void {
    for (const element of Array.from(this.elements)) this.restore(element);
  }

  releaseRemovedSubtree(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    let released = false;
    const release = (root: Element | ShadowRoot): void => {
      if (root instanceof HTMLElement && this.states.has(root)) {
        this.restore(root);
        released = true;
      }
      if (root instanceof Element && root.shadowRoot) {
        this.releaseShadowRoot(root.shadowRoot);
        release(root.shadowRoot);
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let element = walker.nextNode(); element; element = walker.nextNode()) {
        if (element instanceof HTMLElement && this.states.has(element)) {
          this.restore(element);
          released = true;
        }
        if (element instanceof Element && element.shadowRoot) {
          this.releaseShadowRoot(element.shadowRoot);
          release(element.shadowRoot);
        }
      }
    };
    release(node);
    return released;
  }

  summary(): ManagedSummary {
    for (const element of Array.from(this.elements)) {
      if (element.isConnected === false) this.restore(element);
    }
    this.rules.prune();
    return {
      count: this.elements.size,
      variants: Array.from(this.variantCounts.keys()),
      fonts: Array.from(this.fontCounts.keys())
    };
  }

  private markSelfMutation(element: Node): void {
    this.selfMutatedElements.add(element);
    setTimeout(() => this.selfMutatedElements.delete(element), 0);
  }

  private restoreInlineFamily(element: HTMLElement, state: AppliedStyleState): void {
    this.markSelfMutation(element);
    if (state.originalInlineValue) {
      element.style.setProperty("font-family", state.originalInlineValue, state.originalInlinePriority || "");
    } else {
      element.style.removeProperty("font-family");
    }
  }

  private changeVariantCount(oldVariant: Variant | null, newVariant: Variant | null): void {
    if (oldVariant) {
      const next = (this.variantCounts.get(oldVariant) || 1) - 1;
      if (next > 0) this.variantCounts.set(oldVariant, next);
      else this.variantCounts.delete(oldVariant);
    }
    if (newVariant) this.variantCounts.set(newVariant, (this.variantCounts.get(newVariant) || 0) + 1);
  }

  private changeFontCount(oldFont: string | null, newFont: string | null): void {
    if (oldFont) {
      const next = (this.fontCounts.get(oldFont) || 1) - 1;
      if (next > 0) this.fontCounts.set(oldFont, next);
      else this.fontCounts.delete(oldFont);
    }
    if (newFont) this.fontCounts.set(newFont, (this.fontCounts.get(newFont) || 0) + 1);
  }
}
