import { CJK_TEXT_RE, EXCLUDED } from "./candidate-scan";
import { SC_CLUES, TC_CLUES } from "../language/chinese-clues";
import { analyzeCjkEvidence } from "../language/local-evidence";
import { langToVariant } from "../language/tags";
import type { DetectionResult, Settings, SiteOverride, Variant } from "../shared/types";

export interface ExtendedDetection extends DetectionResult {
  changedElements?: number;
  appliedVariants?: Variant[];
  appliedFonts?: string[];
}

interface AutomaticDetectionCache {
  key: string;
  variant: Variant | null;
  detection: ExtendedDetection;
}

export interface LanguageDetection {
  variant: Variant | null;
  detection: ExtendedDetection;
}

const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/gu;

function isVariant(value: unknown): value is Variant {
  return value === "sc" || value === "tc" || value === "jp";
}

/**
 * Resolve only a close browser zh/ja vote using independent Japanese text
 * segments. A Japanese title quoted inside Chinese prose is not page proof.
 */
function hasDominantJapaneseSegments(sample: string): boolean {
  let japaneseBlocks = 0;
  let japaneseCharacters = 0;
  let supportedBlocks = 0;
  let otherScClues = 0;
  let otherTcClues = 0;
  const seen = new Set<string>();

  // collectSample separates DOM text nodes with newlines. Keep repeated UI or
  // duplicate titles from counting as independent language evidence.
  for (const line of sample.split("\n")) {
    const segment = line.trim();
    if (!segment || seen.has(segment)) continue;
    // The shared local analyzer examines at most 500 characters. Never use
    // a truncated long paragraph as evidence for a whole-page override.
    if (segment.length > 500) return false;
    seen.add(segment);
    const evidence = analyzeCjkEvidence(segment, SC_CLUES, TC_CLUES);
    if (evidence.strongVariant === "jp" && evidence.kanaCount >= 3) {
      japaneseBlocks++;
      japaneseCharacters += evidence.cjkCount;
      if (evidence.japaneseHanClues > 0) supportedBlocks++;
    } else {
      if (evidence.strongVariant === "sc" || evidence.strongVariant === "tc") return false;
      otherScClues += evidence.scClues;
      otherTcClues += evidence.tcClues;
    }
  }

  return japaneseBlocks >= 2 && japaneseCharacters >= 40 && supportedBlocks >= 2 &&
    otherScClues < 4 && otherTcClues < 4;
}

/**
 * Produces one stable page-level variant from declarations and a capped sample.
 * The sample cache prevents unrelated DOM updates from repeatedly invoking the
 * asynchronous browser language detector.
 */
export class PageLanguageDetector {
  private sampleRoot: Element | null = null;
  private cache: AutomaticDetectionCache | null = null;

  /** Prefer main content, or a shared article container on result-list pages. */
  collectSample(limit = 10000): string {
    // Re-evaluate the root when detection runs: a SPA can add more articles
    // after its first result without removing that first article.
    this.sampleRoot = this.chooseSampleRoot();
    const preferred = this.sampleRoot;
    if (!preferred) return document.title || "";
    const walker = document.createTreeWalker(preferred, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(EXCLUDED)) return NodeFilter.FILTER_REJECT;
        const value = node.nodeValue?.replace(/\s+/g, " ").trim();
        return value ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let sample = `${document.title || ""}\n`;
    while (sample.length < limit) {
      const node = walker.nextNode();
      if (!node) break;
      sample += `${node.nodeValue?.trim() || ""}\n`;
    }
    return sample.slice(0, limit);
  }

  private chooseSampleRoot(): Element | null {
    const main = document.querySelector("main") || document.querySelector("[role='main']");
    if (main) return main;

    const articles = document.querySelectorAll("article");
    const first = articles[0];
    const second = articles[1];
    if (!first) return document.body;
    if (!second) return first;

    // Search-result cards often use one article per item. Their nearest shared
    // ancestor includes the results without pulling in a whole-page header.
    let shared = first.parentElement;
    while (shared && !shared.contains(second)) shared = shared.parentElement;
    return shared || document.body;
  }

  touchesSample(node: Node | null, includeAncestor = false): boolean {
    if (!this.sampleRoot || !node) return true;
    if (includeAncestor && node instanceof Element) {
      const primary = "main, [role='main']";
      if (node.matches(primary) || node.querySelector(primary)) return true;
      if (this.sampleRoot.tagName === "ARTICLE" &&
          (node.matches("article") || node.querySelector("article"))) return true;
    }
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current) {
      if (current === this.sampleRoot || this.sampleRoot.contains?.(current) ||
          (includeAncestor && current.contains?.(this.sampleRoot))) return true;
      const root = current.getRootNode?.();
      current = typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  }

