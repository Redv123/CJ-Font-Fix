import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedStyles } from "../src/fallback/managed-styles";

function element(): HTMLElement {
  const properties = new Map<string, { value: string; priority: string }>();
  return {
    style: {
      setProperty: (key: string, value: string, priority = "") => properties.set(key, { value, priority }),
      getPropertyValue: (key: string) => properties.get(key)?.value || "",
      getPropertyPriority: (key: string) => properties.get(key)?.priority || "",
      removeProperty: (key: string) => properties.delete(key)
    },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn()
  } as unknown as HTMLElement;
}

function apply(styles: ManagedStyles, target: HTMLElement, inlineFallback: boolean): void {
  styles.commit({ element: target, variant: "sc", fallback: "Test SC",
    appliedValue: '"Test SC", sans-serif', inlineFallback,
    originalInlineValue: "", originalInlinePriority: "" });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("inherited fallback lookup", () => {
  it("does not read ancestors when no different variant is managed", () => {
    const styles = new ManagedStyles();
    const target = element();
    const readParent = vi.fn(() => null);
    Object.defineProperty(target, "parentElement", { get: readParent });
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual([]);
    apply(styles, element(), false);
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual([]);
    styles.restoreAll();
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual([]);
    expect(readParent).not.toHaveBeenCalled();
  });

  it("retains other-variant ancestors and follows restored state without caching", () => {
    class TestHTMLElement {}
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    vi.stubGlobal("ShadowRoot", class {});
    const ancestor = Object.assign(Object.setPrototypeOf(element(), TestHTMLElement.prototype), {
      parentElement: null, getRootNode: () => ({})
    }) as HTMLElement;
    const middle = Object.assign(Object.setPrototypeOf(element(), TestHTMLElement.prototype), {
      parentElement: ancestor
    }) as HTMLElement;
    const target = Object.assign(element(), { parentElement: middle });
    const styles = new ManagedStyles();
    const action = { element: ancestor, variant: "tc" as const, fallback: "Test TC",
      appliedValue: '"Test TC", sans-serif', inlineFallback: false,
      originalInlineValue: "", originalInlinePriority: "" };
    styles.commit(action);
    apply(styles, middle, false);
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual(["Test TC"]);
    expect(styles.inheritedFallbacksFor(target, "tc")).toEqual(["Test SC"]);
    styles.restore(ancestor);
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual([]);
    styles.commit(action);
    expect(styles.inheritedFallbacksFor(target, "sc")).toEqual(["Test TC"]);
  });
});

describe("managed style self-write suppression", () => {
  it("does not schedule suppression for shared-rule attributes", () => {
    vi.useFakeTimers();
    const styles = new ManagedStyles();
    const target = element();
    apply(styles, target, false);
    styles.prepareForRead(target, styles.get(target));
    styles.restore(target);
    expect(styles.isSelfMutation(target)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps all inline writes suppressed until one batch cleanup", () => {
    vi.useFakeTimers();
    const styles = new ManagedStyles();
    const first = element();
    const second = element();
    apply(styles, first, true);
    styles.prepareForRead(first, styles.get(first));
    styles.restore(first);
    apply(styles, second, true);
    expect(styles.isSelfMutation(first)).toBe(true);
    expect(styles.isSelfMutation(second)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(styles.isSelfMutation(first)).toBe(false);
    expect(styles.isSelfMutation(second)).toBe(false);
    styles.restore(second);
    expect(styles.isSelfMutation(second)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(styles.isSelfMutation(second)).toBe(false);
  });
});
