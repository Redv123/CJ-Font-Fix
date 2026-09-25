import { variantToLang } from "../language/tags";
import { CJK_TEXT_RE } from "../page/candidate-scan";
import type { Variant } from "../shared/types";

interface OriginalLang {
  hadAttribute: boolean;
  value: string;
}

/**
 * Implements the root-language-only strategy.
 * Its temporary observer exists only for initially client-rendered pages and
 * stops once CJK is found or the two-second bootstrap window expires.
 */
export class SimpleMode {
  private originalLang: OriginalLang | null = null;
  private currentAppliedLang = "";
  private observer: MutationObserver | null = null;
  private scanTimer = 0;
  private deadlineTimer = 0;

  constructor(
    private readonly requestScan: () => void,
    private readonly subtreeContainsCjk: (node: Node | null) => boolean
  ) {}

  get originalLangValue(): string | null {
    return this.originalLang?.value ?? null;
  }

  get appliedLang(): string {
    return this.currentAppliedLang;
  }

  startBootstrap(enabled: boolean): void {
    this.stopBootstrap();
    const root = document.documentElement;
    if (!enabled || !root) return;

    this.observer = new MutationObserver((mutations) => {
      const gainedCjk = mutations.some((mutation) => {
        if (mutation.type === "characterData") {
          return CJK_TEXT_RE.test(mutation.target.nodeValue || "");
        }
        return Array.from(mutation.addedNodes).some(this.subtreeContainsCjk);
      });
      if (gainedCjk) this.scheduleScan();
    });
    this.observer.observe(root, { childList: true, subtree: true, characterData: true });
    this.deadlineTimer = window.setTimeout(() => {
      this.stopBootstrap();
      this.requestScan();
    }, 2000);
  }

  stopBootstrap(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.scanTimer = 0;
    this.deadlineTimer = 0;
  }

  apply(variant: Variant | null): void {
    const root = document.documentElement;
    const targetLang = variantToLang(variant);
    if (!root || !targetLang) {
      this.restore();
      return;
    }
    if (!this.originalLang) {
      this.originalLang = {
        hadAttribute: root.hasAttribute("lang"),
        value: root.getAttribute("lang") || ""
      };
    }
    root.setAttribute("lang", targetLang);
    this.currentAppliedLang = targetLang;
  }

  restore(): void {
    if (!this.originalLang) return;
    const root = document.documentElement;
    if (root && root.getAttribute("lang") === this.currentAppliedLang) {
      if (this.originalLang.hadAttribute) root.setAttribute("lang", this.originalLang.value);
      else root.removeAttribute("lang");
    }
    this.originalLang = null;
    this.currentAppliedLang = "";
  }

  private scheduleScan(): void {
    if (this.scanTimer) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = 0;
      this.requestScan();
    }, 80);
  }
}
