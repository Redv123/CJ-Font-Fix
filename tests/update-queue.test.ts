import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateQueue } from "../src/page/update-queue";

class TestNode {
  static readonly TEXT_NODE = 3;
  readonly nodeType = 1;
  parentElement: TestElement | null = null;
  readonly childNodes: TestNode[] = [];
  isConnected = true;
  root: object | null = null;

  getRootNode(): object {
    return this.root || document;
  }
}

class TestElement extends TestNode {}
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
