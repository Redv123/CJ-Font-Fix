import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateQueue } from "../src/page/update-queue";

class TestNode {
  static readonly TEXT_NODE = 3;
  readonly nodeType = 1;
  parentElement: TestElement | null = null;
  readonly childNodes: TestNode[] = [];
  isConnected = true;
  root: object | null = null;

  get firstChild(): TestNode | null {
    return this.childNodes[0] || null;
  }

  getRootNode(): object {
    return this.root || document;
  }
}

class TestElement extends TestNode {
  closest(): null { return null; }

  contains(node: TestNode): boolean {
    let current: TestNode | null = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }
}
class TestHTMLElement extends TestElement {}
class TestShadowRoot {
  constructor(readonly host: TestHTMLElement) {}
}

function browserTree(): TestHTMLElement {
  const body = new TestHTMLElement();
  const documentStub = {
    body,
    contains(element: TestElement): boolean {
      let current: TestElement | null = element;
      while (current) {
        if (current === body) return true;
        current = current.parentElement;
      }
      return false;
    }
  };
  Object.assign(body, { root: documentStub });
  Object.assign(body, { contains: documentStub.contains });
  vi.stubGlobal("Node", TestNode);
  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("HTMLElement", TestHTMLElement);
  vi.stubGlobal("ShadowRoot", TestShadowRoot);
  vi.stubGlobal("document", documentStub);
  return body;
}

function childOf(parent: TestHTMLElement): TestHTMLElement {
  const child = new TestHTMLElement();
  child.parentElement = parent;
  parent.childNodes.push(child);
  child.root = parent.root;
  return child;
}

function queueRoot(queue: UpdateQueue, element: TestHTMLElement): void {
  queue.queueRoot(element as unknown as Node);
}

function queueElement(queue: UpdateQueue, element: TestHTMLElement): void {
  queue.queueElement(element as unknown as Node);
}

afterEach(() => vi.unstubAllGlobals());

function installWalker(): void {
  vi.stubGlobal("NodeFilter", { SHOW_ALL: -1 });
  Object.assign(document, {
    createTreeWalker(root: TestNode) {
      const pending = [...root.childNodes].reverse();
      return { nextNode: () => {
        const node = pending.pop();
        if (node) pending.push(...[...node.childNodes].reverse());
        return node || null;
      } };
    }
  });
}

