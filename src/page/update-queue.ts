import { composedParentElement, isInsideBody } from "./candidate-scan";

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
