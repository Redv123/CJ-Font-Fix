import { CJK_TEXT_RE, closestComposed, composedParentElement, EXCLUDED, isInsideBody } from "./candidate-scan";

export interface PendingPageUpdate {
  fullScan: boolean;
  redetectLanguage: boolean;
  roots: HTMLElement[];
  elements: HTMLElement[];
}

/**
 * Coalesces DOM work before the content application runs.
 *
 * Insertion is constant-time even for a large MutationObserver burst. At
 * consume time, ancestor checks discard roots and elements already covered by
 * a queued subtree. A full scan still subsumes all local work.
 */
export class UpdateQueue {
  private readonly roots = new Set<HTMLElement>();
  private readonly elements = new Set<HTMLElement>();
  private readonly newTextElements = new Set<HTMLElement>();
  private fullScan = true;
  private redetectLanguage = true;

  get hasWork(): boolean {
    return this.fullScan || this.redetectLanguage || this.roots.size > 0 || this.elements.size > 0;
  }

  /** Bound work performed immediately after a user interaction. */
  isSmallLocalUpdate(): boolean {
    if (this.fullScan || this.redetectLanguage || !this.hasWork) return false;
    return this.isSmallUpdate(this.roots, this.elements);
  }

  /** Unrelated animation or feed updates must not delay small clicked content. */
  takeSmallInteractionUpdate(target: Element): PendingPageUpdate | null {
    if (this.fullScan || this.redetectLanguage || !this.elements.size || target.getRootNode() instanceof ShadowRoot) return null;
    let previousCount = 0;
    for (let scope: Element | null = target; scope && scope !== document.body && scope !== document.documentElement;
      scope = composedParentElement(scope)) {
      const roots = new Set(Array.from(this.elements).filter((element) => element.isConnected && scope.contains(element)));
      if (roots.size === previousCount) continue;
      previousCount = roots.size;
      if (roots.size > 128) return null;
      if (!this.isSmallUpdate(roots, new Set())) continue;
      const selected = Array.from(roots).filter((root) => !this.hasQueuedAncestor(root, false, roots));
      for (const root of roots) this.elements.delete(root);
      return { fullScan: false, redetectLanguage: false, roots: selected, elements: [] };
    }
    return null;
  }

  private isSmallUpdate(roots: ReadonlySet<HTMLElement>, elements: ReadonlySet<HTMLElement>): boolean {
    if (roots.size + elements.size > 128) return false;
    let nodes = 0;
    let characters = 0;
    let containsCjk = false;
    const fits = (node: Node): boolean => {
      if (++nodes > 128 || (node instanceof Element && node.shadowRoot)) return false;
      const text = node.nodeType === Node.TEXT_NODE ? node.nodeValue || "" :
        node instanceof HTMLElement && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")
          ? (node as HTMLInputElement).value || (node as HTMLInputElement).placeholder || "" : "";
      characters += text.length;
      if (characters > 10000) return false;
      if (!containsCjk && CJK_TEXT_RE.test(text)) {
        const owner = node instanceof Element ? node : node.parentElement;
        containsCjk = !closestComposed(owner, EXCLUDED);
      }
      return true;
    };
    for (const root of roots) {
      if (!root.isConnected || this.hasQueuedAncestor(root, false, roots)) continue;
      if (!fits(root)) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!fits(node)) return false;
      }
    }
    for (const element of elements) {
      if (!element.isConnected || this.hasQueuedAncestor(element, true, roots)) continue;
      if (!fits(element)) return false;
      for (const child of element.childNodes) if (!fits(child)) return false;
    }
    return containsCjk;
  }

  /** Fresh text can arrive after a click handler, surrounded by a large UI. */
  takeSmallNewTextUpdate(isManaged: (element: HTMLElement) => boolean): PendingPageUpdate | null {
    if (!this.newTextElements.size) return null;
    if (this.newTextElements.size > 128) {
      this.newTextElements.clear();
      return null;
    }
    const elements = new Set(Array.from(this.newTextElements).filter((element) =>
      element.isConnected && !isManaged(element) && !(element.getRootNode() instanceof ShadowRoot)
    ));
    this.newTextElements.clear();
    if (this.fullScan || this.redetectLanguage || !this.isSmallUpdate(new Set(), elements)) return null;
    for (const element of elements) this.elements.delete(element);
    return { fullScan: false, redetectLanguage: false, roots: [], elements: Array.from(elements) };
  }

  private rememberNewText(element: HTMLElement): void {
    if (!element.firstChild) return;
    // Added content may already contain wrappers, links, or emoji. Remember
    // its direct CJK text owners without waiting for separate text mutations.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ALL);
    let nodes = 0;
    let characters = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++nodes > 128) break;
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.nodeValue || "";
      characters += text.length;
      if (characters > 10000) break;
      if (node.parentElement instanceof HTMLElement && CJK_TEXT_RE.test(text)) {
        this.newTextElements.add(node.parentElement);
      }
    }
  }

  requestFullScan(redetectLanguage = false): void {
    this.fullScan = true;
    if (redetectLanguage) this.redetectLanguage = true;
    this.roots.clear();
    this.elements.clear();
    this.newTextElements.clear();
  }

  requestLanguageDetection(): void {
    this.redetectLanguage = true;
  }

  queueElement(node: Node | null, newText = false): void {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof HTMLElement) || !isInsideBody(element) || this.fullScan) return;
    this.elements.add(element);
    if (newText) this.rememberNewText(element);
  }

  queueRoot(node: Node | null, added = false): void {
    const root = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(root instanceof HTMLElement) || !isInsideBody(root) || this.fullScan) return;
    this.roots.add(root);
    if (added) this.rememberNewText(root);
  }

  consume(): PendingPageUpdate {
    const roots = this.fullScan ? [] : Array.from(this.roots).filter((root) =>
      root.isConnected && !this.hasQueuedAncestor(root, false)
    );
    const elements = this.fullScan ? [] : Array.from(this.elements).filter((element) =>
      element.isConnected && !this.hasQueuedAncestor(element, true)
    );
    const update = {
      fullScan: this.fullScan,
      redetectLanguage: this.redetectLanguage,
      roots,
      elements
    };
    this.fullScan = false;
    this.redetectLanguage = false;
    this.roots.clear();
    this.elements.clear();
    this.newTextElements.clear();
    return update;
  }

  private hasQueuedAncestor(element: HTMLElement, includeSelf: boolean, roots: ReadonlySet<HTMLElement> = this.roots): boolean {
    let current: Element | null = includeSelf ? element : composedParentElement(element);
    while (current) {
      if (roots.has(current as HTMLElement)) return true;
      current = composedParentElement(current);
    }
    return false;
  }
}
