import type { SimpleMode } from "../fallback/simple-mode";
import type { ManagedStyles } from "../fallback/managed-styles";
import type { FontSupport } from "../fonts/font-support";
import { langToVariant } from "../language/tags";
import type { Settings, Variant } from "../shared/types";
import {
  CJK_TEXT_RE,
  closestComposed,
  composedParentElement,
  EXCLUDED,
  isInsideBody,
  subtreeContainsCjk
} from "./candidate-scan";
import type { ExtendedDetection, PageLanguageDetector } from "./page-language";
import type { UpdateQueue } from "./update-queue";

interface PageObserverDependencies {
  settings: () => Settings;
  detection: () => ExtendedDetection;
  updates: UpdateQueue;
  languageDetector: PageLanguageDetector;
  fontSupport: FontSupport;
  managedStyles: ManagedStyles;
  simpleMode: SimpleMode;
  openShadowRoots: Set<ShadowRoot>;
  requestRun: () => void;
}

/**
 * Converts browser DOM mutations into coalesced page-update requests.
 *
 * This module never detects a language and never applies a fallback. It only
 * decides whether a mutation invalidates page detection, a whole subtree, or
 * one direct text owner. Keeping that policy here prevents the application
 * lifecycle from depending on MutationObserver details.
 */
export class PageObserver {
  private observer: MutationObserver | null = null;
  private observedShadowRoots = new WeakSet<ShadowRoot>();
  private observedUrl = "";

  constructor(private readonly dependencies: PageObserverDependencies) {}

