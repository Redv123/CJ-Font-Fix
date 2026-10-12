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
  private fullScan = true;
  private redetectLanguage = true;

  get hasWork(): boolean {
    return this.fullScan || this.redetectLanguage || this.roots.size > 0 || this.elements.size > 0;
  }

  /** Bound work performed immediately after a user interaction. */
  isSmallLocalUpdate(): boolean {
    if (this.fullScan || this.redetectLanguage || !this.hasWork || this.roots.size + this.elements.size > 128) return false;
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
    for (const root of this.roots) {
      if (!root.isConnected || this.hasQueuedAncestor(root, false)) continue;
      if (!fits(root)) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!fits(node)) return false;
      }
    }
    for (const element of this.elements) {
      if (!element.isConnected || this.hasQueuedAncestor(element, true)) continue;
      if (!fits(element)) return false;
      for (const child of element.childNodes) if (!fits(child)) return false;
    }
    return containsCjk;
  }

  requestFullScan(redetectLanguage = false): void {
    this.fullScan = true;
    if (redetectLanguage) this.redetectLanguage = true;
    this.roots.clear();
    this.elements.clear();
  }

  requestLanguageDetection(): void {
    this.redetectLanguage = true;
  }

  queueElement(node: Node | null): void {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof HTMLElement) || !isInsideBody(element) || this.fullScan) return;
    this.elements.add(element);
  }

  queueRoot(node: Node | null): void {
    const root = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(root instanceof HTMLElement) || !isInsideBody(root) || this.fullScan) return;
    this.roots.add(root);
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
    return update;
  }

  private hasQueuedAncestor(element: HTMLElement, includeSelf: boolean): boolean {
    let current: Element | null = includeSelf ? element : composedParentElement(element);
    while (current) {
      if (this.roots.has(current as HTMLElement)) return true;
      current = composedParentElement(current);
    }
    return false;
  }
}
