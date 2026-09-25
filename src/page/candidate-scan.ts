/** Elements whose text is not page prose and must never become font candidates. */
export const EXCLUDED = "script, style, noscript, template, svg, canvas, code, pre, kbd, samp";
export const CJK_TEXT_RE = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d\u{20000}-\u{2fa1f}]/u;

export function isInsideBody(node: Node | null | undefined): boolean {
  if (!document.body || !node) return false;
  let current: Node | null = node instanceof ShadowRoot ? node.host : node;
  while (current) {
    const root = current.getRootNode();
    if (root === document) {
      return current === document.body || (current instanceof Node && document.body.contains(current));
    }
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

/** Parent traversal that also crosses an open shadow root to its host. */
export function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root.host : null;
}

export function closestComposed(element: Element | null, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

export function isInShadowTree(element: Element): boolean {
  return element.getRootNode() instanceof ShadowRoot;
}

/** Avoid treating a large ancestor as a candidate for its descendants' text. */
export function hasDirectCjkText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && CJK_TEXT_RE.test(node.nodeValue || "")) return true;
  }
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    CJK_TEXT_RE.test(element.value || element.placeholder || "");
}

export function addCandidate(candidates: Set<HTMLElement>, element: Element | null): void {
  if (!(element instanceof HTMLElement) || !isInsideBody(element) || element.matches(EXCLUDED) || closestComposed(element, EXCLUDED)) return;
  if (hasDirectCjkText(element)) candidates.add(element);
}

/**
 * Collect direct text owners in light DOM and discoverable open shadow roots.
 * The caller owns the Set so incremental subtree scans can merge candidates.
 */
export function collectCandidateElements(
  root: Node | null = document.body,
  candidates = new Set<HTMLElement>()
): Set<HTMLElement> {
  if (!root) return candidates;
  if (root.nodeType === Node.TEXT_NODE) {
    addCandidate(candidates, root.parentElement);
    return candidates;
  }
  const isFragment = root instanceof ShadowRoot;
  if (!isFragment && (!(root instanceof Element) || !isInsideBody(root))) return candidates;
  if (isFragment && !isInsideBody(root.host)) return candidates;

  if (root instanceof Element) addCandidate(candidates, root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element) {
        return node.matches(EXCLUDED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
      return CJK_TEXT_RE.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      addCandidate(candidates, node.parentElement);
      continue;
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) addCandidate(candidates, node);
    if (node instanceof Element && node.shadowRoot) collectCandidateElements(node.shadowRoot, candidates);
  }
  return candidates;
}

/**
 * Checks a subtree without collecting candidates. The lightweight startup and
 * dormant observers use this to decide whether a full scan is worth scheduling.
 */
export function subtreeContainsCjk(node: Node | null): boolean {
  if (!node) return false;
  if (node.nodeType === Node.TEXT_NODE) {
    return !closestComposed(node.parentElement, EXCLUDED) && CJK_TEXT_RE.test(node.nodeValue || "");
  }
  const isFragment = node instanceof ShadowRoot;
  if (!isFragment && !(node instanceof Element)) return false;
  if (node instanceof Element && (node.matches(EXCLUDED) || closestComposed(node, EXCLUDED))) return false;

  const shadowRoots: ShadowRoot[] = [];
  if (node instanceof Element && node.shadowRoot) shadowRoots.push(node.shadowRoot);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(current) {
      if (current instanceof Element) {
        return current.matches(EXCLUDED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
      return CJK_TEXT_RE.test(current.nodeValue || "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    }
  });
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.nodeType === Node.TEXT_NODE) return true;
    if (current instanceof Element && current.shadowRoot) shadowRoots.push(current.shadowRoot);
  }
  return shadowRoots.some(subtreeContainsCjk);
}
