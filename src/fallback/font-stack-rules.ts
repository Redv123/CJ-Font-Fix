interface FontStackRule {
  id: string;
  value: string;
  count: number;
}

/** Owns reference-counted CSS rules shared by identical completed font stacks. */
export class FontStackRules {
  readonly managedAttribute = "data-cjk-fallback-fixed";
  readonly stackAttribute = "data-cjk-fallback-stack";
  readonly styleId = "cjk-font-fallback-generated-rules";
  private readonly rules = new Map<string, FontStackRule>();
  private styleElement: HTMLStyleElement | null = null;
  private dirty = false;
  private nextId = 1;

  isStyleNode(node: Node | null): boolean {
    if (!(node instanceof Element)) return false;
    return node.id === this.styleId || Boolean(node.closest?.(`#${this.styleId}`));
  }

  containsStyleNode(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    return node.id === this.styleId || Boolean(node.querySelector?.(`#${this.styleId}`));
  }

  acquire(value: string): string {
    let rule = this.rules.get(value);
    if (!rule) {
      rule = { id: `s${this.nextId++}`, value, count: 0 };
      this.rules.set(value, rule);
      this.dirty = true;
    }
    rule.count++;
    return rule.id;
  }

  release(value: string): void {
    const rule = this.rules.get(value);
    if (rule) rule.count = Math.max(0, rule.count - 1);
  }

  render(): void {
    this.dirty = false;
    if (!this.rules.size) {
      this.styleElement?.remove();
      this.styleElement = null;
      return;
    }
    if (!this.styleElement?.isConnected) {
      this.styleElement = document.createElement("style");
      this.styleElement.id = this.styleId;
      (document.head || document.documentElement).append(this.styleElement);
    }
    const attribute = this.stackAttribute;
    // The impossible :not() ID chain adds specificity without matching a
    // real site element. It lets one shared rule beat ordinary site CSS while
    // avoiding an inline declaration on every managed element.
    this.styleElement.textContent = Array.from(this.rules.values(), ({ id, value }) =>
      `[${attribute}="${id}"]:not(#cjk-font-fallback-a#cjk-font-fallback-b#cjk-font-fallback-c) { font-family: ${value} !important; }`
    ).join("\n");
  }

  prune(): void {
    let changed = false;
    for (const [value, rule] of Array.from(this.rules.entries())) {
      if (rule.count > 0) continue;
      this.rules.delete(value);
      changed = true;
      this.dirty = true;
    }
    if (changed || this.dirty || (this.rules.size && !this.styleElement?.isConnected)) this.render();
  }

  recreateAfterRemoval(): void {
    this.styleElement = null;
    this.render();
  }
}