  sampleRootWasRemoved(mutation: MutationRecord): boolean {
    if (!this.sampleRoot || mutation.type !== "childList") return false;
    const removed = Array.from(mutation.removedNodes).some((node) =>
      node === this.sampleRoot || (node instanceof Element && node.contains(this.sampleRoot))
    );
    if (removed) this.sampleRoot = null;
    return removed;
  }

  async detect(
    settings: Settings,
    classifyChinese: (text: string) => "sc" | "tc",
    originalSimpleLang: string | null
  ): Promise<LanguageDetection> {
    const htmlLang = settings.simpleMode && originalSimpleLang !== null
      ? originalSimpleLang
      : document.documentElement?.lang || "";
    const declared = langToVariant(htmlLang);
    const hostOverride: SiteOverride | "auto" = settings.siteOverrides[location.hostname] || "auto";
    let detection: ExtendedDetection = {
      htmlLang, detectedLanguage: "", reliable: false, variant: null, reason: ""
    };

    if (hostOverride === "off") {
      detection.reason = "Disabled for this site";
      return { variant: null, detection };
    }
    if (isVariant(hostOverride)) {
      detection.variant = hostOverride;
      detection.reason = "Site override";
      return { variant: hostOverride, detection };
    }
    if (settings.trustCjkLang && declared && declared !== "zh") {
      detection.variant = declared;
      detection.reason = "HTML lang";
      return { variant: declared, detection };
    }

    const sample = this.collectSample();
    const automaticKey = JSON.stringify([
      htmlLang, sample, settings.defaultChinese, settings.trustCjkLang
    ]);
    if (this.cache?.key === automaticKey) {
      return { variant: this.cache.variant, detection: { ...this.cache.detection } };
    }
    const remember = (variant: Variant | null): LanguageDetection => {
      this.cache = { key: automaticKey, variant, detection: { ...detection } };
      return { variant, detection };
    };

    if (settings.trustCjkLang && declared === "zh") {
      const variant = classifyChinese(sample);
      detection.variant = variant;
      detection.reason = "HTML lang + Chinese script clues";
      return remember(variant);
    }
    const compactSample = sample.replace(/\s+/g, "");
    const cjkCharCount = Array.from(compactSample).reduce(
      (count, char) => count + (CJK_TEXT_RE.test(char) ? 1 : 0), 0
    );
    const cjkRatio = cjkCharCount / Math.max(1, compactSample.length);
    const kanaCount = (sample.match(KANA_RE) || []).length;
    const kanaShare = kanaCount / Math.max(1, cjkCharCount);
    if (cjkCharCount === 0) {
      detection.reason = "No CJK text";
      return remember(null);
    }
    if (!sample || sample.length < 8) {
      detection.reason = "Not enough CJK text";
      return remember(null);
    }

    try {
      const result = await chrome.i18n.detectLanguage(sample);
      const best = result.languages?.[0];
      const chromeConfident = Boolean(result.isReliable) || (best?.percentage || 0) >= 60;
      detection.detectedLanguage = best?.language || "";
      detection.reliable = Boolean(result.isReliable);
      if (chromeConfident && best?.language?.toLowerCase().startsWith("ja") && cjkRatio >= 0.15) {
        detection.variant = "jp";
        detection.reason = "Chrome language detection";
        return remember("jp");
      }
      const japaneseResult = result.languages?.find(({ language }) => language.toLowerCase().startsWith("ja"));
      // A close zh/ja vote needs corroboration from separate Japanese segments.
      // Kana totals alone can be dominated by titles on a Chinese page.
      if (best?.language?.toLowerCase().startsWith("zh") && japaneseResult &&
          (best.percentage || 0) - (japaneseResult.percentage || 0) <= 10 &&
          cjkRatio >= 0.15 && hasDominantJapaneseSegments(sample)) {
        detection.variant = "jp";
        detection.reason = "Japanese kana fallback";
        return remember("jp");
      }
      const leadingChinese = best?.language?.toLowerCase().startsWith("zh") &&
        (chromeConfident || (best.percentage || 0) >= 40);
      if (leadingChinese && cjkRatio >= 0.15) {
        const variant = classifyChinese(sample);
        detection.variant = variant;
        detection.reason = "Chrome detection + Chinese script clues";
        return remember(variant);
      }
    } catch (error) {
      console.debug("CJ Font Fallback: language detection failed", error);
    }

    if (kanaCount >= 4 && kanaShare >= 0.10 && cjkRatio >= 0.15) {
      detection.variant = "jp";
      detection.reason = "Japanese kana fallback";
      return remember("jp");
    }
    if (cjkCharCount >= 3 && cjkRatio >= 0.15) {
      const variant = classifyChinese(sample);
      detection.variant = variant;
      detection.reason = "Chinese script clues fallback";
      return remember(variant);
    }
    detection.reason = "CJK text is too sparse";
    return remember(null);
  }
}