  configure(): void {
    const { settings, simpleMode, openShadowRoots } = this.dependencies;
    this.observer?.disconnect();
    this.observer = null;
    simpleMode.stopBootstrap();
    this.observedShadowRoots = new WeakSet();
    openShadowRoots.clear();
    document.removeEventListener("input", this.handleInput, true);

    const current = settings();
    const hostOverride = current.siteOverrides?.[location.hostname] || "auto";
    if (hostOverride === "off") return;
    if (current.simpleMode) {
      simpleMode.startBootstrap(true);
      return;
    }

    const dynamic = Boolean(current.dynamicDetection);
    this.observedUrl = location.href;
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations, dynamic));
    this.observer.observe(document.documentElement || document, this.options(dynamic));
    this.observeOpenShadowRoots(document, dynamic);
    if (dynamic) document.addEventListener("input", this.handleInput, true);
  }

  private handleMutations(mutations: MutationRecord[], dynamic: boolean): void {
    const routeChanged = dynamic && this.consumeUrlChange();
    const sampleWasReplaced = dynamic && this.sampleWasSubstantiallyRewritten(mutations);
    const redetectPage = routeChanged || sampleWasReplaced;
    if (this.isDormant()) {
      this.handleDormantMutations(mutations, dynamic, redetectPage);
      return;
    }

    const { managedStyles, updates } = this.dependencies;
    const rules = managedStyles.rules;
    let meaningful = redetectPage;
    if (redetectPage) updates.requestFullScan(true);
    let cleanedManagedContent = false;
    const addedElements = new Set<Element>();
    for (const mutation of mutations) {
      if (rules.isStyleNode(mutation.target)) continue;

      if (mutation.type === "childList") {
        if (Array.from(mutation.removedNodes).some((node) => rules.containsStyleNode(node))) {
          rules.recreateAfterRemoval();
        }
        for (const node of mutation.removedNodes) {
          cleanedManagedContent = managedStyles.releaseRemovedSubtree(node) || cleanedManagedContent;
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) addedElements.add(node);
        }
        if (!dynamic) continue;
      }

      if (!dynamic) continue;
      if (mutation.type === "attributes") {
        meaningful = this.handleAttributeMutation(mutation) || meaningful;
        continue;
      }
      meaningful = this.handleContentMutation(mutation) || meaningful;
    }

    this.observeAddedShadowRoots(addedElements, dynamic);
    if (cleanedManagedContent) this.updateManagedSummary();
    if (meaningful) this.dependencies.requestRun();
  }

  private handleAttributeMutation(mutation: MutationRecord): boolean {
    const { managedStyles, fontSupport, updates } = this.dependencies;
    if (mutation.attributeName === "style" && managedStyles.isSelfMutation(mutation.target)) return false;
    const managedTarget = mutation.target instanceof HTMLElement ? mutation.target : null;
    if (mutation.attributeName === "style" && managedTarget) {
      managedStyles.captureInlineMutation(managedTarget);
    }
    if (this.containsGlobalStyleNode(mutation.target)) {
      fontSupport.markMetadataDirty();
      updates.requestFullScan();
      return true;
    }
    if (["rel", "href", "media", "disabled"].includes(mutation.attributeName || "")) return false;
    if (mutation.target === document.documentElement) {
      updates.requestFullScan(mutation.attributeName === "lang");
      return true;
    }
    if (mutation.target === document.body) {
      updates.requestFullScan();
      return true;
    }
    if (isInsideBody(mutation.target)) {
      updates.queueRoot(mutation.target);
      return true;
    }
    return false;
  }

  private handleContentMutation(mutation: MutationRecord): boolean {
    const { fontSupport, languageDetector, updates } = this.dependencies;
    const target: Element | null = mutation.target.nodeType === Node.TEXT_NODE
      ? mutation.target.parentElement
      : mutation.target instanceof Element ? mutation.target : null;
    if (closestComposed(target, "style")) {
      fontSupport.markMetadataDirty();
      updates.requestFullScan();
      return true;
    }
    if (closestComposed(target, EXCLUDED)) return false;

    if (mutation.type === "characterData") {
      if (target?.tagName === "TITLE") {
        if (!this.pageLanguageIsStable()) updates.requestLanguageDetection();
      } else {
        updates.queueElement(target);
        if (!this.pageLanguageIsStable() && languageDetector.touchesSample(target)) {
          updates.requestLanguageDetection();
        }
      }
      return true;
    }

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (changedNodes.some((node) => this.containsGlobalStyleNode(node))) {
      fontSupport.markMetadataDirty();
      updates.requestFullScan();
    }
    if (target?.tagName === "TITLE") {
      if (!this.pageLanguageIsStable()) updates.requestLanguageDetection();
      return true;
    }
    if (!isInsideBody(target)) return false;

    updates.queueElement(target);
    // A removed paragraph can invalidate the mixed-language choice of its
    // immediate successor even though that successor's own text did not move.
    if (this.dependencies.settings().mixedLanguageDetection && mutation.removedNodes.length) {
      const removedPeer = Array.from(mutation.removedNodes).find((node): node is HTMLElement =>
        node instanceof HTMLElement && node.matches("p, li, blockquote")
      );
      let next = mutation.nextSibling;
      for (let i = 0; i < 4 && next?.nodeType === Node.TEXT_NODE &&
          !(next.nodeValue || "").trim(); i++) next = next.nextSibling;
      if (removedPeer && next instanceof HTMLElement && next.tagName === removedPeer.tagName) {
        updates.queueElement(next);
      }
    }
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) updates.queueRoot(node);
      else if (node.nodeType === Node.TEXT_NODE) updates.queueElement(target);
    }
    if (!this.pageLanguageIsStable() && (
      languageDetector.touchesSample(target) ||
      changedNodes.some((node) => languageDetector.touchesSample(node, true))
    )) {
      updates.requestLanguageDetection();
    }
    return true;
  }

  /**
   * A no-CJK page stays on a cheaper observer path until relevant sample text
   * appears. Ordinary English SPA churn must not schedule empty full scans.
   */
  private handleDormantMutations(
    mutations: MutationRecord[],
    dynamic: boolean,
    redetectPage: boolean
  ): void {
    const { managedStyles, languageDetector, updates } = this.dependencies;
    let wake = redetectPage;
    const addedElements = new Set<Element>();
    for (const mutation of mutations) {
      if (managedStyles.rules.isStyleNode(mutation.target)) continue;
      if (mutation.type === "childList") {
        languageDetector.sampleRootWasRemoved(mutation);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) addedElements.add(node);
        }
      }
      if (!dynamic) continue;
      if (mutation.type === "attributes") {
        if (mutation.target === document.documentElement && mutation.attributeName === "lang") wake = true;
        continue;
      }

      const target: Element | null = mutation.target.nodeType === Node.TEXT_NODE
        ? mutation.target.parentElement
        : mutation.target instanceof Element ? mutation.target : null;
      if (closestComposed(target, EXCLUDED)) continue;
      if (target?.tagName === "TITLE") {
        if (subtreeContainsCjk(target)) wake = true;
        continue;
      }
      if (!languageDetector.touchesSample(target) &&
          !Array.from(mutation.addedNodes).some((node) => languageDetector.touchesSample(node, true))) continue;
      if (mutation.type === "characterData") {
        if (CJK_TEXT_RE.test(mutation.target.nodeValue || "")) wake = true;
      } else if (mutation.type === "childList" &&
          Array.from(mutation.addedNodes).some(subtreeContainsCjk)) {
        wake = true;
      }
    }
    this.observeAddedShadowRoots(addedElements, dynamic);
    if (!wake) return;
    updates.requestFullScan(true);
    this.dependencies.requestRun();
  }

  private readonly handleInput = (event: Event): void => {
    const target = event.composedPath()[0] || event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (this.isDormant()) return;
    this.dependencies.updates.queueElement(target);
    this.dependencies.requestRun();
  };

  private pageLanguageIsStable(): boolean {
    const settings = this.dependencies.settings();
    const hostOverride = settings.siteOverrides?.[location.hostname] || "auto";
    if (hostOverride === "off" || isVariant(hostOverride)) return true;
    const declared = langToVariant(document.documentElement?.lang || "");
    if (settings.trustCjkLang && isVariant(declared)) return true;
    // Content added at the same URL still needs font correction, but it must
    // not let one expanded comment or feed item replace the page-wide choice.
    // Route changes and explicit lifecycle requests can still re-detect.
    return this.dependencies.detection().variant !== null;
  }

  /** Detect History API navigation without patching page-owned functions. */
  private consumeUrlChange(): boolean {
    const currentUrl = location.href;
    if (currentUrl === this.observedUrl) return false;
    this.observedUrl = currentUrl;
    return true;
  }

  /**
   * Recognize replacement of the sampled page itself without treating one
   * appended comment as a new page. Two existing CJK text nodes becoming
   * non-CJK is a conservative signal for same-URL view replacement; removing
   * the selected sample root is definitive.
   */
  private sampleWasSubstantiallyRewritten(mutations: MutationRecord[]): boolean {
    const { languageDetector } = this.dependencies;
    let replacedCjkNodes = 0;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && languageDetector.sampleRootWasRemoved(mutation)) {
        return true;
      }
      if (mutation.type !== "characterData" ||
          !languageDetector.touchesSample(mutation.target)) continue;
      if (!CJK_TEXT_RE.test(mutation.oldValue || "") ||
          CJK_TEXT_RE.test(mutation.target.nodeValue || "")) continue;
      replacedCjkNodes += 1;
      if (replacedCjkNodes >= 2) return true;
    }
    return false;
  }

  private isDormant(): boolean {
    const detection = this.dependencies.detection();
    return !detection.variant && detection.reason === "No CJK text";
  }

  private updateManagedSummary(): void {
    const summary = this.dependencies.managedStyles.summary();
    const detection = this.dependencies.detection();
    detection.changedElements = summary.count;
    detection.appliedVariants = summary.variants;
    detection.appliedFonts = summary.fonts;
  }

  private containsGlobalStyleNode(node: Node | null): boolean {
    if (!(node instanceof Element)) return false;
    const rules = this.dependencies.managedStyles.rules;
    if (rules.isStyleNode(node)) return false;
    if (node.matches("style, link[rel~='stylesheet']")) return true;
    return Boolean(node.querySelector?.(`style:not(#${rules.styleId}), link[rel~='stylesheet']`));
  }

  private options(dynamic: boolean): MutationObserverInit {
    if (!dynamic) return { childList: true, subtree: true };
    return {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: ["lang", "class", "style", "placeholder", "value", "rel", "href", "media", "disabled"]
    };
  }

  /** One added ancestor already contains every light and open-shadow descendant. */
  private observeAddedShadowRoots(elements: ReadonlySet<Element>, dynamic: boolean): void {
    for (const element of elements) {
      if (!element.isConnected) continue;
      let ancestor = composedParentElement(element);
      while (ancestor && !elements.has(ancestor)) ancestor = composedParentElement(ancestor);
      if (!ancestor) this.observeOpenShadowRoots(element, dynamic);
    }
  }

  /** Observe every discoverable open root; closed roots are inaccessible by design. */
  private observeOpenShadowRoots(root: Document | Element, dynamic: boolean): void {
    if (!this.observer) return;
    const visit = (element: Element): void => {
      if (!element.shadowRoot) return;
      const shadowRoot = element.shadowRoot;
      if (!this.observedShadowRoots.has(shadowRoot)) {
        this.observer?.observe(shadowRoot, this.options(dynamic));
        this.observedShadowRoots.add(shadowRoot);
        this.dependencies.openShadowRoots.add(shadowRoot);
      }
      for (const nested of shadowRoot.querySelectorAll("*")) visit(nested);
    };
    if (root instanceof Element) visit(root);
    for (const element of root.querySelectorAll("*")) visit(element);
  }
}

function isVariant(value: unknown): value is Variant {
  return value === "sc" || value === "tc" || value === "jp";
}