describe("small updates after interaction", () => {
  it("takes text owners inside added wrappers with inline content and retains the root scan", () => {
    const body = browserTree();
    installWalker();
    const container = childOf(body);
    const paragraph = childOf(container);
    paragraph.childNodes.push(Object.assign(new TestNode(), {
      nodeType: 3, nodeValue: "新しい返信です", parentElement: paragraph
    }));
    childOf(paragraph);
    const queue = new UpdateQueue();
    queue.consume();
    queue.queueRoot(container as unknown as Node, true);
    expect(queue.takeSmallNewTextUpdate(() => false)).toEqual({
      fullScan: false, redetectLanguage: false, roots: [], elements: [paragraph]
    });
    expect(queue.consume().roots).toEqual([container]);
  });

  it("bounds discovery within an added subtree and keeps unvisited text on the normal queue", () => {
    const body = browserTree();
    installWalker();
    const container = childOf(body);
    for (let i = 0; i < 129; i++) childOf(container);
    const paragraph = childOf(container);
    paragraph.childNodes.push(Object.assign(new TestNode(), {
      nodeType: 3, nodeValue: "後から処理する返信", parentElement: paragraph
    }));
    const queue = new UpdateQueue();
    queue.consume();
    queue.queueRoot(container as unknown as Node, true);
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    expect(queue.consume().roots).toEqual([container]);
  });

  it("takes fresh direct text without consuming large surrounding updates", () => {
    const body = browserTree();
    installWalker();
    const container = childOf(body);
    const paragraph = childOf(container);
    paragraph.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "新しい返信です", parentElement: paragraph }));
    const queue = new UpdateQueue();
    queue.consume();
    queueRoot(queue, container);
    for (let i = 0; i < 180; i++) queueRoot(queue, childOf(container));
    queue.queueRoot(paragraph as unknown as Node, true);
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.takeSmallNewTextUpdate(() => false)).toEqual({
      fullScan: false, redetectLanguage: false, roots: [], elements: [paragraph]
    });
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    expect(queue.consume().roots).toEqual([container]);
  });

  it("keeps English, managed, oversized, shadow, and invalidated text on the normal queue", () => {
    const body = browserTree();
    installWalker();
    const paragraph = childOf(body);
    const text = Object.assign(new TestNode(), { nodeType: 3, nodeValue: "English text", parentElement: paragraph });
    paragraph.childNodes.push(text);
    const queue = new UpdateQueue();
    queue.consume();
    const remember = () => queue.queueRoot(paragraph as unknown as Node, true);
    remember();
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    text.nodeValue = "新的中文回复";
    remember();
    expect(queue.takeSmallNewTextUpdate(() => true)).toBeNull();
    text.nodeValue = "文".repeat(10001);
    remember();
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    text.nodeValue = "新的中文回复";
    paragraph.root = new TestShadowRoot(body);
    remember();
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    paragraph.root = body.root;
    remember();
    queue.requestLanguageDetection();
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
    expect(queue.consume()).toMatchObject({ redetectLanguage: true, roots: [paragraph] });
    remember();
    queue.requestFullScan();
    expect(queue.takeSmallNewTextUpdate(() => false)).toBeNull();
  });

  it("requires a local update with no pending language detection", () => {
    const body = browserTree();
    installWalker();
    const paragraph = childOf(body);
    paragraph.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "新增中文" }));
    const queue = new UpdateQueue();
    expect(queue.isSmallLocalUpdate()).toBe(false);
    queue.consume();
    expect(queue.isSmallLocalUpdate()).toBe(false);
    queueRoot(queue, paragraph);
    expect(queue.isSmallLocalUpdate()).toBe(true);
    queue.requestLanguageDetection();
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.consume()).toMatchObject({ redetectLanguage: true, roots: [paragraph] });
  });

  it("counts overlapping queued regions once, matching the scan that will run", () => {
    const body = browserTree();
    installWalker();
    const queue = new UpdateQueue();
    queue.consume();
    const outer = childOf(body);
    let parent = outer;
    for (let i = 0; i < 8; i++) {
      queueRoot(queue, parent);
      parent = childOf(parent);
    }
    for (let i = 0; i < 30; i++) {
      const child = childOf(parent);
      child.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "文".repeat(200) }));
      queueRoot(queue, child);
      queueElement(queue, child);
    }
    expect(queue.isSmallLocalUpdate()).toBe(true);
    expect(queue.consume()).toMatchObject({ roots: [outer], elements: [] });
  });

  it("leaves oversized updates queued for normal batching", () => {
    const body = browserTree();
    installWalker();
    const queue = new UpdateQueue();
    queue.consume();
    const large = childOf(body);
    large.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "中文" }));
    for (let i = 0; i < 129; i++) childOf(large);
    queueRoot(queue, large);
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.consume().roots).toEqual([large]);
    const long = childOf(body);
    long.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "文".repeat(10001) }));
    queueElement(queue, long);
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.consume().elements).toEqual([long]);
  });

  it("leaves pure English updates queued for normal batching", () => {
    const body = browserTree();
    installWalker();
    const paragraph = childOf(body);
    paragraph.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "An English description" }));
    const queue = new UpdateQueue();
    queue.consume();
    queueRoot(queue, paragraph);
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.consume().roots).toEqual([paragraph]);
  });

  it("takes small clicked content without consuming unrelated or ancestor invalidations", () => {
    const body = browserTree();
    installWalker();
    const widget = childOf(body);
    const button = childOf(widget);
    const content = childOf(widget);
    content.childNodes.push(Object.assign(new TestNode(), { nodeType: 3, nodeValue: "新增中文" }));
    const unrelated = childOf(body);
    const queue = new UpdateQueue();
    queue.consume();
    queueRoot(queue, widget);
    const pending = Array.from({ length: 180 }, () => childOf(unrelated));
    for (const element of pending) queueRoot(queue, element);
    queueElement(queue, content);
    expect(queue.isSmallLocalUpdate()).toBe(false);
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toEqual({
      fullScan: false, redetectLanguage: false, roots: [content], elements: []
    });
    expect(queue.consume()).toEqual({
      fullScan: false, redetectLanguage: false, roots: [widget, ...pending], elements: []
    });
  });

  it("retains English, oversized, and language-invalidated content for normal processing", () => {
    const body = browserTree();
    installWalker();
    const widget = childOf(body);
    const button = childOf(widget);
    const content = childOf(widget);
    const text = Object.assign(new TestNode(), { nodeType: 3, nodeValue: "English text" });
    content.childNodes.push(text);
    const queue = new UpdateQueue();
    queue.consume();
    queueElement(queue, content);
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toBeNull();
    text.nodeValue = "文".repeat(10001);
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toBeNull();
    text.nodeValue = "中文";
    queue.requestLanguageDetection();
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toBeNull();
    expect(queue.consume()).toMatchObject({ redetectLanguage: true, elements: [content] });
    for (let i = 0; i < 129; i++) childOf(content);
    queueElement(queue, content);
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toBeNull();
    expect(queue.consume().elements).toEqual([content]);
    queueElement(queue, content);
    queue.requestFullScan();
    expect(queue.takeSmallInteractionUpdate(button as unknown as Element)).toBeNull();
    expect(queue.consume().fullScan).toBe(true);
  });
});

describe("batched DOM update queue", () => {
  it("keeps only the outermost added roots while retaining unrelated direct updates", () => {
    const body = browserTree();
    const container = childOf(body);
    const first = childOf(container);
    const second = childOf(container);
    const sibling = childOf(body);
    const queue = new UpdateQueue();
    queue.consume();

    queueRoot(queue, first);
    queueRoot(queue, second);
    queueElement(queue, first);
    queueRoot(queue, container);
    queueElement(queue, sibling);

    expect(queue.consume()).toEqual({
      fullScan: false,
      redetectLanguage: false,
      roots: [container],
      elements: [sibling]
    });
  });

  it("collapses queued descendants across a shadow boundary", () => {
    const body = browserTree();
    const host = childOf(body);
    const shadowChild = new TestHTMLElement();
    shadowChild.root = new TestShadowRoot(host);
    const queue = new UpdateQueue();
    queue.consume();

    queueElement(queue, shadowChild);
    queueRoot(queue, host);

    const update = queue.consume();
    expect(update.roots).toEqual([host]);
    expect(update.elements).toEqual([]);
  });

  it("drops removed nodes and lets a full scan replace local work", () => {
    const body = browserTree();
    const removed = childOf(body);
    const remaining = childOf(body);
    const queue = new UpdateQueue();
    queue.consume();

    queueRoot(queue, removed);
    removed.isConnected = false;
    queueElement(queue, remaining);
    expect(queue.consume()).toEqual({
      fullScan: false,
      redetectLanguage: false,
      roots: [],
      elements: [remaining]
    });

    queueRoot(queue, remaining);
    queue.requestFullScan(true);
    expect(queue.consume()).toEqual({
      fullScan: true,
      redetectLanguage: true,
      roots: [],
      elements: []
    });
  });
});
